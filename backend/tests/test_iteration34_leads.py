"""Iteration 34 — Leads CRM + Staff role end-to-end backend tests."""
import os
import io
import time
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://finance-flow-1727.preview.emergentagent.com").rstrip("/")

SUPER = {"email": "admin@kmfoundation.online", "password": "Admin@786"}
OFFICE = {"email": "blr1@finflow.com", "password": "Office@123"}
STAFF = {"email": "staff.blr@kmfoundation.online", "password": "Staff@123"}


def _login(creds):
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json=creds, timeout=20)
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


# ---------- Staff role creation (privilege escalation guards) ----------
class TestStaffCreation:
    def test_office_admin_creates_staff(self, office_s):
        email = f"TEST_staff_{int(time.time())}@example.com"
        r = office_s.post(f"{BASE_URL}/api/users", json={
            "email": email, "password": "Pass@1234",
            "name": "TEST Staff One", "role": "staff", "office": "KM_TCR",  # should be forced to KM_BLR
        })
        assert r.status_code == 201, r.text
        body = r.json()
        assert body["role"] == "staff"
        assert body["office"] == "KM_BLR", f"office should be forced, got {body.get('office')}"
        # Cleanup
        office_s.delete(f"{BASE_URL}/api/users/{body['id']}")

    @pytest.mark.parametrize("role", ["office_admin", "super_admin", "user"])
    def test_office_admin_cannot_create_other_roles(self, office_s, role):
        r = office_s.post(f"{BASE_URL}/api/users", json={
            "email": f"TEST_block_{role}_{int(time.time())}@ex.com",
            "password": "Pass@1234", "name": "X", "role": role,
            "office": "KM_BLR",
        })
        assert r.status_code == 403, f"expected 403 for role={role}, got {r.status_code}: {r.text}"

    def test_super_admin_creates_staff_any_office(self, super_s):
        email = f"TEST_sa_staff_{int(time.time())}@example.com"
        r = super_s.post(f"{BASE_URL}/api/users", json={
            "email": email, "password": "Pass@1234",
            "name": "TEST SA Staff", "role": "staff", "office": "KM_TCR",
        })
        assert r.status_code == 201, r.text
        body = r.json()
        assert body["office"] == "KM_TCR"
        super_s.delete(f"{BASE_URL}/api/users/{body['id']}")


# ---------- List staff & assignable scoping ----------
class TestStaffListing:
    def test_office_admin_sees_only_own_office_staff(self, office_s):
        r = office_s.get(f"{BASE_URL}/api/users/staff")
        assert r.status_code == 200
        data = r.json()
        assert all(u.get("role") == "staff" for u in data)
        assert all(u.get("office") == "KM_BLR" for u in data)

    def test_super_admin_sees_all_staff(self, super_s):
        r = super_s.get(f"{BASE_URL}/api/users/staff")
        assert r.status_code == 200
        assert all(u.get("role") == "staff" for u in r.json())

    def test_assignable_scoped_for_office(self, office_s):
        r = office_s.get(f"{BASE_URL}/api/users/assignable")
        assert r.status_code == 200
        data = r.json()
        assert all(u.get("office") == "KM_BLR" for u in data)
        roles = {u.get("role") for u in data}
        assert roles.issubset({"staff", "office_admin"})

    def test_assignable_for_super(self, super_s):
        r = super_s.get(f"{BASE_URL}/api/users/assignable")
        assert r.status_code == 200
        assert len(r.json()) >= 1


