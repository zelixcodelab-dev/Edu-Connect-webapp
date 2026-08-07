"""File upload + serving (Emergent object storage).

Two upload flavours:
  * ``POST /api/uploads/image``    — profile-picture uploader.
      Accepts jpg/jpeg/png/webp/gif, capped at 2MB.
      Returns ``{url, path, file_id}``. Backward-compatible with the older
      response shape (``url`` + ``path``) so the existing StaffProfile page
      keeps working without changes.
  * ``POST /api/uploads/document`` — attachment uploader for CRM leads.
      Accepts images + application/pdf, capped at 10MB. Admin-only (super_admin
      or office_admin). Returns the full file record so the client can render
      the download link and manage lifecycle.

Every uploaded file has a row in ``db.files``. Soft-delete via ``is_deleted``.
"""
import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import (
    APIRouter, Depends, File, Header, HTTPException, Query, Response, UploadFile,
)

from db import db
from auth_lib import get_current_user, decode_token
from lib.storage import put_object, get_object, APP_NAME

router = APIRouter(prefix="/api", tags=["uploads"])
log = logging.getLogger("uploads")

# ---- Content-type allow-lists ----
PROFILE_IMAGE_TYPES = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
}
DOCUMENT_TYPES = {
    **PROFILE_IMAGE_TYPES,
    "application/pdf": "pdf",
}
MAX_PROFILE_BYTES = 2 * 1024 * 1024   # 2 MB
MAX_DOCUMENT_BYTES = 10 * 1024 * 1024  # 10 MB


def _sniff_ext(filename: Optional[str], fallback: str) -> str:
    """Best-effort extension from the incoming filename; fall back to the map."""
    if filename and "." in filename:
        raw = filename.rsplit(".", 1)[-1].lower()
        if raw.isalnum() and len(raw) <= 5:
            return raw
    return fallback


