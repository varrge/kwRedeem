import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kawang-automation-api-"));
process.env.DATABASE_PATH = path.join(tmpDir, "test.db");
process.env.JWT_SECRET = "automation-api-test-secret";
process.env.ADMIN_USERNAME = "admin";
process.env.ADMIN_PASSWORD = "test-password";
process.env.KAWANG_SKIP_LISTEN = "1";

const originalFetch = globalThis.fetch;
const remoteRequests = [];
globalThis.fetch = async (url, options = {}) => {
  remoteRequests.push({ url: String(url), method: options.method || "GET", headers: options.headers });
  if (String(url) === "https://198.51.100.1/api/v1/automate/config") {
    return new Response(JSON.stringify({
      success: true,
      requestId: "REQ-CONFIG",
      plans: [
        { id: "plus-monthly", name: "ChatGPT Plus", label: "Plus", taskType: "purchase" },
        { id: "subscription-upgrade", name: "Upgrade", label: "Upgrade", taskType: "upgrade" }
      ],
      regions: [{ code: "PH", currency: "PHP", label: "Philippines" }],
      defaultRegion: "PH",
      billingAddressSource: "platform_managed"
    }), { status: 200, headers: { "content-type": "application/json" } });
  }
  throw new Error(`unexpected remote request: ${url}`);
};

const { getDb } = await import("../shared/src/database.js");
const { enrollAutomationOrder } = await import("../shared/src/automation-fulfillment.js");
const { app } = await import("../api/src/server.js");
const db = getDb();

