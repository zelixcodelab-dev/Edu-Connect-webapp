# Iteration 4: Client-detail tabs (applications/database/subscription/security), seat limit enforcement,
# App-detail tabs (deployments/versions/keys/server/databases/logs) and session revocation.
import os
import time
import uuid

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    from pathlib import Path
    for line in Path("/app/frontend/.env").read_text().splitlines():
        if line.startswith("REACT_APP_BACKEND_URL="):
            BASE_URL = line.split("=", 1)[1].strip().strip('"').rstrip("/")

TID = "3b5e3f1f-dba9-4a89-a201-c2fdb24372ef"
OWNER = ("owner@educonnect.app", "Owner@12345")
ADMIN = ("admin@educonnect.app", "Admin@12345")
P = f"{BASE_URL}/api/platform"


def _login(email, pw):
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": pw}, timeout=30)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture(scope="module")
def owner():
    return _login(*OWNER)


@pytest.fixture(scope="module")
def app_id(owner):
    d = requests.get(f"{P}/apps", headers=owner).json()
    apps = d.get("apps") if isinstance(d, dict) else d
    return next(a["id"] for a in apps if a["name"] == "EduConnect Pro")


# --- Applications tab
class TestApplications:
    def test_list_and_toggle(self, owner, app_id):
        r = requests.get(f"{P}/tenants/{TID}/applications", headers=owner)
        assert r.status_code == 200
        a = next(x for x in r.json()["apps"] if x["id"] == app_id)
        assert a["assigned"] is True
        assert "assigned_client_ids" not in a
        r = requests.put(f"{P}/tenants/{TID}/applications/{app_id}", json={"assigned": False}, headers=owner)
        assert r.status_code == 200
        a = next(x for x in requests.get(f"{P}/tenants/{TID}/applications", headers=owner).json()["apps"] if x["id"] == app_id)
        assert a["assigned"] is False
        app = requests.get(f"{P}/apps/{app_id}", headers=owner).json()
        assert TID not in (app.get("assigned_client_ids") or [])
        # restore
        r = requests.put(f"{P}/tenants/{TID}/applications/{app_id}", json={"assigned": True}, headers=owner)
        assert r.status_code == 200
        a = next(x for x in requests.get(f"{P}/tenants/{TID}/applications", headers=owner).json()["apps"] if x["id"] == app_id)
        assert a["assigned"] is True

    def test_unknown_app_404(self, owner):
        r = requests.put(f"{P}/tenants/{TID}/applications/nope", json={"assigned": True}, headers=owner)
        assert r.status_code == 404


# --- Database tab
def test_tenant_database(owner):
    r = requests.get(f"{P}/tenants/{TID}/database", headers=owner)
    assert r.status_code == 200
    d = r.json()
    assert d["status"] == "online"
    assert d["name"].startswith("test_database_t_")
    assert isinstance(d["collections"], list) and len(d["collections"]) > 0
    assert any(c["name"] == "users" and c["count"] >= 1 for c in d["collections"])
    assert d["objects"] > 0


