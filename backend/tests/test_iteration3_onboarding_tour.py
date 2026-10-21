# Iteration 3: Custom tour steps (platform), onboarding checklist (tenant), tour insights, module gating
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
TENANT_ID = "3b5e3f1f-dba9-4a89-a201-c2fdb24372ef"
DEFAULT_IDS = ["welcome", "nav", "year", "students", "leads", "attendance", "messages", "team", "profile", "done"]


def _login(email, pw):
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": pw}, timeout=30)
    assert r.status_code == 200, r.text
    d = r.json()
    tok = d.get("access_token") or d.get("token")
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {tok}"})
    return s


@pytest.fixture(scope="module")
def owner():
    return _login("owner@educonnect.app", "Owner@12345")


@pytest.fixture(scope="module")
def admin():
    return _login("admin@educonnect.app", "Admin@12345")


@pytest.fixture(scope="module")
def staff():
    return _login("TEST_att_staff_1@educonnect.app", "Staff@12345")


@pytest.fixture(scope="module", autouse=True)
def restore(owner):
    r = owner.get(f"{BASE_URL}/api/platform/tenants/{TENANT_ID}")
    mods = r.json().get("enabled_modules") or r.json().get("tenant", {}).get("enabled_modules")
    yield
    owner.patch(f"{BASE_URL}/api/platform/tenants/{TENANT_ID}", json={"enabled_modules": list(mods)})
    owner.delete(f"{BASE_URL}/api/platform/tenants/{TENANT_ID}/tour")


# --- Platform tour editor ---
class TestTourEditor:
    def test_get_default(self, owner):
        owner.delete(f"{BASE_URL}/api/platform/tenants/{TENANT_ID}/tour")
        r = owner.get(f"{BASE_URL}/api/platform/tenants/{TENANT_ID}/tour")
        assert r.status_code == 200
        d = r.json()
        assert [s["id"] for s in d["steps"]] == DEFAULT_IDS
        assert d["customized"] is False
        assert set(d["stats"]) >= {"completed", "skipped", "not_started", "total"}
        assert isinstance(d["users"], list) and len(d["users"]) == d["stats"]["total"]
        assert all(u["tour_status"] in ("completed", "skipped", "not_started") for u in d["users"])

    def test_save_custom_and_tenant_sees_it(self, owner, admin):
        steps = owner.get(f"{BASE_URL}/api/platform/tenants/{TENANT_ID}/tour").json()["steps"]
        steps[0]["title"] = "TEST_Welcome ZELIX"
        for s in steps:
            if s["id"] == "messages":
                s["enabled"] = False
        # move leads before students
        i, j = DEFAULT_IDS.index("students"), DEFAULT_IDS.index("leads")
        steps[i], steps[j] = steps[j], steps[i]
        steps.insert(len(steps) - 1, {"id": "custom-test1", "title": "TEST_Custom", "body": "Hello", "enabled": True})
        payload = {"steps": [{k: s[k] for k in ("id", "title", "body", "enabled")} for s in steps]}
        r = owner.put(f"{BASE_URL}/api/platform/tenants/{TENANT_ID}/tour", json=payload)
        assert r.status_code == 200, r.text
        assert r.json()["customized"] is True
        g = owner.get(f"{BASE_URL}/api/platform/tenants/{TENANT_ID}/tour").json()
        assert g["customized"] is True
        assert g["steps"][0]["title"] == "TEST_Welcome ZELIX"
        cust = [s for s in g["steps"] if s["id"] == "custom-test1"][0]
        assert cust["custom"] is True
        # tenant side
        t = admin.get(f"{BASE_URL}/api/onboarding/tour")
        assert t.status_code == 200
        ids = [s["id"] for s in t.json()["steps"]]
        assert "messages" not in ids
        assert ids[0] == "welcome" and ids[-1] == "done" and ids[-2] == "custom-test1"
        assert ids.index("leads") < ids.index("students")
        assert t.json()["steps"][0]["title"] == "TEST_Welcome ZELIX"

    def test_save_validation(self, owner):
        r = owner.put(f"{BASE_URL}/api/platform/tenants/{TENANT_ID}/tour", json={"steps": []})
        assert r.status_code == 400
        r = owner.put(f"{BASE_URL}/api/platform/tenants/{TENANT_ID}/tour", json={"steps": [{"id": "x", "title": ""}]})
        assert r.status_code == 422

    def test_unknown_tenant_404(self, owner):
        r = owner.get(f"{BASE_URL}/api/platform/tenants/nope-123/tour")
        assert r.status_code == 404

    def test_tenant_admin_cannot_edit(self, admin):
        r = admin.get(f"{BASE_URL}/api/platform/tenants/{TENANT_ID}/tour")
        assert r.status_code in (401, 403)

    def test_replay_for_all(self, owner, admin):
        admin.post(f"{BASE_URL}/api/auth/tour", json={"status": "skipped"})
        r = owner.post(f"{BASE_URL}/api/platform/tenants/{TENANT_ID}/tour/reset-users")
        assert r.status_code == 200 and r.json()["ok"] is True
        d = owner.get(f"{BASE_URL}/api/platform/tenants/{TENANT_ID}/tour").json()
        assert d["stats"]["completed"] == 0 and d["stats"]["skipped"] == 0
        assert admin.get(f"{BASE_URL}/api/auth/me").json().get("tour_status") in (None, "")
        admin.post(f"{BASE_URL}/api/auth/tour", json={"status": "completed"})
        d = owner.get(f"{BASE_URL}/api/platform/tenants/{TENANT_ID}/tour").json()
        assert d["stats"]["completed"] == 1

    def test_reset_default(self, owner, admin):
        r = owner.delete(f"{BASE_URL}/api/platform/tenants/{TENANT_ID}/tour")
        assert r.status_code == 200 and r.json()["customized"] is False
        ids = [s["id"] for s in admin.get(f"{BASE_URL}/api/onboarding/tour").json()["steps"]]
        assert ids == DEFAULT_IDS

    def test_client_list_has_tour_stats(self, owner):
        r = owner.get(f"{BASE_URL}/api/platform/tenants")
        assert r.status_code == 200
        d = r.json()
        rows = d if isinstance(d, list) else (d.get("tenants") or d.get("items") or [])
        row = [t for t in rows if t.get("id") == TENANT_ID][0]
        tour = (row.get("stats") or {}).get("tour") or row.get("tour")
        assert tour and {"completed", "skipped", "not_started"} <= set(tour)


