"""Iteration 12 — 2-tier role system (super_admin / office_admin) backend tests.

Covers: register w/ office field, login gating by approval_status, users mgmt,
expense-requests CRUD + approve/reject, accounts ?for_user_id, clients staff fields."""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://finance-flow-1727.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

SUPER_EMAIL = "admin@finflow.com"
SUPER_PASS = "Admin@123"
OFFICE_EMAIL = "blr1@finflow.com"
OFFICE_PASS = "Office@123"

TS = int(time.time())
NEW_EMAIL = f"testoffice+{TS}@finflow.com"
NEW_PASS = "Test@123"


# ---------------- fixtures ----------------
@pytest.fixture(scope="module")
def super_session():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": SUPER_EMAIL, "password": SUPER_PASS}, timeout=15)
    assert r.status_code == 200, f"super login failed: {r.status_code} {r.text}"
    return s


@pytest.fixture(scope="module")
def office_session():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": OFFICE_EMAIL, "password": OFFICE_PASS}, timeout=15)
    assert r.status_code == 200, f"office login failed: {r.status_code} {r.text}"
    return s


# ---------------- 1. Register flow ----------------
class TestRegister:
    def test_register_requires_office(self):
        r = requests.post(f"{API}/auth/register", json={
            "email": f"missingoffice+{TS}@finflow.com",
            "password": NEW_PASS, "name": "No Office"
        }, timeout=15)
        assert r.status_code == 400, f"expected 400, got {r.status_code} {r.text}"

    def test_register_pending_no_cookie(self):
        s = requests.Session()
        r = s.post(f"{API}/auth/register", json={
            "email": NEW_EMAIL, "password": NEW_PASS,
            "name": "Pending Tester", "office": "KM_TCR"
        }, timeout=15)
        assert r.status_code == 200, f"register: {r.status_code} {r.text}"
        body = r.json()
        assert body.get("ok") is True
        assert body.get("approval_status") == "pending"
        assert "message" in body
        # No auth cookie set
        assert "access_token" not in s.cookies, "register must NOT set auth cookie"
        # /me should be 401 since no cookie
        me = s.get(f"{API}/auth/me", timeout=10)
        assert me.status_code in (401, 403)

    def test_login_blocked_when_pending(self):
        r = requests.post(f"{API}/auth/login",
                          json={"email": NEW_EMAIL, "password": NEW_PASS}, timeout=15)
        assert r.status_code == 403, f"pending user should get 403, got {r.status_code}"


# ---------------- 2. Users management ----------------
class TestUsers:
    def test_list_users_super(self, super_session):
        r = super_session.get(f"{API}/users", timeout=10)
        assert r.status_code == 200
        users = r.json()
        assert isinstance(users, list)
        emails = [u["email"] for u in users]
        assert NEW_EMAIL in emails

    def test_list_users_filter_pending(self, super_session):
        r = super_session.get(f"{API}/users?status=pending", timeout=10)
        assert r.status_code == 200
        for u in r.json():
            assert u["approval_status"] == "pending"

    def test_list_users_forbidden_for_office(self, office_session):
        r = office_session.get(f"{API}/users", timeout=10)
        assert r.status_code == 403

    def test_approve_pending_user(self, super_session):
        # Find new user id
        users = super_session.get(f"{API}/users?status=pending", timeout=10).json()
        target = next((u for u in users if u["email"] == NEW_EMAIL), None)
        assert target, f"new user {NEW_EMAIL} not in pending list"
        uid = target["id"]
        r = super_session.patch(f"{API}/users/{uid}/approval",
                                json={"status": "approved"}, timeout=10)
        assert r.status_code == 200, r.text
        assert r.json()["approval_status"] == "approved"

    def test_approved_user_can_login(self):
        r = requests.post(f"{API}/auth/login",
                          json={"email": NEW_EMAIL, "password": NEW_PASS}, timeout=15)
        assert r.status_code == 200, f"approved should login, got {r.status_code} {r.text}"
        body = r.json()
        assert body["role"] == "office_admin"
        assert body["office"] == "KM_TCR"

    def test_super_cannot_change_own_status(self, super_session):
        me = super_session.get(f"{API}/auth/me", timeout=10).json()
        r = super_session.patch(f"{API}/users/{me['id']}/approval",
                                json={"status": "rejected"}, timeout=10)
        assert r.status_code == 400


