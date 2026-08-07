"""Iteration 60 — Activity Log & Restore backend smoke tests."""
import os
import time
import uuid

import pytest
import requests
from dotenv import load_dotenv

load_dotenv("/app/frontend/.env")
BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
SUPER = {"email": "muneer@kmfoundation.co", "password": "kmf@0786"}
OFFICE = {"email": "blr1@finflow.com", "password": "Office@123"}
STAFF = {"email": "staff.blr@kmfoundation.online", "password": "Staff@123"}


def _login(creds):
    s = requests.Session()
    r = s.post(f"{BASE}/api/auth/login", json=creds, timeout=15)
    assert r.status_code == 200, f"login {creds['email']} → {r.status_code} {r.text}"
    return s


@pytest.fixture(scope="module")
def sa():
    return _login(SUPER)


@pytest.fixture(scope="module")
def oa():
    return _login(OFFICE)


# ----- Access control -----
def test_activity_requires_admin_staff_forbidden():
    try:
        s = _login(STAFF)
    except AssertionError:
        pytest.skip("staff account unavailable")
    r = s.get(f"{BASE}/api/activity-log")
    assert r.status_code == 403


def test_activity_list_super_admin(sa):
    r = sa.get(f"{BASE}/api/activity-log?limit=50")
    assert r.status_code == 200
    body = r.json()
    assert "items" in body and isinstance(body["items"], list)


def test_activity_list_office_admin(oa):
    r = oa.get(f"{BASE}/api/activity-log?limit=50")
    assert r.status_code == 200


def test_activity_filter_subject_type(sa):
    r = sa.get(f"{BASE}/api/activity-log?subject_type=lead&limit=25")
    assert r.status_code == 200
    for it in r.json()["items"]:
        assert it.get("subject_type") == "lead"


def test_activity_filter_reversible_only(sa):
    r = sa.get(f"{BASE}/api/activity-log?reversible=true&limit=25")
    assert r.status_code == 200
    for it in r.json()["items"]:
        assert it.get("reversible") is True


# ----- Lead delete → restore round-trip -----
@pytest.fixture(scope="module")
def created_lead_id(sa):
    payload = {"name": f"AGENT_TEST_LEAD_{uuid.uuid4().hex[:6]}", "phone": "9998887777"}
    r = sa.post(f"{BASE}/api/leads", json=payload)
    assert r.status_code in (200, 201), r.text
    lid = r.json().get("id") or r.json().get("lead", {}).get("id")
    assert lid
    return lid


def test_lead_delete_and_restore_round_trip(sa, created_lead_id):
    lid = created_lead_id
    # delete
    d = sa.delete(f"{BASE}/api/leads/{lid}")
    assert d.status_code in (200, 204), d.text
    # verify gone via list
    g = sa.get(f"{BASE}/api/leads?limit=500")
    assert g.status_code == 200
    body = g.json()
    lst = body.get("items", []) if isinstance(body, dict) else body
    ids_now = {l.get("id") for l in lst}
    assert lid not in ids_now
    # Find the event
    time.sleep(1)
    r = sa.get(f"{BASE}/api/activity-log?event_type=lead.deleted&limit=25")
    assert r.status_code == 200
    events = r.json()["items"]
    ev = next((e for e in events if e.get("subject_id") == lid), None)
    assert ev is not None, "lead.deleted event not found"
    assert ev.get("reversible") is True
    ev_id = ev["id"]
    # restore
    rs = sa.post(f"{BASE}/api/activity-log/{ev_id}/restore")
    assert rs.status_code == 200, rs.text
    body = rs.json()
    assert body.get("ok") is True
    # verify lead exists again
    g2 = sa.get(f"{BASE}/api/leads?limit=500")
    body2 = g2.json()
    lst2 = body2.get("items", []) if isinstance(body2, dict) else body2
    ids2 = {l.get("id") for l in lst2}
    assert lid in ids2
    # second restore should 409
    again = sa.post(f"{BASE}/api/activity-log/{ev_id}/restore")
    assert again.status_code == 409
    # cleanup
    sa.delete(f"{BASE}/api/leads/{lid}")


def test_restore_nonexistent_event(sa):
    r = sa.post(f"{BASE}/api/activity-log/does-not-exist-xyz/restore")
    assert r.status_code == 404
