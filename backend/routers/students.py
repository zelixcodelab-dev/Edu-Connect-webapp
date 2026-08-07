"""Student fee collection — single-page view per student.

Each student document embeds:
- schedules[]: planned installments
- payments[]:  actual receipts, each with its own received_in + adjustments
"""
from typing import List, Optional, Literal
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, model_validator

from db import db
from auth_lib import get_current_user, gen_id, now_iso, require_edit
from routers.notifications import notify_super_admins


router = APIRouter(prefix="/api/students", tags=["students"])


# ---------- Models ----------
PackageStatus = Literal["admission_tuition", "incl_food_accomm"]
InstallmentMode = Literal["semester", "yearly"]


class FeesPlan(BaseModel):
    installment_mode: InstallmentMode = "yearly"
    year_1: float = 0.0
    year_2: float = 0.0
    year_3: Optional[float] = None
    year_4: Optional[float] = None
    has_scholarship: bool = False
    scholarship_amount: float = 0.0
    package_status: PackageStatus = "admission_tuition"

    @model_validator(mode="after")
    def _scholarship_amount(self):
        if not self.has_scholarship:
            self.scholarship_amount = 0.0
        return self


class StudentIn(BaseModel):
    name: str
    course: Optional[str] = None
    college: Optional[str] = None
    reference: Optional[str] = None
    sc_out_fixed: float = 0.0
    status: Literal["inquiry", "enrolled", "cancelled", "completed"] = "inquiry"
    enrollment_date: Optional[str] = None
    notes: Optional[str] = ""
    fees_plan: Optional[FeesPlan] = None
    # Cross-user visibility (super_admin sets via UI; office_admin gets it
    # forced server-side to their own office).
    home_office: Optional[Literal["KM_BLR", "KM_TCR", "KM_KMLY", "ALL"]] = None
    # Super-admin-only override: actual service charge received from the
    # college for THIS admission. Overrides the college-level default rate
    # when set. None means "fall back to the college-level rate".
    sc_from_college_override: Optional[float] = None


class ScheduleItemIn(BaseModel):
    label: str = Field(..., description="e.g. '1st Payment'")
    amount: float = 0.0
    remarks: Optional[str] = ""
    due_date: Optional[str] = None


ReceivedInType = Literal["college", "km", "sub_agent", "associate", "cash", "bank"]
SubAgentType = Literal["sub_agent", "associate", "km"]
PaymentMode = Literal["cash", "bank_transfer", "upi", "cheque", "card", "other"]
FeeType = Literal[
    # Current catalogue
    "application_fees",
    "registration_fees",
    "admission_fees",
    "tuition_fees",
    "uniform_fees",
    "other_fees",
    "sc_adjusted",
    # Legacy values — kept so historical payments deserialize
    "booking_admission",
    "tution",
    "other",
]
AdjustmentKind = Literal[
    "paid_to_college",   # legacy
    "sc_adjusted",        # SC absorbed by a sub-agent / associate / KM
    "internal_credit",    # money landed in an internal KM Foundation account
]


class ReceivedIn(BaseModel):
    type: ReceivedInType
    name: Optional[str] = None      # sub-agent / KM / associate / contact name
    account_id: Optional[str] = None  # internal account where money was received
    client_id: Optional[str] = None   # set when SC Adjusted — references clients._id

    @model_validator(mode="after")
    def _name_required_for_agent(self):
        if self.type in {"sub_agent", "associate", "km"}:
            if not self.name or not self.name.strip():
                raise ValueError(
                    f"received_in.name is required when type is '{self.type}'"
                )
        return self


class Adjustment(BaseModel):
    id: Optional[str] = None
    kind: AdjustmentKind
    amount: float
    payment_date: str
    payment_mode: PaymentMode = "bank_transfer"
    sub_agent_type: Optional[SubAgentType] = None  # only when kind=sc_adjusted
    sub_agent_name: Optional[str] = None
    account_id: Optional[str] = None  # only when kind=internal_credit
    client_id: Optional[str] = None   # references clients._id when picked from list
    remarks: Optional[str] = ""

    @model_validator(mode="after")
    def _per_kind_requirements(self):
        if self.kind == "sc_adjusted":
            if not self.sub_agent_type:
                raise ValueError(
                    "sub_agent_type is required when adjustment kind is 'sc_adjusted'"
                )
            if not self.sub_agent_name or not self.sub_agent_name.strip():
                raise ValueError(
                    "sub_agent_name is required when adjustment kind is 'sc_adjusted'"
                )
        if self.kind == "internal_credit":
            if not self.account_id or not str(self.account_id).strip():
                raise ValueError(
                    "account_id is required when adjustment kind is 'internal_credit'"
                )
        return self


class PaymentItemIn(BaseModel):
    date: str
    amount: float
    fee_type: FeeType = "other"
    received_in: ReceivedIn
    has_adjustment: bool = False
    adjustments: List[Adjustment] = []
    schedule_id: Optional[str] = None
    remarks: Optional[str] = ""


# ---------- Helpers ----------
def _normalize_legacy_payment(p: dict) -> dict:
    """Promote old route/sub_agent_* schema into the new received_in/adjustments shape.
    No-op if already normalized."""
    if "received_in" in p and isinstance(p["received_in"], dict):
        # Ensure adjustments exist
        p.setdefault("has_adjustment", bool(p.get("adjustments")))
        p.setdefault("adjustments", [])
        p.setdefault("fee_type", "other_fees")
        return p

    route = p.get("route", "cash")
    if route == "sub_agent":
        sa_type = p.get("sub_agent_type") or "sub_agent"
        p["received_in"] = {
            "type": sa_type,  # sub_agent / associate / km
            "name": p.get("sub_agent_name"),
            "account_id": p.get("account_id"),
        }
    elif route == "college":
        p["received_in"] = {"type": "college", "name": None, "account_id": p.get("account_id")}
    else:
        p["received_in"] = {"type": route or "cash", "name": None, "account_id": p.get("account_id")}
    p.setdefault("fee_type", "other_fees")
    p["has_adjustment"] = False
    p["adjustments"] = []
    return p


