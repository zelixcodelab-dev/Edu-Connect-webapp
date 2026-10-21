# Iteration 2: SaaS login, module gating (per-tenant switches), product tour, ported KMConnect endpoints
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
TENANT_ID = "3b5e3f1f-dba9-4a89-a201-c2fdb24372ef"
NEW_MODS = ["academic_year", "google_sheets", "passkeys", "pin_lock", "sc_report", "celebrations", "product_tour", "attendance"]


def _login(email, pw):
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": pw}, timeout=30)
    assert r.status_code == 200, r.text
    d = r.json()
    tok = d.get("access_token") or d.get("token")
    assert tok
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {tok}"})
    return s, d


@pytest.fixture(scope="module")
def admin():
    return _login("admin@educonnect.app", "Admin@12345")[0]


@pytest.fixture(scope="module")
def owner():
    return _login("owner@educonnect.app", "Owner@12345")[0]


@pytest.fixture(scope="module")
def full_modules(owner):
    r = owner.get(f"{BASE_URL}/api/platform/tenants/{TENANT_ID}")
    assert r.status_code == 200, r.text
    mods = r.json().get("enabled_modules") or r.json().get("tenant", {}).get("enabled_modules")
    assert mods
    yield list(mods)
    # always restore
    owner.patch(f"{BASE_URL}/api/platform/tenants/{TENANT_ID}", json={"enabled_modules": list(mods)})


# --- Auth ---
class TestAuth:
    def test_admin_me(self, admin):
        r = admin.get(f"{BASE_URL}/api/auth/me")
        assert r.status_code == 200
        d = r.json()
        assert d["scope"] == "tenant"
        for k in NEW_MODS:
            assert k in d["enabled_modules"], k
        assert "pin_enabled" in d and "biometric_enabled" in d

    def test_owner_login_platform_scope(self):
        _, d = _login("owner@educonnect.app", "Owner@12345")
        u = d.get("user", {})
        assert u.get("scope") == "platform" or d.get("scope") == "platform"

    def test_staff_login(self):
        _, d = _login("TEST_att_staff_1@educonnect.app", "Staff@12345")
        assert (d.get("user") or d).get("role") == "staff"


# --- Product tour ---
class TestTour:
    def test_tour_invalid_status(self, admin):
        r = admin.post(f"{BASE_URL}/api/auth/tour", json={"status": "bogus"})
        assert r.status_code == 422

    def test_tour_skip_persists(self, admin):
        r = admin.post(f"{BASE_URL}/api/auth/tour", json={"status": "skipped"})
        assert r.status_code == 200 and r.json()["tour_status"] == "skipped"
        me = admin.get(f"{BASE_URL}/api/auth/me").json()
        assert me.get("tour_status") == "skipped"


# --- Ported endpoints ---
class TestPorted:
    @pytest.mark.parametrize("path", [
        "/api/transactions/sc-payouts",
        "/api/students/sc-by-college",
        "/api/attendance/today",
        "/api/academic-years",
        "/api/dashboard/summary",
        "/api/students",
        "/api/leads",
        "/api/invoices",
        "/api/transactions",
        "/api/accounts",
    ])
    def test_get_200(self, admin, path):
        r = admin.get(f"{BASE_URL}{path}")
        assert r.status_code == 200, f"{path}: {r.status_code} {r.text[:200]}"


# --- Module gating ---
class TestModuleGate:
    def _set(self, owner, mods):
        r = owner.patch(f"{BASE_URL}/api/platform/tenants/{TENANT_ID}", json={"enabled_modules": mods})
        assert r.status_code == 200, r.text
        return r

    @pytest.mark.parametrize("mod,path", [
        ("attendance", "/api/attendance/today"),
        ("sc_report", "/api/students/sc-by-college"),
        ("academic_year", "/api/academic-years"),
    ])
    def test_module_off_returns_403(self, owner, admin, full_modules, mod, path):
        self._set(owner, [m for m in full_modules if m != mod])
        try:
            r = admin.get(f"{BASE_URL}{path}")
            assert r.status_code == 403, f"{path}: {r.status_code}"
            me = admin.get(f"{BASE_URL}/api/auth/me").json()
            assert mod not in me["enabled_modules"]
        finally:
            self._set(owner, full_modules)
        r = admin.get(f"{BASE_URL}{path}")
        assert r.status_code == 200
