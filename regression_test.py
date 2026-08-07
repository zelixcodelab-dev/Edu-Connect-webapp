"""
Focused REGRESSION test after backend/db.py change.
Verifies that defensive MONGO_URL/DB_NAME reading caused no regression.
"""
import requests
import json

BASE_URL = "https://saas-customizer.preview.emergentagent.com"

# Credentials from review_request
PLATFORM_OWNER = {"email": "owner@educonnect.app", "password": "Owner@12345"}
DEFAULT_ADMIN = {"email": "admin@educonnect.app", "password": "Admin@12345"}

def make_request(method, endpoint, token=None, data=None):
    """Make HTTP request"""
    url = f"{BASE_URL}{endpoint}"
    headers = {}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    
    try:
        if method == "GET":
            response = requests.get(url, headers=headers, timeout=30)
        elif method == "POST":
            headers["Content-Type"] = "application/json"
            response = requests.post(url, headers=headers, json=data, timeout=30)
        else:
            return None, f"Unsupported method: {method}"
        return response, None
    except Exception as e:
        return None, str(e)

def test_item(num, desc, passed, details=""):
    """Log test result"""
    status = "✅ PASS" if passed else "❌ FAIL"
    print(f"{num}. {status}: {desc}")
    if details:
        print(f"   {details}")
    return passed

# Track results
results = []

print("="*80)
print("FOCUSED REGRESSION TEST - backend/db.py change verification")
print(f"Base URL: {BASE_URL}")
print("="*80)

# 1. Platform owner login
print("\n[1] POST /api/auth/login (platform owner)")
response, error = make_request("POST", "/api/auth/login", data=PLATFORM_OWNER)
if error:
    results.append(test_item(1, "Platform owner login", False, f"Request failed: {error}"))
    platform_token = None
elif response.status_code == 200:
    data = response.json()
    platform_token = data.get("access_token")
    passed = data.get("scope") == "platform" and platform_token is not None
    results.append(test_item(1, "Platform owner login → 200, scope=platform, access_token", passed,
                            f"scope={data.get('scope')}, has_token={platform_token is not None}"))
else:
    results.append(test_item(1, "Platform owner login", False, f"Status {response.status_code}"))
    platform_token = None

# 1b. Tenant admin login
print("\n[1b] POST /api/auth/login (default company admin)")
response, error = make_request("POST", "/api/auth/login", data=DEFAULT_ADMIN)
if error:
    results.append(test_item("1b", "Tenant admin login", False, f"Request failed: {error}"))
    tenant_token = None
elif response.status_code == 200:
    data = response.json()
    tenant_token = data.get("access_token")
    has_branding = "branding" in data and isinstance(data["branding"], dict)
    has_modules = "enabled_modules" in data and isinstance(data["enabled_modules"], list)
    passed = (data.get("scope") == "tenant" and tenant_token and has_branding and has_modules)
    results.append(test_item("1b", "Tenant admin login → 200, scope=tenant, branding, enabled_modules", passed,
                            f"scope={data.get('scope')}, branding={has_branding}, modules={has_modules}"))
else:
    results.append(test_item("1b", "Tenant admin login", False, f"Status {response.status_code}"))
    tenant_token = None

# 2. GET /api/auth/me for platform token
print("\n[2] GET /api/auth/me (platform token)")
if platform_token:
    response, error = make_request("GET", "/api/auth/me", token=platform_token)
    if error:
        results.append(test_item(2, "GET /api/auth/me (platform)", False, f"Request failed: {error}"))
    elif response.status_code == 200:
        data = response.json()
        passed = data.get("scope") == "platform"
        results.append(test_item(2, "GET /api/auth/me (platform) → 200", passed,
                                f"scope={data.get('scope')}, role={data.get('role')}"))
    else:
        results.append(test_item(2, "GET /api/auth/me (platform)", False, f"Status {response.status_code}"))
else:
    results.append(test_item(2, "GET /api/auth/me (platform)", False, "No platform token"))

# 2b. GET /api/auth/me for tenant token
print("\n[2b] GET /api/auth/me (tenant token)")
if tenant_token:
    response, error = make_request("GET", "/api/auth/me", token=tenant_token)
    if error:
        results.append(test_item("2b", "GET /api/auth/me (tenant)", False, f"Request failed: {error}"))
    elif response.status_code == 200:
        data = response.json()
        passed = data.get("scope") == "tenant"
        results.append(test_item("2b", "GET /api/auth/me (tenant) → 200", passed,
                                f"scope={data.get('scope')}"))
    else:
        results.append(test_item("2b", "GET /api/auth/me (tenant)", False, f"Status {response.status_code}"))
else:
    results.append(test_item("2b", "GET /api/auth/me (tenant)", False, "No tenant token"))

# 3. Platform endpoints
print("\n[3] GET /api/platform/tenants (platform token)")
if platform_token:
    response, error = make_request("GET", "/api/platform/tenants", token=platform_token)
    if error:
        results.append(test_item(3, "GET /api/platform/tenants", False, f"Request failed: {error}"))
    elif response.status_code == 200:
        data = response.json()
        passed = "tenants" in data and isinstance(data["tenants"], list)
        results.append(test_item(3, "GET /api/platform/tenants → 200", passed,
                                f"Found {len(data.get('tenants', []))} tenants"))
    else:
        results.append(test_item(3, "GET /api/platform/tenants", False, f"Status {response.status_code}"))
