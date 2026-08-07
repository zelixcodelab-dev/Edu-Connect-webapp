"""Invoice CRUD with auto-linked expense transactions + open-credit lookups."""
import logging
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException
from pymongo.errors import OperationFailure

from db import client, db
from auth_lib import get_current_user, gen_id, now_iso
from models import InvoiceIn
from routers.notifications import notify_users

router = APIRouter(prefix="/api/invoices", tags=["invoices"])
log = logging.getLogger(__name__)


# Map preset particular descriptions to default category names
PARTICULAR_TO_CATEGORY = {
    "car rent": "Cab Exp",
    "fuel expense": "Fuel Exp",
    "cab expense": "Cab Exp",
    "toll": "Toll",
    "food": "Food",
    "driver salary": "Salaries",
}


def _compute_totals(items: List[dict], tax_rate: float, credit_amount: float = 0.0, previous_payment: float = 0.0) -> dict:
    subtotal = sum(it["quantity"] * it["unit_price"] for it in items)
    tax_amount = round(subtotal * (tax_rate / 100.0), 2)
    total = round(subtotal + tax_amount - (credit_amount or 0.0) - (previous_payment or 0.0), 2)
    return {"subtotal": round(subtotal, 2), "tax_amount": tax_amount, "total": total}


async def _sync_invoice_sc_payment_transaction(user_id: str, invoice: dict) -> None:
    """For a service_charge invoice with a previous_sc_payment, mirror it as
    an income transaction. Idempotent: prior linked tx is removed first."""
    invoice_id = invoice["id"]
    # Always clear any prior SC-payment tx
    await db.transactions.delete_many({
        "user_id": user_id,
        "linked_sc_payment_invoice_id": invoice_id,
    })

    if invoice.get("invoice_type") != "service_charge":
        return
    psp = invoice.get("previous_sc_payment") or {}
    if not psp.get("has"):
        return
    amount = float(psp.get("amount") or 0)
    if amount <= 0:
        return

    account_id = psp.get("account_id")
    if not account_id:
        # Default to first account
        first_account = await db.accounts.find_one({"user_id": user_id}, {"_id": 0})
        if not first_account:
            return
        account_id = first_account["id"]

    cat = await db.categories.find_one(
        {"user_id": user_id, "type": "income"}, {"_id": 0, "id": 1}
    )
    await db.transactions.insert_one({
        "id": gen_id(),
        "user_id": user_id,
        "created_at": now_iso(),
        "type": "income",
        "amount": round(amount, 2),
        "account_id": account_id,
        "category_id": cat["id"] if cat else None,
        "date": psp.get("date") or invoice.get("issue_date"),
        "description": f"Prior SC payment · Invoice {invoice.get('invoice_number')}",
        "client_id": invoice.get("client_id"),
        "linked_sc_payment_invoice_id": invoice_id,
    })


def _resolve_expense_category(description: str, by_name: dict[str, str]) -> Optional[str]:
    """Map a particular's description → expense-category id. Tries direct name,
    then the PARTICULAR_TO_CATEGORY alias map, falling back to "Other"."""
    d = (description or "").strip().lower()
    if d.startswith("other:") or d == "other":
        return by_name.get("other")
    if d in by_name:
        return by_name[d]
    mapped = PARTICULAR_TO_CATEGORY.get(d)
    if mapped:
        return by_name.get(mapped.lower())
    return None


def _build_expense_tx(item: dict, *, user_id: str, invoice: dict, account_id: str, category_id: Optional[str]) -> Optional[dict]:
    """Construct the expense-transaction doc for one invoice line. Returns
    None when the amount is zero/negative (nothing to log)."""
    amount = (item.get("quantity") or 1) * (item.get("unit_price") or 0)
    if amount <= 0:
        return None
    desc = item.get("description") or "Expense"
    return {
        "id": gen_id(),
        "user_id": user_id,
        "created_at": now_iso(),
        "type": "expense",
        "amount": round(amount, 2),
        "account_id": account_id,
        "category_id": category_id,
        "date": invoice.get("issue_date"),
        "description": f"{desc} · Invoice {invoice.get('invoice_number')}",
        "client_id": invoice.get("client_id"),
        "linked_invoice_id": invoice["id"],
    }


