import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  MembershipActionError,
  acknowledgeMembershipPaymentChallenge,
  claimMembershipMaterialGrant,
  issueMembershipActionPermit
} from "../../shared/src/membership-actions.js";
import {
  MembershipRolloutError,
  approveLiveCanaryStage,
  consumeLiveCanaryAuthorization,
  createAutomaticCheckoutScope,
  expireLiveCanaryAuthorizations,
  liveCanaryAuthorizationTtlMs,
  qualifyTierRollout,
  reviseAutomaticCheckoutScope,
  verifyFreshAdminCredentials
} from "../../shared/src/membership-rollout.js";
import { countMembershipUnresolvedOutcomes } from "../../shared/src/membership-reconciliation.js";

const EXTENSION_BODY_LIMIT = 8 * 1024;
const ADMIN_BODY_LIMIT = 16 * 1024;
const RATE_WINDOW_MS = 60_000;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const CHECKOUT_ADAPTER = "checkout-v1";
const PLAN_ADAPTER = "plan-management-v1";
const TARGET_TIERS = ["plus", "x5", "x20"];

const commonBindingSchema = z.object({
  stage: z.enum(["plus", "upgrade"]),
  targetTier: z.enum(TARGET_TIERS),
  attempt: z.number().int().min(1).max(100),
  leaseEpoch: z.number().int().min(1),
  adapterVersion: z.enum([CHECKOUT_ADAPTER, PLAN_ADAPTER])
}).strict();

const paymentFieldsSchema = z.object({
  cardNumber: z.boolean(),
  expiry: z.boolean(),
  expiryMonth: z.boolean(),
  expiryYear: z.boolean(),
  cvc: z.boolean(),
  billingName: z.boolean(),
  billingLine1: z.boolean(),
  billingCity: z.boolean(),
  billingState: z.boolean(),
  billingCountry: z.boolean(),
  billingPostal: z.boolean()
}).strict();

const paymentControlsSchema = z.object({
  progression: z.enum(["payment-next", "hosted-payment-next"]).nullable(),
  submit: z.enum(["payment-submit", "hosted-payment-submit"]).nullable(),
  upgradeX5: z.literal("upgrade-x5").nullable(),
  upgradeX20: z.literal("upgrade-x20").nullable(),
  challenge: z.enum([
    "challenge-3ds",
    "challenge-captcha",
    "challenge-sms",
    "challenge-bank"
  ]).nullable()
}).strict();

const pageSchema = z.object({
  stateId: z.enum([
    "PAYMENT_PROGRESSION_READY",
    "PAYMENT_FINAL_READY",
    "UPGRADE_SELECTION_READY"
  ]),
  origin: z.enum(["https://chatgpt.com", "https://pay.openai.com"]),
  routeTemplate: z.enum([
    "/checkout",
    "/checkout/{id}",
    "/pay/{id}",
    "/settings/subscription",
    "/settings/billing",
    "/account/billing/overview"
  ]),
  plan: z.enum(["plus", "prolite", "pro"]),
  country: z.literal("PH"),
  currency: z.literal("PHP"),
  displayedAmount: z.number().finite().positive().max(10_000_000),
  stateMarker: z.enum([
    "card-entry",
    "billing-entry",
    "review",
    "upgrade-selection",
    "challenge",
    "complete"
  ]).nullable(),
  fields: paymentFieldsSchema,
  controls: paymentControlsSchema,
  structuralHash: z.string().regex(SHA256)
}).strict();

const permitSchema = commonBindingSchema.extend({
  priceContractVersion: z.number().int().min(1),
  controlId: z.enum([
    "payment-next",
    "hosted-payment-next",
    "payment-submit",
    "hosted-payment-submit",
    "upgrade-x5",
    "upgrade-x20"
  ]),
  pageFingerprint: z.string().regex(SHA256),
  page: pageSchema
}).strict();

const materialClaimSchema = commonBindingSchema.extend({
  nonce: z.string().regex(/^[A-Za-z0-9_-]{32,256}$/),
  fulfillmentId: z.string().regex(SAFE_ID)
}).strict();

const actionAckSchema = commonBindingSchema.extend({
  acknowledgement: z.literal("LOCAL_VERIFICATION_COMPLETED")
}).strict();

const credentialsSchema = z.object({
  username: z.string().min(1).max(1024),
  password: z.string().min(1).max(1024)
}).strict();

const canaryApprovalSchema = z.object({
  fulfillmentId: z.string().regex(SAFE_ID),
  stage: z.enum(["plus", "upgrade"]),
  cardId: z.string().regex(SAFE_ID),
  fundingBudgetUsd: z.number().finite().positive().max(100_000),
  priceContractId: z.string().regex(SAFE_ID),
  adapterVersion: z.enum([CHECKOUT_ADAPTER, PLAN_ADAPTER]),
  pageFingerprint: z.string().regex(SHA256),
  credentials: credentialsSchema
}).strict();

const qualificationSchema = z.object({
  fulfillmentId: z.string().regex(SAFE_ID),
  adapterVersion: z.string().regex(SAFE_ID),
  adapterPath: z.string().trim().min(1).max(200),
  priceContractId: z.string().regex(SAFE_ID)
}).strict();

const scopeCreateSchema = z.object({
  siteId: z.string().regex(SAFE_ID),
  productId: z.string().regex(SAFE_ID),
  tier: z.enum(TARGET_TIERS),
  adapterVersion: z.string().regex(SAFE_ID),
  priceContractId: z.string().regex(SAFE_ID),
  dailyOrderLimit: z.literal(1).optional(),
  dailyRiskLimitUsd: z.number().finite().positive().max(1_000_000),
  credentials: credentialsSchema
}).strict();

const scopeRevisionSchema = z.object({
  dailyOrderLimit: z.number().int().positive().max(100_000),
  dailyRiskLimitUsd: z.number().finite().positive().max(1_000_000),
  adapterVersion: z.string().regex(SAFE_ID).optional(),
  priceContractId: z.string().regex(SAFE_ID).optional(),
  credentials: credentialsSchema
}).strict();

const compensationSchema = z.object({
  resolutionType: z.enum([
    "REFUNDED",
    "REPLACEMENT_DELIVERED",
    "CUSTOMER_ACCEPTED_PARTIAL"
  ]),
  evidenceReference: z.string().trim().min(1).max(200)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/)
}).strict();

const rolloutModeSchema = z.object({
  mode: z.enum(["disabled", "no_charge", "canary", "automatic"]),
  credentials: credentialsSchema
}).strict();

const canaryStartSchema = z.object({
  credentials: credentialsSchema
}).strict();

function setNoStore(reply) {
  reply.header("Cache-Control", "no-store");
  reply.header("Pragma", "no-cache");
}

function sendError(reply, status, code, message = "请求无法处理") {
  return reply.code(status).send({ code, message });
}

function nowIso(now) {
  const value = typeof now === "function" ? now() : Date.now();
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new TypeError("服务时间无效");
  return date.toISOString();
}

function safeParam(value) {
  const normalized = String(value || "").trim();
  return SAFE_ID.test(normalized) ? normalized : null;
}

function sameMoney(left, right) {
  return Number.isFinite(Number(left)) && Number.isFinite(Number(right))
    && Math.round(Number(left) * 100) === Math.round(Number(right) * 100);
}

function luhnValid(number) {
  let sum = 0;
  let doubled = false;
  for (let index = number.length - 1; index >= 0; index -= 1) {
    let digit = Number(number[index]);
    if (doubled) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    doubled = !doubled;
  }
  return sum % 10 === 0;
}

