"""Iteration 58 — follow-up edit/delete + auto-slot override backend tests.

Covers:
  * PATCH /api/leads/{lead_id}/followups/{followup_id}
      - creator can edit
      - admin can edit
      - staff non-creator → 403
      - unknown followup_id → 404
      - empty payload → 400
      - editing LATEST moves next_follow_up
      - editing OLDER leaves next_follow_up untouched
      - edited_at/edited_by_user_id/edited_by_name set
      - notification enqueued when editor != assignee
  * DELETE /api/leads/{lead_id}/followups/{followup_id}
      - creator + admin can delete
      - staff non-creator → 403
      - deleting LATEST recomputes next_follow_up (or null)
      - follow_up_reminded_for cleared
  * Regressions: POST followup, GET /next-followup-slot
"""

import os
import time
import uuid
import pytest
import requests

def _resolve_base():
    b = os.environ.get("REACT_APP_BACKEND_URL")
    if not b:
        try:
            from pathlib import Path
            for line in Path("/app/frontend/.env").read_text().splitlines():
                if line.startswith("REACT_APP_BACKEND_URL="):
                    b = line.split("=", 1)[1].strip()
                    break
        except Exception:
            pass
    assert b, "REACT_APP_BACKEND_URL not set"
    return b.rstrip("/")

BASE_URL = _resolve_base()
API = f"{BASE_URL}/api"

SUPER = {"email": "muneer@kmfoundation.co", "password": "kmf@0786"}
OFFICE = {"email": "blr1@finflow.com", "password": "Office@123"}
STAFF = {"email": "staff.blr@kmfoundation.online", "password": "Staff@123"}


def _login(creds):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json=creds, timeout=15)
    assert r.status_code == 200, f"login failed for {creds['email']}: {r.status_code} {r.text}"
    return s


@pytest.fixture(scope="module")
def super_client():
    return _login(SUPER)


@pytest.fixture(scope="module")
def staff_client():
    return _login(STAFF)


@pytest.fixture(scope="module")
def super_me(super_client):
    r = super_client.get(f"{API}/auth/me")
    assert r.status_code == 200
    return r.json()


@pytest.fixture(scope="module")
def staff_me(staff_client):
    r = staff_client.get(f"{API}/auth/me")
    assert r.status_code == 200
    return r.json()


_CREATED_LEADS = []


def _mk_lead(client, name, assignee_id=None, status="follow_up"):
    payload = {"name": name, "phone": "9" + str(uuid.uuid4().int)[:9], "status": status,
               "source": "other"}
    if assignee_id:
        payload["assigned_to_user_id"] = assignee_id
    r = client.post(f"{API}/leads", json=payload)
    assert r.status_code == 201, r.text
    lead = r.json()
    _CREATED_LEADS.append(lead["id"])
    return lead


def _add_followup(client, lead_id, at_iso, note=""):
    r = client.post(f"{API}/leads/{lead_id}/followups", json={"at": at_iso, "note": note})
    assert r.status_code == 201, r.text
    return r.json()


def _future_iso(hours_ahead):
    from datetime import datetime, timezone, timedelta
    return (datetime.now(timezone.utc) + timedelta(hours=hours_ahead)).isoformat().replace("+00:00", "Z")


# ---------- Regressions ----------
class TestRegressions:
    def test_next_followup_slot(self, super_client):
        r = super_client.get(f"{API}/leads/next-followup-slot")
        assert r.status_code == 200
        d = r.json()
        assert "slot" in d and "is_first" in d
        assert "window" in d and d["window"]["step_minutes"] == 5

    def test_post_followup_sets_creator_and_next_fu(self, super_client, super_me):
        lead = _mk_lead(super_client, f"TEST_reg_{uuid.uuid4().hex[:6]}")
        at = _future_iso(48)
        fresh = _add_followup(super_client, lead["id"], at, "regression")
        assert fresh["next_follow_up"] == at
        fu = fresh["follow_ups"][-1]
        assert fu["created_by_user_id"] == super_me["id"]
        assert fu["created_by_name"] == super_me.get("name")