async def _build_invoice_expense_docs(user_id: str, invoice: dict) -> List[dict]:
    """Return the full list of expense-tx docs that should exist for an
    auto-logged invoice. Empty when auto_log is off or items are absent.

    Pulls the user's default expense account and resolves each line's category
    via the cached category-by-name map.
    """
    if not invoice.get("auto_log_expenses", True):
        return []
    items = invoice.get("items") or []
    if not items:
        return []
    account_id = invoice.get("expense_account_id")
    if not account_id:
        first_account = await db.accounts.find_one({"user_id": user_id}, {"_id": 0})
        if not first_account:
            return []
        account_id = first_account["id"]

    cats = await db.categories.find(
        {"user_id": user_id, "type": "expense"}, {"_id": 0}
    ).to_list(500)
    by_name = {c["name"].lower(): c["id"] for c in cats}

    docs: List[dict] = []
    for it in items:
        doc = _build_expense_tx(
            it,
            user_id=user_id,
            invoice=invoice,
            account_id=account_id,
            category_id=_resolve_expense_category(it.get("description"), by_name),
        )
        if doc:
            docs.append(doc)
    return docs


async def _sync_invoice_expense_transactions(user_id: str, invoice: dict) -> None:
    """Delete prior linked expense transactions and re-create them per particulars.
    Uses a Mongo session/transaction when supported (replica set); falls back to a
    best-effort delete-then-insert on standalone MongoDB."""
    invoice_id = invoice["id"]
    new_docs = await _build_invoice_expense_docs(user_id, invoice)

    try:
        async with await client.start_session() as session:
            async with session.start_transaction():
                await db.transactions.delete_many(
                    {"user_id": user_id, "linked_invoice_id": invoice_id},
                    session=session,
                )
                if new_docs:
                    await db.transactions.insert_many(new_docs, session=session)
    except OperationFailure as e:
        # MongoDB without replica set rejects transactions — degrade gracefully.
        log.warning("Transaction unsupported, syncing non-atomically: %s", e)
        await db.transactions.delete_many(
            {"user_id": user_id, "linked_invoice_id": invoice_id}
        )
        if new_docs:
            await db.transactions.insert_many(new_docs)


async def _notify_linked_user_of_invoice(invoice: dict, actor: dict) -> None:
    """If the invoice's ``client_id`` matches a "user" role account's
    ``linked_client_id`` AND the actor is a super_admin, fire an in-app
    notification + push so the sub-agent sees the new invoice on their
    dashboard. No-op when client_id is missing or no linked user exists."""
    cid = invoice.get("client_id")
    if not cid or actor.get("role") != "super_admin":
        return
    linked = await db.users.find_one(
        {"role": "user", "linked_client_id": cid, "approval_status": "approved"},
        {"_id": 0, "id": 1},
    )
    if not linked:
        return
    inv_type = invoice.get("invoice_type") or "invoice"
    type_label = "Service Charge" if inv_type == "service_charge" else "Invoice"
    total = float(invoice.get("total") or 0)
    inv_no = invoice.get("invoice_number") or invoice.get("id")
    await notify_users(
        [linked["id"]],
        type="linked_invoice",
        title=f"💼 New {type_label} invoice · #{inv_no}",
        message=f"Office has issued you a {type_label.lower()} invoice of ₹{total:,.0f}. Tap to view ledger.",
        link="/my-ledger",
        metadata={"invoice_id": invoice.get("id"), "amount": total, "invoice_type": inv_type},
        actor_user_id=actor.get("id"),
    )


