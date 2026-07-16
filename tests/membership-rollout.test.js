import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Worker } from "node:worker_threads";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kawang-membership-rollout-"));
process.env.DATABASE_PATH = path.join(tmpDir, "test.db");
process.env.JWT_SECRET = "membership-rollout-test-secret";

const { getDb } = await import("../shared/src/database.js");
const {
  MembershipRolloutError,
  approveLiveCanaryStage,
  automaticCheckoutDefaultDailyOrderLimit,
  consumeLiveCanaryAuthorization,
  createAutomaticCheckoutScope,
  expireLiveCanaryAuthorizations,
  liveCanaryAuthorizationTtlMs,
  pauseStaleAutomaticCheckoutScopes,
  qualifyTierRollout,
  releaseAutomaticCheckoutDailyRisk,
  requiredCanaryStages,
  reserveAutomaticCheckoutDailyRisk,
  reviseAutomaticCheckoutScope,
  verifyFreshAdminCredentials
} = await import("../shared/src/membership-rollout.js");

const db = getDb();
const expectedAdmin = Object.freeze({ username: "admin", password: "test-password" });
const credentials = () => ({ username: "admin", password: "test-password" });
const baseAt = "2026-07-16T00:00:00.000Z";
let upstreamCardId = 90_000;

after(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function fingerprint(value) {
  return createHash("sha256").update(value).digest("hex");
}

function insertProduct(id, tier) {
  db.prepare(`
    INSERT OR IGNORE INTO products (
      id, code, title, membership_tier, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'active', ?, ?)
  `).run(id, id.toUpperCase(), id, tier, baseAt, baseAt);
}

function insertSite(id) {
  db.prepare(`
    INSERT OR IGNORE INTO sites (id, name, slug, status, created_at, updated_at)
    VALUES (?, ?, ?, 'active', ?, ?)
  `).run(id, id, id, baseAt, baseAt);
}

function insertContract(id, tier, version) {
  db.prepare(`
    INSERT INTO checkout_price_contracts (
      id, tier, version, currency, min_amount, max_amount, status,
      created_at, created_by, activated_at
    ) VALUES (?, ?, ?, 'PHP', 900, 99999, 'active', ?, 'admin', ?)
  `).run(id, tier, version, baseAt, baseAt);
}

function createFulfillment(id, tier, options = {}) {
  const productId = options.productId || `product-${tier}`;
  const siteId = options.siteId || "site-rollout";
  const orderId = `order-${id}`;
  const cardId = `card-${id}`;
  const reservationId = `reservation-${id}`;
  const createdAt = options.createdAt || baseAt;
  insertProduct(productId, tier);
  insertSite(siteId);
  db.prepare(`
    INSERT INTO redeem_orders (
      id, order_no, cdkey_id, public_key, product_id, activation_endpoint_id,
      site_id, session_payload, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'endpoint-rollout', ?, '{}', 'processing', ?, ?)
  `).run(orderId, `KW-${id}`, `cdkey-${id}`, `KEY-${id}`, productId, siteId, createdAt, createdAt);
  db.prepare(`
    INSERT INTO managed_cards (
      id, upstream_card_id, vm_card_id, product_code, last4, upstream_status,
      cached_available_amount, lane, capacity_state, reconciliation_state,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, '1234', 'ACTIVE', 500, ?, 'AVAILABLE', 'READY', ?, ?)
  `).run(cardId, upstreamCardId++, `vm-${id}`, `CARD-${tier}`, tier, createdAt, createdAt);
  db.prepare(`
    INSERT INTO card_capacity_reservations (
      id, fulfillment_id, card_id, target_lane, slot_index, state, reserved_at
    ) VALUES (?, ?, ?, ?, 1, 'reserved', ?)
  `).run(reservationId, id, cardId, tier, createdAt);
  db.prepare(`
    INSERT INTO membership_fulfillments (
      id, order_id, order_no, target_tier, state, current_stage, run_mode,
      resume_revision, state_revision, card_reservation_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?)
  `).run(
    id,
    orderId,
    `KW-${id}`,
    tier,
    options.state || "PLUS_APPROVAL_WAIT",
    options.stage || "plus",
    options.runMode ?? null,
    reservationId,
    createdAt,
    createdAt
  );
  return { id, orderId, productId, siteId, cardId, reservationId };
}

function addAttempt(fulfillmentId, stage, contractVersion, options = {}) {
  const attemptNo = options.attemptNo || 1;
  db.prepare(`
    INSERT INTO membership_fulfillment_attempts (
      id, fulfillment_id, stage, attempt_no, resume_revision, adapter_version,
      price_contract_version, started_at, ended_at, outcome_code
    ) VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?)
  `).run(
    `attempt-${fulfillmentId}-${stage}-${attemptNo}`,
    fulfillmentId,
    stage,
    attemptNo,
    options.adapterVersion || "checkout-v1",
    contractVersion,
    options.startedAt || baseAt,
    options.endedAt || null,
    options.outcomeCode || null
  );
}

function approveAndConsume(fulfillment, stageKey, contractId, fundingBudgetUsd, options = {}) {
  const snapshotFingerprint = fingerprint(`${fulfillment.id}:${stageKey}:${options.fingerprintSuffix || "v1"}`);
  const approvedAt = options.approvedAt || baseAt;
  const authorization = approveLiveCanaryStage(db, {
    id: options.id,
    fulfillmentId: fulfillment.id,
    stageKey,
    cardId: fulfillment.cardId,
    fundingBudgetUsd,
    priceContractId: contractId,
    adapterVersion: options.adapterVersion || "checkout-v1",
    snapshotFingerprint,
    approvedAt,
    credentials: credentials()
  }, expectedAdmin);
  const consumed = consumeLiveCanaryAuthorization(db, {
    authorizationId: authorization.id,
    fulfillmentId: fulfillment.id,
    stageKey,
    cardId: fulfillment.cardId,
    fundingBudgetUsd,
    priceContractId: contractId,
    adapterVersion: options.adapterVersion || "checkout-v1",
    snapshotFingerprint,
    at: options.consumedAt || new Date(Date.parse(approvedAt) + 60_000).toISOString()
  });
  return { authorization, consumed, snapshotFingerprint };
}

function insertSettledStageEvidence(fulfillment, stageKey, expectedTier, options = {}) {
  const authId = `auth-${fulfillment.id}-${stageKey}`;
  const observationId = `observation-${fulfillment.id}-${stageKey}`;
  const observedTier = options.observedTier || expectedTier;
  db.prepare(`
    INSERT INTO membership_observations (
      id, fulfillment_id, stage_key, purpose, provider_code, account_type,
      currency, auto_renew, is_overdue, is_delinquent, expire_time, observed_at
    ) VALUES (?, ?, ?, 'stage_confirmation', 200, ?, 'PHP', ?, 0, 0, ?, ?)
  `).run(
    observationId,
    fulfillment.id,
    stageKey,
    observedTier,
    options.autoRenew === undefined ? 0 : options.autoRenew,
    "2026-08-16T00:00:00.000Z",
    "2026-07-16T01:00:00.000Z"
  );
  db.prepare(`
    INSERT INTO managed_card_transactions (
      card_id, auth_id, auth_time, auth_amount, auth_currency, settle_amount,
      settle_currency, type, status, merchant_normalized, authorization_seen,
      settlement_seen, refund_seen, reversal_seen, first_seen_at, last_seen_at
    ) VALUES (?, ?, ?, 10, 'USD', 10, 'USD', 'Settlement', ?, 'openai', 1, ?, ?, ?, ?, ?)
  `).run(
    fulfillment.cardId,
    authId,
    baseAt,
    options.transactionStatus || "COMPLETE",
    options.settlementSeen === undefined ? 1 : options.settlementSeen,
    options.refundSeen || 0,
    options.reversalSeen || 0,
    baseAt,
    baseAt
  );
  db.prepare(`
    INSERT INTO membership_payment_stages (
      id, fulfillment_id, stage_key, expected_tier, state, card_id,
      matched_auth_id, settlement_state, membership_observation_id,
      confirmed_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'confirmed', ?, ?, ?, ?, ?, ?, ?)
  `).run(
    `stage-${fulfillment.id}-${stageKey}`,
    fulfillment.id,
    stageKey,
    expectedTier,
    fulfillment.cardId,
    authId,
    options.settlementState || "COMPLETE",
    observationId,
    "2026-07-16T01:00:00.000Z",
    baseAt,
    baseAt
  );
}

function finishCanary(fulfillment, tier) {
  db.prepare(`
    UPDATE membership_fulfillment_attempts
    SET ended_at = ?, outcome_code = 'CONFIRMED'
    WHERE fulfillment_id = ? AND ended_at IS NULL
  `).run("2026-07-16T01:00:00.000Z", fulfillment.id);
  for (const stageKey of requiredCanaryStages(tier)) {
    const expectedTier = stageKey === "plus" ? "plus" : tier;
    insertSettledStageEvidence(fulfillment, stageKey, expectedTier);
  }
  db.prepare(`
    UPDATE membership_fulfillments
    SET state = 'COMPLETED', current_stage = 'renewal', completed_at = ?, updated_at = ?
    WHERE id = ?
  `).run("2026-07-16T01:10:00.000Z", "2026-07-16T01:10:00.000Z", fulfillment.id);
}

function expectCode(fn, code) {
  assert.throws(fn, (error) => error instanceof MembershipRolloutError && error.code === code);
}

test("fresh admin verification is constant-time-comparison based and never persists or echoes passwords", () => {
  const verified = verifyFreshAdminCredentials(credentials(), expectedAdmin);
  assert.deepEqual(verified, { verified: true, actor: "admin" });
  assert.doesNotMatch(JSON.stringify(verified), /test-password/);
  expectCode(() => verifyFreshAdminCredentials({
    username: "admin",
    password: "wrong"
  }, expectedAdmin), "FRESH_ADMIN_AUTH_FAILED");
  const source = fs.readFileSync(new URL("../shared/src/membership-rollout.js", import.meta.url), "utf8");
  assert.match(source, /timingSafeEqual/);
});

test("live canary authorization is an immutable single-stage snapshot, single-use, and expires at 15 minutes", () => {
  insertContract("contract-plus-v1", "plus", 1);
  const fulfillment = createFulfillment("mf-canary-expiry", "plus");
  addAttempt(fulfillment.id, "plus", 1);
  const pageFingerprint = fingerprint("expiry-page");
  const authorization = approveLiveCanaryStage(db, {
    id: "canary-expiry",
    fulfillmentId: fulfillment.id,
    stageKey: "plus",
    cardId: fulfillment.cardId,
    fundingBudgetUsd: 16.44,
    priceContractId: "contract-plus-v1",
    adapterVersion: "checkout-v1",
    snapshotFingerprint: pageFingerprint,
    approvedAt: baseAt,
    credentials: credentials()
  }, expectedAdmin);
  assert.equal(authorization.expiresAt, "2026-07-16T00:15:00.000Z");
  assert.equal(authorization.snapshotBound, true);
  assert.doesNotMatch(JSON.stringify(authorization), new RegExp(pageFingerprint));
  const immutableBefore = db.prepare(`
    SELECT fulfillment_id, stage_key, target_tier, card_id, funding_budget,
           price_contract_id, adapter_version, snapshot_fingerprint, approved_by, approved_at
    FROM live_canary_authorizations WHERE id = 'canary-expiry'
  `).get();
  expectCode(() => consumeLiveCanaryAuthorization(db, {
    authorizationId: authorization.id,
    fulfillmentId: fulfillment.id,
    stageKey: "plus",
    cardId: fulfillment.cardId,
    fundingBudgetUsd: 16.44,
    priceContractId: "contract-plus-v1",
    adapterVersion: "checkout-v1",
    snapshotFingerprint: pageFingerprint,
    at: new Date(Date.parse(baseAt) + liveCanaryAuthorizationTtlMs).toISOString()
  }), "CANARY_AUTHORIZATION_EXPIRED");
  const immutableAfter = db.prepare(`
    SELECT fulfillment_id, stage_key, target_tier, card_id, funding_budget,
           price_contract_id, adapter_version, snapshot_fingerprint, approved_by, approved_at
    FROM live_canary_authorizations WHERE id = 'canary-expiry'
  `).get();
  assert.deepEqual(immutableAfter, immutableBefore);
  assert.equal(
    db.prepare("SELECT state FROM live_canary_authorizations WHERE id = 'canary-expiry'").get().state,
    "expired"
  );

  const second = createFulfillment("mf-canary-once", "plus");
  addAttempt(second.id, "plus", 1);
  const consumed = approveAndConsume(second, "plus", "contract-plus-v1", 16.44, {
    id: "canary-once"
  });
  assert.equal(consumed.consumed.state, "consumed");
  expectCode(() => consumeLiveCanaryAuthorization(db, {
    authorizationId: consumed.authorization.id,
    fulfillmentId: second.id,
    stageKey: "plus",
    cardId: second.cardId,
    fundingBudgetUsd: 16.44,
    priceContractId: "contract-plus-v1",
    adapterVersion: "checkout-v1",
    snapshotFingerprint: consumed.snapshotFingerprint,
    at: "2026-07-16T00:02:00.000Z"
  }), "CANARY_AUTHORIZATION_ALREADY_CONSUMED");
  assert.equal(expireLiveCanaryAuthorizations(db, { at: "2026-07-16T02:00:00.000Z" }).expiredCount, 0);
});

test("qualification fails closed unless settlement, exact tier, renewal, and unresolved evidence are all strict", () => {
  const fulfillment = db.prepare("SELECT id FROM membership_fulfillments WHERE id = 'mf-canary-once'").get();
  const facts = {
    id: fulfillment.id,
    cardId: "card-mf-canary-once"
  };
  finishCanary(facts, "plus");
  const input = {
    id: "qualification-plus-v1",
    fulfillmentId: facts.id,
    tier: "plus",
    adapterVersion: "checkout-v1",
    adapterPath: "initial-plus",
    priceContractId: "contract-plus-v1",
    qualifiedAt: "2026-07-16T02:00:00.000Z"
  };
  expectCode(() => qualifyTierRollout(db, input), "ROLLOUT_OUTCOME_UNRESOLVED");
  expectCode(() => qualifyTierRollout(db, {
    ...input,
    unresolvedOutcomeCount: 1
  }), "ROLLOUT_OUTCOME_UNRESOLVED");
  db.prepare(`
    UPDATE membership_observations SET auto_renew = 1
    WHERE id = 'observation-mf-canary-once-plus'
  `).run();
  expectCode(() => qualifyTierRollout(db, {
    ...input,
    unresolvedOutcomeCount: 0
  }), "ROLLOUT_MEMBERSHIP_NOT_STRICT");
  db.prepare(`
    UPDATE membership_observations SET auto_renew = 0
    WHERE id = 'observation-mf-canary-once-plus'
  `).run();
  db.prepare(`
    UPDATE membership_observations SET account_type = 'x5'
    WHERE id = 'observation-mf-canary-once-plus'
  `).run();
  expectCode(() => qualifyTierRollout(db, {
    ...input,
    unresolvedOutcomeCount: 0
  }), "ROLLOUT_MEMBERSHIP_NOT_STRICT");
  db.prepare(`
    UPDATE membership_observations SET account_type = 'plus'
    WHERE id = 'observation-mf-canary-once-plus'
  `).run();
  db.prepare(`
    UPDATE managed_card_transactions SET status = 'PENDING', settlement_seen = 0
    WHERE card_id = ? AND auth_id = 'auth-mf-canary-once-plus'
  `).run(facts.cardId);
  expectCode(() => qualifyTierRollout(db, {
    ...input,
    unresolvedOutcomeCount: 0
  }), "ROLLOUT_TRANSACTION_UNRESOLVED");
  db.prepare(`
    UPDATE managed_card_transactions SET status = 'COMPLETE', settlement_seen = 1
    WHERE card_id = ? AND auth_id = 'auth-mf-canary-once-plus'
  `).run(facts.cardId);
  const qualification = qualifyTierRollout(db, {
    ...input,
    unresolvedOutcomeCount: 0
  });
  assert.equal(qualification.settlement, "COMPLETE");
  assert.equal(qualification.exactMembershipConfirmed, true);
  assert.equal(qualification.autoRenewDisabled, true);
  assert.equal(qualification.unresolvedOutcomeCount, 0);
  assert.equal(qualification.priceContractVersion, 1);
});

test("rollout order is Plus then x5 then x20, with separate Plus and upgrade approvals for both upgrades", () => {
  insertContract("contract-x5-v1", "x5", 1);
  insertContract("contract-x20-v1", "x20", 1);

  const prematureX20 = createFulfillment("mf-x20-premature", "x20");
  addAttempt(prematureX20.id, "plus", 1);
  expectCode(() => approveLiveCanaryStage(db, {
    fulfillmentId: prematureX20.id,
    stageKey: "plus",
    cardId: prematureX20.cardId,
    fundingBudgetUsd: 16.44,
    priceContractId: "contract-plus-v1",
    adapterVersion: "checkout-v1",
    snapshotFingerprint: fingerprint("premature-x20"),
    credentials: credentials()
  }, expectedAdmin), "ROLLOUT_QUALIFICATION_ORDER_REQUIRED");

  const x5 = createFulfillment("mf-x5-canary", "x5");
  addAttempt(x5.id, "plus", 1);
  const x5Plus = approveAndConsume(x5, "plus", "contract-plus-v1", 16.44, { id: "x5-plus-approval" });
  db.prepare(`
    UPDATE membership_fulfillment_attempts SET ended_at = ?, outcome_code = 'CONFIRMED'
    WHERE fulfillment_id = ? AND stage = 'plus'
  `).run("2026-07-16T00:03:00.000Z", x5.id);
  db.prepare(`
    UPDATE membership_fulfillments
    SET state = 'UPGRADE_APPROVAL_WAIT', current_stage = 'upgrade', updated_at = ? WHERE id = ?
  `).run("2026-07-16T00:04:00.000Z", x5.id);
  addAttempt(x5.id, "upgrade", 1, { startedAt: "2026-07-16T00:04:00.000Z" });
  const x5Upgrade = approveAndConsume(x5, "upgrade", "contract-x5-v1", 99.2, {
    id: "x5-upgrade-approval",
    approvedAt: "2026-07-16T00:04:00.000Z",
    consumedAt: "2026-07-16T00:05:00.000Z"
  });
  assert.notEqual(x5Plus.authorization.id, x5Upgrade.authorization.id);
  assert.deepEqual(requiredCanaryStages("x5"), ["plus", "upgrade"]);
  finishCanary(x5, "x5");
  const x5Qualification = qualifyTierRollout(db, {
    fulfillmentId: x5.id,
    tier: "x5",
    adapterVersion: "checkout-v1",
    adapterPath: "plan-management-x5",
    priceContractId: "contract-x5-v1",
    unresolvedOutcomeCount: 0,
    qualifiedAt: "2026-07-16T02:10:00.000Z"
  });
  assert.equal(x5Qualification.tier, "x5");

  const x20 = createFulfillment("mf-x20-canary", "x20");
  addAttempt(x20.id, "plus", 1);
  const x20Plus = approveAndConsume(x20, "plus", "contract-plus-v1", 16.44, {
    id: "x20-plus-approval"
  });
  db.prepare(`
    UPDATE membership_fulfillment_attempts SET ended_at = ?, outcome_code = 'CONFIRMED'
    WHERE fulfillment_id = ? AND stage = 'plus'
  `).run("2026-07-16T00:03:00.000Z", x20.id);
  db.prepare(`
    UPDATE membership_fulfillments
    SET state = 'UPGRADE_APPROVAL_WAIT', current_stage = 'upgrade', updated_at = ? WHERE id = ?
  `).run("2026-07-16T00:04:00.000Z", x20.id);
  addAttempt(x20.id, "upgrade", 1, { startedAt: "2026-07-16T00:04:00.000Z" });
  const x20Upgrade = approveAndConsume(x20, "upgrade", "contract-x20-v1", 199.2, {
    id: "x20-upgrade-approval",
    approvedAt: "2026-07-16T00:04:00.000Z",
    consumedAt: "2026-07-16T00:05:00.000Z"
  });
  assert.notEqual(x20Plus.authorization.id, x20Upgrade.authorization.id);
  assert.deepEqual(requiredCanaryStages("x20"), ["plus", "upgrade"]);
});

test("exact automatic scopes default to one order, revise limits freshly, pause on version drift, and reserve full daily risk once", () => {
  const siteId = "site-rollout";
  const productId = "product-plus";
  expectCode(() => createAutomaticCheckoutScope(db, {
    siteId,
    productId,
    tier: "plus",
    adapterVersion: "checkout-v1",
    priceContractId: "contract-plus-v1",
    dailyRiskLimitUsd: 25,
    dailyOrderLimit: 2,
    credentials: credentials()
  }, expectedAdmin), "AUTOMATIC_SCOPE_INITIAL_LIMIT_INVALID");
  expectCode(() => createAutomaticCheckoutScope(db, {
    siteId,
    productId,
    tier: "plus",
    adapterVersion: "checkout-v1",
    priceContractId: "contract-plus-v1",
    dailyRiskLimitUsd: 25,
    credentials: { username: "admin", password: "wrong" }
  }, expectedAdmin), "FRESH_ADMIN_AUTH_FAILED");

  const scope = createAutomaticCheckoutScope(db, {
    id: "scope-plus-v1-r1",
    siteId,
    productId,
    tier: "plus",
    adapterVersion: "checkout-v1",
    priceContractId: "contract-plus-v1",
    dailyRiskLimitUsd: 25,
    activatedAt: "2026-07-16T03:00:00.000Z",
    credentials: credentials()
  }, expectedAdmin);
  assert.equal(scope.dailyOrderLimit, automaticCheckoutDefaultDailyOrderLimit);
  assert.equal(scope.priceContractVersion, 1);
  assert.doesNotMatch(JSON.stringify(scope), /test-password/);

  const first = createFulfillment("mf-auto-first", "plus", {
    state: "FUNDING_READY",
    productId,
    siteId,
    createdAt: "2026-07-16T03:01:00.000Z"
  });
  const second = createFulfillment("mf-auto-second", "plus", {
    state: "FUNDING_READY",
    productId,
    siteId,
    createdAt: "2026-07-16T03:02:00.000Z"
  });
  const reserved = reserveAutomaticCheckoutDailyRisk(db, {
    fulfillmentId: first.id,
    scopeId: scope.id,
    adapterVersion: "checkout-v1",
    priceContractId: "contract-plus-v1",
    fullPaymentBudgetUsd: 16.44,
    providerFeeUsd: 0.3,
    at: "2026-07-16T04:00:00.000Z"
  });
  assert.equal(reserved.orderRiskUsd, 16.74);
  assert.equal(reserved.dailyOrderUnits, 1);
  assert.equal(reserved.crossedMoneyBoundary, false);
  assert.equal(
    db.prepare("SELECT money_boundary_at FROM membership_fulfillments WHERE id = ?").get(first.id).money_boundary_at,
    null
  );
  assert.equal(
    db.prepare("SELECT state FROM automatic_checkout_quota_reservations WHERE fulfillment_id = ?").get(first.id).state,
    "reserved"
  );
  const retry = reserveAutomaticCheckoutDailyRisk(db, {
    fulfillmentId: first.id,
    scopeId: scope.id,
    adapterVersion: "checkout-v1",
    priceContractId: "contract-plus-v1",
    fullPaymentBudgetUsd: 16.44,
    providerFeeUsd: 0.3,
    at: "2026-07-16T04:01:00.000Z"
  });
  assert.equal(retry.alreadyReserved, true);
  assert.equal(retry.reservationId, reserved.reservationId);
  assert.equal(retry.businessDate, reserved.businessDate);
  expectCode(() => reserveAutomaticCheckoutDailyRisk(db, {
    fulfillmentId: first.id,
    scopeId: scope.id,
    adapterVersion: "checkout-v1",
    priceContractId: "contract-plus-v1",
    fullPaymentBudgetUsd: 16.45,
    providerFeeUsd: 0.3,
    at: "2026-07-16T04:01:30.000Z"
  }), "AUTOMATIC_QUOTA_RESERVATION_CONFLICT");
  assert.equal(
    db.prepare("SELECT order_units FROM automatic_checkout_daily_usage WHERE scope_id = ?").get(scope.id).order_units,
    1
  );
  expectCode(() => reserveAutomaticCheckoutDailyRisk(db, {
    fulfillmentId: second.id,
    scopeId: scope.id,
    adapterVersion: "checkout-v1",
    priceContractId: "contract-plus-v1",
    fullPaymentBudgetUsd: 16.44,
    providerFeeUsd: 0.3,
    at: "2026-07-16T04:02:00.000Z"
  }), "AUTOMATIC_SCOPE_DAILY_ORDER_LIMIT");

  const revision = reviseAutomaticCheckoutScope(db, {
    id: "scope-plus-v1-r2",
    previousScopeId: scope.id,
    dailyOrderLimit: 2,
    dailyRiskLimitUsd: 30,
    activatedAt: "2026-07-16T05:00:00.000Z",
    credentials: credentials()
  }, expectedAdmin);
  assert.equal(revision.revision, 2);
  assert.equal(revision.dailyOrderLimit, 2);
  assert.equal(
    db.prepare("SELECT status FROM automatic_checkout_scopes WHERE id = ?").get(scope.id).status,
    "paused"
  );
  expectCode(() => reserveAutomaticCheckoutDailyRisk(db, {
    fulfillmentId: first.id,
    scopeId: revision.id,
    adapterVersion: "checkout-v1",
    priceContractId: "contract-plus-v1",
    fullPaymentBudgetUsd: 16.44,
    providerFeeUsd: 0.3,
    at: "2026-07-16T05:01:00.000Z"
  }), "AUTOMATIC_QUOTA_RESERVATION_CONFLICT");
  expectCode(() => releaseAutomaticCheckoutDailyRisk(db, {
    fulfillmentId: first.id,
    scopeId: scope.id,
    at: "2026-07-16T05:02:00.000Z"
  }), "AUTOMATIC_QUOTA_RELEASE_EVIDENCE_REQUIRED");
  const noPaymentEvidence = {
    kind: "NO_PAYMENT_BEFORE_MONEY_BOUNDARY",
    membershipUnchanged: true,
    noEffectiveTransaction: true,
    noPendingAuthorization: true
  };
  const released = releaseAutomaticCheckoutDailyRisk(db, {
    fulfillmentId: first.id,
    scopeId: scope.id,
    evidence: noPaymentEvidence,
    at: "2026-07-16T05:02:00.000Z"
  });
  assert.equal(released.state, "released");
  assert.equal(released.noPaymentEvidenceAccepted, true);
  assert.equal(db.prepare(`
    SELECT order_units FROM automatic_checkout_daily_usage WHERE scope_id = ?
  `).get(scope.id).order_units, 0);
  assert.equal(releaseAutomaticCheckoutDailyRisk(db, {
    fulfillmentId: first.id,
    scopeId: scope.id,
    evidence: noPaymentEvidence,
    at: "2026-07-16T05:03:00.000Z"
  }).alreadyReleased, true);
  expectCode(() => reserveAutomaticCheckoutDailyRisk(db, {
    fulfillmentId: first.id,
    scopeId: scope.id,
    adapterVersion: "checkout-v1",
    priceContractId: "contract-plus-v1",
    fullPaymentBudgetUsd: 16.44,
    providerFeeUsd: 0.3,
    at: "2026-07-16T05:04:00.000Z"
  }), "AUTOMATIC_QUOTA_ALREADY_RELEASED");

  const beforeMidnight = createFulfillment("mf-auto-before-midnight", "plus", {
    state: "FUNDING_READY", productId, siteId, createdAt: "2026-07-16T05:01:00.000Z"
  });
  const afterMidnight = createFulfillment("mf-auto-after-midnight", "plus", {
    state: "FUNDING_READY", productId, siteId, createdAt: "2026-07-16T05:02:00.000Z"
  });
  const riskLimited = createFulfillment("mf-auto-risk-limited", "plus", {
    state: "FUNDING_READY", productId, siteId, createdAt: "2026-07-16T05:03:00.000Z"
  });
  const before = reserveAutomaticCheckoutDailyRisk(db, {
    fulfillmentId: beforeMidnight.id,
    scopeId: revision.id,
    adapterVersion: "checkout-v1",
    priceContractId: "contract-plus-v1",
    fullPaymentBudgetUsd: 16.44,
    providerFeeUsd: 0.3,
    at: "2026-07-16T15:59:00.000Z"
  });
  const after = reserveAutomaticCheckoutDailyRisk(db, {
    fulfillmentId: afterMidnight.id,
    scopeId: revision.id,
    adapterVersion: "checkout-v1",
    priceContractId: "contract-plus-v1",
    fullPaymentBudgetUsd: 16.44,
    providerFeeUsd: 0.3,
    at: "2026-07-16T16:00:00.000Z"
  });
  assert.equal(before.businessDate, "2026-07-16");
  assert.equal(after.businessDate, "2026-07-17");
  expectCode(() => reserveAutomaticCheckoutDailyRisk(db, {
    fulfillmentId: riskLimited.id,
    scopeId: revision.id,
    adapterVersion: "checkout-v1",
    priceContractId: "contract-plus-v1",
    fullPaymentBudgetUsd: 16.44,
    providerFeeUsd: 0.3,
    at: "2026-07-16T16:01:00.000Z"
  }), "AUTOMATIC_SCOPE_DAILY_RISK_LIMIT");

  const usageBeforePause = db.prepare(`
    SELECT SUM(order_units) AS orders, SUM(risk_reserved_usd) AS risk
    FROM automatic_checkout_daily_usage WHERE scope_id = ?
  `).get(revision.id);
  const paused = pauseStaleAutomaticCheckoutScopes(db, {
    siteId,
    productId,
    tier: "plus",
    adapterVersion: "checkout-v2",
    priceContractId: "contract-plus-v1",
    at: "2026-07-16T16:02:00.000Z"
  });
  assert.equal(paused.pausedCount, 1);
  assert.equal(paused.scopes[0].status, "paused");
  assert.deepEqual(db.prepare(`
    SELECT SUM(order_units) AS orders, SUM(risk_reserved_usd) AS risk
    FROM automatic_checkout_daily_usage WHERE scope_id = ?
  `).get(revision.id), usageBeforePause);
  expectCode(() => reserveAutomaticCheckoutDailyRisk(db, {
    fulfillmentId: beforeMidnight.id,
    scopeId: revision.id,
    adapterVersion: "checkout-v2",
    priceContractId: "contract-plus-v1",
    fullPaymentBudgetUsd: 16.44,
    providerFeeUsd: 0.3,
    at: "2026-07-16T16:02:30.000Z"
  }), "AUTOMATIC_SCOPE_VERSION_STALE");
  db.prepare(`
    UPDATE membership_fulfillments SET money_boundary_at = ?, updated_at = ? WHERE id = ?
  `).run("2026-07-16T16:00:30.000Z", "2026-07-16T16:00:30.000Z", afterMidnight.id);
  const moneyBearingRetry = reserveAutomaticCheckoutDailyRisk(db, {
    fulfillmentId: afterMidnight.id,
    scopeId: revision.id,
    adapterVersion: "checkout-v2",
    priceContractId: "contract-plus-v1",
    fullPaymentBudgetUsd: 16.44,
    providerFeeUsd: 0.3,
    at: "2026-07-16T16:03:00.000Z"
  });
  assert.equal(moneyBearingRetry.alreadyReserved, true);
  assert.equal(moneyBearingRetry.crossedMoneyBoundary, true);
  assert.equal(moneyBearingRetry.scopePausedForVersionChange, true);
  expectCode(() => releaseAutomaticCheckoutDailyRisk(db, {
    fulfillmentId: afterMidnight.id,
    scopeId: revision.id,
    evidence: noPaymentEvidence,
    at: "2026-07-16T16:04:00.000Z"
  }), "AUTOMATIC_QUOTA_MONEY_BOUNDARY_CROSSED");
  assert.deepEqual(db.prepare(`
    SELECT SUM(order_units) AS orders, SUM(risk_reserved_usd) AS risk
    FROM automatic_checkout_daily_usage WHERE scope_id = ?
  `).get(revision.id), usageBeforePause);

  const persisted = JSON.stringify({
    canaries: db.prepare("SELECT * FROM live_canary_authorizations").all(),
    qualifications: db.prepare("SELECT * FROM tier_rollout_qualifications").all(),
    scopes: db.prepare("SELECT * FROM automatic_checkout_scopes").all(),
    usage: db.prepare("SELECT * FROM automatic_checkout_daily_usage").all(),
    quotaReservations: db.prepare("SELECT * FROM automatic_checkout_quota_reservations").all()
  });
  assert.doesNotMatch(persisted, /test-password/);
});

test("two SQLite writers atomically share the scope order and full-risk budgets", async () => {
  const scope = createAutomaticCheckoutScope(db, {
    id: "scope-x5-v1-r1",
    siteId: "site-rollout",
    productId: "product-x5",
    tier: "x5",
    adapterVersion: "checkout-v1",
    priceContractId: "contract-x5-v1",
    dailyRiskLimitUsd: 200,
    activatedAt: "2026-07-17T00:00:00.000Z",
    credentials: credentials()
  }, expectedAdmin);
  const first = createFulfillment("mf-x5-race-a", "x5", {
    state: "FUNDING_READY",
    createdAt: "2026-07-17T00:01:00.000Z"
  });
  const second = createFulfillment("mf-x5-race-b", "x5", {
    state: "FUNDING_READY",
    createdAt: "2026-07-17T00:02:00.000Z"
  });
  const moduleUrl = new URL("../shared/src/membership-rollout.js", import.meta.url).href;
  const workerSource = `
    const { parentPort, workerData } = require("node:worker_threads");
    const Database = require("better-sqlite3");
    (async () => {
      const { reserveAutomaticCheckoutDailyRisk } = await import(workerData.moduleUrl);
      const connection = new Database(workerData.databasePath);
      connection.pragma("busy_timeout = 5000");
      const ready = Atomics.add(workerData.start, 0, 1) + 1;
      if (ready === 2) Atomics.notify(workerData.start, 0);
      else Atomics.wait(workerData.start, 0, 1, 5000);
      try {
        const value = reserveAutomaticCheckoutDailyRisk(connection, workerData.input);
        parentPort.postMessage({ ok: true, value });
      } catch (error) {
        parentPort.postMessage({ ok: false, code: error.code || error.name });
      } finally {
        connection.close();
      }
    })();
  `;
  const start = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));
  const run = (fulfillmentId) => new Promise((resolve, reject) => {
    let result;
    const worker = new Worker(workerSource, {
      eval: true,
      workerData: {
        moduleUrl,
        databasePath: process.env.DATABASE_PATH,
        start,
        input: {
          fulfillmentId,
          scopeId: scope.id,
          adapterVersion: "checkout-v1",
          priceContractId: "contract-x5-v1",
          fullPaymentBudgetUsd: 115.64,
          providerFeeUsd: 0.5,
          at: "2026-07-17T01:00:00.000Z"
        }
      }
    });
    worker.once("message", (message) => { result = message; });
    worker.once("error", reject);
    worker.once("exit", (code) => {
      if (code !== 0) reject(new Error(`rollout quota worker exited with ${code}`));
      else resolve(result);
    });
  });
  const results = await Promise.all([run(first.id), run(second.id)]);
  assert.equal(results.filter((result) => result.ok).length, 1);
  assert.deepEqual(
    results.filter((result) => !result.ok).map((result) => result.code),
    ["AUTOMATIC_SCOPE_DAILY_ORDER_LIMIT"]
  );
  assert.deepEqual(db.prepare(`
    SELECT order_units, risk_reserved_usd FROM automatic_checkout_daily_usage
    WHERE scope_id = ? AND business_date = '2026-07-17'
  `).get(scope.id), { order_units: 1, risk_reserved_usd: 116.14 });
  assert.equal(db.prepare(`
    SELECT COUNT(*) AS count FROM automatic_checkout_quota_reservations WHERE scope_id = ?
  `).get(scope.id).count, 1);
});
