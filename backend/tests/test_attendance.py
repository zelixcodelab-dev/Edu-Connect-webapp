"""Attendance + Payroll feature tests (multi-tenant SaaS).

Uses tenant super_admin admin@educonnect.app. Verifies:
- check-in / today / break / check-out flow
- board counts + rows
- salary set + payroll math
- monthly `me` view
- staff-role permission gating for require_edit('attendance')
"""
import os
import time
from datetime import datetime

import pytest
import requests

def _load_base_url():
    v = os.environ.get("REACT_APP_BACKEND_URL")
    if v:
        return v.rstrip("/")
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                return line.split("=", 1)[1].strip().rstrip("/")
    raise RuntimeError("REACT_APP_BACKEND_URL not set")

BASE_URL = _load_base_url()
ADMIN_EMAIL = "admin@educonnect.app"
ADMIN_PASSWORD = "Admin@12345"


# ---------- fixtures ----------
@pytest.fixture(scope="module")
def admin_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{BASE_URL}/api/auth/login",
               json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=20)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    body = r.json()
    tok = body.get("access_token") or body.get("token")
    assert tok, f"no token in login response: {body}"
    s.headers.update({"Authorization": f"Bearer {tok}"})
    s.admin_user = body.get("user", {})
    return s


@pytest.fixture(scope="module")
def admin_user(admin_client):
    r = admin_client.get(f"{BASE_URL}/api/auth/me", timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


# ---------- basic access ----------
class TestAttendanceBasic:
    def test_admin_is_super_admin(self, admin_user):
        assert admin_user.get("role") == "super_admin", admin_user

    def test_today_returns_record_shape(self, admin_client):
        r = admin_client.get(f"{BASE_URL}/api/attendance/today", timeout=15)
        assert r.status_code == 200, r.text
        assert "record" in r.json()

    def test_board_returns_counts_and_rows(self, admin_client):
        r = admin_client.get(f"{BASE_URL}/api/attendance/board", timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "counts" in data and "rows" in data and "date" in data
        for k in ("in", "on_break", "checked_out", "leave", "absent"):
            assert k in data["counts"], f"missing count key: {k}"

    def test_staff_list(self, admin_client):
        r = admin_client.get(f"{BASE_URL}/api/attendance/staff", timeout=15)
        assert r.status_code == 200, r.text
        assert isinstance(r.json(), list)

    def test_me_month(self, admin_client):
        month = datetime.now().strftime("%Y-%m")
        r = admin_client.get(f"{BASE_URL}/api/attendance/me?month={month}", timeout=15)
        assert r.status_code == 200, r.text
        assert "records" in r.json()


# ---------- check-in / break / check-out ----------
class TestAttendanceFlow:
    def test_check_in_break_check_out(self, admin_client, admin_user):
        # If already checked in today, this is a valid pre-condition failure to detect
        r = admin_client.post(f"{BASE_URL}/api/attendance/check-in",
                              json={"lat": 12.97, "lng": 77.59}, timeout=20)
        already = r.status_code == 400 and "Already" in r.text
        if not already:
            assert r.status_code == 200, r.text
            rec = r.json()["record"]
            assert rec.get("check_in"), "check_in not set"
            assert rec.get("status") in ("present", "late")

        # today should now reflect the record
        r = admin_client.get(f"{BASE_URL}/api/attendance/today", timeout=15)
        assert r.status_code == 200
        today_rec = r.json()["record"]
        assert today_rec and today_rec.get("check_in")

        # break start (may 400 if already on break — treat as OK)
        r = admin_client.post(f"{BASE_URL}/api/attendance/break/start", timeout=15)
        if r.status_code == 200:
            assert r.json()["record"].get("on_break") is True
            time.sleep(1)
            r2 = admin_client.post(f"{BASE_URL}/api/attendance/break/end", timeout=15)
            assert r2.status_code == 200, r2.text
            rec2 = r2.json()["record"]
            assert rec2.get("on_break") is False
            assert isinstance(rec2.get("break_seconds"), int)
        else:
            assert r.status_code == 400, r.text

        # check-out (only if not already checked out)
        r = admin_client.post(f"{BASE_URL}/api/attendance/check-out", timeout=15)
        if r.status_code == 200:
            rec = r.json()["record"]
            assert rec.get("check_out")
            assert isinstance(rec.get("work_seconds"), int)
        else:
            # allowed: already checked out
            assert r.status_code == 400, r.text


# ---------- salary + payroll ----------
class TestPayroll:
    def _pick_staff(self, admin_client):
        r = admin_client.get(f"{BASE_URL}/api/attendance/staff", timeout=15)
        assert r.status_code == 200
        staff = r.json()
        return staff[0] if staff else None

    def test_set_salary_and_payroll_math(self, admin_client):
        target = self._pick_staff(admin_client)
        if not target:
            pytest.skip("No staff/office_admin users to set salary for")
        uid = target["user_id"]

        r = admin_client.put(f"{BASE_URL}/api/attendance/salary/{uid}",
                             json={"monthly_salary": 30000}, timeout=15)
        assert r.status_code == 200, r.text

        month = datetime.now().strftime("%Y-%m")
        r = admin_client.get(f"{BASE_URL}/api/attendance/payroll?month={month}", timeout=20)
        assert r.status_code == 200, r.text
        payload = r.json()
        assert payload.get("month") == month
        rows = payload.get("rows") or []
        row = next((x for x in rows if x["user_id"] == uid), None)
        assert row is not None, f"target uid not in payroll rows: {uid}"
        assert row["monthly_salary"] == 30000
        # working_days should be number of days in the month
        import calendar as _cal
        y, m = int(month[:4]), int(month[5:7])
        assert row["working_days"] == _cal.monthrange(y, m)[1]
        # net_pay = salary - deduction, or 0 if held
        if not row.get("salary_hold"):
            assert abs((row["monthly_salary"] - row["deduction"]) - row["net_pay"]) < 0.02


# ---------- permission gating ----------
class TestPermissionGating:
    """Verify require_edit('attendance') logic via the running app.

    The staff-role permission is exercised indirectly: fetch known
    STAFF_DEFAULT_PERMISSIONS via a real staff user if one exists.
    If no staff user exists in the tenant, skip (permission unit-tested
    via models.py constants below)."""

    def test_staff_can_check_in_403_check(self, admin_client):
        """Create a staff user and verify require_edit('attendance') passes for
        the check-in POST (staff role's default attendance perm is 'edit')."""
        staff_email = "TEST_att_staff_1@educonnect.app"
        staff_pw = "Staff@12345"
        # Create (idempotent — 409 if exists is OK)
        r = admin_client.post(
            f"{BASE_URL}/api/users",
            json={"email": staff_email, "password": staff_pw, "name": "TEST Att Staff",
                  "role": "staff", "office": "KM_BLR"},
            timeout=15,
        )
        assert r.status_code in (201, 409), r.text

        # Login as staff (fresh session)
        s = requests.Session()
        s.headers.update({"Content-Type": "application/json"})
        r = s.post(f"{BASE_URL}/api/auth/login",
                   json={"email": staff_email, "password": staff_pw}, timeout=15)
        assert r.status_code == 200, r.text
        tok = r.json().get("access_token") or r.json().get("token")
        assert tok
        s.headers.update({"Authorization": f"Bearer {tok}"})

        # Try to check in — staff should NOT get 403 (attendance='edit' default)
        r = s.post(f"{BASE_URL}/api/attendance/check-in", json={}, timeout=15)
        assert r.status_code != 403, f"staff got 403 — permission gating regression: {r.text}"
        assert r.status_code in (200, 400), r.text  # 400 only if already checked in

    def test_staff_default_perms_map(self):
        # Import from backend package
        import sys
        sys.path.insert(0, "/app/backend")
        from models import STAFF_DEFAULT_PERMISSIONS, USER_DEFAULT_PERMISSIONS, PERMISSION_PAGES
        assert "attendance" in PERMISSION_PAGES
        assert STAFF_DEFAULT_PERMISSIONS["attendance"] == "edit"
        assert USER_DEFAULT_PERMISSIONS["attendance"] == "none"
