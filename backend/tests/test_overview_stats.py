# Overview launcher: /api/dashboard/overview-stats + inbox pending_approvals
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().rstrip("/")

CREDS = {
    "super": ("admin@educonnect.app", "Admin@12345"),
    "office": ("office@educonnect.app", "Office@12345"),
    "staff": ("TEST_att_staff_1@educonnect.app", "Staff@12345"),
}


def _login(kind):
    e, p = CREDS[kind]
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": e, "password": p})
    if r.status_code != 200:
        pytest.skip(f"login failed for {kind}: {r.status_code} {r.text[:200]}")
    tok = r.json().get("token") or r.json().get("access_token")
    if tok:
        s.headers["Authorization"] = f"Bearer {tok}"
    return s, r.json().get("user", {})


@pytest.fixture(scope="module")
def sup():
    return _login("super")


@pytest.fixture(scope="module")
def off():
    return _login("office")


@pytest.fixture(scope="module")
def staff():
    # TEST_att_staff_1 is soft-deleted; fall back to a pre-minted staff token at /tmp/staff_tok
    if os.path.exists("/tmp/staff_tok"):
        s = requests.Session()
        s.headers["Authorization"] = "Bearer " + open("/tmp/staff_tok").read().strip()
        return s, {}
    return _login("staff")


KEYS = {"total_leads", "admissions", "collections_month", "pending_tasks", "currency"}


def test_overview_stats_super(sup):
    s, _ = sup
    r = s.get(f"{BASE_URL}/api/dashboard/overview-stats")
    assert r.status_code == 200, r.text
    d = r.json()
    print(d)
    assert KEYS <= set(d)
    assert isinstance(d["total_leads"], int) and isinstance(d["admissions"], int)
    assert isinstance(d["collections_month"], (int, float))
    assert isinstance(d["currency"], str)


def test_pending_tasks_equals_inbox_sum(sup):
    s, _ = sup
    d = s.get(f"{BASE_URL}/api/dashboard/overview-stats").json()
    b = s.get(f"{BASE_URL}/api/dashboard/inbox").json()
    print(b)
    assert "pending_approvals" in b
    assert d["pending_tasks"] == b["followups_due"] + b["new_applications"] + b["pending_approvals"]


def test_overview_stats_office(off):
    s, _ = off
    r = s.get(f"{BASE_URL}/api/dashboard/overview-stats")
    assert r.status_code == 200, r.text
    d = r.json()
    print("office", d)
    assert KEYS <= set(d)


def test_office_leads_scoped(sup, off):
    s1, _ = sup
    s2, ou = off
    a = s1.get(f"{BASE_URL}/api/dashboard/overview-stats").json()
    b = s2.get(f"{BASE_URL}/api/dashboard/overview-stats").json()
    print("super leads", a["total_leads"], "office leads", b["total_leads"], ou.get("office"))
    assert b["total_leads"] <= a["total_leads"]


def test_office_inbox_approvals_zero(off):
    s, _ = off
    b = s.get(f"{BASE_URL}/api/dashboard/inbox").json()
    assert b["pending_approvals"] == 0


def test_staff_forbidden(staff):
    s, _ = staff
    r = s.get(f"{BASE_URL}/api/dashboard/overview-stats")
    assert r.status_code == 403


def test_staff_inbox_has_pending_approvals(staff):
    s, _ = staff
    r = s.get(f"{BASE_URL}/api/dashboard/inbox")
    assert r.status_code == 200
    assert r.json()["pending_approvals"] == 0


def test_unauth():
    r = requests.get(f"{BASE_URL}/api/dashboard/overview-stats")
    assert r.status_code in (401, 403)


# Office-scoping of pending tasks: overdue follow-up on a lead outside office admin's office
def test_office_pending_tasks_scoped(sup, off):
    s1, _ = sup
    s2, _ = off
    r = s1.post(f"{BASE_URL}/api/leads", json={"name": "TEST_ovw_scope", "phone": "+10000000001", "status": "follow_up",
                                              "next_follow_up": "2026-01-01T00:00:00+00:00"})
    assert r.status_code in (200, 201), r.text
    lid = r.json()["id"]
    try:
        assert r.json().get("office") is None
        b = s2.get(f"{BASE_URL}/api/dashboard/inbox").json()
        listed = s2.get(f"{BASE_URL}/api/leads").json()
        ids = [x.get("id") for x in (listed if isinstance(listed, list) else listed.get("items", listed.get("leads", [])))]
        assert lid not in ids
        # office admin cannot see this lead, so it must not count toward their follow-ups due
        assert b["followups_due"] == 0, f"office inbox counts unscoped leads: {b}"
    finally:
        s1.delete(f"{BASE_URL}/api/leads/{lid}")
