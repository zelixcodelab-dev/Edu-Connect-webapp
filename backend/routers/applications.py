"""Public student application form endpoints.

Routes under ``/api/public/*`` — **no auth required** so prospective students
can submit their admission application without an account. Submissions are
written into the existing ``students`` collection (status=``inquiry``) under
the FIRST super-admin's ``user_id`` so they immediately surface in the admin
Students page.

Extra application data (parents, address, academic records, payment, reference)
is preserved as a nested ``application`` sub-document on the student doc.
"""
import logging
import os
import re
from typing import Optional, Literal
from fastapi import APIRouter, HTTPException, Depends, Request
from pydantic import BaseModel, EmailStr, Field

from db import db
from auth_lib import gen_id, now_iso, get_current_user
from lib.application_pdf import render_application_pdf
from lib.email_notifier import send_email, application_email_html
from lib.rate_limit import hit as rate_limit_hit, client_ip, mask_phone

# Re-use the notifier so super-admins get pinged in real time.
from routers.notifications import notify_super_admins
from routers.leads import bump_lead_on_application

log = logging.getLogger("finflow.applications")


def slugify(name: str) -> str:
    """Lowercase, dash-separated slug. Strips everything except a-z 0-9 -."""
    if not name:
        return ""
    s = name.strip().lower()
    s = re.sub(r"[^a-z0-9]+", "-", s)
    return s.strip("-")


router = APIRouter(prefix="/api/public", tags=["public"])
admin_router = APIRouter(prefix="/api/applications", tags=["applications"])


# ---------- Pydantic models (mirror the 6-step wizard) ----------

Gender = Literal["male", "female", "other"]
AdmissionType = Literal["management", "government", "merit", "lateral_entry", "other"]
PaymentMode = Literal["cash", "bank_transfer", "upi", "cheque", "card", "other"]
ReferenceType = Literal["sub_agent", "associate", "km", "staff", "self", "other"]


class BasicInfo(BaseModel):
    student_full_name: str
    mobile_number: str
    email: EmailStr
    date_of_birth: str
    gender: Gender = "male"
    aadhaar_number: Optional[str] = None
    nationality: Optional[str] = "Indian"
    religion: Optional[str] = None
    caste: Optional[str] = None


class CourseDetails(BaseModel):
    interested_course: str
    preferred_college: Optional[str] = None
    academic_year: Optional[str] = None
    admission_type: AdmissionType = "management"


class Communication(BaseModel):
    father_name: str
    father_mobile: str
    mother_name: Optional[str] = None
    mother_mobile: Optional[str] = None
    address_line_1: str
    address_line_2: Optional[str] = None
    city: str
    state: str = "Tamil Nadu"
    pincode: str


class AcademicQualification(BaseModel):
    register_number: Optional[str] = None
    school_name: Optional[str] = None
    school_place: Optional[str] = None
    board: Optional[str] = None
    year_of_passing: Optional[str] = None
    percentage: Optional[str] = None


class Academic(BaseModel):
    tenth: AcademicQualification = Field(default_factory=AcademicQualification)
    twelfth: AcademicQualification = Field(default_factory=AcademicQualification)


class Payment(BaseModel):
    """Registration payment block.

    Legacy fields (``payment_mode``, ``transaction_id``, ``screenshot_url``)
    are kept optional so historical applications still validate cleanly when
    re-saved through the admin Edit dialog. New submissions only send
    ``registration_amount`` + ``payment_date``.
    """
    registration_amount: float = 0.0
    payment_date: Optional[str] = None
    payment_mode: Optional[PaymentMode] = None
    transaction_id: Optional[str] = None
    screenshot_url: Optional[str] = None


class Reference(BaseModel):
    """Trimmed reference block — only the two fields the new form collects.

    Legacy fields (``type``, ``place``, ``notes``, ``relation``, ``phone``)
    are kept optional to preserve backward compatibility.
    """
    name: Optional[str] = None
    contact_number: Optional[str] = None
    type: Optional[ReferenceType] = None
    place: Optional[str] = None
    notes: Optional[str] = None
    relation: Optional[str] = None
    phone: Optional[str] = None


class Declaration(BaseModel):
    """Applicant's acceptance of the admission declaration.

    ``agreement_accepted`` MUST be true for new public submissions — enforced
    by the route handler (not by Pydantic) so admin paste/patch flows can
    still save partial records.
    """
    agreement_accepted: bool = False


