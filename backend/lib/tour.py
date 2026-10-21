"""Product-tour defaults + per-company overrides (stored on tenant.tour_steps)."""
import re
from typing import List, Optional

DEFAULT_TOUR_STEPS = [
    {"id": "welcome", "title": "Welcome to your workspace", "body": "Here's a quick look around. It takes under a minute, and you can skip any time."},
    {"id": "nav", "title": "Navigation", "body": "Every area of the app is listed here. Your menu only shows what your role and company can use."},
    {"id": "year", "title": "Academic year", "body": "Pick a year to scope every page's numbers, lists and reports. \"All years\" removes the filter."},
    {"id": "students", "title": "Students", "body": "Admissions, fees, payments and documents for every student."},
    {"id": "leads", "title": "CRM & leads", "body": "Track enquiries through the pipeline, run campaigns and convert leads into students."},
    {"id": "attendance", "title": "Attendance & leave", "body": "Check in and out, apply for leave and see payroll from one place."},
    {"id": "messages", "title": "Messages", "body": "Chat with your team. Unread counts show up right here."},
    {"id": "team", "title": "Your team", "body": "Invite colleagues and control what each person can see or edit."},
    {"id": "profile", "title": "Profile & settings", "body": "Switch light/dark mode, open settings, or replay this tour any time from here."},
    {"id": "done", "title": "You're all set", "body": "That's the tour. You can replay it from the profile menu whenever you like."},
]
DEFAULT_IDS = {s["id"] for s in DEFAULT_TOUR_STEPS}


def _default(enabled: bool = True) -> List[dict]:
    return [{**s, "enabled": enabled, "custom": False} for s in DEFAULT_TOUR_STEPS]


def resolve_tour_steps(custom: Optional[List[dict]]) -> List[dict]:
    """Company steps in saved order; default steps added later are appended."""
    if not custom:
        return _default()
    out, seen = [], set()
    for s in custom:
        sid = s.get("id")
        if not sid or sid in seen:
            continue
        seen.add(sid)
        out.append({
            "id": sid, "title": s.get("title") or "", "body": s.get("body") or "",
            "enabled": bool(s.get("enabled", True)), "custom": sid not in DEFAULT_IDS,
        })
    out += [{**s, "enabled": True, "custom": False} for s in DEFAULT_TOUR_STEPS if s["id"] not in seen]
    return out


def clean_tour_steps(steps: List[dict]) -> List[dict]:
    out, seen = [], set()
    for s in steps[:30]:
        sid = re.sub(r"[^a-z0-9_-]", "", str(s.get("id", "")).lower())[:40]
        title = str(s.get("title", "")).strip()[:80]
        if not sid or sid in seen or not title:
            continue
        seen.add(sid)
        out.append({"id": sid, "title": title, "body": str(s.get("body", "")).strip()[:400],
                    "enabled": bool(s.get("enabled", True))})
    return out


async def tour_stats(tdb) -> dict:
    users = await tdb.users.count_documents({"deleted_at": {"$exists": False}})
    completed = await tdb.users.count_documents({"deleted_at": {"$exists": False}, "tour_status": "completed"})
    skipped = await tdb.users.count_documents({"deleted_at": {"$exists": False}, "tour_status": "skipped"})
    return {"completed": completed, "skipped": skipped, "not_started": max(0, users - completed - skipped), "total": users}
