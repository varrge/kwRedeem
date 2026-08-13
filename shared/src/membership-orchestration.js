import { createHmac, randomUUID } from "node:crypto";
import {
  membershipFulfillmentStates,
  membershipTiers
} from "./membership-fulfillment.js";

const ACTIVE_LOCK_TERMINAL_STATES = Object.freeze([
  "ACCOUNT_ALREADY_SUBSCRIBED",
  "PAYMENT_DECLINED",
  "PARTIAL_FULFILLMENT_EXPIRED",
  "CANCELLED",
  "COMPLETED"
]);

const CUSTOMER_COMPENSATION_LABELS = Object.freeze({
  REFUNDED: { status: "refunded", label: "已退款" },
  REPLACEMENT_DELIVERED: { status: "replaced", label: "已补发" },
  CUSTOMER_ACCEPTED_PARTIAL: { status: "resolved", label: "已协商完成" }
});

export const membershipCheckoutAdapterVersion = "checkout-v1";
export const browserFulfillmentLeaseTtlMs = 60_000;

function nowIso(value = Date.now()) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new TypeError("时间无效");
  return date.toISOString();
}

function normalizeEmail(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return normalized.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)
    ? normalized
    : null;
}

function requireFulfillmentId(value) {
  const id = String(value || "").trim();
  if (!id || id.length > 128 || !/^[A-Za-z0-9_-]+$/.test(id)) throw new TypeError("履约 ID 无效");
  return id;
}

