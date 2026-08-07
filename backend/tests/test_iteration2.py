"""Iteration 2 tests: new default categories, dashboard date-range filters, idempotency."""
import uuid
import requests

from tests._creds import api_base, admin_credentials

API = api_base()
ADMIN_EMAIL, ADMIN_PASSWORD = admin_credentials()

REQUIRED_NEW_EXPENSE_CATS = {"Rent", "Fuel Exp", "Toll", "Cab Exp", "Train/Bus Booking", "Food", "Other"}


def admin_login() -> requests.Session:
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=30)
    assert r.status_code == 200
    return s


def test_admin_has_all_new_default_categories() -> None:
    s = admin_login()
    r = s.get(f"{API}/categories", timeout=15)
    assert r.status_code == 200
    cats = r.json()
    names_by_type = {(c["name"], c["type"]) for c in cats}
    missing = []
    for n in REQUIRED_NEW_EXPENSE_CATS:
        if (n, "expense") not in names_by_type:
            missing.append(n)
    assert not missing, f"Missing default categories for admin: {missing}"


def test_new_user_has_all_new_default_categories() -> None:
    s = requests.Session()
    email = f"test_iter2_{uuid.uuid4().hex[:8]}@example.com"
    r = s.post(f"{API}/auth/register", json={
        "email": email, "password": "Passw0rd!", "name": "Iter2"
    }, timeout=30)
    assert r.status_code == 200
    r = s.get(f"{API}/categories", timeout=15)
    assert r.status_code == 200
    names = {(c["name"], c["type"]) for c in r.json()}
    for n in REQUIRED_NEW_EXPENSE_CATS:
        assert (n, "expense") in names, f"new user missing category: {n}"


def test_categories_idempotent_no_duplicates_for_admin() -> None:
    """Backfill should not create duplicates on restart. Check admin has each default exactly once."""
    s = admin_login()
    r = s.get(f"{API}/categories", timeout=15)
    cats = r.json()
    from collections import Counter
    counts = Counter((c["name"], c["type"]) for c in cats)
    dups = {k: v for k, v in counts.items() if v > 1 and k[0] in REQUIRED_NEW_EXPENSE_CATS}
    assert not dups, f"Duplicate default categories detected: {dups}"


def test_dashboard_summary_accepts_start_end() -> None:
    s = admin_login()
    r = s.get(f"{API}/dashboard/summary", params={"start": "2025-01-01", "end": "2025-12-31"}, timeout=15)
    assert r.status_code == 200
    data = r.json()
    assert data.get("period_start") == "2025-01-01"
    assert data.get("period_end") == "2025-12-31"
    assert "month_income" in data and "month_expense" in data
    assert isinstance(data["month_income"], (int, float))


def test_dashboard_summary_date_filter_isolates_data() -> None:
    """Create a transaction inside one window and verify only it counts."""
    s = admin_login()
    # Pick Main Bank or first account
    accs = s.get(f"{API}/accounts", timeout=15).json()
    aid = accs[0]["id"]
    tag = uuid.uuid4().hex[:6]
    tx = s.post(f"{API}/transactions", json={
        "type": "income", "amount": 777.77, "account_id": aid,
        "date": "2031-06-15", "description": f"TEST_iter2_{tag}"
    }, timeout=15).json()
    try:
        # Range covering the tx
        r1 = s.get(f"{API}/dashboard/summary", params={"start": "2031-06-01", "end": "2031-06-30"}, timeout=15).json()
        assert r1["month_income"] >= 777.77
        # Range outside
        r2 = s.get(f"{API}/dashboard/summary", params={"start": "2031-07-01", "end": "2031-07-31"}, timeout=15).json()
        assert r2["month_income"] < 777.77 or r2["month_income"] == 0 or (
            # ensure our tagged amount is not in this window
            True
        )
        # Stronger assertion: the 777.77 should not show up in July
        diff = r1["month_income"] - r2["month_income"]
        assert diff >= 777.77 - 0.01, f"Date filter did not isolate tx. r1={r1['month_income']} r2={r2['month_income']}"
    finally:
        s.delete(f"{API}/transactions/{tx['id']}", timeout=15)


def test_dashboard_expense_by_category_accepts_start_end() -> None:
    s = admin_login()
    r = s.get(f"{API}/dashboard/expense-by-category",
              params={"start": "2025-01-01", "end": "2025-12-31"}, timeout=15)
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_dashboard_expense_by_category_date_filter_isolates() -> None:
    s = admin_login()
    cats = s.get(f"{API}/categories", timeout=15).json()
    food = next((c for c in cats if c["name"] == "Food" and c["type"] == "expense"), None)
    assert food, "Food category should exist"
    accs = s.get(f"{API}/accounts", timeout=15).json()
    aid = accs[0]["id"]
    tx = s.post(f"{API}/transactions", json={
        "type": "expense", "amount": 42.42, "account_id": aid, "category_id": food["id"],
        "date": "2031-08-15", "description": "TEST_iter2_food"
    }, timeout=15).json()
    try:
        r_in = s.get(f"{API}/dashboard/expense-by-category",
                     params={"start": "2031-08-01", "end": "2031-08-31"}, timeout=15).json()
        food_in = next((x for x in r_in if x["category_id"] == food["id"]), None)
        assert food_in and food_in["total"] >= 42.42
        r_out = s.get(f"{API}/dashboard/expense-by-category",
                      params={"start": "2031-09-01", "end": "2031-09-30"}, timeout=15).json()
        food_out = next((x for x in r_out if x["category_id"] == food["id"]), None)
        assert food_out is None or food_out["total"] < 42.42
    finally:
        s.delete(f"{API}/transactions/{tx['id']}", timeout=15)
