"""Iteration 29: bottom-nav + sidebar permission gating for 'user' role.
Backend coverage:
  - POST /api/users with role='user' seeds USER_DEFAULT_PERMISSIONS
  - PATCH /api/users/{id}/permissions can flip individual pages
  - PATCH coerces overview='none' → 'view'
  - GET /api/auth/me as the new user reflects superadmin-set permissions
"""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
SUPER = {"email": "admin@kmfoundation.online", "password": "Admin@786"}

EXPECTED_USER_DEFAULTS = {
    "overview": "edit",
    "quick_entry": "edit",
    "transactions": "edit",
    "accounts": "edit",
    "settings": "edit",
    "expense_requests": "edit",
    "clients": "none",
    "students": "none",
}


@pytest.fixture(scope="module")
def super_client():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json=SUPER)
    assert r.status_code == 200, f"super admin login failed: {r.status_code} {r.text}"
    return s


@pytest.fixture(scope="module")
def created_user(super_client):
    email = f"nav-test-user-{int(time.time()*1000)}@example.com"
    payload = {
        "email": email,
        "password": "TestUser@123",
        "name": "Nav Test User",
        "role": "user",
        "currency": "INR",
    }
    r = super_client.post(f"{BASE_URL}/api/users", json=payload)
    assert r.status_code == 201, f"create user failed: {r.status_code} {r.text}"
    body = r.json()
    body["_password"] = payload["password"]
    yield body
    # teardown
    super_client.delete(f"{BASE_URL}/api/users/{body['id']}")


class TestUserRolePermissions:
    def test_create_user_seeds_default_permissions(self, created_user):
        perms = created_user.get("permissions")
        assert perms is not None, "permissions missing on freshly created user"
        for k, v in EXPECTED_USER_DEFAULTS.items():
            assert perms.get(k) == v, f"perm {k}: got {perms.get(k)} expected {v}"
        assert created_user["role"] == "user"
        assert created_user["approval_status"] == "approved"

    def test_patch_permissions_flips_students_to_edit(self, super_client, created_user):
        uid = created_user["id"]
        new_map = dict(EXPECTED_USER_DEFAULTS)
        new_map["students"] = "edit"
        r = super_client.patch(
            f"{BASE_URL}/api/users/{uid}/permissions",
            json={"permissions": new_map},
        )
        assert r.status_code == 200, f"patch failed: {r.status_code} {r.text}"
        assert r.json()["permissions"]["students"] == "edit"

        # GET list and verify persistence
        r2 = super_client.get(f"{BASE_URL}/api/users?status=approved")
        assert r2.status_code == 200
        found = next((u for u in r2.json() if u["id"] == uid), None)
        assert found is not None
        assert found["permissions"]["students"] == "edit"

    def test_patch_overview_none_coerced_to_view(self, super_client, created_user):
        uid = created_user["id"]
        bad_map = dict(EXPECTED_USER_DEFAULTS)
        bad_map["overview"] = "none"
        r = super_client.patch(
            f"{BASE_URL}/api/users/{uid}/permissions",
            json={"permissions": bad_map},
        )
        assert r.status_code == 200, f"patch failed: {r.status_code} {r.text}"
        assert r.json()["permissions"]["overview"] == "view", "overview=none should be coerced to view"

    def test_user_auth_me_reflects_permissions(self, super_client, created_user):
        # Re-flip students to edit (previous coerce-test reset it via the full-map PATCH)
        uid = created_user["id"]
        final_map = dict(EXPECTED_USER_DEFAULTS)
        final_map["students"] = "edit"
        rp = super_client.patch(
            f"{BASE_URL}/api/users/{uid}/permissions",
            json={"permissions": final_map},
        )
        assert rp.status_code == 200
        # Sign in as the user and verify /auth/me returns the (super-admin-set) permissions
        user_sess = requests.Session()
        r = user_sess.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": created_user["email"], "password": created_user["_password"]},
        )
        assert r.status_code == 200, f"user login failed: {r.status_code} {r.text}"
        me = user_sess.get(f"{BASE_URL}/api/auth/me")
        assert me.status_code == 200
        body = me.json()
        assert body["role"] == "user"
        perms = body.get("permissions") or {}
        # students was just flipped to "edit"
        assert perms.get("overview") == "edit"
        assert perms.get("students") == "edit"
        assert perms.get("clients") == "none"
        assert perms.get("quick_entry") == "edit"
        assert perms.get("expense_requests") == "edit"
