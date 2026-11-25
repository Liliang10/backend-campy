/**
 * Cross-platform Node.js Smoke Test for Campy Backend
 * Usage: node backend/scripts/smoke-test.js
 */

const baseUrl = process.env.API_URL || 'http://localhost:5001';

let pass = 0;
let fail = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`✅ [PASS] ${message}`);
    pass++;
  } else {
    console.error(`❌ [FAIL] ${message}`);
    fail++;
  }
}

async function run() {
  console.log('=================================================');
  console.log(`🏕️  CAMPY BACKEND AUTOMATED SMOKE TEST`);
  console.log(`Target: ${baseUrl}`);
  console.log('=================================================\n');

  try {
    // 1. Health
    const healthRes = await fetch(`${baseUrl}/health`);
    assert(healthRes.status === 200, `Health Check: status ${healthRes.status}`);

    // 2. GET Products
    const prodRes = await fetch(`${baseUrl}/api/products`);
    const prodData = await prodRes.json();
    assert(prodRes.status === 200 && prodData.success, `GET /api/products: found ${prodData.count || prodData.data?.length} products`);

    // Pick first product from DB
    const firstProduct = prodData.data && prodData.data[0];
    const testProdId = firstProduct?.id || 'prod-1';
    console.log(`ℹ️  Using test product ID: "${testProdId}" (${firstProduct?.name})`);

    // 3. Register user
    const timestamp = Date.now();
    const testEmail = `smoke_${timestamp}@campy.test`;
    const testPass = 'Password123!';

    const regRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testEmail,
        password: testPass,
        name: 'Smoke Tester',
        phone: '081234567890',
      }),
    });
    const regData = await regRes.json();
    assert(regRes.status === 201 && regData.success, `POST /api/auth/register: status ${regRes.status}`);

    // 4. Login user
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail, password: testPass }),
    });
    const loginData = await loginRes.json();
    assert(loginRes.status === 200 && loginData.data?.accessToken, `POST /api/auth/login: token received`);

    const token = loginData.data?.accessToken;
    const authHeaders = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    };

    // 5. Profile Check
    const profRes = await fetch(`${baseUrl}/api/auth/profile`, { headers: authHeaders });
    const profData = await profRes.json();
    assert(profRes.status === 200 && profData.data?.email === testEmail, `GET /api/auth/profile: verified email`);

    // 6. Checkout calculate (DB-backed)
    const calcRes = await fetch(`${baseUrl}/api/checkout/calculate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deliveryMethod: 'delivery',
        items: [{ productId: testProdId, qty: 2 }],
      }),
    });
    const calcData = await calcRes.json();
    assert(calcRes.status === 200 && calcData.data?.deliveryFee === 20000, `POST /api/checkout/calculate: total Rp ${calcData.data?.total}`);

    // 7. RBAC Denials for regular user (401 / 403)
    const unauthRes = await fetch(`${baseUrl}/api/admins`);
    assert(unauthRes.status === 401, `GET /api/admins without token: 401 Unauthorized`);

    const userAdminRes = await fetch(`${baseUrl}/api/admins`, { headers: authHeaders });
    assert(userAdminRes.status === 403, `GET /api/admins with user token: 403 Forbidden`);

    const userStockRes = await fetch(`${baseUrl}/api/petugas/stock`, { headers: authHeaders });
    assert(userStockRes.status === 403, `GET /api/petugas/stock with user token: 403 Forbidden`);

    const userDelProdRes = await fetch(`${baseUrl}/api/products/${testProdId}`, {
      method: 'DELETE',
      headers: authHeaders,
    });
    assert(userDelProdRes.status === 403, `DELETE /api/products with user token: 403 Forbidden`);

    // 8. Wishlist
    const wishAddRes = await fetch(`${baseUrl}/api/wishlist`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ productId: testProdId }),
    });
    const wishAddData = await wishAddRes.json();
    if (![200, 201].includes(wishAddRes.status)) {
      console.warn('Wishlist add error details:', wishAddData);
    }
    assert([200, 201].includes(wishAddRes.status), `POST /api/wishlist: status ${wishAddRes.status}`);

    const wishGetRes = await fetch(`${baseUrl}/api/wishlist`, { headers: authHeaders });
    const wishGetData = await wishGetRes.json();
    assert(wishGetRes.status === 200 && wishGetData.data?.length > 0, `GET /api/wishlist: ${wishGetData.data?.length} item(s)`);

    const wishDelRes = await fetch(`${baseUrl}/api/wishlist/${testProdId}`, {
      method: 'DELETE',
      headers: authHeaders,
    });
    assert(wishDelRes.status === 200, `DELETE /api/wishlist/:id: status ${wishDelRes.status}`);

    // 9. Orders & Transactions
    const orderRes = await fetch(`${baseUrl}/api/orders`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        deliveryMethod: 'pickup',
        paymentMethod: 'BCA',
        rentalDurationDays: 3,
        items: [{ productId: testProdId, qty: 1 }],
      }),
    });
    const orderData = await orderRes.json();
    if (orderRes.status !== 201) {
      console.warn('Order create error details:', orderData);
    }
    assert(orderRes.status === 201 && orderData.data?.id, `POST /api/orders: order ID ${orderData.data?.id}`);
    const createdDuration = orderData.data?.rental_duration_days ?? orderData.data?.rentalDurationDays;
    const createdDeadline = orderData.data?.return_deadline ?? orderData.data?.returnDeadline;
    assert(createdDuration === 3 && createdDeadline, `POST /api/orders: 3-day rental deadline ${createdDeadline}`);

    const orderId = orderData.data?.id;
    if (orderId) {
      // 10. Transaction
      const trxRes = await fetch(`${baseUrl}/api/transactions`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          orderId,
          paymentMethod: 'BCA',
          status: 'success',
        }),
      });
      const trxData = await trxRes.json();
      assert(trxRes.status === 201 && trxData.data?.amount === orderData.data?.total, `POST /api/transactions: matched order total (${trxData.data?.amount})`);

      // 11. Fetch orders list
      const getOrdersRes = await fetch(`${baseUrl}/api/orders`, { headers: authHeaders });
      const getOrdersData = await getOrdersRes.json();
      assert(getOrdersRes.status === 200 && getOrdersData.data?.some(o => o.id === orderId), `GET /api/orders: contains created order`);
      assert(getOrdersData.data?.some(o => o.id === orderId && o.rentalDurationDays === 3 && o.returnDeadline), `GET /api/orders: includes rental duration and return deadline`);

      // 12. Fetch transactions list
      const getTrxRes = await fetch(`${baseUrl}/api/transactions`, { headers: authHeaders });
      const getTrxData = await getTrxRes.json();
      assert(getTrxRes.status === 200 && getTrxData.data?.some(t => t.order_id === orderId), `GET /api/transactions: contains created transaction`);
    }

  } catch (err) {
    console.error('Smoke test execution error:', err);
    fail++;
  }

  console.log('\n=================================================');
  console.log(`📊 SMOKE TEST SUMMARY: PASS: ${pass} | FAIL: ${fail}`);
  console.log('=================================================');

  if (fail > 0) process.exit(1);
}

run();
