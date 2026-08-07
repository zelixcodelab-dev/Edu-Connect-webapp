"""Test the lightweight /api/users/super-admins picker endpoint used by the
Messages reminder composer for non-super-admin senders."""
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
        if (u.get("email") or "").startswith("pytest_picker_"):
            session.delete(f"{API}/users/{u['id']}", timeout=15)


@pytest.fixture(autouse=True)
def _wipe(admin_session: requests.Session) -> None:
    _cleanup(admin_session)


def test_super_admins_picker_visible_to_office_admin(admin_session: requests.Session) -> None:
    """An office admin should be able to call /api/users/super-admins and see
    every approved super_admin (their own row excluded — but they're not a
    super_admin so the full list comes back)."""
    pwd = generate_test_password("Pk1")
    off = admin_session.post(
        f"{API}/users",
        json={"email": "pytest_picker_office@example.com", "password": pwd, "name": "Pytest Picker Office",
              "role": "office_admin", "office": "KM_BLR"},
        timeout=15,
    ).json()
    office = _login(off["email"], pwd)
    r = office.get(f"{API}/users/super-admins", timeout=15)
    assert r.status_code == 200, r.text
    items = r.json()
    # Must include at least one approved super_admin (the seed admin)
    assert len(items) >= 1
    # All entries must be super_admins
    assert all(u["role"] == "super_admin" for u in items)
    # The office admin's own id must not appear
    assert all(u["id"] != off["id"] for u in items)
    # Returned payload must NOT leak sensitive fields
    for u in items:
        assert set(u.keys()) <= {"id", "name", "email", "role"}
    office.close()


def test_super_admins_picker_visible_to_user_role(admin_session: requests.Session) -> None:
    """A linked sub-agent user account can also call the picker."""
    cli = admin_session.post(
        f"{API}/clients",
        json={"name": "Pytest Picker Client", "client_type": "sub_agent_associate", "phone": "9999000099"},
        timeout=15,
    ).json()
    pwd = generate_test_password("Pk2")
    usr = admin_session.post(
        f"{API}/users",
        json={"email": "pytest_picker_user@example.com", "password": pwd, "name": "Pytest Picker User",
              "role": "user", "linked_client_id": cli["id"]},
        timeout=15,
    ).json()
    u_sess = _login(usr["email"], pwd)
    items = u_sess.get(f"{API}/users/super-admins", timeout=15).json()
    assert len(items) >= 1
    assert all(u["role"] == "super_admin" for u in items)
    u_sess.close()
    # cleanup the client too
    admin_session.delete(f"{API}/clients/{cli['id']}", timeout=15)


def test_super_admins_picker_excludes_self_for_super_admin(admin_session: requests.Session) -> None:
    """A super_admin calling the picker should not see themselves."""
    me_id = admin_session.get(f"{API}/auth/me", timeout=15).json()["id"]
    items = admin_session.get(f"{API}/users/super-admins", timeout=15).json()
    assert all(u["id"] != me_id for u in items), items
