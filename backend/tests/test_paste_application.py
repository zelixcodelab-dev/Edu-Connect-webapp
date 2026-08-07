"""Integration tests for the authenticated admin-paste application endpoint."""
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


SAMPLE_PAYLOAD = {
    "basic_info": {
        "student_full_name": "PYTEST_PasteFlow Student",
        "mobile_number": "9999999999",
        "email": "paste-flow@test.com",
        "date_of_birth": "2003-04-12",
        "gender": "female",
        "aadhaar_number": "111122223333",
        "nationality": "Indian",
        "religion": "",
        "caste": "",
    },
    "course": {
        "interested_course": "BCA",
        "preferred_college": "PYTEST_Paste College",
        "academic_year": "2026-2027",
        "admission_type": "management",
    },
    "communication": {
        "father_name": "Father X",
        "father_mobile": "8888888888",
        "mother_name": "Mother Y",
        "mother_mobile": "7777777777",
        "address_line_1": "123 Main Street",
        "address_line_2": "",
        "city": "Thrissur",
        "state": "Kerala",
        "pincode": "680001",
    },
    "academic": {
        "tenth": {"register_number": "10R", "school_name": "10S", "percentage": "85"},
        "twelfth": {"register_number": "12R", "school_name": "12S", "percentage": "78"},
    },
    "payment": {"registration_amount": 0, "payment_mode": "upi"},
    "reference": {"type": "sub_agent", "notes": "Hostel/Bus: Hostel"},
}


def _cleanup(session: requests.Session) -> None:
    listing = session.get(f"{API}/students", timeout=15).json()
    for s in listing:
        if (s.get("name") or "").startswith("PYTEST_PasteFlow"):
            session.delete(f"{API}/students/{s['id']}", timeout=15)


@pytest.fixture(autouse=True)
def _wipe(admin_session: requests.Session) -> None:
    _cleanup(admin_session)


def test_admin_paste_creates_inquiry_student(admin_session: requests.Session) -> None:
    r = admin_session.post(f"{API}/applications/admin", json=SAMPLE_PAYLOAD, timeout=15)
    assert r.status_code == 201, r.text
    body = r.json()
    assert "id" in body and "reference_code" in body
    sid = body["id"]

    # Read the student back and verify it lands as inquiry + admin_paste source.
    listing = admin_session.get(f"{API}/students", timeout=15).json()
    me = next((x for x in listing if x["id"] == sid), None)
    assert me is not None
    assert me["status"] == "inquiry"
    assert me["application_source"] == "admin_paste"
    assert me["name"] == "PYTEST_PasteFlow Student"
    assert me["course"] == "BCA"
    assert me["college"] == "PYTEST_Paste College"
    assert "application" in me
    assert me["application"]["basic_info"]["aadhaar_number"] == "111122223333"
    assert me["application"]["academic"]["tenth"]["percentage"] == "85"


def test_office_admin_blocked(office_session: requests.Session) -> None:
    r = office_session.post(f"{API}/applications/admin", json=SAMPLE_PAYLOAD, timeout=15)
    assert r.status_code == 403


def test_validation_missing_required_field(admin_session: requests.Session) -> None:
    bad = {**SAMPLE_PAYLOAD, "basic_info": {**SAMPLE_PAYLOAD["basic_info"], "email": "not-an-email"}}
    r = admin_session.post(f"{API}/applications/admin", json=bad, timeout=15)
    assert r.status_code == 422