class ApplicationIn(BaseModel):
    basic_info: BasicInfo
    course: CourseDetails
    communication: Communication
    academic: Academic = Field(default_factory=Academic)
    payment: Payment = Field(default_factory=Payment)
    reference: Reference = Field(default_factory=Reference)
    declaration: Declaration = Field(default_factory=Declaration)
    # Optional referral attribution. When the form is opened via
    # /apply?ref=<staff_user_id>, the frontend echoes that id here so the
    # resulting student is credited to that staff login account.
    referrer_id: Optional[str] = None


# ---------- Helpers ----------

async def _resolve_owner_user_id() -> str:
    """Find the user_id under which to land this application.

    Strategy: pick the first ``super_admin`` user (seeded admin). If none exists
    yet, fall back to the very first user in the database so the row still gets
    persisted.
    """
    admin = await db.users.find_one({"role": "super_admin"}, {"id": 1})
    if admin and admin.get("id"):
        return admin["id"]
    fallback = await db.users.find_one({}, {"id": 1})
    if fallback and fallback.get("id"):
        return fallback["id"]
    raise HTTPException(503, "Admin account not provisioned yet")


def _build_student_doc(app: ApplicationIn, owner_id: str, source: str = "public_form", referrer_user_id: Optional[str] = None, referrer_name: Optional[str] = None) -> dict:
    """Translate the application payload → a row that fits the existing
    ``students`` schema, with the full application preserved on the side.

    ``source`` distinguishes between public form submissions (``public_form``)
    and admin-pasted entries (``admin_paste``) so the UI can badge them
    appropriately. ``referrer_name`` is denormalized alongside
    ``referrer_user_id`` so the Students list can display "Referred by X"
    without a separate lookup per row.
    """
    payment_amt = float(app.payment.registration_amount or 0)
    payments_list: list[dict] = []
    if payment_amt > 0:
        payments_list.append({
            "id": gen_id(),
            "created_at": now_iso(),
            "date": app.payment.payment_date or now_iso()[:10],
            "amount": round(payment_amt, 2),
            "fee_type": "booking_admission",
            "received_in": {
                "type": "college",
                "name": None,
                "account_id": None,
            },
            "has_adjustment": False,
            "adjustments": [],
            "schedule_id": None,
            "remarks": "Registration payment · pending verification",
        })

    return {
        "id": gen_id(),
        "user_id": owner_id,
        "created_at": now_iso(),
        # Map application → top-level student fields (so it shows up cleanly in the grid)
        "name": app.basic_info.student_full_name,
        "course": app.course.interested_course,
        "college": app.course.preferred_college or "",
        "reference": app.reference.name or "",
        "referrer_user_id": referrer_user_id,
        "referrer_name": referrer_name,
        "sc_out_fixed": 0.0,
        "status": "inquiry",
        "enrollment_date": now_iso()[:10],
        "notes": (app.reference.notes or "").strip(),
        # No fees plan yet — admin sets it after reviewing the application.
        "fees_plan": None,
        "schedules": [],
        "payments": payments_list,
        # Preserve the entire application payload for the PDF & admin view.
        "application": app.model_dump(),
        "application_source": source,
        "application_submitted_at": now_iso(),
    }


# ---------- Routes ----------

