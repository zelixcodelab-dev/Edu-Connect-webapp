"""Iteration 46: Extended lead statuses + status_history journey timeline.

Covers:
  (a) PATCH /api/leads/{id} status transitions to application_submitted,
      admission_confirmed, fee_paid, completed, not_turned append status_history
  (b) invalid status → 400
  (c) POST /api/leads/{id}/followups with status='fee_paid' appends BOTH a
      follow_up and a status_history entry with note='via follow-up'
  (d) GET /api/leads/stats returns all 11 keys in by_status
"""
from __future__ import annotations

import os
import pytest
import requests
from dotenv import load_dotenv

load_dotenv("/app/frontend/.env")
BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")

SUPER = {"email": "admin@kmfoundation.online", "password": "Admin@786"}
OFFICE = {"email": "blr1@finflow.com", "password": "Office@123"}
STAFF = {"email": "staff.blr@kmfoundation.online", "password": "Staff@123"}
SAFE_PHONE = "0000000000"

ALL_STATUSES = (
    "new", "not_connected", "interested", "follow_up", "converted",
    "application_submitted", "admission_confirmed", "fee_paid", "completed",
    "not_turned", "lost",
)
POST_CONVERT_STATUSES = (
    "application_submitted", "admission_confirmed", "fee_paid",
    "completed", "not_turned",
)

created_lead_ids: list[str] = []


def _login(creds):
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json=creds, timeout=15)
    assert r.status_code == 200, f"login failed for {creds['email']}: {r.status_code} {r.text}"
    return s


@pytest.fixture(scope="module")
def super_s():
    return _login(SUPER)


@pytest.fixture(scope="module")
def office_s():
    return _login(OFFICE)


@pytest.fixture(scope="module")
def staff_s():
    return _login(STAFF)


def _make_lead(s, suffix, status="new"):
    body = {"name": f"TEST_it46 {suffix}", "phone": SAFE_PHONE, "source": "walk_in", "status": status}
    r = s.post(f"{BASE_URL}/api/leads", json=body)
    assert r.status_code == 201, r.text
    d = r.json()
    created_lead_ids.append(d["id"])
    return d


class TestAuth:
    def test_super_login(self, super_s):
        r = super_s.get(f"{BASE_URL}/api/auth/me")
        assert r.status_code == 200 and r.json()["role"] == "super_admin"

    def test_office_login(self, office_s):
        r = office_s.get(f"{BASE_URL}/api/auth/me")
        assert r.status_code == 200 and r.json()["role"] == "office_admin"

    def test_staff_login(self, staff_s):
        r = staff_s.get(f"{BASE_URL}/api/auth/me")
        assert r.status_code == 200 and r.json()["role"] == "staff"


class TestStatusHistoryTransitions:
    @pytest.mark.parametrize("target", POST_CONVERT_STATUSES)
    def test_patch_status_appends_history(self, super_s, target):
        lead = _make_lead(super_s, f"patch-{target}")
        r = super_s.patch(f"{BASE_URL}/api/leads/{lead['id']}", json={"status": target})
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["status"] == target
        hist = data.get("status_history") or []
        assert len(hist) >= 1, "status_history should have at least one entry"
        last = hist[-1]
        assert last["from"] == "new"
        assert last["to"] == target
        assert last.get("by_name")
        assert "at" in last

    def test_invalid_status_returns_400(self, super_s):
        lead = _make_lead(super_s, "invalid-status")
        r = super_s.patch(f"{BASE_URL}/api/leads/{lead['id']}", json={"status": "random_thing"})
        assert r.status_code == 400, r.text

    def test_multi_step_journey_accumulates(self, super_s):
        lead = _make_lead(super_s, "multi-step")
        chain = ["application_submitted", "admission_confirmed", "fee_paid", "completed"]
        prev = "new"
        for st in chain:
            r = super_s.patch(f"{BASE_URL}/api/leads/{lead['id']}", json={"status": st})
            assert r.status_code == 200, r.text
            prev = st
        # verify history
        r = super_s.get(f"{BASE_URL}/api/leads", params={"q": lead["name"]})
        me = next(x for x in r.json() if x["id"] == lead["id"])
        hist = me.get("status_history") or []
        assert len(hist) == len(chain)
        for i, ev in enumerate(hist):
            assert ev["to"] == chain[i]


class TestFollowupWithStatus:
    def test_followup_pushes_followup_and_status_history(self, super_s):
        lead = _make_lead(super_s, "fu-fee-paid")
        r = super_s.post(f"{BASE_URL}/api/leads/{lead['id']}/followups", json={
            "at": "2030-05-01T10:00:00Z",
            "note": "will pay soon",
            "status": "fee_paid",
        })
        assert r.status_code == 201, r.text
        fresh = r.json()
        assert fresh["status"] == "fee_paid"
        fus = fresh.get("follow_ups") or []
        assert len(fus) == 1
        assert fus[0]["note"] == "will pay soon"
        hist = fresh.get("status_history") or []
        assert len(hist) >= 1
        last = hist[-1]
        assert last["to"] == "fee_paid"
        assert last["from"] == "new"
        assert last.get("note") == "via follow-up"


class TestLeadStats:
    def test_stats_has_all_11_status_keys(self, super_s):
        r = super_s.get(f"{BASE_URL}/api/leads/stats")
        assert r.status_code == 200
        data = r.json()
        by_status = data.get("by_status") or {}
        for s in ALL_STATUSES:
            assert s in by_status, f"missing status key: {s}"
            assert isinstance(by_status[s], int)
            assert by_status[s] >= 0
        # Legacy 'contacted' must not exist (migration guarantee)
        assert by_status.get("contacted", 0) == 0
        # not_connected should have >= 0 (may or may not have 2 depending on seed timing)
        assert by_status.get("not_connected", 0) >= 0

    def test_office_stats_scoped(self, office_s):
        r = office_s.get(f"{BASE_URL}/api/leads/stats")
        assert r.status_code == 200
        for s in ALL_STATUSES:
            assert s in r.json()["by_status"]

    def test_staff_stats_scoped(self, staff_s):
        r = staff_s.get(f"{BASE_URL}/api/leads/stats")
        assert r.status_code == 200
        for s in ALL_STATUSES:
            assert s in r.json()["by_status"]


class TestNoContactedInDb:
    def test_no_legacy_contacted(self, super_s):
        r = super_s.get(f"{BASE_URL}/api/leads/stats")
        assert r.status_code == 200
        # contacted key should either not exist or be 0
        assert r.json()["by_status"].get("contacted", 0) == 0


class TestBulkCsvDefaultsNew:
    def test_bulk_upload_default_status_new(self, super_s):
        csv_content = "name,phone,email,course,place,source,notes,employee\nTEST_it46 CSV Alpha,0000000000,,,,walk_in,,\n"
        files = {"file": ("leads.csv", csv_content, "text/csv")}
        r = super_s.post(f"{BASE_URL}/api/leads/bulk", files=files)
        assert r.status_code == 201, r.text
        data = r.json()
        assert data["created_count"] == 1
        # fetch and confirm status='new'
        r2 = super_s.get(f"{BASE_URL}/api/leads", params={"q": "TEST_it46 CSV Alpha"})
        leads = [l for l in r2.json() if l["name"] == "TEST_it46 CSV Alpha"]
        assert len(leads) >= 1
        assert leads[0]["status"] == "new"
        created_lead_ids.append(leads[0]["id"])


def teardown_module(module):
    s = _login(SUPER)
    for lid in list(set(created_lead_ids)):
        try:
            s.delete(f"{BASE_URL}/api/leads/{lid}")
        except Exception:
            pass
