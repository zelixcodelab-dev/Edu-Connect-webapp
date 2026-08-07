"""Iteration 41 — Campaigns CRM feature integration tests.

Covers:
  - create campaign as office_admin (auto office) and super_admin (requires office)
  - manual add leads (unassigned)
  - distribute: equal, count, percentage; scope unassigned/all
  - office scope isolation; staff forbidden
  - cleanup: deletes any QA_ campaigns + leads created
"""
from __future__ import annotations

import io
import pytest
import requests

from tests._creds import api_base, admin_credentials, office_credentials

BASE = api_base()
QA_PREFIX = "QA_IT41_"


def _login(email: str, password: str) -> requests.Session:
    s = requests.Session()
    r = s.post(f"{BASE}/auth/login", json={"email": email, "password": password}, timeout=20)
    assert r.status_code == 200, f"login failed for {email}: {r.status_code} {r.text}"
    return s


@pytest.fixture(scope="module")
def admin():
    e, p = admin_credentials()
    return _login(e, p)


@pytest.fixture(scope="module")
def office():
    e, p = office_credentials("blr1")
    return _login(e, p)


@pytest.fixture(scope="module")
def staff():
    s = requests.Session()
    r = s.post(
        f"{BASE}/auth/login",
        json={"email": "staff.blr@kmfoundation.online", "password": "Staff@123"},
        timeout=20,
    )
    if r.status_code != 200:
        pytest.skip(f"staff login not available: {r.status_code}")
    return s


@pytest.fixture(scope="module", autouse=True)
def _cleanup(request, admin):
    created_campaigns: list[str] = []
    created_leads: list[str] = []
    request.config._qa_campaigns = created_campaigns
    request.config._qa_leads = created_leads

    yield

    # Cleanup: detach + delete any campaigns we made; then delete leads tagged QA_.
    for cid in list(created_campaigns):
        try:
            # Fetch leads tied to this campaign before deletion
            r = admin.get(f"{BASE}/leads", params={"campaign_id": cid}, timeout=20)
            if r.status_code == 200:
                for ld in r.json() or []:
                    if ld.get("id"):
                        admin.delete(f"{BASE}/leads/{ld['id']}", timeout=20)
            admin.delete(f"{BASE}/campaigns/{cid}", timeout=20)
        except Exception:
            pass
    # Mop up any orphan QA_ leads
    try:
        r = admin.get(f"{BASE}/leads", timeout=20)
        if r.status_code == 200:
            for ld in r.json() or []:
                if (ld.get("name") or "").startswith(QA_PREFIX):
                    admin.delete(f"{BASE}/leads/{ld['id']}", timeout=20)
    except Exception:
        pass


def _track(request, campaign_id: str):
    request.config._qa_campaigns.append(campaign_id)


# ---------------- Campaign CRUD ----------------
def test_office_admin_create_campaign_auto_office(office, request):
    body = {"name": f"{QA_PREFIX}OffAuto", "description": "ofc auto"}
    r = office.post(f"{BASE}/campaigns", json=body, timeout=20)
    assert r.status_code == 201, r.text
    data = r.json()
    assert data["name"] == body["name"]
    assert data["office"] == "KM_BLR", "Office admin office must be forced to KM_BLR"
    assert data["stats"] == {"total": 0, "assigned": 0, "unassigned": 0, "converted": 0}
    _track(request, data["id"])


def test_super_admin_create_campaign_requires_office(admin, request):
    # Missing office should 400
    r = admin.post(f"{BASE}/campaigns", json={"name": f"{QA_PREFIX}NoOffice"}, timeout=20)
    assert r.status_code == 400

    # With office
    r = admin.post(
        f"{BASE}/campaigns",
        json={"name": f"{QA_PREFIX}SuperOK", "office": "KM_BLR"},
        timeout=20,
    )
    assert r.status_code == 201, r.text
    cid = r.json()["id"]
    _track(request, cid)


def test_list_and_get_campaign(office):
    r = office.get(f"{BASE}/campaigns", timeout=20)
    assert r.status_code == 200
    items = r.json()
    assert any(c["name"].startswith(QA_PREFIX) for c in items)
    cid = next(c["id"] for c in items if c["name"].startswith(QA_PREFIX))

    r = office.get(f"{BASE}/campaigns/{cid}", timeout=20)
    assert r.status_code == 200
    detail = r.json()
    assert "campaign" in detail and "employees" in detail and "stats" in detail


