import {
  createHash,
  randomUUID,
  timingSafeEqual
} from "node:crypto";
import { membershipTiers } from "./membership-fulfillment.js";

export const liveCanaryAuthorizationTtlMs = 15 * 60 * 1000;
export const automaticCheckoutBusinessTimeZone = "Asia/Shanghai";
export const automaticCheckoutDefaultDailyOrderLimit = 1;

const REQUIRED_CANARY_STAGES = Object.freeze({
  plus: Object.freeze(["plus"]),
  x5: Object.freeze(["plus", "upgrade"]),
  x20: Object.freeze(["plus", "upgrade"])
});

const APPROVAL_WAIT_STATE = Object.freeze({
  plus: "PLUS_APPROVAL_WAIT",
  upgrade: "UPGRADE_APPROVAL_WAIT"
});

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;
const SAFE_ADAPTER_PATH = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/;
const SHA256_HEX = /^[a-f0-9]{64}$/i;

export class MembershipRolloutError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "MembershipRolloutError";
    this.code = code;
    this.retryable = false;
  }
}

function rolloutError(code, message) {
  return new MembershipRolloutError(code, message);
}

function parseTime(value = Date.now(), field = "时间") {
  const parsed = value instanceof Date ? value.getTime()
    : (typeof value === "number" ? value : Date.parse(value));
  if (!Number.isFinite(parsed)) throw new TypeError(`${field}无效`);
  return parsed;
}

function iso(value = Date.now(), field) {
  return new Date(parseTime(value, field)).toISOString();
}

function safeId(value, field) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!SAFE_ID.test(normalized)) throw new TypeError(`${field}无效`);
  return normalized;
}

function safeAdapterPath(value) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!SAFE_ADAPTER_PATH.test(normalized) || normalized.includes("..")) {
    throw new TypeError("适配器路径无效");
  }
  return normalized;
}

function requireTier(value) {
  if (!membershipTiers.includes(value)) throw new TypeError("会员类型无效");
  return value;
}

function usdCents(value, field, options = {}) {
  const number = Number(value);
  const cents = Math.round(number * 100);
  const minimum = options.allowZero ? 0 : 1;
  if (!Number.isFinite(number) || cents < minimum
    || Math.abs(number * 100 - cents) > 1e-7) {
    throw new TypeError(`${field}必须是精确到美分的${options.allowZero ? "非负" : "正"}金额`);
  }
  return cents;
}

function dollars(cents) {
  return Math.round(cents) / 100;
}

function credentialDigest(value) {
  const normalized = typeof value === "string" && value.length <= 1024 ? value : "\0invalid";
  return createHash("sha256").update(normalized, "utf8").digest();
}

/**
 * Verifies request-local credentials without retaining or echoing either password.
 * API rate limiting remains the route's responsibility.
 */
export function verifyFreshAdminCredentials(provided = {}, expected = {}) {
  const expectedConfigured = typeof expected.username === "string" && expected.username.length > 0
    && expected.username.length <= 1024
    && typeof expected.password === "string" && expected.password.length > 0
    && expected.password.length <= 1024;
  const usernameMatches = timingSafeEqual(
    credentialDigest(provided.username),
    credentialDigest(expected.username)
  );
  const passwordMatches = timingSafeEqual(
    credentialDigest(provided.password),
    credentialDigest(expected.password)
  );
  if (!expectedConfigured || !usernameMatches || !passwordMatches) {
    throw rolloutError("FRESH_ADMIN_AUTH_FAILED", "管理员身份复核失败");
  }
  return Object.freeze({ verified: true, actor: String(expected.username) });
}

export function requiredCanaryStages(targetTier) {
  return REQUIRED_CANARY_STAGES[requireTier(targetTier)];
}

function priceContract(db, id) {
  return db.prepare(`
    SELECT id, tier, version, currency, status, activated_at
    FROM checkout_price_contracts WHERE id = ?
  `).get(id);
}

function requireActivePriceContract(db, id, expectedTier) {
  const row = priceContract(db, safeId(id, "价格契约 ID"));
  if (!row || row.status !== "active" || row.tier !== expectedTier || row.currency !== "PHP") {
    throw rolloutError("ROLLOUT_PRICE_CONTRACT_INVALID", "PHP 价格契约无效或已失效");
  }
  return row;
}

function expectedContractTier(targetTier, stageKey) {
  return stageKey === "plus" ? "plus" : targetTier;
}

function requireCanaryStage(targetTier, stageKey) {
  const normalized = safeId(stageKey, "灰度阶段");
  if (!requiredCanaryStages(targetTier).includes(normalized)) {
    throw rolloutError("CANARY_STAGE_INVALID", "目标会员类型不包含该灰度阶段");
  }
  return normalized;
}

function requireCanaryReservation(db, fulfillment, cardId) {
  const reservation = db.prepare(`
    SELECT id, fulfillment_id, card_id, target_lane, state
    FROM card_capacity_reservations WHERE fulfillment_id = ?
  `).get(fulfillment.id);
  if (!reservation || reservation.card_id !== cardId
    || reservation.target_lane !== fulfillment.target_tier
    || !["reserved", "consumed", "retained_partial"].includes(reservation.state)
    || (fulfillment.card_reservation_id && fulfillment.card_reservation_id !== reservation.id)) {
    throw rolloutError("CANARY_CARD_SNAPSHOT_INVALID", "卡片预留与灰度快照不一致");
  }
  return reservation;
}

function latestStageAttempt(db, fulfillmentId, stageKey) {
  return db.prepare(`
    SELECT adapter_version, price_contract_version, ended_at
    FROM membership_fulfillment_attempts
    WHERE fulfillment_id = ? AND stage = ?
    ORDER BY attempt_no DESC LIMIT 1
  `).get(fulfillmentId, stageKey);
}

