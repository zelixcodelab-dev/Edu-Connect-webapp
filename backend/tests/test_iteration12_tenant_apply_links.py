"""Per-client public application links (/<slug>/apply) — X-Tenant-Slug binding,
owner slug editing, /auth/me tenant_slug and cross-tenant isolation."""
from __future__ import annotations

import uuid

import pytest
import requests

from tests._creds import api_base

API = api_base()
ZELIX_SLUG = "zelix-ventures"


def _login(email, pwd):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": pwd}, timeout=15)
    assert r.status_code == 200, r.text
    d = r.json()
    return d.get("access_token") or d.get("token")


def _h(t):
    return {"Authorization": f"Bearer {t}"}


@pytest.fixture(scope="module")
def owner():
    return _login("owner@educonnect.app", "Owner@12345")


@pytest.fixture(scope="module")
def admin():
    return _login("admin@educonnect.app", "Admin@12345")


@pytest.fixture(scope="module")
def zelix_id(owner):
    r = requests.get(f"{API}/platform/tenants", headers=_h(owner), timeout=15)
    d = r.json()
    lst = d if isinstance(d, list) else d.get("tenants", [])
    return next(t["id"] for t in lst if t.get("slug") == ZELIX_SLUG)


@pytest.fixture(scope="module")
def second(owner):
    email = f"test_iso_{uuid.uuid4().hex[:6]}@example.com"
    pwd = "IsoPass@123"
    r = requests.post(f"{API}/platform/tenants", headers=_h(owner), json={
        "name": "TEST Isolation Co", "admin_email": email, "admin_password": pwd}, timeout=30)
    assert r.status_code == 201, r.text
    t = r.json()
    yield {"id": t["id"], "slug": t["slug"], "email": email, "pwd": pwd}
    requests.delete(f"{API}/platform/tenants/{t['id']}", headers=_h(owner), timeout=30)


def _payload(name):
    return {
        "basic_info": {"student_full_name": name, "mobile_number": "9988776655",
                       "email": "iso.test@example.com", "date_of_birth": "2005-01-01", "gender": "female"},
        "course": {"interested_course": "BCA", "preferred_college": "Test College",
                   "academic_year": "2026-2027", "admission_type": "management"},
        "communication": {"father_name": "Dad", "father_mobile": "9988776644", "address_line_1": "1 Test",
                          "city": "Bangalore", "state": "Karnataka", "pincode": "560001"},
        "academic": {"tenth": {"register_number": "100001"}, "twelfth": {"register_number": "200002"}},
        "payment": {"registration_amount": 500, "payment_date": "2026-01-20"},
        "reference": {"name": "Walk-in", "contact_number": ""},
        "declaration": {"agreement_accepted": True},
    }


# --- Public endpoints + X-Tenant-Slug ---
class TestPublicSlugBinding:
    @pytest.mark.parametrize("path", ["courses", "colleges", "referrer/suhail"])
    def test_valid_slug(self, path):
        r = requests.get(f"{API}/public/{path}", headers={"X-Tenant-Slug": ZELIX_SLUG}, timeout=15)
        assert r.status_code == 200, r.text

    @pytest.mark.parametrize("path", ["courses", "colleges", "referrer/suhail"])
    def test_unknown_slug_404(self, path):
        r = requests.get(f"{API}/public/{path}", headers={"X-Tenant-Slug": "nope-co"}, timeout=15)
        assert r.status_code == 404
        assert r.json()["detail"] == "This application link is not valid"

    def test_unknown_slug_post_404(self):
        r = requests.post(f"{API}/public/applications", headers={"X-Tenant-Slug": "nope-co"},
                          json=_payload("TEST_x"), timeout=15)
        assert r.status_code == 404

    def test_no_header_default(self):
        r = requests.get(f"{API}/public/courses", timeout=15)
        assert r.status_code == 200
        assert "courses" in r.json()

    def test_slug_case_insensitive(self):
        r = requests.get(f"{API}/public/courses", headers={"X-Tenant-Slug": "ZELIX-Ventures"}, timeout=15)
        assert r.status_code == 200


# --- /auth/me ---
def test_me_has_tenant_slug(admin):
    r = requests.get(f"{API}/auth/me", headers=_h(admin), timeout=15)
    assert r.json().get("tenant_slug") == ZELIX_SLUG


# --- Owner slug editing ---
class TestSlugPatch:
    @pytest.mark.parametrize("bad", ["ab", "api", "apply", "login", "platform", "admin", "!!"])
    def test_reject_short_or_reserved(self, owner, second, bad):
        r = requests.patch(f"{API}/platform/tenants/{second['id']}", headers=_h(owner), json={"slug": bad}, timeout=15)
        assert r.status_code == 400, f"{bad}: {r.status_code} {r.text}"

    def test_duplicate_409(self, owner, second):
        r = requests.patch(f"{API}/platform/tenants/{second['id']}", headers=_h(owner), json={"slug": ZELIX_SLUG}, timeout=15)
        assert r.status_code == 409

    def test_slugify_and_persist(self, owner, second):
        r = requests.patch(f"{API}/platform/tenants/{second['id']}", headers=_h(owner),
                           json={"slug": "  Test Iso Co!! "}, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["slug"] == "test-iso-co"
        second["slug"] = "test-iso-co"
        g = requests.get(f"{API}/public/courses", headers={"X-Tenant-Slug": "test-iso-co"}, timeout=15)
        assert g.status_code == 200

    def test_tenant_admin_cannot_patch(self, admin, zelix_id):
        r = requests.patch(f"{API}/platform/tenants/{zelix_id}", headers=_h(admin), json={"slug": "hacked-co"}, timeout=15)
        assert r.status_code in (401, 403)

    def test_suspended_403_then_restore(self, owner, second):
        r = requests.patch(f"{API}/platform/tenants/{second['id']}", headers=_h(owner), json={"status": "suspended"}, timeout=15)
        assert r.status_code == 200
        g = requests.get(f"{API}/public/courses", headers={"X-Tenant-Slug": second["slug"]}, timeout=15)
        assert g.status_code == 403
        requests.patch(f"{API}/platform/tenants/{second['id']}", headers=_h(owner), json={"status": "active"}, timeout=15)


# --- Isolation: an application via second tenant's slug lands only there ---
def test_isolation_submit(owner, admin, second):
    r = requests.post(f"{API}/public/applications", headers={"X-Tenant-Slug": second["slug"]},
                      json=_payload("TEST_Iso Student"), timeout=20)
    if r.status_code == 429:
        pytest.skip("rate limited")
    assert r.status_code == 201, r.text
    sid = r.json()["id"]
    z = requests.get(f"{API}/students/{sid}", headers=_h(admin), timeout=15)
    assert z.status_code == 404, f"leaked into zelix: {z.status_code}"
    t2 = _login(second["email"], second["pwd"])
    s = requests.get(f"{API}/students/{sid}", headers=_h(t2), timeout=15)
    assert s.status_code == 200, s.text
