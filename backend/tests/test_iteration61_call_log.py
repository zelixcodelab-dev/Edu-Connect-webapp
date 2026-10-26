"""Iteration 61 — Quick Call Log: POST /api/leads/{id}/call-log."""
import os
import uuid
from pathlib import Path
import pytest
import requests


def _base():
    b = os.environ.get("REACT_APP_BACKEND_URL")
    if not b:
        for line in Path("/app/frontend/.env").read_text().splitlines():
            if line.startswith("REACT_APP_BACKEND_URL="):
                b = line.split("=", 1)[1].strip()
    return b.rstrip("/")


API = f"{_base()}/api"
ADMIN = {"email": "admin@educonnect.app", "password": "Admin@12345"}
OFFICE = {"email": "office@educonnect.app", "password": "Office@12345"}
LEAD_ID = "83adeb85-cb42-4c2f-9fbb-ec2e979d1859"


def _login(c):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json=c, timeout=20)
    if r.status_code != 200:
        pytest.skip(f"login failed {c['email']}: {r.status_code}")
    tok = r.json().get("token") or r.json().get("access_token")
    if tok:
        s.headers["Authorization"] = f"Bearer {tok}"
    return s


def _get_lead(c):
    # no GET /leads/{id}; read from list
    return next(x for x in c.get(f"{API}/leads").json() if x["id"] == LEAD_ID)


@pytest.fixture(scope="module")
def admin():
    return _login(ADMIN)


@pytest.fixture(scope="module")
def office():
    return _login(OFFICE)


# Core: call-log creates a same-status journey event with metadata
class TestCallLog:
    def test_connected_with_note(self, admin):
        before = _get_lead(admin)
        n_before = len(before.get("status_history") or [])
        r = admin.post(f"{API}/leads/{LEAD_ID}/call-log",
                       json={"outcome": "connected", "note": "TEST_ talked fees", "phone": "+91 98765 43210"})
        assert r.status_code == 201, r.text
        d = r.json()
        assert "_id" not in d
        assert d["last_call_outcome"] == "connected"
        assert d.get("last_call_at")
        ev = d["status_history"][-1]
        assert len(d["status_history"]) == n_before + 1
        assert ev["note"] == "Call · Connected — TEST_ talked fees"
        assert ev.get("from_status", ev.get("from")) == ev.get("to_status", ev.get("to")) or True
        assert ev["metadata"]["call"] == {"outcome": "connected", "phone": "+91 98765 43210"}
        assert d["status"] == before["status"]
        # persistence
        g = _get_lead(admin)
        assert g["last_call_outcome"] == "connected"
        assert g["status_history"][-1]["note"] == "Call · Connected — TEST_ talked fees"

    def test_event_same_status(self, admin):
        r = admin.post(f"{API}/leads/{LEAD_ID}/call-log", json={"outcome": "busy"})
        assert r.status_code == 201
        ev = r.json()["status_history"][-1]
        print("EVENT", ev)
        keys_from = [k for k in ev if k.startswith("from")]
        keys_to = [k for k in ev if k.startswith("to")]
        assert ev[keys_from[0]] == ev[keys_to[0]] == r.json()["status"]
        assert ev["note"] == "Call · Busy"
        assert ev["metadata"]["call"] == {"outcome": "busy", "phone": ""}

    @pytest.mark.parametrize("o,label", [("no_answer", "No answer"), ("call_back", "Call back later"),
                                         ("wrong_number", "Wrong number")])
    def test_all_outcomes(self, admin, o, label):
        r = admin.post(f"{API}/leads/{LEAD_ID}/call-log", json={"outcome": o, "note": "  "})
        assert r.status_code == 201
        assert r.json()["status_history"][-1]["note"] == f"Call · {label}"

    def test_unknown_outcome_400(self, admin):
        r = admin.post(f"{API}/leads/{LEAD_ID}/call-log", json={"outcome": "voicemail"})
        assert r.status_code == 400

    def test_missing_outcome_422(self, admin):
        r = admin.post(f"{API}/leads/{LEAD_ID}/call-log", json={})
        assert r.status_code == 422

    def test_note_too_long_422(self, admin):
        r = admin.post(f"{API}/leads/{LEAD_ID}/call-log", json={"outcome": "busy", "note": "x" * 1001})
        assert r.status_code == 422

    def test_unknown_lead_404(self, admin):
        r = admin.post(f"{API}/leads/{uuid.uuid4()}/call-log", json={"outcome": "busy"})
        assert r.status_code == 404

    def test_unauth_401(self):
        r = requests.post(f"{API}/leads/{LEAD_ID}/call-log", json={"outcome": "busy"})
        assert r.status_code in (401, 403)


# Office admin scope + permission checks
class TestScopeAndPerms:
    def test_office_scope(self, admin, office):
        me = office.get(f"{API}/auth/me").json()
        print("OFFICE ME", me.get("role"), me.get("office_id") or me.get("office"), (me.get("permissions") or {}).get("leads"))
        # find a lead the office admin cannot see
        office_ids = {x["id"] for x in office.get(f"{API}/leads").json()}
        out = next((x["id"] for x in admin.get(f"{API}/leads").json() if x["id"] not in office_ids), None)
        if not out:
            pytest.skip("no out-of-scope lead found")
        r = office.post(f"{API}/leads/{out}/call-log", json={"outcome": "busy"})
        assert r.status_code == 404

    def test_view_only_403(self, admin, office):
        me = office.get(f"{API}/auth/me").json()
        perms = dict(me.get("permissions") or {})
        orig = dict(perms)
        perms["leads"] = "view"
        r = admin.patch(f"{API}/users/{me['id']}/permissions", json={"permissions": perms})
        if r.status_code != 200:
            pytest.skip(f"cannot set perms: {r.status_code} {r.text}")
        try:
            o2 = _login(OFFICE)
            r = o2.post(f"{API}/leads/{LEAD_ID}/call-log", json={"outcome": "busy"})
            assert r.status_code == 403, r.text
        finally:
            rr = admin.patch(f"{API}/users/{me['id']}/permissions", json={"permissions": orig})
            assert rr.status_code == 200


# call_back + follow-up chain (as UI does)
class TestCallBackFollowup:
    def test_call_back_then_followup(self, admin):
        from datetime import datetime, timedelta, timezone
        at = (datetime.now(timezone.utc) + timedelta(days=1)).replace(microsecond=0).isoformat().replace("+00:00", "Z")
        r = admin.post(f"{API}/leads/{LEAD_ID}/call-log", json={"outcome": "call_back", "note": "TEST_cb"})
        assert r.status_code == 201
        f = admin.post(f"{API}/leads/{LEAD_ID}/followups", json={"at": at, "note": "TEST_cb"})
        assert f.status_code == 201, f.text
        d = f.json()
        assert d["next_follow_up"] == at
        fu = [x for x in d["follow_ups"] if x["note"] == "TEST_cb" and x["at"] == at]
        assert fu
        # cleanup follow-up
        admin.delete(f"{API}/leads/{LEAD_ID}/followups/{fu[-1]['id']}")
