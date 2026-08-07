"""Iteration 42 — CRM restructure backend regression.

Confirms:
  * GET /api/leads/stats?campaign_id=... scopes stats to that campaign only.
  * GET /api/leads?campaign_id=... returns only leads for that campaign.
  * Cross-campaign isolation (leads in campaign A don't leak into B stats).

Prefixes test data with 'QA_IT42_' and cleans up all campaigns + leads it created
on teardown (campaign delete only detaches leads, so we explicitly delete leads).
"""
import os
import pytest
import requests

BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/") + "/api"

OFFICE_ADMIN = {"email": "blr1@finflow.com", "password": "Office@123"}


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    r = s.post(f"{BASE}/auth/login", json=OFFICE_ADMIN, timeout=15)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    yield s
    s.close()


@pytest.fixture(scope="module")
def campaign_pair(client):
    """Create two campaigns and seed leads into each. Yields (camp_a, camp_b, lead_ids)."""
    created_campaigns = []
    created_lead_ids = []

    ra = client.post(f"{BASE}/campaigns", json={"name": "QA_IT42_CampA"}, timeout=15)
    assert ra.status_code in (200, 201), ra.text
    ca = ra.json()["id"]
    created_campaigns.append(ca)

    rb = client.post(f"{BASE}/campaigns", json={"name": "QA_IT42_CampB"}, timeout=15)
    assert rb.status_code in (200, 201), rb.text
    cb = rb.json()["id"]
    created_campaigns.append(cb)

    # Seed 3 leads in A, 1 in B
    for i in range(3):
        r = client.post(
            f"{BASE}/campaigns/{ca}/leads",
            json={"leads": [{"name": f"QA_IT42_A_{i}"}]},
            timeout=15,
        )
        assert r.status_code in (200, 201), r.text
    r = client.post(
        f"{BASE}/campaigns/{cb}/leads",
        json={"leads": [{"name": "QA_IT42_B_0"}]},
        timeout=15,
    )
    assert r.status_code in (200, 201), r.text

    # Grab lead ids for cleanup
    for cid in (ca, cb):
        rl = client.get(f"{BASE}/leads", params={"campaign_id": cid}, timeout=15)
        assert rl.status_code == 200
        for l in rl.json():
            created_lead_ids.append(l["id"])

    yield ca, cb

    # Cleanup: delete leads and campaigns
    for lid in created_lead_ids:
        try:
            client.delete(f"{BASE}/leads/{lid}", timeout=10)
        except Exception:
            pass
    for cid in created_campaigns:
        try:
            client.delete(f"{BASE}/campaigns/{cid}", timeout=10)
        except Exception:
            pass


class TestLeadsCampaignScoping:
    def test_stats_no_campaign_returns_office_totals(self, client):
        r = client.get(f"{BASE}/leads/stats", timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert set(["total", "by_status", "missed"]).issubset(d.keys())
        assert isinstance(d["total"], int)

    def test_stats_scoped_to_campaign_a(self, client, campaign_pair):
        ca, _ = campaign_pair
        r = client.get(f"{BASE}/leads/stats", params={"campaign_id": ca}, timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert d["total"] == 3, f"expected 3 leads in campaign A, got {d}"

    def test_stats_scoped_to_campaign_b(self, client, campaign_pair):
        _, cb = campaign_pair
        r = client.get(f"{BASE}/leads/stats", params={"campaign_id": cb}, timeout=15)
        assert r.status_code == 200
        assert r.json()["total"] == 1

    def test_leads_list_scoped_to_campaign_a(self, client, campaign_pair):
        ca, _ = campaign_pair
        r = client.get(f"{BASE}/leads", params={"campaign_id": ca}, timeout=15)
        assert r.status_code == 200
        leads = r.json()
        assert len(leads) == 3
        for l in leads:
            assert l["name"].startswith("QA_IT42_A_"), l

    def test_leads_list_scoped_to_campaign_b(self, client, campaign_pair):
        _, cb = campaign_pair
        r = client.get(f"{BASE}/leads", params={"campaign_id": cb}, timeout=15)
        assert r.status_code == 200
        leads = r.json()
        assert len(leads) == 1
        assert leads[0]["name"] == "QA_IT42_B_0"

    def test_bogus_campaign_id_returns_zero(self, client):
        r = client.get(
            f"{BASE}/leads/stats",
            params={"campaign_id": "does-not-exist"},
            timeout=15,
        )
        assert r.status_code == 200
        assert r.json()["total"] == 0

        r2 = client.get(
            f"{BASE}/leads",
            params={"campaign_id": "does-not-exist"},
            timeout=15,
        )
        assert r2.status_code == 200
        assert r2.json() == []
