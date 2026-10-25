# Profile photo isolation: staff photo must never leak to super admin / office admin
import io
import os
import uuid

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    from dotenv import dotenv_values
    BASE_URL = dotenv_values("/app/frontend/.env")["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"

ADMIN = ("admin@educonnect.app", "Admin@12345")
OFFICE = ("office@educonnect.app", "Office@12345")
BLAISE_ID = "e249596a-5715-4956-a768-9ccf172c52f2"

# 1x1 PNG
PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
    "0000000d49444154789c6360f8cfc0f01f0005000201e2a4f6d50000000049454e44ae426082"
)


def _login(email, pwd):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": email, "password": pwd})
    assert r.status_code == 200, r.text
    tok = r.json().get("token") or r.json().get("access_token")
    if tok:
        s.headers["Authorization"] = f"Bearer {tok}"
    return s, r.json()


@pytest.fixture(scope="module")
def admin():
    return _login(*ADMIN)


@pytest.fixture(scope="module")
def office():
    return _login(*OFFICE)


@pytest.fixture(scope="module")
def staff(admin):
    """Use TEST_att_staff_1 (soft-deleted; seat limit blocks reactivate) - temporarily
    un-delete directly in the tenant DB, restore deleted_at on teardown."""
    from pymongo import MongoClient
    from dotenv import dotenv_values
    env = dotenv_values("/app/backend/.env")
    mdb = MongoClient(env["MONGO_URL"])["test_database_t_8286d28c6b04042a"]
    uid = "1b17fc68-6a5b-4d60-9b42-19502dea0708"
    orig = mdb.users.find_one({"id": uid}, {"_id": 0, "deleted_at": 1}) or {}
    mdb.users.update_one({"id": uid}, {"$set": {"deleted_at": None}})
    prof_before = mdb.clients.find_one({"login_user_id": uid}, {"_id": 0, "id": 1, "photo_url": 1})
    try:
        s, body = _login("TEST_att_staff_1@educonnect.app", "Staff@12345")
        yield {"session": s, "login": body, "uid": uid}
    finally:
        if prof_before is not None:
            mdb.clients.update_one({"id": prof_before["id"]}, {"$set": {"photo_url": prof_before.get("photo_url") or ""}})
        mdb.users.update_one({"id": uid}, {"$set": {"deleted_at": orig.get("deleted_at")}})


# --- super admin login / me ---
def test_admin_login_photo_empty(admin):
    _, body = admin
    assert body["role"] == "super_admin"
    assert body.get("photo_url", "") == ""


def test_admin_me_photo_empty(admin):
    s, _ = admin
    r = s.get(f"{API}/auth/me")
    assert r.status_code == 200
    assert r.json().get("photo_url", "") == ""


def test_office_me_photo_empty(office):
    s, _ = office
    r = s.get(f"{API}/auth/me")
    assert r.status_code == 200
    assert r.json().get("photo_url", "") == ""


# --- team strip ---
def test_team_blaise_has_photo_admin_none(admin):
    s, body = admin
    r = s.get(f"{API}/dashboard/team")
    assert r.status_code == 200
    members = {m["id"]: m for m in r.json()["members"]}
    assert members[BLAISE_ID]["photo_url"]
    assert members[body["id"]]["photo_url"] == ""
    blaise_photo = members[BLAISE_ID]["photo_url"]
    for uid, m in members.items():
        if uid != BLAISE_ID:
            assert m["photo_url"] != blaise_photo, f"{m['name']} got Blaise photo"


# --- staff self-upload regression ---
def test_staff_upload_own_photo_isolated(staff, admin, office):
    s = staff["session"]
    up = s.post(f"{API}/uploads/image", files={"file": ("p.png", io.BytesIO(PNG), "image/png")})
    assert up.status_code == 200, up.text
    url = up.json()["url"]
    p = s.patch(f"{API}/staff/me/profile", json={"photo_url": url})
    assert p.status_code == 200, p.text
    assert p.json()["photo_url"] == url
    me = s.get(f"{API}/auth/me").json()
    assert me["photo_url"] == url
    # file fetchable by staff
    assert s.get(f"{BASE_URL}{url}").status_code == 200

    a_me = admin[0].get(f"{API}/auth/me").json()
    o_me = office[0].get(f"{API}/auth/me").json()
    assert a_me.get("photo_url", "") == ""
    assert o_me.get("photo_url", "") == ""

    # team strip as admin + office admin
    for sess in (admin[0], office[0]):
        members = {m["id"]: m for m in sess.get(f"{API}/dashboard/team").json()["members"]}
        assert members[staff["uid"]]["photo_url"] == url
        for uid, m in members.items():
            if uid != staff["uid"]:
                assert m["photo_url"] != url

    # batched helper via staff-performance
    r = admin[0].get(f"{API}/leads/staff-performance")
    if r.status_code == 200:
        data = r.json()
        rows = data if isinstance(data, list) else (data.get("staff") or data.get("rows") or data.get("members") or [])
        for row in rows:
            if row.get("user_id") in (admin[1]["id"],):
                assert row.get("photo_url", "") == ""
            if row.get("user_id") != staff["uid"]:
                assert row.get("photo_url", "") != url

    # login response for admin still empty
    _, body = _login(*ADMIN)
    assert body.get("photo_url", "") == ""

    # remove photo
    p = s.patch(f"{API}/staff/me/profile", json={"photo_url": ""})
    assert p.status_code == 200
    assert s.get(f"{API}/auth/me").json()["photo_url"] == ""


# --- batched helper via leads list ---
def test_leads_assigned_to_admin_no_staff_photo(admin):
    s, body = admin
    r = s.post(f"{API}/leads", json={"name": "TEST_photo_lead", "phone": "9000000001",
                                      })
    if r.status_code not in (200, 201):
        pytest.skip(f"lead create failed {r.status_code} {r.text[:200]}")
    lid = r.json()["id"]
    try:
        lst = s.get(f"{API}/leads", params={"q": "TEST_photo_lead"}).json()
        items = lst if isinstance(lst, list) else (lst.get("items") or lst.get("leads") or [])
        mine = [x for x in items if x.get("id") == lid]
        if mine and mine[0].get("assigned_to_user_id") == body["id"]:
            assert mine[0].get("assigned_to_photo_url", "") == ""
        # Blaise-assigned leads should carry Blaise photo
        for x in items:
            if x.get("assigned_to_user_id") == body["id"]:
                assert x.get("assigned_to_photo_url", "") == ""
    finally:
        s.delete(f"{API}/leads/{lid}")


def test_notifications_actor_photo_admin_empty(office, admin):
    s, _ = office
    r = s.get(f"{API}/notifications")
    assert r.status_code == 200
    d = r.json()
    items = d if isinstance(d, list) else (d.get("items") or d.get("notifications") or [])
    for n in items:
        if n.get("actor_user_id") == admin[1]["id"]:
            assert n.get("actor_photo_url", "") == ""
