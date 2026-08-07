"""Iteration 37 backend tests — per-staff leave quota overrides, calendar
filters, lead funnel and ClientDetail staff_login_user resolution."""
import os
import pytest
import requests
from dotenv import load_dotenv

load_dotenv("/app/frontend/.env")
BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
SA = {"email": "admin@kmfoundation.online", "password": "Admin@786"}
OA = {"email": "blr1@finflow.com", "password": "Office@123"}
ST = {"email": "staff.blr@kmfoundation.online", "password": "Staff@123"}

FATHIMA_ID = "9aa85b63-c43e-471f-a456-55a88640636f"


def _login(creds):
    s = requests.Session()
    r = s.post(f"{BASE}/api/auth/login", json=creds, timeout=15)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    tok = r.json().get("token") or r.json().get("access_token")
    if tok:
        s.headers.update({"Authorization": f"Bearer {tok}"})
    return s


@pytest.fixture(scope="module")
def sa():
    return _login(SA)


@pytest.fixture(scope="module")
def oa():
    return _login(OA)


@pytest.fixture(scope="module")
def st():
    return _login(ST)


# ---------- quotas/team listing ----------
class TestQuotaTeam:
    def test_sa_lists_staff_and_office_admins(self, sa):
        r = sa.get(f"{BASE}/api/leave/quotas/team", timeout=15)
        assert r.status_code == 200
        body = r.json()
        assert "global" in body and "members" in body
        roles = {m["role"] for m in body["members"]}
        assert "staff" in roles, f"missing staff in roles: {roles}"
        assert "office_admin" in roles, f"missing office_admin in roles: {roles}"
        for k in ("casual", "sick", "earned"):
            assert k in body["global"]

    def test_oa_only_own_office_staff(self, oa):
        r = oa.get(f"{BASE}/api/leave/quotas/team", timeout=15)
        assert r.status_code == 200
        body = r.json()
        for m in body["members"]:
            assert m["role"] == "staff", f"OA should only see staff, got {m['role']}"
            assert m["office"] == "KM_BLR", f"OA should be scoped, got {m['office']}"

    def test_staff_forbidden(self, st):
        r = st.get(f"{BASE}/api/leave/quotas/team", timeout=15)
        assert r.status_code == 403


# ---------- per-user override CRUD ----------
class TestQuotaCRUD:
    def test_oa_put_get_delete_own_staff(self, oa):
        # PUT override
        payload = {"casual": 14, "sick": 8, "earned": 18, "unpaid": None}
        r = oa.put(f"{BASE}/api/leave/quotas/user/{FATHIMA_ID}", json=payload, timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["has_override"] is True
        assert body["quota"]["casual"] == 14
        # GET reflects override
        r = oa.get(f"{BASE}/api/leave/quotas/user/{FATHIMA_ID}", timeout=15)
        assert r.status_code == 200
        body = r.json()
        assert body["has_override"] is True
        assert body["quota"]["casual"] == 14
        assert body["quota"]["earned"] == 18
        # DELETE reverts
        r = oa.delete(f"{BASE}/api/leave/quotas/user/{FATHIMA_ID}", timeout=15)
        assert r.status_code == 200
        assert r.json()["has_override"] is False
        # GET now matches global
        r = oa.get(f"{BASE}/api/leave/quotas/user/{FATHIMA_ID}", timeout=15)
        assert r.status_code == 200
        assert r.json()["has_override"] is False

    def test_oa_forbidden_on_office_admin_target(self, oa, sa):
        # find an office_admin id (other than self) via sa users list
        r = sa.get(f"{BASE}/api/users?status=approved", timeout=15)
        assert r.status_code == 200
        oa_users = [u for u in r.json() if u.get("role") == "office_admin"]
        assert oa_users
        target = oa_users[0]["id"]
        payload = {"casual": 5, "sick": 5, "earned": 5, "unpaid": 0}
        r = oa.put(f"{BASE}/api/leave/quotas/user/{target}", json=payload, timeout=15)
        assert r.status_code == 403, f"expected 403, got {r.status_code} {r.text}"

    def test_sa_balance_uses_override(self, sa):
        # SA sets override on Fathima then asserts has_override True via /quotas/user
        payload = {"casual": 20, "sick": 7, "earned": 16, "unpaid": None}
        r = sa.put(f"{BASE}/api/leave/quotas/user/{FATHIMA_ID}", json=payload, timeout=15)
        assert r.status_code == 200
        r = sa.get(f"{BASE}/api/leave/quotas/user/{FATHIMA_ID}", timeout=15)
        assert r.json()["quota"]["casual"] == 20
        # cleanup
        sa.delete(f"{BASE}/api/leave/quotas/user/{FATHIMA_ID}", timeout=15)


# ---------- calendar filters ----------
class TestCalendarFilters:
    def test_sa_calendar_with_office_filter(self, sa):
        r = sa.get(f"{BASE}/api/leave/calendar", params={"month": "2026-01", "office": "KM_BLR"}, timeout=15)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_oa_calendar_member_filter(self, oa):
        r = oa.get(f"{BASE}/api/leave/calendar", params={"month": "2026-01", "member": FATHIMA_ID}, timeout=15)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_invalid_month(self, sa):
        r = sa.get(f"{BASE}/api/leave/calendar", params={"month": "2026-13"}, timeout=15)
        assert r.status_code == 400


# ---------- lead funnel stats ----------
class TestLeadStats:
    def test_sa_stats_has_funnel_stages(self, sa):
        r = sa.get(f"{BASE}/api/leads/stats", timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        # accept either flat stage keys or a 'by_status' map
        flat = all(k in body for k in ("new", "contacted", "interested", "follow_up", "converted"))
        nested = isinstance(body.get("by_status"), dict) and all(
            k in body["by_status"] for k in ("new", "contacted", "interested", "follow_up", "converted")
        )
        assert flat or nested, f"funnel stages missing: {body}"

    def test_oa_stats(self, oa):
        r = oa.get(f"{BASE}/api/leads/stats", timeout=15)
        assert r.status_code == 200


# ---------- ClientDetail staff_login_user ----------
class TestClientDetailLoginUser:
    def test_temp_staff_client_matches_login_user(self, sa):
        # Create client with exact case-insensitive match to staff login user 'Fathima Telecaller'
        payload = {
            "name": "Fathima Telecaller",
            "client_type": "staff",
            "office": "KM_BLR",
            "phone": "9000000000",
        }
        r = sa.post(f"{BASE}/api/clients", json=payload, timeout=15)
        assert r.status_code in (200, 201), r.text
        cid = r.json()["id"]
        try:
            r = sa.get(f"{BASE}/api/clients/{cid}/detail", timeout=15)
            assert r.status_code == 200, r.text
            body = r.json()
            slu = body.get("staff_login_user") or (body.get("client") or {}).get("staff_login_user")
            assert slu is not None, f"expected staff_login_user resolution, got: {body}"
            assert "leave_quota" in slu
            assert "has_override" in slu
            assert slu.get("id") == FATHIMA_ID
        finally:
            sa.delete(f"{BASE}/api/clients/{cid}", timeout=15)
