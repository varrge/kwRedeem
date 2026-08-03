const MEMBERSHIP_TYPE_MAP = Object.freeze({
  free: "free",
  plus: "plus",
  prolite: "x5",
  pro: "x20"
});

export const membershipTiers = Object.freeze(["plus", "x5", "x20"]);
export const membershipCapacityByTier = Object.freeze({ plus: 5, x5: 2, x20: 1 });
export const membershipStageAllowanceUsd = 0.2;
export const cardPriceFreshnessMs = 72 * 60 * 60 * 1000;
export const historicalUpgradePairWindowMs = 2 * 60 * 60 * 1000;
export const membershipPaymentRecognitionRanges = Object.freeze({
  plus: Object.freeze({ minUsd: 15, maxUsd: 20 }),
  x5: Object.freeze({ minUsd: 90, maxUsd: 100 }),
  // Historical PH x20 settlements can be below the card-segment quote API's current $140 floor.
  x20: Object.freeze({ minUsd: 120, maxUsd: 160 })
});

const cardTransactionTypePriority = Object.freeze({
  Authorization: 1,
  Settlement: 2,
  Reversal: 3,
  Refund: 4
});
const cardTransactionStatusPriority = Object.freeze({
  PENDING: 1,
  DECLINED: 2,
  COMPLETE: 3
});

export const membershipFulfillmentStates = Object.freeze([
	"WAITING_SESSION_VALIDATION",
  "WAITING_SESSION_ACTIVATION",
  "QUEUED",
  "ACCOUNT_FULFILLMENT_WAIT",
  "ACCOUNT_CHECKING",
  "ACCOUNT_REPURCHASE_NOT_READY",
  "ACCOUNT_ALREADY_SUBSCRIBED",
  "INVENTORY_NOT_READY",
  "INVENTORY_CHECKING",
  "CARD_PRICE_UNAVAILABLE",
	"CHECKOUT_PREFLIGHT_READY",
	"CHECKOUT_CHALLENGE_WAIT",
	"CHECKOUT_LOGIN_READY",
	"CHECKOUT_LOGIN_WAIT",
	"CHECKOUT_LOGIN_PREFLIGHT_PASSED",
	"CHECKOUT_EXECUTION_WAIT",
  "BROWSER_LEASE_WAIT",
  "CARD_RESERVED",
  "INITIAL_CHECKOUT_PREFLIGHT",
  "CHECKOUT_ADDRESS_UNAVAILABLE",
  "CHECKOUT_PRICE_UNRECOGNIZED",
  "CHECKOUT_UI_UNSUPPORTED",
  "FUNDING_READY",
  "PLATFORM_BALANCE_INSUFFICIENT",
  "FUNDING",
  "FUNDING_OUTCOME_UNKNOWN",
  "PLUS_APPROVAL_WAIT",
  "PLUS_CHECKOUT_READY",
  "PLUS_SUBMIT_PERMITTED",
  "PLUS_RECONCILING",
  "PLUS_CONFIRMED",
  "UPGRADE_CHECKOUT_PREFLIGHT",
  "UPGRADE_CHECKOUT_UNAVAILABLE",
  "UPGRADE_APPROVAL_WAIT",
  "UPGRADE_CHECKOUT_READY",
  "UPGRADE_SUBMIT_PERMITTED",
  "UPGRADE_RECONCILING",
  "FINAL_TIER_CONFIRMED",
  "RENEWAL_CANCELLING",
  "CHECKOUT_PRE_SUBMIT_FAILED",
  "UNEXPECTED_PREAUTH",
  "PAYMENT_ACTION_REQUIRED",
  "ACTION_REQUIRED_CONTEXT_LOST",
  "PAYMENT_OUTCOME_UNCERTAIN",
  "PAYMENT_DECLINED",
  "PARTIALLY_FULFILLED",
  "PARTIAL_FULFILLMENT_EXPIRED",
  "MEMBERSHIP_CONTRACT_UNKNOWN",
  "CANCELLED",
  "COMPLETED"
]);

