#!/bin/bash
# ==============================================================================
# CAMPY APP - BACKEND SMOKE TEST SCRIPT
# File: backend/scripts/smoke-test.sh
# Tests: health -> register/login -> GET products -> create order ->
#        create transaction -> get orders/transactions -> wishlist add/remove ->
#        staff permissions (401/403) -> staff-login -> CRUD stok -> CRUD admin
# ==============================================================================

BASE_URL="${API_URL:-http://localhost:5001}"
PASS=0
FAIL=0

if [ -z "$CAMPY_ADMIN_EMAIL" ] || [ -z "$CAMPY_ADMIN_PASSWORD" ] || \
   [ -z "$CAMPY_PETUGAS_EMAIL" ] || [ -z "$CAMPY_PETUGAS_PASSWORD" ]; then
  echo "Set CAMPY_ADMIN_EMAIL, CAMPY_ADMIN_PASSWORD, CAMPY_PETUGAS_EMAIL, and CAMPY_PETUGAS_PASSWORD first."
  exit 2
fi

echo "================================================="
echo "🏕️  RUNNING CAMPY BACKEND SMOKE TESTS"
echo "Target: $BASE_URL"
echo "================================================="

assert_status() {
  local test_name="$1"
  local expected="$2"
  local actual="$3"
  if [ "$actual" -eq "$expected" ]; then
    echo "✅ [PASS] $test_name (HTTP $actual)"
    PASS=$((PASS + 1))
  else
    echo "❌ [FAIL] $test_name (Expected HTTP $expected, got $actual)"
    FAIL=$((FAIL + 1))
  fi
}

# 1. HEALTH CHECK
echo ""
echo "--- 1. Testing Health Check ---"
HEALTH_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/health")
assert_status "Health Check" 200 "$HEALTH_CODE"

# 2. GET PRODUCTS (PUBLIC)
echo ""
echo "--- 2. Testing Get Products (Public) ---"
PRODUCTS_RES=$(curl -s -w "\n%{http_code}" "$BASE_URL/api/products")
PRODUCTS_CODE=$(echo "$PRODUCTS_RES" | tail -n1)
assert_status "GET /api/products" 200 "$PRODUCTS_CODE"

PROD_ID=$(echo "$PRODUCTS_RES" | grep -o '"id":"[^"]*' | head -n1 | cut -d'"' -f4)
if [ -z "$PROD_ID" ]; then
  PROD_ID="prod-1"
fi
echo "Using Product ID: $PROD_ID"

# 3. REGISTER NEW USER
echo ""
echo "--- 3. Testing User Registration ---"
TIMESTAMP=$(date +%s)
TEST_EMAIL="smoke_test_${TIMESTAMP}@campy.test"
TEST_PASS="Password123!"

REG_RES=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/auth/register" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASS\",\"name\":\"Smoke Tester\",\"phone\":\"081234567890\"}")

REG_CODE=$(echo "$REG_RES" | tail -n1)
assert_status "POST /api/auth/register" 201 "$REG_CODE"

# 4. LOGIN USER
echo ""
echo "--- 4. Testing User Login ---"
LOGIN_RES=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASS\"}")

LOGIN_CODE=$(echo "$LOGIN_RES" | tail -n1)
LOGIN_BODY=$(echo "$LOGIN_RES" | sed '$d')
assert_status "POST /api/auth/login" 200 "$LOGIN_CODE"

USER_TOKEN=$(echo "$LOGIN_BODY" | grep -o '"accessToken":"[^"]*' | head -n1 | cut -d'"' -f4)

# 5. CHECKOUT CALCULATE (FROM DB PRODUCTS)
echo ""
echo "--- 5. Testing Checkout Calculate ---"
CALC_RES=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/checkout/calculate" \
  -H "Content-Type: application/json" \
  -d "{\"deliveryMethod\":\"delivery\",\"items\":[{\"productId\":\"$PROD_ID\",\"qty\":2}]}")

CALC_CODE=$(echo "$CALC_RES" | tail -n1)
assert_status "POST /api/checkout/calculate" 200 "$CALC_CODE"

# 6. PERMISSION CHECK: USER CANNOT ACCESS STAFF ROUTES
echo ""
echo "--- 6. Testing RBAC Permission Denials (401 / 403) ---"
UNAUTH_ADMIN_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/admins")
assert_status "GET /api/admins without token should be 401" 401 "$UNAUTH_ADMIN_CODE"