# --- Subscription + seat limit enforcement
class TestSubscription:
    def _sub(self, owner):
        return requests.get(f"{P}/tenants/{TID}/subscription", headers=owner).json()

    def test_validation(self, owner):
        d = self._sub(owner)
        pid = d["plans"][0]["id"]
        r = requests.put(f"{P}/tenants/{TID}/subscription", json={"plan_id": pid, "status": "bogus"}, headers=owner)
        assert r.status_code == 400
        r = requests.put(f"{P}/tenants/{TID}/subscription", json={"plan_id": "nope", "status": "active"}, headers=owner)
        assert r.status_code == 400

    def test_seat_limit_blocks_and_unblocks(self, owner):
        d = self._sub(owner)
        orig = d["subscription"]
        used = orig["seats_used"]
        pid = orig.get("plan_id") or d["plans"][0]["id"]
        r = requests.put(f"{P}/tenants/{TID}/subscription",
                         json={"plan_id": pid, "status": orig.get("status", "trial"), "seat_limit": used}, headers=owner)
        assert r.status_code == 200, r.text
        assert r.json()["subscription"]["seat_limit"] == used
        admin = _login(*ADMIN)
        tag = uuid.uuid4().hex[:6]
        created = []
        try:
            r = requests.post(f"{BASE_URL}/api/users", headers=admin, json={
                "email": f"TEST_seat_{tag}@educonnect.app", "password": "Test@12345", "name": "TEST Seat",
                "role": "staff", "office": "KM_BLR"})
            assert r.status_code == 403, r.text
            assert r.json()["detail"].startswith(f"Seat limit reached: {used} of {used} users")
            r = requests.post(f"{BASE_URL}/api/staff/members", headers=admin, json={
                "email": f"TEST_seat2_{tag}@educonnect.app", "password": "Test@12345", "name": "TEST Seat2", "office": "KM_BLR"})
            assert r.status_code == 403, r.text
            assert "Seat limit reached" in r.json()["detail"]
            # raise limit -> creation works
            r = requests.put(f"{P}/tenants/{TID}/subscription",
                             json={"plan_id": pid, "status": orig.get("status", "trial"), "seat_limit": used + 5}, headers=owner)
            assert r.status_code == 200
            r = requests.post(f"{BASE_URL}/api/users", headers=admin, json={
                "email": f"TEST_seat_{tag}@educonnect.app", "password": "Test@12345", "name": "TEST Seat",
                "role": "staff", "office": "KM_BLR"})
            assert r.status_code in (200, 201), r.text
            created.append(r.json()["id"])
            assert self._sub(owner)["subscription"]["seats_used"] == used + 1
        finally:
            for uid in created:
                requests.delete(f"{BASE_URL}/api/users/{uid}", headers=admin)
            requests.put(f"{P}/tenants/{TID}/subscription",
                         json={"plan_id": pid, "status": orig.get("status", "trial"), "seat_limit": 50,
                               "notes": orig.get("notes", "")}, headers=owner)
        assert self._sub(owner)["subscription"]["seat_limit"] == 50

    def test_reactivated_user_counts_as_seat(self, owner):
        """Re-creating a soft-deleted email reactivates the row; it must count and be blocked by the limit."""
        d = self._sub(owner)
        pid = d["subscription"].get("plan_id")
        used = d["subscription"]["seats_used"]
        admin = _login(*ADMIN)
        email = f"TEST_react_{uuid.uuid4().hex[:6]}@educonnect.app"
        body = {"email": email, "password": "Test@12345", "name": "TEST React", "role": "staff", "office": "KM_BLR"}
        uid = requests.post(f"{BASE_URL}/api/users", headers=admin, json=body).json()["id"]
        requests.delete(f"{BASE_URL}/api/users/{uid}", headers=admin)
        try:
            requests.put(f"{P}/tenants/{TID}/subscription", json={"plan_id": pid, "status": "trial", "seat_limit": used}, headers=owner)
            r = requests.post(f"{BASE_URL}/api/users", headers=admin, json=body)
            blocked = r.status_code == 403
            if r.status_code in (200, 201):
                seats_after = self._sub(owner)["subscription"]["seats_used"]
                requests.delete(f"{BASE_URL}/api/users/{uid}", headers=admin)
            assert blocked, f"reactivation bypassed seat limit: {r.status_code}"
        finally:
            requests.put(f"{P}/tenants/{TID}/subscription", json={"plan_id": pid, "status": "trial", "seat_limit": 50}, headers=owner)


