# Per-company offices (branches): tenant list, branch requests, platform approve/reject, set offices, create client offices
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL") or open("/app/frontend/.env").read().split("REACT_APP_BACKEND_URL=")[1].split()[0]
BASE_URL = BASE_URL.rstrip("/")
API = f"{BASE_URL}/api"


def _login(email, pw):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": pw}, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()


def _h(tok):
    return {"Authorization": f"Bearer {tok}"}


@pytest.fixture(scope="module")
def owner():
    return _h(_login("owner@educonnect.app", "Owner@12345")["access_token"])


@pytest.fixture(scope="module")
def admin_login():
    return _login("admin@educonnect.app", "Admin@12345")


@pytest.fixture(scope="module")
def admin(admin_login):
    return _h(admin_login["access_token"])


@pytest.fixture(scope="module")
def office_admin():
    return _h(_login("office@educonnect.app", "Office@12345")["access_token"])


@pytest.fixture(scope="module")
def test_client(owner):
    """A throwaway client with two offices; deleted on teardown."""
    sfx = uuid.uuid4().hex[:6]
    email = f"test_offices_{sfx}@example.com"
    pw = "TestPw@12345"
    r = requests.post(f"{API}/platform/tenants", headers=owner, json={
        "name": f"TEST_OffCo {sfx}", "admin_email": email, "admin_password": pw,
        "offices": ["Alpha Office", "Beta Office"]}, timeout=60)
    assert r.status_code == 201, r.text
    t = r.json()
    yield {"tenant": t, "email": email, "pw": pw}
    requests.delete(f"{API}/platform/tenants/{t['id']}", headers=owner, timeout=60)


