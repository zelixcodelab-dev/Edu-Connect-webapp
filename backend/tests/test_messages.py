"""End-to-end tests for the messages API (announcements + reminders, with
role-based send rules, dismiss / reply threading, and unread-count badge)."""
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
        if (u.get("email") or "").startswith("pytest_msg_"):
            session.delete(f"{API}/users/{u['id']}", timeout=15)
    clients = session.get(f"{API}/clients", timeout=15).json()
    for c in clients:
        if (c.get("name") or "").startswith("Pytest Msg Agent"):
            session.delete(f"{API}/clients/{c['id']}", timeout=15)


@pytest.fixture(autouse=True)
def _wipe(admin_session: requests.Session) -> None:
    _cleanup(admin_session)


def _make_users(admin: requests.Session) -> dict:
    """Spawns 1 office_admin + 1 linked user for the test (super admin is the
    fixture's admin_session). Returns ids + reusable sessions."""
    pwd_off = generate_test_password("Off")
    off = admin.post(
        f"{API}/users",
        json={
            "email": "pytest_msg_office@example.com",
            "password": pwd_off,
            "name": "Pytest Msg Office",
            "role": "office_admin",
            "office": "KM_BLR",
        },
        timeout=15,
    ).json()

    cli = admin.post(
        f"{API}/clients",
        json={"name": "Pytest Msg Agent", "client_type": "sub_agent_associate", "phone": "9100000099"},
        timeout=15,
    ).json()
    pwd_usr = generate_test_password("Usr")
    usr = admin.post(
        f"{API}/users",
        json={
            "email": "pytest_msg_user@example.com",
            "password": pwd_usr,
            "name": "Pytest Msg User",
            "role": "user",
            "linked_client_id": cli["id"],
        },
        timeout=15,
    ).json()
    return {
        "office_id": off["id"], "office_email": off["email"], "office_password": pwd_off,
        "user_id":   usr["id"], "user_email":   usr["email"], "user_password":   pwd_usr,
    }


def test_super_admin_announces_to_office_admins(admin_session: requests.Session) -> None:
    users = _make_users(admin_session)
    r = admin_session.post(
        f"{API}/messages",
        json={
            "kind": "announcement",
            "subject": "Welcome to the new dashboard",
            "body": "Please complete profile updates by Friday.",
            "priority": "urgent",
            "audience": {"type": "role", "role": "office_admin"},
        },
        timeout=15,
    )
    assert r.status_code == 200, r.text
    msg = r.json()
    assert msg["priority"] == "urgent"
    assert users["office_id"] in msg["recipient_ids"]

    office = _login(users["office_email"], users["office_password"])
    inbox = office.get(f"{API}/messages?folder=inbox", timeout=15).json()
    assert any(m["id"] == msg["id"] for m in inbox)
    banners = office.get(f"{API}/messages/banners", timeout=15).json()
    assert any(b["id"] == msg["id"] for b in banners)
    # Dismissing should remove it from banners but keep it in inbox
    office.post(f"{API}/messages/{msg['id']}/dismiss", timeout=15).raise_for_status()
    banners_after = office.get(f"{API}/messages/banners", timeout=15).json()
    assert not any(b["id"] == msg["id"] for b in banners_after)
    inbox_after = office.get(f"{API}/messages?folder=inbox", timeout=15).json()
    assert any(m["id"] == msg["id"] for m in inbox_after)
    office.close()


def test_super_admin_announces_to_users(admin_session: requests.Session) -> None:
    users = _make_users(admin_session)
    r = admin_session.post(
        f"{API}/messages",
        json={
            "kind": "announcement",
            "subject": "Welcome sub-agents",
            "body": "New onboarding checklist available.",
            "audience": {"type": "role", "role": "user"},
        },
        timeout=15,
    )
    assert r.status_code == 200, r.text
    msg = r.json()
    assert users["user_id"] in msg["recipient_ids"]

    usr = _login(users["user_email"], users["user_password"])
    inbox = usr.get(f"{API}/messages?folder=inbox", timeout=15).json()
    assert any(m["id"] == msg["id"] for m in inbox)
    count = usr.get(f"{API}/messages/unread-count", timeout=15).json()
    assert count["count"] >= 1
    # Mark read
    usr.post(f"{API}/messages/{msg['id']}/read", timeout=15).raise_for_status()
    count_after = usr.get(f"{API}/messages/unread-count", timeout=15).json()
    assert count_after["count"] < count["count"] or count_after["count"] == 0
    usr.close()