function appendOutbox(db, fulfillment, eventType, at) {
  db.prepare(`
    INSERT INTO membership_outbox (
      id, event_type, fulfillment_id, state_revision, payload, created_at
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    `mfo_${randomUUID()}`,
    eventType,
    fulfillment.id,
    fulfillment.state_revision,
    JSON.stringify({ createdAt: at }),
    at
  );
}

export function deriveMembershipAccountLockKey(secret, identity = {}) {
  const key = String(secret || "");
  if (key.length < 12) throw new TypeError("账号锁密钥未配置");
  const accountId = typeof identity.accountId === "string" ? identity.accountId.trim() : "";
  const email = normalizeEmail(identity.email);
  const normalized = accountId ? `account:${accountId}` : (email ? `email:${email}` : "");
  if (!normalized) throw new TypeError("缺少已验证的 ChatGPT 身份");
  return `mfalk_v1_${createHmac("sha256", key)
    .update(`kwredeem:membership-account-lock:v1\0${normalized}`)
    .digest("hex")}`;
}

export function createMembershipFulfillmentForOrder(db, input = {}) {
  const product = db.prepare("SELECT membership_tier FROM products WHERE id = ?").get(input.productId);
  const manualType = String(input.manualType || "").trim().toLowerCase();
  const targetTier = manualType || product?.membership_tier || null;
  if (targetTier === null) return null;
  if (!membershipTiers.includes(targetTier)) throw new TypeError("订单会员类型无效");

  const existing = db.prepare("SELECT * FROM membership_fulfillments WHERE order_id = ?").get(input.orderId);
  if (existing) {
    if (existing.order_no !== input.orderNo || existing.target_tier !== targetTier) {
      throw new Error("订单已有不一致的会员履约记录");
    }
    return existing;
  }

  const at = nowIso(input.createdAt ?? Date.now());
  const id = input.id || `mf_${randomUUID()}`;
  const order = db.prepare("SELECT site_id, product_id, created_at FROM redeem_orders WHERE id = ?")
    .get(input.orderId);
  const automaticScope = order ? db.prepare(`
    SELECT id FROM automatic_checkout_scopes
    WHERE site_id = ? AND product_id = ? AND tier = ? AND status = 'active'
      AND activated_at IS NOT NULL AND activated_at <= ?
    LIMIT 1
  `).get(order.site_id, order.product_id, targetTier, order.created_at || at) : null;
  const runMode = automaticScope ? "automatic" : null;
  db.prepare(`
    INSERT INTO membership_fulfillments (
      id, order_id, order_no, target_tier, state, current_stage, run_mode,
      account_lock_key, resume_revision, state_revision, automation_enrolled_at,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'WAITING_SESSION_VALIDATION', NULL, ?, NULL, 0, 0, ?, ?, ?)
  `).run(id, input.orderId, input.orderNo, targetTier, runMode, at, at, at);
  return db.prepare("SELECT * FROM membership_fulfillments WHERE id = ?").get(id);
}

export function activateMembershipFulfillmentIdentity(db, input = {}) {
  const orderNo = String(input.orderNo || "").trim();
  const at = nowIso(input.at ?? Date.now());
  const lockKey = deriveMembershipAccountLockKey(input.secret, {
    accountId: input.verifiedAccountId,
    email: input.verifiedEmail
  });
  return db.transaction(() => {
    const current = db.prepare(`
      SELECT f.*
      FROM membership_fulfillments f
      JOIN redeem_orders o ON o.id = f.order_id
      WHERE f.order_no = ? AND f.automation_enrolled_at IS NOT NULL
        AND o.extension_delivery_status = 'succeeded'
    `).get(orderNo);
    if (!current) return null;
    if (!["WAITING_SESSION_VALIDATION", "WAITING_SESSION_ACTIVATION", "ACCOUNT_FULFILLMENT_WAIT"].includes(current.state)) return current;

    const holder = db.prepare(`
      SELECT id FROM membership_fulfillments
      WHERE account_lock_key = ? AND id <> ? AND automation_enrolled_at IS NOT NULL
        AND state <> 'ACCOUNT_FULFILLMENT_WAIT'
        AND state NOT IN (${ACTIVE_LOCK_TERMINAL_STATES.map(() => "?").join(", ")})
      LIMIT 1
    `).get(lockKey, current.id, ...ACTIVE_LOCK_TERMINAL_STATES);
    const nextState = holder ? "ACCOUNT_FULFILLMENT_WAIT" : "QUEUED";
    db.prepare(`
      UPDATE membership_fulfillments
      SET account_lock_key = ?, state = ?, failure_code = NULL,
          retry_at = NULL, state_revision = state_revision + 1, updated_at = ?
      WHERE id = ?
    `).run(lockKey, nextState, at, current.id);
    return db.prepare("SELECT * FROM membership_fulfillments WHERE id = ?").get(current.id);
  })();
}

export function promoteWaitingMembershipFulfillment(db, fulfillmentId, options = {}) {
  const id = requireFulfillmentId(fulfillmentId);
  const at = nowIso(options.at ?? Date.now());
  return db.transaction(() => {
    const current = db.prepare("SELECT * FROM membership_fulfillments WHERE id = ?").get(id);
    if (!current || !current.automation_enrolled_at
      || current.state !== "ACCOUNT_FULFILLMENT_WAIT" || !current.account_lock_key) return current || null;
    const holder = db.prepare(`
      SELECT id FROM membership_fulfillments
      WHERE account_lock_key = ? AND id <> ? AND automation_enrolled_at IS NOT NULL
        AND state <> 'ACCOUNT_FULFILLMENT_WAIT'
        AND state NOT IN (${ACTIVE_LOCK_TERMINAL_STATES.map(() => "?").join(", ")})
      LIMIT 1
    `).get(current.account_lock_key, current.id, ...ACTIVE_LOCK_TERMINAL_STATES);
    if (holder) return current;
    db.prepare(`
      UPDATE membership_fulfillments
      SET state = 'QUEUED', failure_code = NULL, retry_at = NULL,
          state_revision = state_revision + 1, updated_at = ?
      WHERE id = ? AND state = 'ACCOUNT_FULFILLMENT_WAIT'
    `).run(at, current.id);
    return db.prepare("SELECT * FROM membership_fulfillments WHERE id = ?").get(current.id);
  })();
}

export function transitionMembershipFulfillment(db, fulfillmentId, nextState, options = {}) {
  const id = requireFulfillmentId(fulfillmentId);
  if (!membershipFulfillmentStates.includes(nextState)) throw new TypeError("会员履约状态无效");
  const at = nowIso(options.at ?? Date.now());
  return db.transaction(() => {
    const current = db.prepare("SELECT * FROM membership_fulfillments WHERE id = ?").get(id);
    if (!current) return null;
    if (ACTIVE_LOCK_TERMINAL_STATES.includes(current.state) && nextState !== current.state) return current;
    if (Number.isInteger(options.expectedRevision) && current.state_revision !== options.expectedRevision) {
      const error = new Error("会员履约版本已变化");
      error.code = "MEMBERSHIP_REVISION_CONFLICT";
      throw error;
    }
    const terminal = ACTIVE_LOCK_TERMINAL_STATES.includes(nextState);
    db.prepare(`
      UPDATE membership_fulfillments
      SET state = ?, current_stage = ?, failure_code = ?, retry_at = ?,
          state_revision = state_revision + 1, updated_at = ?,
          completed_at = CASE WHEN ? THEN COALESCE(completed_at, ?) ELSE completed_at END
      WHERE id = ?
    `).run(
      nextState,
      options.currentStage ?? current.current_stage,
      options.failureCode ?? null,
      options.retryAt ?? null,
      at,
      terminal ? 1 : 0,
      at,
      id
    );
    const updated = db.prepare("SELECT * FROM membership_fulfillments WHERE id = ?").get(id);
    if (options.notify === true || nextState === "BROWSER_LEASE_WAIT") {
      appendOutbox(db, updated, "membership.available", at);
    }
    return updated;
  })();
}

export function projectMembershipDelivery(fulfillment, compensation = null) {
  if (!fulfillment) return null;
  const compensated = compensation && CUSTOMER_COMPENSATION_LABELS[compensation.resolution_type];
  let projection = { status: "processing", label: "处理中" };
  if (compensated) projection = compensated;
  else if (fulfillment.state === "CANCELLED") projection = { status: "cancelled", label: "卡密已作废" };
  else if (fulfillment.state === "COMPLETED") projection = { status: "succeeded", label: "交付成功" };
	else if (fulfillment.state === "SESSION_RECOVERY_REQUIRED") {
		projection = { status: "session_required", label: "需要重新提交 Session" };
	} else if (fulfillment.state === "SESSION_RECOVERY_RECONCILING") {
		projection = { status: "processing", label: "正在核对付款状态" };
	} else if (["SESSION_RECOVERY_EVIDENCE_HOLD", "EXECUTOR_OUTCOME_UNCERTAIN"].includes(fulfillment.state)) {
		projection = { status: "manual_review", label: "付款状态待人工核对" };
	}
  else if (fulfillment.state === "PARTIAL_FULFILLMENT_EXPIRED") {
    projection = { status: "after_sales", label: "售后处理中" };
  } else if ([
    "PARTIALLY_FULFILLED",
    "ACCOUNT_ALREADY_SUBSCRIBED",
    "PAYMENT_DECLINED"
  ].includes(fulfillment.state)) {
    projection = { status: "manual_review", label: "人工处理中" };
  }
  return Object.freeze({
    ...projection,
    targetTier: fulfillment.target_tier,
    updatedAt: compensation?.created_at || fulfillment.updated_at
  });
}

function leaseRow(db) {
  return db.prepare("SELECT * FROM browser_fulfillment_lease WHERE id = 'default'").get();
}

export function expireBrowserFulfillmentLease(db, options = {}) {
  const at = nowIso(options.at ?? Date.now());
  return db.transaction(() => {
    const lease = leaseRow(db);
    if (!lease || lease.state === "available" || !lease.expires_at || lease.expires_at > at) return lease;
    db.prepare(`
      UPDATE browser_fulfillment_lease
      SET fulfillment_id = NULL, installation_id = NULL, epoch = epoch + 1,
          state = 'available', heartbeat_at = NULL, expires_at = NULL, updated_at = ?
      WHERE id = 'default' AND epoch = ?
    `).run(at, lease.epoch);
    if (lease.fulfillment_id) {
      const fulfillment = db.prepare("SELECT * FROM membership_fulfillments WHERE id = ?").get(lease.fulfillment_id);
	  if (!fulfillment?.automation_enrolled_at) return leaseRow(db);
      if (fulfillment.browser_lease_epoch === lease.epoch
        && fulfillment.state === "INITIAL_CHECKOUT_PREFLIGHT") {
        db.prepare(`
          UPDATE membership_fulfillment_attempts
          SET ended_at = ?, outcome_code = 'BROWSER_LEASE_EXPIRED'
          WHERE id = (
            SELECT id FROM membership_fulfillment_attempts
            WHERE fulfillment_id = ? AND stage = 'plus' AND ended_at IS NULL
            ORDER BY attempt_no DESC LIMIT 1
          )
        `).run(at, fulfillment.id);
        db.prepare(`
          UPDATE membership_fulfillments
          SET state = 'BROWSER_LEASE_WAIT', browser_lease_epoch = NULL,
              failure_code = 'BROWSER_LEASE_EXPIRED', state_revision = state_revision + 1,
              updated_at = ?
          WHERE id = ?
        `).run(at, fulfillment.id);
        const updated = db.prepare("SELECT * FROM membership_fulfillments WHERE id = ?").get(fulfillment.id);
        appendOutbox(db, updated, "membership.available", at);
      } else if (fulfillment.browser_lease_epoch === lease.epoch) {
        const stageKey = fulfillment.current_stage === "upgrade" ? "upgrade" : "plus";
        const riskyPermit = db.prepare(`
          SELECT id FROM membership_action_permits
          WHERE fulfillment_id = ? AND stage_key = ? AND (
            action_type = 'submit'
            OR state IN ('issued', 'activated', 'outcome_uncertain', 'blocked', 'challenge_locked')
            OR (action_type = 'progression' AND NOT (
              state = 'reported' AND outcome_code = 'AUTHORIZATION_CLEAR'
            ))
          ) LIMIT 1
        `).get(fulfillment.id, stageKey);
        const contextLost = fulfillment.state === "PAYMENT_ACTION_REQUIRED";
        const uncertain = Boolean(riskyPermit) && !contextLost;
        const nextState = contextLost
          ? "ACTION_REQUIRED_CONTEXT_LOST"
          : (uncertain ? "PAYMENT_OUTCOME_UNCERTAIN" : "BROWSER_LEASE_WAIT");
        const failureCode = contextLost
          ? "ACTION_REQUIRED_CONTEXT_LOST"
          : (uncertain ? "BROWSER_LEASE_EXPIRED_AFTER_PERMIT" : "BROWSER_LEASE_EXPIRED");
        db.prepare(`
          UPDATE membership_material_grants
          SET invalidated_at = COALESCE(invalidated_at, ?)
          WHERE fulfillment_id = ? AND browser_lease_epoch = ?
        `).run(at, fulfillment.id, lease.epoch);
        db.prepare(`
          UPDATE live_canary_authorizations
          SET state = 'invalidated', invalidated_at = ?
          WHERE fulfillment_id = ? AND state = 'approved'
        `).run(at, fulfillment.id);
        db.prepare(`
          UPDATE membership_fulfillment_attempts
          SET ended_at = COALESCE(ended_at, ?),
              outcome_code = COALESCE(outcome_code, ?)
          WHERE fulfillment_id = ? AND stage = ? AND ended_at IS NULL
        `).run(at, failureCode, fulfillment.id, stageKey);
        if (!contextLost && !uncertain) {
          const stageState = stageKey === "plus"
            ? "checkout_pending"
            : (fulfillment.state === "UPGRADE_CHECKOUT_PREFLIGHT" ? "preflight_pending" : "checkout_pending");
          db.prepare(`
            UPDATE membership_payment_stages
            SET state = ?, attempt_no = NULL, page_fingerprint = NULL,
                page_permit_kind = NULL, page_control_id = NULL, page_ready_at = NULL,
                page_facts_json = NULL, updated_at = ?
            WHERE fulfillment_id = ? AND stage_key = ?
          `).run(stageState, at, fulfillment.id, stageKey);
        }
        db.prepare(`
          UPDATE membership_fulfillments
          SET state = ?, browser_lease_epoch = NULL, failure_code = ?,
              state_revision = state_revision + 1, updated_at = ?
          WHERE id = ? AND browser_lease_epoch = ?
        `).run(nextState, failureCode, at, fulfillment.id, lease.epoch);
        const updated = db.prepare("SELECT * FROM membership_fulfillments WHERE id = ?").get(fulfillment.id);
        if (nextState === "BROWSER_LEASE_WAIT") {
          appendOutbox(db, updated, "membership.available", at);
        } else {
          db.prepare(`
            INSERT OR IGNORE INTO fulfillment_interventions (
              id, fulfillment_id, state, state_revision, reason_code, created_at
            ) VALUES (?, ?, ?, ?, ?, ?)
          `).run(`fi_${randomUUID()}`, fulfillment.id, nextState, updated.state_revision, failureCode, at);
        }
      }
    }
    return leaseRow(db);
  })();
}

export function acquireBrowserFulfillmentLease(db, input = {}) {
  const fulfillmentId = requireFulfillmentId(input.fulfillmentId);
  const installationId = String(input.installationId || "").trim();
  if (!installationId || installationId.length > 200) throw new TypeError("扩展安装实例无效");
  const atMs = input.at instanceof Date ? input.at.getTime() : Number(input.at ?? Date.now());
  const at = nowIso(atMs);
  const ttlMs = Number.isFinite(input.ttlMs) ? Math.max(15_000, Math.min(5 * 60_000, input.ttlMs)) : browserFulfillmentLeaseTtlMs;
  const expiresAt = nowIso(atMs + ttlMs);
  expireBrowserFulfillmentLease(db, { at: atMs });
  return db.transaction(() => {
    const fulfillment = db.prepare("SELECT * FROM membership_fulfillments WHERE id = ?").get(fulfillmentId);
    if (!fulfillment) return { acquired: false, reason: "not_found" };
	if (!fulfillment.automation_enrolled_at) return { acquired: false, reason: "not_enrolled" };
    const lease = leaseRow(db);
    if (lease.state !== "available") {
      if (lease.fulfillment_id === fulfillmentId && lease.installation_id === installationId) {
        const attempt = db.prepare(`
          SELECT attempt_no FROM membership_fulfillment_attempts
          WHERE fulfillment_id = ? AND stage = 'plus'
          ORDER BY attempt_no DESC LIMIT 1
        `).get(fulfillmentId);
        return { acquired: true, lease, fulfillment, attemptNo: attempt?.attempt_no || 1, resumed: true };
      }
      return { acquired: false, reason: "busy", retryAt: lease.expires_at };
    }
    if (fulfillment.state !== "BROWSER_LEASE_WAIT") {
      return { acquired: false, reason: "state", state: fulfillment.state };
    }

    const nextEpoch = lease.epoch + 1;
    const changed = db.prepare(`
      UPDATE browser_fulfillment_lease
      SET fulfillment_id = ?, installation_id = ?, epoch = ?, state = 'leased',
          heartbeat_at = ?, expires_at = ?, updated_at = ?
      WHERE id = 'default' AND state = 'available' AND epoch = ?
    `).run(fulfillmentId, installationId, nextEpoch, at, expiresAt, at, lease.epoch).changes;
    if (changed !== 1) return { acquired: false, reason: "busy" };

    const attemptNo = db.prepare(`
      SELECT COALESCE(MAX(attempt_no), 0) + 1 AS attempt_no
      FROM membership_fulfillment_attempts
      WHERE fulfillment_id = ? AND stage = 'plus'
    `).get(fulfillmentId).attempt_no;
    db.prepare(`
      INSERT INTO membership_fulfillment_attempts (
        id, fulfillment_id, stage, attempt_no, resume_revision, adapter_version,
        price_contract_version, started_at
      ) VALUES (?, ?, 'plus', ?, ?, ?, ?, ?)
    `).run(
      `mfa_${randomUUID()}`,
      fulfillmentId,
      attemptNo,
      fulfillment.resume_revision,
      input.adapterVersion || membershipCheckoutAdapterVersion,
      input.priceContractVersion ?? null,
      at
    );
    db.prepare(`
      UPDATE membership_fulfillments
      SET state = 'INITIAL_CHECKOUT_PREFLIGHT', current_stage = 'plus',
          browser_lease_epoch = ?, state_revision = state_revision + 1,
          failure_code = NULL, updated_at = ?
      WHERE id = ? AND state = 'BROWSER_LEASE_WAIT'
    `).run(nextEpoch, at, fulfillmentId);
    return {
      acquired: true,
      lease: leaseRow(db),
      fulfillment: db.prepare("SELECT * FROM membership_fulfillments WHERE id = ?").get(fulfillmentId),
      attemptNo,
      resumed: false
    };
  })();
}

export function acquirePaymentBrowserFulfillmentLease(db, input = {}) {
  const fulfillmentId = requireFulfillmentId(input.fulfillmentId);
  const installationId = String(input.installationId || "").trim();
  if (!installationId || installationId.length > 200) throw new TypeError("扩展安装实例无效");
  const atMs = input.at instanceof Date ? input.at.getTime() : Number(input.at ?? Date.now());
  const at = nowIso(atMs);
  const ttlMs = Number.isFinite(input.ttlMs)
    ? Math.max(15_000, Math.min(5 * 60_000, input.ttlMs))
    : browserFulfillmentLeaseTtlMs;
  const expiresAt = nowIso(atMs + ttlMs);
  expireBrowserFulfillmentLease(db, { at: atMs });
  return db.transaction(() => {
    const fulfillment = db.prepare("SELECT * FROM membership_fulfillments WHERE id = ?").get(fulfillmentId);
	if (fulfillment && !fulfillment.automation_enrolled_at) {
	  return { acquired: false, reason: "not_enrolled", state: fulfillment.state };
	}
    const stageKey = fulfillment?.current_stage === "upgrade" ? "upgrade" : "plus";
    const stage = db.prepare(`
      SELECT stage.*, contract.version AS contract_version
      FROM membership_payment_stages stage
      JOIN checkout_price_contracts contract ON contract.id = stage.price_contract_id
      WHERE stage.fulfillment_id = ? AND stage.stage_key = ?
    `).get(fulfillmentId, stageKey);
    if (!fulfillment || !stage || !["canary", "automatic"].includes(fulfillment.run_mode)
      || !["checkout_pending", "preflight_pending"].includes(stage.state) || !stage.card_id) {
      return { acquired: false, reason: "state", state: fulfillment?.state || null };
    }
    const lease = leaseRow(db);
    if (lease.state !== "available") {
      if (lease.fulfillment_id === fulfillmentId && lease.installation_id === installationId
        && fulfillment.browser_lease_epoch === lease.epoch) {
        return { acquired: true, lease, fulfillment, attemptNo: stage.attempt_no, resumed: true };
      }
      return { acquired: false, reason: "busy", retryAt: lease.expires_at };
    }
    if (fulfillment.state !== "BROWSER_LEASE_WAIT") {
      return { acquired: false, reason: "state", state: fulfillment.state };
    }
    const nextEpoch = lease.epoch + 1;
    const changed = db.prepare(`
      UPDATE browser_fulfillment_lease
      SET fulfillment_id = ?, installation_id = ?, epoch = ?, state = 'leased',
          heartbeat_at = ?, expires_at = ?, updated_at = ?
      WHERE id = 'default' AND state = 'available' AND epoch = ?
    `).run(fulfillmentId, installationId, nextEpoch, at, expiresAt, at, lease.epoch).changes;
    if (changed !== 1) return { acquired: false, reason: "busy" };
    const attemptNo = db.prepare(`
      SELECT COALESCE(MAX(attempt_no), 0) + 1 AS attempt_no
      FROM membership_fulfillment_attempts
      WHERE fulfillment_id = ? AND stage = ?
    `).get(fulfillmentId, stageKey).attempt_no;
    const preflight = stageKey === "upgrade" && stage.state === "preflight_pending";
    const adapterVersion = preflight ? "plan-management-v1" : (input.adapterVersion || membershipCheckoutAdapterVersion);
    const nextState = stageKey === "plus"
      ? "PLUS_CHECKOUT_READY"
      : (preflight ? "UPGRADE_CHECKOUT_PREFLIGHT" : "UPGRADE_CHECKOUT_READY");
    const nextStageState = preflight ? "preflight_ready" : "checkout_ready";
    db.prepare(`
      INSERT INTO membership_fulfillment_attempts (
        id, fulfillment_id, stage, attempt_no, resume_revision, adapter_version,
        price_contract_version, started_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      `mfa_${randomUUID()}`,
      fulfillmentId,
      stageKey,
      attemptNo,
      fulfillment.resume_revision,
      adapterVersion,
      stage.contract_version,
      at
    );
    db.prepare(`
      UPDATE membership_payment_stages
      SET state = ?, attempt_no = ?, adapter_version = ?,
          adapter_path = COALESCE(adapter_path, ?), page_fingerprint = NULL,
          page_permit_kind = NULL, page_control_id = NULL, page_ready_at = NULL,
          page_facts_json = NULL, updated_at = ?
      WHERE id = ? AND state = ?
    `).run(
      nextStageState,
      attemptNo,
      adapterVersion,
      preflight ? "plan-management-v1+checkout-v1" : "checkout-v1",
      at,
      stage.id,
      stage.state
    );
    db.prepare(`
      UPDATE membership_fulfillments
      SET state = ?, current_stage = ?,
          browser_lease_epoch = ?, state_revision = state_revision + 1,
          failure_code = NULL, retry_at = NULL, updated_at = ?
      WHERE id = ? AND state = 'BROWSER_LEASE_WAIT'
    `).run(nextState, stageKey, nextEpoch, at, fulfillmentId);
    return {
      acquired: true,
      lease: leaseRow(db),
      fulfillment: db.prepare("SELECT * FROM membership_fulfillments WHERE id = ?").get(fulfillmentId),
      attemptNo,
      resumed: false
    };
  })();
}

