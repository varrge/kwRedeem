import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { JSDOM } from "jsdom";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kawang-subscription-"));
process.env.DATABASE_PATH = path.join(tmpDir, "test.db");
process.env.JWT_SECRET = "subscription-test-secret";
process.env.KAWANG_SKIP_LISTEN = "1";
const { getDb } = await import("../shared/src/database.js");
const { encryptText, decryptText } = await import("../shared/src/secure.js");
const { SpaceXGptDirectV1Adapter } = await import("../shared/src/automation-adapters/spacex-gpt-direct-v1.js");
const { createAutomationRunner } = await import("../worker/src/automation-runner.js");
const { app } = await import("../api/src/server.js");
const db = getDb();
const expiry = "2099-09-20T02:30:00Z";

after(async () => {
  await app.close();
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function adapterFor(data, requests = []) {
  return new SpaceXGptDirectV1Adapter({
    baseUrl: "https://zovocard.com/openapi/v1", apiKey: "test-key",
    lookup: async () => [{ address: "203.0.113.10", family: 4 }],
    fetchImpl: async (url) => {
      requests.push(new URL(url).pathname);
      assert.equal(new URL(url).pathname, "/openapi/v1/gpt-direct/preflight");
      return new Response(JSON.stringify({ code: 0, data }), {
        headers: { "content-type": "application/json" }
      });
    }
  });
}

for (const data of [
  { currentPlan: "plus", can_purchase_at: expiry, subscription_will_renew: true },
  { current_plan: "pro", subscription_active_until: expiry },
  { currentPlan: "prolite", can_purchase_at: "bad-date", subscription_active_until: expiry },
  { currentPlan: "plus", can_purchase_at: "2099-09-19T00:00:00Z", subscription_active_until: expiry },
  { subscription_has_active: true, can_purchase_at: expiry }
]) test(`active subscription fails with the authoritative recharge time: ${JSON.stringify(data)}`, async () => {
  const requests = [];
  await assert.rejects(adapterFor(data, requests).prepareAccount({
    planId: "plus", checkoutCountry: "PH", authSessionJson: { sessionToken: "secret-session" }
  }), (error) => {
    assert.equal(error.code, "AUTOMATION_SUBSCRIPTION_ACTIVE");
    assert.equal(error.retryable, false);
    assert.equal(error.definitelyNotCreated, true);
    assert.match(error.message, /2099-09-20 10:30:00（北京时间）/);
    assert.match(error.message, /Free/);
    assert.doesNotMatch(error.message, /secret|bad-date/);
    return true;
  });
  assert.equal(requests.length, 1, "an unexpired subscription must not be cancelled or submitted");
});

for (const timestamp of [undefined, "invalid-date", "2020-01-01T00:00:00Z"]) {
  test(`missing or stale expiry never invents a recharge time (${timestamp})`, async () => {
    await assert.rejects(adapterFor({ currentPlan: "plus", subscription_active_until: timestamp }).prepareAccount({
      planId: "plus", checkoutCountry: "PH", authSessionJson: { sessionToken: "secret" }
    }), (error) => error.code === "AUTOMATION_SUBSCRIPTION_ACTIVE"
      && /未返回有效的可充值时间/.test(error.message) && !/2020|invalid-date/.test(error.message));
  });
}

for (const cancellation of ["access_token", "rejected", "pending", "unknown", "still_active", "recheck_failed"]) {
  test(`known subscription rejection survives cancellation outcome: ${cancellation}`, async () => {
    let preflightCalls = 0;
    const adapter = new SpaceXGptDirectV1Adapter({
      baseUrl: "https://zovocard.com/openapi/v1", apiKey: "test-key",
      lookup: async () => [{ address: "203.0.113.10", family: 4 }],
      fetchImpl: async (url) => {
        const pathname = new URL(url).pathname;
        if (pathname.endsWith('/preflight')) {
          preflightCalls += 1;
          return new Response(JSON.stringify(cancellation === 'recheck_failed' && preflightCalls > 1
            ? { code: 1, error_code: 'GPT_SESSION_INVALID' }
            : { code: 0, data: { currentPlan: 'plus', subscription_is_delinquent: true,
              subscription_will_renew: true, subscription_has_active: true, can_purchase_at: expiry } }), {
            status: cancellation === 'recheck_failed' && preflightCalls > 1 ? 400 : 200,
            headers: { 'content-type': 'application/json' }
          });
        }
        assert.ok(pathname.endsWith('/cancel-renewal'));
        return new Response(JSON.stringify(cancellation === 'rejected'
          ? { code: 1, error_code: 'GPT_SESSION_INVALID' }
          : { code: 0, data: { renewal_status: ['still_active', 'recheck_failed'].includes(cancellation) ? 'success' : cancellation } }), {
          status: cancellation === 'rejected' ? 400 : 200, headers: { 'content-type': 'application/json' }
        });
      }
    });
    await assert.rejects(adapter.prepareAccount({ planId: 'plus', checkoutCountry: 'PH',
      authSessionJson: cancellation === 'access_token' ? { accessToken: 'test-token' } : { sessionToken: 'test-session' }
    }), (error) => error.code === 'AUTOMATION_SUBSCRIPTION_ACTIVE' && !error.retryable
      && /2099-09-20 10:30:00/.test(error.message));
  });
}

for (const boundary of ["none", "funded", "unknown"]) {
  test(`subscription rejection completes safely through worker, API and customer page (${boundary})`, async () => {
    const at = new Date().toISOString();
    const id = `subscription-${boundary}`;
    const snapshot = { mappingId: id, providerId: id, adapterKey: "spacex_gpt_direct_v1",
      externalPlanId: "plus", regionCode: "PH", cardPlatformKey: "spacexcard", capacityKey: "plus",
      cardCapacity: 5, fundingAmountUsd: 82 };
    db.prepare(`INSERT INTO cdkeys (id,batch_id,product_id,activation_endpoint_id,source_key,public_key,
      prefix,status,locked_by_order_id,processing_mode,created_at,updated_at)
      VALUES (?, 'test', 'prod_demo', 'test', 'test', ?, 'TEST', 'locked', ?, 'membership_auto', ?, ?)`)
      .run(id, id, id, at, at);
    db.prepare(`INSERT INTO redeem_orders (id,order_no,cdkey_id,public_key,product_id,activation_endpoint_id,
      session_payload,status,created_at,updated_at) VALUES (?,?,?,?, 'prod_demo','test',?,'pending',?,?)`)
      .run(id, id, id, id, encryptText(JSON.stringify({ sessionToken: "secret-session" })), at, at);
    db.prepare(`INSERT INTO automation_executions (id,order_id,order_no,product_id,status,mapping_id,
      provider_id,credential_id,client_order_id,mapping_snapshot,attempt_count,next_action_at,created_at,updated_at)
      VALUES (?,?,?,'prod_demo',?,?,?,?,?, ?,1,?,?,?)`)
      .run(id, id, id, boundary === "unknown" ? "submit_unknown" : "preparing_card", id, id, id, id,
        JSON.stringify(snapshot), at, at, at);
    db.prepare(`INSERT INTO automation_execution_attempts (id,execution_id,attempt_no,mapping_id,provider_id,
      credential_id,client_order_id,status,mapping_snapshot,created_at,updated_at)
      VALUES (?,?,1,?,?,?,?,?,?,?,?)`)
      .run(id, id, id, id, id, id, boundary === "unknown" ? "submit_unknown" : "selected", JSON.stringify(snapshot), at, at);
    if (boundary === "funded") {
      db.prepare(`INSERT INTO automation_funding_intents (id,execution_id,provider_key,operation,amount_usd,
        idempotency_key,request_fingerprint,request_body_encrypted,state,created_at)
        VALUES (?,?,'spacexcard','open',82,?,'test','test','succeeded',?)`).run(id, id, id, at);
    }
    db.prepare("UPDATE automation_fulfillment_settings SET payment_gate_enabled=1, mode='automatic'").run();
    const requests = [];
    let cardCalls = 0;
    const runner = createAutomationRunner({ db, decryptText, encryptText,
      adapterFactory: () => ({ adapter: adapterFor({ currentPlan: "plus", can_purchase_at: expiry }, requests) }),
      prepareCard: async () => { cardCalls += 1; return { card: { provider_key: "spacexcard", upstream_card_id: 123 }, material: {} }; },
      now: () => new Date(at)
    });
    try {
      await runner.tick();
      const execution = db.prepare("SELECT * FROM automation_executions WHERE id=?").get(id);
      const order = db.prepare("SELECT * FROM redeem_orders WHERE id=?").get(id);
      const card = db.prepare("SELECT status,locked_by_order_id FROM cdkeys WHERE id=?").get(id);
      if (boundary !== "none") {
        assert.equal(execution.status, "manual_review");
        assert.notEqual(order.session_payload, "");
        assert.equal(card.status, "locked");
        if (boundary === "funded") assert.equal(db.prepare("SELECT state FROM automation_funding_intents WHERE id=?").get(id).state, "succeeded");
        return;
      }
      assert.equal(execution.status, "failed");
      assert.equal(execution.next_action_at, null);
      assert.equal(cardCalls, 0);
      assert.equal(order.status, "failed");
      assert.equal(order.session_payload, "");
      assert.equal(card.status, "active");
      assert.equal(card.locked_by_order_id, null);
      assert.equal(db.prepare("SELECT status FROM automation_execution_attempts WHERE id=?").get(id).status, "not_created");
      for (const table of ["automation_funding_intents", "automation_card_reservations"]) {
        assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE execution_id=?`).get(id).n, 0);
      }
      await runner.tick();
      assert.equal(requests.length, 1, "terminal rejection must not retry or switch providers");
      const response = await app.inject({ method: "GET", url: `/api/public/orders/${id}` });
      assert.equal(response.statusCode, 200);
      const payload = response.json();
      assert.match(payload.liveMessage, /2099-09-20 10:30:00/);
      assert.doesNotMatch(response.body, /secret-session|preflight_token/);
      const dom = new JSDOM(fs.readFileSync('web/index.html', 'utf8'), {
        url: 'https://example.test', runScripts: 'outside-only'
      });
      try {
        dom.window.fetch = async () => ({ ok: true, json: async () => ({ items: [] }) });
        dom.window.eval(fs.readFileSync('web/app.js', 'utf8'));
        dom.window.document.querySelector('#status-container').innerHTML = dom.window.renderRedeemSuccess(payload);
        assert.match(dom.window.document.querySelector('#status-container').textContent, /2099-09-20 10:30:00（北京时间）/);
        assert.equal(dom.window.document.querySelector('#status-container .status-badge').textContent, '失败');
        assert.equal(dom.window.shouldKeepPolling(payload), false);
      } finally { dom.window.close(); }
    } finally {
      for (const table of ['automation_funding_intents','automation_execution_attempts','automation_executions','redeem_orders','cdkeys']) {
        db.prepare(`DELETE FROM ${table} WHERE id=?`).run(id);
      }
    }
  });
}