def _summarize(s: dict, user: Optional[dict] = None) -> dict:
    """Compute summary fields on a student doc (in-place).

    When ``user`` is provided and the caller is *not* super_admin, the
    confidential ``sc_from_college_override`` field is stripped so lower-
    privileged roles never see the college-side service-charge amount.
    """
    from lib.student_math import compute_summary

    s["payments"] = [_normalize_legacy_payment(p) for p in (s.get("payments") or [])]
    summary = compute_summary(s)

    # Persist computed total_fees back onto the nested fees_plan dict so the
    # frontend doesn't have to recompute it.
    fp = s.get("fees_plan") or {}
    if fp:
        fp["total_fees"] = summary["fees_plan_total"]
        s["fees_plan"] = fp

    # Surface the summary fields onto the student doc.
    for key in (
        "scheduled_total", "collected_total", "scholarship_amount",
        "sc_adjusted_total", "sc_earned_effective",
        "balance_vs_scheduled", "balance_vs_sc",
    ):
        s[key] = summary[key]

    # Mask super-admin-only fields from other roles.
    if user is not None and (user or {}).get("role") != "super_admin":
        s.pop("sc_from_college_override", None)
    return s


async def _resolve_referrer_by_name(name: Optional[str]) -> Optional[dict]:
    """Look up a staff / office_admin / super_admin whose name matches the
    given reference string. Used to auto-map the manual "Reference" text
    field on a student doc → ``referrer_user_id`` so referred students
    surface on the referrer's own dashboard even when the admin typed the
    name manually instead of using a `/apply?ref=<slug>` link.

    Match is case-insensitive with whitespace collapsed. Returns
    ``{"id": ..., "name": ...}`` or ``None`` when nothing matches / the
    input is empty.
    """
    if not name:
        return None
    cleaned = " ".join(str(name).split()).strip()
    if not cleaned:
        return None
    # Escape regex specials, then anchor with case-insensitive full match on
    # the normalized value. Whitespace inside the name is preserved.
    import re as _re
    pattern = f"^{_re.escape(cleaned)}$"
    hit = await db.users.find_one(
        {
            "name": {"$regex": pattern, "$options": "i"},
            "role": {"$in": ["staff", "office_admin", "super_admin"]},
        },
        {"_id": 0, "id": 1, "name": 1},
    )
    return hit


# Auto-generate schedule rows from a fees_plan. Returns list of {label, amount, year_key}.
_YEAR_FIELDS = [
    ("1st Year", "year_1"),
    ("2nd Year", "year_2"),
    ("3rd Year", "year_3"),
    ("4th Year", "year_4"),
]


def _fees_plan_rows(fees_plan: Optional[dict]) -> List[dict]:
    if not fees_plan:
        return []
    scholarship = 0.0
    if fees_plan.get("has_scholarship"):
        try:
            scholarship = max(0.0, float(fees_plan.get("scholarship_amount") or 0))
        except (TypeError, ValueError):
            scholarship = 0.0
    rows = []
    for label, key in _YEAR_FIELDS:
        amt = fees_plan.get(key)
        if amt is None:
            continue
        try:
            amt = float(amt)
        except (TypeError, ValueError):
            continue
        # Scholarship reduces only the 1st-year fees.
        if key == "year_1" and scholarship > 0:
            amt = max(0.0, amt - scholarship)
        if amt <= 0:
            continue
        rows.append({"label": label, "amount": round(amt, 2), "year_key": key})
    return rows


def _merge_fees_plan_schedules(
    existing: List[dict], fees_plan: Optional[dict], referenced_ids: set
) -> List[dict]:
    """Reconcile existing schedules with a (possibly updated) fees_plan.
    - Preserves manually-added schedules (source != 'fees_plan') untouched.
    - For each year amount > 0, upserts a fees_plan-sourced schedule by year_key.
    - For year_keys that drop to 0/None, deletes the schedule only if not referenced
      by any payment; otherwise zeroes its amount.
    """
    desired = {r["year_key"]: r for r in _fees_plan_rows(fees_plan)}
    scholarship_amt = 0.0
    if fees_plan and fees_plan.get("has_scholarship"):
        try:
            scholarship_amt = max(0.0, float(fees_plan.get("scholarship_amount") or 0))
        except (TypeError, ValueError):
            scholarship_amt = 0.0

    def _remarks_for(yk: str) -> str:
        if yk == "year_1" and scholarship_amt > 0:
            return f"Auto from fees plan · Scholarship reduced ({scholarship_amt:.0f})"
        return "Auto from fees plan"

    out: List[dict] = []
    seen_keys = set()
    for sc in existing or []:
        if sc.get("source") != "fees_plan":
            out.append(sc)
            continue
        yk = sc.get("year_key")
        if not yk:
            out.append(sc)
            continue
        if yk in desired:
            sc = {
                **sc,
                "label": desired[yk]["label"],
                "amount": desired[yk]["amount"],
                "remarks": _remarks_for(yk),
            }
            out.append(sc)
            seen_keys.add(yk)
        else:
            # year was zeroed/removed
            if sc.get("id") in referenced_ids:
                sc = {**sc, "amount": 0.0}
                out.append(sc)
                seen_keys.add(yk)
            # otherwise drop it
    # Add new fees_plan rows that didn't exist before
    for yk, row in desired.items():
        if yk in seen_keys:
            continue
        out.append({
            "id": gen_id(),
            "created_at": now_iso(),
            "label": row["label"],
            "amount": row["amount"],
            "remarks": _remarks_for(yk),
            "due_date": None,
            "source": "fees_plan",
            "year_key": yk,
        })
    return out


def _office_visibility_clause(user: dict) -> dict:
    """For office_admin, build a Mongo filter that matches records the admin
    is allowed to see: records owned by them OR records assigned to their
    office (home_office == user.office) OR records marked shared ("ALL")."""
    return {
        "$or": [
            {"user_id": user["id"]},
            {"home_office": user.get("office")},
            {"home_office": "ALL"},
        ]
    }