function requireStageAttempt(db, fulfillmentId, stageKey, adapterVersion, contractVersion) {
  const attempt = latestStageAttempt(db, fulfillmentId, stageKey);
  if (!attempt || attempt.ended_at !== null
    || attempt.adapter_version !== adapterVersion
    || Number(attempt.price_contract_version) !== Number(contractVersion)) {
    throw rolloutError("CANARY_PAGE_SNAPSHOT_STALE", "灰度页面版本已变化");
  }
}

function expiresAtForAuthorization(row) {
  return iso(Date.parse(row.approved_at) + liveCanaryAuthorizationTtlMs);
}

function serializeCanaryAuthorization(row, contractVersion = null) {
  if (!row) return null;
  return Object.freeze({
    id: row.id,
    fulfillmentId: row.fulfillment_id,
    stageKey: row.stage_key,
    targetTier: row.target_tier,
    selectedCardId: row.card_id,
    fundingBudgetUsd: row.funding_budget,
    priceContractId: row.price_contract_id,
    priceContractVersion: contractVersion,
    adapterVersion: row.adapter_version,
    snapshotBound: true,
    state: row.state,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at,
    expiresAt: expiresAtForAuthorization(row),
    consumedAt: row.consumed_at || null,
    invalidatedAt: row.invalidated_at || null
  });
}

function expireApprovedCanaries(db, at) {
  const cutoff = iso(Date.parse(at) - liveCanaryAuthorizationTtlMs);
  const expired = db.prepare(`
    SELECT * FROM live_canary_authorizations
    WHERE state = 'approved' AND approved_at <= ?
    ORDER BY approved_at
  `).all(cutoff);
  if (expired.length) {
    db.prepare(`
      UPDATE live_canary_authorizations
      SET state = 'expired', invalidated_at = ?
      WHERE state = 'approved' AND approved_at <= ?
    `).run(at, cutoff);
  }
  return expired.map((row) => ({ ...row, state: "expired", invalidated_at: at }));
}

export function expireLiveCanaryAuthorizations(db, options = {}) {
  const at = iso(options.at, "灰度失效时间");
  const rows = db.transaction(() => expireApprovedCanaries(db, at)).immediate();
  return Object.freeze({
    expiredCount: rows.length,
    requiresBrowserSanitization: rows.length > 0,
    authorizations: Object.freeze(rows.map((row) => serializeCanaryAuthorization(
      row,
      priceContract(db, row.price_contract_id)?.version ?? null
    )))
  });
}

export function approveLiveCanaryStage(db, input = {}, secrets = {}) {
  const verified = verifyFreshAdminCredentials(input.credentials, secrets);
  const fulfillmentId = safeId(input.fulfillmentId, "履约 ID");
  const stageKeyInput = safeId(input.stageKey, "灰度阶段");
  const cardId = safeId(input.cardId, "卡片 ID");
  const priceContractId = safeId(input.priceContractId, "价格契约 ID");
  const adapterVersion = safeId(input.adapterVersion, "适配器版本");
  const fingerprint = typeof input.snapshotFingerprint === "string"
    ? input.snapshotFingerprint.trim().toLowerCase()
    : "";
  if (!SHA256_HEX.test(fingerprint)) throw new TypeError("页面快照指纹无效");
  const fundingBudgetUsd = dollars(usdCents(input.fundingBudgetUsd, "灰度资金预算"));
  const approvedAt = iso(input.approvedAt, "灰度批准时间");

  return db.transaction(() => {
    expireApprovedCanaries(db, approvedAt);
    const fulfillment = db.prepare("SELECT * FROM membership_fulfillments WHERE id = ?").get(fulfillmentId);
    if (!fulfillment) throw rolloutError("FULFILLMENT_NOT_FOUND", "会员履约不存在");
    const targetTier = requireTier(fulfillment.target_tier);
    const stageKey = requireCanaryStage(targetTier, stageKeyInput);
    if (fulfillment.state !== APPROVAL_WAIT_STATE[stageKey]
      || ![null, "canary"].includes(fulfillment.run_mode)) {
      throw rolloutError("CANARY_STAGE_NOT_READY", "会员履约尚未进入对应灰度批准状态");
    }
    requireCanaryReservation(db, fulfillment, cardId);
    const contract = requireActivePriceContract(
      db,
      priceContractId,
      expectedContractTier(targetTier, stageKey)
    );
    requireStageAttempt(db, fulfillmentId, stageKey, adapterVersion, contract.version);

    if (stageKey === "upgrade") {
      const initialApproval = db.prepare(`
        SELECT id FROM live_canary_authorizations
        WHERE fulfillment_id = ? AND stage_key = 'plus' AND target_tier = ?
          AND adapter_version = ? AND state = 'consumed'
        LIMIT 1
      `).get(fulfillmentId, targetTier, adapterVersion);
      if (!initialApproval) {
        throw rolloutError("CANARY_INITIAL_STAGE_REQUIRED", "升级灰度必须先消费独立的 Plus 阶段批准");
      }
    }

    const spent = db.prepare(`
      SELECT id FROM live_canary_authorizations
      WHERE fulfillment_id = ? AND stage_key = ? AND state = 'consumed'
      LIMIT 1
    `).get(fulfillmentId, stageKey);
    if (spent) throw rolloutError("CANARY_STAGE_ALREADY_CONSUMED", "该灰度阶段已经消费过批准");
    const active = db.prepare(`
      SELECT id FROM live_canary_authorizations WHERE state = 'approved' LIMIT 1
    `).get();
    if (active) throw rolloutError("CANARY_APPROVAL_BUSY", "当前已有待消费的灰度阶段批准");

    const id = input.id ? safeId(input.id, "灰度批准 ID") : `lca_${randomUUID()}`;
    db.prepare(`
      INSERT INTO live_canary_authorizations (
        id, fulfillment_id, stage_key, target_tier, card_id, funding_budget,
        price_contract_id, adapter_version, snapshot_fingerprint, state,
        approved_by, approved_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?, ?)
    `).run(
      id,
      fulfillmentId,
      stageKey,
      targetTier,
      cardId,
      fundingBudgetUsd,
      priceContractId,
      adapterVersion,
      fingerprint,
      verified.actor,
      approvedAt
    );
    db.prepare(`
      UPDATE membership_fulfillments
      SET run_mode = 'canary', updated_at = ? WHERE id = ?
    `).run(approvedAt, fulfillmentId);
    const row = db.prepare("SELECT * FROM live_canary_authorizations WHERE id = ?").get(id);
    return serializeCanaryAuthorization(row, contract.version);
  }).immediate();
}

