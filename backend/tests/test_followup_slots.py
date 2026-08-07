"""Unit tests for the per-user follow-up slot scheduler."""
from datetime import datetime, timezone

from lib.followup_slots import compute_next_slot, IST


def _ist(y, m, d, h, mi):
    return datetime(y, m, d, h, mi, tzinfo=IST)


def _utc(y, m, d, h, mi):
    return _ist(y, m, d, h, mi).astimezone(timezone.utc)


def _slot_ist(slot_iso):
    return datetime.fromisoformat(slot_iso).astimezone(IST)


def test_first_slot_when_empty():
    slot, is_first = compute_next_slot([], _utc(2026, 6, 1, 11, 3))
    assert is_first is True
    dt = _slot_ist(slot)
    assert (dt.hour, dt.minute) == (11, 5)  # ceil to next 5-min


def test_next_slot_after_latest():
    booked = [_utc(2026, 6, 1, 11, 0).isoformat()]
    slot, is_first = compute_next_slot(booked, _utc(2026, 6, 1, 11, 0))
    assert is_first is False
    dt = _slot_ist(slot)
    assert (dt.hour, dt.minute) == (11, 5)


def test_rollover_to_next_day_after_window():
    booked = [_utc(2026, 6, 1, 18, 55).isoformat()]
    slot, is_first = compute_next_slot(booked, _utc(2026, 6, 1, 11, 0))
    assert is_first is False
    dt = _slot_ist(slot)
    assert (dt.month, dt.day, dt.hour, dt.minute) == (6, 2, 10, 0)


def test_before_window_pushed_to_open():
    slot, is_first = compute_next_slot([], _utc(2026, 6, 1, 7, 2))
    dt = _slot_ist(slot)
    assert (dt.hour, dt.minute) == (10, 0)
    assert is_first is True


def test_collision_skips_to_next_free():
    booked = [
        _utc(2026, 6, 1, 10, 0).isoformat(),
        _utc(2026, 6, 1, 10, 5).isoformat(),
    ]
    slot, _ = compute_next_slot(booked, _utc(2026, 6, 1, 10, 0))
    dt = _slot_ist(slot)
    assert (dt.hour, dt.minute) == (10, 10)


def test_past_booked_slots_ignored():
    booked = [_utc(2026, 6, 1, 9, 0).isoformat()]  # before now and before window
    slot, is_first = compute_next_slot(booked, _utc(2026, 6, 1, 11, 0))
    assert is_first is True  # no FUTURE slots
    dt = _slot_ist(slot)
    assert (dt.hour, dt.minute) == (11, 0)


def test_exclude_edited_lead_slot():
    own = _utc(2026, 6, 1, 12, 0).isoformat()
    slot, is_first = compute_next_slot([own], _utc(2026, 6, 1, 11, 0), exclude_iso=own)
    assert is_first is True
