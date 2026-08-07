"""Integration tests for super-admin direct user creation."""
from __future__ import annotations

from typing import Iterator

import pytest
import requests

from _creds import admin_credentials, office_credentials, api_base


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


@pytest.fixture
def office_session() -> Iterator[requests.Session]:
    email, pwd = office_credentials()
    s = _login(email, pwd)
    yield s
    s.close()


def _cleanup(session: requests.Session) -> None:
    listing = session.get(f"{API}/users", timeout=15).json()
    for u in listing:
        if (u.get("email") or "").startswith("pytest_create_"):
            session.delete(f"{API}/users/{u['id']}", timeout=15)


@pytest.fixture(autouse=True)
def _wipe(admin_session: requests.Session) -> None:
    _cleanup(admin_session)


def test_super_admin_creates_office_admin(admin_session: requests.Session) -> None:
    r = admin_session.post(f"{API}/users", json={
        "email": "pytest_create_office@finflow.com",
        "password": "Pass@123",
        "name": "PyTest Office",
        "role": "office_admin",
        "office": "KM_BLR",
        "currency": "INR",
    }, timeout=15)
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["approval_status"] == "approved"
    assert body["role"] == "office_admin"
    assert body["office"] == "KM_BLR"
    # Default permissions = all-edit
    perms = body.get("permissions") or {}
    assert len(perms) >= 6
    assert all(v == "edit" for v in perms.values())
    assert "password_hash" not in body  # never leak the hash

    # And the user can sign in immediately.
    login = requests.post(f"{API}/auth/login", json={
        "email": "pytest_create_office@finflow.com",
        "password": "Pass@123",
    }, timeout=15)
    assert login.status_code == 200


def test_create_super_admin_role(admin_session: requests.Session) -> None:
    r = admin_session.post(f"{API}/users", json={
        "email": "pytest_create_super@finflow.com",
        "password": "Super@456",
        "name": "PyTest Super",
        "role": "super_admin",
    }, timeout=15)
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["role"] == "super_admin"
    assert body["approval_status"] == "approved"
    # Super admins do not need a per-page permissions map.
    assert body.get("office") is None


def test_duplicate_email_409(admin_session: requests.Session) -> None:
    payload = {
        "email": "pytest_create_dup@finflow.com",
        "password": "Pass@123",
        "name": "Dup1",
        "role": "office_admin",
        "office": "KM_BLR",
    }
    r1 = admin_session.post(f"{API}/users", json=payload, timeout=15)
    assert r1.status_code == 201
    r2 = admin_session.post(f"{API}/users", json={**payload, "name": "Dup2"}, timeout=15)
    assert r2.status_code == 409


def test_office_role_requires_office_field(admin_session: requests.Session) -> None:
    r = admin_session.post(f"{API}/users", json={
        "email": "pytest_create_noff@finflow.com",
        "password": "Pass@123",
        "name": "NoOffice",
        "role": "office_admin",
    }, timeout=15)
    assert r.status_code == 400


def test_office_admin_cannot_create(office_session: requests.Session) -> None:
    r = office_session.post(f"{API}/users", json={
        "email": "pytest_create_block@finflow.com",
        "password": "Pass@123",
        "name": "Blocked",
        "role": "office_admin",
        "office": "KM_BLR",
    }, timeout=15)
    assert r.status_code == 403


def test_short_password_rejected(admin_session: requests.Session) -> None:
    r = admin_session.post(f"{API}/users", json={
        "email": "pytest_create_short@finflow.com",
        "password": "abc",
        "name": "Short",
        "role": "office_admin",
        "office": "KM_BLR",
    }, timeout=15)
    assert r.status_code == 422
