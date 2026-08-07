"""Iteration 20 — Invoice payments endpoint regression tests.

Tests GET /api/invoices/{id}/payments + a quick regression on existing
invoice CRUD to ensure the new endpoint did not break anything.
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://finance-flow-1727.preview.emergentagent.com").rstrip("/")
ADMIN_EMAIL = "admin@finflow.com"
ADMIN_PWD = "Admin@123"
OFFICE_EMAIL = "blr1@finflow.com"
OFFICE_PWD = "Office@123"


def _login(email, password):
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password}, timeout=20)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return s


@pytest.fixture(scope="module")
def admin_session():
    return _login(ADMIN_EMAIL, ADMIN_PWD)


@pytest.fixture(scope="module")
def office_session():
    return _login(OFFICE_EMAIL, OFFICE_PWD)


@pytest.fixture(scope="module")
def admin_client_id(admin_session):
    """Pick (or create) a client owned by super_admin."""
    r = admin_session.get(f"{BASE_URL}/api/clients", timeout=20)
    assert r.status_code == 200
    clients = r.json()
    assert clients, "expected at least one client"
    return clients[0]["id"]


@pytest.fixture(scope="module")
def sc_invoice_with_psp(admin_session, admin_client_id):
    """Create an SC invoice with previous_sc_payment.has = True so we can
    validate the timeline endpoint. Cleans up afterwards."""
    payload = {
        "invoice_type": "service_charge",
        "client_id": admin_client_id,
        "invoice_number": "TEST-INV-IT20",
        "issue_date": "2026-01-10",
        "due_date": "2026-01-25",
        "items": [{"description": "Service charge", "quantity": 1, "unit_price": 50000}],
        "tax_rate": 0.0,
        "credit_amount": 0.0,
        "auto_log_expenses": False,
        "previous_sc_payment": {
            "has": True,
            "amount": 20000,
            "date": "2026-01-05",
            "mode": "bank_transfer",
        },
        "notes": "iteration20 test",
        "status": "draft",
    }
    r = admin_session.post(f"{BASE_URL}/api/invoices", json=payload, timeout=20)
    assert r.status_code in (200, 201), f"create invoice failed: {r.status_code} {r.text}"
    inv = r.json()
    yield inv
    # cleanup
    admin_session.delete(f"{BASE_URL}/api/invoices/{inv['id']}", timeout=20)


@pytest.fixture(scope="module")
def sc_invoice_no_psp(admin_session, admin_client_id):
    """Create an SC invoice WITHOUT previous_sc_payment for empty-payments check."""
    payload = {
        "invoice_type": "service_charge",
        "client_id": admin_client_id,
        "invoice_number": "TEST-INV-IT20-NOPSP",
        "issue_date": "2026-01-10",
        "due_date": "2026-01-25",
        "items": [{"description": "Service charge", "quantity": 1, "unit_price": 15000}],
        "tax_rate": 0.0,
        "credit_amount": 0.0,
        "auto_log_expenses": False,
        "previous_sc_payment": {"has": False, "amount": 0},
        "status": "draft",
    }
    r = admin_session.post(f"{BASE_URL}/api/invoices", json=payload, timeout=20)
    assert r.status_code in (200, 201)
    inv = r.json()
    yield inv
    admin_session.delete(f"{BASE_URL}/api/invoices/{inv['id']}", timeout=20)


# --- New /payments endpoint tests --------------------------------------
class TestInvoicePayments:
    def test_sc_invoice_with_psp_returns_one_payment(self, admin_session, sc_invoice_with_psp):
        inv = sc_invoice_with_psp
        r = admin_session.get(f"{BASE_URL}/api/invoices/{inv['id']}/payments", timeout=20)
        assert r.status_code == 200, r.text
        data = r.json()
        assert set(data.keys()) >= {"payments", "total_paid", "balance_due"}
        assert isinstance(data["payments"], list)
        # The auto-mirrored tx should be de-duped → exactly 1 entry
        assert len(data["payments"]) == 1, f"expected 1 payment, got {data['payments']}"
        p = data["payments"][0]
        assert p["amount"] == 20000.0
        assert p["source"] == "previous_sc_payment"
        assert p["date"] == "2026-01-05"
        assert p["mode"] == "bank_transfer"
        assert "label" in p
        assert data["total_paid"] == 20000.0
        # total = 50000 - 20000 (prev payment) = 30000
        assert data["balance_due"] == 30000.0

    def test_invoice_without_payments_returns_empty(self, admin_session, sc_invoice_no_psp):
        inv = sc_invoice_no_psp
        r = admin_session.get(f"{BASE_URL}/api/invoices/{inv['id']}/payments", timeout=20)
        assert r.status_code == 200
        data = r.json()
        assert data["payments"] == []
        assert data["total_paid"] == 0
        assert data["balance_due"] == 15000.0

    def test_auto_mirrored_tx_is_deduped(self, admin_session, sc_invoice_with_psp):
        """The /sync_invoice_sc_payment_transaction creates an income tx with
        linked_sc_payment_invoice_id; the /payments endpoint must NOT emit it
        as a second entry (it matches the previous_sc_payment)."""
        inv = sc_invoice_with_psp
        # Confirm the mirrored tx exists in /transactions
        rtx = admin_session.get(f"{BASE_URL}/api/transactions", timeout=20)
        assert rtx.status_code == 200
        mirrored = [t for t in rtx.json() if t.get("linked_sc_payment_invoice_id") == inv["id"]]
        assert len(mirrored) == 1, "expected exactly one auto-mirrored income tx"
        # And the /payments endpoint still returns only 1 payment
        r = admin_session.get(f"{BASE_URL}/api/invoices/{inv['id']}/payments", timeout=20)
        assert r.status_code == 200
        assert len(r.json()["payments"]) == 1

    def test_404_on_invalid_invoice_id(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/invoices/does-not-exist-xyz/payments", timeout=20)
        assert r.status_code == 404

    def test_office_admin_cannot_access_other_user_invoice(
        self, office_session, sc_invoice_with_psp
    ):
        """Office admin querying super_admin's invoice id → 404 (per-user scope)."""
        inv = sc_invoice_with_psp
        r = office_session.get(f"{BASE_URL}/api/invoices/{inv['id']}/payments", timeout=20)
        assert r.status_code == 404


# --- Regression: existing endpoints still respond ----------------------
class TestRegression:
    def test_list_invoices(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/invoices", timeout=20)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_list_clients(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/clients", timeout=20)
        assert r.status_code == 200

    def test_list_students(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/students", timeout=20)
        assert r.status_code == 200

    def test_client_detail_staff(self, admin_session):
        # ABHISHEK P RAJ — staff client referenced in the task
        cid = "ef820dda-81e9-4b84-8870-15dca580e21b"
        r = admin_session.get(f"{BASE_URL}/api/clients/{cid}/detail", timeout=20)
        assert r.status_code == 200
        data = r.json()
        assert data["client"]["id"] == cid
        # Staff should have incentive totals, no credit/debit tiles required
        assert "totals" in data
