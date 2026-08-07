"""One-shot: merge duplicate college names that only differ in casing/whitespace.

Idempotent. Groups all `colleges` by lower-cased trimmed name; when a group
has more than one row it:
  * picks a *canonical* doc (prefer the one that already has ``sc_rates``,
    then most recently updated, then most recently created)
  * merges the ``courses`` + ``sc_rates`` from every dupe into it
  * rewrites all ``students.college`` fields that pointed at any duplicate
    variant → the canonical name
  * deletes the duplicate college docs
  * refreshes the canonical doc's ``name_lower`` guard

Run:  cd /app/backend && python3 scripts/merge_duplicate_colleges.py
"""
from __future__ import annotations

import asyncio
import sys
from collections import defaultdict
from pathlib import Path

# Allow "python scripts/foo.py" from /app/backend
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from db import db  # noqa: E402
from auth_lib import now_iso  # noqa: E402


def _norm(s: str | None) -> str:
    return " ".join((s or "").split()).strip().lower()


def _score(c: dict) -> tuple:
    """Higher = better canonical candidate."""
    has_rates = 1 if (c.get("sc_rates") or {}) else 0
    updated = c.get("updated_at") or ""
    created = c.get("created_at") or ""
    return (has_rates, updated, created)


async def main() -> None:
    docs = await db.colleges.find({}, {"_id": 0}).to_list(10000)
    print(f"Loaded {len(docs)} college docs.")

    groups: dict[str, list[dict]] = defaultdict(list)
    for c in docs:
        groups[_norm(c.get("name"))].append(c)

    merged = 0
    students_updated_total = 0
    deleted_total = 0

    for key, rows in groups.items():
        if len(rows) < 2:
            continue

        rows.sort(key=_score, reverse=True)
        canonical = rows[0]
        others = rows[1:]

        # Merge courses + sc_rates from every duplicate.
        merged_courses: list[str] = list(canonical.get("courses") or [])
        seen_courses = {c.strip().lower() for c in merged_courses if c and c.strip()}
        merged_rates: dict = dict(canonical.get("sc_rates") or {})

        for d in others:
            for c in d.get("courses") or []:
                if not c or not c.strip():
                    continue
                if c.strip().lower() not in seen_courses:
                    merged_courses.append(c.strip())
                    seen_courses.add(c.strip().lower())
            for k, v in (d.get("sc_rates") or {}).items():
                # canonical wins on a conflict — only fill unset keys
                if k not in merged_rates:
                    merged_rates[k] = v

        variant_names = [d.get("name") for d in others if d.get("name")]
        print(f"\n→ Group '{canonical.get('name')}' (key={key!r}):")
        print(f"    canonical id={canonical.get('id')}  courses={len(merged_courses)}  sc_rates={len(merged_rates)}")
        print(f"    merging variants: {variant_names}")

        # 1) Repoint students.college for every duplicate variant.
        for old_name in variant_names:
            if not old_name or old_name == canonical.get("name"):
                continue
            res = await db.students.update_many(
                {"college": old_name},
                {"$set": {"college": canonical["name"]}},
            )
            if res.modified_count:
                print(f"    ↳ students updated: {res.modified_count} (college '{old_name}' → '{canonical['name']}')")
            students_updated_total += res.modified_count

        # 2) Persist the merged canonical row.
        patch = {
            "courses": merged_courses,
            "sc_rates": merged_rates,
            "name_lower": (canonical.get("name") or "").strip().lower(),
            "updated_at": now_iso(),
        }
        await db.colleges.update_one({"id": canonical["id"]}, {"$set": patch})

        # 3) Delete the duplicate college docs.
        dup_ids = [d["id"] for d in others if d.get("id")]
        if dup_ids:
            res = await db.colleges.delete_many({"id": {"$in": dup_ids}})
            deleted_total += res.deleted_count
            print(f"    ↳ deleted {res.deleted_count} duplicate college doc(s).")

        merged += 1

    # Backfill name_lower for any doc that's still missing it.
    fixed_lower = 0
    async for c in db.colleges.find({"name_lower": {"$exists": False}}, {"_id": 0, "id": 1, "name": 1}):
        await db.colleges.update_one(
            {"id": c["id"]},
            {"$set": {"name_lower": (c.get("name") or "").strip().lower()}},
        )
        fixed_lower += 1
    if fixed_lower:
        print(f"\nBackfilled name_lower on {fixed_lower} pre-existing doc(s).")

    # ── Also normalize students.college to the canonical name whenever the
    # student's college string is a case-insensitive match to a college doc.
    # This prevents the Admission Revenue "By College" table from splitting
    # a single college across two rows when data entered pre-catalogue was
    # a lower/upper-case variant.
    canonical_by_lower = {
        (c.get("name") or "").strip().lower(): c.get("name")
        for c in await db.colleges.find({}, {"_id": 0, "name": 1}).to_list(5000)
        if c.get("name")
    }
    student_college_fixed = 0
    async for s in db.students.find(
        {"college": {"$nin": [None, ""]}},
        {"_id": 0, "id": 1, "college": 1},
    ):
        raw = str(s.get("college") or "")
        canonical = canonical_by_lower.get(raw.strip().lower())
        if canonical and canonical != raw:
            await db.students.update_one(
                {"id": s["id"]}, {"$set": {"college": canonical}}
            )
            student_college_fixed += 1
    if student_college_fixed:
        print(f"Normalized `college` on {student_college_fixed} student(s) to their catalogue canonical name.")

    print(
        f"\nDone. Merged {merged} duplicate group(s). "
        f"Repointed {students_updated_total} student(s). Deleted {deleted_total} dup college(s)."
    )


if __name__ == "__main__":
    asyncio.run(main())
