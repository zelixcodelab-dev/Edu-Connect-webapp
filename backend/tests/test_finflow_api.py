"""FinFlow backend API tests.

Covers: auth, accounts, clients, categories, transactions, invoices, dashboard.
"""
import uuid
import pytest
import requests

from tests._creds import api_base, admin_credentials

API = api_base()
ADMIN_EMAIL, ADMIN_PASSWORD = admin_credentials()


# ---------- Fixtures ----------
@pytest.fixture(scope="session")
def admin_session() -> requests.Session:
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=30)
    assert r.status_code == 200, f"Admin login failed: {r.status_code} {r.text}"
    data = r.json()
    assert data["email"] == ADMIN_EMAIL
    assert "access_token" in s.cookies, f"No access_token cookie set. Cookies: {dict(s.cookies)}"
    return s


@pytest.fixture(scope="session")
def new_user_session() -> requests.Session:
    s = requests.Session()
    email = f"test_{uuid.uuid4().hex[:10]}@example.com"
    r = s.post(f"{API}/auth/register", json={
        "email": email,
        "password": "Passw0rd!",
        "name": "Test User",
        "business_name": "TEST_Co",
    }, timeout=30)
    assert r.status_code == 200, f"Register failed: {r.status_code} {r.text}"
    s.email = email  # type: ignore
    return s


# ---------- Health ----------
def test_health_root() -> None:
    r = requests.get(f"{API}/", timeout=15)
    assert r.status_code == 200
    assert r.json().get("status") == "ok"


# ---------- Auth ----------
class TestAuth:
    def test_admin_login_sets_cookie(self, admin_session) -> None:
        # session fixture already validated cookie + login
        assert admin_session.cookies.get("access_token")

    def test_me_returns_user(self, admin_session) -> None:
        r = admin_session.get(f"{API}/auth/me", timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert data["email"] == ADMIN_EMAIL
        assert data["role"] == "admin"

    def test_me_unauthenticated(self) -> None:
        r = requests.get(f"{API}/auth/me", timeout=15)
        assert r.status_code == 401

    def test_login_invalid_password(self) -> None:
        r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": "wrong"}, timeout=15)
        assert r.status_code == 401

    def test_register_default_seeds(self, new_user_session) -> None:
        # Default categories should be seeded (10)
        r = new_user_session.get(f"{API}/categories", timeout=15)
        assert r.status_code == 200
        cats = r.json()
        assert len(cats) >= 10, f"Expected >=10 default categories, got {len(cats)}"
        # Default account
        r = new_user_session.get(f"{API}/accounts", timeout=15)
        assert r.status_code == 200
        accs = r.json()
        assert any(a["name"] == "Main Bank" for a in accs)

    def test_register_duplicate(self, new_user_session) -> None:
        email = new_user_session.email  # type: ignore
        r = requests.post(f"{API}/auth/register", json={
            "email": email, "password": "Passw0rd!", "name": "Dup"
        }, timeout=15)
        assert r.status_code == 400

    def test_patch_me_currency(self, new_user_session) -> None:
        r = new_user_session.patch(f"{API}/auth/me", json={"currency": "INR"}, timeout=15)
        assert r.status_code == 200
        assert r.json()["currency"] == "INR"
        # Switch back
        new_user_session.patch(f"{API}/auth/me", json={"currency": "USD"}, timeout=15)

    def test_logout_clears_cookie(self) -> None:
        s = requests.Session()
        s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=15)
        assert s.cookies.get("access_token")
        r = s.post(f"{API}/auth/logout", timeout=15)
        assert r.status_code == 200
        # cookie cleared
        r2 = s.get(f"{API}/auth/me", timeout=15)
        assert r2.status_code == 401


# ---------- Accounts ----------
class TestAccounts:
    def test_create_get_patch_delete(self, new_user_session) -> None:
        s = new_user_session
        r = s.post(f"{API}/accounts", json={"name": "TEST_Cash", "type": "cash", "opening_balance": 100}, timeout=15)
        assert r.status_code == 200
        acc = r.json()
        assert acc["name"] == "TEST_Cash"
        aid = acc["id"]

        # current_balance with no transactions should equal opening_balance
        r = s.get(f"{API}/accounts", timeout=15)
        accs = r.json()
        found = next(a for a in accs if a["id"] == aid)
        assert found["current_balance"] == 100

        # update
        r = s.patch(f"{API}/accounts/{aid}", json={"name": "TEST_Cash2", "type": "cash", "opening_balance": 50}, timeout=15)
        assert r.status_code == 200
        assert r.json()["name"] == "TEST_Cash2"

        # delete
        r = s.delete(f"{API}/accounts/{aid}", timeout=15)
        assert r.status_code == 200


# ---------- Clients ----------
class TestClients:
    def test_crud(self, new_user_session) -> None:
        s = new_user_session
        r = s.post(f"{API}/clients", json={"name": "TEST_Client", "email": "c@x.com"}, timeout=15)
        assert r.status_code == 200
        cid = r.json()["id"]

        r = s.get(f"{API}/clients", timeout=15)
        assert any(c["id"] == cid for c in r.json())

        r = s.patch(f"{API}/clients/{cid}", json={"name": "TEST_Client2"}, timeout=15)
        assert r.status_code == 200
        assert r.json()["name"] == "TEST_Client2"

        r = s.delete(f"{API}/clients/{cid}", timeout=15)
        assert r.status_code == 200


