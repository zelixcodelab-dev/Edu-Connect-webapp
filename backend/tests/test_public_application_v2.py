"""Public student application form — Feb 2026 redesign.

Validates the two new server-side rules:
  - 12th Standard Register Number is mandatory
  - declaration.agreement_accepted must be true

…plus a successful submission round-trip that confirms the new payload shape
persists correctly and surfaces via /api/students for super-admin.
"""
from __future__ import annotations

import requests

from tests._creds import api_base, admin_credentials

API = api_base()


def _h(token: str) -> dict:
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def _login(creds: tuple[str, str]) -> str:
    r = requests.post(
        f"{API}/auth/login",
        json={"email": creds[0], "password": creds[1]},
        timeout=15,
    )
    r.raise_for_status()
    data = r.json()
    return data.get("access_token") or data.get("token") or ""


def _payload(*, twelfth_reg: str = "200234", agreed: bool = True) -> dict:
    return {
        "basic_info": {
            "student_full_name": "Test PublicForm",
            "mobile_number": "9988776655",
            "email": "publicform.test@example.com",
            "date_of_birth": "2005-01-01",
            "gender": "female",
        },
        "course": {
            "interested_course": "BCA",
            "preferred_college": "Test College",
            "academic_year": "2026-2027",
            "admission_type": "management",
        },
        "communication": {
            "father_name": "Daddy",
            "father_mobile": "9988776644",
            "address_line_1": "123 Test",
            "city": "Bangalore",
            "state": "Karnataka",
            "pincode": "560001",
        },
        "academic": {
            "tenth": {"register_number": "100001"},
            "twelfth": {"register_number": twelfth_reg},
        },
        "payment": {"registration_amount": 500, "payment_date": "2026-02-26"},
        "reference": {"name": "Walk-in", "contact_number": ""},
        "declaration": {"agreement_accepted": agreed},
    }


def test_public_apply_rejects_missing_twelfth_register() -> None:
    body = _payload(twelfth_reg="", agreed=True)
    r = requests.post(f"{API}/public/applications", json=body, timeout=15)
    assert r.status_code == 422, r.text
    assert "register" in r.text.lower()


def test_public_apply_rejects_missing_declaration() -> None:
    body = _payload(twelfth_reg="123456", agreed=False)
    r = requests.post(f"{API}/public/applications", json=body, timeout=15)
    assert r.status_code == 422, r.text
    assert "declaration" in r.text.lower() or "agree" in r.text.lower()


def test_public_apply_succeeds_and_persists_new_fields() -> None:
    body = _payload(twelfth_reg="999999", agreed=True)
    r = requests.post(f"{API}/public/applications", json=body, timeout=15)
    assert r.status_code == 201, r.text
    data = r.json()
    sid = data["id"]
    assert data["reference_code"] == sid[:8].upper()

    # Verify via authenticated super admin that the student persisted with the
    # new fields visible.
    token = _login(admin_credentials())
    rec = requests.get(f"{API}/students/{sid}", headers=_h(token), timeout=15)
    assert rec.status_code == 200, rec.text
    student = rec.json()
    app = student.get("application", {})
    assert app.get("declaration", {}).get("agreement_accepted") is True
    assert app.get("academic", {}).get("twelfth", {}).get("register_number") == "999999"
    assert app.get("payment", {}).get("registration_amount") == 500

    # Cleanup
    try:
        requests.delete(f"{API}/students/{sid}", headers=_h(token), timeout=10)
    except requests.RequestException:
        pass


def test_application_pdf_renderer_smoke() -> None:
    """Direct unit-test on render_application_pdf with a minimal student doc.

    Confirms the backend ReportLab generator boots without raising for a
    typical payload + that the bytes are a valid PDF (start with %PDF)
    AND that the output is a SINGLE PAGE (regression test for the bug where
    body padding pushed content onto page 2).
    """
    import re
    from lib.application_pdf import render_application_pdf

    student = {
        "id": "abcdef12-3456-7890-abcd-ef1234567890",
        "name": "Smoke Test",
        "application_submitted_at": "2026-02-26T00:00:00+00:00",
        "application": {
            "basic_info": {
                "student_full_name": "Smoke Test",
                "mobile_number": "9988776655",
                "email": "smoke@example.com",
                "date_of_birth": "2005-01-01",
                "gender": "male",
                "nationality": "Indian",
            },
            "course": {
                "interested_course": "B.Sc — Nursing",
                "preferred_college": "Little Flower Group",
                "academic_year": "2026-2027",
                "admission_type": "management",
            },
            "communication": {
                "father_name": "Father",
                "father_mobile": "9988776644",
                "address_line_1": "123 Smoke Test",
                "city": "Bangalore",
                "state": "Karnataka",
                "pincode": "560001",
            },
            "academic": {
                "tenth": {"register_number": "100", "board": "CBSE", "year_of_passing": "2021"},
                "twelfth": {"register_number": "200", "board": "State Board", "year_of_passing": "2023"},
            },
            "payment": {"registration_amount": 500, "payment_date": "2026-02-26"},
            "reference": {"name": "Walk-in"},
            "declaration": {"agreement_accepted": True},
        },
    }
    pdf_bytes = render_application_pdf(student)
    assert isinstance(pdf_bytes, bytes)
    assert pdf_bytes.startswith(b"%PDF"), "Output is not a valid PDF"
    assert len(pdf_bytes) > 5_000, f"Suspiciously small PDF ({len(pdf_bytes)} bytes)"
    # Regression: the PDF MUST be a single page. Multi-page output indicates
    # body padding has crept above the single-page budget.
    page_count = len(re.findall(rb"/Type\s*/Page[^s]", pdf_bytes))
    assert page_count == 1, f"Expected single-page PDF, got {page_count} pages"
