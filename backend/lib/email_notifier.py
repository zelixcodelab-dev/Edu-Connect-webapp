"""Resend transactional email — thin async wrapper.

Used to notify admissions officers when a new student application is submitted
via the public `/apply` form. Falls back silently in dev (no API key) so unit
tests don't need the key.

Env vars (read at call time, NOT import time — so the module is importable
without keys set):
    RESEND_API_KEY      – your Resend secret (re_xxx).
    SENDER_EMAIL        – verified Resend sender; default onboarding@resend.dev.
    APPLICATION_NOTIFY_EMAIL – recipient address for new-application alerts.
"""
from __future__ import annotations

import asyncio
import base64
import logging
import os
from typing import Iterable, Optional

import resend

log = logging.getLogger("finflow.email")


def _api_key() -> Optional[str]:
    return os.environ.get("RESEND_API_KEY")


def _sender() -> str:
    return os.environ.get("SENDER_EMAIL") or "FinFlow <onboarding@resend.dev>"


def _is_enabled() -> bool:
    return bool(_api_key())


async def send_email(
    *,
    to: Iterable[str] | str,
    subject: str,
    html: str,
    attachments: list[dict] | None = None,
    reply_to: str | None = None,
) -> dict:
    """Send a transactional email via Resend.

    Returns the Resend API response dict on success, or `{"skipped": True}` if
    no API key is configured (so callers can treat the alert as best-effort).
    Raises `RuntimeError` on hard send failures so the caller can decide
    whether to surface or swallow.

    `attachments` items: `{"filename": str, "content": bytes | str}` where
    bytes content is auto base64-encoded.
    """
    api_key = _api_key()
    if not api_key:
        log.info("[email] RESEND_API_KEY not set — skipping send (%s)", subject)
        return {"skipped": True, "reason": "no_api_key"}

    resend.api_key = api_key

    recipients = [to] if isinstance(to, str) else list(to)
    params: dict = {
        "from": _sender(),
        "to": recipients,
        "subject": subject,
        "html": html,
    }
    if reply_to:
        params["reply_to"] = reply_to
    if attachments:
        params["attachments"] = []
        for a in attachments:
            content = a["content"]
            if isinstance(content, (bytes, bytearray)):
                content = base64.b64encode(bytes(content)).decode("ascii")
            params["attachments"].append({
                "filename": a["filename"],
                "content": content,
            })

    try:
        # Resend SDK is synchronous → push to a thread so the event loop stays clean.
        resp = await asyncio.to_thread(resend.Emails.send, params)
        log.info("[email] sent %r to %s (id=%s)", subject, recipients, (resp or {}).get("id"))
        return resp or {}
    except Exception as exc:
        log.exception("[email] send failed (%s → %s): %s", subject, recipients, exc)
        raise RuntimeError(f"Resend send failed: {exc}") from exc


def password_reset_email_html(name: str, reset_link: str, expires_minutes: int = 30) -> str:
    """Inline-CSS HTML body for the self-service password reset email."""
    safe_name = (name or "there").strip() or "there"
    return f"""
<!doctype html>
<html><body style="margin:0;padding:0;background:#fafaf9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1c1917;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#fafaf9;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:520px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e7e5e4;">
        <tr><td style="background:linear-gradient(135deg,#f97316 0%,#d97706 100%);padding:24px 28px;color:#ffffff;">
          <div style="font-size:11px;letter-spacing:.18em;text-transform:uppercase;opacity:.9;font-weight:600;">FinFlow · KM Foundation</div>
          <h1 style="margin:6px 0 0;font-size:22px;font-weight:700;">Reset your password</h1>
        </td></tr>
        <tr><td style="padding:28px 28px 8px;">
          <p style="font-size:15px;margin:0 0 14px;">Hi {safe_name},</p>
          <p style="font-size:14px;color:#57534e;line-height:1.6;margin:0 0 22px;">
            We received a request to reset the password for your FinFlow account. Click the button below to choose a new password. This link expires in <strong>{expires_minutes} minutes</strong>.
          </p>
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 22px;">
            <tr><td style="border-radius:10px;background:linear-gradient(135deg,#fbbf24 0%,#f97316 100%);">
              <a href="{reset_link}" style="display:inline-block;padding:13px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px;">Reset password</a>
            </td></tr>
          </table>
          <p style="font-size:12px;color:#a8a29e;line-height:1.6;margin:0 0 8px;">
            If the button doesn't work, copy and paste this link into your browser:
          </p>
          <p style="font-size:12px;color:#f97316;word-break:break-all;margin:0 0 20px;">{reset_link}</p>
        </td></tr>
        <tr><td style="padding:6px 28px 24px;color:#78716c;font-size:12px;line-height:1.55;border-top:1px solid #f5f5f4;">
          If you didn't request this, you can safely ignore this email — your password will stay the same.
        </td></tr>
      </table>
      <div style="font-size:11px;color:#a8a29e;margin-top:14px;">This is an automated message from FinFlow by KM Foundation.</div>
    </td></tr>
  </table>
</body></html>
""".strip()