# ---------- PATCH followup ----------
class TestPatchFollowup:
    def test_creator_edits_latest_updates_next_fu(self, super_client, super_me):
        lead = _mk_lead(super_client, f"TEST_edit_latest_{uuid.uuid4().hex[:6]}",
                        )
        old = _future_iso(24)
        _add_followup(super_client, lead["id"], old, "orig")
        # add a newer one (which becomes the latest)
        latest_old = _future_iso(72)
        fresh = _add_followup(super_client, lead["id"], latest_old, "latest")
        latest_id = fresh["follow_ups"][-1]["id"]
        assert fresh["next_follow_up"] == latest_old

        new_at = _future_iso(96)
        r = super_client.patch(
            f"{API}/leads/{lead['id']}/followups/{latest_id}",
            json={"at": new_at, "note": "moved"},
        )
        assert r.status_code == 200, r.text
        after = r.json()
        assert after["next_follow_up"] == new_at
        item = next(f for f in after["follow_ups"] if f["id"] == latest_id)
        assert item["at"] == new_at
        assert item["note"] == "moved"
        assert item["edited_by_user_id"] == super_me["id"]
        assert item.get("edited_by_name") == super_me.get("name")
        assert item.get("edited_at")

    def test_editing_older_does_not_change_next_fu(self, super_client, super_me):
        lead = _mk_lead(super_client, f"TEST_edit_old_{uuid.uuid4().hex[:6]}",
                        )
        older_at = _future_iso(24)
        fresh = _add_followup(super_client, lead["id"], older_at, "older")
        older_id = fresh["follow_ups"][-1]["id"]
        latest_at = _future_iso(72)
        fresh = _add_followup(super_client, lead["id"], latest_at, "latest")
        assert fresh["next_follow_up"] == latest_at

        # Edit older
        new_older_at = _future_iso(30)
        r = super_client.patch(
            f"{API}/leads/{lead['id']}/followups/{older_id}",
            json={"at": new_older_at},
        )
        assert r.status_code == 200
        after = r.json()
        assert after["next_follow_up"] == latest_at  # unchanged

    def test_empty_payload_400(self, super_client, super_me):
        lead = _mk_lead(super_client, f"TEST_empty_{uuid.uuid4().hex[:6]}",
                        )
        fresh = _add_followup(super_client, lead["id"], _future_iso(24))
        fid = fresh["follow_ups"][-1]["id"]
        r = super_client.patch(f"{API}/leads/{lead['id']}/followups/{fid}", json={})
        assert r.status_code == 400, r.text

    def test_unknown_followup_404(self, super_client, super_me):
        lead = _mk_lead(super_client, f"TEST_404_{uuid.uuid4().hex[:6]}",
                        )
        r = super_client.patch(
            f"{API}/leads/{lead['id']}/followups/nonexistent-id",
            json={"note": "x"},
        )
        assert r.status_code == 404

    def test_staff_cannot_edit_non_own_followup(self, super_client, staff_client, staff_me):
        # Lead assigned to staff, but the follow-up will be created BY super_admin
        lead = _mk_lead(super_client, f"TEST_staff_denied_{uuid.uuid4().hex[:6]}",
                        assignee_id=staff_me["id"])
        # Add follow-up as super_admin (this makes super_admin the creator)
        fresh = _add_followup(super_client, lead["id"], _future_iso(24))
        fid = fresh["follow_ups"][-1]["id"]
        # Staff tries to edit → should 403 (not creator, not admin)
        r = staff_client.patch(
            f"{API}/leads/{lead['id']}/followups/{fid}",
            json={"note": "hacked"},
        )
        assert r.status_code == 403, r.text

    def test_admin_can_edit_others_followup(self, super_client, staff_client, staff_me):
        lead = _mk_lead(super_client, f"TEST_adm_ok_{uuid.uuid4().hex[:6]}",
                        assignee_id=staff_me["id"])
        # follow-up created by staff
        fresh = _add_followup(staff_client, lead["id"], _future_iso(24), "staff")
        fid = fresh["follow_ups"][-1]["id"]
        # super_admin edits — should succeed
        r = super_client.patch(
            f"{API}/leads/{lead['id']}/followups/{fid}",
            json={"note": "admin edit"},
        )
        assert r.status_code == 200, r.text
        item = next(f for f in r.json()["follow_ups"] if f["id"] == fid)
        assert item["note"] == "admin edit"

    def test_creator_staff_can_edit_own(self, super_client, staff_client, staff_me):
        lead = _mk_lead(super_client, f"TEST_staff_own_{uuid.uuid4().hex[:6]}",
                        assignee_id=staff_me["id"])
        fresh = _add_followup(staff_client, lead["id"], _future_iso(24), "mine")
        fid = fresh["follow_ups"][-1]["id"]
        r = staff_client.patch(
            f"{API}/leads/{lead['id']}/followups/{fid}",
            json={"note": "edited"},
        )
        assert r.status_code == 200

    def test_reschedule_notifies_assignee(self, super_client, staff_client, staff_me, super_me):
        # Lead assigned to staff; super_admin reschedules → staff gets notification
        lead = _mk_lead(super_client, f"TEST_notif_{uuid.uuid4().hex[:6]}",
                        assignee_id=staff_me["id"])
        old = _future_iso(24)
        fresh = _add_followup(super_client, lead["id"], old)
        fid = fresh["follow_ups"][-1]["id"]

        # baseline notif count for staff (type=lead_followup)
        r0 = staff_client.get(f"{API}/notifications")
        assert r0.status_code == 200
        j0 = r0.json()
        items0 = j0.get("items", j0) if isinstance(j0, dict) else j0
        before = [n for n in items0
                  if n.get("type") == "lead_followup" and n.get("metadata", {}).get("lead_id") == lead["id"]]

        new_at = _future_iso(72)
        r = super_client.patch(
            f"{API}/leads/{lead['id']}/followups/{fid}", json={"at": new_at}
        )
        assert r.status_code == 200

        time.sleep(0.5)
        r1 = staff_client.get(f"{API}/notifications")
        j1 = r1.json()
        items = j1.get("items", j1) if isinstance(j1, dict) else j1
        after = [n for n in items
                 if n.get("type") == "lead_followup" and n.get("metadata", {}).get("lead_id") == lead["id"]]
        rescheduled = [n for n in after if "rescheduled" in (n.get("title") or "").lower()]
        assert len(rescheduled) >= 1, f"expected 'rescheduled' notification, got titles={[n.get('title') for n in after]}"


