# Iteration 17: app icon badge backend — lib/push.unread_total + send_push_to_users
import os
import sys
import asyncio
import pytest
import requests

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from dotenv import load_dotenv  # noqa: E402

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL") or open("/app/frontend/.env").read().split("REACT_APP_BACKEND_URL=")[1].split()[0]
BASE_URL = BASE_URL.rstrip("/")


@pytest.fixture(scope="module")
def admin():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": "admin@educonnect.app", "password": "Admin@12345"})
    if r.status_code != 200:
        pytest.skip(f"login failed {r.status_code}")
    d = r.json()
    tok = d.get("token") or d.get("access_token")
    h = {"Authorization": f"Bearer {tok}"}
    me = requests.get(f"{BASE_URL}/api/auth/me", headers=h).json()
    import jwt
    tid = jwt.decode(tok, options={"verify_signature": False}).get("tenant")
    from db import set_current_tenant
    set_current_tenant(tid)
    me["_tenant"] = tid
    return h, me


_LOOP = asyncio.new_event_loop()


def _run(coro):
    return _LOOP.run_until_complete(coro)


# Module import sanity
def test_push_imports():
    from lib import push
    assert callable(push.unread_total)
    assert callable(push.send_push_to_users)


# unread_total equals notifications unread + messages unread from APIs
def test_unread_total_matches_api(admin):
    h, me = admin
    n = requests.get(f"{BASE_URL}/api/notifications/unread-count", headers=h).json()["count"]
    m = requests.get(f"{BASE_URL}/api/messages/unread-count", headers=h).json()["count"]
    from lib import push
    total = _run(push.unread_total(me["id"]))
    assert isinstance(total, int)
    assert total == n + m, f"unread_total={total} api={n}+{m}"
    # Seed one unread notification → total increments by exactly 1
    from db import db
    _run(db.notifications.insert_one({"id": "TEST_badge_notif", "recipient_user_id": me["id"], "read": False, "title": "TEST"}))
    try:
        assert _run(push.unread_total(me["id"])) == total + 1
        n2 = requests.get(f"{BASE_URL}/api/notifications/unread-count", headers=h).json()["count"]
        assert n2 == n + 1
    finally:
        _run(db.notifications.delete_one({"id": "TEST_badge_notif"}))


def test_unread_total_unknown_user_zero():
    from lib import push
    assert _run(push.unread_total("TEST_nonexistent_user")) == 0


# send_push_to_users without VAPID → skipped, never raises
def test_send_push_skipped_without_vapid(admin, monkeypatch):
    _, me = admin
    monkeypatch.delenv("VAPID_PUBLIC_KEY", raising=False)
    from lib import push
    res = _run(push.send_push_to_users([me["id"]], title="t", body="b"))
    assert res.get("skipped") is True
    assert res["sent"] == 0


def test_send_push_empty_users():
    from lib import push
    res = _run(push.send_push_to_users([], title="t", body="b"))
    assert res["sent"] == 0
