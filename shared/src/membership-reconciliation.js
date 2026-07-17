import { randomUUID } from "node:crypto";
import {
  isStrictMembershipStageConfirmed,
  matchPaymentTransactionDelta,
  selectCanonicalCardTransactionState
} from "./membership-fulfillment.js";
import { fetchMembershipObservation } from "./membership-state-provider.js";
import { recordMembershipNoPaymentCheckpoint } from "./membership-actions.js";

const RECONCILE_RETRY_MS = 30_000;
const PARTIAL_RENEWAL_GUARD_MS = 72 * 60 * 60_000;

export class MembershipReconciliationError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = "MembershipReconciliationError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new MembershipReconciliationError(code, message);
}

function iso(value = Date.now()) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new TypeError("时间无效");
  return date.toISOString();
}

function stageKey(value) {
  if (value !== "plus" && value !== "upgrade") throw new TypeError("支付阶段无效");
  return value;
}

function safeId(value, label = "ID") {
  const normalized = String(value || "").trim();
  if (!/^[A-Za-z0-9._:-]{1,256}$/.test(normalized)) throw new TypeError(`${label} 无效`);
  return normalized;
}

function foldTransactions(events) {
  if (!Array.isArray(events) || events.length > 10_000) throw new TypeError("交易列表无效");
  const byAuth = new Map();
  for (const event of events) {
    const authId = safeId(event?.authId, "授权 ID");
    const current = byAuth.get(authId) || {
      authId,
      authTime: event.authTime || null,
      authAmount: 0,
      authCurrency: null,
      settleAmount: 0,
      settleCurrency: null,
      type: String(event.type || ""),
      status: String(event.status || "").toUpperCase(),
      merchantNormalized: String(event.merchantNormalized || "OTHER").toUpperCase(),
      authorizationSeen: 0,
      settlementSeen: 0,
      refundSeen: 0,
      reversalSeen: 0,
      declineReasonCode: event.declineReasonCode || null
    };
    current.authTime ||= event.authTime || null;
    if (Number(event.authAmount) > 0) current.authAmount = Number(event.authAmount);
    if (event.authCurrency) current.authCurrency = String(event.authCurrency).toUpperCase();
    if (Number(event.settleAmount) > 0) current.settleAmount = Number(event.settleAmount);
    if (event.settleCurrency) current.settleCurrency = String(event.settleCurrency).toUpperCase();
    if (String(event.merchantNormalized).toUpperCase() === "OPENAI") current.merchantNormalized = "OPENAI";
    if (event.type === "Authorization") current.authorizationSeen = 1;
    if (event.type === "Settlement") current.settlementSeen = 1;
    if (event.type === "Refund") current.refundSeen = 1;
    if (event.type === "Reversal") current.reversalSeen = 1;
    current.declineReasonCode ||= event.declineReasonCode || null;
    const canonical = selectCanonicalCardTransactionState(current, event);
    current.type = canonical.type;
    current.status = canonical.status;
    byAuth.set(authId, current);
  }
  return [...byAuth.values()];
}

