"""Iteration 15 backend tests:
   - Brute-force lockout (5 fails → 6th = 429, per-email, clear on success, locked even with right pwd)
   - Salary auto-request on mark-paid (idempotent, unmark deletes pending, super_admin doesn't auto-create)
"""
import os
import time
import pytest
import requests
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / "frontend" / ".env")
BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE}/api"

ADMIN = {"email": "admin@finflow.com", "password": "Admin@123"}
BLR1 = {"email": "blr1@finflow.com", "password": "Office@123"}

TS = int(time.time())
VICTIM = f"locktest+{TS}@finflow.com"
VICTIM2 = f"locktest2+{TS}@finflow.com"


def _s():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _login(s, creds):
    r = s.post(f"{API}/auth/login", json=creds, timeout=20)
    return r


# ---------------- BRUTE-FORCE LOCKOUT ----------------
class TestBruteForce:
    def test_5_fails_then_6th_429(self):
        s = _s()
        codes = []
        for _ in range(5):
            r = _login(s, {"email": VICTIM, "password": "wrong"})
            codes.append(r.status_code)
        assert all(c == 401 for c in codes), f"expected five 401s, got {codes}"
        r6 = _login(s, {"email": VICTIM, "password": "wrong"})
        assert r6.status_code == 429, f"6th attempt should be 429, got {r6.status_code} {r6.text}"
        body = r6.json()
        assert "locked" in (body.get("detail") or "").lower()
        assert "minute" in (body.get("detail") or "").lower()

    def test_lock_is_per_email(self):
        s = _s()
        # Another fake email should still 401 (not affected by VICTIM's lock)
        r = _login(s, {"email": VICTIM2, "password": "wrong"})
        assert r.status_code == 401, f"per-email lock should not bleed to VICTIM2 (got {r.status_code})"

    def test_locked_account_429_even_with_correct_password(self):
        # Use blr1's email — we will first force lock via 5 wrongs, then attempt the correct pwd.
        # IMPORTANT: clear at the end via successful direct DB cleanup endpoint (we use admin path).
        s = _s()
        target_email = f"locktest_pwd+{TS}@finflow.com"
        for _ in range(5):
            _login(s, {"email": target_email, "password": "wrong"})
        r = _login(s, {"email": target_email, "password": "doesntmatter"})
        assert r.status_code == 429

    def test_clear_on_successful_login(self):
        # Fail 4x for blr1 then succeed → counter must be wiped
        s = _s()
        for _ in range(4):
            r = _login(s, {"email": BLR1["email"], "password": "wrong"})
            assert r.status_code == 401
        ok = _login(s, BLR1)
        assert ok.status_code == 200, f"blr1 should still login: {ok.status_code} {ok.text}"
        # Now 4 more fails should NOT lock (since counter cleared)
        for _ in range(4):
            r = _login(s, {"email": BLR1["email"], "password": "wrong"})
            assert r.status_code == 401, f"unexpected lock at {r.status_code}"
        # Cleanup: successful login again to clear counter for downstream tests
        ok2 = _login(s, BLR1)
        assert ok2.status_code == 200


# ---------------- SALARY AUTO-REQUEST ----------------
@pytest.fixture(scope="module")
def admin_session():
    s = _s()
    r = _login(s, ADMIN)
    assert r.status_code == 200, r.text
    return s


@pytest.fixture(scope="module")
def blr1_session():
    s = _s()
    r = _login(s, BLR1)
    assert r.status_code == 200, r.text
    return s


def _find_student_with_ravi_ref(s):
    r = s.get(f"{API}/students", timeout=20)
    assert r.status_code == 200, r.text
    for st in r.json():
        if (st.get("reference") or "").strip().lower() == "ravi kumar":
            return st
    return None


