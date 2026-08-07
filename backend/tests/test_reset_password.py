"""Tests for the Super Admin "Reset another user's password" endpoint
(iteration 38).

POST /api/users/{user_id}/reset-password — super_admin only, accepts
{new_password}. Target user can sign in with the new password immediately.
"""
from __future__ import annotations

import time
from typing import Optional

import requests

from tests._creds import api_base, admin_credentials, office_credentials, generate_test_password

API = api_base()


def _login(email: str, password: str) -> Optional[str]:
    r = requests.post(
        f"{API}/auth/login",
        json={"email": email, "password": password},
        timeout=15,
    )
    if r.status_code != 200:
        return None
    body = r.json()
    return body.get("access_token") or body.get("token") or ""


def _h(t: str) -> dict:
    return {"Authorization": f"Bearer {t}", "Content-Type": "application/json"}


def _create_target_user(super_token: str) -> dict:
    """Create a throwaway office_admin user. Returns the new user dict
    (with embedded 'email' + the 'password' we used)."""
    email = f"pwd_reset_qa_{int(time.time() * 1000)}@example.com"
    password = generate_test_password("InitPwd")
    r = requests.post(
        f"{API}/users",
        headers=_h(super_token),
        json={
            "email": email,
            "password": password,
            "name": "Reset QA",
            "role": "office_admin",
            "office": "KM_BLR",
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


def test_super_admin_resets_password_target_can_login() -> None:
    super_token = _login(*admin_credentials())
    target = _create_target_user(super_token)
    try:
        new_password = generate_test_password("BrandNew")
        r = requests.post(
            f"{API}/users/{target['id']}/reset-password",
            headers=_h(super_token),
            json={"new_password": new_password},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        # Old password no longer works.
        assert _login(target["email"], target["password"]) is None
        # New password works.
        assert _login(target["email"], new_password) is not None
    finally:
        _delete_user(super_token, target["id"])


def test_reset_password_min_length_enforced() -> None:
    super_token = _login(*admin_credentials())
    target = _create_target_user(super_token)
    try:
        r = requests.post(
            f"{API}/users/{target['id']}/reset-password",
            headers=_h(super_token),
            json={"new_password": "short"},  # < 8
            timeout=15,
        )
        assert r.status_code == 422, r.text
    finally:
        _delete_user(super_token, target["id"])


def test_office_admin_cannot_reset_others() -> None:
    super_token = _login(*admin_credentials())
    office_token = _login(*office_credentials())
    target = _create_target_user(super_token)
    try:
        r = requests.post(
            f"{API}/users/{target['id']}/reset-password",
            headers=_h(office_token),
            json={"new_password": generate_test_password("AnotherPwd")},
            timeout=15,
        )
        assert r.status_code == 403, r.text
    finally:
        _delete_user(super_token, target["id"])


def test_reset_password_unknown_user_404() -> None:
    super_token = _login(*admin_credentials())
    r = requests.post(
        f"{API}/users/nope-no-such-id/reset-password",
        headers=_h(super_token),
        json={"new_password": generate_test_password("DoesntMatter")},
        timeout=15,
    )
    assert r.status_code == 404, r.text


def test_reset_clears_brute_force_lockout() -> None:
    """If the target user has been locked out (too many failed logins), a
    super-admin password reset should also clear the lockout so they can
    sign in right away with the new password."""
    super_token = _login(*admin_credentials())
    target = _create_target_user(super_token)
    try:
        # Trigger several failed logins to lock the account.
        for _ in range(6):
            requests.post(
                f"{API}/auth/login",
                json={"email": target["email"], "password": "wrong-on-purpose"},
                timeout=10,
            )
        fresh_password = generate_test_password("FreshStart")
        # Reset password.
        r = requests.post(
            f"{API}/users/{target['id']}/reset-password",
            headers=_h(super_token),
            json={"new_password": fresh_password},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        # New password should work immediately — no lockout in the way.
        token = _login(target["email"], fresh_password)
        assert token is not None
    finally:
        _delete_user(super_token, target["id"])
