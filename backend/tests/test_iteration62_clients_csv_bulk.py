# Clients CSV export/import (dry-run + commit) and bulk-delete regression tests
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
HEADER = "Name,Type,Email,Phone,Company,Office,Home Office,Place,Address,Incentive,DOB,Employee ID,Designation,Department,DOJ"


@pytest.fixture(scope="module")
def s():
    r = requests.post(f"{API}/auth/login", json={"email": "admin@educonnect.app", "password": "Admin@12345"})
    if r.status_code != 200:
        pytest.skip("login failed")
    tok = r.json().get("token") or r.json().get("access_token")
    sess = requests.Session()
    sess.headers["Authorization"] = f"Bearer {tok}"
    yield sess
    # cleanup TEST_ csv clients
    lst = sess.get(f"{API}/clients").json()
    ids = [c["id"] for c in lst if str(c.get("name", "")).startswith("TEST_CSV")]
    if ids:
        sess.post(f"{API}/clients/bulk-delete", json={"ids": ids})


CSV = ("Name,Type,Email,Phone\n"
       "TEST_CSV_A,Sub Agent,a@x.com,111\n"
       "TEST_CSV_B,associate_consultant,,222\n"
       ",sub_agent_associate,,333\n"
       "TEST_CSV_C,bogus,,444\n")


def _imp(s, dry, body=CSV):
    return s.post(f"{API}/clients/import?dry_run={str(dry).lower()}",
                  files={"file": ("c.csv", body, "text/csv")}, data={"default_type": "sub_agent_associate"})


def test_export_header(s):
    r = s.get(f"{API}/clients/export", params={"types": "sub_agent_associate,associate_consultant"})
    assert r.status_code == 200
    assert "text/csv" in r.headers["content-type"]
    assert r.text.splitlines()[0].strip() == HEADER


def test_dry_run_saves_nothing(s):
    before = [c for c in s.get(f"{API}/clients").json() if c["name"].startswith("TEST_CSV")]
    r = _imp(s, True)
    assert r.status_code == 200
    d = r.json()
    assert d["valid"] == 2 and d["created"] == 0
    assert {e["row"] for e in d["errors"]} == {4, 5}
    after = [c for c in s.get(f"{API}/clients").json() if c["name"].startswith("TEST_CSV")]
    assert len(after) == len(before)


def test_no_name_column(s):
    r = _imp(s, True, "Email\na@x.com\n")
    assert r.status_code == 400


def test_import_commit_export_ids_bulk_delete(s):
    r = _imp(s, False)
    assert r.status_code == 200 and r.json()["created"] == 2
    lst = [c for c in s.get(f"{API}/clients").json() if c["name"] in ("TEST_CSV_A", "TEST_CSV_B")]
    assert len(lst) >= 2
    a = next(c for c in lst if c["name"] == "TEST_CSV_A")
    assert a["client_type"] == "sub_agent_associate" and a["phone"] == "111"
    ids = [c["id"] for c in lst]
    ex = s.get(f"{API}/clients/export", params={"ids": ",".join(ids)})
    assert ex.status_code == 200 and len(ex.text.strip().splitlines()) == len(ids) + 1
    d = s.post(f"{API}/clients/bulk-delete", json={"ids": ids})
    assert d.status_code == 200 and d.json()["deleted"] == len(ids)
    remaining = [c for c in s.get(f"{API}/clients").json() if c["id"] in ids]
    assert remaining == []


def test_bulk_delete_empty(s):
    r = s.post(f"{API}/clients/bulk-delete", json={"ids": []})
    assert r.status_code == 200 and r.json()["deleted"] == 0
