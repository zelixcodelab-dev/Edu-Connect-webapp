# SC Settlement (Mark SC Settled) — super admin only, single linked income credit
import uuid
import pytest
import requests

from _creds import api_base

API = api_base()
ADMIN = ("admin@educonnect.app", "Admin@12345")
OFFICE = ("office@educonnect.app", "Office@12345")


def _login(email, pwd):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": email, "password": pwd}, timeout=20)
    if r.status_code != 200:
        pytest.skip(f"login failed {email}: {r.status_code}")
    tok = (r.json() or {}).get("token") or (r.json() or {}).get("access_token")
    if tok:
        s.headers["Authorization"] = f"Bearer {tok}"
    return s


@pytest.fixture(scope="module")
def admin():
    return _login(*ADMIN)


@pytest.fixture(scope="module")
def office():
    return _login(*OFFICE)


@pytest.fixture(scope="module")
def setup(admin):
    tag = uuid.uuid4().hex[:6]
    acc = admin.post(f"{API}/accounts", json={"name": f"TEST_SCAcc_{tag}", "type": "bank", "opening_balance": 1000}).json()
    st = admin.post(f"{API}/students", json={"name": f"TEST_SCStu_{tag}", "sc_out_fixed": 5000, "status": "enrolled", "home_office": "KM_BLR"})
    assert st.status_code in (200, 201), st.text
    stu = st.json()
    yield {"acc": acc, "stu": stu}
    admin.delete(f"{API}/students/{stu['id']}/sc-settlement")
    admin.delete(f"{API}/students/{stu['id']}")
    admin.delete(f"{API}/accounts/{acc['id']}")


def _bal(admin, acc_id):
    return next(a for a in admin.get(f"{API}/accounts").json() if a["id"] == acc_id)["current_balance"]


def _sc_txs(admin, sid):
    r = admin.get(f"{API}/transactions", params={"limit": 1000})
    data = r.json()
    items = data if isinstance(data, list) else data.get("items") or data.get("transactions") or []
    return [t for t in items if t.get("linked_sc_settlement_student_id") == sid]


class TestScSettlement:
    def test_student_sc_earned(self, admin, setup):
        s = admin.get(f"{API}/students/{setup['stu']['id']}").json()
        assert s["sc_earned_effective"] == 5000
        assert s["sc_settled"] is False

    def test_settle_creates_one_credit(self, admin, setup):
        sid, aid = setup["stu"]["id"], setup["acc"]["id"]
        b0 = _bal(admin, aid)
        r = admin.put(f"{API}/students/{sid}/sc-settlement", json={"amount": 5000, "account_id": aid, "date": "2026-01-15", "payment_mode": "bank_transfer"})
        assert r.status_code == 200, r.text
        assert r.json()["sc_settlement"]["amount"] == 5000
        assert _bal(admin, aid) == b0 + 5000
        txs = _sc_txs(admin, sid)
        assert len(txs) == 1
        assert txs[0]["type"] == "income"
        assert txs[0]["description"].startswith("SC received from college — TEST_SCStu_")
        s = admin.get(f"{API}/students/{sid}").json()
        assert s["sc_settled"] is True and s["sc_settlement"]["account_id"] == aid

    def test_list_has_sc_settled_flag(self, admin, setup):
        r = admin.get(f"{API}/students")
        data = r.json()
        items = data if isinstance(data, list) else data.get("items") or data.get("students") or []
        me = [x for x in items if x["id"] == setup["stu"]["id"]]
        assert me and me[0]["sc_settled"] is True

    def test_edit_replaces_credit(self, admin, setup):
        sid, aid = setup["stu"]["id"], setup["acc"]["id"]
        b0 = _bal(admin, aid)
        r = admin.put(f"{API}/students/{sid}/sc-settlement", json={"amount": 4200, "account_id": aid, "date": "2026-01-16"})
        assert r.status_code == 200
        txs = _sc_txs(admin, sid)
        assert len(txs) == 1 and txs[0]["amount"] == 4200
        assert _bal(admin, aid) == b0 - 800

    def test_office_admin_forbidden_and_masked(self, office, setup):
        sid, aid = setup["stu"]["id"], setup["acc"]["id"]
        r = office.put(f"{API}/students/{sid}/sc-settlement", json={"amount": 10, "account_id": aid, "date": "2026-01-16"})
        assert r.status_code == 403
        r = office.delete(f"{API}/students/{sid}/sc-settlement")
        assert r.status_code == 403
        g = office.get(f"{API}/students/{sid}")
        if g.status_code == 200:
            assert "sc_settlement" not in g.json()

    def test_validation(self, admin, setup):
        sid = setup["stu"]["id"]
        assert admin.put(f"{API}/students/{sid}/sc-settlement", json={"amount": 0, "account_id": setup["acc"]["id"], "date": "2026-01-16"}).status_code == 422
        assert admin.put(f"{API}/students/{sid}/sc-settlement", json={"amount": 10, "account_id": "nope", "date": "2026-01-16"}).status_code == 404
        assert admin.put(f"{API}/students/nope/sc-settlement", json={"amount": 10, "account_id": setup["acc"]["id"], "date": "2026-01-16"}).status_code == 404
        assert len(_sc_txs(admin, sid)) == 1

    def test_delete_tx_clears_settled(self, admin, setup):
        sid, aid = setup["stu"]["id"], setup["acc"]["id"]
        tx = _sc_txs(admin, sid)[0]
        assert admin.delete(f"{API}/transactions/{tx['id']}").status_code == 200
        s = admin.get(f"{API}/students/{sid}").json()
        assert s["sc_settled"] is False and not s.get("sc_settlement")

    def test_undo_removes_credit(self, admin, setup):
        sid, aid = setup["stu"]["id"], setup["acc"]["id"]
        admin.put(f"{API}/students/{sid}/sc-settlement", json={"amount": 5000, "account_id": aid, "date": "2026-01-15"})
        b0 = _bal(admin, aid)
        assert admin.delete(f"{API}/students/{sid}/sc-settlement").status_code == 200
        assert _sc_txs(admin, sid) == []
        assert _bal(admin, aid) == b0 - 5000
        assert admin.get(f"{API}/students/{sid}").json()["sc_settled"] is False