export function persistManagedCardTransactions(db, cardIdValue, events, options = {}) {
  const cardId = safeId(cardIdValue, "卡片 ID");
  const at = iso(options.at);
  const rows = foldTransactions(events);
  db.transaction(() => {
    const insert = db.prepare(`
      INSERT INTO managed_card_transactions (
        card_id, auth_id, auth_time, auth_amount, auth_currency, settle_amount,
        settle_currency, type, status, merchant_normalized, authorization_seen,
        settlement_seen, refund_seen, reversal_seen, decline_reason_code,
        first_seen_at, last_seen_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(card_id, auth_id) DO UPDATE SET
        auth_time = COALESCE(excluded.auth_time, managed_card_transactions.auth_time),
        auth_amount = CASE WHEN excluded.auth_amount > 0 THEN excluded.auth_amount ELSE managed_card_transactions.auth_amount END,
        auth_currency = COALESCE(excluded.auth_currency, managed_card_transactions.auth_currency),
        settle_amount = CASE WHEN excluded.settle_amount > 0 THEN excluded.settle_amount ELSE managed_card_transactions.settle_amount END,
        settle_currency = COALESCE(excluded.settle_currency, managed_card_transactions.settle_currency),
        type = excluded.type,
        status = excluded.status,
        merchant_normalized = CASE WHEN excluded.merchant_normalized = 'OPENAI' THEN 'OPENAI' ELSE managed_card_transactions.merchant_normalized END,
        authorization_seen = MAX(managed_card_transactions.authorization_seen, excluded.authorization_seen),
        settlement_seen = MAX(managed_card_transactions.settlement_seen, excluded.settlement_seen),
        refund_seen = MAX(managed_card_transactions.refund_seen, excluded.refund_seen),
        reversal_seen = MAX(managed_card_transactions.reversal_seen, excluded.reversal_seen),
        decline_reason_code = COALESCE(excluded.decline_reason_code, managed_card_transactions.decline_reason_code),
        last_seen_at = excluded.last_seen_at
    `);
    for (const row of rows) {
      insert.run(
        cardId,
        row.authId,
        row.authTime,
        row.authAmount,
        row.authCurrency,
        row.settleAmount,
        row.settleCurrency,
        row.type,
        row.status,
        row.merchantNormalized,
        row.authorizationSeen,
        row.settlementSeen,
        row.refundSeen,
        row.reversalSeen,
        row.declineReasonCode,
        at,
        at
      );
    }
    db.prepare(`
      UPDATE managed_cards SET last_transaction_sync_at = ?, updated_at = ? WHERE id = ?
    `).run(at, at, cardId);
  })();
  return Object.freeze(rows.map((row) => Object.freeze({ ...row })));
}