def _student_filter(student_id: str, user: dict) -> dict:
    """Compose the MongoDB filter so super_admin can find ANY student, while
    office_admin sees their own records + records scoped to their office /
    shared with ALL via home_office."""
    if user.get("role") == "super_admin":
        return {"id": student_id}
    return {
        "id": student_id,
        **_office_visibility_clause(user),
    }



async def _resolve_default_account_id(user_id: str) -> Optional[str]:
    """Pick a sensible default account when the payment has no explicit
    account_id (used by SC Adjusted entries and the cash-route fallback).
    Preference: first cash → first bank → first available account."""
    for acc_type in ("cash", "bank"):
        acc = await db.accounts.find_one(
            {"user_id": user_id, "type": acc_type}, {"_id": 0, "id": 1},
        )
        if acc:
            return acc["id"]
    any_acc = await db.accounts.find_one({"user_id": user_id}, {"_id": 0, "id": 1})
    return any_acc["id"] if any_acc else None


async def _auto_log_payment_transaction(user_id: str, student: dict, payment: dict) -> None:
    """Mirror of invoice auto-log: create an income transaction when the
    payment's received_in carries an account_id (or is plain cash routed to
    the user's first cash account). SC-Adjusted entries also auto-log on a
    default account so they show up on the books."""
    received = payment.get("received_in") or {}
    account_id = received.get("account_id")
    fee_type = payment.get("fee_type", "other_fees")

    if not account_id:
        if fee_type == "sc_adjusted":
            account_id = await _resolve_default_account_id(user_id)
        elif received.get("type") == "cash":
            account_id = await _resolve_default_account_id(user_id)

    # Clean up any prior linked tx for this payment id (idempotent)
    await db.transactions.delete_many({
        "user_id": user_id,
        "linked_student_payment_id": payment["id"],
    })

    # Resolve income category from fee_type label
    fee_label_map = {
        "application_fees": "Application Fees",
        "registration_fees": "Registration Fees",
        "admission_fees": "Admission Fees",
        "tuition_fees": "Tuition Fees",
        "uniform_fees": "Uniform Fees",
        "other_fees": "Other Fees",
        "sc_adjusted": "SC Adjusted",
        # legacy
        "booking_admission": "Admission Fees",
        "tution": "Tuition Fees",
        "other": "Other Fees",
    }
    cat_name = fee_label_map.get(fee_type, "Other Fees")
    cat = await db.categories.find_one(
        {"user_id": user_id, "type": "income", "name": cat_name},
        {"_id": 0, "id": 1},
    )

    # Main payment tx — only created when there's an account to credit
    if account_id:
        desc_bits = [
            f"Student fee — {student.get('name')}",
            cat_name,
        ]
        if fee_type == "sc_adjusted" and received.get("name"):
            desc_bits.append(f"SC absorbed by {received.get('name')}")
        if payment.get("remarks"):
            desc_bits.append(payment.get("remarks"))
        description = " · ".join([b for b in desc_bits if b])

        await db.transactions.insert_one({
            "id": gen_id(),
            "user_id": user_id,
            "created_at": now_iso(),
            "type": "income",
            "amount": round(payment.get("amount") or 0, 2),
            "account_id": account_id,
            "category_id": cat["id"] if cat else None,
            "date": payment.get("date"),
            "description": description,
            "linked_student_id": student.get("id"),
            "linked_student_payment_id": payment["id"],
        })

    # Also auto-log every internal_credit adjustment as its own income tx on
    # the picked KM-Foundation account. SC-adjusted rows are tracked by the
    # agent-ledger aggregation and intentionally do NOT create real money
    # transactions on the books.
    for idx, adj in enumerate(payment.get("adjustments") or []):
        if adj.get("kind") != "internal_credit":
            continue
        adj_account_id = adj.get("account_id")
        if not adj_account_id:
            continue
        await db.transactions.insert_one({
            "id": gen_id(),
            "user_id": user_id,
            "created_at": now_iso(),
            "type": "income",
            "amount": round(adj.get("amount") or 0, 2),
            "account_id": adj_account_id,
            "category_id": cat["id"] if cat else None,
            "date": adj.get("payment_date") or payment.get("date"),
            "description": " · ".join(filter(None, [
                f"Student fee — {student.get('name')}",
                "KM Foundation (adjustment)",
                adj.get("remarks") or "",
            ])),
            "linked_student_id": student.get("id"),
            "linked_student_payment_id": payment["id"],
            "linked_adjustment_idx": idx,
        })


async def _delete_payment_transaction(user_id: str, payment_id: str) -> None:
    await db.transactions.delete_many({
        "user_id": user_id,
        "linked_student_payment_id": payment_id,
    })


# ---------- Student CRUD ----------
@router.get("/me/referrals")
async def my_referred_students(user: dict = Depends(get_current_user)):
    """Students credited to the logged-in user via `referrer_user_id`
    (referral apply link OR a converted lead). Available to any authenticated
    user — staff use this for their dashboard. Returns lightweight rows."""
    items = await db.students.find(
        {"referrer_user_id": user["id"]},
        {"_id": 0, "id": 1, "name": 1, "course": 1, "college": 1, "status": 1,
         "created_at": 1, "reference": 1, "referrer_user_id": 1, "referrer_name": 1},
    ).sort("created_at", -1).to_list(2000)
    # For staff opening their own list, denormalize the referrer's own name
    # onto rows that predated the schema addition, so the "Referred by" chip
    # renders consistently everywhere.
    caller_name = user.get("name")
    for s in items:
        if not s.get("referrer_name") and s.get("referrer_user_id") == user["id"]:
            s["referrer_name"] = caller_name
    return items


class StaffQuickStudentIn(BaseModel):
    name: str = Field(..., min_length=1)
    course: Optional[str] = ""
    college: Optional[str] = ""
    status: Literal["inquiry", "enrolled", "cancelled", "completed"] = "inquiry"