function invalidateCanary(db, authorizationId, at) {
  db.prepare(`
    UPDATE live_canary_authorizations
    SET state = 'invalidated', invalidated_at = ?
    WHERE id = ? AND state = 'approved'
  `).run(at, authorizationId);
}

export function consumeLiveCanaryAuthorization(db, input = {}) {
  const authorizationId = safeId(input.authorizationId, "灰度批准 ID");
  const fulfillmentId = safeId(input.fulfillmentId, "履约 ID");
  const stageKey = safeId(input.stageKey, "灰度阶段");
  const cardId = safeId(input.cardId, "卡片 ID");
  const priceContractId = safeId(input.priceContractId, "价格契约 ID");
  const adapterVersion = safeId(input.adapterVersion, "适配器版本");
  const fingerprint = typeof input.snapshotFingerprint === "string"
    ? input.snapshotFingerprint.trim().toLowerCase()
    : "";
  if (!SHA256_HEX.test(fingerprint)) throw new TypeError("页面快照指纹无效");
  const fundingBudgetUsd = dollars(usdCents(input.fundingBudgetUsd, "灰度资金预算"));
  const at = iso(input.at, "灰度消费时间");

  const result = db.transaction(() => {
    const row = db.prepare("SELECT * FROM live_canary_authorizations WHERE id = ?").get(authorizationId);
    if (!row) return { error: rolloutError("CANARY_AUTHORIZATION_NOT_FOUND", "灰度批准不存在") };
    if (row.state === "consumed") {
      return { error: rolloutError("CANARY_AUTHORIZATION_ALREADY_CONSUMED", "灰度批准已经消费") };
    }
    if (row.state !== "approved") {
      return { error: rolloutError("CANARY_AUTHORIZATION_INVALID", "灰度批准已失效") };
    }
    if (parseTime(at) >= parseTime(row.approved_at) + liveCanaryAuthorizationTtlMs) {
      db.prepare(`
        UPDATE live_canary_authorizations
        SET state = 'expired', invalidated_at = ? WHERE id = ? AND state = 'approved'
      `).run(at, authorizationId);
      return { error: rolloutError("CANARY_AUTHORIZATION_EXPIRED", "灰度批准已超过十五分钟") };
    }
    const exactSnapshot = row.fulfillment_id === fulfillmentId
      && row.stage_key === stageKey
      && row.card_id === cardId
      && row.price_contract_id === priceContractId
      && row.adapter_version === adapterVersion
      && row.snapshot_fingerprint === fingerprint
      && usdCents(row.funding_budget, "已保存灰度资金预算") === usdCents(fundingBudgetUsd, "灰度资金预算");
    if (!exactSnapshot) {
      invalidateCanary(db, authorizationId, at);
      return { error: rolloutError("CANARY_PAGE_SNAPSHOT_STALE", "灰度批准快照不再匹配") };
    }

    const fulfillment = db.prepare("SELECT * FROM membership_fulfillments WHERE id = ?").get(fulfillmentId);
    if (!fulfillment || fulfillment.run_mode !== "canary"
      || fulfillment.target_tier !== row.target_tier
      || fulfillment.state !== APPROVAL_WAIT_STATE[stageKey]) {
      invalidateCanary(db, authorizationId, at);
      return { error: rolloutError("CANARY_STAGE_NOT_READY", "会员履约灰度阶段已变化") };
    }
    try {
      requireCanaryReservation(db, fulfillment, cardId);
      const contract = requireActivePriceContract(
        db,
        priceContractId,
        expectedContractTier(row.target_tier, stageKey)
      );
      requireStageAttempt(db, fulfillmentId, stageKey, adapterVersion, contract.version);
    } catch (error) {
      invalidateCanary(db, authorizationId, at);
      return { error };
    }

    const changed = db.prepare(`
      UPDATE live_canary_authorizations
      SET state = 'consumed', consumed_at = ?
      WHERE id = ? AND state = 'approved'
    `).run(at, authorizationId);
    if (changed.changes !== 1) {
      return { error: rolloutError("CANARY_AUTHORIZATION_ALREADY_CONSUMED", "灰度批准已经消费") };
    }
    const consumed = db.prepare("SELECT * FROM live_canary_authorizations WHERE id = ?").get(authorizationId);
    return {
      value: serializeCanaryAuthorization(
        consumed,
        priceContract(db, consumed.price_contract_id)?.version ?? null
      )
    };
  }).immediate();
  if (result.error) throw result.error;
  return result.value;
}

function paymentStageRows(db, fulfillmentId) {
  return db.prepare(`
    SELECT * FROM membership_payment_stages
    WHERE fulfillment_id = ? ORDER BY stage_key
  `).all(fulfillmentId);
}

