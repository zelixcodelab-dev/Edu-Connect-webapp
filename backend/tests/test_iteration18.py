"""Iteration 18 backend tests:
- Super admin /api/clients aggregates from all users; office_admin docs get _creator_name/_creator_office
- Super admin /api/students aggregates from all users; office_admin docs get _creator_name/_creator_office
- Office admin /api/clients and /api/students still scoped to own user_id
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
SUPER = {"email": "admin@finflow.com", "password": "Admin@123"}
OFFICE = {"email": "blr1@finflow.com", "password": "Office@123"}


def _login(creds):
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json=creds, timeout=15)
    assert r.status_code == 200, f"login failed for {creds['email']}: {r.status_code} {r.text}"
    return s


@pytest.fixture(scope="module")
def super_client():
    return _login(SUPER)


@pytest.fixture(scope="module")
def office_client():
    return _login(OFFICE)


# ----- Clients aggregation -----
class TestClientsAggregation:
    def test_super_admin_sees_office_admin_clients(self, super_client, office_client):
        # Get office_admin's own clients
        own = office_client.get(f"{BASE_URL}/api/clients", timeout=15)
        assert own.status_code == 200
        own_ids = {c["id"] for c in own.json()}
        # Super admin must include all those IDs
        all_resp = super_client.get(f"{BASE_URL}/api/clients", timeout=15)
        assert all_resp.status_code == 200
        all_data = all_resp.json()
        all_ids = {c["id"] for c in all_data}
        missing = own_ids - all_ids
        assert not missing, f"super_admin missing office_admin clients: {missing}"

    def test_creator_attribution_on_office_admin_clients(self, super_client):
        all_resp = super_client.get(f"{BASE_URL}/api/clients", timeout=15)
        assert all_resp.status_code == 200
        docs = all_resp.json()
        office_owned = [d for d in docs if d.get("_creator_office")]
        assert len(office_owned) >= 1, "expected at least one office-admin-owned client (Ravi Kumar)"
        for d in office_owned:
            assert d.get("_creator_name"), f"missing _creator_name on {d.get('name')}"
            assert d.get("_creator_office", "").startswith("KM_"), \
                f"_creator_office should look like KM_BLR; got {d.get('_creator_office')}"

    def test_super_admin_own_clients_have_no_creator_fields(self, super_client):
        # Create a super-admin-owned client; verify it doesn't pick up creator fields.
        payload = {"name": "TEST_SA_Client_Iter18", "client_type": "sub_agent_associate", "company": "ZZZ"}
        cr = super_client.post(f"{BASE_URL}/api/clients", json=payload, timeout=15)
        assert cr.status_code in (200, 201), cr.text
        cid = cr.json()["id"]
        try:
            resp = super_client.get(f"{BASE_URL}/api/clients", timeout=15)
            assert resp.status_code == 200
            this = next((c for c in resp.json() if c["id"] == cid), None)
            assert this is not None, "super_admin client not visible"
            assert "_creator_name" not in this, "super_admin's own client must not have _creator_name"
            assert "_creator_office" not in this, "super_admin's own client must not have _creator_office"
        finally:
            super_client.delete(f"{BASE_URL}/api/clients/{cid}", timeout=15)

    def test_office_admin_scope_unchanged(self, office_client):
        resp = office_client.get(f"{BASE_URL}/api/clients", timeout=15)
        assert resp.status_code == 200
        docs = resp.json()
        # No _creator_name should appear in office_admin view (they only see own docs)
        for d in docs:
            assert "_creator_name" not in d, f"office_admin should not see creator field: {d}"


# ----- Students aggregation -----
class TestStudentsAggregation:
    def test_super_admin_sees_office_admin_students(self, super_client, office_client):
        own = office_client.get(f"{BASE_URL}/api/students", timeout=15)
        assert own.status_code == 200
        own_ids = {s["id"] for s in own.json()}
        all_resp = super_client.get(f"{BASE_URL}/api/students", timeout=15)
        assert all_resp.status_code == 200
        all_ids = {s["id"] for s in all_resp.json()}
        missing = own_ids - all_ids
        assert not missing, f"super_admin missing office_admin students: {missing}"

    def test_creator_attribution_on_office_admin_students(self, super_client):
        all_resp = super_client.get(f"{BASE_URL}/api/students", timeout=15)
        assert all_resp.status_code == 200
        docs = all_resp.json()
        office_owned = [d for d in docs if d.get("_creator_office")]
        assert len(office_owned) >= 1, "expected at least one office-admin-enrolled student"
        for d in office_owned:
            assert d.get("_creator_name"), f"missing _creator_name on student {d.get('name')}"
            assert d.get("_creator_office", "").startswith("KM_")

    def test_super_admin_aggregated_summary_fields(self, super_client):
        resp = super_client.get(f"{BASE_URL}/api/students", timeout=15)
        assert resp.status_code == 200
        docs = resp.json()
        # Summary fields must be present on each student
        for d in docs[:10]:
            assert "collected_total" in d, f"missing collected_total on {d.get('name')}"
            assert "balance_vs_sc" in d, f"missing balance_vs_sc on {d.get('name')}"

    def test_office_admin_students_scope_unchanged(self, office_client):
        resp = office_client.get(f"{BASE_URL}/api/students", timeout=15)
        assert resp.status_code == 200
        for d in resp.json():
            assert "_creator_name" not in d
