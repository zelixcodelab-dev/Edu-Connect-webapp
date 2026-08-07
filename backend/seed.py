"""Seeding: the platform owner (reseller) + a default demo company.

Multi-tenant model:
  * ``gdb.platform_owners`` holds the reseller account that manages all
    companies from the Platform Console.
  * Each company (tenant) lives in its own database, provisioned via
    ``lib.whitelabel.provision_tenant``.
"""
import os

from db import db, gdb, set_default_tenant
from auth_lib import hash_password, gen_id, now_iso
from lib.whitelabel import (
    DEFAULT_CATEGORIES, provision_tenant, DEFAULT_APP_NAME,
)


async def seed_user_defaults(user_id: str) -> None:
    """Seed the default category catalogue + a Main Bank account for a user
    inside the CURRENT tenant context."""
    cats = [
        {"id": gen_id(), "user_id": user_id, "created_at": now_iso(), **c}
        for c in DEFAULT_CATEGORIES
    ]
    await db.categories.insert_many(cats)
    await db.accounts.insert_one({
        "id": gen_id(),
        "user_id": user_id,
        "name": "Main Bank",
        "type": "bank",
        "opening_balance": 0.0,
        "color": "#10b981",
        "created_at": now_iso(),
    })


async def seed_platform_and_default_tenant() -> None:
    """Idempotent boot seed. Ensures the platform owner exists and at least
    one company (the default workspace) is provisioned so the app is usable
    out of the box. Also binds the default tenant for context-less requests."""
    # 1) Platform owner (the reseller who sells the app to companies).
    owner_email = (
        os.environ.get("PLATFORM_OWNER_EMAIL")
        or os.environ.get("ADMIN_EMAIL")
        or "owner@educonnect.app"
    ).lower()
    owner_pw = (
        os.environ.get("PLATFORM_OWNER_PASSWORD")
        or os.environ.get("ADMIN_PASSWORD")
        or "Owner@12345"
    )
    if not await gdb.platform_owners.find_one({"email": owner_email}):
        await gdb.platform_owners.insert_one({
            "id": gen_id(),
            "email": owner_email,
            "name": "Platform Owner",
            "password_hash": hash_password(owner_pw),
            "role": "platform_owner",
            "created_at": now_iso(),
        })

    # 2) Default company — provisioned once. If any company already exists we
    #    just bind the first as the fallback/default tenant.
    existing = await gdb.tenants.find_one({}, sort=[("created_at", 1)])
    if existing:
        set_default_tenant(existing["id"])
        return

    demo_admin_email = (os.environ.get("DEMO_ADMIN_EMAIL") or "admin@educonnect.app").lower()
    demo_admin_pw = os.environ.get("DEMO_ADMIN_PASSWORD") or "Admin@12345"
    doc = await provision_tenant(
        name=DEFAULT_APP_NAME,
        admin_email=demo_admin_email,
        admin_password=demo_admin_pw,
        admin_name="Workspace Admin",
    )
    set_default_tenant(doc["id"])
