import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kawang-membership-"));
process.env.DATABASE_PATH = path.join(tmpDir, "test.db");
process.env.JWT_SECRET = "membership-fulfillment-test-secret";
process.env.ADMIN_USERNAME = "admin";
process.env.ADMIN_PASSWORD = "test-password";
process.env.KAWANG_SKIP_LISTEN = "1";

const {
  MembershipContractError,
  calculateMembershipBudget,
  classifyHistoricalCardFulfillments,
  classifyStartingMembership,
  isStrictMembershipStageConfirmed,
  matchPaymentTransactionDelta,
  normalizeMembershipEnvelope,
  rankMembershipCardCandidates
} = await import("../shared/src/membership-fulfillment.js");
const {
  fetchMembershipObservation,
  membershipStateProviderUrl
} = await import("../shared/src/membership-state-provider.js");
const {
  SpaceXCardOpenApiClient,
  spaceXCardOpenApiBaseUrl
} = await import("../shared/src/spacexcard-openapi.js");
const {
  createMembershipInventoryRunner,
  startMembershipInventoryRun
} = await import("../shared/src/membership-inventory.js");
const {
  acquireDependencyCircuit,
  recordDependencyFailure,
  recordDependencySuccess,
  requestDependencyProbe
} = await import("../shared/src/membership-circuits.js");
const { getDb } = await import("../shared/src/database.js");
const { decryptText, encryptText } = await import("../shared/src/secure.js");
const { deriveMembershipAccountLockKey } = await import("../shared/src/membership-orchestration.js");

const db = getDb();
let app;

after(async () => {
  if (app) await app.close();
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function fixture(name) {
  return JSON.parse(fs.readFileSync(path.resolve("tests", "fixtures", name), "utf8"));
}

function jsonResponse(body, options = {}) {
  return new Response(JSON.stringify(body), {
    status: options.status || 200,
    headers: { "content-type": "application/json", ...(options.headers || {}) }
  });
}

function signWebhookBody(secret, body) {
  return createHmac("sha256", secret).update(body).digest("hex");
}

test("membership provider contract is strict and separates starting-free from paid confirmation", () => {
  const envelope = fixture("gptserve-subscription-info-pro.json");
  const nowMs = Date.parse("2026-07-16T00:00:00Z");
  const observation = normalizeMembershipEnvelope(envelope, { nowMs });
  assert.equal(observation.accountType, "x20");
  assert.equal(classifyStartingMembership(observation), "subscribed");
  assert.equal(isStrictMembershipStageConfirmed(observation, "x20"), true);
  assert.equal(isStrictMembershipStageConfirmed(observation, "x20", { requireAutoRenewFalse: true }), false);

  const renewalSafe = normalizeMembershipEnvelope({
    ...envelope,
    data: { ...envelope.data, auto_renew: false }
  }, { nowMs });
  assert.equal(isStrictMembershipStageConfirmed(renewalSafe, "x20", { requireAutoRenewFalse: true }), true);

  const free = normalizeMembershipEnvelope({
    code: 200,
    data: {
      account_type: "free",
      currency: null,
		auto_renew: false,
      is_overdue: false,
      is_delinquent: false,
      expire_time: null
    }
  }, { nowMs });
  assert.equal(classifyStartingMembership(free), "free");
	const renewalUnknown = normalizeMembershipEnvelope({
		code: 200,
		data: { ...free, account_type: "free", auto_renew: null, is_overdue: false, is_delinquent: false }
	}, { nowMs });
	assert.equal(classifyStartingMembership(renewalUnknown), "unknown");
  assert.equal(isStrictMembershipStageConfirmed(free, "plus"), false);

  assert.throws(() => normalizeMembershipEnvelope({
    code: 200,
    data: { ...envelope.data, account_type: "future_plan" }
  }, { nowMs }), MembershipContractError);
});

test("membership state adapter uses the fixed URL and object token contract", async () => {
  const envelope = fixture("gptserve-subscription-info-pro.json");
  let request;
  const session = { user: { email: "user@example.com" }, accessToken: "redacted" };
  const observation = await fetchMembershipObservation(session, {
    nowMs: Date.parse("2026-07-16T00:00:00Z"),
    fetchImpl: async (url, options) => {
      request = { url, options };
      return jsonResponse(envelope);
    }
  });
  assert.equal(request.url, membershipStateProviderUrl);
  assert.deepEqual(JSON.parse(request.options.body), { token: session });
  assert.equal(observation.accountType, "x20");
});

test("card price budget applies USD 0.20 to every stage and rejects stale data", () => {
  const signals = fixture("spacexcard-openapi-openai-payments.json").data.map((item) => ({
    tier: item.tier,
    found: item.found,
    amount: item.amount,
    time: item.time
  }));
  const nowMs = Date.parse("2026-07-16T12:00:00+08:00");
  assert.equal(calculateMembershipBudget(signals, "plus", { nowMs }).totalUsd, 16.44);
  const x5 = calculateMembershipBudget(signals, "x5", { nowMs });
  assert.deepEqual(x5.stages.map((stage) => stage.budgetUsd), [16.44, 99.2]);
  assert.equal(x5.totalUsd, 115.64);

  assert.throws(() => calculateMembershipBudget(signals, "x5", {
    nowMs: Date.parse("2026-07-20T12:00:00+08:00")
  }), (error) => error.code === "CARD_PRICE_UNAVAILABLE");
});

test("payment delta requires exactly one new matching OpenAI authorization", () => {
  const base = {
    authAmount: 16.24,
    settleAmount: 0,
    merchantNormalized: "OPENAI",
    type: "Authorization"
  };
  const matched = matchPaymentTransactionDelta({
    beforeAuthIds: ["old"],
    minUsd: 15,
    maxUsd: 20,
    transactions: [
      { ...base, authId: "old", status: "COMPLETE" },
      { ...base, authId: "new", status: "PENDING" },
      { ...base, authId: "new", status: "COMPLETE", settleAmount: 16.24, type: "Settlement" }
    ]
  });
  assert.equal(matched.outcome, "matched");
  assert.equal(matched.transaction.authId, "new");
  assert.equal(matched.transaction.status, "COMPLETE");

  const multiple = matchPaymentTransactionDelta({
    beforeAuthIds: [],
    minUsd: 15,
    maxUsd: 20,
    transactions: [
      { ...base, authId: "new-1", status: "PENDING" },
      { ...base, authId: "new-2", status: "PENDING" }
    ]
  });
  assert.deepEqual(multiple, { outcome: "uncertain", reason: "MULTIPLE_MATCHES", matches: 2 });

  const declined = matchPaymentTransactionDelta({
    beforeAuthIds: [],
    minUsd: 15,
    maxUsd: 20,
    transactions: [{ ...base, authId: "declined", status: "DECLINED" }]
  });
  assert.equal(declined.outcome, "declined");

  const philippinesX20 = matchPaymentTransactionDelta({
    beforeAuthIds: [],
    tier: "x20",
    minUsd: 140,
    maxUsd: 160,
    transactions: [{
      ...base,
      authId: "x20-ph",
      authAmount: 7937.55,
      authCurrency: "PHP",
      settleAmount: 130.06,
      settleCurrency: "USD",
      status: "COMPLETE",
      type: "Settlement"
    }]
  });
  assert.equal(philippinesX20.outcome, "matched");
});

test("card ranking consolidates the target lane before unassigned cards", () => {
  const ranked = rankMembershipCardCandidates([
    { id: "unassigned", eligible: true, lane: null, budgetUsd: 20, availableAmount: 20 },
    { id: "same-expensive", eligible: true, lane: "plus", budgetUsd: 20, availableAmount: 5 },
    { id: "same-cheap", eligible: true, lane: "plus", budgetUsd: 20, availableAmount: 10 },
    { id: "wrong", eligible: true, lane: "x5", budgetUsd: 20, availableAmount: 20 }
  ], "plus");
  assert.deepEqual(ranked.map((item) => item.id), ["same-cheap", "same-expensive", "unassigned"]);
});

test("historical reconciliation pairs staged upgrades and holds ambiguous cards", () => {
  const settled = (authId, authTime, amount, type = "Settlement", status = "COMPLETE") => ({
    authId,
    authTime,
    authAmount: amount,
    settleAmount: amount,
    merchantNormalized: "OPENAI",
    type,
    status
  });
  const x5 = classifyHistoricalCardFulfillments([
    settled("plus-1", "2026-07-10T00:00:00Z", 16.24),
    settled("x5-1", "2026-07-10T01:00:00Z", 99),
    settled("plus-2", "2026-07-11T00:00:00Z", 16.24),
    settled("x5-2", "2026-07-11T01:30:00Z", 99)
  ]);
  assert.deepEqual(x5, { lane: "x5", consumed: 2, state: "CAPACITY_FULL", reason: null });

  const historicalPhilippinesX20 = classifyHistoricalCardFulfillments([
    settled("plus-ph", "2026-07-10T03:36:14+08:00", 16.09),
    settled("x20-ph", "2026-07-10T03:38:39+08:00", 130.06)
  ]);
  assert.deepEqual(historicalPhilippinesX20, {
    lane: "x20",
    consumed: 1,
    state: "CAPACITY_FULL",
    reason: null
  });

  const unknownUpgradeAmount = classifyHistoricalCardFulfillments([
    settled("plus-unknown", "2026-07-10T03:36:14+08:00", 16.09),
    settled("unknown-final", "2026-07-10T03:38:39+08:00", 110)
  ]);
  assert.equal(unknownUpgradeAmount.reason, "UNCLASSIFIABLE_OPENAI_PAYMENT");

  const missingPair = classifyHistoricalCardFulfillments([
    settled("x20", "2026-07-10T01:00:00Z", 150)
  ]);
  assert.equal(missingPair.reason, "UPGRADE_PAIR_MISSING");

  const mixed = classifyHistoricalCardFulfillments([
    settled("plus-1", "2026-07-10T00:00:00Z", 16.24),
    settled("x5-1", "2026-07-10T01:00:00Z", 99),
    settled("plus-extra", "2026-07-11T00:00:00Z", 16.24)
  ]);
  assert.equal(mixed.reason, "MIXED_MEMBERSHIP_LANES");

  const refunded = classifyHistoricalCardFulfillments([
    settled("paid", "2026-07-10T00:00:00Z", 16.24),
    settled("paid", "2026-07-10T00:00:00Z", 16.24, "Refund", "COMPLETE")
  ]);
  assert.equal(refunded.reason, "REFUNDED_FULFILLMENT");

  const reversedPending = classifyHistoricalCardFulfillments([
    settled("reversed", "2026-07-10T00:00:00Z", 16.24, "Authorization", "PENDING"),
    settled("reversed", "2026-07-10T00:00:00Z", 16.24, "Reversal", "COMPLETE")
  ]);
  assert.deepEqual(reversedPending, { lane: null, consumed: 0, state: "AVAILABLE", reason: null });

  const pendingPlus = classifyHistoricalCardFulfillments([
    settled("plus-pending", "2026-07-12T00:00:00Z", 16.24, "Authorization", "PENDING")
  ], { knownLane: "plus" });
  assert.deepEqual(pendingPlus, { lane: "plus", consumed: 1, state: "AVAILABLE", reason: null });

  const pendingPhilippinesPlus = classifyHistoricalCardFulfillments([{
    ...settled("plus-pending-php", "2026-07-12T00:00:00Z", 982.14, "Authorization", "PENDING"),
    authCurrency: "PHP",
    settleAmount: 0,
    settleCurrency: "USD"
  }], { knownLane: "plus" });
  assert.deepEqual(pendingPhilippinesPlus, { lane: "plus", consumed: 1, state: "AVAILABLE", reason: null });

  const reverseOrderedSettlement = classifyHistoricalCardFulfillments([{
    ...settled("plus-reverse-order", "2026-07-12T00:00:00Z", 982.14),
    authCurrency: "PHP",
    settleAmount: 16.09,
    settleCurrency: "USD"
  }, {
    ...settled("plus-reverse-order", "2026-07-12T00:00:00Z", 982.14, "Authorization", "PENDING"),
    authCurrency: "PHP",
    settleAmount: 0,
    settleCurrency: "USD"
  }]);
  assert.deepEqual(reverseOrderedSettlement, { lane: "plus", consumed: 1, state: "AVAILABLE", reason: null });

  const fivePendingPlus = classifyHistoricalCardFulfillments(Array.from({ length: 5 }, (_, index) => (
    settled(`plus-pending-${index}`, `2026-07-1${index + 1}T00:00:00Z`, 16.24, "Authorization", "PENDING")
  )), { knownLane: "plus" });
  assert.deepEqual(fivePendingPlus, { lane: "plus", consumed: 5, state: "CAPACITY_FULL", reason: null });

  const sixPendingPlus = classifyHistoricalCardFulfillments(Array.from({ length: 6 }, (_, index) => (
    settled(`plus-over-capacity-${index}`, `2026-07-1${index + 1}T00:00:00Z`, 16.24, "Authorization", "PENDING")
  )), { knownLane: "plus" });
  assert.equal(sixPendingPlus.reason, "CAPACITY_EXCEEDED");

  const unknownPending = classifyHistoricalCardFulfillments([
    settled("unknown-lane-pending", "2026-07-12T00:00:00Z", 16.24, "Authorization", "PENDING")
  ]);
  assert.equal(unknownPending.reason, "PENDING_SETTLEMENT");
});

test("SpaceX Card OpenAPI adapter strips list PAN and requires idempotency for writes", async () => {
  const products = fixture("spacexcard-openapi-products.json");
  const cards = fixture("spacexcard-openapi-cards.json");
  const prices = fixture("spacexcard-openapi-openai-payments.json");
  const requests = [];
  const client = new SpaceXCardOpenApiClient({
    appSecret: "sk_test_redacted",
    appId: "ak_test_redacted",
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      const pathname = new URL(url).pathname;
      if (pathname.endsWith("/products")) return jsonResponse(products);
      if (pathname.endsWith("/cards/123/openai-payments")) return jsonResponse(prices);
      if (pathname.endsWith("/cards/open")) {
        return jsonResponse({
          code: 0,
          msg: "ok",
          data: {
            id: 124,
            vm_card_id: "card-redacted-124",
            card_number: "5378720000009999",
            cvv: "000",
            expire: "08/29",
            product_code: "P5378OX",
            available_amount: 20,
            status: "ACTIVE",
            open_fee: 1.5
          }
        });
      }
      if (pathname.endsWith("/cards")) return jsonResponse(cards);
      throw new Error(`unexpected OpenAPI request: ${url}`);
    }
  });

  assert.equal((await client.listProducts())[0].productCode, "P5378OX");
  const listed = await client.listCards({ sync: true });
  assert.equal(listed.cards[0].bin, "537872");
  assert.equal(listed.cards[0].last4, "8264");
  assert.equal("cardNumber" in listed.cards[0], false);
  assert.deepEqual((await client.getOpenAiPayments(123)).map((item) => item.tier), ["plus", "x5", "x20"]);
  await assert.rejects(() => client.openCard({
    productCode: "P5378OX",
    firstName: "John",
    lastName: "Smith",
    initAmount: 20
  }), /Idempotency-Key/);
  const opened = await client.openCard({
    productCode: "P5378OX",
    firstName: "John",
    lastName: "Smith",
    initAmount: 20
  }, "kwr:order-1:open:v1");
  assert.equal(opened.upstreamCardId, 124);
  assert.equal("number" in opened, false);
  const openRequest = requests.find((item) => item.url.endsWith("/cards/open"));
  assert.equal(openRequest.options.headers["Idempotency-Key"], "kwr:order-1:open:v1");
  assert.ok(requests.every((item) => item.url.startsWith(spaceXCardOpenApiBaseUrl)));
});

test("database initializes membership tables and safe defaults", () => {
  const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name));
  for (const name of [
    "membership_fulfillments",
    "membership_intake_settings",
    "managed_cards",
    "managed_card_transactions",
    "card_capacity_reservations",
    "funding_intents",
    "browser_fulfillment_lease",
    "membership_checkout_commands",
    "live_canary_authorizations",
    "automatic_checkout_scopes"
  ]) assert.equal(tables.has(name), true, `missing table ${name}`);

  const productColumns = new Set(db.prepare("PRAGMA table_info(products)").all().map((column) => column.name));
  assert.equal(productColumns.has("membership_tier"), true);
  const fulfillmentColumns = new Set(
    db.prepare("PRAGMA table_info(membership_fulfillments)").all().map((column) => column.name)
  );
  assert.equal(fulfillmentColumns.has("automation_enrolled_at"), true);
  const settings = db.prepare("SELECT * FROM membership_fulfillment_settings WHERE id = 'default'").get();
  assert.equal(settings.enabled, 0);
  assert.equal(settings.inventory_status, "not_started");
  assert.equal(settings.business_timezone, "Asia/Shanghai");
  const intake = db.prepare("SELECT * FROM membership_intake_settings WHERE id = 'default'").get();
  assert.equal(Number.isFinite(Date.parse(intake.accept_orders_created_at)), true);
  assert.equal(db.prepare("SELECT state FROM browser_fulfillment_lease WHERE id = 'default'").get().state, "available");

  const commandColumns = new Set(
    db.prepare("PRAGMA table_info(membership_checkout_commands)").all().map((column) => column.name)
  );
  for (const forbidden of ["session", "cookie", "pan", "cvv", "checkout_url", "card_number"]) {
    assert.equal(commandColumns.has(forbidden), false, `unsafe command column ${forbidden}`);
  }
  for (const required of ["hard_deadline_at", "lease_token_sha256", "fulfillment_revision", "sanitized_diagnostic"]) {
    assert.equal(commandColumns.has(required), true, `missing command column ${required}`);
  }
});

