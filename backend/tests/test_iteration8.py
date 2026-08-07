"""Iteration 8 — Student payments restructured + auto-log income tx + agent ledger."""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "admin@finflow.com"
ADMIN_PASS = "Admin@123"


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASS})
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return s


@pytest.fixture(scope="module")
def first_account_id(client):
    accs = client.get(f"{API}/accounts").json()
    assert isinstance(accs, list) and len(accs) > 0
    return accs[0]["id"]


@pytest.fixture
def student_id(client):
    """Create a fresh test student, yield id, then clean up."""
    r = client.post(f"{API}/students", json={
        "name": "TEST_IT8_Student",
        "course": "MBA",
        "sc_out_fixed": 80000,
        "status": "enrolled",
    })
    assert r.status_code == 200
    sid = r.json()["id"]
    yield sid
    client.delete(f"{API}/students/{sid}")


# --- Core payment shape & totals ---
def test_post_payment_new_shape_persists(client, student_id, first_account_id):
    payload = {
        "date": "2026-01-10",
        "amount": 25000,
        "fee_type": "tution",
        "received_in": {"type": "sub_agent", "name": "Rohan Mehta", "account_id": first_account_id},
        "has_adjustment": True,
        "adjustments": [
            {"kind": "paid_to_college", "amount": 10000, "payment_date": "2026-01-12", "payment_mode": "bank_transfer"},
            {"kind": "sc_adjusted", "amount": 5000, "payment_date": "2026-01-13", "payment_mode": "upi",
             "sub_agent_type": "sub_agent", "sub_agent_name": "Rohan Mehta"},
        ],
        "remarks": "TEST_IT8",
    }
    r = client.post(f"{API}/students/{student_id}/payments", json=payload)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["collected_total"] == 25000
    pay = body["payments"][-1]
    assert pay["received_in"]["type"] == "sub_agent"
    assert pay["received_in"]["name"] == "Rohan Mehta"
    assert pay["received_in"]["account_id"] == first_account_id
    assert pay["has_adjustment"] is True
    assert len(pay["adjustments"]) == 2
    assert all(a.get("id") for a in pay["adjustments"])
    assert pay["fee_type"] == "tution"


def test_auto_income_tx_created_with_account(client, student_id, first_account_id):
    r = client.post(f"{API}/students/{student_id}/payments", json={
        "date": "2026-01-10", "amount": 12000, "fee_type": "booking_admission",
        "received_in": {"type": "college", "account_id": first_account_id},
        "has_adjustment": False, "adjustments": [], "remarks": "TEST_IT8_auto",
    })
    assert r.status_code == 200
    pid = r.json()["payments"][-1]["id"]

    txs = client.get(f"{API}/transactions").json()
    linked = [t for t in txs if t.get("linked_student_payment_id") == pid]
    assert len(linked) == 1
    tx = linked[0]
    assert tx["type"] == "income"
    assert tx["amount"] == 12000
    assert tx["account_id"] == first_account_id
    assert tx["linked_student_id"] == student_id

    # fee_type -> category
    cats = client.get(f"{API}/categories").json()
    admission = next((c for c in cats if c["name"] == "Admission Fees" and c["type"] == "income"), None)
    if admission:
        assert tx["category_id"] == admission["id"]


def test_no_tx_when_no_account_and_not_cash(client, student_id):
    r = client.post(f"{API}/students/{student_id}/payments", json={
        "date": "2026-01-10", "amount": 5000, "fee_type": "other",
        "received_in": {"type": "sub_agent", "name": "NoAccount"},
        "has_adjustment": False, "adjustments": [], "remarks": "TEST_IT8_noaccount",
    })
    assert r.status_code == 200
    pid = r.json()["payments"][-1]["id"]
    txs = client.get(f"{API}/transactions").json()
    linked = [t for t in txs if t.get("linked_student_payment_id") == pid]
    assert len(linked) == 0


