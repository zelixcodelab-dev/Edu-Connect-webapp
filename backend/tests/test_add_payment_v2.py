"""Tests for the new "Add Payment" dialog logic (iteration 36):

- Fee Type catalogue updated to:
    application_fees / registration_fees / admission_fees /
    tuition_fees / uniform_fees / other_fees / sc_adjusted

- For fee_type=sc_adjusted, the client must store a real income
  transaction on a designated default account, and the received_in
  carries client_id pointing back to a Sub-Agent / Consultant / KM Office
  client.

Pre-existing payment auto-log behaviour for the new account-based fee
types is also re-verified.
"""
from __future__ import annotations

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


def _cleanup(token: str, student_id: Optional[str], client_id: Optional[str]) -> None:
    if student_id:
        try:
            requests.delete(f"{API}/students/{student_id}", headers=_h(token), timeout=10)
        except requests.RequestException:
            pass
    if client_id:
        try:
            requests.delete(f"{API}/clients/{client_id}", headers=_h(token), timeout=10)
        except requests.RequestException:
            pass


def test_new_fee_types_accepted() -> None:
    """Each new fee_type value (admission_fees / tuition_fees / etc.) is a
    valid Literal — the POST should not 422 on the new keys."""
    token = _login()
    sr = requests.post(
        f"{API}/students",
        headers=_h(token),
        json={"name": "FeeType QA", "course": "B.Com", "college": "Test", "status": "enrolled", "sc_out_fixed": 5000},
        timeout=15,
    )
    sr.raise_for_status()
    sid = sr.json()["id"]
    try:
        for ft in (
            "application_fees", "registration_fees", "admission_fees",
            "tuition_fees", "uniform_fees", "other_fees",
        ):
            pr = requests.post(
                f"{API}/students/{sid}/payments",
                headers=_h(token),
                json={
                    "date": "2026-02-20",
                    "amount": 1000,
                    "fee_type": ft,
                    "received_in": {"type": "cash"},
                },
                timeout=15,
            )
            assert pr.status_code == 200, f"fee_type={ft!r} failed: {pr.status_code} {pr.text}"
            body = pr.json()
            # Latest payment is the one we just posted; assert fee_type roundtripped.
            assert any(p.get("fee_type") == ft for p in body.get("payments", [])), \
                f"fee_type={ft!r} not persisted: {body.get('payments')}"
    finally:
        _cleanup(token, sid, None)


def test_sc_adjusted_payment_creates_income_tx_on_default_account() -> None:
    """When fee_type=sc_adjusted, the backend auto-logs an income transaction
    on a default (cash → bank → any) account even though the dialog never
    supplied an account_id."""
    token = _login()

    # Create the sub-agent client (needed for received_in.client_id).
    cr = requests.post(
        f"{API}/clients",
        headers=_h(token),
        json={"name": "SC-Adjusted SubAgent QA", "client_type": "sub_agent_associate"},
        timeout=15,
    )
    cr.raise_for_status()
    cid = cr.json()["id"]

    sr = requests.post(
        f"{API}/students",
        headers=_h(token),
        json={"name": "SC Adjusted QA", "course": "BBA", "college": "Test", "status": "enrolled", "sc_out_fixed": 8000},
        timeout=15,
    )
    sr.raise_for_status()
    sid = sr.json()["id"]
    try:
        pr = requests.post(
            f"{API}/students/{sid}/payments",
            headers=_h(token),
            json={
                "date": "2026-02-20",
                "amount": 3000,
                "fee_type": "sc_adjusted",
                "received_in": {
                    "type": "sub_agent",
                    "name": "SC-Adjusted SubAgent QA",
                    "client_id": cid,
                },
            },
            timeout=15,
        )
        assert pr.status_code == 200, pr.text
        body = pr.json()
        payment = next((p for p in body.get("payments", []) if p.get("fee_type") == "sc_adjusted"), None)
        assert payment is not None, body
        assert payment["received_in"]["client_id"] == cid
        assert payment["received_in"]["name"] == "SC-Adjusted SubAgent QA"

        # An income transaction should exist linked to this payment id.
        tx_resp = requests.get(f"{API}/transactions?limit=200", headers=_h(token), timeout=15)
        tx_resp.raise_for_status()
        txs = tx_resp.json()
        linked = [t for t in txs if t.get("linked_student_payment_id") == payment["id"]]
        assert len(linked) == 1, f"expected 1 auto-logged tx, got {len(linked)}: {linked}"
        tx = linked[0]
        assert tx["type"] == "income"
        assert abs(tx["amount"] - 3000.0) < 0.01
        assert tx.get("account_id"), "tx must be posted to some account"
    finally:
        _cleanup(token, sid, cid)


def test_sc_adjusted_payment_routes_through_agent_ledger() -> None:
    """SC Adjusted entries set received_in.type ∈ {sub_agent|associate|km}
    and the agent-ledger aggregation includes them."""
    token = _login()

    cr = requests.post(
        f"{API}/clients",
        headers=_h(token),
        json={"name": "Ledger Sub QA", "client_type": "sub_agent_associate"},
        timeout=15,
    )
    cr.raise_for_status()
    cid = cr.json()["id"]

    sr = requests.post(
        f"{API}/students",
        headers=_h(token),
        json={"name": "Ledger QA", "course": "BBA", "college": "T", "status": "enrolled", "sc_out_fixed": 5000},
        timeout=15,
    )
    sr.raise_for_status()
    sid = sr.json()["id"]
    try:
        pr = requests.post(
            f"{API}/students/{sid}/payments",
            headers=_h(token),
            json={
                "date": "2026-02-20",
                "amount": 1500,
                "fee_type": "sc_adjusted",
                "received_in": {
                    "type": "sub_agent",
                    "name": "Ledger Sub QA",
                    "client_id": cid,
                },
            },
            timeout=15,
        )
        assert pr.status_code == 200, pr.text

        lr = requests.get(
            f"{API}/students/agent-ledger/payments?type=sub_agent&name=Ledger%20Sub%20QA",
            headers=_h(token),
            timeout=15,
        )
        assert lr.status_code == 200, lr.text
        body = lr.json()
        assert body["totals"]["payments_count"] >= 1
        assert any(row["amount"] == 1500 for row in body.get("payments", []))
    finally:
        _cleanup(token, sid, cid)
