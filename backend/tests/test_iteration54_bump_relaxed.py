"""Iteration 54: auto-bump on /api/public/applications with RELAXED match set.

Previously bump_lead_on_application only matched leads in status IN
[converted, application_submitted]. The fix extends it to also match
('new', 'not_connected', 'interested', 'follow_up'), so a lead sitting
in any pre-application stage cascades correctly when its phone matches
a public application submission.

Cascade rules:
  * pre_app status → application_submitted (always)
  * application_submitted → fee_paid (only if payment.registration_amount > 0)
  * status_history entries reflect the ACTUAL starting status ("from") and
    are actored as "System · Application submitted".
  * Leads already past application (fee_paid/completed/admission_confirmed
    /lost/not_turned) are UNTOUCHED (0 new history entries).
  * Phone normalization: last-10-digits.
"""
from __future__ import annotations

import os
import time
import uuid
import pytest
import requests
from dotenv import load_dotenv

load_dotenv("/app/frontend/.env")
BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")

SUPER = {"email": "admin@kmfoundation.online", "password": "Admin@786"}

created_lead_ids: list[str] = []
created_student_ids: list[str] = []


def _login(creds):
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json=creds, timeout=20)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return s


@pytest.fixture(scope="module")
def super_s():
    return _login(SUPER)


def _unique_phone(i: int = 0) -> str:
    # 10 digit unique, format 88880xxxxx
    tail = int(time.time() * 1000) % 100000
    return f"88880{tail:05d}"[:10]


def _phone_iter():
    base = int(time.time() * 1000) % 100000
    counter = {"i": 0}

    def nxt():
        counter["i"] += 1
        tail = (base + counter["i"]) % 100000
        return f"88880{tail:05d}"[:10]
    return nxt


nxt_phone = _phone_iter()


def _mk_lead(s, name, phone, status="new"):
    body = {
        "name": f"IT54 {name} {uuid.uuid4().hex[:5]}",
        "phone": phone,
        "source": "walk_in",
        "status": status,
    }
    r = s.post(f"{BASE_URL}/api/leads", json=body)
    assert r.status_code == 201, r.text
    d = r.json()
    created_lead_ids.append(d["id"])
    # If status wasn't set (some codepaths default to new), PATCH to force it.
    if d.get("status") != status:
        rp = s.patch(f"{BASE_URL}/api/leads/{d['id']}", json={"status": status})
        assert rp.status_code == 200, rp.text
        d = rp.json()
    return d


def _get_lead(s, lead_id):
    # Use list search: no direct GET /leads/{id}. Use q= to find.
    r = s.get(f"{BASE_URL}/api/leads")
    assert r.status_code == 200
    for x in r.json():
        if x["id"] == lead_id:
            return x
    raise AssertionError(f"lead {lead_id} not found in listing")


def _apply_payload(name, phone, reg_amount=0.0):
    return {
        "basic_info": {
            "student_full_name": name,
            "mobile_number": phone,
            "email": f"it54_{uuid.uuid4().hex[:6]}@example.com",
            "date_of_birth": "2005-01-01",
            "gender": "male",
        },
        "course": {"interested_course": "B.Sc Nursing"},
        "communication": {
            "father_name": "Test Father", "father_mobile": "9000000000",
            "address_line_1": "1 Test St", "city": "Bengaluru",
            "state": "Karnataka", "pincode": "560001",
        },
        "academic": {"twelfth": {"register_number": "REG54"}},
        "payment": {"registration_amount": reg_amount, "payment_date": "2026-01-15"},
        "reference": {"name": "Referee"},
        "declaration": {"agreement_accepted": True},
    }


def _submit(payload):
    r = requests.post(f"{BASE_URL}/api/public/applications", json=payload, timeout=20)
    assert r.status_code == 201, r.text
    sid = r.json()["id"]
    created_student_ids.append(sid)
    return sid


def _new_history(before_hist, after_hist):
    """Return only the entries added since the previous snapshot."""
    old_ids = {h.get("id") for h in (before_hist or [])}
    return [h for h in (after_hist or []) if h.get("id") not in old_ids]


ACTOR = "System · Application submitted"


# ---------------- pre-application cascade tests ----------------