# --- Onboarding checklist ---
class TestChecklist:
    def test_admin_checklist(self, admin):
        r = admin.get(f"{BASE_URL}/api/onboarding/checklist")
        assert r.status_code == 200
        d = r.json()
        keys = [i["key"] for i in d["items"]]
        assert keys == ["first_student", "invite_staff", "first_lead", "first_payment", "google_sheets", "branding"]
        links = {i["key"]: i["to"] for i in d["items"]}
        assert links["invite_staff"] == "/users" and links["branding"] == "/branding" and links["google_sheets"] == "/settings"
        assert d["total"] == 6 and d["done"] == sum(i["done"] for i in d["items"])

    def test_staff_checklist(self, staff):
        r = staff.get(f"{BASE_URL}/api/onboarding/checklist")
        assert r.status_code == 200
        assert [i["key"] for i in r.json()["items"]] == ["first_student", "first_lead", "first_payment"]

    def test_owner_checklist_no_crash(self, owner):
        r = owner.get(f"{BASE_URL}/api/onboarding/checklist")
        assert r.status_code < 500


# --- Module gating ---
class TestModules:
    def _mods(self, owner):
        r = owner.get(f"{BASE_URL}/api/platform/tenants/{TENANT_ID}")
        return r.json().get("enabled_modules") or r.json().get("tenant", {}).get("enabled_modules")

    def test_onboarding_off(self, owner, admin):
        mods = self._mods(owner)
        assert "onboarding" in mods
        owner.patch(f"{BASE_URL}/api/platform/tenants/{TENANT_ID}", json={"enabled_modules": [m for m in mods if m != "onboarding"]})
        try:
            assert admin.get(f"{BASE_URL}/api/onboarding/checklist").status_code == 403
            assert admin.post(f"{BASE_URL}/api/onboarding/checklist/dismiss").status_code == 403
            assert admin.get(f"{BASE_URL}/api/onboarding/tour").status_code == 200
        finally:
            owner.patch(f"{BASE_URL}/api/platform/tenants/{TENANT_ID}", json={"enabled_modules": mods})
        assert admin.get(f"{BASE_URL}/api/onboarding/checklist").status_code == 200

    def test_product_tour_off(self, owner, admin):
        mods = self._mods(owner)
        owner.patch(f"{BASE_URL}/api/platform/tenants/{TENANT_ID}", json={"enabled_modules": [m for m in mods if m != "product_tour"]})
        try:
            assert admin.get(f"{BASE_URL}/api/onboarding/tour").status_code == 403
        finally:
            owner.patch(f"{BASE_URL}/api/platform/tenants/{TENANT_ID}", json={"enabled_modules": mods})
        assert admin.get(f"{BASE_URL}/api/onboarding/tour").status_code == 200