export function heartbeatBrowserFulfillmentLease(db, input = {}) {
  const fulfillmentId = requireFulfillmentId(input.fulfillmentId);
  const installationId = String(input.installationId || "").trim();
  const epoch = Number(input.epoch);
  const atMs = input.at instanceof Date ? input.at.getTime() : Number(input.at ?? Date.now());
  const at = nowIso(atMs);
  const expiresAt = nowIso(atMs + (Number.isFinite(input.ttlMs) ? input.ttlMs : browserFulfillmentLeaseTtlMs));
  const changed = db.prepare(`
    UPDATE browser_fulfillment_lease
    SET heartbeat_at = ?, expires_at = ?, updated_at = ?
    WHERE id = 'default' AND state = 'leased' AND fulfillment_id = ?
      AND installation_id = ? AND epoch = ? AND expires_at > ?
  `).run(at, expiresAt, at, fulfillmentId, installationId, epoch, at).changes;
  return changed === 1 ? leaseRow(db) : null;
}

export function releaseBrowserFulfillmentLease(db, input = {}) {
  const fulfillmentId = requireFulfillmentId(input.fulfillmentId);
  const installationId = String(input.installationId || "").trim();
  const epoch = Number(input.epoch);
  const at = nowIso(input.at ?? Date.now());
  const outcome = input.outcome || "wait";
  if (!["recognized", "unsupported", "wait"].includes(outcome)) throw new TypeError("浏览器释放结果无效");
  return db.transaction(() => {
    const lease = leaseRow(db);
    if (lease.state !== "leased" || lease.fulfillment_id !== fulfillmentId
      || lease.installation_id !== installationId || lease.epoch !== epoch) return null;
    const nextState = outcome === "recognized"
      ? "FUNDING_READY"
      : (outcome === "unsupported" ? "CHECKOUT_UI_UNSUPPORTED" : "BROWSER_LEASE_WAIT");
    const failureCode = outcome === "recognized"
      ? "MEMBERSHIP_PAYMENT_GATE_LOCKED"
      : (outcome === "unsupported" ? "CHECKOUT_UI_UNSUPPORTED" : null);
    db.prepare(`
      UPDATE membership_fulfillments
      SET state = ?, current_stage = 'plus', browser_lease_epoch = NULL,
          failure_code = ?, state_revision = state_revision + 1, updated_at = ?
      WHERE id = ? AND browser_lease_epoch = ?
    `).run(nextState, failureCode, at, fulfillmentId, epoch);
    db.prepare(`
      UPDATE membership_fulfillment_attempts
      SET ended_at = ?, outcome_code = ?
      WHERE id = (
        SELECT id FROM membership_fulfillment_attempts
        WHERE fulfillment_id = ? AND stage = 'plus' AND ended_at IS NULL
        ORDER BY attempt_no DESC LIMIT 1
      )
    `).run(at, outcome === "recognized" ? "PREFLIGHT_RECOGNIZED" : (outcome === "unsupported" ? "PREFLIGHT_UNSUPPORTED" : "LEASE_RELEASED"), fulfillmentId);
    db.prepare(`
      UPDATE browser_fulfillment_lease
      SET fulfillment_id = NULL, installation_id = NULL, epoch = epoch + 1,
          state = 'available', heartbeat_at = NULL, expires_at = NULL, updated_at = ?
      WHERE id = 'default' AND epoch = ?
    `).run(at, epoch);
    const updated = db.prepare("SELECT * FROM membership_fulfillments WHERE id = ?").get(fulfillmentId);
    if (nextState === "BROWSER_LEASE_WAIT") appendOutbox(db, updated, "membership.available", at);
    return { lease: leaseRow(db), fulfillment: updated };
  })();
}

