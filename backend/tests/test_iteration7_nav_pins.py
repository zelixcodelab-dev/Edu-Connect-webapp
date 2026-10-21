# Nav pins (pinned favourites) API tests: PUT /api/auth/pins + /api/auth/me nav_pins
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")


def _login(email, pw):
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": pw})
    if r.status_code != 200:
        pytest.skip(f"login failed for {email}: {r.status_code}")
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture(scope="module")
def admin_h():
    h = _login("admin@educonnect.app", "Admin@12345")
    yield h
    requests.put(f"{BASE_URL}/api/auth/pins", json={"pins": []}, headers=h)


@pytest.fixture(scope="module")
def staff_h():
    h = _login("TEST_att_staff_1@educonnect.app", "Staff@12345")
    yield h
    requests.put(f"{BASE_URL}/api/auth/pins", json={"pins": []}, headers=h)


def _me(h):
    r = requests.get(f"{BASE_URL}/api/auth/me", headers=h)
    assert r.status_code == 200
    return r.json()


class TestNavPins:
    def test_save_and_me(self, admin_h):
        r = requests.put(f"{BASE_URL}/api/auth/pins", json={"pins": ["/students", "/leads", "/attendance"]}, headers=admin_h)
        assert r.status_code == 200
        assert r.json()["pins"] == ["/students", "/leads", "/attendance"]
        assert _me(admin_h)["nav_pins"] == ["/students", "/leads", "/attendance"]

    def test_reorder_persists(self, admin_h):
        r = requests.put(f"{BASE_URL}/api/auth/pins", json={"pins": ["/attendance", "/students", "/leads"]}, headers=admin_h)
        assert r.status_code == 200
        assert _me(admin_h)["nav_pins"] == ["/attendance", "/students", "/leads"]

    def test_dedupe_and_invalid_paths_dropped(self, admin_h):
        r = requests.put(f"{BASE_URL}/api/auth/pins",
                         json={"pins": ["/students", "/students", "students", "//evil.com", "http://x", " /leads "]},
                         headers=admin_h)
        assert r.status_code == 200
        assert r.json()["pins"] == ["/students", "/leads"]
        assert _me(admin_h)["nav_pins"] == ["/students", "/leads"]

    def test_max_8(self, admin_h):
        eight = [f"/p{i}" for i in range(8)]
        assert requests.put(f"{BASE_URL}/api/auth/pins", json={"pins": eight}, headers=admin_h).status_code == 200
        r = requests.put(f"{BASE_URL}/api/auth/pins", json={"pins": eight + ["/p8"]}, headers=admin_h)
        assert r.status_code == 422
        assert _me(admin_h)["nav_pins"] == eight

    def test_unauthenticated(self):
        r = requests.put(f"{BASE_URL}/api/auth/pins", json={"pins": ["/students"]})
        assert r.status_code in (401, 403)

    def test_bad_payload(self, admin_h):
        r = requests.put(f"{BASE_URL}/api/auth/pins", json={"pins": "notalist"}, headers=admin_h)
        assert r.status_code == 422

    def test_staff_independent(self, admin_h, staff_h):
        requests.put(f"{BASE_URL}/api/auth/pins", json={"pins": ["/students"]}, headers=admin_h)
        r = requests.put(f"{BASE_URL}/api/auth/pins", json={"pins": ["/attendance"]}, headers=staff_h)
        assert r.status_code == 200
        assert _me(staff_h)["nav_pins"] == ["/attendance"]
        assert _me(admin_h)["nav_pins"] == ["/students"]

    def test_clear(self, admin_h, staff_h):
        for h in (admin_h, staff_h):
            assert requests.put(f"{BASE_URL}/api/auth/pins", json={"pins": []}, headers=h).json()["pins"] == []
            assert _me(h)["nav_pins"] == []
