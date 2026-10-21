# Helper: python _toggle_modules.py off k1,k2 | python _toggle_modules.py restore
import os, sys, requests
B = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
TID = "3b5e3f1f-dba9-4a89-a201-c2fdb24372ef"
FULL = ['overview', 'settings', 'users', 'quick_entry', 'transactions', 'accounts', 'invoices', 'clients', 'students', 'leads', 'leave', 'expense_requests', 'colleges', 'admission_revenue', 'agents', 'messages', 'activity', 'categories', 'office_overview', 'staff', 'attendance', 'academic_year', 'google_sheets', 'passkeys', 'pin_lock', 'sc_report', 'celebrations', 'product_tour']
tok = requests.post(f"{B}/api/auth/login", json={"email": "owner@educonnect.app", "password": "Owner@12345"}).json()["access_token"]
h = {"Authorization": f"Bearer {tok}"}
mods = FULL if sys.argv[1] == "restore" else [m for m in FULL if m not in sys.argv[2].split(",")]
r = requests.patch(f"{B}/api/platform/tenants/{TID}", json={"enabled_modules": mods}, headers=h)
print(r.status_code, len(r.json().get("enabled_modules", [])))
