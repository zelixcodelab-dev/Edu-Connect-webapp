"""Tests for the @-mention feature on messages + replies — fan-out splitting,
mention-notif content, and validation that mentions are scoped to actual
thread participants."""
from __future__ import annotations

from typing import Iterator

import pytest
import requests

from _creds import admin_credentials, api_base, generate_test_password


API = api_base()


def _login(email: str, password: str) -> requests.Session:
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=15)
    assert r.status_code == 200, r.text
    return s


@pytest.fixture
def admin_session() -> Iterator[requests.Session]:
    email, pwd = admin_credentials()
    s = _login(email, pwd)
    yield s
    s.close()


def _cleanup(session: requests.Session) -> None:
    listing = session.get(f"{API}/users", timeout=15).json()
    for u in listing:
        if (u.get("email") or "").startswith("pytest_mention_"):
            session.delete(f"{API}/users/{u['id']}", timeout=15)
    clients = session.get(f"{API}/clients", timeout=15).json()
    for c in clients:
        if (c.get("name") or "").startswith("Pytest Mention"):
            session.delete(f"{API}/clients/{c['id']}", timeout=15)


@pytest.fixture(autouse=True)
def _wipe(admin_session: requests.Session) -> None:
    _cleanup(admin_session)


def _make_two_office_admins(admin: requests.Session) -> dict:
    pwd_a = generate_test_password("OffA")
    a = admin.post(
        f"{API}/users",
        json={"email": "pytest_mention_a@example.com", "password": pwd_a, "name": "Pytest Mention A",
              "role": "office_admin", "office": "KM_TCR"},
        timeout=15,
    ).json()
    pwd_b = generate_test_password("OffB")
    b = admin.post(
        f"{API}/users",
        json={"email": "pytest_mention_b@example.com", "password": pwd_b, "name": "Pytest Mention B",
              "role": "office_admin", "office": "KM_TCR"},
        timeout=15,
    ).json()
    return {"a": a, "b": b, "a_pwd": pwd_a, "b_pwd": pwd_b}


def test_mention_creates_separate_notification(admin_session: requests.Session) -> None:
    """When the sender @-mentions a recipient, that recipient should get a
    notification of type='mention' (NOT the standard 'message' type)."""
    users = _make_two_office_admins(admin_session)

    # Super admin announces to all TCR office admins and mentions only A
    r = admin_session.post(
        f"{API}/messages",
        json={
            "kind": "announcement",
            "subject": "Mention test announcement",
            "body": f"@{users['a']['name']} please check the new policy.",
            "priority": "normal",
            "audience": {"type": "role_office", "role": "office_admin", "office": "KM_TCR"},
            "mentions": [users["a"]["id"]],
        },
        timeout=15,
    )
    assert r.status_code == 200, r.text
    msg = r.json()
    assert msg["mentions"] == [users["a"]["id"]]
    assert users["a"]["id"] in msg["recipient_ids"]
    assert users["b"]["id"] in msg["recipient_ids"]

    # A should see ONE 'mention' notif, NOT a 'message' notif
    a = _login(users["a"]["email"], users["a_pwd"])
    a_notifs = a.get(f"{API}/notifications", timeout=15).json()
    a_for_msg = [n for n in a_notifs if (n.get("metadata") or {}).get("message_id") == msg["id"]]
    assert len(a_for_msg) == 1
    assert a_for_msg[0]["type"] == "mention"
    assert "mentioned you" in (a_for_msg[0]["title"] or "")
    a.close()

    # B should see a regular 'message' notif (no 'mention')
    b = _login(users["b"]["email"], users["b_pwd"])
    b_notifs = b.get(f"{API}/notifications", timeout=15).json()
    b_for_msg = [n for n in b_notifs if (n.get("metadata") or {}).get("message_id") == msg["id"]]
    assert len(b_for_msg) == 1
    assert b_for_msg[0]["type"] == "message"
    b.close()


def test_mentions_outside_recipient_set_are_dropped(admin_session: requests.Session) -> None:
    """A sender can't @-mention someone who isn't in the resolved audience —
    those ids should be silently filtered from the persisted mentions list."""
    users = _make_two_office_admins(admin_session)
    # Get an unrelated user (the admin themselves — not in recipient set)
    me_id = admin_session.get(f"{API}/auth/me", timeout=15).json()["id"]

    r = admin_session.post(
        f"{API}/messages",
        json={
            "kind": "announcement",
            "subject": "Drop test",
            "body": "Hello team.",
            "audience": {"type": "role_office", "role": "office_admin", "office": "KM_TCR"},
            "mentions": [users["a"]["id"], me_id, "non-existent-user-id"],
        },
        timeout=15,
    )
    assert r.status_code == 200
    msg = r.json()
    # Only A survives — admin is the sender (excluded) and the made-up id is rejected
    assert msg["mentions"] == [users["a"]["id"]]