# --- auth: login / me offices ---
class TestAuthOffices:
    def test_login_offices_active_only(self, admin_login):
        offs = admin_login["offices"]
        codes = [o["code"] for o in offs]
        assert "KM_BLR" in codes
        assert "KM_TCR" not in codes and "KM_KMLY" not in codes
        assert all(set(o.keys()) == {"code", "name"} for o in offs)
        assert next(o for o in offs if o["code"] == "KM_BLR")["name"] == "ZELIX VENTURES"

    def test_me_offices(self, admin):
        r = requests.get(f"{API}/auth/me", headers=admin, timeout=30)
        assert r.status_code == 200
        codes = [o["code"] for o in r.json()["offices"]]
        assert "KM_BLR" in codes and "KM_TCR" not in codes

    def test_office_admin_me_offices(self, office_admin):
        r = requests.get(f"{API}/auth/me", headers=office_admin, timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d["office"] == "KM_BLR"
        assert "KM_BLR" in [o["code"] for o in d["offices"]]


# --- tenant offices + branch requests (ZELIX) ---
class TestTenantOffices:
    def test_list_offices(self, admin):
        r = requests.get(f"{API}/offices", headers=admin, timeout=30)
        assert r.status_code == 200
        codes = [o["code"] for o in r.json()["offices"]]
        assert "KM_BLR" in codes and "KM_TCR" not in codes and "KM_KMLY" not in codes

    def test_request_forbidden_for_office_admin(self, office_admin):
        r = requests.post(f"{API}/offices/requests", headers=office_admin, json={"name": "TEST_Nope"}, timeout=30)
        assert r.status_code == 403
        r = requests.get(f"{API}/offices/requests", headers=office_admin, timeout=30)
        assert r.status_code == 403

    def test_request_duplicate_and_reject(self, admin, owner, admin_login):
        name = f"TEST_Branch {uuid.uuid4().hex[:5]}"
        r = requests.post(f"{API}/offices/requests", headers=admin, json={"name": name, "note": "pls"}, timeout=30)
        assert r.status_code == 201, r.text
        req = r.json()
        assert req["status"] == "pending" and req["name"] == name and "_id" not in req
        r2 = requests.post(f"{API}/offices/requests", headers=admin, json={"name": name}, timeout=30)
        assert r2.status_code == 409
        mine = requests.get(f"{API}/offices/requests", headers=admin, timeout=30).json()["items"]
        assert any(i["id"] == req["id"] for i in mine)
        # platform lists it, filter by tenant
        tid = admin_login["tenant_id"]
        lst = requests.get(f"{API}/platform/office-requests", headers=owner, params={"status": "pending", "tenant_id": tid}, timeout=30)
        assert lst.status_code == 200
        assert any(i["id"] == req["id"] for i in lst.json()["items"])
        # reject
        rj = requests.post(f"{API}/platform/office-requests/{req['id']}/reject", headers=owner, json={}, timeout=30)
        assert rj.status_code == 200 and rj.json()["office"] is None
        mine = requests.get(f"{API}/offices/requests", headers=admin, timeout=30).json()["items"]
        assert next(i for i in mine if i["id"] == req["id"])["status"] == "rejected"
        # re-deciding -> 404
        again = requests.post(f"{API}/platform/office-requests/{req['id']}/approve", headers=owner, json={}, timeout=30)
        assert again.status_code == 404

    def test_request_short_name_422(self, admin):
        r = requests.post(f"{API}/offices/requests", headers=admin, json={"name": "A"}, timeout=30)
        assert r.status_code == 422

    def test_platform_requires_owner(self, admin):
        r = requests.get(f"{API}/platform/office-requests", headers=admin, timeout=30)
        assert r.status_code in (401, 403)

    def test_create_user_unknown_office(self, admin):
        for code in ("KM_TCR", "NOPE_XYZ"):
            r = requests.post(f"{API}/users", headers=admin, json={
                "email": f"test_unk_{uuid.uuid4().hex[:5]}@example.com", "password": "Test@12345",
                "name": "TEST unk", "role": "office_admin", "office": code}, timeout=30)
            assert r.status_code == 400, r.text
            assert "Unknown office" in r.json()["detail"]


# --- platform: create client with offices, set offices, approve flow ---
class TestPlatformOffices:
    def test_created_offices(self, test_client):
        offs = test_client["tenant"]["offices"]
        assert offs[0]["code"] == "HQ" and offs[0]["name"] == "Alpha Office" and offs[0]["active"]
        assert offs[1]["name"] == "Beta Office" and offs[1]["active"]
        assert len(offs) == 2

    def test_default_one_office(self, owner):
        sfx = uuid.uuid4().hex[:6]
        r = requests.post(f"{API}/platform/tenants", headers=owner, json={
            "name": f"TEST_Solo {sfx}", "admin_email": f"test_solo_{sfx}@example.com", "admin_password": "TestPw@12345"}, timeout=60)
        assert r.status_code == 201, r.text
        t = r.json()
        try:
            assert t["offices"] == [{"code": "HQ", "name": f"TEST_Solo {sfx}", "active": True}]
        finally:
            d = requests.delete(f"{API}/platform/tenants/{t['id']}", headers=owner, timeout=60)
            assert d.status_code in (200, 204)

    def test_client_admin_sees_offices(self, test_client):
        d = _login(test_client["email"], test_client["pw"])
        assert [o["name"] for o in d["offices"]] == ["Alpha Office", "Beta Office"]

    def test_set_offices_rename_hide_add(self, owner, test_client):
        tid = test_client["tenant"]["id"]
        offs = test_client["tenant"]["offices"]
        r = requests.put(f"{API}/platform/tenants/{tid}/offices", headers=owner, json={"offices": [
            {"code": "HQ", "name": "Alpha Renamed", "active": True},
            {"code": offs[1]["code"], "name": "Beta Office", "active": False},
            {"name": "Gamma Office", "active": True}]}, timeout=30)
        assert r.status_code == 200, r.text
        out = r.json()["offices"]
        assert out[0] == {"code": "HQ", "name": "Alpha Renamed", "active": True}
        assert out[1]["active"] is False
        assert out[2]["name"] == "Gamma Office" and out[2]["code"]
        d = _login(test_client["email"], test_client["pw"])
        assert [o["name"] for o in d["offices"]] == ["Alpha Renamed", "Gamma Office"]

    def test_set_offices_omitted_kept_hidden(self, owner, test_client):
        tid = test_client["tenant"]["id"]
        r = requests.put(f"{API}/platform/tenants/{tid}/offices", headers=owner,
                         json={"offices": [{"code": "HQ", "name": "Alpha Renamed", "active": True}]}, timeout=30)
        assert r.status_code == 200
        out = r.json()["offices"]
        assert len(out) == 3
        assert [o["active"] for o in out] == [True, False, False]

    def test_set_offices_requires_active(self, owner, test_client):
        tid = test_client["tenant"]["id"]
        r = requests.put(f"{API}/platform/tenants/{tid}/offices", headers=owner,
                         json={"offices": [{"code": "HQ", "name": "Alpha", "active": False}]}, timeout=30)
        assert r.status_code == 400

    def test_set_offices_404(self, owner):
        r = requests.put(f"{API}/platform/tenants/nope-xyz/offices", headers=owner,
                         json={"offices": [{"name": "X", "active": True}]}, timeout=30)
        assert r.status_code == 404

    def test_approve_adds_office(self, owner, test_client):
        a = _h(_login(test_client["email"], test_client["pw"])["access_token"])
        r = requests.post(f"{API}/offices/requests", headers=a, json={"name": "Delta Branch"}, timeout=30)
        assert r.status_code == 201
        rid = r.json()["id"]
        ap = requests.post(f"{API}/platform/office-requests/{rid}/approve", headers=owner, json={}, timeout=30)
        assert ap.status_code == 200, ap.text
        office = ap.json()["office"]
        assert office["name"] == "Delta Branch" and office["active"] is True and office["code"] == "DELTA_BRANCH"
        lst = requests.get(f"{API}/offices", headers=a, timeout=30).json()["offices"]
        assert {"code": "DELTA_BRANCH", "name": "Delta Branch"} in lst
        mine = requests.get(f"{API}/offices/requests", headers=a, timeout=30).json()["items"]
        st = next(i for i in mine if i["id"] == rid)
        assert st["status"] == "approved" and st["office_code"] == "DELTA_BRANCH"
