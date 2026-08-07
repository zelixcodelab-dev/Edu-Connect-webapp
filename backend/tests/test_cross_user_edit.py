"""Cross-user data visibility — Super Admin edits on Office Admin records.

The user's requirement: "Once super admin enter any of the updations in Our
Staffs details / student enrolment etc, [it should] reflect on office admin
dashboard also." This file pins down the contract that Super Admin can
PATCH / POST / DELETE on any office_admin-owned client (staff) or student,
and that the change persists on the original owner's books so the Office
Admin sees the update.
"""
from __future__ import annotations

import os
from typing import Optional

import requests

from tests._creds import api_base, admin_credentials, office_credentials

API = api_base()


def _login(creds: tuple[str, str]) -> str:
    email, password = creds
    r = requests.post(
        f"{API}/auth/login",
        json={"email": email, "password": password},
        timeout=15,
    )
    r.raise_for_status()
    data = r.json()
    return data.get("access_token") or data.get("token") or ""


def _h(token: str) -> dict:
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def _cleanup_client(super_token: str, client_id: Optional[str]) -> None:
    if not client_id:
        return
    try:
        requests.delete(f"{API}/clients/{client_id}", headers=_h(super_token), timeout=10)
    except requests.RequestException:
        pass


def _cleanup_student(super_token: str, student_id: Optional[str]) -> None:
    if not student_id:
        return
    try:
        requests.delete(f"{API}/students/{student_id}", headers=_h(super_token), timeout=10)
    except requests.RequestException:
        pass


def test_super_admin_can_patch_office_admins_staff() -> None:
    super_token = _login(admin_credentials())
    office_token = _login(office_credentials())

    # Office admin creates a staff member
    create = requests.post(
        f"{API}/clients", headers=_h(office_token),
        json={
            "name": "Staff X (cross-user test)",
            "client_type": "staff",
            "office": "KM_BLR",
            "eligible_incentive": 5000,
            "phone": "9988776655",
        }, timeout=15,
    )
    create.raise_for_status()
    cid = create.json()["id"]

    try:
        # Super admin PATCHes the eligible_incentive
        patch = requests.patch(
            f"{API}/clients/{cid}", headers=_h(super_token),
            json={
                "name": "Staff X (cross-user test)",
                "client_type": "staff",
                "office": "KM_BLR",
                "eligible_incentive": 8500,
                "phone": "9988776655",
            }, timeout=15,
        )
        assert patch.status_code == 200, patch.text
        assert patch.json()["eligible_incentive"] == 8500

        # Office admin reads back — should see the new value
        listing = requests.get(f"{API}/clients", headers=_h(office_token), timeout=15)
        listing.raise_for_status()
        rec = next((c for c in listing.json() if c.get("id") == cid), None)
        assert rec is not None, "Staff disappeared from office admin's view"
        assert rec.get("eligible_incentive") == 8500
    finally:
        _cleanup_client(super_token, cid)


def test_super_admin_can_patch_office_admins_student() -> None:
    super_token = _login(admin_credentials())
    office_token = _login(office_credentials())

    # Office admin creates a student
    create = requests.post(
        f"{API}/students", headers=_h(office_token),
        json={
            "name": "Stu X (cross-user)",
            "course": "BCA",
            "college": "Test College",
            "reference": "",
            "sc_out_fixed": 40000,
            "status": "enrolled",
            "enrollment_date": "2026-02-26",
        }, timeout=15,
    )
    create.raise_for_status()
    sid = create.json()["id"]

    try:
        # Super admin PATCHes the SC
        patch = requests.patch(
            f"{API}/students/{sid}", headers=_h(super_token),
            json={
                "name": "Stu X (super edited)",
                "course": "BCA",
                "college": "Test College",
                "reference": "",
                "sc_out_fixed": 60000,
                "status": "enrolled",
                "enrollment_date": "2026-02-26",
            }, timeout=15,
        )
        assert patch.status_code == 200, patch.text
        assert patch.json()["sc_out_fixed"] == 60000
        assert patch.json()["name"] == "Stu X (super edited)"

        # Office admin reads back via GET /students/{id}
        get = requests.get(f"{API}/students/{sid}", headers=_h(office_token), timeout=15)
        assert get.status_code == 200, get.text
        assert get.json()["sc_out_fixed"] == 60000
        assert get.json()["name"] == "Stu X (super edited)"
    finally:
        _cleanup_student(super_token, sid)


def test_super_admin_can_post_payment_on_office_admins_student() -> None:
    super_token = _login(admin_credentials())
    office_token = _login(office_credentials())

    # Office admin creates a student
    create = requests.post(
        f"{API}/students", headers=_h(office_token),
        json={
            "name": "Stu Y (super-pays-cross-user)",
            "course": "BCA",
            "college": "Test College",
            "reference": "",
            "sc_out_fixed": 40000,
            "status": "enrolled",
            "enrollment_date": "2026-02-26",
        }, timeout=15,
    )
    create.raise_for_status()
    sid = create.json()["id"]

    try:
        # Super admin POSTs a payment
        pay = requests.post(
            f"{API}/students/{sid}/payments", headers=_h(super_token),
            json={
                "date": "2026-02-26",
                "amount": 15000,
                "fee_type": "booking_admission",
                "received_in": {"type": "cash"},
                "remarks": "Logged by super admin",
            }, timeout=15,
        )
        assert pay.status_code == 200, pay.text
        assert pay.json()["collected_total"] == 15000
        assert len(pay.json()["payments"]) == 1

        # Office admin reads back and sees the payment
        get = requests.get(f"{API}/students/{sid}", headers=_h(office_token), timeout=15)
        assert get.status_code == 200, get.text
        assert get.json()["collected_total"] == 15000
        assert any(p.get("remarks", "").startswith("Logged by super admin") for p in get.json()["payments"])
    finally:
        _cleanup_student(super_token, sid)


def test_office_admin_cannot_patch_super_admins_client() -> None:
    """Defense-in-depth: office admins still scoped to their own records."""
    super_token = _login(admin_credentials())
    office_token = _login(office_credentials())

    # Super admin creates a non-staff client
    create = requests.post(
        f"{API}/clients", headers=_h(super_token),
        json={
            "name": "Super-owned (cross-test)",
            "client_type": "sub_agent_associate",
            "phone": "9911223344",
        }, timeout=15,
    )
    create.raise_for_status()
    cid = create.json()["id"]

    try:
        patch = requests.patch(
            f"{API}/clients/{cid}", headers=_h(office_token),
            json={
                "name": "Should-not-rename",
                "client_type": "sub_agent_associate",
                "phone": "9911223344",
            }, timeout=15,
        )
        assert patch.status_code == 404, patch.text  # Office admin can't see it
    finally:
        _cleanup_client(super_token, cid)
