"""
Comprehensive backend API testing for multi-tenant white-label CRM.
Tests authentication, platform console, data isolation, branding, and regression.
"""
import requests
import json
from typing import Dict, Optional

# Base URL from frontend/.env
BASE_URL = "https://saas-customizer.preview.emergentagent.com"

# Test credentials
PLATFORM_OWNER = {
    "email": "owner@educonnect.app",
    "password": "Owner@12345"
}

DEFAULT_ADMIN = {
    "email": "admin@educonnect.app",
    "password": "Admin@12345"
}

# Test results tracking
test_results = {
    "auth": [],
    "platform_console": [],
    "data_isolation": [],
    "branding": [],
    "regression": []
}

def log_test(category: str, test_name: str, passed: bool, details: str = ""):
    """Log test result"""
    result = "✅ PASS" if passed else "❌ FAIL"
    message = f"{result}: {test_name}"
    if details:
        message += f" - {details}"
    print(message)
    test_results[category].append({
        "test": test_name,
        "passed": passed,
        "details": details
    })

def make_request(method: str, endpoint: str, token: Optional[str] = None, 
                 data: Optional[Dict] = None, expect_error: bool = False):
    """Make HTTP request with optional Bearer token"""
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
        elif method == "PATCH":
            headers["Content-Type"] = "application/json"
            response = requests.patch(url, headers=headers, json=data, timeout=30)
        elif method == "DELETE":
            response = requests.delete(url, headers=headers, timeout=30)
        else:
            return None, f"Unsupported method: {method}"
        
        return response, None
    except Exception as e:
        return None, str(e)

# ============================================================================
# 1. AUTH TESTS
# ============================================================================

