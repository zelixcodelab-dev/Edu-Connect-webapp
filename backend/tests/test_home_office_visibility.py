"""Tests for the home_office cross-user visibility model (iteration 37).

Rules being validated:
- Super admin creates a Student / Client → if home_office=KM_BLR / KM_TCR /
  KM_KMLY, Office Admins of that office can see + edit it.
- home_office=ALL makes the record visible to every office_admin.
- home_office=null keeps the record private to the super_admin who owns it.
- Office Admin's home_office is always forced server-side to their own office,
  no matter what they POST.
"""
from __future__ import annotations

import os
from typing import Optional

import requests

from tests._creds import api_base, admin_credentials, office_credentials

API = api_base()


def _login(email: str, password: str) -> str:
    r = requests.post(
        f"{API}/auth/login",
        json={"email": email, "password": password},
        timeout=15,
    )
    r.raise_for_status()
    body = r.json()
    return body.get("access_token") or body.get("token") or ""


def _h(t: str) -> dict:
    return {"Authorization": f"Bearer {t}", "Content-Type": "application/json"}


def _cleanup_student(token: str, sid: Optional[str]) -> None:
    if not sid:
        return
    try:
        requests.delete(f"{API}/students/{sid}", headers=_h(token), timeout=10)
    except requests.RequestException:
        pass


def _cleanup_client(token: str, cid: Optional[str]) -> None:
    if not cid:
        return
    try:
        requests.delete(f"{API}/clients/{cid}", headers=_h(token), timeout=10)
    except requests.RequestException:
        pass


def test_super_admin_blr_student_visible_to_blr_office() -> None:
    """A student tagged home_office=KM_BLR by Super Admin must appear in the
    BLR Office Admin's GET /api/students list."""
    super_token = _login(*admin_credentials())
    office_token = _login(*office_credentials())

    sr = requests.post(
        f"{API}/students",
        headers=_h(super_token),
        json={
            "name": "Cross-Office QA Student",
            "course": "BBA",
            "college": "QA College",
            "status": "enrolled",
            "sc_out_fixed": 5000,
            "home_office": "KM_BLR",
        },
        timeout=15,
    )
    sr.raise_for_status()
    sid = sr.json()["id"]
    try:
        # BLR office admin should see it.
        lr = requests.get(f"{API}/students", headers=_h(office_token), timeout=15)
        lr.raise_for_status()
        ids = {s["id"] for s in lr.json()}
        assert sid in ids, f"BLR office admin should see KM_BLR-scoped student {sid}"

        # BLR office admin should also be able to fetch & edit it.
        gr = requests.get(f"{API}/students/{sid}", headers=_h(office_token), timeout=15)
        assert gr.status_code == 200, gr.text
    finally:
        _cleanup_student(super_token, sid)


def test_super_admin_private_student_invisible_to_office() -> None:
    """A student left without a home_office stays private to the super admin."""
    super_token = _login(*admin_credentials())
    office_token = _login(*office_credentials())

    sr = requests.post(
        f"{API}/students",
        headers=_h(super_token),
        json={
            "name": "Private QA Student",
            "course": "BBA",
            "college": "QA College",
            "status": "inquiry",
            "sc_out_fixed": 0,
        },
        timeout=15,
    )
    sr.raise_for_status()
    sid = sr.json()["id"]
    try:
        lr = requests.get(f"{API}/students", headers=_h(office_token), timeout=15)
        lr.raise_for_status()
        ids = {s["id"] for s in lr.json()}
        assert sid not in ids, "Private student must not surface to office admin"
        gr = requests.get(f"{API}/students/{sid}", headers=_h(office_token), timeout=15)
        assert gr.status_code == 404, gr.text
    finally:
        _cleanup_student(super_token, sid)


def test_super_admin_all_scope_visible_to_office() -> None:
    """home_office=ALL → visible to every office admin."""
    super_token = _login(*admin_credentials())
    office_token = _login(*office_credentials())

    sr = requests.post(
        f"{API}/students",
        headers=_h(super_token),
        json={
            "name": "Shared QA Student",
            "course": "B.Com",
            "college": "QA College",
            "status": "inquiry",
            "sc_out_fixed": 0,
            "home_office": "ALL",
        },
        timeout=15,
    )
    sr.raise_for_status()
    sid = sr.json()["id"]
    try:
        lr = requests.get(f"{API}/students", headers=_h(office_token), timeout=15)
        lr.raise_for_status()
        ids = {s["id"] for s in lr.json()}
        assert sid in ids
    finally:
        _cleanup_student(super_token, sid)


def test_office_admin_create_forces_home_office() -> None:
    """Even if the office admin tries to POST home_office=ALL, the server forces
    it back to their own office so they can't widen their own scope."""
    office_token = _login(*office_credentials())

    sr = requests.post(
        f"{API}/students",
        headers=_h(office_token),
        json={
            "name": "Office Scope Forced QA",
            "course": "B.Com",
            "college": "QA College",
            "status": "inquiry",
            "sc_out_fixed": 0,
            "home_office": "ALL",  # should be ignored
        },
        timeout=15,
    )
    sr.raise_for_status()
    sid = sr.json()["id"]
    try:
        # Super admin fetches the raw record and confirms home_office==KM_BLR
        super_token = _login(*admin_credentials())
        gr = requests.get(f"{API}/students/{sid}", headers=_h(super_token), timeout=15)
        gr.raise_for_status()
        body = gr.json()
        assert body.get("home_office") == "KM_BLR", body
    finally:
        _cleanup_student(_login(*admin_credentials()), sid)


def test_client_scoped_to_office_visible() -> None:
    """A client (sub-agent) created by super_admin with home_office=KM_BLR
    appears on the BLR office admin's /api/clients list."""
    super_token = _login(*admin_credentials())
    office_token = _login(*office_credentials())

    cr = requests.post(
        f"{API}/clients",
        headers=_h(super_token),
        json={
            "name": "Shared SubAgent QA",
            "client_type": "sub_agent_associate",
            "home_office": "KM_BLR",
        },
        timeout=15,
    )
    cr.raise_for_status()
    cid = cr.json()["id"]
    try:
        lr = requests.get(f"{API}/clients", headers=_h(office_token), timeout=15)
        lr.raise_for_status()
        ids = {c["id"] for c in lr.json()}
        assert cid in ids
    finally:
        _cleanup_client(super_token, cid)
