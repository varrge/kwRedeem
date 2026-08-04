import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kawang-spacex-cdk-flow-"));
process.env.DATABASE_PATH = path.join(tmpDir, "test.db");
process.env.JWT_SECRET = "spacex-cdk-flow-test-secret";
process.env.APP_URL = "https://key.example.com";

const { getDb } = await import("../shared/src/database.js");
const { encryptText, decryptText } = await import("../shared/src/secure.js");
const { createSpaceXCdkService } = await import("../shared/src/spacex-cdk-service.js");
const { createStoreFulfillmentRunner } = await import("../shared/src/store-fulfillment-runner.js");
const { SpaceXCdkApiError } = await import("../shared/src/spacex-cdk.js");

const db = getDb();

after(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function nowIso() {
  return new Date().toISOString();
}

function configureSpaceX() {
  db.prepare(`
    UPDATE spacex_cdk_settings
    SET enabled = 1, rollout_plan = 'plus', base_url = 'https://spacex.example.com',
        api_key_encrypted = ?, webhook_secret_encrypted = ?, updated_at = ?, updated_by = 'test'
    WHERE id = 'default'
  `).run(encryptText("api-key"), encryptText("webhook-secret"), nowIso());
}

function configureStore() {
  db.prepare(`
    UPDATE store_fulfillment_settings
    SET base_url = 'https://shop.example.com', admin_username = 'service', admin_password = ?,
        enabled = 1, last_sync_at = NULL, updated_at = ?, updated_by = 'test'
    WHERE id = 'default'
  `).run(encryptText("secret"), nowIso());
}

function addSpaceXMapping({ id, productId, plan = "plus" }) {
  const manualType = plan === "plus" ? "PLUS" : (plan === "pro_5x" ? "x5" : "x20");
  const prefix = plan === "plus" ? "91GPTPLUS" : (plan === "pro_5x" ? "91GPT5X" : "91GPT20X");
  db.prepare(`
    INSERT INTO store_product_mappings (
      id, product_id, sku_id, product_title, manual_type, fulfillment_kind, spacex_plan,
      site_id, prefix, enabled, created_at, updated_at, updated_by
    ) VALUES (?, ?, '0', 'SpaceX 商品', ?, 'spacex_cdk', ?, 'site_demo', ?, 1, ?, ?, 'test')
  `).run(id, productId, manualType, plan, prefix, nowIso(), nowIso());
}

function addSnapshottedTask({ taskId, itemId, plan = "plus" }) {
  const createdAt = nowIso();
  const mapping = {
    itemId,
    productId: `${itemId}-product`,
    skuId: "0",
    quantity: 1,
    fulfillmentKind: "spacex_cdk",
    spacexPlan: plan,
    siteId: "site_demo",
    kawangProductId: "prod_demo",
    kawangActivationEndpointId: "endpoint_demo"
  };
  db.prepare(`
    INSERT INTO store_fulfillment_tasks (
      id, remote_order_id, remote_order_no, parent_order_no, items_json, mapping_snapshot,
      quantity, status, cdkeys_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, '[]', ?, 1, 'pending', '[]', ?, ?)
  `).run(taskId, `${taskId}-remote`, `${taskId}-target`, `${taskId}-parent`, JSON.stringify([mapping]), createdAt, createdAt);
  return db.prepare("SELECT * FROM store_fulfillment_tasks WHERE id = ?").get(taskId);
}

function dujiaoEnvelope(data, extra = {}) {
  return new Response(JSON.stringify({ status_code: 0, msg: "success", data, ...extra }), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

test("store fulfillment reuses verified inventory before issuing one new SpaceX CDK and delivers only wrappers", async () => {
  configureSpaceX();
  configureStore();
  addSpaceXMapping({ id: "map-spacex-100", productId: "sx100" });
  db.prepare(`
    INSERT INTO spacex_cdks (
      id, upstream_id, code_encrypted, code_prefix, plan, state, upstream_status,
      funding_cap_minor, funding_currency, fee_amount_minor, created_at, updated_at
    ) VALUES ('asset-reusable', 'up-reusable', ?, 'SXC-REUSE', 'plus', 'inventory', 'unused', 2500, 'USD', 100, ?, ?)
  `).run(encryptText("SXC-REUSABLE-FULL"), nowIso(), nowIso());

  const issued = [];
  const fakeClient = {
    async getCdk(id) {
      assert.equal(id, "up-reusable");
      return { upstreamId: id, plan: "plus", status: "unused", codePrefix: "SXC-REUSE" };
    },
    async getBalance() { return { balanceMinor: 10000, currency: "USD" }; },
    async issueOne({ plan, idempotencyKey }) {
      issued.push({ plan, idempotencyKey });
      return {
        upstreamId: "up-new",
        code: "SXC-NEW-FULL",
        codePrefix: "SXC-NEW",
        plan,
        feeAmountMinor: 100,
        fundingCapMinor: 2500,
        fundingCurrency: "USD",
        contractValid: true
      };
    }
  };
  const service = createSpaceXCdkService({ db, clientFactory: () => fakeClient });

  let deliveredPayload = "";
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const parsed = new URL(url);
    if (parsed.pathname === "/api/v1/admin/login") return dujiaoEnvelope({ requires_totp: false, token: "jwt" });
    if (parsed.pathname === "/api/v1/admin/orders") {
      if (parsed.searchParams.get("status") === "fulfilling") {
        return dujiaoEnvelope([{
          id: 1,
          order_no: "DJSX100",
          status: "fulfilling",
          children: [{
            id: 11,
            order_no: "DJSX100-1",
            status: "fulfilling",
            fulfillment: null,
            items: [{ id: 101, product_id: "sx100", sku_id: 0, title: { "zh-CN": "SpaceX Plus" }, quantity: 2, fulfillment_type: "manual" }]
          }]
        }], { pagination: { page: 1, total_page: 1 } });
      }
      return dujiaoEnvelope([], { pagination: { page: 1, total_page: 1 } });
    }
    if (parsed.pathname === "/api/v1/admin/orders/11") {
      return dujiaoEnvelope({ id: 11, order_no: "DJSX100-1", status: "fulfilling", fulfillment: null });
    }
    if (parsed.pathname === "/api/v1/admin/fulfillments") {
      deliveredPayload = JSON.parse(options.body).payload;
      return dujiaoEnvelope({ id: 901, order_id: 11, status: "delivered" });
    }
    throw new Error(`unexpected request: ${url}`);
  };

  try {
    const runner = createStoreFulfillmentRunner({
      db,
      redeemUrl: "https://key.example.com",
      workerId: "spacex-flow-worker",
      logger: { error() {} },
      spaceXCdkService: service
    });
    const result = await runner.tick({ force: true });
    assert.equal(result.processed, 1);
    assert.equal(issued.length, 1);
    assert.match(issued[0].idempotencyKey, /^kawang:store:/);
    const task = db.prepare("SELECT * FROM store_fulfillment_tasks WHERE remote_order_id = '11'").get();
    assert.equal(task.status, "succeeded");
    const wrappers = JSON.parse(task.cdkeys_json);
    assert.equal(wrappers.length, 2);
    assert.ok(wrappers.every((item) => item.publicKey.startsWith("91GPTPLUS-")));
    assert.match(deliveredPayload, /91GPTPLUS-/);
    assert.doesNotMatch(deliveredPayload, /SXC-REUSABLE-FULL|SXC-NEW-FULL/);
    const assets = db.prepare("SELECT * FROM spacex_cdks ORDER BY upstream_id").all();
    assert.equal(assets.length, 2);
    assert.ok(assets.every((item) => item.state === "allocated" && item.current_wrapper_cdkey_id));
    assert.equal(decryptText(assets.find((item) => item.upstream_id === "up-new").code_encrypted), "SXC-NEW-FULL");
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("an uncertain SpaceX issuance blocks the task and never buys a replacement on retry", async () => {
  addSpaceXMapping({ id: "map-spacex-200", productId: "sx200" });
  let issueCount = 0;
  const fakeClient = {
    async getBalance() { return { balanceMinor: 100000, currency: "USD" }; },
    async issueOne() {
      issueCount += 1;
      throw new SpaceXCdkApiError("socket closed", { uncertain: true });
    }
  };
  const service = createSpaceXCdkService({ db, clientFactory: () => fakeClient });
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const parsed = new URL(url);
    if (parsed.pathname === "/api/v1/admin/login") return dujiaoEnvelope({ requires_totp: false, token: "jwt" });
    if (parsed.pathname === "/api/v1/admin/orders") {
      if (parsed.searchParams.get("status") === "fulfilling") {
        return dujiaoEnvelope([{
          id: 2,
          order_no: "DJSX200",
          status: "fulfilling",
          children: [{ id: 22, order_no: "DJSX200-1", status: "fulfilling", items: [{ id: 202, product_id: "sx200", sku_id: 0, title: "Plus", quantity: 1, fulfillment_type: "manual" }] }]
        }], { pagination: { page: 1, total_page: 1 } });
      }
      return dujiaoEnvelope([], { pagination: { page: 1, total_page: 1 } });
    }
    if (parsed.pathname === "/api/v1/admin/orders/22") return dujiaoEnvelope({ id: 22, order_no: "DJSX200-1", status: "fulfilling" });
    throw new Error(`unexpected request: ${url}`);
  };
  try {
    const runner = createStoreFulfillmentRunner({ db, redeemUrl: "https://key.example.com", workerId: "uncertain-worker", spaceXCdkService: service, logger: { error() {} } });
    await runner.tick({ force: true });
    const task = db.prepare("SELECT * FROM store_fulfillment_tasks WHERE remote_order_id = '22'").get();
    assert.equal(task.status, "issuance_uncertain");
    assert.equal(issueCount, 1);
    db.prepare("UPDATE store_fulfillment_tasks SET status = 'pending', locked_at = NULL, locked_by = NULL WHERE id = ?").run(task.id);
    await runner.tick({ force: true });
    assert.equal(issueCount, 1);
    assert.equal(db.prepare("SELECT status FROM store_fulfillment_tasks WHERE id = ?").get(task.id).status, "issuance_uncertain");
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("SpaceX activation stores no raw Session and reconciles a queued order to completed", async () => {
  const wrapper = db.prepare("SELECT * FROM cdkeys WHERE processing_mode = 'spacex_cdk' AND status = 'active' ORDER BY created_at LIMIT 1").get();
  const asset = db.prepare("SELECT * FROM spacex_cdks WHERE current_wrapper_cdkey_id = ?").get(wrapper.id);
  const fakeClient = {
    async preview() { return { redemptionToken: "redemption-token", plan: asset.plan }; },
    async preflight() { return { preflightToken: "preflight-token", account_id: "acct-123" }; },
    async redeem() { return { status: "queued", stage: "opening_card", upstreamOrderId: "sx-order-1", message: "queued" }; },
    async result() { return { status: "completed", stage: "done", upstreamOrderId: "sx-order-1", message: "completed" }; }
  };
  const service = createSpaceXCdkService({ db, clientFactory: () => fakeClient });
  const response = await service.activate({
    publicKey: wrapper.public_key,
    session: { accessToken: "RAW-SESSION-SECRET", user: { id: "acct-123", email: "player@example.com" } },
    customerIp: "127.0.0.1"
  });
  assert.equal(response.processingMode, "spacex_cdk");
  const order = db.prepare("SELECT * FROM redeem_orders WHERE order_no = ?").get(response.orderNo);
  assert.deepEqual(JSON.parse(decryptText(order.session_payload)), { ephemeral: true });
  assert.doesNotMatch(JSON.stringify(db.prepare("SELECT * FROM redeem_orders WHERE id = ?").get(order.id)), /RAW-SESSION-SECRET/);
  const activation = db.prepare("SELECT * FROM spacex_cdk_activations WHERE redeem_order_id = ?").get(order.id);
  assert.equal(activation.state, "queued");
  db.prepare("UPDATE spacex_cdk_activations SET next_reconcile_at = ? WHERE id = ?")
    .run(new Date(Date.now() - 1000).toISOString(), activation.id);
  const reconciled = await service.reconcileDue();
  assert.equal(reconciled.processed, 1);
  assert.equal(db.prepare("SELECT state FROM spacex_cdk_activations WHERE id = ?").get(activation.id).state, "completed");
  assert.equal(db.prepare("SELECT status FROM cdkeys WHERE id = ?").get(wrapper.id).status, "used");
  assert.equal(db.prepare("SELECT state FROM spacex_cdks WHERE id = ?").get(asset.id).state, "consumed");
  assert.equal(db.prepare("SELECT status FROM redeem_orders WHERE id = ?").get(order.id).status, "succeeded");
});

test("a pre-activation refund is resumable and returns only authoritative unused inventory", async () => {
  const createdAt = nowIso();
  db.prepare(`
    INSERT INTO store_fulfillment_tasks (
      id, remote_order_id, remote_order_no, parent_order_no, items_json, mapping_snapshot,
      quantity, status, cdkeys_json, created_at, updated_at
    ) VALUES ('refund-task', 'refund-remote', 'DJREFUND-1', 'DJREFUND', '[]', '[]', 1, 'refund_pending', '[]', ?, ?)
  `).run(createdAt, createdAt);
  db.prepare(`
    INSERT INTO spacex_cdk_units (
      id, task_id, item_id, unit_index, plan, state, idempotency_key, recovery_revision,
      spacex_cdk_id, wrapper_cdkey_id, created_at, updated_at
    ) VALUES ('refund-unit', 'refund-task', 'refund-item', 0, 'plus', 'wrapped', 'refund-idem', 0,
              'refund-asset', 'refund-wrapper', ?, ?)
  `).run(createdAt, createdAt);
  db.prepare(`
    INSERT INTO spacex_cdks (
      id, upstream_id, code_encrypted, code_prefix, plan, state, upstream_status,
      funding_cap_minor, funding_currency, fee_amount_minor, current_unit_id, current_wrapper_cdkey_id,
      created_at, updated_at
    ) VALUES ('refund-asset', 'refund-upstream', ?, 'SXC-REFUND', 'plus', 'allocated', 'unused',
              2500, 'USD', 100, 'refund-unit', 'refund-wrapper', ?, ?)
  `).run(encryptText("SXC-REFUND-FULL"), createdAt, createdAt);
  db.prepare(`
    INSERT INTO cdkeys (
      id, batch_id, product_id, activation_endpoint_id, site_id, source_key, public_key, prefix,
      status, metadata, processing_mode, manual_type, origin, store_order_no,
      store_fulfillment_target_no, store_fulfillment_task_id, created_at, updated_at
    ) VALUES ('refund-wrapper', '', 'prod_demo', 'endpoint_demo', 'site_demo', ?, '91GPTPLUS-REFUND',
              '91GPTPLUS', 'active', '{}', 'spacex_cdk', 'PLUS', 'store_order', 'DJREFUND',
              'DJREFUND-1', 'refund-task', ?, ?)
  `).run(encryptText("spacex-cdk-asset:refund-asset"), createdAt, createdAt);
  let lookupCount = 0;
  const service = createSpaceXCdkService({
    db,
    clientFactory: () => ({
      async getCdk() {
        lookupCount += 1;
        if (lookupCount === 1) throw new Error("temporary list failure");
        return { upstreamId: "refund-upstream", plan: "plus", status: "unused" };
      }
    })
  });
  await assert.rejects(
    service.reclaimCanceledTask(db.prepare("SELECT * FROM store_fulfillment_tasks WHERE id = 'refund-task'").get()),
    (error) => error.code === "SPACEX_CDK_REFUND_VERIFY_FAILED"
  );
  assert.equal(db.prepare("SELECT status FROM cdkeys WHERE id = 'refund-wrapper'").get().status, "void");
  assert.equal(db.prepare("SELECT state FROM spacex_cdks WHERE id = 'refund-asset'").get().state, "refund_hold");
  await service.reclaimCanceledTask(db.prepare("SELECT * FROM store_fulfillment_tasks WHERE id = 'refund-task'").get());
  assert.equal(db.prepare("SELECT status FROM cdkeys WHERE id = 'refund-wrapper'").get().status, "void");
  const recycled = db.prepare("SELECT * FROM spacex_cdks WHERE id = 'refund-asset'").get();
  assert.equal(recycled.state, "inventory");
  assert.equal(recycled.current_unit_id, null);
  assert.equal(recycled.current_wrapper_cdkey_id, null);
  assert.equal(db.prepare("SELECT state FROM spacex_cdk_units WHERE id = 'refund-unit'").get().state, "refunded");
});

test("a terminal SpaceX activation cannot regress from an out-of-order Webhook", () => {
  const service = createSpaceXCdkService({ db, clientFactory: () => ({}) });
  const applied = service.applyWebhookEvent({
    event_id: "event-terminal-regression",
    type: "gpt_direct.progress",
    data: { order_id: "sx-order-1", status: "running", stage: "opening_card" }
  });
  assert.equal(applied.matched, true);
  const activation = db.prepare("SELECT * FROM spacex_cdk_activations WHERE upstream_order_id = 'sx-order-1'").get();
  assert.equal(activation.state, "completed");
  assert.equal(db.prepare("SELECT status FROM cdkeys WHERE id = ?").get(activation.wrapper_cdkey_id).status, "used");
});

test("an activation claim wins the refund race without voiding the remaining wrapper", async () => {
  const task = db.prepare("SELECT * FROM store_fulfillment_tasks WHERE remote_order_id = '11'").get();
  const activeBefore = db.prepare(`
    SELECT id FROM cdkeys WHERE store_fulfillment_task_id = ? AND status = 'active'
  `).all(task.id);
  assert.equal(activeBefore.length, 1);
  const service = createSpaceXCdkService({ db, clientFactory: () => ({}) });
  await assert.rejects(
    service.reclaimCanceledTask(task),
    (error) => error.code === "SPACEX_CDK_REFUND_RACE_LOST"
  );
  assert.equal(db.prepare("SELECT status FROM cdkeys WHERE id = ?").get(activeBefore[0].id).status, "active");
});

test("an unverifiable reusable CDK pauses fulfillment without buying a replacement", async () => {
  configureSpaceX();
  db.prepare("UPDATE spacex_cdk_settings SET rollout_plan = 'pro_5x' WHERE id = 'default'").run();
  const createdAt = nowIso();
  db.prepare(`
    INSERT INTO spacex_cdks (
      id, upstream_id, code_encrypted, code_prefix, plan, state, upstream_status,
      funding_cap_minor, funding_currency, fee_amount_minor, created_at, updated_at
    ) VALUES ('verify-fail-asset', 'verify-fail-upstream', ?, 'SXC-VERIFY', 'pro_5x', 'inventory', 'unused',
              10000, 'USD', 100, ?, ?)
  `).run(encryptText("SXC-VERIFY-FULL"), createdAt, createdAt);
  const task = addSnapshottedTask({ taskId: "verify-fail-task", itemId: "verify-fail-item", plan: "pro_5x" });
  let issueCount = 0;
  const service = createSpaceXCdkService({
    db,
    clientFactory: () => ({
      async getCdk() { throw new Error("temporary list failure"); },
      async issueOne() { issueCount += 1; throw new Error("must not issue"); }
    })
  });
  await assert.rejects(
    service.provisionTask(task),
    (error) => error.code === "SPACEX_CDK_INVENTORY_VERIFY_FAILED"
  );
  assert.equal(issueCount, 0);
  assert.equal(db.prepare("SELECT state FROM spacex_cdks WHERE id = 'verify-fail-asset'").get().state, "inventory");
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM cdkeys WHERE store_fulfillment_task_id = ?").get(task.id).count, 0);
});

test("insufficient owner balance reserves the exact asset but blocks wrapper delivery", async () => {
  db.prepare("UPDATE spacex_cdk_settings SET rollout_plan = 'pro_20x' WHERE id = 'default'").run();
  const createdAt = nowIso();
  db.prepare(`
    INSERT INTO spacex_cdks (
      id, upstream_id, code_encrypted, code_prefix, plan, state, upstream_status,
      funding_cap_minor, funding_currency, fee_amount_minor, created_at, updated_at
    ) VALUES ('funding-asset', 'funding-upstream', ?, 'SXC-FUNDING', 'pro_20x', 'inventory', 'unused',
              50000, 'USD', 100, ?, ?)
  `).run(encryptText("SXC-FUNDING-FULL"), createdAt, createdAt);
  const task = addSnapshottedTask({ taskId: "funding-task", itemId: "funding-item", plan: "pro_20x" });
  let issueCount = 0;
  const service = createSpaceXCdkService({
    db,
    clientFactory: () => ({
      async getCdk(id) { return { upstreamId: id, plan: "pro_20x", status: "unused" }; },
      async getBalance() { return { balanceMinor: 1, currency: "USD" }; },
      async issueOne() { issueCount += 1; throw new Error("must not issue"); }
    })
  });
  await assert.rejects(
    service.provisionTask(task),
    (error) => error.code === "SPACEX_CDK_FUNDING_BLOCKED"
  );
  assert.equal(issueCount, 0);
  assert.equal(db.prepare("SELECT state FROM spacex_cdk_units WHERE task_id = ?").get(task.id).state, "funding_blocked");
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM cdkeys WHERE store_fulfillment_task_id = ?").get(task.id).count, 0);
});

test("a missing authoritative funding cap preserves the only full code and blocks delivery", async () => {
  const task = addSnapshottedTask({ taskId: "contract-task", itemId: "contract-item", plan: "pro_20x" });
  const service = createSpaceXCdkService({
    db,
    clientFactory: () => ({
      async getBalance() { return { balanceMinor: 1_000_000_000, currency: "USD" }; },
      async issueOne({ plan }) {
        return {
          upstreamId: "contract-upstream",
          code: "SXC-CONTRACT-ONLY-FULL",
          codePrefix: "SXC-CONTRACT",
          plan,
          feeAmountMinor: 100,
          fundingCapMinor: null,
          fundingCurrency: null,
          contractValid: false
        };
      }
    })
  });
  await assert.rejects(
    service.provisionTask(task),
    (error) => error.code === "SPACEX_CDK_ISSUE_CONTRACT_INVALID"
  );
  const asset = db.prepare("SELECT * FROM spacex_cdks WHERE upstream_id = 'contract-upstream'").get();
  assert.equal(asset.state, "held_contract");
  assert.equal(decryptText(asset.code_encrypted), "SXC-CONTRACT-ONLY-FULL");
  assert.equal(db.prepare("SELECT state FROM spacex_cdk_units WHERE task_id = ?").get(task.id).state, "contract_blocked");
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM cdkeys WHERE store_fulfillment_task_id = ?").get(task.id).count, 0);
  await assert.rejects(
    service.reclaimCanceledTask(task),
    (error) => error.code === "SPACEX_CDK_ISSUE_CONTRACT_INVALID"
  );
  assert.equal(db.prepare("SELECT state FROM spacex_cdks WHERE id = ?").get(asset.id).state, "held_contract");
});

test("a missing issuance contract is recovered from the bounded read-after-write record", async () => {
  configureSpaceX();
  db.prepare("UPDATE spacex_cdks SET state = 'held' WHERE state IN ('held_contract', 'inventory')").run();
  const task = addSnapshottedTask({ taskId: "contract-recovered-task", itemId: "contract-recovered-item" });
  let lookupCount = 0;
  const service = createSpaceXCdkService({
    db,
    clientFactory: () => ({
      async getBalance() { return { balanceMinor: 100_000, currency: "USD" }; },
      async issueOne({ plan }) {
        return {
          upstreamId: "contract-recovered-upstream",
          code: "SXC-CONTRACT-RECOVERED-FULL",
          codePrefix: "SXC-CONTRACT-RECOVERED",
          plan,
          feeAmountMinor: 30,
          fundingCapMinor: null,
          fundingCurrency: null,
          fundingContractMode: "missing",
          fundingSnapshot: null,
          contractValid: false
        };
      },
      async getCdk(id) {
        lookupCount += 1;
        assert.equal(id, "contract-recovered-upstream");
        return {
          upstreamId: id,
          plan: "plus",
          status: "unused",
          codePrefix: "SXC-CONTRACT-RECOVERED",
          fundingCapMinor: 2_100,
          fundingCurrency: "USD",
          fundingContractMode: "bounded",
          fundingSnapshot: "plan=plus open_and_balance_minor=2100 unlimited_cap=0",
          contractValid: true
        };
      }
    })
  });

  await service.provisionTask(task);
  const asset = db.prepare("SELECT * FROM spacex_cdks WHERE upstream_id = 'contract-recovered-upstream'").get();
  assert.equal(lookupCount, 1);
  assert.equal(asset.state, "allocated");
  assert.equal(asset.funding_cap_minor, 2_100);
  assert.equal(asset.funding_currency, "USD");
  assert.equal(asset.funding_contract_mode, "bounded");
  assert.equal(asset.funding_snapshot, "plan=plus open_and_balance_minor=2100 unlimited_cap=0");
  assert.equal(db.prepare("SELECT state FROM spacex_cdk_units WHERE task_id = ?").get(task.id).state, "wrapped");
});

test("an unlimited read-after-write funding contract remains blocked instead of becoming zero liability", async () => {
  configureSpaceX();
  db.prepare("UPDATE spacex_cdks SET state = 'held' WHERE state IN ('held_contract', 'inventory')").run();
  const task = addSnapshottedTask({ taskId: "contract-unlimited-task", itemId: "contract-unlimited-item" });
  const service = createSpaceXCdkService({
    db,
    clientFactory: () => ({
      async getBalance() { return { balanceMinor: 100_000, currency: "USD" }; },
      async issueOne({ plan }) {
        return {
          upstreamId: "contract-unlimited-upstream",
          code: "SXC-CONTRACT-UNLIMITED-FULL",
          codePrefix: "SXC-CONTRACT-UNLIMITED",
          plan,
          feeAmountMinor: 30,
          fundingCapMinor: null,
          fundingCurrency: null,
          fundingContractMode: "missing",
          fundingSnapshot: null,
          contractValid: false
        };
      },
      async getCdk(id) {
        return {
          upstreamId: id,
          plan: "plus",
          status: "unused",
          codePrefix: "SXC-CONTRACT-UNLIMITED",
          fundingCapMinor: 0,
          fundingCurrency: "USD",
          fundingContractMode: "unlimited",
          fundingSnapshot: "plan=plus open_and_balance_minor=2100 unlimited_cap=1",
          contractValid: false
        };
      }
    })
  });

  await assert.rejects(
    service.provisionTask(task),
    (error) => error.code === "SPACEX_CDK_FUNDING_UNLIMITED"
  );
  const asset = db.prepare("SELECT * FROM spacex_cdks WHERE upstream_id = 'contract-unlimited-upstream'").get();
  assert.equal(asset.state, "held_contract");
  assert.equal(asset.funding_cap_minor, 0);
  assert.equal(asset.funding_currency, "USD");
  assert.equal(asset.funding_contract_mode, "unlimited");
  assert.equal(db.prepare("SELECT state FROM spacex_cdk_units WHERE task_id = ?").get(task.id).state, "contract_blocked");
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM cdkeys WHERE store_fulfillment_task_id = ?").get(task.id).count, 0);
});
