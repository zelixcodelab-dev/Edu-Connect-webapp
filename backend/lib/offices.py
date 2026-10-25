"""Per-company offices (branches). Stored on the tenant registry row as
``offices: [{code, name, active}]``. Only active offices are visible to the
company; the platform owner adds/enables offices (clients request more)."""
from __future__ import annotations

import re
from typing import List

from fastapi import HTTPException

from db import gdb, _current_tenant

LEGACY_CODES = ["KM_BLR", "KM_TCR", "KM_KMLY"]
LEGACY_NAMES = {"KM_TCR": "KM TCR", "KM_KMLY": "KM KMLY"}


def _tid() -> str | None:
    import db as _db
    return _current_tenant.get() or _db._DEFAULT_TENANT_ID


def default_offices(company: str, names: List[str] | None = None) -> list:
    names = [n.strip() for n in (names or []) if n and n.strip()] or [company]
    return [{"code": "HQ" if i == 0 else new_code(n, i), "name": n[:60], "active": True} for i, n in enumerate(names)]


def new_code(name: str, i: int = 0) -> str:
    base = re.sub(r"[^A-Z0-9]+", "_", (name or "").upper()).strip("_")[:16] or "OFFICE"
    return f"{base}_{i}" if i else base


def active_offices(doc: dict) -> list:
    return [{"code": o["code"], "name": o.get("name") or o["code"]} for o in (doc.get("offices") or []) if o.get("active", True)]


async def tenant_office_codes() -> list:
    t = await gdb.tenants.find_one({"id": _tid()}, {"_id": 0, "offices": 1}) or {}
    return [o["code"] for o in active_offices(t)]


async def require_office(code: str | None, allow_all: bool = False) -> None:
    if code is None or (allow_all and code == "ALL"):
        return
    if code not in await tenant_office_codes():
        raise HTTPException(400, f"Unknown office '{code}'")


async def ensure_offices_backfill(company_has_legacy) -> None:
    """Give every company without an offices list its first office. Companies
    with legacy KM data keep KM_BLR active and the other two hidden."""
    async for t in gdb.tenants.find({"offices": {"$exists": False}}, {"_id": 0, "id": 1, "name": 1}):
        if await company_has_legacy(t["id"]):
            offices = [{"code": "KM_BLR", "name": t["name"], "active": True}] + [
                {"code": c, "name": LEGACY_NAMES[c], "active": False} for c in ("KM_TCR", "KM_KMLY")
            ]
        else:
            offices = default_offices(t["name"])
        await gdb.tenants.update_one({"id": t["id"]}, {"$set": {"offices": offices}})
