"""Iteration 4 tests: Invoice auto-log expense transactions lifecycle."""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # Read frontend/.env directly as fallback
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
                break

API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": "admin@finflow.com", "password": "Admin@123"})
    assert r.status_code == 200, f"Login failed: {r.text}"
    return s


@pytest.fixture(scope="module")
def ctx(session):
    clients = session.get(f"{API}/clients").json()
    accounts = session.get(f"{API}/accounts").json()
    categories = session.get(f"{API}/categories").json()
    assert clients and accounts and categories
    return {
        "client_id": clients[0]["id"],
        "account_id": accounts[0]["id"],
        "second_account_id": accounts[1]["id"] if len(accounts) > 1 else None,
        "cat_by_name": {c["name"].lower(): c for c in categories},
    }


def _invoice_payload(ctx, number, auto_log=True, expense_account_id=None, particulars=None):
    if particulars is None:
        particulars = [
            {"description": "Car Rent", "quantity": 1, "unit_price": 100.0},
            {"description": "Fuel Expense", "quantity": 1, "unit_price": 50.0},
            {"description": "Toll", "quantity": 1, "unit_price": 25.0},
            {"description": "Food", "quantity": 1, "unit_price": 30.0},
            {"description": "Driver Salary", "quantity": 1, "unit_price": 200.0},
            {"description": "Cab Expense", "quantity": 1, "unit_price": 40.0},
            {"description": "Other: Parking", "quantity": 1, "unit_price": 15.0},
        ]
    return {
        "client_id": ctx["client_id"],
        "invoice_number": number,
        "issue_date": "2026-01-15",
        "due_date": "2026-01-15",
        "items": particulars,
        "tax_rate": 5.0,
        "credit_amount": 50.0,
        "status": "draft",
        "auto_log_expenses": auto_log,
        "expense_account_id": expense_account_id,
    }


def _linked(session, invoice_id):
    txs = session.get(f"{API}/transactions").json()
    return [t for t in txs if t.get("linked_invoice_id") == invoice_id]


def test_create_invoice_with_auto_log_creates_linked_transactions(session, ctx):
    payload = _invoice_payload(ctx, "TEST-INV-IT4-001", auto_log=True, expense_account_id=ctx["account_id"])
    r = session.post(f"{API}/invoices", json=payload)
    assert r.status_code == 200, r.text
    inv = r.json()
    assert inv["auto_log_expenses"] is True
    assert inv["expense_account_id"] == ctx["account_id"]

    linked = _linked(session, inv["id"])
    assert len(linked) == 7, f"Expected 7 linked txs, got {len(linked)}"

    # All expense type
    for t in linked:
        assert t["type"] == "expense"
        assert t["account_id"] == ctx["account_id"]

    # Category mapping
    by_desc = {t["description"].split(" · ")[0]: t for t in linked}
    cn = ctx["cat_by_name"]
    assert by_desc["Car Rent"]["category_id"] == cn["cab exp"]["id"]
    assert by_desc["Fuel Expense"]["category_id"] == cn["fuel exp"]["id"]
    assert by_desc["Toll"]["category_id"] == cn["toll"]["id"]
    assert by_desc["Food"]["category_id"] == cn["food"]["id"]
    assert by_desc["Driver Salary"]["category_id"] == cn["salaries"]["id"]
    assert by_desc["Cab Expense"]["category_id"] == cn["cab exp"]["id"]
    assert by_desc["Other: Parking"]["category_id"] == cn["other"]["id"]

    # Sum equals subtotal (not total) — credit NOT logged
    total_logged = sum(t["amount"] for t in linked)
    assert round(total_logged, 2) == round(inv["subtotal"], 2)
    assert round(inv["subtotal"], 2) != round(inv["total"], 2)  # tax+credit differ

    # cleanup
    session.delete(f"{API}/invoices/{inv['id']}")


def test_patch_auto_log_recreates_no_duplicates(session, ctx):
    inv = session.post(f"{API}/invoices", json=_invoice_payload(
        ctx, "TEST-INV-IT4-002", auto_log=True, expense_account_id=ctx["account_id"]
    )).json()
    before = _linked(session, inv["id"])
    assert len(before) == 7

    # Modify particulars
    new_payload = _invoice_payload(
        ctx, "TEST-INV-IT4-002", auto_log=True, expense_account_id=ctx["account_id"],
        particulars=[
            {"description": "Car Rent", "quantity": 1, "unit_price": 500.0},
            {"description": "Food", "quantity": 2, "unit_price": 75.0},
        ],
    )
    r = session.patch(f"{API}/invoices/{inv['id']}", json=new_payload)
    assert r.status_code == 200, r.text

    linked = _linked(session, inv["id"])
    assert len(linked) == 2, f"Expected 2 linked, got {len(linked)}"
    amounts = sorted(t["amount"] for t in linked)
    assert amounts == [150.0, 500.0]

    session.delete(f"{API}/invoices/{inv['id']}")