@router.post("/applications", status_code=201)
async def submit_application(payload: ApplicationIn, request: Request) -> dict:
    """Submit a new student application. Returns ``{id, reference_code}``."""
    # SEC-003: Rate-limit public submissions per source IP.
    # Two-tier: a burst limit (5/hour) plus a daily cap (30/day) to keep
    # honest applicants unblocked while stopping form spam.
    ip = client_ip(request)
    await rate_limit_hit(bucket="apply-hour", key=ip, max_hits=5, window_seconds=3600)
    await rate_limit_hit(bucket="apply-day", key=ip, max_hits=30, window_seconds=86400)
    # Enforce mandatory fields for public submissions. Admin paste/patch
    # endpoints don't go through here so they can still save partial data.
    twelfth_reg = (payload.academic.twelfth.register_number or "").strip()
    if not twelfth_reg:
        raise HTTPException(422, "12th Standard Register Number is required")
    if not payload.declaration.agreement_accepted:
        raise HTTPException(422, "Please accept the declaration to submit")
    owner_id = await _resolve_owner_user_id()
    # Resolve a staff/admin login referrer so the student is credited to them.
    referrer_user_id = None
    referrer_name = None
    if payload.referrer_id:
        ru = await db.users.find_one(
            {"id": payload.referrer_id, "role": {"$in": ["staff", "office_admin", "super_admin"]}},
            {"_id": 0, "id": 1, "name": 1},
        )
        if ru:
            referrer_user_id = ru["id"]
            referrer_name = ru.get("name")
            if not (payload.reference.name or "").strip():
                payload.reference.name = ru.get("name")
    # Fallback: applicant typed a reference name manually (no ?ref= link).
    # If it matches a staff/admin, credit them as the referrer too.
    if not referrer_user_id and (payload.reference.name or "").strip():
        from routers.students import _resolve_referrer_by_name
        ru2 = await _resolve_referrer_by_name(payload.reference.name)
        if ru2:
            referrer_user_id = ru2["id"]
            referrer_name = ru2.get("name")
    doc = _build_student_doc(payload, owner_id, referrer_user_id=referrer_user_id, referrer_name=referrer_name)
    await db.students.insert_one(doc)
    # Auto-advance the matching CRM lead: converted → application_submitted,
    # cascading to fee_paid when a registration amount is present. Best-effort.
    try:
        reg_amt = float(payload.payment.registration_amount or 0)
        bump_result = await bump_lead_on_application(
            student_id=doc["id"],
            phone=payload.basic_info.mobile_number,
            applicant_name=payload.basic_info.student_full_name,
            has_registration_payment=reg_amt > 0,
            registration_amount=reg_amt,
        )
        if bump_result:
            log.info(
                "[applications] auto-bumped lead %s -> %s (student=%s)",
                bump_result.get("id"), bump_result.get("status"), doc["id"],
            )
        else:
            log.info(
                "[applications] no matching lead to auto-bump for phone=%s (student=%s)",
                mask_phone(payload.basic_info.mobile_number), doc["id"],
            )
    except Exception as exc:  # pragma: no cover — best-effort
        log.warning("[applications] lead auto-bump failed: %s", exc, exc_info=True)
    # Fire-and-forget notification to all super admins.
    try:
        await notify_super_admins(
            type="student_application",
            title="New student application",
            message=f"{payload.basic_info.student_full_name} · {payload.course.interested_course}",
            link=f"/students/{doc['id']}",
        )
    except Exception:  # pragma: no cover — best-effort
        pass
    # Email notification with the Application PDF attached. Best-effort: never
    # block or fail the public submit endpoint if the email pipeline is down.
    recipient = os.environ.get("APPLICATION_NOTIFY_EMAIL")
    if recipient:
        try:
            pdf_bytes = render_application_pdf(doc)
            safe_name = "".join(
                ch if ch.isalnum() or ch in " -_" else "_"
                for ch in (payload.basic_info.student_full_name or "applicant")
            ).strip() or "applicant"
            filename = f"{safe_name} - Application - {doc['application_submitted_at'][:10]}.pdf"
            await send_email(
                to=recipient,
                subject=f"New application · {payload.basic_info.student_full_name}",
                html=application_email_html(doc),
                attachments=[{"filename": filename, "content": pdf_bytes}],
                reply_to=str(payload.basic_info.email) if payload.basic_info.email else None,
            )
        except Exception as exc:  # pragma: no cover — best-effort
            log.warning("[applications] email notification failed: %s", exc)
    return {
        "id": doc["id"],
        "reference_code": doc["id"][:8].upper(),
        "submitted_at": doc["application_submitted_at"],
    }


@router.get("/courses")
async def list_courses() -> dict:
    """Convenience endpoint — returns a static list of common courses for the
    public form's dropdown. Customise as needed."""
    return {
        "courses": [
            "B.Tech — Computer Science",
            "B.Tech — Electronics & Communication",
            "B.Tech — Mechanical",
            "B.Tech — Civil",
            "B.Tech — Information Technology",
            "B.Sc — Nursing",
            "B.Sc — Physics",
            "B.Sc — Chemistry",
            "B.Sc — Mathematics",
            "B.Com",
            "BBA",
            "BCA",
            "MBA",
            "MCA",
            "M.Tech",
            "MBBS",
            "BDS",
            "Pharm.D",
            "B.Pharm",
            "Other",
        ]
    }


# Map our internal client_type → the form's reference_type enum.
_CLIENT_TYPE_TO_REF = {
    "staff": "staff",
    "sub_agent_associate": "sub_agent",
    "associate_consultant": "associate",
    "km_blr_office": "km",
    "km_tcr_office": "km",
    "km_kmly_office": "km",
}