# ---------------- 3. Expense Requests ----------------
class TestExpenseRequests:
    created_id = None

    def test_super_cannot_create(self, super_session):
        r = super_session.post(f"{API}/expense-requests", json={
            "amount": 100.0, "date": "2026-01-15", "description": "TEST_should_fail"
        }, timeout=10)
        assert r.status_code == 403

    def test_office_creates_pending(self, office_session):
        r = office_session.post(f"{API}/expense-requests", json={
            "amount": 555.55, "date": "2026-01-15",
            "description": "TEST_IT12_expense_req", "urgency": "normal", "kind": "expense"
        }, timeout=10)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["status"] == "pending"
        assert body["amount"] == 555.55
        assert body["requester_office"] == "KM_BLR"
        assert "id" in body
        TestExpenseRequests.created_id = body["id"]

    def test_office_sees_only_own(self, office_session):
        r = office_session.get(f"{API}/expense-requests", timeout=10)
        assert r.status_code == 200
        docs = r.json()
        me = office_session.get(f"{API}/auth/me", timeout=10).json()
        for d in docs:
            assert d["requested_by_user_id"] == me["id"]
        ids = [d["id"] for d in docs]
        assert TestExpenseRequests.created_id in ids

    def test_super_sees_all_enriched(self, super_session):
        r = super_session.get(f"{API}/expense-requests", timeout=10)
        assert r.status_code == 200
        docs = r.json()
        ours = next((d for d in docs if d["id"] == TestExpenseRequests.created_id), None)
        assert ours, "super_admin should see office_admin's request"
        # enrichment fields
        assert "requested_by_name" in ours
        assert "requested_by_email" in ours
        assert "requested_by_office" in ours
        assert ours["requested_by_email"] == OFFICE_EMAIL

    def test_approve_creates_expense_transaction(self, super_session, office_session):
        rid = TestExpenseRequests.created_id
        # Get requester's accounts via for_user_id
        me_office = office_session.get(f"{API}/auth/me", timeout=10).json()
        accts_resp = super_session.get(f"{API}/accounts?for_user_id={me_office['id']}", timeout=10)
        assert accts_resp.status_code == 200, accts_resp.text
        accts = accts_resp.json()
        assert isinstance(accts, list) and len(accts) > 0, "requester should have seeded accounts"
        # ensure current_balance is present
        assert "current_balance" in accts[0]
        acct_id = accts[0]["id"]

        r = super_session.post(f"{API}/expense-requests/{rid}/approve",
                               json={"account_id": acct_id, "note": "ok"}, timeout=10)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["status"] == "approved"
        assert body["linked_transaction_id"]
        tx_id = body["linked_transaction_id"]

        # Verify transaction appears for office_admin
        tx_list = office_session.get(f"{API}/transactions", timeout=10).json()
        found = next((t for t in tx_list if t["id"] == tx_id), None)
        assert found, "approved expense transaction must be on requester's books"
        assert found["type"] == "expense"
        assert found["amount"] == 555.55
        assert found.get("linked_expense_request_id") == rid

    def test_cannot_approve_already_actioned(self, super_session, office_session):
        rid = TestExpenseRequests.created_id
        me_office = office_session.get(f"{API}/auth/me", timeout=10).json()
        accts = super_session.get(f"{API}/accounts?for_user_id={me_office['id']}", timeout=10).json()
        r = super_session.post(f"{API}/expense-requests/{rid}/approve",
                               json={"account_id": accts[0]["id"]}, timeout=10)
        assert r.status_code == 400

    def test_office_accounts_forbidden_to_other(self, office_session):
        # office_admin must not be able to view another user's accounts
        # use a fake/other user id (the super admin's)
        super_s = requests.Session()
        super_s.post(f"{API}/auth/login", json={"email": SUPER_EMAIL, "password": SUPER_PASS})
        super_me = super_s.get(f"{API}/auth/me").json()
        r = office_session.get(f"{API}/accounts?for_user_id={super_me['id']}", timeout=10)
        assert r.status_code == 403

    def test_reject_flow(self, office_session, super_session):
        # Create a second request to reject
        rc = office_session.post(f"{API}/expense-requests", json={
            "amount": 22.0, "date": "2026-01-15", "description": "TEST_IT12_to_reject"
        }, timeout=10)
        assert rc.status_code == 200
        rid = rc.json()["id"]
        rj = super_session.post(f"{API}/expense-requests/{rid}/reject",
                                json={"note": "nope"}, timeout=10)
        assert rj.status_code == 200
        assert rj.json()["status"] == "rejected"
        assert rj.json().get("decision_note") == "nope"

    def test_office_can_cancel_own_pending(self, office_session):
        rc = office_session.post(f"{API}/expense-requests", json={
            "amount": 11.0, "date": "2026-01-15", "description": "TEST_IT12_cancel_me"
        }, timeout=10)
        rid = rc.json()["id"]
        rd = office_session.delete(f"{API}/expense-requests/{rid}", timeout=10)
        assert rd.status_code == 200

    def test_office_cannot_cancel_approved(self, office_session):
        # approved req from earlier
        rid = TestExpenseRequests.created_id
        r = office_session.delete(f"{API}/expense-requests/{rid}", timeout=10)
        assert r.status_code == 400


# ---------------- 4. Clients (staff) ----------------
class TestStaffClient:
    def test_create_staff_with_office_fields(self, office_session):
        r = office_session.post(f"{API}/clients", json={
            "name": "TEST_IT12_StaffPerson",
            "client_type": "staff",
            "office": "KM_BLR",
            "eligible_incentive": 500.0,
            "date_of_birth": "1990-04-15",
            "email": "staff_test@finflow.com",
        }, timeout=10)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["client_type"] == "staff"
        assert body["office"] == "KM_BLR"
        assert body["eligible_incentive"] == 500.0
        assert body["date_of_birth"] == "1990-04-15"
        # Verify via GET
        cid = body["id"]
        listing = office_session.get(f"{API}/clients", timeout=10).json()
        found = next((c for c in listing if c["id"] == cid), None)
        assert found and found["client_type"] == "staff"