test("dependency circuit opens after bounded failures and recovers through one half-open probe", () => {
  const dependency = "circuit-test";
  const scopeKey = "default";
  const failure = { code: "SPACEXCARD_TIMEOUT" };
  const start = Date.parse("2026-07-16T00:00:00.000Z");
  const first = recordDependencyFailure(db, { dependency, scopeKey, error: failure, at: start });
  const second = recordDependencyFailure(db, { dependency, scopeKey, error: failure, at: start + 60_000 });
  const third = recordDependencyFailure(db, { dependency, scopeKey, error: failure, at: start + 120_000 });
  assert.equal(first.circuit.state, "closed");
  assert.equal(second.circuit.failureCount, 2);
  assert.equal(third.openedNow, true);
  assert.equal(third.circuit.state, "open");
  assert.equal(Date.parse(third.circuit.retryAt) - (start + 120_000), 15 * 60 * 1000);

  const blocked = acquireDependencyCircuit(db, { dependency, scopeKey, at: start + 10 * 60_000 });
  assert.equal(blocked.allowed, false);
  const requested = requestDependencyProbe(db, third.circuit.id, { at: start + 11 * 60_000 });
  assert.equal(requested.outcome, "scheduled");
  const probe = acquireDependencyCircuit(db, { dependency, scopeKey, at: start + 11 * 60_000 });
  assert.deepEqual({ allowed: probe.allowed, probe: probe.probe }, { allowed: true, probe: true });

  const reopened = recordDependencyFailure(db, {
    dependency,
    scopeKey,
    error: failure,
    at: start + 12 * 60_000
  });
  assert.equal(reopened.circuit.state, "open");
  assert.equal(reopened.circuit.recoveryRevision, 1);
  assert.equal(Date.parse(reopened.circuit.retryAt) - (start + 12 * 60_000), 30 * 60 * 1000);
  const secondProbe = acquireDependencyCircuit(db, {
    dependency,
    scopeKey,
    at: Date.parse(reopened.circuit.retryAt) + 1
  });
  assert.equal(secondProbe.allowed, true);
  const recovered = recordDependencySuccess(db, {
    dependency,
    scopeKey,
    at: Date.parse(reopened.circuit.retryAt) + 2
  });
  assert.equal(recovered.state, "closed");
  assert.equal(recovered.failureCount, 0);
  assert.equal(recovered.recoveryRevision, 0);

  const immediate = recordDependencyFailure(db, {
    dependency: "contract-test",
    scopeKey,
    error: { code: "SPACEXCARD_CONTRACT_DRIFT" },
    at: start
  });
  assert.equal(immediate.openedNow, true);
  assert.equal(immediate.circuit.state, "open");
});