function boundedText(value, minimum, maximum) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (normalized.length < minimum || normalized.length > maximum
    || /[\u0000-\u001f\u007f]/.test(normalized)) return null;
  return normalized;
}

function normalizeCardMaterial(card, rawCheckout, at, checkoutRequired = true) {
  const checkoutUrl = typeof rawCheckout?.checkoutUrl === "string"
    ? rawCheckout.checkoutUrl.trim()
    : "";
  if (!card || typeof card !== "object" || (checkoutRequired && !checkoutUrl)) return null;
  const number = String(card.number || "").trim();
  const cvv = String(card.cvv || "").trim();
  const expiryMonth = String(card.expiryMonth || "").trim();
  const expiryYear = String(card.expiryYear || "").trim();
  const status = String(card.status || "").trim().toUpperCase();
  let url = null;
  if (checkoutRequired) {
    try { url = new URL(checkoutUrl); } catch { return null; }
  }
  const routeAllowed = !checkoutRequired || (url.origin === "https://chatgpt.com"
    ? /^(?:\/checkout\/?|\/checkout\/[A-Za-z0-9_-]+\/?)$/.test(url.pathname)
    : url.origin === "https://pay.openai.com"
      && /^(?:\/checkout\/[A-Za-z0-9_-]+\/?|\/(?:c\/)?pay\/[A-Za-z0-9_-]+\/?)$/.test(url.pathname));
  const expiryBoundary = Date.UTC(Number(expiryYear), Number(expiryMonth), 1);
  if (status !== "ACTIVE" || (checkoutRequired
      && (url.protocol !== "https:" || url.username || url.password || url.hash)) || !routeAllowed
    || !/^\d{12,19}$/.test(number) || !luhnValid(number)
    || !/^\d{3,4}$/.test(cvv) || !/^(0[1-9]|1[0-2])$/.test(expiryMonth)
    || !/^20\d{2}$/.test(expiryYear) || expiryBoundary <= Date.parse(at)) return null;
  return { checkoutUrl: checkoutRequired ? url.toString() : null, card: { number, cvv, expiryMonth, expiryYear } };
}

function normalizeBilling(raw) {
  const item = Array.isArray(raw?.items) && raw.items.length === 1 ? raw.items[0] : raw;
  const billing = item?.billing || item?.address;
  const person = item?.person;
  if (!billing || typeof billing !== "object") return null;
  const name = boundedText(billing.name || person?.name, 2, 120);
  const line1 = boundedText(billing.line1, 2, 160);
  const city = boundedText(billing.city, 2, 100);
  const state = String(billing.stateAbbr || billing.state || "").trim().toUpperCase();
  const postalCode = String(billing.postalCode || billing.zipCode || "").trim();
  const country = String(billing.countryCode || billing.country || "").trim().toUpperCase();
  if (!name || !line1 || !city || state !== "DE"
    || !/^\d{5}(?:-\d{4})?$/.test(postalCode)
    || !["US", "UNITED STATES"].includes(country)) return null;
  return { name, line1, city, state: "DE", postalCode, country: "US" };
}

function pageHash(page) {
  const shape = {
    stateId: page.stateId,
    origin: page.origin,
    routeTemplate: page.routeTemplate,
    plan: page.plan,
    country: page.country,
    currency: page.currency,
    displayedAmount: page.displayedAmount,
    stateMarker: page.stateMarker,
    fields: page.fields,
    controls: page.controls
  };
  return createHash("sha256").update(JSON.stringify(shape)).digest("hex");
}

function expectedPlan(stage, targetTier) {
  if (stage === "plus") return "plus";
  return targetTier === "x5" ? "prolite" : "pro";
}

function validatePageFacts(data, actionType, contract) {
  const { page, stage, targetTier, adapterVersion, controlId, pageFingerprint } = data;
  if (stage === "upgrade" && targetTier === "plus") return false;
  if (page.structuralHash !== pageFingerprint || pageHash(page) !== pageFingerprint
    || page.plan !== expectedPlan(stage, targetTier) || page.controls.challenge !== null
    || page.displayedAmount < contract.min_amount || page.displayedAmount > contract.max_amount) return false;

  const checkoutRoute = page.origin === "https://chatgpt.com"
    ? ["/checkout", "/checkout/{id}"].includes(page.routeTemplate)
    : page.origin === "https://pay.openai.com"
      && ["/checkout/{id}", "/pay/{id}"].includes(page.routeTemplate);
  if (adapterVersion === CHECKOUT_ADAPTER) {
    if (!checkoutRoute) return false;
    if (actionType === "submit") {
      return page.stateId === "PAYMENT_FINAL_READY" && page.controls.submit === controlId
        && page.controls.progression === null;
    }
    return page.stateId === "PAYMENT_PROGRESSION_READY" && page.controls.progression === controlId
      && page.controls.submit === null;
  }

  const planRoute = page.origin === "https://chatgpt.com" && [
    "/settings/subscription",
    "/settings/billing",
    "/account/billing/overview"
  ].includes(page.routeTemplate);
  const expectedControl = targetTier === "x5" ? page.controls.upgradeX5 : page.controls.upgradeX20;
  return actionType === "progression" && stage === "upgrade" && planRoute
    && page.stateId === "UPGRADE_SELECTION_READY" && expectedControl === controlId
    && page.controls.progression === null && page.controls.submit === null;
}

function serializeCanary(row, contractVersion = null) {
  return {
    id: row.id,
    fulfillmentId: row.fulfillment_id,
    stage: row.stage_key,
    targetTier: row.target_tier,
    cardId: row.card_id,
    fundingBudgetUsd: row.funding_budget,
    priceContractId: row.price_contract_id,
    priceContractVersion: contractVersion,
    adapterVersion: row.adapter_version,
    state: row.state,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at,
    expiresAt: row.expires_at || new Date(
      Date.parse(row.approved_at) + liveCanaryAuthorizationTtlMs
    ).toISOString(),
    consumedAt: row.consumed_at || null,
    invalidatedAt: row.invalidated_at || null,
    snapshotBound: true
  };
}

function serializeQualification(db, row) {
  const contract = db.prepare("SELECT version FROM checkout_price_contracts WHERE id = ?").get(row.price_contract_id);
  return {
    id: row.id,
    tier: row.tier,
    adapterVersion: row.adapter_version,
    adapterPath: row.adapter_path,
    priceContractId: row.price_contract_id,
    priceContractVersion: contract?.version ?? null,
    fulfillmentId: row.fulfillment_id,
    settlement: "COMPLETE",
    exactMembershipConfirmed: true,
    autoRenewDisabled: true,
    unresolvedOutcomeCount: 0,
    qualifiedAt: row.qualified_at
  };
}

function serializeScope(db, row) {
  const contract = db.prepare("SELECT version FROM checkout_price_contracts WHERE id = ?").get(row.price_contract_id);
  return {
    id: row.id,
    scopeKey: row.scope_key,
    revision: row.revision,
    siteId: row.site_id,
    productId: row.product_id,
    tier: row.tier,
    adapterVersion: row.adapter_version,
    priceContractId: row.price_contract_id,
    priceContractVersion: contract?.version ?? null,
    dailyOrderLimit: row.daily_order_limit,
    dailyRiskLimitUsd: row.daily_risk_limit_usd,
    status: row.status,
    activatedAt: row.activated_at || null,
    disabledAt: row.disabled_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at || row.created_at,
    createdBy: row.created_by
  };
}

