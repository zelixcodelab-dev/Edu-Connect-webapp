# Seed/cleanup helper for UI test of SC settlement + table pagination (TEST_ data only)
import json, sys, requests
sys.path.insert(0, "/app/backend/tests")
from _creds import api_base
API = api_base()
s = requests.Session()
r = s.post(f"{API}/auth/login", json={"email": "admin@educonnect.app", "password": "Admin@12345"})
tok = r.json().get("token") or r.json().get("access_token")
if tok: s.headers["Authorization"] = f"Bearer {tok}"
STATE = "/tmp/ui_seed.json"
if sys.argv[1] == "seed":
    data = s.get(f"{API}/students").json()
    items = data if isinstance(data, list) else data.get("items") or data.get("students") or []
    acc = s.post(f"{API}/accounts", json={"name": "TEST_UI_SCAcc", "type": "bank", "opening_balance": 0}).json()
    ids = []
    for i in range(12):
        st = s.post(f"{API}/students", json={"name": f"TEST_UIStu_{i:02d}", "course": "Bachelor of Science Nursing Long Course", "college": "St Johns Medical College and Hospital Bangalore", "sc_out_fixed": 7500 if i == 0 else 0, "status": "enrolled", "home_office": "KM_BLR"}).json()
        ids.append(st["id"])
    json.dump({"acc": acc["id"], "ids": ids}, open(STATE, "w"))
    print("existing", len(items), "seeded", ids[0], acc["id"])
else:
    st = json.load(open(STATE))
    for i in st["ids"]:
        s.delete(f"{API}/students/{i}/sc-settlement")
        print(i, s.delete(f"{API}/students/{i}").status_code)
    print("acc", s.delete(f"{API}/accounts/{st['acc']}").status_code)