def test_auth():
    """Test authentication flows"""
    print("\n" + "="*80)
    print("1. AUTHENTICATION TESTS")
    print("="*80)
    
    global platform_token, default_admin_token, globe_admin_token
    platform_token = None
    default_admin_token = None
    globe_admin_token = None
    
    # Test 1.1: Platform owner login
    print("\n[1.1] Platform owner login")
    response, error = make_request("POST", "/api/auth/login", data=PLATFORM_OWNER)
    if error:
        log_test("auth", "Platform owner login", False, f"Request failed: {error}")
    elif response.status_code == 200:
        data = response.json()
        if data.get("scope") == "platform" and data.get("access_token"):
            platform_token = data["access_token"]
            log_test("auth", "Platform owner login returns access_token and scope=platform", True,
                    f"role={data.get('role')}")
        else:
            log_test("auth", "Platform owner login", False, 
                    f"Missing scope or token: {json.dumps(data, indent=2)}")
    else:
        log_test("auth", "Platform owner login", False, 
                f"Status {response.status_code}: {response.text}")
    
    # Test 1.2: Tenant admin login
    print("\n[1.2] Tenant admin login")
    response, error = make_request("POST", "/api/auth/login", data=DEFAULT_ADMIN)
    if error:
        log_test("auth", "Tenant admin login", False, f"Request failed: {error}")
    elif response.status_code == 200:
        data = response.json()
        has_token = "access_token" in data
        has_scope = data.get("scope") == "tenant"
        has_branding = "branding" in data and isinstance(data["branding"], dict)
        has_modules = "enabled_modules" in data and isinstance(data["enabled_modules"], list)
        
        if has_token and has_scope and has_branding and has_modules:
            default_admin_token = data["access_token"]
            log_test("auth", "Tenant admin login returns access_token, scope=tenant, branding, enabled_modules", 
                    True, f"app_name={data['branding'].get('app_name')}, modules={len(data['enabled_modules'])}")
        else:
            log_test("auth", "Tenant admin login", False,
                    f"Missing fields - token:{has_token}, scope:{has_scope}, branding:{has_branding}, modules:{has_modules}")
    else:
        log_test("auth", "Tenant admin login", False,
                f"Status {response.status_code}: {response.text}")
    
    # Test 1.3: GET /api/auth/me with platform token
    print("\n[1.3] GET /api/auth/me with platform token")
    if platform_token:
        response, error = make_request("GET", "/api/auth/me", token=platform_token)
        if error:
            log_test("auth", "GET /api/auth/me (platform)", False, f"Request failed: {error}")
        elif response.status_code == 200:
            data = response.json()
            if (data.get("role") == "platform_owner" and 
                data.get("scope") == "platform" and 
                "branding" in data):
                log_test("auth", "GET /api/auth/me (platform) returns role=platform_owner, scope=platform, branding", 
                        True)
            else:
                log_test("auth", "GET /api/auth/me (platform)", False,
                        f"Unexpected data: {json.dumps(data, indent=2)}")
        else:
            log_test("auth", "GET /api/auth/me (platform)", False,
                    f"Status {response.status_code}: {response.text}")
    else:
        log_test("auth", "GET /api/auth/me (platform)", False, "No platform token available")
    
    # Test 1.4: GET /api/auth/me with tenant token
    print("\n[1.4] GET /api/auth/me with tenant token")
    if default_admin_token:
        response, error = make_request("GET", "/api/auth/me", token=default_admin_token)
        if error:
            log_test("auth", "GET /api/auth/me (tenant)", False, f"Request failed: {error}")
        elif response.status_code == 200:
            data = response.json()
            if (data.get("scope") == "tenant" and 
                "branding" in data and 
                "enabled_modules" in data):
                log_test("auth", "GET /api/auth/me (tenant) returns scope=tenant, branding, enabled_modules", 
                        True)
            else:
                log_test("auth", "GET /api/auth/me (tenant)", False,
                        f"Missing fields: {json.dumps(data, indent=2)}")
        else:
            log_test("auth", "GET /api/auth/me (tenant)", False,
                    f"Status {response.status_code}: {response.text}")
    else:
        log_test("auth", "GET /api/auth/me (tenant)", False, "No tenant token available")
    
    # Test 1.5: Wrong password returns 401
    print("\n[1.5] Wrong password returns 401")
    response, error = make_request("POST", "/api/auth/login", 
                                   data={"email": PLATFORM_OWNER["email"], "password": "WrongPassword123"})
    if error:
        log_test("auth", "Wrong password returns 401", False, f"Request failed: {error}")
    elif response.status_code == 401:
        log_test("auth", "Wrong password returns 401", True)
    else:
        log_test("auth", "Wrong password returns 401", False,
                f"Expected 401, got {response.status_code}")
    
    # Test 1.6: POST /api/auth/register returns 403
    print("\n[1.6] POST /api/auth/register returns 403 (self-signup disabled)")
    response, error = make_request("POST", "/api/auth/register",
                                   data={"email": "test@example.com", "password": "Test@12345", "name": "Test User"})
    if error:
        log_test("auth", "POST /api/auth/register returns 403", False, f"Request failed: {error}")
    elif response.status_code == 403:
        log_test("auth", "POST /api/auth/register returns 403 (self-signup disabled)", True)
    else:
        log_test("auth", "POST /api/auth/register returns 403", False,
                f"Expected 403, got {response.status_code}")

# ============================================================================
# 2. PLATFORM CONSOLE TESTS
# ============================================================================