USER_FORBIDDEN_ADMIN_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/admins" \
  -H "Authorization: Bearer $USER_TOKEN")
assert_status "GET /api/admins with regular user token should be 403" 403 "$USER_FORBIDDEN_ADMIN_CODE"

USER_FORBIDDEN_STOCK_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/petugas/stock" \
  -H "Authorization: Bearer $USER_TOKEN")
assert_status "GET /api/petugas/stock with regular user token should be 403" 403 "$USER_FORBIDDEN_STOCK_CODE"

USER_FORBIDDEN_PROD_DEL=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "$BASE_URL/api/products/$PROD_ID" \
  -H "Authorization: Bearer $USER_TOKEN")
assert_status "DELETE /api/products with regular user token should be 403" 403 "$USER_FORBIDDEN_PROD_DEL"

# 7. WISHLIST ADD & REMOVE
echo ""
echo "--- 7. Testing Wishlist Add & Remove ---"
WISH_ADD_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/wishlist" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $USER_TOKEN" \
  -d "{\"productId\":\"$PROD_ID\"}")
if [ "$WISH_ADD_CODE" -eq 200 ] || [ "$WISH_ADD_CODE" -eq 201 ]; then
  echo "✅ [PASS] POST /api/wishlist (Add, HTTP $WISH_ADD_CODE)"
  PASS=$((PASS + 1))
else
  echo "❌ [FAIL] POST /api/wishlist (Expected HTTP 200 or 201, got $WISH_ADD_CODE)"
  FAIL=$((FAIL + 1))
fi

WISH_GET_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X GET "$BASE_URL/api/wishlist" \
  -H "Authorization: Bearer $USER_TOKEN")
assert_status "GET /api/wishlist" 200 "$WISH_GET_CODE"

WISH_DEL_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "$BASE_URL/api/wishlist/$PROD_ID" \
  -H "Authorization: Bearer $USER_TOKEN")
assert_status "DELETE /api/wishlist/:id" 200 "$WISH_DEL_CODE"

# 8. CREATE ORDER & CREATE TRANSACTION
echo ""
echo "--- 8. Testing Orders & Transactions ---"
ORDER_RES=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/orders" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $USER_TOKEN" \
  -d "{\"deliveryMethod\":\"pickup\",\"paymentMethod\":\"BCA\",\"items\":[{\"productId\":\"$PROD_ID\",\"qty\":1}]}")

ORDER_CODE=$(echo "$ORDER_RES" | tail -n1)
ORDER_BODY=$(echo "$ORDER_RES" | sed '$d')
assert_status "POST /api/orders" 201 "$ORDER_CODE"

ORDER_ID=$(echo "$ORDER_BODY" | grep -o '"id":"[^"]*' | head -n1 | cut -d'"' -f4)

if [ -n "$ORDER_ID" ]; then
  OVERSTOCK_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/orders" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $USER_TOKEN" \
    -d "{\"deliveryMethod\":\"pickup\",\"paymentMethod\":\"BCA\",\"items\":[{\"productId\":\"$PROD_ID\",\"qty\":999999}]}")
  assert_status "POST /api/orders rejects stock shortage" 400 "$OVERSTOCK_CODE"

  TRX_RES=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/transactions" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $USER_TOKEN" \
    -d "{\"orderId\":\"$ORDER_ID\",\"paymentMethod\":\"BCA\",\"status\":\"success\"}")

  TRX_CODE=$(echo "$TRX_RES" | tail -n1)
  assert_status "POST /api/transactions" 201 "$TRX_CODE"

  ORDERS_LIST_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/orders" \
    -H "Authorization: Bearer $USER_TOKEN")
  assert_status "GET /api/orders" 200 "$ORDERS_LIST_CODE"

  TRX_LIST_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/transactions" \
    -H "Authorization: Bearer $USER_TOKEN")
  assert_status "GET /api/transactions" 200 "$TRX_LIST_CODE"
fi

# 9. STAFF LOGIN AND CRUD
echo ""
echo "--- 9. Testing Staff Login and CRUD ---"
ADMIN_LOGIN_RES=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/auth/staff-login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$CAMPY_ADMIN_EMAIL\",\"password\":\"$CAMPY_ADMIN_PASSWORD\",\"role\":\"admin\"}")
ADMIN_LOGIN_CODE=$(echo "$ADMIN_LOGIN_RES" | tail -n1)
ADMIN_LOGIN_BODY=$(echo "$ADMIN_LOGIN_RES" | sed '$d')
assert_status "POST /api/auth/staff-login (admin)" 200 "$ADMIN_LOGIN_CODE"
ADMIN_TOKEN=$(echo "$ADMIN_LOGIN_BODY" | grep -o '"accessToken":"[^"]*' | head -n1 | cut -d'"' -f4)