def test_office_admin_announces_to_peers(admin_session: requests.Session) -> None:
    users = _make_users(admin_session)
    office = _login(users["office_email"], users["office_password"])
    # Allowed: announce to own office peers. There may already be other
    # office_admins on the test DB; either ≥1 recipient (200) or none (400).
    r = office.post(
        f"{API}/messages",
        json={
            "kind": "announcement",
            "subject": "Office stand-up at 10",
            "body": "Reminder for the morning huddle.",
            "audience": {"type": "role_office", "role": "office_admin", "office": "KM_BLR"},
        },
        timeout=15,
    )
    assert r.status_code in {200, 400}, r.text
    if r.status_code == 200:
        msg = r.json()
        # Sender must NEVER be in their own recipients list
        assert users["office_id"] not in msg["recipient_ids"]
    # Not allowed: announce to USER role
    r2 = office.post(
        f"{API}/messages",
        json={
            "kind": "announcement",
            "subject": "should fail",
            "body": "x",
            "audience": {"type": "role", "role": "user"},
        },
        timeout=15,
    )
    assert r2.status_code == 403, r2.text
    # Not allowed: announce to another office
    r3 = office.post(
        f"{API}/messages",
        json={
            "kind": "announcement",
            "subject": "cross-office",
            "body": "x",
            "audience": {"type": "role_office", "role": "office_admin", "office": "KM_TCR"},
        },
        timeout=15,
    )
    assert r3.status_code == 403, r3.text
    office.close()


def test_office_admin_reminds_super_admin(admin_session: requests.Session) -> None:
    users = _make_users(admin_session)
    me_id = admin_session.get(f"{API}/auth/me", timeout=15).json()["id"]
    office = _login(users["office_email"], users["office_password"])

    r = office.post(
        f"{API}/messages",
        json={
            "kind": "reminder",
            "subject": "Pending approval",
            "body": "Salary for March awaiting your nod.",
            "priority": "urgent",
            "due_date": "2026-03-05",
            "audience": {"type": "users", "user_ids": [me_id]},
        },
        timeout=15,
    )
    assert r.status_code == 200, r.text
    msg = r.json()
    assert msg["recipient_ids"] == [me_id]
    assert msg["due_date"] == "2026-03-05"

    # Office admin can NOT remind another office admin
    other_office = office.post(
        f"{API}/messages",
        json={
            "kind": "reminder", "subject": "x", "body": "x",
            "audience": {"type": "users", "user_ids": [users["user_id"]]},
        },
        timeout=15,
    )
    assert other_office.status_code == 403, other_office.text
    office.close()


def test_user_reminds_super_admin_and_threading(admin_session: requests.Session) -> None:
    users = _make_users(admin_session)
    super_id = admin_session.get(f"{API}/auth/me", timeout=15).json()["id"]
    usr = _login(users["user_email"], users["user_password"])

    r = usr.post(
        f"{API}/messages",
        json={
            "kind": "reminder",
            "subject": "Profile review request",
            "body": "Please verify my linked client name on the dashboard.",
            "audience": {"type": "users", "user_ids": [super_id]},
        },
        timeout=15,
    )
    assert r.status_code == 200, r.text
    msg = r.json()
    assert msg["recipient_ids"] == [super_id]

    # Super admin replies
    reply = admin_session.post(
        f"{API}/messages/{msg['id']}/replies",
        json={"body": "Looking into it now."},
        timeout=15,
    )
    assert reply.status_code == 200, reply.text

    # User can see the reply
    thread = usr.get(f"{API}/messages/{msg['id']}", timeout=15).json()
    assert thread["root"]["id"] == msg["id"]
    assert len(thread["replies"]) == 1
    assert thread["replies"][0]["body"] == "Looking into it now."

    # User CANNOT remind another user
    bad = usr.post(
        f"{API}/messages",
        json={
            "kind": "reminder", "subject": "x", "body": "x",
            "audience": {"type": "users", "user_ids": [users["office_id"]]},
        },
        timeout=15,
    )
    assert bad.status_code == 403, bad.text

    # Sender deletes own thread
    admin_del = admin_session.delete(f"{API}/messages/{msg['id']}", timeout=15)
    assert admin_del.status_code == 403  # only the original sender (user) can delete
    usr_del = usr.delete(f"{API}/messages/{msg['id']}", timeout=15)
    assert usr_del.status_code == 200
    usr.close()


def test_announcement_creates_notification(admin_session: requests.Session) -> None:
    """The fan-out should write a /api/notifications row for each recipient."""
    users = _make_users(admin_session)
    admin_session.post(
        f"{API}/messages",
        json={
            "kind": "announcement",
            "subject": "Notif test",
            "body": "Should land in notifications too.",
            "priority": "urgent",
            "audience": {"type": "role", "role": "office_admin"},
        },
        timeout=15,
    ).raise_for_status()
    office = _login(users["office_email"], users["office_password"])
    notifs = office.get(f"{API}/notifications", timeout=15).json()
    assert any(n["type"] == "message" and "Notif test" in (n["title"] or "") for n in notifs)
    office.close()