async def _persist_file_record(*, storage_path: str, filename: str, content_type: str,
                               size: int, owner: dict, purpose: str,
                               lead_id: Optional[str] = None) -> dict:
    """Create the ``db.files`` row that lets us track / soft-delete / audit."""
    doc = {
        "id": str(uuid.uuid4()),
        "storage_path": storage_path,
        "original_filename": filename,
        "content_type": content_type,
        "size": size,
        "owner_user_id": owner["id"],
        "purpose": purpose,          # "profile" | "lead_document"
        "lead_id": lead_id,          # only set for lead_document uploads
        "is_deleted": False,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.files.insert_one(doc)
    doc.pop("_id", None)
    return doc


def _serialize(record: dict) -> dict:
    """Trim server-side fields for the API response."""
    return {
        "file_id": record["id"],
        "url": f"/api/files/{record['storage_path']}",
        "path": record["storage_path"],
        "original_filename": record.get("original_filename"),
        "content_type": record.get("content_type"),
        "size": record.get("size"),
        "created_at": record.get("created_at"),
    }


@router.post("/uploads/image")
async def upload_image(file: UploadFile = File(...), user: dict = Depends(get_current_user)):
    """Profile-picture upload. Any authenticated user can call this — the
    caller decides what to do with the returned url (usually PATCH their
    ``photo_url``)."""
    ct = (file.content_type or "").lower()
    if ct not in PROFILE_IMAGE_TYPES:
        raise HTTPException(400, "Only JPG, PNG, WebP or GIF images are allowed")
    data = await file.read()
    if not data:
        raise HTTPException(400, "Empty file")
    if len(data) > MAX_PROFILE_BYTES:
        raise HTTPException(400, "Image must be 2MB or smaller")
    ext = _sniff_ext(file.filename, PROFILE_IMAGE_TYPES[ct])
    path = f"{APP_NAME}/uploads/{user['id']}/{uuid.uuid4()}.{ext}"
    try:
        result = put_object(path, data, ct)
    except Exception as e:
        log.exception("[uploads] storage put failed")
        raise HTTPException(502, "Upload failed — storage unavailable") from e
    stored_path = result.get("path", path)
    record = await _persist_file_record(
        storage_path=stored_path, filename=file.filename or f"photo.{ext}",
        content_type=ct, size=result.get("size", len(data)),
        owner=user, purpose="profile",
    )
    # Keep the legacy top-level ``url`` + ``path`` keys for the StaffProfile
    # + Clients photo uploaders that already call this endpoint. Add ``file_id``
    # for new call sites.
    return {"url": f"/api/files/{stored_path}", "path": stored_path, "file_id": record["id"]}


@router.post("/uploads/document")
async def upload_document(
    file: UploadFile = File(...),
    lead_id: Optional[str] = Query(None, description="Attach directly to a CRM lead"),
    user: dict = Depends(get_current_user),
):
    """Document upload for CRM lead attachments. Admin roles only (staff/user
    are blocked). Accepts images + PDF, capped at 10MB.

    If ``lead_id`` is provided, we scope-check the lead the same way the leads
    router does, so an office_admin can't attach files to leads outside their
    office. Otherwise it's a "loose" upload (rare; UI always passes lead_id).
    """
    if user.get("role") not in ("super_admin", "office_admin"):
        raise HTTPException(403, "Only admins can upload documents")
    ct = (file.content_type or "").lower()
    if ct not in DOCUMENT_TYPES:
        raise HTTPException(400, "Only PDF or image uploads (JPG/PNG/WebP/GIF) are allowed")
    data = await file.read()
    if not data:
        raise HTTPException(400, "Empty file")
    if len(data) > MAX_DOCUMENT_BYTES:
        raise HTTPException(400, "Document must be 10MB or smaller")

    if lead_id:
        # Scope filter mirrors routers/leads.py::_scope_filter.
        scope = {} if user.get("role") == "super_admin" else {"office": user.get("office")}
        lead = await db.leads.find_one({**scope, "id": lead_id}, {"_id": 0, "id": 1, "office": 1})
        if not lead:
            raise HTTPException(404, "Lead not found in your scope")

    ext = _sniff_ext(file.filename, DOCUMENT_TYPES[ct])
    path = f"{APP_NAME}/leads/{lead_id or 'loose'}/{uuid.uuid4()}.{ext}"
    try:
        result = put_object(path, data, ct)
    except Exception as e:
        log.exception("[uploads] storage put (doc) failed")
        raise HTTPException(502, "Upload failed — storage unavailable") from e
    stored_path = result.get("path", path)
    record = await _persist_file_record(
        storage_path=stored_path, filename=file.filename or f"document.{ext}",
        content_type=ct, size=result.get("size", len(data)),
        owner=user, purpose="lead_document", lead_id=lead_id,
    )
    return _serialize(record)


@router.delete("/files/id/{file_id}")
async def soft_delete_file(file_id: str, user: dict = Depends(get_current_user)):
    """Soft-delete a file (``is_deleted=True``). Admins can delete any file
    they can see; regular users can only delete their own uploads.
    Storage bytes are not removed (Emergent has no delete API) — served
    downloads honour the flag."""
    record = await db.files.find_one({"id": file_id, "is_deleted": False})
    if not record:
        raise HTTPException(404, "File not found")
    is_admin = user.get("role") in ("super_admin", "office_admin")
    if not is_admin and record.get("owner_user_id") != user.get("id"):
        raise HTTPException(403, "You cannot delete this file")
    await db.files.update_one(
        {"id": file_id},
        {"$set": {"is_deleted": True, "deleted_at": datetime.now(timezone.utc).isoformat(),
                  "deleted_by_user_id": user["id"]}},
    )
    # If the file was attached to a lead, pull it out of the attachments array
    # so the UI doesn't render a broken link.
    if record.get("lead_id"):
        await db.leads.update_one(
            {"id": record["lead_id"]},
            {"$pull": {"attachments": {"file_id": file_id}}},
        )
    return {"ok": True}


@router.get("/files/{path:path}")
async def serve_file(path: str, authorization: str = Header(None), auth: str = Query(None)):
    """Serve a stored file. Auth via ``Authorization: Bearer <t>`` OR
    ``?auth=<t>`` query param (needed because ``<img>``/``<a download>``
    tags can't attach headers)."""
    token = None
    if authorization and authorization.startswith("Bearer "):
        token = authorization[7:]
    elif auth:
        token = auth
    if not token or not decode_token(token):
        raise HTTPException(401, "Not authenticated")
    record = await db.files.find_one({"storage_path": path, "is_deleted": False})
    if not record:
        raise HTTPException(404, "File not found")
    try:
        data, content_type = get_object(path)
    except Exception as e:
        log.exception("[uploads] storage get failed")
        raise HTTPException(502, "Could not load file") from e
    return Response(
        content=data,
        media_type=record.get("content_type", content_type),
        headers={
            "Cache-Control": "private, max-age=86400",
            # Nice download filename fallback — the frontend can override with
            # its own ``download`` attribute if it wants.
            "Content-Disposition": f'inline; filename="{record.get("original_filename", "file")}"',
        },
    )
