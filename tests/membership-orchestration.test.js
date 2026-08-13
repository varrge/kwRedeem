import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kawang-membership-orchestration-"));
process.env.DATABASE_PATH = path.join(tmpDir, "test.db");
process.env.JWT_SECRET = "membership-orchestration-test-secret";
process.env.ADMIN_USERNAME = "admin";
process.env.ADMIN_PASSWORD = "test-password";
process.env.KAWANG_SKIP_LISTEN = "1";

const { getDb } = await import("../shared/src/database.js");
const { encryptText } = await import("../shared/src/secure.js");
const {
  acquireBrowserFulfillmentLease,
  acquirePaymentBrowserFulfillmentLease,
  activateMembershipFulfillmentIdentity,
  createMembershipFulfillmentForOrder,
  deriveMembershipAccountLockKey,
  expireBrowserFulfillmentLease,
  heartbeatBrowserFulfillmentLease,
  projectMembershipDelivery,
  promoteWaitingMembershipFulfillment,
  releaseBrowserFulfillmentLease,
  sanitizeAndReleaseBrowserFulfillmentLease,
  transitionMembershipFulfillment
} = await import("../shared/src/membership-orchestration.js");
const {
  createMembershipFulfillmentRunner
} = await import("../shared/src/membership-fulfillment-runner.js");
const {
  createSpaceXCardCheckout,
  spaceXCardGptCheckoutUrl,
  validateChatGptCheckoutUrl
} = await import("../shared/src/spacexcard-gpt.js");

const db = getDb();
let app;