function persistObservation(db, fulfillmentId, key, observation, purpose, at) {
  const id = `mfo_${randomUUID()}`;
  db.prepare(`
    INSERT INTO membership_observations (
      id, fulfillment_id, stage_key, purpose, provider_code, account_type,
      currency, auto_renew, is_overdue, is_delinquent, expire_time, observed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    fulfillmentId,
    key,
    purpose,
    observation.providerCode,
    observation.accountType,
    observation.currency,
    observation.autoRenew === null ? null : (observation.autoRenew ? 1 : 0),
    observation.isOverdue ? 1 : 0,
    observation.isDelinquent ? 1 : 0,
    observation.expireTime,
    observation.observedAt || at
  );
  return id;
}

export function getMembershipStageAuthorizationSnapshot(db, fulfillmentIdValue, stageKeyValue) {
  const fulfillmentId = safeId(fulfillmentIdValue, "履约 ID");
  const key = stageKey(stageKeyValue);
  const permit = db.prepare(`
    SELECT id FROM membership_action_permits
    WHERE fulfillment_id = ? AND stage_key = ? AND action_type = 'submit'
    ORDER BY sequence_no DESC LIMIT 1
  `).get(fulfillmentId, key);
  if (!permit) fail("SUBMIT_AUTH_SNAPSHOT_MISSING", "缺少提交前授权快照");
  const authIds = db.prepare(`
    SELECT auth_id FROM membership_action_auth_snapshots
    WHERE permit_id = ? ORDER BY auth_id
  `).all(permit.id).map((row) => row.auth_id);
  return Object.freeze({ permitId: permit.id, authIds: Object.freeze(authIds) });
}

function intervention(db, fulfillmentId, state, revision, reasonCode, at) {
  db.prepare(`
    INSERT OR IGNORE INTO fulfillment_interventions (
      id, fulfillment_id, state, state_revision, reason_code, created_at
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run(`fi_${randomUUID()}`, fulfillmentId, state, revision, reasonCode, at);
}

function transition(db, fulfillment, state, options = {}) {
  const at = options.at;
  db.prepare(`
    UPDATE membership_fulfillments
    SET state = ?, current_stage = ?, failure_code = ?, retry_at = ?,
        state_revision = state_revision + 1, updated_at = ?,
        completed_at = CASE WHEN ? = 'COMPLETED' THEN COALESCE(completed_at, ?) ELSE completed_at END
    WHERE id = ?
  `).run(
    state,
    options.currentStage ?? fulfillment.current_stage,
    options.failureCode ?? null,
    options.retryAt ?? null,
    at,
    state,
    at,
    fulfillment.id
  );
  return db.prepare("SELECT * FROM membership_fulfillments WHERE id = ?").get(fulfillment.id);
}

function membershipRemainsPreStage(observation, key) {
  if (key === "plus") {
    return observation?.accountType === "free"
      && observation.isOverdue === false && observation.isDelinquent === false;
  }
  return isStrictMembershipStageConfirmed(observation, "plus");
}

export function reconcileMembershipPaymentStage(db, input = {}) {
  const fulfillmentId = safeId(input.fulfillmentId, "履约 ID");
  const key = stageKey(input.stageKey);
  const atMs = new Date(input.at ?? Date.now()).getTime();
  const at = iso(atMs);
  if (!input.observation || typeof input.observation !== "object") throw new TypeError("会员观察无效");

  return db.transaction(() => {
    const fulfillment = db.prepare("SELECT * FROM membership_fulfillments WHERE id = ?").get(fulfillmentId);
    const stage = db.prepare(`
      SELECT * FROM membership_payment_stages WHERE fulfillment_id = ? AND stage_key = ?
    `).get(fulfillmentId, key);
    if (!fulfillment || !stage?.card_id || !Number.isFinite(Number(stage.price_signal_min))
      || !Number.isFinite(Number(stage.price_signal_max))) {
      fail("PAYMENT_STAGE_EVIDENCE_INCOMPLETE", "支付阶段证据配置不完整");
    }
    const snapshot = getMembershipStageAuthorizationSnapshot(db, fulfillmentId, key);
    const transactions = persistManagedCardTransactions(db, stage.card_id, input.transactions, { at });
    const matched = matchPaymentTransactionDelta({
      beforeAuthIds: snapshot.authIds,
      transactions,
      tier: stage.expected_tier,
      minUsd: Number(stage.price_signal_min),
      maxUsd: Number(stage.price_signal_max)
    });
    const observationId = persistObservation(
      db,
      fulfillmentId,
      key,
      input.observation,
      `payment_${key}_reconciliation`,
      at
    );

    if (matched.outcome === "matched") {
      const expectedTier = key === "plus" ? "plus" : fulfillment.target_tier;
      if (!isStrictMembershipStageConfirmed(input.observation, expectedTier)) {
        const waiting = transition(db, fulfillment, key === "plus" ? "PLUS_RECONCILING" : "UPGRADE_RECONCILING", {
          currentStage: key,
          failureCode: "MEMBERSHIP_NOT_YET_CONFIRMED",
          retryAt: iso(atMs + RECONCILE_RETRY_MS),
          at
        });
        return Object.freeze({ outcome: "waiting_membership", state: waiting.state, matchedAuthId: null });
      }
      if (stage.matched_auth_id && stage.matched_auth_id !== matched.transaction.authId) {
        fail("PAYMENT_MATCH_CONFLICT", "支付阶段已绑定另一笔授权");
      }
      db.prepare(`
        UPDATE membership_payment_stages
        SET state = 'confirmed', matched_auth_id = ?, settlement_state = ?,
            membership_observation_id = ?, confirmed_at = COALESCE(confirmed_at, ?), updated_at = ?
        WHERE id = ?
      `).run(
        matched.transaction.authId,
        matched.transaction.status,
        observationId,
        at,
        at,
        stage.id
      );
      db.prepare(`
        UPDATE membership_action_permits
        SET state = 'reported', reported_at = COALESCE(reported_at, ?),
            outcome_code = 'PAYMENT_CONFIRMED'
        WHERE fulfillment_id = ? AND stage_key = ? AND action_type = 'submit'
          AND state IN ('activated', 'challenge_locked', 'outcome_uncertain')
      `).run(at, fulfillmentId, key);
      db.prepare(`
        UPDATE card_capacity_reservations
        SET state = 'consumed', consumed_at = COALESCE(consumed_at, ?)
        WHERE fulfillment_id = ? AND state = 'reserved'
      `).run(at, fulfillmentId);
      const nextState = key === "plus" && fulfillment.target_tier !== "plus"
        ? "PLUS_CONFIRMED"
        : "FINAL_TIER_CONFIRMED";
      const updated = transition(db, fulfillment, nextState, {
        currentStage: key,
        at
      });
      return Object.freeze({
        outcome: "confirmed",
        state: updated.state,
        matchedAuthId: matched.transaction.authId,
        settlementState: matched.transaction.status,
        observationId
      });
    }

    if (matched.outcome === "declined" && membershipRemainsPreStage(input.observation, key)) {
      const nextState = key === "upgrade" ? "PARTIALLY_FULFILLED" : "PAYMENT_DECLINED";
      db.prepare(`
        UPDATE membership_payment_stages
        SET state = 'declined', matched_auth_id = ?, settlement_state = 'DECLINED',
            membership_observation_id = ?, updated_at = ? WHERE id = ?
      `).run(matched.transaction.authId, observationId, at, stage.id);
      db.prepare(`
        UPDATE membership_action_permits
        SET state = 'reported', reported_at = COALESCE(reported_at, ?),
            outcome_code = 'PAYMENT_DECLINED_CONFIRMED'
        WHERE fulfillment_id = ? AND stage_key = ? AND action_type = 'submit'
          AND state IN ('activated', 'challenge_locked', 'outcome_uncertain')
      `).run(at, fulfillmentId, key);
      if (key === "upgrade") {
        db.prepare(`
          UPDATE card_capacity_reservations SET state = 'retained_partial'
          WHERE fulfillment_id = ? AND state IN ('reserved', 'consumed')
        `).run(fulfillmentId);
      }
      const updated = transition(db, fulfillment, nextState, {
        currentStage: key,
        failureCode: "PAYMENT_DECLINED",
        at
      });
      intervention(db, fulfillmentId, nextState, updated.state_revision, "PAYMENT_DECLINED", at);
      return Object.freeze({ outcome: "declined", state: updated.state, matchedAuthId: matched.transaction.authId });
    }

    const reason = matched.reason || "PAYMENT_MEMBERSHIP_MISMATCH";
    const updated = transition(db, fulfillment, "PAYMENT_OUTCOME_UNCERTAIN", {
      currentStage: key,
      failureCode: reason,
      retryAt: iso(atMs + 5 * 60_000),
      at
    });
    intervention(db, fulfillmentId, updated.state, updated.state_revision, reason, at);
    return Object.freeze({ outcome: "uncertain", state: updated.state, reason });
  })();
}

export function shouldCancelPartialMembershipRenewal(observation, options = {}) {
  const nowMs = new Date(options.at ?? Date.now()).getTime();
  const expireMs = Date.parse(observation?.expireTime || "");
  return observation?.accountType === "plus"
    && observation.autoRenew === true
    && Number.isFinite(expireMs)
    && expireMs - nowMs <= PARTIAL_RENEWAL_GUARD_MS;
}

export function applyMembershipRenewalObservation(db, input = {}) {
  const fulfillmentId = safeId(input.fulfillmentId, "履约 ID");
  const atMs = new Date(input.at ?? Date.now()).getTime();
  const at = iso(atMs);
  const observation = input.observation;
  if (!observation || typeof observation !== "object") throw new TypeError("会员观察无效");
  return db.transaction(() => {
    const fulfillment = db.prepare("SELECT * FROM membership_fulfillments WHERE id = ?").get(fulfillmentId);
    if (!fulfillment) fail("MEMBERSHIP_FULFILLMENT_NOT_FOUND", "会员履约不存在");
    const partial = fulfillment.state === "PARTIALLY_FULFILLED";
    const expectedTier = partial ? "plus" : fulfillment.target_tier;
    const observationId = persistObservation(
      db,
      fulfillmentId,
      partial ? "plus" : (fulfillment.target_tier === "plus" ? "plus" : "upgrade"),
      observation,
      partial ? "partial_renewal_guard" : "final_renewal_guard",
      at
    );
    if (!isStrictMembershipStageConfirmed(observation, expectedTier)) {
      if (partial && (observation.accountType === "free"
        || (observation.accountType === "plus" && observation.expireTimeFuture === false))) {
        const expired = transition(db, fulfillment, "PARTIAL_FULFILLMENT_EXPIRED", {
          currentStage: "renewal",
          failureCode: "PARTIAL_MEMBERSHIP_EXPIRED",
          at
        });
        intervention(db, fulfillmentId, expired.state, expired.state_revision, "PARTIAL_MEMBERSHIP_EXPIRED", at);
        return Object.freeze({ state: expired.state, observationId, renewalDisabled: false });
      }
      const uncertain = transition(db, fulfillment, "PAYMENT_OUTCOME_UNCERTAIN", {
        currentStage: "renewal",
        failureCode: "FINAL_MEMBERSHIP_CHANGED",
        retryAt: iso(atMs + RECONCILE_RETRY_MS),
        at
      });
      intervention(db, fulfillmentId, uncertain.state, uncertain.state_revision, "FINAL_MEMBERSHIP_CHANGED", at);
      return Object.freeze({ state: uncertain.state, observationId, renewalDisabled: false });
    }
    if (observation.autoRenew !== false) {
      const waiting = partial
        ? transition(db, fulfillment, "PARTIALLY_FULFILLED", {
            currentStage: "renewal",
            failureCode: "PARTIAL_RENEWAL_STILL_ENABLED",
            retryAt: iso(atMs + 60 * 60_000),
            at
          })
        : transition(db, fulfillment, "RENEWAL_CANCELLING", {
            currentStage: "renewal",
            failureCode: "RENEWAL_STILL_ENABLED",
            retryAt: iso(atMs + RECONCILE_RETRY_MS),
            at
          });
      return Object.freeze({ state: waiting.state, observationId, renewalDisabled: false });
    }
    if (partial) {
      const retained = transition(db, fulfillment, "PARTIALLY_FULFILLED", {
        currentStage: "renewal",
        failureCode: "UPGRADE_NOT_COMPLETED",
        retryAt: observation.expireTime || iso(atMs + 60 * 60_000),
        at
      });
      return Object.freeze({ state: retained.state, observationId, renewalDisabled: true });
    }
    const completed = transition(db, fulfillment, "COMPLETED", {
      currentStage: "renewal",
      at
    });
    const finalStageKey = fulfillment.target_tier === "plus" ? "plus" : "upgrade";
    db.prepare(`
      UPDATE membership_payment_stages
      SET membership_observation_id = ?, updated_at = ?
      WHERE fulfillment_id = ? AND stage_key = ? AND state = 'confirmed'
    `).run(observationId, at, fulfillmentId, finalStageKey);
    db.prepare(`
      UPDATE membership_fulfillment_attempts
      SET ended_at = COALESCE(ended_at, ?), outcome_code = COALESCE(outcome_code, 'COMPLETED')
      WHERE fulfillment_id = ? AND ended_at IS NULL
    `).run(at, fulfillmentId);
    return Object.freeze({ state: completed.state, observationId, renewalDisabled: true });
  })();
}

export function countMembershipUnresolvedOutcomes(db, fulfillmentIdValue) {
  const fulfillmentId = safeId(fulfillmentIdValue, "履约 ID");
  const fulfillment = db.prepare("SELECT state, failure_code FROM membership_fulfillments WHERE id = ?")
    .get(fulfillmentId);
  if (!fulfillment) fail("MEMBERSHIP_FULFILLMENT_NOT_FOUND", "会员履约不存在");
  let count = fulfillment.failure_code ? 1 : 0;
  count += Number(db.prepare(`
    SELECT COUNT(*) AS count FROM funding_intents
    WHERE fulfillment_id = ? AND state <> 'succeeded'
  `).get(fulfillmentId).count || 0);
  count += Number(db.prepare(`
    SELECT COUNT(*) AS count FROM membership_action_permits
    WHERE fulfillment_id = ? AND state IN ('outcome_uncertain', 'blocked', 'challenge_locked')
  `).get(fulfillmentId).count || 0);
  count += Number(db.prepare(`
    SELECT COUNT(*) AS count
    FROM membership_payment_stages stage
    JOIN managed_card_transactions tx
      ON tx.card_id = stage.card_id AND tx.auth_id = stage.matched_auth_id
    WHERE stage.fulfillment_id = ?
      AND (tx.refund_seen = 1 OR tx.reversal_seen = 1 OR tx.status IN ('DECLINED', 'REFUNDED', 'REVERSED'))
  `).get(fulfillmentId).count || 0);
  return count;
}

function checkpointFacts(snapshot, transactions, observation, key) {
  const before = new Set(snapshot.authIds);
  const newlySeen = transactions.filter((item) => !before.has(String(item.authId)));
  const effective = newlySeen.some((item) => String(item.merchantNormalized).toUpperCase() === "OPENAI"
    && ["PENDING", "COMPLETE"].includes(String(item.status).toUpperCase())
    && !["Refund", "Reversal"].includes(item.type));
  const pending = newlySeen.some((item) => String(item.status).toUpperCase() === "PENDING"
    || item.type === "Authorization");
  return {
    membershipUnchanged: membershipRemainsPreStage(observation, key),
    noEffectiveTransaction: !effective,
    noPendingAuthorization: !pending
  };
}

function recordDueNoPaymentChecks(db, fulfillmentId, key, stage, snapshot, transactions, observation, atMs) {
  const elapsed = atMs - Date.parse(stage.submit_permitted_at || "");
  if (!Number.isFinite(elapsed) || elapsed < 5 * 60_000) return;
  const facts = checkpointFacts(snapshot, transactions, observation, key);
  for (const [checkpoint, threshold] of [["5m", 5 * 60_000], ["1h", 60 * 60_000], ["24h", 24 * 60 * 60_000]]) {
    if (elapsed < threshold) continue;
    const exists = db.prepare(`
      SELECT id FROM membership_no_payment_checks
      WHERE fulfillment_id = ? AND stage_key = ? AND checkpoint = ?
    `).get(fulfillmentId, key, checkpoint);
    if (!exists) recordMembershipNoPaymentCheckpoint(db, {
      fulfillmentId,
      stageKey: key,
      checkpoint,
      facts,
      observedAt: iso(atMs)
    });
  }
}

export function refreshMembershipStageSettlement(db, input = {}) {
  const fulfillmentId = safeId(input.fulfillmentId, "履约 ID");
  const key = stageKey(input.stageKey);
  const at = iso(input.at);
  return db.transaction(() => {
    const stage = db.prepare(`
      SELECT * FROM membership_payment_stages
      WHERE fulfillment_id = ? AND stage_key = ?
    `).get(fulfillmentId, key);
    if (!stage?.matched_auth_id || !stage.card_id) fail("PAYMENT_STAGE_EVIDENCE_INCOMPLETE");
    persistManagedCardTransactions(db, stage.card_id, input.transactions, { at });
    const transaction = db.prepare(`
      SELECT * FROM managed_card_transactions WHERE card_id = ? AND auth_id = ?
    `).get(stage.card_id, stage.matched_auth_id);
    if (!transaction) fail("PAYMENT_MATCH_MISSING");
    if (transaction.status === "COMPLETE" && transaction.refund_seen === 0 && transaction.reversal_seen === 0) {
      db.prepare(`
        UPDATE membership_payment_stages SET settlement_state = 'COMPLETE', updated_at = ? WHERE id = ?
      `).run(at, stage.id);
      return Object.freeze({ settlementState: "COMPLETE", reviewed: false });
    }
    if (transaction.status === "PENDING" && transaction.refund_seen === 0 && transaction.reversal_seen === 0) {
      return Object.freeze({ settlementState: "PENDING", reviewed: false });
    }
    const fulfillment = db.prepare("SELECT * FROM membership_fulfillments WHERE id = ?").get(fulfillmentId);
    const updated = transition(db, fulfillment, "PAYMENT_OUTCOME_UNCERTAIN", {
      currentStage: key,
      failureCode: "POST_COMPLETION_TRANSACTION_CHANGED",
      at
    });
    intervention(db, fulfillmentId, updated.state, updated.state_revision, "POST_COMPLETION_TRANSACTION_CHANGED", at);
    return Object.freeze({ settlementState: transaction.status, reviewed: true });
  })();
}

export function createMembershipReconciliationRunner(options = {}) {
  const {
    db,
    decryptText,
    clientFactory,
    membershipFetcher = fetchMembershipObservation,
    cancelRenewal,
    getRenewalToken,
    now = () => new Date(),
    logger = console
  } = options;
  if (!db || typeof decryptText !== "function" || typeof clientFactory !== "function") {
    throw new TypeError("会员对账 Runner 配置不完整");
  }
  let running = false;

  function nowMs() {
    const value = now();
    const ms = value instanceof Date ? value.getTime() : Number(value);
    if (!Number.isFinite(ms)) throw new TypeError("Runner 时间无效");
    return ms;
  }

  async function allTransactions(card) {
    const client = clientFactory();
    const all = [];
    for (let page = 1; page <= 100; page += 1) {
      const rows = await client.listTransactions(card.upstream_card_id, { page, pageSize: 50 });
      all.push(...rows);
      if (rows.length < 50) return all;
    }
    fail("CARD_TRANSACTION_PAGINATION_EXCEEDED");
  }

  function sessionFor(fulfillmentId) {
    const row = db.prepare(`
      SELECT o.session_payload
      FROM membership_fulfillments f JOIN redeem_orders o ON o.id = f.order_id
      WHERE f.id = ?
    `).get(fulfillmentId);
    try { return JSON.parse(decryptText(row?.session_payload)); } catch { fail("SESSION_INVALID"); }
  }

  function stageFor(fulfillment) {
    const key = fulfillment.current_stage === "upgrade" || fulfillment.state.startsWith("UPGRADE_")
      ? "upgrade"
      : "plus";
    return {
      key,
      row: db.prepare(`
        SELECT stage.*, card.upstream_card_id
        FROM membership_payment_stages stage
        JOIN managed_cards card ON card.id = stage.card_id
        WHERE stage.fulfillment_id = ? AND stage.stage_key = ?
      `).get(fulfillment.id, key)
    };
  }

  async function reconcilePayment(fulfillment, atMs) {
    const { key, row: stage } = stageFor(fulfillment);
    if (!stage) fail("PAYMENT_STAGE_EVIDENCE_INCOMPLETE");
    const [transactions, observation] = await Promise.all([
      allTransactions(stage),
      membershipFetcher(sessionFor(fulfillment.id), { nowMs: atMs })
    ]);
    const result = reconcileMembershipPaymentStage(db, {
      fulfillmentId: fulfillment.id,
      stageKey: key,
      transactions,
      observation,
      at: atMs
    });
    if (result.outcome === "uncertain" && result.reason === "NO_MATCH") {
      recordDueNoPaymentChecks(
        db,
        fulfillment.id,
        key,
        stage,
        getMembershipStageAuthorizationSnapshot(db, fulfillment.id, key),
        transactions,
        observation,
        atMs
      );
    }
    return result;
  }

  async function protectRenewal(fulfillment, atMs) {
    const session = sessionFor(fulfillment.id);
    let observation = await membershipFetcher(session, { nowMs: atMs });
    const partial = fulfillment.state === "PARTIALLY_FULFILLED";
    const shouldRequest = observation.autoRenew === true
      && (!partial || shouldCancelPartialMembershipRenewal(observation, { at: atMs }));
    if (shouldRequest) {
      if (typeof cancelRenewal !== "function" || typeof getRenewalToken !== "function") {
        fail("RENEWAL_CANCEL_NOT_CONFIGURED");
      }
      await cancelRenewal(session, await getRenewalToken(fulfillment));
      observation = await membershipFetcher(session, { nowMs: atMs });
    }
    return applyMembershipRenewalObservation(db, {
      fulfillmentId: fulfillment.id,
      observation,
      at: atMs
    });
  }

  async function refreshSettlement(fulfillment, atMs) {
    const stages = db.prepare(`
      SELECT stage_key, card_id FROM membership_payment_stages
      WHERE fulfillment_id = ? AND settlement_state = 'PENDING'
    `).all(fulfillment.id);
    for (const stage of stages) {
      const card = db.prepare("SELECT upstream_card_id FROM managed_cards WHERE id = ?").get(stage.card_id);
      if (!card) fail("MANAGED_CARD_NOT_FOUND");
      const transactions = await allTransactions(card);
      const result = refreshMembershipStageSettlement(db, {
        fulfillmentId: fulfillment.id,
        stageKey: stage.stage_key,
        transactions,
        at: atMs
      });
      if (result.reviewed) return result;
    }
    return Object.freeze({ settlementState: stages.length ? "COMPLETE" : null, reviewed: false });
  }

  async function processFulfillment(fulfillmentId) {
    const fulfillment = db.prepare("SELECT * FROM membership_fulfillments WHERE id = ?").get(fulfillmentId);
    if (!fulfillment) fail("MEMBERSHIP_FULFILLMENT_NOT_FOUND");
    const atMs = nowMs();
    if (["PLUS_SUBMIT_PERMITTED", "PLUS_RECONCILING", "UPGRADE_SUBMIT_PERMITTED",
      "UPGRADE_RECONCILING", "PAYMENT_OUTCOME_UNCERTAIN"].includes(fulfillment.state)) {
      return reconcilePayment(fulfillment, atMs);
    }
    if (fulfillment.state === "PAYMENT_ACTION_REQUIRED") {
      const acknowledged = db.prepare(`
        SELECT id FROM fulfillment_interventions
        WHERE fulfillment_id = ? AND state = 'PAYMENT_ACTION_REQUIRED'
          AND acknowledged_at IS NOT NULL
        ORDER BY state_revision DESC LIMIT 1
      `).get(fulfillment.id);
      return acknowledged
        ? reconcilePayment(fulfillment, atMs)
        : Object.freeze({ outcome: "awaiting_local_ack", state: fulfillment.state });
    }
    if (["FINAL_TIER_CONFIRMED", "RENEWAL_CANCELLING", "PARTIALLY_FULFILLED"].includes(fulfillment.state)) {
      return protectRenewal(fulfillment, atMs);
    }
    if (fulfillment.state === "COMPLETED") return refreshSettlement(fulfillment, atMs);
    return Object.freeze({ outcome: "state", state: fulfillment.state });
  }

  async function tick() {
    if (running) return Object.freeze({ processed: 0, busy: true });
    running = true;
    let fulfillment = null;
    try {
      const at = iso(nowMs());
      fulfillment = db.prepare(`
        SELECT f.* FROM membership_fulfillments f
        WHERE (
          f.state IN (
            'PLUS_SUBMIT_PERMITTED', 'PLUS_RECONCILING', 'UPGRADE_SUBMIT_PERMITTED',
            'UPGRADE_RECONCILING', 'PAYMENT_OUTCOME_UNCERTAIN', 'PAYMENT_ACTION_REQUIRED',
            'FINAL_TIER_CONFIRMED', 'RENEWAL_CANCELLING', 'PARTIALLY_FULFILLED'
          )
          OR (f.state = 'COMPLETED' AND EXISTS (
            SELECT 1 FROM membership_payment_stages stage
            WHERE stage.fulfillment_id = f.id AND stage.settlement_state = 'PENDING'
          ))
        )
          AND (f.retry_at IS NULL OR f.retry_at <= ?)
        ORDER BY f.updated_at, f.id LIMIT 1
      `).get(at);
      if (!fulfillment) return Object.freeze({ processed: 0, reason: "idle" });
      const result = await processFulfillment(fulfillment.id);
      return Object.freeze({ processed: 1, fulfillmentId: fulfillment.id, ...result });
    } catch (error) {
      logger.warn?.(`[membership reconciliation] ${error?.code || "RECONCILIATION_FAILED"}`);
      if (!fulfillment) throw error;
      const atMs = nowMs();
      const at = iso(atMs);
      const code = String(error?.code || "RECONCILIATION_FAILED").slice(0, 100);
      db.prepare(`
        UPDATE membership_fulfillments
        SET failure_code = ?, retry_at = ?, updated_at = ? WHERE id = ?
      `).run(code, iso(atMs + 5 * 60_000), at, fulfillment.id);
      if (code.startsWith("RENEWAL_CANCEL_")) {
        const current = db.prepare("SELECT * FROM membership_fulfillments WHERE id = ?").get(fulfillment.id);
        intervention(db, fulfillment.id, current.state, current.state_revision, code, at);
      }
      return Object.freeze({
        processed: 1,
        fulfillmentId: fulfillment.id,
        outcome: "retry",
        state: fulfillment.state,
        code
      });
    } finally {
      running = false;
    }
  }

  return Object.freeze({ tick, processFulfillment });
}
