"""Iteration 10 backend tests:
- Clients: client_type field, address removed
- Students: fees_plan auto-schedule rows + summarize.total_fees
- PATCH fees_plan reconcile (preserve manual + payment-referenced)
"""
import pytest
import requests

from tests._creds import backend_url, admin_credentials

BASE = backend_url().rstrip("/")
EMAIL, PASSWORD = admin_credentials()


@pytest.fixture(scope="module")
def client() -> requests.Session:
    s = requests.Session()
    r = s.post(f"{BASE}/api/auth/login", json={"email": EMAIL, "password": PASSWORD})
    assert r.status_code == 200, r.text
    return s


# ---------- Clients ----------
class TestClients:
    def test_create_client_with_type(self, client) -> None:
        r = client.post(f"{BASE}/api/clients", json={
            "name": "TEST_IT10_SubAgent",
            "client_type": "sub_agent_associate",
            "email": "t1@x.com",
        })
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["name"] == "TEST_IT10_SubAgent"
        assert data["client_type"] == "sub_agent_associate"
        assert "address" not in data
        self.cid = data["id"]

        # Update client_type
        r2 = client.patch(f"{BASE}/api/clients/{data['id']}", json={
            "name": data["name"],
            "client_type": "associate_consultant",
            "email": data.get("email"),
        })
        assert r2.status_code == 200, r2.text
        assert r2.json()["client_type"] == "associate_consultant"

        # Cleanup
        client.delete(f"{BASE}/api/clients/{data['id']}")

    def test_create_client_no_type_optional(self, client) -> None:
        r = client.post(f"{BASE}/api/clients", json={"name": "TEST_IT10_NoType"})
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["client_type"] is None
        client.delete(f"{BASE}/api/clients/{data['id']}")

    def test_invalid_client_type_rejected(self, client) -> None:
        r = client.post(f"{BASE}/api/clients", json={
            "name": "TEST_IT10_BadType",
            "client_type": "junk_value",
        })
        assert r.status_code == 422

    def test_list_clients_returns_legacy_no_type(self, client) -> None:
        # Create then directly read via list
        r = client.post(f"{BASE}/api/clients", json={"name": "TEST_IT10_Legacy"})
        cid = r.json()["id"]
        lr = client.get(f"{BASE}/api/clients")
        assert lr.status_code == 200
        ids = [c["id"] for c in lr.json()]
        assert cid in ids
        client.delete(f"{BASE}/api/clients/{cid}")


