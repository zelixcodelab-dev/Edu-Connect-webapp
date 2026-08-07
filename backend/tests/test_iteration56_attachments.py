"""Tests for object-storage / lead-attachments feature (iteration 56).

Covers uploads/image, uploads/document, lead attach/detach, serve, soft-delete-by-id,
scope, MIME/size rejection, and the round-trip through the real Emergent object storage.
"""
import io
import os
import struct
import zlib
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://finance-flow-1727.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

SUPER = ("muneer@kmfoundation.co", "kmf@0786")
OFFICE = ("blr1@finflow.com", "Office@123")
STAFF = ("staff.blr@kmfoundation.online", "Staff@123")


def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=30)
    if r.status_code != 200:
        pytest.skip(f"login failed for {email}: {r.status_code} {r.text[:200]}")
    return r.json()["access_token"]


def _bearer(token):
    return {"Authorization": f"Bearer {token}"}


def _tiny_png():
    """Build a minimum valid 1x1 PNG (~70B)."""
    sig = b"\x89PNG\r\n\x1a\n"
    def chunk(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
    ihdr = chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0))
    idat = chunk(b"IDAT", zlib.compress(b"\x00\xff\xff\xff"))
    iend = chunk(b"IEND", b"")
    return sig + ihdr + idat + iend


def _tiny_pdf():
    """Bare-bones valid PDF header — enough to be recognised as application/pdf."""
    return (b"%PDF-1.4\n1 0 obj<<>>endobj\nxref\n0 1\n0000000000 65535 f \n"
            b"trailer<<>>\nstartxref\n0\n%%EOF")


@pytest.fixture(scope="module")
def super_token():
    return _login(*SUPER)


@pytest.fixture(scope="module")
def office_token():
    return _login(*OFFICE)


@pytest.fixture(scope="module")
def staff_token():
    return _login(*STAFF)


@pytest.fixture(scope="module")
def lead_id(super_token):
    """Create a scratch lead in KM_BLR for attachment tests."""
    payload = {
        "name": "TEST_Attach Lead",
        "phone": "9000012345",
        "course": "MBA",
        "place": "Bengaluru",
        "source": "walk_in",
        "office": "KM_BLR",
    }
    r = requests.post(f"{API}/leads", json=payload, headers=_bearer(super_token), timeout=30)
    assert r.status_code in (200, 201), r.text
    lid = r.json()["id"]
    yield lid
    # cleanup
    requests.delete(f"{API}/leads/{lid}", headers=_bearer(super_token), timeout=30)