@router.get("/open-credits")
async def open_credits(
    user: dict = Depends(get_current_user),
    client_id: Optional[str] = None,
):
    """Return campus-visit invoices with their pending balance.

    pending_amount = invoice.total minus the sum of credit_amount on
    service-charge invoices that linked back to this campus visit.
    """
    user_id = user["id"]
    q = {
        "user_id": user_id,
        "$or": [
            {"invoice_type": "campus_visit"},
            {"invoice_type": {"$exists": False}},
        ],
    }
    if client_id:
        q["client_id"] = client_id
    visits = await db.invoices.find(q, {"_id": 0}).sort("issue_date", -1).to_list(500)

    # Aggregate credit already drawn against each visit by service-charge invoices.
    used_pipeline = [
        {"$match": {
            "user_id": user_id,
            "invoice_type": "service_charge",
            "linked_visit_invoice_id": {"$ne": None},
        }},
        {"$group": {"_id": "$linked_visit_invoice_id", "used": {"$sum": "$credit_amount"}}},
    ]
    used = {row["_id"]: round(row["used"], 2)
            async for row in db.invoices.aggregate(used_pipeline)}

    out = []
    for v in visits:
        total = v.get("total", 0) or 0
        drawn = used.get(v["id"], 0)
        remaining = round(total - drawn, 2)
        out.append({
            "id": v["id"],
            "invoice_number": v.get("invoice_number"),
            "issue_date": v.get("issue_date"),
            "client_id": v.get("client_id"),
            "student_name": v.get("student_name"),
            "campus_visit_no": v.get("campus_visit_no"),
            "total": round(total, 2),
            "used_credit": drawn,
            "remaining_credit": remaining,
        })
    return out


@router.get("")
async def list_invoices(user: dict = Depends(get_current_user)):
    return await db.invoices.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(500)


@router.post("")
async def create_invoice(payload: InvoiceIn, user: dict = Depends(get_current_user)):
    items = [i.model_dump() for i in payload.items]
    psp = payload.previous_sc_payment.model_dump() if payload.previous_sc_payment else None
    prev_amt = psp["amount"] if (psp and psp.get("has")) else 0.0
    totals = _compute_totals(items, payload.tax_rate, payload.credit_amount, prev_amt)
    doc = {
        "id": gen_id(),
        "user_id": user["id"],
        "created_at": now_iso(),
        **payload.model_dump(),
        **totals,
    }
    await db.invoices.insert_one(doc)
    doc.pop("_id", None)
    await _sync_invoice_expense_transactions(user["id"], doc)
    await _sync_invoice_sc_payment_transaction(user["id"], doc)
    await _notify_linked_user_of_invoice(doc, user)
    return doc


@router.patch("/{invoice_id}")
async def update_invoice(invoice_id: str, payload: InvoiceIn, user: dict = Depends(get_current_user)):
    items = [i.model_dump() for i in payload.items]
    psp = payload.previous_sc_payment.model_dump() if payload.previous_sc_payment else None
    prev_amt = psp["amount"] if (psp and psp.get("has")) else 0.0
    totals = _compute_totals(items, payload.tax_rate, payload.credit_amount, prev_amt)
    update = {**payload.model_dump(), **totals}
    res = await db.invoices.update_one(
        {"id": invoice_id, "user_id": user["id"]},
        {"$set": update},
    )
    if res.matched_count == 0:
        raise HTTPException(404, "Invoice not found")
    fresh = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
    await _sync_invoice_expense_transactions(user["id"], fresh)
    await _sync_invoice_sc_payment_transaction(user["id"], fresh)
    return fresh


@router.patch("/{invoice_id}/status")
async def set_invoice_status(invoice_id: str, body: dict, user: dict = Depends(get_current_user)):
    status = body.get("status")
    if status not in {"draft", "sent", "paid", "overdue"}:
        raise HTTPException(400, "Invalid status")
    res = await db.invoices.update_one(
        {"id": invoice_id, "user_id": user["id"]},
        {"$set": {"status": status}},
    )
    if res.matched_count == 0:
        raise HTTPException(404, "Invoice not found")
    return await db.invoices.find_one({"id": invoice_id}, {"_id": 0})