@router.post("/me/quick-add", status_code=201)
async def staff_quick_add_student(payload: StaffQuickStudentIn, user: dict = Depends(get_current_user)):
    """Staff quick-add: enroll a student credited to the logged-in staff member.
    Owned by a super_admin (so it surfaces centrally) and scoped to the staff's
    office via home_office so the office admin sees it too."""
    if user.get("role") != "staff":
        raise HTTPException(403, "Only staff can use quick-add")
    admin = await db.users.find_one({"role": "super_admin"}, {"_id": 0, "id": 1})
    owner_id = (admin or {}).get("id") or user["id"]
    now = now_iso()
    doc = {
        "id": gen_id(),
        "user_id": owner_id,
        "created_at": now,
        "name": payload.name.strip(),
        "course": (payload.course or "").strip(),
        "college": (payload.college or "").strip(),
        "reference": user.get("name") or "",
        "referrer_user_id": user["id"],
        "referrer_name": user.get("name"),
        "sc_out_fixed": 0.0,
        "status": payload.status,
        "enrollment_date": now[:10],
        "notes": "Added by staff via quick-add",
        "fees_plan": None,
        "schedules": [],
        "payments": [],
        "application_source": "staff_quick_add",
        "home_office": user.get("office"),
    }
    await db.students.insert_one(doc)
    office_label = (user.get("office") or "").replace("KM_", "KM ")
    bits = [b for b in [doc["college"], doc["course"]] if b]
    await notify_super_admins(
        type="student_enrolled",
        title=f"New admission · {user.get('name', 'Staff')}",
        message=f"{doc['name']}{' · ' + ' · '.join(bits) if bits else ''}"
                f"{' · ' + office_label if office_label else ''}",
        link=f"/students/{doc['id']}",
        actor_user_id=user["id"],
        metadata={"student_id": doc["id"], "reference": doc["reference"]},
    )
    return {"ok": True, "student_id": doc["id"]}


@router.get("/me/referral-summary")
async def my_referral_summary(user: dict = Depends(get_current_user)):
    """Incentive-aware summary of the logged-in staff member's referred students.
    Mirrors the client-detail incentive math (3+ admissions/month → eligible)."""
    from lib.incentive_math import (
        compute_monthly_admission_counts,
        enrich_student_with_incentive,
        build_client_detail_totals,
    )
    raw = await db.students.find(
        {"referrer_user_id": user["id"]}, {"_id": 0}
    ).sort("created_at", -1).to_list(2000)

    staff_client = await db.clients.find_one(
        {"client_type": "staff", "login_user_id": user["id"]}, {"_id": 0}
    )
    if not staff_client and (user.get("name") or "").strip():
        staff_client = await db.clients.find_one(
            {"client_type": "staff",
             "$expr": {"$eq": [{"$toLower": "$name"}, user["name"].strip().lower()]}},
            {"_id": 0},
        )
    incentive_amount = float((staff_client or {}).get("eligible_incentive") or 0)

    month_counts = compute_monthly_admission_counts(raw)
    enriched = [
        enrich_student_with_incentive(
            s, is_staff=True, incentive_amount=incentive_amount, month_counts=month_counts
        )
        for s in raw
    ]
    enriched.sort(key=lambda x: x.get("enrollment_date") or "", reverse=True)
    totals = build_client_detail_totals(enriched, [], incentive_amount=incentive_amount)
    return {"students": enriched, "totals": totals, "incentive_amount": incentive_amount}


@router.get("/me/sc-earned")
async def my_sc_earned(user: dict = Depends(get_current_user)):
    """Total Service-Charge (SC) earned by the logged-in user when they are
    linked to a Client (sub-agent / associate consultant). Aggregates every
    `sc_adjusted` adjustment line across all student payments where
    `adjustment.client_id` matches the linked client.

    Returns:
        {
          "client_id":   <str | null>,
          "client_name": <str>,
          "total":       <float>,             // sum of all SC adjustments
          "count":       <int>,               // # of adjustment lines
          "by_student":  [                    // grouped breakdown
            {"student_id": str, "student_name": str, "course": str,
             "college": str, "total": float, "count": int}
          ]
        }

    Office/super admins also get a 200 with `total=0` so the same UI tile
    can render gracefully; only linked `user` accounts get real numbers.
    """
    linked_id = user.get("linked_client_id")
    linked_name = user.get("linked_client_name") or ""
    if not linked_id:
        return {"client_id": None, "client_name": "", "total": 0.0, "count": 0, "by_student": []}

    students = await db.students.find(
        {"payments.adjustments.client_id": linked_id},
        {"_id": 0, "id": 1, "name": 1, "course": 1, "college": 1, "payments": 1},
    ).to_list(2000)

    by_student: list[dict] = []
    grand_total = 0.0
    grand_count = 0
    for s in students:
        s_total = 0.0
        s_count = 0
        for p in s.get("payments") or []:
            for adj in p.get("adjustments") or []:
                if adj.get("client_id") == linked_id and adj.get("kind") == "sc_adjusted":
                    s_total += float(adj.get("amount") or 0)
                    s_count += 1
        if s_count > 0:
            by_student.append({
                "student_id": s.get("id"),
                "student_name": s.get("name"),
                "course": s.get("course"),
                "college": s.get("college"),
                "total": round(s_total, 2),
                "count": s_count,
            })
            grand_total += s_total
            grand_count += s_count

    by_student.sort(key=lambda r: r["total"], reverse=True)

    # ---- SC RECEIVED via invoices ----
    # Super-admin generates service_charge invoices to pay out the SC owed
    # to this sub-agent. Sum the totals of all such invoices so the linked
    # user can see how much has actually been invoiced/received vs earned.
    invoice_rows = await db.invoices.find(
        {"client_id": linked_id, "invoice_type": "service_charge"},
        {"_id": 0, "id": 1, "invoice_number": 1, "issue_date": 1, "total": 1, "status": 1},
    ).to_list(500)
    sc_received = round(sum(float(inv.get("total") or 0) for inv in invoice_rows), 2)

    return {
        "client_id": linked_id,
        "client_name": linked_name,
        "total": round(grand_total, 2),
        "count": grand_count,
        "by_student": by_student,
        # SC actually invoiced/received from the office to this sub-agent
        "sc_received": sc_received,
        "invoices_count": len(invoice_rows),
        "invoices": invoice_rows,
    }


