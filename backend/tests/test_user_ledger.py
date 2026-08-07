"""Integration tests for the linked-user ledger endpoint + invoice/transaction
notifications fired to the linked sub-agent / associate consultant user."""
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
        if (u.get("email") or "").startswith("pytest_ledger_"):
            session.delete(f"{API}/users/{u['id']}", timeout=15)
    clients = session.get(f"{API}/clients", timeout=15).json()
    for c in clients:
        if (c.get("name") or "").startswith("Pytest Ledger Agent"):
            session.delete(f"{API}/clients/{c['id']}", timeout=15)


@pytest.fixture(autouse=True)
def _wipe(admin_session: requests.Session) -> None:
    _cleanup(admin_session)


def _create_sub_agent_and_user(admin: requests.Session) -> tuple[str, str, str]:
    """Returns (client_id, user_email, user_password)."""
    cli = admin.post(
        f"{API}/clients",
        json={
            "name": "Pytest Ledger Agent",
            "client_type": "sub_agent_associate",
            "phone": "9000000001",
        },
        timeout=15,
    ).json()
    pwd = generate_test_password("Ledg")
    email = f"pytest_ledger_user@example.com"
    user = admin.post(
        f"{API}/users",
        json={
            "email": email,
            "password": pwd,
            "name": "Pytest Ledger User",
            "role": "user",
            "linked_client_id": cli["id"],
        },
        timeout=15,
    ).json()
    assert user.get("linked_client_id") == cli["id"], user
    return cli["id"], email, pwd


def test_unlinked_account_gets_empty_ledger(admin_session: requests.Session) -> None:
    r = admin_session.get(f"{API}/users/me/ledger", timeout=15)
    assert r.status_code == 200
    data = r.json()
    assert data["client_id"] is None
    assert data["entries"] == []
    assert data["totals"] == {"credits": 0.0, "debits": 0.0, "invoices_total": 0.0, "net": 0.0}


def test_sc_invoice_shows_in_ledger_and_notifies(admin_session: requests.Session) -> None:
    cid, email, pwd = _create_sub_agent_and_user(admin_session)

    inv = admin_session.post(
        f"{API}/invoices",
        json={
            "client_id": cid,
            "invoice_type": "service_charge",
            "invoice_number": "SC-PYTEST-001",
            "issue_date": "2026-02-15",
            "due_date": "2026-03-15",
            "items": [{"description": "SC pytest", "quantity": 1, "unit_price": 3000}],
            "tax_rate": 0,
        },
        timeout=15,
    ).json()
    assert inv.get("total") == 3000.0, inv

    user = _login(email, pwd)
    ledger = user.get(f"{API}/users/me/ledger", timeout=15).json()
    assert ledger["client_id"] == cid
    assert ledger["totals"]["invoices_total"] == 3000.0
    assert any(e["kind"] == "invoice" and e["amount"] == 3000.0 for e in ledger["entries"])

    notifs = user.get(f"{API}/notifications", timeout=15).json()
    assert any(n["type"] == "linked_invoice" for n in notifs), notifs
    user.close()


def test_credit_and_debit_transactions_show_in_ledger(admin_session: requests.Session) -> None:
    cid, email, pwd = _create_sub_agent_and_user(admin_session)

    accounts = admin_session.get(f"{API}/accounts", timeout=15).json()
    assert accounts, "Super admin should have at least one account"
    acc_id = accounts[0]["id"]

    admin_session.post(
        f"{API}/transactions",
        json={
            "type": "income", "amount": 1500, "account_id": acc_id,
            "date": "2026-02-10", "description": "Credit pytest",
            "client_id": cid,
        },
        timeout=15,
    ).raise_for_status()
    admin_session.post(
        f"{API}/transactions",
        json={
            "type": "expense", "amount": 700, "account_id": acc_id,
            "date": "2026-02-12", "description": "Debit pytest",
            "client_id": cid,
        },
        timeout=15,
    ).raise_for_status()

    user = _login(email, pwd)
    ledger = user.get(f"{API}/users/me/ledger", timeout=15).json()
    assert ledger["totals"]["credits"] == 1500.0
    assert ledger["totals"]["debits"] == 700.0
    # net = credits - debits + invoices_total (no invoice here)
    assert ledger["totals"]["net"] == 800.0
    kinds = sorted(e["kind"] for e in ledger["entries"])
    assert kinds == ["credit", "debit"]

    # Both events should produce notifications
    notifs = user.get(f"{API}/notifications", timeout=15).json()
    linked_tx = [n for n in notifs if n["type"] == "linked_transaction"]
    assert len(linked_tx) == 2, linked_tx
    user.close()


def test_auto_invoice_expense_mirror_not_double_counted(admin_session: requests.Session) -> None:
    """When an SC invoice auto-logs an expense transaction, the ledger
    should still show the invoice exactly once (no mirror duplicate)."""
    cid, email, pwd = _create_sub_agent_and_user(admin_session)
    admin_session.post(
        f"{API}/invoices",
        json={
            "client_id": cid,
            "invoice_type": "service_charge",
            "invoice_number": "SC-PYTEST-002",
            "issue_date": "2026-02-15",
            "due_date": "2026-03-15",
            "items": [{"description": "SC pytest", "quantity": 1, "unit_price": 4000}],
            "tax_rate": 0,
        },
        timeout=15,
    ).raise_for_status()

    user = _login(email, pwd)
    ledger = user.get(f"{API}/users/me/ledger", timeout=15).json()
    invoice_rows = [e for e in ledger["entries"] if e["kind"] == "invoice"]
    debit_rows = [e for e in ledger["entries"] if e["kind"] == "debit"]
    assert len(invoice_rows) == 1
    # The auto-mirrored expense tx must be filtered out
    assert len(debit_rows) == 0, debit_rows
    assert ledger["totals"]["invoices_total"] == 4000.0
    assert ledger["totals"]["debits"] == 0.0
    user.close()
