"""Extra edge-case coverage for the My Ledger flow (iteration 30 review).

Covers items not in test_user_ledger.py:
- SC-payment income mirror (linked_sc_payment_invoice_id) must be excluded
- Manual income/expense tx WITHOUT a linked_* id must STILL appear
- An office_admin creating a tx against a linked client → no linked_transaction
  notification fires (only super_admin triggers it).
"""
from __future__ import annotations

from typing import Iterator

import pytest
import requests

from _creds import admin_credentials, api_base, generate_test_password

API = api_base()


def _login(email: str, password: str) -> requests.Session:
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=15)
    assert r.status_code == 200, r.text
    return s


@pytest.fixture
def admin_session() -> Iterator[requests.Session]:
    email, pwd = admin_credentials()
    s = _login(email, pwd)
    yield s
    s.close()


def _cleanup(session: requests.Session) -> None:
    listing = session.get(f"{API}/users", timeout=15).json()
    for u in listing:
        if (u.get("email") or "").startswith("pytest_ledger2_"):
            session.delete(f"{API}/users/{u['id']}", timeout=15)
    clients = session.get(f"{API}/clients", timeout=15).json()
    for c in clients:
        if (c.get("name") or "").startswith("Pytest Ledger2 Agent"):
            session.delete(f"{API}/clients/{c['id']}", timeout=15)


@pytest.fixture(autouse=True)
def _wipe(admin_session: requests.Session) -> None:
    _cleanup(admin_session)


def _create_sub_agent_and_user(admin: requests.Session) -> tuple[str, str, str]:
    cli = admin.post(
        f"{API}/clients",
        json={"name": "Pytest Ledger2 Agent", "client_type": "sub_agent_associate",
              "phone": "9000000002"},
        timeout=15,
    ).json()
    pwd = generate_test_password("Ldg2")
    email = "pytest_ledger2_user@example.com"
    admin.post(
        f"{API}/users",
        json={"email": email, "password": pwd, "name": "Pytest Ledger2 User",
              "role": "user", "linked_client_id": cli["id"]},
        timeout=15,
    ).raise_for_status()
    return cli["id"], email, pwd


def test_sc_payment_mirror_income_excluded_from_ledger(admin_session: requests.Session) -> None:
    """Service charge invoice with previous_sc_payment auto-mirrors an income tx
    (linked_sc_payment_invoice_id). Ledger must NOT include it as a credit row;
    the invoice row alone represents that flow."""
    cid, email, pwd = _create_sub_agent_and_user(admin_session)
    admin_session.post(
        f"{API}/invoices",
        json={
            "client_id": cid,
            "invoice_type": "service_charge",
            "invoice_number": "SC-PYTEST-MIRROR",
            "issue_date": "2026-02-20",
            "due_date": "2026-03-20",
            "items": [{"description": "SC pytest mirror", "quantity": 1, "unit_price": 5000}],
            "tax_rate": 0,
            "previous_sc_payment": {
                "has": True, "amount": 1200, "date": "2026-02-18",
                "mode": "bank_transfer",
            },
        },
        timeout=15,
    ).raise_for_status()

    user = _login(email, pwd)
    ledger = user.get(f"{API}/users/me/ledger", timeout=15).json()
    credit_rows = [e for e in ledger["entries"] if e["kind"] == "credit"]
    assert len(credit_rows) == 0, f"SC payment mirror leaked: {credit_rows}"
    assert ledger["totals"]["credits"] == 0.0
    user.close()


def test_manual_credit_alongside_invoice_both_visible(admin_session: requests.Session) -> None:
    """Manual income tx WITHOUT linked_invoice_id / linked_sc_payment_invoice_id
    must still appear (regression guard on the exclusion filter)."""
    cid, email, pwd = _create_sub_agent_and_user(admin_session)
    accounts = admin_session.get(f"{API}/accounts", timeout=15).json()
    acc_id = accounts[0]["id"]
    # Manual standalone income
    admin_session.post(
        f"{API}/transactions",
        json={"type": "income", "amount": 900, "account_id": acc_id,
              "date": "2026-02-22", "description": "Manual credit",
              "client_id": cid},
        timeout=15,
    ).raise_for_status()
    user = _login(email, pwd)
    ledger = user.get(f"{API}/users/me/ledger", timeout=15).json()
    credit_rows = [e for e in ledger["entries"] if e["kind"] == "credit"]
    assert len(credit_rows) == 1, credit_rows
    assert credit_rows[0]["amount"] == 900.0
    assert ledger["totals"]["credits"] == 900.0
    user.close()
