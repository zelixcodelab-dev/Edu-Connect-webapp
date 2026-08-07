"""Iteration 3 tests: campus-visit invoice fields + credit_amount in totals."""
import uuid
import requests

from tests._creds import api_base, admin_credentials

API = api_base()
ADMIN_EMAIL, ADMIN_PASSWORD = admin_credentials()


def admin_session() -> requests.Session:
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=30)
    assert r.status_code == 200, r.text
    return s


def _get_or_create_client(s: requests.Session) -> str:
    r = s.get(f"{API}/clients", timeout=15)
    assert r.status_code == 200
    items = r.json()
    if items:
        return items[0]["id"]
    r = s.post(f"{API}/clients", json={"name": f"TEST_iter3_client_{uuid.uuid4().hex[:6]}"}, timeout=15)
    assert r.status_code == 200
    return r.json()["id"]


# --- Create invoice with campus visit fields + credit ---
def test_create_invoice_with_campus_fields_and_credit() -> None:
    s = admin_session()
    cid = _get_or_create_client(s)
    payload = {
        "client_id": cid,
        "invoice_number": f"INV-TEST-CV-{uuid.uuid4().hex[:6]}",
        "issue_date": "2026-01-15",
        "due_date": "2026-01-15",
        "items": [
            {"description": "Car Rent", "quantity": 1, "unit_price": 3500},
            {"description": "Fuel Expense", "quantity": 1, "unit_price": 2200},
            {"description": "Cab Expense", "quantity": 1, "unit_price": 650},
            {"description": "Toll", "quantity": 1, "unit_price": 1200},
            {"description": "Food", "quantity": 1, "unit_price": 1500},
            {"description": "Driver Salary", "quantity": 1, "unit_price": 250},
        ],
        "tax_rate": 0,
        "credit_amount": 2000,
        "campus_visit_no": "CV-2026-099",
        "student_name": "TEST_Student Name",
        "course": "B.Tech CSE",
        "visited_colleges": "IIT Delhi, NIT Kurukshetra",
        "status": "draft",
    }
    r = s.post(f"{API}/invoices", json=payload, timeout=15)
    assert r.status_code == 200, r.text
    inv = r.json()
    assert inv["subtotal"] == 9300.0
    assert inv["tax_amount"] == 0.0
    assert inv["total"] == 7300.0
    assert inv["campus_visit_no"] == "CV-2026-099"
    assert inv["student_name"] == "TEST_Student Name"
    assert inv["course"] == "B.Tech CSE"
    assert inv["visited_colleges"] == "IIT Delhi, NIT Kurukshetra"
    assert inv["credit_amount"] == 2000.0

    # GET back to verify persistence
    r2 = s.get(f"{API}/invoices", timeout=15)
    assert r2.status_code == 200
    found = next((x for x in r2.json() if x["id"] == inv["id"]), None)
    assert found is not None
    assert found["total"] == 7300.0
    assert found["campus_visit_no"] == "CV-2026-099"

    # cleanup
    s.delete(f"{API}/invoices/{inv['id']}")


# --- Total with tax + credit ---
def test_invoice_total_with_tax_and_credit() -> None:
    s = admin_session()
    cid = _get_or_create_client(s)
    payload = {
        "client_id": cid,
        "invoice_number": f"INV-TEST-TX-{uuid.uuid4().hex[:6]}",
        "issue_date": "2026-01-10",
        "due_date": "2026-01-10",
        "items": [{"description": "Car Rent", "quantity": 1, "unit_price": 1000}],
        "tax_rate": 10,
        "credit_amount": 300,
    }
    r = s.post(f"{API}/invoices", json=payload, timeout=15)
    assert r.status_code == 200, r.text
    inv = r.json()
    # subtotal 1000, tax 100, total = 1000 + 100 - 300 = 800
    assert inv["subtotal"] == 1000.0
    assert inv["tax_amount"] == 100.0
    assert inv["total"] == 800.0
    s.delete(f"{API}/invoices/{inv['id']}")


# --- PATCH updates new fields and recomputes total ---
def test_patch_invoice_updates_credit_and_recomputes() -> None:
    s = admin_session()
    cid = _get_or_create_client(s)
    create_payload = {
        "client_id": cid,
        "invoice_number": f"INV-TEST-PT-{uuid.uuid4().hex[:6]}",
        "issue_date": "2026-01-12",
        "due_date": "2026-01-12",
        "items": [{"description": "Food", "quantity": 1, "unit_price": 500}],
        "tax_rate": 0,
        "credit_amount": 0,
    }
    r = s.post(f"{API}/invoices", json=create_payload, timeout=15)
    assert r.status_code == 200, r.text
    inv = r.json()
    assert inv["total"] == 500.0

    update_payload = dict(create_payload)
    update_payload["credit_amount"] = 150
    update_payload["student_name"] = "TEST_Updated Student"
    update_payload["campus_visit_no"] = "CV-NEW"
    r2 = s.patch(f"{API}/invoices/{inv['id']}", json=update_payload, timeout=15)
    assert r2.status_code == 200, r2.text
    updated = r2.json()
    assert updated["credit_amount"] == 150.0
    assert updated["total"] == 350.0
    assert updated["student_name"] == "TEST_Updated Student"
    assert updated["campus_visit_no"] == "CV-NEW"

    s.delete(f"{API}/invoices/{inv['id']}")


# --- Legacy invoice (no campus fields) still listed & editable ---
def test_legacy_invoice_without_campus_fields_works() -> None:
    s = admin_session()
    cid = _get_or_create_client(s)
    # Create a "legacy-style" invoice without the new optional fields
    payload = {
        "client_id": cid,
        "invoice_number": f"INV-TEST-LG-{uuid.uuid4().hex[:6]}",
        "issue_date": "2026-01-08",
        "due_date": "2026-01-08",
        "items": [{"description": "Consulting", "quantity": 2, "unit_price": 200}],
        "tax_rate": 5,
    }
    r = s.post(f"{API}/invoices", json=payload, timeout=15)
    assert r.status_code == 200, r.text
    inv = r.json()
    # credit_amount default 0 -> total = 400 + 20 = 420
    assert inv["subtotal"] == 400.0
    assert inv["tax_amount"] == 20.0
    assert inv["total"] == 420.0
    # Optional fields default to None / 0
    assert inv.get("campus_visit_no") in (None, "")
    assert inv.get("student_name") in (None, "")
    assert inv.get("credit_amount", 0) == 0.0

    # And editable via PATCH without supplying new fields
    upd = dict(payload)
    upd["tax_rate"] = 0
    r2 = s.patch(f"{API}/invoices/{inv['id']}", json=upd, timeout=15)
    assert r2.status_code == 200
    assert r2.json()["total"] == 400.0

    s.delete(f"{API}/invoices/{inv['id']}")


# --- Seeded campus-visit invoice exists ---
def test_seed_campus_visit_invoice_present() -> None:
    s = admin_session()
    r = s.get(f"{API}/invoices", timeout=15)
    assert r.status_code == 200
    invs = r.json()
    seed = next((x for x in invs if x.get("invoice_number") == "INV-2026-CV-0001"), None)
    assert seed is not None, "Expected seeded campus-visit invoice INV-2026-CV-0001"
    assert seed.get("student_name") == "Aarav Sharma"
    assert seed.get("total") == 7300.0
