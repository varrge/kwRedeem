import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kawang-spacex-cdk-api-"));
process.env.DATABASE_PATH = path.join(tmpDir, "test.db");
process.env.JWT_SECRET = "spacex-cdk-api-test-secret";
process.env.ADMIN_USERNAME = "admin";
process.env.ADMIN_PASSWORD = "test-password";
process.env.KAWANG_SKIP_LISTEN = "1";

const { getDb } = await import("../shared/src/database.js");
const { encryptText, decryptText } = await import("../shared/src/secure.js");
const db = getDb();

const previousFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  const parsed = new URL(url);
  const response = (data) => new Response(JSON.stringify({ code: 200, data }), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
  if (parsed.pathname === "/api/v1/cdk/preview") return response({ redemption_token: "redemption-token", plan: "plus" });
  if (parsed.pathname === "/api/v1/cdk/preflight") return response({ preflight_token: "preflight-token", account_id: "account-1" });
  if (parsed.pathname === "/api/v1/cdk/redeem") return response({ order_id: "upstream-order-1", status: "queued", stage: "queued" });
  if (parsed.pathname === "/openapi/v1/balance") return response({ balance: 100, currency: "USD" });
  throw new Error(`unexpected SpaceX request: ${url}`);
};

const { app } = await import("../api/src/server.js");