# ---------------- Manual add leads ----------------
def test_add_leads_unassigned_and_stats(office, request):
    r = office.post(
        f"{BASE}/campaigns",
        json={"name": f"{QA_PREFIX}AddLeads", "description": "manual"},
        timeout=20,
    )
    cid = r.json()["id"]
    _track(request, cid)

    payload = {"leads": [
        {"name": f"{QA_PREFIX}A", "phone": "9991110001"},
        {"name": f"{QA_PREFIX}B", "phone": "9991110002"},
        {"name": f"{QA_PREFIX}C", "phone": "9991110003"},
    ]}
    r = office.post(f"{BASE}/campaigns/{cid}/leads", json=payload, timeout=20)
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["created_count"] == 3
    assert body["stats"]["total"] == 3
    assert body["stats"]["unassigned"] == 3
    assert body["stats"]["assigned"] == 0

    # Verify persistence via GET /leads?campaign_id=
    r = office.get(f"{BASE}/leads", params={"campaign_id": cid}, timeout=20)
    assert r.status_code == 200
    leads = r.json()
    assert len(leads) == 3
    assert all(ld.get("assigned_to_user_id") in (None, "") for ld in leads)
    assert all(ld.get("office") == "KM_BLR" for ld in leads)


# ---------------- Distribute ----------------
def _employees(session, cid):
    r = session.get(f"{BASE}/campaigns/{cid}", timeout=20)
    return r.json()["employees"]


