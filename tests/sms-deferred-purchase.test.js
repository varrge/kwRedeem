import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kawang-sms-deferred-purchase-"));
process.env.DATABASE_PATH = path.join(tmpDir, "test.db");
process.env.JWT_SECRET = "sms-deferred-purchase-test-secret";
process.env.INTERNAL_SECRET = "sms-test-internal-secret";
process.env.KAWANG_SKIP_LISTEN = "1";

const { getDb } = await import("../shared/src/database.js");
const { encryptText } = await import("../shared/src/secure.js");
const { app } = await import("../api/src/server.js");
const db = getDb();
const originalFetch = globalThis.fetch;

after(async () => {
  globalThis.fetch = originalFetch;
  await app.close();
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

test("dynamic get-number previews a NexSMS prefix and only verification purchase charges once", async () => {
  const at = "2026-07-22T00:00:00.000Z";
  db.prepare(`
    UPDATE sms_sites
    SET sms_provider = 'nexsms', inventory_source = 'nexsms', sms_api_key = ?,
        sms_app_id = '72', sms_card_type = 1, sms_expiry = 0,
        sms_prefix_filter = '1201,1202,1203', sms_exclude_prefix = '1202', status = 'active'
    WHERE id = 'sms_site_laoyou'
  `).run(encryptText("nexsms-test-key"));
  db.prepare(`
    INSERT INTO sms_cards (
      id, site_id, batch_id, card_key, prefix, status, current_order_id,
      resource_entry_id, note, created_at, updated_at
    ) VALUES ('sms-card-dynamic', 'sms_site_laoyou', NULL, 'SMS-DYNAMIC-KEY',
              'SMS', 'active', NULL, NULL, NULL, ?, ?)
  `).run(at, at);

  let prefixCalls = 0;
  let purchaseCalls = 0;
  let purchaseBody = null;
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(String(input));
    if (url.pathname === "/api/premium/prefix") {
      prefixCalls += 1;
      return jsonResponse({
        code: 0,
        message: "success",
        data: { list: [{ prefix: 1202, num: 500 }, { prefix: 1201, num: 20 }, { prefix: 1203, num: 10 }] }
      });
    }
    if (url.pathname === "/api/premium/purchase") {
      purchaseCalls += 1;
      purchaseBody = JSON.parse(options.body);
      await new Promise((resolve) => setTimeout(resolve, 25));
      return jsonResponse({
        code: 0,
        message: "success",
        data: [{ tel: "12015550199", endTime: "2026-07-22T01:00:00.000Z", appName: "OpenAI" }]
      });
    }
    throw new Error(`unexpected fetch: ${url}`);
  };

  const preview = await app.inject({
    method: "POST",
    url: "/api/public/sms/orders",
    payload: { cardKey: "SMS-DYNAMIC-KEY" }
  });
  assert.equal(preview.statusCode, 200);
  assert.equal(preview.json().purchaseStatus, "preview");
  assert.equal(preview.json().numberPrefix, "1201");
  assert.equal(preview.json().phone, "");
  assert.match(preview.json().phonePreview, /^\+1201/);
  assert.equal(prefixCalls, 1);
  assert.equal(purchaseCalls, 0);

  const refreshed = await app.inject({
    method: "POST",
    url: "/api/public/sms/orders",
    payload: { cardKey: "SMS-DYNAMIC-KEY", refreshPrefix: true }
  });
  assert.equal(refreshed.statusCode, 200);
  assert.equal(refreshed.json().numberPrefix, "1203");
  assert.equal(refreshed.json().phone, "");
  assert.equal(prefixCalls, 2);
  assert.equal(purchaseCalls, 0);

  const verificationUrl = `/api/public/sms/orders/${refreshed.json().orderNo}/verification`;
  const [firstClick, secondClick] = await Promise.all([
    app.inject({ method: "POST", url: verificationUrl, payload: { cardKey: "SMS-DYNAMIC-KEY" } }),
    app.inject({ method: "POST", url: verificationUrl, payload: { cardKey: "SMS-DYNAMIC-KEY" } })
  ]);
  assert.deepEqual([firstClick.statusCode, secondClick.statusCode].sort(), [200, 409]);
  const purchased = firstClick.statusCode === 200 ? firstClick.json() : secondClick.json();
  assert.equal(purchased.purchaseStatus, "purchased");
  assert.equal(purchased.phone, "12015550199");
  assert.equal(purchaseCalls, 1);
  assert.equal(purchaseBody.prefix, "1203");

  const repeated = await app.inject({
    method: "POST",
    url: verificationUrl,
    payload: { cardKey: "SMS-DYNAMIC-KEY" }
  });
  assert.equal(repeated.statusCode, 200);
  assert.equal(repeated.json().phone, "12015550199");
  assert.equal(purchaseCalls, 1);
});

test("383api also defers its purchase until verification is requested", async () => {
  const at = "2026-07-22T00:05:00.000Z";
  db.prepare(`
    INSERT INTO sms_sites (
      id, name, slug, inventory_source, status, note, created_at, updated_at,
      sms_provider, sms_api_key, sms_app_id, sms_prefix_filter
    ) VALUES ('sms-site-383-test', '383 测试', 'api_383_test', '383api', 'active', NULL, ?, ?,
              '383api', ?, '9001', '4477')
  `).run(at, at, encryptText("383-test-key"));
  db.prepare(`
    INSERT INTO sms_cards (
      id, site_id, batch_id, card_key, prefix, status, current_order_id,
      resource_entry_id, note, created_at, updated_at
    ) VALUES ('sms-card-383-test', 'sms-site-383-test', NULL, 'SMS-383-KEY',
              'SMS', 'active', NULL, NULL, NULL, ?, ?)
  `).run(at, at);

  let purchaseCalls = 0;
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(String(input));
    if (url.pathname === "/api/open/purchase") {
      purchaseCalls += 1;
      assert.equal(JSON.parse(options.body).prefix, "4477");
      return jsonResponse({
        code: 0,
        msg: "success",
        data: {
          order_number: "383-ORDER-1",
          numbers: [{ phone_number: "+447700900123", expires_at: "2026-07-22T01:00:00.000Z" }]
        }
      });
    }
    throw new Error(`unexpected fetch: ${url}`);
  };

  const preview = await app.inject({
    method: "POST",
    url: "/api/public/sms/orders",
    payload: { cardKey: "SMS-383-KEY" }
  });
  assert.equal(preview.statusCode, 200);
  assert.equal(preview.json().purchaseStatus, "preview");
  assert.equal(preview.json().numberPrefix, "4477");
  assert.equal(preview.json().phone, "");
  assert.equal(purchaseCalls, 0);

  const purchased = await app.inject({
    method: "POST",
    url: `/api/public/sms/orders/${preview.json().orderNo}/verification`,
    payload: { cardKey: "SMS-383-KEY" }
  });
  assert.equal(purchased.statusCode, 200);
  assert.equal(purchased.json().phone, "+447700900123");
  assert.equal(purchaseCalls, 1);
});

