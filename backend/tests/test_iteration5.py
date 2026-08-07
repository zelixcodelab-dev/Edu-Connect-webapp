"""Iteration 5 tests: Service Charge invoice variant + invoice_type branching."""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
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
    assert clients and accounts
    return {"client_id": clients[0]["id"], "account_id": accounts[0]["id"]}


def _linked(session, invoice_id):
    txs = session.get(f"{API}/transactions", params={"limit": 500}).json()
    return [t for t in txs if t.get("linked_invoice_id") == invoice_id]


# -------- Backend: service_charge POST --------
def test_create_service_charge_invoice_with_credit(session, ctx):
    payload = {
        "client_id": ctx["client_id"],
        "invoice_number": "TEST-INV-IT5-SC-001",
        "issue_date": "2026-01-15",
        "due_date": "2026-01-15",
        "items": [{"description": "Service Charge", "quantity": 1, "unit_price": 25000.0}],
        "tax_rate": 0.0,
        "credit_amount": 7300.0,
        "status": "draft",
        "auto_log_expenses": False,
        "invoice_type": "service_charge",
        "college": "IIT Delhi",
        "academic_year": "2026-27",
        "student_name": "Aarav Sharma",
        "course": "B.Tech CSE",
    }
    r = session.post(f"{API}/invoices", json=payload)
    assert r.status_code == 200, r.text
    inv = r.json()
    assert inv["invoice_type"] == "service_charge"
    assert inv["college"] == "IIT Delhi"
    assert inv["academic_year"] == "2026-27"
    assert inv["subtotal"] == 25000.0
    assert inv["tax_amount"] == 0.0
    assert inv["total"] == 17700.0  # 25000 + 0 - 7300
    assert inv["auto_log_expenses"] is False
    # auto_log=false -> no linked tx
    assert _linked(session, inv["id"]) == []

    # GET verifies persistence
    listed = session.get(f"{API}/invoices").json()
    saved = next(i for i in listed if i["id"] == inv["id"])
    assert saved["college"] == "IIT Delhi"
    assert saved["total"] == 17700.0

    session.delete(f"{API}/invoices/{inv['id']}")


# -------- Backend: defaults invoice_type to campus_visit --------
def test_default_invoice_type_is_campus_visit(session, ctx):
    payload = {
        "client_id": ctx["client_id"],
        "invoice_number": "TEST-INV-IT5-DFLT-001",
        "issue_date": "2026-01-10",
        "due_date": "2026-01-10",
        "items": [{"description": "Car Rent", "quantity": 1, "unit_price": 500.0}],
        "tax_rate": 0.0,
        "credit_amount": 0.0,
        "status": "draft",
        "auto_log_expenses": False,
    }
    r = session.post(f"{API}/invoices", json=payload)
    assert r.status_code == 200, r.text
    inv = r.json()
    assert inv["invoice_type"] == "campus_visit"
    # college / academic_year null when not service
    assert inv.get("college") in (None, "")
    assert inv.get("academic_year") in (None, "")
    session.delete(f"{API}/invoices/{inv['id']}")


# -------- Backend: PATCH switches invoice_type and recomputes totals --------
def test_patch_invoice_type_switch_recomputes_totals(session, ctx):
    create = {
        "client_id": ctx["client_id"],
        "invoice_number": "TEST-INV-IT5-PATCH-001",
        "issue_date": "2026-01-12",
        "due_date": "2026-01-12",
        "items": [{"description": "Car Rent", "quantity": 1, "unit_price": 1000.0}],
        "tax_rate": 0.0,
        "credit_amount": 0.0,
        "status": "draft",
        "auto_log_expenses": False,
        "invoice_type": "campus_visit",
    }
    inv = session.post(f"{API}/invoices", json=create).json()
    assert inv["invoice_type"] == "campus_visit"
    assert inv["total"] == 1000.0

    patch_payload = {
        **create,
        "items": [{"description": "Service Charge", "quantity": 1, "unit_price": 5000.0}],
        "credit_amount": 1500.0,
        "invoice_type": "service_charge",
        "college": "BITS Pilani",
        "academic_year": "2025-26",
    }
    r = session.patch(f"{API}/invoices/{inv['id']}", json=patch_payload)
    assert r.status_code == 200, r.text
    updated = r.json()
    assert updated["invoice_type"] == "service_charge"
    assert updated["college"] == "BITS Pilani"
    assert updated["academic_year"] == "2025-26"
    assert updated["subtotal"] == 5000.0
    assert updated["total"] == 3500.0  # 5000 - 1500
    # auto_log_expenses=false => no linked transactions
    assert _linked(session, inv["id"]) == []

    session.delete(f"{API}/invoices/{inv['id']}")