@router.get("")
async def list_students(user: dict = Depends(get_current_user)):
    """Office admin sees own students. Super admin sees students from ALL users
    so admissions enrolled by office admins surface on the central Students page.
    Linked `user` accounts only see students that reference their client."""
    # Linked user (sub-agent / associate consultant logging in) — show students
    # whose `reference` matches the linked client's name (case-insensitive) OR
    # students this user themselves entered (created via the Add-student flow).
    if user.get("role") == "user" and user.get("linked_client_id"):
        client_name = (user.get("linked_client_name") or "").strip()
        if not client_name:
            return []
        items = await db.students.find(
            {
                "$or": [
                    {"$expr": {"$eq": [{"$toLower": "$reference"}, client_name.lower()]}},
                    {"user_id": user["id"]},
                ]
            },
            {"_id": 0},
        ).sort("created_at", -1).to_list(2000)
        return [_summarize(s, user) for s in items]

    if user.get("role") == "super_admin":
        items = await db.students.find({}, {"_id": 0}).sort("created_at", -1).to_list(2000)
        if items:
            user_ids = list({s.get("user_id") for s in items if s.get("user_id")})
            referrer_ids = list({s.get("referrer_user_id") for s in items if s.get("referrer_user_id")})
            all_ids = list(set(user_ids) | set(referrer_ids))
            users = await db.users.find(
                {"id": {"$in": all_ids}},
                {"_id": 0, "id": 1, "name": 1, "office": 1, "role": 1},
            ).to_list(500)
            umap = {u["id"]: u for u in users}
            out = []
            for s in items:
                summary = _summarize(s, user)
                u = umap.get(s.get("user_id"))
                if u and u.get("role") == "office_admin":
                    summary["_creator_name"] = u.get("name")
                    summary["_creator_office"] = u.get("office")
                # Denormalized referrer name (fills legacy rows on the fly).
                if s.get("referrer_user_id") and not s.get("referrer_name"):
                    ru = umap.get(s["referrer_user_id"])
                    if ru:
                        summary["referrer_name"] = ru.get("name")
                out.append(summary)
            return out
        return []
    items = await db.students.find(
        _office_visibility_clause(user), {"_id": 0}
    ).sort("created_at", -1).to_list(1000)
    # Populate referrer_name for legacy rows so the "Referred by" chip renders.
    referrer_ids = list({s.get("referrer_user_id") for s in items if s.get("referrer_user_id") and not s.get("referrer_name")})
    umap: dict = {}
    if referrer_ids:
        rus = await db.users.find(
            {"id": {"$in": referrer_ids}}, {"_id": 0, "id": 1, "name": 1}
        ).to_list(500)
        umap = {u["id"]: u.get("name") for u in rus}
    out = []
    for s in items:
        summary = _summarize(s, user)
        if s.get("referrer_user_id") and not s.get("referrer_name"):
            summary["referrer_name"] = umap.get(s["referrer_user_id"])
        out.append(summary)
    return out


@router.post("")
async def create_student(payload: StudentIn, user: dict = Depends(require_edit("students"))):
    data = payload.model_dump()
    # Office admin: force home_office to their own office so other office
    # admins in the same office (and super_admin) can see the record.
    if user.get("role") == "office_admin":
        data["home_office"] = user.get("office")
    # Guard the confidential college-side SC override: only super_admin can
    # set / read this field. Silently drop it for every other role.
    if user.get("role") != "super_admin":
        data.pop("sc_from_college_override", None)
    fees_plan = data.get("fees_plan")
    schedules = _merge_fees_plan_schedules([], fees_plan, set()) if fees_plan else []
    # Auto-map the manual "Reference" name → referrer_user_id so admin-added
    # students still surface on the referred staff/office admin's dashboard.
    ru = await _resolve_referrer_by_name(data.get("reference"))
    doc = {
        "id": gen_id(),
        "user_id": user["id"],
        "created_at": now_iso(),
        "schedules": schedules,
        "payments": [],
        "referrer_user_id": ru["id"] if ru else None,
        "referrer_name": ru["name"] if ru else None,
        **data,
    }
    await db.students.insert_one(doc)
    doc.pop("_id", None)
    # Notify super-admins when an office admin enrols a student
    if user.get("role") == "office_admin":
        office_label = (user.get("office") or "").replace("KM_", "KM ")
        bits = []
        if data.get("college"):
            bits.append(data["college"])
        if data.get("course"):
            bits.append(data["course"])
        if data.get("reference"):
            bits.append(f"ref: {data['reference']}")
        await notify_super_admins(
            type="student_enrolled",
            title=f"New admission · {user.get('name', 'Office admin')}",
            message=f"{data.get('name', 'Student')}"
                    f"{' · ' + ' · '.join(bits) if bits else ''}"
                    f"{' · ' + office_label if office_label else ''}",
            link=f"/students/{doc['id']}",
            actor_user_id=user["id"],
            metadata={"student_id": doc["id"], "reference": data.get("reference"), "college": data.get("college")},
        )
    return _summarize(doc, user)


_AGENT_TYPES = {"sub_agent", "associate", "km"}


def _new_ledger_bucket(kind: str, name: str) -> dict:
    return {
        "type": kind, "name": name,
        "total_received": 0.0, "paid_to_college": 0.0, "sc_adjusted": 0.0,
        "holding": 0.0, "payments_count": 0, "students": set(),
    }


def _finalise_ledger_row(row: dict) -> dict:
    """Round monetary totals, derive holding + students_count, expand the
    students set to a list so the row is JSON-serialisable."""
    row["holding"] = round(
        row["total_received"] - row["paid_to_college"] - row["sc_adjusted"], 2
    )
    row["total_received"] = round(row["total_received"], 2)
    row["paid_to_college"] = round(row["paid_to_college"], 2)
    row["sc_adjusted"] = round(row["sc_adjusted"], 2)
    row["students_count"] = len(row["students"])
    row["students"] = list(row["students"])
    return row


