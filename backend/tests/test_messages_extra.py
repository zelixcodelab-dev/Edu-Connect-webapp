"""Extra coverage for the messages router — banners ordering, replies
fan-out + delete cascade + reminders cannot be dismissed + thread 403 auth."""
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
def admin() -> Iterator[requests.Session]:
    email, pwd = admin_credentials()
    s = _login(email, pwd)
    yield s
    s.close()


def _cleanup(admin: requests.Session) -> None:
    listing = admin.get(f"{API}/users", timeout=15).json()
    for u in listing:
        if (u.get("email") or "").startswith("pytest_msgx_"):
            admin.delete(f"{API}/users/{u['id']}", timeout=15)
    clients = admin.get(f"{API}/clients", timeout=15).json()
    for c in clients:
        if (c.get("name") or "").startswith("Pytest MsgX Agent"):
            admin.delete(f"{API}/clients/{c['id']}", timeout=15)


@pytest.fixture(autouse=True)
def _wipe(admin: requests.Session) -> None:
    _cleanup(admin)


def _make_user(admin: requests.Session) -> dict:
    cli = admin.post(
        f"{API}/clients",
        json={"name": "Pytest MsgX Agent", "client_type": "sub_agent_associate", "phone": "9100000098"},
        timeout=15,
    ).json()
    pwd = generate_test_password("Usrx")
    usr = admin.post(
        f"{API}/users",
        json={
            "email": "pytest_msgx_user@example.com",
            "password": pwd,
            "name": "Pytest MsgX User",
            "role": "user",
            "linked_client_id": cli["id"],
        },
        timeout=15,
    ).json()
    return {"id": usr["id"], "email": usr["email"], "password": pwd}


def test_reminder_cannot_be_dismissed(admin: requests.Session) -> None:
    u = _make_user(admin)
    r = admin.post(
        f"{API}/messages",
        json={
            "kind": "reminder", "subject": "Do this", "body": "now",
            "audience": {"type": "users", "user_ids": [u["id"]]},
        }, timeout=15,
    )
    assert r.status_code == 200, r.text
    mid = r.json()["id"]
    usr = _login(u["email"], u["password"])
    dis = usr.post(f"{API}/messages/{mid}/dismiss", timeout=15)
    assert dis.status_code == 400
    usr.close()


def test_get_thread_forbidden_for_non_participant(admin: requests.Session) -> None:
    u = _make_user(admin)
    # admin sends a reminder to nobody-of-relevance (admin → user u)
    r = admin.post(
        f"{API}/messages",
        json={
            "kind": "reminder", "subject": "Private", "body": "secret",
            "audience": {"type": "users", "user_ids": [u["id"]]},
        }, timeout=15,
    )
    mid = r.json()["id"]
    # Spawn a 2nd unrelated office_admin
    pwd = generate_test_password("Other")
    other = admin.post(
        f"{API}/users",
        json={
            "email": "pytest_msgx_other@example.com",
            "password": pwd,
            "name": "Pytest MsgX Other",
            "role": "office_admin",
            "office": "KM_TCR",
        }, timeout=15,
    ).json()
    other_s = _login(other["email"], pwd)
    g = other_s.get(f"{API}/messages/{mid}", timeout=15)
    assert g.status_code == 403
    # cleanup
    admin.delete(f"{API}/users/{other['id']}", timeout=15)
    other_s.close()


def test_replies_fanout_and_delete_cascade(admin: requests.Session) -> None:
    u = _make_user(admin)
    # user sends reminder to admin
    me_id = admin.get(f"{API}/auth/me", timeout=15).json()["id"]
    usr = _login(u["email"], u["password"])
    r = usr.post(
        f"{API}/messages",
        json={
            "kind": "reminder", "subject": "Hi admin", "body": "need approval",
            "audience": {"type": "users", "user_ids": [me_id]},
        }, timeout=15,
    )
    mid = r.json()["id"]
    # admin replies — should fan out a 'message_reply' notif to user
    admin.post(f"{API}/messages/{mid}/replies", json={"body": "approved"}, timeout=15).raise_for_status()
    notifs = usr.get(f"{API}/notifications", timeout=15).json()
    assert any(n["type"] == "message_reply" for n in notifs)
    # thread shows reply, reply_count bumped
    th = usr.get(f"{API}/messages/{mid}", timeout=15).json()
    assert th["root"]["reply_count"] == 1
    assert len(th["replies"]) == 1
    # admin cannot delete (not sender)
    assert admin.delete(f"{API}/messages/{mid}", timeout=15).status_code == 403
    # user deletes → cascades root + replies
    assert usr.delete(f"{API}/messages/{mid}", timeout=15).status_code == 200
    # 404 afterwards
    assert usr.get(f"{API}/messages/{mid}", timeout=15).status_code == 404
    usr.close()


def test_banners_endpoint_urgent_first_and_cap(admin: requests.Session) -> None:
    u = _make_user(admin)
    # Send 1 normal + 1 urgent to the user, then check banner order
    admin.post(
        f"{API}/messages",
        json={
            "kind": "announcement", "subject": "Normal A", "body": "x", "priority": "normal",
            "audience": {"type": "role", "role": "user"},
        }, timeout=15,
    ).raise_for_status()
    admin.post(
        f"{API}/messages",
        json={
            "kind": "announcement", "subject": "URG B", "body": "x", "priority": "urgent",
            "audience": {"type": "role", "role": "user"},
        }, timeout=15,
    ).raise_for_status()
    usr = _login(u["email"], u["password"])
    banners = usr.get(f"{API}/messages/banners", timeout=15).json()
    assert len(banners) >= 2
    # first should be urgent
    assert banners[0]["priority"] == "urgent"
    assert len(banners) <= 5
    usr.close()


def test_list_sent_folder_and_kind_filter(admin: requests.Session) -> None:
    u = _make_user(admin)
    sent_before = admin.get(f"{API}/messages?folder=sent&kind=reminder", timeout=15).json()
    admin.post(
        f"{API}/messages",
        json={
            "kind": "reminder", "subject": "Sent test", "body": "x",
            "audience": {"type": "users", "user_ids": [u["id"]]},
        }, timeout=15,
    ).raise_for_status()
    sent_after = admin.get(f"{API}/messages?folder=sent&kind=reminder", timeout=15).json()
    assert len(sent_after) >= len(sent_before) + 1
    # newest first
    assert sent_after[0]["subject"] == "Sent test"
    # sender should NOT be in own recipient list
    assert admin.get(f"{API}/auth/me", timeout=15).json()["id"] not in sent_after[0]["recipient_ids"]
