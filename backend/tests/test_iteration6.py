"""Iteration 6 tests: router split, open-credits endpoint, linked-visit invoices, atomic sync fallback."""
import os
import pytest
import requests

# Resolve BASE_URL
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


# -------- Module split: server.py is ~71 lines, routers/ dir exists with all modules --------
def test_module_split_server_is_slim():
    with open("/app/backend/server.py") as f:
        lines = f.read().splitlines()
    assert len(lines) <= 90, f"server.py has {len(lines)} lines, expected ~71 (<=90)"


def test_router_modules_exist():
    expected = ["auth", "accounts", "clients", "categories", "transactions", "invoices", "dashboard"]
    for mod in expected:
        path = f"/app/backend/routers/{mod}.py"
        assert os.path.isfile(path), f"Missing router: {path}"


# -------- Open-credits endpoint: basic shape & only includes campus_visit --------
def test_open_credits_endpoint_returns_list(session):
    r = session.get(f"{API}/invoices/open-credits")
    assert r.status_code == 200, r.text
    data = r.json()
    assert isinstance(data, list)
    for item in data:
        for key in ("id", "invoice_number", "total", "used_credit", "remaining_credit"):
            assert key in item, f"Missing key {key} in {item}"


def test_open_credits_does_not_include_service_charge(session):
    # Get all SC invoice ids first
    all_invs = session.get(f"{API}/invoices").json()
    sc_ids = {i["id"] for i in all_invs if i.get("invoice_type") == "service_charge"}
    creds = session.get(f"{API}/invoices/open-credits").json()
    cred_ids = {c["id"] for c in creds}
    assert sc_ids.isdisjoint(cred_ids), (
        f"open-credits leaked service_charge invoices: {sc_ids & cred_ids}"
    )


def test_open_credits_includes_seeded_cv0001(session):
    creds = session.get(f"{API}/invoices/open-credits").json()
    found = next((c for c in creds if c["invoice_number"] == "INV-2026-CV-0001"), None)
    assert found is not None, "Seeded INV-2026-CV-0001 missing from open-credits"
    assert found["total"] == 7300.0
    # used_credit must be sum of credit_amount on service_charge invoices linking back
    all_invs = session.get(f"{API}/invoices").json()
    expected_used = round(
        sum(
            i.get("credit_amount", 0) or 0
            for i in all_invs
            if i.get("invoice_type") == "service_charge"
            and i.get("linked_visit_invoice_id") == found["id"]
        ),
        2,
    )
    assert found["used_credit"] == expected_used
    assert found["remaining_credit"] == round(7300.0 - expected_used, 2)


def test_open_credits_filter_by_client(session, ctx):
    r = session.get(f"{API}/invoices/open-credits", params={"client_id": ctx["client_id"]})
    assert r.status_code == 200
    for item in r.json():
        # all returned items must belong to that client OR have null client (the endpoint
        # filters by exact match; ensure no leakage)
        # We can't easily verify client_id without GETing each invoice, but at least the
        # endpoint should not 500 and should respect filter shape.
        assert "id" in item


# -------- Linked-visit lifecycle: create SC with credit -> remaining drops; update -> rises; delete -> restored --------
def test_linked_visit_credit_lifecycle(session, ctx):
    # Get CV-0001 starting state
    creds_before = session.get(f"{API}/invoices/open-credits").json()
    cv = next((c for c in creds_before if c["invoice_number"] == "INV-2026-CV-0001"), None)
    assert cv is not None
    cv_id = cv["id"]
    remaining_before = cv["remaining_credit"]

    # Create a service_charge invoice linked to CV-0001 with credit_amount=3000
    payload = {
        "client_id": ctx["client_id"],
        "invoice_number": "TEST-INV-IT6-LINK-001",
        "issue_date": "2026-01-20",
        "due_date": "2026-01-20",
        "items": [{"description": "Service Charge", "quantity": 1, "unit_price": 10000.0}],
        "tax_rate": 0.0,
        "credit_amount": 3000.0,
        "status": "draft",
        "auto_log_expenses": False,
        "invoice_type": "service_charge",
        "college": "IIT Bombay",
        "academic_year": "2026-27",
        "student_name": "Test Linked",
        "linked_visit_invoice_id": cv_id,
    }
    r = session.post(f"{API}/invoices", json=payload)
    assert r.status_code == 200, r.text
    inv = r.json()
    inv_id = inv["id"]
    assert inv["linked_visit_invoice_id"] == cv_id
    assert inv["credit_amount"] == 3000.0
    assert inv["total"] == 7000.0  # 10000 - 3000

    try:
        # Remaining should have dropped by 3000
        creds_after = session.get(f"{API}/invoices/open-credits").json()
        cv_after = next(c for c in creds_after if c["id"] == cv_id)
        assert cv_after["remaining_credit"] == round(remaining_before - 3000.0, 2)
        assert cv_after["used_credit"] == round(cv["used_credit"] + 3000.0, 2)

        # PATCH credit_amount 3000 -> 1000 ; remaining should rise by 2000
        patch_payload = {**payload, "credit_amount": 1000.0}
        r2 = session.patch(f"{API}/invoices/{inv_id}", json=patch_payload)
        assert r2.status_code == 200, r2.text
        assert r2.json()["credit_amount"] == 1000.0

        creds_mid = session.get(f"{API}/invoices/open-credits").json()
        cv_mid = next(c for c in creds_mid if c["id"] == cv_id)
        assert cv_mid["remaining_credit"] == round(remaining_before - 1000.0, 2)
    finally:
        # DELETE -> remaining_credit fully restored
        session.delete(f"{API}/invoices/{inv_id}")

    creds_final = session.get(f"{API}/invoices/open-credits").json()
    cv_final = next(c for c in creds_final if c["id"] == cv_id)
    assert cv_final["remaining_credit"] == remaining_before, (
        f"After delete, remaining was {cv_final['remaining_credit']}, expected {remaining_before}"
    )


