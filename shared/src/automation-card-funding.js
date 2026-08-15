import { createHash, randomUUID } from "node:crypto";
import { EfunCardOpenApiClient } from "./efuncard-openapi.js";
import { SpaceXCardOpenApiClient } from "./spacexcard-openapi.js";

export class AutomationFundingError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = "AutomationFundingError";
    this.code = code;
    this.retryable = options.retryable === true;
    this.unknownOutcome = options.unknownOutcome === true;
  }
}

function fail(code, message, options) {
  throw new AutomationFundingError(code, message, options);
}

function iso(value = Date.now()) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new TypeError("时间无效");
  return date.toISOString();
}

function usd(value, field, positive = false) {
  const result = Math.round((Number(value) + Number.EPSILON) * 100) / 100;
  if (!Number.isFinite(result) || result < 0 || (positive && result <= 0)) throw new TypeError(`${field} 无效`);
  return result;
}

function safeJson(value, fallback = null) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function fundingFingerprint(body) {
  return createHash("sha256").update(JSON.stringify(body, Object.keys(body).sort())).digest("hex");
}

function fundingIdempotencyKey(orderNo, operation) {
  const normalized = String(orderNo || "").trim();
  if (!/^[A-Za-z0-9._:-]{1,120}$/.test(normalized) || !["open", "recharge"].includes(operation)) {
    throw new TypeError("资金幂等键无效");
  }
  return `kwa:${normalized}:${operation}:v1`;
}

export function createConfiguredAutomationCardProvider(db, providerKey, decryptText, options = {}) {
  const platform = db.prepare("SELECT * FROM membership_card_platforms WHERE key = ? AND enabled = 1").get(providerKey);
  if (!platform) fail("AUTOMATION_CARD_PLATFORM_DISABLED", "映射指定的卡台未启用", { retryable: true });
  if (providerKey === "spacexcard") {
    const settings = db.prepare("SELECT * FROM membership_fulfillment_settings WHERE id = 'default'").get();
    const encrypted = platform.credential_encrypted || settings?.spacexcard_app_secret_encrypted;
    if (!encrypted) fail("AUTOMATION_CARD_PLATFORM_NOT_CONFIGURED", "SpaceX Card 凭证未配置", { retryable: true });
    const client = new SpaceXCardOpenApiClient({
      appId: settings?.spacexcard_app_id || "",
      appSecret: decryptText(encrypted),
      fetchImpl: options.fetchImpl
    });
    client.classifyFundingError = (error) => {
      if (["SPACEXCARD_AUTH_FAILED", "SPACEXCARD_ACCESS_DENIED"].includes(error?.code)) return "known_no_write";
      if (error?.code === "SPACEXCARD_OPERATION_REJECTED" && error?.retryable === false) return "known_no_write";
      return "unknown";
    };
    return client;
  }
  if (providerKey === "efuncard") {
    if (!platform.base_url || !platform.credential_encrypted) {
      fail("AUTOMATION_CARD_PLATFORM_NOT_CONFIGURED", "EfunCard 凭证未配置", { retryable: true });
    }
    return new EfunCardOpenApiClient({
      baseUrl: platform.base_url,
      apiKey: decryptText(platform.credential_encrypted),
      fetchImpl: options.fetchImpl
    });
  }
  fail("AUTOMATION_CARD_PLATFORM_UNSUPPORTED", "卡台 Adapter 不受支持", { retryable: true });
}

async function listLiveCards(provider) {
  const cards = new Map();
  for (let page = 1; page <= 100; page += 1) {
    const result = await provider.listCards({ page, pageSize: 100, sync: true });
    if (!result || !Array.isArray(result.cards) || !Number.isFinite(Number(result.total))) {
      fail("AUTOMATION_CARD_LIST_INVALID", "卡台返回的卡片列表无效", { retryable: true });
    }
    for (const card of result.cards) cards.set(Number(card.upstreamCardId), card);
    if (result.cards.length === 0 || cards.size >= Number(result.total)) return cards;
  }
  fail("AUTOMATION_CARD_LIST_EXCEEDED", "卡片列表超过安全分页上限", { retryable: true });
}

function occupiedSlots(db, cardId, capacityKey) {
  const occupied = new Set();
  const legacy = db.prepare(`
    SELECT slot_index FROM card_capacity_reservations
    WHERE card_id = ? AND target_lane = ?
      AND state IN ('reserved', 'consumed', 'retained_partial')
  `).all(cardId, capacityKey);
  const current = db.prepare(`
    SELECT slot_index FROM automation_card_reservations
    WHERE card_id = ? AND capacity_key = ?
      AND state IN ('reserved', 'consumed', 'manual_review')
  `).all(cardId, capacityKey);
  for (const row of [...legacy, ...current]) {
    if (Number.isInteger(row.slot_index) && row.slot_index > 0) occupied.add(row.slot_index);
  }
  return occupied;
}