STAFF_LOGIN_RES=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/auth/staff-login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$CAMPY_PETUGAS_EMAIL\",\"password\":\"$CAMPY_PETUGAS_PASSWORD\",\"role\":\"petugas\"}")
STAFF_LOGIN_CODE=$(echo "$STAFF_LOGIN_RES" | tail -n1)
STAFF_LOGIN_BODY=$(echo "$STAFF_LOGIN_RES" | sed '$d')
assert_status "POST /api/auth/staff-login (petugas)" 200 "$STAFF_LOGIN_CODE"
STAFF_TOKEN=$(echo "$STAFF_LOGIN_BODY" | grep -o '"accessToken":"[^"]*' | head -n1 | cut -d'"' -f4)

if [ -n "$STAFF_TOKEN" ]; then
  STOCK_RES=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/petugas/stock" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $STAFF_TOKEN" \
    -d "{\"name\":\"Smoke Stock $TIMESTAMP\",\"qty\":2,\"price\":1000}")
  STOCK_CODE=$(echo "$STOCK_RES" | tail -n1)
  STOCK_BODY=$(echo "$STOCK_RES" | sed '$d')
  assert_status "POST /api/petugas/stock" 201 "$STOCK_CODE"
  STOCK_ID=$(echo "$STOCK_BODY" | grep -o '"id":"[^"]*' | head -n1 | cut -d'"' -f4)
  if [ -n "$STOCK_ID" ]; then
    STOCK_UPDATE_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X PUT "$BASE_URL/api/petugas/stock/$STOCK_ID" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $STAFF_TOKEN" \
      -d '{"qty":3,"price":1200}')
    assert_status "PUT /api/petugas/stock/:id" 200 "$STOCK_UPDATE_CODE"
    STOCK_DELETE_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "$BASE_URL/api/petugas/stock/$STOCK_ID" \
      -H "Authorization: Bearer $STAFF_TOKEN")
    assert_status "DELETE /api/petugas/stock/:id" 200 "$STOCK_DELETE_CODE"
  else
    echo "❌ [FAIL] Could not read created stock item ID"
    FAIL=$((FAIL + 1))
  fi
fi

if [ -n "$ADMIN_TOKEN" ]; then
  ADMIN_EMAIL="smoke_admin_${TIMESTAMP}@campy.test"
  ADMIN_CREATE_RES=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/admins" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -d "{\"username\":\"Smoke Admin\",\"email\":\"$ADMIN_EMAIL\",\"password\":\"Password123!\",\"detail\":\"Smoke test\",\"location\":\"Test\"}")
  ADMIN_CREATE_CODE=$(echo "$ADMIN_CREATE_RES" | tail -n1)
  ADMIN_CREATE_BODY=$(echo "$ADMIN_CREATE_RES" | sed '$d')
  assert_status "POST /api/admins" 201 "$ADMIN_CREATE_CODE"
  CREATED_ADMIN_ID=$(echo "$ADMIN_CREATE_BODY" | grep -o '"id":"[^"]*' | head -n1 | cut -d'"' -f4)
  if [ -n "$CREATED_ADMIN_ID" ]; then
    ADMIN_UPDATE_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X PUT "$BASE_URL/api/admins/$CREATED_ADMIN_ID" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $ADMIN_TOKEN" \
      -d '{"detail":"Updated by smoke test"}')
    assert_status "PUT /api/admins/:id" 200 "$ADMIN_UPDATE_CODE"
    ADMIN_DELETE_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "$BASE_URL/api/admins/$CREATED_ADMIN_ID" \
      -H "Authorization: Bearer $ADMIN_TOKEN")
    assert_status "DELETE /api/admins/:id" 200 "$ADMIN_DELETE_CODE"
  else
    echo "❌ [FAIL] Could not read created admin ID"
    FAIL=$((FAIL + 1))
  fi
fi

echo ""
echo "================================================="
echo "📊 SMOKE TEST SUMMARY: PASS: $PASS | FAIL: $FAIL"
echo "================================================="