after(async () => {
  if (app) await app.close();
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const at = "2026-07-16T00:00:00.000Z";

function insertProduct(id, tier) {
  db.prepare(`
    INSERT INTO products (id, code, title, membership_tier, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'active', ?, ?)
  `).run(id, id.toUpperCase(), id, tier, at, at);
}

function insertOrder(id, orderNo, productId, email, deliveryStatus = "succeeded") {
  db.prepare(`
    INSERT INTO redeem_orders (
      id, order_no, cdkey_id, public_key, product_id, activation_endpoint_id, site_id,
      session_payload, session_preview, status, created_at, updated_at,
      extension_delivery_status, extension_delivery_updated_at
    ) VALUES (?, ?, ?, ?, ?, 'endpoint-test', 'site_demo', ?, '{}', 'processing', ?, ?, ?, ?)
  `).run(
    id,
    orderNo,
    `cdkey-${id}`,
    `KEY-${id}`,
    productId,
    encryptText(JSON.stringify({ user: { email } })),
    at,
    at,
    deliveryStatus,
    at
  );
}

test("aggregate snapshots the product tier and queues duplicate ChatGPT identities without exposing email", () => {
  insertProduct("product-x5", "x5");
  insertProduct("product-plain", null);
  insertOrder("order-a", "KWMFA", "product-x5", "User@Example.com");
  insertOrder("order-b", "KWMFB", "product-x5", "user@example.com");
  insertOrder("order-plain", "KWMFPLAIN", "product-plain", "plain@example.com");
  insertOrder("order-manual-x5", "KWMFMANUALX5", "product-plain", "manual-x5@example.com", "pending");
  insertOrder("order-manual-x20", "KWMFMANUALX20", "product-plain", "manual-x20@example.com", "pending");
  insertOrder("order-manual-plus", "KWMFMANUALPLUS", "product-plain", "manual-plus@example.com", "pending");

  const first = createMembershipFulfillmentForOrder(db, {
    id: "mf-a",
    orderId: "order-a",
    orderNo: "KWMFA",
    productId: "product-x5",
    createdAt: at
  });
  const second = createMembershipFulfillmentForOrder(db, {
    id: "mf-b",
    orderId: "order-b",
    orderNo: "KWMFB",
    productId: "product-x5",
    createdAt: at
  });
  assert.equal(first.target_tier, "x5");
	assert.equal(second.state, "WAITING_SESSION_VALIDATION");
  assert.equal(createMembershipFulfillmentForOrder(db, {
    orderId: "order-plain",
    orderNo: "KWMFPLAIN",
    productId: "product-plain",
    createdAt: at
  }), null);
  assert.equal(createMembershipFulfillmentForOrder(db, {
    orderId: "order-manual-x5",
    orderNo: "KWMFMANUALX5",
    productId: "product-plain",
    manualType: "x5",
    createdAt: at
  }).target_tier, "x5");
  assert.equal(createMembershipFulfillmentForOrder(db, {
    orderId: "order-manual-x20",
    orderNo: "KWMFMANUALX20",
    productId: "product-plain",
    manualType: "x20",
    createdAt: at
  }).target_tier, "x20");
  assert.equal(createMembershipFulfillmentForOrder(db, {
    orderId: "order-manual-plus",
    orderNo: "KWMFMANUALPLUS",
    productId: "product-plain",
    manualType: "PLUS",
    createdAt: at
  }).target_tier, "plus");

  const activatedFirst = activateMembershipFulfillmentIdentity(db, {
    orderNo: "KWMFA",
    verifiedEmail: "User@Example.com",
    secret: process.env.JWT_SECRET,
    at
  });
  const activatedSecond = activateMembershipFulfillmentIdentity(db, {
    orderNo: "KWMFB",
    verifiedEmail: "user@example.com",
    secret: process.env.JWT_SECRET,
    at
  });
  assert.equal(activatedFirst.state, "QUEUED");
  assert.equal(activatedSecond.state, "ACCOUNT_FULFILLMENT_WAIT");
  assert.equal(activatedFirst.account_lock_key, activatedSecond.account_lock_key);
  assert.doesNotMatch(activatedFirst.account_lock_key, /user|example/i);
  assert.equal(
    activatedFirst.account_lock_key,
    deriveMembershipAccountLockKey(process.env.JWT_SECRET, { email: "user@example.com" })
  );

  transitionMembershipFulfillment(db, "mf-a", "ACCOUNT_ALREADY_SUBSCRIBED", { at });
  const promoted = promoteWaitingMembershipFulfillment(db, "mf-b", { at: "2026-07-16T00:01:00.000Z" });
  assert.equal(promoted.state, "QUEUED");
});

test("automatic scope eligibility is snapshotted only for orders created after scope activation", () => {
  insertProduct("product-auto-snapshot", "plus");
  insertOrder("order-auto-new", "KWAUTONEW", "product-auto-snapshot", "new-auto@example.com", "pending");
  insertOrder("order-auto-old", "KWAUTOOLD", "product-auto-snapshot", "old-auto@example.com", "pending");
  db.prepare("UPDATE redeem_orders SET created_at = ? WHERE id = 'order-auto-old'")
    .run("2026-07-15T23:00:00.000Z");
  db.prepare(`
    INSERT INTO automatic_checkout_scopes (
      id, scope_key, revision, site_id, product_id, tier, adapter_version,
      price_contract_id, daily_order_limit, daily_risk_limit_usd, status,
      activated_at, created_at, created_by
    ) VALUES ('scope-auto-snapshot', 'scope-key-auto', 1, 'site_demo',
      'product-auto-snapshot', 'plus', 'checkout-v1', 'contract-auto-snapshot',
      1, 30, 'active', '2026-07-15T23:30:00.000Z', '2026-07-15T23:30:00.000Z', 'admin')
  `).run();
  const newer = createMembershipFulfillmentForOrder(db, {
    id: "mf-auto-new",
    orderId: "order-auto-new",
    orderNo: "KWAUTONEW",
    productId: "product-auto-snapshot",
    createdAt: at
  });
  const older = createMembershipFulfillmentForOrder(db, {
    id: "mf-auto-old",
    orderId: "order-auto-old",
    orderNo: "KWAUTOOLD",
    productId: "product-auto-snapshot",
    createdAt: at
  });
  assert.equal(newer.run_mode, "automatic");
  assert.equal(older.run_mode, null);
});

test("customer projection claims success only for COMPLETED or an explicit compensation", () => {
  const base = {
    target_tier: "x20",
    state: "PLUS_CONFIRMED",
    updated_at: at
  };
  assert.deepEqual(projectMembershipDelivery(base), {
    status: "processing",
    label: "处理中",
    targetTier: "x20",
    updatedAt: at
  });
  assert.equal(projectMembershipDelivery({ ...base, state: "PARTIALLY_FULFILLED" }).label, "人工处理中");
  assert.equal(projectMembershipDelivery({ ...base, state: "COMPLETED" }).label, "交付成功");
  assert.equal(projectMembershipDelivery(base, {
    resolution_type: "REFUNDED",
    created_at: "2026-07-16T01:00:00.000Z"
  }).label, "已退款");
});

test("a cancelled membership fulfillment cannot be revived by a stale worker transition", () => {
  insertProduct("product-cancelled", null);
  insertOrder("order-cancelled", "KWCANCELLED", "product-cancelled", "cancelled@example.com", "succeeded");
  createMembershipFulfillmentForOrder(db, {
    id: "mf-cancelled",
    orderId: "order-cancelled",
    orderNo: "KWCANCELLED",
    productId: "product-cancelled",
    manualType: "plus",
    createdAt: at
  });
  assert.equal(activateMembershipFulfillmentIdentity(db, {
    orderNo: "KWCANCELLED",
    verifiedEmail: "cancelled@example.com",
    secret: process.env.JWT_SECRET,
    at
  }).state, "QUEUED");

  const cancelled = transitionMembershipFulfillment(db, "mf-cancelled", "CANCELLED", {
    failureCode: "CDKEY_VOIDED",
    at
  });
  assert.equal(cancelled.state, "CANCELLED");
  assert.equal(projectMembershipDelivery(cancelled).label, "卡密已作废");

  const staleTransition = transitionMembershipFulfillment(db, "mf-cancelled", "QUEUED", {
    at: "2026-07-16T00:01:00.000Z"
  });
  assert.equal(staleTransition.state, "CANCELLED");
  assert.equal(staleTransition.failure_code, "CDKEY_VOIDED");

  insertOrder("order-after-cancel", "KWAFTERCANCEL", "product-cancelled", "cancelled@example.com", "succeeded");
  createMembershipFulfillmentForOrder(db, {
    id: "mf-after-cancel",
    orderId: "order-after-cancel",
    orderNo: "KWAFTERCANCEL",
    productId: "product-cancelled",
    manualType: "plus",
    createdAt: "2026-07-16T00:02:00.000Z"
  });
  assert.equal(activateMembershipFulfillmentIdentity(db, {
    orderNo: "KWAFTERCANCEL",
    verifiedEmail: "cancelled@example.com",
    secret: process.env.JWT_SECRET,
    at: "2026-07-16T00:02:00.000Z"
  }).state, "QUEUED");
});

test("browser fulfillment lease is exclusive, epoch-bound, heartbeating, and released without card operations", () => {
  transitionMembershipFulfillment(db, "mf-b", "BROWSER_LEASE_WAIT", { at });
  const acquired = acquireBrowserFulfillmentLease(db, {
    fulfillmentId: "mf-b",
    installationId: "install-a",
    adapterVersion: "checkout-v1",
    priceContractVersion: 1,
    at: Date.parse(at)
  });
  assert.equal(acquired.acquired, true);
  assert.equal(acquired.lease.epoch, 1);
  assert.equal(acquired.fulfillment.state, "INITIAL_CHECKOUT_PREFLIGHT");
  assert.equal(acquireBrowserFulfillmentLease(db, {
    fulfillmentId: "mf-a",
    installationId: "install-a",
    at: Date.parse(at)
  }).acquired, false);

  const heartbeat = heartbeatBrowserFulfillmentLease(db, {
    fulfillmentId: "mf-b",
    installationId: "install-a",
    epoch: 1,
    at: Date.parse(at) + 10_000
  });
  assert.equal(heartbeat.epoch, 1);
  assert.equal(heartbeatBrowserFulfillmentLease(db, {
    fulfillmentId: "mf-b",
    installationId: "install-a",
    epoch: 2,
    at: Date.parse(at) + 20_000
  }), null);

  const released = releaseBrowserFulfillmentLease(db, {
    fulfillmentId: "mf-b",
    installationId: "install-a",
    epoch: 1,
    outcome: "recognized",
    at: "2026-07-16T00:02:00.000Z"
  });
  assert.equal(released.lease.state, "available");
  assert.equal(released.lease.epoch, 2);
  assert.equal(released.fulfillment.state, "FUNDING_READY");
  assert.equal(released.fulfillment.failure_code, "MEMBERSHIP_PAYMENT_GATE_LOCKED");
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM funding_intents").get().count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM card_capacity_reservations").get().count, 0);
});