function requireSettledStageEvidence(db, fulfillment, stageKey, atMs) {
  const stage = db.prepare(`
    SELECT * FROM membership_payment_stages
    WHERE fulfillment_id = ? AND stage_key = ?
  `).get(fulfillment.id, stageKey);
  const expectedTier = stageKey === "plus" ? "plus" : fulfillment.target_tier;
  if (!stage || stage.expected_tier !== expectedTier
    || stage.settlement_state !== "COMPLETE" || !stage.matched_auth_id
    || !stage.membership_observation_id || !stage.confirmed_at) {
    throw rolloutError("ROLLOUT_SETTLEMENT_INCOMPLETE", "灰度付款阶段尚未最终结算");
  }
  const transaction = db.prepare(`
    SELECT status, settlement_seen, refund_seen, reversal_seen
    FROM managed_card_transactions WHERE card_id = ? AND auth_id = ?
  `).get(stage.card_id, stage.matched_auth_id);
  if (!transaction || transaction.status !== "COMPLETE"
    || Number(transaction.settlement_seen) !== 1
    || Number(transaction.refund_seen) !== 0
    || Number(transaction.reversal_seen) !== 0) {
    throw rolloutError("ROLLOUT_TRANSACTION_UNRESOLVED", "灰度卡片交易仍有未决结果");
  }
  const observation = db.prepare(`
    SELECT * FROM membership_observations WHERE id = ? AND fulfillment_id = ?
  `).get(stage.membership_observation_id, fulfillment.id);
  const finalStage = stageKey === requiredCanaryStages(fulfillment.target_tier).at(-1);
  if (!observation
    || observation.account_type !== expectedTier
    || observation.currency !== "PHP"
    || (finalStage && Number(observation.auto_renew) !== 0)
    || Number(observation.is_overdue) !== 0
    || Number(observation.is_delinquent) !== 0
    || !observation.expire_time
    || parseTime(observation.expire_time, "会员到期时间") <= atMs) {
    throw rolloutError("ROLLOUT_MEMBERSHIP_NOT_STRICT", "会员阶段与续费保护证据不满足严格资格");
  }
  return stage;
}

function requireNoStoredUnresolvedOutcome(db, fulfillment) {
  if (fulfillment.failure_code) {
    throw rolloutError("ROLLOUT_OUTCOME_UNRESOLVED", "会员履约仍有未决结果");
  }
  const openAttempt = db.prepare(`
    SELECT id FROM membership_fulfillment_attempts
    WHERE fulfillment_id = ? AND ended_at IS NULL LIMIT 1
  `).get(fulfillment.id);
  const fundingUnknown = db.prepare(`
    SELECT id FROM funding_intents
    WHERE fulfillment_id = ? AND state <> 'succeeded' LIMIT 1
  `).get(fulfillment.id);
  const unclaimedMaterial = db.prepare(`
    SELECT id FROM membership_material_grants
    WHERE fulfillment_id = ? AND claimed_at IS NULL LIMIT 1
  `).get(fulfillment.id);
  const activeLease = db.prepare(`
    SELECT id FROM browser_fulfillment_lease
    WHERE fulfillment_id = ? AND state <> 'available' LIMIT 1
  `).get(fulfillment.id);
  if (openAttempt || fundingUnknown || unclaimedMaterial || activeLease) {
    throw rolloutError("ROLLOUT_OUTCOME_UNRESOLVED", "会员履约仍有未决结果");
  }
}

function serializeQualification(db, row) {
  return Object.freeze({
    id: row.id,
    tier: row.tier,
    adapterVersion: row.adapter_version,
    adapterPath: row.adapter_path,
    priceContractId: row.price_contract_id,
    priceContractVersion: priceContract(db, row.price_contract_id)?.version ?? null,
    fulfillmentId: row.fulfillment_id,
    settlement: "COMPLETE",
    exactMembershipConfirmed: true,
    autoRenewDisabled: true,
    unresolvedOutcomeCount: 0,
    qualifiedAt: row.qualified_at
  });
}