after(async () => {
  globalThis.fetch = previousFetch;
  await app.close();
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function login() {
  const response = await app.inject({ method: "POST", url: "/api/admin/auth/login", payload: { username: "admin", password: "test-password" } });
  return response.json().token;
}

function seedWrapper() {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO spacex_cdks (
      id, upstream_id, code_encrypted, code_prefix, plan, state, upstream_status,
      funding_cap_minor, funding_currency, fee_amount_minor, current_wrapper_cdkey_id,
      created_at, updated_at
    ) VALUES ('api-asset', 'api-upstream', ?, 'SXC-API', 'plus', 'allocated', 'unused',
              2500, 'USD', 100, 'api-wrapper', ?, ?)
  `).run(encryptText("SXC-API-FULL"), now, now);
  db.prepare(`
    INSERT INTO cdkeys (
      id, batch_id, product_id, activation_endpoint_id, site_id, source_key, public_key, prefix,
      status, metadata, processing_mode, manual_type, origin, created_at, updated_at
    ) VALUES ('api-wrapper', '', 'prod_demo', 'endpoint_demo', 'site_demo', ?, '91GPTPLUS-API1234567',
              '91GPTPLUS', 'active', ?, 'spacex_cdk', 'PLUS', 'store_order', ?, ?)
  `).run(
    encryptText("spacex-cdk-asset:api-asset"),
    JSON.stringify({ processingMode: "spacex_cdk", spacexPlan: "plus", spacexCdkId: "api-asset" }),
    now,
    now
  );
}

test("SpaceX CDK admin settings remain disabled by default and require fresh credentials to enable", async () => {
  const token = await login();
  const headers = { authorization: `Bearer ${token}` };
  const initial = await app.inject({ method: "GET", url: "/api/admin/spacex-cdk/settings", headers });
  assert.equal(initial.statusCode, 200);
  assert.equal(initial.json().settings.enabled, false);

  const denied = await app.inject({
    method: "PUT",
    url: "/api/admin/spacex-cdk/settings",
    headers,
    payload: {
      enabled: true,
      rolloutPlan: "plus",
      baseUrl: "https://spacex.example.com",
      apiKey: "api-key",
      webhookSecret: "webhook-secret",
      adminUsername: "admin",
      adminPassword: "wrong"
    }
  });
  assert.equal(denied.statusCode, 401);

  const saved = await app.inject({
    method: "PUT",
    url: "/api/admin/spacex-cdk/settings",
    headers,
    payload: {
      enabled: true,
      rolloutPlan: "plus",
      baseUrl: "https://spacex.example.com",
      apiKey: "api-key",
      webhookSecret: "webhook-secret",
      adminUsername: "admin",
      adminPassword: "test-password"
    }
  });
  assert.equal(saved.statusCode, 200);
  assert.equal(saved.json().settings.enabled, true);
  assert.equal(saved.json().settings.hasApiKey, true);
  assert.equal(saved.json().settings.hasWebhookSecret, true);
});

test("SpaceX store mapping forces the canonical plan prefix", async () => {
  const token = await login();
  const headers = { authorization: `Bearer ${token}` };
  const created = await app.inject({
    method: "POST",
    url: "/api/admin/store-fulfillment/mappings",
    headers,
    payload: {
      productId: "spacex-product",
      skuId: "0",
      productTitle: "Plus",
      manualType: "x20",
      fulfillmentKind: "spacex_cdk",
      spacexPlan: "plus",
      siteId: "site_demo",
      prefix: "WRONG",
      enabled: true
    }
  });
  assert.equal(created.statusCode, 200);
  const row = db.prepare("SELECT * FROM store_product_mappings WHERE id = ?").get(created.json().id);
  assert.equal(row.fulfillment_kind, "spacex_cdk");
  assert.equal(row.spacex_plan, "plus");
  assert.equal(row.manual_type, "PLUS");
  assert.equal(row.prefix, "91GPTPLUS");
});

test("public SpaceX activation never persists the raw Session and a signed Webhook completes it idempotently", async () => {
  seedWrapper();
  const verified = await app.inject({
    method: "POST",
    url: "/api/public/cdkeys/verify",
    payload: { publicKey: "91GPTPLUS-API1234567" }
  });
  assert.equal(verified.statusCode, 200);
  assert.equal(verified.json().processingMode, "spacex_cdk");
  assert.equal(verified.json().spacexPlan, "plus");
  assert.equal(verified.json().canRedeem, true);

  const rawSecret = "RAW-SESSION-MUST-NOT-PERSIST";
  const redeemed = await app.inject({
    method: "POST",
    url: "/api/public/redeem",
    payload: {
      publicKey: "91GPTPLUS-API1234567",
      sessionPayload: JSON.stringify({ accessToken: rawSecret, user: { id: "account-1", email: "player@example.com" } })
    }
  });
  assert.equal(redeemed.statusCode, 200);
  assert.equal(redeemed.json().processingMode, "spacex_cdk");
  const order = db.prepare("SELECT * FROM redeem_orders WHERE order_no = ?").get(redeemed.json().orderNo);
  assert.deepEqual(JSON.parse(decryptText(order.session_payload)), { ephemeral: true });
  assert.doesNotMatch(JSON.stringify(db.prepare("SELECT * FROM redeem_orders WHERE id = ?").get(order.id)), new RegExp(rawSecret));

  const event = JSON.stringify({
    event_id: "event-1",
    type: "gpt_direct.progress",
    data: { order_id: "upstream-order-1", status: "completed", stage: "done" }
  });
  const signature = createHmac("sha256", "webhook-secret").update(event).digest("hex");
  const webhook = await app.inject({
    method: "POST",
    url: "/api/webhooks/spacex-cdk",
    headers: { "content-type": "application/json", "x-signature": signature },
    payload: event
  });
  assert.equal(webhook.statusCode, 200);
  assert.equal(webhook.json().matched, true);
  assert.equal(db.prepare("SELECT state FROM spacex_cdk_activations WHERE redeem_order_id = ?").get(order.id).state, "completed");
  assert.equal(db.prepare("SELECT status FROM cdkeys WHERE id = 'api-wrapper'").get().status, "used");

  const duplicate = await app.inject({
    method: "POST",
    url: "/api/webhooks/spacex-cdk",
    headers: { "content-type": "application/json", "x-signature": signature },
    payload: event
  });
  assert.equal(duplicate.statusCode, 200);
  assert.equal(duplicate.json().duplicate, true);

  const rejected = await app.inject({
    method: "POST",
    url: "/api/webhooks/spacex-cdk",
    headers: { "content-type": "application/json", "x-signature": "0".repeat(64) },
    payload: event
  });
  assert.equal(rejected.statusCode, 401);
});

test("revealing an upstream SpaceX CDK requires fresh credentials, a reason, and an audit record", async () => {
  const token = await login();
  const headers = { authorization: `Bearer ${token}` };
  const denied = await app.inject({
    method: "POST",
    url: "/api/admin/spacex-cdk/inventory/api-asset/reveal",
    headers,
    payload: { adminUsername: "admin", adminPassword: "wrong", reason: "人工核对上游订单" }
  });
  assert.equal(denied.statusCode, 401);

  const revealed = await app.inject({
    method: "POST",
    url: "/api/admin/spacex-cdk/inventory/api-asset/reveal",
    headers,
    payload: { adminUsername: "admin", adminPassword: "test-password", reason: "人工核对上游订单" }
  });
  assert.equal(revealed.statusCode, 200);
  assert.equal(revealed.json().code, "SXC-API-FULL");
  const audit = db.prepare(`
    SELECT * FROM admin_audit_logs
    WHERE action = 'spacex_cdk.secret.reveal' AND resource_id = 'api-asset'
    ORDER BY created_at DESC LIMIT 1
  `).get();
  assert.ok(audit);
  assert.match(audit.detail, /人工核对上游订单/);
  assert.doesNotMatch(audit.detail, /SXC-API-FULL/);
});
