import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Worker } from "node:worker_threads";
import Database from "better-sqlite3";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kawang-membership-funding-"));
const databasePath = path.join(tmpDir, "test.db");
process.env.DATABASE_PATH = databasePath;
process.env.JWT_SECRET = "membership-funding-test-secret";

const { getDb } = await import("../shared/src/database.js");
const {
  MembershipFundingError,
  attachOpenedMembershipCard,
  buildFundingIdempotencyKey,
  createFundingRequestFingerprint,
  getMembershipFundingIntent,
  membershipFundingPaymentGateDefault,
  planMembershipFunding,
  prepareMembershipFundingIntent,
  recoverMembershipFundingIntent,
  releaseMembershipCardReservation,
  reserveMembershipCardCapacity,
  reserveMembershipNewCardPlan,
  submitMembershipFundingIntent
} = await import("../shared/src/membership-funding.js");

const db = getDb();
db.pragma("busy_timeout = 5000");

after(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const at = "2026-07-16T00:00:00.000Z";

function insertFulfillment(id, targetTier, orderNo = `ORDER-${id}`) {
  db.prepare(`
    INSERT INTO membership_fulfillments (
      id, order_id, order_no, target_tier, state, run_mode, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'FUNDING_READY', 'canary', ?, ?)
  `).run(id, `order-${id}`, orderNo, targetTier, at, at);
}

function insertCard(id, options = {}) {
  db.prepare(`
    INSERT INTO managed_cards (
      id, upstream_card_id, vm_card_id, product_code, bin, last4, upstream_status,
      cached_available_amount, lane, consumed_slots, capacity_state,
      reconciliation_state, created_at, updated_at
    ) VALUES (?, ?, ?, ?, '537872', ?, 'ACTIVE', ?, ?, ?, 'AVAILABLE', 'READY', ?, ?)
  `).run(
    id,
    options.upstreamCardId ?? Number(id.replace(/\D/g, "")) + 1000,
    `vm-${id}`,
    options.productCode || "P5378OX",
    String(options.last4 || "7890"),
    options.availableAmount ?? 0,
    options.lane ?? null,
    options.consumedSlots ?? 0,
    at,
    at
  );
}

function expectCode(code) {
  return (error) => error instanceof MembershipFundingError && error.code === code;
}

test("capacity reservation is fulfillment-idempotent and provisionally locks an unassigned card lane", () => {
  insertFulfillment("mf-reserve-a", "x5");
  insertFulfillment("mf-reserve-b", "plus");
  insertCard("card-101");

  const first = reserveMembershipCardCapacity(db, {
    reservationId: "mcr-reserve-a",
    fulfillmentId: "mf-reserve-a",
    cardId: "card-101",
    targetLane: "x5",
    at
  });
  const retry = reserveMembershipCardCapacity(db, {
    fulfillmentId: "mf-reserve-a",
    cardId: "card-101",
    targetLane: "x5",
    at: "2026-07-16T00:00:01.000Z"
  });

  assert.equal(first.id, "mcr-reserve-a");
  assert.equal(first.slotIndex, 1);
  assert.equal(retry.id, first.id);
  assert.equal(db.prepare("SELECT lane FROM managed_cards WHERE id = ?").get("card-101").lane, "x5");
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM card_capacity_reservations WHERE fulfillment_id = ?").get("mf-reserve-a").count, 1);
  assert.throws(() => reserveMembershipCardCapacity(db, {
    fulfillmentId: "mf-reserve-b",
    cardId: "card-101",
    targetLane: "plus",
    at
  }), expectCode("CARD_LANE_MISMATCH"));
});

test("two SQLite writers cannot claim the same final lane slot", async () => {
  insertFulfillment("mf-race-a", "x20");
  insertFulfillment("mf-race-b", "x20");
  insertCard("card-202");

  const moduleUrl = new URL("../shared/src/membership-funding.js", import.meta.url).href;
  const workerSource = `
    const { parentPort, workerData } = require("node:worker_threads");
    const Database = require("better-sqlite3");
    (async () => {
      const { reserveMembershipCardCapacity } = await import(workerData.moduleUrl);
      const connection = new Database(workerData.databasePath);
      connection.pragma("busy_timeout = 5000");
      const ready = Atomics.add(workerData.start, 0, 1) + 1;
      if (ready === 2) Atomics.notify(workerData.start, 0);
      else Atomics.wait(workerData.start, 0, 1, 5000);
      try {
        const reservation = reserveMembershipCardCapacity(connection, workerData.input);
        parentPort.postMessage({ ok: true, slotIndex: reservation.slotIndex });
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
        databasePath,
        start,
        input: { fulfillmentId, cardId: "card-202", targetLane: "x20", at }
      }
    });
    worker.once("message", (message) => { result = message; });
    worker.once("error", reject);
    worker.once("exit", (code) => {
      if (code !== 0) reject(new Error(`capacity worker exited with ${code}`));
      else resolve(result);
    });
  });
  const results = await Promise.all([run("mf-race-a"), run("mf-race-b")]);

  assert.equal(results.filter((result) => result.ok).length, 1);
  assert.deepEqual(results.filter((result) => !result.ok).map((result) => result.code), ["CARD_CAPACITY_FULL"]);
  assert.equal(db.prepare(`
    SELECT COUNT(*) AS count FROM card_capacity_reservations
    WHERE card_id = 'card-202' AND state = 'reserved'
  `).get().count, 1);
});

test("a successfully opened card attaches atomically to its durable product plan", async () => {
  insertFulfillment("mf-new-card", "plus");
  reserveMembershipNewCardPlan(db, {
    reservationId: "mcr-new-card",
    fulfillmentId: "mf-new-card",
    plannedProductCode: "P5378OX",
    targetLane: "plus",
    at
  });
  prepareMembershipFundingIntent(db, {
    fulfillmentId: "mf-new-card",
    orderNo: "ORDER-mf-new-card",
    operation: "open",
    productCode: "P5378OX",
    amountUsd: 20,
    feeUsd: 1.5,
    requestBody: {
      product_code: "P5378OX",
      first_name: "Test",
      last_name: "Holder",
      init_amount: 20
    },
    at
  });
  await submitMembershipFundingIntent(db, {
    fulfillmentId: "mf-new-card",
    paymentGate: { enabled: true, mode: "canary" },
    invoke: async () => ({
      upstreamCardId: 1303,
      vmCardId: "vm-card-303",
      productCode: "P5378OX",
      availableAmount: 20,
      status: "ACTIVE",
      openFee: 1.5
    })
  });
  const persistedCard = db.prepare("SELECT * FROM managed_cards WHERE upstream_card_id = 1303").get();
  assert.equal(persistedCard.product_code, "P5378OX");
  assert.equal(persistedCard.cached_available_amount, 20);
  assert.equal(persistedCard.lane, "plus");

  const attached = attachOpenedMembershipCard(db, {
    fulfillmentId: "mf-new-card",
    cardId: persistedCard.id,
    at: "2026-07-16T00:01:00.000Z"
  });
  assert.equal(attached.cardId, persistedCard.id);
  assert.equal(attached.slotIndex, 1);
});

test("release requires explicit no-payment evidence and only removes the internal provisional lane", () => {
  insertFulfillment("mf-release", "plus");
  insertCard("card-304", { productCode: "P5378OX" });
  reserveMembershipCardCapacity(db, {
    reservationId: "mcr-release",
    fulfillmentId: "mf-release",
    cardId: "card-304",
    targetLane: "plus",
    at
  });
  assert.throws(() => releaseMembershipCardReservation(db, {
    fulfillmentId: "mf-release",
    releaseEvidenceRevision: 1,
    at
  }), expectCode("RESERVATION_RELEASE_EVIDENCE_REQUIRED"));

  const released = releaseMembershipCardReservation(db, {
    fulfillmentId: "mf-release",
    releaseEvidenceRevision: 1,
    evidence: {
      kind: "NO_PAYMENT_BEFORE_SUBMIT",
      membershipUnchanged: true,
      noEffectiveTransaction: true,
      noPendingAuthorization: true
    },
    at: "2026-07-16T00:02:00.000Z"
  });
  assert.equal(released.state, "released");
  assert.equal(released.releaseEvidenceRevision, 1);
  assert.equal(db.prepare("SELECT lane FROM managed_cards WHERE id = ?").get("card-304").lane, null);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM card_capacity_reservations WHERE id = ?").get("mcr-release").count, 1);
});

test("reservation release refuses persisted payment or unknown funding evidence", () => {
  insertFulfillment("mf-paid", "plus");
  insertCard("card-404", { lane: "plus" });
  reserveMembershipCardCapacity(db, {
    fulfillmentId: "mf-paid",
    cardId: "card-404",
    targetLane: "plus",
    at
  });
  db.prepare(`
    INSERT INTO membership_payment_stages (
      id, fulfillment_id, stage_key, expected_tier, state, card_id,
      matched_auth_id, created_at, updated_at
    ) VALUES ('mps-paid', 'mf-paid', 'plus', 'plus', 'confirmed', 'card-404', 'auth-paid', ?, ?)
  `).run(at, at);

  assert.throws(() => releaseMembershipCardReservation(db, {
    fulfillmentId: "mf-paid",
    releaseEvidenceRevision: 1,
    evidence: {
      kind: "NO_PAYMENT_BEFORE_SUBMIT",
      membershipUnchanged: true,
      noEffectiveTransaction: true,
      noPendingAuthorization: true
    },
    at
  }), expectCode("RESERVATION_HAS_PAYMENT_EVIDENCE"));

  insertFulfillment("mf-funding-unknown", "plus");
  insertCard("card-405", { lane: "plus" });
  reserveMembershipCardCapacity(db, {
    fulfillmentId: "mf-funding-unknown",
    cardId: "card-405",
    targetLane: "plus",
    at
  });
  db.prepare(`
    INSERT INTO funding_intents (
      id, fulfillment_id, operation, target_card_id, amount, fee,
      idempotency_key, request_fingerprint, request_body_encrypted,
      state, created_at, submitted_at
    ) VALUES (
      'mfi-unknown-release', 'mf-funding-unknown', 'recharge', 'card-405', 20, 0,
      'kwr:UNKNOWN-RELEASE:recharge:v1', 'fingerprint', 'encrypted',
      'outcome_unknown', ?, ?
    )
  `).run(at, at);
  assert.throws(() => releaseMembershipCardReservation(db, {
    fulfillmentId: "mf-funding-unknown",
    releaseEvidenceRevision: 1,
    evidence: {
      kind: "NO_PAYMENT_BEFORE_SUBMIT",
      membershipUnchanged: true,
      noEffectiveTransaction: true,
      noPendingAuthorization: true
    },
    at
  }), expectCode("RESERVATION_FUNDING_OUTCOME_UNRESOLVED"));
});

test("funding planner uses the combined order budget and includes provider fees in platform and risk checks", () => {
  const recharge = planMembershipFunding({
    kind: "existing_card",
    fullOrderBudgetUsd: 115.64,
    cardAvailableAmountUsd: 20,
    platformBalanceUsd: 96.59,
    rechargeFeeRate: 0.01,
    minAmountUsd: 10,
    maxAmountUsd: 10000
  });
  assert.deepEqual(recharge, {
    kind: "existing_card",
    operation: "recharge",
    fullOrderBudgetUsd: 115.64,
    availableAmountUsd: 20,
    fundingAmountUsd: 95.64,
    feeUsd: 0.96,
    platformDebitUsd: 96.6,
    platformBalanceUsd: 96.59,
    platformBalanceSufficient: false,
    riskReservationUsd: 116.6,
    failureCode: "PLATFORM_BALANCE_INSUFFICIENT"
  });

  const prefunded = planMembershipFunding({
    kind: "existing_card",
    fullOrderBudgetUsd: 16.44,
    cardAvailableAmountUsd: 30,
    platformBalanceUsd: 0,
    rechargeFeeRate: 0.01,
    minAmountUsd: 10,
    maxAmountUsd: 10000
  });
  assert.equal(prefunded.operation, "none");
  assert.equal(prefunded.platformDebitUsd, 0);
  assert.equal(prefunded.platformBalanceSufficient, true);
  assert.equal(prefunded.riskReservationUsd, 16.44);

  const opening = planMembershipFunding({
    kind: "new_card",
    fullOrderBudgetUsd: 16.44,
    platformBalanceUsd: 27.93,
    openFeeUsd: 1.5,
    minAmountUsd: 10,
    maxAmountUsd: 10000
  });
  assert.equal(opening.operation, "open");
  assert.equal(opening.fundingAmountUsd, 16.44);
  assert.equal(opening.platformDebitUsd, 17.94);
  assert.equal(opening.platformBalanceSufficient, true);
  assert.equal(opening.riskReservationUsd, 17.94);
});

test("funding intent is immutable, canonical, deterministic, and committed before the injected write", async () => {
  insertFulfillment("mf-intent", "plus", "ORDER-INTENT");
  insertCard("card-501", { upstreamCardId: 501, lane: "plus" });
  reserveMembershipCardCapacity(db, {
    fulfillmentId: "mf-intent",
    cardId: "card-501",
    targetLane: "plus",
    at
  });
  const body = { amount: 20, card_id: 501 };
  const prepared = prepareMembershipFundingIntent(db, {
    intentId: "mfi-intent",
    fulfillmentId: "mf-intent",
    orderNo: "ORDER-INTENT",
    operation: "recharge",
    targetCardId: "card-501",
    amountUsd: 20,
    feeUsd: 0.2,
    requestBody: body,
    at
  });
  const retry = prepareMembershipFundingIntent(db, {
    fulfillmentId: "mf-intent",
    orderNo: "ORDER-INTENT",
    operation: "recharge",
    targetCardId: "card-501",
    amountUsd: 20,
    feeUsd: 0.2,
    requestBody: { card_id: 501, amount: 20 },
    at
  });

  assert.equal(membershipFundingPaymentGateDefault.enabled, false);
  assert.equal(prepared.id, "mfi-intent");
  assert.equal("requestBody" in prepared, false);
  assert.doesNotMatch(
    db.prepare("SELECT request_body_encrypted FROM funding_intents WHERE id = ?").get("mfi-intent").request_body_encrypted,
    /card_id/
  );
  assert.equal(retry.id, prepared.id);
  assert.equal(prepared.idempotencyKey, buildFundingIdempotencyKey("ORDER-INTENT", "recharge"));
  assert.equal(prepared.requestFingerprint, createFundingRequestFingerprint(body));
  assert.throws(() => prepareMembershipFundingIntent(db, {
    fulfillmentId: "mf-intent",
    orderNo: "ORDER-INTENT",
    operation: "recharge",
    targetCardId: "card-501",
    amountUsd: 21,
    feeUsd: 0.21,
    requestBody: { card_id: 501, amount: 21 },
    at
  }), expectCode("FUNDING_INTENT_CONFLICT"));

  let calls = 0;
  await assert.rejects(() => submitMembershipFundingIntent(db, {
    fulfillmentId: "mf-intent",
    invoke: async () => { calls += 1; }
  }), expectCode("MEMBERSHIP_PAYMENT_GATE_LOCKED"));
  assert.equal(calls, 0);

  const submitted = await submitMembershipFundingIntent(db, {
    fulfillmentId: "mf-intent",
    paymentGate: { enabled: true, mode: "canary" },
    at: "2026-07-16T00:03:00.000Z",
    invoke: async ({ requestBody, idempotencyKey }) => {
      calls += 1;
      const committed = db.prepare("SELECT state FROM funding_intents WHERE fulfillment_id = ?").get("mf-intent");
      const fulfillment = db.prepare("SELECT money_boundary_at FROM membership_fulfillments WHERE id = ?").get("mf-intent");
      assert.equal(committed.state, "submitted");
      assert.equal(fulfillment.money_boundary_at, "2026-07-16T00:03:00.000Z");
      assert.deepEqual(requestBody, { amount: 20, card_id: 501 });
      assert.equal(Object.isFrozen(requestBody), true);
      assert.equal(idempotencyKey, "kwr:ORDER-INTENT:recharge:v1");
      return { succeeded: true };
    }
  });
  assert.equal(calls, 1);
  assert.equal(submitted.intent.state, "succeeded");
  assert.equal(getMembershipFundingIntent(db, "mf-intent").state, "succeeded");
});

test("automatic funding gate requires the durable quota marker while remaining default-off", async () => {
  insertFulfillment("mf-automatic", "plus", "ORDER-AUTOMATIC");
  insertCard("card-550", { upstreamCardId: 550, lane: "plus" });
  reserveMembershipCardCapacity(db, {
    fulfillmentId: "mf-automatic",
    cardId: "card-550",
    targetLane: "plus",
    at
  });
  prepareMembershipFundingIntent(db, {
    fulfillmentId: "mf-automatic",
    orderNo: "ORDER-AUTOMATIC",
    operation: "recharge",
    targetCardId: "card-550",
    amountUsd: 10,
    feeUsd: 0.1,
    requestBody: { card_id: 550, amount: 10 },
    at
  });

  await assert.rejects(() => submitMembershipFundingIntent(db, {
    fulfillmentId: "mf-automatic",
    paymentGate: { enabled: true, mode: "automatic" },
    invoke: async () => ({ succeeded: true })
  }), expectCode("AUTOMATIC_FUNDING_QUOTA_REQUIRED"));
  assert.equal(getMembershipFundingIntent(db, "mf-automatic").state, "prepared");

  db.prepare(`
    UPDATE membership_fulfillments
    SET run_mode = 'automatic', updated_at = ?
    WHERE id = 'mf-automatic'
  `).run("2026-07-16T00:10:00.000Z");
  db.prepare(`
    INSERT INTO automatic_checkout_scopes (
      id, scope_key, revision, site_id, product_id, tier, adapter_version,
      price_contract_id, daily_order_limit, daily_risk_limit_usd, status,
      activated_at, created_at, created_by
    ) VALUES (
      'scope-automatic', 'scope-key-automatic', 1, 'site-auto', 'product-auto',
      'plus', 'checkout-v1', 'contract-auto', 1, 20, 'active', ?, ?, 'admin'
    )
  `).run(at, at);
  db.prepare(`
    INSERT INTO automatic_checkout_quota_reservations (
      id, scope_id, fulfillment_id, business_date, order_units,
      risk_reserved_usd, state, reserved_at
    ) VALUES (
      'quota-automatic', 'scope-automatic', 'mf-automatic', '2026-07-16',
      1, 10.1, 'reserved', ?
    )
  `).run(at);
  const submitted = await submitMembershipFundingIntent(db, {
    fulfillmentId: "mf-automatic",
    paymentGate: { enabled: true, mode: "automatic" },
    invoke: async () => ({ succeeded: true })
  });
  assert.equal(submitted.intent.state, "succeeded");
  assert.notEqual(
    db.prepare("SELECT money_boundary_at FROM membership_fulfillments WHERE id = 'mf-automatic'").get().money_boundary_at,
    null
  );
});

test("unknown funding outcome blocks ordinary submit and recovery replays only the persisted body and key", async () => {
  insertFulfillment("mf-recovery", "plus", "ORDER-RECOVERY");
  insertCard("card-601", { upstreamCardId: 601, lane: "plus" });
  reserveMembershipCardCapacity(db, {
    fulfillmentId: "mf-recovery",
    cardId: "card-601",
    targetLane: "plus",
    at
  });
  prepareMembershipFundingIntent(db, {
    fulfillmentId: "mf-recovery",
    orderNo: "ORDER-RECOVERY",
    operation: "recharge",
    targetCardId: "card-601",
    amountUsd: 25,
    feeUsd: 0.25,
    requestBody: { card_id: 601, amount: 25 },
    at
  });

  await assert.rejects(() => submitMembershipFundingIntent(db, {
    fulfillmentId: "mf-recovery",
    paymentGate: { enabled: true, mode: "canary" },
    invoke: async () => {
      const timeout = new Error("socket disconnected");
      timeout.name = "AbortError";
      throw timeout;
    }
  }), expectCode("FUNDING_OUTCOME_UNKNOWN"));
  assert.equal(getMembershipFundingIntent(db, "mf-recovery").state, "outcome_unknown");
  assert.throws(() => prepareMembershipFundingIntent(db, {
    fulfillmentId: "mf-recovery",
    orderNo: "ORDER-RECOVERY",
    operation: "recharge",
    targetCardId: "card-601",
    amountUsd: 26,
    feeUsd: 0.26,
    requestBody: { card_id: 601, amount: 26 },
    at
  }), expectCode("FUNDING_INTENT_CONFLICT"));
  await assert.rejects(() => submitMembershipFundingIntent(db, {
    fulfillmentId: "mf-recovery",
    paymentGate: { enabled: true, mode: "canary" },
    invoke: async () => ({ succeeded: true })
  }), expectCode("FUNDING_RECOVERY_REQUIRED"));

  let replay;
  const recovered = await recoverMembershipFundingIntent(db, {
    fulfillmentId: "mf-recovery",
    recoveryGate: { enabled: true },
    at: "2026-07-16T00:05:00.000Z",
    invoke: async (request) => {
      replay = request;
      assert.equal(db.prepare("SELECT state FROM funding_intents WHERE fulfillment_id = ?").get("mf-recovery").state, "submitted");
      return { succeeded: true };
    }
  });
  assert.deepEqual(replay.requestBody, { amount: 25, card_id: 601 });
  assert.equal(replay.idempotencyKey, "kwr:ORDER-RECOVERY:recharge:v1");
  assert.equal(recovered.intent.state, "succeeded");
});
