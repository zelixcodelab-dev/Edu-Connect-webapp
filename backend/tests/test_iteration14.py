"""Iteration 14 — per-page permissions feature.

Covers:
- PATCH /api/users/{id}/permissions (super_admin only, 403/400/200 paths)
- /auth/me + /auth/login include `permissions` field
- require_edit dependency enforces 403 on POST/PATCH/DELETE for view/none
- GET endpoints remain open
- Default permissions seeding on register / approve
- Test cleans up by restoring blr1 to all-edit at teardown.
"""
import os
import time
import requests
import pytest
from pathlib import Path

# Load REACT_APP_BACKEND_URL from frontend/.env
_env = Path(__file__).resolve().parents[2] / "frontend" / ".env"
for line in _env.read_text().splitlines():
    if line.startswith("REACT_APP_BACKEND_URL="):
        os.environ.setdefault("REACT_APP_BACKEND_URL", line.split("=", 1)[1].strip())

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
SA_EMAIL, SA_PASS = "admin@finflow.com", "Admin@123"
OA_EMAIL, OA_PASS = "blr1@finflow.com", "Office@123"

ALL_EDIT = {p: "edit" for p in (
    "overview", "quick_entry", "transactions", "clients",
    "students", "expense_requests", "settings",
)}


def _login(email, password):
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, f"login {email}: {r.status_code} {r.text}"
    return s, r.json()


@pytest.fixture(scope="module")
def sa_session():
    s, me = _login(SA_EMAIL, SA_PASS)
    return s, me


@pytest.fixture(scope="module")
def oa_user_id(sa_session):
    s, _ = sa_session
    r = s.get(f"{BASE_URL}/api/users?status=approved")
    assert r.status_code == 200
    for u in r.json():
        if u["email"] == OA_EMAIL:
            return u["id"]
    pytest.skip("blr1 user not present")


@pytest.fixture(scope="module", autouse=True)
def restore_permissions_after(sa_session, oa_user_id):
    yield
    s, _ = sa_session
    s.patch(f"{BASE_URL}/api/users/{oa_user_id}/permissions", json={"permissions": ALL_EDIT})


def _set_perms(sa, user_id, perms):
    full = {**ALL_EDIT, **perms}
    r = sa.patch(f"{BASE_URL}/api/users/{user_id}/permissions", json={"permissions": full})
    assert r.status_code == 200, r.text
    return r.json()


# ---------------- Login / me include permissions ----------------
def test_login_response_includes_permissions(sa_session):
    s, me = _login(OA_EMAIL, OA_PASS)
    assert "permissions" in me and isinstance(me["permissions"], dict)
    for k in ALL_EDIT:
        assert k in me["permissions"], f"missing perm key {k}"


def test_me_includes_permissions(sa_session):
    s, _ = _login(OA_EMAIL, OA_PASS)
    r = s.get(f"{BASE_URL}/api/auth/me")
    assert r.status_code == 200
    body = r.json()
    assert "permissions" in body
    assert set(body["permissions"].keys()) >= set(ALL_EDIT.keys())


# ---------------- Super-admin only on PATCH /permissions ----------------
def test_office_admin_cannot_patch_permissions(sa_session, oa_user_id):
    oa, _ = _login(OA_EMAIL, OA_PASS)
    r = oa.patch(f"{BASE_URL}/api/users/{oa_user_id}/permissions",
                 json={"permissions": ALL_EDIT})
    assert r.status_code == 403


def test_cannot_change_super_admin_permissions(sa_session):
    s, me = sa_session
    r = s.patch(f"{BASE_URL}/api/users/{me['id']}/permissions",
                json={"permissions": ALL_EDIT})
    assert r.status_code == 400


def test_invalid_level_returns_400(sa_session, oa_user_id):
    s, _ = sa_session
    bad = dict(ALL_EDIT)
    bad["students"] = "writeonly"
    r = s.patch(f"{BASE_URL}/api/users/{oa_user_id}/permissions",
                json={"permissions": bad})
    assert r.status_code == 400


def test_patch_permissions_persists(sa_session, oa_user_id):
    s, _ = sa_session
    body = _set_perms(s, oa_user_id, {"students": "view", "clients": "none"})
    assert body["permissions"]["students"] == "view"
    assert body["permissions"]["clients"] == "none"
    # Verify via /auth/me on new oa login
    oa, me = _login(OA_EMAIL, OA_PASS)
    assert me["permissions"]["students"] == "view"
    assert me["permissions"]["clients"] == "none"
    # Restore for downstream tests
    _set_perms(s, oa_user_id, ALL_EDIT)


# ---------------- require_edit enforcement ----------------
def test_students_view_blocks_post_allows_get(sa_session, oa_user_id):
    sa, _ = sa_session
    _set_perms(sa, oa_user_id, {"students": "view"})
    oa, _ = _login(OA_EMAIL, OA_PASS)
    r_get = oa.get(f"{BASE_URL}/api/students")
    assert r_get.status_code == 200
    r_post = oa.post(f"{BASE_URL}/api/students", json={
        "name": "TEST_IT14_blocked",
        "enrollment_date": "2026-01-15",
    })
    assert r_post.status_code == 403, r_post.text
    _set_perms(sa, oa_user_id, ALL_EDIT)