test("expired browser attempts stay expired after a fresh lease completes", () => {
  insertProduct("product-lease-expiry", "plus");
  insertOrder("order-lease-expiry", "KWLEASEEXPIRY", "product-lease-expiry", "lease@example.com");
  createMembershipFulfillmentForOrder(db, {
    id: "mf-lease-expiry",
    orderId: "order-lease-expiry",
    orderNo: "KWLEASEEXPIRY",
    productId: "product-lease-expiry",
    createdAt: at
  });
  transitionMembershipFulfillment(db, "mf-lease-expiry", "BROWSER_LEASE_WAIT", { at });
  const first = acquireBrowserFulfillmentLease(db, {
    fulfillmentId: "mf-lease-expiry",
    installationId: "install-expiry",
    adapterVersion: "checkout-v1",
    priceContractVersion: 1,
    at: Date.parse(at)
  });
  assert.equal(first.acquired, true);
  expireBrowserFulfillmentLease(db, { at: Date.parse(at) + 60_001 });
  assert.equal(db.prepare("SELECT state FROM membership_fulfillments WHERE id = 'mf-lease-expiry'").get().state, "BROWSER_LEASE_WAIT");

  const second = acquireBrowserFulfillmentLease(db, {
    fulfillmentId: "mf-lease-expiry",
    installationId: "install-expiry",
    adapterVersion: "checkout-v1",
    priceContractVersion: 1,
    at: Date.parse(at) + 61_000
  });
  assert.equal(second.acquired, true);
  releaseBrowserFulfillmentLease(db, {
    fulfillmentId: "mf-lease-expiry",
    installationId: "install-expiry",
    epoch: second.lease.epoch,
    outcome: "recognized",
    at: Date.parse(at) + 62_000
  });
  assert.deepEqual(db.prepare(`
    SELECT attempt_no, outcome_code, ended_at
    FROM membership_fulfillment_attempts
    WHERE fulfillment_id = 'mf-lease-expiry'
    ORDER BY attempt_no
  `).all().map((item) => ({
    attemptNo: item.attempt_no,
    outcome: item.outcome_code,
    ended: Boolean(item.ended_at)
  })), [
    { attemptNo: 1, outcome: "BROWSER_LEASE_EXPIRED", ended: true },
    { attemptNo: 2, outcome: "PREFLIGHT_RECOGNIZED", ended: true }
  ]);
});

test("post-payment sanitization releases only the browser lease and preserves reconciliation truth", () => {
  insertProduct("product-sanitize", "plus");
  insertOrder("order-sanitize", "KWSANITIZE", "product-sanitize", "sanitize@example.com");
  createMembershipFulfillmentForOrder(db, {
    id: "mf-sanitize",
    orderId: "order-sanitize",
    orderNo: "KWSANITIZE",
    productId: "product-sanitize",
    createdAt: at
  });
  transitionMembershipFulfillment(db, "mf-sanitize", "BROWSER_LEASE_WAIT", { at });
  const acquired = acquireBrowserFulfillmentLease(db, {
    fulfillmentId: "mf-sanitize",
    installationId: "install-sanitize",
    adapterVersion: "checkout-v1",
    priceContractVersion: 1,
    at: Date.parse(at)
  });
  db.prepare(`
    UPDATE membership_fulfillments SET state = 'PAYMENT_OUTCOME_UNCERTAIN'
    WHERE id = 'mf-sanitize'
  `).run();
  const released = sanitizeAndReleaseBrowserFulfillmentLease(db, {
    fulfillmentId: "mf-sanitize",
    installationId: "install-sanitize",
    epoch: acquired.lease.epoch,
    at: "2026-07-16T00:01:00.000Z"
  });
  assert.equal(released.lease.state, "available");
  assert.equal(released.fulfillment.state, "PAYMENT_OUTCOME_UNCERTAIN");
  assert.equal(released.fulfillment.browser_lease_epoch, null);
});

test("payment lease expiry retries only before a permit and becomes uncertain after submit permission", () => {
  insertProduct("product-payment-lease", "plus");
  insertOrder("order-payment-lease", "KWPAYLEASE", "product-payment-lease", "paylease@example.com");
  createMembershipFulfillmentForOrder(db, {
    id: "mf-payment-lease",
    orderId: "order-payment-lease",
    orderNo: "KWPAYLEASE",
    productId: "product-payment-lease",
    createdAt: at
  });
  db.prepare(`
    INSERT INTO checkout_price_contracts (
      id, tier, version, currency, min_amount, max_amount, status,
      created_at, created_by, activated_at
    ) VALUES ('contract-payment-lease', 'plus', 77, 'PHP', 900, 1200, 'draft', ?, 'admin', NULL)
  `).run(at);
  db.prepare(`
    INSERT INTO managed_cards (
      id, upstream_card_id, vm_card_id, product_code, upstream_status,
      cached_available_amount, lane, capacity_state, reconciliation_state,
      created_at, updated_at
    ) VALUES ('card-payment-lease', 991177, 'vm-payment-lease', 'LEASE', 'ACTIVE',
      30, 'plus', 'AVAILABLE', 'READY', ?, ?)
  `).run(at, at);
  db.prepare(`
    INSERT INTO membership_payment_stages (
      id, fulfillment_id, stage_key, expected_tier, state, card_id,
      price_contract_id, created_at, updated_at
    ) VALUES ('stage-payment-lease', 'mf-payment-lease', 'plus', 'plus',
      'checkout_pending', 'card-payment-lease', 'contract-payment-lease', ?, ?)
  `).run(at, at);
  db.prepare(`
    UPDATE membership_fulfillments
    SET state = 'BROWSER_LEASE_WAIT', current_stage = 'plus', run_mode = 'canary'
    WHERE id = 'mf-payment-lease'
  `).run();

  const first = acquirePaymentBrowserFulfillmentLease(db, {
    fulfillmentId: "mf-payment-lease",
    installationId: "install-payment-lease",
    at: Date.parse(at)
  });
  assert.equal(first.fulfillment.state, "PLUS_CHECKOUT_READY");
  expireBrowserFulfillmentLease(db, { at: Date.parse(at) + 60_001 });
  assert.equal(db.prepare("SELECT state FROM membership_fulfillments WHERE id = 'mf-payment-lease'").get().state,
    "BROWSER_LEASE_WAIT");
  assert.equal(db.prepare("SELECT state FROM membership_payment_stages WHERE id = 'stage-payment-lease'").get().state,
    "checkout_pending");

  const second = acquirePaymentBrowserFulfillmentLease(db, {
    fulfillmentId: "mf-payment-lease",
    installationId: "install-payment-lease",
    at: Date.parse(at) + 61_000
  });
  db.prepare(`
    INSERT INTO membership_action_permits (
      id, fulfillment_id, stage_key, attempt_no, action_type, sequence_no,
      installation_id, browser_lease_epoch, adapter_version, price_contract_id,
      control_id, page_fingerprint, state, issued_at, expires_at
    ) VALUES ('permit-payment-lease', 'mf-payment-lease', 'plus', ?, 'submit', 1,
      'install-payment-lease', ?, 'checkout-v1', 'contract-payment-lease',
      'payment-submit', ?, 'issued', ?, ?)
  `).run(
    second.attemptNo,
    second.lease.epoch,
    "a".repeat(64),
    "2026-07-16T00:01:01.000Z",
    "2026-07-16T00:01:30.000Z"
  );
  expireBrowserFulfillmentLease(db, { at: Date.parse(at) + 122_000 });
  assert.equal(db.prepare("SELECT state FROM membership_fulfillments WHERE id = 'mf-payment-lease'").get().state,
    "PAYMENT_OUTCOME_UNCERTAIN");
});

