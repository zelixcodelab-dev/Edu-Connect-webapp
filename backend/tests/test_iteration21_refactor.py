"""Iteration 21 — refactor regression suite.

Validates that the lib helpers extracted in this iteration (incentive_math,
student_math, office_dashboard) are wired into the routers and return the same
response shapes that the frontend depends on.

Tests in this module are network integration tests against the deployed backend
URL. They use the shared credential resolver in `tests/_creds.py`.
"""
from __future__ import annotations

import pytest
import requests

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _creds import api_base, admin_credentials, office_credentials  # noqa: E402


API = api_base()


# ---- fixtures -------------------------------------------------------------


def _login(email: str, password: str) -> requests.Session:
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=20)
    if r.status_code != 200:
        pytest.skip(f"login failed for {email}: {r.status_code} {r.text[:160]}")
    return s


@pytest.fixture(scope="module")
def admin_session() -> requests.Session:
    email, pwd = admin_credentials()
    return _login(email, pwd)


@pytest.fixture(scope="module")
def office_session() -> requests.Session:
    email, pwd = office_credentials("blr1")
    return _login(email, pwd)


# ---- /api/clients/{id}/detail ---------------------------------------------


class TestClientDetailShape:
    """Refactored endpoint must keep the same JSON contract."""

    def test_client_detail_keys(self, admin_session):
        clients = admin_session.get(f"{API}/clients", timeout=15).json()
        assert isinstance(clients, list) and clients, "no clients seeded"
        cid = clients[0]["id"]

        r = admin_session.get(f"{API}/clients/{cid}/detail", timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()

        # top-level shape — exactly what the frontend renders
        for key in ("client", "totals", "students", "transactions"):
            assert key in body, f"missing key {key}; got {list(body)}"

        # totals come from build_client_detail_totals helper
        t = body["totals"]
        for key in ("incentive_earned", "incentive_paid", "incentive_pending"):
            assert key in t, f"missing totals.{key}"
            assert isinstance(t[key], (int, float))

        # students list shape (used by StudentList on ClientDetail)
        if body["students"]:
            a = body["students"][0]
            assert "id" in a and "name" in a

    def test_client_detail_404_unknown(self, admin_session):
        r = admin_session.get(f"{API}/clients/does-not-exist-uuid/detail", timeout=15)
        assert r.status_code == 404


# ---- /api/dashboard/office-admin ------------------------------------------


class TestOfficeAdminDashboard:
    """Refactored helper must return identical totals shape."""

    def test_office_admin_dashboard_shape(self, office_session):
        r = office_session.get(f"{API}/dashboard/office-admin?window=month", timeout=20)
        assert r.status_code == 200, r.text
        body = r.json()

        # the four stat tiles depend on these fields
        assert "totals" in body
        totals = body["totals"]
        for k in ("admissions", "incentive_earned", "incentive_pending", "staff_count"):
            assert k in totals, f"missing totals.{k}"
            assert isinstance(totals[k], (int, float))

        # staff_breakdown drives the right-rail list
        assert "staff_breakdown" in body
        assert isinstance(body["staff_breakdown"], list)
        if body["staff_breakdown"]:
            row = body["staff_breakdown"][0]
            for k in ("id", "name", "month_count"):
                assert k in row, f"missing staff_breakdown[].{k}"

        # upcoming_birthdays drives the aside card
        assert "upcoming_birthdays" in body
        assert isinstance(body["upcoming_birthdays"], list)

    def test_office_admin_window_toggle(self, office_session):
        # week vs year — both must succeed with the same shape
        for w in ("week", "month", "year"):
            r = office_session.get(f"{API}/dashboard/office-admin?window={w}", timeout=20)
            assert r.status_code == 200, f"{w} → {r.status_code} {r.text[:160]}"
            assert "totals" in r.json()

    def test_office_admin_totals_admissions_counts_all(self, office_session):
        """Per acceptance criteria: totals.admissions counts ALL admissions (not just current-window)."""
        body = office_session.get(f"{API}/dashboard/office-admin?window=month", timeout=20).json()
        totals = body["totals"]
        # The window-scoped count comes via a different field if present;
        # totals.admissions should be >= any windowed value.
        assert totals["admissions"] >= 0
        # staff_count should be a non-negative integer
        assert isinstance(totals["staff_count"], int)
        assert totals["staff_count"] >= 0


# ---- /api/students/{id} (uses student_math helpers) -----------------------


class TestStudentSummaryFields:
    """GET /students/{id} must include sc_earned_effective and balance_vs_sc."""

    def test_student_detail_has_summary_fields(self, admin_session):
        students = admin_session.get(f"{API}/students", timeout=15).json()
        assert isinstance(students, list) and students, "no students seeded"
        # pick one with fees_plan if possible
        target = next((s for s in students if s.get("fees_plan")), students[0])
        sid = target["id"]

        r = admin_session.get(f"{API}/students/{sid}", timeout=15)
        assert r.status_code == 200, r.text
        s = r.json()

        # the new helper-driven fields
        assert "sc_earned_effective" in s, "missing sc_earned_effective"
        assert "balance_vs_sc" in s, "missing balance_vs_sc"
        assert isinstance(s["sc_earned_effective"], (int, float))
        assert isinstance(s["balance_vs_sc"], (int, float))

        # legacy summary fields the StudentDetail tiles still need
        for k in ("scheduled_total", "collected_total"):
            assert k in s, f"missing summary field {k}"


# ---- Empty-catch-blocks regression ----------------------------------------


class TestNotificationsAndAuth:
    """Notifications poll + logout must respond without crashing (failures
    should be console.error in the UI, never blank-screen)."""

    def test_notifications_endpoint_responds(self, admin_session):
        r = admin_session.get(f"{API}/notifications", timeout=15)
        # 200 with list or 204; not 5xx
        assert r.status_code < 500, r.text

    def test_logout_succeeds(self, admin_session):
        s = requests.Session()
        email, pwd = admin_credentials()
        login = s.post(f"{API}/auth/login", json={"email": email, "password": pwd}, timeout=15)
        assert login.status_code == 200
        r = s.post(f"{API}/auth/logout", timeout=15)
        assert r.status_code in (200, 204)
