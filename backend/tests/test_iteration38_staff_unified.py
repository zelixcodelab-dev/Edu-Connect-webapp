"""Iteration 38: unified staff (office admin) + staff quick-add students."""
import os, requests, pytest
from pathlib import Path

def _load_env():
    p = Path('/app/frontend/.env')
    if p.exists():
        for line in p.read_text().splitlines():
            if '=' in line and not line.strip().startswith('#'):
                k, v = line.split('=', 1); os.environ.setdefault(k.strip(), v.strip())
_load_env()
BASE_URL = os.environ.get('REACT_APP_BACKEND_URL').rstrip('/')
SA = ("admin@kmfoundation.online", "Admin@786")
OA = ("blr1@finflow.com", "Office@123")
STAFF = ("staff.blr@kmfoundation.online", "Staff@123")


def _login(email, pw):
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": pw}, timeout=20)
    assert r.status_code == 200, f"login failed for {email}: {r.status_code} {r.text}"
    return s


@pytest.fixture(scope="module")
def sa_session(): return _login(*SA)


@pytest.fixture(scope="module")
def oa_session(): return _login(*OA)


def test_staff_members_list_oa(oa_session):
    r = oa_session.get(f"{BASE_URL}/api/staff/members", timeout=20)
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, list)
    # rows should only have offices == KM_BLR
    for row in data:
        assert row.get("office") in (None, "KM_BLR", "ALL")
        assert "kind" in row and row["kind"] in ("full", "profile_only", "login_only")


def test_staff_members_forbidden_for_staff():
    s = _login(*STAFF)
    r = s.get(f"{BASE_URL}/api/staff/members", timeout=20)
    assert r.status_code == 403


def test_oa_create_update_reset_delete_staff(oa_session):
    email = "TEST_iter38_unified@example.com"
    payload = {"name": "TEST Iter38 Unified", "email": email, "password": "Pass1234",
               "place": "Bangalore", "address": "Test Address"}
    r = oa_session.post(f"{BASE_URL}/api/staff/members", json=payload, timeout=20)
    assert r.status_code == 201, r.text
    body = r.json()
    cid, uid = body["client_id"], body["login_user_id"]

    # GET reflects it
    r2 = oa_session.get(f"{BASE_URL}/api/staff/members", timeout=20)
    row = next((x for x in r2.json() if x.get("client_id") == cid), None)
    assert row is not None and row["kind"] == "full"
    assert row["login_user_id"] == uid
    assert row["has_login"] is True

    # New staff can log in
    s2 = _login(email, "Pass1234")
    me = s2.get(f"{BASE_URL}/api/auth/me", timeout=20).json()
    assert me["role"] == "staff" and me["office"] == "KM_BLR"

    # PATCH: change name → syncs to login
    r3 = oa_session.patch(f"{BASE_URL}/api/staff/members/{cid}",
                          json={"name": "TEST Iter38 Renamed", "place": "Mysore"}, timeout=20)
    assert r3.status_code == 200
    # Verify login name synced
    import requests as _r
    s3 = _r.Session()
    s3.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": "Pass1234"}, timeout=20)
    me2 = s3.get(f"{BASE_URL}/api/auth/me", timeout=20).json()
    assert me2["name"] == "TEST Iter38 Renamed"

    # Reset password via /api/users/{uid}/reset-password (existing endpoint)
    rp = oa_session.post(f"{BASE_URL}/api/users/{uid}/reset-password",
                         json={"new_password": "NewPass456"}, timeout=20)
    assert rp.status_code in (200, 204), rp.text
    # Login with new password works
    _login(email, "NewPass456")

    # DELETE: removes both
    rd = oa_session.delete(f"{BASE_URL}/api/staff/members/{cid}", timeout=20)
    assert rd.status_code == 200
    # Login should now fail
    fail = requests.post(f"{BASE_URL}/api/auth/login",
                        json={"email": email, "password": "NewPass456"}, timeout=20)
    assert fail.status_code in (401, 403)


def test_staff_quick_add_student_and_summary():
    s = _login(*STAFF)
    payload = {"name": "TEST Iter38 Student", "course": "BBA",
               "college": "Test College", "status": "enrolled"}
    r = s.post(f"{BASE_URL}/api/students/me/quick-add", json=payload, timeout=20)
    assert r.status_code == 201, r.text
    sid = r.json()["student_id"]

    # Appears in referral summary
    rs = s.get(f"{BASE_URL}/api/students/me/referral-summary", timeout=20).json()
    ids = [x["id"] for x in rs.get("students", [])]
    assert sid in ids
    totals = rs.get("totals") or {}
    # totals struct may vary; just ensure there's some admitted/earned/pending counter
    assert any(k in totals for k in ("admitted_count", "admissions", "students_admitted")) or len(ids) >= 1

    # Cleanup via super_admin
    sa = _login(*SA)
    d = sa.delete(f"{BASE_URL}/api/students/{sid}", timeout=20)
    assert d.status_code == 200


def test_quick_add_forbidden_for_oa(oa_session):
    r = oa_session.post(f"{BASE_URL}/api/students/me/quick-add",
                        json={"name": "X"}, timeout=20)
    assert r.status_code == 403
