# Application Preview: pending-applications list, inbox count, approve/reject review API, RBAC
import os
from datetime import datetime, timezone, timedelta

import pytest
import requests
from pymongo import MongoClient

from _creds import api_base

API = api_base()
TENANT_DB = "test_database_t_8286d28c6b04042a"
mdb = MongoClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017"))[TENANT_DB]


def _doc(n, minutes_ago):
    t = (datetime.now(timezone.utc) - timedelta(minutes=minutes_ago)).isoformat()
    return {
        "id": f"TEST_app_{n}", "name": f"TEST Applicant {n}", "course": "BSc Nursing", "college": "City College",
        "status": "inquiry", "created_at": t, "application_submitted_at": t, "notes": "orig note",
        "reference": f"Ref Person {n}",
        "application": {
            "basic_info": {"student_full_name": f"TEST Applicant {n}", "mobile_number": f"98765000{n}",
                           "email": f"test_app_{n}@example.com", "date_of_birth": "2005-01-01", "gender": "female"},
            "course": {"interested_course": "BSc Nursing", "preferred_college": "City College"},
            "communication": {"father_name": "Dad", "father_mobile": "9000000000", "address_line_1": "1 St",
                              "city": "Bengaluru", "state": "KA"},
            "reference": {"name": f"Ref Person {n}"},
            "payments": [],
        },
    }


@pytest.fixture(scope="module", autouse=True)
def seed():
    mdb.students.delete_many({"id": {"$regex": "^TEST_app_"}})
    mdb.students.insert_many([_doc(1, 30), _doc(2, 20), _doc(3, 10), _doc(4, 5)])
    yield
    mdb.students.delete_many({"id": {"$regex": "^TEST_app_"}})


def _login(email, pw):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": email, "password": pw})
    if r.status_code != 200:
        pytest.skip(f"login failed {email}: {r.status_code} {r.text[:200]}")
    tok = r.json().get("token") or r.json().get("access_token")
    if tok:
        s.headers["Authorization"] = f"Bearer {tok}"
    return s


@pytest.fixture(scope="module")
def admin():
    return _login("admin@educonnect.app", "Admin@12345")


@pytest.fixture(scope="module")
def staff():
    return _login("TEST_att_staff_1@educonnect.app", "Staff@12345")


def _ids(admin):
    r = admin.get(f"{API}/dashboard/pending-applications")
    assert r.status_code == 200, r.text
    return [x["id"] for x in r.json()["items"]]


class TestPending:
    def test_list_newest_first(self, admin):
        ids = [i for i in _ids(admin) if i.startswith("TEST_app_")]
        assert ids == ["TEST_app_4", "TEST_app_3", "TEST_app_2", "TEST_app_1"]

    def test_no_mongo_id(self, admin):
        items = admin.get(f"{API}/dashboard/pending-applications").json()["items"]
        assert all("_id" not in x for x in items)

    def test_inbox_count_matches(self, admin):
        n = len(_ids(admin))
        r = admin.get(f"{API}/dashboard/inbox")
        assert r.status_code == 200
        assert r.json()["new_applications"] == n

    def test_staff_forbidden(self, staff):
        assert staff.get(f"{API}/dashboard/pending-applications").status_code == 403
        r = staff.post(f"{API}/dashboard/applications/TEST_app_1/review", json={"decision": "approved"})
        assert r.status_code == 403
        assert mdb.students.find_one({"id": "TEST_app_1"}).get("application_review") is None


class TestReview:
    def test_invalid_decision_422(self, admin):
        r = admin.post(f"{API}/dashboard/applications/TEST_app_1/review", json={"decision": "maybe"})
        assert r.status_code == 422

    def test_unknown_404(self, admin):
        r = admin.post(f"{API}/dashboard/applications/nope_xyz/review", json={"decision": "approved"})
        assert r.status_code == 404

    def test_approve(self, admin):
        before = admin.get(f"{API}/dashboard/inbox").json()["new_applications"]
        r = admin.post(f"{API}/dashboard/applications/TEST_app_1/review", json={"decision": "approved", "reason": ""})
        assert r.status_code == 200 and r.json()["ok"] is True
        d = mdb.students.find_one({"id": "TEST_app_1"})
        assert d["status"] == "inquiry"
        assert d["application_review"]["status"] == "approved"
        assert d["application_review"]["by"] and d["application_review"]["at"]
        assert d["notes"] == "orig note"
        assert "TEST_app_1" not in _ids(admin)
        assert admin.get(f"{API}/dashboard/inbox").json()["new_applications"] == before - 1

    def test_reject_with_reason(self, admin):
        r = admin.post(f"{API}/dashboard/applications/TEST_app_2/review", json={"decision": "rejected", "reason": "  Docs missing  "})
        assert r.status_code == 200
        d = mdb.students.find_one({"id": "TEST_app_2"})
        assert d["status"] == "cancelled"
        assert d["application_review"]["status"] == "rejected"
        assert "[Application rejected] Docs missing" in d["notes"]
        assert d["notes"].startswith("orig note")
        assert "TEST_app_2" not in _ids(admin)

    def test_reject_without_reason(self, admin):
        r = admin.post(f"{API}/dashboard/applications/TEST_app_3/review", json={"decision": "rejected"})
        assert r.status_code == 200
        d = mdb.students.find_one({"id": "TEST_app_3"})
        assert d["status"] == "cancelled" and d["notes"] == "orig note"

    def test_reason_too_long_422(self, admin):
        r = admin.post(f"{API}/dashboard/applications/TEST_app_4/review", json={"decision": "rejected", "reason": "x" * 501})
        assert r.status_code == 422