def test_patch_payment_resyncs_tx(client, student_id, first_account_id):
    r = client.post(f"{API}/students/{student_id}/payments", json={
        "date": "2026-01-10", "amount": 7000, "fee_type": "tution",
        "received_in": {"type": "college", "account_id": first_account_id},
        "has_adjustment": False, "adjustments": [],
    })
    pid = r.json()["payments"][-1]["id"]

    # PATCH -> raise amount
    r2 = client.patch(f"{API}/students/{student_id}/payments/{pid}", json={
        "date": "2026-01-10", "amount": 9000, "fee_type": "tution",
        "received_in": {"type": "college", "account_id": first_account_id},
        "has_adjustment": False, "adjustments": [],
    })
    assert r2.status_code == 200
    txs = client.get(f"{API}/transactions").json()
    linked = [t for t in txs if t.get("linked_student_payment_id") == pid]
    assert len(linked) == 1
    assert linked[0]["amount"] == 9000


def test_delete_payment_removes_tx(client, student_id, first_account_id):
    r = client.post(f"{API}/students/{student_id}/payments", json={
        "date": "2026-01-10", "amount": 4000, "fee_type": "other",
        "received_in": {"type": "college", "account_id": first_account_id},
        "has_adjustment": False, "adjustments": [],
    })
    pid = r.json()["payments"][-1]["id"]
    client.delete(f"{API}/students/{student_id}/payments/{pid}")
    txs = client.get(f"{API}/transactions").json()
    linked = [t for t in txs if t.get("linked_student_payment_id") == pid]
    assert len(linked) == 0


def test_delete_student_cascades_tx(client, first_account_id):
    r = client.post(f"{API}/students", json={"name": "TEST_IT8_Cascade", "sc_out_fixed": 1000})
    sid = r.json()["id"]
    rp = client.post(f"{API}/students/{sid}/payments", json={
        "date": "2026-01-10", "amount": 500, "fee_type": "other",
        "received_in": {"type": "college", "account_id": first_account_id},
        "has_adjustment": False, "adjustments": [],
    })
    pid = rp.json()["payments"][-1]["id"]
    # confirm tx exists
    txs = client.get(f"{API}/transactions").json()
    assert any(t.get("linked_student_payment_id") == pid for t in txs)
    # delete student
    client.delete(f"{API}/students/{sid}")
    txs2 = client.get(f"{API}/transactions").json()
    assert not any(t.get("linked_student_id") == sid for t in txs2)


# --- Legacy normalization ---
def test_legacy_payment_normalized_on_read(client):
    """List students should normalize legacy payments shape."""
    students = client.get(f"{API}/students").json()
    aarav = next((s for s in students if s["name"] == "Aarav Sharma"), None)
    if not aarav:
        pytest.skip("Seeded Aarav Sharma not present")
    for p in aarav["payments"]:
        assert "received_in" in p, "legacy payment not normalized"
        assert isinstance(p["received_in"], dict)
        assert "adjustments" in p


# --- Agent ledger ---
def test_agent_ledger_aggregation(client):
    r = client.get(f"{API}/students/agent-ledger")
    assert r.status_code == 200
    rows = r.json()
    assert isinstance(rows, list)
    rohan = next((row for row in rows if row["name"] == "Rohan Mehta" and row["type"] == "sub_agent"), None)
    if rohan is None:
        pytest.skip("Rohan Mehta agent ledger row not present (seed missing)")
    # Required keys
    for k in ["total_received", "paid_to_college", "sc_adjusted", "holding",
              "payments_count", "students_count", "students", "type", "name"]:
        assert k in rohan
    # holding == received - paid - sc
    assert round(rohan["holding"], 2) == round(
        rohan["total_received"] - rohan["paid_to_college"] - rohan["sc_adjusted"], 2
    )


def test_agent_ledger_canonical_rohan(client):
    """From iteration 8 spec: Rohan should be $40k received / $10k paid / $15k sc / $15k holding."""
    rows = client.get(f"{API}/students/agent-ledger").json()
    rohan = next((row for row in rows if row["name"] == "Rohan Mehta" and row["type"] == "sub_agent"), None)
    if rohan is None:
        pytest.skip("Rohan not present")
    # Tolerate ±0.01 rounding
    assert rohan["total_received"] == 40000, rohan
    assert rohan["paid_to_college"] == 10000, rohan
    assert rohan["sc_adjusted"] == 15000, rohan
    assert rohan["holding"] == 15000, rohan