def test_distribute_equal(office, request):
    r = office.post(f"{BASE}/campaigns", json={"name": f"{QA_PREFIX}Equal"}, timeout=20)
    cid = r.json()["id"]
    _track(request, cid)
    office.post(f"{BASE}/campaigns/{cid}/leads", json={"leads": [
        {"name": f"{QA_PREFIX}E{i}"} for i in range(5)
    ]}, timeout=20)
    emps = _employees(office, cid)
    assert len(emps) >= 2
    emp_ids = [emps[0]["id"], emps[1]["id"]]

    r = office.post(
        f"{BASE}/campaigns/{cid}/distribute",
        json={"method": "equal", "employee_ids": emp_ids, "scope": "unassigned"},
        timeout=20,
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["assigned"] == 5
    counts = {row["id"]: row["count"] for row in data["per_employee"]}
    assert sorted(counts.values()) == [2, 3]
    assert data["stats"]["unassigned"] == 0
    assert data["stats"]["assigned"] == 5


def test_distribute_by_count_with_surplus(office, request):
    r = office.post(f"{BASE}/campaigns", json={"name": f"{QA_PREFIX}Count"}, timeout=20)
    cid = r.json()["id"]
    _track(request, cid)
    office.post(f"{BASE}/campaigns/{cid}/leads", json={"leads": [
        {"name": f"{QA_PREFIX}C{i}"} for i in range(5)
    ]}, timeout=20)
    emps = _employees(office, cid)
    emp_ids = [emps[0]["id"], emps[1]["id"]]
    counts = {emp_ids[0]: 4, emp_ids[1]: 1}

    r = office.post(
        f"{BASE}/campaigns/{cid}/distribute",
        json={"method": "count", "employee_ids": emp_ids, "counts": counts, "scope": "all"},
        timeout=20,
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["assigned"] == 5
    per = {row["id"]: row["count"] for row in data["per_employee"]}
    assert per[emp_ids[0]] == 4
    assert per[emp_ids[1]] == 1


def test_distribute_by_count_surplus_unassigned(office, request):
    r = office.post(f"{BASE}/campaigns", json={"name": f"{QA_PREFIX}CountSmall"}, timeout=20)
    cid = r.json()["id"]
    _track(request, cid)
    office.post(f"{BASE}/campaigns/{cid}/leads", json={"leads": [
        {"name": f"{QA_PREFIX}cs{i}"} for i in range(5)
    ]}, timeout=20)
    emps = _employees(office, cid)
    emp_ids = [emps[0]["id"], emps[1]["id"]]
    counts = {emp_ids[0]: 2, emp_ids[1]: 1}  # leaves 2 unassigned
    r = office.post(
        f"{BASE}/campaigns/{cid}/distribute",
        json={"method": "count", "employee_ids": emp_ids, "counts": counts, "scope": "all"},
        timeout=20,
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["assigned"] == 3
    assert data["stats"]["unassigned"] == 2


def test_distribute_by_percentage(office, request):
    r = office.post(f"{BASE}/campaigns", json={"name": f"{QA_PREFIX}Pct"}, timeout=20)
    cid = r.json()["id"]
    _track(request, cid)
    office.post(f"{BASE}/campaigns/{cid}/leads", json={"leads": [
        {"name": f"{QA_PREFIX}p{i}"} for i in range(5)
    ]}, timeout=20)
    emps = _employees(office, cid)
    emp_ids = [emps[0]["id"], emps[1]["id"]]
    pcts = {emp_ids[0]: 80, emp_ids[1]: 20}
    r = office.post(
        f"{BASE}/campaigns/{cid}/distribute",
        json={"method": "percentage", "employee_ids": emp_ids, "percentages": pcts, "scope": "all"},
        timeout=20,
    )
    assert r.status_code == 200, r.text
    data = r.json()
    per = {row["id"]: row["count"] for row in data["per_employee"]}
    assert per[emp_ids[0]] == 4
    assert per[emp_ids[1]] == 1


def test_distribute_invalid_method(office, request):
    r = office.post(f"{BASE}/campaigns", json={"name": f"{QA_PREFIX}Bad"}, timeout=20)
    cid = r.json()["id"]
    _track(request, cid)
    office.post(f"{BASE}/campaigns/{cid}/leads", json={"leads": [{"name": f"{QA_PREFIX}x"}]}, timeout=20)
    emps = _employees(office, cid)
    r = office.post(
        f"{BASE}/campaigns/{cid}/distribute",
        json={"method": "bogus", "employee_ids": [emps[0]["id"]]},
        timeout=20,
    )
    assert r.status_code == 400


def test_distribute_no_leads_in_scope(office, request):
    r = office.post(f"{BASE}/campaigns", json={"name": f"{QA_PREFIX}Empty"}, timeout=20)
    cid = r.json()["id"]
    _track(request, cid)
    emps = _employees(office, cid)
    r = office.post(
        f"{BASE}/campaigns/{cid}/distribute",
        json={"method": "equal", "employee_ids": [emps[0]["id"]], "scope": "unassigned"},
        timeout=20,
    )
    assert r.status_code == 400


# ---------------- CSV bulk upload to campaign ----------------
def test_csv_upload_to_campaign_unassigned(office, request):
    r = office.post(f"{BASE}/campaigns", json={"name": f"{QA_PREFIX}Csv"}, timeout=20)
    cid = r.json()["id"]
    _track(request, cid)

    csv_text = "name,phone\n" + f"{QA_PREFIX}csv1,9991\n{QA_PREFIX}csv2,9992\n"
    files = {"file": ("leads.csv", io.BytesIO(csv_text.encode()), "text/csv")}
    data = {"campaign_id": cid}
    r = office.post(f"{BASE}/leads/bulk", files=files, data=data, timeout=30)
    assert r.status_code in (200, 201), f"{r.status_code} {r.text}"

    r = office.get(f"{BASE}/campaigns/{cid}", timeout=20)
    assert r.status_code == 200
    stats = r.json()["stats"]
    assert stats["total"] >= 2
    assert stats["unassigned"] >= 2


# ---------------- Scope isolation ----------------
def test_office_admin_cannot_create_other_office_campaign(office, request):
    # Even if office_admin sends a different office, server forces theirs.
    r = office.post(f"{BASE}/campaigns", json={"name": f"{QA_PREFIX}Force", "office": "KM_TCR"}, timeout=20)
    assert r.status_code == 201
    body = r.json()
    assert body["office"] == "KM_BLR"
    _track(request, body["id"])


def test_office_admin_cannot_see_other_office_campaign(admin, office, request):
    # Super admin creates a KM_TCR campaign; office admin (KM_BLR) should not see it.
    r = admin.post(f"{BASE}/campaigns", json={"name": f"{QA_PREFIX}TCR", "office": "KM_TCR"}, timeout=20)
    assert r.status_code == 201, r.text
    cid = r.json()["id"]
    _track(request, cid)
    r2 = office.get(f"{BASE}/campaigns/{cid}", timeout=20)
    assert r2.status_code == 404


# ---------------- Staff forbidden ----------------
def test_staff_cannot_list_or_create_campaigns(staff):
    r = staff.get(f"{BASE}/campaigns", timeout=20)
    assert r.status_code == 403
    r = staff.post(f"{BASE}/campaigns", json={"name": f"{QA_PREFIX}staff"}, timeout=20)
    assert r.status_code == 403
