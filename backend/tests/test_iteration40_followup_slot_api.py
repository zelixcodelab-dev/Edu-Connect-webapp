"""Integration tests for GET /api/leads/next-followup-slot (iteration 40)."""
from datetime import datetime, timedelta, timezone
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
STAFF_EMAIL = "staff.blr@kmfoundation.online"
STAFF_PASSWORD = "Staff@123"

IST = timezone(timedelta(hours=5, minutes=30))


@pytest.fixture(scope="module")
def staff_session():
    s = requests.Session()
    r = s.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": STAFF_EMAIL, "password": STAFF_PASSWORD},
        timeout=15,
    )
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return s


@pytest.fixture(scope="module")
def created_leads():
    return []


def _cleanup(session, leads):
    for lid in leads:
        try:
            session.delete(f"{BASE_URL}/api/leads/{lid}", timeout=10)
        except Exception:
            pass


def test_initial_slot_is_first_when_empty(staff_session, created_leads):
    # Drop any existing leads owned by Staff for a clean slate
    r = staff_session.get(f"{BASE_URL}/api/leads", timeout=15)
    assert r.status_code == 200
    for d in r.json():
        if d.get("next_follow_up"):
            staff_session.patch(
                f"{BASE_URL}/api/leads/{d['id']}", json={"next_follow_up": None}, timeout=10
            )

    r = staff_session.get(f"{BASE_URL}/api/leads/next-followup-slot", timeout=15)
    assert r.status_code == 200
    data = r.json()
    assert "slot" in data and "is_first" in data and "window" in data
    assert data["is_first"] is True
    # IST window: must be inside [10:00, 19:00) IST
    dt = datetime.fromisoformat(data["slot"].replace("Z", "+00:00")).astimezone(IST)
    assert 10 <= dt.hour < 19, f"slot {dt} not in IST window"
    assert dt.minute % 5 == 0, f"slot not on 5-min mark: {dt}"
    assert data["window"]["step_minutes"] == 5


def test_slot_advances_5min_after_booking(staff_session, created_leads):
    # Fetch first slot
    r = staff_session.get(f"{BASE_URL}/api/leads/next-followup-slot", timeout=15)
    data = r.json()
    first_slot_iso = data["slot"]
    assert data["is_first"] is True

    # Book a lead with that slot
    r = staff_session.post(
        f"{BASE_URL}/api/leads",
        json={
            "name": "TEST_IT40_first",
            "phone": "9000000001",
            "next_follow_up": first_slot_iso,
        },
        timeout=15,
    )
    assert r.status_code == 201, r.text
    lead1 = r.json()
    created_leads.append(lead1["id"])
    assert lead1["next_follow_up"] == first_slot_iso

    # Next slot must be +5 minutes AND is_first=false
    r = staff_session.get(f"{BASE_URL}/api/leads/next-followup-slot", timeout=15)
    data2 = r.json()
    assert data2["is_first"] is False
    t1 = datetime.fromisoformat(first_slot_iso.replace("Z", "+00:00"))
    t2 = datetime.fromisoformat(data2["slot"].replace("Z", "+00:00"))
    assert (t2 - t1) == timedelta(minutes=5), f"expected +5min, got {t2 - t1}"


def test_exclude_lead_id_restores_is_first(staff_session, created_leads):
    # We have 1 future booked lead from previous test
    assert created_leads, "expected lead from previous test"
    lid = created_leads[0]
    r = staff_session.get(
        f"{BASE_URL}/api/leads/next-followup-slot",
        params={"exclude_lead_id": lid},
        timeout=15,
    )
    assert r.status_code == 200
    data = r.json()
    assert data["is_first"] is True, "excluding own lead should empty future timeline"


def test_second_booking_advances_again(staff_session, created_leads):
    r = staff_session.get(f"{BASE_URL}/api/leads/next-followup-slot", timeout=15)
    slot = r.json()["slot"]
    r = staff_session.post(
        f"{BASE_URL}/api/leads",
        json={"name": "TEST_IT40_second", "phone": "9000000002", "next_follow_up": slot},
        timeout=15,
    )
    assert r.status_code == 201
    lead2 = r.json()
    created_leads.append(lead2["id"])

    r3 = staff_session.get(f"{BASE_URL}/api/leads/next-followup-slot", timeout=15)
    d3 = r3.json()
    assert d3["is_first"] is False
    t2 = datetime.fromisoformat(slot.replace("Z", "+00:00"))
    t3 = datetime.fromisoformat(d3["slot"].replace("Z", "+00:00"))
    assert (t3 - t2) == timedelta(minutes=5)


def test_followup_post_advances_slot(staff_session, created_leads):
    # Use the first created lead and add a follow-up via POST /followups
    lid = created_leads[0]
    r = staff_session.get(f"{BASE_URL}/api/leads/next-followup-slot", timeout=15)
    slot = r.json()["slot"]
    r = staff_session.post(
        f"{BASE_URL}/api/leads/{lid}/followups",
        json={"at": slot, "note": "TEST_IT40 followup"},
        timeout=15,
    )
    assert r.status_code == 201, r.text
    updated = r.json()
    assert updated["next_follow_up"] == slot

    r2 = staff_session.get(f"{BASE_URL}/api/leads/next-followup-slot", timeout=15)
    d2 = r2.json()
    t1 = datetime.fromisoformat(slot.replace("Z", "+00:00"))
    t2 = datetime.fromisoformat(d2["slot"].replace("Z", "+00:00"))
    assert (t2 - t1) == timedelta(minutes=5)


def test_cleanup_module(staff_session, created_leads):
    _cleanup(staff_session, created_leads)
    created_leads.clear()