export class MembershipContractError extends Error {
  constructor(message, code = "MEMBERSHIP_CONTRACT_UNKNOWN") {
    super(message);
    this.name = "MembershipContractError";
    this.code = code;
    this.retryable = true;
    this.retryScope = "global";
  }
}

export function selectCanonicalCardTransactionState(current, candidate) {
  const currentType = String(current?.type || "");
  const candidateType = String(candidate?.type || "");
  if (!candidateType) return { type: currentType, status: String(current?.status || "") };
  if (!currentType) return { type: candidateType, status: String(candidate?.status || "") };
  const currentTypeRank = cardTransactionTypePriority[currentType] || 0;
  const candidateTypeRank = cardTransactionTypePriority[candidateType] || 0;
  if (candidateTypeRank > currentTypeRank) {
    return { type: candidateType, status: String(candidate?.status || "") };
  }
  if (candidateTypeRank < currentTypeRank) {
    return { type: currentType, status: String(current?.status || "") };
  }
  const currentStatus = String(current?.status || "");
  const candidateStatus = String(candidate?.status || "");
  return (cardTransactionStatusPriority[candidateStatus] || 0) > (cardTransactionStatusPriority[currentStatus] || 0)
    ? { type: candidateType, status: candidateStatus }
    : { type: currentType, status: currentStatus };
}

function requireObject(value, message) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new MembershipContractError(message);
  }
  return value;
}

function requireBoolean(value, field) {
  if (typeof value !== "boolean") {
    throw new MembershipContractError(`会员状态字段 ${field} 不是布尔值`);
  }
  return value;
}

function nullableBoolean(value, field) {
  if (value === null || value === undefined) return null;
  return requireBoolean(value, field);
}

function nullableString(value, field) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") {
    throw new MembershipContractError(`会员状态字段 ${field} 不是字符串`);
  }
  return value.trim() || null;
}

function parseTime(value) {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

export function normalizeMembershipEnvelope(envelope, options = {}) {
  const root = requireObject(envelope, "会员状态响应不是对象");
  if (root.code !== 200) {
    throw new MembershipContractError("会员状态响应业务码不是 200");
  }
  const data = requireObject(root.data, "会员状态响应缺少 data");
  const providerType = nullableString(data.account_type, "account_type")?.toLowerCase() || null;
  const accountType = providerType ? MEMBERSHIP_TYPE_MAP[providerType] : null;
  if (!accountType) {
    throw new MembershipContractError("会员状态 account_type 未知或缺失");
  }

  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  const expireTimeRaw = nullableString(data.expire_time, "expire_time");
  const expireTime = parseTime(expireTimeRaw);
  const currencyRaw = nullableString(data.currency, "currency");

  return Object.freeze({
    providerCode: 200,
    providerAccountType: providerType,
    accountType,
    currency: currencyRaw ? currencyRaw.toUpperCase() : null,
    autoRenew: nullableBoolean(data.auto_renew, "auto_renew"),
    isOverdue: requireBoolean(data.is_overdue, "is_overdue"),
    isDelinquent: requireBoolean(data.is_delinquent, "is_delinquent"),
    expireTime,
    expireTimeValid: expireTime !== null,
    expireTimeFuture: expireTime !== null && Date.parse(expireTime) > nowMs,
    observedAt: new Date(nowMs).toISOString()
  });
}

export function classifyStartingMembership(observation) {
  requireObject(observation, "会员状态观察无效");
  if (observation.accountType === "free") {
    return observation.isOverdue === false && observation.isDelinquent === false
      ? "free"
      : "unknown";
  }
  if (!membershipTiers.includes(observation.accountType)) return "unknown";
  if (observation.isOverdue || observation.isDelinquent) return "delinquent";
  return observation.currency && observation.expireTimeFuture ? "subscribed" : "unknown";
}

export function isStrictMembershipStageConfirmed(observation, expectedTier, options = {}) {
  if (!observation || !membershipTiers.includes(expectedTier)) return false;
  if (observation.accountType !== expectedTier) return false;
  if (observation.currency !== "PHP") return false;
  if (observation.isOverdue !== false || observation.isDelinquent !== false) return false;
  if (!observation.expireTimeFuture) return false;
  if (options.requireAutoRenewFalse && observation.autoRenew !== false) return false;
  return true;
}

function roundUsd(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function parseSpaceXCardTime(value) {
  if (typeof value !== "string" || !value.trim()) return NaN;
  const normalized = value.trim();
  const providerLocal = normalized.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})$/);
  const parsed = Date.parse(providerLocal ? `${providerLocal[1]}T${providerLocal[2]}+08:00` : normalized);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function normalizePriceSignals(signals) {
  if (Array.isArray(signals)) return new Map(signals.map((item) => [item?.tier, item]));
  if (signals && typeof signals === "object") return new Map(Object.entries(signals));
  return new Map();
}