@router.get("/agent-ledger")
async def agent_ledger(user: dict = Depends(get_current_user)):
    """Aggregate payments routed through sub-agents / associates / KMs.

    Returns a row per (received_in.type, received_in.name) combo with totals."""
    scope = {} if user.get("role") == "super_admin" else _office_visibility_clause(user)
    students = await db.students.find(scope, {"_id": 0}).to_list(2000)
    ledger: dict[tuple, dict] = {}

    for st in students:
        payments = [_normalize_legacy_payment(p) for p in (st.get("payments") or [])]
        for p in payments:
            received = p.get("received_in") or {}
            r_type = received.get("type")
            if r_type in _AGENT_TYPES:
                name = (received.get("name") or "—").strip() or "—"
                key = (r_type, name)
                row = ledger.setdefault(key, _new_ledger_bucket(r_type, name))
                paid, sc = _split_adjustments(p)
                row["total_received"] += float(p.get("amount") or 0)
                row["paid_to_college"] += paid
                row["sc_adjusted"] += sc
                row["payments_count"] += 1
                row["students"].add(st["id"])
            # Also pick up SC-Adjusted adjustments on non-agent payments
            # (e.g. a College-Acc. payment with a "SUB AGENT" adjustment row).
            for adj in (p.get("adjustments") or []):
                if adj.get("kind") != "sc_adjusted":
                    continue
                adj_type = adj.get("sub_agent_type")
                adj_name = (adj.get("sub_agent_name") or "—").strip() or "—"
                if adj_type not in _AGENT_TYPES:
                    continue
                # Don't double-count when the parent payment is already
                # attributed to the same agent.
                if r_type == adj_type and (received.get("name") or "—").strip() == adj_name:
                    continue
                key = (adj_type, adj_name)
                row = ledger.setdefault(key, _new_ledger_bucket(adj_type, adj_name))
                row["sc_adjusted"] += float(adj.get("amount") or 0)
                row["students"].add(st["id"])

    out = [_finalise_ledger_row(row) for row in ledger.values()]
    out.sort(key=lambda r: r["total_received"], reverse=True)
    return out


def _payment_matches_agent(payment: dict, type_: str, name: str) -> bool:
    """True when the payment was routed through the (type, name) agent.
    Centralised so the agent_ledger + agent_payments handlers can share it."""
    r = payment.get("received_in") or {}
    if r.get("type") != type_:
        return False
    return (r.get("name") or "—").strip() == name


def _split_adjustments(payment: dict) -> tuple[float, float]:
    """Return ``(paid_total, sc_adjusted_total)`` for one payment.
    `paid_total` includes both legacy "paid_to_college" rows and the new
    "internal_credit" rows since both represent money that landed in a real
    account (i.e., not SC absorbed by a sub-agent)."""
    paid = 0.0
    sc = 0.0
    for a in (payment.get("adjustments") or []):
        amt = float(a.get("amount") or 0)
        kind = a.get("kind")
        if kind in ("paid_to_college", "internal_credit"):
            paid += amt
        elif kind == "sc_adjusted":
            sc += amt
    return paid, sc


def _agent_payment_row(
    student: dict, payment: dict, paid_to_college: float, sc_adjusted: float,
) -> dict:
    """Project a single payment into the flat row shape returned by /agent-ledger/payments."""
    sch = next(
        (sc for sc in (student.get("schedules") or []) if sc.get("id") == payment.get("schedule_id")),
        None,
    )
    return {
        "payment_id": payment["id"],
        "date": payment.get("date"),
        "amount": round(float(payment.get("amount") or 0), 2),
        "fee_type": payment.get("fee_type"),
        "schedule_label": sch["label"] if sch else None,
        "remarks": payment.get("remarks") or "",
        "has_adjustment": bool(payment.get("has_adjustment")),
        "adjustments": payment.get("adjustments") or [],
        "student_id": student["id"],
        "student_name": student.get("name"),
        "course": student.get("course"),
        "college": student.get("college"),
        "paid_to_college": round(paid_to_college, 2),
        "sc_adjusted": round(sc_adjusted, 2),
    }


@router.get("/agent-ledger/payments")
async def agent_payments(
    type: str,
    name: str,
    user: dict = Depends(get_current_user),
):
    """Flat list of every payment routed through a specific (type, name) agent.

    Each row includes the student context, the payment itself, and the
    breakdown of adjustments (paid_to_college / sc_adjusted)."""
    if type not in {"sub_agent", "associate", "km"}:
        raise HTTPException(400, "type must be one of sub_agent, associate, km")
    scope = {} if user.get("role") == "super_admin" else _office_visibility_clause(user)
    students = await db.students.find(scope, {"_id": 0}).to_list(2000)

    target = name.strip()
    rows: list[dict] = []
    student_ids: set[str] = set()
    total_received = paid_to_college_total = sc_adjusted_total = 0.0

    for st in students:
        payments = [_normalize_legacy_payment(p) for p in (st.get("payments") or [])]
        for p in payments:
            if not _payment_matches_agent(p, type, target):
                continue
            paid, sc = _split_adjustments(p)
            total_received += float(p.get("amount") or 0)
            paid_to_college_total += paid
            sc_adjusted_total += sc
            student_ids.add(st["id"])
            rows.append(_agent_payment_row(st, p, paid, sc))

    totals = {
        "total_received": round(total_received, 2),
        "paid_to_college": round(paid_to_college_total, 2),
        "sc_adjusted": round(sc_adjusted_total, 2),
        "holding": round(total_received - paid_to_college_total - sc_adjusted_total, 2),
        "payments_count": len(rows),
        "students_count": len(student_ids),
    }
    rows.sort(key=lambda r: r["date"] or "", reverse=True)
    return {"type": type, "name": target, "totals": totals, "payments": rows}


@router.get("/{student_id}")
async def get_student(student_id: str, user: dict = Depends(get_current_user)):
    s = await db.students.find_one(_student_filter(student_id, user), {"_id": 0})
    if not s:
        raise HTTPException(404, "Student not found")
    return _summarize(s, user)


