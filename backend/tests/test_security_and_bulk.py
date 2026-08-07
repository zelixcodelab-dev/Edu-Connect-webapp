"""Backend tests for SEC-001/002/003/004 and bulk endpoints (Leads & Campaigns)."""
import os
import time
import uuid
import requests
import subprocess
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # Fallback read from frontend .env if not exported
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
                break

# For CORS tests we must hit the FastAPI app directly (localhost:8001) — the
# public ingress currently overrides Access-Control-Allow-Origin with "*"
# for GET requests (a separate ingress-layer bug, tracked below). The backend
# code itself (server.py) is correctly configured with a strict allow-list.
DIRECT_URL = "http://localhost:8001"


def _lead_by_id(super_headers, lead_id):
    """GET single lead via the list endpoint (no /leads/{id} route exists)."""
    r = requests.get(f"{BASE_URL}/api/leads?ids={lead_id}", headers=super_headers)
    if r.status_code == 200:
        data = r.json()
        items = data.get("items", data) if isinstance(data, dict) else data
        for it in items:
            if it.get("id") == lead_id:
                return it
    # fallback — page through all
    r = requests.get(f"{BASE_URL}/api/leads?limit=500", headers=super_headers)
    if r.status_code == 200:
        data = r.json()
        items = data.get("items", data) if isinstance(data, dict) else data
        for it in items:
            if it.get("id") == lead_id:
                return it
    return None

SUPER_EMAIL = "muneer@kmfoundation.co"
SUPER_PASSWORD = "kmf@0786"


# ---------- Fixtures ----------

@pytest.fixture(scope="session")
def super_token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": SUPER_EMAIL, "password": SUPER_PASSWORD})
    assert r.status_code == 200, f"super admin login failed: {r.status_code} {r.text}"
    return r.json().get("access_token") or r.json().get("token")


@pytest.fixture(scope="session")
def super_headers(super_token):
    return {"Authorization": f"Bearer {super_token}", "Content-Type": "application/json"}


@pytest.fixture(scope="session")
def super_user(super_headers):
    r = requests.get(f"{BASE_URL}/api/auth/me", headers=super_headers)
    assert r.status_code == 200
    return r.json()


@pytest.fixture(scope="session", autouse=True)
def clear_rate_limits():
    # Clear the collection using motor via a small helper
    import asyncio, sys
    sys.path.insert(0, "/app/backend")
    from db import db  # type: ignore
    asyncio.get_event_loop().run_until_complete(db.rate_limits.delete_many({}))
    yield
    asyncio.get_event_loop().run_until_complete(db.rate_limits.delete_many({}))


# ---------- SEC-001: CORS ----------

class TestCORS:
    """Verifies SEC-001 fix on the FastAPI backend directly.

    NOTE: When tested through the public ingress URL, GET responses currently
    include ``Access-Control-Allow-Origin: *`` regardless of origin — this is
    an ingress-layer override outside of backend code, and combined with
    ``allow-credentials: true`` browsers reject the response so real
    credentialed CORS abuse is still blocked. Preflights (OPTIONS) are
    correctly filtered by FastAPI even through the ingress. Tests target
    the backend directly to validate the code change.
    """

    def test_evil_origin_not_reflected(self):
        r = requests.get(f"{DIRECT_URL}/api/", headers={"Origin": "https://evil.example.com"})
        acao = r.headers.get("access-control-allow-origin")
        assert acao in (None, ""), f"evil origin reflected by backend: {acao}"

    def test_allowed_origin_kmfoundation(self):
        origin = "https://app.kmfoundation.co.in"
        r = requests.get(f"{DIRECT_URL}/api/", headers={"Origin": origin})
        acao = r.headers.get("access-control-allow-origin")
        assert acao == origin, f"expected {origin}, got {acao}"

    def test_allowed_origin_preview_emergent(self):
        origin = "https://finance-flow-1727.preview.emergentagent.com"
        r = requests.get(f"{DIRECT_URL}/api/", headers={"Origin": origin})
        acao = r.headers.get("access-control-allow-origin")
        assert acao == origin

    def test_preflight_evil_blocked(self):
        r = requests.options(
            f"{BASE_URL}/api/auth/login",
            headers={
                "Origin": "https://evil.example.com",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "content-type",
            },
        )
        acao = r.headers.get("access-control-allow-origin")
        assert acao != "https://evil.example.com"


# ---------- SEC-004: Seed password preservation ----------