export function calculateMembershipBudget(signals, targetTier, options = {}) {
  if (!membershipTiers.includes(targetTier)) throw new TypeError("targetTier 无效");
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  const signalMap = normalizePriceSignals(signals);
  const requiredTiers = targetTier === "plus" ? ["plus"] : ["plus", targetTier];
  const stages = requiredTiers.map((tier) => {
    const signal = signalMap.get(tier);
    const providerTimeMs = parseSpaceXCardTime(signal?.time);
    const ageMs = nowMs - providerTimeMs;
    if (signal?.found !== true || !Number.isFinite(signal?.amount) || signal.amount <= 0
      || !Number.isFinite(providerTimeMs) || ageMs < -5 * 60 * 1000 || ageMs > cardPriceFreshnessMs) {
      const error = new Error(`卡段 ${tier} 行情不可用`);
      error.code = "CARD_PRICE_UNAVAILABLE";
      error.retryable = true;
      error.retryScope = "order";
      throw error;
    }
    return Object.freeze({
      tier,
      priceUsd: roundUsd(signal.amount),
      allowanceUsd: membershipStageAllowanceUsd,
      budgetUsd: roundUsd(signal.amount + membershipStageAllowanceUsd),
      providerTime: new Date(providerTimeMs).toISOString()
    });
  });
  return Object.freeze({
    targetTier,
    stages: Object.freeze(stages),
    totalUsd: roundUsd(stages.reduce((sum, stage) => sum + stage.budgetUsd, 0))
  });
}

function transactionAmount(transaction) {
  const settled = Number(transaction?.settleAmount);
  if (Number.isFinite(settled) && settled > 0) return settled;
  const authorized = Number(transaction?.authAmount);
  return Number.isFinite(authorized) ? authorized : NaN;
}

function transactionCurrency(transaction) {
  const settled = Number(transaction?.settleAmount);
  const currency = Number.isFinite(settled) && settled > 0
    ? transaction?.settleCurrency
    : transaction?.authCurrency;
  return typeof currency === "string" && currency.trim() ? currency.trim().toUpperCase() : null;
}

function transactionAmountPriority(transaction) {
  const settled = Number(transaction?.settleAmount);
  return Number.isFinite(settled) && settled > 0 ? 2 : 1;
}

function isOpenAiTransaction(transaction) {
  return String(transaction?.merchantNormalized || "").trim().toUpperCase() === "OPENAI";
}

function latestTransactionByAuthId(transactions) {
  const byId = new Map();
  const statusRank = { DECLINED: 1, PENDING: 2, COMPLETE: 3 };
  for (const transaction of transactions || []) {
    const authId = String(transaction?.authId || "").trim();
    if (!authId) continue;
    const current = byId.get(authId);
    if (!current || (statusRank[transaction.status] || 0) >= (statusRank[current.status] || 0)) {
      byId.set(authId, { ...transaction, authId });
    }
  }
  return [...byId.values()];
}

