import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kawang-store-fulfillment-"));
process.env.DATABASE_PATH = path.join(tmpDir, "test.db");
process.env.JWT_SECRET = "store-fulfillment-test-secret";
process.env.ADMIN_USERNAME = "admin";
process.env.ADMIN_PASSWORD = "test-password";
process.env.KAWANG_SKIP_LISTEN = "1";
process.env.APP_URL = "https://key.example.com";

const {
  DujiaoAdminClient,
  buildStoreDelivery,
  collectDujiaoFulfillmentTargets,
  fulfillmentMatchesTask,
  normalizeDujiaoBaseUrl
} = await import("../shared/src/store-fulfillment.js");
const { getDb } = await import("../shared/src/database.js");
const { encryptText } = await import("../shared/src/secure.js");
const { createStoreFulfillmentRunner } = await import("../shared/src/store-fulfillment-runner.js");

const db = getDb();
let app;

after(async () => {
  if (app) await app.close();
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function envelope(data, extra = {}) {
  return new Response(JSON.stringify({ status_code: 0, msg: "success", data, ...extra }), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

test("Dujiao helpers preserve parent and fulfillment target identities", () => {
  assert.equal(normalizeDujiaoBaseUrl("https://shop.example.com///"), "https://shop.example.com");
  const targets = collectDujiaoFulfillmentTargets({
    id: 1,
    order_no: "DJ100",
    status: "partially_delivered",
    children: [{
      id: 11,
      order_no: "DJ100-1",
      status: "fulfilling",
      items: [{ id: 101, product_id: 100, sku_id: 8, title: { "zh-CN": "PLUS" }, quantity: 2, fulfillment_type: "manual" }]
    }]
  });
  assert.deepEqual(targets[0], {
    orderId: "11",
    orderNo: "DJ100-1",
    parentOrderId: "1",
    parentOrderNo: "DJ100",
    status: "fulfilling",
    fulfillment: null,
    items: [{ id: "101", productId: "100", skuId: "8", title: "PLUS", quantity: 2, fulfillmentType: "manual" }]
  });

  const delivery = buildStoreDelivery("task-1", "DJ100", "DJ100-1", ["PLUS-A", "PLUS-B"], "https://key.example.com");
  assert.equal(delivery.payload, "1.PLUS-A\n2.PLUS-B\n提交网址：https://key.example.com");
  assert.equal(fulfillmentMatchesTask({ payload: delivery.payload }, "task-1", ["PLUS-A", "PLUS-B"], delivery.payload), true);
  assert.equal(fulfillmentMatchesTask({ payload: "1.OTHER\n提交网址：https://key.example.com" }, "task-1", ["PLUS-A", "PLUS-B"], delivery.payload), false);
  assert.equal(fulfillmentMatchesTask({ delivery_data: delivery.deliveryData }, "task-1", ["PLUS-A", "PLUS-B"]), true);
  assert.equal(fulfillmentMatchesTask({ delivery_data: delivery.deliveryData }, "task-1", ["PLUS-A", "PLUS-C"]), false);
});

test("admin UI exposes the store fulfillment console and card order search", async () => {
  const { JSDOM } = await import("jsdom");
  const html = fs.readFileSync(path.resolve("admin/index.html"), "utf8");
  const script = fs.readFileSync(path.resolve("admin/app.js"), "utf8");
  const dom = new JSDOM(html, { url: "http://127.0.0.1:4174/", runScripts: "outside-only" });
  const requestedUrls = [];
  dom.window.fetch = async (url) => {
    requestedUrls.push(String(url));
    if (String(url).includes("/api/admin/store-fulfillment/tasks")) {
      return new Response(JSON.stringify({ items: [] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (String(url).includes("/api/admin/extension-deliveries")) {
      return new Response(JSON.stringify({ items: [], nextCursor: null }), { status: 200, headers: { "content-type": "application/json" } });
    }
    throw new Error(`unexpected UI request: ${url}`);
  };
  dom.window.alert = () => {};
  dom.window.confirm = () => true;
  dom.window.eval(script);
  const nav = dom.window.document.querySelector('[data-tab="store-fulfillment"]');
  nav.click();
  const panel = dom.window.document.querySelector('[data-panel="store-fulfillment"]');
  assert.equal(panel.classList.contains("hidden"), false);
  assert.ok(panel.querySelector("#store-settings-form"));
  assert.ok(panel.querySelector("#store-mapping-form"));
  assert.ok(panel.querySelector("#store-task-list"));
  const storeRefresh = panel.querySelector("#store-task-list-refresh-btn");
  assert.ok(storeRefresh);
  storeRefresh.click();
  const extensionRefresh = dom.window.document.querySelector("#extension-delivery-list-refresh");
  assert.ok(extensionRefresh);
  extensionRefresh.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(requestedUrls.some((url) => url.includes("/api/admin/store-fulfillment/tasks")));
  assert.ok(requestedUrls.some((url) => url.includes("/api/admin/extension-deliveries?limit=100")));
  assert.match(panel.querySelector("#store-task-result").textContent, /商城交付列表已刷新/);
  assert.match(dom.window.document.querySelector("#extension-delivery-list-result").textContent, /扩展交付列表已刷新/);
  assert.ok(dom.window.document.querySelector("#cdkey-filter-keyword"));
  dom.window.close();
});

test("Dujiao client relogs once after an expired JWT", async () => {
  let loginCount = 0;
  let orderCount = 0;
  const client = new DujiaoAdminClient({
    baseUrl: "https://shop.example.com",
    username: "service",
    password: "secret",
    fetchImpl: async (url) => {
      if (url.endsWith("/api/v1/admin/login")) {
        loginCount += 1;
        return envelope({ requires_totp: false, token: `token-${loginCount}` });
      }
      orderCount += 1;
      if (orderCount === 1) {
        return new Response(JSON.stringify({ status_code: 401, msg: "unauthorized" }), { status: 401 });
      }
      return envelope([], { pagination: { total_page: 1 } });
    }
  });
  const result = await client.listOrders({ status: "fulfilling" });
  assert.equal(result.items.length, 0);
  assert.equal(loginCount, 2);
  assert.equal(orderCount, 2);
});

test("Dujiao client relogs when the API returns a business-level invalid-token response", async () => {
  let loginCount = 0;
  let orderCount = 0;
  const client = new DujiaoAdminClient({
    baseUrl: "https://shop.example.com",
    username: "service",
    password: "secret",
    fetchImpl: async (url) => {
      if (url.endsWith("/api/v1/admin/login")) {
        loginCount += 1;
        return envelope({ requires_totp: false, token: `token-${loginCount}` });
      }
      orderCount += 1;
      if (orderCount === 1) {
        return new Response(JSON.stringify({ status_code: 1, msg: "无效的 token" }), { status: 200 });
      }
      return envelope([], { pagination: { total_page: 1 } });
    }
  });
  const result = await client.listOrders({ status: "fulfilling" });
  assert.equal(result.items.length, 0);
  assert.equal(loginCount, 2);
  assert.equal(orderCount, 2);
});

test("runner issues one active manual CDK per purchased unit and delivers idempotently", async () => {
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE store_fulfillment_settings
    SET base_url = ?, admin_username = ?, admin_password = ?, enabled = 1,
        poll_interval_seconds = 30, updated_at = ?, updated_by = 'test'
    WHERE id = 'default'
  `).run("https://shop.example.com", "service", encryptText("secret"), now);
  db.prepare(`
    INSERT INTO store_product_mappings (
      id, product_id, sku_id, product_title, manual_type, site_id, prefix, enabled, created_at, updated_at, updated_by
    ) VALUES ('map-100', '100', '0', 'PLUS', 'PLUS', 'site_demo', 'PLUS', 1, ?, ?, 'test')
  `).run(now, now);

  let fulfillmentBody;
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const parsed = new URL(url);
    if (parsed.pathname === "/api/v1/admin/login") return envelope({ requires_totp: false, token: "jwt" });
    if (parsed.pathname === "/api/v1/admin/orders") {
      if (parsed.searchParams.get("status") === "fulfilling") {
        return envelope([{
          id: 1,
          order_no: "DJ100",
          status: "fulfilling",
          children: [{
            id: 11,
            order_no: "DJ100-1",
            status: "fulfilling",
            fulfillment: null,
            items: [{ id: 101, product_id: 100, sku_id: 8, title: { "zh-CN": "PLUS" }, quantity: 2, fulfillment_type: "manual" }]
          }]
        }], { pagination: { page: 1, total_page: 1 } });
      }
      return envelope([], { pagination: { page: 1, total_page: 1 } });
    }
    if (parsed.pathname === "/api/v1/admin/orders/11") {
      return envelope({ id: 11, order_no: "DJ100-1", status: "fulfilling", fulfillment: null });
    }
    if (parsed.pathname === "/api/v1/admin/fulfillments") {
      fulfillmentBody = JSON.parse(options.body);
      return envelope({ id: 900, order_id: 11, status: "delivered", delivery_data: fulfillmentBody.delivery_data });
    }
    throw new Error(`unexpected request: ${url}`);
  };

  try {
    const runner = createStoreFulfillmentRunner({ db, redeemUrl: "https://key.example.com", workerId: "test-worker", logger: { error() {} } });
    const first = await runner.tick({ force: true });
    assert.equal(first.accepted, true);
    assert.equal(first.discovered, 1);
    assert.equal(first.processed, 1);

    const task = db.prepare("SELECT * FROM store_fulfillment_tasks WHERE remote_order_id = '11'").get();
    assert.equal(task.status, "succeeded");
    const cards = JSON.parse(task.cdkeys_json);
    assert.equal(cards.length, 2);
    const storedCards = db.prepare("SELECT * FROM cdkeys WHERE store_fulfillment_task_id = ? ORDER BY public_key").all(task.id);
    assert.equal(storedCards.length, 2);
    assert.ok(storedCards.every((item) => item.status === "active" && item.origin === "store_order"));
    assert.ok(storedCards.every((item) => item.store_order_no === "DJ100" && item.store_fulfillment_target_no === "DJ100-1"));
    assert.equal("delivery_data" in fulfillmentBody, false);
    assert.equal(
      fulfillmentBody.payload,
      `${cards.map((item, index) => `${index + 1}.${item.publicKey}`).join("\n")}\n提交网址：https://key.example.com`
    );
    assert.doesNotMatch(fulfillmentBody.payload, /task_id|schema_version|fulfillment_target_no|store_order_no/);

    const second = await runner.tick({ force: true });
    assert.equal(second.discovered, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM store_fulfillment_tasks").get().count, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM cdkeys WHERE origin = 'store_order'").get().count, 2);

    const blocked = runner.createTask({
      orderId: "22",
      orderNo: "DJ200-1",
      parentOrderId: "2",
      parentOrderNo: "DJ200",
      status: "fulfilling",
      items: [{ id: "202", productId: "999", skuId: "0", title: "未映射", quantity: 1, fulfillmentType: "manual" }]
    });
    assert.equal(blocked.status, "blocked");
    assert.match(blocked.last_error, /未配置商品映射/);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM cdkeys WHERE store_fulfillment_task_id = ?").get(blocked.id).count, 0);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("runner reuses the same cards when a timed-out delivery is later confirmed", async () => {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO store_product_mappings (
      id, product_id, sku_id, product_title, manual_type, site_id, prefix, enabled, created_at, updated_at, updated_by
    ) VALUES ('map-300', '300', '0', 'x5', 'x5', 'site_demo', 'X5', 1, ?, ?, 'test')
  `).run(now, now);
  db.prepare("UPDATE store_fulfillment_settings SET enabled = 1, last_sync_at = NULL, updated_at = ? WHERE id = 'default'").run(now);

  let remoteDelivered = false;
  let fulfillmentPostCount = 0;
  let taskPayload;
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const parsed = new URL(url);
    if (parsed.pathname === "/api/v1/admin/login") return envelope({ requires_totp: false, token: "jwt-retry" });
    if (parsed.pathname === "/api/v1/admin/orders") {
      if (parsed.searchParams.get("status") === "fulfilling") {
        return envelope([{
          id: 3,
          order_no: "DJ300",
          status: "fulfilling",
          children: [{
            id: 33,
            order_no: "DJ300-1",
            status: "fulfilling",
            fulfillment: null,
            items: [{ id: 303, product_id: 300, sku_id: 0, title: { "zh-CN": "x5" }, quantity: 1, fulfillment_type: "manual" }]
          }]
        }], { pagination: { page: 1, total_page: 1 } });
      }
      return envelope([], { pagination: { page: 1, total_page: 1 } });
    }
    if (parsed.pathname === "/api/v1/admin/orders/33") {
      return envelope(remoteDelivered
        ? { id: 33, order_no: "DJ300-1", status: "delivered", fulfillment: { id: 901, payload: taskPayload } }
        : { id: 33, order_no: "DJ300-1", status: "fulfilling", fulfillment: null });
    }
    if (parsed.pathname === "/api/v1/admin/fulfillments") {
      fulfillmentPostCount += 1;
      const body = JSON.parse(options.body);
      assert.equal("delivery_data" in body, false);
      taskPayload = body.payload;
      remoteDelivered = true;
      throw new Error("socket closed after remote commit");
    }
    throw new Error(`unexpected request: ${url}`);
  };

  try {
    const runner = createStoreFulfillmentRunner({ db, redeemUrl: "https://key.example.com", workerId: "retry-worker", logger: { error() {} } });
    await runner.tick({ force: true });
    const retrying = db.prepare("SELECT * FROM store_fulfillment_tasks WHERE remote_order_id = '33'").get();
    assert.equal(retrying.status, "retrying");
    const originalCards = JSON.parse(retrying.cdkeys_json);
    assert.equal(originalCards.length, 1);

    db.prepare("UPDATE store_fulfillment_tasks SET next_retry_at = ? WHERE id = ?")
      .run(new Date(Date.now() - 1000).toISOString(), retrying.id);
    await runner.tick({ force: true });

    const succeeded = db.prepare("SELECT * FROM store_fulfillment_tasks WHERE id = ?").get(retrying.id);
    assert.equal(succeeded.status, "succeeded");
    assert.deepEqual(JSON.parse(succeeded.cdkeys_json), originalCards);
    assert.equal(fulfillmentPostCount, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM cdkeys WHERE store_fulfillment_task_id = ?").get(retrying.id).count, 1);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("runner recovers from a startup authentication blip without requiring settings to be saved again", async () => {
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE store_fulfillment_settings
    SET base_url = ?, admin_username = ?, admin_password = ?, enabled = 1,
        poll_interval_seconds = 5, last_sync_at = NULL, last_sync_status = NULL,
        last_sync_error = NULL, updated_at = ?, updated_by = 'test'
    WHERE id = 'default'
  `).run("https://shop.example.com", "service", encryptText("secret"), now);

  let remoteReady = false;
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const parsed = new URL(url);
    if (parsed.pathname === "/api/v1/admin/login") return envelope({ requires_totp: false, token: "jwt" });
    if (parsed.pathname === "/api/v1/admin/orders") {
      if (!remoteReady) {
        return new Response(JSON.stringify({ status_code: 401, msg: "temporary unauthorized" }), {
          status: 401,
          headers: { "content-type": "application/json" }
        });
      }
      return envelope([], { pagination: { page: 1, total_page: 1 } });
    }
    throw new Error(`unexpected request: ${url}`);
  };

  try {
    const firstRunner = createStoreFulfillmentRunner({ db, redeemUrl: "https://key.example.com", workerId: "startup-worker", logger: { error() {} } });
    const first = await firstRunner.tick({ force: true });
    assert.equal(first.accepted, false);
    const afterStartupFailure = db.prepare("SELECT enabled, last_sync_status FROM store_fulfillment_settings WHERE id = 'default'").get();
    assert.equal(afterStartupFailure.last_sync_status, "auth_error");
    assert.equal(afterStartupFailure.enabled, 1);

    remoteReady = true;
    const restartedRunner = createStoreFulfillmentRunner({ db, redeemUrl: "https://key.example.com", workerId: "restarted-worker", logger: { error() {} } });
    const recovered = await restartedRunner.tick({ force: true });
    assert.equal(recovered.accepted, true);
    assert.equal(db.prepare("SELECT enabled FROM store_fulfillment_settings WHERE id = 'default'").get().enabled, 1);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

async function adminRequest(method, url, token = "", body) {
  const response = await app.inject({
    method,
    url,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    payload: body
  });
  return { response, json: response.json() };
}

test("admin APIs manage store settings, mappings, tasks and CDK order search", async () => {
  ({ app } = await import("../api/src/server.js"));
  const login = await adminRequest("POST", "/api/admin/auth/login", "", { username: "admin", password: "test-password" });
  assert.equal(login.response.statusCode, 200);
  const token = login.json.token;

  const saved = await adminRequest("PUT", "/api/admin/store-fulfillment/settings", token, {
    baseUrl: "https://shop.example.com/",
    adminUsername: "service",
    adminPassword: "",
    enabled: false,
    pollIntervalSeconds: 30
  });
  assert.equal(saved.response.statusCode, 200);
  assert.equal(saved.json.settings.baseUrl, "https://shop.example.com");
  assert.equal(saved.json.settings.hasAdminPassword, true);

  const created = await adminRequest("POST", "/api/admin/store-fulfillment/mappings", token, {
    productId: "200",
    skuId: "0",
    productTitle: "x5 商品",
    manualType: "x5",
    siteId: "site_demo",
    prefix: "X5",
    enabled: true
  });
  assert.equal(created.response.statusCode, 200);

  const mappings = await adminRequest("GET", "/api/admin/store-fulfillment/mappings", token);
  assert.ok(mappings.json.items.some((item) => item.productId === "200" && item.manualType === "x5"));

  const tasks = await adminRequest("GET", "/api/admin/store-fulfillment/tasks?q=DJ100", token);
  assert.equal(tasks.response.statusCode, 200);
  assert.equal(tasks.json.items[0].parentOrderNo, "DJ100");
  assert.equal(tasks.json.items[0].cdkeys.length, 2);
  db.prepare("UPDATE store_fulfillment_tasks SET status = 'blocked', locked_at = NULL, locked_by = NULL WHERE id = ?")
    .run(tasks.json.items[0].id);
  const cancelableTasks = await adminRequest("GET", "/api/admin/store-fulfillment/tasks?q=DJ100", token);
  assert.equal(cancelableTasks.json.items[0].canCancel, true);

  const deniedCancel = await adminRequest("POST", `/api/admin/store-fulfillment/tasks/${cancelableTasks.json.items[0].id}/cancel`, token, {
    adminUsername: "admin",
    adminPassword: "wrong-password",
    reason: "客户申请取消自动交付"
  });
  assert.equal(deniedCancel.response.statusCode, 401);

  const canceled = await adminRequest("POST", `/api/admin/store-fulfillment/tasks/${cancelableTasks.json.items[0].id}/cancel`, token, {
    adminUsername: "admin",
    adminPassword: "test-password",
    reason: "客户申请取消自动交付"
  });
  assert.equal(canceled.response.statusCode, 200);
  assert.equal(canceled.json.canceled.status, "canceled");
  assert.equal(canceled.json.canceled.recycled, 0);
  assert.equal(db.prepare("SELECT status FROM store_fulfillment_tasks WHERE id = ?").get(cancelableTasks.json.items[0].id).status, "canceled");
  assert.ok(db.prepare(`
    SELECT 1 FROM admin_audit_logs
    WHERE action = 'store_fulfillment.task.cancel' AND resource_id = ?
  `).get(cancelableTasks.json.items[0].id));

  const cards = await adminRequest("GET", "/api/admin/cdkeys?q=DJ100", token);
  assert.equal(cards.response.statusCode, 200);
  assert.equal(cards.json.items.length, 2);
  assert.ok(cards.json.items.every((item) => item.origin === "store_order" && item.store_order_no === "DJ100"));

  const batch = await adminRequest("POST", "/api/admin/batches/import", token, {
    name: "测试批次",
    prefix: "BATCH",
    siteId: "site_demo",
    importType: "manual_x5",
    rawKeys: "生成一张"
  });
  assert.equal(batch.response.statusCode, 200);
  const batchCard = db.prepare("SELECT origin FROM cdkeys WHERE batch_id = ?").get(batch.json.batchId);
  assert.equal(batchCard.origin, "batch_import");
});