def test_platform_console():
    """Test platform console endpoints"""
    print("\n" + "="*80)
    print("2. PLATFORM CONSOLE TESTS")
    print("="*80)
    
    global globe_tenant_id, globe_admin_token
    globe_tenant_id = None
    globe_admin_token = None
    
    if not platform_token:
        print("⚠️  Skipping platform console tests - no platform token")
        return
    
    # Test 2.1: GET /api/platform/summary
    print("\n[2.1] GET /api/platform/summary")
    response, error = make_request("GET", "/api/platform/summary", token=platform_token)
    if error:
        log_test("platform_console", "GET /api/platform/summary", False, f"Request failed: {error}")
    elif response.status_code == 200:
        data = response.json()
        required_fields = ["companies", "active", "suspended", "total_users"]
        if all(field in data for field in required_fields):
            log_test("platform_console", "GET /api/platform/summary returns companies/active/suspended/total_users", 
                    True, f"companies={data['companies']}, active={data['active']}, total_users={data['total_users']}")
        else:
            log_test("platform_console", "GET /api/platform/summary", False,
                    f"Missing fields: {json.dumps(data, indent=2)}")
    else:
        log_test("platform_console", "GET /api/platform/summary", False,
                f"Status {response.status_code}: {response.text}")
    
    # Test 2.2: GET /api/platform/modules
    print("\n[2.2] GET /api/platform/modules")
    response, error = make_request("GET", "/api/platform/modules", token=platform_token)
    if error:
        log_test("platform_console", "GET /api/platform/modules", False, f"Request failed: {error}")
    elif response.status_code == 200:
        data = response.json()
        if "modules" in data and isinstance(data["modules"], list):
            log_test("platform_console", "GET /api/platform/modules returns list of modules", 
                    True, f"Found {len(data['modules'])} modules")
        else:
            log_test("platform_console", "GET /api/platform/modules", False,
                    f"Invalid response: {json.dumps(data, indent=2)}")
    else:
        log_test("platform_console", "GET /api/platform/modules", False,
                f"Status {response.status_code}: {response.text}")
    
    # Test 2.3: GET /api/platform/tenants
    print("\n[2.3] GET /api/platform/tenants")
    response, error = make_request("GET", "/api/platform/tenants", token=platform_token)
    if error:
        log_test("platform_console", "GET /api/platform/tenants", False, f"Request failed: {error}")
    elif response.status_code == 200:
        data = response.json()
        if "tenants" in data and isinstance(data["tenants"], list):
            edu_connect = any(t.get("name") == "Edu Connect" for t in data["tenants"])
            log_test("platform_console", "GET /api/platform/tenants includes 'Edu Connect'", 
                    edu_connect, f"Found {len(data['tenants'])} tenants")
        else:
            log_test("platform_console", "GET /api/platform/tenants", False,
                    f"Invalid response: {json.dumps(data, indent=2)}")
    else:
        log_test("platform_console", "GET /api/platform/tenants", False,
                f"Status {response.status_code}: {response.text}")
    
    # Test 2.4: POST /api/platform/tenants (create Globe Institute)
    print("\n[2.4] POST /api/platform/tenants (create Globe Institute)")
    new_tenant_data = {
        "name": "Globe Institute",
        "admin_email": "admin@globeinstitute.com",
        "admin_password": "Globe@12345",
        "admin_name": "Globe Admin",
        "branding": {
            "brand_color": "#2563eb"
        },
        "enabled_modules": ["overview", "settings", "users", "students", "accounts", "transactions"]
    }
    response, error = make_request("POST", "/api/platform/tenants", token=platform_token, data=new_tenant_data)
    if error:
        log_test("platform_console", "POST /api/platform/tenants creates Globe Institute", False, 
                f"Request failed: {error}")
    elif response.status_code == 201:
        data = response.json()
        globe_tenant_id = data.get("id")
        log_test("platform_console", "POST /api/platform/tenants creates Globe Institute", True,
                f"tenant_id={globe_tenant_id}")
    else:
        log_test("platform_console", "POST /api/platform/tenants creates Globe Institute", False,
                f"Status {response.status_code}: {response.text}")
    
    # Test 2.5: Login as Globe admin
    print("\n[2.5] Login as Globe admin")
    if globe_tenant_id:
        response, error = make_request("POST", "/api/auth/login",
                                       data={"email": "admin@globeinstitute.com", "password": "Globe@12345"})
        if error:
            log_test("platform_console", "Login as Globe admin", False, f"Request failed: {error}")
        elif response.status_code == 200:
            data = response.json()
            globe_admin_token = data.get("access_token")
            brand_color_match = data.get("branding", {}).get("brand_color") == "#2563eb"
            scope_match = data.get("scope") == "tenant"
            modules_present = "enabled_modules" in data
            
            if brand_color_match and scope_match and modules_present:
                log_test("platform_console", "Globe admin login: scope=tenant, brand_color=#2563eb, enabled_modules present",
                        True, f"modules count={len(data.get('enabled_modules', []))}")
            else:
                log_test("platform_console", "Globe admin login", False,
                        f"brand_color_match={brand_color_match}, scope={data.get('scope')}, modules={modules_present}")
        else:
            log_test("platform_console", "Login as Globe admin", False,
                    f"Status {response.status_code}: {response.text}")
    else:
        log_test("platform_console", "Login as Globe admin", False, "No Globe tenant ID available")
    
    # Test 2.6: PATCH /api/platform/tenants/{globe_id} (update name and add module)
    print("\n[2.6] PATCH /api/platform/tenants/{globe_id}")
    if globe_tenant_id:
        patch_data = {
            "name": "Globe Institute Updated",
            "enabled_modules": ["overview", "settings", "users", "students", "accounts", "transactions", "invoices"],
            "status": "active"
        }
        response, error = make_request("PATCH", f"/api/platform/tenants/{globe_tenant_id}",
                                       token=platform_token, data=patch_data)
        if error:
            log_test("platform_console", "PATCH /api/platform/tenants updates name and modules", False,
                    f"Request failed: {error}")
        elif response.status_code == 200:
            data = response.json()
            name_updated = data.get("name") == "Globe Institute Updated"
            status_active = data.get("status") == "active"
            log_test("platform_console", "PATCH /api/platform/tenants updates name and modules", 
                    name_updated and status_active,
                    f"name={data.get('name')}, status={data.get('status')}")
        else:
            log_test("platform_console", "PATCH /api/platform/tenants", False,
                    f"Status {response.status_code}: {response.text}")
    else:
        log_test("platform_console", "PATCH /api/platform/tenants", False, "No Globe tenant ID available")
    
    # Test 2.7: POST /api/platform/tenants/{globe_id}/reset-admin
    print("\n[2.7] POST /api/platform/tenants/{globe_id}/reset-admin")
    if globe_tenant_id:
        response, error = make_request("POST", f"/api/platform/tenants/{globe_tenant_id}/reset-admin",
                                       token=platform_token, data={"admin_password": "Globe@99999"})
        if error:
            log_test("platform_console", "POST reset-admin", False, f"Request failed: {error}")
        elif response.status_code == 200:
            log_test("platform_console", "POST reset-admin returns 200", True)
            
            # Test new password works
            print("  → Testing new password works")
            response, error = make_request("POST", "/api/auth/login",
                                          data={"email": "admin@globeinstitute.com", "password": "Globe@99999"})
            if response and response.status_code == 200:
                log_test("platform_console", "Login with new password works", True)
            else:
                log_test("platform_console", "Login with new password works", False,
                        f"Status {response.status_code if response else 'N/A'}")
            
            # Test old password fails
            print("  → Testing old password fails")
            response, error = make_request("POST", "/api/auth/login",
                                          data={"email": "admin@globeinstitute.com", "password": "Globe@12345"})
            if response and response.status_code == 401:
                log_test("platform_console", "Login with old password fails (401)", True)
            else:
                log_test("platform_console", "Login with old password fails", False,
                        f"Expected 401, got {response.status_code if response else 'N/A'}")
        else:
            log_test("platform_console", "POST reset-admin", False,
                    f"Status {response.status_code}: {response.text}")
    else:
        log_test("platform_console", "POST reset-admin", False, "No Globe tenant ID available")
    
    # Test 2.8: PATCH status to suspended, then login should fail
    print("\n[2.8] Suspend tenant and verify login fails")
    if globe_tenant_id:
        response, error = make_request("PATCH", f"/api/platform/tenants/{globe_tenant_id}",
                                       token=platform_token, data={"status": "suspended"})
        if response and response.status_code == 200:
            # Try to login as suspended admin
            response, error = make_request("POST", "/api/auth/login",
                                          data={"email": "admin@globeinstitute.com", "password": "Globe@99999"})
            if response and response.status_code == 403:
                log_test("platform_console", "Login to suspended workspace returns 403", True)
            else:
                log_test("platform_console", "Login to suspended workspace returns 403", False,
                        f"Expected 403, got {response.status_code if response else 'N/A'}")
            
            # Set back to active
            response, error = make_request("PATCH", f"/api/platform/tenants/{globe_tenant_id}",
                                          token=platform_token, data={"status": "active"})
            if response and response.status_code == 200:
                log_test("platform_console", "Set tenant back to active", True)
            else:
                log_test("platform_console", "Set tenant back to active", False,
                        f"Status {response.status_code if response else 'N/A'}")
        else:
            log_test("platform_console", "Suspend tenant", False,
                    f"Status {response.status_code if response else 'N/A'}")
    else:
        log_test("platform_console", "Suspend tenant test", False, "No Globe tenant ID available")
    
    # Test 2.9: Access control - tenant token cannot access platform endpoints
    print("\n[2.9] Access control: tenant token → 403 on platform endpoints")
    if default_admin_token:
        response, error = make_request("GET", "/api/platform/tenants", token=default_admin_token)
        if response and response.status_code == 403:
            log_test("platform_console", "Tenant token on platform endpoint returns 403", True)
        else:
            log_test("platform_console", "Tenant token on platform endpoint returns 403", False,
                    f"Expected 403, got {response.status_code if response else 'N/A'}")
    else:
        log_test("platform_console", "Access control test", False, "No tenant token available")
    
    # Test 2.10: Access control - no token returns 401
    print("\n[2.10] Access control: no token → 401 on platform endpoints")
    response, error = make_request("GET", "/api/platform/tenants")
    if response and response.status_code == 401:
        log_test("platform_console", "No token on platform endpoint returns 401", True)
    else:
        log_test("platform_console", "No token on platform endpoint returns 401", False,
                f"Expected 401, got {response.status_code if response else 'N/A'}")