test("inventory initialization is resumable, read-only, and stores only masked card metadata", async () => {
  const at = new Date().toISOString();
  db.prepare(`
    UPDATE membership_fulfillment_settings
    SET spacexcard_app_secret_encrypted = ?, inventory_status = 'not_started', updated_at = ?
    WHERE id = 'default'
  `).run(encryptText("sk_inventory_test"), at);
  const run = startMembershipInventoryRun(db, { id: "mir_test", actor: "admin", at });
  assert.equal(run.status, "discovering");
  assert.throws(() => startMembershipInventoryRun(db, { id: "mir_duplicate", actor: "admin", at }), (error) => (
    error.code === "INVENTORY_ALREADY_RUNNING"
  ));

  const prices = fixture("spacexcard-openapi-openai-payments.json").data.map((item) => ({
    tier: item.tier,
    label: item.label,
    minUsd: item.min_usd,
    maxUsd: item.max_usd,
    amount: item.amount,
    time: item.time,
    found: item.found
  }));
  const transactions = [{
    authId: "auth-plus-1",
    authTime: "2026-07-15T01:00:00Z",
    authAmount: 16.24,
    authCurrency: "USD",
    settleAmount: 16.24,
    settleCurrency: "USD",
    status: "COMPLETE",
    type: "Settlement",
    merchantNormalized: "OPENAI",
    createdAt: "2026-07-15T01:01:00Z"
  }];
  const client = {
    async listCards() {
      return {
        total: 1,
        cards: [{
          upstreamCardId: 123,
          vmCardId: "card-redacted-123",
          productCode: "P5378OX",
          network: "MasterCard",
          issuingArea: "United States",
          availableAmount: 18.8,
          status: "ACTIVE",
          bin: "537872",
          last4: "8264",
          createdAt: "2026-06-04T00:31:56Z"
        }]
      };
    },
    async listTransactions() {
      return transactions;
    },
    async getOpenAiPayments() { return prices; }
  };
  const runner = createMembershipInventoryRunner({
    db,
    decryptText() { throw new Error("clientFactory should avoid real credentials"); },
    workerId: "inventory-test-worker",
    clientFactory: () => client,
    logger: { warn() {} }
  });
  assert.equal((await runner.tick()).action, "discovered");
  const reconciliation = await runner.tick();
  assert.equal(reconciliation.action, "reconciled", JSON.stringify(reconciliation));

  const completed = db.prepare("SELECT * FROM card_inventory_runs WHERE id = 'mir_test'").get();
  assert.equal(completed.status, "completed");
  assert.equal(completed.processed_cards, 1);
  const card = db.prepare("SELECT * FROM managed_cards WHERE upstream_card_id = 123").get();
  assert.equal(card.bin, "537872");
  assert.equal(card.last4, "8264");
  assert.equal(card.lane, "plus");
  assert.equal(card.consumed_slots, 1);
  assert.equal(card.reconciliation_state, "READY");
  assert.equal(db.prepare("PRAGMA table_info(managed_cards)").all().some((column) => /number|cvv|expire/i.test(column.name)), false);
  assert.equal(db.prepare("SELECT inventory_status FROM membership_fulfillment_settings WHERE id = 'default'").get().inventory_status, "completed");

  db.prepare("UPDATE managed_cards SET lane = NULL, consumed_slots = 0 WHERE id = ?").run(card.id);
  db.prepare(`
    INSERT INTO card_capacity_reservations (
      id, fulfillment_id, card_id, target_lane, slot_index, state, reserved_at
    ) VALUES ('mcr_pending_plus', 'mf_pending_plus', ?, 'plus', 1, 'consumed', ?)
  `).run(card.id, at);
  transactions.splice(0, transactions.length, {
    authId: "auth-plus-pending",
    authTime: "2026-07-16T01:00:00Z",
    authAmount: 16.24,
    authCurrency: "USD",
    settleAmount: 0,
    settleCurrency: "USD",
    status: "PENDING",
    type: "Authorization",
    merchantNormalized: "OPENAI",
    createdAt: "2026-07-16T01:00:00Z"
  });
  startMembershipInventoryRun(db, { id: "mir_pending_plus", actor: "admin", mode: "refresh", at });
  assert.equal((await runner.tick()).action, "discovered");
  assert.equal((await runner.tick()).action, "reconciled");
  const pendingCard = db.prepare("SELECT * FROM managed_cards WHERE upstream_card_id = 123").get();
  assert.equal(pendingCard.lane, "plus");
  assert.equal(pendingCard.consumed_slots, 1);
  assert.equal(pendingCard.capacity_state, "AVAILABLE");
  assert.equal(pendingCard.reconciliation_state, "READY");
  assert.equal(pendingCard.reconciliation_reason, null);
});

test("inventory retries shared failures without holding cards and holds cards missing from a completed refresh", async () => {
  db.prepare(`
    UPDATE membership_fulfillment_settings
    SET spacexcard_app_secret_encrypted = ?, inventory_status = 'completed', updated_at = ?
    WHERE id = 'default'
  `).run(encryptText("sk_inventory_failure_test"), new Date().toISOString());
  const prices = fixture("spacexcard-openapi-openai-payments.json").data.map((item) => ({
    tier: item.tier,
    label: item.label,
    minUsd: item.min_usd,
    maxUsd: item.max_usd,
    amount: item.amount,
    time: item.time,
    found: item.found
  }));
  let transactionCalls = 0;
  const sharedFailure = Object.assign(new Error("temporary upstream outage"), { code: "SPACEXCARD_TIMEOUT" });
  const client = {
    async listCards() {
      return {
        total: 1,
        cards: [{
          upstreamCardId: 456,
          vmCardId: "card-redacted-456",
          productCode: "P5378OX",
          availableAmount: 20,
          status: "ACTIVE",
          bin: "537872",
          last4: "0456"
        }]
      };
    },
    async listTransactions() {
      transactionCalls += 1;
      if (transactionCalls === 1) throw sharedFailure;
      return [];
    },
    async getOpenAiPayments() { return prices; }
  };
  const runner = createMembershipInventoryRunner({
    db,
    decryptText() { throw new Error("clientFactory should avoid real credentials"); },
    workerId: "inventory-shared-failure-worker",
    clientFactory: () => client,
    logger: { warn() {} }
  });
  startMembershipInventoryRun(db, { id: "mir_shared_failure", actor: "admin", mode: "refresh" });
  assert.equal((await runner.tick()).action, "discovered");
  const failed = await runner.tick();
  assert.equal(failed.code, "SPACEXCARD_TIMEOUT");
  const retryingCard = db.prepare("SELECT * FROM managed_cards WHERE upstream_card_id = 456").get();
  assert.notEqual(retryingCard.reconciliation_state, "HOLD");
  assert.notEqual(retryingCard.capacity_state, "HOLD");

  db.prepare(`
    UPDATE card_inventory_run_items SET next_retry_at = '1970-01-01T00:00:00.000Z'
    WHERE run_id = 'mir_shared_failure' AND upstream_card_id = 456
  `).run();
  assert.equal((await runner.tick()).action, "reconciled");
  assert.equal(db.prepare("SELECT status FROM card_inventory_runs WHERE id = 'mir_shared_failure'").get().status, "completed");

  const missingRun = startMembershipInventoryRun(db, {
    id: "mir_missing_card",
    actor: "admin",
    mode: "refresh"
  });
  assert.equal(missingRun.status, "discovering");
  const emptyRunner = createMembershipInventoryRunner({
    db,
    decryptText() { throw new Error("clientFactory should avoid real credentials"); },
    workerId: "inventory-missing-card-worker",
    clientFactory: () => ({ async listCards() { return { total: 0, cards: [] }; } }),
    logger: { warn() {} }
  });
  assert.equal((await emptyRunner.tick()).action, "discovered");
  assert.equal((await emptyRunner.tick()).action, "completed");
  const missingCard = db.prepare("SELECT * FROM managed_cards WHERE upstream_card_id = 456").get();
  assert.equal(missingCard.upstream_status, "MISSING");
  assert.equal(missingCard.reconciliation_state, "HOLD");
  assert.equal(missingCard.capacity_state, "HOLD");
  assert.equal(missingCard.reconciliation_reason, "UPSTREAM_CARD_MISSING");

  const sevenHoursAgo = new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString();
  db.prepare(`
    UPDATE card_inventory_runs SET completed_at = ?
    WHERE mode IN ('full', 'refresh') AND status = 'completed'
  `).run(sevenHoursAgo);
  const scheduled = await emptyRunner.tick();
  assert.equal(scheduled.action, "scheduled_refresh");
  assert.equal(db.prepare("SELECT mode FROM card_inventory_runs WHERE id = ?").get(scheduled.runId).mode, "refresh");
  assert.equal((await emptyRunner.tick()).action, "discovered");
  assert.equal((await emptyRunner.tick()).action, "completed");
});