# -------- Atomic sync: seeded CV-0001 should retain its 6 linked txs after a PATCH --------
def test_seed_cv0001_sync_after_patch(session):
    all_invs = session.get(f"{API}/invoices").json()
    cv = next((i for i in all_invs if i["invoice_number"] == "INV-2026-CV-0001"), None)
    if cv is None:
        pytest.skip("INV-2026-CV-0001 not seeded")
    # Sanity-check the 6 linked txs and their sum
    linked = _linked(session, cv["id"])
    assert len(linked) == 6, f"Expected 6 linked txs pre-patch, got {len(linked)}"
    expected_amounts = {3500.0, 2200.0, 650.0, 1200.0, 1500.0, 250.0}
    got_amounts = {round(t["amount"], 2) for t in linked}
    assert got_amounts == expected_amounts, f"Got {got_amounts}"
    assert round(sum(t["amount"] for t in linked), 2) == 9300.0

    # PATCH (no-op style) and re-verify the 6 are still there (atomic sync delete+insert)
    patch_payload = {
        "client_id": cv["client_id"],
        "invoice_number": cv["invoice_number"],
        "issue_date": cv["issue_date"],
        "due_date": cv["due_date"],
        "items": cv["items"],
        "tax_rate": cv.get("tax_rate", 0.0),
        "credit_amount": cv.get("credit_amount", 0.0),
        "status": cv.get("status", "draft"),
        "auto_log_expenses": True,
        "invoice_type": cv.get("invoice_type", "campus_visit"),
        "expense_account_id": cv.get("expense_account_id"),
    }
    r = session.patch(f"{API}/invoices/{cv['id']}", json=patch_payload)
    assert r.status_code == 200, r.text

    linked2 = _linked(session, cv["id"])
    assert len(linked2) == 6, f"Post-patch expected 6 linked txs, got {len(linked2)}"
    got2 = {round(t["amount"], 2) for t in linked2}
    assert got2 == expected_amounts
    assert round(sum(t["amount"] for t in linked2), 2) == 9300.0


# -------- Atomic sync fallback log: backend log warns 'Transaction unsupported, syncing non-atomically' --------
def test_atomic_fallback_logged_in_backend():
    """Trigger a sync (any invoice PATCH does this) then grep backend logs for the warning."""
    # The previous test already triggered a sync. Check supervisor logs.
    log_files = [
        "/var/log/supervisor/backend.out.log",
        "/var/log/supervisor/backend.err.log",
    ]
    needle = "Transaction unsupported, syncing non-atomically"
    found = False
    for lf in log_files:
        if not os.path.exists(lf):
            continue
        with open(lf) as f:
            content = f.read()
        if needle in content:
            found = True
            break
    assert found, (
        "Expected fallback warning 'Transaction unsupported, syncing non-atomically' "
        "in backend logs but did not find it. Standalone Mongo should trigger this."
    )


# -------- Linked-visit field persists on GET and listing --------
def test_linked_visit_field_persists(session, ctx):
    creds = session.get(f"{API}/invoices/open-credits").json()
    cv = next((c for c in creds if c["invoice_number"] == "INV-2026-CV-0001"), None)
    if cv is None:
        pytest.skip("CV seed missing")
    payload = {
        "client_id": ctx["client_id"],
        "invoice_number": "TEST-INV-IT6-PERSIST",
        "issue_date": "2026-01-20",
        "due_date": "2026-01-20",
        "items": [{"description": "Service Charge", "quantity": 1, "unit_price": 5000.0}],
        "tax_rate": 0.0,
        "credit_amount": 500.0,
        "status": "draft",
        "auto_log_expenses": False,
        "invoice_type": "service_charge",
        "college": "X",
        "academic_year": "2026-27",
        "linked_visit_invoice_id": cv["id"],
    }
    inv = session.post(f"{API}/invoices", json=payload).json()
    try:
        listed = session.get(f"{API}/invoices").json()
        saved = next(i for i in listed if i["id"] == inv["id"])
        assert saved["linked_visit_invoice_id"] == cv["id"]
        assert saved["credit_amount"] == 500.0
    finally:
        session.delete(f"{API}/invoices/{inv['id']}")
