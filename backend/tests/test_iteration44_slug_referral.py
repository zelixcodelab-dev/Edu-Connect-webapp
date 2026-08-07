"""Iteration 44 — Slug referral URL tests.

Covers:
- GET /api/public/referrer/{slug} for both name-slug and UUID lookups
- Creating a fresh client + linked user for the frontend Playwright test
- End-to-end attribution via slug through /api/public/applications
"""
import os
import uuid
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/") or "https://finance-flow-1727.preview.emergentagent.com"
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "admin@kmfoundation.online"
ADMIN_PASS = "Admin@786"
STAFF_EMAIL = "staff.blr@kmfoundation.online"
STAFF_PASS = "Staff@123"

TEST_TAG = uuid.uuid4().hex[:8]
LINKED_USER_EMAIL = f"slugtest+{TEST_TAG}@kmf.co"
LINKED_USER_PASS = "SlugTest@123"
CLIENT_NAME = f"Slug Test Agent {TEST_TAG}"
# The slug returned by backend slugify() for the above name:
EXPECTED_CLIENT_SLUG = f"slug-test-agent-{TEST_TAG}"


@pytest.fixture(scope="module")
def admin_session():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASS}, timeout=15)
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text[:200]}"
    return s


@pytest.fixture(scope="module")
def new_client(admin_session):
    """Create a fresh sub_agent_associate client used across tests."""
    payload = {
        "name": CLIENT_NAME,
        "client_type": "sub_agent_associate",
        "phone": "9876543210",
        "email": f"agent+{TEST_TAG}@kmf.co",
    }
    r = admin_session.post(f"{API}/clients", json=payload, timeout=15)
    assert r.status_code in (200, 201), f"client create failed: {r.status_code} {r.text[:300]}"
    data = r.json()
    assert "id" in data
    yield data
    # cleanup
    try:
        admin_session.delete(f"{API}/clients/{data['id']}", timeout=15)
    except Exception:
        pass


@pytest.fixture(scope="module")
def linked_user(admin_session, new_client):
    """Create a linked user account bound to new_client."""
    payload = {
        "name": "Slug Test User",
        "email": LINKED_USER_EMAIL,
        "password": LINKED_USER_PASS,
        "role": "user",
        "linked_client_id": new_client["id"],
    }
    r = admin_session.post(f"{API}/users", json=payload, timeout=15)
    assert r.status_code in (200, 201), f"user create failed: {r.status_code} {r.text[:300]}"
    data = r.json()
    yield data
    try:
        admin_session.delete(f"{API}/users/{data['id']}", timeout=15)
    except Exception:
        pass


# -------- referrer slug resolution --------

class TestReferrerSlug:
    def test_gibi_philip_slug(self):
        r = requests.get(f"{API}/public/referrer/gibi-philip", timeout=15)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        assert d["slug"] == "gibi-philip"
        assert d["name"].strip().lower() == "gibi philip"
        assert "id" in d

    def test_og_academy_slug(self):
        r = requests.get(f"{API}/public/referrer/og-academy", timeout=15)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        assert d["slug"] == "og-academy"
        assert "id" in d

    def test_uuid_lookup_legacy(self):
        # GIBI PHILIP known id per task spec
        r = requests.get(f"{API}/public/referrer/16717581-3c15-4a28-b907-feb0c338b5e5", timeout=15)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        assert d["id"] == "16717581-3c15-4a28-b907-feb0c338b5e5"
        assert d["slug"] == "gibi-philip"

    def test_unknown_slug_404(self):
        r = requests.get(f"{API}/public/referrer/nonexistent-slug-xyz-12345", timeout=15)
        assert r.status_code == 404

    def test_new_client_slug_resolves(self, new_client):
        r = requests.get(f"{API}/public/referrer/{EXPECTED_CLIENT_SLUG}", timeout=15)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        assert d["id"] == new_client["id"]
        assert d["slug"] == EXPECTED_CLIENT_SLUG


# -------- linked-user attribution end-to-end --------

class TestSlugAttribution:
    def test_linked_user_can_login(self, linked_user):
        s = requests.Session()
        r = s.post(f"{API}/auth/login", json={"email": LINKED_USER_EMAIL, "password": LINKED_USER_PASS}, timeout=15)
        assert r.status_code == 200, r.text[:300]
        me = s.get(f"{API}/auth/me", timeout=15).json()
        assert me["role"] == "user"
        assert me.get("linked_client_id")
        assert me.get("linked_client_name") == CLIENT_NAME

    def test_submit_application_with_slug_ref(self, linked_user):
        # POST /api/public/applications with referrer_id = slug
        payload = {
            "referrer_id": EXPECTED_CLIENT_SLUG,
            "basic_info": {
                "student_full_name": f"SlugStudent {TEST_TAG}",
                "mobile_number": "9998887777",
                "email": f"student+{TEST_TAG}@kmf.co",
                "date_of_birth": "2004-01-15",
                "gender": "male",
                "aadhaar_number": "",
                "nationality": "Indian",
                "religion": "",
                "caste": "",
            },
            "course": {
                "preferred_college": "Some College",
                "interested_course": "B.Tech",
                "academic_year": "2026-2027",
                "admission_type": "management",
            },
            "communication": {
                "father_name": "Dad Test",
                "father_mobile": "9998887771",
                "mother_name": "",
                "mother_mobile": "",
                "address_line_1": "Test address",
                "address_line_2": "",
                "city": "Kochi",
                "state": "Kerala",
                "pincode": "682001",
            },
            "academic": {
                "tenth": {"register_number": "", "school_name": "", "school_place": "", "board": "", "year_of_passing": "", "percentage": ""},
                "twelfth": {"register_number": f"REG{TEST_TAG}", "school_name": "12th School", "school_place": "Kochi", "board": "CBSE", "year_of_passing": "2022", "percentage": "85"},
            },
            "payment": {"registration_amount": 0, "payment_date": ""},
            "reference": {"name": CLIENT_NAME, "contact_number": "9876543210"},
            "declaration": {"agreement_accepted": True},
        }
        r = requests.post(f"{API}/public/applications", json=payload, timeout=30)
        assert r.status_code in (200, 201), f"submit failed: {r.status_code} {r.text[:400]}"
        data = r.json()
        assert data.get("id")

    def test_linked_user_sees_new_student(self, linked_user):
        s = requests.Session()
        s.post(f"{API}/auth/login", json={"email": LINKED_USER_EMAIL, "password": LINKED_USER_PASS}, timeout=15)
        r = s.get(f"{API}/students", timeout=15)
        assert r.status_code == 200
        students = r.json()
        # Attribution via reference name match
        names = [str(st.get("name") or "").lower() for st in students]
        assert any(f"slugstudent {TEST_TAG}".lower() in n for n in names), (
            f"New student not attributed to linked user. Got {len(students)} students, names sample: {names[:5]}"
        )


# -------- regression: staff login still works --------

class TestStaffRegression:
    def test_staff_login(self):
        s = requests.Session()
        r = s.post(f"{API}/auth/login", json={"email": STAFF_EMAIL, "password": STAFF_PASS}, timeout=15)
        assert r.status_code == 200, r.text[:300]
        me = s.get(f"{API}/auth/me", timeout=15).json()
        assert me["role"] == "staff"