export function matchPaymentTransactionDelta(options = {}) {
  const before = new Set([...(options.beforeAuthIds || [])].map(String));
  const minUsd = Number(options.minUsd);
  const maxUsd = Number(options.maxUsd);
  if (!Number.isFinite(minUsd) || !Number.isFinite(maxUsd) || minUsd < 0 || maxUsd < minUsd) {
    throw new TypeError("交易金额范围无效");
  }
  const recognitionRange = membershipPaymentRecognitionRanges[options.tier];
  const recognizedMinUsd = recognitionRange ? Math.min(minUsd, recognitionRange.minUsd) : minUsd;
  const recognizedMaxUsd = recognitionRange ? Math.max(maxUsd, recognitionRange.maxUsd) : maxUsd;
  const candidates = latestTransactionByAuthId(options.transactions)
    .filter((item) => !before.has(item.authId))
    .filter(isOpenAiTransaction)
    .filter((item) => {
      const amount = transactionAmount(item);
      return Number.isFinite(amount) && amount >= recognizedMinUsd && amount <= recognizedMaxUsd;
    });
  const effective = candidates.filter((item) => ["PENDING", "COMPLETE"].includes(item.status)
    && !["Refund", "Reversal"].includes(item.type));
  if (effective.length === 1) return Object.freeze({ outcome: "matched", transaction: effective[0] });
  if (effective.length > 1) return Object.freeze({ outcome: "uncertain", reason: "MULTIPLE_MATCHES", matches: effective.length });
  const declined = candidates.filter((item) => item.status === "DECLINED");
  if (declined.length === 1) return Object.freeze({ outcome: "declined", transaction: declined[0] });
  return Object.freeze({
    outcome: "uncertain",
    reason: declined.length > 1 ? "MULTIPLE_DECLINES" : "NO_MATCH",
    matches: declined.length
  });
}