# ============================================================================
# 3. DATA ISOLATION TESTS
# ============================================================================

def test_data_isolation():
    """Test data isolation between tenants"""
    print("\n" + "="*80)
    print("3. DATA ISOLATION TESTS")
    print("="*80)
    
    if not globe_admin_token:
        print("⚠️  Skipping data isolation tests - no Globe admin token")
        return
    
    # Re-login as Globe admin to get fresh token
    print("\n[3.1] Re-login as Globe admin")
    response, error = make_request("POST", "/api/auth/login",
                                   data={"email": "admin@globeinstitute.com", "password": "Globe@99999"})
    if response and response.status_code == 200:
        globe_token = response.json().get("access_token")
        log_test("data_isolation", "Re-login as Globe admin", True)
    else:
        log_test("data_isolation", "Re-login as Globe admin", False, "Cannot proceed with isolation tests")
        return
    
    # Test 3.2: Globe admin sees 20 seeded categories
    print("\n[3.2] Globe admin GET /api/categories (should have 20 seeded)")
    response, error = make_request("GET", "/api/categories", token=globe_token)
    if error:
        log_test("data_isolation", "Globe admin GET /api/categories", False, f"Request failed: {error}")
    elif response.status_code == 200:
        categories = response.json()
        if isinstance(categories, list) and len(categories) == 20:
            log_test("data_isolation", "Globe admin has exactly 20 seeded categories", True)
        else:
            log_test("data_isolation", "Globe admin has exactly 20 seeded categories", False,
                    f"Expected 20, got {len(categories) if isinstance(categories, list) else 'N/A'}")
    else:
        log_test("data_isolation", "Globe admin GET /api/categories", False,
                f"Status {response.status_code}: {response.text}")
    
    # Test 3.3: Globe admin sees 0 students
    print("\n[3.3] Globe admin GET /api/students (should have 0)")
    response, error = make_request("GET", "/api/students", token=globe_token)
    if error:
        log_test("data_isolation", "Globe admin GET /api/students", False, f"Request failed: {error}")
    elif response.status_code == 200:
        students = response.json()
        if isinstance(students, list) and len(students) == 0:
            log_test("data_isolation", "Globe admin has 0 students", True)
        else:
            log_test("data_isolation", "Globe admin has 0 students", False,
                    f"Expected 0, got {len(students) if isinstance(students, list) else 'N/A'}")
    else:
        log_test("data_isolation", "Globe admin GET /api/students", False,
                f"Status {response.status_code}: {response.text}")
    
    # Test 3.4: Create a category as Globe admin
    print("\n[3.4] Globe admin creates category 'GlobeOnly'")
    response, error = make_request("POST", "/api/categories", token=globe_token,
                                   data={"name": "GlobeOnly", "type": "income", "color": "#2563eb"})
    if error:
        log_test("data_isolation", "Globe admin creates category 'GlobeOnly'", False, f"Request failed: {error}")
    elif response.status_code in [200, 201]:
        log_test("data_isolation", "Globe admin creates category 'GlobeOnly'", True)
    else:
        log_test("data_isolation", "Globe admin creates category 'GlobeOnly'", False,
                f"Status {response.status_code}: {response.text}")
    
    # Test 3.5: Default company admin should NOT see GlobeOnly category
    print("\n[3.5] Default company admin should NOT see 'GlobeOnly' category")
    if default_admin_token:
        response, error = make_request("GET", "/api/categories", token=default_admin_token)
        if error:
            log_test("data_isolation", "Cross-tenant isolation verified", False, f"Request failed: {error}")
        elif response.status_code == 200:
            categories = response.json()
            if isinstance(categories, list):
                has_globe_only = any(c.get("name") == "GlobeOnly" for c in categories)
                if not has_globe_only:
                    log_test("data_isolation", "Cross-tenant isolation verified: 'GlobeOnly' NOT in default company", True)
                else:
                    log_test("data_isolation", "Cross-tenant isolation FAILED", False,
                            "GlobeOnly category visible in default company!")
            else:
                log_test("data_isolation", "Cross-tenant isolation test", False, "Invalid response format")
        else:
            log_test("data_isolation", "Cross-tenant isolation test", False,
                    f"Status {response.status_code}: {response.text}")
    else:
        log_test("data_isolation", "Cross-tenant isolation test", False, "No default admin token available")