test("static inventory is only polled after the get-verification action", async () => {
  const at = "2026-07-22T00:10:00.000Z";
  db.prepare(`
    INSERT INTO sms_sites (id, name, slug, inventory_source, status, note, created_at, updated_at)
    VALUES ('sms-site-static-test', '静态测试', 'static_test', 'sms_entries', 'active', NULL, ?, ?)
  `).run(at, at);
  db.prepare(`
    INSERT INTO sms_batches (id, name, prefix, imported_count, created_by, created_at, updated_at)
    VALUES ('sms-batch-static-test', '静态测试', 'SMS', 1, 'test', ?, ?)
  `).run(at, at);
  db.prepare(`
    INSERT INTO sms_entries (
      id, phone, sms_url, public_key, prefix, batch_id, status, note, created_at, updated_at
    ) VALUES ('sms-entry-static-test', '+15550001111', 'https://sms.test/messages',
              'SMS-ENTRY-STATIC', 'SMS', 'sms-batch-static-test', 'active', NULL, ?, ?)
  `).run(at, at);
  db.prepare(`
    INSERT INTO sms_cards (
      id, site_id, batch_id, card_key, prefix, status, current_order_id,
      resource_entry_id, note, created_at, updated_at
    ) VALUES ('sms-card-static-test', 'sms-site-static-test', NULL, 'SMS-STATIC-KEY',
              'SMS', 'active', NULL, NULL, NULL, ?, ?)
  `).run(at, at);

  let pollCalls = 0;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/api/internal/sms/poll") {
      pollCalls += 1;
      return jsonResponse({ accepted: true });
    }
    throw new Error(`unexpected fetch: ${url}`);
  };

  const reserved = await app.inject({
    method: "POST",
    url: "/api/public/sms/orders",
    payload: { cardKey: "SMS-STATIC-KEY" }
  });
  assert.equal(reserved.statusCode, 200);
  assert.equal(reserved.json().status, "number_reserved");
  assert.equal(reserved.json().phone, "+15550001111");
  assert.equal(pollCalls, 0);
  assert.equal(
    db.prepare("SELECT expires_at FROM sms_orders WHERE order_no = ?").get(reserved.json().orderNo).expires_at,
    null
  );

  const started = await app.inject({
    method: "POST",
    url: `/api/public/sms/orders/${reserved.json().orderNo}/verification`,
    payload: { cardKey: "SMS-STATIC-KEY" }
  });
  assert.equal(started.statusCode, 200);
  assert.equal(started.json().status, "waiting_code");
  assert.equal(pollCalls, 1);
});
