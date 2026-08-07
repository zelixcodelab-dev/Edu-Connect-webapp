"""Iteration 16 backend tests — In-app notifications.

Coverage:
  - Endpoints: GET /notifications, /unread-count, POST /{id}/read, /read-all, DELETE /{id}
  - 404 when notif_id doesn't belong to current user
  - Trigger 1: POST /expense-requests as office_admin → fans out to super_admins (not actor)
  - Trigger 2: POST /transactions as office_admin → notifies super_admins; as super_admin → no notif
  - Trigger 3: POST /students as office_admin → notifies super_admins; as super_admin → no notif
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


def _s():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _login(s, creds):
    r = s.post(f"{API}/auth/login", json=creds, timeout=20)
    assert r.status_code == 200, f"login failed for {creds['email']}: {r.status_code} {r.text}"
    return r.json()


@pytest.fixture(scope="module")
def admin_sess():
    s = _s()
    me = _login(s, ADMIN)
    s.me = me
    yield s
    s.close()


@pytest.fixture(scope="module")
def blr1_sess():
    s = _s()
    me = _login(s, BLR1)
    s.me = me
    yield s
    s.close()


@pytest.fixture(scope="module")
def blr1_account(blr1_sess):
    accs = blr1_sess.get(f"{API}/accounts", timeout=10).json()
    assert isinstance(accs, list) and len(accs) > 0, "blr1 should already have at least 1 account"
    return accs[0]


# -------------------- 1. unread-count + list happy path --------------------
class TestListAndUnread:
    def test_admin_can_list_notifications(self, admin_sess):
        r = admin_sess.get(f"{API}/notifications?limit=10", timeout=10)
        assert r.status_code == 200, r.text
        data = r.json()
        assert isinstance(data, list)
        # sorted desc by created_at
        if len(data) >= 2:
            assert data[0]["created_at"] >= data[-1]["created_at"]
        # only own notifications
        for n in data:
            assert n["recipient_user_id"] == admin_sess.me["id"]
            # _id must not leak
            assert "_id" not in n

    def test_admin_unread_count(self, admin_sess):
        r = admin_sess.get(f"{API}/notifications/unread-count", timeout=10)
        assert r.status_code == 200, r.text
        assert "count" in r.json()
        assert isinstance(r.json()["count"], int)

    def test_unread_only_filter(self, admin_sess):
        r_all = admin_sess.get(f"{API}/notifications?limit=200", timeout=10).json()
        r_unread = admin_sess.get(f"{API}/notifications?limit=200&unread_only=true", timeout=10).json()
        # every item in unread_only must have read=False
        for n in r_unread:
            assert n["read"] is False
        assert len(r_unread) <= len(r_all)

    def test_office_admin_sees_only_own(self, blr1_sess):
        """office_admin is never a recipient, so list should be empty."""
        r = blr1_sess.get(f"{API}/notifications", timeout=10)
        assert r.status_code == 200, r.text
        data = r.json()
        # all (if any) should be addressed to blr1, which should be empty per spec
        for n in data:
            assert n["recipient_user_id"] == blr1_sess.me["id"]


# -------------------- 2. trigger: expense_request --------------------
class TestExpenseRequestTrigger:
    def test_expense_request_creates_notification(self, admin_sess, blr1_sess, blr1_account):
        before = admin_sess.get(f"{API}/notifications/unread-count", timeout=10).json()["count"]

        payload = {
            "amount": 1234,
            "account_id": blr1_account["id"],
            "date": "2026-01-15",
            "description": "TEST_iter16 expense",
            "urgency": "urgent",
            "kind": "expense",
        }
        r = blr1_sess.post(f"{API}/expense-requests", json=payload, timeout=15)
        assert r.status_code in (200, 201), r.text
        req = r.json()

        after = admin_sess.get(f"{API}/notifications/unread-count", timeout=10).json()["count"]
        assert after == before + 1, f"expected +1 unread, got before={before} after={after}"

        # Fetch latest and verify shape
        latest = admin_sess.get(f"{API}/notifications?limit=5", timeout=10).json()[0]
        assert latest["type"] == "expense_request"
        assert "Expense request" in latest["title"]
        assert "URGENT" in latest["message"]
        assert "TEST_iter16" in latest["message"]
        assert "1,234" in latest["message"] or "1234" in latest["message"]
        assert latest["link"] == "/expense-requests"
        meta = latest.get("metadata", {})
        assert meta.get("request_id") == req["id"]
        assert meta.get("kind") == "expense"
        assert meta.get("urgency") == "urgent"
        assert float(meta.get("amount")) == 1234.0

        # cleanup: cancel pending request
        blr1_sess.delete(f"{API}/expense-requests/{req['id']}", timeout=10)

    def test_salary_request_uses_salary_label(self, admin_sess, blr1_sess, blr1_account):
        payload = {
            "amount": 500,
            "account_id": blr1_account["id"],
            "date": "2026-01-15",
            "description": "TEST_iter16 salary",
            "urgency": "normal",
            "kind": "salary",
        }
        r = blr1_sess.post(f"{API}/expense-requests", json=payload, timeout=15)
        assert r.status_code in (200, 201), r.text
        req = r.json()

        latest = admin_sess.get(f"{API}/notifications?limit=5", timeout=10).json()[0]
        assert latest["type"] == "expense_request"
        assert "Salary request" in latest["title"]
        assert latest["metadata"]["kind"] == "salary"

        # cleanup
        blr1_sess.delete(f"{API}/expense-requests/{req['id']}", timeout=10)


# -------------------- 3. trigger: transaction --------------------
class TestTransactionTrigger:
    def test_office_admin_transaction_notifies(self, admin_sess, blr1_sess, blr1_account):
        before = admin_sess.get(f"{API}/notifications/unread-count", timeout=10).json()["count"]
        payload = {
            "type": "income",
            "amount": 789,
            "account_id": blr1_account["id"],
            "date": "2026-01-15",
            "description": "TEST_iter16 tx",
        }
        r = blr1_sess.post(f"{API}/transactions", json=payload, timeout=15)
        assert r.status_code in (200, 201), r.text
        tx = r.json()

        after = admin_sess.get(f"{API}/notifications/unread-count", timeout=10).json()["count"]
        assert after == before + 1

        latest = admin_sess.get(f"{API}/notifications?limit=5", timeout=10).json()[0]
        assert latest["type"] == "transaction"
        assert latest["title"].startswith("Income")
        assert "TEST_iter16 tx" in latest["message"]
        assert latest["link"] == "/transactions"
        assert latest["metadata"]["transaction_id"] == tx["id"]
        assert latest["metadata"]["type"] == "income"

        # cleanup
        blr1_sess.delete(f"{API}/transactions/{tx['id']}", timeout=10)

    def test_super_admin_transaction_does_NOT_notify(self, admin_sess):
        # admin needs an account
        accs = admin_sess.get(f"{API}/accounts", timeout=10).json()
        if not accs:
            pytest.skip("admin has no account; cannot test self-trigger suppression")
        before = admin_sess.get(f"{API}/notifications/unread-count", timeout=10).json()["count"]
        payload = {
            "type": "expense",
            "amount": 11,
            "account_id": accs[0]["id"],
            "date": "2026-01-15",
            "description": "TEST_iter16 admin self tx",
        }
        r = admin_sess.post(f"{API}/transactions", json=payload, timeout=15)
        assert r.status_code in (200, 201), r.text
        tx = r.json()
        after = admin_sess.get(f"{API}/notifications/unread-count", timeout=10).json()["count"]
        assert after == before, f"super_admin self-action should not create notif; before={before} after={after}"

        # cleanup
        admin_sess.delete(f"{API}/transactions/{tx['id']}", timeout=10)


# -------------------- 4. trigger: student_enrolled --------------------
class TestStudentTrigger:
    def test_office_admin_student_notifies(self, admin_sess, blr1_sess):
        before = admin_sess.get(f"{API}/notifications/unread-count", timeout=10).json()["count"]
        payload = {
            "name": "TEST_iter16 Student",
            "college": "Acme College",
            "course": "BSc CS",
            "reference": "Ravi Kumar",
            "admission_date": "2026-01-15",
        }
        r = blr1_sess.post(f"{API}/students", json=payload, timeout=15)
        assert r.status_code in (200, 201), r.text
        st = r.json()

        after = admin_sess.get(f"{API}/notifications/unread-count", timeout=10).json()["count"]
        assert after == before + 1

        latest = admin_sess.get(f"{API}/notifications?limit=5", timeout=10).json()[0]
        assert latest["type"] == "student_enrolled"
        assert "New admission" in latest["title"]
        assert "TEST_iter16 Student" in latest["message"]
        assert "Acme College" in latest["message"]
        assert latest["link"] == f"/students/{st['id']}"
        assert latest["metadata"]["student_id"] == st["id"]
        assert latest["metadata"]["reference"] == "Ravi Kumar"

        # cleanup
        blr1_sess.delete(f"{API}/students/{st['id']}", timeout=10)

    def test_super_admin_student_does_NOT_notify(self, admin_sess):
        before = admin_sess.get(f"{API}/notifications/unread-count", timeout=10).json()["count"]
        payload = {
            "name": "TEST_iter16 Admin Student",
            "college": "Acme",
            "course": "BCom",
            "admission_date": "2026-01-15",
        }
        r = admin_sess.post(f"{API}/students", json=payload, timeout=15)
        if r.status_code not in (200, 201):
            pytest.skip(f"admin cannot create student here: {r.status_code} {r.text}")
        st = r.json()
        after = admin_sess.get(f"{API}/notifications/unread-count", timeout=10).json()["count"]
        assert after == before, "super_admin enrolling should not notify"

        # cleanup
        admin_sess.delete(f"{API}/students/{st['id']}", timeout=10)


# -------------------- 5. mark read / read-all / delete + 404 --------------------
class TestMarkAndDelete:
    def _seed_one(self, admin_sess, blr1_sess, blr1_account):
        """Force-create one notification by submitting an expense request from blr1."""
        r = blr1_sess.post(f"{API}/expense-requests", json={
            "amount": 7,
            "account_id": blr1_account["id"],
            "date": "2026-01-15",
            "description": "TEST_iter16 seed",
            "urgency": "normal",
            "kind": "expense",
        }, timeout=15)
        assert r.status_code in (200, 201), r.text
        req_id = r.json()["id"]
        # find the just-created notif
        notif = admin_sess.get(f"{API}/notifications?limit=5", timeout=10).json()[0]
        return notif, req_id

    def test_mark_read_decreases_unread(self, admin_sess, blr1_sess, blr1_account):
        notif, req_id = self._seed_one(admin_sess, blr1_sess, blr1_account)
        assert notif["read"] is False
        before = admin_sess.get(f"{API}/notifications/unread-count", timeout=10).json()["count"]
        r = admin_sess.post(f"{API}/notifications/{notif['id']}/read", timeout=10)
        assert r.status_code == 200, r.text
        after = admin_sess.get(f"{API}/notifications/unread-count", timeout=10).json()["count"]
        assert after == before - 1

        # cleanup
        admin_sess.delete(f"{API}/notifications/{notif['id']}", timeout=10)
        blr1_sess.delete(f"{API}/expense-requests/{req_id}", timeout=10)

    def test_mark_read_other_user_returns_404(self, admin_sess, blr1_sess, blr1_account):
        notif, req_id = self._seed_one(admin_sess, blr1_sess, blr1_account)
        # blr1 tries to mark admin's notif → 404
        r = blr1_sess.post(f"{API}/notifications/{notif['id']}/read", timeout=10)
        assert r.status_code == 404, f"expected 404 got {r.status_code} {r.text}"

        # cleanup
        admin_sess.delete(f"{API}/notifications/{notif['id']}", timeout=10)
        blr1_sess.delete(f"{API}/expense-requests/{req_id}", timeout=10)

    def test_delete_other_user_returns_404(self, admin_sess, blr1_sess, blr1_account):
        notif, req_id = self._seed_one(admin_sess, blr1_sess, blr1_account)
        r = blr1_sess.delete(f"{API}/notifications/{notif['id']}", timeout=10)
        assert r.status_code == 404
        # cleanup
        admin_sess.delete(f"{API}/notifications/{notif['id']}", timeout=10)
        blr1_sess.delete(f"{API}/expense-requests/{req_id}", timeout=10)

    def test_delete_own(self, admin_sess, blr1_sess, blr1_account):
        notif, req_id = self._seed_one(admin_sess, blr1_sess, blr1_account)
        r = admin_sess.delete(f"{API}/notifications/{notif['id']}", timeout=10)
        assert r.status_code == 200, r.text
        # verify gone
        ids = [n["id"] for n in admin_sess.get(f"{API}/notifications?limit=200", timeout=10).json()]
        assert notif["id"] not in ids
        # cleanup expense request
        blr1_sess.delete(f"{API}/expense-requests/{req_id}", timeout=10)

    def test_read_all_clears_unread(self, admin_sess, blr1_sess, blr1_account):
        # seed 2 fresh notifications
        seeded = []
        for _ in range(2):
            n, req = self._seed_one(admin_sess, blr1_sess, blr1_account)
            seeded.append((n, req))
        r = admin_sess.post(f"{API}/notifications/read-all", timeout=10)
        assert r.status_code == 200, r.text
        assert r.json().get("ok") is True
        cnt = admin_sess.get(f"{API}/notifications/unread-count", timeout=10).json()["count"]
        assert cnt == 0

        # cleanup
        for n, req in seeded:
            admin_sess.delete(f"{API}/notifications/{n['id']}", timeout=10)
            blr1_sess.delete(f"{API}/expense-requests/{req}", timeout=10)