# ============================================================================
# 4. BRANDING API TESTS
# ============================================================================

def test_branding():
    """Test branding API"""
    print("\n" + "="*80)
    print("4. BRANDING API TESTS")
    print("="*80)
    
    # Test 4.1: GET /api/branding (public, no auth)
    print("\n[4.1] GET /api/branding (public, no auth)")
    response, error = make_request("GET", "/api/branding")
    if error:
        log_test("branding", "GET /api/branding (public)", False, f"Request failed: {error}")
    elif response.status_code == 200:
        data = response.json()
        branding = data.get("branding", {})
        app_name = branding.get("app_name")
        if app_name == "Edu Connect":
            log_test("branding", "GET /api/branding returns app_name='Edu Connect'", True)
        else:
            log_test("branding", "GET /api/branding returns app_name='Edu Connect'", False,
                    f"Expected 'Edu Connect', got '{app_name}'")
    else:
        log_test("branding", "GET /api/branding (public)", False,
                f"Status {response.status_code}: {response.text}")
    
    # Test 4.2: PATCH /api/branding as super_admin
    print("\n[4.2] PATCH /api/branding as super_admin")
    if default_admin_token:
        patch_data = {
            "app_name": "Bright Future Academy",
            "brand_color": "#0ea5e9"
        }
        response, error = make_request("PATCH", "/api/branding", token=default_admin_token, data=patch_data)
        if error:
            log_test("branding", "PATCH /api/branding as super_admin", False, f"Request failed: {error}")
        elif response.status_code == 200:
            data = response.json()
            branding = data.get("branding", {})
            name_match = branding.get("app_name") == "Bright Future Academy"
            color_match = branding.get("brand_color") == "#0ea5e9"
            if name_match and color_match:
                log_test("branding", "PATCH /api/branding updates app_name and brand_color", True)
            else:
                log_test("branding", "PATCH /api/branding", False,
                        f"name_match={name_match}, color_match={color_match}")
        else:
            log_test("branding", "PATCH /api/branding as super_admin", False,
                    f"Status {response.status_code}: {response.text}")
    else:
        log_test("branding", "PATCH /api/branding as super_admin", False, "No default admin token")
    
    # Test 4.3: GET /api/branding/me reflects changes
    print("\n[4.3] GET /api/branding/me reflects changes")
    if default_admin_token:
        response, error = make_request("GET", "/api/branding/me", token=default_admin_token)
        if error:
            log_test("branding", "GET /api/branding/me reflects changes", False, f"Request failed: {error}")
        elif response.status_code == 200:
            data = response.json()
            branding = data.get("branding", {})
            can_edit = data.get("can_edit")
            name_match = branding.get("app_name") == "Bright Future Academy"
            if name_match and can_edit:
                log_test("branding", "GET /api/branding/me reflects changes and can_edit=true", True)
            else:
                log_test("branding", "GET /api/branding/me", False,
                        f"name_match={name_match}, can_edit={can_edit}")
        else:
            log_test("branding", "GET /api/branding/me", False,
                    f"Status {response.status_code}: {response.text}")
    else:
        log_test("branding", "GET /api/branding/me", False, "No default admin token")

