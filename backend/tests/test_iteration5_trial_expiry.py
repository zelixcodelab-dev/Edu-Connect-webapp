# Iteration 5: Trial-end reminders (trial_info in /me, list, attention), expiry actions
# (keep / read_only / block) and forced sign-out (revoke) notices. Restores the subscription at the end.
import time
from datetime import date, timedelta

import pytest
import requests

from pathlib import Path

BASE_URL = ""
for line in Path("/app/frontend/.env").read_text().splitlines():
    if line.startswith("REACT_APP_BACKEND_URL="):
        BASE_URL = line.split("=", 1)[1].strip().strip('"').rstrip("/")

TID = "3b5e3f1f-dba9-4a89-a201-c2fdb24372ef"
OWNER = ("owner@educonnect.app", "Owner@12345")
ADMIN = ("admin@educonnect.app", "Admin@12345")
STAFF = ("TEST_att_staff_1@educonnect.app", "Staff@12345")
P = f"{BASE_URL}/api/platform"


def _login_raw(email, pw):
    return requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": pw}, timeout=30)


def _login(email, pw):
    r = _login_raw(email, pw)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _day(n):
    return (date.today() + timedelta(days=n)).isoformat()


@pytest.fixture(scope="module")
def owner():
    return _login(*OWNER)


@pytest.fixture(scope="module")
def plan_id(owner):
    r = requests.get(f"{P}/tenants/{TID}/subscription", headers=owner)
    assert r.status_code == 200
    return r.json()["subscription"]["plan_id"]


@pytest.fixture(scope="module", autouse=True)
def restore(owner, plan_id):
    yield
    r = requests.put(f"{P}/tenants/{TID}/subscription", headers=owner, json={
        "plan_id": plan_id, "status": "trial", "trial_ends_at": _day(30), "seat_limit": 50, "expiry_action": "keep"})
    assert r.status_code == 200, r.text


def _set(owner, plan_id, days, action="keep", status="trial"):
    r = requests.put(f"{P}/tenants/{TID}/subscription", headers=owner, json={
        "plan_id": plan_id, "status": status, "trial_ends_at": _day(days), "seat_limit": 50, "expiry_action": action})
    assert r.status_code == 200, r.text
    return r.json()["subscription"]


class TestTrialInfo:
    def test_put_validation_bad_action(self, owner, plan_id):
        r = requests.put(f"{P}/tenants/{TID}/subscription", headers=owner, json={
            "plan_id": plan_id, "status": "trial", "trial_ends_at": _day(2), "expiry_action": "nope"})
        assert r.status_code == 422

    def test_two_days_left(self, owner, plan_id):
        sub = _set(owner, plan_id, 2, "read_only")
        assert sub["expiry_action"] == "read_only"
        assert sub["trial"]["days_left"] == 2 and sub["trial"]["near"] is True and sub["trial"]["expired"] is False
        g = requests.get(f"{P}/tenants/{TID}/subscription", headers=owner).json()["subscription"]
        assert g["expiry_action"] == "read_only" and g["trial_ends_at"] == _day(2)

    def test_list_and_attention(self, owner, plan_id):
        _set(owner, plan_id, 2)
        d = requests.get(f"{P}/tenants", headers=owner).json()
        ts = d.get("tenants", d) if isinstance(d, dict) else d
        t = next(x for x in ts if x["id"] == TID)
        assert t["trial"]["days_left"] == 2
        a = requests.get(f"{P}/attention", headers=owner)
        assert a.status_code == 200
        items = a.json().get("items", a.json()) if isinstance(a.json(), dict) else a.json()
        it = next(x for x in items if x["id"] == f"trial-{TID}")
        assert "trial ends in 2 days" in it["title"]
        assert it["severity"] == "critical"
        assert it["link"] == f"/platform/clients/{TID}"

    def test_attention_warning_at_6_and_absent_at_20(self, owner, plan_id):
        _set(owner, plan_id, 6)
        items = requests.get(f"{P}/attention", headers=owner).json()
        items = items.get("items", items) if isinstance(items, dict) else items
        it = next(x for x in items if x["id"] == f"trial-{TID}")
        assert it["severity"] == "warning"
        _set(owner, plan_id, 20)
        items = requests.get(f"{P}/attention", headers=owner).json()
        items = items.get("items", items) if isinstance(items, dict) else items
        assert not any(x["id"] == f"trial-{TID}" for x in items)

    def test_me_and_login_include_trial(self, owner, plan_id):
        _set(owner, plan_id, 2)
        r = _login_raw(*ADMIN)
        assert r.status_code == 200
        body = r.json()
        user = body.get("user", body)
        assert (user.get("trial") or body.get("trial"))["days_left"] == 2
        me = requests.get(f"{BASE_URL}/api/auth/me", headers={"Authorization": f"Bearer {body['access_token']}"}).json()
        assert me["trial"]["days_left"] == 2

    def test_active_status_no_trial(self, owner, plan_id):
        sub = _set(owner, plan_id, -1, "block", status="active")
        assert sub["trial"] is None
        assert _login_raw(*ADMIN).status_code == 200


class TestReadOnly:
    def test_read_only_blocks_writes(self, owner, plan_id):
        admin = _login(*ADMIN)
        _set(owner, plan_id, -1, "read_only")
        me = requests.get(f"{BASE_URL}/api/auth/me", headers=admin)
        assert me.status_code == 200
        assert me.json()["trial"]["expired"] is True
        assert requests.get(f"{BASE_URL}/api/students", headers=admin).status_code == 200
        r = requests.post(f"{BASE_URL}/api/leads", headers=admin, json={"name": "TEST_ro", "phone": "9999999999"})
        assert r.status_code == 403, r.text
        assert "read-only" in r.json()["detail"]
        # login still allowed in read-only
        assert _login_raw(*ADMIN).status_code == 200


class TestBlock:
    def test_block_existing_token_and_login(self, owner, plan_id):
        admin = _login(*ADMIN)
        _set(owner, plan_id, -1, "block")
        r = requests.get(f"{BASE_URL}/api/auth/me", headers=admin)
        assert r.status_code == 403
        assert "trial has ended" in r.json()["detail"].lower()
        lr = _login_raw(*ADMIN)
        assert lr.status_code == 403
        assert "Contact your platform provider" in lr.json()["detail"]
        # owner (platform scope) not affected
        assert requests.get(f"{P}/tenants", headers=owner).status_code == 200

    def test_trial_end_today_not_locked(self, owner, plan_id):
        _set(owner, plan_id, 0, "block")
        assert _login_raw(*ADMIN).status_code == 200


class TestRevoke:
    def test_revoke_sessions(self, owner, plan_id):
        _set(owner, plan_id, 30, "keep")
        admin = _login(*ADMIN)
        time.sleep(1.2)
        r = requests.post(f"{P}/tenants/{TID}/security/revoke-sessions", headers=owner)
        assert r.status_code == 200
        me = requests.get(f"{BASE_URL}/api/auth/me", headers=admin)
        assert me.status_code == 401
        assert "session was ended by the administrator" in me.json()["detail"]
        time.sleep(1.2)
        again = _login(*ADMIN)
        assert requests.get(f"{BASE_URL}/api/auth/me", headers=again).status_code == 200
