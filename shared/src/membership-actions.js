import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

const MATERIAL_TTL_MIN_MS = 15_000;
const MATERIAL_TTL_MAX_MS = 2 * 60_000;
const PERMIT_TTL_MIN_MS = 5_000;
const PERMIT_TTL_MAX_MS = 60_000;
const NO_PAYMENT_CHECKPOINTS_MS = Object.freeze({
  "5m": 5 * 60_000,
  "1h": 60 * 60_000,
  "24h": 24 * 60 * 60_000
});

export class MembershipActionError extends Error {
  constructor(code, message = code, options = {}) {
    super(message);
    this.name = "MembershipActionError";
    this.code = code;
    this.statusCode = options.statusCode || 409;
  }
}

function fail(code, message, options) {
  throw new MembershipActionError(code, message, options);
}

function iso(value = Date.now()) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new TypeError("时间无效");
  return date.toISOString();
}

function safeId(value, label = "ID") {
  const normalized = String(value || "").trim();
  if (!/^[A-Za-z0-9._:-]{1,200}$/.test(normalized)) throw new TypeError(`${label} 无效`);
  return normalized;
}

function safeFingerprint(value) {
  const normalized = String(value || "").trim();
  if (!/^[a-f0-9]{64}$/.test(normalized)) throw new TypeError("页面指纹无效");
  return normalized;
}

