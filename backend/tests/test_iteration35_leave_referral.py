"""Iteration 35 — Leave management + referral attribution + lead conversion +
staff reminder messaging. Each TestClass focuses on one feature so failures
are isolated. Tests prefix created data with TEST_ for easy identification.
"""
import os
import pytest
import requests
from datetime import date, timedelta
from pathlib import Path


def _load_base_url():
    val = os.environ.get("REACT_APP_BACKEND_URL", "").strip()
    if val:
        return val.rstrip("/")
    env_path = Path("/app/frontend/.env")
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            if line.startswith("REACT_APP_BACKEND_URL="):
                return line.split("=", 1)[1].strip().rstrip("/")
    raise RuntimeError("REACT_APP_BACKEND_URL not set")


BASE_URL = _load_base_url()

SUPER = {"email": "admin@kmfoundation.online", "password": "Admin@786"}
OFFICE = {"email": "blr1@finflow.com", "password": "Office@123"}
STAFF = {"email": "staff.blr@kmfoundation.online", "password": "Staff@123"}


# ---------- Helpers ----------
def _login(creds):
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json=creds, timeout=20)
    if r.status_code != 200:
        pytest.skip(f"login failed for {creds['email']}: {r.status_code} {r.text}")
    me = s.get(f"{BASE_URL}/api/auth/me", timeout=10).json()
    return s, me


@pytest.fixture(scope="module")
def staff_session():
    return _login(STAFF)


@pytest.fixture(scope="module")
def office_session():
    return _login(OFFICE)


@pytest.fixture(scope="module")
def super_session():
    return _login(SUPER)


# ---------- Leave Module ----------
class TestLeave:
    def test_staff_create_leave(self, staff_session, office_session):
        s_staff, me_staff = staff_session
        s_office, me_office = office_session
        today = date.today()
        payload = {
            "leave_type": "casual",
            "from_date": today.isoformat(),
            "to_date": (today + timedelta(days=2)).isoformat(),
            "reason": "TEST_leave_iter35",
        }
        r = s_staff.post(f"{BASE_URL}/api/leave", json=payload, timeout=15)
        assert r.status_code == 201, r.text
        data = r.json()
        assert data["status"] == "pending"
        assert data["requester_user_id"] == me_staff["id"]
        assert data["days"] == 3
        leave_id = data["id"]

        # Office admin sees it in inbox
        inbox = s_office.get(f"{BASE_URL}/api/leave?box=inbox", timeout=10).json()
        assert any(d["id"] == leave_id for d in inbox), "staff leave not in office admin inbox"

        # Staff sees it in their own list
        mine = s_staff.get(f"{BASE_URL}/api/leave?box=mine", timeout=10).json()
        assert any(d["id"] == leave_id for d in mine)

        # Staff cannot approve own
        rr = s_staff.patch(f"{BASE_URL}/api/leave/{leave_id}", json={"status": "approved"}, timeout=10)
        assert rr.status_code == 403

        # Office admin approves it
        ra = s_office.patch(f"{BASE_URL}/api/leave/{leave_id}", json={"status": "approved", "note": "ok"}, timeout=10)
        assert ra.status_code == 200, ra.text
        assert ra.json()["status"] == "approved"
        assert ra.json()["approver_user_id"] == me_office["id"]

        # Cleanup: super admin would need access, otherwise leave it (decided)
        # Approved leave can't be deleted by requester anymore — that's OK.

    def test_invalid_leave_type(self, staff_session):
        s_staff, _ = staff_session
        today = date.today()
        r = s_staff.post(f"{BASE_URL}/api/leave", json={
            "leave_type": "vacation",
            "from_date": today.isoformat(),
            "to_date": today.isoformat(),
            "reason": "x",
        }, timeout=10)
        assert r.status_code == 400

    def test_to_before_from_rejected(self, staff_session):
        s_staff, _ = staff_session
        today = date.today()
        r = s_staff.post(f"{BASE_URL}/api/leave", json={
            "leave_type": "casual",
            "from_date": today.isoformat(),
            "to_date": (today - timedelta(days=1)).isoformat(),
            "reason": "bad",
        }, timeout=10)
        assert r.status_code == 400

    def test_office_admin_leave_appears_in_super_inbox(self, office_session, super_session):
        s_off, me_off = office_session
        s_sup, _ = super_session
        today = date.today()
        r = s_off.post(f"{BASE_URL}/api/leave", json={
            "leave_type": "sick",
            "from_date": today.isoformat(),
            "to_date": today.isoformat(),
            "reason": "TEST_oa_leave",
        }, timeout=10)
        assert r.status_code == 201, r.text
        leave_id = r.json()["id"]

        # Super admin sees in inbox
        inbox = s_sup.get(f"{BASE_URL}/api/leave?box=inbox", timeout=10).json()
        assert any(d["id"] == leave_id for d in inbox)

        # Requester can delete their own pending
        rd = s_off.delete(f"{BASE_URL}/api/leave/{leave_id}", timeout=10)
        assert rd.status_code == 200

        # After delete, gone
        inbox2 = s_sup.get(f"{BASE_URL}/api/leave?box=inbox", timeout=10).json()
        assert not any(d["id"] == leave_id for d in inbox2)

    def test_stats_endpoint(self, staff_session, office_session):
        s_staff, _ = staff_session
        s_off, _ = office_session
        today = date.today()
        r = s_staff.post(f"{BASE_URL}/api/leave", json={
            "leave_type": "casual",
            "from_date": today.isoformat(),
            "to_date": today.isoformat(),
            "reason": "TEST_stats",
        }, timeout=10)
        assert r.status_code == 201
        lid = r.json()["id"]

        stats_s = s_staff.get(f"{BASE_URL}/api/leave/stats", timeout=10).json()
        assert "pending_mine" in stats_s and stats_s["pending_mine"] >= 1
        assert "pending_inbox" in stats_s

        stats_o = s_off.get(f"{BASE_URL}/api/leave/stats", timeout=10).json()
        assert stats_o["pending_inbox"] >= 1

        # Requester deletes own pending → 200
        rd = s_staff.delete(f"{BASE_URL}/api/leave/{lid}", timeout=10)
        assert rd.status_code == 200