# ============================================================================
# 5. REGRESSION TESTS
# ============================================================================

def test_regression():
    """Test existing modules still work"""
    print("\n" + "="*80)
    print("5. REGRESSION TESTS (existing modules)")
    print("="*80)
    
    if not default_admin_token:
        print("⚠️  Skipping regression tests - no default admin token")
        return
    
    endpoints = [
        "/api/categories",
        "/api/accounts",
        "/api/students",
        "/api/transactions",
        "/api/invoices",
        "/api/leads",
        "/api/users",
        "/api/dashboard/summary"
    ]
    
    for endpoint in endpoints:
        print(f"\n[5.x] GET {endpoint}")
        response, error = make_request("GET", endpoint, token=default_admin_token)
        if error:
            log_test("regression", f"GET {endpoint}", False, f"Request failed: {error}")
        elif response.status_code == 200:
            log_test("regression", f"GET {endpoint} returns 200", True)
        else:
            log_test("regression", f"GET {endpoint}", False,
                    f"Status {response.status_code}: {response.text[:200]}")

# ============================================================================
# MAIN TEST RUNNER
# ============================================================================

def print_summary():
    """Print test summary"""
    print("\n" + "="*80)
    print("TEST SUMMARY")
    print("="*80)
    
    total_passed = 0
    total_failed = 0
    
    for category, results in test_results.items():
        if not results:
            continue
        passed = sum(1 for r in results if r["passed"])
        failed = sum(1 for r in results if not r["passed"])
        total_passed += passed
        total_failed += failed
        
        print(f"\n{category.upper().replace('_', ' ')}:")
        print(f"  ✅ Passed: {passed}")
        print(f"  ❌ Failed: {failed}")
        
        if failed > 0:
            print(f"  Failed tests:")
            for r in results:
                if not r["passed"]:
                    print(f"    - {r['test']}")
                    if r["details"]:
                        print(f"      {r['details']}")
    
    print(f"\n{'='*80}")
    print(f"TOTAL: {total_passed} passed, {total_failed} failed")
    print(f"{'='*80}\n")

if __name__ == "__main__":
    print("="*80)
    print("MULTI-TENANT WHITE-LABEL CRM - BACKEND API TESTS")
    print(f"Base URL: {BASE_URL}")
    print("="*80)
    
    try:
        test_auth()
        test_platform_console()
        test_data_isolation()
        test_branding()
        test_regression()
    except KeyboardInterrupt:
        print("\n\n⚠️  Tests interrupted by user")
    except Exception as e:
        print(f"\n\n❌ Unexpected error: {e}")
        import traceback
        traceback.print_exc()
    finally:
        print_summary()
