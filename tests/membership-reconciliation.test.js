import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kawang-membership-reconcile-"));
process.env.DATABASE_PATH = path.join(tmpDir, "test.db");
process.env.JWT_SECRET = "membership-reconcile-secret";

const { getDb } = await import("../shared/src/database.js");
const {
  applyMembershipRenewalObservation,
  countMembershipUnresolvedOutcomes,
  createMembershipReconciliationRunner,
  reconcileMembershipPaymentStage,
  shouldCancelPartialMembershipRenewal
} = await import("../shared/src/membership-reconciliation.js");

const db = getDb();
after(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const at = "2026-07-16T00:00:00.000Z";

function observation(accountType, autoRenew = true, observedAt = at) {
  return {
    providerCode: 200,
    accountType,
    currency: accountType === "free" ? null : "PHP",
    autoRenew: accountType === "free" ? null : autoRenew,
    isOverdue: false,
    isDelinquent: false,
    expireTime: accountType === "free" ? null : "2026-08-16T00:00:00.000Z",
    expireTimeFuture: accountType !== "free",
    observedAt
  };
}

function seed(id, targetTier = "plus", key = "plus") {
  db.prepare(`
    INSERT INTO membership_fulfillments (
      id, order_id, order_no, target_tier, state, current_stage, run_mode,
      money_boundary_at, card_reservation_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'canary', ?, ?, ?, ?)
  `).run(
    id,
    `order-${id}`,
    `ORDER-${id}`,
    targetTier,
    key === "plus" ? "PLUS_RECONCILING" : "UPGRADE_RECONCILING",
    key,
    at,
    `reservation-${id}`,
    at,
    at
  );
  db.prepare(`
    INSERT INTO managed_cards (
      id, upstream_card_id, vm_card_id, product_code, upstream_status,
      cached_available_amount, lane, capacity_state, reconciliation_state,
      created_at, updated_at
    ) VALUES (?, ?, ?, 'OPENAI', 'ACTIVE', 50, ?, 'AVAILABLE', 'READY', ?, ?)
  `).run(`card-${id}`, Math.floor(Math.random() * 1_000_000_000) + 1, `vm-${id}`, targetTier, at, at);
  db.prepare(`
    INSERT INTO card_capacity_reservations (
      id, fulfillment_id, card_id, target_lane, slot_index, state, reserved_at
    ) VALUES (?, ?, ?, ?, 1, 'reserved', ?)
  `).run(`reservation-${id}`, id, `card-${id}`, targetTier, at);
  db.prepare(`
    INSERT INTO membership_payment_stages (
      id, fulfillment_id, stage_key, expected_tier, state, card_id,
      price_signal_min, price_signal_max, submit_permitted_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'reconciling', ?, 18, 25, ?, ?, ?)
  `).run(`stage-${id}`, id, key, key === "plus" ? "plus" : targetTier, `card-${id}`, at, at, at);
  db.prepare(`
    INSERT INTO membership_action_permits (
      id, fulfillment_id, stage_key, attempt_no, action_type, sequence_no,
      installation_id, browser_lease_epoch, adapter_version, price_contract_id,
      control_id, page_fingerprint, state, issued_at, expires_at
    ) VALUES (?, ?, ?, 1, 'submit', 1, 'install', 1, 'checkout-v1',
      'contract', 'payment-submit', ?, 'activated', ?, ?)
  `).run(`permit-${id}`, id, key, "a".repeat(64), at, "2026-07-16T00:05:00.000Z");
  db.prepare(`
    INSERT INTO membership_action_auth_snapshots (permit_id, card_id, auth_id, snapshotted_at)
    VALUES (?, ?, 'old-auth', ?)
  `).run(`permit-${id}`, `card-${id}`, at);
}

function seedOrder(id) {
  db.prepare(`
    INSERT INTO redeem_orders (
      id, order_no, cdkey_id, public_key, product_id, activation_endpoint_id,
      site_id, session_payload, session_preview, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'encrypted-session', '{}', 'processing', ?, ?)
  `).run(
    `order-${id}`,
    `ORDER-${id}`,
    `cdk-${id}`,
    `KEY-${id}`,
    `product-${id}`,
    `endpoint-${id}`,
    `site-${id}`,
    at,
    at
  );
}

function openAiAuth(authId, status = "COMPLETE", amount = 20) {
  return {
    authId,
    authTime: at,
    authAmount: amount,
    authCurrency: "USD",
    settleAmount: status === "COMPLETE" ? amount : 0,
    settleCurrency: status === "COMPLETE" ? "USD" : null,
    type: status === "COMPLETE" ? "Settlement" : "Authorization",
    status,
    merchantNormalized: "OPENAI"
  };
}

test("stage reconciliation requires exactly one new OpenAI auth plus strict membership", () => {
  seed("mf-plus");
  const result = reconcileMembershipPaymentStage(db, {
    fulfillmentId: "mf-plus",
    stageKey: "plus",
    transactions: [openAiAuth("old-auth"), openAiAuth("new-auth")],
    observation: observation("plus"),
    at
  });
  assert.deepEqual(result, {
    outcome: "confirmed",
    state: "FINAL_TIER_CONFIRMED",
    matchedAuthId: "new-auth",
    settlementState: "COMPLETE",
    observationId: result.observationId
  });
  assert.equal(db.prepare("SELECT state FROM card_capacity_reservations WHERE fulfillment_id = 'mf-plus'").get().state,
    "consumed");
});

test("zero or multiple transaction matches are uncertain and never resubmit", () => {
  seed("mf-many");
  const result = reconcileMembershipPaymentStage(db, {
    fulfillmentId: "mf-many",
    stageKey: "plus",
    transactions: [openAiAuth("new-one"), openAiAuth("new-two")],
    observation: observation("plus"),
    at
  });
  assert.equal(result.outcome, "uncertain");
  assert.equal(result.reason, "MULTIPLE_MATCHES");
  assert.equal(countMembershipUnresolvedOutcomes(db, "mf-many") > 0, true);
});

test("upgrade decline retains the paid target-lane slot as partial", () => {
  seed("mf-upgrade", "x5", "upgrade");
  const result = reconcileMembershipPaymentStage(db, {
    fulfillmentId: "mf-upgrade",
    stageKey: "upgrade",
    transactions: [openAiAuth("upgrade-decline", "DECLINED")],
    observation: observation("plus"),
    at
  });
  assert.equal(result.state, "PARTIALLY_FULFILLED");
  assert.equal(db.prepare("SELECT state FROM card_capacity_reservations WHERE fulfillment_id = 'mf-upgrade'").get().state,
    "retained_partial");
});

test("completion requires a subsequent auto-renew=false observation", () => {
  seed("mf-renewal");
  db.prepare("UPDATE membership_fulfillments SET state = 'FINAL_TIER_CONFIRMED' WHERE id = 'mf-renewal'").run();
  const waiting = applyMembershipRenewalObservation(db, {
    fulfillmentId: "mf-renewal",
    observation: observation("plus", true),
    at
  });
  assert.equal(waiting.state, "RENEWAL_CANCELLING");
  const complete = applyMembershipRenewalObservation(db, {
    fulfillmentId: "mf-renewal",
    observation: observation("plus", false, "2026-07-16T00:01:00.000Z"),
    at: "2026-07-16T00:01:00.000Z"
  });
  assert.equal(complete.state, "COMPLETED");
  assert.equal(complete.renewalDisabled, true);
});

test("partial Plus cancellation starts only in the final 72 hours", () => {
  assert.equal(shouldCancelPartialMembershipRenewal({
    ...observation("plus", true),
    expireTime: "2026-07-18T23:59:59.000Z"
  }, { at }), true);
  assert.equal(shouldCancelPartialMembershipRenewal({
    ...observation("plus", true),
    expireTime: "2026-07-20T00:00:01.000Z"
  }, { at }), false);
});

test("closed rollout gate still reconciles payment, protects renewal, and finishes after a fresh false observation", async () => {
  assert.deepEqual(db.prepare(`
    SELECT enabled, rollout_mode FROM membership_fulfillment_settings WHERE id = 'default'
  `).get(), { enabled: 0, rollout_mode: "disabled" });
  seed("mf-runner-reconcile");
  seedOrder("mf-runner-reconcile");
  let renewalDisabled = false;
  const runner = createMembershipReconciliationRunner({
    db,
    decryptText: () => JSON.stringify({ token: "session" }),
    clientFactory: () => ({
      async listTransactions() { return [openAiAuth("new-runner-auth")]; }
    }),
    membershipFetcher: async () => observation("plus", !renewalDisabled),
    cancelRenewal: async () => { renewalDisabled = true; return { providerConfirmed: true }; },
    getRenewalToken: async () => "renewal-token",
    now: () => new Date(at)
  });
  const paid = await runner.processFulfillment("mf-runner-reconcile");
  assert.equal(paid.state, "FINAL_TIER_CONFIRMED");
  const completed = await runner.processFulfillment("mf-runner-reconcile");
  assert.equal(completed.state, "COMPLETED");
  const finalObservation = db.prepare(`
    SELECT observation.auto_renew
    FROM membership_payment_stages stage
    JOIN membership_observations observation ON observation.id = stage.membership_observation_id
    WHERE stage.fulfillment_id = 'mf-runner-reconcile' AND stage.stage_key = 'plus'
  `).get();
  assert.equal(finalObservation.auto_renew, 0);
  assert.equal(countMembershipUnresolvedOutcomes(db, "mf-runner-reconcile"), 0);
});

test("reconciliation runner backs off a provider failure for five minutes", async () => {
  db.prepare("UPDATE membership_fulfillments SET state = 'PAYMENT_DECLINED'").run();
  seed("mf-provider-backoff");
  seedOrder("mf-provider-backoff");
  let clock = Date.parse(at);
  const runner = createMembershipReconciliationRunner({
    db,
    decryptText: () => JSON.stringify({ token: "session" }),
    clientFactory: () => ({
      async listTransactions() {
        const error = new Error("provider unavailable");
        error.code = "SPACEXCARD_UNAVAILABLE";
        throw error;
      }
    }),
    membershipFetcher: async () => observation("plus"),
    now: () => new Date(clock),
    logger: { warn() {} }
  });

  const failed = await runner.tick();
  assert.equal(failed.code, "SPACEXCARD_UNAVAILABLE");
  assert.equal(failed.outcome, "retry");
  assert.deepEqual(
    db.prepare("SELECT state, failure_code, retry_at FROM membership_fulfillments WHERE id = ?")
      .get("mf-provider-backoff"),
    {
      state: "PLUS_RECONCILING",
      failure_code: "SPACEXCARD_UNAVAILABLE",
      retry_at: "2026-07-16T00:05:00.000Z"
    }
  );

  clock += 5 * 60_000 - 1;
  assert.deepEqual(await runner.tick(), { processed: 0, reason: "idle" });
});

test("renewal cancellation failure creates one deduplicated intervention", async () => {
  db.prepare("UPDATE membership_fulfillments SET state = 'PAYMENT_DECLINED'").run();
  seed("mf-renewal-failure");
  seedOrder("mf-renewal-failure");
  db.prepare(`
    UPDATE membership_fulfillments
    SET state = 'FINAL_TIER_CONFIRMED', current_stage = 'renewal'
    WHERE id = 'mf-renewal-failure'
  `).run();
  let clock = Date.parse(at);
  const runner = createMembershipReconciliationRunner({
    db,
    decryptText: () => JSON.stringify({ token: "session" }),
    clientFactory: () => ({ async listTransactions() { return []; } }),
    membershipFetcher: async () => observation("plus", true),
    cancelRenewal: async () => {
      const error = new Error("renewal provider unavailable");
      error.code = "RENEWAL_CANCEL_FAILED";
      throw error;
    },
    getRenewalToken: async () => "renewal-token",
    now: () => new Date(clock),
    logger: { warn() {} }
  });

  const failed = await runner.tick();
  assert.equal(failed.code, "RENEWAL_CANCEL_FAILED");
  assert.deepEqual(
    db.prepare("SELECT state, failure_code, retry_at FROM membership_fulfillments WHERE id = ?")
      .get("mf-renewal-failure"),
    {
      state: "FINAL_TIER_CONFIRMED",
      failure_code: "RENEWAL_CANCEL_FAILED",
      retry_at: "2026-07-16T00:05:00.000Z"
    }
  );
  assert.deepEqual(
    db.prepare(`
      SELECT state, state_revision, reason_code, acknowledged_at
      FROM fulfillment_interventions WHERE fulfillment_id = ?
    `).get("mf-renewal-failure"),
    {
      state: "FINAL_TIER_CONFIRMED",
      state_revision: 0,
      reason_code: "RENEWAL_CANCEL_FAILED",
      acknowledged_at: null
    }
  );

  clock += 5 * 60_000;
  assert.equal((await runner.tick()).code, "RENEWAL_CANCEL_FAILED");
  assert.equal(db.prepare(`
    SELECT COUNT(*) AS count FROM fulfillment_interventions WHERE fulfillment_id = ?
  `).get("mf-renewal-failure").count, 1);
});
