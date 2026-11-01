# Clients CSV import "updates existing" (phone/email match, blank keeps value, dup/double-match skips)
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
API = f"{BASE_URL}/api"
ALLOWED = "sub_agent_associate,associate_consultant"


@pytest.fixture(scope="module")
def s():
    r = requests.post(f"{API}/auth/login", json={"email": "admin@educonnect.app", "password": "Admin@12345"})
    if r.status_code != 200:
        pytest.skip("login failed")
    tok = r.json().get("token") or r.json().get("access_token")
    sess = requests.Session()
    sess.headers["Authorization"] = f"Bearer {tok}"
    yield sess
    lst = sess.get(f"{API}/clients").json()
    ids = [c["id"] for c in lst if str(c.get("name", "")).startswith("TEST_UPD")]
    if ids:
        sess.post(f"{API}/clients/bulk-delete", json={"ids": ids})


def _imp(s, body, dry):
    return s.post(f"{API}/clients/import?dry_run={str(dry).lower()}",
                  files={"file": ("c.csv", body, "text/csv")},
                  data={"default_type": "sub_agent_associate", "allowed_types": ALLOWED})


def _get(s, cid):
    return next((c for c in s.get(f"{API}/clients").json() if c["id"] == cid), None)


@pytest.fixture(scope="module")
def seeded(s):
    a = s.post(f"{API}/clients", json={"name": "TEST_UPD_A", "client_type": "sub_agent_associate",
                                       "phone": "9876543210", "email": "upd_a@x.com",
                                       "company": "OldCo", "place": "Kochi"}).json()
    b = s.post(f"{API}/clients", json={"name": "TEST_UPD_B", "client_type": "associate_consultant",
                                       "phone": "9000000001", "email": "Upd_B@Example.com",
                                       "company": "BCo", "place": "Calicut"}).json()
    return a, b


CSV = ("Name,Type,Email,Phone,Company,Place\n"
       "TEST_UPD_A,,,+91 98765 43210,NewCo,\n"          # phone match (formatted) -> update company only
       "TEST_UPD_B2,,UPD_B@EXAMPLE.COM,,,Mumbai\n"     # email match (case) -> update name + place
       "TEST_UPD_NEW,,new@x.com,9111111111,NC,Delhi\n"  # create
       "TEST_UPD_A,,,,Dup,\n"                           # name dup no match -> skip
       "TEST_UPD_X,,,98765-43210,Again,\n")             # double-match -> skip


def test_dry_run_preview(s, seeded):
    a, b = seeded
    r = _imp(s, CSV, True)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["dry_run"] is True
    assert d["to_create"] == 1 and d["to_update"] == 2, d
    assert d["created"] == 0 and d["updated"] == 0
    rows = d["rows"]
    assert [x["action"] for x in rows] == ["update", "update", "create"]
    assert rows[0]["match_name"] == "TEST_UPD_A"
    assert "company" in rows[0]["fields"] and "place" not in rows[0]["fields"]
    assert rows[1]["match_name"] == "TEST_UPD_B"
    assert "place" in rows[1]["fields"]
    assert {e["row"] for e in d["errors"]} == {5, 6}, d["errors"]
    # nothing written
    assert _get(s, a["id"])["company"] == "OldCo"
    assert _get(s, b["id"])["place"] == "Calicut"
    assert not any(c["name"] == "TEST_UPD_NEW" for c in s.get(f"{API}/clients").json())


def test_real_import_updates_and_keeps_blanks(s, seeded):
    a, b = seeded
    r = _imp(s, CSV, False)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["created"] == 1 and d["updated"] == 2, d
    ca = _get(s, a["id"])
    assert ca["company"] == "NewCo"
    assert ca["place"] == "Kochi"
    assert ca["email"] == "upd_a@x.com"
    cb = _get(s, b["id"])
    assert cb["name"] == "TEST_UPD_B2"
    assert cb["place"] == "Mumbai"
    assert cb["phone"] == "9000000001" and cb["company"] == "BCo"
    assert cb["client_type"] == "associate_consultant"
    names = [c["name"] for c in s.get(f"{API}/clients").json()]
    assert names.count("TEST_UPD_NEW") == 1
    assert "TEST_UPD_X" not in names
    assert names.count("TEST_UPD_A") == 1


def test_reimport_new_row_now_updates(s, seeded):
    # The just-created row should now be matched by phone instead of duplicated
    r = _imp(s, "Name,Phone,Company\nTEST_UPD_NEW,(911) 111-1111,NC2\n", True)
    d = r.json()
    assert d["to_update"] == 1 and d["to_create"] == 0, d


def test_staff_not_matched(s):
    st = s.post(f"{API}/clients", json={"name": "TEST_UPD_STAFF", "client_type": "staff",
                                        "phone": "9222222222", "office": None}).json()
    try:
        r = _imp(s, "Name,Phone\nTEST_UPD_SOMEONE,9222222222\n", True)
        d = r.json()
        assert d["to_update"] == 0 and d["to_create"] == 1, d
    finally:
        s.delete(f"{API}/clients/{st['id']}")
