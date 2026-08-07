"""Debug the 4 failed tests"""
import requests

BASE_URL = "https://saas-customizer.preview.emergentagent.com"

# First, get tokens
print("Getting tokens...")
response = requests.post(f"{BASE_URL}/api/auth/login", 
                        json={"email": "owner@educonnect.app", "password": "Owner@12345"})
platform_token = response.json().get("access_token")
print(f"Platform token: {platform_token[:20]}...")

response = requests.post(f"{BASE_URL}/api/auth/login",
                        json={"email": "admin@educonnect.app", "password": "Admin@12345"})
default_admin_token = response.json().get("access_token")
print(f"Default admin token: {default_admin_token[:20]}...")

# Get Globe tenant ID
response = requests.get(f"{BASE_URL}/api/platform/tenants",
                       headers={"Authorization": f"Bearer {platform_token}"})
tenants = response.json()["tenants"]
globe_tenant = next((t for t in tenants if "Globe" in t.get("name", "")), None)
if globe_tenant:
    globe_id = globe_tenant["id"]
    print(f"Globe tenant ID: {globe_id}")
else:
    print("No Globe tenant found")
    exit(1)

print("\n" + "="*80)
print("TEST 1: Login with old password after reset")
print("="*80)
try:
    response = requests.post(f"{BASE_URL}/api/auth/login",
                            json={"email": "admin@globeinstitute.com", "password": "Globe@12345"},
                            timeout=30)
    print(f"Status: {response.status_code}")
    print(f"Response: {response.text[:200]}")
except Exception as e:
    print(f"Error: {e}")

print("\n" + "="*80)
print("TEST 2: Login to suspended workspace")
print("="*80)
# First suspend
try:
    response = requests.patch(f"{BASE_URL}/api/platform/tenants/{globe_id}",
                             headers={"Authorization": f"Bearer {platform_token}"},
                             json={"status": "suspended"},
                             timeout=30)
    print(f"Suspend status: {response.status_code}")
    
    # Try to login
    response = requests.post(f"{BASE_URL}/api/auth/login",
                            json={"email": "admin@globeinstitute.com", "password": "Globe@99999"},
                            timeout=30)
    print(f"Login status: {response.status_code}")
    print(f"Response: {response.text[:200]}")
    
    # Set back to active
    response = requests.patch(f"{BASE_URL}/api/platform/tenants/{globe_id}",
                             headers={"Authorization": f"Bearer {platform_token}"},
                             json={"status": "active"},
                             timeout=30)
    print(f"Reactivate status: {response.status_code}")
except Exception as e:
    print(f"Error: {e}")

print("\n" + "="*80)
print("TEST 3: Tenant token on platform endpoint")
print("="*80)
try:
    response = requests.get(f"{BASE_URL}/api/platform/tenants",
                           headers={"Authorization": f"Bearer {default_admin_token}"},
                           timeout=30)
    print(f"Status: {response.status_code}")
    print(f"Response: {response.text[:200]}")
except Exception as e:
    print(f"Error: {e}")

print("\n" + "="*80)
print("TEST 4: No token on platform endpoint")
print("="*80)
try:
    response = requests.get(f"{BASE_URL}/api/platform/tenants", timeout=30)
    print(f"Status: {response.status_code}")
    print(f"Response: {response.text[:200]}")
except Exception as e:
    print(f"Error: {e}")