export function rankMembershipCardCandidates(candidates, targetTier) {
  if (!membershipTiers.includes(targetTier)) throw new TypeError("targetTier 无效");
  return (candidates || [])
    .filter((item) => item?.eligible === true)
    .filter((item) => item.lane === targetTier || item.lane === null || item.lane === undefined)
    .map((item) => {
      const budgetUsd = Number(item.budgetUsd);
      const availableAmount = Number(item.availableAmount);
      if (!Number.isFinite(budgetUsd) || !Number.isFinite(availableAmount)) return null;
      return {
        ...item,
        laneRank: item.lane === targetTier ? 0 : 1,
        fundingShortfallUsd: roundUsd(Math.max(0, budgetUsd - availableAmount))
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.laneRank - right.laneRank
      || left.fundingShortfallUsd - right.fundingShortfallUsd
      || String(left.id).localeCompare(String(right.id)));
}

function classifyOpenAiTier(amount) {
  return membershipTiers.find((tier) => {
    const range = membershipPaymentRecognitionRanges[tier];
    return amount >= range.minUsd && amount <= range.maxUsd;
  }) || null;
}

function foldHistoricalAuthorizations(transactions) {
  const authorizations = new Map();
  for (const event of transactions || []) {
    const authId = String(event?.authId || "").trim();
    if (!authId || !isOpenAiTransaction(event)) continue;
    const record = authorizations.get(authId) || {
      authId,
      authTimeMs: NaN,
      amount: NaN,
      amountPriority: 0,
      currency: null,
      authorizationPending: false,
      settlementComplete: false,
      refundSeen: false,
      reversalSeen: false
    };
    const timeMs = Date.parse(event.authTime || event.createdAt || "");
    if (Number.isFinite(timeMs) && (!Number.isFinite(record.authTimeMs) || timeMs < record.authTimeMs)) {
      record.authTimeMs = timeMs;
    }
    const amount = transactionAmount(event);
    const amountPriority = transactionAmountPriority(event);
    if (Number.isFinite(amount) && amount > 0 && amountPriority >= record.amountPriority) {
      record.amount = amount;
      record.amountPriority = amountPriority;
      record.currency = transactionCurrency(event);
    }
    if (event.type === "Authorization" && event.status === "PENDING") record.authorizationPending = true;
    if (event.type === "Settlement" && event.status === "COMPLETE") record.settlementComplete = true;
    if (event.type === "Refund" && ["PENDING", "COMPLETE"].includes(event.status)) record.refundSeen = true;
    if (event.type === "Reversal" && event.status === "COMPLETE") record.reversalSeen = true;
    authorizations.set(authId, record);
  }
  return [...authorizations.values()];
}

export function classifyHistoricalCardFulfillments(transactions, options = {}) {
  const authorizations = foldHistoricalAuthorizations(transactions);
  const knownLane = membershipTiers.includes(options.knownLane) ? options.knownLane : null;
  if (authorizations.some((item) => item.refundSeen && item.settlementComplete)) {
    return Object.freeze({ lane: null, consumed: 0, state: "RECONCILIATION_HOLD", reason: "REFUNDED_FULFILLMENT" });
  }
  if (knownLane !== "plus"
    && authorizations.some((item) => item.authorizationPending && !item.settlementComplete && !item.reversalSeen)) {
    return Object.freeze({ lane: null, consumed: 0, state: "RECONCILIATION_HOLD", reason: "PENDING_SETTLEMENT" });
  }

  const effective = authorizations
    .filter((item) => item.settlementComplete || (item.authorizationPending && !item.reversalSeen))
    .map((item) => ({
      ...item,
      tier: classifyOpenAiTier(item.amount)
        || (knownLane === "plus" && item.authorizationPending && !item.settlementComplete
          && item.currency && item.currency !== "USD" ? "plus" : null)
    }));
  if (effective.length === 0) {
    return Object.freeze({ lane: knownLane, consumed: 0, state: "AVAILABLE", reason: null });
  }
  if (effective.some((item) => !item.tier || !Number.isFinite(item.authTimeMs))) {
    return Object.freeze({ lane: null, consumed: 0, state: "RECONCILIATION_HOLD", reason: "UNCLASSIFIABLE_OPENAI_PAYMENT" });
  }

  const ordered = effective.sort((left, right) => left.authTimeMs - right.authTimeMs || left.authId.localeCompare(right.authId));
  const unpairedPlus = ordered.filter((item) => item.tier === "plus");
  const finals = ordered.filter((item) => item.tier !== "plus");
  const pairs = [];
  for (const final of finals) {
    let bestIndex = -1;
    let bestDelta = Infinity;
    for (let index = 0; index < unpairedPlus.length; index += 1) {
      const plus = unpairedPlus[index];
      const delta = final.authTimeMs - plus.authTimeMs;
      if (delta >= 0 && delta <= historicalUpgradePairWindowMs && delta < bestDelta) {
        bestIndex = index;
        bestDelta = delta;
      }
    }
    if (bestIndex < 0) {
      return Object.freeze({ lane: null, consumed: 0, state: "RECONCILIATION_HOLD", reason: "UPGRADE_PAIR_MISSING" });
    }
    pairs.push({ tier: final.tier, plus: unpairedPlus[bestIndex], final });
    unpairedPlus.splice(bestIndex, 1);
  }

  if (pairs.length > 0 && unpairedPlus.length > 0) {
    return Object.freeze({ lane: null, consumed: 0, state: "RECONCILIATION_HOLD", reason: "MIXED_MEMBERSHIP_LANES" });
  }
  const finalTiers = new Set(pairs.map((pair) => pair.tier));
  if (finalTiers.size > 1) {
    return Object.freeze({ lane: null, consumed: 0, state: "RECONCILIATION_HOLD", reason: "MIXED_FINAL_TIERS" });
  }

  const lane = pairs.length > 0 ? pairs[0].tier : "plus";
  if (knownLane && lane !== knownLane) {
    return Object.freeze({ lane: null, consumed: 0, state: "RECONCILIATION_HOLD", reason: "MIXED_MEMBERSHIP_LANES" });
  }
  const consumed = pairs.length > 0 ? pairs.length : unpairedPlus.length;
  const capacity = membershipCapacityByTier[lane];
  if (consumed > capacity) {
    return Object.freeze({ lane: null, consumed, state: "RECONCILIATION_HOLD", reason: "CAPACITY_EXCEEDED" });
  }
  return Object.freeze({
    lane,
    consumed,
    state: consumed === capacity ? "CAPACITY_FULL" : "AVAILABLE",
    reason: null
  });
}
