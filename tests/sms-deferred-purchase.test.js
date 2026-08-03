import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { JSDOM } from "jsdom";

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

test("383api previews a full number from the last inventory page, can replace it, and purchases that exact number", async () => {
  const at = "2026-07-22T00:05:00.000Z";
  db.prepare(`
    INSERT INTO sms_sites (
      id, name, slug, inventory_source, status, note, created_at, updated_at,
      sms_provider, sms_api_key, sms_app_id, sms_prefix_filter
    ) VALUES ('sms-site-383-test', '383 测试', 'api_383_test', '383api', 'active', NULL, ?, ?,
              '383api', ?, '63', NULL)
  `).run(at, at, encryptText("383-test-key"));
  db.prepare(`
    INSERT INTO sms_cards (
      id, site_id, batch_id, card_key, prefix, status, current_order_id,
      resource_entry_id, note, created_at, updated_at
    ) VALUES ('sms-card-383-test', 'sms-site-383-test', NULL, 'SMS-383-KEY',
              'SMS', 'active', NULL, NULL, NULL, ?, ?)
  `).run(at, at);

  const inventoryPages = [];
  const validatedNumbers = [];
  const purchasedNumbers = [];
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(String(input));
    if (url.pathname === "/api/marketplace/63/inventory") {
      const page = Number(url.searchParams.get("page"));
      inventoryPages.push(page);
      return jsonResponse(page === 1
        ? {
            items: [{ phone_number: "+10000000001", expires_at: "2026-08-01T00:00:00.000Z" }],
            total: 2_700
          }
        : {
            items: [
              { phone_number: "+19990000001", expires_at: "2026-12-30T00:00:00.000Z" },
              { phone_number: "+19990000002", expires_at: "2026-12-31T00:00:00.000Z" }
            ],
            total: 2_700
          });
    }
    if (url.pathname === "/api/marketplace/63/validate-numbers") {
      const numbers = JSON.parse(options.body).numbers;
      validatedNumbers.push(...numbers);
      return jsonResponse({ valid: numbers, invalid: [], unit_price: 5, total_price: 5 });
    }
    if (url.pathname === "/api/marketplace/63/designated-purchase") {
      const numbers = JSON.parse(options.body).numbers;
      purchasedNumbers.push(...numbers);
      return jsonResponse({
        order_number: "383-ORDER-1",
        project_name: "333站点",
        quantity: 1,
        total_price: 5
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
  assert.equal(preview.json().previewKind, "phone");
  assert.ok(["+19990000001", "+19990000002"].includes(preview.json().phonePreview));
  assert.equal(preview.json().canRefreshNumber, true);
  assert.equal(preview.json().phone, "");
  assert.deepEqual(inventoryPages, [1, 27]);
  assert.equal(purchasedNumbers.length, 0);

  const refreshed = await app.inject({
    method: "POST",
    url: "/api/public/sms/orders",
    payload: { cardKey: "SMS-383-KEY", refreshNumber: true }
  });
  assert.equal(refreshed.statusCode, 200);
  assert.notEqual(refreshed.json().phonePreview, preview.json().phonePreview);
  assert.ok(["+19990000001", "+19990000002"].includes(refreshed.json().phonePreview));
  assert.deepEqual(inventoryPages, [1, 27, 1, 27]);
  assert.equal(purchasedNumbers.length, 0);

  const purchased = await app.inject({
    method: "POST",
    url: `/api/public/sms/orders/${refreshed.json().orderNo}/verification`,
    payload: { cardKey: "SMS-383-KEY" }
  });
  assert.equal(purchased.statusCode, 200);
  assert.equal(purchased.json().phone, refreshed.json().phonePreview);
  assert.deepEqual(validatedNumbers, [refreshed.json().phonePreview]);
  assert.deepEqual(purchasedNumbers, [refreshed.json().phonePreview]);
});

test("383api does not substitute another number when the preview is no longer purchasable", async () => {
  const at = "2026-07-22T00:07:00.000Z";
  db.prepare(`
    INSERT INTO sms_sites (
      id, name, slug, inventory_source, status, note, created_at, updated_at,
      sms_provider, sms_api_key, sms_app_id, sms_prefix_filter
    ) VALUES ('sms-site-383-stale', '383 失效预览', 'api_383_stale', '383api', 'active', NULL, ?, ?,
              '383api', ?, '64', NULL)
  `).run(at, at, encryptText("383-stale-key"));
  db.prepare(`
    INSERT INTO sms_cards (
      id, site_id, batch_id, card_key, prefix, status, current_order_id,
      resource_entry_id, note, created_at, updated_at
    ) VALUES ('sms-card-383-stale', 'sms-site-383-stale', NULL, 'SMS-383-STALE',
              'SMS', 'active', NULL, NULL, NULL, ?, ?)
  `).run(at, at);

  let designatedPurchaseCalls = 0;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/api/marketplace/64/inventory") {
      return jsonResponse({
        items: [{ phone_number: "+18880000001", expires_at: "2026-12-31T00:00:00.000Z" }],
        total: 1
      });
    }
    if (url.pathname === "/api/marketplace/64/validate-numbers") {
      return jsonResponse({
        valid: [],
        invalid: [{ number: "+18880000001", reason: "已售出" }],
        unit_price: 5,
        total_price: 0
      });
    }
    if (url.pathname === "/api/marketplace/64/designated-purchase") {
      designatedPurchaseCalls += 1;
      return jsonResponse({ order_number: "SHOULD-NOT-HAPPEN" });
    }
    throw new Error(`unexpected fetch: ${url}`);
  };

  const preview = await app.inject({
    method: "POST",
    url: "/api/public/sms/orders",
    payload: { cardKey: "SMS-383-STALE" }
  });
  assert.equal(preview.statusCode, 200);
  assert.equal(preview.json().phonePreview, "+18880000001");

  const purchase = await app.inject({
    method: "POST",
    url: `/api/public/sms/orders/${preview.json().orderNo}/verification`,
    payload: { cardKey: "SMS-383-STALE" }
  });
  assert.equal(purchase.statusCode, 409);
  assert.match(purchase.json().message, /已不可购买.*已售出.*重新获取号码/);
  assert.equal(designatedPurchaseCalls, 0);

  const order = db.prepare("SELECT status, phone FROM sms_orders WHERE order_no = ?").get(preview.json().orderNo);
  assert.equal(order.status, "number_reserved");
  assert.equal(order.phone, null);

  const recovered = await app.inject({
    method: "POST",
    url: "/api/public/sms/cards/verify",
    payload: { cardKey: "SMS-383-STALE" }
  });
  assert.equal(recovered.statusCode, 200);
  assert.equal(recovered.json().latestOrder.purchaseStatus, "preview");
  assert.equal(recovered.json().latestOrder.canRefreshNumber, true);
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

test("SMS full-number preview enables the same button as 换一个号码", async () => {
  const html = fs.readFileSync(new URL("../web/index.html", import.meta.url), "utf8");
  const appSource = fs.readFileSync(new URL("../web/app.js", import.meta.url), "utf8");
  const dom = new JSDOM(html, {
    url: "https://key.example.test/",
    runScripts: "outside-only"
  });
  dom.window.KAWANG_CONFIG = { apiUrl: "https://api.example.test" };
  dom.window.fetch = async (url) => {
    assert.equal(url, "https://api.example.test/api/public/sms/cards/verify");
    return jsonResponse({
      valid: true,
      cardKey: "SMS-TEST-KEY",
      inventorySource: "383api",
      smsProvider: "383api",
      status: "in_use",
      site: { name: "333站点", inventorySource: "383api", smsProvider: "383api" },
      latestOrder: {
        orderNo: "SMS-ORDER-1",
        status: "number_reserved",
        purchaseStatus: "preview",
        previewKind: "phone",
        phone: "",
        phonePreview: "17252656782",
        canRefreshNumber: true,
        canRefreshPrefix: false,
        verificationStatus: "pending"
      }
    });
  };

  dom.window.eval(appSource);
  dom.window.document.querySelector("#sms-key").value = "SMS-TEST-KEY";
  dom.window.document.querySelector("#sms-form").dispatchEvent(new dom.window.Event("submit", {
    bubbles: true,
    cancelable: true
  }));
  await new Promise((resolve) => setTimeout(resolve, 0));

  const button = dom.window.document.querySelector("#sms-submit");
  assert.equal(button.disabled, false);
  assert.equal(button.textContent, "换一个号码");
  assert.match(dom.window.document.querySelector("#sms-result").textContent, /确认号码可用/);
  dom.window.close();
});

test("SMS page cache-busts the frontend module after deployments", () => {
  const html = fs.readFileSync(new URL("../web/index.html", import.meta.url), "utf8");
  assert.match(html, /import\(`\.\/app\.js\?v=\$\{Date\.now\(\)\}`\)/);
});
