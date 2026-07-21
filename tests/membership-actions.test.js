import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kawang-membership-actions-"));
process.env.DATABASE_PATH = path.join(tmpDir, "test.db");
process.env.JWT_SECRET = "membership-actions-test-secret";

const { getDb } = await import("../shared/src/database.js");
const {
  MembershipActionError,
  acknowledgeMembershipPaymentChallenge,
  claimMembershipMaterialGrant,
  createMembershipMaterialGrant,
  evaluateProgressionAuthorizationDelta,
  issueMembershipActionPermit,
  markMembershipActionOutcomeUncertain,
  recordMembershipNoPaymentCheckpoint,
  reportMembershipActionActivation,
  hasCompleteNoPaymentEvidence
} = await import("../shared/src/membership-actions.js");

const db = getDb();
after(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const at = "2026-07-16T00:00:00.000Z";

function seedStage(id = "mf-action", options = {}) {
  db.prepare(`
    INSERT INTO membership_fulfillments (
      id, order_id, order_no, target_tier, state, current_stage, run_mode,
      browser_lease_epoch, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'canary', ?, ?, ?)
  `).run(
    id,
    `order-${id}`,
    `ORDER-${id}`,
    options.targetTier || "plus",
    options.state || "PLUS_CHECKOUT_READY",
    options.stageKey || "plus",
    options.epoch || 1,
    at,
    at
  );
  db.prepare(`
    INSERT INTO membership_payment_stages (
      id, fulfillment_id, stage_key, expected_tier, state, card_id,
      attempt_no, adapter_version, adapter_path, price_contract_id,
      page_fingerprint, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'checkout_ready', ?, 1, 'checkout-v1', 'single_page',
      'contract-plus', ?, ?, ?)
  `).run(
    `stage-${id}`,
    id,
    options.stageKey || "plus",
    options.expectedTier || "plus",
    options.cardId || "card-action",
    "a".repeat(64),
    at,
    at
  );
  db.prepare(`
    INSERT INTO membership_fulfillment_attempts (
      id, fulfillment_id, stage, attempt_no, resume_revision,
      adapter_version, price_contract_version, started_at
    ) VALUES (?, ?, ?, 1, 0, 'checkout-v1', 1, ?)
  `).run(`attempt-${id}`, id, options.stageKey || "plus", at);
  db.prepare(`
    UPDATE browser_fulfillment_lease
    SET fulfillment_id = ?, installation_id = 'install-action', epoch = ?,
        state = 'leased', heartbeat_at = ?, expires_at = ?, updated_at = ?
    WHERE id = 'default'
  `).run(id, options.epoch || 1, at, "2026-07-16T00:10:00.000Z", at);
}

function expectCode(code) {
  return (error) => error instanceof MembershipActionError && error.code === code;
}

test("material grant is nonce-bound, lease-bound, single-use, and persists no material", () => {
  seedStage();
  const grant = createMembershipMaterialGrant(db, {
    fulfillmentId: "mf-action",
    stageKey: "plus",
    attemptNo: 1,
    installationId: "install-action",
    leaseEpoch: 1,
    adapterVersion: "checkout-v1",
    nowMs: Date.parse(at),
    ttlMs: 60_000
  });
  assert.match(grant.nonce, /^[A-Za-z0-9_-]{43}$/);
  const persisted = JSON.stringify(db.prepare("SELECT * FROM membership_material_grants WHERE id = ?").get(grant.grantId));
  assert.doesNotMatch(persisted, new RegExp(grant.nonce));
  assert.doesNotMatch(persisted, /card_number|cvv|address|checkoutUrl/i);

  assert.throws(() => claimMembershipMaterialGrant(db, {
    grantId: grant.grantId,
    nonce: "x".repeat(43),
    fulfillmentId: "mf-action",
    stageKey: "plus",
    attemptNo: 1,
    installationId: "install-action",
    leaseEpoch: 1,
    adapterVersion: "checkout-v1",
    at
  }), expectCode("MATERIAL_GRANT_INVALID"));

  const claimed = claimMembershipMaterialGrant(db, {
    grantId: grant.grantId,
    nonce: grant.nonce,
    fulfillmentId: "mf-action",
    stageKey: "plus",
    attemptNo: 1,
    installationId: "install-action",
    leaseEpoch: 1,
    adapterVersion: "checkout-v1",
    at
  });
  assert.equal(claimed.cardId, "card-action");
  assert.throws(() => claimMembershipMaterialGrant(db, {
    grantId: grant.grantId,
    nonce: grant.nonce,
    fulfillmentId: "mf-action",
    stageKey: "plus",
    attemptNo: 1,
    installationId: "install-action",
    leaseEpoch: 1,
    adapterVersion: "checkout-v1",
    at
  }), expectCode("MATERIAL_GRANT_ALREADY_CLAIMED"));
});

test("progression permit snapshots auth ids once and any new authorization blocks the stage", () => {
  seedStage("mf-progression");
  const permit = issueMembershipActionPermit(db, {
    fulfillmentId: "mf-progression",
    stageKey: "plus",
    attemptNo: 1,
    actionType: "progression",
    sequenceNo: 1,
    installationId: "install-action",
    leaseEpoch: 1,
    adapterVersion: "checkout-v1",
    priceContractId: "contract-plus",
    controlId: "checkout-next",
    pageFingerprint: "a".repeat(64),
    beforeAuthIds: ["auth-before"],
    at,
    ttlMs: 30_000,
    authorize: () => ({ mode: "canary", authorizationId: "canary-progression", rawProvider: "must-not-leak" })
  });
  assert.equal(permit.authorizationState, "snapshotted");
  assert.equal(permit.authorizationMode, "canary");
  assert.equal(permit.authorizationId, "canary-progression");
  assert.equal(Object.hasOwn(permit, "authorization"), false);
  assert.throws(() => issueMembershipActionPermit(db, {
    fulfillmentId: "mf-progression",
    stageKey: "plus",
    attemptNo: 1,
    actionType: "progression",
    sequenceNo: 1,
    installationId: "install-action",
    leaseEpoch: 1,
    adapterVersion: "checkout-v1",
    priceContractId: "contract-plus",
    controlId: "checkout-next",
    pageFingerprint: "a".repeat(64),
    beforeAuthIds: ["auth-before"],
    at,
    authorize: () => ({ mode: "canary", authorizationId: "canary-progression" })
  }), expectCode("ACTION_PERMIT_ALREADY_ISSUED"));

  reportMembershipActionActivation(db, {
    permitId: permit.permitId,
    fulfillmentId: "mf-progression",
    installationId: "install-action",
    leaseEpoch: 1,
    at: "2026-07-16T00:00:01.000Z"
  });
  const blocked = evaluateProgressionAuthorizationDelta(db, {
    permitId: permit.permitId,
    currentAuthIds: ["auth-before", "auth-zero-dollar"],
    at: "2026-07-16T00:00:02.000Z"
  });
  assert.deepEqual(blocked, { authorizationState: "unexpected", newAuthorization: true });
  assert.equal(db.prepare("SELECT state FROM membership_fulfillments WHERE id = 'mf-progression'").get().state, "UNEXPECTED_PREAUTH");
  const intervention = db.prepare(`
    SELECT state, reason_code FROM fulfillment_interventions WHERE fulfillment_id = 'mf-progression'
  `).get();
  assert.deepEqual(intervention, { state: "UNEXPECTED_PREAUTH", reason_code: "UNEXPECTED_PREAUTH" });
});

test("submit permit is the conservative boundary and cannot be reissued after a lost response", () => {
  seedStage("mf-submit");
  const permit = issueMembershipActionPermit(db, {
    fulfillmentId: "mf-submit",
    stageKey: "plus",
    attemptNo: 1,
    actionType: "submit",
    sequenceNo: 1,
    installationId: "install-action",
    leaseEpoch: 1,
    adapterVersion: "checkout-v1",
    priceContractId: "contract-plus",
    controlId: "checkout-submit",
    pageFingerprint: "a".repeat(64),
    beforeAuthIds: ["auth-before-submit"],
    authorizationClear: true,
    at,
    authorize: () => ({ mode: "canary", authorizationId: "canary-one" })
  });
  assert.equal(permit.singleUse, true);
  assert.equal(permit.authorizationMode, "canary");
  assert.equal(permit.authorizationId, "canary-one");
  assert.deepEqual(db.prepare(`
    SELECT auth_id FROM membership_action_auth_snapshots WHERE permit_id = ?
  `).all(permit.permitId), [{ auth_id: "auth-before-submit" }]);
  assert.equal(db.prepare("SELECT state FROM membership_fulfillments WHERE id = 'mf-submit'").get().state, "PLUS_SUBMIT_PERMITTED");
  assert.equal(db.prepare("SELECT money_boundary_at FROM membership_fulfillments WHERE id = 'mf-submit'").get().money_boundary_at, at);
  assert.throws(() => issueMembershipActionPermit(db, {
    fulfillmentId: "mf-submit",
    stageKey: "plus",
    attemptNo: 1,
    actionType: "submit",
    sequenceNo: 1,
    installationId: "install-action",
    leaseEpoch: 1,
    adapterVersion: "checkout-v1",
    priceContractId: "contract-plus",
    controlId: "checkout-submit",
    pageFingerprint: "a".repeat(64),
    beforeAuthIds: ["auth-before-submit"],
    authorizationClear: true,
    at
  }), expectCode("ACTION_PERMIT_ALREADY_ISSUED"));
});

test("lost permit outcome freezes the stage and local challenge acknowledgement never clicks or resumes it", () => {
  seedStage("mf-uncertain");
  const permit = issueMembershipActionPermit(db, {
    fulfillmentId: "mf-uncertain",
    stageKey: "plus",
    attemptNo: 1,
    actionType: "submit",
    installationId: "install-action",
    leaseEpoch: 1,
    adapterVersion: "checkout-v1",
    priceContractId: "contract-plus",
    controlId: "checkout-submit",
    pageFingerprint: "a".repeat(64),
    beforeAuthIds: [],
    authorizationClear: true,
    authorize: () => ({ mode: "automatic", authorizationId: "quota-one" }),
    at
  });
  const uncertain = markMembershipActionOutcomeUncertain(db, {
    permitId: permit.permitId,
    fulfillmentId: "mf-uncertain",
    stageKey: "plus",
    attemptNo: 1,
    actionType: "submit",
    installationId: "install-action",
    leaseEpoch: 1,
    reasonCode: "PERMIT_RESPONSE_UNCERTAIN",
    at: "2026-07-16T00:00:02.000Z"
  });
  assert.equal(uncertain.state, "PAYMENT_OUTCOME_UNCERTAIN");
  assert.equal(uncertain.permit.state, "outcome_uncertain");
  assert.equal(db.prepare("SELECT state FROM membership_fulfillments WHERE id = 'mf-uncertain'").get().state,
    "PAYMENT_OUTCOME_UNCERTAIN");

  db.prepare(`
    UPDATE membership_fulfillments
    SET state = 'PAYMENT_ACTION_REQUIRED', state_revision = state_revision + 1
    WHERE id = 'mf-uncertain'
  `).run();
  const fulfillment = db.prepare("SELECT state_revision FROM membership_fulfillments WHERE id = 'mf-uncertain'").get();
  db.prepare(`
    INSERT INTO fulfillment_interventions (
      id, fulfillment_id, state, state_revision, reason_code, created_at
    ) VALUES ('fi-challenge', 'mf-uncertain', 'PAYMENT_ACTION_REQUIRED', ?, '3DS_REQUIRED', ?)
  `).run(fulfillment.state_revision, at);
  assert.deepEqual(acknowledgeMembershipPaymentChallenge(db, {
    fulfillmentId: "mf-uncertain",
    stageKey: "plus",
    attemptNo: 1,
    installationId: "install-action",
    leaseEpoch: 1,
    adapterVersion: "checkout-v1",
    at: "2026-07-16T00:00:03.000Z"
  }), { accepted: true, confirmationOnly: true });
  assert.equal(db.prepare("SELECT state FROM membership_fulfillments WHERE id = 'mf-uncertain'").get().state,
    "PAYMENT_ACTION_REQUIRED");
  assert.equal(db.prepare("SELECT acknowledged_by FROM fulfillment_interventions WHERE id = 'fi-challenge'").get().acknowledged_by,
    "extension-local");
});

test("no-payment release evidence requires the timed 5m, 1h, and 24h checkpoints", () => {
  seedStage("mf-no-payment");
  db.prepare(`
    UPDATE membership_payment_stages SET submit_permitted_at = ?
    WHERE fulfillment_id = 'mf-no-payment' AND stage_key = 'plus'
  `).run(at);
  const facts = {
    membershipUnchanged: true,
    noEffectiveTransaction: true,
    noPendingAuthorization: true
  };
  assert.throws(() => recordMembershipNoPaymentCheckpoint(db, {
    fulfillmentId: "mf-no-payment",
    stageKey: "plus",
    checkpoint: "5m",
    facts,
    observedAt: "2026-07-16T00:04:59.000Z"
  }), expectCode("NO_PAYMENT_CHECK_TOO_EARLY"));
  recordMembershipNoPaymentCheckpoint(db, {
    fulfillmentId: "mf-no-payment", stageKey: "plus", checkpoint: "5m", facts,
    observedAt: "2026-07-16T00:05:00.000Z"
  });
  recordMembershipNoPaymentCheckpoint(db, {
    fulfillmentId: "mf-no-payment", stageKey: "plus", checkpoint: "1h", facts,
    observedAt: "2026-07-16T01:00:00.000Z"
  });
  assert.equal(hasCompleteNoPaymentEvidence(db, "mf-no-payment", "plus"), false);
  recordMembershipNoPaymentCheckpoint(db, {
    fulfillmentId: "mf-no-payment", stageKey: "plus", checkpoint: "24h", facts,
    observedAt: "2026-07-17T00:00:00.000Z"
  });
  assert.equal(hasCompleteNoPaymentEvidence(db, "mf-no-payment", "plus"), true);
});