function firstFreeSlot(db, card, mapping) {
  const capacity = Number(mapping.card_capacity);
  const occupied = occupiedSlots(db, card.id, mapping.capacity_key);
  for (let slot = 1; slot <= Math.min(capacity, Number(card.consumed_slots || 0)); slot += 1) {
    occupied.add(slot);
  }
  for (let slot = 1; slot <= capacity; slot += 1) {
    if (!occupied.has(slot)) return slot;
  }
  return null;
}

function persistedReservation(db, executionId) {
  return db.prepare("SELECT * FROM automation_card_reservations WHERE execution_id = ?").get(executionId) || null;
}

function reserveExistingCard(db, execution, mapping, card, slot, at) {
  return db.transaction(() => {
    const existing = persistedReservation(db, execution.id);
    if (existing) return existing;
    const id = `acr_${randomUUID()}`;
    db.prepare(`
      INSERT INTO automation_card_reservations (
        id, execution_id, provider_key, card_id, capacity_key, slot_index, state, reserved_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'reserved', ?)
    `).run(id, execution.id, mapping.card_platform_key, card.id, mapping.capacity_key, slot, at);
    db.prepare(`
      UPDATE managed_cards SET lane = COALESCE(lane, ?), updated_at = ? WHERE id = ?
    `).run(mapping.capacity_key, at, card.id);
    db.prepare(`
      UPDATE automation_executions
      SET card_id = ?, card_reservation_state = 'reserved', updated_at = ? WHERE id = ?
    `).run(card.id, at, execution.id);
    return persistedReservation(db, execution.id);
  }).immediate();
}

function reserveNewCard(db, execution, mapping, at) {
  return db.transaction(() => {
    const existing = persistedReservation(db, execution.id);
    if (existing) return existing;
    if (!mapping.card_product_code) fail("AUTOMATION_CARD_UNAVAILABLE", "没有可用卡片且映射未配置开卡产品", { retryable: true });
    const id = `acr_${randomUUID()}`;
    db.prepare(`
      INSERT INTO automation_card_reservations (
        id, execution_id, provider_key, planned_product_code, capacity_key, state, reserved_at
      ) VALUES (?, ?, ?, ?, ?, 'reserved', ?)
    `).run(id, execution.id, mapping.card_platform_key, mapping.card_product_code, mapping.capacity_key, at);
    db.prepare(`
      UPDATE automation_executions SET card_reservation_state = 'reserved', updated_at = ? WHERE id = ?
    `).run(at, execution.id);
    return persistedReservation(db, execution.id);
  }).immediate();
}

function persistFundingIntent(db, execution, request, encryptText, at) {
  const existing = db.prepare("SELECT * FROM automation_funding_intents WHERE execution_id = ?").get(execution.id);
  if (existing) return existing;
  const idempotencyKey = fundingIdempotencyKey(execution.order_no, request.operation);
  const fingerprint = fundingFingerprint(request.body);
  db.prepare(`
    INSERT INTO automation_funding_intents (
      id, execution_id, provider_key, operation, target_card_id, product_code,
      amount_usd, idempotency_key, request_fingerprint, request_body_encrypted,
      state, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'prepared', ?)
  `).run(
    `afi_${randomUUID()}`,
    execution.id,
    request.providerKey,
    request.operation,
    request.targetCardId || null,
    request.productCode || null,
    request.amountUsd,
    idempotencyKey,
    fingerprint,
    encryptText(JSON.stringify(request.body)),
    at
  );
  return db.prepare("SELECT * FROM automation_funding_intents WHERE execution_id = ?").get(execution.id);
}