test("membership admin settings encrypt credentials and keep payment locked", async () => {
  ({ app } = await import("../api/src/server.js"));
  const login = await app.inject({
    method: "POST",
    url: "/api/admin/auth/login",
    payload: { username: "admin", password: "test-password" }
  });
  assert.equal(login.statusCode, 200);
  const token = login.json().token;
  const headers = { authorization: `Bearer ${token}` };

  const seededProcessor = db.prepare("SELECT * FROM membership_processor_lease WHERE id = 'default'").get();
  assert.deepEqual(
    db.prepare("PRAGMA table_info(membership_processor_lease)").all().map((column) => column.name),
    [
      "id", "owner", "holder_token", "epoch", "status", "version", "started_at",
      "heartbeat_at", "expires_at", "last_tick_at", "last_success_at", "last_error_code", "updated_at"
    ]
  );
  assert.equal(seededProcessor.owner, null);
  assert.equal(seededProcessor.holder_token, null);
  assert.equal(seededProcessor.epoch, 0);
  assert.equal(seededProcessor.status, "stopped");

  db.prepare(`
    UPDATE membership_processor_lease
    SET owner = 'go', holder_token = 'processor-token-redacted', status = 'active',
        version = 'v1.2.3', heartbeat_at = '2026-07-20T01:02:03.000Z',
        expires_at = '2999-07-20T01:02:23.000Z',
        last_tick_at = '2026-07-20T01:02:02.000Z',
        last_success_at = '2026-07-20T01:02:01.000Z', last_error_code = 'UPSTREAM_TIMEOUT'
    WHERE id = 'default'
  `).run();
  const statusResponse = await app.inject({
    method: "GET",
    url: "/api/admin/membership-fulfillment/settings",
    headers
  });
  assert.equal(statusResponse.statusCode, 200);
  assert.deepEqual(statusResponse.json().settings.processor, {
    owner: "go",
    status: "active",
    version: "v1.2.3",
    heartbeatAt: "2026-07-20T01:02:03.000Z",
    expiresAt: "2999-07-20T01:02:23.000Z",
    lastTickAt: "2026-07-20T01:02:02.000Z",
    lastSuccessAt: "2026-07-20T01:02:01.000Z",
    lastErrorCode: "UPSTREAM_TIMEOUT"
  });
  assert.doesNotMatch(statusResponse.body, /processor-token-redacted/);
  db.prepare(`
    UPDATE membership_processor_lease
    SET expires_at = '2000-01-01T00:00:00.000Z'
    WHERE id = 'default'
  `).run();
  const staleStatus = await app.inject({
    method: "GET",
    url: "/api/admin/membership-fulfillment/settings",
    headers
  });
  assert.equal(staleStatus.statusCode, 200);
  assert.equal(staleStatus.json().settings.processor.status, "stale");
  db.prepare(`
    UPDATE membership_processor_lease
    SET owner = NULL, holder_token = NULL, epoch = 0, status = 'stopped', version = NULL,
        started_at = NULL, heartbeat_at = NULL, expires_at = NULL, last_tick_at = NULL,
        last_success_at = NULL, last_error_code = NULL
    WHERE id = 'default'
  `).run();

  const locked = await app.inject({
    method: "PATCH",
    url: "/api/admin/membership-fulfillment/settings",
    headers,
    payload: { enabled: true }
  });
  assert.equal(locked.statusCode, 409);
  assert.equal(locked.json().code, "MEMBERSHIP_PAYMENT_GATE_LOCKED");

  const saved = await app.inject({
    method: "PATCH",
    url: "/api/admin/membership-fulfillment/settings",
    headers,
    payload: {
      appId: "ak_test_redacted",
      appSecret: "sk_test_redacted",
	  webhookSecret: "whsec_test_redacted",
	  gptToken: "gpt_test_redacted"
    }
  });
  assert.equal(saved.statusCode, 200);
  const settings = saved.json().settings;
  assert.equal(settings.paymentGateLocked, true);
  assert.equal(settings.hasAppSecret, true);
  assert.equal(settings.hasWebhookSecret, true);
	assert.equal(settings.dependencies.hasGptToken, true);
  assert.equal("appSecret" in settings, false);
  assert.equal("webhookSecret" in settings, false);

  const row = db.prepare("SELECT * FROM membership_fulfillment_settings WHERE id = 'default'").get();
  assert.notEqual(row.spacexcard_app_secret_encrypted, "sk_test_redacted");
  assert.notEqual(row.spacexcard_webhook_secret_encrypted, "whsec_test_redacted");
	const gptSettings = db.prepare("SELECT spacexcard_api_token_encrypted FROM extension_delivery_settings WHERE id='default'").get();
	assert.notEqual(gptSettings.spacexcard_api_token_encrypted, "gpt_test_redacted");
  const audit = db.prepare(`
    SELECT detail FROM admin_audit_logs
    WHERE action = 'membership_fulfillment.settings.update'
    ORDER BY created_at DESC LIMIT 1
  `).get();
	assert.doesNotMatch(audit.detail, /sk_test_redacted|whsec_test_redacted|gpt_test_redacted/);

	db.prepare(`INSERT INTO card_capacity_reservations (
	  id,fulfillment_id,provider_key,target_lane,state,reserved_at
	) VALUES ('ccr_spacex_identity_lock','mf_spacex_identity_lock','spacexcard','plus','reserved',?)`)
	  .run(new Date().toISOString());
	const identityLocked = await app.inject({
	  method: "PATCH",
	  url: "/api/admin/membership-fulfillment/settings",
	  headers,
	  payload: { appSecret: "sk_replacement_must_not_apply" }
	});
	assert.equal(identityLocked.statusCode, 409);
	assert.equal(identityLocked.json().code, "CARD_PLATFORM_FINANCIAL_EXPOSURE");
	db.prepare("UPDATE card_capacity_reservations SET state='released',released_at=? WHERE id='ccr_spacex_identity_lock'")
	  .run(new Date().toISOString());
});

test("card platform admin keeps Efun credentials secret and isolates inventory by provider", async () => {
  if (!app) ({ app } = await import("../api/src/server.js"));
  const login = await app.inject({
    method: "POST",
    url: "/api/admin/auth/login",
    payload: { username: "admin", password: "test-password" }
  });
  const headers = { authorization: `Bearer ${login.json().token}` };

  const missing = await app.inject({
    method: "PUT",
    url: "/api/admin/membership-card-platforms/efuncard",
    headers,
    payload: { baseUrl: "https://cards.example.test/api/open/v1", enabled: true, priority: 50 }
  });
  assert.equal(missing.statusCode, 409);
  assert.equal(missing.json().code, "CARD_PLATFORM_NOT_CONFIGURED");

  const saved = await app.inject({
    method: "PUT",
    url: "/api/admin/membership-card-platforms/efuncard",
    headers,
    payload: {
      baseUrl: "https://cards.example.test/api/open/v1",
      apiKey: "efk_test_redacted",
      enabled: true,
      priority: 50
    }
  });
  assert.equal(saved.statusCode, 200);
  assert.equal(saved.json().item.enabled, true);
  assert.equal(saved.json().item.hasCredential, true);
  assert.equal(saved.json().item.inventoryStatus, "not_started");
  assert.doesNotMatch(saved.body, /efk_test_redacted/);
  const stored = db.prepare("SELECT * FROM membership_card_platforms WHERE key='efuncard'").get();
  assert.notEqual(stored.credential_encrypted, "efk_test_redacted");
  assert.deepEqual(JSON.parse(decryptText(stored.credential_encrypted)), { apiKey: "efk_test_redacted" });

  const started = await app.inject({
    method: "POST",
    url: "/api/admin/membership-inventory/initialize",
    headers,
    payload: { providerKey: "efuncard" }
  });
  assert.equal(started.statusCode, 200, started.body);
  assert.equal(started.json().run.providerKey, "efuncard");
  assert.equal(
    db.prepare("SELECT inventory_status FROM membership_card_platforms WHERE key='efuncard'").get().inventory_status,
    "running"
  );
  db.prepare("UPDATE card_inventory_runs SET status='completed',completed_at=?,locked_at=NULL,locked_by=NULL WHERE id=?")
    .run(new Date().toISOString(), started.json().run.id);
  db.prepare("UPDATE membership_card_platforms SET inventory_status='completed',inventory_initialized_at=? WHERE key='efuncard'")
    .run(new Date().toISOString());

  db.prepare(`INSERT INTO card_capacity_reservations (
    id,fulfillment_id,provider_key,target_lane,state,reserved_at
  ) VALUES ('ccr_platform_lock','mf_platform_lock','efuncard','plus','reserved',?)`).run(new Date().toISOString());
  const reservationLocked = await app.inject({
    method: "PUT",
    url: "/api/admin/membership-card-platforms/efuncard",
    headers,
    payload: { baseUrl: "https://replacement.example.test/api/open/v1" }
  });
  assert.equal(reservationLocked.statusCode, 409);
  assert.equal(reservationLocked.json().code, "CARD_PLATFORM_FINANCIAL_EXPOSURE");
  db.prepare("UPDATE card_capacity_reservations SET state='released',released_at=? WHERE id='ccr_platform_lock'")
    .run(new Date().toISOString());

  db.prepare(`INSERT INTO funding_intents (
    id,fulfillment_id,provider_key,operation,amount,fee,idempotency_key,
    request_fingerprint,request_body_encrypted,state,created_at
  ) VALUES ('mfi_platform_lock','mf_platform_lock','efuncard','recharge',10,0.1,
    'platform-lock-key','platform-lock-fingerprint',?,'outcome_unknown',?)`)
    .run(encryptText("{}"), new Date().toISOString());
  const fundingLocked = await app.inject({
    method: "PUT",
    url: "/api/admin/membership-card-platforms/efuncard",
    headers,
    payload: { clearCredential: true, enabled: false }
  });
  assert.equal(fundingLocked.statusCode, 409);
  assert.equal(fundingLocked.json().code, "CARD_PLATFORM_FINANCIAL_EXPOSURE");
  db.prepare("UPDATE funding_intents SET state='failed',resolved_at=? WHERE id='mfi_platform_lock'")
    .run(new Date().toISOString());
});

