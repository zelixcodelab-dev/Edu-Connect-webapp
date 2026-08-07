"""Iteration 40 — adjustment kinds redesign.

The Add Payment dialog now models adjustments as one of three "destinations":
  KM Foundation       → backend kind="internal_credit", account_id set
  Sub Agent           → backend kind="sc_adjusted", sub_agent_type="sub_agent"
  Associate Consultant → backend kind="sc_adjusted", sub_agent_type="associate"

Tests assert: (a) internal_credit auto-logs a real income transaction on the
picked account; (b) sc_adjusted with a sub-agent shows up in the agent
ledger; (c) the legacy `paid_to_college` kind still deserialises.
"""
from __future__ import annotations

import time
from typing import Optional

import requests

from tests._creds import api_base, admin_credentials

API = api_base()


def _login() -> str:
    email, password = admin_credentials()
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=15)
    r.raise_for_status()
    return r.json().get("access_token") or r.json().get("token") or ""


def _h(t: str) -> dict:
    return {"Authorization": f"Bearer {t}", "Content-Type": "application/json"}


def _resolve_default_account(token: str) -> Optional[str]:
    r = requests.get(f"{API}/accounts", headers=_h(token), timeout=15)
    r.raise_for_status()
    accs = r.json()
    if not accs:
        return None
    # Prefer cash, then bank, then anything
    for atype in ("cash", "bank"):
        for a in accs:
            if a.get("type") == atype:
                return a["id"]
    return accs[0]["id"]


def test_internal_credit_adjustment_auto_logs_income() -> None:
    token = _login()
    account_id = _resolve_default_account(token)
    assert account_id, "Need at least one account to run this test."

    sr = requests.post(
        f"{API}/students",
        headers=_h(token),
        json={
            "name": "Internal Credit QA",
            "course": "BBA",
            "college": "QA College",
            "status": "enrolled",
            "sc_out_fixed": 10000,
        },
        timeout=15,
    )
    sr.raise_for_status()
    sid = sr.json()["id"]
    try:
        pr = requests.post(
            f"{API}/students/{sid}/payments",
            headers=_h(token),
            json={
                "date": "2026-02-26",
                "amount": 5000,
                "fee_type": "tuition_fees",
                "received_in": {"type": "college"},
                "has_adjustment": True,
                "adjustments": [{
                    "kind": "internal_credit",
                    "amount": 2000,
                    "payment_date": "2026-02-26",
                    "payment_mode": "bank_transfer",
                    "account_id": account_id,
                }],
            },
            timeout=15,
        )
        assert pr.status_code == 200, pr.text
        body = pr.json()
        payment = next((p for p in body.get("payments", []) if p.get("amount") == 5000), None)
        assert payment is not None
        assert payment["adjustments"][0]["kind"] == "internal_credit"
        assert payment["adjustments"][0]["account_id"] == account_id

        # An income tx must exist for the adjustment on the picked account.
        txr = requests.get(f"{API}/transactions?limit=200", headers=_h(token), timeout=15)
        txr.raise_for_status()
        linked = [
            t for t in txr.json()
            if t.get("linked_student_payment_id") == payment["id"]
            and abs(float(t.get("amount") or 0) - 2000.0) < 0.01
            and t.get("account_id") == account_id
        ]
        assert len(linked) == 1, f"expected 1 adjustment income tx, got {len(linked)}"
    finally:
        try:
            requests.delete(f"{API}/students/{sid}", headers=_h(token), timeout=10)
        except requests.RequestException:
            pass


def test_sc_adjusted_via_subagent_client_routes_to_ledger() -> None:
    token = _login()
    # Create a sub-agent client
    cr = requests.post(
        f"{API}/clients",
        headers=_h(token),
        json={"name": f"Ledger SubA {int(time.time()*1000)}", "client_type": "sub_agent_associate"},
        timeout=15,
    )
    cr.raise_for_status()
    cid = cr.json()["id"]
    cname = cr.json()["name"]

    sr = requests.post(
        f"{API}/students",
        headers=_h(token),
        json={
            "name": "Adj SC QA",
            "course": "BBA",
            "college": "QA College",
            "status": "enrolled",
            "sc_out_fixed": 8000,
        },
        timeout=15,
    )
    sr.raise_for_status()
    sid = sr.json()["id"]
    try:
        pr = requests.post(
            f"{API}/students/{sid}/payments",
            headers=_h(token),
            json={
                "date": "2026-02-26",
                "amount": 3000,
                "fee_type": "tuition_fees",
                "received_in": {"type": "college"},
                "has_adjustment": True,
                "adjustments": [{
                    "kind": "sc_adjusted",
                    "amount": 1000,
                    "payment_date": "2026-02-26",
                    "payment_mode": "bank_transfer",
                    "sub_agent_type": "sub_agent",
                    "sub_agent_name": cname,
                    "client_id": cid,
                }],
            },
            timeout=15,
        )
        assert pr.status_code == 200, pr.text

        # Lookup agent-ledger
        lr = requests.get(f"{API}/students/agent-ledger", headers=_h(token), timeout=15)
        assert lr.status_code == 200
        rows = lr.json()
        match = [r for r in rows if r.get("name") == cname and r.get("type") == "sub_agent"]
        assert match, f"Sub-agent {cname} should appear in agent ledger"
    finally:
        try:
            requests.delete(f"{API}/students/{sid}", headers=_h(token), timeout=10)
            requests.delete(f"{API}/clients/{cid}", headers=_h(token), timeout=10)
        except requests.RequestException:
            pass


def test_legacy_paid_to_college_still_accepted() -> None:
    """Records created before iter 40 carry kind="paid_to_college" — these
    must still deserialize and POST without error."""
    token = _login()
    sr = requests.post(
        f"{API}/students",
        headers=_h(token),
        json={
            "name": "Legacy Adj QA",
            "course": "BBA",
            "college": "QA College",
            "status": "enrolled",
            "sc_out_fixed": 5000,
        },
        timeout=15,
    )
    sr.raise_for_status()
    sid = sr.json()["id"]
    try:
        pr = requests.post(
            f"{API}/students/{sid}/payments",
            headers=_h(token),
            json={
                "date": "2026-02-26",
                "amount": 2000,
                "fee_type": "tuition_fees",
                "received_in": {"type": "college"},
                "has_adjustment": True,
                "adjustments": [{
                    "kind": "paid_to_college",
                    "amount": 800,
                    "payment_date": "2026-02-26",
                    "payment_mode": "bank_transfer",
                }],
            },
            timeout=15,
        )
        assert pr.status_code == 200, pr.text
        body = pr.json()
        payment = next((p for p in body.get("payments", []) if p.get("amount") == 2000), None)
        assert payment["adjustments"][0]["kind"] == "paid_to_college"
    finally:
        try:
            requests.delete(f"{API}/students/{sid}", headers=_h(token), timeout=10)
        except requests.RequestException:
            pass
