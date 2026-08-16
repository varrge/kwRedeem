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
        { id: "pro20x-direct-monthly", name: "ChatGPT Pro 20x", label: "Pro 20x", taskType: "purchase" },
        { id: "subscription-upgrade", name: "Upgrade", label: "Upgrade", taskType: "upgrade" }
      ],
      regions: [{ code: "PH", currency: "PHP", label: "Philippines" }],
      defaultRegion: "PH",
      billingAddressSource: "platform_managed"
    }), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (String(url) === "https://198.51.100.2/api/v1/third-party/user") {
    return new Response(JSON.stringify({
      code: 0,
      message: "success",
      data: { id: "0", username: "api-user", is_active: true }
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

  const storedProvider = db.prepare("SELECT config_snapshot FROM automation_providers WHERE id = ?")
    .get(provider.json().item.id);
  const legacyConfigSnapshot = JSON.parse(storedProvider.config_snapshot);
  legacyConfigSnapshot.plans = legacyConfigSnapshot.plans.map(({ canonicalOffer: _ignored, ...plan }) => plan);
  db.prepare("UPDATE automation_providers SET config_snapshot = ? WHERE id = ?")
    .run(JSON.stringify(legacyConfigSnapshot), provider.json().item.id);

  db.prepare("UPDATE membership_card_platforms SET enabled = 1 WHERE key = 'spacexcard'").run();
  const storeMappingAt = new Date().toISOString();
  db.prepare(`
    INSERT INTO store_product_mappings (
      id, product_id, sku_id, product_title, manual_type, fulfillment_kind,
      site_id, prefix, enabled, created_at, updated_at, updated_by
    ) VALUES ('store-map-plus', 'remote-plus', 'sku-plus', '商城 Plus', 'PLUS',
              'membership_auto', 'site_demo', 'PLUS', 1, ?, ?, 'test')
  `).run(storeMappingAt, storeMappingAt);
  const mapping = await app.inject({
    method: "POST",
    url: "/api/admin/automation/mappings",
    headers,
    payload: {
      storeMappingId: "store-map-plus",
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
  assert.equal(mapping.json().item.storeMappingId, "store-map-plus");
  assert.equal(mapping.json().item.storeProductId, "remote-plus");
  assert.equal(mapping.json().item.storeSkuId, "sku-plus");
  assert.equal(mapping.json().item.storeManualType, "PLUS");
  assert.equal(mapping.json().item.externalPlanId, "plus-monthly");
  assert.equal(mapping.json().item.regionCode, "PH");

  const upgradeMapping = await app.inject({
    method: "POST",
    url: "/api/admin/automation/mappings",
    headers,
    payload: {
      storeMappingId: "store-map-plus",
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

  const mismatchedMapping = await app.inject({
    method: "POST",
    url: "/api/admin/automation/mappings",
    headers,
    payload: {
      storeMappingId: "store-map-plus",
      providerId: provider.json().item.id,
      externalPlanId: "pro20x-direct-monthly",
      regionCode: "PH",
      cardPlatformKey: "spacexcard",
      cardProductCode: "P5378OX",
      capacityKey: "x20",
      cardCapacity: 1,
      fundingAmountUsd: 149,
      expectedMinAmount: 9000,
      expectedMaxAmount: 9999,
      dailyRiskLimitUsd: 149,
      priority: 20,
      enabled: true
    }
  });
  assert.equal(mismatchedMapping.statusCode, 409);
  assert.match(mismatchedMapping.json().message, /套餐.*不一致/);

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
  const script = fs.readFileSync(path.resolve("admin/app.js"), "utf8");
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
  assert.match(script, /retryAutomationExecution/);
  assert.match(script, /\/api\/admin\/automation\/executions\/\$\{encodeURIComponent\(id\)\}\/retry/);
  assert.match(script, /takeOverAutomationExecution/);
  assert.match(script, /\/api\/admin\/automation\/executions\/\$\{encodeURIComponent\(id\)\}\/manual-review/);
  assert.match(html, /value=["']efun_open_v1["']/);
});

test("admin can create an eFun protocol site and synchronize its documented capabilities", async () => {
  const login = await app.inject({
    method: "POST",
    url: "/api/admin/auth/login",
    payload: { username: "admin", password: "test-password" }
  });
  const headers = { authorization: `Bearer ${login.json().token}` };
  const provider = await app.inject({
    method: "POST",
    url: "/api/admin/automation/providers",
    headers,
    payload: {
      name: "eFun",
      adapterKey: "efun_open_v1",
      baseUrl: "https://198.51.100.2/api/v1",
      apiKey: "efun-fixed-key",
      status: "paused"
    }
  });
  assert.equal(provider.statusCode, 200, provider.body);
  assert.equal(provider.json().item.adapterKey, "efun_open_v1");
  assert.equal(provider.json().item.baseUrl, "https://198.51.100.2/api/v1");
  assert.equal(provider.json().item.configStatus, "ready");
  assert.deepEqual(provider.json().item.config.plans.map((item) => item.id), ["plus", "pro5", "pro20"]);
  assert.deepEqual(provider.json().item.config.regions, [
    { code: "PH", currency: "PHP", label: "Philippines" }
  ]);
  const request = remoteRequests.find((item) => item.url.endsWith("/third-party/user"));
  assert.equal(request.method, "GET");
  assert.equal(request.headers["X-API-Key"], "efun-fixed-key");
});

test("admin can immediately retry only pre-submit automation states while Gate remains authoritative", async () => {
  const login = await app.inject({
    method: "POST",
    url: "/api/admin/auth/login",
    payload: { username: "admin", password: "test-password" }
  });
  const headers = { authorization: `Bearer ${login.json().token}` };
  const execution = enrollAutomationOrder(db, {
    id: "execution-manual-retry",
    orderId: "order-manual-retry",
    orderNo: "KWMANUALRETRY",
    productId: "store-map-plus",
    createdAt: new Date().toISOString()
  });
  db.prepare(`
    UPDATE automation_executions
    SET status = 'waiting_mapping', next_action_at = '2099-01-01T00:00:00.000Z'
    WHERE id = ?
  `).run(execution.id);

  const requestedAt = Date.now();
  const retried = await app.inject({
    method: "POST",
    url: `/api/admin/automation/executions/${execution.id}/retry`,
    headers,
    payload: {}
  });
  assert.equal(retried.statusCode, 200, retried.body);
  const afterRetry = db.prepare("SELECT * FROM automation_executions WHERE id = ?").get(execution.id);
  assert.equal(afterRetry.status, "waiting_mapping");
  assert.equal(Date.parse(afterRetry.next_action_at) >= requestedAt, true);
  assert.ok(db.prepare(`
    SELECT 1 FROM admin_audit_logs
    WHERE action = 'automation.execution.retry_requested' AND resource_id = ?
  `).get(execution.id));

  db.prepare(`
    UPDATE automation_executions
    SET status = 'submit_unknown', remote_task_id = 'REMOTE-UNKNOWN'
    WHERE id = ?
  `).run(execution.id);
  const unsafe = await app.inject({
    method: "POST",
    url: `/api/admin/automation/executions/${execution.id}/retry`,
    headers,
    payload: {}
  });
  assert.equal(unsafe.statusCode, 409);
  assert.match(unsafe.json().message, /不能手动重试/);

  db.prepare(`
    UPDATE automation_executions
    SET status = 'waiting_mapping', remote_task_id = NULL
    WHERE id = ?
  `).run(execution.id);
  db.prepare("UPDATE automation_fulfillment_settings SET payment_gate_enabled = 0 WHERE id = 'default'").run();
  const closedGate = await app.inject({
    method: "POST",
    url: `/api/admin/automation/executions/${execution.id}/retry`,
    headers,
    payload: {}
  });
  assert.equal(closedGate.statusCode, 409);
  assert.match(closedGate.json().message, /Gate 已关闭/);
  db.prepare("UPDATE automation_fulfillment_settings SET payment_gate_enabled = 1 WHERE id = 'default'").run();
});

test("admin can safely take over an unfunded waiting order and settle an external manual success", async () => {
  const login = await app.inject({
    method: "POST",
    url: "/api/admin/auth/login",
    payload: { username: "admin", password: "test-password" }
  });
  const headers = { authorization: `Bearer ${login.json().token}` };
  const at = new Date().toISOString();
  db.prepare(`
    INSERT INTO cdkeys (
      id, batch_id, product_id, activation_endpoint_id, source_key, public_key,
      prefix, status, locked_at, locked_by_order_id, processing_mode, created_at, updated_at
    ) VALUES (
      'cdkey-manual-takeover', 'batch-manual-takeover', 'prod_demo', 'endpoint_demo',
      'source-manual-takeover', 'PUBLIC-MANUAL-TAKEOVER', 'MANUAL', 'locked', ?,
      'order-manual-takeover', 'membership_auto', ?, ?
    )
  `).run(at, at, at);
  db.prepare(`
    INSERT INTO redeem_orders (
      id, order_no, cdkey_id, public_key, product_id, activation_endpoint_id,
      session_payload, status, created_at, updated_at
    ) VALUES (
      'order-manual-takeover', 'KWMANUALTAKEOVER', 'cdkey-manual-takeover',
      'PUBLIC-MANUAL-TAKEOVER', 'prod_demo', 'endpoint_demo',
      'encrypted-session', 'pending', ?, ?
    )
  `).run(at, at);
  const execution = enrollAutomationOrder(db, {
    id: "execution-manual-takeover",
    orderId: "order-manual-takeover",
    orderNo: "KWMANUALTAKEOVER",
    productId: "store-map-plus",
    createdAt: at
  });
  db.prepare(`
    UPDATE automation_executions
    SET status = 'waiting_mapping', next_action_at = '2099-01-01T00:00:00.000Z'
    WHERE id = ?
  `).run(execution.id);

  const takeover = await app.inject({
    method: "POST",
    url: `/api/admin/automation/executions/${execution.id}/manual-review`,
    headers,
    payload: {}
  });
  assert.equal(takeover.statusCode, 200, takeover.body);
  assert.equal(takeover.json().item.status, "manual_review");
  assert.equal(takeover.json().item.lastErrorCode, "ADMIN_MANUAL_TAKEOVER_PRE_PAYMENT");
  assert.equal(db.prepare("SELECT next_action_at FROM automation_executions WHERE id = ?").get(execution.id).next_action_at, null);

  const resolved = await app.inject({
    method: "POST",
    url: `/api/admin/automation/executions/${execution.id}/resolve`,
    headers,
    payload: {
      outcome: "succeeded",
      evidenceReference: "MANUAL-KWMANUALTAKEOVER",
      confirmation: "RESOLVE_AUTOMATION_REVIEW"
    }
  });
  assert.equal(resolved.statusCode, 200, resolved.body);
  assert.equal(resolved.json().item.status, "succeeded");
  const completedOrder = db.prepare("SELECT status, session_payload FROM redeem_orders WHERE id = 'order-manual-takeover'").get();
  assert.equal(completedOrder.status, "succeeded");
  assert.equal(completedOrder.session_payload, "");
  assert.equal(db.prepare("SELECT status FROM cdkeys WHERE id = 'cdkey-manual-takeover'").get().status, "used");
  assert.ok(db.prepare(`
    SELECT 1 FROM admin_audit_logs
    WHERE action = 'automation.execution.manual_takeover' AND resource_id = ?
  `).get(execution.id));

  const bounded = enrollAutomationOrder(db, {
    id: "execution-manual-boundary",
    orderId: "order-manual-boundary",
    orderNo: "KWMANUALBOUNDARY",
    productId: "store-map-plus",
    createdAt: at
  });
  db.prepare("UPDATE automation_executions SET status = 'waiting_mapping' WHERE id = ?").run(bounded.id);
  db.prepare(`
    INSERT INTO automation_card_reservations (
      id, execution_id, provider_key, card_id, planned_product_code,
      capacity_key, slot_index, state, reserved_at
    ) VALUES (
      'reservation-manual-boundary', ?, 'spacexcard', NULL, 'P5378OX',
      'plus', NULL, 'reserved', ?
    )
  `).run(bounded.id, at);
  const blocked = await app.inject({
    method: "POST",
    url: `/api/admin/automation/executions/${bounded.id}/manual-review`,
    headers,
    payload: {}
  });
  assert.equal(blocked.statusCode, 409);
  assert.match(blocked.json().message, /卡片或资金边界/);
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
