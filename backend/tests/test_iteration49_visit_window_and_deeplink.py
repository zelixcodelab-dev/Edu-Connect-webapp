"""Iteration 49 backend tests — /visits/today time-window & phase field.

Covers:
1) response shape: `phase` per visit + top-level `live_count` + `preview_count`
2) time-window inclusion/exclusion:
   - dep +12h: included, phase='preview'
   - dep -1d + arr today: included, phase='live'
   - dep -3d: excluded
   - dep +48h: excluded
3) edge cases:
   (a) only departure_at → visible until end-of-day(dep+1d)
   (b) only arrival_at → visible from arr-24h to end-of-day(arr)
   (c) legacy visit.status='admitted' normalized to 'admission_taken' on read
4) sort order: live before preview, both by departure asc

Uses pymongo for direct DB seeding of the visit sub-doc so we can control
timestamps precisely (via HTTP /interested we still get scheduled defaults,
but we then overwrite `visit.departure_at`/`arrival_at`/`status` directly).
"""
from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone, timedelta

import pytest
import requests
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/app/frontend/.env")
load_dotenv("/app/backend/.env")
BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")

SUPER = {"email": "admin@kmfoundation.online", "password": "Admin@786"}
STAFF = {"email": "staff.blr@kmfoundation.online", "password": "Staff@123"}
SAFE_PHONE = "0000000000"

_mc = MongoClient(os.environ["MONGO_URL"])
_mdb = _mc[os.environ["DB_NAME"]]

created_lead_ids: list[str] = []


def _login(creds):
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json=creds, timeout=20)
    assert r.status_code == 200, f"login failed: {r.text}"
    return s


@pytest.fixture(scope="module")
def super_s():
    return _login(SUPER)


def _mk_lead(s, name):
    body = {
        "name": f"IT49 {name} {uuid.uuid4().hex[:6]}",
        "phone": SAFE_PHONE,
        "source": "walk_in",
        "status": "new",
    }
    r = s.post(f"{BASE_URL}/api/leads", json=body)
    assert r.status_code == 201, r.text
    d = r.json()
    created_lead_ids.append(d["id"])
    return d


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _seed_visit(lead_id: str, departure_at=None, arrival_at=None, status="scheduled"):
    """Directly write a visit sub-doc so we can control the timestamps exactly."""
    visit = {
        "id": uuid.uuid4().hex,
        "status": status,
        "departure_at": _iso(departure_at) if departure_at else None,
        "arrival_at": _iso(arrival_at) if arrival_at else None,
        "institution": "IT49 Campus",
        "travel_mode": "",
        "who_comes": "",
        "drop_point": "",
        "attending_admin_id": None,
        "attending_admin_name": None,
        "created_by_user_id": None,
        "created_by_name": None,
        "created_at": _iso(datetime.now(timezone.utc)),
        "updated_at": _iso(datetime.now(timezone.utc)),
        "whatsapp_sent": False,
    }
    r = _mdb.leads.update_one(
        {"id": lead_id},
        {"$set": {"visit": visit, "campus_visit_interested": True}},
    )
    assert r.matched_count == 1


def _fetch_visits(s):
    r = s.get(f"{BASE_URL}/api/leads/visits/today")
    assert r.status_code == 200, r.text
    return r.json()


# ============== 1) shape ==============
class TestShape:
    def test_top_level_counts_and_date(self, super_s):
        data = _fetch_visits(super_s)
        assert "date" in data and "count" in data and "visits" in data
        assert "live_count" in data and "preview_count" in data
        assert data["date"] == datetime.now(timezone.utc).date().isoformat()
        assert data["count"] == data["live_count"] + data["preview_count"]
        assert data["count"] == len(data["visits"])

    def test_each_visit_has_phase(self, super_s):
        lead = _mk_lead(super_s, "shape-phase")
        now = datetime.now(timezone.utc)
        _seed_visit(lead["id"], departure_at=now - timedelta(hours=1), arrival_at=now + timedelta(hours=4))
        data = _fetch_visits(super_s)
        v = next((x for x in data["visits"] if x["id"] == lead["id"]), None)
        assert v is not None, "seeded live visit should be listed"
        assert v.get("phase") == "live"


