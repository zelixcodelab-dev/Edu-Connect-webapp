"""Iteration 26 - Public Application form changes + PDF rendering regressions.

Coverage:
- Public application 422 when declaration.agreement_accepted is False
- Public application 422 when academic.twelfth.register_number is empty
- Successful public application submission with declaration accepted
- Backend PDF renderer produces a real PDF (magic + non-zero bytes)
- Smoke regressions for /api/public/courses, /api/public/colleges,
  /api/auth/login, /api/auth/me, /api/students for both super and office admin.
- Paste application admin endpoint still works without supplying a declaration.
"""
import os
import sys
import asyncio
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
assert BASE_URL, "REACT_APP_BACKEND_URL must be set"

SUPER_EMAIL = os.getenv("TEST_ADMIN_EMAIL", "admin@kmfoundation.online")
SUPER_PASSWORD = os.getenv("TEST_ADMIN_PASSWORD", "Admin@786")
OFFICE_EMAIL = os.getenv("TEST_OFFICE_EMAIL", "blr1@finflow.com")
OFFICE_PASSWORD = os.getenv("TEST_OFFICE_PASSWORD", "Office@123")

PUBLIC = f"{BASE_URL}/api/public"


# ---------- fixtures ----------
@pytest.fixture(scope="module")
def http():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _login(http, email, password):
    r = http.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, f"login failed {email}: {r.status_code} {r.text}"
    return r.json().get("access_token") or r.json().get("token")


@pytest.fixture(scope="module")
def super_token(http):
    return _login(http, SUPER_EMAIL, SUPER_PASSWORD)


@pytest.fixture(scope="module")
def office_token(http):
    return _login(http, OFFICE_EMAIL, OFFICE_PASSWORD)


def _valid_payload(register_number="200234", agreement=True, college="Test Partner College"):
    """Build a payload that matches the new public application schema."""
    return {
        "basic_info": {
            "student_full_name": f"TEST_Arya R {uuid.uuid4().hex[:6]}",
            "mobile_number": "9876543210",
            "email": f"test_{uuid.uuid4().hex[:8]}@example.com",
            "date_of_birth": "2006-04-12",
            "gender": "female",
            "aadhaar_number": "",
            "nationality": "Indian",
            "religion": "",
            "caste": "",
        },
        "course": {
            "interested_course": "B.E. CSE",
            "preferred_college": college,
            "academic_year": "2026-2027",
            "admission_type": "management",
        },
        "communication": {
            "father_name": "Test Father",
            "father_mobile": "9876543211",
            "mother_name": "Test Mother",
            "mother_mobile": "",
            "address_line_1": "1 Test St",
            "address_line_2": "",
            "city": "Coimbatore",
            "state": "Tamil Nadu",
            "pincode": "641001",
        },
        "academic": {
            "tenth": {"register_number": "100200", "school_name": "ABC", "school_place": "CBE",
                      "board": "State Board", "year_of_passing": "2022", "percentage": "85"},
            "twelfth": {"register_number": register_number, "school_name": "XYZ", "school_place": "CBE",
                        "board": "State Board", "year_of_passing": "2024", "percentage": "82"},
        },
        "payment": {"registration_amount": 500, "payment_date": "2026-01-15"},
        "reference": {"name": "QA Bot", "contact_number": "9000000000"},
        "declaration": {"agreement_accepted": agreement},
    }


# ---------- Public smoke ----------
def test_public_courses(http):
    r = http.get(f"{PUBLIC}/courses")
    assert r.status_code == 200
    assert "courses" in r.json()


def test_public_colleges(http):
    r = http.get(f"{PUBLIC}/colleges")
    assert r.status_code == 200
    assert isinstance(r.json().get("colleges"), list)


# ---------- Validation 422s ----------
def test_submit_rejected_when_agreement_false(http):
    payload = _valid_payload(agreement=False)
    r = http.post(f"{PUBLIC}/applications", json=payload)
    assert r.status_code == 422, f"expected 422, got {r.status_code}: {r.text}"
    assert "declaration" in r.text.lower() or "agree" in r.text.lower()


def test_submit_rejected_when_twelfth_register_empty(http):
    payload = _valid_payload(register_number="", agreement=True)
    r = http.post(f"{PUBLIC}/applications", json=payload)
    assert r.status_code == 422, f"expected 422, got {r.status_code}: {r.text}"
    assert "register" in r.text.lower()


# ---------- Successful submission ----------
created_student = {"id": None, "ref": None}


def test_submit_success_and_persistence(http):
    payload = _valid_payload()
    r = http.post(f"{PUBLIC}/applications", json=payload)
    assert r.status_code in (200, 201), f"{r.status_code}: {r.text}"
    body = r.json()
    assert body.get("reference_code")
    # Server may return student_id key as id or student_id
    sid = body.get("student_id") or body.get("id")
    assert sid, f"no student id in response: {body}"
    created_student["id"] = sid
    created_student["ref"] = body["reference_code"]


# ---------- Auth + protected smoke ----------
def test_auth_login_super(http, super_token):
    assert super_token


