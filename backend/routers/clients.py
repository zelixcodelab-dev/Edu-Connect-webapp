"""Client CRUD."""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from db import db
from auth_lib import get_current_user, gen_id, now_iso, require_edit
from models import ClientIn

router = APIRouter(prefix="/api/clients", tags=["clients"])


def _office_visibility_clause(user: dict) -> dict:
    """For office_admin, build a Mongo filter that matches records the admin
    is allowed to see: records owned by them OR scoped to their office
    (home_office) OR physically in their office (office field, e.g. staff) OR
    shared with ALL via home_office."""
    office = user.get("office")
    ors = [
        {"user_id": user["id"]},
        {"home_office": office},
        {"home_office": "ALL"},
    ]
    if office:
        ors.append({"office": office})
    return {"$or": ors}


@router.get("")
async def list_clients(user: dict = Depends(get_current_user)):
    """Office admin sees own clients PLUS clients scoped to their office (or
    shared with ALL) via home_office. Super admin sees clients from ALL users
    (so staff onboarded by office admins are visible too). Each returned doc
    gets a `_creator_name` / `_creator_office` for UI attribution.

    Also enriches staff-type rows with ``has_login`` + ``login_user_id`` so
    the Employees UI can show a "Create login" action inline (matching the
    Office Admin's Staff page). Not academic-year scoped."""
    if user.get("role") == "super_admin":
        docs = await db.clients.find({}, {"_id": 0}).sort("created_at", -1).to_list(2000)
        if docs:
            user_ids = list({d.get("user_id") for d in docs if d.get("user_id")})
            users = await db.users.find(
                {"id": {"$in": user_ids}},
                {"_id": 0, "id": 1, "name": 1, "office": 1, "role": 1},
            ).to_list(500)
            umap = {u["id"]: u for u in users}
            for d in docs:
                u = umap.get(d.get("user_id"))
                if u and u.get("role") == "office_admin":
                    d["_creator_name"] = u.get("name")
                    d["_creator_office"] = u.get("office")
        await _enrich_login_status(docs)
        return docs
    docs = await db.clients.find(
        _office_visibility_clause(user), {"_id": 0}
    ).sort("created_at", -1).to_list(1000)
    await _enrich_login_status(docs)
    return docs


async def _enrich_login_status(docs: list[dict]) -> None:
    """Mutates each staff row to add ``has_login`` (plus ``suspended`` /
    ``salary_hold`` read from the linked login account) — used by the
    Employees UI to render inline login + access controls."""
    login_ids = [
        d.get("login_user_id")
        for d in docs
        if d.get("client_type") == "staff" and d.get("login_user_id")
    ]
    umap: dict = {}
    if login_ids:
        us = await db.users.find(
            {"id": {"$in": login_ids}},
            {"_id": 0, "id": 1, "suspended": 1, "salary_hold": 1},
        ).to_list(5000)
        umap = {u["id"]: u for u in us}
    for d in docs:
        if d.get("client_type") == "staff":
            lu = umap.get(d.get("login_user_id"))
            d["has_login"] = bool(d.get("login_user_id"))
            d["suspended"] = bool((lu or {}).get("suspended"))
            d["salary_hold"] = bool((lu or {}).get("salary_hold"))


async def _next_employee_id(office: str | None) -> str:
    """Generate a unique employee id like EMP-BLR-001 scoped to an office."""
    code = (office or "GEN").replace("KM_", "")
    prefix = f"EMP-{code}-"
    existing = await db.clients.find(
        {"employee_id": {"$regex": f"^{prefix}"}}, {"_id": 0, "employee_id": 1}
    ).to_list(5000)
    max_seq = 0
    for d in existing:
        try:
            max_seq = max(max_seq, int(str(d["employee_id"]).rsplit("-", 1)[-1]))
        except (ValueError, IndexError):
            continue
    seq = max_seq + 1
    while await db.clients.find_one({"employee_id": f"{prefix}{seq:03d}"}):
        seq += 1
    return f"{prefix}{seq:03d}"


@router.post("")
async def create_client(payload: ClientIn, user: dict = Depends(require_edit("clients"))):
    data = payload.model_dump()
    if user.get("role") == "office_admin":
        data["home_office"] = user.get("office")
    # Auto-assign an employee id for staff when not provided.
    if data.get("client_type") == "staff" and not (data.get("employee_id") or "").strip():
        data["employee_id"] = await _next_employee_id(data.get("office"))
    doc = {"id": gen_id(), "user_id": user["id"], "created_at": now_iso(), **data}
    await db.clients.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.patch("/{client_id}")