export function sanitizeAndReleaseBrowserFulfillmentLease(db, input = {}) {
  const fulfillmentId = requireFulfillmentId(input.fulfillmentId);
  const installationId = String(input.installationId || "").trim();
  const epoch = Number(input.epoch);
  const at = nowIso(input.at ?? Date.now());
  return db.transaction(() => {
    const lease = leaseRow(db);
    if (lease.state !== "leased" || lease.fulfillment_id !== fulfillmentId
      || lease.installation_id !== installationId || lease.epoch !== epoch) return null;
    db.prepare(`
      UPDATE membership_material_grants
      SET invalidated_at = COALESCE(invalidated_at, ?)
      WHERE fulfillment_id = ? AND browser_lease_epoch = ?
    `).run(at, fulfillmentId, epoch);
    db.prepare(`
      UPDATE membership_action_permits
      SET state = CASE WHEN state = 'issued' THEN 'invalidated' ELSE state END,
          reported_at = CASE WHEN state = 'issued' THEN COALESCE(reported_at, ?) ELSE reported_at END,
          outcome_code = CASE WHEN state = 'issued' THEN 'CONTEXT_SANITIZED' ELSE outcome_code END
      WHERE fulfillment_id = ? AND browser_lease_epoch = ?
    `).run(at, fulfillmentId, epoch);
    db.prepare(`
      UPDATE membership_fulfillments
      SET browser_lease_epoch = NULL, state_revision = state_revision + 1, updated_at = ?
      WHERE id = ? AND browser_lease_epoch = ?
    `).run(at, fulfillmentId, epoch);
    db.prepare(`
      UPDATE browser_fulfillment_lease
      SET fulfillment_id = NULL, installation_id = NULL, epoch = epoch + 1,
          state = 'available', heartbeat_at = NULL, expires_at = NULL, updated_at = ?
      WHERE id = 'default' AND epoch = ?
    `).run(at, epoch);
    return Object.freeze({
      lease: leaseRow(db),
      fulfillment: db.prepare("SELECT * FROM membership_fulfillments WHERE id = ?").get(fulfillmentId)
    });
  })();
}
