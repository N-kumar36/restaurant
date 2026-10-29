import { test, describe, before, after } from "node:test";
import assert from "node:assert";
import http from "http";
import { app } from "../app.js";
import { prisma } from "../config/db.js";
import { calculateOrderTotals } from "../utils/calc.js";

let server: http.Server;
let baseUrl: string;

describe("Restaurant Backend API Test Suite", () => {
  before(async () => {
    await new Promise<void>((resolve) => {
      server = app.listen(5099, () => {
        baseUrl = "http://localhost:5099";
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    await prisma.$disconnect();
  });

  test("1. Precision Financial Calculations test", () => {
    // 420.00 subtotal at 5% tax and 2.5% service charge
    // subtotal cents = 42000
    // tax cents = round(42000 * 5 / 100) = 2100 = 21.00
    // service charge cents = round(42000 * 2.5 / 100) = 1050 = 10.50
    // total cents = 42000 + 2100 + 1050 = 45150 = 451.50
    const totals = calculateOrderTotals(42000, 5, 2.5);
    assert.strictEqual(totals.subtotal, 420);
    assert.strictEqual(totals.taxAmount, 21);
    assert.strictEqual(totals.serviceCharge, 10.5);
    assert.strictEqual(totals.totalAmount, 451.5);
  });

  test("2. Public Restaurant Profile endpoint GET /api/restaurants/:slug", async () => {
    const res = await fetch(`${baseUrl}/api/restaurants/saffron-ember`);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.restaurant.slug, "saffron-ember");
    assert.ok(body.restaurant.name.includes("Saffron"));
  });

  test("3. Digital Menu retrieval GET /api/restaurants/:slug/menu", async () => {
    const res = await fetch(`${baseUrl}/api/restaurants/saffron-ember/menu`);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.success, true);
    assert.ok(Array.isArray(body.categories));
    assert.ok(body.categories.length > 0);
    const firstCat = body.categories[0];
    assert.ok(firstCat.items.length > 0);
    assert.ok(firstCat.items[0].name);
  });

  test("4. Table validation GET /api/restaurants/:slug/tables/:tableNumber/validate", async () => {
    // Valid table
    const validRes = await fetch(`${baseUrl}/api/restaurants/saffron-ember/tables/T-01/validate`);
    assert.strictEqual(validRes.status, 200);
    const validBody = await validRes.json();
    assert.strictEqual(validBody.success, true);
    assert.strictEqual(validBody.valid, true);
    assert.strictEqual(validBody.table.tableNumber, "T-01");

    // Invalid table
    const invalidRes = await fetch(`${baseUrl}/api/restaurants/saffron-ember/tables/NON_EXISTENT_99/validate`);
    assert.strictEqual(invalidRes.status, 404);
    const invalidBody = await invalidRes.json();
    assert.strictEqual(invalidBody.valid, false);
  });

  test("5. Authentication flow: Login & protected /me endpoint", async () => {
    // Correct credentials
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "admin@saffronember.com",
        password: "Admin@123456",
      }),
    });
    assert.strictEqual(loginRes.status, 200);
    const loginData = await loginRes.json();
    assert.strictEqual(loginData.success, true);
    assert.ok(loginData.token);
    const token = loginData.token;

    // Check /me
    const meRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.strictEqual(meRes.status, 200);
    const meData = await meRes.json();
    assert.strictEqual(meData.success, true);
    assert.strictEqual(meData.user.email, "admin@saffronember.com");

    // Invalid credentials
    const badLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "admin@saffronember.com",
        password: "WrongPassword999",
      }),
    });
    assert.strictEqual(badLogin.status, 401);
  });

  test("6. Order creation, idempotency, and status lifecycle transitions", async () => {
    // First fetch a menu item id
    const menuRes = await fetch(`${baseUrl}/api/restaurants/saffron-ember/menu`);
    const menuData = await menuRes.json();
    const testItem = menuData.categories[0].items[0];

    const idempotencyKey = `test-idem-${Date.now()}`;

    // Place an order
    const orderPayload = {
      restaurantSlug: "saffron-ember",
      tableNumber: "T-02",
      customerName: "Ananya Deshmukh",
      customerPhone: "+91 98888 77777",
      orderType: "DINE_IN",
      paymentMethod: "CASH",
      idempotencyKey,
      items: [
        {
          menuItemId: testItem.id,
          quantity: 2,
          notes: "Extra napkins please",
        },
      ],
    };

    const createRes = await fetch(`${baseUrl}/api/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(orderPayload),
    });

    assert.strictEqual(createRes.status, 201);
    const createData = await createRes.json();
    assert.strictEqual(createData.success, true);
    const order = createData.order;
    assert.ok(order.id);
    assert.strictEqual(order.status, "PENDING");
    assert.strictEqual(order.table.tableNumber, "T-02");

    // Test Idempotency duplicate submission
    const duplicateRes = await fetch(`${baseUrl}/api/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(orderPayload),
    });
    assert.strictEqual(duplicateRes.status, 200);
    const duplicateData = await duplicateRes.json();
    assert.strictEqual(duplicateData.order.id, order.id);

    // Test Admin Status Transition: PENDING -> ACCEPTED
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "admin@saffronember.com",
        password: "Admin@123456",
      }),
    });
    const { token } = await loginRes.json();

    const acceptRes = await fetch(`${baseUrl}/api/admin/orders/${order.id}/status`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ status: "ACCEPTED" }),
    });
    assert.strictEqual(acceptRes.status, 200);
    const acceptData = await acceptRes.json();
    assert.strictEqual(acceptData.order.status, "ACCEPTED");

    // Test Invalid Transition: ACCEPTED directly to COMPLETED should fail
    const invalidTransitionRes = await fetch(`${baseUrl}/api/admin/orders/${order.id}/status`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ status: "COMPLETED" }),
    });
    assert.strictEqual(invalidTransitionRes.status, 400);

    // Test Valid Next Transition: ACCEPTED -> PREPARING
    const preparingRes = await fetch(`${baseUrl}/api/admin/orders/${order.id}/status`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ status: "PREPARING" }),
    });
    assert.strictEqual(preparingRes.status, 200);
    const preparingData = await preparingRes.json();
    assert.strictEqual(preparingData.order.status, "PREPARING");
  });
});