# --- App detail tabs
class TestAppTabs:
    def test_deployment_updates_version(self, owner, app_id):
        r = requests.post(f"{P}/apps/{app_id}/deployments", headers=owner,
                          json={"version": "9.9.9-test", "environment": "production", "status": "success", "notes": "TEST"})
        assert r.status_code == 201
        assert requests.get(f"{P}/apps/{app_id}", headers=owner).json()["version"] == "9.9.9-test"
        lst = requests.get(f"{P}/apps/{app_id}/deployments", headers=owner).json()["deployments"]
        assert lst[0]["version"] == "9.9.9-test"
        bad = requests.post(f"{P}/apps/{app_id}/deployments", headers=owner, json={"version": "x", "status": "weird"})
        assert bad.status_code == 400
        requests.patch(f"{P}/apps/{app_id}", headers=owner, json={"version": "1.0.0"})
        assert requests.get(f"{P}/apps/{app_id}", headers=owner).json()["version"] == "1.0.0"

    def test_versions_crud_and_duplicate(self, owner, app_id):
        r = requests.post(f"{P}/apps/{app_id}/versions", headers=owner, json={"version": "0.0.1-test", "title": "TEST"})
        assert r.status_code == 201
        vid = r.json()["id"]
        assert requests.post(f"{P}/apps/{app_id}/versions", headers=owner, json={"version": "0.0.1-test"}).status_code == 409
        assert requests.delete(f"{P}/apps/{app_id}/versions/{vid}", headers=owner).status_code == 200
        vs = requests.get(f"{P}/apps/{app_id}/versions", headers=owner).json()["versions"]
        assert not any(v["id"] == vid for v in vs)

    def test_api_keys(self, owner, app_id):
        r = requests.post(f"{P}/apps/{app_id}/keys", headers=owner, json={"name": "TEST key"})
        assert r.status_code == 201
        raw, kid = r.json()["key"], r.json()["id"]
        assert "key_hash" not in r.json()
        w = requests.get(f"{P}/app-api/whoami", headers={"X-App-Key": raw})
        assert w.status_code == 200 and w.json()["app"]["id"] == app_id
        keys = requests.get(f"{P}/apps/{app_id}/keys", headers=owner).json()["keys"]
        k = next(x for x in keys if x["id"] == kid)
        assert "key_hash" not in k and k["last_used_at"]
        assert requests.delete(f"{P}/apps/{app_id}/keys/{kid}", headers=owner).status_code == 200
        assert requests.get(f"{P}/app-api/whoami", headers={"X-App-Key": raw}).status_code == 401
        assert requests.get(f"{P}/app-api/whoami").status_code == 401

    def test_server_link_unlink(self, owner, app_id):
        d = requests.get(f"{P}/apps/{app_id}/server", headers=owner).json()
        sid = d["servers"][0]["id"]
        assert all("agent_key" not in s for s in d["servers"])
        requests.patch(f"{P}/apps/{app_id}", headers=owner, json={"server_id": sid})
        assert requests.get(f"{P}/apps/{app_id}/server", headers=owner).json()["server"]["id"] == sid
        requests.patch(f"{P}/apps/{app_id}", headers=owner, json={"server_id": ""})
        assert requests.get(f"{P}/apps/{app_id}/server", headers=owner).json()["server"] is None

    def test_databases_and_logs(self, owner, app_id):
        dbs = requests.get(f"{P}/apps/{app_id}/databases", headers=owner).json()["databases"]
        assert any(x["client_id"] == TID and x["status"] == "online" for x in dbs)
        logs = requests.get(f"{P}/apps/{app_id}/logs", headers=owner).json()["entries"]
        actions = {e["action"] for e in logs}
        assert {"app.deploy", "app.version", "app.key.create"} <= actions


# --- Security tab (run last: revokes sessions)
class TestSecurity:
    def test_failed_login_and_unlock(self, owner):
        r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN[0], "password": "wrong-pass"})
        assert r.status_code == 401
        s = requests.get(f"{P}/tenants/{TID}/security", headers=owner).json()
        assert s["failed_24h"] >= 1
        assert any(e["email"] == ADMIN[0] and not e["success"] for e in s["events"])
        assert any(l["email"] == ADMIN[0] for l in s["lockouts"])
        assert requests.post(f"{P}/tenants/{TID}/security/unlock", headers=owner, json={"email": ADMIN[0]}).status_code == 200
        s = requests.get(f"{P}/tenants/{TID}/security", headers=owner).json()
        assert not any(l["email"] == ADMIN[0] for l in s["lockouts"])
        assert requests.post(f"{P}/tenants/{TID}/security/unlock", headers=owner, json={"email": "nobody@x.com"}).status_code == 404

    def test_revoke_sessions(self, owner):
        admin = _login(*ADMIN)
        assert requests.get(f"{BASE_URL}/api/auth/me", headers=admin).status_code == 200
        time.sleep(1.1)
        assert requests.post(f"{P}/tenants/{TID}/security/revoke-sessions", headers=owner).status_code == 200
        assert requests.get(f"{BASE_URL}/api/auth/me", headers=admin).status_code == 401
        fresh = _login(*ADMIN)
        assert requests.get(f"{BASE_URL}/api/auth/me", headers=fresh).status_code == 200
        # owner token unaffected
        assert requests.get(f"{P}/tenants/{TID}/security", headers=owner).status_code == 200