test("worker advances a verified free account through read-only readiness to browser lease wait", async () => {
  insertProduct("product-plus-runner", "plus");
  insertOrder("order-runner", "KWRUNNER", "product-plus-runner", "runner@example.com");
  createMembershipFulfillmentForOrder(db, {
    id: "mf-runner",
    orderId: "order-runner",
    orderNo: "KWRUNNER",
    productId: "product-plus-runner",
    createdAt: at
  });
  db.prepare(`
    UPDATE membership_fulfillment_settings SET inventory_status = 'completed' WHERE id = 'default'
  `).run();
  db.prepare(`
    UPDATE extension_delivery_settings
    SET spacexcard_api_token_encrypted = ? WHERE id = 'default'
  `).run(encryptText("server-side-gpt-token"));
  db.prepare(`
    INSERT INTO managed_cards (
      id, upstream_card_id, vm_card_id, product_code, bin, last4, upstream_status,
      cached_available_amount, lane, consumed_slots, capacity_state, reconciliation_state,
      created_at, updated_at
    ) VALUES ('card-runner', 88001, 'vm-runner', 'RUNNER-CARD', '537872', '0001',
      'ACTIVE', 20, NULL, 0, 'AVAILABLE', 'READY', ?, ?)
  `).run(at, at);
  db.prepare(`
    INSERT INTO card_price_signals (
      card_id, tier, found, amount, min_usd, max_usd, provider_time, fetched_at
    ) VALUES ('card-runner', 'plus', 1, 16.24, 15, 20, ?, ?)
  `).run("2026-07-16T00:00:00+08:00", at);
  db.prepare(`
    INSERT INTO checkout_price_contracts (
      id, tier, version, currency, min_amount, max_amount, status,
      created_at, created_by, activated_at
    ) VALUES ('contract-runner', 'plus', 1, 'PHP', 999, 1099, 'active', ?, 'admin', ?)
  `).run(at, at);

  const runner = createMembershipFulfillmentRunner({
    db,
    decryptText: (value) => {
      // Use the real decryptor through a late import-free closure.
      const [ivHex, tagHex, contentHex] = String(value).split(":");
      assert.ok(ivHex && tagHex && contentHex);
      return JSON.stringify({ user: { email: "runner@example.com" } });
    },
    identitySecret: process.env.JWT_SECRET,
    now: () => new Date("2026-07-16T04:00:00.000Z"),
    membershipFetcher: async () => ({
      providerCode: 200,
      accountType: "free",
      currency: null,
	  autoRenew: false,
      isOverdue: false,
      isDelinquent: false,
      expireTime: null,
      expireTimeFuture: false,
      observedAt: "2026-07-16T04:00:00.000Z"
    })
  });
  const result = await runner.tick();
  assert.equal(result.processed, 1);
  const fulfillment = db.prepare("SELECT * FROM membership_fulfillments WHERE id = 'mf-runner'").get();
  assert.equal(fulfillment.state, "BROWSER_LEASE_WAIT");
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM membership_observations WHERE fulfillment_id = 'mf-runner'").get().count, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM membership_outbox WHERE fulfillment_id = 'mf-runner'").get().count >= 1, true);
});

test("a blocked duplicate-account waiter does not starve an unrelated queued account", async () => {
  insertProduct("product-queue-fairness", "plus");
  insertOrder("order-lock-holder", "KWLOCKHOLDER", "product-queue-fairness", "locked@example.com");
  insertOrder("order-lock-waiter", "KWLOCKWAITER", "product-queue-fairness", "locked@example.com");
  insertOrder("order-unrelated", "KWUNRELATED", "product-queue-fairness", "other@example.com");
  for (const [id, orderId, orderNo] of [
    ["mf-lock-holder", "order-lock-holder", "KWLOCKHOLDER"],
    ["mf-lock-waiter", "order-lock-waiter", "KWLOCKWAITER"],
    ["mf-unrelated", "order-unrelated", "KWUNRELATED"]
  ]) {
    createMembershipFulfillmentForOrder(db, {
      id,
      orderId,
      orderNo,
      productId: "product-queue-fairness",
      createdAt: at
    });
  }
  activateMembershipFulfillmentIdentity(db, {
    orderNo: "KWLOCKHOLDER",
    verifiedEmail: "locked@example.com",
    secret: process.env.JWT_SECRET,
    at
  });
  activateMembershipFulfillmentIdentity(db, {
    orderNo: "KWLOCKWAITER",
    verifiedEmail: "locked@example.com",
    secret: process.env.JWT_SECRET,
    at
  });
  activateMembershipFulfillmentIdentity(db, {
    orderNo: "KWUNRELATED",
    verifiedEmail: "other@example.com",
    secret: process.env.JWT_SECRET,
    at
  });
  transitionMembershipFulfillment(db, "mf-lock-holder", "BROWSER_LEASE_WAIT", { at });

  const runner = createMembershipFulfillmentRunner({
    db,
    decryptText: () => JSON.stringify({ user: { email: "other@example.com" } }),
    identitySecret: process.env.JWT_SECRET,
    now: () => new Date("2026-07-16T04:01:00.000Z"),
    membershipFetcher: async () => ({
      providerCode: 200,
      accountType: "free",
      currency: null,
	  autoRenew: false,
      isOverdue: false,
      isDelinquent: false,
      expireTime: null,
      expireTimeFuture: false,
      observedAt: "2026-07-16T04:01:00.000Z"
    })
  });
  const result = await runner.tick();
  assert.equal(result.fulfillmentId, "mf-unrelated");
  assert.equal(db.prepare("SELECT state FROM membership_fulfillments WHERE id = 'mf-lock-waiter'").get().state, "ACCOUNT_FULFILLMENT_WAIT");
  assert.equal(db.prepare("SELECT state FROM membership_fulfillments WHERE id = 'mf-unrelated'").get().state, "BROWSER_LEASE_WAIT");
});

