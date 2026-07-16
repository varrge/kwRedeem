import { createHash, randomUUID } from "node:crypto";
import { membershipCapacityByTier, membershipTiers } from "./membership-fulfillment.js";
import { decryptText, encryptText } from "./secure.js";

export const membershipFundingPaymentGateDefault = Object.freeze({
  enabled: false,
  mode: "disabled"
});

export class MembershipFundingError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = "MembershipFundingError";
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.retryScope = options.retryScope || "order";
  }
}

function fundingError(code, message, options) {
  return new MembershipFundingError(code, message, options);
}

function requiredString(value, field, maxLength = 200) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized || normalized.length > maxLength) {
    throw new TypeError(`${field} 无效`);
  }
  return normalized;
}

function timestamp(value) {
  if (value === undefined) return new Date().toISOString();
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new TypeError("时间无效");
  return new Date(parsed).toISOString();
}

function usd(value, field, options = {}) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || (options.positive && number <= 0)) {
    throw new TypeError(`${field} 无效`);
  }
  return Math.round((number + Number.EPSILON) * 100) / 100;
}

function sameUsd(left, right) {
  return usd(left, "金额") === usd(right, "金额");
}

function canonicalJson(value, seen = new Set()) {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("资金请求正文包含无效数字");
    return JSON.stringify(value);
  }
  if (typeof value !== "object") throw new TypeError("资金请求正文必须是 JSON 值");
  if (seen.has(value)) throw new TypeError("资金请求正文不能循环引用");
  seen.add(value);
  try {
    if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item, seen)).join(",")}]`;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("资金请求正文必须是普通 JSON 对象");
    }
    return `{${Object.keys(value).sort().map((key) => {
      if (value[key] === undefined) throw new TypeError("资金请求正文不能包含 undefined");
      return `${JSON.stringify(key)}:${canonicalJson(value[key], seen)}`;
    }).join(",")}}`;
  } finally {
    seen.delete(value);
  }
}

export function createFundingRequestFingerprint(requestBody) {
  return createHash("sha256").update(canonicalJson(requestBody)).digest("hex");
}

export function buildFundingIdempotencyKey(orderNo, operation) {
  const normalizedOrderNo = requiredString(orderNo, "orderNo", 140);
  if (!/^[A-Za-z0-9._-]+$/.test(normalizedOrderNo)) throw new TypeError("orderNo 不能用于资金幂等键");
  if (!["open", "recharge"].includes(operation)) throw new TypeError("资金操作无效");
  return `kwr:${normalizedOrderNo}:${operation}:v1`;
}

function toReservation(row) {
  if (!row) return null;
  return Object.freeze({
    id: row.id,
    fulfillmentId: row.fulfillment_id,
    cardId: row.card_id || null,
    plannedProductCode: row.planned_product_code || null,
    targetLane: row.target_lane,
    slotIndex: row.slot_index === null ? null : Number(row.slot_index),
    state: row.state,
    reservedAt: row.reserved_at,
    consumedAt: row.consumed_at || null,
    releasedAt: row.released_at || null,
    releaseEvidenceRevision: row.release_evidence_revision === null
      ? null
      : Number(row.release_evidence_revision)
  });
}

function requireTargetLane(value) {
  if (!membershipTiers.includes(value)) throw new TypeError("targetLane 无效");
  return value;
}

function getFulfillmentForReservation(db, fulfillmentId, targetLane) {
  const fulfillment = db.prepare(`
    SELECT id, target_tier, card_reservation_id
    FROM membership_fulfillments WHERE id = ?
  `).get(fulfillmentId);
  if (!fulfillment) throw fundingError("MEMBERSHIP_FULFILLMENT_NOT_FOUND", "会员履约不存在");
  if (fulfillment.target_tier !== targetLane) {
    throw fundingError("CARD_RESERVATION_TIER_MISMATCH", "容量预留档位与履约档位不一致");
  }
  return fulfillment;
}

function activeSlotSet(db, card, targetLane) {
  const occupied = new Set();
  for (let slot = 1; slot <= Number(card.consumed_slots || 0); slot += 1) occupied.add(slot);
  const rows = db.prepare(`
    SELECT slot_index FROM card_capacity_reservations
    WHERE card_id = ? AND target_lane = ?
      AND state IN ('reserved', 'consumed', 'retained_partial')
  `).all(card.id, targetLane);
  for (const row of rows) {
    if (Number.isInteger(row.slot_index) && row.slot_index > 0) occupied.add(row.slot_index);
  }
  return occupied;
}

function firstFreeSlot(db, card, targetLane) {
  const capacity = membershipCapacityByTier[targetLane];
  const occupied = activeSlotSet(db, card, targetLane);
  for (let slot = 1; slot <= capacity; slot += 1) {
    if (!occupied.has(slot)) return slot;
  }
  throw fundingError("CARD_CAPACITY_FULL", "卡片目标档位容量已满", { retryable: true });
}

function assertCardReservable(card, targetLane) {
  if (!card) throw fundingError("MEMBERSHIP_CARD_NOT_FOUND", "托管卡片不存在");
  if (card.upstream_status !== "ACTIVE" || card.reconciliation_state !== "READY" || card.capacity_state === "HOLD") {
    throw fundingError("MEMBERSHIP_CARD_NOT_READY", "托管卡片当前不可预留", { retryable: true });
  }
  if (card.lane && card.lane !== targetLane) {
    throw fundingError("CARD_LANE_MISMATCH", "卡片已经锁定为另一会员档位");
  }
}

function updateCardCapacityState(db, cardId, targetLane, at) {
  const card = db.prepare("SELECT * FROM managed_cards WHERE id = ?").get(cardId);
  if (!card || card.capacity_state === "HOLD") return;
  const occupied = activeSlotSet(db, card, targetLane);
  db.prepare(`
    UPDATE managed_cards SET capacity_state = ?, updated_at = ? WHERE id = ?
  `).run(occupied.size >= membershipCapacityByTier[targetLane] ? "CAPACITY_FULL" : "AVAILABLE", at, cardId);
}

function returnExistingReservation(db, fulfillment, expected) {
  const existing = db.prepare(`
    SELECT * FROM card_capacity_reservations WHERE fulfillment_id = ?
  `).get(fulfillment.id);
  if (!existing) return null;
  if (existing.state === "released") {
    throw fundingError("CARD_RESERVATION_RELEASED", "该履约的容量预留已经释放，不能替换预留");
  }
  if (existing.target_lane !== expected.targetLane
    || (expected.cardId !== undefined && existing.card_id !== expected.cardId)
    || (expected.plannedProductCode !== undefined && existing.planned_product_code !== expected.plannedProductCode)) {
    throw fundingError("CARD_RESERVATION_CONFLICT", "同一履约不能更换卡片、产品或会员档位");
  }
  if (fulfillment.card_reservation_id && fulfillment.card_reservation_id !== existing.id) {
    throw fundingError("CARD_RESERVATION_CONFLICT", "履约关联了另一容量预留");
  }
  if (!fulfillment.card_reservation_id) {
    db.prepare(`
      UPDATE membership_fulfillments SET card_reservation_id = ? WHERE id = ?
    `).run(existing.id, fulfillment.id);
  }
  return toReservation(existing);
}

function runImmediate(db, callback) {
  try {
    return db.transaction(callback).immediate();
  } catch (error) {
    if (error instanceof MembershipFundingError || error instanceof TypeError) throw error;
    if (error?.code === "SQLITE_BUSY" || error?.code === "SQLITE_LOCKED") {
      throw fundingError("CARD_RESERVATION_BUSY", "容量预留正在被其他履约更新", { retryable: true });
    }
    if (String(error?.code || "").startsWith("SQLITE_CONSTRAINT")) {
      throw fundingError("CARD_RESERVATION_CONFLICT", "容量预留发生并发冲突", { retryable: true });
    }
    throw error;
  }
}

export function reserveMembershipCardCapacity(db, input = {}) {
  const fulfillmentId = requiredString(input.fulfillmentId, "fulfillmentId");
  const cardId = requiredString(input.cardId, "cardId");
  const targetLane = requireTargetLane(input.targetLane);
  const at = timestamp(input.at);
  return runImmediate(db, () => {
    const fulfillment = getFulfillmentForReservation(db, fulfillmentId, targetLane);
    const existing = returnExistingReservation(db, fulfillment, { cardId, targetLane });
    if (existing) return existing;

    const card = db.prepare("SELECT * FROM managed_cards WHERE id = ?").get(cardId);
    assertCardReservable(card, targetLane);
    const slotIndex = firstFreeSlot(db, card, targetLane);
    const reservationId = input.reservationId
      ? requiredString(input.reservationId, "reservationId")
      : `mcr_${randomUUID()}`;
    if (!card.lane) {
      db.prepare("UPDATE managed_cards SET lane = ?, updated_at = ? WHERE id = ?").run(targetLane, at, cardId);
    }
    db.prepare(`
      INSERT INTO card_capacity_reservations (
        id, fulfillment_id, card_id, planned_product_code, target_lane,
        slot_index, state, reserved_at
      ) VALUES (?, ?, ?, NULL, ?, ?, 'reserved', ?)
    `).run(reservationId, fulfillmentId, cardId, targetLane, slotIndex, at);
    db.prepare(`
      UPDATE membership_fulfillments SET card_reservation_id = ?, updated_at = ? WHERE id = ?
    `).run(reservationId, at, fulfillmentId);
    updateCardCapacityState(db, cardId, targetLane, at);
    return toReservation(db.prepare("SELECT * FROM card_capacity_reservations WHERE id = ?").get(reservationId));
  });
}

export function reserveMembershipNewCardPlan(db, input = {}) {
  const fulfillmentId = requiredString(input.fulfillmentId, "fulfillmentId");
  const plannedProductCode = requiredString(input.plannedProductCode, "plannedProductCode");
  const targetLane = requireTargetLane(input.targetLane);
  const at = timestamp(input.at);
  return runImmediate(db, () => {
    const fulfillment = getFulfillmentForReservation(db, fulfillmentId, targetLane);
    const existing = returnExistingReservation(db, fulfillment, { plannedProductCode, targetLane });
    if (existing) return existing;
    const reservationId = input.reservationId
      ? requiredString(input.reservationId, "reservationId")
      : `mcr_${randomUUID()}`;
    db.prepare(`
      INSERT INTO card_capacity_reservations (
        id, fulfillment_id, card_id, planned_product_code, target_lane,
        slot_index, state, reserved_at
      ) VALUES (?, ?, NULL, ?, ?, NULL, 'reserved', ?)
    `).run(reservationId, fulfillmentId, plannedProductCode, targetLane, at);
    db.prepare(`
      UPDATE membership_fulfillments SET card_reservation_id = ?, updated_at = ? WHERE id = ?
    `).run(reservationId, at, fulfillmentId);
    return toReservation(db.prepare("SELECT * FROM card_capacity_reservations WHERE id = ?").get(reservationId));
  });
}

export function attachOpenedMembershipCard(db, input = {}) {
  const fulfillmentId = requiredString(input.fulfillmentId, "fulfillmentId");
  const cardId = requiredString(input.cardId, "cardId");
  const at = timestamp(input.at);
  return runImmediate(db, () => {
    const reservation = db.prepare(`
      SELECT * FROM card_capacity_reservations WHERE fulfillment_id = ?
    `).get(fulfillmentId);
    if (!reservation) throw fundingError("CARD_RESERVATION_NOT_FOUND", "新卡计划不存在");
    if (reservation.state !== "reserved") throw fundingError("CARD_RESERVATION_NOT_ACTIVE", "新卡计划已不再有效");
    if (reservation.card_id) {
      if (reservation.card_id !== cardId) throw fundingError("CARD_RESERVATION_CONFLICT", "新卡计划已经绑定另一张卡");
      return toReservation(reservation);
    }
    if (!reservation.planned_product_code) throw fundingError("NEW_CARD_PLAN_REQUIRED", "容量预留不是新卡计划");

    const card = db.prepare("SELECT * FROM managed_cards WHERE id = ?").get(cardId);
    assertCardReservable(card, reservation.target_lane);
    if (card.product_code !== reservation.planned_product_code) {
      throw fundingError("OPENED_CARD_PRODUCT_MISMATCH", "开卡结果与持久化产品计划不一致");
    }
    const intent = db.prepare(`
      SELECT operation, state, provider_resource_id, product_code
      FROM funding_intents WHERE fulfillment_id = ?
    `).get(fulfillmentId);
    if (!intent || intent.operation !== "open" || intent.state !== "succeeded") {
      throw fundingError("OPEN_CARD_FUNDING_NOT_CONFIRMED", "只有已确认成功的开卡资金意图可以绑定新卡");
    }
    if (intent.product_code !== card.product_code
      || intent.provider_resource_id !== String(card.upstream_card_id)) {
      throw fundingError("OPENED_CARD_RESULT_MISMATCH", "托管卡片与开卡资金结果不一致");
    }
    const slotIndex = firstFreeSlot(db, card, reservation.target_lane);
    if (!card.lane) {
      db.prepare("UPDATE managed_cards SET lane = ?, updated_at = ? WHERE id = ?")
        .run(reservation.target_lane, at, cardId);
    }
    db.prepare(`
      UPDATE card_capacity_reservations SET card_id = ?, slot_index = ? WHERE id = ?
    `).run(cardId, slotIndex, reservation.id);
    updateCardCapacityState(db, cardId, reservation.target_lane, at);
    return toReservation(db.prepare("SELECT * FROM card_capacity_reservations WHERE id = ?").get(reservation.id));
  });
}

function assertNoPaymentReleaseEvidence(input) {
  const revision = Number(input.releaseEvidenceRevision);
  const evidence = input.evidence;
  if (!Number.isInteger(revision) || revision <= 0 || !evidence
    || evidence.kind !== "NO_PAYMENT_BEFORE_SUBMIT"
    || evidence.membershipUnchanged !== true
    || evidence.noEffectiveTransaction !== true
    || evidence.noPendingAuthorization !== true) {
    throw fundingError("RESERVATION_RELEASE_EVIDENCE_REQUIRED", "释放容量预留需要明确的无付款证据");
  }
  return revision;
}

export function releaseMembershipCardReservation(db, input = {}) {
  const fulfillmentId = requiredString(input.fulfillmentId, "fulfillmentId");
  const releaseEvidenceRevision = assertNoPaymentReleaseEvidence(input);
  const at = timestamp(input.at);
  return runImmediate(db, () => {
    const reservation = db.prepare(`
      SELECT * FROM card_capacity_reservations WHERE fulfillment_id = ?
    `).get(fulfillmentId);
    if (!reservation) throw fundingError("CARD_RESERVATION_NOT_FOUND", "容量预留不存在");
    if (reservation.state === "released") {
      if (Number(reservation.release_evidence_revision) !== releaseEvidenceRevision) {
        throw fundingError("RESERVATION_RELEASE_CONFLICT", "容量预留已由另一证据版本释放");
      }
      return toReservation(reservation);
    }
    if (reservation.state !== "reserved") {
      throw fundingError("RESERVATION_HAS_PAYMENT_EVIDENCE", "已消费或保留的容量槽不能释放");
    }

    const paymentEvidence = db.prepare(`
      SELECT 1 FROM membership_payment_stages
      WHERE fulfillment_id = ? AND (
        matched_auth_id IS NOT NULL OR confirmed_at IS NOT NULL
        OR submit_permitted_at IS NOT NULL OR submit_reported_at IS NOT NULL
        OR settlement_state IN ('PENDING', 'COMPLETE')
      ) LIMIT 1
    `).get(fulfillmentId);
    if (paymentEvidence) {
      throw fundingError("RESERVATION_HAS_PAYMENT_EVIDENCE", "履约已经存在付款或提交证据，不能由预提交释放流程处理");
    }

    const funding = db.prepare(`
      SELECT state, submitted_at FROM funding_intents WHERE fulfillment_id = ?
    `).get(fulfillmentId);
    if (funding && ["submitted", "outcome_unknown"].includes(funding.state)) {
      throw fundingError("RESERVATION_FUNDING_OUTCOME_UNRESOLVED", "资金操作结果未明确，容量预留必须保留");
    }
    if (funding?.submitted_at) {
      throw fundingError("RESERVATION_FUNDING_ALREADY_SUBMITTED", "已经发出资金请求，不能由预提交释放流程处理");
    }

    db.prepare(`
      UPDATE card_capacity_reservations
      SET state = 'released', released_at = ?, release_evidence_revision = ?
      WHERE id = ?
    `).run(at, releaseEvidenceRevision, reservation.id);

    if (reservation.card_id) {
      const card = db.prepare("SELECT * FROM managed_cards WHERE id = ?").get(reservation.card_id);
      const activeReservations = db.prepare(`
        SELECT COUNT(*) AS count FROM card_capacity_reservations
        WHERE card_id = ? AND state IN ('reserved', 'consumed', 'retained_partial')
      `).get(reservation.card_id);
      const effectivePayments = db.prepare(`
        SELECT COUNT(*) AS count FROM managed_card_transactions
        WHERE card_id = ? AND merchant_normalized = 'OPENAI'
          AND status IN ('PENDING', 'COMPLETE')
          AND type NOT IN ('Refund', 'Reversal')
      `).get(reservation.card_id);
      if (card?.lane === reservation.target_lane
        && Number(card.consumed_slots || 0) === 0
        && Number(activeReservations.count || 0) === 0
        && Number(effectivePayments.count || 0) === 0) {
        db.prepare("UPDATE managed_cards SET lane = NULL, updated_at = ? WHERE id = ?").run(at, reservation.card_id);
      }
      updateCardCapacityState(db, reservation.card_id, reservation.target_lane, at);
    }
    return toReservation(db.prepare("SELECT * FROM card_capacity_reservations WHERE id = ?").get(reservation.id));
  });
}

export function planMembershipFunding(input = {}) {
  const kind = input.kind;
  if (!["existing_card", "new_card"].includes(kind)) throw new TypeError("资金规划类型无效");
  if (input.platformCurrency !== undefined && String(input.platformCurrency).toUpperCase() !== "USD") {
    throw fundingError("PLATFORM_BALANCE_CURRENCY_UNSUPPORTED", "SpaceX Card 平台余额必须是 USD");
  }
  const fullOrderBudgetUsd = usd(input.fullOrderBudgetUsd, "fullOrderBudgetUsd", { positive: true });
  const platformBalanceUsd = usd(input.platformBalanceUsd, "platformBalanceUsd");
  const minAmountUsd = usd(input.minAmountUsd ?? 0, "minAmountUsd");
  const maxAmountUsd = usd(input.maxAmountUsd, "maxAmountUsd", { positive: true });
  if (maxAmountUsd < minAmountUsd) throw new TypeError("产品金额范围无效");

  if (kind === "new_card") {
    const fundingAmountUsd = Math.max(minAmountUsd, fullOrderBudgetUsd);
    if (fundingAmountUsd > maxAmountUsd) {
      throw fundingError("CARD_PRODUCT_AMOUNT_UNSUPPORTED", "开卡产品最高金额不足以覆盖完整订单预算");
    }
    const feeUsd = usd(input.openFeeUsd, "openFeeUsd");
    const platformDebitUsd = usd(fundingAmountUsd + feeUsd, "platformDebitUsd");
    const platformBalanceSufficient = platformBalanceUsd >= platformDebitUsd;
    return Object.freeze({
      kind,
      operation: "open",
      fullOrderBudgetUsd,
      availableAmountUsd: 0,
      fundingAmountUsd,
      feeUsd,
      platformDebitUsd,
      platformBalanceUsd,
      platformBalanceSufficient,
      riskReservationUsd: usd(fullOrderBudgetUsd + feeUsd, "riskReservationUsd"),
      failureCode: platformBalanceSufficient ? null : "PLATFORM_BALANCE_INSUFFICIENT"
    });
  }

  const availableAmountUsd = usd(input.cardAvailableAmountUsd, "cardAvailableAmountUsd");
  const fundingAmountUsd = usd(Math.max(0, fullOrderBudgetUsd - availableAmountUsd), "fundingAmountUsd");
  if (fundingAmountUsd === 0) {
    return Object.freeze({
      kind,
      operation: "none",
      fullOrderBudgetUsd,
      availableAmountUsd,
      fundingAmountUsd: 0,
      feeUsd: 0,
      platformDebitUsd: 0,
      platformBalanceUsd,
      platformBalanceSufficient: true,
      riskReservationUsd: fullOrderBudgetUsd,
      failureCode: null
    });
  }
  if (fundingAmountUsd < minAmountUsd) {
    throw fundingError("CARD_RECHARGE_MINIMUM_EXCEEDS_SHORTFALL", "卡片最小充值额高于完整订单的实际短缺，拒绝超额充值");
  }
  if (fundingAmountUsd > maxAmountUsd) {
    throw fundingError("CARD_PRODUCT_AMOUNT_UNSUPPORTED", "卡片最高充值额不足以覆盖完整订单短缺");
  }
  const rechargeFeeRate = Number(input.rechargeFeeRate);
  if (!Number.isFinite(rechargeFeeRate) || rechargeFeeRate < 0 || rechargeFeeRate > 1) {
    throw new TypeError("rechargeFeeRate 无效");
  }
  const feeUsd = usd(fundingAmountUsd * rechargeFeeRate, "feeUsd");
  const platformDebitUsd = usd(fundingAmountUsd + feeUsd, "platformDebitUsd");
  const platformBalanceSufficient = platformBalanceUsd >= platformDebitUsd;
  return Object.freeze({
    kind,
    operation: "recharge",
    fullOrderBudgetUsd,
    availableAmountUsd,
    fundingAmountUsd,
    feeUsd,
    platformDebitUsd,
    platformBalanceUsd,
    platformBalanceSufficient,
    riskReservationUsd: usd(fullOrderBudgetUsd + feeUsd, "riskReservationUsd"),
    failureCode: platformBalanceSufficient ? null : "PLATFORM_BALANCE_INSUFFICIENT"
  });
}

function toFundingIntent(row) {
  if (!row) return null;
  return Object.freeze({
    id: row.id,
    fulfillmentId: row.fulfillment_id,
    operation: row.operation,
    targetCardId: row.target_card_id || null,
    productCode: row.product_code || null,
    amountUsd: Number(row.amount),
    feeUsd: Number(row.fee),
    idempotencyKey: row.idempotency_key,
    requestFingerprint: row.request_fingerprint,
    state: row.state,
    providerResourceId: row.provider_resource_id || null,
    createdAt: row.created_at,
    submittedAt: row.submitted_at || null,
    resolvedAt: row.resolved_at || null
  });
}

export function getMembershipFundingIntent(db, fulfillmentId) {
  const id = requiredString(fulfillmentId, "fulfillmentId");
  return toFundingIntent(db.prepare("SELECT * FROM funding_intents WHERE fulfillment_id = ?").get(id));
}

function validateFundingRequest(db, input, canonicalBody) {
  let body;
  try {
    body = JSON.parse(canonicalBody);
  } catch {
    throw new TypeError("资金请求正文不是合法 JSON");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new TypeError("资金请求正文必须是对象");
  const amountUsd = usd(input.amountUsd, "amountUsd", { positive: true });
  if (input.operation === "recharge") {
    if (Object.keys(body).sort().join(",") !== "amount,card_id") {
      throw fundingError("FUNDING_REQUEST_PLAN_MISMATCH", "充值请求正文字段与固定适配器不一致");
    }
    const targetCardId = requiredString(input.targetCardId, "targetCardId");
    const card = db.prepare("SELECT upstream_card_id FROM managed_cards WHERE id = ?").get(targetCardId);
    if (!card) throw fundingError("MEMBERSHIP_CARD_NOT_FOUND", "充值目标卡不存在");
    if (Number(body.card_id) !== Number(card.upstream_card_id) || !sameUsd(body.amount, amountUsd)) {
      throw fundingError("FUNDING_REQUEST_PLAN_MISMATCH", "充值请求正文与持久化资金计划不一致");
    }
    return { body, amountUsd, targetCardId, productCode: null };
  }
  if (Object.keys(body).sort().join(",") !== "first_name,init_amount,last_name,product_code") {
    throw fundingError("FUNDING_REQUEST_PLAN_MISMATCH", "开卡请求正文字段与固定适配器不一致");
  }
  const productCode = requiredString(input.productCode, "productCode");
  if (body.product_code !== productCode || !sameUsd(body.init_amount, amountUsd)
    || !requiredString(body.first_name, "first_name") || !requiredString(body.last_name, "last_name")) {
    throw fundingError("FUNDING_REQUEST_PLAN_MISMATCH", "开卡请求正文与持久化资金计划不一致");
  }
  return { body, amountUsd, targetCardId: null, productCode };
}

export function prepareMembershipFundingIntent(db, input = {}) {
  const fulfillmentId = requiredString(input.fulfillmentId, "fulfillmentId");
  const operation = input.operation;
  if (!["open", "recharge"].includes(operation)) throw new TypeError("资金操作无效");
  const orderNo = requiredString(input.orderNo, "orderNo", 140);
  const idempotencyKey = buildFundingIdempotencyKey(orderNo, operation);
  const feeUsd = usd(input.feeUsd ?? 0, "feeUsd");
  const at = timestamp(input.at);
  const canonicalBody = canonicalJson(input.requestBody);
  const requestFingerprint = createHash("sha256").update(canonicalBody).digest("hex");

  return runImmediate(db, () => {
    const fulfillment = db.prepare(`
      SELECT id, order_no, card_reservation_id FROM membership_fulfillments WHERE id = ?
    `).get(fulfillmentId);
    if (!fulfillment) throw fundingError("MEMBERSHIP_FULFILLMENT_NOT_FOUND", "会员履约不存在");
    if (fulfillment.order_no !== orderNo) throw fundingError("FUNDING_ORDER_MISMATCH", "资金幂等键订单与履约不一致");
    const reservation = db.prepare(`
      SELECT * FROM card_capacity_reservations WHERE fulfillment_id = ?
    `).get(fulfillmentId);
    if (!reservation || reservation.state !== "reserved") {
      throw fundingError("ACTIVE_CARD_RESERVATION_REQUIRED", "准备资金意图前必须存在有效容量预留");
    }
    const validated = validateFundingRequest(db, { ...input, operation }, canonicalBody);
    if (operation === "recharge" && reservation.card_id !== validated.targetCardId) {
      throw fundingError("FUNDING_REQUEST_PLAN_MISMATCH", "充值卡与容量预留不一致");
    }
    if (operation === "open" && (reservation.card_id || reservation.planned_product_code !== validated.productCode)) {
      throw fundingError("FUNDING_REQUEST_PLAN_MISMATCH", "开卡产品与容量预留不一致");
    }

    const existing = db.prepare("SELECT * FROM funding_intents WHERE fulfillment_id = ?").get(fulfillmentId);
    if (existing) {
      if (existing.operation !== operation
        || existing.target_card_id !== validated.targetCardId
        || existing.product_code !== validated.productCode
        || !sameUsd(existing.amount, validated.amountUsd)
        || !sameUsd(existing.fee, feeUsd)
        || existing.idempotency_key !== idempotencyKey
        || existing.request_fingerprint !== requestFingerprint) {
        throw fundingError("FUNDING_INTENT_CONFLICT", "同一履约的资金意图不可修改");
      }
      return toFundingIntent(existing);
    }

    const intentId = input.intentId
      ? requiredString(input.intentId, "intentId")
      : `mfi_${randomUUID()}`;
    db.prepare(`
      INSERT INTO funding_intents (
        id, fulfillment_id, operation, target_card_id, product_code,
        amount, fee, idempotency_key, request_fingerprint,
        request_body_encrypted, state, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'prepared', ?)
    `).run(
      intentId,
      fulfillmentId,
      operation,
      validated.targetCardId,
      validated.productCode,
      validated.amountUsd,
      feeUsd,
      idempotencyKey,
      requestFingerprint,
      encryptText(canonicalBody),
      at
    );
    return toFundingIntent(db.prepare("SELECT * FROM funding_intents WHERE id = ?").get(intentId));
  });
}

function decodePersistedRequest(row) {
  let serialized;
  let requestBody;
  try {
    serialized = decryptText(row.request_body_encrypted);
    requestBody = JSON.parse(serialized);
  } catch {
    throw fundingError("FUNDING_INTENT_STORAGE_INVALID", "持久化资金请求无法验证");
  }
  const canonical = canonicalJson(requestBody);
  const fingerprint = createHash("sha256").update(canonical).digest("hex");
  if (serialized !== canonical || fingerprint !== row.request_fingerprint) {
    throw fundingError("FUNDING_INTENT_STORAGE_INVALID", "持久化资金请求指纹不一致");
  }
  return requestBody;
}

function deepFreezeJson(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreezeJson(child);
  return Object.freeze(value);
}

function assertInitialPaymentGate(db, fulfillmentId, gate) {
  if (gate?.enabled !== true || !["canary", "automatic"].includes(gate?.mode)) {
    throw fundingError("MEMBERSHIP_PAYMENT_GATE_LOCKED", "会员资金 Payment Gate 未开启");
  }
  const fulfillment = db.prepare(`
    SELECT run_mode, money_boundary_at FROM membership_fulfillments WHERE id = ?
  `).get(fulfillmentId);
  if (!fulfillment) throw fundingError("MEMBERSHIP_FULFILLMENT_NOT_FOUND", "会员履约不存在");
  if (gate.mode === "automatic") {
    const quota = db.prepare(`
      SELECT reservation.state, scope.status AS scope_status
      FROM automatic_checkout_quota_reservations reservation
      JOIN automatic_checkout_scopes scope ON scope.id = reservation.scope_id
      WHERE reservation.fulfillment_id = ?
    `).get(fulfillmentId);
    if (fulfillment.run_mode !== "automatic" || quota?.state !== "reserved") {
      throw fundingError("AUTOMATIC_FUNDING_QUOTA_REQUIRED", "自动资金操作必须先原子占用每日订单和风险额度");
    }
    if (quota.scope_status !== "active") {
      throw fundingError("AUTOMATIC_FUNDING_SCOPE_INACTIVE", "自动范围已暂停，尚未跨资金边界的履约不能发起资金请求");
    }
    return;
  }
  if (fulfillment.run_mode && fulfillment.run_mode !== "canary") {
    throw fundingError("MEMBERSHIP_FUNDING_RUN_MODE_CONFLICT", "会员履约运行模式与资金 Gate 不一致");
  }
}

function assertRecoveryGate(gate) {
  if (gate?.enabled !== true) {
    throw fundingError("MEMBERSHIP_PAYMENT_GATE_LOCKED", "会员资金恢复 Gate 未开启");
  }
}

function acquireFundingCall(db, fulfillmentId, options = {}) {
  return runImmediate(db, () => {
    const row = db.prepare("SELECT * FROM funding_intents WHERE fulfillment_id = ?").get(fulfillmentId);
    if (!row) throw fundingError("FUNDING_INTENT_NOT_FOUND", "资金意图不存在");
    if (row.state === "succeeded") return { row, requestBody: null, alreadySucceeded: true };

    if (options.recovery) {
      if (row.state === "submitted" && options.allowOrphanedSubmitted !== true) {
        throw fundingError("FUNDING_SUBMISSION_IN_PROGRESS", "资金请求仍标记为提交中，需先确认执行者已经失联");
      }
      if (!["outcome_unknown", "submitted"].includes(row.state)) {
        throw fundingError("FUNDING_RECOVERY_NOT_ALLOWED", "只有结果未知的原资金意图允许恢复");
      }
    } else {
      if (row.state === "outcome_unknown") {
        throw fundingError("FUNDING_RECOVERY_REQUIRED", "资金结果未知，只能走原样恢复流程");
      }
      if (row.state === "submitted") {
        throw fundingError("FUNDING_SUBMISSION_IN_PROGRESS", "资金请求已经提交，不能再次普通提交");
      }
      if (row.state !== "prepared") {
        throw fundingError("FUNDING_SUBMISSION_NOT_ALLOWED", "资金意图当前状态不允许提交");
      }
    }

    const requestBody = decodePersistedRequest(row);
    const at = timestamp(options.at);
    db.prepare(`
      UPDATE funding_intents
      SET state = 'submitted', submitted_at = COALESCE(submitted_at, ?), resolved_at = NULL
      WHERE id = ?
    `).run(at, row.id);
    db.prepare(`
      UPDATE membership_fulfillments
      SET money_boundary_at = COALESCE(money_boundary_at, ?), updated_at = ?
      WHERE id = ?
    `).run(at, at, fulfillmentId);
    return {
      row: db.prepare("SELECT * FROM funding_intents WHERE id = ?").get(row.id),
      requestBody,
      alreadySucceeded: false
    };
  });
}

function normalizeProviderSuccess(row, result) {
  if (row.operation === "recharge") {
    if (!result || result.succeeded !== true) {
      throw fundingError("FUNDING_PROVIDER_RESULT_MISMATCH", "充值成功响应无法匹配原资金意图");
    }
    return Object.freeze({ providerResourceId: null, result: Object.freeze({ succeeded: true }) });
  }
  const upstreamCardId = Number(result?.upstreamCardId);
  const vmCardId = typeof result?.vmCardId === "string" ? result.vmCardId.trim() : "";
  const productCode = typeof result?.productCode === "string" ? result.productCode.trim() : "";
  const availableAmount = usd(result?.availableAmount, "availableAmount");
  const openFee = usd(result?.openFee, "openFee");
  const status = typeof result?.status === "string" ? result.status.toUpperCase() : "";
  if (!Number.isInteger(upstreamCardId) || upstreamCardId <= 0 || !vmCardId
    || productCode !== row.product_code || !sameUsd(availableAmount, row.amount)
    || !sameUsd(openFee, row.fee) || status !== "ACTIVE") {
    throw fundingError("FUNDING_PROVIDER_RESULT_MISMATCH", "开卡成功响应无法匹配原资金意图");
  }
  return Object.freeze({
    providerResourceId: String(upstreamCardId),
    result: Object.freeze({ upstreamCardId, vmCardId, productCode, availableAmount, status, openFee })
  });
}

function persistOpenedCardAndAttach(db, row, result, at) {
  const reservation = db.prepare(`
    SELECT * FROM card_capacity_reservations WHERE fulfillment_id = ?
  `).get(row.fulfillment_id);
  if (!reservation || reservation.state !== "reserved"
    || reservation.planned_product_code !== result.productCode) {
    throw fundingError("OPEN_CARD_RESERVATION_MISMATCH", "开卡结果与持久化容量计划不一致");
  }

  let card = db.prepare("SELECT * FROM managed_cards WHERE upstream_card_id = ?")
    .get(result.upstreamCardId);
  if (!card) {
    const cardId = `mc_${randomUUID()}`;
    db.prepare(`
      INSERT INTO managed_cards (
        id, upstream_card_id, vm_card_id, product_code, bin, last4,
        upstream_status, cached_available_amount, lane, consumed_slots,
        capacity_state, reconciliation_state, last_balance_sync_at,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, NULL, 0, 'AVAILABLE', 'READY', ?, ?, ?)
    `).run(
      cardId,
      result.upstreamCardId,
      result.vmCardId,
      result.productCode,
      result.status,
      result.availableAmount,
      at,
      at,
      at
    );
    card = db.prepare("SELECT * FROM managed_cards WHERE id = ?").get(cardId);
  }
  assertCardReservable(card, reservation.target_lane);
  if (card.vm_card_id !== result.vmCardId || card.product_code !== result.productCode) {
    throw fundingError("OPENED_CARD_RESULT_MISMATCH", "开卡结果与已有托管卡片身份不一致");
  }
  if (reservation.card_id && reservation.card_id !== card.id) {
    throw fundingError("CARD_RESERVATION_CONFLICT", "开卡计划已经绑定另一张卡");
  }
  if (!reservation.card_id) {
    const slotIndex = firstFreeSlot(db, card, reservation.target_lane);
    if (!card.lane) {
      db.prepare("UPDATE managed_cards SET lane = ?, updated_at = ? WHERE id = ?")
        .run(reservation.target_lane, at, card.id);
    }
    db.prepare(`
      UPDATE card_capacity_reservations SET card_id = ?, slot_index = ? WHERE id = ?
    `).run(card.id, slotIndex, reservation.id);
    updateCardCapacityState(db, card.id, reservation.target_lane, at);
  }
  return card.id;
}

function knownNoWriteFailure(error, classifyError) {
  if (typeof classifyError !== "function") return false;
  try {
    return classifyError(error) === "known_failure";
  } catch {
    return false;
  }
}

async function invokeFundingIntent(db, acquired, input) {
  if (acquired.alreadySucceeded) {
    return Object.freeze({ intent: toFundingIntent(acquired.row), providerResult: null, alreadySucceeded: true });
  }
  if (typeof input.invoke !== "function") throw new TypeError("invoke 必须是函数");
  const row = acquired.row;
  try {
    const result = await input.invoke(Object.freeze({
      operation: row.operation,
      requestBody: deepFreezeJson(acquired.requestBody),
      idempotencyKey: row.idempotency_key,
      intent: toFundingIntent(row)
    }));
    const normalized = normalizeProviderSuccess(row, result);
    const resolvedAt = timestamp(input.resolvedAt);
    const persisted = runImmediate(db, () => {
      const managedCardId = row.operation === "open"
        ? persistOpenedCardAndAttach(db, row, normalized.result, resolvedAt)
        : null;
      const changes = db.prepare(`
        UPDATE funding_intents
        SET state = 'succeeded', provider_resource_id = ?, resolved_at = ?
        WHERE id = ? AND state = 'submitted'
      `).run(normalized.providerResourceId, resolvedAt, row.id).changes;
      if (changes !== 1) {
        throw fundingError("FUNDING_INTENT_STATE_CONFLICT", "资金结果写入发生并发冲突");
      }
      return { managedCardId };
    });
    const providerResult = row.operation === "open"
      ? Object.freeze({ ...normalized.result, managedCardId: persisted.managedCardId })
      : normalized.result;
    return Object.freeze({
      intent: getMembershipFundingIntent(db, row.fulfillment_id),
      providerResult,
      alreadySucceeded: false
    });
  } catch (error) {
    if (error instanceof MembershipFundingError && error.code === "FUNDING_INTENT_STATE_CONFLICT") throw error;
    const knownFailure = knownNoWriteFailure(error, input.classifyError);
    const state = knownFailure ? "failed" : "outcome_unknown";
    const resolvedAt = timestamp(input.resolvedAt);
    runImmediate(db, () => {
      db.prepare(`
        UPDATE funding_intents SET state = ?, resolved_at = ?
        WHERE id = ? AND state = 'submitted'
      `).run(state, resolvedAt, row.id);
    });
    if (knownFailure) {
      throw fundingError("FUNDING_PROVIDER_REJECTED", "资金提供方明确拒绝了原请求");
    }
    throw fundingError("FUNDING_OUTCOME_UNKNOWN", "资金请求结果未知，只能使用相同正文和幂等键恢复", {
      retryable: true
    });
  }
}

export async function submitMembershipFundingIntent(db, input = {}) {
  const fulfillmentId = requiredString(input.fulfillmentId, "fulfillmentId");
  assertInitialPaymentGate(db, fulfillmentId, input.paymentGate);
  if (typeof input.invoke !== "function") throw new TypeError("invoke 必须是函数");
  const acquired = acquireFundingCall(db, fulfillmentId, { at: input.at });
  return invokeFundingIntent(db, acquired, input);
}

export async function recoverMembershipFundingIntent(db, input = {}) {
  assertRecoveryGate(input.recoveryGate);
  if (typeof input.invoke !== "function") throw new TypeError("invoke 必须是函数");
  const fulfillmentId = requiredString(input.fulfillmentId, "fulfillmentId");
  const acquired = acquireFundingCall(db, fulfillmentId, {
    recovery: true,
    allowOrphanedSubmitted: input.allowOrphanedSubmitted === true,
    at: input.at
  });
  return invokeFundingIntent(db, acquired, input);
}