after(async () => {
  globalThis.fetch = originalFetch;
  await app.close();
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("automation admin config keeps Gate closed and maps only discovered direct capabilities", async () => {
  const login = await app.inject({
    method: "POST",
    url: "/api/admin/auth/login",
    payload: { username: "admin", password: "test-password" }
  });
  assert.equal(login.statusCode, 200);
  const headers = { authorization: `Bearer ${login.json().token}` };

  const initial = await app.inject({ method: "GET", url: "/api/admin/automation/settings", headers });
  assert.equal(initial.statusCode, 200);
  assert.equal(initial.json().paymentGateEnabled, false);

  const provider = await app.inject({
    method: "POST",
    url: "/api/admin/automation/providers",
    headers,
    payload: {
      name: "Automate Test",
      adapterKey: "automate_v1",
      baseUrl: "https://198.51.100.1/api/v1/automate",
      apiKey: "atk_live_once",
      status: "active"
    }
  });
  assert.equal(provider.statusCode, 200, provider.body);
  assert.equal(provider.json().item.configStatus, "ready");
  assert.equal(provider.json().item.hasCredential, true);
  assert.equal(remoteRequests.length, 1);
  assert.equal(remoteRequests[0].method, "GET");
  assert.match(String(remoteRequests[0].headers["X-Automate-Key"]), /atk_live_once/);

  db.prepare("UPDATE membership_card_platforms SET enabled = 1 WHERE key = 'spacexcard'").run();
  const mapping = await app.inject({
    method: "POST",
    url: "/api/admin/automation/mappings",
    headers,
    payload: {
      productId: "prod_demo",
      providerId: provider.json().item.id,
      externalPlanId: "plus-monthly",
      regionCode: "PH",
      cardPlatformKey: "spacexcard",
      cardProductCode: "P5378OX",
      capacityKey: "plus",
      cardCapacity: 1,
      fundingAmountUsd: 25,
      expectedMinAmount: 900,
      expectedMaxAmount: 1200,
      dailyRiskLimitUsd: 100,
      priority: 10,
      enabled: true
    }
  });
  assert.equal(mapping.statusCode, 200, mapping.body);
  assert.equal(mapping.json().item.externalPlanId, "plus-monthly");
  assert.equal(mapping.json().item.regionCode, "PH");

  const upgradeMapping = await app.inject({
    method: "POST",
    url: "/api/admin/automation/mappings",
    headers,
    payload: {
      productId: "prod_demo",
      providerId: provider.json().item.id,
      externalPlanId: "subscription-upgrade",
      regionCode: "PH",
      cardPlatformKey: "spacexcard",
      cardProductCode: "P5378OX",
      capacityKey: "upgrade",
      cardCapacity: 1,
      fundingAmountUsd: 25,
      expectedMinAmount: 900,
      expectedMaxAmount: 1200,
      dailyRiskLimitUsd: 100,
      priority: 20,
      enabled: true
    }
  });
  assert.equal(upgradeMapping.statusCode, 409);
  assert.match(upgradeMapping.json().message, /直付套餐/);

  const enabled = await app.inject({
    method: "PUT",
    url: "/api/admin/automation/settings",
    headers,
    payload: {
      paymentGateEnabled: true,
      configTtlSeconds: 300,
      credentials: { username: "admin", password: "test-password" },
      confirmation: "ENABLE_LIVE_AUTOMATION"
    }
  });
  assert.equal(enabled.statusCode, 200);
  assert.equal(enabled.json().paymentGateEnabled, true);
  assert.equal(remoteRequests.length, 1, "Gate updates must not create or query remote tasks");
});

test("admin UI exposes protocol sites, mappings, Gate, and manual review controls", async () => {
  const html = fs.readFileSync(path.resolve("admin/index.html"), "utf8");
  for (const id of [
    "automation-gate-form",
    "automation-provider-form",
    "automation-provider-list",
    "automation-mapping-form",
    "automation-mapping-region",
    "automation-execution-list"
  ]) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
});

test("CDK voiding cancels only protocol orders that have not crossed the card boundary", async () => {
  const login = await app.inject({
    method: "POST",
    url: "/api/admin/auth/login",
    payload: { username: "admin", password: "test-password" }
  });
  const headers = { authorization: `Bearer ${login.json().token}` };
  const at = new Date().toISOString();
  const insertOrder = (suffix) => {
    const orderId = `automation-void-order-${suffix}`;
    const cdkeyId = `automation-void-cdkey-${suffix}`;
    const orderNo = `KWAUTOVOID${suffix}`;
    db.prepare(`
      INSERT INTO cdkeys (
        id, batch_id, product_id, activation_endpoint_id, source_key, public_key,
        prefix, status, locked_at, locked_by_order_id, processing_mode, created_at, updated_at
      ) VALUES (?, 'batch-auto-void', 'prod_demo', 'endpoint_demo', ?, ?, 'AUTOVOID',
        'locked', ?, ?, 'membership_auto', ?, ?)
    `).run(cdkeyId, `source-${suffix}`, `PUBLIC-AUTO-VOID-${suffix}`, at, orderId, at, at);
    db.prepare(`
      INSERT INTO redeem_orders (
        id, order_no, cdkey_id, public_key, product_id, activation_endpoint_id,
        session_payload, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'prod_demo', 'endpoint_demo', 'encrypted-session', 'pending', ?, ?)
    `).run(orderId, orderNo, cdkeyId, `PUBLIC-AUTO-VOID-${suffix}`, at, at);
    const execution = enrollAutomationOrder(db, {
      orderId,
      orderNo,
      productId: "prod_demo",
      createdAt: at
    });
    return { orderId, cdkeyId, execution };
  };

  const beforeBoundary = insertOrder("SAFE");
  const voided = await app.inject({
    method: "POST",
    url: "/api/admin/cdkeys/bulk-action",
    headers,
    payload: { ids: [beforeBoundary.cdkeyId], action: "void" }
  });
  assert.equal(voided.statusCode, 200);
  assert.equal(voided.json().cancelledAutomationExecutions, 1);
  assert.equal(db.prepare("SELECT status FROM automation_executions WHERE id = ?").get(beforeBoundary.execution.id).status, "cancelled");
  assert.equal(db.prepare("SELECT session_payload FROM redeem_orders WHERE id = ?").get(beforeBoundary.orderId).session_payload, "");

  const afterBoundary = insertOrder("BOUNDARY");
  db.prepare("UPDATE automation_executions SET status = 'preparing_card' WHERE id = ?")
    .run(afterBoundary.execution.id);
  const blocked = await app.inject({
    method: "POST",
    url: "/api/admin/cdkeys/bulk-action",
    headers,
    payload: { ids: [afterBoundary.cdkeyId], action: "void" }
  });
  assert.equal(blocked.statusCode, 409);
  assert.equal(blocked.json().code, "CDKEY_VOID_BLOCKED_BY_AUTOMATION_BOUNDARY");
  assert.equal(db.prepare("SELECT status FROM cdkeys WHERE id = ?").get(afterBoundary.cdkeyId).status, "locked");
});