async def update_client(client_id: str, payload: ClientIn, user: dict = Depends(require_edit("clients"))):
    data = payload.model_dump()
    if user.get("role") == "office_admin":
        data["home_office"] = user.get("office")
    elif "home_office" not in payload.model_fields_set:
        existing = await db.clients.find_one(
            {"id": client_id}, {"_id": 0, "home_office": 1}
        )
        if existing is not None:
            data["home_office"] = existing.get("home_office")
    # Backfill an employee id for staff if still missing.
    if data.get("client_type") == "staff" and not (data.get("employee_id") or "").strip():
        data["employee_id"] = await _next_employee_id(data.get("office"))
    res = await db.clients.update_one(
        _client_filter(client_id, user),
        {"$set": data},
    )
    if res.matched_count == 0:
        raise HTTPException(404, "Client not found")
    return await db.clients.find_one({"id": client_id}, {"_id": 0})


@router.delete("/{client_id}")
async def delete_client(client_id: str, user: dict = Depends(require_edit("clients"))):
    res = await db.clients.delete_one(_client_filter(client_id, user))
    if res.deleted_count == 0:
        raise HTTPException(404, "Client not found")
    return {"ok": True}



def _client_filter(client_id: str, user: dict) -> dict:
    if user.get("role") == "super_admin":
        return {"id": client_id}
    return {
        "id": client_id,
        **_office_visibility_clause(user),
    }


@router.get("/{client_id}/detail")
async def client_detail(client_id: str, user: dict = Depends(get_current_user)) -> dict:
    """Per-client summary: students they admitted, SC earned, transactions
    (income/expense), and — for staff only — incentive earned/paid/pending
    using the 3-admissions-per-month rule.

    Super admin can look up any client across users. Office admin scoped to own.
    """
    from lib.incentive_math import (
        filter_admissions_by_reference,
        compute_monthly_admission_counts,
        enrich_student_with_incentive,
        build_client_detail_totals,
    )

    client = await db.clients.find_one(_client_filter(client_id, user), {"_id": 0})
    if not client:
        raise HTTPException(404, "Client not found")

    owner_id = client["user_id"]
    is_staff = client.get("client_type") == "staff"
    incentive_amount = float(client.get("eligible_incentive") or 0)

    # Students whose `reference` matches this client.
    # Scope so that all admissions visible to the staff's office surface here
    # (an office-admin staff's referrals can be created by ANY admin of the
    # same office, including super_admin records with home_office matching).
    office_code = client.get("home_office") or client.get("office")
    if user.get("role") == "super_admin":
        # Super admin sees every student across the database.
        student_scope: dict = {}
    else:
        scope_or: list = [{"user_id": owner_id}]
        if office_code:
            scope_or.append({"home_office": office_code})
        scope_or.append({"home_office": "ALL"})
        student_scope = {"$or": scope_or}
    students_raw = await db.students.find(student_scope, {"_id": 0}).to_list(2000)
    matched = filter_admissions_by_reference(students_raw, client.get("name"))
    month_counts = compute_monthly_admission_counts(matched)

    enriched_students = [
        enrich_student_with_incentive(
            s,
            is_staff=is_staff,
            incentive_amount=incentive_amount,
            month_counts=month_counts,
        )
        for s in matched
    ]
    enriched_students.sort(key=lambda x: x.get("enrollment_date") or "", reverse=True)

    # Per-student service-charge clearance: a student's SC is "Cleared" once a
    # service_charge invoice naming that student exists against this client.
    sc_invoices = await db.invoices.find(
        {"client_id": client_id, "invoice_type": "service_charge"},
        {"_id": 0, "student_name": 1},
    ).to_list(2000)
    sc_cleared_names = {
        (inv.get("student_name") or "").strip().lower()
        for inv in sc_invoices
        if (inv.get("student_name") or "").strip()
    }
    for s in enriched_students:
        st = (s.get("status") or "").lower()
        if st == "cancelled":
            s["sc_status"] = "not_earned"
        elif (s.get("name") or "").strip().lower() in sc_cleared_names:
            s["sc_status"] = "cleared"
        else:
            s["sc_status"] = "pending"

    if user.get("role") == "super_admin":
        tx_query: dict = {"client_id": client_id}
    else:
        # Same office-scoping logic for tx linked to this client.
        owner_ids = {owner_id}
        if office_code:
            office_admins = await db.users.find(
                {"role": "office_admin", "office": office_code},
                {"_id": 0, "id": 1},
            ).to_list(100)
            owner_ids.update(u["id"] for u in office_admins)
        tx_query = {"user_id": {"$in": list(owner_ids)}, "client_id": client_id}
    txs = await db.transactions.find(
        tx_query, {"_id": 0}
    ).sort("date", -1).to_list(500)

    # SC the client EARNED as a sub-agent / associate: surfaced from student
    # payment adjustments (kind=sc_adjusted) that reference this client. These
    # are synthetic *credit* rows in the money trail — NOT real DB transactions
    # — so they never pollute account balances or the main Transactions page.
    if not is_staff:
        sc_students = await db.students.find(
            {"payments.adjustments.client_id": client_id},
            {"_id": 0, "id": 1, "name": 1, "payments": 1},
        ).to_list(2000)
        sc_rows = []
        for st in sc_students:
            for p in (st.get("payments") or []):
                for idx, a in enumerate(p.get("adjustments") or []):
                    if a.get("client_id") == client_id and a.get("kind") == "sc_adjusted":
                        sc_rows.append({
                            "id": f"sc-{st['id']}-{p.get('id')}-{idx}",
                            "date": a.get("payment_date") or p.get("date"),
                            "description": f"SC earned — {st.get('name')}",
                            "type": "income",
                            "amount": round(float(a.get("amount") or 0), 2),
                            "is_sc_earned": True,
                            "sc_given": bool(a.get("sc_given")),
                            "_sc_student_id": st["id"],
                            "_sc_payment_id": p.get("id"),
                            "_sc_adj_idx": idx,
                            "_sc_student_name": st.get("name"),
                        })
        if sc_rows:
            txs = txs + sc_rows
            txs.sort(key=lambda t: t.get("date") or "", reverse=True)

    # Best-effort: resolve a matching staff LOGIN user (role="staff") for this
    # employee record so the UI can surface / edit their leave quota. Matched
    # by exact (case-insensitive) name within the same office.
    staff_login_user = None
    if is_staff and (client.get("name") or "").strip():
        import re
        from routers.leave import _effective_quota
        nm = re.escape(client["name"].strip())
        match_q: dict = {
            "role": "staff",
            "name": {"$regex": f"^{nm}$", "$options": "i"},
        }
        office = client.get("office")
        if office:
            match_q["office"] = office
        lu = await db.users.find_one(
            match_q, {"_id": 0, "id": 1, "name": 1, "office": 1, "leave_quota": 1}
        )
        if lu:
            staff_login_user = {
                "id": lu["id"],
                "name": lu.get("name"),
                "office": lu.get("office"),
                "leave_quota": await _effective_quota(lu),
                "has_override": isinstance(lu.get("leave_quota"), dict),
            }

    return {
        "client": client,
        "is_staff": is_staff,
        "staff_login_user": staff_login_user,
        "students": enriched_students,
        "transactions": txs,
        "totals": build_client_detail_totals(
            enriched_students, txs, incentive_amount=incentive_amount
        ),
    }