def test_auth_me_super(http, super_token):
    r = http.get(f"{BASE_URL}/api/auth/me", headers={"Authorization": f"Bearer {super_token}"})
    assert r.status_code == 200
    assert r.json().get("email") == SUPER_EMAIL


def test_students_list_super(http, super_token):
    r = http.get(f"{BASE_URL}/api/students", headers={"Authorization": f"Bearer {super_token}"})
    assert r.status_code == 200
    items = r.json() if isinstance(r.json(), list) else r.json().get("students", [])
    assert isinstance(items, list)


def test_auth_login_office(http, office_token):
    assert office_token


def test_students_list_office(http, office_token):
    r = http.get(f"{BASE_URL}/api/students", headers={"Authorization": f"Bearer {office_token}"})
    assert r.status_code == 200


# ---------- Edit application regression ----------
def test_patch_application_still_works(http, super_token):
    """Find the most recent online application and patch its mobile number."""
    if not created_student["id"]:
        pytest.skip("no created student to patch")
    headers = {"Authorization": f"Bearer {super_token}"}
    # Get the student detail to fetch the linked application id
    r = http.get(f"{BASE_URL}/api/students/{created_student['id']}", headers=headers)
    assert r.status_code == 200, r.text
    sdata = r.json()
    app_id = sdata.get("application_id") or (sdata.get("application") or {}).get("id")
    if not app_id:
        # try listing applications
        r2 = http.get(f"{BASE_URL}/api/applications?student_id={created_student['id']}", headers=headers)
        if r2.status_code == 200:
            arr = r2.json() if isinstance(r2.json(), list) else r2.json().get("applications", [])
            if arr:
                app_id = arr[0].get("id") or arr[0].get("_id")
    if not app_id:
        pytest.skip("could not resolve application id from student record")
    patch = {"basic_info": {"mobile_number": "9123456780"}}
    r = http.patch(f"{BASE_URL}/api/applications/{app_id}", json=patch, headers=headers)
    assert r.status_code in (200, 204), f"PATCH failed: {r.status_code} {r.text}"


# ---------- Backend PDF renderer ----------
def test_backend_pdf_renderer(super_token, http):
    """Invoke render_application_pdf via subprocess to verify PDF magic + size."""
    if not created_student["id"]:
        pytest.skip("no student id")
    sid = created_student["id"]
    script = f"""
import asyncio, sys
sys.path.insert(0, '/app/backend')
from db import db
from lib.application_pdf import render_application_pdf

async def main():
    student = await db.students.find_one({{'id': '{sid}'}})
    if not student:
        print('NO_STUDENT'); return
    app = await db.applications.find_one({{'student_id': '{sid}'}})
    if not app:
        # try by id
        app = await db.applications.find_one({{'id': student.get('application_id')}})
    if not app:
        print('NO_APP'); return
    try:
        result = render_application_pdf(student, app)
        if asyncio.iscoroutine(result):
            data = await result
        else:
            data = result
    except Exception as e:
        print('ERR:' + repr(e)); return
    if isinstance(data, (bytes, bytearray)):
        print('LEN', len(data), 'MAGIC', data[:5].decode('latin-1', errors='replace'))
    else:
        print('TYPE', type(data).__name__)

asyncio.run(main())
"""
    import subprocess
    r = subprocess.run(["python", "-c", script], capture_output=True, text=True, cwd="/app/backend")
    out = (r.stdout + r.stderr).strip()
    print("PDF_RENDER_OUTPUT:", out)
    assert "%PDF" in out, f"PDF magic not found in renderer output: {out}"
    # parse LEN
    import re
    m = re.search(r"LEN (\d+)", out)
    assert m and int(m.group(1)) > 1000, f"PDF size too small or missing: {out}"


# ---------- Paste application admin endpoint (no declaration) ----------
def test_paste_application_admin_without_declaration(http, super_token):
    """POST /api/applications/admin should succeed without declaration field."""
    payload = _valid_payload(college="Paste Test College")
    # remove declaration to simulate older clients
    payload.pop("declaration", None)
    r = http.post(
        f"{BASE_URL}/api/applications/admin",
        json=payload,
        headers={"Authorization": f"Bearer {super_token}"},
    )
    assert r.status_code in (200, 201), f"paste admin failed: {r.status_code} {r.text}"
    body = r.json()
    assert body.get("reference_code") or body.get("student_id") or body.get("id"), body


# ---------- Cleanup ----------
@pytest.fixture(scope="module", autouse=True)
def _cleanup(http):
    yield
    # best-effort: delete TEST_ students
    try:
        token = _login(http, SUPER_EMAIL, SUPER_PASSWORD)
        h = {"Authorization": f"Bearer {token}"}
        r = http.get(f"{BASE_URL}/api/students", headers=h)
        if r.status_code == 200:
            arr = r.json() if isinstance(r.json(), list) else r.json().get("students", [])
            for s in arr:
                name = (s.get("name") or s.get("student_full_name") or "")
                if name.startswith("TEST_Arya"):
                    sid = s.get("id") or s.get("_id")
                    if sid:
                        http.delete(f"{BASE_URL}/api/students/{sid}", headers=h)
    except Exception as e:
        print("cleanup error:", e)