def test_patch_disable_auto_log_removes_linked(session, ctx):
    inv = session.post(f"{API}/invoices", json=_invoice_payload(
        ctx, "TEST-INV-IT4-003", auto_log=True, expense_account_id=ctx["account_id"]
    )).json()
    assert len(_linked(session, inv["id"])) == 7

    payload = _invoice_payload(ctx, "TEST-INV-IT4-003", auto_log=False, expense_account_id=ctx["account_id"])
    r = session.patch(f"{API}/invoices/{inv['id']}", json=payload)
    assert r.status_code == 200
    assert _linked(session, inv["id"]) == []

    session.delete(f"{API}/invoices/{inv['id']}")


def test_delete_invoice_cascades_linked_transactions(session, ctx):
    inv = session.post(f"{API}/invoices", json=_invoice_payload(
        ctx, "TEST-INV-IT4-004", auto_log=True, expense_account_id=ctx["account_id"]
    )).json()
    assert len(_linked(session, inv["id"])) == 7

    r = session.delete(f"{API}/invoices/{inv['id']}")
    assert r.status_code == 200
    assert _linked(session, inv["id"]) == []


def test_default_auto_log_when_field_absent(session, ctx):
    payload = _invoice_payload(ctx, "TEST-INV-IT4-005", expense_account_id=ctx["account_id"])
    payload.pop("auto_log_expenses")  # omit -> default True
    r = session.post(f"{API}/invoices", json=payload)
    assert r.status_code == 200
    inv = r.json()
    assert inv["auto_log_expenses"] is True
    assert len(_linked(session, inv["id"])) == 7
    session.delete(f"{API}/invoices/{inv['id']}")


def test_null_expense_account_falls_back_to_first_account(session, ctx):
    payload = _invoice_payload(ctx, "TEST-INV-IT4-006", auto_log=True, expense_account_id=None)
    r = session.post(f"{API}/invoices", json=payload)
    assert r.status_code == 200
    inv = r.json()
    linked = _linked(session, inv["id"])
    assert len(linked) == 7
    # All linked tx should be on first user account
    first_account = session.get(f"{API}/accounts").json()[0]
    for t in linked:
        assert t["account_id"] == first_account["id"]
    session.delete(f"{API}/invoices/{inv['id']}")


def test_linked_transactions_listed_and_filterable(session, ctx):
    inv = session.post(f"{API}/invoices", json=_invoice_payload(
        ctx, "TEST-INV-IT4-007", auto_log=True, expense_account_id=ctx["account_id"]
    )).json()

    # GET /transactions?type=expense includes them
    r = session.get(f"{API}/transactions", params={"type": "expense", "limit": 500})
    assert r.status_code == 200
    found = [t for t in r.json() if t.get("linked_invoice_id") == inv["id"]]
    assert len(found) == 7
    for t in found:
        assert t["type"] == "expense"

    session.delete(f"{API}/invoices/{inv['id']}")


def test_legacy_invoice_patch_still_works(session, ctx):
    """Simulate a legacy invoice without auto_log_expenses persisted; PATCH should default True."""
    # Create invoice normally
    inv = session.post(f"{API}/invoices", json=_invoice_payload(
        ctx, "TEST-INV-IT4-008", auto_log=True, expense_account_id=ctx["account_id"]
    )).json()
    # Strip auto_log_expenses field from db directly via API (we can't here),
    # so simulate by PATCHing without sending it in payload — but Pydantic defaults to True.
    payload = _invoice_payload(ctx, "TEST-INV-IT4-008", expense_account_id=ctx["account_id"])
    payload.pop("auto_log_expenses")
    r = session.patch(f"{API}/invoices/{inv['id']}", json=payload)
    assert r.status_code == 200
    assert r.json()["auto_log_expenses"] is True
    assert len(_linked(session, inv["id"])) == 7
    session.delete(f"{API}/invoices/{inv['id']}")
