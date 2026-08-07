"""Iteration 19 — Client Detail endpoint + student scholarship/sc_adjusted math.

Covers:
- GET /api/clients/{id}/detail role access (super_admin any, office_admin own/404)
- GET /api/students/{id} returns scholarship_amount, sc_adjusted_total,
  sc_earned_effective, balance_vs_sc with new formula
- POST /api/students with fees_plan scholarship → 1st-year row reduced
- PATCH toggling scholarship reconciles 1st year row
"""
import os
import pytest
import requests

def _read_frontend_env():
    try:
        with open("/app/frontend/.env") as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    return line.split("=", 1)[1].strip().rstrip("/")
    except Exception:
        pass
    return None


BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or _read_frontend_env() or "").rstrip("/")
assert BASE_URL, "REACT_APP_BACKEND_URL not configured"
SUPER = {"email": "admin@finflow.com", "password": "Admin@123"}
OFFICE = {"email": "blr1@finflow.com", "password": "Office@123"}


def _login(creds):
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json=creds, timeout=15)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return s


@pytest.fixture(scope="module")
def super_sess():
    return _login(SUPER)


@pytest.fixture(scope="module")
def office_sess():
    return _login(OFFICE)


# -------- Client Detail --------
class TestClientDetail:
    def test_super_admin_can_view_any_client(self, super_sess):
        clients = super_sess.get(f"{BASE_URL}/api/clients").json()
        assert clients, "expected at least one client"
        staff = next((c for c in clients if c.get("client_type") == "staff"), clients[0])
        r = super_sess.get(f"{BASE_URL}/api/clients/{staff['id']}/detail")
        assert r.status_code == 200, r.text
        d = r.json()
        assert "client" in d and "totals" in d and "students" in d
        t = d["totals"]
        for k in ("students_count", "sc_earned", "incentive_earned",
                  "incentive_paid", "incentive_pending",
                  "total_income", "total_expense", "net"):
            assert k in t, f"missing total: {k}"

    def test_office_admin_owns_staff(self, office_sess):
        clients = office_sess.get(f"{BASE_URL}/api/clients").json()
        assert clients, "office admin should have staff"
        c = clients[0]
        r = office_sess.get(f"{BASE_URL}/api/clients/{c['id']}/detail")
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["is_staff"] is True

    def test_office_admin_cannot_view_other_client(self, super_sess, office_sess):
        # find a client owned by someone OTHER than blr1
        me = office_sess.get(f"{BASE_URL}/api/auth/me").json()
        all_clients = super_sess.get(f"{BASE_URL}/api/clients").json()
        other = next((c for c in all_clients if c.get("user_id") != me["id"]), None)
        if not other:
            pytest.skip("no foreign client to test cross-user 404")
        r = office_sess.get(f"{BASE_URL}/api/clients/{other['id']}/detail")
        assert r.status_code == 404, f"expected 404 got {r.status_code}"

    def test_404_on_missing_id(self, office_sess):
        r = office_sess.get(f"{BASE_URL}/api/clients/no-such-id-xyz/detail")
        assert r.status_code == 404


# -------- Student math --------
class TestStudentMath:
    def test_anupama_scholarship(self, super_sess):
        students = super_sess.get(f"{BASE_URL}/api/students").json()
        anupama = next((s for s in students if (s.get("name") or "").upper().startswith("ANUPAMA")), None)
        if not anupama:
            pytest.skip("ANUPAMA fixture not present")
        r = super_sess.get(f"{BASE_URL}/api/students/{anupama['id']}")
        d = r.json()
        assert d["scholarship_amount"] == 20000.0
        assert d["sc_earned_effective"] == 55000.0  # 75000 - 20000
        # balance_vs_sc = sc_earned_effective - sc_adjusted_total
        assert d["balance_vs_sc"] == round(55000.0 - d["sc_adjusted_total"], 2)

    def test_nafathulla_sc_adjusted(self, super_sess):
        students = super_sess.get(f"{BASE_URL}/api/students").json()
        n = next((s for s in students if "NAFATHULLA" in (s.get("name") or "").upper()), None)
        if not n:
            pytest.skip("NAFATHULLA fixture not present")
        r = super_sess.get(f"{BASE_URL}/api/students/{n['id']}")
        d = r.json()
        assert d["scholarship_amount"] == 0.0
        assert d["sc_earned_effective"] == 100000.0
        assert d["sc_adjusted_total"] == 10000.0
        assert d["balance_vs_sc"] == 90000.0

    def test_create_with_scholarship_reduces_year_1(self, super_sess):
        payload = {
            "name": "TEST_ScholarshipStudent_Iter19",
            "course": "BSc",
            "sc_out_fixed": 50000,
            "status": "enrolled",
            "fees_plan": {
                "installment_mode": "yearly",
                "year_1": 100000,
                "year_2": 90000,
                "year_3": 80000,
                "year_4": 0,
                "has_scholarship": True,
                "scholarship_amount": 30000,
                "package_status": "admission_tuition",
            },
        }
        r = super_sess.post(f"{BASE_URL}/api/students", json=payload)
        assert r.status_code == 200, r.text
        d = r.json()
        sid = d["id"]
        try:
            scheds = d["schedules"]
            by_key = {s["year_key"]: s for s in scheds}
            assert by_key["year_1"]["amount"] == 70000.0  # 100000 - 30000
            assert by_key["year_2"]["amount"] == 90000.0
            assert by_key["year_3"]["amount"] == 80000.0
            assert "year_4" not in by_key  # 0 dropped
            assert d["sc_earned_effective"] == 20000.0  # max(0, 50000 - 30000)

            # PATCH: turn scholarship off → year_1 back to 100000
            payload["fees_plan"]["has_scholarship"] = False
            payload["fees_plan"]["scholarship_amount"] = 0
            r2 = super_sess.patch(f"{BASE_URL}/api/students/{sid}", json=payload)
            assert r2.status_code == 200, r2.text
            d2 = r2.json()
            by_key2 = {s["year_key"]: s for s in d2["schedules"] if s.get("year_key")}
            assert by_key2["year_1"]["amount"] == 100000.0

            # PATCH: scholarship > year_1 → row drops (no payments linked)
            payload["fees_plan"]["has_scholarship"] = True
            payload["fees_plan"]["scholarship_amount"] = 200000
            r3 = super_sess.patch(f"{BASE_URL}/api/students/{sid}", json=payload)
            d3 = r3.json()
            ykeys = {s.get("year_key") for s in d3["schedules"]}
            assert "year_1" not in ykeys, f"year_1 row should drop when scholarship>year_1; got {ykeys}"
        finally:
            super_sess.delete(f"{BASE_URL}/api/students/{sid}")

    def test_legacy_student_no_fees_plan(self, super_sess):
        """Backward-compat: students with no fees_plan should still respond."""
        students = super_sess.get(f"{BASE_URL}/api/students").json()
        legacy = next((s for s in students if not s.get("fees_plan")), None)
        if not legacy:
            pytest.skip("no legacy student without fees_plan")
        r = super_sess.get(f"{BASE_URL}/api/students/{legacy['id']}")
        assert r.status_code == 200
        d = r.json()
        assert d["scholarship_amount"] == 0.0
        assert d["sc_earned_effective"] == round(float(d.get("sc_out_fixed") or 0), 2)
        assert d["balance_vs_sc"] == round(d["sc_earned_effective"] - d["sc_adjusted_total"], 2)
