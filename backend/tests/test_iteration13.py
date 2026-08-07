"""Iteration 13 — Phase 2 Office Admin Dashboard + Quick Entry tests."""
import os
import pytest
import requests
from datetime import datetime

def _load_env():
    p = "/app/frontend/.env"
    if os.path.exists(p):
        for line in open(p):
            if "=" in line and not line.strip().startswith("#"):
                k, v = line.strip().split("=", 1)
                os.environ.setdefault(k, v)
_load_env()
BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
SUPER = {"email": "admin@finflow.com", "password": "Admin@123"}
OFFICE = {"email": "blr1@finflow.com", "password": "Office@123"}


def _login(creds):
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json=creds, timeout=20)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return s


@pytest.fixture(scope="module")
def office_session():
    return _login(OFFICE)


@pytest.fixture(scope="module")
def super_session():
    return _login(SUPER)


# ---------- Dashboard endpoint structure ----------
def test_office_admin_dashboard_month(office_session):
    r = office_session.get(f"{BASE_URL}/api/dashboard/office-admin?window=month", timeout=20)
    assert r.status_code == 200, r.text
    data = r.json()
    for k in ["window", "window_start", "window_end", "office", "totals", "staff_breakdown", "upcoming_birthdays"]:
        assert k in data, f"missing key: {k}"
    assert data["window"] == "month"
    for tk in ["admissions", "eligible_admissions", "staff_count", "incentive_earned", "incentive_paid", "incentive_pending"]:
        assert tk in data["totals"], f"missing totals.{tk}"
    assert isinstance(data["staff_breakdown"], list)
    assert isinstance(data["upcoming_birthdays"], list)


@pytest.mark.parametrize("win", ["week", "month", "year"])
def test_office_dashboard_window_params(office_session, win):
    r = office_session.get(f"{BASE_URL}/api/dashboard/office-admin?window={win}", timeout=20)
    assert r.status_code == 200
    assert r.json()["window"] == win


def test_office_dashboard_invalid_window_defaults_month(office_session):
    r = office_session.get(f"{BASE_URL}/api/dashboard/office-admin?window=bogus", timeout=20)
    assert r.status_code == 200
    assert r.json()["window"] == "month"


# ---------- Eligibility rule (3+ admissions/staff/month) ----------
def test_eligibility_rule_seeded_ravi_kumar(office_session):
    """Ravi Kumar has 3 students enrolled in May 2026 — should be eligible
    with incentive_amount=500 for ALL three admissions in that month."""
    r = office_session.get(f"{BASE_URL}/api/dashboard/office-admin?window=year", timeout=20)
    assert r.status_code == 200
    rows = r.json()["staff_breakdown"]
    ravi = next((x for x in rows if x["name"].strip().lower() == "ravi kumar"), None)
    if not ravi:
        pytest.skip("Seeded Ravi Kumar staff+students not present — skipping eligibility check")
    # Find may-2026 admissions
    may = [a for a in ravi["admissions"] if a["month"] == "2026-05"]
    assert len(may) >= 3, f"expected >=3 may-2026 admissions, got {len(may)}"
    for a in may:
        assert a["eligible"] is True
        assert a["incentive_amount"] == ravi["eligible_incentive"]


# ---------- Mark-paid / unmark-paid endpoints ----------
def test_mark_and_unmark_incentive(office_session):
    # find a student with eligible admission to act on
    r = office_session.get(f"{BASE_URL}/api/dashboard/office-admin?window=year", timeout=20)
    rows = r.json()["staff_breakdown"]
    target = None
    for row in rows:
        for a in row["admissions"]:
            if a["eligible"]:
                target = a
                break
        if target:
            break
    if not target:
        pytest.skip("No eligible admissions to mark paid")
    sid = target["student_id"]

    # Mark paid
    r = office_session.post(f"{BASE_URL}/api/students/{sid}/incentive/mark-paid", timeout=20)
    assert r.status_code == 200
    body = r.json()
    assert body["incentive_paid"] is True

    # Idempotent: call again
    r2 = office_session.post(f"{BASE_URL}/api/students/{sid}/incentive/mark-paid", timeout=20)
    assert r2.status_code == 200

    # Verify via GET
    r = office_session.get(f"{BASE_URL}/api/students/{sid}", timeout=20)
    assert r.status_code == 200
    s = r.json()
    assert s.get("incentive_paid") is True
    assert s.get("incentive_paid_at")

    # Unmark
    r = office_session.post(f"{BASE_URL}/api/students/{sid}/incentive/unmark-paid", timeout=20)
    assert r.status_code == 200
    assert r.json()["incentive_paid"] is False
    r = office_session.get(f"{BASE_URL}/api/students/{sid}", timeout=20)
    s = r.json()
    assert s.get("incentive_paid") is False
    assert s.get("incentive_paid_at") in (None, "")  # unset


def test_mark_paid_404_for_unknown_id(office_session):
    r = office_session.post(f"{BASE_URL}/api/students/does-not-exist/incentive/mark-paid", timeout=20)
    assert r.status_code == 404


# ---------- Upcoming birthdays ----------
def test_upcoming_birthdays_shape(office_session):
    r = office_session.get(f"{BASE_URL}/api/dashboard/office-admin", timeout=20)
    assert r.status_code == 200
    for b in r.json()["upcoming_birthdays"]:
        for k in ["staff_id", "name", "date_of_birth", "days_until"]:
            assert k in b
        assert 0 <= b["days_until"] <= 30


# ---------- Reference mismatch doesn't crash ----------
def test_legacy_reference_does_not_crash(office_session):
    # Create a student with a free-text reference that won't match any staff
    payload = {
        "name": "TEST_IT13_BadRef",
        "reference": "Nobody_xyz_zzz",
        "status": "enrolled",
        "enrollment_date": datetime.utcnow().date().isoformat(),
    }
    r = office_session.post(f"{BASE_URL}/api/students", json=payload, timeout=20)
    assert r.status_code == 200, r.text
    sid = r.json()["id"]

    try:
        r = office_session.get(f"{BASE_URL}/api/dashboard/office-admin?window=month", timeout=20)
        assert r.status_code == 200
        # The bad-ref student should NOT appear in any staff_breakdown row
        for row in r.json()["staff_breakdown"]:
            for a in row["admissions"]:
                assert a["student_id"] != sid
    finally:
        office_session.delete(f"{BASE_URL}/api/students/{sid}", timeout=20)


# ---------- Super admin can hit the endpoint too (their own books) ----------
def test_super_admin_can_access_office_dashboard(super_session):
    r = super_session.get(f"{BASE_URL}/api/dashboard/office-admin?window=month", timeout=20)
    assert r.status_code == 200