function serializeIntervention(row) {
  return {
    id: row.id,
    fulfillmentId: row.fulfillment_id,
    state: row.state,
    stateRevision: row.state_revision,
    reasonCode: row.reason_code,
    acknowledgedAt: row.acknowledged_at || null,
    acknowledgedBy: row.acknowledged_by || null,
    feishuStatus: row.feishu_status || null,
    feishuSentAt: row.feishu_sent_at || null,
    createdAt: row.created_at
  };
}

function serializeCompensation(row) {
  return {
    id: row.id,
    fulfillmentId: row.fulfillment_id,
    revision: row.revision,
    resolutionType: row.resolution_type,
    evidenceReference: row.evidence_reference,
    createdAt: row.created_at,
    createdBy: row.created_by
  };
}

function safeRouteError(error, reply) {
  if (error instanceof MembershipActionError) {
    return sendError(reply, error.statusCode || 409, error.code, "支付操作状态不允许");
  }
  if (error instanceof MembershipRolloutError) {
    const status = error.code === "FRESH_ADMIN_AUTH_FAILED" ? 403 : 409;
    return sendError(reply, status, error.code, "灰度或自动范围状态不允许");
  }
  if (error instanceof TypeError) return sendError(reply, 400, "MEMBERSHIP_PAYMENT_REQUEST_INVALID");
  return sendError(reply, 500, "MEMBERSHIP_PAYMENT_INTERNAL_ERROR");
}