test("SpaceX Card webhook verifies raw signatures, deduplicates, redacts PAN, and keeps terminal state", async () => {
  if (!app) ({ app } = await import("../api/src/server.js"));
  const secret = "whsec_webhook_test";
  const pan = "5378721234567890";
  const upstreamCardId = 987654;
  const managedCardId = "mc_webhook_test";
  const vmCardId = "card-webhook-test";
  const at = new Date().toISOString();
  db.prepare(`
    UPDATE membership_fulfillment_settings
    SET spacexcard_webhook_secret_encrypted = ?, inventory_status = 'completed', updated_at = ?
    WHERE id = 'default'
  `).run(encryptText(secret), at);
  db.prepare(`
    INSERT INTO managed_cards (
      id, upstream_card_id, vm_card_id, product_code, bin, last4, upstream_status,
      cached_available_amount, capacity_state, reconciliation_state, created_at, updated_at
    ) VALUES (?, ?, ?, 'P5378OX', '537872', '7890', 'ACTIVE', 20, 'AVAILABLE', 'READY', ?, ?)
  `).run(managedCardId, upstreamCardId, vmCardId, at, at);
  db.prepare(`
    INSERT INTO managed_cards (
      id, provider_key, upstream_card_id, vm_card_id, product_code, bin, last4,
      upstream_status, cached_available_amount, capacity_state, reconciliation_state,
      created_at, updated_at
    ) VALUES ('mc_efun_webhook_collision', 'efuncard', ?, 'efun-webhook-collision',
      '559666', '559666', '7890', 'ACTIVE', 20, 'AVAILABLE', 'READY', ?, ?)
  `).run(upstreamCardId, at, at);

  const baseEvent = {
    event: "card_transaction",
    auth_id: "webhook-auth-main",
    vm_card_id: vmCardId,
    card_id: upstreamCardId,
    card_number: pan,
    settle_amount: 0,
    status: "PENDING",
    type: "Authorization",
    merchant: "OPENAI"
  };
  const raw = JSON.stringify(baseEvent);
  const invalid = await app.inject({
    method: "POST",
    url: "/api/webhooks/spacexcard/card-transactions",
    headers: { "content-type": "application/json", "x-signature": "0".repeat(64) },
    payload: raw
  });
  assert.equal(invalid.statusCode, 401);

  const accepted = await app.inject({
    method: "POST",
    url: "/api/webhooks/spacexcard/card-transactions",
    headers: { "content-type": "application/json", "x-signature": signWebhookBody(secret, raw) },
    payload: raw
  });
  assert.equal(accepted.statusCode, 202);
  assert.deepEqual(accepted.json(), { accepted: true, duplicate: false });
  assert.equal(db.prepare(`
    SELECT managed_card_id FROM spacexcard_webhook_events
    WHERE auth_id = 'webhook-auth-main' AND type = 'Authorization' AND status = 'PENDING'
  `).get().managed_card_id, managedCardId);

  const duplicate = await app.inject({
    method: "POST",
    url: "/api/webhooks/spacexcard/card-transactions",
    headers: { "content-type": "application/json", "x-signature": signWebhookBody(secret, raw) },
    payload: raw
  });
  assert.equal(duplicate.statusCode, 202);
  assert.deepEqual(duplicate.json(), { accepted: true, duplicate: true });
  assert.equal(db.prepare(`
    SELECT COUNT(*) AS count FROM spacexcard_webhook_events WHERE auth_id = 'webhook-auth-main'
  `).get().count, 1);
  assert.equal(db.prepare(`
    SELECT COUNT(*) AS count FROM membership_outbox
    WHERE event_type = 'card.transaction.changed' AND payload LIKE '%webhook-auth-main%'
  `).get().count, 1);

  const completeBody = JSON.stringify({
    ...baseEvent,
    auth_id: "webhook-auth-order",
    settle_amount: 16.24,
    status: "COMPLETE",
    type: "Settlement"
  });
  const pendingBody = JSON.stringify({
    ...baseEvent,
    auth_id: "webhook-auth-order"
  });
  for (const body of [completeBody, pendingBody]) {
    const response = await app.inject({
      method: "POST",
      url: "/api/webhooks/spacexcard/card-transactions",
      headers: { "content-type": "application/json", "x-signature": signWebhookBody(secret, body) },
      payload: body
    });
    assert.equal(response.statusCode, 202);
  }
  const transaction = db.prepare(`
    SELECT * FROM managed_card_transactions
    WHERE card_id = ? AND auth_id = 'webhook-auth-order'
  `).get(managedCardId);
  assert.equal(transaction.type, "Settlement");
  assert.equal(transaction.status, "COMPLETE");
  assert.equal(transaction.authorization_seen, 1);
  assert.equal(transaction.settlement_seen, 1);
  assert.equal(transaction.settle_amount, 16.24);
  assert.equal(db.prepare("SELECT reconciliation_state FROM managed_cards WHERE id = ?").get(managedCardId).reconciliation_state, "PENDING");

  const persisted = JSON.stringify({
    events: db.prepare("SELECT * FROM spacexcard_webhook_events WHERE managed_card_id = ?").all(managedCardId),
    transactions: db.prepare("SELECT * FROM managed_card_transactions WHERE card_id = ?").all(managedCardId),
    outbox: db.prepare("SELECT payload FROM membership_outbox WHERE payload LIKE '%webhook-auth-%'").all(),
    audits: db.prepare("SELECT detail FROM admin_audit_logs").all()
  });
  assert.doesNotMatch(persisted, new RegExp(pan));
  assert.doesNotMatch(JSON.stringify(db.prepare(`
    SELECT payload FROM membership_outbox WHERE payload LIKE '%webhook-auth-%'
  `).all()), /card_number/i);

  const oversizedBody = JSON.stringify({ ...baseEvent, merchant: "x".repeat(40 * 1024) });
  const oversized = await app.inject({
    method: "POST",
    url: "/api/webhooks/spacexcard/card-transactions",
    headers: {
      "content-type": "application/json",
      "x-signature": signWebhookBody(secret, oversizedBody)
    },
    payload: oversizedBody
  });
  assert.equal(oversized.statusCode, 413, oversized.body);

  const prices = fixture("spacexcard-openapi-openai-payments.json").data.map((item) => ({
    tier: item.tier,
    label: item.label,
    minUsd: item.min_usd,
    maxUsd: item.max_usd,
    amount: item.amount,
    time: item.time,
    found: item.found
  }));
  const authoritativeTransactions = [
    {
      authId: "webhook-auth-order",
      authTime: at,
      authAmount: 16.24,
      authCurrency: "USD",
      settleAmount: 0,
      settleCurrency: "USD",
      status: "PENDING",
      type: "Authorization",
      merchantNormalized: "OPENAI",
      createdAt: at
    },
    {
      authId: "webhook-auth-order",
      authTime: at,
      authAmount: 16.24,
      authCurrency: "USD",
      settleAmount: 16.24,
      settleCurrency: "USD",
      status: "COMPLETE",
      type: "Settlement",
      merchantNormalized: "OPENAI",
      createdAt: at
    }
  ];
  const targetedRunner = createMembershipInventoryRunner({
    db,
    decryptText() { throw new Error("clientFactory should avoid real credentials"); },
    workerId: "inventory-webhook-target-worker",
    clientFactory: () => ({
      async listTransactions() { return authoritativeTransactions; },
      async getOpenAiPayments() { return prices; }
    }),
    logger: { warn() {} }
  });
  const targeted = await targetedRunner.tick();
  assert.equal(targeted.action, "scheduled_targeted");
  assert.equal(targeted.upstreamCardId, upstreamCardId);
  assert.equal((await targetedRunner.tick()).action, "reconciled");
  const reconciledCard = db.prepare("SELECT * FROM managed_cards WHERE id = ?").get(managedCardId);
  assert.equal(reconciledCard.reconciliation_state, "READY");
  assert.equal(reconciledCard.lane, "plus");
});

test("PHP price contracts are versioned and card products require fresh proof before enabling", async () => {
  if (!app) ({ app } = await import("../api/src/server.js"));
  const login = await app.inject({
    method: "POST",
    url: "/api/admin/auth/login",
    payload: { username: "admin", password: "test-password" }
  });
  const headers = { authorization: `Bearer ${login.json().token}` };
  const at = new Date().toISOString();
  const productCode = "P-POLICY-TEST";
  const cardId = "mc_policy_test";
  db.prepare(`
    INSERT OR IGNORE INTO managed_cards (
      id, upstream_card_id, vm_card_id, product_code, bin, last4, upstream_status,
      cached_available_amount, capacity_state, reconciliation_state, created_at, updated_at
    ) VALUES (?, 765432, 'card-policy-test', ?, '537872', '5432', 'ACTIVE',
      20, 'AVAILABLE', 'READY', ?, ?)
  `).run(cardId, productCode, at, at);
  const insertPrice = db.prepare(`
    INSERT INTO card_price_signals (
      card_id, tier, found, amount, min_usd, max_usd, provider_time, fetched_at
    ) VALUES (?, ?, 1, ?, ?, ?, ?, ?)
    ON CONFLICT(card_id, tier) DO UPDATE SET
      found = 1, amount = excluded.amount, min_usd = excluded.min_usd,
      max_usd = excluded.max_usd, provider_time = excluded.provider_time,
      fetched_at = excluded.fetched_at
  `);
  insertPrice.run(cardId, "plus", 16.24, 15, 20, at, at);
  insertPrice.run(cardId, "x5", 99, 90, 110, at, at);
  insertPrice.run(cardId, "x20", 199, 180, 220, at, at);

  const invalidContract = await app.inject({
    method: "POST",
    url: "/api/admin/checkout-price-contracts",
    headers,
    payload: { tier: "plus", minAmount: 1100, maxAmount: 1000 }
  });
  assert.equal(invalidContract.statusCode, 400);

  const first = await app.inject({
    method: "POST",
    url: "/api/admin/checkout-price-contracts",
    headers,
    payload: { tier: "plus", minAmount: 999, maxAmount: 1099 }
  });
  assert.equal(first.statusCode, 201);
  assert.equal(first.json().item.version, 1);
  assert.equal(first.json().item.status, "draft");
  const firstId = first.json().item.id;
  const activateFirst = await app.inject({
    method: "POST",
    url: `/api/admin/checkout-price-contracts/${encodeURIComponent(firstId)}/activate`,
    headers,
    payload: {}
  });
  assert.equal(activateFirst.statusCode, 200);
  assert.equal(activateFirst.json().item.status, "active");

  const second = await app.inject({
    method: "POST",
    url: "/api/admin/checkout-price-contracts",
    headers,
    payload: { tier: "plus", minAmount: 1000, maxAmount: 1100 }
  });
  assert.equal(second.statusCode, 201);
  assert.equal(second.json().item.version, 2);
  const secondId = second.json().item.id;
  assert.equal((await app.inject({
    method: "POST",
    url: `/api/admin/checkout-price-contracts/${encodeURIComponent(secondId)}/activate`,
    headers,
    payload: {}
  })).statusCode, 200);
  const contracts = await app.inject({
    method: "GET",
    url: "/api/admin/checkout-price-contracts?tier=plus",
    headers
  });
  assert.deepEqual(contracts.json().items.map((item) => [item.version, item.status]), [
    [2, "active"],
    [1, "retired"]
  ]);

  const policies = await app.inject({
    method: "GET",
    url: "/api/admin/card-product-policies",
    headers
  });
  const product = policies.json().items.find((item) => item.productCode === productCode);
  assert.deepEqual(product.provenTiers, { plus: true, x5: true, x20: true });
  assert.equal(product.canEnable, true);

  const enabled = await app.inject({
    method: "PUT",
    url: "/api/admin/card-product-policies",
    headers,
    payload: { items: [{ productCode, enabled: true }] }
  });
  assert.equal(enabled.statusCode, 200);
  assert.equal(enabled.json().items.find((item) => item.productCode === productCode).revision, 1);
  const disabled = await app.inject({
    method: "PUT",
    url: "/api/admin/card-product-policies",
    headers,
    payload: { items: [{ productCode, enabled: false }] }
  });
  assert.equal(disabled.statusCode, 200);
  assert.equal(disabled.json().items.find((item) => item.productCode === productCode).revision, 2);

  const staleAt = new Date(Date.now() - 80 * 60 * 60 * 1000).toISOString();
  db.prepare("UPDATE card_price_signals SET provider_time = ? WHERE card_id = ?").run(staleAt, cardId);
  const staleEnable = await app.inject({
    method: "PUT",
    url: "/api/admin/card-product-policies",
    headers,
    payload: { items: [{ productCode, enabled: true }] }
  });
  assert.equal(staleEnable.statusCode, 409);
  assert.equal(staleEnable.json().code, "CARD_PRODUCT_NOT_PROVEN");

  const unknown = await app.inject({
    method: "PUT",
    url: "/api/admin/card-product-policies",
    headers,
    payload: { items: [{ productCode: "UNKNOWN-PRODUCT", enabled: true }] }
  });
  assert.equal(unknown.statusCode, 404);
});