# ---------- Leads CRUD + scoping ----------
class TestLeadsCRUD:
    @pytest.fixture(scope="class")
    def staff_user_id(self, super_s):
        r = super_s.get(f"{BASE_URL}/api/users/staff")
        for u in r.json():
            if u.get("email") == "staff.blr@kmfoundation.online":
                return u["id"]
        pytest.skip("seed staff missing")

    def test_office_admin_create_lead(self, office_s, staff_user_id):
        r = office_s.post(f"{BASE_URL}/api/leads", json={
            "name": "TEST_Lead_OA",
            "phone": "9999990001",
            "email": "test_lead_oa@example.com",
            "course": "B.Sc",
            "place": "Bangalore",
            "source": "walk_in",
            "status": "new",
            "assigned_to_user_id": staff_user_id,
        })
        assert r.status_code == 201, r.text
        lead = r.json()
        assert lead["assigned_to_user_id"] == staff_user_id
        assert lead["office"] == "KM_BLR"
        pytest.lead_id_oa = lead["id"]

    def test_staff_sees_only_assigned(self, staff_s):
        r = staff_s.get(f"{BASE_URL}/api/leads")
        assert r.status_code == 200
        for ld in r.json():
            assert ld.get("assigned_to_user_id"), ld

    def test_staff_cannot_reassign(self, staff_s):
        r = staff_s.get(f"{BASE_URL}/api/leads")
        leads = r.json()
        if not leads:
            pytest.skip("no leads visible to staff")
        lid = leads[0]["id"]
        r2 = staff_s.patch(f"{BASE_URL}/api/leads/{lid}", json={"assigned_to_user_id": "some-other-id"})
        assert r2.status_code == 403, r2.text

    def test_staff_can_update_status_notes(self, staff_s):
        r = staff_s.get(f"{BASE_URL}/api/leads")
        leads = r.json()
        if not leads:
            pytest.skip("no leads visible to staff")
        lid = leads[0]["id"]
        r2 = staff_s.patch(f"{BASE_URL}/api/leads/{lid}", json={"status": "contacted", "notes": "TEST_notes"})
        assert r2.status_code == 200, r2.text
        assert r2.json()["status"] == "contacted"

    def test_stats_endpoint(self, office_s):
        r = office_s.get(f"{BASE_URL}/api/leads/stats")
        assert r.status_code == 200
        data = r.json()
        assert "total" in data and "by_status" in data and "missed" in data
        for s in ("new", "contacted", "interested", "follow_up", "converted", "lost"):
            assert s in data["by_status"]

    def test_missed_view(self, office_s, staff_user_id):
        # Create lead with past follow-up
        r = office_s.post(f"{BASE_URL}/api/leads", json={
            "name": "TEST_Missed_Lead",
            "source": "walk_in",
            "status": "follow_up",
            "assigned_to_user_id": staff_user_id,
            "next_follow_up": "2020-01-01T10:00:00Z",
        })
        assert r.status_code == 201, r.text
        lid = r.json()["id"]
        m = office_s.get(f"{BASE_URL}/api/leads?view=missed")
        assert m.status_code == 200
        ids = [d["id"] for d in m.json()]
        assert lid in ids
        # cleanup
        office_s.delete(f"{BASE_URL}/api/leads/{lid}")

    def test_followups_add(self, office_s):
        lid = getattr(pytest, "lead_id_oa", None)
        if not lid:
            pytest.skip("no oa lead")
        r = office_s.post(f"{BASE_URL}/api/leads/{lid}/followups", json={
            "at": "2030-01-01T10:00:00Z",
            "note": "TEST_followup",
            "status": "interested",
        })
        assert r.status_code == 201, r.text
        body = r.json()
        assert body["status"] == "interested"
        assert body["next_follow_up"]
        assert any(f.get("note") == "TEST_followup" for f in body.get("follow_ups", []))

    def test_cleanup_oa_lead(self, office_s):
        lid = getattr(pytest, "lead_id_oa", None)
        if lid:
            r = office_s.delete(f"{BASE_URL}/api/leads/{lid}")
            assert r.status_code == 200


# ---------- CSV bulk + template ----------
class TestCSVBulk:
    def test_template(self, office_s):
        r = office_s.get(f"{BASE_URL}/api/leads/template")
        assert r.status_code == 200
        assert "name" in r.text and "phone" in r.text and "email" in r.text

    def test_bulk_upload(self, office_s):
        csv_data = (
            "name,phone,email,course,place,source,notes\n"
            "TEST_Bulk1,9000000001,b1@ex.com,B.Tech,BLR,walk_in,n1\n"
            "TEST_Bulk2,9000000002,b2@ex.com,MBA,BLR,referral,n2\n"
            ",blank,row,should,skip,walk_in,\n"
        )
        files = {"file": ("leads.csv", io.BytesIO(csv_data.encode()), "text/csv")}
        r = office_s.post(f"{BASE_URL}/api/leads/bulk", files=files)
        assert r.status_code == 201, r.text
        body = r.json()
        assert body["created_count"] == 2
        assert 4 in body["skipped_blank_rows"]
        # Cleanup by name search
        listr = office_s.get(f"{BASE_URL}/api/leads", params={"q": "TEST_Bulk"})
        for ld in listr.json():
            if ld["name"].startswith("TEST_Bulk"):
                office_s.delete(f"{BASE_URL}/api/leads/{ld['id']}")
