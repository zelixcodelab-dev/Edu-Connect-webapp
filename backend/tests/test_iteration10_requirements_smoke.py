# Post-requirements.txt regeneration smoke tests: dependency hygiene + core APIs
import os
import re
from pathlib import Path

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL")
if not BASE_URL:
    for line in Path("/app/frontend/.env").read_text().splitlines():
        if line.startswith("REACT_APP_BACKEND_URL="):
            BASE_URL = line.split("=", 1)[1].strip()
BASE_URL = BASE_URL.rstrip("/")
ADMIN = {"email": "admin@educonnect.app", "password": "Admin@12345"}


# Requirements file: no duplicate package names
def test_requirements_no_duplicates():
    names = []
    for line in Path("/app/backend/requirements.txt").read_text().splitlines():
        s = line.strip()
        if not s or s.startswith("#") or s.startswith("-"):
            continue
        name = re.split(r"[<>=!~\[; @]", s, 1)[0]
        names.append(re.sub(r"[-_.]+", "-", name).lower())
    dups = {n for n in names if names.count(n) > 1}
    assert not dups, f"duplicates: {dups}"
    assert "google-auth" in names


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json=ADMIN, timeout=30)
    assert r.status_code == 200, r.text
    data = r.json()
    tok = data.get("token") or data.get("access_token")
    if tok:
        s.headers.update({"Authorization": f"Bearer {tok}"})
    return s


# Auth
def test_auth_me(client):
    r = client.get(f"{BASE_URL}/api/auth/me", timeout=30)
    assert r.status_code == 200, r.text
    body = r.json()
    user = body.get("user", body)
    assert user.get("email", "").lower() == ADMIN["email"]


def test_login_bad_password():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": ADMIN["email"], "password": "wrong-pass"}, timeout=30)
    assert r.status_code in (400, 401)


# Core endpoints
@pytest.mark.parametrize("path", ["/api/branding", "/api/dashboard/summary", "/api/dashboard/pending-applications", "/api/dashboard/trending", "/api/dashboard/inbox"])
def test_core_endpoints(client, path):
    r = client.get(f"{BASE_URL}{path}", timeout=30)
    assert r.status_code == 200, f"{path}: {r.status_code} {r.text[:200]}"
    assert r.json() is not None
