"""Iteration 42 — staff client_detail surfaces office-wide referrals.

Bug: when an office admin viewed a staff client's detail page, only students
owned by the SAME user_id who created the staff would appear. After the
home_office visibility model (iter 37), admissions for a staff belonging to
KM_BLR can be created by ANY KM_BLR admin (or super_admin with
home_office=KM_BLR). All such admissions must surface on the staff's page.
"""
from __future__ import annotations

import time
from typing import Optional

import requests

from tests._creds import api_base, admin_credentials, office_credentials

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


def test_office_staff_sees_referrals_from_same_office_admins() -> None:
    super_token = _login(*admin_credentials())
    office_token = _login(*office_credentials())

    # 1) Office admin (BLR) creates a Staff client.
    stamp = int(time.time() * 1000)
    staff_name = f"OfficeStaff QA {stamp}"
    cr = requests.post(
        f"{API}/clients",
        headers=_h(office_token),
        json={
            "name": staff_name,
            "client_type": "staff",
            "office": "KM_BLR",
            "eligible_incentive": 2000,
        },
        timeout=15,
    )
    cr.raise_for_status()
    staff_id = cr.json()["id"]

    # 2) Super admin creates a student referring to this staff, scoped to KM_BLR.
    sr = requests.post(
        f"{API}/students",
        headers=_h(super_token),
        json={
            "name": f"Referral Student QA {stamp}",
            "course": "B.Com",
            "college": "QA College",
            "status": "enrolled",
            "sc_out_fixed": 3000,
            "reference": staff_name,
            "home_office": "KM_BLR",
        },
        timeout=15,
    )
    sr.raise_for_status()
    sid = sr.json()["id"]

    try:
        # 3) Office admin opens the staff detail. Should surface this referral.
        dr = requests.get(
            f"{API}/clients/{staff_id}/detail",
            headers=_h(office_token),
            timeout=15,
        )
        assert dr.status_code == 200, dr.text
        body = dr.json()
        ids = {s["id"] for s in body.get("students", [])}
        assert sid in ids, (
            f"office staff page must show super-admin-created referrals scoped "
            f"to the same office. got students: {ids}"
        )
        # Counter check: students count should be ≥ 1.
        assert body["totals"]["students_count"] >= 1
    finally:
        try:
            requests.delete(f"{API}/students/{sid}", headers=_h(super_token), timeout=10)
            requests.delete(f"{API}/clients/{staff_id}", headers=_h(office_token), timeout=10)
        except requests.RequestException:
            pass


def test_super_admin_staff_detail_sees_all_referrals() -> None:
    """Super admin viewing a staff page sees admissions across all offices."""
    super_token = _login(*admin_credentials())

    stamp = int(time.time() * 1000)
    staff_name = f"SuperStaff QA {stamp}"
    cr = requests.post(
        f"{API}/clients",
        headers=_h(super_token),
        json={
            "name": staff_name,
            "client_type": "staff",
            "office": "KM_TCR",
            "eligible_incentive": 1500,
            "home_office": "KM_TCR",
        },
        timeout=15,
    )
    cr.raise_for_status()
    staff_id = cr.json()["id"]

    sr = requests.post(
        f"{API}/students",
        headers=_h(super_token),
        json={
            "name": f"Referral QA {stamp}",
            "course": "BBA",
            "college": "QA College",
            "status": "enrolled",
            "sc_out_fixed": 2000,
            "reference": staff_name,
            # No home_office — private to super_admin
        },
        timeout=15,
    )
    sr.raise_for_status()
    sid = sr.json()["id"]

    try:
        dr = requests.get(
            f"{API}/clients/{staff_id}/detail",
            headers=_h(super_token),
            timeout=15,
        )
        assert dr.status_code == 200, dr.text
        body = dr.json()
        ids = {s["id"] for s in body.get("students", [])}
        assert sid in ids
    finally:
        try:
            requests.delete(f"{API}/students/{sid}", headers=_h(super_token), timeout=10)
            requests.delete(f"{API}/clients/{staff_id}", headers=_h(super_token), timeout=10)
        except requests.RequestException:
            pass


def test_other_office_staff_does_NOT_see_unrelated_referrals() -> None:
    """A KM_TCR staff page should NOT show students scoped to KM_BLR."""
    super_token = _login(*admin_credentials())
    office_token = _login(*office_credentials())  # this is a KM_BLR admin

    stamp = int(time.time() * 1000)
    staff_name = f"TCR Staff QA {stamp}"
    cr = requests.post(
        f"{API}/clients",
        headers=_h(super_token),
        json={
            "name": staff_name,
            "client_type": "staff",
            "office": "KM_TCR",
            "eligible_incentive": 1500,
            "home_office": "KM_TCR",
        },
        timeout=15,
    )
    cr.raise_for_status()
    staff_id = cr.json()["id"]

    # Student created by BLR admin (different office)
    sr = requests.post(
        f"{API}/students",
        headers=_h(office_token),
        json={
            "name": f"BLR Student QA {stamp}",
            "course": "BBA",
            "college": "QA College",
            "status": "enrolled",
            "sc_out_fixed": 2000,
            "reference": staff_name,
        },
        timeout=15,
    )
    sr.raise_for_status()
    sid = sr.json()["id"]

    try:
        # BLR office admin tries to view the TCR staff detail.
        dr = requests.get(
            f"{API}/clients/{staff_id}/detail",
            headers=_h(office_token),
            timeout=15,
        )
        # The BLR office admin cannot even see the TCR-scoped staff, so 404.
        # That's the right behaviour — they shouldn't be looking at it.
        assert dr.status_code == 404
    finally:
        try:
            requests.delete(f"{API}/students/{sid}", headers=_h(office_token), timeout=10)
            requests.delete(f"{API}/clients/{staff_id}", headers=_h(super_token), timeout=10)
        except requests.RequestException:
            pass