else:
    results.append(test_item(3, "GET /api/platform/tenants", False, "No platform token"))

print("\n[3b] GET /api/platform/summary (platform token)")
if platform_token:
    response, error = make_request("GET", "/api/platform/summary", token=platform_token)
    if error:
        results.append(test_item("3b", "GET /api/platform/summary", False, f"Request failed: {error}"))
    elif response.status_code == 200:
        data = response.json()
        required = ["companies", "active", "suspended", "total_users"]
        passed = all(field in data for field in required)
        results.append(test_item("3b", "GET /api/platform/summary → 200", passed,
                                f"companies={data.get('companies')}, active={data.get('active')}"))
    else:
        results.append(test_item("3b", "GET /api/platform/summary", False, f"Status {response.status_code}"))
else:
    results.append(test_item("3b", "GET /api/platform/summary", False, "No platform token"))

# 4. Multi-tenant isolation
print("\n[4] GET /api/categories (tenant admin)")
if tenant_token:
    response, error = make_request("GET", "/api/categories", token=tenant_token)
    if error:
        results.append(test_item(4, "GET /api/categories", False, f"Request failed: {error}"))
    elif response.status_code == 200:
        categories = response.json()
        passed = isinstance(categories, list)
        results.append(test_item(4, "GET /api/categories → 200 (array)", passed,
                                f"Found {len(categories) if isinstance(categories, list) else 'N/A'} categories"))
        
        # 4b. Create category
        print("\n[4b] POST /api/categories (create RegCheck)")
        response, error = make_request("POST", "/api/categories", token=tenant_token,
                                      data={"name": "RegCheck", "type": "income"})
        if error:
            results.append(test_item("4b", "POST /api/categories (RegCheck)", False, f"Request failed: {error}"))
        elif response.status_code in [200, 201]:
            results.append(test_item("4b", "POST /api/categories → 200/201", True,
                                    f"Status {response.status_code}"))
            
            # 4c. Verify it appears
            print("\n[4c] Verify RegCheck appears in GET /api/categories")
            response, error = make_request("GET", "/api/categories", token=tenant_token)
            if response and response.status_code == 200:
                categories = response.json()
                has_regcheck = any(c.get("name") == "RegCheck" for c in categories)
                results.append(test_item("4c", "RegCheck appears in category list", has_regcheck))
            else:
                results.append(test_item("4c", "Verify RegCheck", False, "Cannot fetch categories"))
        else:
            results.append(test_item("4b", "POST /api/categories", False, f"Status {response.status_code}"))
    else:
        results.append(test_item(4, "GET /api/categories", False, f"Status {response.status_code}"))
else:
    results.append(test_item(4, "GET /api/categories", False, "No tenant token"))

# 5. Core endpoints
print("\n[5] Core endpoints (tenant admin)")
core_endpoints = [
    "/api/accounts",
    "/api/students",
    "/api/transactions",
    "/api/invoices",
    "/api/users",
    "/api/dashboard/summary"
]

if tenant_token:
    for endpoint in core_endpoints:
        response, error = make_request("GET", endpoint, token=tenant_token)
        if error:
            results.append(test_item(f"5.{endpoint}", f"GET {endpoint}", False, f"Request failed: {error}"))
        elif response.status_code == 200:
            results.append(test_item(f"5.{endpoint}", f"GET {endpoint} → 200", True))
        else:
            results.append(test_item(f"5.{endpoint}", f"GET {endpoint}", False, f"Status {response.status_code}"))
else:
    results.append(test_item(5, "Core endpoints", False, "No tenant token"))

# 6. Public branding
print("\n[6] GET /api/branding (no auth)")
response, error = make_request("GET", "/api/branding")
if error:
    results.append(test_item(6, "GET /api/branding (public)", False, f"Request failed: {error}"))
elif response.status_code == 200:
    data = response.json()
    branding = data.get("branding", {})
    has_app_name = "app_name" in branding
    results.append(test_item(6, "GET /api/branding → 200 with branding.app_name", has_app_name,
                            f"app_name={branding.get('app_name')}"))
else:
    results.append(test_item(6, "GET /api/branding (public)", False, f"Status {response.status_code}"))

# Summary
print("\n" + "="*80)
print("SUMMARY")
print("="*80)
passed_count = sum(1 for r in results if r)
total_count = len(results)
print(f"✅ PASSED: {passed_count}/{total_count}")
print(f"❌ FAILED: {total_count - passed_count}/{total_count}")

if passed_count == total_count:
    print("\n🎉 ALL REGRESSION TESTS PASSED - No issues from db.py change")
else:
    print("\n⚠️  SOME TESTS FAILED - Review failures above")
    failed_items = [i+1 for i, r in enumerate(results) if not r]
    print(f"Failed test numbers: {failed_items}")

print("="*80)
