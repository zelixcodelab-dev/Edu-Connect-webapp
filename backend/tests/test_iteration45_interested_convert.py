"""Iteration 45: /interested, /attending-admins, /visit, /convert flows.

Uses phone 0000000000 (Interakt rejects → WA is expected to fail — treat
whatsapp.ok=False + detail present as PASS).
"""
from __future__ import annotations

import os
import time
import pytest
import requests
from dotenv import load_dotenv

load_dotenv("/app/frontend/.env")
BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")

SUPER = {"email": "admin@kmfoundation.online", "password": "Admin@786"}
OFFICE = {"email": "blr1@finflow.com", "password": "Office@123"}
STAFF = {"email": "staff.blr@kmfoundation.online", "password": "Staff@123"}
SAFE_PHONE = "0000000000"


def _login(creds):
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json=creds, timeout=15)
    assert r.status_code == 200, f"login failed for {creds['email']}: {r.status_code} {r.text}"
    return s


@pytest.fixture(scope="module")
def super_s():
    return _login(SUPER)


@pytest.fixture(scope="module")
def office_s():
    return _login(OFFICE)


@pytest.fixture(scope="module")
def staff_s():
    return _login(STAFF)


@pytest.fixture(scope="module")
def super_user(super_s):
    return super_s.get(f"{BASE_URL}/api/auth/me").json()


@pytest.fixture(scope="module")
def office_user(office_s):
    return office_s.get(f"{BASE_URL}/api/auth/me").json()


@pytest.fixture(scope="module")
def staff_user(staff_s):
    return staff_s.get(f"{BASE_URL}/api/auth/me").json()


created_lead_ids: list[str] = []
created_student_ids: list[str] = []


def _make_lead(s, name_suffix, assign_to=None, status="new"):
    body = {"name": f"QA WA Test {name_suffix}", "phone": SAFE_PHONE, "source": "walk_in", "status": status}
    if assign_to:
        body["assigned_to_user_id"] = assign_to
    r = s.post(f"{BASE_URL}/api/leads", json=body)
    assert r.status_code == 201, r.text
    d = r.json()
    created_lead_ids.append(d["id"])
    return d


# ---------- /interested + visit ----------
class TestInterested:
    def test_interested_no_visit(self, super_s):
        lead = _make_lead(super_s, "int-nov")
        r = super_s.post(f"{BASE_URL}/api/leads/{lead['id']}/interested", json={
            "parent_number": "9111111111",
            "alternate_number": "9222222222",
            "campus_visit_interested": False,
        })
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["lead"]["status"] == "interested"
        assert data["lead"]["parent_number"] == "9111111111"
        assert data["lead"]["alternate_number"] == "9222222222"
        assert data["lead"].get("campus_visit_interested") is False
        assert data["whatsapp"] is None
        assert "visit" not in data["lead"] or not data["lead"].get("visit")

    def test_interested_with_visit_and_notifications(self, super_s):
        lead = _make_lead(super_s, "int-visit")
        r = super_s.post(f"{BASE_URL}/api/leads/{lead['id']}/interested", json={
            "parent_number": "9333333333",
            "alternate_number": "",
            "campus_visit_interested": True,
            "visit": {
                "departure_at": "2030-01-05T10:00:00Z",
                "arrival_at": "2030-01-05T14:00:00Z",
                "travel_mode": "Train",
                "who_comes": "Student + Father",
                "drop_point": "Bengaluru City Junction",
            },
        })
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["lead"]["status"] == "interested"
        assert data["lead"]["campus_visit_interested"] is True
        v = data["lead"]["visit"]
        assert v["status"] == "scheduled"
        assert v["travel_mode"] == "Train"
        assert v["drop_point"].startswith("Bengaluru")
        assert v["whatsapp_sent"] is False  # invalid phone
        # whatsapp payload — ok should be False, with detail
        assert data["whatsapp"] is not None
        assert data["whatsapp"]["ok"] is False
        assert data["whatsapp"].get("detail")


# ---------- /attending-admins ----------
class TestAttendingAdmins:
    def test_super_can_list(self, super_s):
        r = super_s.get(f"{BASE_URL}/api/leads/attending-admins")
        assert r.status_code == 200
        arr = r.json()
        assert isinstance(arr, list)
        roles = {a["role"] for a in arr}
        assert roles.issubset({"super_admin", "office_admin"})
        assert any(a["role"] == "super_admin" for a in arr)

    def test_office_can_list(self, office_s):
        r = office_s.get(f"{BASE_URL}/api/leads/attending-admins")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_staff_can_list(self, staff_s):
        r = staff_s.get(f"{BASE_URL}/api/leads/attending-admins")
        assert r.status_code == 200
        assert isinstance(r.json(), list)