def test_mention_in_reply_fans_out_correctly(admin_session: requests.Session) -> None:
    """Replies with mentions should send a 'mention' notif to those users and
    a 'message_reply' to everyone else."""
    users = _make_two_office_admins(admin_session)
    me_id = admin_session.get(f"{API}/auth/me", timeout=15).json()["id"]

    # Super admin announces to both A and B
    root = admin_session.post(
        f"{API}/messages",
        json={
            "kind": "announcement",
            "subject": "Reply mention test",
            "body": "Initial body.",
            "audience": {"type": "role_office", "role": "office_admin", "office": "KM_TCR"},
        },
        timeout=15,
    ).json()

    # A replies and mentions B (B should get a mention notif; admin gets standard 'message_reply')
    a = _login(users["a"]["email"], users["a_pwd"])
    reply = a.post(
        f"{API}/messages/{root['id']}/replies",
        json={"body": f"Hi @{users['b']['name']}, what do you think?", "mentions": [users["b"]["id"]]},
        timeout=15,
    ).json()
    assert reply["mentions"] == [users["b"]["id"]]
    a.close()

    # B should have a 'mention' notification for this reply
    b = _login(users["b"]["email"], users["b_pwd"])
    b_notifs = b.get(f"{API}/notifications", timeout=15).json()
    b_for_reply = [n for n in b_notifs if (n.get("metadata") or {}).get("reply_id") == reply["id"]]
    assert len(b_for_reply) == 1
    assert b_for_reply[0]["type"] == "mention"
    assert "mentioned you in a reply" in (b_for_reply[0]["title"] or "")
    b.close()

    # Super admin (original sender, also in the thread) should have a regular
    # 'message_reply' since they weren't mentioned.
    admin_notifs = admin_session.get(f"{API}/notifications", timeout=15).json()
    admin_for_reply = [n for n in admin_notifs if (n.get("metadata") or {}).get("reply_id") == reply["id"]]
    assert len(admin_for_reply) == 1
    assert admin_for_reply[0]["type"] == "message_reply"


def test_mention_self_is_dropped(admin_session: requests.Session) -> None:
    """A sender can't @-mention themselves — they aren't in the recipient
    set so the filter should drop them."""
    users = _make_two_office_admins(admin_session)
    me_id = admin_session.get(f"{API}/auth/me", timeout=15).json()["id"]

    r = admin_session.post(
        f"{API}/messages",
        json={
            "kind": "announcement",
            "subject": "Self-mention test",
            "body": "Talking to myself.",
            "audience": {"type": "role_office", "role": "office_admin", "office": "KM_TCR"},
            "mentions": [me_id],
        },
        timeout=15,
    )
    assert r.status_code == 200
    assert r.json()["mentions"] == []


def test_mentioned_banner_sorts_first(admin_session: requests.Session) -> None:
    """Banners list should put a banner where I'm mentioned ABOVE other
    urgent banners that didn't mention me — even if the mentioning banner
    is older and lower priority."""
    users = _make_two_office_admins(admin_session)
    # 1. URGENT announcement to KM_TCR, no mention
    admin_session.post(
        f"{API}/messages",
        json={
            "kind": "announcement", "subject": "Urgent broadcast no mention",
            "body": "x", "priority": "urgent",
            "audience": {"type": "role_office", "role": "office_admin", "office": "KM_TCR"},
        },
        timeout=15,
    ).raise_for_status()
    # 2. NORMAL announcement (older sort by created_at would put it second
    # without mentions sort) — mentions A.
    admin_session.post(
        f"{API}/messages",
        json={
            "kind": "announcement", "subject": "Normal but mentions A",
            "body": "Heads up", "priority": "normal",
            "audience": {"type": "role_office", "role": "office_admin", "office": "KM_TCR"},
            "mentions": [users["a"]["id"]],
        },
        timeout=15,
    ).raise_for_status()
    a = _login(users["a"]["email"], users["a_pwd"])
    bn = a.get(f"{API}/messages/banners", timeout=15).json()
    a.close()
    # A's first banner should be the one that mentioned them, even though it
    # is NORMAL priority and the other is URGENT.
    assert len(bn) >= 2
    assert bn[0]["subject"] == "Normal but mentions A"
    assert bn[0]["mentioned_me"] is True
    assert bn[1]["subject"] == "Urgent broadcast no mention"
    assert bn[1].get("mentioned_me") is False