class TestSeedPassword:
    def test_super_admin_login_ok(self, super_token):
        assert super_token

    def test_seed_source_no_overwrite_branch(self):
        with open("/app/backend/seed.py") as f:
            src = f.read()
        # The removed vulnerable branch: reset admin password if verify fails.
        assert "not verify_password" not in src
        # Ensure a comment mentioning SEC-004 exists
        assert "SEC-004" in src


# ---------- SEC-003 + SEC-002: rate limit + phone masking ----------

VALID_APP_PAYLOAD = lambda phone="9876543210": {
    "basic_info": {
        "student_full_name": "TEST Applicant",
        "mobile_number": phone,
        "email": f"test.{uuid.uuid4().hex[:6]}@example.com",
        "date_of_birth": "2005-01-01",
        "gender": "male",
    },
    "course": {"interested_course": "BCA"},
    "communication": {
        "father_name": "TEST Father",
        "father_mobile": "9000000000",
        "address_line_1": "1 test rd",
        "city": "Chennai",
        "state": "Tamil Nadu",
        "pincode": "600001",
    },
    "academic": {"twelfth": {"register_number": "TESTREG123"}},
    "declaration": {"agreement_accepted": True},
}


class TestRateLimitAndPII:
    def test_rate_limit_kicks_in_after_5(self):
        url = f"{BASE_URL}/api/public/applications"
        statuses = []
        for i in range(7):
            r = requests.post(url, json=VALID_APP_PAYLOAD())
            statuses.append(r.status_code)
        # First 5 should be 201 (or at least not 429), 6th onward should be 429
        assert statuses[:5].count(201) == 5, f"expected 5 success, got: {statuses}"
        assert 429 in statuses[5:], f"rate limit did not trigger: {statuses}"
        # Verify Retry-After header on the 429
        r = requests.post(url, json=VALID_APP_PAYLOAD())
        assert r.status_code == 429
        assert r.headers.get("Retry-After"), "Retry-After header missing on 429"

    def test_phone_masked_in_logs(self):
        # A submission already happened above; grep the log for full phone
        # We use a unique phone here and clear rate_limits first so this call succeeds
        import asyncio, sys
        sys.path.insert(0, "/app/backend")
        from db import db  # type: ignore
        asyncio.get_event_loop().run_until_complete(db.rate_limits.delete_many({}))

        unique_phone = "9123456789"
        r = requests.post(f"{BASE_URL}/api/public/applications", json=VALID_APP_PAYLOAD(unique_phone))
        # It should have submitted OK
        assert r.status_code == 201, r.text
        time.sleep(1.5)
        # Check both log streams
        logs = ""
        for fn in ("/var/log/supervisor/backend.err.log", "/var/log/supervisor/backend.out.log"):
            try:
                with open(fn) as f:
                    logs += f.read()
            except Exception:
                pass
        # Full phone must NOT appear in logs
        assert unique_phone not in logs, "Full phone number leaked into backend logs"
        # And at least one masked pattern should appear from the app router
        # (mask_phone leaves last 2 digits)
        assert "*******89" in logs or "phone=" in logs, "No masked phone log entry seen"


# ---------- Leads bulk actions ----------

@pytest.fixture
def four_test_leads(super_headers, super_user):
    ids = []
    for i in range(4):
        payload = {
            "name": f"TEST Lead {uuid.uuid4().hex[:6]}",
            "phone": f"90000000{i:02d}",
            "office": super_user.get("office") or "KM_BLR",
            "source": "walk_in",
            "status": "new",
        }
        r = requests.post(f"{BASE_URL}/api/leads", headers=super_headers, json=payload)
        assert r.status_code in (200, 201), r.text
        ids.append(r.json()["id"])
    yield ids
    # cleanup any leftovers
    for lid in ids:
        requests.delete(f"{BASE_URL}/api/leads/{lid}", headers=super_headers)