# ============== 2) time window ==============
class TestTimeWindow:
    def test_preview_12h_future_included(self, super_s):
        lead = _mk_lead(super_s, "win-preview12")
        now = datetime.now(timezone.utc)
        dep = now + timedelta(hours=12)
        _seed_visit(lead["id"], departure_at=dep, arrival_at=dep + timedelta(hours=5))
        data = _fetch_visits(super_s)
        v = next((x for x in data["visits"] if x["id"] == lead["id"]), None)
        assert v is not None, "12h-future visit should be visible"
        assert v["phase"] == "preview"

    def test_live_yesterday_dep_today_arr(self, super_s):
        lead = _mk_lead(super_s, "win-live-yday")
        now = datetime.now(timezone.utc)
        dep = now - timedelta(hours=20)  # yesterday-ish
        arr = now + timedelta(hours=2)   # arriving later today (still in end-of-day window)
        _seed_visit(lead["id"], departure_at=dep, arrival_at=arr)
        data = _fetch_visits(super_s)
        v = next((x for x in data["visits"] if x["id"] == lead["id"]), None)
        assert v is not None, "yesterday-dep/today-arr should be live"
        assert v["phase"] == "live"

    def test_3_days_ago_excluded(self, super_s):
        lead = _mk_lead(super_s, "win-3d-ago")
        now = datetime.now(timezone.utc)
        _seed_visit(
            lead["id"],
            departure_at=now - timedelta(days=3),
            arrival_at=now - timedelta(days=3) + timedelta(hours=5),
        )
        data = _fetch_visits(super_s)
        ids = [v["id"] for v in data["visits"]]
        assert lead["id"] not in ids

    def test_48h_future_excluded(self, super_s):
        lead = _mk_lead(super_s, "win-48h-future")
        now = datetime.now(timezone.utc)
        dep = now + timedelta(hours=48)
        _seed_visit(lead["id"], departure_at=dep, arrival_at=dep + timedelta(hours=5))
        data = _fetch_visits(super_s)
        ids = [v["id"] for v in data["visits"]]
        assert lead["id"] not in ids


# ============== 3) edge cases ==============
class TestEdgeCases:
    def test_only_departure_set(self, super_s):
        """arr unset → visible until end-of-day(dep + 1 day)."""
        lead = _mk_lead(super_s, "edge-only-dep")
        now = datetime.now(timezone.utc)
        dep = now - timedelta(hours=2)  # 2h ago → live
        _seed_visit(lead["id"], departure_at=dep, arrival_at=None)
        data = _fetch_visits(super_s)
        v = next((x for x in data["visits"] if x["id"] == lead["id"]), None)
        assert v is not None, "only-departure visit (dep 2h ago) should be visible"
        assert v["phase"] == "live"

    def test_only_arrival_set(self, super_s):
        """dep unset → anchor=arr; visible from arr-24h to end-of-day(arr)."""
        lead = _mk_lead(super_s, "edge-only-arr")
        now = datetime.now(timezone.utc)
        arr = now + timedelta(hours=5)  # future arr → preview
        _seed_visit(lead["id"], departure_at=None, arrival_at=arr)
        data = _fetch_visits(super_s)
        v = next((x for x in data["visits"] if x["id"] == lead["id"]), None)
        assert v is not None, "only-arrival visit (arr +5h) should be visible in preview"
        assert v["phase"] == "preview"

    def test_legacy_admitted_normalized(self, super_s):
        lead = _mk_lead(super_s, "edge-legacy")
        now = datetime.now(timezone.utc)
        _seed_visit(
            lead["id"],
            departure_at=now - timedelta(hours=1),
            arrival_at=now + timedelta(hours=4),
            status="admitted",  # legacy
        )
        data = _fetch_visits(super_s)
        v = next((x for x in data["visits"] if x["id"] == lead["id"]), None)
        assert v is not None
        assert v["visit"]["status"] == "admission_taken", "legacy 'admitted' must normalize"


# ============== 4) sort order ==============
class TestSortOrder:
    def test_live_before_preview(self, super_s):
        lead_live = _mk_lead(super_s, "sort-live")
        lead_prev = _mk_lead(super_s, "sort-prev")
        now = datetime.now(timezone.utc)
        _seed_visit(
            lead_live["id"],
            departure_at=now - timedelta(hours=3),
            arrival_at=now + timedelta(hours=2),
        )
        # preview departure earlier than live in ISO string terms wouldn't matter
        # because grouping puts live first regardless. Confirm that.
        _seed_visit(
            lead_prev["id"],
            departure_at=now + timedelta(hours=10),
            arrival_at=now + timedelta(hours=15),
        )
        data = _fetch_visits(super_s)
        visits = data["visits"]
        # find indices
        idx_live = next(i for i, v in enumerate(visits) if v["id"] == lead_live["id"])
        idx_prev = next(i for i, v in enumerate(visits) if v["id"] == lead_prev["id"])
        assert idx_live < idx_prev, "live must appear before preview"


# ============== teardown ==============
def teardown_module(module):
    s = _login(SUPER)
    for lid in set(created_lead_ids):
        try:
            s.delete(f"{BASE_URL}/api/leads/{lid}")
        except Exception:
            pass
    try:
        _mc.close()
    except Exception:
        pass