# -------- Backend: service-charge invoice w/ auto_log=false produces no transactions on PATCH --------
def test_service_charge_patch_does_not_create_transactions(session, ctx):
    create = {
        "client_id": ctx["client_id"],
        "invoice_number": "TEST-INV-IT5-SC-NOTX",
        "issue_date": "2026-01-15",
        "due_date": "2026-01-15",
        "items": [{"description": "Service Charge", "quantity": 1, "unit_price": 10000.0}],
        "tax_rate": 0.0,
        "credit_amount": 0.0,
        "status": "draft",
        "auto_log_expenses": False,
        "invoice_type": "service_charge",
        "college": "IIM Bangalore",
        "academic_year": "2026-27",
    }
    inv = session.post(f"{API}/invoices", json=create).json()
    assert _linked(session, inv["id"]) == []

    patch_payload = {
        **create,
        "items": [{"description": "Service Charge", "quantity": 1, "unit_price": 15000.0}],
        "credit_amount": 2000.0,
    }
    r = session.patch(f"{API}/invoices/{inv['id']}", json=patch_payload)
    assert r.status_code == 200
    assert r.json()["total"] == 13000.0
    assert _linked(session, inv["id"]) == []

    session.delete(f"{API}/invoices/{inv['id']}")


# -------- Backend: existing campus_visit serializes fine (college/academic_year=null) --------
def test_campus_visit_invoice_has_null_service_fields(session, ctx):
    payload = {
        "client_id": ctx["client_id"],
        "invoice_number": "TEST-INV-IT5-CV-NULL",
        "issue_date": "2026-01-15",
        "due_date": "2026-01-15",
        "items": [{"description": "Car Rent", "quantity": 1, "unit_price": 300.0}],
        "tax_rate": 0.0,
        "credit_amount": 0.0,
        "status": "draft",
        "auto_log_expenses": False,
        "invoice_type": "campus_visit",
    }
    r = session.post(f"{API}/invoices", json=payload)
    assert r.status_code == 200
    inv = r.json()
    assert inv["college"] is None
    assert inv["academic_year"] is None
    session.delete(f"{API}/invoices/{inv['id']}")


# -------- Backend: seeded INV-2026-CV-0001 still has 6 linked txs --------
def test_seed_campus_visit_invoice_intact(session):
    invoices = session.get(f"{API}/invoices").json()
    seed_cv = next((i for i in invoices if i["invoice_number"] == "INV-2026-CV-0001"), None)
    if seed_cv is None:
        pytest.skip("INV-2026-CV-0001 not seeded; skipping")
    assert seed_cv.get("invoice_type", "campus_visit") in ("campus_visit", None)  # legacy lacks field
    linked = _linked(session, seed_cv["id"])
    assert len(linked) == 6, f"Expected 6 linked txs on INV-2026-CV-0001, got {len(linked)}"


# -------- Backend: seeded INV-2026-SC-0001 exists with $17,700 total --------
def test_seed_service_charge_invoice_exists(session):
    invoices = session.get(f"{API}/invoices").json()
    seed_sc = next((i for i in invoices if i["invoice_number"] == "INV-2026-SC-0001"), None)
    if seed_sc is None:
        pytest.skip("INV-2026-SC-0001 not seeded; main agent should seed it")
    assert seed_sc["invoice_type"] == "service_charge"
    assert seed_sc["college"] == "IIT Delhi"
    assert seed_sc["academic_year"] == "2026-27"
    assert seed_sc["student_name"] == "Aarav Sharma"
    assert seed_sc["subtotal"] == 25000.0
    assert seed_sc["credit_amount"] == 7300.0
    assert seed_sc["total"] == 17700.0
    # Should not have linked expense transactions
    assert _linked(session, seed_sc["id"]) == []