function attachOpenedCard(db, execution, mapping, opened, at) {
  const id = `mc_${randomUUID()}`;
  db.prepare(`
    INSERT INTO managed_cards (
      id, provider_key, upstream_card_id, vm_card_id, product_code, last4,
      upstream_status, cached_available_amount, lane, consumed_slots,
      capacity_state, reconciliation_state, last_balance_sync_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, NULL, 'ACTIVE', ?, ?, 0, 'AVAILABLE', 'READY', ?, ?, ?)
  `).run(
    id,
    mapping.card_platform_key,
    opened.upstreamCardId,
    opened.vmCardId,
    opened.productCode,
    opened.availableAmount,
    mapping.capacity_key,
    at,
    at,
    at
  );
  const slot = firstFreeSlot(db, { id }, mapping);
  if (!slot) throw new Error("新卡没有可用容量槽位");
  db.prepare(`
    UPDATE automation_card_reservations
    SET card_id = ?, slot_index = ?, planned_product_code = NULL
    WHERE execution_id = ? AND card_id IS NULL AND state = 'reserved'
  `).run(id, slot, execution.id);
  db.prepare(`
    UPDATE automation_executions SET card_id = ?, updated_at = ? WHERE id = ?
  `).run(id, at, execution.id);
  return db.prepare("SELECT * FROM managed_cards WHERE id = ?").get(id);
}

async function executeFundingIntent(db, execution, mapping, provider, intent, decryptText, at) {
  if (intent.state === "succeeded") return;
  if (["submitted", "outcome_unknown"].includes(intent.state)) {
    fail("AUTOMATION_FUNDING_OUTCOME_UNKNOWN", "卡片资金操作结果不确定", { unknownOutcome: true });
  }
  if (intent.state === "failed") fail("AUTOMATION_FUNDING_REJECTED", "卡台已明确拒绝资金操作", { retryable: true });
  const body = safeJson(decryptText(intent.request_body_encrypted));
  if (!body || fundingFingerprint(body) !== intent.request_fingerprint) {
    fail("AUTOMATION_FUNDING_INTENT_INVALID", "资金意图校验失败");
  }
  db.prepare(`
    UPDATE automation_funding_intents SET state = 'submitted', submitted_at = ? WHERE id = ? AND state = 'prepared'
  `).run(at, intent.id);
  try {
    let result;
    if (intent.operation === "recharge") {
      result = await provider.rechargeCard({ cardId: body.card_id, amount: body.amount }, intent.idempotency_key);
    } else {
      result = await provider.openCard({
        productCode: body.product_code,
        firstName: body.first_name,
        lastName: body.last_name,
        initAmount: body.init_amount
      }, intent.idempotency_key);
      attachOpenedCard(db, execution, mapping, result, at);
    }
    db.prepare(`
      UPDATE automation_funding_intents
      SET state = 'succeeded', provider_resource_id = ?, resolved_at = ? WHERE id = ?
    `).run(
      result?.upstreamCardId ? String(result.upstreamCardId) : (result?.taskId ? String(result.taskId) : null),
      at,
      intent.id
    );
  } catch (error) {
    const classification = typeof provider.classifyFundingError === "function"
      ? provider.classifyFundingError(error)
      : "unknown";
    if (classification === "known_no_write") {
      db.prepare(`UPDATE automation_funding_intents SET state = 'failed', resolved_at = ? WHERE id = ?`).run(at, intent.id);
      fail("AUTOMATION_FUNDING_REJECTED", "卡台明确拒绝了资金操作", { retryable: true });
    }
    db.prepare(`UPDATE automation_funding_intents SET state = 'outcome_unknown' WHERE id = ?`).run(intent.id);
    fail("AUTOMATION_FUNDING_OUTCOME_UNKNOWN", "卡片资金操作结果不确定", { unknownOutcome: true });
  }
}

function normalizeCardMaterial(raw) {
  const number = String(raw?.number || "").replace(/\D/g, "");
  const cvc = String(raw?.cvv || raw?.cvc || "").trim();
  const expMonth = String(raw?.expiryMonth || raw?.expMonth || "").padStart(2, "0");
  const expYear = String(raw?.expiryYear || raw?.expYear || "").trim();
  if (!/^\d{13,19}$/.test(number) || !/^\d{3,4}$/.test(cvc)
    || !/^(0[1-9]|1[0-2])$/.test(expMonth) || !/^20\d{2}$/.test(expYear)) {
    fail("AUTOMATION_CARD_MATERIAL_INVALID", "卡片敏感资料无法识别");
  }
  return Object.freeze({ number, cvc, expMonth, expYear });
}