test("no-charge validation stores only allowlisted facts and never permits card or click data", async () => {
  if (!app) ({ app } = await import("../api/src/server.js"));
  const login = await app.inject({
    method: "POST",
    url: "/api/admin/auth/login",
    payload: { username: "admin", password: "test-password" }
  });
  const headers = { authorization: `Bearer ${login.json().token}` };
  const at = new Date().toISOString();
  const productId = "product_no_charge_test";
  const siteId = "site_no_charge_test";
  const contractId = "cpc_no_charge_test";
  db.prepare(`
    INSERT OR IGNORE INTO products (
      id, code, title, membership_tier, status, created_at, updated_at
    ) VALUES (?, 'NO_CHARGE_X5', 'No Charge x5', 'x5', 'active', ?, ?)
  `).run(productId, at, at);
  db.prepare(`
    INSERT OR IGNORE INTO sites (
      id, name, slug, product_id, status, created_at, updated_at
    ) VALUES (?, 'No Charge Site', 'no-charge-site', ?, 'active', ?, ?)
  `).run(siteId, productId, at, at);
  db.prepare(`
    INSERT OR IGNORE INTO checkout_price_contracts (
      id, tier, version, currency, min_amount, max_amount, status,
      created_at, created_by, activated_at
    ) VALUES (?, 'x5', 1, 'PHP', 4999, 5099, 'active', ?, 'admin', ?)
  `).run(contractId, at, at);
  const facts = {
    originRecognized: true,
    routeRecognized: true,
    planRecognized: true,
    currency: "PHP",
    displayedAmount: 5049,
    requiredFieldsRecognized: true,
    allowedControlRecognized: true,
    cardMaterialRequested: false,
    progressionActivated: false,
    finalSubmitActivated: false
  };
  const pan = "5378729999991111";
  const rejected = await app.inject({
    method: "POST",
    url: "/api/admin/checkout-validation-runs",
    headers,
    payload: {
      siteId,
      productId,
      tier: "x5",
      adapterVersion: "checkout-v1-test",
      priceContractId: contractId,
      facts: { ...facts, cardNumber: pan }
    }
  });
  assert.equal(rejected.statusCode, 400);
  const clickRejected = await app.inject({
    method: "POST",
    url: "/api/admin/checkout-validation-runs",
    headers,
    payload: {
      siteId,
      productId,
      tier: "x5",
      adapterVersion: "checkout-v1-test",
      priceContractId: contractId,
      facts: { ...facts, progressionActivated: true }
    }
  });
  assert.equal(clickRejected.statusCode, 400);

  const passed = await app.inject({
    method: "POST",
    url: "/api/admin/checkout-validation-runs",
    headers,
    payload: {
      siteId,
      productId,
      tier: "x5",
      adapterVersion: "checkout-v1-test",
      priceContractId: contractId,
      facts
    }
  });
  assert.equal(passed.statusCode, 201);
  assert.equal(passed.json().item.status, "passed");
  assert.deepEqual(passed.json().item.result.failedChecks, []);

  const failed = await app.inject({
    method: "POST",
    url: "/api/admin/checkout-validation-runs",
    headers,
    payload: {
      siteId,
      productId,
      tier: "x5",
      adapterVersion: "checkout-v1-test",
      priceContractId: contractId,
      facts: { ...facts, displayedAmount: 6000 }
    }
  });
  assert.equal(failed.statusCode, 201);
  assert.equal(failed.json().item.status, "failed");
  assert.deepEqual(failed.json().item.result.failedChecks, ["PRICE_OUT_OF_RANGE"]);

  const listed = await app.inject({
    method: "GET",
    url: "/api/admin/checkout-validation-runs?tier=x5",
    headers
  });
  assert.equal(listed.statusCode, 200);
  assert.equal(listed.json().items.length, 2);
  const persisted = JSON.stringify({
    runs: db.prepare("SELECT sanitized_result FROM checkout_validation_runs WHERE site_id = ?").all(siteId),
    audits: db.prepare("SELECT detail FROM admin_audit_logs WHERE action = 'checkout_validation_run.record'").all()
  });
  assert.doesNotMatch(persisted, new RegExp(pan));
  assert.doesNotMatch(persisted, /cardNumber|rawHtml|screenshot/i);
  assert.equal(db.prepare("SELECT enabled FROM membership_fulfillment_settings WHERE id = 'default'").get().enabled, 0);
});

test("admin can confirm an unassigned legacy pending card as Plus without touching the upstream card", async () => {
  if (!app) ({ app } = await import("../api/src/server.js"));
  const at = "2026-07-17T08:00:00.000Z";
  db.prepare(`
    INSERT INTO managed_cards (
      id, upstream_card_id, vm_card_id, product_code, bin, last4, upstream_status,
      cached_available_amount, lane, consumed_slots, capacity_state,
      reconciliation_state, reconciliation_reason, created_at, updated_at
    ) VALUES (
      'card-legacy-plus', 37226, 'vm-legacy-plus', 'USMAB01', '525962', '7995', 'ACTIVE',
      3.94, NULL, 0, 'HOLD', 'HOLD', 'PENDING_SETTLEMENT', ?, ?
    )
  `).run(at, at);
  db.prepare(`
    INSERT INTO managed_card_transactions (
      card_id, auth_id, auth_time, auth_amount, auth_currency, settle_amount,
      settle_currency, type, status, merchant_normalized, authorization_seen,
      settlement_seen, refund_seen, reversal_seen, first_seen_at, last_seen_at
    ) VALUES (
      'card-legacy-plus', 'auth-legacy-plus', ?, 982.14, 'PHP', 0,
      'USD', 'Authorization', 'PENDING', 'OPENAI', 1, 0, 0, 0, ?, ?
    )
  `).run(at, at, at);

  const login = await app.inject({
    method: "POST",
    url: "/api/admin/auth/login",
    payload: { username: "admin", password: "test-password" }
  });
  const headers = { authorization: `Bearer ${login.json().token}` };
  const confirmed = await app.inject({
    method: "POST",
    url: "/api/admin/membership-cards/card-legacy-plus/confirm-plus-lane",
    headers,
    payload: { confirmation: "legacy_plus_cdk" }
  });
  assert.equal(confirmed.statusCode, 200, confirmed.body);

  const card = db.prepare("SELECT * FROM managed_cards WHERE id = 'card-legacy-plus'").get();
  assert.equal(card.upstream_status, "ACTIVE");
  assert.equal(card.lane, "plus");
  assert.equal(card.consumed_slots, 1);
  assert.equal(card.capacity_state, "AVAILABLE");
  assert.equal(card.reconciliation_state, "READY");
  assert.equal(card.reconciliation_reason, null);
  const audit = db.prepare(`
    SELECT detail FROM admin_audit_logs
    WHERE action = 'membership_card.legacy_plus_lane.confirm'
      AND resource_id = 'card-legacy-plus'
    ORDER BY created_at DESC LIMIT 1
  `).get();
  assert.ok(audit);
  assert.deepEqual(JSON.parse(audit.detail), {
    upstreamCardId: 37226,
    previousReason: "PENDING_SETTLEMENT",
    lane: "plus",
    consumedSlots: 1,
    capacityState: "AVAILABLE",
    confirmation: "legacy_plus_cdk"
  });

  const retry = await app.inject({
    method: "POST",
    url: "/api/admin/membership-cards/card-legacy-plus/confirm-plus-lane",
    headers,
    payload: { confirmation: "legacy_plus_cdk" }
  });
  assert.equal(retry.statusCode, 200);
  assert.equal(db.prepare(`
    SELECT COUNT(*) AS count FROM admin_audit_logs
    WHERE action = 'membership_card.legacy_plus_lane.confirm'
      AND resource_id = 'card-legacy-plus'
  `).get().count, 1);

  db.prepare(`
    INSERT INTO managed_cards (
      id, upstream_card_id, vm_card_id, product_code, upstream_status,
      cached_available_amount, capacity_state, reconciliation_state,
      reconciliation_reason, created_at, updated_at
    ) VALUES (
      'card-legacy-conflict', 37227, 'vm-legacy-conflict', 'USMAB01', 'ACTIVE',
      0, 'HOLD', 'HOLD', 'PENDING_SETTLEMENT', ?, ?
    )
  `).run(at, at);
  db.prepare(`
    INSERT INTO managed_card_transactions (
      card_id, auth_id, auth_time, auth_amount, auth_currency, settle_amount,
      settle_currency, type, status, merchant_normalized, authorization_seen,
      settlement_seen, refund_seen, reversal_seen, first_seen_at, last_seen_at
    ) VALUES (
      'card-legacy-conflict', 'auth-legacy-conflict', ?, 130.06, 'USD', 0,
      'USD', 'Authorization', 'PENDING', 'OPENAI', 1, 0, 0, 0, ?, ?
    )
  `).run(at, at, at);
  const conflict = await app.inject({
    method: "POST",
    url: "/api/admin/membership-cards/card-legacy-conflict/confirm-plus-lane",
    headers,
    payload: { confirmation: "legacy_plus_cdk" }
  });
  assert.equal(conflict.statusCode, 409);
  assert.equal(conflict.json().code, "CARD_PLUS_LANE_EVIDENCE_CONFLICT");
  assert.equal(db.prepare("SELECT lane FROM managed_cards WHERE id = 'card-legacy-conflict'").get().lane, null);
});

