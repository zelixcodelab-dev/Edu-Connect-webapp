"""Iteration 43 — POST /api/leads/{id}/campaign (assign/detach).

Verifies:
- Super Admin can assign an uncategorised lead to a campaign; response has
  campaign_id + office set (from campaign office).
- Passing campaign_id=null detaches; lead reappears in ?uncategorized=true.
- ?uncategorized=true excludes leads that have a campaign_id.
- Invalid campaign_id → 404.
- Staff cannot call the endpoint → 403.
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN = {"email": "admin@kmfoundation.online", "password": "Admin@786"}
OFFICE = {"email": "blr1@finflow.com", "password": "Office@123"}
STAFF = {"email": "staff.blr@kmfoundation.online", "password": "Staff@123"}

TAG = "QA_IT43_"


def _login(creds):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json=creds, timeout=20)
    assert r.status_code == 200, f"login failed for {creds['email']}: {r.status_code} {r.text}"
    return s


@pytest.fixture(scope="module")
def admin():
    return _login(ADMIN)


@pytest.fixture(scope="module")
def office_admin():
    return _login(OFFICE)


@pytest.fixture(scope="module")
def staff():
    return _login(STAFF)


@pytest.fixture(scope="module")
def created_ids():
    ids = {"campaigns": [], "leads": []}
    yield ids
    # Teardown — delete leads then campaigns
    s = _login(ADMIN)
    for lid in ids["leads"]:
        try:
            s.delete(f"{API}/leads/{lid}", timeout=15)
        except Exception:
            pass
    for cid in ids["campaigns"]:
        try:
            s.delete(f"{API}/campaigns/{cid}", timeout=15)
        except Exception:
            pass


def _create_campaign(sess, name):
    r = sess.post(f"{API}/campaigns", json={"name": name, "office": "KM_BLR"}, timeout=20)
    assert r.status_code in (200, 201), f"create campaign failed: {r.status_code} {r.text}"
    return r.json()


def _create_lead(sess, name, campaign_id=None):
    # Assign to blr1 staff-like office_admin — matches office scoping.
    r = sess.post(f"{API}/leads", json={"name": name, "phone": "9999999999", "source": "other"}, timeout=20)
    assert r.status_code in (200, 201), f"create lead failed: {r.status_code} {r.text}"
    return r.json()


class TestAssignCampaign:
    def test_assign_and_detach_flow(self, admin, created_ids):
        # 1) Create a campaign (office KM_BLR)
        camp = _create_campaign(admin, f"{TAG}CampA")
        created_ids["campaigns"].append(camp["id"])

        # 2) Create an uncategorised lead
        lead = _create_lead(admin, f"{TAG}LeadA")
        created_ids["leads"].append(lead["id"])
        assert not lead.get("campaign_id")

        # 3) Confirm uncategorized filter returns this lead
        r = admin.get(f"{API}/leads", params={"uncategorized": "true"}, timeout=20)
        assert r.status_code == 200
        ids_uncat = {l["id"] for l in r.json()}
        assert lead["id"] in ids_uncat

        # 4) Assign to campaign
        r = admin.post(f"{API}/leads/{lead['id']}/campaign", json={"campaign_id": camp["id"]}, timeout=20)
        assert r.status_code == 200, r.text
        updated = r.json()
        assert updated["campaign_id"] == camp["id"]
        assert updated["office"] == camp["office"]

        # 5) Confirm lead is no longer in uncategorized list
        r = admin.get(f"{API}/leads", params={"uncategorized": "true"}, timeout=20)
        assert lead["id"] not in {l["id"] for l in r.json()}

        # 6) Confirm lead IS in campaign-scoped list
        r = admin.get(f"{API}/leads", params={"campaign_id": camp["id"]}, timeout=20)
        assert lead["id"] in {l["id"] for l in r.json()}

        # 7) Detach (campaign_id=null)
        r = admin.post(f"{API}/leads/{lead['id']}/campaign", json={"campaign_id": None}, timeout=20)
        assert r.status_code == 200, r.text
        detached = r.json()
        assert detached.get("campaign_id") in (None, "")

        # 8) Confirm reappears in uncategorized
        r = admin.get(f"{API}/leads", params={"uncategorized": "true"}, timeout=20)
        assert lead["id"] in {l["id"] for l in r.json()}

    def test_invalid_campaign_id_returns_404(self, admin, created_ids):
        lead = _create_lead(admin, f"{TAG}LeadB")
        created_ids["leads"].append(lead["id"])
        r = admin.post(
            f"{API}/leads/{lead['id']}/campaign",
            json={"campaign_id": "does-not-exist-xyz"},
            timeout=20,
        )
        assert r.status_code == 404, f"expected 404 got {r.status_code} {r.text}"

    def test_invalid_lead_id_returns_404(self, admin):
        r = admin.post(
            f"{API}/leads/nope-nope-nope/campaign",
            json={"campaign_id": None},
            timeout=20,
        )
        assert r.status_code == 404

    def test_staff_forbidden(self, admin, staff, created_ids):
        # Admin creates a lead for staff-scope test
        lead = _create_lead(admin, f"{TAG}LeadC")
        created_ids["leads"].append(lead["id"])
        r = staff.post(f"{API}/leads/{lead['id']}/campaign", json={"campaign_id": None}, timeout=20)
        # Staff either forbidden by role check (403) or scope (404) since lead not assigned to them.
        assert r.status_code in (403, 404), r.text

    def test_office_admin_can_assign_within_office(self, office_admin, created_ids):
        camp = _create_campaign(office_admin, f"{TAG}CampOA")
        created_ids["campaigns"].append(camp["id"])
        lead = _create_lead(office_admin, f"{TAG}LeadOA")
        created_ids["leads"].append(lead["id"])
        r = office_admin.post(
            f"{API}/leads/{lead['id']}/campaign", json={"campaign_id": camp["id"]}, timeout=20
        )
        assert r.status_code == 200, r.text
        assert r.json()["campaign_id"] == camp["id"]