export function createMembershipPaymentService(options = {}) {
  const {
    app,
    db,
    requireAdmin,
    extensionDelivery,
    getCardMaterial,
    getCheckoutUrl,
    generateAddress,
    getCardAuthorizationIds,
    authorizeAction,
    createAuditLog,
    adminCredentials,
    paymentGate: configuredPaymentGate = Object.freeze({ enabled: false }),
    now = Date.now
  } = options;
  if (!app || !db || typeof requireAdmin !== "function") {
    throw new TypeError("membership payment service requires app, db, and requireAdmin");
  }

  const extensionRates = new Map();
  const freshAdminRates = new Map();

  function rateAllowed(store, key, limit) {
    const currentMs = Date.parse(nowIso(now));
    const cutoff = currentMs - RATE_WINDOW_MS;
    const recent = (store.get(key) || []).filter((value) => value > cutoff);
    if (recent.length >= limit) {
      store.set(key, recent);
      return false;
    }
    recent.push(currentMs);
    store.set(key, recent);
    return true;
  }

  function authenticateExtension(request, reply, bucket, limit) {
    setNoStore(reply);
    if (typeof extensionDelivery?.authenticateRequest !== "function") {
      sendError(reply, 503, "EXTENSION_DELIVERY_DISABLED");
      return null;
    }
    const auth = extensionDelivery.authenticateRequest(request, reply);
    if (!auth) return null;
    if (auth.settings?.enabled === false) {
      sendError(reply, 503, "EXTENSION_DELIVERY_DISABLED");
      return null;
    }
    const key = `${bucket}:${auth.requestHash || "bound"}:${auth.installationId}`;
    if (!rateAllowed(extensionRates, key, limit)) {
      reply.header("Retry-After", "60");
      sendError(reply, 429, "EXTENSION_RATE_LIMITED", "扩展请求过于频繁");
      return null;
    }
    return auth;
  }

  function checkFreshAdminRate(request, reply) {
    const key = `${request.ip || "local"}:${request.admin?.username || "admin"}`;
    if (rateAllowed(freshAdminRates, key, 5)) return true;
    reply.header("Retry-After", "60");
    sendError(reply, 429, "FRESH_ADMIN_AUTH_RATE_LIMITED", "管理员身份复核请求过于频繁");
    return false;
  }

  function expectedAdminCredentials() {
    return typeof adminCredentials === "function" ? adminCredentials() : (adminCredentials || {});
  }

  function assertPaymentGate(fulfillment) {
    if (fulfillment?.money_boundary_at) return;
    const gate = typeof configuredPaymentGate === "function"
      ? configuredPaymentGate(fulfillment)
      : configuredPaymentGate;
    if (gate?.enabled === true && gate.mode === fulfillment?.run_mode
      && ["canary", "automatic"].includes(fulfillment?.run_mode)) return;
    throw new MembershipActionError("MEMBERSHIP_PAYMENT_GATE_LOCKED");
  }

  function anyPaymentGateEnabled() {
    const gate = typeof configuredPaymentGate === "function"
      ? configuredPaymentGate(null)
      : configuredPaymentGate;
    return gate?.enabled === true;
  }

  function audit(request, action, resourceType, resourceId, detail = null) {
    if (typeof createAuditLog !== "function") return;
    createAuditLog({
      action,
      actor: request.admin?.username || "admin",
      resourceType,
      resourceId,
      detail
    });
  }

  function loadPermitBinding(fulfillmentId, data) {
    const row = db.prepare(`
      SELECT f.target_tier, f.run_mode, f.money_boundary_at, f.state AS fulfillment_state,
             s.id AS stage_id, s.card_id, s.state AS stage_state,
             s.price_contract_id, s.page_fingerprint, s.attempt_no,
             a.adapter_version, a.price_contract_version,
             c.tier AS contract_tier, c.version AS contract_version,
             c.currency, c.min_amount, c.max_amount, c.status AS contract_status
      FROM membership_fulfillments f
      JOIN membership_payment_stages s
        ON s.fulfillment_id = f.id AND s.stage_key = ?
      JOIN membership_fulfillment_attempts a
        ON a.fulfillment_id = f.id AND a.stage = s.stage_key AND a.attempt_no = ?
      JOIN checkout_price_contracts c ON c.id = s.price_contract_id
      WHERE f.id = ?
    `).get(data.stage, data.attempt, fulfillmentId);
    const expectedContractTier = data.stage === "plus" ? "plus" : data.targetTier;
    if (!row || row.target_tier !== data.targetTier || row.attempt_no !== data.attempt
      || row.adapter_version !== data.adapterVersion
      || row.price_contract_version !== data.priceContractVersion
      || row.contract_version !== data.priceContractVersion
      || row.contract_tier !== expectedContractTier || row.currency !== "PHP"
      || (row.contract_status !== "active" && !row.money_boundary_at) || row.price_contract_id === null) {
      throw new MembershipActionError("MEMBERSHIP_STAGE_BINDING_MISMATCH");
    }
    assertPaymentGate(row);
    return row;
  }

  function defaultAuthorizeAction(context, meta) {
    const at = nowIso(now);
    if (context.stageKey === "upgrade" && context.adapterVersion === PLAN_ADAPTER) {
      if (meta.consume) throw new MembershipActionError("ACTION_PERMIT_NOT_AUTHORIZED");
      return {
        mode: "canary",
        authorizationId: `preflight:${context.fulfillmentId}:${context.attemptNo}`
      };
    }
    if (context.fulfillment.run_mode === "canary") {
      expireLiveCanaryAuthorizations(db, { at });
      const row = db.prepare(`
        SELECT * FROM live_canary_authorizations
        WHERE fulfillment_id = ? AND stage_key = ? AND card_id = ?
          AND price_contract_id = ? AND adapter_version = ?
          AND state = 'approved'
        ORDER BY approved_at DESC LIMIT 1
      `).get(
        context.fulfillmentId,
        context.stageKey,
        context.stage.card_id,
        context.stage.price_contract_id,
        context.adapterVersion
      );
      if (!row) throw new MembershipRolloutError("CANARY_AUTHORIZATION_NOT_FOUND", "灰度批准不存在");
      const clearProgression = db.prepare(`
        SELECT id FROM membership_action_permits
        WHERE fulfillment_id = ? AND stage_key = ? AND attempt_no = ?
          AND action_type = 'progression' AND state = 'reported'
          AND outcome_code = 'AUTHORIZATION_CLEAR' AND issued_at >= ?
        ORDER BY sequence_no DESC LIMIT 1
      `).get(
        context.fulfillmentId,
        context.stageKey,
        context.attemptNo,
        row.approved_at
      );
      if (!clearProgression && row.snapshot_fingerprint !== context.stage.page_fingerprint) {
        throw new MembershipRolloutError("CANARY_PAGE_SNAPSHOT_STALE", "灰度批准页面快照已变化");
      }
      if (meta.consume) {
        consumeLiveCanaryAuthorization(db, {
          authorizationId: row.id,
          fulfillmentId: context.fulfillmentId,
          stageKey: context.stageKey,
          cardId: context.stage.card_id,
          fundingBudgetUsd: row.funding_budget,
          priceContractId: context.stage.price_contract_id,
          adapterVersion: context.adapterVersion,
          snapshotFingerprint: row.snapshot_fingerprint,
          at
        });
      }
      return { mode: "canary", authorizationId: row.id };
    }

    if (context.fulfillment.run_mode === "automatic") {
      const quota = db.prepare(`
        SELECT q.id, q.state, s.status AS scope_status, s.tier,
               s.adapter_version, s.price_contract_id
        FROM automatic_checkout_quota_reservations q
        JOIN automatic_checkout_scopes s ON s.id = q.scope_id
        WHERE q.fulfillment_id = ?
      `).get(context.fulfillmentId);
      if (!quota || quota.state !== "reserved"
        || quota.adapter_version !== context.adapterVersion
        || quota.tier !== context.fulfillment.target_tier
        || ((context.stageKey === "upgrade" || context.fulfillment.target_tier === "plus")
          && quota.price_contract_id !== context.stage.price_contract_id)
        || (quota.scope_status !== "active" && !context.fulfillment.money_boundary_at)) {
        throw new MembershipRolloutError("AUTOMATIC_SCOPE_INACTIVE", "自动范围不可用");
      }
      return { mode: "automatic", authorizationId: quota.id };
    }
    throw new MembershipActionError("ACTION_PERMIT_NOT_AUTHORIZED");
  }

  async function authorizationIds(context) {
    const values = typeof getCardAuthorizationIds === "function"
      ? await getCardAuthorizationIds(context)
      : db.prepare(`
          SELECT auth_id FROM managed_card_transactions
          WHERE card_id = ? ORDER BY auth_id
        `).all(context.cardId).map((row) => row.auth_id);
    if (!Array.isArray(values) || values.length > 500) throw new TypeError("authorization ids invalid");
    const normalized = values.map((value) => String(value || "").trim());
    if (normalized.some((value) => !value || value.length > 256)) {
      throw new TypeError("authorization ids invalid");
    }
    return [...new Set(normalized)].sort();
  }

  function currentProgressionSequence(fulfillmentId, stage, attempt, fingerprint) {
    const latest = db.prepare(`
      SELECT sequence_no, state, outcome_code, page_fingerprint
      FROM membership_action_permits
      WHERE fulfillment_id = ? AND stage_key = ? AND attempt_no = ?
        AND action_type = 'progression'
      ORDER BY sequence_no DESC LIMIT 1
    `).get(fulfillmentId, stage, attempt);
    if (!latest) return 1;
    if (latest.state !== "reported" || latest.outcome_code !== "AUTHORIZATION_CLEAR"
      || latest.page_fingerprint === fingerprint) {
      throw new MembershipActionError("ACTION_PERMIT_ALREADY_ISSUED");
    }
    return Number(latest.sequence_no) + 1;
  }

  async function handlePermit(actionType, request, reply) {
    const auth = authenticateExtension(request, reply, `permit:${actionType}`, 60);
    if (!auth) return;
    const fulfillmentId = safeParam(request.params?.id);
    const parsed = permitSchema.safeParse(request.body);
    if (!fulfillmentId || !parsed.success) {
      if (!anyPaymentGateEnabled()) return sendError(reply, 409, "MEMBERSHIP_PAYMENT_GATE_LOCKED");
      return sendError(reply, 400, "MEMBERSHIP_PAYMENT_REQUEST_INVALID");
    }
    try {
      const data = parsed.data;
      const binding = loadPermitBinding(fulfillmentId, data);
      if (binding.page_fingerprint !== data.pageFingerprint
        || !validatePageFacts(data, actionType, binding)) {
        return sendError(reply, 409, "MEMBERSHIP_PAGE_SNAPSHOT_MISMATCH");
      }
      let beforeAuthIds;
      try {
        beforeAuthIds = await authorizationIds({
          fulfillmentId,
          stage: data.stage,
          targetTier: data.targetTier,
          attempt: data.attempt,
          cardId: binding.card_id
        });
      } catch {
        return sendError(reply, 502, "CARD_AUTHORIZATION_SNAPSHOT_UNAVAILABLE");
      }
      const sequenceNo = actionType === "progression"
        ? currentProgressionSequence(fulfillmentId, data.stage, data.attempt, data.pageFingerprint)
        : 1;
      const permit = issueMembershipActionPermit(db, {
        fulfillmentId,
        stageKey: data.stage,
        attemptNo: data.attempt,
        actionType,
        sequenceNo,
        installationId: auth.installationId,
        leaseEpoch: data.leaseEpoch,
        adapterVersion: data.adapterVersion,
        priceContractId: binding.price_contract_id,
        controlId: data.controlId,
        pageFingerprint: data.pageFingerprint,
        beforeAuthIds,
        authorizationClear: actionType === "submit",
        at: nowIso(now),
        authorize: (context, meta) => (typeof authorizeAction === "function"
          ? authorizeAction(context, meta)
          : defaultAuthorizeAction(context, meta))
      });
      return {
        permitId: permit.permitId,
        kind: permit.kind,
        singleUse: true,
        fulfillmentId: permit.fulfillmentId,
        stage: permit.stageKey,
        targetTier: data.targetTier,
        attempt: permit.attemptNo,
        leaseEpoch: permit.leaseEpoch,
        adapterVersion: permit.adapterVersion,
        priceContractVersion: data.priceContractVersion,
        controlId: permit.controlId,
        pageFingerprint: permit.pageFingerprint,
        authorizationMode: permit.authorizationMode,
        authorizationId: permit.authorizationId,
        authorizationState: permit.authorizationState,
        expiresAt: permit.expiresAt
      };
    } catch (error) {
      return safeRouteError(error, reply);
    }
  }

  app.post("/api/extension/membership-material-grants/:grantId/claim", {
    bodyLimit: EXTENSION_BODY_LIMIT
  }, async (request, reply) => {
    const auth = authenticateExtension(request, reply, "material", 30);
    if (!auth) return;
    const grantId = safeParam(request.params?.grantId);
    const parsed = materialClaimSchema.safeParse(request.body);
    if (!grantId || !parsed.success) {
      if (!anyPaymentGateEnabled()) return sendError(reply, 409, "MEMBERSHIP_PAYMENT_GATE_LOCKED");
      return sendError(reply, 400, "MATERIAL_CLAIM_INVALID");
    }
    if (typeof getCardMaterial !== "function" || typeof getCheckoutUrl !== "function"
      || typeof generateAddress !== "function") {
      return sendError(reply, 503, "CHECKOUT_MATERIAL_UNAVAILABLE");
    }
    try {
      const data = parsed.data;
      if (data.stage === "upgrade" && data.targetTier === "plus") {
        return sendError(reply, 400, "MATERIAL_CLAIM_INVALID");
      }
      const gateRow = db.prepare(`
        SELECT f.run_mode, f.money_boundary_at
        FROM membership_material_grants grant_row
        JOIN membership_fulfillments f ON f.id = grant_row.fulfillment_id
        WHERE grant_row.id = ? AND grant_row.fulfillment_id = ?
      `).get(grantId, data.fulfillmentId);
      if (!gateRow) {
        throw new MembershipActionError("MATERIAL_GRANT_INVALID", "敏感资料授权无效", { statusCode: 404 });
      }
      assertPaymentGate(gateRow);
      const claimed = claimMembershipMaterialGrant(db, {
        grantId,
        nonce: data.nonce,
        fulfillmentId: data.fulfillmentId,
        stageKey: data.stage,
        attemptNo: data.attempt,
        installationId: auth.installationId,
        leaseEpoch: data.leaseEpoch,
        adapterVersion: data.adapterVersion,
        at: nowIso(now)
      });
      if (claimed.targetTier !== data.targetTier) {
        throw new MembershipActionError("MEMBERSHIP_STAGE_BINDING_MISMATCH");
      }
      const contract = db.prepare(`
        SELECT version, currency FROM checkout_price_contracts WHERE id = ?
      `).get(claimed.priceContractId);
      if (!contract || contract.currency !== "PHP") {
        throw new MembershipActionError("MEMBERSHIP_PAGE_SNAPSHOT_MISMATCH");
      }
      const context = Object.freeze({
        fulfillmentId: claimed.fulfillmentId,
        stage: claimed.stageKey,
        targetTier: claimed.targetTier,
        attempt: claimed.attemptNo,
        leaseEpoch: claimed.leaseEpoch,
        adapterVersion: claimed.adapterVersion,
        cardId: claimed.cardId
      });
      let rawCard;
      let rawCheckout;
      let rawAddress;
      try {
        [rawCard, rawCheckout, rawAddress] = await Promise.all([
          getCardMaterial(context),
          getCheckoutUrl(context),
          generateAddress({ ...context, state: "DE", count: 1, includePerson: true })
        ]);
      } catch {
        return sendError(reply, 502, "CHECKOUT_MATERIAL_UNAVAILABLE");
      }
      const at = nowIso(now);
      const material = normalizeCardMaterial(rawCard, rawCheckout, at, claimed.stageKey === "plus");
      const billing = normalizeBilling(rawAddress);
      if (!material || !billing) {
        return sendError(reply, 502, "CHECKOUT_MATERIAL_CONTRACT_INVALID");
      }
      return {
        checkoutUrl: material.checkoutUrl,
        card: material.card,
        billing,
        validation: {
          stage: claimed.stageKey,
          targetTier: claimed.targetTier,
          currency: "PHP",
          priceContractVersion: contract.version,
          adapterVersion: claimed.adapterVersion
        }
      };
    } catch (error) {
      if (error instanceof MembershipActionError || error instanceof TypeError) {
        return safeRouteError(error, reply);
      }
      return sendError(reply, 502, "CHECKOUT_MATERIAL_UNAVAILABLE");
    }
  });

  app.post("/api/extension/membership-fulfillments/:id/progression-permit", {
    bodyLimit: EXTENSION_BODY_LIMIT
  }, (request, reply) => handlePermit("progression", request, reply));

  app.post("/api/extension/membership-fulfillments/:id/submit-permit", {
    bodyLimit: EXTENSION_BODY_LIMIT
  }, (request, reply) => handlePermit("submit", request, reply));

  app.post("/api/extension/membership-fulfillments/:id/action-ack", {
    bodyLimit: EXTENSION_BODY_LIMIT
  }, async (request, reply) => {
    const auth = authenticateExtension(request, reply, "action-ack", 30);
    if (!auth) return;
    const fulfillmentId = safeParam(request.params?.id);
    const parsed = actionAckSchema.safeParse(request.body);
    if (!fulfillmentId || !parsed.success) {
      return sendError(reply, 400, "MEMBERSHIP_PAYMENT_REQUEST_INVALID");
    }
    try {
      const fulfillment = db.prepare("SELECT target_tier FROM membership_fulfillments WHERE id = ?").get(fulfillmentId);
      if (!fulfillment || fulfillment.target_tier !== parsed.data.targetTier
        || (parsed.data.stage === "upgrade" && parsed.data.targetTier === "plus")) {
        throw new MembershipActionError("MEMBERSHIP_STAGE_BINDING_MISMATCH");
      }
      return acknowledgeMembershipPaymentChallenge(db, {
        fulfillmentId,
        stageKey: parsed.data.stage,
        attemptNo: parsed.data.attempt,
        leaseEpoch: parsed.data.leaseEpoch,
        installationId: auth.installationId,
        adapterVersion: parsed.data.adapterVersion,
        at: nowIso(now)
      });
    } catch (error) {
      return safeRouteError(error, reply);
    }
  });

  app.post("/api/admin/membership-fulfillment/rollout-mode", {
    preHandler: requireAdmin,
    bodyLimit: ADMIN_BODY_LIMIT
  }, async (request, reply) => {
    setNoStore(reply);
    const parsed = rolloutModeSchema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, "MEMBERSHIP_ROLLOUT_MODE_INVALID");
    if (!checkFreshAdminRate(request, reply)) return;
    try {
      const verified = verifyFreshAdminCredentials(parsed.data.credentials, expectedAdminCredentials());
      const current = db.prepare(`
        SELECT * FROM membership_fulfillment_settings WHERE id = 'default'
      `).get();
      const extension = db.prepare(`
        SELECT extension_token_sha256, bound_installation_id, spacexcard_api_token_encrypted
        FROM extension_delivery_settings WHERE id = 'default'
      `).get();
      const moneyEnabled = ["canary", "automatic"].includes(parsed.data.mode);
      if (moneyEnabled && (current.inventory_status !== "completed"
        || !current.spacexcard_app_secret_encrypted
        || !extension?.extension_token_sha256 || !extension.bound_installation_id
        || !extension.spacexcard_api_token_encrypted)) {
        return sendError(reply, 409, "MEMBERSHIP_ROLLOUT_DEPENDENCIES_NOT_READY");
      }
      const at = nowIso(now);
      db.prepare(`
        UPDATE membership_fulfillment_settings
        SET enabled = ?, rollout_mode = ?, updated_at = ?, updated_by = ?
        WHERE id = 'default'
      `).run(moneyEnabled ? 1 : 0, parsed.data.mode, at, verified.actor);
      audit(request, "membership.rollout_mode.update", "membership_fulfillment_settings", "default", {
        previousMode: current.rollout_mode || "disabled",
        mode: parsed.data.mode,
        paymentGateEnabled: moneyEnabled
      });
      return {
        item: {
          mode: parsed.data.mode,
          paymentGateEnabled: moneyEnabled,
          updatedAt: at,
          updatedBy: verified.actor
        }
      };
    } catch (error) {
      return safeRouteError(error, reply);
    }
  });

  app.post("/api/admin/membership-fulfillments/:id/start-canary", {
    preHandler: requireAdmin,
    bodyLimit: ADMIN_BODY_LIMIT
  }, async (request, reply) => {
    setNoStore(reply);
    const fulfillmentId = safeParam(request.params?.id);
    const parsed = canaryStartSchema.safeParse(request.body);
    if (!fulfillmentId || !parsed.success) return sendError(reply, 400, "CANARY_START_INVALID");
    if (!checkFreshAdminRate(request, reply)) return;
    try {
      const verified = verifyFreshAdminCredentials(parsed.data.credentials, expectedAdminCredentials());
      const at = nowIso(now);
      const result = db.transaction(() => {
        const settings = db.prepare(`
          SELECT enabled, rollout_mode FROM membership_fulfillment_settings WHERE id = 'default'
        `).get();
        const fulfillment = db.prepare("SELECT * FROM membership_fulfillments WHERE id = ?").get(fulfillmentId);
        if (!fulfillment) return { error: "not_found" };
        if (settings?.enabled !== 1 || !["canary", "automatic"].includes(settings.rollout_mode)) {
          return { error: "gate" };
        }
        if (fulfillment.state !== "FUNDING_READY" || fulfillment.money_boundary_at
          || ![null, "canary"].includes(fulfillment.run_mode)) return { error: "state" };
        const exposure = db.prepare(`
          SELECT
            EXISTS(SELECT 1 FROM funding_intents WHERE fulfillment_id = ?) AS has_funding,
            EXISTS(SELECT 1 FROM card_capacity_reservations WHERE fulfillment_id = ?) AS has_reservation
        `).get(fulfillmentId, fulfillmentId);
        if (exposure.has_funding || exposure.has_reservation) return { error: "state" };
        const previousTier = fulfillment.target_tier === "x5" ? "plus"
          : (fulfillment.target_tier === "x20" ? "x5" : null);
        if (previousTier && !db.prepare(`
          SELECT id FROM tier_rollout_qualifications
          WHERE tier = ? AND adapter_version = ? LIMIT 1
        `).get(previousTier, CHECKOUT_ADAPTER)) return { error: "qualification" };
        const active = db.prepare(`
          SELECT id FROM membership_fulfillments
          WHERE id <> ? AND run_mode = 'canary'
            AND state NOT IN (
              'ACCOUNT_ALREADY_SUBSCRIBED', 'PAYMENT_DECLINED',
              'PARTIAL_FULFILLMENT_EXPIRED', 'CANCELLED', 'COMPLETED'
            )
          LIMIT 1
        `).get(fulfillmentId);
        if (active) return { error: "busy" };
        db.prepare(`
          UPDATE membership_fulfillments
          SET run_mode = 'canary', state_revision = state_revision + 1,
              failure_code = NULL, retry_at = NULL, updated_at = ?
          WHERE id = ? AND state = 'FUNDING_READY'
        `).run(at, fulfillmentId);
        return { value: db.prepare("SELECT * FROM membership_fulfillments WHERE id = ?").get(fulfillmentId) };
      }).immediate();
      if (result.error === "not_found") return sendError(reply, 404, "MEMBERSHIP_FULFILLMENT_NOT_FOUND");
      if (result.error === "gate") return sendError(reply, 409, "MEMBERSHIP_PAYMENT_GATE_LOCKED");
      if (result.error === "qualification") return sendError(reply, 409, "ROLLOUT_QUALIFICATION_ORDER_REQUIRED");
      if (result.error === "busy") return sendError(reply, 409, "CANARY_FULFILLMENT_BUSY");
      if (result.error) return sendError(reply, 409, "CANARY_START_STATE_INVALID");
      audit(request, "membership.canary.start", "membership_fulfillment", fulfillmentId, {
        targetTier: result.value.target_tier,
        stateRevision: result.value.state_revision,
        actor: verified.actor
      });
      return {
        item: {
          fulfillmentId,
          targetTier: result.value.target_tier,
          runMode: result.value.run_mode,
          state: result.value.state,
          stateRevision: result.value.state_revision,
          updatedAt: result.value.updated_at
        }
      };
    } catch (error) {
      return safeRouteError(error, reply);
    }
  });

  function canaryPreparation(fulfillmentId) {
    const fulfillment = db.prepare(`
      SELECT * FROM membership_fulfillments WHERE id = ?
    `).get(fulfillmentId);
    if (!fulfillment) return null;
    const stage = fulfillment.state.startsWith("UPGRADE_") ? "upgrade" : "plus";
    const row = db.prepare(`
      SELECT s.*, a.price_contract_version, c.version AS contract_version
      FROM membership_payment_stages s
      LEFT JOIN membership_fulfillment_attempts a
        ON a.fulfillment_id = s.fulfillment_id AND a.stage = s.stage_key
        AND a.attempt_no = s.attempt_no
      LEFT JOIN checkout_price_contracts c ON c.id = s.price_contract_id
      WHERE s.fulfillment_id = ? AND s.stage_key = ?
    `).get(fulfillmentId, stage);
    const priceRows = db.prepare(`
      SELECT stage_key, price_signal_amount FROM membership_payment_stages
      WHERE fulfillment_id = ? ORDER BY stage_key
    `).all(fulfillmentId);
    const expectedStages = fulfillment.target_tier === "plus" ? ["plus"] : ["plus", "upgrade"];
    const pricesComplete = expectedStages.every((stageKey) => priceRows.some(
      (item) => item.stage_key === stageKey && item.price_signal_amount !== null
        && Number.isFinite(Number(item.price_signal_amount))
    ));
    const fundingBudgetUsd = pricesComplete
      ? Math.round(expectedStages.reduce((sum, stageKey) => {
          const price = priceRows.find((item) => item.stage_key === stageKey);
          return sum + Number(price.price_signal_amount) + 0.2;
        }, 0) * 100) / 100
      : null;
    const readyState = stage === "plus" ? "PLUS_APPROVAL_WAIT" : "UPGRADE_APPROVAL_WAIT";
    const ready = Boolean(row && fulfillment.state === readyState && row.card_id
      && SAFE_ID.test(row.adapter_version || "") && SAFE_ID.test(row.price_contract_id || "")
      && SHA256.test(row.page_fingerprint || "")
      && row.price_contract_version === row.contract_version && fundingBudgetUsd !== null);
    return {
      ready,
      stage,
      cardId: ready ? row.card_id : null,
      fundingBudgetUsd: ready ? fundingBudgetUsd : null,
      priceContractId: ready ? row.price_contract_id : null,
      adapterVersion: ready ? row.adapter_version : null,
      pageFingerprint: ready ? row.page_fingerprint : null,
      preparedAt: ready ? row.updated_at : null,
      reasonCode: ready ? null : "CANARY_PREPARATION_NOT_READY"
    };
  }

  app.get("/api/admin/live-canary-authorizations", { preHandler: requireAdmin }, async (request, reply) => {
    setNoStore(reply);
    const query = z.object({
      fulfillmentId: z.string().regex(SAFE_ID).optional(),
      state: z.enum(["approved", "consumed", "expired", "invalidated"]).optional()
    }).strict().safeParse(request.query || {});
    if (!query.success) return sendError(reply, 400, "CANARY_QUERY_INVALID");
    expireLiveCanaryAuthorizations(db, { at: nowIso(now) });
    const clauses = [];
    const values = [];
    if (query.data.fulfillmentId) { clauses.push("fulfillment_id = ?"); values.push(query.data.fulfillmentId); }
    if (query.data.state) { clauses.push("state = ?"); values.push(query.data.state); }
    const rows = db.prepare(`
      SELECT * FROM live_canary_authorizations
      ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
      ORDER BY approved_at DESC LIMIT 200
    `).all(...values);
    const items = rows.map((row) => serializeCanary(
      row,
      db.prepare("SELECT version FROM checkout_price_contracts WHERE id = ?").get(row.price_contract_id)?.version ?? null
    ));
    return {
      items,
      canaryPreparation: query.data.fulfillmentId ? canaryPreparation(query.data.fulfillmentId) : null
    };
  });

  app.post("/api/admin/live-canary-authorizations", {
    preHandler: requireAdmin,
    bodyLimit: ADMIN_BODY_LIMIT
  }, async (request, reply) => {
    setNoStore(reply);
    const parsed = canaryApprovalSchema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, "CANARY_APPROVAL_INVALID");
    if (!checkFreshAdminRate(request, reply)) return;
    try {
      const preparation = canaryPreparation(parsed.data.fulfillmentId);
      if (!preparation?.ready || preparation.stage !== parsed.data.stage
        || preparation.cardId !== parsed.data.cardId
        || !sameMoney(preparation.fundingBudgetUsd, parsed.data.fundingBudgetUsd)
        || preparation.priceContractId !== parsed.data.priceContractId
        || preparation.adapterVersion !== parsed.data.adapterVersion
        || preparation.pageFingerprint !== parsed.data.pageFingerprint) {
        return sendError(reply, 409, "CANARY_PAGE_SNAPSHOT_STALE");
      }
      const approved = approveLiveCanaryStage(db, {
        fulfillmentId: parsed.data.fulfillmentId,
        stageKey: parsed.data.stage,
        cardId: parsed.data.cardId,
        fundingBudgetUsd: parsed.data.fundingBudgetUsd,
        priceContractId: parsed.data.priceContractId,
        adapterVersion: parsed.data.adapterVersion,
        snapshotFingerprint: parsed.data.pageFingerprint,
        approvedAt: nowIso(now),
        credentials: parsed.data.credentials
      }, expectedAdminCredentials());
      const row = db.prepare("SELECT * FROM live_canary_authorizations WHERE id = ?").get(approved.id);
      const item = serializeCanary(row, approved.priceContractVersion);
      audit(request, "membership.canary.approve", "live_canary_authorization", item.id, {
        fulfillmentId: item.fulfillmentId,
        stage: item.stage,
        targetTier: item.targetTier
      });
      return { item };
    } catch (error) {
      return safeRouteError(error, reply);
    }
  });

  app.get("/api/admin/tier-rollout-qualifications", { preHandler: requireAdmin }, async (_request, reply) => {
    setNoStore(reply);
    const rows = db.prepare(`
      SELECT * FROM tier_rollout_qualifications ORDER BY qualified_at DESC
    `).all();
    return { items: rows.map((row) => serializeQualification(db, row)) };
  });

  app.post("/api/admin/tier-rollout-qualifications", {
    preHandler: requireAdmin,
    bodyLimit: ADMIN_BODY_LIMIT
  }, async (request, reply) => {
    setNoStore(reply);
    const parsed = qualificationSchema.safeParse(request.body);
    if (!parsed.success || parsed.data.adapterPath.includes("..")) {
      return sendError(reply, 400, "ROLLOUT_QUALIFICATION_INVALID");
    }
    try {
      const fulfillment = db.prepare("SELECT target_tier FROM membership_fulfillments WHERE id = ?")
        .get(parsed.data.fulfillmentId);
      if (!fulfillment) return sendError(reply, 404, "MEMBERSHIP_FULFILLMENT_NOT_FOUND");
      const item = qualifyTierRollout(db, {
        fulfillmentId: parsed.data.fulfillmentId,
        tier: fulfillment.target_tier,
        adapterVersion: parsed.data.adapterVersion,
        adapterPath: parsed.data.adapterPath,
        priceContractId: parsed.data.priceContractId,
        unresolvedOutcomeCount: countMembershipUnresolvedOutcomes(db, parsed.data.fulfillmentId),
        qualifiedAt: nowIso(now)
      });
      audit(request, "membership.rollout.qualify", "tier_rollout_qualification", item.id, {
        tier: item.tier,
        fulfillmentId: item.fulfillmentId
      });
      return { item };
    } catch (error) {
      return safeRouteError(error, reply);
    }
  });

  app.get("/api/admin/automatic-checkout-scopes", { preHandler: requireAdmin }, async (request, reply) => {
    setNoStore(reply);
    const query = z.object({
      status: z.enum(["active", "paused", "disabled"]).optional()
    }).strict().safeParse(request.query || {});
    if (!query.success) return sendError(reply, 400, "AUTOMATIC_SCOPE_QUERY_INVALID");
    const rows = query.data.status
      ? db.prepare("SELECT * FROM automatic_checkout_scopes WHERE status = ? ORDER BY created_at DESC")
          .all(query.data.status)
      : db.prepare("SELECT * FROM automatic_checkout_scopes ORDER BY created_at DESC").all();
    return { items: rows.map((row) => serializeScope(db, row)) };
  });

  app.post("/api/admin/automatic-checkout-scopes", {
    preHandler: requireAdmin,
    bodyLimit: ADMIN_BODY_LIMIT
  }, async (request, reply) => {
    setNoStore(reply);
    const parsed = scopeCreateSchema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, "AUTOMATIC_SCOPE_INVALID");
    if (!checkFreshAdminRate(request, reply)) return;
    try {
      const created = createAutomaticCheckoutScope(db, {
        ...parsed.data,
        activatedAt: nowIso(now)
      }, expectedAdminCredentials());
      const item = serializeScope(
        db,
        db.prepare("SELECT * FROM automatic_checkout_scopes WHERE id = ?").get(created.id)
      );
      audit(request, "membership.automatic_scope.create", "automatic_checkout_scope", item.id, {
        siteId: item.siteId,
        productId: item.productId,
        tier: item.tier,
        revision: item.revision
      });
      return { item };
    } catch (error) {
      return safeRouteError(error, reply);
    }
  });

  app.post("/api/admin/automatic-checkout-scopes/:id/disable", {
    preHandler: requireAdmin,
    bodyLimit: ADMIN_BODY_LIMIT
  }, async (request, reply) => {
    setNoStore(reply);
    const id = safeParam(request.params?.id);
    const empty = z.object({}).strict().safeParse(request.body || {});
    if (!id || !empty.success) return sendError(reply, 400, "AUTOMATIC_SCOPE_INVALID");
    try {
      const at = nowIso(now);
      const item = db.transaction(() => {
        const existing = db.prepare("SELECT * FROM automatic_checkout_scopes WHERE id = ?").get(id);
        if (!existing) return null;
        db.prepare(`
          UPDATE automatic_checkout_scopes
          SET status = 'disabled', disabled_at = COALESCE(disabled_at, ?), updated_at = ?
          WHERE id = ?
        `).run(at, at, id);
        return serializeScope(db, db.prepare("SELECT * FROM automatic_checkout_scopes WHERE id = ?").get(id));
      }).immediate();
      if (!item) return sendError(reply, 404, "AUTOMATIC_SCOPE_NOT_FOUND");
      audit(request, "membership.automatic_scope.disable", "automatic_checkout_scope", id, {
        revision: item.revision
      });
      return { item };
    } catch (error) {
      return safeRouteError(error, reply);
    }
  });

  app.post("/api/admin/automatic-checkout-scopes/:id/increase-limits", {
    preHandler: requireAdmin,
    bodyLimit: ADMIN_BODY_LIMIT
  }, async (request, reply) => {
    setNoStore(reply);
    const id = safeParam(request.params?.id);
    const parsed = scopeRevisionSchema.safeParse(request.body);
    if (!id || !parsed.success) return sendError(reply, 400, "AUTOMATIC_SCOPE_INVALID");
    if (!checkFreshAdminRate(request, reply)) return;
    const previous = db.prepare("SELECT * FROM automatic_checkout_scopes WHERE id = ?").get(id);
    if (!previous) return sendError(reply, 404, "AUTOMATIC_SCOPE_NOT_FOUND");
    if (parsed.data.dailyOrderLimit < previous.daily_order_limit
      || parsed.data.dailyRiskLimitUsd < previous.daily_risk_limit_usd
      || (parsed.data.dailyOrderLimit === previous.daily_order_limit
        && sameMoney(parsed.data.dailyRiskLimitUsd, previous.daily_risk_limit_usd)
        && !parsed.data.adapterVersion && !parsed.data.priceContractId)) {
      return sendError(reply, 409, "AUTOMATIC_SCOPE_LIMIT_INCREASE_REQUIRED");
    }
    try {
      const revised = reviseAutomaticCheckoutScope(db, {
        previousScopeId: id,
        ...parsed.data,
        activatedAt: nowIso(now)
      }, expectedAdminCredentials());
      const item = serializeScope(
        db,
        db.prepare("SELECT * FROM automatic_checkout_scopes WHERE id = ?").get(revised.id)
      );
      audit(request, "membership.automatic_scope.revise", "automatic_checkout_scope", item.id, {
        previousScopeId: id,
        revision: item.revision,
        dailyOrderLimit: item.dailyOrderLimit,
        dailyRiskLimitUsd: item.dailyRiskLimitUsd
      });
      return { item };
    } catch (error) {
      return safeRouteError(error, reply);
    }
  });

  app.get("/api/admin/fulfillment-interventions", { preHandler: requireAdmin }, async (request, reply) => {
    setNoStore(reply);
    const query = z.object({
      acknowledged: z.enum(["pending", "acknowledged"]).optional(),
      limit: z.coerce.number().int().min(1).max(200).optional().default(100)
    }).strict().safeParse(request.query || {});
    if (!query.success) return sendError(reply, 400, "INTERVENTION_QUERY_INVALID");
    const clause = query.data.acknowledged === "pending" ? "WHERE acknowledged_at IS NULL"
      : query.data.acknowledged === "acknowledged" ? "WHERE acknowledged_at IS NOT NULL" : "";
    const rows = db.prepare(`
      SELECT * FROM fulfillment_interventions ${clause}
      ORDER BY created_at DESC LIMIT ?
    `).all(query.data.limit);
    return { items: rows.map(serializeIntervention) };
  });

  app.post("/api/admin/fulfillment-interventions/:id/ack", {
    preHandler: requireAdmin,
    bodyLimit: ADMIN_BODY_LIMIT
  }, async (request, reply) => {
    setNoStore(reply);
    const id = safeParam(request.params?.id);
    const empty = z.object({}).strict().safeParse(request.body || {});
    if (!id || !empty.success) return sendError(reply, 400, "INTERVENTION_ACK_INVALID");
    const at = nowIso(now);
    const actor = request.admin?.username || "admin";
    const item = db.transaction(() => {
      const existing = db.prepare("SELECT * FROM fulfillment_interventions WHERE id = ?").get(id);
      if (!existing) return null;
      db.prepare(`
        UPDATE fulfillment_interventions
        SET acknowledged_at = COALESCE(acknowledged_at, ?),
            acknowledged_by = COALESCE(acknowledged_by, ?)
        WHERE id = ?
      `).run(at, actor, id);
      return serializeIntervention(db.prepare("SELECT * FROM fulfillment_interventions WHERE id = ?").get(id));
    })();
    if (!item) return sendError(reply, 404, "INTERVENTION_NOT_FOUND");
    audit(request, "membership.intervention.ack", "fulfillment_intervention", id, {
      fulfillmentId: item.fulfillmentId,
      stateRevision: item.stateRevision
    });
    return { item };
  });

  app.post("/api/admin/membership-fulfillments/:id/compensations", {
    preHandler: requireAdmin,
    bodyLimit: ADMIN_BODY_LIMIT
  }, async (request, reply) => {
    setNoStore(reply);
    const fulfillmentId = safeParam(request.params?.id);
    const parsed = compensationSchema.safeParse(request.body);
    if (!fulfillmentId || !parsed.success) return sendError(reply, 400, "COMPENSATION_INVALID");
    try {
      const at = nowIso(now);
      const actor = request.admin?.username || "admin";
      const item = db.transaction(() => {
        const fulfillment = db.prepare("SELECT state FROM membership_fulfillments WHERE id = ?")
          .get(fulfillmentId);
        if (!fulfillment) return { error: "not_found" };
        if (!["PARTIALLY_FULFILLED", "PARTIAL_FULFILLMENT_EXPIRED"].includes(fulfillment.state)) {
          return { error: "state" };
        }
        const revision = Number(db.prepare(`
          SELECT COALESCE(MAX(revision), 0) AS revision
          FROM customer_compensation_resolutions WHERE fulfillment_id = ?
        `).get(fulfillmentId).revision) + 1;
        const id = `ccr_${randomUUID()}`;
        db.prepare(`
          INSERT INTO customer_compensation_resolutions (
            id, fulfillment_id, revision, resolution_type,
            evidence_reference, created_at, created_by
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          id,
          fulfillmentId,
          revision,
          parsed.data.resolutionType,
          parsed.data.evidenceReference,
          at,
          actor
        );
        return { value: serializeCompensation(
          db.prepare("SELECT * FROM customer_compensation_resolutions WHERE id = ?").get(id)
        ) };
      }).immediate();
      if (item.error === "not_found") return sendError(reply, 404, "MEMBERSHIP_FULFILLMENT_NOT_FOUND");
      if (item.error) return sendError(reply, 409, "COMPENSATION_STATE_INVALID");
      audit(request, "membership.compensation.append", "customer_compensation_resolution", item.value.id, {
        fulfillmentId,
        revision: item.value.revision,
        resolutionType: item.value.resolutionType
      });
      return { item: item.value };
    } catch (error) {
      return safeRouteError(error, reply);
    }
  });

  return Object.freeze({
    extensionRoutes: Object.freeze([
      "/api/extension/membership-material-grants/:grantId/claim",
      "/api/extension/membership-fulfillments/:id/progression-permit",
      "/api/extension/membership-fulfillments/:id/submit-permit",
      "/api/extension/membership-fulfillments/:id/action-ack"
    ]),
    adminRoutes: Object.freeze([
      "/api/admin/membership-fulfillment/rollout-mode",
      "/api/admin/membership-fulfillments/:id/start-canary",
      "/api/admin/live-canary-authorizations",
      "/api/admin/tier-rollout-qualifications",
      "/api/admin/automatic-checkout-scopes",
      "/api/admin/automatic-checkout-scopes/:id/disable",
      "/api/admin/automatic-checkout-scopes/:id/increase-limits",
      "/api/admin/fulfillment-interventions",
      "/api/admin/fulfillment-interventions/:id/ack",
      "/api/admin/membership-fulfillments/:id/compensations"
    ])
  });
}