export async function prepareAutomationCard(db, input = {}) {
  const { execution, mapping, decryptText, encryptText, getCardholder } = input;
  if (!execution || !mapping || typeof decryptText !== "function" || typeof encryptText !== "function") {
    throw new TypeError("自动化卡片准备参数不完整");
  }
  const at = iso(input.at);
  const provider = input.provider || createConfiguredAutomationCardProvider(
    db,
    mapping.card_platform_key,
    decryptText,
    { fetchImpl: input.fetchImpl }
  );
  const fundingAmount = usd(mapping.funding_amount_usd, "fundingAmountUsd", true);
  let reservation = persistedReservation(db, execution.id);
  const liveCards = await listLiveCards(provider);

  if (!reservation) {
    const cards = db.prepare(`
      SELECT * FROM managed_cards
      WHERE provider_key = ? AND upstream_status = 'ACTIVE' AND reconciliation_state = 'READY'
        AND capacity_state <> 'HOLD' AND (lane IS NULL OR lane = ?)
      ORDER BY cached_available_amount DESC, id
    `).all(mapping.card_platform_key, mapping.capacity_key);
    const candidates = [];
    for (const card of cards) {
      if (mapping.card_product_code && card.product_code !== mapping.card_product_code) continue;
      const slot = firstFreeSlot(db, card, mapping);
      const live = liveCards.get(Number(card.upstream_card_id));
      if (!slot || !live || String(live.status).toUpperCase() !== "ACTIVE") continue;
      candidates.push({ card, live, slot, shortfall: Math.max(0, fundingAmount - Number(live.availableAmount || 0)) });
    }
    candidates.sort((left, right) => left.shortfall - right.shortfall || left.card.id.localeCompare(right.card.id));
    if (candidates[0]) {
      reservation = reserveExistingCard(db, execution, mapping, candidates[0].card, candidates[0].slot, at);
    } else {
      reservation = reserveNewCard(db, execution, mapping, at);
    }
  }

  let card = reservation.card_id
    ? db.prepare("SELECT * FROM managed_cards WHERE id = ?").get(reservation.card_id)
    : null;
  if (!card) {
    const holder = typeof getCardholder === "function" ? await getCardholder() : null;
    const firstName = String(holder?.firstName || "").trim();
    const lastName = String(holder?.lastName || "").trim();
    if (mapping.card_platform_key === "spacexcard" && (!firstName || !lastName)) {
      fail("AUTOMATION_CARDHOLDER_UNAVAILABLE", "自动开卡缺少持卡人姓名", { retryable: true });
    }
    let intent = persistFundingIntent(db, execution, {
      providerKey: mapping.card_platform_key,
      operation: "open",
      productCode: reservation.planned_product_code,
      amountUsd: fundingAmount,
      body: {
        product_code: reservation.planned_product_code,
        first_name: firstName,
        last_name: lastName,
        init_amount: fundingAmount
      }
    }, encryptText, at);
    await executeFundingIntent(db, execution, mapping, provider, intent, decryptText, at);
    card = db.prepare(`
      SELECT c.* FROM automation_card_reservations r
      JOIN managed_cards c ON c.id = r.card_id WHERE r.execution_id = ?
    `).get(execution.id);
  } else {
    const live = liveCards.get(Number(card.upstream_card_id));
    if (!live) fail("AUTOMATION_RESERVED_CARD_STALE", "已预留卡片不在实时卡片列表中", { retryable: true });
    const shortfall = usd(Math.max(0, fundingAmount - Number(live.availableAmount || 0)), "shortfall");
    if (shortfall > 0) {
      const intent = persistFundingIntent(db, execution, {
        providerKey: mapping.card_platform_key,
        operation: "recharge",
        targetCardId: card.id,
        amountUsd: shortfall,
        body: { card_id: Number(card.upstream_card_id), amount: shortfall }
      }, encryptText, at);
      await executeFundingIntent(db, execution, mapping, provider, intent, decryptText, at);
      db.prepare(`
        UPDATE managed_cards
        SET cached_available_amount = cached_available_amount + ?, last_balance_sync_at = ?, updated_at = ?
        WHERE id = ?
      `).run(shortfall, at, at, card.id);
    } else {
      db.prepare(`
        UPDATE managed_cards SET cached_available_amount = ?, last_balance_sync_at = ?, updated_at = ? WHERE id = ?
      `).run(Number(live.availableAmount), at, at, card.id);
    }
  }

  const material = normalizeCardMaterial(await provider.getCardMaterial(Number(card.upstream_card_id)));
  db.prepare(`
    UPDATE managed_cards SET last4 = ?, updated_at = ? WHERE id = ?
  `).run(material.number.slice(-4), at, card.id);
  db.prepare(`
    UPDATE automation_executions SET card_id = ?, card_last4 = ?, updated_at = ? WHERE id = ?
  `).run(card.id, material.number.slice(-4), at, execution.id);
  return Object.freeze({ card, material });
}
