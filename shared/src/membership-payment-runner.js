import { randomUUID } from "node:crypto";
import {
  calculateMembershipBudget,
  membershipCapacityByTier,
  membershipStageAllowanceUsd,
  rankMembershipCardCandidates
} from "./membership-fulfillment.js";
import {
  MembershipFundingError,
  getMembershipFundingIntent,
  membershipFundingPaymentGateDefault,
  planMembershipFunding,
  prepareMembershipFundingIntent,
  recoverMembershipFundingIntent,
  reserveMembershipCardCapacity,
  reserveMembershipNewCardPlan,
  submitMembershipFundingIntent
} from "./membership-funding.js";
import { membershipCheckoutAdapterVersion, transitionMembershipFulfillment } from "./membership-orchestration.js";
import { reserveAutomaticCheckoutDailyRisk } from "./membership-rollout.js";

const RUNNABLE_STATES = Object.freeze([
  "FUNDING_READY",
  "FUNDING",
  "PLATFORM_BALANCE_INSUFFICIENT"
]);
const EXPLICIT_RUN_MODES = Object.freeze(["canary", "automatic"]);
const CARD_PAGE_SIZE = 100;
const MAX_CARD_PAGES = 100;
const RETRY_MS = 5 * 60_000;

export const membershipPaymentRunnerGateDefault = membershipFundingPaymentGateDefault;

export class MembershipPaymentRunnerError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = "MembershipPaymentRunnerError";
    this.code = code;
    this.retryable = options.retryable ?? false;
  }
}

function runnerError(code, message, options) {
  return new MembershipPaymentRunnerError(code, message, options);
}

function iso(value = Date.now()) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new TypeError("时间无效");
  return date.toISOString();
}

