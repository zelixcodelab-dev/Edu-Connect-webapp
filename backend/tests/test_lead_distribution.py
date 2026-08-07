"""Unit tests for campaign lead distribution."""
from collections import Counter

from lib.lead_distribution import distribute


def _counts(assignments):
    return Counter(emp for _, emp in assignments)


def test_equal_round_robin():
    leads = [f"L{i}" for i in range(10)]
    a = distribute(leads, "equal", ["e1", "e2", "e3"])
    assert len(a) == 10
    c = _counts(a)
    assert c["e1"] == 4 and c["e2"] == 3 and c["e3"] == 3
    # every lead assigned exactly once
    assert len({lid for lid, _ in a}) == 10


def test_count_leaves_surplus_unassigned():
    leads = [f"L{i}" for i in range(10)]
    a = distribute(leads, "count", ["e1", "e2"], counts={"e1": 3, "e2": 4})
    c = _counts(a)
    assert c["e1"] == 3 and c["e2"] == 4
    assert len(a) == 7  # 3 leads left unassigned


def test_count_caps_at_available():
    leads = [f"L{i}" for i in range(5)]
    a = distribute(leads, "count", ["e1", "e2"], counts={"e1": 10, "e2": 10})
    assert len(a) == 5
    c = _counts(a)
    assert c["e1"] == 5 and c["e2"] == 0


def test_percentage_split():
    leads = [f"L{i}" for i in range(10)]
    a = distribute(leads, "percentage", ["e1", "e2"], percentages={"e1": 70, "e2": 30})
    c = _counts(a)
    assert c["e1"] == 7 and c["e2"] == 3
    assert len(a) == 10


def test_percentage_rounding_remainder():
    leads = [f"L{i}" for i in range(10)]
    a = distribute(leads, "percentage", ["e1", "e2", "e3"], percentages={"e1": 33.34, "e2": 33.33, "e3": 33.33})
    assert len(a) == 10  # all leads distributed despite rounding
    c = _counts(a)
    assert max(c.values()) - min(c.values()) <= 1


def test_empty_inputs():
    assert distribute([], "equal", ["e1"]) == []
    assert distribute(["L1"], "equal", []) == []
