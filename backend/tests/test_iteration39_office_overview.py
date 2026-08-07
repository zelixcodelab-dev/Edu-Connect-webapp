"""
Iteration 39 — Verify:
  1) Staff-created leads inherit office and show up in Office Admin's CRM (same office)
  2) Super Admin office-scoped analytics parity with Office Admin's own analytics
"""
import os, requests, pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")

SA = ("admin@kmfoundation.online", "Admin@786")
OA_BLR = ("blr1@finflow.com", "Office@123")
STAFF_BLR = ("staff.blr@kmfoundation.online", "Staff@123")


def _login(email, password):
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password}, timeout=15)
    assert r.status_code == 200, f"login {email} -> {r.status_code} {r.text}"
    return s


@pytest.fixture(scope="module")
def sa(): return _login(*SA)

@pytest.fixture(scope="module")
def oa(): return _login(*OA_BLR)

@pytest.fixture(scope="module")
def staff(): return _login(*STAFF_BLR)


# ---------- Lead linkage staff -> office admin ----------
def test_staff_lead_visible_to_office_admin(staff, oa):
    payload = {
        "name": "TEST_IT39 Staff Lead",
        "phone": "9990000039",
        "source": "walk_in",
        "status": "new",
    }
    cr = staff.post(f"{BASE_URL}/api/leads", json=payload, timeout=15)
    assert cr.status_code in (200, 201), f"create lead -> {cr.status_code} {cr.text}"
    lead = cr.json()
    lead_id = lead.get("id") or lead.get("_id")
    assert lead_id, lead
    assert lead.get("office") == "KM_BLR", f"office not inherited: {lead}"
    # assigned_to_user_id should be the staff's user_id (the creating staff)
    assert lead.get("assigned_to_user_id"), lead

    try:
        # Office Admin (same office) must see the lead
        lr = oa.get(f"{BASE_URL}/api/leads", timeout=15)
        assert lr.status_code == 200, lr.text
        ids = [l.get("id") for l in lr.json()]
        assert lead_id in ids, f"OA cannot see staff lead. saw {len(ids)} leads"

        # Staff must see only their assigned leads — include this one
        sr = staff.get(f"{BASE_URL}/api/leads", timeout=15)
        assert sr.status_code == 200
        s_ids = [l.get("id") for l in sr.json()]
        assert lead_id in s_ids
    finally:
        # cleanup as super admin to guarantee delete
        sa = _login(*SA)
        sa.delete(f"{BASE_URL}/api/leads/{lead_id}", timeout=15)


# ---------- Parity: SA /leads/analytics?office=KM_BLR == OA /leads/analytics ----------
def test_sa_office_param_parity_with_oa(sa, oa):
    r_sa = sa.get(f"{BASE_URL}/api/leads/analytics?office=KM_BLR", timeout=15)
    r_oa = oa.get(f"{BASE_URL}/api/leads/analytics", timeout=15)
    assert r_sa.status_code == 200, r_sa.text
    assert r_oa.status_code == 200, r_oa.text
    k_sa = r_sa.json().get("kpis", {})
    k_oa = r_oa.json().get("kpis", {})
    assert k_sa.get("total_leads") == k_oa.get("total_leads"), (k_sa, k_oa)
    assert k_sa.get("total_admissions") == k_oa.get("total_admissions"), (k_sa, k_oa)


def test_sa_dashboard_office_param(sa):
    for o in ("KM_BLR", "KM_TCR", "KM_KMLY"):
        r = sa.get(f"{BASE_URL}/api/dashboard/office-admin?window=month&office={o}", timeout=15)
        assert r.status_code == 200, f"{o} -> {r.status_code} {r.text}"
        body = r.json()
        assert "totals" in body
        # staff_count should be a number (may be 0)
        assert isinstance(body["totals"].get("staff_count", 0), int)


def test_office_param_oa_forbidden_or_ignored(oa):
    # If OA passes office=KM_TCR it must NOT be honored (their own scope must win)
    r = oa.get(f"{BASE_URL}/api/leads/analytics?office=KM_TCR", timeout=15)
    assert r.status_code == 200
    # OA-own analytics
    r_own = oa.get(f"{BASE_URL}/api/leads/analytics", timeout=15)
    assert r.json().get("kpis", {}).get("total_leads") == r_own.json().get("kpis", {}).get("total_leads")