@router.delete("/{invoice_id}")
async def delete_invoice(invoice_id: str, user: dict = Depends(get_current_user)):
    res = await db.invoices.delete_one({"id": invoice_id, "user_id": user["id"]})
    if res.deleted_count == 0:
        raise HTTPException(404, "Invoice not found")
    await db.transactions.delete_many(
        {"user_id": user["id"], "linked_invoice_id": invoice_id}
    )
    await db.transactions.delete_many(
        {"user_id": user["id"], "linked_sc_payment_invoice_id": invoice_id}
    )
    return {"ok": True}


@router.get("/{invoice_id}/payments")
def _previous_sc_payment_row(invoice: dict) -> tuple[dict | None, float, str | None]:
    """Materialise the 'Previous payment towards SC' row from the invoice itself.
    Returns ``(row_or_none, amount, date)`` — amount + date are returned so the
    caller can deduplicate the auto-mirrored income transaction."""
    psp = invoice.get("previous_sc_payment") or {}
    if not psp.get("has"):
        return None, 0.0, None
    try:
        amount = float(psp.get("amount") or 0)
    except (TypeError, ValueError):
        amount = 0.0
    date = psp.get("date") or invoice.get("issue_date")
    if amount <= 0:
        return None, 0.0, date
    row = {
        "date": date,
        "mode": psp.get("mode") or "bank_transfer",
        "amount": round(amount, 2),
        "label": "Previous payment towards SC",
        "source": "previous_sc_payment",
    }
    return row, amount, date


def _is_mirrored_psp_tx(tx: dict, invoice_id: str, psp_amount: float, psp_date: str | None) -> bool:
    """True when this income tx is the auto-mirrored copy of the invoice's
    previous_sc_payment (so we don't double-count it in the PDF timeline)."""
    return bool(
        tx.get("linked_sc_payment_invoice_id") == invoice_id
        and abs(round(float(tx.get("amount") or 0), 2) - round(psp_amount, 2)) < 0.01
        and tx.get("date") == psp_date
    )


async def invoice_payments(invoice_id: str, user: dict = Depends(get_current_user)):
    """Return all payments received against an invoice — for the PDF payments
    timeline. Combines `previous_sc_payment` (SC invoices) with any auto-logged
    income transactions linked to the invoice.
    """
    inv = await db.invoices.find_one(
        {"id": invoice_id, "user_id": user["id"]}, {"_id": 0}
    )
    if not inv:
        raise HTTPException(404, "Invoice not found")

    payments: list[dict] = []
    psp_row, psp_amount, psp_date = _previous_sc_payment_row(inv)
    if psp_row:
        payments.append(psp_row)

    income_txs = await db.transactions.find(
        {
            "user_id": user["id"],
            "type": "income",
            "$or": [
                {"linked_sc_payment_invoice_id": invoice_id},
                {"linked_invoice_id": invoice_id},
            ],
        },
        {"_id": 0},
    ).sort("date", 1).to_list(200)

    for tx in income_txs:
        if _is_mirrored_psp_tx(tx, invoice_id, psp_amount, psp_date):
            continue
        payments.append({
            "date": tx.get("date"),
            "mode": "bank_transfer",  # mode isn't stored on tx; safe default
            "amount": round(float(tx.get("amount") or 0), 2),
            "label": tx.get("description") or "Payment received",
            "source": "transaction",
        })

    payments.sort(key=lambda p: str(p.get("date") or ""))
    total_paid = round(sum(p["amount"] for p in payments), 2)
    return {
        "payments": payments,
        "total_paid": total_paid,
        "balance_due": round(float(inv.get("total") or 0), 2),
    }