# ---------- /visit PATCH ----------
class TestVisitPatch:
    @pytest.fixture(scope="class")
    def lead_with_visit(self, super_s):
        lead = _make_lead(super_s, "visit-patch")
        r = super_s.post(f"{BASE_URL}/api/leads/{lead['id']}/interested", json={
            "campus_visit_interested": True,
            "visit": {"departure_at": "2030-02-05T10:00:00Z", "arrival_at": "2030-02-05T14:00:00Z"},
        })
        assert r.status_code == 200
        return lead["id"]

    def test_assign_valid_admin(self, super_s, lead_with_visit):
        # Get a super admin id
        admins = super_s.get(f"{BASE_URL}/api/leads/attending-admins").json()
        sup = next(a for a in admins if a["role"] == "super_admin")
        r = super_s.patch(f"{BASE_URL}/api/leads/{lead_with_visit}/visit",
                          json={"attending_admin_id": sup["id"]})
        assert r.status_code == 200
        v = r.json()["visit"]
        assert v["attending_admin_id"] == sup["id"]
        assert v["attending_admin_name"] == sup["name"]

    def test_assign_staff_id_rejected(self, super_s, staff_user, lead_with_visit):
        r = super_s.patch(f"{BASE_URL}/api/leads/{lead_with_visit}/visit",
                          json={"attending_admin_id": staff_user["id"]})
        assert r.status_code == 400

    def test_clear_assignment(self, super_s, lead_with_visit):
        r = super_s.patch(f"{BASE_URL}/api/leads/{lead_with_visit}/visit",
                          json={"attending_admin_id": ""})
        assert r.status_code == 200
        v = r.json()["visit"]
        assert v["attending_admin_id"] is None
        assert v["attending_admin_name"] is None

    def test_status_transitions(self, super_s, lead_with_visit):
        # Full 9-stage visit vocabulary (iteration 47) — cycle through the
        # outcome stages, then back to scheduled.
        for st in ("assigned", "picked_up", "ongoing", "confused",
                   "admission_taken", "fees_paid", "admission_letter_taken",
                   "lost", "scheduled"):
            r = super_s.patch(f"{BASE_URL}/api/leads/{lead_with_visit}/visit",
                              json={"status": st})
            assert r.status_code == 200
            assert r.json()["visit"]["status"] == st

    def test_invalid_status(self, super_s, lead_with_visit):
        r = super_s.patch(f"{BASE_URL}/api/leads/{lead_with_visit}/visit",
                          json={"status": "bogus"})
        assert r.status_code == 400

    def test_staff_forbidden(self, staff_s, lead_with_visit):
        # Staff might get 403 (role) or 404 (scope) — either is acceptable "denied"
        r = staff_s.patch(f"{BASE_URL}/api/leads/{lead_with_visit}/visit",
                         json={"status": "admission_taken"})
        assert r.status_code in (403, 404)


# ---------- /convert ----------
class TestConvert:
    def test_convert_with_payload(self, super_s):
        lead = _make_lead(super_s, "conv-full")
        r = super_s.post(f"{BASE_URL}/api/leads/{lead['id']}/convert", json={
            "city": "Bangalore",
            "course": "B.Sc Nursing",
            "college": "Sample College",
            "send_link": True,
            "campus_visit_interested": True,
            "visit": {"departure_at": "2030-03-05T10:00:00Z", "arrival_at": "2030-03-05T14:00:00Z"},
        })
        assert r.status_code == 201, r.text
        data = r.json()
        assert data["ok"] is True
        assert data.get("student_id")
        created_student_ids.append(data["student_id"])
        # whatsapp attempts — ok False with detail expected for 0000000000
        assert data["whatsapp"] is not None
        assert data["whatsapp"]["ok"] is False
        assert data["whatsapp"].get("detail")
        assert data["visit_whatsapp"] is not None
        assert data["visit_whatsapp"]["ok"] is False

        # verify student
        st = super_s.get(f"{BASE_URL}/api/students/{data['student_id']}").json()
        assert st["course"] == "B.Sc Nursing"
        assert st["college"] == "Sample College"
        assert "City: Bangalore" in (st.get("notes") or "")

        # verify lead conversion_details
        lead_fresh = super_s.get(f"{BASE_URL}/api/leads", params={"q": lead["name"]}).json()
        me = next(x for x in lead_fresh if x["id"] == lead["id"])
        assert me["status"] == "converted"
        cd = me.get("conversion_details") or {}
        assert cd.get("city") == "Bangalore"
        assert cd.get("course") == "B.Sc Nursing"
        assert cd.get("college") == "Sample College"

    def test_convert_no_body_backcompat(self, super_s):
        lead = _make_lead(super_s, "conv-legacy")
        r = super_s.post(f"{BASE_URL}/api/leads/{lead['id']}/convert")
        assert r.status_code == 201, r.text
        data = r.json()
        assert data["ok"] is True
        assert data["student_id"]
        created_student_ids.append(data["student_id"])

    def test_convert_idempotent(self, super_s):
        lead = _make_lead(super_s, "conv-idem")
        r1 = super_s.post(f"{BASE_URL}/api/leads/{lead['id']}/convert", json={})
        assert r1.status_code == 201
        sid = r1.json()["student_id"]
        created_student_ids.append(sid)
        r2 = super_s.post(f"{BASE_URL}/api/leads/{lead['id']}/convert", json={})
        assert r2.status_code == 201
        d = r2.json()
        assert d.get("already_converted") is True
        assert d["student_id"] == sid


# ---------- teardown ----------
def teardown_module(module):
    s = _login(SUPER)
    for lid in list(set(created_lead_ids)):
        try:
            s.delete(f"{BASE_URL}/api/leads/{lid}")
        except Exception:
            pass
    for sid in list(set(created_student_ids)):
        try:
            s.delete(f"{BASE_URL}/api/students/{sid}")
        except Exception:
            pass