@pytest.mark.parametrize("start_status", ["new", "converted", "interested", "follow_up", "not_connected"])
def test_pre_app_status_cascades_to_fee_paid(super_s, start_status):
    """Cascade: <start_status> → application_submitted → fee_paid (reg > 0)."""
    phone = nxt_phone()
    lead = _mk_lead(super_s, f"cascade-{start_status}", phone=phone, status=start_status)
    before = _get_lead(super_s, lead["id"])
    before_hist = before.get("status_history") or []

    sid = _submit(_apply_payload(f"IT54 {start_status}", phone, reg_amount=5000))

    after = _get_lead(super_s, lead["id"])
    assert after["status"] == "fee_paid", f"start={start_status} → {after['status']} (expected fee_paid)"
    assert after.get("application_student_id") == sid

    new_hist = _new_history(before_hist, after.get("status_history"))
    assert len(new_hist) == 2, f"expected 2 new events, got {len(new_hist)}: {new_hist}"
    e1, e2 = new_hist[0], new_hist[1]
    assert e1["from"] == start_status and e1["to"] == "application_submitted", e1
    assert e2["from"] == "application_submitted" and e2["to"] == "fee_paid", e2
    assert e1.get("by_name") == ACTOR
    assert e2.get("by_name") == ACTOR
    assert e1.get("metadata", {}).get("student_id") == sid
    assert e2.get("metadata", {}).get("amount") == 5000


def test_no_cascade_when_registration_zero(super_s):
    """converted → application_submitted ONLY (no fee_paid) when reg=0."""
    phone = nxt_phone()
    lead = _mk_lead(super_s, "no-cascade", phone=phone, status="converted")
    before = _get_lead(super_s, lead["id"])
    before_hist = before.get("status_history") or []

    _submit(_apply_payload("IT54 NoCascade", phone, reg_amount=0))

    after = _get_lead(super_s, lead["id"])
    assert after["status"] == "application_submitted"
    new_hist = _new_history(before_hist, after.get("status_history"))
    assert len(new_hist) == 1, f"expected 1 new event, got {len(new_hist)}"
    assert new_hist[0]["from"] == "converted" and new_hist[0]["to"] == "application_submitted"


# ---------------- untouched-status tests ----------------

@pytest.mark.parametrize("terminal", ["fee_paid", "completed", "admission_confirmed", "lost", "not_turned"])
def test_terminal_status_untouched(super_s, terminal):
    """Leads already past application are LEFT ALONE — no status change, no history."""
    phone = nxt_phone()
    # Some statuses require a lost_reason etc., but we're just PATCHing via update_lead
    # which only validates the enum. lost is fine.
    lead = _mk_lead(super_s, f"term-{terminal}", phone=phone, status=terminal)
    before = _get_lead(super_s, lead["id"])
    before_status = before["status"]
    before_hist = before.get("status_history") or []

    _submit(_apply_payload(f"IT54 Term {terminal}", phone, reg_amount=1000))

    after = _get_lead(super_s, lead["id"])
    assert after["status"] == before_status, f"terminal {terminal} was bumped to {after['status']}"
    new_hist = _new_history(before_hist, after.get("status_history"))
    assert len(new_hist) == 0, f"expected 0 new events, got {len(new_hist)}: {new_hist}"


# ---------------- phone normalization ----------------

def test_phone_normalization_lead_prefix_apply_bare(super_s):
    """Lead phone '+91-98765xxxxx' matches /apply mobile_number '98765xxxxx'."""
    phone_bare = nxt_phone()
    phone_lead = f"+91-{phone_bare}"
    lead = _mk_lead(super_s, "norm-a", phone=phone_lead, status="new")
    _submit(_apply_payload("IT54 NormA", phone_bare, reg_amount=100))
    after = _get_lead(super_s, lead["id"])
    assert after["status"] == "fee_paid"


def test_phone_normalization_lead_bare_apply_prefix(super_s):
    """Reverse — lead bare, apply prefixed."""
    phone_bare = nxt_phone()
    lead = _mk_lead(super_s, "norm-b", phone=phone_bare, status="new")
    _submit(_apply_payload("IT54 NormB", f"+91 {phone_bare[:5]} {phone_bare[5:]}", reg_amount=100))
    after = _get_lead(super_s, lead["id"])
    assert after["status"] == "fee_paid"


# ---------------- no matching lead ----------------

def test_no_matching_phone_returns_201_no_effect(super_s):
    """Non-matching phone: /apply still succeeds, no leads mutated."""
    stray_phone = f"97{int(time.time()*1000) % 100000000:08d}"[:10]
    sid = _submit(_apply_payload("IT54 NoMatch", stray_phone, reg_amount=500))
    assert sid


# ---------------- teardown ----------------

def teardown_module(module):
    s = _login(SUPER)
    for lid in set(created_lead_ids):
        try:
            s.delete(f"{BASE_URL}/api/leads/{lid}")
        except Exception:
            pass
    for sid in set(created_student_ids):
        try:
            s.delete(f"{BASE_URL}/api/students/{sid}")
        except Exception:
            pass