# ---------- Categories ----------
class TestCategories:
    def test_crud(self, new_user_session) -> None:
        s = new_user_session
        r = s.post(f"{API}/categories", json={"name": "TEST_Cat", "type": "expense"}, timeout=15)
        assert r.status_code == 200
        cid = r.json()["id"]

        r = s.patch(f"{API}/categories/{cid}", json={"name": "TEST_Cat2", "type": "income"}, timeout=15)
        assert r.status_code == 200
        assert r.json()["type"] == "income"

        r = s.delete(f"{API}/categories/{cid}", timeout=15)
        assert r.status_code == 200


# ---------- Transactions ----------
class TestTransactions:
    def test_transaction_affects_account_balance(self, new_user_session) -> None:
        s = new_user_session
        # Find Main Bank account
        accs = s.get(f"{API}/accounts", timeout=15).json()
        main = next(a for a in accs if a["name"] == "Main Bank")
        aid = main["id"]

        # Income transaction
        r = s.post(f"{API}/transactions", json={
            "type": "income", "amount": 500, "account_id": aid, "date": "2026-01-15", "description": "TEST_income"
        }, timeout=15)
        assert r.status_code == 200
        tx_income = r.json()["id"]

        # Expense transaction
        r = s.post(f"{API}/transactions", json={
            "type": "expense", "amount": 200, "account_id": aid, "date": "2026-01-16", "description": "TEST_expense"
        }, timeout=15)
        assert r.status_code == 200
        tx_exp = r.json()["id"]

        # Balance should be 500-200 = 300
        accs = s.get(f"{API}/accounts", timeout=15).json()
        main = next(a for a in accs if a["id"] == aid)
        assert main["current_balance"] == 300, f"Expected 300, got {main['current_balance']}"

        # Filter by type
        r = s.get(f"{API}/transactions", params={"type": "income"}, timeout=15)
        assert all(t["type"] == "income" for t in r.json())

        # Filter by account
        r = s.get(f"{API}/transactions", params={"account_id": aid}, timeout=15)
        assert all(t["account_id"] == aid for t in r.json())

        # Date filter
        r = s.get(f"{API}/transactions", params={"start": "2026-01-15", "end": "2026-01-15"}, timeout=15)
        ids = [t["id"] for t in r.json()]
        assert tx_income in ids
        assert tx_exp not in ids

        # cleanup
        s.delete(f"{API}/transactions/{tx_income}", timeout=15)
        s.delete(f"{API}/transactions/{tx_exp}", timeout=15)


# ---------- Invoices ----------
class TestInvoices:
    def test_invoice_totals_and_status(self, new_user_session) -> None:
        s = new_user_session
        # Create client
        cid = s.post(f"{API}/clients", json={"name": "TEST_Invoice_Client"}, timeout=15).json()["id"]

        payload = {
            "client_id": cid,
            "invoice_number": f"INV-{uuid.uuid4().hex[:6]}",
            "issue_date": "2026-01-10",
            "due_date": "2026-02-10",
            "items": [
                {"description": "Web design", "quantity": 2, "unit_price": 100},
                {"description": "Hosting", "quantity": 1, "unit_price": 50},
            ],
            "tax_rate": 10.0,
        }
        r = s.post(f"{API}/invoices", json=payload, timeout=15)
        assert r.status_code == 200, r.text
        inv = r.json()
        assert inv["subtotal"] == 250.0
        assert inv["tax_amount"] == 25.0
        assert inv["total"] == 275.0
        assert inv["status"] == "draft"

        iid = inv["id"]
        # Status updates
        for st in ["sent", "paid", "overdue", "draft"]:
            r = s.patch(f"{API}/invoices/{iid}/status", json={"status": st}, timeout=15)
            assert r.status_code == 200
            assert r.json()["status"] == st

        # Invalid status
        r = s.patch(f"{API}/invoices/{iid}/status", json={"status": "bogus"}, timeout=15)
        assert r.status_code == 400

        # cleanup
        s.delete(f"{API}/invoices/{iid}", timeout=15)
        s.delete(f"{API}/clients/{cid}", timeout=15)


# ---------- Dashboard ----------
class TestDashboard:
    def test_summary(self, admin_session) -> None:
        r = admin_session.get(f"{API}/dashboard/summary", timeout=15)
        assert r.status_code == 200
        data = r.json()
        for k in ("total_balance", "month_income", "month_expense", "month_cashflow", "outstanding_invoices", "currency"):
            assert k in data

    def test_cashflow(self, admin_session) -> None:
        r = admin_session.get(f"{API}/dashboard/cashflow", params={"months": 6}, timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        assert len(data) == 6
        for d in data:
            assert "month" in d and "income" in d and "expense" in d

    def test_expense_by_category(self, admin_session) -> None:
        r = admin_session.get(f"{API}/dashboard/expense-by-category", timeout=15)
        assert r.status_code == 200
        assert isinstance(r.json(), list)
