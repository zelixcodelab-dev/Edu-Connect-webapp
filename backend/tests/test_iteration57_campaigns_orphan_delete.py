"""Iteration 57 — Campaigns edit + orphan-aware stats + delete-with-leads.

Covers:
 - PATCH /api/campaigns/{id}: update name/desc/tag_type/tag_value, office is ignored.
 - GET  /api/campaigns/{id}: stats.unassigned counts orphaned assignees; distribution
   row does not contain the orphaned assignee.
 - DELETE /api/campaigns/{id} without query → leads survive with campaign_id=null.
 - DELETE /api/campaigns/{id}?delete_leads=true → purges leads and returns
   removed_leads count.
 - POST /api/campaigns/bulk-delete with delete_leads flag (both modes).
 - POST /api/campaigns/{id}/distribute scope='unassigned' picks up orphaned leads.
"""
import os
import time
import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"
SUPER = ("muneer@kmfoundation.co", "kmf@0786")

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")

# ---------- helpers ----------
def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=30)
    if r.status_code != 200:
        pytest.skip(f"login failed for {email}: {r.status_code} {r.text[:200]}")
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def super_token():
    return _login(*SUPER)


@pytest.fixture(scope="module")
def super_headers(super_token):
    return {"Authorization": f"Bearer {super_token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def super_uid(super_headers):
    r = requests.get(f"{API}/auth/me", headers=super_headers, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["id"]


@pytest.fixture(scope="module")
def db_sync():
    """Direct Mongo sync client."""
    client = MongoClient(MONGO_URL)
    db = client[DB_NAME]
    yield db
    client.close()


def _insert_lead(db, doc):
    return db.leads.insert_one(doc)


def _find_lead(db, lid):
    return db.leads.find_one({"id": lid}, {"_id": 0})


def _delete_leads(db, ids):
    return db.leads.delete_many({"id": {"$in": ids}})


def _seed_lead(db, *, campaign_id, office, assigned=None, name="TEST_lead"):
    from uuid import uuid4
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).isoformat()
    lid = str(uuid4())
    doc = {
        "id": lid,
        "name": name,
        "phone": "", "email": "",
        "course": "", "place": "", "source": "other",
        "status": "new",
        "assigned_to_user_id": assigned,
        "office": office,
        "campaign_id": campaign_id,
        "next_follow_up": None,
        "notes": "",
        "follow_ups": [],
        "created_by_user_id": "test",
        "created_at": now,
        "updated_at": now,
    }
    _insert_lead(db, doc)
    return lid


# ---------- fixtures ----------
@pytest.fixture(scope="module")
def campaign(super_headers):
    """Create a campaign, yield it, delete on teardown."""
    r = requests.post(f"{API}/campaigns", headers=super_headers,
                      json={"name": f"TEST_camp_{int(time.time())}",
                            "description": "iter57", "office": "KM_BLR"}, timeout=30)
    assert r.status_code == 201, r.text
    c = r.json()
    yield c
    # cleanup — purge campaign + leads
    requests.delete(f"{API}/campaigns/{c['id']}?delete_leads=true", headers=super_headers, timeout=30)


# =====================================================================
# 1. stats.unassigned must include orphaned assignments
# =====================================================================
class TestOrphanAwareStats:
    def test_stats_and_distribution(self, super_headers, super_uid, campaign, db_sync):
        cid = campaign["id"]
        _seed_lead(db_sync, campaign_id=cid, office="KM_BLR", assigned=None)          # unassigned
        _seed_lead(db_sync, campaign_id=cid, office="KM_BLR", assigned=super_uid)      # real
        _seed_lead(db_sync, campaign_id=cid, office="KM_BLR", assigned="fake-orphan-uid")  # orphan
        r = requests.get(f"{API}/campaigns/{cid}", headers=super_headers, timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        s = body["stats"]
        assert s["total"] == 3, s
        assert s["assigned"] == 1, s
        assert s["unassigned"] == 2, s
        # distribution must NOT contain fake-orphan-uid
        ids = [d["id"] for d in body["distribution"]]
        assert "fake-orphan-uid" not in ids
        # super_uid is a real user, may appear (pre-existing quirk — allowed)


# =====================================================================
# 2. PATCH updates + ignores office
# =====================================================================
class TestPatchCampaign:
    def test_patch_updates_fields(self, super_headers, campaign):
        cid = campaign["id"]
        payload = {"name": "TEST_camp_edited",
                   "description": "new-desc",
                   "tag_type": "course", "tag_value": "MBBS",
                   "office": "KM_HYD"}  # office must be ignored
        r = requests.patch(f"{API}/campaigns/{cid}", headers=super_headers, json=payload, timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["name"] == "TEST_camp_edited"
        assert body["description"] == "new-desc"
        assert body["tag_type"] == "course"
        assert body["tag_value"] == "MBBS"
        assert body["office"] == "KM_BLR"  # unchanged


# =====================================================================
# 3. DELETE detach vs purge
# =====================================================================
class TestDeleteWithLeads:
    def _mk(self, super_headers):
        r = requests.post(f"{API}/campaigns", headers=super_headers,
                          json={"name": f"TEST_del_{int(time.time()*1000)}",
                                "office": "KM_BLR"}, timeout=30)
        assert r.status_code == 201, r.text
        return r.json()

    def test_delete_default_detaches(self, super_headers, db_sync):
        c = self._mk(super_headers)
        cid = c["id"]
        lid = _seed_lead(db_sync, campaign_id=cid, office="KM_BLR")
        r = requests.delete(f"{API}/campaigns/{cid}", headers=super_headers, timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["ok"] is True
        assert body["removed_leads"] == 0
        lead = _find_lead(db_sync, lid)
        assert lead is not None
        assert lead["campaign_id"] is None
        # cleanup
        db_sync.leads.delete_one({"id": lid})

    def test_delete_with_leads_purges(self, super_headers, db_sync):
        c = self._mk(super_headers)
        cid = c["id"]
        lid1 = _seed_lead(db_sync, campaign_id=cid, office="KM_BLR")
        lid2 = _seed_lead(db_sync, campaign_id=cid, office="KM_BLR")
        r = requests.delete(f"{API}/campaigns/{cid}?delete_leads=true", headers=super_headers, timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["ok"] is True
        assert body["removed_leads"] == 2
        assert _find_lead(db_sync, lid1) is None
        assert _find_lead(db_sync, lid2) is None


# =====================================================================
# 4. Bulk-delete with delete_leads flag
# =====================================================================
class TestBulkDelete:
    def _mk(self, super_headers, i):
        r = requests.post(f"{API}/campaigns", headers=super_headers,
                          json={"name": f"TEST_bulk_{i}_{int(time.time()*1000)}",
                                "office": "KM_BLR"}, timeout=30)
        assert r.status_code == 201, r.text
        return r.json()["id"]

    def test_bulk_delete_detach(self, super_headers, db_sync):
        cid1 = self._mk(super_headers, 1)
        cid2 = self._mk(super_headers, 2)
        lid1 = _seed_lead(db_sync, campaign_id=cid1, office="KM_BLR")
        lid2 = _seed_lead(db_sync, campaign_id=cid2, office="KM_BLR")
        r = requests.post(f"{API}/campaigns/bulk-delete", headers=super_headers,
                          json={"ids": [cid1, cid2], "delete_leads": False}, timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["count"] == 2
        assert body["removed_leads"] == 0
        assert _find_lead(db_sync, lid1)["campaign_id"] is None
        assert _find_lead(db_sync, lid2)["campaign_id"] is None
        db_sync.leads.delete_many({"id": {"$in": [lid1, lid2]}})

    def test_bulk_delete_with_leads(self, super_headers, db_sync):
        cid1 = self._mk(super_headers, 3)
        cid2 = self._mk(super_headers, 4)
        lid1 = _seed_lead(db_sync, campaign_id=cid1, office="KM_BLR")
        lid2 = _seed_lead(db_sync, campaign_id=cid2, office="KM_BLR")
        lid3 = _seed_lead(db_sync, campaign_id=cid2, office="KM_BLR")
        r = requests.post(f"{API}/campaigns/bulk-delete", headers=super_headers,
                          json={"ids": [cid1, cid2], "delete_leads": True}, timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["count"] == 2
        assert body["removed_leads"] == 3
        for lid in (lid1, lid2, lid3):
            assert _find_lead(db_sync, lid) is None

    def test_bulk_backward_compat_no_flag(self, super_headers, db_sync):
        """Existing callers passing {ids:[...]} without delete_leads still work."""
        cid = self._mk(super_headers, 5)
        lid = _seed_lead(db_sync, campaign_id=cid, office="KM_BLR")
        r = requests.post(f"{API}/campaigns/bulk-delete", headers=super_headers,
                          json={"ids": [cid]}, timeout=30)
        assert r.status_code == 200, r.text
        assert r.json()["removed_leads"] == 0
        assert _find_lead(db_sync, lid)["campaign_id"] is None
        db_sync.leads.delete_one({"id": lid})


# =====================================================================
# 5. Distribute scope='unassigned' includes orphaned leads
# =====================================================================
class TestDistributeIncludesOrphans:
    def test_distribute_orphans(self, super_headers, db_sync):
        # create campaign
        r = requests.post(f"{API}/campaigns", headers=super_headers,
                          json={"name": f"TEST_dist_{int(time.time()*1000)}",
                                "office": "KM_BLR"}, timeout=30)
        assert r.status_code == 201, r.text
        cid = r.json()["id"]
        # 1 orphaned lead
        lid = _seed_lead(db_sync, campaign_id=cid, office="KM_BLR", assigned="fake-orphan-uid")
        # find an active employee in KM_BLR
        detail = requests.get(f"{API}/campaigns/{cid}", headers=super_headers, timeout=30).json()
        employees = detail["employees"]
        if not employees:
            pytest.skip("No employees in KM_BLR office to distribute to")
        eid = employees[0]["id"]
        r = requests.post(f"{API}/campaigns/{cid}/distribute", headers=super_headers,
                          json={"method": "equal", "employee_ids": [eid], "scope": "unassigned"}, timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["assigned"] == 1
        assert body["targeted"] == 1
        lead = _find_lead(db_sync, lid)
        assert lead["assigned_to_user_id"] == eid
        # cleanup
        requests.delete(f"{API}/campaigns/{cid}?delete_leads=true", headers=super_headers, timeout=30)


# =====================================================================
# 6. Regression: create + list + get still work
# =====================================================================
class TestRegression:
    def test_list_and_get(self, super_headers, campaign):
        r = requests.get(f"{API}/campaigns", headers=super_headers, timeout=30)
        assert r.status_code == 200
        assert any(c["id"] == campaign["id"] for c in r.json())
        r2 = requests.get(f"{API}/campaigns/{campaign['id']}", headers=super_headers, timeout=30)
        assert r2.status_code == 200
        body = r2.json()
        assert "campaign" in body and "stats" in body and "employees" in body and "distribution" in body