@router.patch("/{student_id}")
async def update_student(student_id: str, payload: StudentIn, user: dict = Depends(require_edit("students"))):
    existing = await db.students.find_one(
        _student_filter(student_id, user), {"_id": 0}
    )
    if not existing:
        raise HTTPException(404, "Student not found")
    # Cache fields we need AFTER the update so the later branch that
    # overwrites `existing` to fetch home_office can't shadow them.
    prev_status = (existing.get("status") or "").lower()

    data = payload.model_dump()
    # Office admin can never re-scope a record outside their office.
    if user.get("role") == "office_admin":
        data["home_office"] = user.get("office")
    elif "home_office" not in payload.model_fields_set:
        # Super-admin partial PATCH that didn't send home_office — preserve
        # the existing scope so the record doesn't silently drop off the
        # office admin's dashboard.
        existing = await db.students.find_one(
            {"id": student_id}, {"_id": 0, "home_office": 1}
        )
        if existing is not None:
            data["home_office"] = existing.get("home_office")

    # Guard the confidential college-side SC override on writes: only
    # super_admin can set / clear this field. For lower roles we strip
    # the key entirely so the PATCH doesn't touch its current value.
    if user.get("role") != "super_admin":
        data.pop("sc_from_college_override", None)
    fees_plan = data.get("fees_plan")
    # Reconcile fees_plan rows with existing schedules. Preserve manual ones,
    # and don't drop fee_plan rows that already have payments linked.
    referenced_ids = {
        p.get("schedule_id") for p in (existing.get("payments") or []) if p.get("schedule_id")
    }
    new_schedules = _merge_fees_plan_schedules(
        existing.get("schedules") or [], fees_plan, referenced_ids
    )
    data["schedules"] = new_schedules

    # Re-map referrer whenever the reference name changes on update. This
    # keeps the "Referred by" chip + staff dashboard in sync when an admin
    # edits the reference field after enrollment. When the manual reference
    # field goes empty we DON'T auto-clear an existing referrer_user_id
    # (link may have been set via /apply?ref=<slug> — preserve it).
    if "reference" in payload.model_fields_set:
        new_ref = data.get("reference")
        if new_ref:
            ru = await _resolve_referrer_by_name(new_ref)
            if ru:
                data["referrer_user_id"] = ru["id"]
                data["referrer_name"] = ru["name"]

    await db.students.update_one(
        _student_filter(student_id, user),
        {"$set": data},
    )
    s = await db.students.find_one({"id": student_id}, {"_id": 0})

    # Notify the linked sub-agent/consultant when a super-admin flips the
    # status to "enrolled". The linked user is the one whose `linked_client_name`
    # matches the student's `reference` (case-insensitive).
    new_status = (s.get("status") or "").lower()
    if new_status == "enrolled" and prev_status != "enrolled":
        ref = (s.get("reference") or "").strip()
        if ref:
            linked = await db.users.find_one(
                {
                    "role": "user",
                    "$expr": {"$eq": [{"$toLower": "$linked_client_name"}, ref.lower()]},
                },
                {"_id": 0, "id": 1},
            )
            if linked:
                from routers.notifications import notify_users  # local import: avoid circular
                await notify_users(
                    [linked["id"]],
                    type="student_enrolled",
                    title="🎓 Your referral got enrolled",
                    message=f"{s.get('name')} has been confirmed as ENROLLED. Your SC will reflect once the super admin logs the adjustment.",
                    link=f"/students/{s.get('id')}",
                    metadata={"student_id": s.get("id"), "student_name": s.get("name"), "reference": ref},
                    actor_user_id=user["id"],
                )

    return _summarize(s, user)


@router.delete("/{student_id}")
async def delete_student(student_id: str, user: dict = Depends(require_edit("students"))):
    # Cascade delete any auto-logged income transactions linked to this student.
    res = await db.students.delete_one(_student_filter(student_id, user))
    if res.deleted_count == 0:
        raise HTTPException(404, "Student not found")
    await db.transactions.delete_many({"linked_student_id": student_id})
    return {"ok": True}


@router.post("/{student_id}/incentive/mark-paid")
async def mark_incentive_paid(student_id: str, user: dict = Depends(require_edit("students"))):
    """Mark the staff incentive earned on this admission as paid AND auto-create a
    salary-style `expense_request` for super-admin approval so the actual cash flows
    through the same approval pipeline as other office expenses. Idempotent."""
    s = await db.students.find_one(_student_filter(student_id, user), {"_id": 0})
    if not s:
        raise HTTPException(404, "Student not found")
    if s.get("incentive_paid"):
        return {"ok": True, "student_id": student_id, "incentive_paid": True,
                "expense_request_id": s.get("incentive_request_id")}

    # Look up the referring staff to read their eligible_incentive. Use the
    # record OWNER's clients so super_admin can mark-paid for an office admin's
    # student and still resolve the right staff member.
    ref = (s.get("reference") or "").strip().lower()
    owner_id = s.get("user_id") or user["id"]
    staff = None
    if ref:
        all_staff = await db.clients.find(
            {"user_id": owner_id, "client_type": "staff"}, {"_id": 0}
        ).to_list(500)
        staff = next((c for c in all_staff if (c.get("name") or "").strip().lower() == ref), None)
    amount = float((staff or {}).get("eligible_incentive") or 0)

    request_id = None
    if amount > 0 and user.get("role") == "office_admin":
        # Route the actual cash through super-admin approval
        first_acc = await db.accounts.find_one({"user_id": user["id"]}, {"_id": 0, "id": 1})
        request_id = gen_id()
        await db.expense_requests.insert_one({
            "id": request_id,
            "requested_by_user_id": user["id"],
            "requester_office": user.get("office"),
            "status": "pending",
            "created_at": now_iso(),
            "amount": amount,
            "account_id": (first_acc or {}).get("id"),
            "category_id": None,
            "date": datetime.now(timezone.utc).date().isoformat(),
            "description": f"Incentive payout · student {s.get('name', '')} (ref: {(staff or {}).get('name', '—')})",
            "urgency": "normal",
            "kind": "salary",
            "linked_student_id": student_id,
        })

    patch = {"incentive_paid": True, "incentive_paid_at": now_iso()}
    if request_id:
        patch["incentive_request_id"] = request_id
    await db.students.update_one(
        _student_filter(student_id, user),
        {"$set": patch},
    )
    return {
        "ok": True,
        "student_id": student_id,
        "incentive_paid": True,
        "expense_request_id": request_id,
        "amount": amount,
    }