function roundUsd(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function sameUsd(left, right) {
  return roundUsd(left) === roundUsd(right);
}

function requireProviderMethod(provider, method) {
  if (!provider || typeof provider[method] !== "function") {
    throw runnerError("PAYMENT_PROVIDER_NOT_INJECTED", `支付编排缺少显式注入的 ${method} provider`);
  }
  return provider[method].bind(provider);
}

function requiredStageTiers(targetTier) {
  return targetTier === "plus"
    ? Object.freeze([{ stageKey: "plus", expectedTier: "plus", signalTier: "plus" }])
    : Object.freeze([
        { stageKey: "plus", expectedTier: "plus", signalTier: "plus" },
        { stageKey: "upgrade", expectedTier: targetTier, signalTier: targetTier }
      ]);
}

function loadPriceSnapshot(db, cardId, targetTier, nowMs) {
  const rows = db.prepare(`
    SELECT tier, found, amount, min_usd, max_usd, provider_time
    FROM card_price_signals WHERE card_id = ?
  `).all(cardId);
  const byTier = new Map(rows.map((row) => [row.tier, row]));
  const budget = calculateMembershipBudget(rows.map((row) => ({
    tier: row.tier,
    found: row.found === 1,
    amount: Number(row.amount),
    time: row.provider_time
  })), targetTier, { nowMs });
  const budgetStages = new Map(budget.stages.map((stage) => [stage.tier, stage]));
  const stages = requiredStageTiers(targetTier).map((definition) => {
    const row = byTier.get(definition.signalTier);
    if (!row || row.found !== 1) {
      throw runnerError("CARD_PRICE_UNAVAILABLE", "卡片缺少完整会员行情", { retryable: true });
    }
    return Object.freeze({
      ...definition,
      amountUsd: roundUsd(row.amount),
      minUsd: roundUsd(row.min_usd),
      maxUsd: roundUsd(row.max_usd),
      providerTime: budgetStages.get(definition.signalTier).providerTime
    });
  });
  return Object.freeze({ budget, stages: Object.freeze(stages) });
}

function persistedPriceSnapshot(db, fulfillment, reservation) {
  const rows = db.prepare(`
    SELECT * FROM membership_payment_stages
    WHERE fulfillment_id = ? ORDER BY stage_key
  `).all(fulfillment.id);
  if (rows.length === 0) return null;
  const definitions = requiredStageTiers(fulfillment.target_tier);
  if (rows.length !== definitions.length) {
    throw runnerError("PAYMENT_STAGE_SNAPSHOT_CONFLICT", "持久化付款阶段快照不完整");
  }
  const stages = definitions.map((definition) => {
    const row = rows.find((item) => item.stage_key === definition.stageKey);
    if (!row || row.expected_tier !== definition.expectedTier
      || !Number.isFinite(Number(row.price_signal_amount))
      || !Number.isFinite(Number(row.price_signal_min))
      || !Number.isFinite(Number(row.price_signal_max))
      || !row.price_signal_time
      || (row.card_id && reservation.card_id && row.card_id !== reservation.card_id)) {
      throw runnerError("PAYMENT_STAGE_SNAPSHOT_CONFLICT", "持久化付款阶段快照与容量预留不一致");
    }
    return Object.freeze({
      ...definition,
      amountUsd: roundUsd(row.price_signal_amount),
      minUsd: roundUsd(row.price_signal_min),
      maxUsd: roundUsd(row.price_signal_max),
      providerTime: iso(row.price_signal_time),
      priceContractId: row.price_contract_id,
      adapterVersion: row.adapter_version
    });
  });
  const totalUsd = roundUsd(stages.reduce(
    (sum, stage) => sum + stage.amountUsd + membershipStageAllowanceUsd,
    0
  ));
  return Object.freeze({
    budget: Object.freeze({ targetTier: fulfillment.target_tier, totalUsd }),
    stages: Object.freeze(stages)
  });
}

function activePriceContracts(db, targetTier) {
  const result = new Map();
  for (const definition of requiredStageTiers(targetTier)) {
    const rows = db.prepare(`
      SELECT id, tier, version FROM checkout_price_contracts
      WHERE tier = ? AND currency = 'PHP' AND status = 'active'
      ORDER BY version DESC, id
    `).all(definition.expectedTier);
    if (rows.length !== 1) {
      throw runnerError(
        rows.length ? "PAYMENT_PRICE_CONTRACT_AMBIGUOUS" : "PAYMENT_PRICE_CONTRACT_MISSING",
        "付款编排要求每个阶段恰好一个有效 PHP 价格契约",
        { retryable: true }
      );
    }
    result.set(definition.stageKey, rows[0]);
  }
  return result;
}

function cardHasCapacity(db, card, targetTier) {
  if (!card || card.upstream_status !== "ACTIVE" || card.reconciliation_state !== "READY"
    || card.capacity_state === "HOLD" || (card.lane && card.lane !== targetTier)) return false;
  const active = Number(db.prepare(`
    SELECT COUNT(*) AS count FROM card_capacity_reservations
    WHERE card_id = ? AND target_lane = ?
      AND state IN ('reserved', 'consumed', 'retained_partial')
  `).get(card.id, targetTier).count || 0);
  return Math.max(Number(card.consumed_slots || 0), active) < membershipCapacityByTier[targetTier];
}

async function listLiveCardSummaries(provider) {
  if (typeof provider?.listCards !== "function") return null;
  const summaries = new Map();
  for (let page = 1; page <= MAX_CARD_PAGES; page += 1) {
    const result = await provider.listCards({ page, pageSize: CARD_PAGE_SIZE, sync: true });
    if (!result || !Array.isArray(result.cards) || !Number.isFinite(Number(result.total))) {
      throw runnerError("PAYMENT_PROVIDER_CARD_LIST_INVALID", "卡片余额刷新响应无效", { retryable: true });
    }
    for (const card of result.cards) {
      const upstreamCardId = Number(card?.upstreamCardId);
      if (!Number.isInteger(upstreamCardId) || upstreamCardId <= 0 || summaries.has(upstreamCardId)) {
        throw runnerError("PAYMENT_PROVIDER_CARD_LIST_INVALID", "卡片余额刷新响应包含无效或重复卡片", { retryable: true });
      }
      summaries.set(upstreamCardId, card);
    }
    if (result.cards.length === 0 || summaries.size >= Number(result.total)) return summaries;
  }
  throw runnerError("PAYMENT_PROVIDER_CARD_LIST_EXCEEDED", "卡片余额刷新分页超过安全上限", { retryable: true });
}

async function liveCardSummary(provider, card, summaries) {
  if (summaries) return summaries.get(Number(card.upstream_card_id)) || null;
  if (typeof provider?.getCardSummary === "function") {
    return provider.getCardSummary(card.upstream_card_id);
  }
  throw runnerError(
    "PAYMENT_PROVIDER_CARD_BALANCE_UNAVAILABLE",
    "支付 provider 必须显式提供 listCards 或 getCardSummary 以刷新卡片余额",
    { retryable: true }
  );
}

function normalizeProductCatalog(products) {
  if (!Array.isArray(products)) {
    throw runnerError("PAYMENT_PROVIDER_PRODUCTS_INVALID", "开卡产品响应无效", { retryable: true });
  }
  const catalog = new Map();
  for (const product of products) {
    const code = typeof product?.productCode === "string" ? product.productCode.trim() : "";
    if (!code || catalog.has(code)) {
      throw runnerError("PAYMENT_PROVIDER_PRODUCTS_INVALID", "开卡产品响应包含无效或重复产品", { retryable: true });
    }
    catalog.set(code, product);
  }
  return catalog;
}

async function loadFundingFacts(provider) {
  const [balance, products] = await Promise.all([
    requireProviderMethod(provider, "getBalance")(),
    requireProviderMethod(provider, "listProducts")()
  ]);
  const platformBalanceUsd = Number(balance?.balance);
  const currency = typeof balance?.currency === "string" ? balance.currency.toUpperCase() : "";
  if (!Number.isFinite(platformBalanceUsd) || platformBalanceUsd < 0 || currency !== "USD") {
    throw runnerError("PAYMENT_PROVIDER_BALANCE_INVALID", "SpaceX Card 平台余额必须是有效 USD 余额", { retryable: true });
  }
  return Object.freeze({
    platformBalanceUsd: roundUsd(platformBalanceUsd),
    platformCurrency: currency,
    products: normalizeProductCatalog(products)
  });
}

function planExistingCard(snapshot, card, live, product, fundingFacts) {
  if (!live || String(live.status || "").toUpperCase() !== "ACTIVE") return null;
  if (Number(live.upstreamCardId) !== Number(card.upstream_card_id)
    || String(live.productCode || "") !== card.product_code) {
    throw runnerError("PAYMENT_PROVIDER_CARD_IDENTITY_MISMATCH", "实时卡片余额与托管卡片身份不一致");
  }
  if (!product) return null;
  try {
    return planMembershipFunding({
      kind: "existing_card",
      fullOrderBudgetUsd: snapshot.budget.totalUsd,
      cardAvailableAmountUsd: Number(live.availableAmount),
      platformBalanceUsd: fundingFacts.platformBalanceUsd,
      platformCurrency: fundingFacts.platformCurrency,
      rechargeFeeRate: product.rechargeFeeRate,
      minAmountUsd: product.minAmount,
      maxAmountUsd: product.maxAmount
    });
  } catch (error) {
    if (error instanceof MembershipFundingError
      && ["CARD_RECHARGE_MINIMUM_EXCEEDS_SHORTFALL", "CARD_PRODUCT_AMOUNT_UNSUPPORTED"].includes(error.code)) {
      return null;
    }
    throw error;
  }
}

function planNewCard(snapshot, product, fundingFacts) {
  return planMembershipFunding({
    kind: "new_card",
    fullOrderBudgetUsd: snapshot.budget.totalUsd,
    platformBalanceUsd: fundingFacts.platformBalanceUsd,
    platformCurrency: fundingFacts.platformCurrency,
    openFeeUsd: product.openFee,
    minAmountUsd: product.minAmount,
    maxAmountUsd: product.maxAmount
  });
}

function existingReservation(db, fulfillmentId) {
  return db.prepare(`
    SELECT * FROM card_capacity_reservations WHERE fulfillment_id = ?
  `).get(fulfillmentId) || null;
}

async function chooseAndReserve(db, provider, fulfillment, fundingFacts, nowMs, at) {
  const already = existingReservation(db, fulfillment.id);
  const summaries = await listLiveCardSummaries(provider);
  if (already) {
    if (already.state !== "reserved") {
      throw runnerError("PAYMENT_CARD_RESERVATION_INACTIVE", "付款编排的容量预留不再有效");
    }
    if (already.card_id) {
      const card = db.prepare("SELECT * FROM managed_cards WHERE id = ?").get(already.card_id);
      if (!cardHasCapacity(db, card, fulfillment.target_tier)) {
        // Its own reservation can make a final slot appear full; reservation validity was already checked above.
        if (!card || card.upstream_status !== "ACTIVE" || card.reconciliation_state !== "READY"
          || card.capacity_state === "HOLD" || card.lane !== fulfillment.target_tier) {
          throw runnerError("PAYMENT_CARD_RESERVATION_STALE", "已预留卡片不再可用于付款", { retryable: true });
        }
      }
      const snapshot = persistedPriceSnapshot(db, fulfillment, already)
        || loadPriceSnapshot(db, card.id, fulfillment.target_tier, nowMs);
      const live = await liveCardSummary(provider, card, summaries);
      const plan = planExistingCard(snapshot, card, live, fundingFacts.products.get(card.product_code), fundingFacts);
      if (!plan) throw runnerError("PAYMENT_RESERVED_CARD_UNSUPPORTED", "已预留卡片的产品或余额不再满足资金计划");
      return Object.freeze({ reservation: already, card, snapshot, plan, live, kind: "existing_card" });
    }
    const snapshot = persistedPriceSnapshot(db, fulfillment, already)
      || loadProvenProductSnapshot(db, already.planned_product_code, fulfillment.target_tier, nowMs);
    const product = fundingFacts.products.get(already.planned_product_code);
    if (!product) throw runnerError("PAYMENT_CARD_PRODUCT_UNAVAILABLE", "已预留的新卡产品已不可用", { retryable: true });
    const plan = planNewCard(snapshot, product, fundingFacts);
    return Object.freeze({ reservation: already, card: null, snapshot, plan, live: null, product, kind: "new_card" });
  }

  const cards = db.prepare(`
    SELECT * FROM managed_cards
    WHERE upstream_status = 'ACTIVE' AND reconciliation_state = 'READY'
      AND capacity_state <> 'HOLD' AND (lane IS NULL OR lane = ?)
    ORDER BY id
  `).all(fulfillment.target_tier);
  const candidates = [];
  for (const card of cards) {
    if (!cardHasCapacity(db, card, fulfillment.target_tier)) continue;
    let snapshot;
    try {
      snapshot = loadPriceSnapshot(db, card.id, fulfillment.target_tier, nowMs);
    } catch (error) {
      if (error?.code === "CARD_PRICE_UNAVAILABLE") continue;
      throw error;
    }
    const live = await liveCardSummary(provider, card, summaries);
    const plan = planExistingCard(snapshot, card, live, fundingFacts.products.get(card.product_code), fundingFacts);
    if (!plan) continue;
    candidates.push({
      id: card.id,
      lane: card.lane,
      eligible: true,
      budgetUsd: snapshot.budget.totalUsd,
      availableAmount: plan.availableAmountUsd,
      card,
      snapshot,
      plan,
      live
    });
  }
  for (const candidate of rankMembershipCardCandidates(candidates, fulfillment.target_tier)) {
    try {
      const reservation = reserveMembershipCardCapacity(db, {
        fulfillmentId: fulfillment.id,
        cardId: candidate.card.id,
        targetLane: fulfillment.target_tier,
        at
      });
      db.prepare(`
        UPDATE managed_cards
        SET cached_available_amount = ?, upstream_status = 'ACTIVE',
            last_balance_sync_at = ?, updated_at = ?
        WHERE id = ?
      `).run(candidate.plan.availableAmountUsd, at, at, candidate.card.id);
      return Object.freeze({ ...candidate, reservation, kind: "existing_card" });
    } catch (error) {
      const won = existingReservation(db, fulfillment.id);
      if (won) return chooseAndReserve(db, provider, fulfillment, fundingFacts, nowMs, at);
      if (error instanceof MembershipFundingError
        && ["CARD_CAPACITY_FULL", "CARD_RESERVATION_BUSY", "CARD_RESERVATION_CONFLICT"].includes(error.code)) continue;
      throw error;
    }
  }

  const productRows = db.prepare(`
    SELECT product_code FROM card_product_policies
    WHERE enabled = 1 ORDER BY product_code
  `).all();
  const newCandidates = [];
  for (const row of productRows) {
    const product = fundingFacts.products.get(row.product_code);
    if (!product) continue;
    try {
      const snapshot = loadProvenProductSnapshot(db, row.product_code, fulfillment.target_tier, nowMs);
      const plan = planNewCard(snapshot, product, fundingFacts);
      newCandidates.push({ product, snapshot, plan });
    } catch (error) {
      if (["CARD_PRICE_UNAVAILABLE", "CARD_PRODUCT_AMOUNT_UNSUPPORTED"].includes(error?.code)) continue;
      throw error;
    }
  }
  newCandidates.sort((left, right) => left.plan.platformDebitUsd - right.plan.platformDebitUsd
    || left.product.productCode.localeCompare(right.product.productCode));
  const selected = newCandidates[0];
  if (!selected) {
    throw runnerError("CARD_PRICE_UNAVAILABLE", "没有可预留的现有卡片或管理员允许的新卡产品", { retryable: true });
  }
  const reservation = reserveMembershipNewCardPlan(db, {
    fulfillmentId: fulfillment.id,
    plannedProductCode: selected.product.productCode,
    targetLane: fulfillment.target_tier,
    at
  });
  return Object.freeze({ ...selected, reservation, card: null, live: null, kind: "new_card" });
}

function loadProvenProductSnapshot(db, productCode, targetTier, nowMs) {
  const cards = db.prepare(`
    SELECT id FROM managed_cards
    WHERE product_code = ? AND upstream_status = 'ACTIVE' AND reconciliation_state = 'READY'
    ORDER BY id
  `).all(productCode);
  for (const card of cards) {
    try {
      return loadPriceSnapshot(db, card.id, targetTier, nowMs);
    } catch (error) {
      if (error?.code !== "CARD_PRICE_UNAVAILABLE") throw error;
    }
  }
  throw runnerError("CARD_PRICE_UNAVAILABLE", "新卡产品缺少同产品的新鲜完整行情证据", { retryable: true });
}

function ensurePaymentStageSnapshots(db, fulfillment, selection, contracts, adapterVersion, at) {
  const cardId = selection.reservation.card_id || null;
  return db.transaction(() => {
    const insert = db.prepare(`
      INSERT INTO membership_payment_stages (
        id, fulfillment_id, stage_key, expected_tier, state, card_id,
        price_signal_amount, price_signal_min, price_signal_max, price_signal_time,
        adapter_version, price_contract_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'funding_pending', ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const stage of selection.snapshot.stages) {
      const contract = contracts.get(stage.stageKey);
      const existing = db.prepare(`
        SELECT * FROM membership_payment_stages
        WHERE fulfillment_id = ? AND stage_key = ?
      `).get(fulfillment.id, stage.stageKey);
      if (existing) {
        if (existing.expected_tier !== stage.expectedTier
          || (existing.card_id && cardId && existing.card_id !== cardId)
          || !sameUsd(existing.price_signal_amount, stage.amountUsd)
          || !sameUsd(existing.price_signal_min, stage.minUsd)
          || !sameUsd(existing.price_signal_max, stage.maxUsd)
          || iso(existing.price_signal_time) !== stage.providerTime
          || existing.adapter_version !== adapterVersion
          || existing.price_contract_id !== contract.id) {
          throw runnerError("PAYMENT_STAGE_SNAPSHOT_CONFLICT", "付款阶段快照不可修改");
        }
        continue;
      }
      insert.run(
        `mps_${randomUUID()}`,
        fulfillment.id,
        stage.stageKey,
        stage.expectedTier,
        cardId,
        stage.amountUsd,
        stage.minUsd,
        stage.maxUsd,
        stage.providerTime,
        adapterVersion,
        contract.id,
        at,
        at
      );
    }
    return db.prepare(`
      SELECT * FROM membership_payment_stages
      WHERE fulfillment_id = ? ORDER BY stage_key
    `).all(fulfillment.id);
  })();
}

function resolveAutomaticScope(db, fulfillment, adapterVersion, contracts) {
  const order = db.prepare("SELECT site_id, product_id FROM redeem_orders WHERE id = ?").get(fulfillment.order_id);
  if (!order?.site_id || !order.product_id) {
    throw runnerError("AUTOMATIC_SCOPE_NOT_FOUND", "自动付款订单缺少站点或商品绑定");
  }
  const rows = db.prepare(`
    SELECT * FROM automatic_checkout_scopes
    WHERE site_id = ? AND product_id = ? AND tier = ? AND status = 'active'
    ORDER BY revision DESC
  `).all(order.site_id, order.product_id, fulfillment.target_tier);
  if (rows.length !== 1) {
    throw runnerError("AUTOMATIC_SCOPE_NOT_FOUND", "自动付款要求恰好一个有效精确范围");
  }
  const scope = rows[0];
  const finalStageKey = fulfillment.target_tier === "plus" ? "plus" : "upgrade";
  if (scope.adapter_version !== adapterVersion
    || scope.price_contract_id !== contracts.get(finalStageKey).id) {
    throw runnerError("AUTOMATIC_SCOPE_VERSION_STALE", "自动付款范围与当前 adapter 或价格契约不一致");
  }
  return scope;
}

function resolvePaymentGate(configured, fulfillment) {
  const gate = typeof configured === "function" ? configured(fulfillment) : configured;
  if (!EXPLICIT_RUN_MODES.includes(fulfillment.run_mode)
    || gate?.enabled !== true || gate.mode !== fulfillment.run_mode) return null;
  return Object.freeze({ enabled: true, mode: fulfillment.run_mode });
}

function buildFundingRequest(selection, fulfillment, cardholder) {
  if (selection.plan.operation === "none") return null;
  if (selection.plan.operation === "recharge") {
    return Object.freeze({
      operation: "recharge",
      targetCardId: selection.card.id,
      amountUsd: selection.plan.fundingAmountUsd,
      feeUsd: selection.plan.feeUsd,
      requestBody: Object.freeze({
        card_id: Number(selection.card.upstream_card_id),
        amount: selection.plan.fundingAmountUsd
      })
    });
  }
  const firstName = typeof cardholder?.firstName === "string" ? cardholder.firstName.trim() : "";
  const lastName = typeof cardholder?.lastName === "string" ? cardholder.lastName.trim() : "";
  if (!firstName || !lastName || firstName.length > 100 || lastName.length > 100) {
    throw runnerError("NEW_CARD_HOLDER_NOT_CONFIGURED", "自动开卡必须显式注入合法持卡人姓名");
  }
  return Object.freeze({
    operation: "open",
    productCode: selection.product.productCode,
    amountUsd: selection.plan.fundingAmountUsd,
    feeUsd: selection.plan.feeUsd,
    requestBody: Object.freeze({
      product_code: selection.product.productCode,
      first_name: firstName,
      last_name: lastName,
      init_amount: selection.plan.fundingAmountUsd
    })
  });
}

async function invokePersistedFunding(provider, request) {
  if (request.operation === "recharge") {
    const recharge = requireProviderMethod(provider, "rechargeCard");
    return recharge({
      cardId: request.requestBody.card_id,
      amount: request.requestBody.amount
    }, request.idempotencyKey);
  }
  const open = requireProviderMethod(provider, "openCard");
  return open({
    productCode: request.requestBody.product_code,
    firstName: request.requestBody.first_name,
    lastName: request.requestBody.last_name,
    initAmount: request.requestBody.init_amount
  }, request.idempotencyKey);
}

function classifyFundingError(provider, error) {
  if (typeof provider?.classifyFundingError !== "function") return "unknown";
  return provider.classifyFundingError(error);
}

function markStages(db, fulfillmentId, state, cardId, at) {
  db.prepare(`
    UPDATE membership_payment_stages
    SET state = ?, card_id = COALESCE(card_id, ?), updated_at = ?
    WHERE fulfillment_id = ? AND state IN ('funding_pending', 'funding_unknown', 'funding_failed')
  `).run(state, cardId || null, at, fulfillmentId);
}

function finalizeFunding(db, fulfillment, selection, at) {
  const reservation = existingReservation(db, fulfillment.id);
  if (!reservation?.card_id) {
    throw runnerError("PAYMENT_CARD_NOT_ATTACHED", "资金成功后容量预留仍未绑定卡片");
  }
  markStages(db, fulfillment.id, "checkout_pending", reservation.card_id, at);
  const updated = transitionMembershipFulfillment(db, fulfillment.id, "BROWSER_LEASE_WAIT", {
    currentStage: "plus",
    at,
    notify: true
  });
  return Object.freeze({
    processed: 1,
    fulfillmentId: fulfillment.id,
    outcome: selection.plan.operation === "none" ? "prefunded" : "funded",
    state: updated.state,
    cardId: reservation.card_id,
    fullPaymentBudgetUsd: selection.snapshot.budget.totalUsd,
    providerFeeUsd: selection.plan.feeUsd,
    fundingOperation: selection.plan.operation
  });
}

function safeFailureTransition(db, fulfillmentId, state, code, at, retry = false) {
  return transitionMembershipFulfillment(db, fulfillmentId, state, {
    currentStage: "plus",
    failureCode: code,
    retryAt: retry ? iso(Date.parse(at) + RETRY_MS) : null,
    at
  });
}

function serializeBlocked(fulfillmentId, state, code) {
  return Object.freeze({ processed: 1, fulfillmentId, outcome: "blocked", state, code });
}

export function createMembershipPaymentRunner(options = {}) {
  const {
    db,
    provider = null,
    paymentGate = membershipPaymentRunnerGateDefault,
    recoveryGate = Object.freeze({ enabled: false }),
    adapterVersion: configuredAdapterVersion = membershipCheckoutAdapterVersion,
    cardholder: configuredCardholder = null,
    now = () => new Date(),
    logger = console
  } = options;
  if (!db) throw new TypeError("会员支付 Runner 缺少数据库");
  let running = false;

  function nowMs() {
    const value = now();
    const result = value instanceof Date ? value.getTime() : Number(value);
    if (!Number.isFinite(result)) throw new TypeError("Runner 时间无效");
    return result;
  }

  function loadFulfillment(fulfillmentId) {
    return db.prepare("SELECT * FROM membership_fulfillments WHERE id = ?").get(fulfillmentId) || null;
  }

  async function processFulfillment(fulfillmentId) {
    let fulfillment = loadFulfillment(fulfillmentId);
    if (!fulfillment) throw runnerError("MEMBERSHIP_FULFILLMENT_NOT_FOUND", "会员履约不存在");
    const gate = resolvePaymentGate(paymentGate, fulfillment);
    if (!gate) {
      return Object.freeze({ processed: 0, fulfillmentId, outcome: "gated", state: fulfillment.state });
    }
    if (!RUNNABLE_STATES.includes(fulfillment.state)) {
      if (fulfillment.state === "FUNDING_OUTCOME_UNKNOWN") {
        return Object.freeze({ processed: 0, fulfillmentId, outcome: "recovery_required", state: fulfillment.state });
      }
      return Object.freeze({ processed: 0, fulfillmentId, outcome: "state", state: fulfillment.state });
    }
    const atMs = nowMs();
    const at = iso(atMs);
    const existingIntent = getMembershipFundingIntent(db, fulfillment.id);
    if (existingIntent?.state === "outcome_unknown" || existingIntent?.state === "submitted") {
      markStages(db, fulfillment.id, "funding_unknown", null, at);
      const updated = safeFailureTransition(db, fulfillment.id, "FUNDING_OUTCOME_UNKNOWN", "FUNDING_OUTCOME_UNKNOWN", at);
      return Object.freeze({ processed: 0, fulfillmentId, outcome: "recovery_required", state: updated.state });
    }
    if (existingIntent?.state === "failed") {
      markStages(db, fulfillment.id, "funding_failed", null, at);
      const updated = safeFailureTransition(db, fulfillment.id, "CHECKOUT_PRE_SUBMIT_FAILED", "FUNDING_PROVIDER_REJECTED", at);
      return serializeBlocked(fulfillment.id, updated.state, "FUNDING_PROVIDER_REJECTED");
    }

    try {
      if (existingIntent?.state === "succeeded" || existingIntent?.state === "prepared") {
        const reservation = existingReservation(db, fulfillment.id);
        const snapshot = persistedPriceSnapshot(db, fulfillment, reservation);
        if (!reservation || !snapshot) {
          throw runnerError("PAYMENT_STAGE_SNAPSHOT_CONFLICT", "已持久化资金意图缺少原容量或付款阶段快照");
        }
        const persistedSelection = Object.freeze({
          reservation,
          snapshot,
          plan: Object.freeze({
            operation: existingIntent.operation,
            feeUsd: existingIntent.feeUsd
          })
        });
        if (existingIntent.state === "succeeded") {
          return finalizeFunding(db, fulfillment, persistedSelection, at);
        }
        transitionMembershipFulfillment(db, fulfillment.id, "FUNDING", {
          currentStage: "plus",
          at
        });
        await submitMembershipFundingIntent(db, {
          fulfillmentId: fulfillment.id,
          paymentGate: gate,
          at,
          resolvedAt: at,
          classifyError: (error) => classifyFundingError(provider, error),
          invoke: (request) => invokePersistedFunding(provider, request)
        });
        return finalizeFunding(db, fulfillment, persistedSelection, at);
      }

      const facts = await loadFundingFacts(provider);
      fulfillment = loadFulfillment(fulfillment.id);
      const contracts = activePriceContracts(db, fulfillment.target_tier);
      const baseAdapterVersion = String(configuredAdapterVersion || "").trim();
      if (!/^[A-Za-z0-9._:-]{1,200}$/.test(baseAdapterVersion)) {
        throw new TypeError("付款 Adapter 版本无效");
      }
      const scope = fulfillment.run_mode === "automatic"
        ? resolveAutomaticScope(db, fulfillment, baseAdapterVersion, contracts)
        : null;
      const adapterVersion = scope?.adapter_version || baseAdapterVersion;
      const selection = await chooseAndReserve(db, provider, fulfillment, facts, atMs, at);
      ensurePaymentStageSnapshots(db, fulfillment, selection, contracts, adapterVersion, at);

      if (!selection.plan.platformBalanceSufficient) {
        const updated = safeFailureTransition(
          db,
          fulfillment.id,
          "PLATFORM_BALANCE_INSUFFICIENT",
          "PLATFORM_BALANCE_INSUFFICIENT",
          at,
          true
        );
        return serializeBlocked(fulfillment.id, updated.state, "PLATFORM_BALANCE_INSUFFICIENT");
      }

      const cardholder = selection.plan.operation === "open"
        ? (typeof configuredCardholder === "function"
            ? await configuredCardholder(Object.freeze({
                fulfillmentId: fulfillment.id,
                orderNo: fulfillment.order_no,
                targetTier: fulfillment.target_tier
              }))
            : configuredCardholder)
        : null;
      const fundingRequest = buildFundingRequest(selection, fulfillment, cardholder);

      if (scope) {
        reserveAutomaticCheckoutDailyRisk(db, {
          fulfillmentId: fulfillment.id,
          scopeId: scope.id,
          adapterVersion,
          priceContractId: scope.price_contract_id,
          fullPaymentBudgetUsd: selection.snapshot.budget.totalUsd,
          providerFeeUsd: selection.plan.feeUsd,
          at
        });
      }
      if (!fundingRequest) return finalizeFunding(db, fulfillment, selection, at);

      if (!existingIntent) {
        prepareMembershipFundingIntent(db, {
          fulfillmentId: fulfillment.id,
          orderNo: fulfillment.order_no,
          ...fundingRequest,
          at
        });
      }
      transitionMembershipFulfillment(db, fulfillment.id, "FUNDING", {
        currentStage: "plus",
        at
      });
      const submitted = await submitMembershipFundingIntent(db, {
        fulfillmentId: fulfillment.id,
        paymentGate: gate,
        at,
        resolvedAt: at,
        classifyError: (error) => classifyFundingError(provider, error),
        invoke: (request) => invokePersistedFunding(provider, request)
      });
      const refreshedSelection = submitted.providerResult?.managedCardId
        ? Object.freeze({ ...selection, reservation: existingReservation(db, fulfillment.id) })
        : selection;
      return finalizeFunding(db, fulfillment, refreshedSelection, at);
    } catch (error) {
      if (error?.code === "FUNDING_OUTCOME_UNKNOWN") {
        markStages(db, fulfillment.id, "funding_unknown", null, at);
        const updated = safeFailureTransition(db, fulfillment.id, "FUNDING_OUTCOME_UNKNOWN", error.code, at);
        return Object.freeze({ processed: 1, fulfillmentId, outcome: "recovery_required", state: updated.state, code: error.code });
      }
      if (error?.code === "FUNDING_PROVIDER_REJECTED") {
        markStages(db, fulfillment.id, "funding_failed", null, at);
        const updated = safeFailureTransition(db, fulfillment.id, "CHECKOUT_PRE_SUBMIT_FAILED", error.code, at);
        return serializeBlocked(fulfillment.id, updated.state, error.code);
      }
      if (["FUNDING_SUBMISSION_IN_PROGRESS", "FUNDING_INTENT_CONFLICT"].includes(error?.code)) {
        return Object.freeze({
          processed: 0,
          fulfillmentId,
          outcome: "in_progress",
          state: loadFulfillment(fulfillmentId)?.state || fulfillment.state,
          code: error.code
        });
      }
      if (error?.code === "FUNDING_RECOVERY_REQUIRED") {
        markStages(db, fulfillment.id, "funding_unknown", null, at);
        const updated = safeFailureTransition(db, fulfillment.id, "FUNDING_OUTCOME_UNKNOWN", error.code, at);
        return Object.freeze({ processed: 0, fulfillmentId, outcome: "recovery_required", state: updated.state, code: error.code });
      }
      const priceUnavailable = [
        "CARD_PRICE_UNAVAILABLE",
        "PAYMENT_PRICE_CONTRACT_MISSING",
        "PAYMENT_PRICE_CONTRACT_AMBIGUOUS"
      ].includes(error?.code);
      const quotaOrScope = String(error?.code || "").startsWith("AUTOMATIC_");
      const retryableProvider = error?.retryable === true || String(error?.code || "").startsWith("SPACEXCARD_");
      if (priceUnavailable || quotaOrScope || retryableProvider) {
        const nextState = priceUnavailable ? "CARD_PRICE_UNAVAILABLE" : "FUNDING_READY";
        const updated = safeFailureTransition(db, fulfillment.id, nextState, error.code || "PAYMENT_PREPARATION_FAILED", at, true);
        return serializeBlocked(fulfillment.id, updated.state, error.code || "PAYMENT_PREPARATION_FAILED");
      }
      throw error;
    }
  }

  async function recoverFundingOutcome(fulfillmentId, input = {}) {
    const fulfillment = loadFulfillment(fulfillmentId);
    if (!fulfillment) throw runnerError("MEMBERSHIP_FULFILLMENT_NOT_FOUND", "会员履约不存在");
    if (!EXPLICIT_RUN_MODES.includes(fulfillment.run_mode)) {
      return Object.freeze({ processed: 0, fulfillmentId, outcome: "gated", state: fulfillment.state });
    }
    const at = iso(input.at ?? nowMs());
    const gate = input.recoveryGate || recoveryGate;
    try {
      await recoverMembershipFundingIntent(db, {
        fulfillmentId,
        recoveryGate: gate,
        allowOrphanedSubmitted: input.allowOrphanedSubmitted === true,
        at,
        resolvedAt: at,
        classifyError: (error) => classifyFundingError(provider, error),
        invoke: (request) => invokePersistedFunding(provider, request)
      });
      const reservation = existingReservation(db, fulfillmentId);
      const snapshot = persistedPriceSnapshot(db, fulfillment, reservation);
      if (!snapshot || !reservation?.card_id) {
        throw runnerError("PAYMENT_STAGE_SNAPSHOT_CONFLICT", "资金恢复后缺少原付款阶段或卡片快照");
      }
      const intent = getMembershipFundingIntent(db, fulfillmentId);
      const selection = Object.freeze({
        reservation,
        snapshot,
        plan: Object.freeze({ operation: intent.operation, feeUsd: intent.feeUsd })
      });
      return finalizeFunding(db, fulfillment, selection, at);
    } catch (error) {
      if (error?.code === "FUNDING_OUTCOME_UNKNOWN") {
        markStages(db, fulfillmentId, "funding_unknown", null, at);
        safeFailureTransition(db, fulfillmentId, "FUNDING_OUTCOME_UNKNOWN", error.code, at);
        return Object.freeze({ processed: 1, fulfillmentId, outcome: "recovery_required", state: "FUNDING_OUTCOME_UNKNOWN", code: error.code });
      }
      throw error;
    }
  }

  async function tick() {
    if (running) return Object.freeze({ processed: 0, busy: true });
    running = true;
    try {
      const at = iso(nowMs());
      const candidates = db.prepare(`
        SELECT id FROM membership_fulfillments
        WHERE state IN ('FUNDING_READY', 'FUNDING', 'PLATFORM_BALANCE_INSUFFICIENT')
          AND (retry_at IS NULL OR retry_at <= ?)
        ORDER BY created_at, id LIMIT 50
      `).all(at);
      for (const candidate of candidates) {
        const fulfillment = loadFulfillment(candidate.id);
        if (!resolvePaymentGate(paymentGate, fulfillment)) continue;
        const result = await processFulfillment(candidate.id);
        return Object.freeze({ ...result, processed: result.processed || 1 });
      }
      return Object.freeze({ processed: 0, reason: candidates.length ? "gated" : "idle" });
    } catch (error) {
      logger.warn?.(`[membership payment] ${error?.code || "PAYMENT_RUNNER_FAILED"}`);
      throw error;
    } finally {
      running = false;
    }
  }

  return Object.freeze({ tick, processFulfillment, recoverFundingOutcome });
}