# ---------- Referral attribution ----------
class TestReferral:
    def test_public_referrer_resolves_staff_user(self, staff_session):
        _, me = staff_session
        r = requests.get(f"{BASE_URL}/api/public/referrer/{me['id']}", timeout=10)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["id"] == me["id"]
        assert data.get("is_user") is True
        assert data.get("type") == "staff"

    def test_application_with_referrer_credits_staff(self, staff_session):
        _, me = staff_session
        body = {
            "referrer_id": me["id"],
            "basic_info": {
                "student_full_name": "TEST_RefStudent_35",
                "email": "ref35@example.com",
                "mobile_number": "9999000035",
                "date_of_birth": "2002-01-15",
            },
            "communication": {
                "father_name": "TEST_Father",
                "father_mobile": "9999000001",
                "address_line_1": "123 Test St",
                "city": "Bengaluru",
                "pincode": "560001",
            },
            "academic": {"twelfth": {"register_number": "TEST123"}},
            "course": {"interested_course": "BCA"},
            "reference": {"name": "", "notes": ""},
            "declaration": {"agreement_accepted": True},
        }
        r = requests.post(f"{BASE_URL}/api/public/applications", json=body, timeout=15)
        assert r.status_code == 201, r.text
        sid = r.json()["id"]

        # GET /api/students/me/referrals as staff
        s_staff, _ = staff_session
        rr = s_staff.get(f"{BASE_URL}/api/students/me/referrals", timeout=10)
        assert rr.status_code == 200
        items = rr.json()
        ids = [s["id"] for s in items] if isinstance(items, list) else [s["id"] for s in items.get("items", [])]
        assert sid in ids, "submitted student not found under /students/me/referrals"


