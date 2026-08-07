"""Integration tests for the Colleges master-data router."""
from __future__ import annotations

import io
from typing import Iterator

import pytest
import requests

from _creds import admin_credentials, office_credentials, api_base


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


@pytest.fixture
def office_session() -> Iterator[requests.Session]:
    email, pwd = office_credentials()
    s = _login(email, pwd)
    yield s
    s.close()


@pytest.fixture(autouse=True)
def _wipe_test_colleges(admin_session: requests.Session) -> None:
    """Remove any college whose name starts with 'PYTEST_' before each test
    so reruns are idempotent and we don't collide with manual data."""
    r = admin_session.get(f"{API}/colleges", timeout=15)
    if r.status_code != 200:
        return
    for c in r.json():
        if (c.get("name") or "").startswith("PYTEST_"):
            admin_session.delete(f"{API}/colleges/{c['id']}", timeout=15)


def test_create_and_list_college(admin_session: requests.Session) -> None:
    r = admin_session.post(f"{API}/colleges", json={
        "name": "PYTEST_Alpha University",
        "courses": ["B.Tech CSE", "B.Tech ECE"],
        "place": "Bangalore",
    }, timeout=15)
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["name"] == "PYTEST_Alpha University"
    assert body["place"] == "Bangalore"
    assert body["courses"] == ["B.Tech CSE", "B.Tech ECE"]

    r2 = admin_session.get(f"{API}/colleges", timeout=15)
    assert r2.status_code == 200
    names = {c["name"] for c in r2.json()}
    assert "PYTEST_Alpha University" in names


def test_duplicate_name_rejected(admin_session: requests.Session) -> None:
    admin_session.post(f"{API}/colleges", json={
        "name": "PYTEST_Beta College",
        "courses": [],
        "place": "",
    }, timeout=15)
    # Case-insensitive duplicate must be rejected.
    r = admin_session.post(f"{API}/colleges", json={
        "name": "pytest_beta college",
        "courses": [],
        "place": "",
    }, timeout=15)
    assert r.status_code == 409


def test_update_and_delete(admin_session: requests.Session) -> None:
    create = admin_session.post(f"{API}/colleges", json={
        "name": "PYTEST_Gamma Institute",
        "courses": ["BBA"],
        "place": "Pune",
    }, timeout=15).json()
    cid = create["id"]

    upd = admin_session.patch(f"{API}/colleges/{cid}", json={
        "name": "PYTEST_Gamma Institute (Renamed)",
        "courses": ["BBA", "MBA"],
        "place": "Pune North",
    }, timeout=15)
    assert upd.status_code == 200
    after = upd.json()
    assert after["name"] == "PYTEST_Gamma Institute (Renamed)"
    assert after["courses"] == ["BBA", "MBA"]
    assert after["place"] == "Pune North"

    delr = admin_session.delete(f"{API}/colleges/{cid}", timeout=15)
    assert delr.status_code == 200


def test_office_admin_cannot_write(
    admin_session: requests.Session, office_session: requests.Session
) -> None:
    # GET is allowed for office admins (drives the student-form dropdown)
    r = office_session.get(f"{API}/colleges", timeout=15)
    assert r.status_code == 200

    # POST / PATCH / DELETE blocked
    r2 = office_session.post(f"{API}/colleges", json={
        "name": "PYTEST_Office Tried",
        "courses": [],
        "place": "",
    }, timeout=15)
    assert r2.status_code == 403


def test_bulk_upload_csv(admin_session: requests.Session) -> None:
    csv_text = (
        "name,courses,place\n"
        "PYTEST_Delta University,\"B.Sc Physics, B.Sc Math\",Chennai\n"
        "PYTEST_Epsilon Polytechnic,Diploma CSE; Diploma ECE,Coimbatore\n"
        ",B.Tech XX,No Name Row\n"
        "PYTEST_Delta University,B.Tech,Should be skipped\n"
    )
    files = {"file": ("test.csv", io.BytesIO(csv_text.encode("utf-8")), "text/csv")}
    r = admin_session.post(f"{API}/colleges/bulk", files=files, timeout=20)
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["created_count"] == 2
    assert body["duplicates_count"] == 1
    assert 4 in body["skipped_blank_rows"]  # blank-name row is line 4 (header is line 1)

    # Confirm course splitter handles both ',' and ';'
    listing = admin_session.get(f"{API}/colleges", timeout=15).json()
    epsilon = next(c for c in listing if c["name"] == "PYTEST_Epsilon Polytechnic")
    assert epsilon["courses"] == ["Diploma CSE", "Diploma ECE"]


def test_bulk_upload_rejects_non_csv(admin_session: requests.Session) -> None:
    files = {"file": ("oops.txt", io.BytesIO(b"name,courses,place\n"), "text/plain")}
    r = admin_session.post(f"{API}/colleges/bulk", files=files, timeout=20)
    assert r.status_code == 400


def test_template_download(admin_session: requests.Session) -> None:
    r = admin_session.get(f"{API}/colleges/template", timeout=15)
    assert r.status_code == 200
    text = r.text
    assert "name" in text and "courses" in text and "place" in text


def test_public_colleges_no_auth() -> None:
    # Use a vanilla requests.get (no session/cookies).
    r = requests.get(f"{API}/public/colleges", timeout=15)
    assert r.status_code == 200
    data = r.json()
    assert "colleges" in data
    assert isinstance(data["colleges"], list)