# -------- /api/uploads/image --------
class TestUploadImage:
    def test_upload_png_ok(self, super_token):
        r = requests.post(
            f"{API}/uploads/image",
            files={"file": ("t.png", _tiny_png(), "image/png")},
            headers=_bearer(super_token), timeout=60,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert "url" in body and "path" in body and "file_id" in body
        assert body["path"].startswith("finflow/uploads/")

    def test_upload_pdf_rejected(self, super_token):
        r = requests.post(
            f"{API}/uploads/image",
            files={"file": ("t.pdf", _tiny_pdf(), "application/pdf")},
            headers=_bearer(super_token), timeout=30,
        )
        assert r.status_code == 400

    def test_upload_too_large_rejected(self, super_token):
        big = b"\x00" * (2 * 1024 * 1024 + 10)
        r = requests.post(
            f"{API}/uploads/image",
            files={"file": ("big.png", big, "image/png")},
            headers=_bearer(super_token), timeout=60,
        )
        assert r.status_code == 400

    def test_upload_requires_auth(self):
        r = requests.post(
            f"{API}/uploads/image",
            files={"file": ("t.png", _tiny_png(), "image/png")}, timeout=30,
        )
        assert r.status_code in (401, 403)

    def test_round_trip_serve(self, super_token):
        png = _tiny_png()
        r = requests.post(
            f"{API}/uploads/image",
            files={"file": ("rt.png", png, "image/png")},
            headers=_bearer(super_token), timeout=60,
        )
        assert r.status_code == 200, r.text
        path = r.json()["path"]
        # GET via query auth
        g = requests.get(f"{API}/files/{path}", params={"auth": super_token}, timeout=60)
        assert g.status_code == 200, g.text
        assert g.headers.get("Content-Type", "").startswith("image/")
        assert g.content == png
        # GET via bearer
        g2 = requests.get(f"{API}/files/{path}", headers=_bearer(super_token), timeout=60)
        assert g2.status_code == 200
        # unauth
        u = requests.get(f"{API}/files/{path}", timeout=30)
        assert u.status_code == 401


# -------- /api/uploads/document --------
class TestUploadDocument:
    def test_staff_forbidden(self, staff_token):
        r = requests.post(
            f"{API}/uploads/document",
            files={"file": ("d.pdf", _tiny_pdf(), "application/pdf")},
            headers=_bearer(staff_token), timeout=30,
        )
        assert r.status_code == 403

    def test_admin_pdf_ok(self, super_token):
        r = requests.post(
            f"{API}/uploads/document",
            files={"file": ("d.pdf", _tiny_pdf(), "application/pdf")},
            headers=_bearer(super_token), timeout=60,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["content_type"] == "application/pdf"
        assert body["path"].startswith("finflow/leads/loose/")

    def test_reject_bad_mime(self, super_token):
        r = requests.post(
            f"{API}/uploads/document",
            files={"file": ("d.exe", b"MZ\x00\x00", "application/octet-stream")},
            headers=_bearer(super_token), timeout=30,
        )
        assert r.status_code == 400

    def test_reject_oversize(self, super_token):
        big = b"\x00" * (10 * 1024 * 1024 + 10)
        r = requests.post(
            f"{API}/uploads/document",
            files={"file": ("big.pdf", big, "application/pdf")},
            headers=_bearer(super_token), timeout=120,
        )
        assert r.status_code == 400

    def test_bad_lead_scope(self, super_token):
        r = requests.post(
            f"{API}/uploads/document",
            files={"file": ("d.pdf", _tiny_pdf(), "application/pdf")},
            params={"lead_id": "nonexistent-xyz"},
            headers=_bearer(super_token), timeout=30,
        )
        assert r.status_code == 404


# -------- /api/leads/{id}/attachments --------
class TestLeadAttachments:
    def test_staff_cannot_attach(self, staff_token, lead_id):
        r = requests.post(
            f"{API}/leads/{lead_id}/attachments",
            files={"file": ("d.pdf", _tiny_pdf(), "application/pdf")},
            headers=_bearer(staff_token), timeout=30,
        )
        # staff should be blocked either by require_edit or _require_admin
        assert r.status_code in (403, 404)

    def test_attach_and_persist(self, super_token, lead_id):
        pdf = _tiny_pdf()
        r = requests.post(
            f"{API}/leads/{lead_id}/attachments",
            files={"file": ("proof.pdf", pdf, "application/pdf")},
            headers=_bearer(super_token), timeout=60,
        )
        assert r.status_code == 201, r.text
        att = r.json()
        assert att["file_id"] and att["path"].startswith(f"finflow/leads/{lead_id}/")
        assert att["original_filename"] == "proof.pdf"
        assert att["content_type"] == "application/pdf"
        assert att["uploaded_by_name"]

        # Round trip serve
        g = requests.get(f"{API}/files/{att['path']}", params={"auth": super_token}, timeout=60)
        assert g.status_code == 200
        assert g.content == pdf

        # Lead now includes it (no GET-by-id endpoint; fetch via list)
        lr = requests.get(f"{API}/leads", headers=_bearer(super_token), timeout=30)
        assert lr.status_code == 200
        rows = lr.json() if isinstance(lr.json(), list) else lr.json().get("items", [])
        found = next((x for x in rows if x.get("id") == lead_id), None)
        assert found is not None
        atts = found.get("attachments") or []
        assert any(a.get("file_id") == att["file_id"] for a in atts)

        # Detach
        d = requests.delete(
            f"{API}/leads/{lead_id}/attachments/{att['file_id']}",
            headers=_bearer(super_token), timeout=30,
        )
        assert d.status_code == 200
        # Serving now 404
        g2 = requests.get(f"{API}/files/{att['path']}", params={"auth": super_token}, timeout=30)
        assert g2.status_code == 404

        # No longer on lead
        lr2 = requests.get(f"{API}/leads", headers=_bearer(super_token), timeout=30)
        rows2 = lr2.json() if isinstance(lr2.json(), list) else lr2.json().get("items", [])
        found2 = next((x for x in rows2 if x.get("id") == lead_id), None) or {}
        atts2 = found2.get("attachments") or []
        assert not any(a.get("file_id") == att["file_id"] for a in atts2)


# -------- DELETE /api/files/id/{file_id} --------
class TestSoftDeleteById:
    def test_owner_delete_and_admin_cascade(self, super_token, lead_id):
        # attach a doc to a lead then delete via /files/id/{file_id}
        r = requests.post(
            f"{API}/leads/{lead_id}/attachments",
            files={"file": ("cascade.pdf", _tiny_pdf(), "application/pdf")},
            headers=_bearer(super_token), timeout=60,
        )
        assert r.status_code == 201, r.text
        fid = r.json()["file_id"]
        path = r.json()["path"]

        d = requests.delete(f"{API}/files/id/{fid}", headers=_bearer(super_token), timeout=30)
        assert d.status_code == 200

        # serve 404
        g = requests.get(f"{API}/files/{path}", params={"auth": super_token}, timeout=30)
        assert g.status_code == 404

        # attachment cascaded off lead
        lr = requests.get(f"{API}/leads", headers=_bearer(super_token), timeout=30)
        rows = lr.json() if isinstance(lr.json(), list) else lr.json().get("items", [])
        found = next((x for x in rows if x.get("id") == lead_id), None) or {}
        atts = found.get("attachments") or []
        assert not any(a.get("file_id") == fid for a in atts)

    def test_missing_file_404(self, super_token):
        r = requests.delete(f"{API}/files/id/does-not-exist", headers=_bearer(super_token), timeout=30)
        assert r.status_code == 404


# -------- Serve endpoint auth --------
class TestServeAuth:
    def test_bad_token_401(self, super_token):
        r = requests.post(
            f"{API}/uploads/image",
            files={"file": ("t.png", _tiny_png(), "image/png")},
            headers=_bearer(super_token), timeout=60,
        )
        path = r.json()["path"]
        g = requests.get(f"{API}/files/{path}", params={"auth": "not-a-real-token"}, timeout=30)
        assert g.status_code == 401