test("checkout broker uses the fixed Plus/PH/PHP contract and rejects drift", async () => {
  assert.equal(validateChatGptCheckoutUrl("https://chatgpt.com/checkout"), "https://chatgpt.com/checkout");
  assert.equal(validateChatGptCheckoutUrl("https://chatgpt.com/not-checkout"), null);
  const requests = [];
  const checkout = await createSpaceXCardCheckout(
    { user: { email: "redacted@example.com" } },
    "private-token",
    {
      fetchImpl: async (url, options) => {
        requests.push({ url, options });
        return new Response(JSON.stringify({
          code: 200,
          data: { link: "https://pay.openai.com/checkout/redacted" },
          msg: "ok"
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
    }
  );
  assert.equal(checkout.checkoutUrl, "https://pay.openai.com/checkout/redacted");
  assert.equal(requests[0].url, spaceXCardGptCheckoutUrl);
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    token_input: JSON.stringify({ user: { email: "redacted@example.com" } }),
    plan_name: "plus",
    country: "PH",
    currency: "PHP"
  });
  assert.equal(requests[0].options.headers.Authorization, "Bearer private-token");

  await assert.rejects(() => createSpaceXCardCheckout({}, "private-token", {
    fetchImpl: async () => new Response(JSON.stringify({
      code: 0,
      data: { link: "https://evil.example/checkout/token" }
    }), { status: 200 })
  }), (error) => error.code === "CHECKOUT_BROKER_LINK_INVALID");
  await assert.rejects(() => createSpaceXCardCheckout({}, "private-token", {
    fetchImpl: async () => new Response(JSON.stringify({ code: 400, message: "not exposed" }), { status: 200 })
  }), (error) => error.code === "CHECKOUT_BROKER_BUSINESS_REJECTED");
  await assert.rejects(() => createSpaceXCardCheckout({}, "private-token", {
    fetchImpl: async () => new Response(JSON.stringify({ code: 200, data: {} }), { status: 200 })
  }), (error) => error.code === "CHECKOUT_BROKER_LINK_MISSING");
  await assert.rejects(() => createSpaceXCardCheckout({}, "private-token", {
    fetchImpl: async () => new Response("{}", { status: 429, headers: { "retry-after": "2" } })
  }), (error) => error.code === "CHECKOUT_BROKER_RATE_LIMITED" && error.retryAfterMs === 2000);
  await assert.rejects(() => createSpaceXCardCheckout({}, "private-token", {
    fetchImpl: async () => new Response("{}", { status: 200, headers: { "content-length": String(200 * 1024) } })
  }), (error) => error.code === "CHECKOUT_BROKER_RESPONSE_TOO_LARGE");
});

test("public order response exposes only the customer-safe membership projection", async () => {
  ({ app } = await import("../api/src/server.js"));
  const response = await app.inject({ method: "GET", url: "/api/public/orders/KWMFB" });
  assert.equal(response.statusCode, 200);
  const delivery = response.json().membershipDelivery;
  assert.deepEqual(Object.keys(delivery).sort(), ["label", "status", "targetTier", "updatedAt"]);
  assert.equal(delivery.label, "处理中");
  assert.doesNotMatch(response.body, /account_lock|example\.com|browserLeaseEpoch|failureCode/);
});

test("admin fulfillment list and detail expose operational metadata without account identity", async () => {
  if (!app) ({ app } = await import("../api/src/server.js"));
  const login = await app.inject({
    method: "POST",
    url: "/api/admin/auth/login",
    payload: { username: "admin", password: "test-password" }
  });
  const headers = { authorization: `Bearer ${login.json().token}` };
  const listed = await app.inject({
    method: "GET",
    url: "/api/admin/membership-fulfillments?limit=200",
    headers
  });
  assert.equal(listed.statusCode, 200);
  assert.equal(listed.json().items.some((item) => item.id === "mf-runner"), true);
  assert.doesNotMatch(listed.body, /account_lock|runner@example|session_payload/i);

  const detailed = await app.inject({
    method: "GET",
    url: "/api/admin/membership-fulfillments/mf-runner",
    headers
  });
  assert.equal(detailed.statusCode, 200);
  assert.equal(detailed.json().item.targetTier, "plus");
  assert.equal(Array.isArray(detailed.json().attempts), true);
  assert.deepEqual(Object.keys(detailed.json().customerProjection).sort(), ["label", "status", "targetTier", "updatedAt"]);
  assert.doesNotMatch(detailed.body, /account_lock|runner@example|session_payload|checkoutUrl/i);
});

test("extension REST preflight is lease-bound, diagnostic-only, and keeps material claim locked", async () => {
  if (!app) ({ app } = await import("../api/src/server.js"));
  const extensionToken = "extension-preflight-token";
  db.prepare(`
    UPDATE extension_delivery_settings
    SET enabled = 1, extension_token_sha256 = ?, bound_installation_id = ?,
        spacexcard_api_token_encrypted = ?
    WHERE id = 'default'
  `).run(
    createHash("sha256").update(extensionToken).digest("hex"),
    "install-preflight",
    encryptText("server-side-gpt-token")
  );
  const headers = {
    authorization: `Bearer ${extensionToken}`,
    "x-extension-installation-id": "install-preflight"
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, spaceXCardGptCheckoutUrl);
    assert.equal(JSON.parse(options.body).plan_name, "plus");
    return new Response(JSON.stringify({
      code: 0,
      data: { link: "https://pay.openai.com/checkout/one-time-redacted" },
      msg: "ok"
    }), { status: 200 });
  };
  try {
    const command = await app.inject({
      method: "GET",
      url: "/api/extension/membership-fulfillments/mf-runner/command",
      headers
    });
    assert.equal(command.statusCode, 200);
    const payload = command.json();
    assert.equal(payload.command, "PREFLIGHT_INITIAL_CHECKOUT");
    assert.equal(payload.leaseEpoch >= 1, true);
    assert.equal(payload.priceContract.currency, "PHP");
    assert.doesNotMatch(command.body, /runner@example|server-side-gpt-token|cardNumber|cvv|address/i);

    const rawRejected = await app.inject({
      method: "POST",
      url: "/api/extension/membership-fulfillments/mf-runner/diagnostic",
      headers,
      payload: {
        leaseEpoch: payload.leaseEpoch,
        adapterVersion: "checkout-v1",
        rawHtml: "<input value='sensitive'>"
      }
    });
    assert.equal(rawRejected.statusCode, 400);

    const diagnosticBody = {
      leaseEpoch: payload.leaseEpoch,
      adapterVersion: "checkout-v1",
      stateId: "INITIAL_CHECKOUT_RECOGNIZED",
      origin: "https://pay.openai.com",
      originRecognized: true,
      routeTemplate: "/pay/{id}",
      plan: "plus",
      currency: "PHP",
      displayedAmount: 1049,
      expectedElements: {
        cardNumber: true,
        expiry: true,
        cvc: true,
        billingName: true,
        billingCountry: true,
        billingPostal: true,
        finalControl: true
      },
      structuralHash: "a".repeat(64),
      cardMaterialRequested: false,
      controlActivated: false
    };
    const diagnostic = await app.inject({
      method: "POST",
      url: "/api/extension/membership-fulfillments/mf-runner/diagnostic",
      headers,
      payload: diagnosticBody
    });
    assert.equal(diagnostic.statusCode, 200, diagnostic.body);
    assert.equal(diagnostic.json().status, "passed");

    const heartbeat = await app.inject({
      method: "POST",
      url: "/api/extension/membership-fulfillments/mf-runner/events",
      headers,
      payload: { type: "LEASE_HEARTBEAT", leaseEpoch: payload.leaseEpoch }
    });
    assert.equal(heartbeat.statusCode, 200);
    const finished = await app.inject({
      method: "POST",
      url: "/api/extension/membership-fulfillments/mf-runner/events",
      headers,
      payload: {
        type: "PREFLIGHT_FINISHED",
        leaseEpoch: payload.leaseEpoch,
        adapterVersion: "checkout-v1",
        outcome: "recognized",
        sanitized: true
      }
    });
    assert.equal(finished.statusCode, 200);
    assert.equal(finished.json().paymentGateLocked, true);
    assert.equal(finished.json().state, "FUNDING_READY");

    const material = await app.inject({
      method: "POST",
      url: "/api/extension/membership-material-grants/nonexistent/claim",
      headers,
      payload: {}
    });
    assert.equal(material.statusCode, 409);
    assert.equal(material.json().code, "MEMBERSHIP_PAYMENT_GATE_LOCKED");
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM funding_intents").get().count, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM card_capacity_reservations").get().count, 0);
    const persisted = JSON.stringify(db.prepare(`
      SELECT sanitized_diagnostic FROM membership_fulfillment_attempts WHERE fulfillment_id = 'mf-runner'
    `).get());
    assert.doesNotMatch(persisted, /rawHtml|sensitive|runner@example|one-time-redacted/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("funded canary waits on the exact filled-page snapshot before any permit can exist", async () => {
  if (!app) ({ app } = await import("../api/src/server.js"));
  insertProduct("product-payment-protocol", "plus");
  insertOrder("order-payment-protocol", "KWPAYPROTO", "product-payment-protocol", "protocol@example.com");
  db.prepare(`
    INSERT INTO membership_fulfillments (
      id, order_id, order_no, target_tier, state, current_stage, run_mode,
      card_reservation_id, created_at, updated_at
    ) VALUES ('mf-payment-protocol', 'order-payment-protocol', 'KWPAYPROTO',
      'plus', 'BROWSER_LEASE_WAIT', 'plus', 'canary',
      'reservation-payment-protocol', ?, ?)
  `).run(at, at);
  db.prepare(`
    INSERT INTO card_capacity_reservations (
      id, fulfillment_id, card_id, target_lane, slot_index, state, reserved_at
    ) VALUES ('reservation-payment-protocol', 'mf-payment-protocol', 'card-runner',
      'plus', 2, 'reserved', ?)
  `).run(at);
  db.prepare(`
    INSERT INTO membership_payment_stages (
      id, fulfillment_id, stage_key, expected_tier, state, card_id,
      price_signal_amount, price_signal_min, price_signal_max, price_signal_time,
      adapter_version, price_contract_id, created_at, updated_at
    ) VALUES ('stage-payment-protocol', 'mf-payment-protocol', 'plus', 'plus',
      'checkout_pending', 'card-runner', 16.24, 15, 20, ?, 'checkout-v1',
      'contract-runner', ?, ?)
  `).run("2026-07-16T00:00:00.000Z", at, at);
  db.prepare(`
    INSERT INTO checkout_validation_runs (
      id, order_id, site_id, product_id, tier, adapter_version,
      price_contract_id, status, sanitized_result, started_at, completed_at, created_by
    ) VALUES ('validation-payment-protocol', 'order-payment-protocol', 'site_demo',
      'product-payment-protocol', 'plus', 'checkout-v1', 'contract-runner', 'passed', ?, ?, ?, 'extension')
  `).run(JSON.stringify({ origin: "https://pay.openai.com", routeTemplate: "/pay/{id}" }), at, at);
  db.prepare(`
    UPDATE membership_fulfillment_settings
    SET enabled = 1, rollout_mode = 'canary', inventory_status = 'completed'
    WHERE id = 'default'
  `).run();
  const extensionToken = "extension-preflight-token";
  const extensionHeaders = {
    authorization: `Bearer ${extensionToken}`,
    "x-extension-installation-id": "install-preflight"
  };
  const command = await app.inject({
    method: "GET",
    url: "/api/extension/membership-fulfillments/mf-payment-protocol/command",
    headers: extensionHeaders
  });
  assert.equal(command.statusCode, 200, command.body);
  const materialCommand = command.json();
  assert.equal(materialCommand.command, "CLAIM_STAGE_MATERIAL");
  assert.equal(materialCommand.expectedOrigin, "https://pay.openai.com");
  db.prepare(`
    UPDATE membership_material_grants SET claimed_at = ? WHERE id = ?
  `).run("2026-07-16T00:00:01.000Z", materialCommand.grantId);

  const page = {
    stateId: "PAYMENT_FINAL_READY",
    origin: "https://pay.openai.com",
    routeTemplate: "/pay/{id}",
    plan: "plus",
    country: "PH",
    currency: "PHP",
    displayedAmount: 1049,
    stateMarker: "review",
    fields: {
      cardNumber: true, expiry: true, expiryMonth: false, expiryYear: false, cvc: true,
      billingName: true, billingLine1: false, billingCity: false, billingState: false,
      billingCountry: true, billingPostal: true
    },
    controls: {
      progression: null,
      submit: "payment-submit",
      upgradeX5: null,
      upgradeX20: null,
      challenge: null
    }
  };
  page.structuralHash = createHash("sha256").update(JSON.stringify(page)).digest("hex");
  const binding = {
    stage: "plus",
    targetTier: "plus",
    attempt: materialCommand.attempt,
    leaseEpoch: materialCommand.leaseEpoch,
    adapterVersion: "checkout-v1"
  };
  const ready = await app.inject({
    method: "POST",
    url: "/api/extension/membership-fulfillments/mf-payment-protocol/events",
    headers: extensionHeaders,
    payload: {
      type: "STAGE_PAGE_READY",
      ...binding,
      permitKind: "submit",
      controlId: "payment-submit",
      pageFingerprint: page.structuralHash,
      page
    }
  });
  assert.equal(ready.statusCode, 200, ready.body);
  assert.equal(ready.json().proceed, false);
  assert.equal(ready.json().awaitApproval, true);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM membership_action_permits WHERE fulfillment_id = 'mf-payment-protocol'").get().count, 0);

  const waiting = await app.inject({
    method: "GET",
    url: "/api/extension/membership-fulfillments/mf-payment-protocol/command",
    headers: extensionHeaders
  });
  assert.equal(waiting.json().command, "AWAIT_APPROVAL");
  assert.equal(waiting.json().approvalReady, false);

  const login = await app.inject({
    method: "POST",
    url: "/api/admin/auth/login",
    payload: { username: "admin", password: "test-password" }
  });
  const adminHeaders = { authorization: `Bearer ${login.json().token}` };
  const prepared = await app.inject({
    method: "GET",
    url: "/api/admin/live-canary-authorizations?fulfillmentId=mf-payment-protocol",
    headers: adminHeaders
  });
  const snapshot = prepared.json().canaryPreparation;
  assert.equal(snapshot.ready, true);
  const approved = await app.inject({
    method: "POST",
    url: "/api/admin/live-canary-authorizations",
    headers: adminHeaders,
    payload: {
      fulfillmentId: "mf-payment-protocol",
      stage: snapshot.stage,
      cardId: snapshot.cardId,
      fundingBudgetUsd: snapshot.fundingBudgetUsd,
      priceContractId: snapshot.priceContractId,
      adapterVersion: snapshot.adapterVersion,
      pageFingerprint: snapshot.pageFingerprint,
      credentials: { username: "admin", password: "test-password" }
    }
  });
  assert.equal(approved.statusCode, 200, approved.body);
  const continued = await app.inject({
    method: "GET",
    url: "/api/extension/membership-fulfillments/mf-payment-protocol/command",
    headers: extensionHeaders
  });
  assert.equal(continued.json().command, "CONTINUE_STAGE");
  assert.equal(continued.json().pageFingerprint, page.structuralHash);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM membership_action_permits WHERE fulfillment_id = 'mf-payment-protocol'").get().count, 0);
});

test("upgrade preflight requires a reported clear progression and a closed rollout gate still permits cleanup", async () => {
  if (!app) ({ app } = await import("../api/src/server.js"));
  const extensionToken = "extension-upgrade-guard-token";
  const headers = {
    authorization: `Bearer ${extensionToken}`,
    "x-extension-installation-id": "install-upgrade-guard"
  };
  db.prepare(`
    UPDATE extension_delivery_settings
    SET enabled = 1, extension_token_sha256 = ?, bound_installation_id = ?
    WHERE id = 'default'
  `).run(
    createHash("sha256").update(extensionToken).digest("hex"),
    "install-upgrade-guard"
  );
  db.prepare(`
    UPDATE membership_fulfillment_settings
    SET enabled = 1, rollout_mode = 'canary' WHERE id = 'default'
  `).run();
  db.prepare(`
    INSERT INTO checkout_price_contracts (
      id, tier, version, currency, min_amount, max_amount, status,
      created_at, created_by, activated_at
    ) VALUES ('contract-upgrade-guard', 'x5', 91, 'PHP', 4900, 5100,
      'active', ?, 'admin', ?)
  `).run(at, at);
  insertProduct("product-upgrade-guard", "x5");
  insertOrder(
    "order-upgrade-guard",
    "KWUPGRADEGUARD",
    "product-upgrade-guard",
    "upgrade-guard@example.com"
  );
  db.prepare(`
    INSERT INTO membership_fulfillments (
      id, order_id, order_no, target_tier, state, current_stage, run_mode,
      browser_lease_epoch, money_boundary_at, created_at, updated_at
    ) VALUES ('mf-upgrade-guard', 'order-upgrade-guard', 'KWUPGRADEGUARD',
      'x5', 'UPGRADE_CHECKOUT_PREFLIGHT', 'upgrade', 'canary', 7, ?, ?, ?)
  `).run(at, at, at);
  db.prepare(`
    INSERT INTO membership_payment_stages (
      id, fulfillment_id, stage_key, expected_tier, state, card_id,
      price_signal_amount, price_signal_min, price_signal_max, price_signal_time,
      attempt_no, adapter_version, adapter_path, price_contract_id,
      created_at, updated_at
    ) VALUES ('stage-upgrade-guard', 'mf-upgrade-guard', 'upgrade', 'x5',
      'preflight_ready', 'card-upgrade-guard', 49, 45, 55, ?, 1,
      'plan-management-v1', 'plan-management-v1+checkout-v1',
      'contract-upgrade-guard', ?, ?)
  `).run(at, at, at);
  db.prepare(`
    INSERT INTO membership_fulfillment_attempts (
      id, fulfillment_id, stage, attempt_no, resume_revision,
      adapter_version, price_contract_version, started_at
    ) VALUES ('attempt-upgrade-guard', 'mf-upgrade-guard', 'upgrade', 1, 0,
      'plan-management-v1', 91, ?)
  `).run(at);
  db.prepare(`
    UPDATE browser_fulfillment_lease
    SET fulfillment_id = 'mf-upgrade-guard', installation_id = 'install-upgrade-guard',
        epoch = 7, state = 'leased', heartbeat_at = ?,
        expires_at = '2099-01-01T00:00:00.000Z', updated_at = ?
    WHERE id = 'default'
  `).run(at, at);

  const page = {
    stateId: "UPGRADE_SELECTION_READY",
    origin: "https://chatgpt.com",
    routeTemplate: "/settings/subscription",
    plan: "prolite",
    country: "PH",
    currency: "PHP",
    displayedAmount: 4999,
    stateMarker: "upgrade-selection",
    fields: {
      cardNumber: false, expiry: false, expiryMonth: false, expiryYear: false, cvc: false,
      billingName: false, billingLine1: false, billingCity: false, billingState: false,
      billingCountry: false, billingPostal: false
    },
    controls: {
      progression: null, submit: null, upgradeX5: "upgrade-x5", upgradeX20: null, challenge: null
    }
  };
  page.structuralHash = createHash("sha256").update(JSON.stringify(page)).digest("hex");
  const binding = {
    stage: "upgrade",
    targetTier: "x5",
    attempt: 1,
    leaseEpoch: 7,
    adapterVersion: "plan-management-v1"
  };
  const ready = await app.inject({
    method: "POST",
    url: "/api/extension/membership-fulfillments/mf-upgrade-guard/events",
    headers,
    payload: {
      type: "STAGE_PAGE_READY",
      ...binding,
      permitKind: "progression",
      controlId: "upgrade-x5",
      pageFingerprint: page.structuralHash,
      page
    }
  });
  assert.equal(ready.statusCode, 200, ready.body);
  assert.equal(db.prepare("SELECT state FROM membership_payment_stages WHERE id = 'stage-upgrade-guard'").get().state,
    "preflight_ready");

  db.prepare(`
    INSERT INTO membership_action_permits (
      id, fulfillment_id, stage_key, attempt_no, action_type, sequence_no,
      installation_id, browser_lease_epoch, adapter_version, price_contract_id,
      control_id, page_fingerprint, state, issued_at, expires_at
    ) VALUES ('permit-upgrade-guard', 'mf-upgrade-guard', 'upgrade', 1,
      'progression', 1, 'install-upgrade-guard', 7, 'plan-management-v1',
      'contract-upgrade-guard', 'upgrade-x5', ?, 'issued', ?,
      '2099-01-01T00:00:00.000Z')
  `).run(page.structuralHash, at);
  db.prepare(`
    UPDATE membership_payment_stages SET state = 'progression_permitted'
    WHERE id = 'stage-upgrade-guard'
  `).run();

  const lateReady = await app.inject({
    method: "POST",
    url: "/api/extension/membership-fulfillments/mf-upgrade-guard/events",
    headers,
    payload: {
      type: "STAGE_PAGE_READY",
      ...binding,
      permitKind: "progression",
      controlId: "upgrade-x5",
      pageFingerprint: page.structuralHash,
      page
    }
  });
  assert.equal(lateReady.statusCode, 409, lateReady.body);
  assert.equal(lateReady.json().code, "MEMBERSHIP_STAGE_NOT_READY");
  assert.equal(db.prepare("SELECT state FROM membership_payment_stages WHERE id = 'stage-upgrade-guard'").get().state,
    "progression_permitted");

  const finishBody = { type: "UPGRADE_PREFLIGHT_FINISHED", ...binding, page };
  const premature = await app.inject({
    method: "POST",
    url: "/api/extension/membership-fulfillments/mf-upgrade-guard/events",
    headers,
    payload: finishBody
  });
  assert.equal(premature.statusCode, 409, premature.body);
  assert.equal(premature.json().code, "UPGRADE_PREFLIGHT_AUTHORIZATION_CLEAR_REQUIRED");
  assert.equal(db.prepare("SELECT adapter_version FROM membership_fulfillment_attempts WHERE id = 'attempt-upgrade-guard'").get().adapter_version,
    "plan-management-v1");

  db.prepare(`
    UPDATE membership_action_permits
    SET state = 'reported', activated_at = ?, reported_at = ?, outcome_code = 'AUTHORIZATION_CLEAR'
    WHERE id = 'permit-upgrade-guard'
  `).run(at, at);
  db.prepare(`
    UPDATE membership_payment_stages
    SET state = 'checkout_ready', progression_reported_at = ?
    WHERE id = 'stage-upgrade-guard'
  `).run(at);
  db.prepare(`
    UPDATE membership_fulfillment_settings
    SET enabled = 0, rollout_mode = 'disabled' WHERE id = 'default'
  `).run();

  const finished = await app.inject({
    method: "POST",
    url: "/api/extension/membership-fulfillments/mf-upgrade-guard/events",
    headers,
    payload: finishBody
  });
  assert.equal(finished.statusCode, 200, finished.body);
  assert.equal(finished.json().state, "UPGRADE_CHECKOUT_READY");
  assert.deepEqual(db.prepare(`
    SELECT state, adapter_version FROM membership_payment_stages WHERE id = 'stage-upgrade-guard'
  `).get(), { state: "checkout_ready", adapter_version: "checkout-v1" });

  db.prepare(`
    UPDATE membership_fulfillments SET state = 'COMPLETED', current_stage = 'upgrade'
    WHERE id = 'mf-upgrade-guard'
  `).run();
  const cleanup = await app.inject({
    method: "GET",
    url: "/api/extension/membership-fulfillments/mf-upgrade-guard/command",
    headers
  });
  assert.equal(cleanup.statusCode, 200, cleanup.body);
  assert.equal(cleanup.json().command, "SANITIZE_AND_RELEASE");
  const sanitized = await app.inject({
    method: "POST",
    url: "/api/extension/membership-fulfillments/mf-upgrade-guard/events",
    headers,
    payload: {
      type: "CONTEXT_SANITIZED",
      stage: "upgrade",
      targetTier: "x5",
      attempt: 1,
      leaseEpoch: 7,
      adapterVersion: "checkout-v1",
      sanitized: true
    }
  });
  assert.equal(sanitized.statusCode, 200, sanitized.body);
  assert.equal(sanitized.json().released, true);
  assert.deepEqual(db.prepare(`
    SELECT state, browser_lease_epoch FROM membership_fulfillments WHERE id = 'mf-upgrade-guard'
  `).get(), { state: "COMPLETED", browser_lease_epoch: null });
  assert.equal(db.prepare("SELECT state FROM browser_fulfillment_lease WHERE id = 'default'").get().state, "available");
});
