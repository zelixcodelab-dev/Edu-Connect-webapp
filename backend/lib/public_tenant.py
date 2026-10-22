"""Bind the company behind a public application link (``X-Tenant-Slug``)."""
from typing import Optional

from fastapi import Header, HTTPException

from db import gdb, set_current_tenant

RESERVED_SLUGS = {
    "api", "apply", "login", "register", "platform", "admin", "app", "www", "static",
    "settings", "students", "branding", "forgot-password", "reset-password", "assets",
}


async def bind_public_tenant(x_tenant_slug: Optional[str] = Header(default=None)):
    slug = (x_tenant_slug or "").strip().lower()
    if not slug:
        return None
    t = await gdb.tenants.find_one({"slug": slug}, {"_id": 0, "id": 1, "status": 1})
    if not t:
        raise HTTPException(status_code=404, detail="This application link is not valid")
    if t.get("status") == "suspended":
        raise HTTPException(status_code=403, detail="This application form is currently unavailable")
    # Request-scoped: each request runs in its own context copy.
    set_current_tenant(t["id"])
    return t["id"]
