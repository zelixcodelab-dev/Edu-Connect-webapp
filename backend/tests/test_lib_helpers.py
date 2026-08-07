"""Unit tests for the extracted backend math helpers (no DB / no HTTP)."""
from datetime import datetime, timezone

import pytest

from lib.incentive_math import (
    filter_admissions_by_reference,
    compute_monthly_admission_counts,
    enrich_student_with_incentive,
    build_client_detail_totals,
)
from lib.student_math import (
    coerce_float,
    fees_plan_total,
    sum_sc_adjusted,
    compute_summary,
)
from lib.office_dashboard import (
    window_bounds,
    student_admission_dt,
    days_until_birthday,
    compute_staff_month_counts,
    build_staff_breakdown,
    count_admissions_in_window,
    upcoming_birthdays_30d,
)


# ---------------- incentive_math ----------------

class TestIncentiveMath:
    def test_filter_admissions_by_reference_case_insensitive(self):
        students = [
            {"id": "1", "reference": "Rohan Mehta"},
            {"id": "2", "reference": " rohan mehta "},
            {"id": "3", "reference": "Different Person"},
            {"id": "4", "reference": None},
        ]
        assert [s["id"] for s in filter_admissions_by_reference(students, "Rohan Mehta")] == ["1", "2"]

    def test_monthly_admission_counts(self):
        students = [
            {"enrollment_date": "2026-01-15"},
            {"enrollment_date": "2026-01-20"},
            {"enrollment_date": "2026-02-10"},
            {"created_at": "2026-02-11"},
        ]
        assert compute_monthly_admission_counts(students) == {"2026-01": 2, "2026-02": 2}

    def test_enrich_student_marks_eligible_after_third_in_month(self):
        s = {"id": "x", "name": "Test", "enrollment_date": "2026-01-15", "sc_out_fixed": 1000}
        counts = {"2026-01": 3}
        out = enrich_student_with_incentive(s, is_staff=True, incentive_amount=500, month_counts=counts)
        assert out["incentive_eligible"] is True
        assert out["incentive_amount"] == 500

    def test_enrich_student_not_eligible_below_threshold(self):
        s = {"id": "x", "name": "Test", "enrollment_date": "2026-01-15", "sc_out_fixed": 1000}
        counts = {"2026-01": 2}
        out = enrich_student_with_incentive(s, is_staff=True, incentive_amount=500, month_counts=counts)
        assert out["incentive_eligible"] is False
        assert out["incentive_amount"] == 0.0

    def test_enrich_student_non_staff_never_eligible(self):
        s = {"id": "x", "name": "Test", "enrollment_date": "2026-01-15", "sc_out_fixed": 1000}
        counts = {"2026-01": 10}
        out = enrich_student_with_incentive(s, is_staff=False, incentive_amount=500, month_counts=counts)
        assert out["incentive_eligible"] is False

    def test_build_client_detail_totals_aggregates_paid_pending(self):
        enriched = [
            {"sc_out_fixed": 1000, "incentive_eligible": True, "incentive_paid": True},
            {"sc_out_fixed": 1500, "incentive_eligible": True, "incentive_paid": False},
            {"sc_out_fixed": 2000, "incentive_eligible": False, "incentive_paid": False},
        ]
        txs = [
            {"type": "income", "amount": 5000},
            {"type": "expense", "amount": 2000},
        ]
        totals = build_client_detail_totals(enriched, txs, incentive_amount=500)
        assert totals == {
            "students_count": 3,
            "sc_earned": 4500.0,
            "incentive_earned": 1000.0,
            "incentive_paid": 500.0,
            "incentive_pending": 500.0,
            "eligible_count": 2,
            "total_income": 5000.0,
            "total_expense": 2000.0,
            "net": 3000.0,
        }


# ---------------- student_math ----------------

class TestStudentMath:
    @pytest.mark.parametrize("v,expected", [
        (None, 0.0), ("", 0.0), ("abc", 0.0),
        (10, 10.0), ("12.5", 12.5), (-3, -3.0),
    ])
    def test_coerce_float(self, v, expected):
        assert coerce_float(v) == expected

    def test_fees_plan_total_with_scholarship(self):
        fp = {"year_1": 100000, "year_2": 90000, "year_3": 80000, "year_4": 70000,
              "has_scholarship": True, "scholarship_amount": 20000}
        total, scholarship = fees_plan_total(fp)
        assert total == 320000.0
        assert scholarship == 20000.0

    def test_fees_plan_total_without_scholarship(self):
        fp = {"year_1": 100000, "year_2": 90000, "scholarship_amount": 20000}  # has_scholarship not set
        total, scholarship = fees_plan_total(fp)
        assert total == 190000.0
        assert scholarship == 0.0

    def test_fees_plan_total_with_none(self):
        assert fees_plan_total(None) == (0.0, 0.0)

    def test_sum_sc_adjusted_filters_kind(self):
        payments = [
            {"adjustments": [
                {"kind": "sc_adjusted", "amount": 5000},
                {"kind": "paid_to_college", "amount": 3000},
            ]},
            {"adjustments": [{"kind": "sc_adjusted", "amount": "1000"}]},
            {"adjustments": []},
            {},
        ]
        assert sum_sc_adjusted(payments) == 6000.0

    def test_compute_summary_balance_excludes_collected(self):
        # Per latest product spec, balance_vs_sc = sc_earned_effective - sc_adjusted_total
        student = {
            "sc_out_fixed": 75000,
            "fees_plan": {"year_1": 100000, "year_2": 90000, "year_3": 0, "year_4": 0,
                          "has_scholarship": True, "scholarship_amount": 20000},
            "schedules": [{"amount": 100000}, {"amount": 90000}],
            "payments": [
                {"amount": 10000, "adjustments": [{"kind": "sc_adjusted", "amount": 6000}]},
            ],
        }
        summary = compute_summary(student)
        assert summary["scheduled_total"] == 190000.0
        assert summary["collected_total"] == 10000.0
        assert summary["scholarship_amount"] == 20000.0
        assert summary["sc_adjusted_total"] == 6000.0
        assert summary["sc_earned_effective"] == 55000.0  # 75000 - 20000
        assert summary["balance_vs_sc"] == 49000.0  # 55000 - 6000
        assert summary["balance_vs_scheduled"] == 180000.0

    def test_compute_summary_no_scholarship_no_adjustments(self):
        student = {
            "sc_out_fixed": 50000,
            "schedules": [{"amount": 50000}],
            "payments": [{"amount": 25000, "adjustments": []}],
        }
        summary = compute_summary(student)
        assert summary["scholarship_amount"] == 0.0
        assert summary["sc_adjusted_total"] == 0.0
        assert summary["sc_earned_effective"] == 50000.0
        assert summary["balance_vs_sc"] == 50000.0


