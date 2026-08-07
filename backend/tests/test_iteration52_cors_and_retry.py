"""Iteration 52 — Android WebView login network error fix.

Backend CORS assertions must be made DIRECTLY against localhost:8001,
NOT through the preview ingress (which rewrites CORS headers).
"""
import requests
import pytest

DIRECT = "http://localhost:8001"


def _preflight(origin: str):
    return requests.options(
        f"{DIRECT}/api/auth/login",
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
        timeout=5,
    )


class TestCORSPreflight:
    def test_capacitor_origin_preflight(self):
        r = _preflight("capacitor://localhost")
        assert r.status_code == 200
        assert r.headers.get("access-control-allow-credentials") == "true"
        # Must reflect the exact origin, NOT '*'
        assert r.headers.get("access-control-allow-origin") == "capacitor://localhost"
        assert r.headers.get("access-control-max-age") == "600"

    def test_vercel_origin_preflight(self):
        origin = "https://finflow-by-km-updated-2-mp4p.vercel.app"
        r = _preflight(origin)
        assert r.status_code == 200
        assert r.headers.get("access-control-allow-credentials") == "true"
        assert r.headers.get("access-control-allow-origin") == origin
        assert r.headers.get("access-control-max-age") == "600"

    def test_arbitrary_browser_origin_reflects_via_regex(self):
        origin = "https://random.example.com"
        r = _preflight(origin)
        assert r.status_code == 200
        assert r.headers.get("access-control-allow-credentials") == "true"
        # regex '.*' fallback must still reflect the origin
        assert r.headers.get("access-control-allow-origin") == origin

    def test_ionic_origin_preflight(self):
        r = _preflight("ionic://localhost")
        assert r.status_code == 200
        assert r.headers.get("access-control-allow-origin") == "ionic://localhost"
        assert r.headers.get("access-control-allow-credentials") == "true"

    def test_http_localhost_preflight(self):
        r = _preflight("http://localhost")
        assert r.status_code == 200
        assert r.headers.get("access-control-allow-origin") == "http://localhost"


class TestActualLoginCORS:
    def test_login_success_from_capacitor_origin(self):
        r = requests.post(
            f"{DIRECT}/api/auth/login",
            headers={"Origin": "capacitor://localhost", "Content-Type": "application/json"},
            json={"email": "admin@kmfoundation.online", "password": "Admin@786"},
            timeout=10,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert "access_token" in data
        assert isinstance(data["access_token"], str) and len(data["access_token"]) > 20
        # CORS headers on the actual (non-preflight) response
        assert r.headers.get("access-control-allow-credentials") == "true"
        assert r.headers.get("access-control-allow-origin") == "capacitor://localhost"

    def test_login_bad_credentials_still_returns_cors(self):
        r = requests.post(
            f"{DIRECT}/api/auth/login",
            headers={"Origin": "capacitor://localhost", "Content-Type": "application/json"},
            json={"email": "admin@kmfoundation.online", "password": "wrong"},
            timeout=10,
        )
        # 401 or 400 — but CORS headers must still be present so the browser
        # surfaces the real error instead of "Network Error".
        assert r.status_code in (400, 401, 403)
        assert r.headers.get("access-control-allow-origin") == "capacitor://localhost"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