@router.post("/{student_id}/incentive/unmark-paid")
async def unmark_incentive_paid(student_id: str, user: dict = Depends(require_edit("students"))):
    s = await db.students.find_one(_student_filter(student_id, user), {"_id": 0})
    if not s:
        raise HTTPException(404, "Student not found")
    # If a salary request was auto-created and is still pending, cancel it. The
    # request belongs to the student's OWNER (super_admin acting on an office
    # admin's record finds the office admin's pending request).
    req_id = s.get("incentive_request_id")
    if req_id:
        await db.expense_requests.delete_one(
            {"id": req_id, "requested_by_user_id": s.get("user_id"), "status": "pending"}
        )
    await db.students.update_one(
        _student_filter(student_id, user),
        {"$set": {"incentive_paid": False},
         "$unset": {"incentive_paid_at": "", "incentive_request_id": ""}},
    )
    return {"ok": True, "student_id": student_id, "incentive_paid": False}


# ---------- Schedules ----------
async def _load_student_or_404(student_id: str, user: dict) -> dict:
    """Load a student honouring the super_admin cross-user bypass.

    Super admin can load any student. Office admin is scoped to their own
    user_id. Raises 404 if the student doesn't exist or is out of scope.
    """
    s = await db.students.find_one(_student_filter(student_id, user), {"_id": 0})
    if not s:
        raise HTTPException(404, "Student not found")
    return s


@router.post("/{student_id}/schedules")
async def add_schedule(student_id: str, payload: ScheduleItemIn, user: dict = Depends(require_edit("students"))):
    await _load_student_or_404(student_id, user)
    item = {"id": gen_id(), "created_at": now_iso(), **payload.model_dump()}
    await db.students.update_one(
        _student_filter(student_id, user),
        {"$push": {"schedules": item}},
    )
    s = await db.students.find_one({"id": student_id}, {"_id": 0})
    return _summarize(s, user)


@router.patch("/{student_id}/schedules/{schedule_id}")
async def update_schedule(student_id: str, schedule_id: str, payload: ScheduleItemIn, user: dict = Depends(require_edit("students"))):
    filt = {**_student_filter(student_id, user), "schedules.id": schedule_id}
    res = await db.students.update_one(
        filt,
        {"$set": {f"schedules.$.{k}": v for k, v in payload.model_dump().items()}},
    )
    if res.matched_count == 0:
        raise HTTPException(404, "Schedule item not found")
    s = await db.students.find_one({"id": student_id}, {"_id": 0})
    return _summarize(s, user)


@router.delete("/{student_id}/schedules/{schedule_id}")
async def delete_schedule(student_id: str, schedule_id: str, user: dict = Depends(require_edit("students"))):
    res = await db.students.update_one(
        _student_filter(student_id, user),
        {"$pull": {"schedules": {"id": schedule_id}}},
    )
    if res.matched_count == 0:
        raise HTTPException(404, "Student not found")
    s = await db.students.find_one({"id": student_id}, {"_id": 0})
    return _summarize(s, user)


# ---------- Payments ----------
def _materialize_payment(payload: PaymentItemIn) -> dict:
    data = payload.model_dump()
    adjustments = data.get("adjustments") or []
    for adj in adjustments:
        if not adj.get("id"):
            adj["id"] = gen_id()
    data["adjustments"] = adjustments if data.get("has_adjustment") else []
    return data


@router.post("/{student_id}/payments")
async def add_payment(student_id: str, payload: PaymentItemIn, user: dict = Depends(require_edit("students"))):
    student = await _load_student_or_404(student_id, user)
    item = {"id": gen_id(), "created_at": now_iso(), **_materialize_payment(payload)}
    await db.students.update_one(
        _student_filter(student_id, user),
        {"$push": {"payments": item}},
    )
    # Auto-log income transaction on the RECORD OWNER's books (not the actor's).
    # This way, when super_admin posts a payment to an office_admin's student,
    # the cash lands on the office_admin's account/ledger.
    await _auto_log_payment_transaction(student["user_id"], student, item)
    s = await db.students.find_one({"id": student_id}, {"_id": 0})
    return _summarize(s, user)


@router.patch("/{student_id}/payments/{payment_id}")
async def update_payment(student_id: str, payment_id: str, payload: PaymentItemIn, user: dict = Depends(require_edit("students"))):
    data = _materialize_payment(payload)
    filt = {**_student_filter(student_id, user), "payments.id": payment_id}
    res = await db.students.update_one(
        filt,
        {"$set": {f"payments.$.{k}": v for k, v in data.items()}},
    )
    if res.matched_count == 0:
        raise HTTPException(404, "Payment not found")
    student = await db.students.find_one({"id": student_id}, {"_id": 0})
    # Re-fetch the freshly updated payment and re-sync transaction
    updated_payment = next((p for p in student.get("payments") or [] if p["id"] == payment_id), None)
    if updated_payment:
        await _auto_log_payment_transaction(student["user_id"], student, updated_payment)
    return _summarize(student, user)


@router.delete("/{student_id}/payments/{payment_id}")
async def delete_payment(student_id: str, payment_id: str, user: dict = Depends(require_edit("students"))):
    student = await _load_student_or_404(student_id, user)
    res = await db.students.update_one(
        _student_filter(student_id, user),
        {"$pull": {"payments": {"id": payment_id}}},
    )
    if res.matched_count == 0:
        raise HTTPException(404, "Student not found")
    # Cascade-clean the auto-logged transaction on the record OWNER's books.
    await _delete_payment_transaction(student["user_id"], payment_id)
    s = await db.students.find_one({"id": student_id}, {"_id": 0})
    return _summarize(s, user)