# ---------- Lead conversion ----------
class TestLeadConvert:
    def test_office_create_assign_staff_then_staff_convert(self, office_session, staff_session):
        s_off, _ = office_session
        s_staff, me_staff = staff_session

        # Create a lead assigned to staff
        lead_payload = {
            "name": "TEST_LeadConvert_35",
            "phone": "9999000035",
            "email": "lc35@example.com",
            "course": "BBA",
            "place": "BLR",
            "status": "new",
            "source": "walk_in",
            "assigned_to_user_id": me_staff["id"],
        }
        r = s_off.post(f"{BASE_URL}/api/leads", json=lead_payload, timeout=10)
        assert r.status_code in (200, 201), r.text
        lead_id = r.json()["id"]

        # Staff converts
        rc = s_staff.post(f"{BASE_URL}/api/leads/{lead_id}/convert", json={}, timeout=15)
        assert rc.status_code in (200, 201), rc.text
        body = rc.json()
        assert body.get("ok") is True
        student_id = body.get("student_id")
        assert student_id

        # Idempotent — second call returns same id
        rc2 = s_staff.post(f"{BASE_URL}/api/leads/{lead_id}/convert", json={}, timeout=10)
        assert rc2.status_code in (200, 201)
        assert rc2.json().get("student_id") == student_id
        assert rc2.json().get("already_converted") is True

        # Lead is converted
        rl = s_staff.get(f"{BASE_URL}/api/leads/{lead_id}", timeout=10)
        if rl.status_code == 200:
            assert rl.json().get("status") == "converted"

        # Student credited to staff
        rr = s_staff.get(f"{BASE_URL}/api/students/me/referrals", timeout=10)
        items = rr.json()
        ids = [s["id"] for s in items] if isinstance(items, list) else [s["id"] for s in items.get("items", [])]
        assert student_id in ids

        # Cleanup
        s_off.delete(f"{BASE_URL}/api/leads/{lead_id}", timeout=10)


# ---------- Staff reminder messaging ----------
class TestStaffReminder:
    def test_staff_reminder_to_office_admin(self, staff_session, office_session):
        s_staff, _ = staff_session
        _, me_off = office_session
        payload = {
            "kind": "reminder",
            "subject": "TEST_reminder_35",
            "body": "Please review my leave",
            "audience": {"type": "users", "user_ids": [me_off["id"]]},
        }
        r = s_staff.post(f"{BASE_URL}/api/messages", json=payload, timeout=10)
        assert r.status_code in (200, 201), f"staff reminder to office admin failed: {r.status_code} {r.text}"

    def test_staff_reminder_to_regular_user_rejected(self, staff_session, super_session):
        s_staff, _ = staff_session
        s_sup, _ = super_session
        # Find a non-admin/non-staff user (role=user) if available
        ru = s_sup.get(f"{BASE_URL}/api/users?status=approved", timeout=10)
        if ru.status_code != 200:
            pytest.skip("cannot list users to find a 'user' role target")
        rows = ru.json()
        if isinstance(rows, dict):
            rows = rows.get("items", [])
        target = next((u for u in rows if u.get("role") == "user"), None)
        if not target:
            pytest.skip("no 'user' role account to test rejection against")

        payload = {
            "kind": "reminder",
            "subject": "TEST_reminder_bad",
            "body": "x",
            "audience": {"type": "users", "user_ids": [target["id"]]},
        }
        r = s_staff.post(f"{BASE_URL}/api/messages", json=payload, timeout=10)
        assert r.status_code in (400, 403), f"expected rejection, got {r.status_code} {r.text}"


# ---------- Regression: nav permissions check ----------
class TestRegression:
    def test_super_admin_login_works(self, super_session):
        _, me = super_session
        assert me["role"] == "super_admin"

    def test_office_admin_login_works(self, office_session):
        _, me = office_session
        assert me["role"] == "office_admin"

    def test_staff_login_role_is_staff(self, staff_session):
        _, me = staff_session
        assert me["role"] == "staff", f"expected role=staff, got {me.get('role')}"

    def test_leads_listing_still_works(self, office_session):
        s, _ = office_session
        r = s.get(f"{BASE_URL}/api/leads", timeout=10)
        assert r.status_code == 200
