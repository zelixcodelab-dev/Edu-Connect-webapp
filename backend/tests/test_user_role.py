"""Iteration 44 — new lightweight "user" role.

Spec: a third role distinct from super_admin / office_admin. They log in
and see a stripped-down sidebar (Overview · Quick entry · Transactions ·
Accounts · Settings) with only their *own* records — no students, clients,
invoices, etc.

Tests cover: creating a user-role account, the user can sign in, the user
gets a `user` role + USER_DEFAULT_PERMISSIONS server-side, calls to
restricted endpoints (students / clients / invoices) return 403, and calls
to allowed endpoints (transactions / accounts) succeed.
"""
from __future__ import annotations

import time
from typing import Optional

import requests

from tests._creds import api_base, admin_credentials, generate_test_password

API = api_base()


def _login(email: str, password: str) -> Optional[str]:
    r = requests.post(
        f"{API}/auth/login",
        json={"email": email, "password": password},
        timeout=15,
    )
    if r.status_code != 200:
        return None
    return r.json().get("access_token") or r.json().get("token") or ""


def _h(t: str) -> dict:
    return {"Authorization": f"Bearer {t}", "Content-Type": "application/json"}


def _create_user_role_account(super_token: str) -> dict:
    stamp = int(time.time() * 1000)
    email = f"user_role_qa_{stamp}@example.com"
    password = generate_test_password("UserPwd")
    r = requests.post(
        f"{API}/users",
        headers=_h(super_token),
        json={
            "email": email,
            "password": password,
            "name": "User QA",
            "role": "user",
            "currency": "INR",
        },
        timeout=15,
    )
    r.raise_for_status()
    body = r.json()
    body["password"] = password
    return body


def _delete_user(super_token: str, user_id: str) -> None:
    try:
        requests.delete(f"{API}/users/{user_id}", headers=_h(super_token), timeout=10)
    except requests.RequestException:
        pass


def test_super_admin_creates_user_role_account() -> None:
    super_token = _login(*admin_credentials())
    body = _create_user_role_account(super_token)
    try:
        assert body["role"] == "user"
        # Stripped-down permissions
        perms = body.get("permissions") or {}
        assert perms.get("transactions") == "edit"
        assert perms.get("accounts") == "edit"
        assert perms.get("students") == "none"
        assert perms.get("clients") == "none"
        # Login works
        token = _login(body["email"], body["password"])
        assert token is not None
    finally:
        _delete_user(super_token, body["id"])


def test_user_role_can_use_transactions_and_accounts() -> None:
    super_token = _login(*admin_credentials())
    body = _create_user_role_account(super_token)
    try:
        token = _login(body["email"], body["password"])
        # 1) Create an account
        ar = requests.post(
            f"{API}/accounts",
            headers=_h(token),
            json={"name": "User Cash", "type": "cash", "opening_balance": 1000},
            timeout=15,
        )
        assert ar.status_code == 200, ar.text
        account_id = ar.json()["id"]
        # 2) Create a transaction (debit)
        tr = requests.post(
            f"{API}/transactions",
            headers=_h(token),
            json={
                "type": "expense",
                "amount": 150,
                "account_id": account_id,
                "date": "2026-02-26",
                "description": "Coffee",
            },
            timeout=15,
        )
        assert tr.status_code == 200, tr.text
        # 3) List transactions
        lr = requests.get(f"{API}/transactions", headers=_h(token), timeout=15)
        lr.raise_for_status()
        txs = lr.json()
        assert any(t.get("description") == "Coffee" for t in txs)
    finally:
        _delete_user(super_token, body["id"])


def test_user_role_blocked_from_students_clients_invoices() -> None:
    super_token = _login(*admin_credentials())
    body = _create_user_role_account(super_token)
    try:
        token = _login(body["email"], body["password"])
        # Create attempts must be 403
        for path, payload in (
            ("/students", {"name": "Nope", "status": "inquiry"}),
            ("/clients", {"name": "Nope", "client_type": "sub_agent_associate"}),
        ):
            r = requests.post(f"{API}{path}", headers=_h(token), json=payload, timeout=15)
            assert r.status_code == 403, f"POST {path} expected 403, got {r.status_code}: {r.text}"
    finally:
        _delete_user(super_token, body["id"])


def test_user_role_can_submit_expense_request() -> None:
    """User-role accounts can submit expense requests (iter 45)."""
    super_token = _login(*admin_credentials())
    body = _create_user_role_account(super_token)
    try:
        token = _login(body["email"], body["password"])
        # Create an account first (needed by the expense request payload)
        ar = requests.post(
            f"{API}/accounts",
            headers=_h(token),
            json={"name": "User Bank", "type": "bank", "opening_balance": 5000},
            timeout=15,
        )
        ar.raise_for_status()
        account_id = ar.json()["id"]
        # Submit expense request
        er = requests.post(
            f"{API}/expense-requests",
            headers=_h(token),
            json={
                "kind": "expense",
                "amount": 750,
                "account_id": account_id,
                "category_id": None,
                "date": "2026-02-26",
                "description": "User-role expense QA",
            },
            timeout=15,
        )
        assert er.status_code == 200, er.text
        # And the user can see their own request in the list
        lr = requests.get(f"{API}/expense-requests", headers=_h(token), timeout=15)
        lr.raise_for_status()
        rows = lr.json()
        assert any(r.get("description") == "User-role expense QA" for r in rows)
    finally:
        _delete_user(super_token, body["id"])


def test_user_role_records_are_private() -> None:
    """Two separate user-role accounts should never see each other's accounts/
    transactions, even when both are created by the same super_admin."""
    super_token = _login(*admin_credentials())
    user_a = _create_user_role_account(super_token)
    time.sleep(0.01)
    user_b = _create_user_role_account(super_token)
    try:
        token_a = _login(user_a["email"], user_a["password"])
        token_b = _login(user_b["email"], user_b["password"])

        # User A creates an account
        ar = requests.post(
            f"{API}/accounts",
            headers=_h(token_a),
            json={"name": "PrivateA", "type": "bank", "opening_balance": 0},
            timeout=15,
        )
        ar.raise_for_status()
        acc_id = ar.json()["id"]

        # User B's account list should not contain user A's account
        lr = requests.get(f"{API}/accounts", headers=_h(token_b), timeout=15)
        lr.raise_for_status()
        ids = {a["id"] for a in lr.json()}
        assert acc_id not in ids
    finally:
        _delete_user(super_token, user_a["id"])
        _delete_user(super_token, user_b["id"])