# ---------- DELETE followup ----------
class TestDeleteFollowup:
    def test_delete_latest_recomputes_next_fu(self, super_client, super_me):
        lead = _mk_lead(super_client, f"TEST_del_latest_{uuid.uuid4().hex[:6]}",
                        )
        first_at = _future_iso(24)
        _add_followup(super_client, lead["id"], first_at, "first")
        last_at = _future_iso(72)
        fresh = _add_followup(super_client, lead["id"], last_at, "last")
        last_id = fresh["follow_ups"][-1]["id"]
        assert fresh["next_follow_up"] == last_at

        r = super_client.delete(f"{API}/leads/{lead['id']}/followups/{last_id}")
        assert r.status_code == 200
        after = r.json()
        assert after["next_follow_up"] == first_at
        assert after.get("follow_up_reminded_for") is None

    def test_delete_only_followup_nulls_next_fu(self, super_client, super_me):
        lead = _mk_lead(super_client, f"TEST_del_only_{uuid.uuid4().hex[:6]}",
                        )
        at = _future_iso(24)
        fresh = _add_followup(super_client, lead["id"], at)
        fid = fresh["follow_ups"][-1]["id"]
        r = super_client.delete(f"{API}/leads/{lead['id']}/followups/{fid}")
        assert r.status_code == 200
        assert r.json()["next_follow_up"] is None

    def test_staff_cannot_delete_others(self, super_client, staff_client, staff_me):
        lead = _mk_lead(super_client, f"TEST_del_403_{uuid.uuid4().hex[:6]}",
                        assignee_id=staff_me["id"])
        fresh = _add_followup(super_client, lead["id"], _future_iso(24))
        fid = fresh["follow_ups"][-1]["id"]
        r = staff_client.delete(f"{API}/leads/{lead['id']}/followups/{fid}")
        assert r.status_code == 403

    def test_admin_can_delete_others(self, super_client, staff_client, staff_me):
        lead = _mk_lead(super_client, f"TEST_del_admin_{uuid.uuid4().hex[:6]}",
                        assignee_id=staff_me["id"])
        fresh = _add_followup(staff_client, lead["id"], _future_iso(24))
        fid = fresh["follow_ups"][-1]["id"]
        r = super_client.delete(f"{API}/leads/{lead['id']}/followups/{fid}")
        assert r.status_code == 200


# ---------- Cleanup ----------
def test_zzz_cleanup(super_client):
    for lid in _CREATED_LEADS:
        try:
            super_client.delete(f"{API}/leads/{lid}")
        except Exception:
            pass