test("membership inventory admin APIs expose only masked cards and serialize refresh runs", async () => {
  if (!app) ({ app } = await import("../api/src/server.js"));
  const login = await app.inject({
    method: "POST",
    url: "/api/admin/auth/login",
    payload: { username: "admin", password: "test-password" }
  });
  const headers = { authorization: `Bearer ${login.json().token}` };
  const cards = await app.inject({
    method: "GET",
    url: "/api/admin/membership-cards",
    headers
  });
  assert.equal(cards.statusCode, 200);
  assert.match(cards.body, /537872••••8264/);
  assert.doesNotMatch(cards.body, /5378720000008264|card_number|cvv/i);

  const refresh = await app.inject({
    method: "POST",
    url: "/api/admin/membership-inventory/refresh",
    headers,
    payload: {}
  });
  assert.equal(refresh.statusCode, 200);
  assert.equal(refresh.json().run.mode, "refresh");
  const duplicate = await app.inject({
    method: "POST",
    url: "/api/admin/membership-inventory/initialize",
    headers,
    payload: {}
  });
  assert.equal(duplicate.statusCode, 409);
  assert.equal(duplicate.json().code, "INVENTORY_ALREADY_RUNNING");
});

test("manual membership CDKs create the target fulfillment and support one-order historical backfill", async () => {
  if (!app) ({ app } = await import("../api/src/server.js"));
  const login = await app.inject({
    method: "POST",
    url: "/api/admin/auth/login",
    payload: { username: "admin", password: "test-password" }
  });
  const headers = { authorization: `Bearer ${login.json().token}` };
  const created = await app.inject({
    method: "POST",
    url: "/api/admin/cdkeys/create",
    headers,
    payload: {
      sourceKey: "",
      emailToken: "",
      siteId: "site_demo",
      prefix: "X20-FULFILLMENT",
      processingMode: "manual",
      manualType: "x20"
    }
  });
  assert.equal(created.statusCode, 200);

  const redeemed = await app.inject({
    method: "POST",
    url: "/api/public/redeem",
    payload: {
      publicKey: created.json().publicKey,
      sessionPayload: JSON.stringify({ user: { email: "manual-x20@example.com" } }),
      abandonRemainingTime: false
    }
  });
  assert.equal(redeemed.statusCode, 200);
  const order = db.prepare("SELECT * FROM redeem_orders WHERE order_no = ?").get(redeemed.json().orderNo);
  const original = db.prepare("SELECT * FROM membership_fulfillments WHERE order_id = ?").get(order.id);
  assert.equal(original.target_tier, "x20");
	assert.equal(original.state, "WAITING_SESSION_VALIDATION");

  db.prepare("DELETE FROM membership_fulfillments WHERE id = ?").run(original.id);
  db.prepare(`
    UPDATE redeem_orders
    SET extension_delivery_status = 'succeeded', extension_delivery_updated_at = ?
    WHERE id = ?
  `).run(new Date().toISOString(), order.id);
  const repaired = await app.inject({
    method: "POST",
    url: "/api/admin/membership-fulfillments/backfill",
    headers,
    payload: { orderNo: order.order_no }
  });
  assert.equal(repaired.statusCode, 200);
  assert.equal(repaired.json().created, true);
  assert.equal(repaired.json().item.targetTier, "x20");
	assert.equal(repaired.json().item.state, "WAITING_SESSION_VALIDATION");
	assert.equal(Number.isFinite(Date.parse(repaired.json().item.automationEnrolledAt)), true);
	assert.equal(repaired.json().enrolled, true);

  const repeated = await app.inject({
    method: "POST",
    url: "/api/admin/membership-fulfillments/backfill",
    headers,
    payload: { orderNo: order.order_no }
  });
  assert.equal(repeated.statusCode, 200);
  assert.equal(repeated.json().created, false);
	assert.equal(repeated.json().enrolled, false);
  assert.equal(db.prepare(`
    SELECT COUNT(*) AS count FROM admin_audit_logs
    WHERE action = 'membership.fulfillment.backfill' AND resource_id = ?
  `).get(repaired.json().item.id).count, 1);

	db.prepare(`
	  UPDATE membership_fulfillments SET automation_enrolled_at = NULL WHERE id = ?
	`).run(repaired.json().item.id);
	const enrolledExisting = await app.inject({
	  method: "POST",
	  url: "/api/admin/membership-fulfillments/backfill",
	  headers,
	  payload: { orderNo: order.order_no }
	});
	assert.equal(enrolledExisting.statusCode, 200);
	assert.equal(enrolledExisting.json().created, false);
	assert.equal(enrolledExisting.json().enrolled, true);
	assert.equal(Number.isFinite(Date.parse(enrolledExisting.json().item.automationEnrolledAt)), true);
	assert.equal(db.prepare(`
	  SELECT COUNT(*) AS count FROM admin_audit_logs
	  WHERE action = 'membership.fulfillment.backfill' AND resource_id = ?
	`).get(repaired.json().item.id).count, 2);
});

test("voiding a redeemed CDK cancels its queued delivery and membership fulfillment", async () => {
  if (!app) ({ app } = await import("../api/src/server.js"));
  const login = await app.inject({
    method: "POST",
    url: "/api/admin/auth/login",
    payload: { username: "admin", password: "test-password" }
  });
  const headers = { authorization: `Bearer ${login.json().token}` };
  const created = await app.inject({
    method: "POST",
    url: "/api/admin/cdkeys/create",
    headers,
    payload: {
      sourceKey: "",
      siteId: "site_demo",
      prefix: "VOID-QUEUED",
      processingMode: "manual",
      manualType: "PLUS"
    }
  });
  assert.equal(created.statusCode, 200);

  const redeemed = await app.inject({
    method: "POST",
    url: "/api/public/redeem",
    payload: {
      publicKey: created.json().publicKey,
      sessionPayload: JSON.stringify({ user: { email: "void-queued@example.com" } }),
      abandonRemainingTime: false
    }
  });
  assert.equal(redeemed.statusCode, 200);
  const order = db.prepare("SELECT * FROM redeem_orders WHERE order_no = ?").get(redeemed.json().orderNo);
  db.prepare(`
    UPDATE redeem_orders
    SET extension_delivery_status = 'pending', extension_delivery_error = NULL
    WHERE id = ?
  `).run(order.id);

  const voided = await app.inject({
    method: "POST",
    url: "/api/admin/cdkeys/bulk-action",
    headers,
    payload: { ids: [created.json().id], action: "void" }
  });
  assert.equal(voided.statusCode, 200);
  assert.deepEqual(voided.json(), {
    updated: 1,
    cancelledOrders: 1,
    cancelledJobs: 0,
    cancelledExtensionDeliveries: 1,
    cancelledMembershipFulfillments: 1
  });

  const cdkey = db.prepare("SELECT * FROM cdkeys WHERE id = ?").get(created.json().id);
  assert.equal(cdkey.status, "void");
  assert.equal(cdkey.locked_by_order_id, null);
  const cancelledOrder = db.prepare("SELECT * FROM redeem_orders WHERE id = ?").get(order.id);
  assert.equal(cancelledOrder.status, "failed");
  assert.equal(cancelledOrder.error_message, "关联卡密已由后台作废");
  assert.equal(cancelledOrder.extension_delivery_status, "failed");
  assert.equal(cancelledOrder.extension_delivery_error, "CDKEY_VOIDED");
  const fulfillment = db.prepare("SELECT * FROM membership_fulfillments WHERE order_id = ?").get(order.id);
  assert.equal(fulfillment.state, "CANCELLED");
  assert.equal(fulfillment.failure_code, "CDKEY_VOIDED");
  assert.ok(fulfillment.completed_at);
});

test("voiding a redeemed CDK cancels its pending activation job", async () => {
  if (!app) ({ app } = await import("../api/src/server.js"));
  const login = await app.inject({
    method: "POST",
    url: "/api/admin/auth/login",
    payload: { username: "admin", password: "test-password" }
  });
  const headers = { authorization: `Bearer ${login.json().token}` };
  const created = await app.inject({
    method: "POST",
    url: "/api/admin/cdkeys/create",
    headers,
    payload: {
      sourceKey: "source-key-for-void-test",
      siteId: "site_demo",
      prefix: "VOID-JOB",
      processingMode: "auto"
    }
  });
  assert.equal(created.statusCode, 200);
  const redeemed = await app.inject({
    method: "POST",
    url: "/api/public/redeem",
    payload: {
      publicKey: created.json().publicKey,
      sessionPayload: JSON.stringify({ user: { email: "void-job@example.com" } }),
      abandonRemainingTime: false
    }
  });
  assert.equal(redeemed.statusCode, 200);
  const order = db.prepare("SELECT * FROM redeem_orders WHERE order_no = ?").get(redeemed.json().orderNo);
  db.prepare(`
    UPDATE redeem_orders
    SET extension_delivery_status = NULL, extension_delivery_error = NULL
    WHERE id = ?
  `).run(order.id);
  assert.equal(db.prepare("SELECT status FROM activation_jobs WHERE order_id = ?").get(order.id).status, "pending");

  const voided = await app.inject({
    method: "POST",
    url: "/api/admin/cdkeys/bulk-action",
    headers,
    payload: { ids: [created.json().id], action: "void" }
  });
  assert.equal(voided.statusCode, 200);
  assert.deepEqual(voided.json(), {
    updated: 1,
    cancelledOrders: 1,
    cancelledJobs: 1,
    cancelledExtensionDeliveries: 0,
    cancelledMembershipFulfillments: 0
  });
  const job = db.prepare("SELECT * FROM activation_jobs WHERE order_id = ?").get(order.id);
  assert.equal(job.status, "cancelled");
  assert.equal(job.last_error, "关联卡密已由后台作废");
  assert.equal(job.locked_at, null);
  assert.equal(db.prepare("SELECT status FROM redeem_orders WHERE id = ?").get(order.id).status, "failed");
  assert.equal(db.prepare("SELECT status FROM cdkeys WHERE id = ?").get(created.json().id).status, "void");
});