export function qualifyTierRollout(db, input = {}) {
  const fulfillmentId = safeId(input.fulfillmentId, "履约 ID");
  const tier = requireTier(input.tier);
  const adapterVersion = safeId(input.adapterVersion, "适配器版本");
  const adapterPath = safeAdapterPath(input.adapterPath);
  const priceContractId = safeId(input.priceContractId, "价格契约 ID");
  const unresolvedOutcomeCount = Number(input.unresolvedOutcomeCount);
  if (!Number.isInteger(unresolvedOutcomeCount) || unresolvedOutcomeCount !== 0) {
    throw rolloutError("ROLLOUT_OUTCOME_UNRESOLVED", "权威检查仍有未决结果或尚未完成");
  }
  const qualifiedAt = iso(input.qualifiedAt, "资格确认时间");
  const atMs = parseTime(qualifiedAt);

  return db.transaction(() => {
    const fulfillment = db.prepare("SELECT * FROM membership_fulfillments WHERE id = ?").get(fulfillmentId);
    if (!fulfillment || fulfillment.state !== "COMPLETED"
      || fulfillment.target_tier !== tier || fulfillment.run_mode !== "canary") {
      throw rolloutError("ROLLOUT_FULFILLMENT_NOT_COMPLETE", "灰度履约尚未严格完成或会员类型不匹配");
    }
    requireActivePriceContract(db, priceContractId, tier);
    requireNoStoredUnresolvedOutcome(db, fulfillment);

    const stages = requiredCanaryStages(tier);
    const paymentStages = paymentStageRows(db, fulfillmentId);
    if (paymentStages.length !== stages.length
      || stages.some((stageKey) => !paymentStages.some((row) => row.stage_key === stageKey))) {
      throw rolloutError("ROLLOUT_STAGE_EVIDENCE_INCOMPLETE", "灰度阶段证据不完整");
    }
    const reservation = requireCanaryReservation(
      db,
      fulfillment,
      db.prepare(`
        SELECT card_id FROM card_capacity_reservations WHERE fulfillment_id = ?
      `).get(fulfillmentId)?.card_id
    );
    for (const stageKey of stages) {
      const stage = requireSettledStageEvidence(db, fulfillment, stageKey, atMs);
      if (stage.card_id !== reservation.card_id) {
        throw rolloutError("ROLLOUT_CARD_MISMATCH", "灰度付款阶段没有使用同一张预留卡片");
      }
    }

    for (const stageKey of stages) {
      const consumed = db.prepare(`
        SELECT COUNT(*) AS count FROM live_canary_authorizations
        WHERE fulfillment_id = ? AND stage_key = ? AND target_tier = ?
          AND adapter_version = ? AND state = 'consumed'
      `).get(fulfillmentId, stageKey, tier, adapterVersion);
      if (Number(consumed.count) !== 1) {
        throw rolloutError("ROLLOUT_CANARY_APPROVAL_INCOMPLETE", "灰度阶段缺少独立且已消费的批准");
      }
    }

    const existing = db.prepare(`
      SELECT * FROM tier_rollout_qualifications
      WHERE tier = ? AND adapter_version = ? AND adapter_path = ? AND price_contract_id = ?
    `).get(tier, adapterVersion, adapterPath, priceContractId);
    if (existing) {
      if (existing.fulfillment_id !== fulfillmentId) {
        throw rolloutError("ROLLOUT_VERSION_ALREADY_QUALIFIED", "该精确版本已经取得灰度资格");
      }
      return serializeQualification(db, existing);
    }
    const id = input.id ? safeId(input.id, "资格 ID") : `trq_${randomUUID()}`;
    db.prepare(`
      INSERT INTO tier_rollout_qualifications (
        id, tier, adapter_version, adapter_path, price_contract_id,
        fulfillment_id, qualified_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      tier,
      adapterVersion,
      adapterPath,
      priceContractId,
      fulfillmentId,
      qualifiedAt
    );
    return serializeQualification(
      db,
      db.prepare("SELECT * FROM tier_rollout_qualifications WHERE id = ?").get(id)
    );
  }).immediate();
}

export function deriveAutomaticCheckoutScopeKey(input = {}) {
  const siteId = safeId(input.siteId, "站点 ID");
  const productId = safeId(input.productId, "商品 ID");
  const tier = requireTier(input.tier);
  return `acs_v1_${createHash("sha256")
    .update(JSON.stringify([siteId, productId, tier]))
    .digest("hex")}`;
}

function businessDate(value) {
  const date = new Date(parseTime(value, "额度业务日期"));
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: automaticCheckoutBusinessTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function scopeContractVersion(db, row) {
  return priceContract(db, row.price_contract_id)?.version ?? null;
}

function serializeAutomaticScope(db, row) {
  if (!row) return null;
  return Object.freeze({
    id: row.id,
    scopeKey: row.scope_key,
    revision: row.revision,
    siteId: row.site_id,
    productId: row.product_id,
    tier: row.tier,
    adapterVersion: row.adapter_version,
    priceContractId: row.price_contract_id,
    priceContractVersion: scopeContractVersion(db, row),
    dailyOrderLimit: row.daily_order_limit,
    dailyRiskLimitUsd: row.daily_risk_limit_usd,
    status: row.status,
    activatedAt: row.activated_at || null,
    createdAt: row.created_at,
    createdBy: row.created_by
  });
}

function requireScopeBindingEntities(db, binding) {
  const site = db.prepare("SELECT id FROM sites WHERE id = ?").get(binding.siteId);
  const product = db.prepare("SELECT id, membership_tier FROM products WHERE id = ?").get(binding.productId);
  if (!site || !product || product.membership_tier !== binding.tier) {
    throw rolloutError("AUTOMATIC_SCOPE_BINDING_INVALID", "自动范围的站点、商品或会员类型无效");
  }
  requireActivePriceContract(db, binding.priceContractId, binding.tier);
  const qualification = db.prepare(`
    SELECT id FROM tier_rollout_qualifications
    WHERE tier = ? AND adapter_version = ? AND price_contract_id = ?
    LIMIT 1
  `).get(binding.tier, binding.adapterVersion, binding.priceContractId);
  if (!qualification) {
    throw rolloutError("AUTOMATIC_SCOPE_NOT_QUALIFIED", "自动范围的精确版本尚未取得灰度资格");
  }
}

function normalizeScopeBinding(input) {
  const binding = {
    siteId: safeId(input.siteId, "站点 ID"),
    productId: safeId(input.productId, "商品 ID"),
    tier: requireTier(input.tier),
    adapterVersion: safeId(input.adapterVersion, "适配器版本"),
    priceContractId: safeId(input.priceContractId, "价格契约 ID")
  };
  return { ...binding, scopeKey: deriveAutomaticCheckoutScopeKey(binding) };
}

export function createAutomaticCheckoutScope(db, input = {}, secrets = {}) {
  const verified = verifyFreshAdminCredentials(input.credentials, secrets);
  const binding = normalizeScopeBinding(input);
  const requestedOrderLimit = input.dailyOrderLimit ?? automaticCheckoutDefaultDailyOrderLimit;
  if (requestedOrderLimit !== automaticCheckoutDefaultDailyOrderLimit) {
    throw rolloutError("AUTOMATIC_SCOPE_INITIAL_LIMIT_INVALID", "首次自动范围只能使用每日一单默认额度");
  }
  const riskLimitUsd = dollars(usdCents(input.dailyRiskLimitUsd, "每日风险额度"));
  const activatedAt = iso(input.activatedAt, "自动范围启用时间");

  return db.transaction(() => {
    requireScopeBindingEntities(db, binding);
    const existing = db.prepare(`
      SELECT id FROM automatic_checkout_scopes WHERE scope_key = ? LIMIT 1
    `).get(binding.scopeKey);
    if (existing) {
      throw rolloutError("AUTOMATIC_SCOPE_ALREADY_EXISTS", "自动范围已存在，变更必须创建新修订");
    }
    const id = input.id ? safeId(input.id, "自动范围 ID") : `acs_${randomUUID()}`;
    db.prepare(`
      INSERT INTO automatic_checkout_scopes (
        id, scope_key, revision, site_id, product_id, tier, adapter_version,
        price_contract_id, daily_order_limit, daily_risk_limit_usd, status,
        activated_at, created_at, created_by
      ) VALUES (?, ?, 1, ?, ?, ?, ?, ?, 1, ?, 'active', ?, ?, ?)
    `).run(
      id,
      binding.scopeKey,
      binding.siteId,
      binding.productId,
      binding.tier,
      binding.adapterVersion,
      binding.priceContractId,
      riskLimitUsd,
      activatedAt,
      activatedAt,
      verified.actor
    );
    return serializeAutomaticScope(
      db,
      db.prepare("SELECT * FROM automatic_checkout_scopes WHERE id = ?").get(id)
    );
  }).immediate();
}

export function reviseAutomaticCheckoutScope(db, input = {}, secrets = {}) {
  const verified = verifyFreshAdminCredentials(input.credentials, secrets);
  const previousScopeId = safeId(input.previousScopeId, "原自动范围 ID");
  const at = iso(input.activatedAt, "自动范围修订时间");
  return db.transaction(() => {
    const previous = db.prepare("SELECT * FROM automatic_checkout_scopes WHERE id = ?").get(previousScopeId);
    if (!previous) throw rolloutError("AUTOMATIC_SCOPE_NOT_FOUND", "自动范围不存在");
    const binding = normalizeScopeBinding({
      siteId: previous.site_id,
      productId: previous.product_id,
      tier: previous.tier,
      adapterVersion: input.adapterVersion ?? previous.adapter_version,
      priceContractId: input.priceContractId ?? previous.price_contract_id
    });
    requireScopeBindingEntities(db, binding);
    const orderLimit = input.dailyOrderLimit ?? previous.daily_order_limit;
    if (!Number.isInteger(orderLimit) || orderLimit <= 0) {
      throw new TypeError("每日订单额度必须是正整数");
    }
    const riskLimitUsd = input.dailyRiskLimitUsd === undefined
      ? previous.daily_risk_limit_usd
      : dollars(usdCents(input.dailyRiskLimitUsd, "每日风险额度"));
    const latest = db.prepare(`
      SELECT MAX(revision) AS revision FROM automatic_checkout_scopes WHERE scope_key = ?
    `).get(previous.scope_key);
    const revision = Number(latest.revision) + 1;
    db.prepare(`
      UPDATE automatic_checkout_scopes SET status = 'paused'
      WHERE scope_key = ? AND status = 'active'
    `).run(previous.scope_key);
    const id = input.id ? safeId(input.id, "自动范围修订 ID") : `acs_${randomUUID()}`;
    db.prepare(`
      INSERT INTO automatic_checkout_scopes (
        id, scope_key, revision, site_id, product_id, tier, adapter_version,
        price_contract_id, daily_order_limit, daily_risk_limit_usd, status,
        activated_at, created_at, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
    `).run(
      id,
      previous.scope_key,
      revision,
      previous.site_id,
      previous.product_id,
      previous.tier,
      binding.adapterVersion,
      binding.priceContractId,
      orderLimit,
      riskLimitUsd,
      at,
      at,
      verified.actor
    );
    return serializeAutomaticScope(
      db,
      db.prepare("SELECT * FROM automatic_checkout_scopes WHERE id = ?").get(id)
    );
  }).immediate();
}

export function pauseStaleAutomaticCheckoutScopes(db, input = {}) {
  const binding = normalizeScopeBinding(input);
  const at = iso(input.at, "自动范围版本检查时间");
  return db.transaction(() => {
    const stale = db.prepare(`
      SELECT * FROM automatic_checkout_scopes
      WHERE site_id = ? AND product_id = ? AND tier = ? AND status = 'active'
        AND (adapter_version <> ? OR price_contract_id <> ?)
      ORDER BY revision
    `).all(
      binding.siteId,
      binding.productId,
      binding.tier,
      binding.adapterVersion,
      binding.priceContractId
    );
    if (stale.length) {
      db.prepare(`
        UPDATE automatic_checkout_scopes SET status = 'paused'
        WHERE site_id = ? AND product_id = ? AND tier = ? AND status = 'active'
          AND (adapter_version <> ? OR price_contract_id <> ?)
      `).run(
        binding.siteId,
        binding.productId,
        binding.tier,
        binding.adapterVersion,
        binding.priceContractId
      );
    }
    return Object.freeze({
      checkedAt: at,
      pausedCount: stale.length,
      scopes: Object.freeze(stale.map((row) => serializeAutomaticScope(db, { ...row, status: "paused" })))
    });
  }).immediate();
}

function scopeMatchesFulfillment(scope, fulfillment) {
  return scope.site_id === fulfillment.site_id
    && scope.product_id === fulfillment.product_id
    && scope.tier === fulfillment.target_tier;
}

function pausedVersionError() {
  return rolloutError("AUTOMATIC_SCOPE_VERSION_STALE", "自动范围版本已变化并已暂停");
}

function isScopeVersionStale(db, scope, adapterVersion, priceContractId) {
  const activeContract = db.prepare(`
    SELECT id FROM checkout_price_contracts WHERE tier = ? AND status = 'active'
  `).get(scope.tier);
  return scope.adapter_version !== adapterVersion
    || scope.price_contract_id !== priceContractId
    || activeContract?.id !== scope.price_contract_id;
}

function pauseScope(db, scopeId) {
  db.prepare(`
    UPDATE automatic_checkout_scopes SET status = 'paused'
    WHERE id = ? AND status = 'active'
  `).run(scopeId);
}

function serializeQuotaReservation(row, fulfillment, options = {}) {
  return Object.freeze({
    reservationId: row.id,
    scopeId: row.scope_id,
    fulfillmentId: row.fulfillment_id,
    businessDate: row.business_date,
    orderUnitsReserved: row.order_units,
    orderRiskUsd: row.risk_reserved_usd,
    state: row.state,
    reservedAt: row.reserved_at,
    releasedAt: row.released_at || null,
    reserved: options.reserved === true,
    alreadyReserved: options.alreadyReserved === true,
    alreadyReleased: options.alreadyReleased === true,
    scopePausedForVersionChange: options.scopePausedForVersionChange === true,
    crossedMoneyBoundary: Boolean(fulfillment?.money_boundary_at),
    moneyBoundaryAt: fulfillment?.money_boundary_at || null,
    noPaymentEvidenceAccepted: options.noPaymentEvidenceAccepted === true
  });
}

export function reserveAutomaticCheckoutDailyRisk(db, input = {}) {
  const fulfillmentId = safeId(input.fulfillmentId, "履约 ID");
  const scopeId = safeId(input.scopeId, "自动范围 ID");
  const adapterVersion = safeId(input.adapterVersion, "适配器版本");
  const priceContractId = safeId(input.priceContractId, "价格契约 ID");
  const paymentBudgetCents = usdCents(input.fullPaymentBudgetUsd, "完整付款预算");
  const feeCents = usdCents(input.providerFeeUsd ?? 0, "服务商费用", { allowZero: true });
  const orderRiskCents = paymentBudgetCents + feeCents;
  const at = iso(input.at, "自动额度占用时间");

  const result = db.transaction(() => {
    const scope = db.prepare("SELECT * FROM automatic_checkout_scopes WHERE id = ?").get(scopeId);
    const fulfillment = db.prepare(`
      SELECT f.*, o.site_id, o.product_id, o.created_at AS order_created_at
      FROM membership_fulfillments f
      JOIN redeem_orders o ON o.id = f.order_id
      WHERE f.id = ?
    `).get(fulfillmentId);
    if (!scope || !fulfillment || !scopeMatchesFulfillment(scope, fulfillment)) {
      return { error: rolloutError("AUTOMATIC_SCOPE_MISMATCH", "自动范围与会员履约不匹配") };
    }
    const existing = db.prepare(`
      SELECT * FROM automatic_checkout_quota_reservations WHERE fulfillment_id = ?
    `).get(fulfillmentId);
    if (existing) {
      if (existing.scope_id !== scope.id
        || usdCents(existing.risk_reserved_usd, "已保存风险额度") !== orderRiskCents
        || Number(existing.order_units) !== 1) {
        return { error: rolloutError("AUTOMATIC_QUOTA_RESERVATION_CONFLICT", "履约已有不同范围或金额的额度占用") };
      }
      if (existing.state === "released") {
        return { error: rolloutError("AUTOMATIC_QUOTA_ALREADY_RELEASED", "该履约的自动额度已经明确释放，不能重复占用") };
      }
      if (existing.state !== "reserved") {
        return { error: rolloutError("AUTOMATIC_QUOTA_STATE_INVALID", "自动额度账本状态无效") };
      }
      const versionStale = isScopeVersionStale(db, scope, adapterVersion, priceContractId);
      if (versionStale) pauseScope(db, scope.id);
      if (!fulfillment.money_boundary_at && versionStale) {
        return { error: pausedVersionError() };
      }
      if (!fulfillment.money_boundary_at && scope.status !== "active") {
        return { error: rolloutError("AUTOMATIC_SCOPE_INACTIVE", "自动范围已暂停，尚未跨资金边界的履约不能继续") };
      }
      return {
        value: serializeQuotaReservation(existing, fulfillment, {
          alreadyReserved: true,
          scopePausedForVersionChange: versionStale
        })
      };
    }
    if (fulfillment.run_mode && fulfillment.run_mode !== "automatic") {
      return { error: rolloutError("AUTOMATIC_SCOPE_RUN_MODE_CONFLICT", "会员履约已绑定其他运行模式") };
    }
    if (fulfillment.money_boundary_at) {
      return { error: rolloutError("AUTOMATIC_SCOPE_MONEY_BOUNDARY_MISSED", "履约已跨资金边界，不能补占自动额度") };
    }
    const versionStale = isScopeVersionStale(db, scope, adapterVersion, priceContractId);
    if (versionStale) {
      pauseScope(db, scope.id);
      return { error: pausedVersionError() };
    }
    if (scope.status !== "active" || !scope.activated_at
      || parseTime(fulfillment.order_created_at) < parseTime(scope.activated_at)) {
      return { error: rolloutError("AUTOMATIC_SCOPE_INACTIVE", "订单不在自动范围的启用窗口内") };
    }

    const dateKey = businessDate(at);
    const current = db.prepare(`
      SELECT order_units, risk_reserved_usd FROM automatic_checkout_daily_usage
      WHERE scope_id = ? AND business_date = ?
    `).get(scope.id, dateKey) || { order_units: 0, risk_reserved_usd: 0 };
    const nextOrderUnits = Number(current.order_units) + 1;
    const nextRiskCents = usdCents(
      current.risk_reserved_usd,
      "已占用风险额度",
      { allowZero: true }
    ) + orderRiskCents;
    const limitCents = usdCents(scope.daily_risk_limit_usd, "每日风险额度");
    if (nextOrderUnits > Number(scope.daily_order_limit)) {
      return { error: rolloutError("AUTOMATIC_SCOPE_DAILY_ORDER_LIMIT", "自动范围当日订单额度不足") };
    }
    if (nextRiskCents > limitCents) {
      return { error: rolloutError("AUTOMATIC_SCOPE_DAILY_RISK_LIMIT", "自动范围当日风险额度不足") };
    }

    const reservationId = input.reservationId
      ? safeId(input.reservationId, "自动额度占用 ID")
      : `acqr_${randomUUID()}`;
    db.prepare(`
      INSERT INTO automatic_checkout_quota_reservations (
        id, scope_id, fulfillment_id, business_date, order_units,
        risk_reserved_usd, state, reserved_at
      ) VALUES (?, ?, ?, ?, 1, ?, 'reserved', ?)
    `).run(reservationId, scope.id, fulfillmentId, dateKey, dollars(orderRiskCents), at);
    db.prepare(`
      INSERT INTO automatic_checkout_daily_usage (
        scope_id, business_date, order_units, risk_reserved_usd, updated_at
      ) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(scope_id, business_date) DO UPDATE SET
        order_units = excluded.order_units,
        risk_reserved_usd = excluded.risk_reserved_usd,
        updated_at = excluded.updated_at
    `).run(scope.id, dateKey, nextOrderUnits, dollars(nextRiskCents), at);
    db.prepare(`
      UPDATE membership_fulfillments
      SET run_mode = 'automatic', state_revision = state_revision + 1, updated_at = ?
      WHERE id = ? AND money_boundary_at IS NULL
    `).run(at, fulfillmentId);
    const reservation = db.prepare(`
      SELECT * FROM automatic_checkout_quota_reservations WHERE id = ?
    `).get(reservationId);
    return {
      value: Object.freeze({
        ...serializeQuotaReservation(reservation, { ...fulfillment, money_boundary_at: null }, { reserved: true }),
        dailyOrderUnits: nextOrderUnits,
        dailyRiskReservedUsd: dollars(nextRiskCents)
      })
    };
  }).immediate();
  if (result.error) throw result.error;
  return result.value;
}

function requireQuotaReleaseEvidence(evidence) {
  if (!evidence || typeof evidence !== "object"
    || evidence.kind !== "NO_PAYMENT_BEFORE_MONEY_BOUNDARY"
    || evidence.membershipUnchanged !== true
    || evidence.noEffectiveTransaction !== true
    || evidence.noPendingAuthorization !== true) {
    throw rolloutError("AUTOMATIC_QUOTA_RELEASE_EVIDENCE_REQUIRED", "释放自动额度需要明确的未跨资金边界无付款证据");
  }
}

function hasPersistedMoneyBoundary(db, fulfillment) {
  if (fulfillment.money_boundary_at) return true;
  const funding = db.prepare(`
    SELECT id FROM funding_intents
    WHERE fulfillment_id = ?
      AND (submitted_at IS NOT NULL OR state IN ('submitted', 'succeeded', 'outcome_unknown', 'failed'))
    LIMIT 1
  `).get(fulfillment.id);
  const payment = db.prepare(`
    SELECT id FROM membership_payment_stages
    WHERE fulfillment_id = ? AND (
      submit_permitted_at IS NOT NULL OR submit_reported_at IS NOT NULL
      OR matched_auth_id IS NOT NULL OR confirmed_at IS NOT NULL
      OR settlement_state IN ('PENDING', 'COMPLETE')
    ) LIMIT 1
  `).get(fulfillment.id);
  const submitPermit = db.prepare(`
    SELECT id FROM membership_action_permits
    WHERE fulfillment_id = ? AND action_type = 'submit' LIMIT 1
  `).get(fulfillment.id);
  return Boolean(funding || payment || submitPermit);
}

export function releaseAutomaticCheckoutDailyRisk(db, input = {}) {
  const fulfillmentId = safeId(input.fulfillmentId, "履约 ID");
  const scopeId = safeId(input.scopeId, "自动范围 ID");
  requireQuotaReleaseEvidence(input.evidence);
  const at = iso(input.at, "自动额度释放时间");

  const result = db.transaction(() => {
    const reservation = db.prepare(`
      SELECT * FROM automatic_checkout_quota_reservations WHERE fulfillment_id = ?
    `).get(fulfillmentId);
    const fulfillment = db.prepare(`
      SELECT * FROM membership_fulfillments WHERE id = ?
    `).get(fulfillmentId);
    if (!reservation || !fulfillment || reservation.scope_id !== scopeId) {
      return { error: rolloutError("AUTOMATIC_QUOTA_RESERVATION_NOT_FOUND", "自动额度占用不存在或范围不匹配") };
    }
    if (reservation.state === "released") {
      return {
        value: serializeQuotaReservation(reservation, fulfillment, {
          alreadyReleased: true,
          noPaymentEvidenceAccepted: true
        })
      };
    }
    if (reservation.state !== "reserved") {
      return { error: rolloutError("AUTOMATIC_QUOTA_STATE_INVALID", "自动额度账本状态无效") };
    }
    if (hasPersistedMoneyBoundary(db, fulfillment)) {
      return { error: rolloutError("AUTOMATIC_QUOTA_MONEY_BOUNDARY_CROSSED", "履约已经跨过资金边界，风险额度必须永久保留") };
    }

    const usage = db.prepare(`
      SELECT * FROM automatic_checkout_daily_usage
      WHERE scope_id = ? AND business_date = ?
    `).get(reservation.scope_id, reservation.business_date);
    if (!usage) {
      return { error: rolloutError("AUTOMATIC_QUOTA_USAGE_CORRUPT", "自动额度日账与逐履约账本不一致") };
    }
    const reservedRiskCents = usdCents(reservation.risk_reserved_usd, "已保存风险额度");
    const usedRiskCents = usdCents(
      usage.risk_reserved_usd,
      "当日已占用风险额度",
      { allowZero: true }
    );
    if (Number(usage.order_units) < Number(reservation.order_units)
      || usedRiskCents < reservedRiskCents) {
      return { error: rolloutError("AUTOMATIC_QUOTA_USAGE_CORRUPT", "自动额度日账与逐履约账本不一致") };
    }
    db.prepare(`
      UPDATE automatic_checkout_daily_usage
      SET order_units = ?, risk_reserved_usd = ?, updated_at = ?
      WHERE scope_id = ? AND business_date = ?
    `).run(
      Number(usage.order_units) - Number(reservation.order_units),
      dollars(usedRiskCents - reservedRiskCents),
      at,
      reservation.scope_id,
      reservation.business_date
    );
    const changed = db.prepare(`
      UPDATE automatic_checkout_quota_reservations
      SET state = 'released', released_at = ?
      WHERE id = ? AND state = 'reserved'
    `).run(at, reservation.id);
    if (changed.changes !== 1) {
      throw rolloutError("AUTOMATIC_QUOTA_STATE_CONFLICT", "自动额度账本已被其他执行者更新");
    }
    db.prepare(`
      UPDATE membership_fulfillments
      SET state_revision = state_revision + 1, updated_at = ? WHERE id = ?
    `).run(at, fulfillmentId);
    const released = db.prepare(`
      SELECT * FROM automatic_checkout_quota_reservations WHERE id = ?
    `).get(reservation.id);
    return {
      value: serializeQuotaReservation(released, fulfillment, {
        noPaymentEvidenceAccepted: true
      })
    };
  }).immediate();
  if (result.error) throw result.error;
  return result.value;
}