def application_email_html(student: dict) -> str:
    """Inline-CSS HTML body for the new-application notification.

    Email clients ignore external stylesheets and many strip <style> blocks,
    so all styling is inlined.
    """
    app = student.get("application") or {}
    bi = app.get("basic_info") or {}
    co = app.get("course") or {}
    cm = app.get("communication") or {}
    ref = app.get("reference") or {}

    ref_code = (student.get("id") or "")[:8].upper() or "—"
    submitted_at = student.get("application_submitted_at") or "—"
    full_name = bi.get("student_full_name") or student.get("name") or "Applicant"

    rows = [
        ("Course", co.get("interested_course")),
        ("Preferred college", co.get("preferred_college") or "—"),
        ("Admission type", (co.get("admission_type") or "—").replace("_", " ").title()),
        ("Mobile", bi.get("mobile_number") or "—"),
        ("Email", bi.get("email") or "—"),
        ("City", cm.get("city") or "—"),
        ("State", cm.get("state") or "—"),
        ("Reference", ref.get("name") or "—"),
    ]
    row_html = "".join(
        f"""
        <tr>
          <td style="padding:8px 14px;color:#78716c;font-size:13px;width:140px;border-bottom:1px solid #f5f5f4;">{label}</td>
          <td style="padding:8px 14px;color:#1c1917;font-size:13px;border-bottom:1px solid #f5f5f4;">{value}</td>
        </tr>
        """
        for label, value in rows
    )

    return f"""
<!doctype html>
<html><body style="margin:0;padding:0;background:#fafaf9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1c1917;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#fafaf9;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e7e5e4;">
        <tr><td style="background:linear-gradient(135deg,#f97316 0%,#d97706 100%);padding:24px 28px;color:#ffffff;">
          <div style="font-size:11px;letter-spacing:.18em;text-transform:uppercase;opacity:.9;font-weight:600;">FinFlow · KM Foundation</div>
          <h1 style="margin:6px 0 0;font-size:22px;font-weight:700;">New student application</h1>
        </td></tr>
        <tr><td style="padding:24px 28px 8px;">
          <div style="font-size:13px;color:#78716c;">Reference</div>
          <div style="font-size:18px;font-weight:600;margin-top:2px;">{full_name}</div>
          <div style="font-size:12px;color:#a8a29e;margin-top:4px;">Ref code: <strong style="color:#1c1917;font-family:monospace;">{ref_code}</strong> · Submitted: {submitted_at[:19].replace('T', ' ')}</div>
        </td></tr>
        <tr><td style="padding:8px 14px 16px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-radius:8px;overflow:hidden;border:1px solid #f5f5f4;">
            {row_html}
          </table>
        </td></tr>
        <tr><td style="padding:6px 28px 24px;color:#78716c;font-size:12px;line-height:1.55;">
          The full admission application is attached as a PDF. Open it to review parent details, address, academic records and signatures.
        </td></tr>
      </table>
      <div style="font-size:11px;color:#a8a29e;margin-top:14px;">This is an automated notification from FinFlow. Reply to this email to follow up with the applicant directly.</div>
    </td></tr>
  </table>
</body></html>
""".strip()