# ---------------- office_dashboard ----------------

class TestOfficeDashboard:
    def test_window_bounds_month(self):
        now = datetime(2026, 2, 17, 14, 30, tzinfo=timezone.utc)
        start, end = window_bounds("month", now)
        assert (end - start).days == 29
        assert start.hour == 0 and start.minute == 0

    def test_window_bounds_week(self):
        now = datetime(2026, 2, 17, tzinfo=timezone.utc)
        start, end = window_bounds("week", now)
        assert (end - start).days == 6

    def test_window_bounds_year(self):
        now = datetime(2026, 2, 17, tzinfo=timezone.utc)
        start, end = window_bounds("year", now)
        assert (end - start).days == 364

    def test_student_admission_dt_falls_back_to_epoch_on_bad_data(self):
        assert student_admission_dt({"enrollment_date": "garbage"}).year == 1970
        assert student_admission_dt({}).year == 1970

    def test_days_until_birthday(self):
        now = datetime(2026, 2, 17, tzinfo=timezone.utc)
        # 5 days away
        assert days_until_birthday("1990-02-22", now) == 5
        # tomorrow
        assert days_until_birthday("1990-02-18", now) == 1
        # already passed this year → returns next year's date diff
        assert 350 < days_until_birthday("1990-02-15", now) < 380

    def test_compute_staff_month_counts(self):
        students = [
            {"reference": "Alice", "enrollment_date": "2026-01-05"},
            {"reference": "alice", "enrollment_date": "2026-01-20"},
            {"reference": "Bob", "enrollment_date": "2026-02-01"},
            {"reference": None, "enrollment_date": "2026-01-15"},
        ]
        counts = compute_staff_month_counts(students)
        assert counts == {("alice", "2026-01"): 2, ("bob", "2026-02"): 1}

    def test_build_staff_breakdown_eligibility(self):
        now = datetime(2026, 1, 31, tzinfo=timezone.utc)
        win_start, win_end = window_bounds("month", now)
        staffs = [
            {"id": "s1", "name": "Alice", "office": "KM_BLR", "eligible_incentive": 500, "date_of_birth": None},
        ]
        students = [
            {"id": str(i), "name": f"st{i}", "reference": "Alice",
             "enrollment_date": "2026-01-15", "incentive_paid": False}
            for i in range(3)
        ]
        month_counts = compute_staff_month_counts(students)
        breakdown = build_staff_breakdown(students, staffs, win_start=win_start, win_end=win_end, month_counts=month_counts)
        assert len(breakdown) == 1
        assert breakdown[0]["admissions_count"] == 3
        assert breakdown[0]["eligible_count"] == 3
        assert breakdown[0]["incentive_earned"] == 1500.0

    def test_count_admissions_in_window_includes_unreferenced(self):
        now = datetime(2026, 1, 31, tzinfo=timezone.utc)
        win_start, win_end = window_bounds("month", now)
        students = [
            {"enrollment_date": "2026-01-15", "reference": "Alice"},
            {"enrollment_date": "2026-01-20", "reference": None},  # unreferenced still counts
            {"enrollment_date": "2025-12-01", "reference": "Bob"},  # out of window
        ]
        assert count_admissions_in_window(students, win_start, win_end) == 2

    def test_upcoming_birthdays_30d_sorted(self):
        now = datetime(2026, 2, 17, tzinfo=timezone.utc)
        staffs = [
            {"id": "a", "name": "Alice", "office": "KM_BLR", "date_of_birth": "1990-03-15"},  # 26 days
            {"id": "b", "name": "Bob", "office": "KM_BLR", "date_of_birth": "1990-02-20"},  # 3 days
            {"id": "c", "name": "Carol", "office": "KM_BLR", "date_of_birth": "1990-08-01"},  # >30
            {"id": "d", "name": "Dora", "office": "KM_BLR", "date_of_birth": None},
        ]
        out = upcoming_birthdays_30d(staffs, now)
        assert [u["name"] for u in out] == ["Bob", "Alice"]