class TestLeadsBulk:
    def test_bulk_status(self, super_headers, four_test_leads):
        r = requests.post(
            f"{BASE_URL}/api/leads/bulk-actions",
            headers=super_headers,
            json={"ids": four_test_leads, "action": "status", "status": "lost"},
        )
        assert r.status_code == 200, r.text
        for lid in four_test_leads:
            lead = _lead_by_id(super_headers, lid)
            assert lead is not None, f"lead {lid} not found"
            assert lead["status"] == "lost"

    def test_bulk_assign(self, super_headers, super_user, four_test_leads):
        # find a staff/office_admin user (assignee validation requires this)
        r = requests.get(f"{BASE_URL}/api/users", headers=super_headers)
        assert r.status_code == 200
        users = r.json()
        other = next(
            (u for u in users if u["id"] != super_user["id"]
             and u.get("role") in ("staff", "office_admin")
             and u.get("approval_status") == "approved"),
            None,
        )
        if not other:
            pytest.skip("No staff/office_admin user available to reassign to")
        r = requests.post(
            f"{BASE_URL}/api/leads/bulk-actions",
            headers=super_headers,
            json={"ids": four_test_leads, "action": "assign", "assigned_to_user_id": other["id"]},
        )
        assert r.status_code == 200, r.text
        for lid in four_test_leads:
            lead = _lead_by_id(super_headers, lid)
            assert lead is not None
            assert lead.get("assigned_to_user_id") == other["id"]

    def test_bulk_campaign_then_delete(self, super_headers, super_user, four_test_leads):
        # create a campaign
        camp_payload = {"name": f"TEST Camp {uuid.uuid4().hex[:6]}", "office": super_user.get("office") or "KM_BLR"}
        rc = requests.post(f"{BASE_URL}/api/campaigns", headers=super_headers, json=camp_payload)
        assert rc.status_code in (200, 201), rc.text
        campaign_id = rc.json()["id"]

        r = requests.post(
            f"{BASE_URL}/api/leads/bulk-actions",
            headers=super_headers,
            json={"ids": four_test_leads, "action": "campaign", "campaign_id": campaign_id},
        )
        assert r.status_code == 200, r.text
        for lid in four_test_leads:
            lead = _lead_by_id(super_headers, lid)
            assert lead is not None
            assert lead.get("campaign_id") == campaign_id

        # Now bulk delete leads
        r = requests.post(
            f"{BASE_URL}/api/leads/bulk-actions",
            headers=super_headers,
            json={"ids": four_test_leads, "action": "delete"},
        )
        assert r.status_code == 200, r.text
        for lid in four_test_leads:
            lead = _lead_by_id(super_headers, lid)
            assert lead is None, f"lead {lid} still exists after bulk delete"

        # cleanup campaign
        requests.delete(f"{BASE_URL}/api/campaigns/{campaign_id}", headers=super_headers)


# ---------- Campaigns bulk delete ----------

class TestCampaignsBulk:
    def test_bulk_delete_campaigns_detaches_leads(self, super_headers, super_user):
        office = super_user.get("office") or "KM_BLR"
        # Create 2 campaigns
        c_ids = []
        for _ in range(2):
            r = requests.post(f"{BASE_URL}/api/campaigns", headers=super_headers,
                              json={"name": f"TEST BulkCamp {uuid.uuid4().hex[:6]}", "office": office})
            assert r.status_code in (200, 201), r.text
            c_ids.append(r.json()["id"])
        # Create a lead attached to first campaign
        lr = requests.post(f"{BASE_URL}/api/leads", headers=super_headers, json={
            "name": f"TEST leadC {uuid.uuid4().hex[:6]}",
            "phone": "9111111111", "office": office, "source": "walk_in",
            "campaign_id": c_ids[0], "status": "new",
        })
        assert lr.status_code in (200, 201), lr.text
        lead_id = lr.json()["id"]
        try:
            r = requests.post(f"{BASE_URL}/api/campaigns/bulk-delete",
                              headers=super_headers, json={"ids": c_ids})
            assert r.status_code == 200, r.text
            for cid in c_ids:
                g = requests.get(f"{BASE_URL}/api/campaigns/{cid}", headers=super_headers)
                assert g.status_code == 404, f"campaign {cid} still exists"
            # lead should have campaign_id detached
            lead = _lead_by_id(super_headers, lead_id)
            assert lead is not None
            assert lead.get("campaign_id") in (None, ""), lead.get("campaign_id")
        finally:
            requests.delete(f"{BASE_URL}/api/leads/{lead_id}", headers=super_headers)


# ---------- Activity log persistence ----------

class TestActivityLog:
    def test_activity_log_has_bulk_events(self, super_user):
        import asyncio, sys
        sys.path.insert(0, "/app/backend")
        from db import db  # type: ignore
        loop = asyncio.get_event_loop()
        events = loop.run_until_complete(
            db.activity_log.find(
                {"type": {"$in": [
                    "lead.bulk_delete", "lead.bulk_assign",
                    "lead.bulk_campaign", "campaign.bulk_delete",
                ]}, "actor_id": super_user["id"]},
                {"_id": 0}
            ).to_list(50)
        )
        assert events, "no bulk activity_log entries found"
        seen = {e["type"] for e in events}
        # Should have at least these four types from prior tests
        for et in ("lead.bulk_delete", "lead.bulk_assign", "lead.bulk_campaign", "campaign.bulk_delete"):
            assert et in seen, f"missing activity_log event_type={et}; seen={seen}"