def test_students_none_still_allows_get(sa_session, oa_user_id):
    sa, _ = sa_session
    _set_perms(sa, oa_user_id, {"students": "none"})
    oa, _ = _login(OA_EMAIL, OA_PASS)
    r_get = oa.get(f"{BASE_URL}/api/students")
    assert r_get.status_code == 200
    r_post = oa.post(f"{BASE_URL}/api/students", json={
        "name": "TEST_IT14_none",
        "enrollment_date": "2026-01-15",
    })
    assert r_post.status_code == 403
    _set_perms(sa, oa_user_id, ALL_EDIT)


def test_clients_view_blocks_writes(sa_session, oa_user_id):
    sa, _ = sa_session
    _set_perms(sa, oa_user_id, {"clients": "view"})
    oa, _ = _login(OA_EMAIL, OA_PASS)
    assert oa.get(f"{BASE_URL}/api/clients").status_code == 200
    r_post = oa.post(f"{BASE_URL}/api/clients", json={"name": "TEST_IT14_cli"})
    assert r_post.status_code == 403
    _set_perms(sa, oa_user_id, ALL_EDIT)


def test_transactions_view_blocks_writes(sa_session, oa_user_id):
    sa, _ = sa_session
    _set_perms(sa, oa_user_id, {"transactions": "view"})
    oa, _ = _login(OA_EMAIL, OA_PASS)
    assert oa.get(f"{BASE_URL}/api/transactions").status_code == 200
    # need an account_id but we just want to assert the 403 happens before/at auth check
    r_post = oa.post(f"{BASE_URL}/api/transactions", json={
        "type": "income", "amount": 1, "account_id": "x", "date": "2026-01-15",
    })
    assert r_post.status_code == 403
    _set_perms(sa, oa_user_id, ALL_EDIT)


def test_expense_requests_view_blocks_post(sa_session, oa_user_id):
    sa, _ = sa_session
    _set_perms(sa, oa_user_id, {"expense_requests": "view"})
    oa, _ = _login(OA_EMAIL, OA_PASS)
    assert oa.get(f"{BASE_URL}/api/expense-requests").status_code == 200
    r_post = oa.post(f"{BASE_URL}/api/expense-requests", json={
        "amount": 100, "date": "2026-01-15", "urgency": "normal", "kind": "expense",
    })
    assert r_post.status_code == 403
    _set_perms(sa, oa_user_id, ALL_EDIT)


def test_settings_view_blocks_patch_me(sa_session, oa_user_id):
    sa, _ = sa_session
    _set_perms(sa, oa_user_id, {"settings": "view"})
    oa, _ = _login(OA_EMAIL, OA_PASS)
    r_get = oa.get(f"{BASE_URL}/api/auth/me")
    assert r_get.status_code == 200
    r_patch = oa.patch(f"{BASE_URL}/api/auth/me", json={"name": "TEST_IT14_renamed"})
    assert r_patch.status_code == 403, r_patch.text
    _set_perms(sa, oa_user_id, ALL_EDIT)


def test_super_admin_bypasses_require_edit(sa_session):
    # Even if we set super admin to view (we can't, but role override should bypass anyway)
    s, _ = sa_session
    # super admin can always PATCH /me
    r = s.patch(f"{BASE_URL}/api/auth/me", json={})
    assert r.status_code == 200


# ---------------- Default-permissions seeding ----------------
def test_register_seeds_default_permissions(sa_session):
    sa, _ = sa_session
    email = f"TEST_IT14_reg_{int(time.time()*1000)}@finflow.com"
    r_reg = requests.post(f"{BASE_URL}/api/auth/register", json={
        "email": email, "password": "Test@1234", "name": "TEST_IT14_reg",
        "office": "KM_BLR",
    })
    assert r_reg.status_code == 200, r_reg.text
    # Approve — email was lowercased server-side
    lookup = email.lower()
    users = sa.get(f"{BASE_URL}/api/users?status=pending").json()
    target = next((u for u in users if u["email"] == lookup), None)
    if target is None:
        # Fall back to scanning all users
        users = sa.get(f"{BASE_URL}/api/users").json()
        target = next((u for u in users if u["email"] == lookup), None)
    assert target is not None, f"Registered user not found. Sample emails: {[u['email'] for u in users[:5]]}"
    r_app = sa.patch(f"{BASE_URL}/api/users/{target['id']}/approval",
                     json={"status": "approved"})
    assert r_app.status_code == 200
    body = r_app.json()
    assert "permissions" in body and body["permissions"] == ALL_EDIT
    # Login & verify /auth/me
    new_s, me = _login(email, "Test@1234")
    assert me["permissions"] == ALL_EDIT
    # Cleanup user
    sa.delete(f"{BASE_URL}/api/users/{target['id']}")