class ScPayoutIn(BaseModel):
    student_id: str
    payment_id: str
    adjustment_idx: int
    amount: float
    account_id: str
    payment_mode: str = "bank_transfer"
    date: Optional[str] = None


@router.post("/{client_id}/sc-payout")
async def pay_sc_now(
    client_id: str,
    payload: ScPayoutIn,
    user: dict = Depends(require_edit("transactions")),
):
    """One-click SC payout: pay the SC a sub-agent/associate earned on a specific
    student fee adjustment. Marks that adjustment `sc_given=True` and logs a real
    SC-payout expense transaction (reduces the agent's holding, shows as a debit
    in their money trail)."""
    client = await db.clients.find_one(_client_filter(client_id, user), {"_id": 0})
    if not client:
        raise HTTPException(404, "Client not found")

    st_filter = {"id": payload.student_id}
    if user.get("role") != "super_admin":
        st_filter.update(_office_visibility_clause(user))
    student = await db.students.find_one(st_filter, {"_id": 0})
    if not student:
        raise HTTPException(404, "Student not found")

    payment = next((p for p in (student.get("payments") or []) if p.get("id") == payload.payment_id), None)
    if not payment:
        raise HTTPException(404, "Payment not found")
    adjustments = payment.get("adjustments") or []
    if not (0 <= payload.adjustment_idx < len(adjustments)):
        raise HTTPException(404, "Adjustment not found")
    adj = adjustments[payload.adjustment_idx]
    if adj.get("kind") != "sc_adjusted" or adj.get("client_id") != client_id:
        raise HTTPException(400, "Adjustment does not match this client")

    await db.students.update_one(
        {"id": payload.student_id, "payments.id": payload.payment_id},
        {"$set": {f"payments.$.adjustments.{payload.adjustment_idx}.sc_given": True}},
    )

    doc = {
        "id": gen_id(),
        "user_id": user["id"],
        "created_at": now_iso(),
        "type": "expense",
        "amount": round(float(payload.amount), 2),
        "account_id": payload.account_id,
        "category_id": None,
        "date": payload.date or now_iso()[:10],
        "description": f"SC payout — {student.get('name')} · to {client.get('name')}",
        "client_id": client_id,
        "is_sc_payout": True,
        "payment_mode": payload.payment_mode,
        "student_name": student.get("name"),
    }
    await db.transactions.insert_one(doc)
    doc.pop("_id", None)
    return {"ok": True, "transaction": doc}