# ---------- Students fees_plan ----------
class TestStudentsFeesPlan:
    @pytest.fixture
    def student_id(self, client) -> None:
        payload = {
            "name": "TEST_IT10_Student",
            "course": "B.Tech",
            "college": "Test U",
            "reference": "TEST_IT10_SubAgent",
            "status": "enrolled",
            "fees_plan": {
                "installment_mode": "yearly",
                "year_1": 100000,
                "year_2": 120000,
                "year_3": 130000,
                "year_4": None,
                "has_scholarship": True,
                "scholarship_amount": 25000,
                "package_status": "admission_tuition",
            },
        }
        r = client.post(f"{BASE}/api/students", json=payload)
        assert r.status_code == 200, r.text
        sid = r.json()["id"]
        yield sid
        client.delete(f"{BASE}/api/students/{sid}")

    def test_auto_generated_schedules(self, client, student_id) -> None:
        r = client.get(f"{BASE}/api/students/{student_id}")
        s = r.json()
        scheds = s.get("schedules", [])
        # Should have 3 fees_plan rows (year_1, year_2, year_3); year_4 is None
        plan_rows = [sc for sc in scheds if sc.get("source") == "fees_plan"]
        assert len(plan_rows) == 3
        labels = {sc["label"]: sc["amount"] for sc in plan_rows}
        assert labels.get("1st Year") == 100000
        assert labels.get("2nd Year") == 120000
        assert labels.get("3rd Year") == 130000
        ykeys = {sc["year_key"] for sc in plan_rows}
        assert ykeys == {"year_1", "year_2", "year_3"}

    def test_summarize_total_fees(self, client, student_id) -> None:
        r = client.get(f"{BASE}/api/students/{student_id}")
        s = r.json()
        fp = s.get("fees_plan")
        assert fp is not None
        # 100k+120k+130k - 25k scholarship = 325000
        assert fp["total_fees"] == 325000

    def test_patch_reconcile_update_inplace(self, client, student_id) -> None:
        # Get current schedule IDs
        s = client.get(f"{BASE}/api/students/{student_id}").json()
        before_ids = {sc["year_key"]: sc["id"] for sc in s["schedules"] if sc.get("source") == "fees_plan"}

        # Update year_1 amount, keep others
        new_plan = {
            "installment_mode": "yearly",
            "year_1": 150000, "year_2": 120000, "year_3": 130000, "year_4": None,
            "has_scholarship": True, "scholarship_amount": 25000,
            "package_status": "admission_tuition",
        }
        r = client.patch(f"{BASE}/api/students/{student_id}", json={
            "name": s["name"], "course": s["course"], "college": s["college"],
            "reference": s["reference"], "status": s["status"],
            "fees_plan": new_plan,
        })
        assert r.status_code == 200
        s2 = r.json()
        after = {sc["year_key"]: sc for sc in s2["schedules"] if sc.get("source") == "fees_plan"}
        assert after["year_1"]["id"] == before_ids["year_1"]  # id preserved
        assert after["year_1"]["amount"] == 150000
        # total_fees recomputed: 150+120+130-25 = 375k
        assert s2["fees_plan"]["total_fees"] == 375000

    def test_patch_reconcile_add_and_remove(self, client, student_id) -> None:
        s = client.get(f"{BASE}/api/students/{student_id}").json()
        # Add year_4, remove year_3 (set null)
        new_plan = {
            "installment_mode": "yearly",
            "year_1": 100000, "year_2": 120000, "year_3": None, "year_4": 140000,
            "has_scholarship": False, "scholarship_amount": 0,
            "package_status": "admission_tuition",
        }
        r = client.patch(f"{BASE}/api/students/{student_id}", json={
            "name": s["name"], "status": s["status"], "fees_plan": new_plan,
        })
        assert r.status_code == 200, r.text
        s2 = r.json()
        ykeys = {sc["year_key"] for sc in s2["schedules"] if sc.get("source") == "fees_plan"}
        assert ykeys == {"year_1", "year_2", "year_4"}
        labels = {sc["label"]: sc["amount"] for sc in s2["schedules"] if sc.get("source") == "fees_plan"}
        assert labels.get("4th Year") == 140000

    def test_patch_preserves_referenced_year(self, client, student_id) -> None:
        # Add a payment that references year_2 schedule
        s = client.get(f"{BASE}/api/students/{student_id}").json()
        y1_sched = next(sc for sc in s["schedules"] if sc.get("year_key") == "year_1")
        pay = client.post(f"{BASE}/api/students/{student_id}/payments", json={
            "date": "2026-01-15",
            "amount": 50000,
            "fee_type": "tution",
            "received_in": {"type": "cash"},
            "schedule_id": y1_sched["id"],
        })
        assert pay.status_code == 200

        # Now try to remove year_1 from fees_plan
        new_plan = {
            "installment_mode": "yearly",
            "year_1": 0, "year_2": 120000, "year_3": None, "year_4": 140000,
            "has_scholarship": False, "scholarship_amount": 0,
            "package_status": "admission_tuition",
        }
        r = client.patch(f"{BASE}/api/students/{student_id}", json={
            "name": s["name"], "status": s["status"], "fees_plan": new_plan,
        })
        assert r.status_code == 200
        s2 = r.json()
        # year_1 schedule must still exist (because payment references it) but amount zeroed
        y1 = next((sc for sc in s2["schedules"] if sc.get("year_key") == "year_1"), None)
        assert y1 is not None, "year_1 schedule was dropped despite payment reference"
        assert y1["amount"] == 0.0
        assert y1["id"] == y1_sched["id"]

    def test_patch_existing_student_without_fees_plan_does_not_corrupt(self, client) -> None:
        # Create a student WITHOUT fees_plan, add manual schedule, then PATCH without fees_plan
        r = client.post(f"{BASE}/api/students", json={
            "name": "TEST_IT10_Legacy", "status": "inquiry",
        })
        sid = r.json()["id"]
        try:
            # Add manual schedule
            sch = client.post(f"{BASE}/api/students/{sid}/schedules", json={
                "label": "Manual Item", "amount": 5000,
            })
            assert sch.status_code == 200
            sched_id = next(s["id"] for s in sch.json()["schedules"] if s["label"] == "Manual Item")

            # PATCH the student without fees_plan
            pr = client.patch(f"{BASE}/api/students/{sid}", json={
                "name": "TEST_IT10_Legacy_Updated", "status": "enrolled",
            })
            assert pr.status_code == 200
            updated = pr.json()
            # Manual schedule must still exist
            ids = [s["id"] for s in updated["schedules"]]
            assert sched_id in ids, "Manual schedule was corrupted on PATCH without fees_plan"
        finally:
            client.delete(f"{BASE}/api/students/{sid}")


class TestStudentNoFeesPlan:
    def test_create_student_without_fees_plan(self, client) -> None:
        r = client.post(f"{BASE}/api/students", json={
            "name": "TEST_IT10_NoPlan", "status": "inquiry",
        })
        assert r.status_code == 200, r.text
        sid = r.json()["id"]
        s = r.json()
        assert s["schedules"] == []
        assert s.get("fees_plan") is None
        client.delete(f"{BASE}/api/students/{sid}")