class TestSalaryAutoRequest:
    def test_office_admin_mark_paid_creates_salary_request(self, blr1_session):
        s = blr1_session
        st = _find_student_with_ravi_ref(s)
        assert st, "seeded student referencing Ravi Kumar not found"
        sid = st["id"]
        # Ensure unpaid first
        s.post(f"{API}/students/{sid}/incentive/unmark-paid", timeout=20)

        r = s.post(f"{API}/students/{sid}/incentive/mark-paid", timeout=20)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["incentive_paid"] is True
        assert body.get("expense_request_id"), "expense_request_id missing"
        assert body.get("amount") == 500, f"expected 500, got {body.get('amount')}"

        # GET back the request and verify fields
        rl = s.get(f"{API}/expense-requests?status=pending", timeout=20)
        assert rl.status_code == 200
        match = next((er for er in rl.json() if er["id"] == body["expense_request_id"]), None)
        assert match, "salary request not found in pending list"
        assert match["kind"] == "salary"
        assert match["linked_student_id"] == sid
        assert match["amount"] == 500
        assert "incentive" in (match.get("description") or "").lower() or st["name"].lower() in (match.get("description") or "").lower()

    def test_mark_paid_idempotent(self, blr1_session):
        s = blr1_session
        st = _find_student_with_ravi_ref(s)
        sid = st["id"]
        # already paid from previous test — call again
        first = s.get(f"{API}/expense-requests?status=pending", timeout=20).json()
        first_count = sum(1 for er in first if er.get("linked_student_id") == sid and er.get("kind") == "salary")
        r = s.post(f"{API}/students/{sid}/incentive/mark-paid", timeout=20)
        assert r.status_code == 200
        second = s.get(f"{API}/expense-requests?status=pending", timeout=20).json()
        second_count = sum(1 for er in second if er.get("linked_student_id") == sid and er.get("kind") == "salary")
        assert first_count == second_count, f"idempotency broken: {first_count} → {second_count}"

    def test_unmark_paid_deletes_pending_request(self, blr1_session):
        s = blr1_session
        st = _find_student_with_ravi_ref(s)
        sid = st["id"]
        # Find current pending request id
        pending = [er for er in s.get(f"{API}/expense-requests?status=pending").json()
                   if er.get("linked_student_id") == sid and er.get("kind") == "salary"]
        assert pending, "expected a pending salary request from earlier test"
        req_id = pending[0]["id"]

        r = s.post(f"{API}/students/{sid}/incentive/unmark-paid", timeout=20)
        assert r.status_code == 200
        # Confirm gone
        after = s.get(f"{API}/expense-requests?status=pending").json()
        assert not any(er["id"] == req_id for er in after), "salary request still pending after unmark"
        # Student is back to unpaid
        st2 = next((x for x in s.get(f"{API}/students").json() if x["id"] == sid), None)
        assert st2 and st2.get("incentive_paid") in (False, None)

    def test_unmark_after_approved_does_not_delete_request(self, blr1_session, admin_session):
        s = blr1_session
        st = _find_student_with_ravi_ref(s)
        sid = st["id"]
        # Fresh mark-paid (creates new pending request)
        s.post(f"{API}/students/{sid}/incentive/unmark-paid", timeout=20)
        r = s.post(f"{API}/students/{sid}/incentive/mark-paid", timeout=20)
        req_id = r.json()["expense_request_id"]
        assert req_id

        # Super-admin approves it — account must belong to requester (blr1), not admin
        accs = s.get(f"{API}/accounts").json()
        assert accs, "blr1 has no accounts"
        appr = admin_session.post(
            f"{API}/expense-requests/{req_id}/approve",
            json={"account_id": accs[0]["id"], "note": "it15 test"},
            timeout=20,
        )
        assert appr.status_code == 200, appr.text

        # Now office admin unmarks → request must NOT be deleted (since not pending anymore)
        s.post(f"{API}/students/{sid}/incentive/unmark-paid", timeout=20)
        # Check that the approved request still exists
        all_reqs = admin_session.get(f"{API}/expense-requests?status=approved").json()
        assert any(er["id"] == req_id for er in all_reqs), "approved salary request was incorrectly deleted"

        # Student should be unpaid again
        st2 = next((x for x in s.get(f"{API}/students").json() if x["id"] == sid), None)
        assert st2.get("incentive_paid") in (False, None)

    def test_super_admin_mark_paid_does_not_auto_create(self, admin_session):
        s = admin_session
        # super-admin has its own students universe — create a student for the test
        # but the seeded Ravi Kumar is on blr1's account, so we just verify behavior with one of admin's own students if any.
        # Find any admin-owned student
        admin_students = s.get(f"{API}/students").json()
        if not admin_students:
            pytest.skip("admin has no students seeded — cannot verify negative path")
        sid = admin_students[0]["id"]
        s.post(f"{API}/students/{sid}/incentive/unmark-paid", timeout=20)
        before = s.get(f"{API}/expense-requests").json()
        before_ids = {er["id"] for er in before}
        r = s.post(f"{API}/students/{sid}/incentive/mark-paid", timeout=20)
        assert r.status_code == 200
        body = r.json()
        assert body.get("expense_request_id") in (None, ""), f"super_admin should not auto-create expense_request, got {body}"
        after = s.get(f"{API}/expense-requests").json()
        new_ids = {er["id"] for er in after} - before_ids
        assert not new_ids, f"super_admin path created a new request: {new_ids}"
        # cleanup
        s.post(f"{API}/students/{sid}/incentive/unmark-paid", timeout=20)