test("voiding a CDK is rejected after its membership fulfillment crosses the money boundary", async () => {
  if (!app) ({ app } = await import("../api/src/server.js"));
  const login = await app.inject({
    method: "POST",
    url: "/api/admin/auth/login",
    payload: { username: "admin", password: "test-password" }
  });
  const headers = { authorization: `Bearer ${login.json().token}` };
  const created = await app.inject({
    method: "POST",
    url: "/api/admin/cdkeys/create",
    headers,
    payload: {
      sourceKey: "",
      siteId: "site_demo",
      prefix: "VOID-MONEY",
      processingMode: "manual",
      manualType: "PLUS"
    }
  });
  const redeemed = await app.inject({
    method: "POST",
    url: "/api/public/redeem",
    payload: {
      publicKey: created.json().publicKey,
      sessionPayload: JSON.stringify({ user: { email: "void-money@example.com" } }),
      abandonRemainingTime: false
    }
  });
  assert.equal(redeemed.statusCode, 200);
  const order = db.prepare("SELECT * FROM redeem_orders WHERE order_no = ?").get(redeemed.json().orderNo);
  db.prepare(`
    UPDATE membership_fulfillments
    SET state = 'FUNDING', money_boundary_at = ?, updated_at = ?
    WHERE order_id = ?
  `).run("2026-07-17T12:00:00.000Z", "2026-07-17T12:00:00.000Z", order.id);

  const voided = await app.inject({
    method: "POST",
    url: "/api/admin/cdkeys/bulk-action",
    headers,
    payload: { ids: [created.json().id], action: "void" }
  });
  assert.equal(voided.statusCode, 409);
  assert.equal(voided.json().code, "CDKEY_VOID_BLOCKED_BY_MONEY_BOUNDARY");
  assert.equal(db.prepare("SELECT status FROM cdkeys WHERE id = ?").get(created.json().id).status, "locked");
  assert.equal(db.prepare("SELECT status FROM redeem_orders WHERE id = ?").get(order.id).status, "pending");
  assert.equal(db.prepare("SELECT state FROM membership_fulfillments WHERE order_id = ?").get(order.id).state, "FUNDING");

  const lockedSession = await app.inject({
    method: "GET",
    url: `/api/admin/cdkeys/${encodeURIComponent(created.json().id)}/session`,
    headers
  });
  assert.equal(lockedSession.statusCode, 200);
  assert.deepEqual(JSON.parse(lockedSession.json().sessionJson), { user: { email: "void-money@example.com" } });
});

test("post-boundary Session recovery requires the original CDK and account identity", async () => {
	if (!app) ({ app } = await import("../api/src/server.js"));
	const login = await app.inject({
		method: "POST",
		url: "/api/admin/auth/login",
		payload: { username: "admin", password: "test-password" }
	});
	const headers = { authorization: `Bearer ${login.json().token}` };
	const created = await app.inject({
		method: "POST",
		url: "/api/admin/cdkeys/create",
		headers,
		payload: {
			sourceKey: "",
			siteId: "site_demo",
			prefix: "SESSION-RECOVERY",
			processingMode: "manual",
			manualType: "PLUS"
		}
	});
	const originalEmail = "session-recovery@example.com";
	const redeemed = await app.inject({
		method: "POST",
		url: "/api/public/redeem",
		payload: {
			publicKey: created.json().publicKey,
			sessionPayload: JSON.stringify({ user: { email: originalEmail }, accessToken: "old-session" }),
			abandonRemainingTime: false
		}
	});
	assert.equal(redeemed.statusCode, 200);
	const order = db.prepare("SELECT * FROM redeem_orders WHERE order_no=?").get(redeemed.json().orderNo);
	const lock = deriveMembershipAccountLockKey(process.env.JWT_SECRET, { email: originalEmail });
	db.prepare(`UPDATE membership_fulfillments SET state='SESSION_RECOVERY_REQUIRED',
	  account_lock_key=?,money_boundary_at=?,card_reservation_id='reservation-immutable',
	  current_stage='plus',state_revision=state_revision+1,updated_at=? WHERE order_id=?`).run(
		lock, "2026-08-13T01:00:00.000Z", "2026-08-13T01:01:00.000Z", order.id
	);
	db.prepare(`UPDATE extension_delivery_settings SET spacexcard_api_token_encrypted=? WHERE id='default'`).run(
		encryptText("session-converter-token")
	);

	const originalFetch = globalThis.fetch;
	globalThis.fetch = async (url, options) => {
		if (String(url).includes("session-to-cookie")) {
			const submitted = JSON.parse(JSON.parse(options.body).token_input);
			return new Response(JSON.stringify({
				code: 0,
				data: {
					email: submitted.user.email,
					count: 1,
					cookies: [{
						domain: ".chatgpt.com", hostOnly: false, httpOnly: true,
						name: "__Secure-next-auth.session-token", path: "/", sameSite: "lax",
						secure: true, session: true, storeId: null, value: "verified-cookie"
					}]
				},
				msg: "ok"
			}), { status: 200, headers: { "content-type": "application/json" } });
		}
		return new Response(JSON.stringify({
			code: 200,
			data: {
				account_type: "free", currency: null, auto_renew: false,
				is_overdue: false, is_delinquent: false, expire_time: null
			}
		}), { status: 200, headers: { "content-type": "application/json" } });
	};
	const mismatch = await app.inject({
		method: "POST",
		url: `/api/public/orders/${encodeURIComponent(order.order_no)}/membership-session`,
		payload: {
			publicKey: created.json().publicKey,
			sessionPayload: JSON.stringify({ user: { email: "other@example.com" }, accessToken: "wrong-session" })
		}
	});
	assert.equal(mismatch.statusCode, 409);
	assert.equal(mismatch.json().code, "SESSION_IDENTITY_MISMATCH");

	let recovered;
	try {
		recovered = await app.inject({
			method: "POST",
			url: `/api/public/orders/${encodeURIComponent(order.order_no)}/membership-session`,
			payload: {
				publicKey: created.json().publicKey,
				sessionPayload: JSON.stringify({ user: { email: originalEmail }, accessToken: "new-session" })
			}
		});
	} finally {
		globalThis.fetch = originalFetch;
	}
	assert.equal(recovered.statusCode, 200);
	assert.equal(recovered.json().accepted, true);
	assert.equal(recovered.json().membershipDelivery.label, "正在核对付款状态");

	const updatedOrder = db.prepare("SELECT * FROM redeem_orders WHERE id=?").get(order.id);
	const updatedFulfillment = db.prepare("SELECT * FROM membership_fulfillments WHERE order_id=?").get(order.id);
	const updatedCdk = db.prepare("SELECT * FROM cdkeys WHERE id=?").get(created.json().id);
	assert.deepEqual(JSON.parse(decryptText(updatedOrder.session_payload)), {
		user: { email: originalEmail }, accessToken: "new-session"
	});
	assert.equal(updatedOrder.session_revision, 1);
	assert.equal(updatedFulfillment.state, "SESSION_RECOVERY_RECONCILING");
	assert.equal(updatedFulfillment.card_reservation_id, "reservation-immutable");
	assert.equal(updatedCdk.status, "locked");
	assert.equal(updatedCdk.locked_by_order_id, order.id);
	const audit = db.prepare(`SELECT detail FROM admin_audit_logs
	  WHERE action='membership.session.recovered' AND resource_id=? ORDER BY created_at DESC LIMIT 1`).get(updatedFulfillment.id);
	assert.deepEqual(JSON.parse(audit.detail), { orderNo: order.order_no, sessionRevision: 1 });
	assert.doesNotMatch(audit.detail, /session-recovery@example|new-session/i);
});

test("admin UI exposes locked membership credentials without money-operation controls", async () => {
  const { JSDOM } = await import("jsdom");
  const html = fs.readFileSync(path.resolve("admin", "index.html"), "utf8");
  const script = fs.readFileSync(path.resolve("admin", "app.js"), "utf8");
  const dom = new JSDOM(html);
  const panel = dom.window.document.querySelector('[data-panel="membership-fulfillment"]');
  assert.ok(dom.window.document.querySelector('[data-tab="membership-fulfillment"]'));
  assert.ok(panel);
  assert.ok(panel.querySelector("#membership-app-secret"));
  assert.ok(panel.querySelector("#membership-webhook-secret"));
  assert.ok(panel.querySelector("#membership-inventory-initialize"));
  assert.ok(panel.querySelector("#membership-inventory-refresh"));
  assert.ok(panel.querySelector("#membership-card-list-refresh"));
  assert.ok(panel.querySelector("#membership-fulfillment-list-refresh"));
  assert.ok(panel.querySelector("#membership-fulfillment-list"));
  assert.ok(panel.querySelector("#membership-fulfillment-detail"));
  assert.ok(panel.querySelector("#membership-price-contract-form"));
  assert.ok(panel.querySelector("#membership-product-policy-refresh"));
  assert.ok(panel.querySelector("#membership-no-charge-form"));
  assert.ok(panel.querySelector("#membership-circuit-refresh"));
  assert.equal(panel.querySelector('[data-action="open-card"], [data-action="recharge-card"], [data-action="delete-card"]'), null);
  assert.match(script, /\/api\/admin\/membership-fulfillment\/settings/);
  assert.match(script, /\/api\/admin\/membership-fulfillments/);
  assert.match(script, /\/api\/admin\/checkout-price-contracts/);
  assert.match(script, /\/api\/admin\/card-product-policies/);
  assert.match(script, /\/api\/admin\/checkout-validation-runs/);
  assert.match(script, /\/api\/admin\/fulfillment-circuits/);
  dom.window.close();
});
