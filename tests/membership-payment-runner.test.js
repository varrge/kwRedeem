import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kawang-membership-payment-runner-"));
process.env.DATABASE_PATH = path.join(tmpDir, "test.db");
process.env.JWT_SECRET = "membership-payment-runner-test-secret";

const { getDb } = await import("../shared/src/database.js");
const { MembershipFundingError, getMembershipFundingIntent } = await import("../shared/src/membership-funding.js");
const {
  createMembershipPaymentRunner,
  membershipPaymentRunnerGateDefault
} = await import("../shared/src/membership-payment-runner.js");

const db = getDb();
const at = "2026-07-16T00:00:00.000Z";
const priceTime = "2026-07-15 12:00:00";

after(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function seedFulfillment(id, options = {}) {
  const targetTier = options.targetTier || "plus";
  const productId = `product-${id}`;
  const siteId = `site-${id}`;
  const orderId = `order-${id}`;
  const createdAt = options.createdAt || "2026-07-16T00:00:00.000Z";
  db.prepare(`
    INSERT INTO products (id, code, title, membership_tier, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'active', ?, ?)
  `).run(productId, `CODE-${id}`, `Product ${id}`, targetTier, createdAt, createdAt);
  db.prepare(`
    INSERT INTO sites (id, name, slug, product_id, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'active', ?, ?)
  `).run(siteId, `Site ${id}`, `site-${id}`, productId, createdAt, createdAt);
  db.prepare(`
    INSERT INTO redeem_orders (
      id, order_no, cdkey_id, public_key, product_id, activation_endpoint_id,
      site_id, session_payload, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'endpoint-test', ?, '{}', 'processing', ?, ?)
  `).run(orderId, `ORDER-${id}`, `cdkey-${id}`, `PUBLIC-${id}`, productId, siteId, createdAt, createdAt);
  db.prepare(`
    INSERT INTO membership_fulfillments (
      id, order_id, order_no, target_tier, state, current_stage, run_mode,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'plus', ?, ?, ?)
  `).run(
    id,
    orderId,
    `ORDER-${id}`,
    targetTier,
    options.state || "FUNDING_READY",
    options.runMode === undefined ? "canary" : options.runMode,
    createdAt,
    createdAt
  );
  return { id, orderId, productId, siteId, targetTier, createdAt };
}

function seedContract(tier, suffix) {
  const existing = db.prepare(`
    SELECT id FROM checkout_price_contracts
    WHERE tier = ? AND status = 'active'
  `).get(tier);
  if (existing) return existing.id;
  const id = `contract-${tier}-${suffix}`;
  db.prepare(`
    INSERT INTO checkout_price_contracts (
      id, tier, version, currency, min_amount, max_amount, status,
      created_at, created_by, activated_at
    ) VALUES (?, ?, 1, 'PHP', 1, 100000, 'active', ?, 'test', ?)
  `).run(id, tier, at, at);
  return id;
}

function seedCard(id, options = {}) {
  const upstreamCardId = options.upstreamCardId ?? Number(id.replace(/\D/g, "")) + 1000;
  db.prepare(`
    INSERT INTO managed_cards (
      id, upstream_card_id, vm_card_id, product_code, bin, last4,
      upstream_status, cached_available_amount, lane, consumed_slots,
      capacity_state, reconciliation_state, created_at, updated_at
    ) VALUES (?, ?, ?, ?, '537872', '7890', 'ACTIVE', ?, ?, ?, ?, 'READY', ?, ?)
  `).run(
    id,
    upstreamCardId,
    `vm-${id}`,
    options.productCode || "P5378OX",
    options.cachedBalance ?? 0,
    options.lane ?? null,
    options.consumedSlots ?? 0,
    options.capacityState || "AVAILABLE",
    at,
    at
  );
  return { id, upstreamCardId, productCode: options.productCode || "P5378OX" };
}

function seedSignals(cardId, values) {
  for (const [tier, amount] of Object.entries(values)) {
    db.prepare(`
      INSERT INTO card_price_signals (
        card_id, tier, found, amount, min_usd, max_usd, provider_time, fetched_at
      ) VALUES (?, ?, 1, ?, ?, ?, ?, ?)
    `).run(cardId, tier, amount, Math.max(0, amount - 1), amount + 1, priceTime, at);
  }
}

function productTerms(productCode = "P5378OX", overrides = {}) {
  return Object.freeze({
    productCode,
    openFee: overrides.openFee ?? 1.5,
    rechargeFeeRate: overrides.rechargeFeeRate ?? 0.01,
    minAmount: overrides.minAmount ?? 1,
    maxAmount: overrides.maxAmount ?? 1000
  });
}

function fakeProvider(options = {}) {
  const calls = {
    getBalance: 0,
    listProducts: 0,
    listCards: 0,
    open: [],
    recharge: []
  };
  const cards = options.cards || [];
  const provider = {
    calls,
    async getBalance() {
      calls.getBalance += 1;
      return { balance: options.platformBalance ?? 1000, currency: "USD" };
    },
    async listProducts() {
      calls.listProducts += 1;
      return options.products || [productTerms()];
    },
    async listCards({ page, pageSize }) {
      calls.listCards += 1;
      const start = (page - 1) * pageSize;
      return { total: cards.length, cards: cards.slice(start, start + pageSize) };
    },
    async openCard(input, idempotencyKey) {
      calls.open.push({ input, idempotencyKey });
      if (options.openCard) return options.openCard(input, idempotencyKey, calls.open.length);
      return {
        upstreamCardId: 99001,
        vmCardId: "vm-opened-99001",
        productCode: input.productCode,
        availableAmount: input.initAmount,
        status: "ACTIVE",
        openFee: 1.5
      };
    },
    async rechargeCard(input, idempotencyKey) {
      calls.recharge.push({ input, idempotencyKey });
      if (options.rechargeCard) return options.rechargeCard(input, idempotencyKey, calls.recharge.length);
      return { succeeded: true };
    },
    classifyFundingError(error) {
      return options.classifyFundingError?.(error) || "unknown";
    }
  };
  return provider;
}

function liveCard(card, availableAmount) {
  return Object.freeze({
    upstreamCardId: card.upstreamCardId,
    vmCardId: `vm-${card.id}`,
    productCode: card.productCode,
    availableAmount,
    status: "ACTIVE"
  });
}

test("Payment Gate defaults closed and NULL/disabled/no_charge run modes never touch provider or reservations", async () => {
  const canary = seedFulfillment("mf-gate-default");
  seedContract("plus", "gate-default");
  const card = seedCard("card-gate-default", { upstreamCardId: 11001 });
  seedSignals(card.id, { plus: 16.24 });
  const provider = fakeProvider({ cards: [liveCard(card, 20)] });
  const closed = createMembershipPaymentRunner({ db, provider, now: () => new Date(at) });

  assert.equal(membershipPaymentRunnerGateDefault.enabled, false);
  assert.deepEqual(await closed.tick(), { processed: 0, reason: "gated" });
  assert.equal(provider.calls.getBalance, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM card_capacity_reservations WHERE fulfillment_id = ?").get(canary.id).count, 0);

  for (const mode of [null, "disabled", "no_charge"]) {
    const seeded = seedFulfillment(`mf-gate-${mode || "null"}`, { runMode: mode });
    const opened = createMembershipPaymentRunner({
      db,
      provider,
      paymentGate: { enabled: true, mode: "canary" },
      now: () => new Date(at)
    });
    const result = await opened.processFulfillment(seeded.id);
    assert.equal(result.outcome, "gated");
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM card_capacity_reservations WHERE fulfillment_id = ?").get(seeded.id).count, 0);
  }
  assert.equal(provider.calls.getBalance, 0);
});

test("runner deterministically reserves the lowest live shortfall and establishes a prefunded Plus stage", async () => {
  const fulfillment = seedFulfillment("mf-prefunded");
  const contractId = seedContract("plus", "prefunded");
  const lowBalance = seedCard("card-prefunded-low", { upstreamCardId: 12001, lane: "plus" });
  const highBalance = seedCard("card-prefunded-high", { upstreamCardId: 12002, lane: "plus" });
  seedSignals(lowBalance.id, { plus: 16.24 });
  seedSignals(highBalance.id, { plus: 16.24 });
  const provider = fakeProvider({
    cards: [liveCard(lowBalance, 1), liveCard(highBalance, 30)]
  });
  const runner = createMembershipPaymentRunner({
    db,
    provider,
    paymentGate: { enabled: true, mode: "canary" },
    now: () => new Date(at)
  });

  const result = await runner.processFulfillment(fulfillment.id);
  assert.equal(result.outcome, "prefunded");
  assert.equal(result.cardId, highBalance.id);
  assert.equal(result.fullPaymentBudgetUsd, 16.44);
  assert.equal(result.fundingOperation, "none");
  assert.equal(provider.calls.open.length, 0);
  assert.equal(provider.calls.recharge.length, 0);
  assert.equal(getMembershipFundingIntent(db, fulfillment.id), null);

  const reservation = db.prepare("SELECT * FROM card_capacity_reservations WHERE fulfillment_id = ?").get(fulfillment.id);
  assert.equal(reservation.card_id, highBalance.id);
  const stage = db.prepare("SELECT * FROM membership_payment_stages WHERE fulfillment_id = ? AND stage_key = 'plus'").get(fulfillment.id);
  assert.equal(stage.state, "checkout_pending");
  assert.equal(stage.card_id, highBalance.id);
  assert.equal(stage.price_signal_amount, 16.24);
  assert.equal(stage.price_contract_id, contractId);
  assert.equal(stage.adapter_version, "checkout-v1");
  assert.equal(stage.attempt_no, null);
  assert.equal(stage.page_fingerprint, null);
  assert.equal(db.prepare("SELECT state FROM membership_fulfillments WHERE id = ?").get(fulfillment.id).state, "BROWSER_LEASE_WAIT");
});

test("automatic x20 reserves one full-order quota including fee, then submits one immutable recharge intent", async () => {
  const fulfillment = seedFulfillment("mf-automatic-x20", {
    targetTier: "x20",
    runMode: "automatic",
    createdAt: "2026-07-16T00:01:00.000Z"
  });
  seedContract("plus", "automatic-x20");
  const x20Contract = seedContract("x20", "automatic-x20");
  const card = seedCard("card-automatic-x20", { upstreamCardId: 13001, lane: "x20" });
  seedSignals(card.id, { plus: 16.24, x20: 150 });
  db.prepare(`
    INSERT INTO automatic_checkout_scopes (
      id, scope_key, revision, site_id, product_id, tier, adapter_version,
      price_contract_id, daily_order_limit, daily_risk_limit_usd, status,
      activated_at, created_at, created_by
    ) VALUES (
      'scope-automatic-x20', 'scope-key-automatic-x20', 1, ?, ?, 'x20',
      'checkout-v1', ?, 1, 500, 'active', ?, ?, 'admin'
    )
  `).run(
    fulfillment.siteId,
    fulfillment.productId,
    x20Contract,
    "2026-07-16T00:00:00.000Z",
    "2026-07-16T00:00:00.000Z"
  );
  const provider = fakeProvider({
    cards: [liveCard(card, 10)],
    products: [productTerms("P5378OX", { rechargeFeeRate: 0.01 })]
  });
  const runner = createMembershipPaymentRunner({
    db,
    provider,
    paymentGate: { enabled: true, mode: "automatic" },
    now: () => new Date("2026-07-16T00:02:00.000Z")
  });

  const result = await runner.processFulfillment(fulfillment.id);
  assert.equal(result.outcome, "funded");
  assert.equal(result.fullPaymentBudgetUsd, 166.64);
  assert.equal(result.providerFeeUsd, 1.57);
  assert.equal(provider.calls.recharge.length, 1);
  assert.deepEqual(provider.calls.recharge[0], {
    input: { cardId: 13001, amount: 156.64 },
    idempotencyKey: "kwr:ORDER-mf-automatic-x20:recharge:v1"
  });
  const intent = getMembershipFundingIntent(db, fulfillment.id);
  assert.equal(intent.state, "succeeded");
  assert.equal(intent.amountUsd, 156.64);
  assert.equal(intent.feeUsd, 1.57);
  const quota = db.prepare("SELECT * FROM automatic_checkout_quota_reservations WHERE fulfillment_id = ?").get(fulfillment.id);
  assert.equal(quota.order_units, 1);
  assert.equal(quota.risk_reserved_usd, 168.21);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM membership_payment_stages WHERE fulfillment_id = ?").get(fulfillment.id).count, 2);
  assert.equal(db.prepare("SELECT price_signal_amount FROM membership_payment_stages WHERE fulfillment_id = ? AND stage_key = 'upgrade'").get(fulfillment.id).price_signal_amount, 150);
});

test("when existing capacity is exhausted, runner opens only an allowed proven product and attaches it", async () => {
  const fulfillment = seedFulfillment("mf-open-card");
  seedContract("plus", "open-card");
  const evidenceCard = seedCard("card-open-evidence", {
    upstreamCardId: 14001,
    lane: "plus",
    consumedSlots: 5,
    capacityState: "CAPACITY_FULL"
  });
  seedSignals(evidenceCard.id, { plus: 16.24 });
  db.prepare(`
    INSERT INTO card_product_policies (product_code, enabled, revision, updated_at, updated_by)
    VALUES ('P5378OX', 1, 1, ?, 'admin')
  `).run(at);
  const provider = fakeProvider({
    cards: [liveCard(evidenceCard, 0)],
    products: [productTerms("P5378OX", { openFee: 1.5 })],
    openCard(input) {
      return {
        upstreamCardId: 14002,
        vmCardId: "vm-opened-14002",
        productCode: input.productCode,
        availableAmount: input.initAmount,
        status: "ACTIVE",
        openFee: 1.5
      };
    }
  });
  const runner = createMembershipPaymentRunner({
    db,
    provider,
    paymentGate: { enabled: true, mode: "canary" },
    cardholder: { firstName: "Test", lastName: "Holder" },
    now: () => new Date(at)
  });

  const result = await runner.processFulfillment(fulfillment.id);
  assert.equal(result.outcome, "funded");
  assert.equal(provider.calls.open.length, 1);
  assert.deepEqual(provider.calls.open[0], {
    input: {
      productCode: "P5378OX",
      firstName: "Test",
      lastName: "Holder",
      initAmount: 16.44
    },
    idempotencyKey: "kwr:ORDER-mf-open-card:open:v1"
  });
  const opened = db.prepare("SELECT * FROM managed_cards WHERE upstream_card_id = 14002").get();
  assert.ok(opened);
  assert.equal(opened.lane, "plus");
  assert.equal(result.cardId, opened.id);
  assert.equal(db.prepare("SELECT card_id FROM card_capacity_reservations WHERE fulfillment_id = ?").get(fulfillment.id).card_id, opened.id);
  assert.equal(db.prepare("SELECT card_id FROM membership_payment_stages WHERE fulfillment_id = ?").get(fulfillment.id).card_id, opened.id);
});

test("unknown funding outcome never ordinary-retries and recovery reuses the persisted body and key", async () => {
  const fulfillment = seedFulfillment("mf-funding-recovery");
  seedContract("plus", "funding-recovery");
  const card = seedCard("card-funding-recovery", { upstreamCardId: 15001, lane: "plus" });
  seedSignals(card.id, { plus: 16.24 });
  const provider = fakeProvider({
    cards: [liveCard(card, 0)],
    rechargeCard(_input, _key, callNo) {
      if (callNo === 1) throw new Error("socket disconnected");
      return { succeeded: true };
    }
  });
  const runner = createMembershipPaymentRunner({
    db,
    provider,
    paymentGate: { enabled: true, mode: "canary" },
    now: () => new Date(at)
  });

  const first = await runner.processFulfillment(fulfillment.id);
  assert.equal(first.outcome, "recovery_required");
  assert.equal(getMembershipFundingIntent(db, fulfillment.id).state, "outcome_unknown");
  assert.equal(provider.calls.recharge.length, 1);
  const ordinaryRetry = await runner.processFulfillment(fulfillment.id);
  assert.equal(ordinaryRetry.outcome, "recovery_required");
  assert.equal(provider.calls.recharge.length, 1);

  await assert.rejects(
    () => runner.recoverFundingOutcome(fulfillment.id),
    (error) => error instanceof MembershipFundingError && error.code === "MEMBERSHIP_PAYMENT_GATE_LOCKED"
  );
  assert.equal(provider.calls.recharge.length, 1);

  const recovered = await runner.recoverFundingOutcome(fulfillment.id, {
    recoveryGate: { enabled: true },
    at: "2026-07-16T00:05:00.000Z"
  });
  assert.equal(recovered.outcome, "funded");
  assert.equal(provider.calls.recharge.length, 2);
  assert.deepEqual(provider.calls.recharge[1], provider.calls.recharge[0]);
  assert.deepEqual(provider.calls.recharge[1], {
    input: { cardId: 15001, amount: 16.44 },
    idempotencyKey: "kwr:ORDER-mf-funding-recovery:recharge:v1"
  });
  assert.equal(getMembershipFundingIntent(db, fulfillment.id).state, "succeeded");
  assert.equal(db.prepare("SELECT state FROM membership_fulfillments WHERE id = ?").get(fulfillment.id).state, "BROWSER_LEASE_WAIT");
});