function boundedTtl(value, minimum, maximum, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : fallback;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function constantTimeHexEqual(left, right) {
  if (!/^[a-f0-9]{64}$/.test(String(left || "")) || !/^[a-f0-9]{64}$/.test(String(right || ""))) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function loadBoundContext(db, input) {
  const fulfillmentId = safeId(input.fulfillmentId, "履约 ID");
  const stageKey = input.stageKey === "upgrade" ? "upgrade" : (input.stageKey === "plus" ? "plus" : null);
  if (!stageKey) throw new TypeError("支付阶段无效");
  const attemptNo = Number(input.attemptNo);
  const leaseEpoch = Number(input.leaseEpoch);
  if (!Number.isInteger(attemptNo) || attemptNo < 1 || !Number.isInteger(leaseEpoch) || leaseEpoch < 1) {
    throw new TypeError("尝试或租约版本无效");
  }
  const installationId = safeId(input.installationId, "扩展安装 ID");
  const adapterVersion = safeId(input.adapterVersion, "Adapter 版本");
  const fulfillment = db.prepare("SELECT * FROM membership_fulfillments WHERE id = ?").get(fulfillmentId);
  const stage = db.prepare(`
    SELECT * FROM membership_payment_stages
    WHERE fulfillment_id = ? AND stage_key = ?
  `).get(fulfillmentId, stageKey);
  const attempt = db.prepare(`
    SELECT * FROM membership_fulfillment_attempts
    WHERE fulfillment_id = ? AND stage = ? AND attempt_no = ?
  `).get(fulfillmentId, stageKey, attemptNo);
  const lease = db.prepare("SELECT * FROM browser_fulfillment_lease WHERE id = 'default'").get();
  if (!fulfillment || !stage || !attempt) fail("MEMBERSHIP_STAGE_BINDING_MISMATCH");
  if (stage.attempt_no !== attemptNo || stage.adapter_version !== adapterVersion
    || attempt.adapter_version !== adapterVersion) fail("MEMBERSHIP_STAGE_BINDING_MISMATCH");
  if (lease?.state !== "leased" || lease.fulfillment_id !== fulfillmentId
    || lease.installation_id !== installationId || lease.epoch !== leaseEpoch
    || fulfillment.browser_lease_epoch !== leaseEpoch) fail("BROWSER_LEASE_MISMATCH");
  return { fulfillmentId, stageKey, attemptNo, leaseEpoch, installationId, adapterVersion, fulfillment, stage, attempt, lease };
}

function assertCheckoutReady(context) {
  const expectedState = context.stageKey === "plus" ? "PLUS_CHECKOUT_READY" : "UPGRADE_CHECKOUT_READY";
  if (context.fulfillment.state !== expectedState || context.stage.state !== "checkout_ready" || !context.stage.card_id) {
    fail("MEMBERSHIP_STAGE_NOT_READY");
  }
}

function assertActionReady(context, actionType) {
  const allowedStates = context.stageKey === "plus"
    ? new Set(["PLUS_CHECKOUT_READY", "PLUS_APPROVAL_WAIT"])
    : new Set(["UPGRADE_CHECKOUT_PREFLIGHT", "UPGRADE_CHECKOUT_READY", "UPGRADE_APPROVAL_WAIT"]);
  const allowedStageStates = actionType === "progression"
    ? new Set(["checkout_ready", "preflight_ready"])
    : new Set(["checkout_ready"]);
  if (!allowedStates.has(context.fulfillment.state)
    || !allowedStageStates.has(context.stage.state) || !context.stage.card_id) {
    fail("MEMBERSHIP_STAGE_NOT_READY");
  }
}

export function createMembershipMaterialGrant(db, input = {}) {
  const nowMs = Number(input.nowMs ?? Date.now());
  const at = iso(nowMs);
  const expiresAt = iso(nowMs + boundedTtl(input.ttlMs, MATERIAL_TTL_MIN_MS, MATERIAL_TTL_MAX_MS, 60_000));
  return db.transaction(() => {
    const context = loadBoundContext(db, input);
    assertCheckoutReady(context);
    const claimed = db.prepare(`
      SELECT id FROM membership_material_grants
      WHERE fulfillment_id = ? AND stage_key = ? AND attempt_no = ?
        AND claimed_at IS NOT NULL
      LIMIT 1
    `).get(context.fulfillmentId, context.stageKey, context.attemptNo);
    if (claimed) fail("MATERIAL_GRANT_ALREADY_CLAIMED");
    db.prepare(`
      UPDATE membership_material_grants
      SET invalidated_at = ?
      WHERE fulfillment_id = ? AND stage_key = ? AND attempt_no = ?
        AND claimed_at IS NULL AND invalidated_at IS NULL
    `).run(at, context.fulfillmentId, context.stageKey, context.attemptNo);
    const nonce = randomBytes(32).toString("base64url");
    const grantId = `mmg_${randomUUID()}`;
    db.prepare(`
      INSERT INTO membership_material_grants (
        id, nonce_sha256, fulfillment_id, stage_key, attempt_no,
        installation_id, browser_lease_epoch, adapter_version,
        expires_at, claimed_at, created_at, invalidated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL)
    `).run(
      grantId,
      sha256(nonce),
      context.fulfillmentId,
      context.stageKey,
      context.attemptNo,
      context.installationId,
      context.leaseEpoch,
      context.adapterVersion,
      expiresAt,
      at
    );
    return Object.freeze({
      grantId,
      nonce,
      fulfillmentId: context.fulfillmentId,
      stageKey: context.stageKey,
      attemptNo: context.attemptNo,
      leaseEpoch: context.leaseEpoch,
      adapterVersion: context.adapterVersion,
      expiresAt
    });
  })();
}

export function claimMembershipMaterialGrant(db, input = {}) {
  const grantId = safeId(input.grantId, "Grant ID");
  const nonce = String(input.nonce || "");
  const at = iso(input.at ?? Date.now());
  return db.transaction(() => {
    const context = loadBoundContext(db, input);
    assertCheckoutReady(context);
    const grant = db.prepare("SELECT * FROM membership_material_grants WHERE id = ?").get(grantId);
    if (!grant || grant.fulfillment_id !== context.fulfillmentId || grant.stage_key !== context.stageKey
      || grant.attempt_no !== context.attemptNo || grant.installation_id !== context.installationId
      || grant.browser_lease_epoch !== context.leaseEpoch || grant.adapter_version !== context.adapterVersion
      || grant.invalidated_at || !constantTimeHexEqual(grant.nonce_sha256, sha256(nonce))) {
      fail("MATERIAL_GRANT_INVALID", "敏感资料授权无效", { statusCode: 404 });
    }
    if (grant.claimed_at) fail("MATERIAL_GRANT_ALREADY_CLAIMED");
    if (grant.expires_at <= at) fail("MATERIAL_GRANT_EXPIRED", "敏感资料授权已过期", { statusCode: 410 });
    const changed = db.prepare(`
      UPDATE membership_material_grants SET claimed_at = ?
      WHERE id = ? AND claimed_at IS NULL AND invalidated_at IS NULL AND expires_at > ?
    `).run(at, grant.id, at).changes;
    if (changed !== 1) fail("MATERIAL_GRANT_ALREADY_CLAIMED");
    return Object.freeze({
      grantId: grant.id,
      fulfillmentId: context.fulfillmentId,
      stageKey: context.stageKey,
      attemptNo: context.attemptNo,
      leaseEpoch: context.leaseEpoch,
      adapterVersion: context.adapterVersion,
      cardId: context.stage.card_id,
      priceContractId: context.stage.price_contract_id,
      targetTier: context.fulfillment.target_tier
    });
  })();
}

function normalizeAuthIds(values) {
  if (!Array.isArray(values) || values.length > 500) throw new TypeError("授权快照无效");
  const ids = [...new Set(values.map((value) => String(value || "").trim()))].sort();
  if (ids.some((value) => !value || value.length > 256)) throw new TypeError("授权快照无效");
  return ids;
}

function normalizeAuthorization(value) {
  const mode = value?.mode === "canary" ? "canary" : (value?.mode === "automatic" ? "automatic" : null);
  const authorizationId = typeof value?.authorizationId === "string"
    ? value.authorizationId.trim()
    : "";
  if (!mode || !/^[A-Za-z0-9._:-]{1,200}$/.test(authorizationId)) {
    fail("ACTION_PERMIT_NOT_AUTHORIZED");
  }
  return Object.freeze({ mode, authorizationId });
}

function serializePermit(row) {
  return Object.freeze({
    permitId: row.id,
    kind: row.action_type,
    singleUse: true,
    fulfillmentId: row.fulfillment_id,
    stageKey: row.stage_key,
    attemptNo: row.attempt_no,
    leaseEpoch: row.browser_lease_epoch,
    adapterVersion: row.adapter_version,
    priceContractId: row.price_contract_id,
    controlId: row.control_id,
    pageFingerprint: row.page_fingerprint,
    state: row.state,
    activatedAt: row.activated_at || null,
    reportedAt: row.reported_at || null,
    outcomeCode: row.outcome_code || null,
    authorizationMode: row.authorization_mode || null,
    authorizationId: row.authorization_id || null,
    expiresAt: row.expires_at
  });
}

export function issueMembershipActionPermit(db, input = {}) {
  const actionType = input.actionType === "progression" ? "progression" : (input.actionType === "submit" ? "submit" : null);
  if (!actionType) throw new TypeError("操作许可类型无效");
  const sequenceNo = Number(input.sequenceNo ?? 1);
  if (!Number.isInteger(sequenceNo) || sequenceNo < 1 || sequenceNo > 5) throw new TypeError("操作许可序号无效");
  const priceContractId = safeId(input.priceContractId, "价格契约 ID");
  const controlId = safeId(input.controlId, "控件 ID");
  const pageFingerprint = safeFingerprint(input.pageFingerprint);
  const atMs = new Date(input.at ?? Date.now()).getTime();
  const at = iso(atMs);
  const expiresAt = iso(atMs + boundedTtl(input.ttlMs, PERMIT_TTL_MIN_MS, PERMIT_TTL_MAX_MS, 30_000));
  const authIds = normalizeAuthIds(input.beforeAuthIds);
  if (actionType === "submit" && input.authorizationClear !== true) fail("SUBMIT_AUTHORIZATION_NOT_CLEAR");

  return db.transaction(() => {
    const context = loadBoundContext(db, input);
    if (context.stage.price_contract_id !== priceContractId || context.stage.page_fingerprint !== pageFingerprint) {
      fail("MEMBERSHIP_PAGE_SNAPSHOT_MISMATCH");
    }
    const existing = db.prepare(`
      SELECT id FROM membership_action_permits
      WHERE fulfillment_id = ? AND stage_key = ? AND attempt_no = ?
        AND action_type = ? AND sequence_no = ?
    `).get(context.fulfillmentId, context.stageKey, context.attemptNo, actionType, sequenceNo);
    if (existing) fail("ACTION_PERMIT_ALREADY_ISSUED");
    assertActionReady(context, actionType);
    const authorization = normalizeAuthorization(
      typeof input.authorize === "function"
        ? input.authorize(context, Object.freeze({ consume: actionType === "submit" }))
        : null
    );

    const permitId = `map_${randomUUID()}`;
    db.prepare(`
      INSERT INTO membership_action_permits (
        id, fulfillment_id, stage_key, attempt_no, action_type, sequence_no,
        installation_id, browser_lease_epoch, adapter_version, price_contract_id,
        control_id, page_fingerprint, state, issued_at, expires_at,
        authorization_mode, authorization_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'issued', ?, ?, ?, ?)
    `).run(
      permitId,
      context.fulfillmentId,
      context.stageKey,
      context.attemptNo,
      actionType,
      sequenceNo,
      context.installationId,
      context.leaseEpoch,
      context.adapterVersion,
      priceContractId,
      controlId,
      pageFingerprint,
      at,
      expiresAt,
      authorization.mode,
      authorization.authorizationId
    );
    const insertSnapshot = db.prepare(`
      INSERT INTO membership_action_auth_snapshots (permit_id, card_id, auth_id, snapshotted_at)
      VALUES (?, ?, ?, ?)
    `);
    for (const authId of authIds) insertSnapshot.run(permitId, context.stage.card_id, authId, at);
    if (actionType === "progression") {
      db.prepare(`
        UPDATE membership_payment_stages
        SET state = 'progression_permitted', progression_permitted_at = ?, updated_at = ?
        WHERE id = ?
      `).run(at, at, context.stage.id);
    } else {
      const nextState = context.stageKey === "plus" ? "PLUS_SUBMIT_PERMITTED" : "UPGRADE_SUBMIT_PERMITTED";
      db.prepare(`
        UPDATE membership_payment_stages
        SET state = 'submit_permitted', submit_permitted_at = ?, updated_at = ?
        WHERE id = ?
      `).run(at, at, context.stage.id);
      db.prepare(`
        UPDATE membership_fulfillments
        SET state = ?, money_boundary_at = COALESCE(money_boundary_at, ?),
            state_revision = state_revision + 1, updated_at = ?
        WHERE id = ?
      `).run(nextState, at, at, context.fulfillmentId);
    }
    return Object.freeze({
      permitId,
      kind: actionType,
      singleUse: true,
      fulfillmentId: context.fulfillmentId,
      stageKey: context.stageKey,
      attemptNo: context.attemptNo,
      leaseEpoch: context.leaseEpoch,
      adapterVersion: context.adapterVersion,
      priceContractId,
      controlId,
      pageFingerprint,
      expiresAt,
      authorizationState: actionType === "progression" ? "snapshotted" : "clear",
      authorizationMode: authorization.mode,
      authorizationId: authorization.authorizationId
    });
  })();
}

export function reportMembershipActionActivation(db, input = {}) {
  const permitId = safeId(input.permitId, "Permit ID");
  const fulfillmentId = safeId(input.fulfillmentId, "履约 ID");
  const installationId = safeId(input.installationId, "扩展安装 ID");
  const leaseEpoch = Number(input.leaseEpoch);
  const at = iso(input.at ?? Date.now());
  return db.transaction(() => {
    const permit = db.prepare("SELECT * FROM membership_action_permits WHERE id = ?").get(permitId);
    if (!permit || permit.fulfillment_id !== fulfillmentId || permit.installation_id !== installationId
      || permit.browser_lease_epoch !== leaseEpoch) fail("ACTION_PERMIT_BINDING_MISMATCH");
    if (["activated", "reported"].includes(permit.state)) return serializePermit(permit);
    const lease = db.prepare("SELECT * FROM browser_fulfillment_lease WHERE id = 'default'").get();
    if (permit.state !== "issued" || permit.expires_at <= at || lease?.state !== "leased"
      || lease.fulfillment_id !== fulfillmentId || lease.installation_id !== installationId || lease.epoch !== leaseEpoch) {
      db.prepare(`
        UPDATE membership_action_permits
        SET state = 'outcome_uncertain', reported_at = ?, outcome_code = 'PERMIT_CONTEXT_LOST'
        WHERE id = ? AND state = 'issued'
      `).run(at, permit.id);
      db.prepare(`
        UPDATE membership_fulfillments
        SET state = 'PAYMENT_OUTCOME_UNCERTAIN', failure_code = 'PERMIT_CONTEXT_LOST',
            state_revision = state_revision + 1, updated_at = ?
        WHERE id = ?
      `).run(at, fulfillmentId);
      fail("ACTION_PERMIT_CONTEXT_LOST");
    }
    db.prepare(`
      UPDATE membership_action_permits SET state = 'activated', activated_at = ?
      WHERE id = ? AND state = 'issued'
    `).run(at, permit.id);
    if (permit.action_type === "progression") {
      db.prepare(`
        UPDATE membership_payment_stages SET progression_reported_at = ?, updated_at = ?
        WHERE fulfillment_id = ? AND stage_key = ?
      `).run(at, at, fulfillmentId, permit.stage_key);
    } else {
      const nextState = permit.stage_key === "plus" ? "PLUS_RECONCILING" : "UPGRADE_RECONCILING";
      db.prepare(`
        UPDATE membership_payment_stages SET submit_reported_at = ?, state = 'reconciling', updated_at = ?
        WHERE fulfillment_id = ? AND stage_key = ?
      `).run(at, at, fulfillmentId, permit.stage_key);
      db.prepare(`
        UPDATE membership_fulfillments
        SET state = ?, state_revision = state_revision + 1, updated_at = ?
        WHERE id = ?
      `).run(nextState, at, fulfillmentId);
    }
    return serializePermit(db.prepare("SELECT * FROM membership_action_permits WHERE id = ?").get(permit.id));
  })();
}

export function markMembershipActionOutcomeUncertain(db, input = {}) {
  const fulfillmentId = safeId(input.fulfillmentId, "履约 ID");
  const stageKey = input.stageKey === "upgrade" ? "upgrade" : (input.stageKey === "plus" ? "plus" : null);
  const actionType = input.actionType === "progression" ? "progression" : (input.actionType === "submit" ? "submit" : null);
  if (!stageKey || !actionType) throw new TypeError("支付阶段或操作类型无效");
  const attemptNo = Number(input.attemptNo);
  const leaseEpoch = Number(input.leaseEpoch);
  if (!Number.isInteger(attemptNo) || attemptNo < 1 || !Number.isInteger(leaseEpoch) || leaseEpoch < 1) {
    throw new TypeError("尝试或租约版本无效");
  }
  const installationId = safeId(input.installationId, "扩展安装 ID");
  const permitId = input.permitId ? safeId(input.permitId, "Permit ID") : null;
  const at = iso(input.at ?? Date.now());
  const reasonCode = [
    "PERMIT_RESPONSE_UNCERTAIN",
    "PERMIT_ACTIVATION_UNCERTAIN",
    "PAGE_CHANGED_AFTER_PERMIT",
    "PAYMENT_CONTEXT_LOST"
  ].includes(input.reasonCode) ? input.reasonCode : "PERMIT_OUTCOME_UNCERTAIN";

  return db.transaction(() => {
    const permit = permitId
      ? db.prepare("SELECT * FROM membership_action_permits WHERE id = ?").get(permitId)
      : db.prepare(`
          SELECT * FROM membership_action_permits
          WHERE fulfillment_id = ? AND stage_key = ? AND attempt_no = ? AND action_type = ?
          ORDER BY sequence_no DESC LIMIT 1
        `).get(fulfillmentId, stageKey, attemptNo, actionType);
    if (!permit || permit.fulfillment_id !== fulfillmentId || permit.stage_key !== stageKey
      || permit.attempt_no !== attemptNo || permit.action_type !== actionType
      || permit.installation_id !== installationId || permit.browser_lease_epoch !== leaseEpoch) {
      fail("ACTION_PERMIT_BINDING_MISMATCH");
    }
    if (!["outcome_uncertain", "blocked"].includes(permit.state)) {
      db.prepare(`
        UPDATE membership_action_permits
        SET state = 'outcome_uncertain', reported_at = COALESCE(reported_at, ?), outcome_code = ?
        WHERE id = ?
      `).run(at, reasonCode, permit.id);
    }
    db.prepare(`
      UPDATE membership_action_permits
      SET state = 'invalidated', reported_at = COALESCE(reported_at, ?), outcome_code = 'SIBLING_INVALIDATED'
      WHERE fulfillment_id = ? AND stage_key = ? AND attempt_no = ?
        AND id <> ? AND state = 'issued'
    `).run(at, fulfillmentId, stageKey, attemptNo, permit.id);
    db.prepare(`
      UPDATE membership_material_grants
      SET invalidated_at = COALESCE(invalidated_at, ?)
      WHERE fulfillment_id = ? AND stage_key = ? AND attempt_no = ?
    `).run(at, fulfillmentId, stageKey, attemptNo);
    const fulfillment = db.prepare("SELECT state, state_revision FROM membership_fulfillments WHERE id = ?")
      .get(fulfillmentId);
    if (!fulfillment) fail("MEMBERSHIP_STAGE_BINDING_MISMATCH");
    if (fulfillment.state !== "PAYMENT_OUTCOME_UNCERTAIN") {
      db.prepare(`
        UPDATE membership_fulfillments
        SET state = 'PAYMENT_OUTCOME_UNCERTAIN', failure_code = ?,
            state_revision = state_revision + 1, updated_at = ?
        WHERE id = ?
      `).run(reasonCode, at, fulfillmentId);
    }
    const current = db.prepare("SELECT * FROM membership_fulfillments WHERE id = ?").get(fulfillmentId);
    db.prepare(`
      INSERT OR IGNORE INTO fulfillment_interventions (
        id, fulfillment_id, state, state_revision, reason_code, created_at
      ) VALUES (?, ?, 'PAYMENT_OUTCOME_UNCERTAIN', ?, ?, ?)
    `).run(`fi_${randomUUID()}`, fulfillmentId, current.state_revision, reasonCode, at);
    return Object.freeze({
      permit: serializePermit(db.prepare("SELECT * FROM membership_action_permits WHERE id = ?").get(permit.id)),
      state: "PAYMENT_OUTCOME_UNCERTAIN",
      confirmationOnly: true
    });
  })();
}

export function acknowledgeMembershipPaymentChallenge(db, input = {}) {
  const fulfillmentId = safeId(input.fulfillmentId, "履约 ID");
  const stageKey = input.stageKey === "upgrade" ? "upgrade" : (input.stageKey === "plus" ? "plus" : null);
  const attemptNo = Number(input.attemptNo);
  const leaseEpoch = Number(input.leaseEpoch);
  const installationId = safeId(input.installationId, "扩展安装 ID");
  if (!stageKey || !Number.isInteger(attemptNo) || attemptNo < 1
    || !Number.isInteger(leaseEpoch) || leaseEpoch < 1) throw new TypeError("验证确认绑定无效");
  const at = iso(input.at ?? Date.now());
  return db.transaction(() => {
    const context = loadBoundContext(db, {
      fulfillmentId,
      stageKey,
      attemptNo,
      leaseEpoch,
      installationId,
      adapterVersion: input.adapterVersion
    });
    if (context.fulfillment.state !== "PAYMENT_ACTION_REQUIRED") fail("PAYMENT_ACTION_NOT_REQUIRED");
    db.prepare(`
      UPDATE membership_action_permits
      SET state = CASE WHEN state IN ('issued', 'activated') THEN 'challenge_locked' ELSE state END,
          reported_at = COALESCE(reported_at, ?),
          outcome_code = CASE WHEN state IN ('issued', 'activated') THEN 'LOCAL_VERIFICATION_COMPLETED' ELSE outcome_code END
      WHERE fulfillment_id = ? AND stage_key = ? AND attempt_no = ?
    `).run(at, fulfillmentId, stageKey, attemptNo);
    const intervention = db.prepare(`
      SELECT * FROM fulfillment_interventions
      WHERE fulfillment_id = ? AND state = 'PAYMENT_ACTION_REQUIRED'
      ORDER BY state_revision DESC LIMIT 1
    `).get(fulfillmentId);
    if (!intervention) fail("PAYMENT_ACTION_INTERVENTION_MISSING");
    db.prepare(`
      UPDATE fulfillment_interventions
      SET acknowledged_at = COALESCE(acknowledged_at, ?),
          acknowledged_by = COALESCE(acknowledged_by, 'extension-local')
      WHERE id = ?
    `).run(at, intervention.id);
    return Object.freeze({ accepted: true, confirmationOnly: true });
  })();
}

export function evaluateProgressionAuthorizationDelta(db, input = {}) {
  const permitId = safeId(input.permitId, "Permit ID");
  const current = normalizeAuthIds(input.currentAuthIds);
  const at = iso(input.at ?? Date.now());
  return db.transaction(() => {
    const permit = db.prepare("SELECT * FROM membership_action_permits WHERE id = ?").get(permitId);
    if (!permit || permit.action_type !== "progression" || permit.state !== "activated") {
      fail("PROGRESSION_PERMIT_NOT_ACTIVATED");
    }
    const before = new Set(db.prepare(`
      SELECT auth_id FROM membership_action_auth_snapshots WHERE permit_id = ?
    `).all(permitId).map((row) => row.auth_id));
    const newAuthIds = current.filter((authId) => !before.has(authId));
    if (newAuthIds.length) {
      db.prepare(`
        UPDATE membership_action_permits
        SET state = 'blocked', reported_at = ?, outcome_code = 'UNEXPECTED_PREAUTH'
        WHERE id = ?
      `).run(at, permitId);
      db.prepare(`
        UPDATE membership_fulfillments
        SET state = 'UNEXPECTED_PREAUTH', failure_code = 'UNEXPECTED_PREAUTH',
            state_revision = state_revision + 1, updated_at = ?
        WHERE id = ?
      `).run(at, permit.fulfillment_id);
      const fulfillment = db.prepare(`
        SELECT state_revision FROM membership_fulfillments WHERE id = ?
      `).get(permit.fulfillment_id);
      db.prepare(`
        INSERT OR IGNORE INTO fulfillment_interventions (
          id, fulfillment_id, state, state_revision, reason_code, created_at
        ) VALUES (?, ?, 'UNEXPECTED_PREAUTH', ?, 'UNEXPECTED_PREAUTH', ?)
      `).run(`fi_${randomUUID()}`, permit.fulfillment_id, fulfillment.state_revision, at);
      return Object.freeze({ authorizationState: "unexpected", newAuthorization: true });
    }
    db.prepare(`
      UPDATE membership_action_permits
      SET state = 'reported', reported_at = ?, outcome_code = 'AUTHORIZATION_CLEAR'
      WHERE id = ?
    `).run(at, permitId);
    db.prepare(`
      UPDATE membership_payment_stages SET state = 'checkout_ready', updated_at = ?
      WHERE fulfillment_id = ? AND stage_key = ?
    `).run(at, permit.fulfillment_id, permit.stage_key);
    return Object.freeze({ authorizationState: "clear", newAuthorization: false });
  })();
}

export function recordMembershipNoPaymentCheckpoint(db, input = {}) {
  const fulfillmentId = safeId(input.fulfillmentId, "履约 ID");
  const stageKey = input.stageKey === "upgrade" ? "upgrade" : (input.stageKey === "plus" ? "plus" : null);
  const checkpoint = String(input.checkpoint || "");
  if (!stageKey || !Object.hasOwn(NO_PAYMENT_CHECKPOINTS_MS, checkpoint)) throw new TypeError("未扣款检查点无效");
  const facts = input.facts;
  if (!facts || typeof facts !== "object" || [
    facts.membershipUnchanged,
    facts.noEffectiveTransaction,
    facts.noPendingAuthorization
  ].some((value) => typeof value !== "boolean")) throw new TypeError("未扣款证据无效");
  const observedAt = iso(input.observedAt ?? Date.now());
  return db.transaction(() => {
    const stage = db.prepare(`
      SELECT submit_permitted_at FROM membership_payment_stages
      WHERE fulfillment_id = ? AND stage_key = ?
    `).get(fulfillmentId, stageKey);
    if (!stage?.submit_permitted_at) fail("NO_PAYMENT_SUBMIT_BOUNDARY_MISSING");
    if (Date.parse(observedAt) < Date.parse(stage.submit_permitted_at) + NO_PAYMENT_CHECKPOINTS_MS[checkpoint]) {
      fail("NO_PAYMENT_CHECK_TOO_EARLY");
    }
    const existing = db.prepare(`
      SELECT * FROM membership_no_payment_checks
      WHERE fulfillment_id = ? AND stage_key = ? AND checkpoint = ?
    `).get(fulfillmentId, stageKey, checkpoint);
    if (existing) {
      if (existing.membership_unchanged !== (facts.membershipUnchanged ? 1 : 0)
        || existing.no_effective_transaction !== (facts.noEffectiveTransaction ? 1 : 0)
        || existing.no_pending_authorization !== (facts.noPendingAuthorization ? 1 : 0)) {
        fail("NO_PAYMENT_CHECK_CONFLICT");
      }
      return existing;
    }
    const id = `mnpc_${randomUUID()}`;
    db.prepare(`
      INSERT INTO membership_no_payment_checks (
        id, fulfillment_id, stage_key, checkpoint, membership_unchanged,
        no_effective_transaction, no_pending_authorization, observed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      fulfillmentId,
      stageKey,
      checkpoint,
      facts.membershipUnchanged ? 1 : 0,
      facts.noEffectiveTransaction ? 1 : 0,
      facts.noPendingAuthorization ? 1 : 0,
      observedAt
    );
    return db.prepare("SELECT * FROM membership_no_payment_checks WHERE id = ?").get(id);
  })();
}

export function hasCompleteNoPaymentEvidence(db, fulfillmentIdValue, stageKeyValue) {
  const fulfillmentId = safeId(fulfillmentIdValue, "履约 ID");
  const stageKey = stageKeyValue === "upgrade" ? "upgrade" : (stageKeyValue === "plus" ? "plus" : null);
  if (!stageKey) throw new TypeError("支付阶段无效");
  const rows = db.prepare(`
    SELECT checkpoint, membership_unchanged, no_effective_transaction, no_pending_authorization
    FROM membership_no_payment_checks
    WHERE fulfillment_id = ? AND stage_key = ?
  `).all(fulfillmentId, stageKey);
  const passed = new Set(rows.filter((row) => row.membership_unchanged === 1
    && row.no_effective_transaction === 1 && row.no_pending_authorization === 1)
    .map((row) => row.checkpoint));
  return Object.keys(NO_PAYMENT_CHECKPOINTS_MS).every((checkpoint) => passed.has(checkpoint));
}