@router.get("/referrer/{ref}")
async def get_referrer(ref: str) -> dict:
    """Public lookup for the referral landing page.

    Accepts either:
    - a UUID (legacy long links) — looked up as ``id``
    - a short slug like ``john-doe`` — matched against ``slugify(name)``

    Returns the bare-minimum info needed to pre-fill the Reference section
    of the application form. 404 if no match.
    """
    # UUID-shaped strings → direct id lookup (legacy + future direct shares)
    is_uuid = len(ref) == 36 and ref.count("-") == 4
    c = None
    if is_uuid:
        c = await db.clients.find_one({"id": ref}, {"_id": 0})
    if c is None:
        # Fall back to slug — match the first staff/agent client whose name slugifies
        # to the given ref. Slug collisions resolve by oldest-created (deterministic).
        target_slug = slugify(ref)
        if target_slug:
            candidates = await db.clients.find(
                {}, {"_id": 0, "id": 1, "name": 1, "client_type": 1, "phone": 1, "office": 1, "company": 1, "created_at": 1},
            ).to_list(2000)
            matches = [d for d in candidates if slugify(d.get("name") or "") == target_slug]
            if matches:
                matches.sort(key=lambda d: d.get("created_at") or "")
                c = await db.clients.find_one({"id": matches[0]["id"]}, {"_id": 0})
    if not c:
        # Maybe the ref is a staff/admin LOGIN user id — CRM referral links
        # use the staff user id (not a client id).
        if is_uuid:
            u = await db.users.find_one(
                {"id": ref, "role": {"$in": ["staff", "office_admin", "super_admin"]}},
                {"_id": 0, "id": 1, "name": 1, "office": 1},
            )
            if u:
                return {
                    "id": u["id"],
                    "name": u.get("name") or "",
                    "slug": slugify(u.get("name") or ""),
                    "type": "staff",
                    "contact_number": "",
                    "place": (u.get("office") or "").replace("KM_", "KM ") if u.get("office") else "",
                    "is_user": True,
                }
        raise HTTPException(404, "Referrer not found")
    return {
        "id": c["id"],
        "name": c.get("name") or "",
        "slug": slugify(c.get("name") or ""),
        "type": _CLIENT_TYPE_TO_REF.get(c.get("client_type"), "other"),
        "contact_number": c.get("phone") or "",
        "place": c.get("office", "").replace("KM_", "KM ") if c.get("office") else (c.get("company") or ""),
    }



# ---------- Authenticated admin paste endpoint ----------

@admin_router.post("/admin", status_code=201)
async def admin_submit_application(payload: ApplicationIn, user: dict = Depends(get_current_user)) -> dict:
    """Create an inquiry student from an admin-pasted/edited application.

    Mirrors the public submission flow but:
    - requires authentication (super_admin only),
    - tags ``application_source="admin_paste"`` so the UI can badge it,
    - owner is the current super admin (not the seeded fallback).
    """
    if user.get("role") != "super_admin":
        raise HTTPException(403, "Super admin only")
    doc = _build_student_doc(payload, owner_id=user["id"], source="admin_paste")
    await db.students.insert_one(doc)
    return {
        "id": doc["id"],
        "reference_code": doc["id"][:8].upper(),
        "submitted_at": doc["application_submitted_at"],
    }


@admin_router.patch("/{student_id}", status_code=200)
async def update_application(student_id: str, payload: ApplicationIn, user: dict = Depends(get_current_user)) -> dict:
    """Replace the ``application`` sub-document on an existing student.

    Super-admin only. Mirrors the same payload shape as the public submit so
    edits flow back into the same fields the PDF generator reads. Top-level
    student fields (name, course, college, reference) are kept in sync with
    the application's basic_info / course / reference.
    """
    if user.get("role") != "super_admin":
        raise HTTPException(403, "Super admin only")
    student = await db.students.find_one({"id": student_id})
    if not student:
        raise HTTPException(404, "Student not found")
    patch = {
        "application": payload.model_dump(),
        "name": payload.basic_info.student_full_name,
        "course": payload.course.interested_course,
        "college": payload.course.preferred_college or "",
        "reference": payload.reference.name or "",
        "application_updated_at": now_iso(),
    }
    if (student.get("notes") or "").strip() == "" and payload.reference.notes:
        patch["notes"] = (payload.reference.notes or "").strip()
    await db.students.update_one({"id": student_id}, {"$set": patch})
    fresh = await db.students.find_one({"id": student_id}, {"_id": 0})
    return fresh
