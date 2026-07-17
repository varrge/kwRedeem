import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { Readable } from "node:stream";
import { z } from "zod";
import { membershipStateProviderUrl } from "../../shared/src/membership-state-provider.js";
import { createSpaceXCardCheckout } from "../../shared/src/spacexcard-gpt.js";
import {
  calculateMembershipBudget,
  classifyHistoricalCardFulfillments,
  membershipFulfillmentStates,
  membershipTiers,
  selectCanonicalCardTransactionState
} from "../../shared/src/membership-fulfillment.js";
import {
  requestDependencyProbe,
  serializeDependencyCircuit
} from "../../shared/src/membership-circuits.js";
import { spaceXCardOpenApiBaseUrl } from "../../shared/src/spacexcard-openapi.js";
import { SpaceXCardOpenApiClient } from "../../shared/src/spacexcard-openapi.js";
import {
  createMembershipMaterialGrant,
  evaluateProgressionAuthorizationDelta,
  markMembershipActionOutcomeUncertain,
  reportMembershipActionActivation
} from "../../shared/src/membership-actions.js";
import {
  membershipPaymentAdapters,
  validateSanitizedMembershipPageShape,
  validateMembershipPaymentPage,
  validateMembershipStageControl
} from "../../shared/src/membership-browser-protocol.js";
import { persistManagedCardTransactions } from "../../shared/src/membership-reconciliation.js";
import {
  serializeMembershipInventoryRun,
  startMembershipInventoryRun
} from "../../shared/src/membership-inventory.js";
import {
  acquireBrowserFulfillmentLease,
  acquirePaymentBrowserFulfillmentLease,
  createMembershipFulfillmentForOrder,
  expireBrowserFulfillmentLease,
  heartbeatBrowserFulfillmentLease,
  membershipCheckoutAdapterVersion,
  projectMembershipDelivery,
  releaseBrowserFulfillmentLease,
  sanitizeAndReleaseBrowserFulfillmentLease,
  transitionMembershipFulfillment
} from "../../shared/src/membership-orchestration.js";

const CHECKOUT_BROKER_URL = "https://spacexcard.com/api/v1/gpt/checkout";
const WEBHOOK_BODY_LIMIT = 32 * 1024;
const EXTENSION_BODY_LIMIT = 8 * 1024;
const EXTENSION_RATE_WINDOW_MS = 60_000;
const PAYMENT_TRANSACTION_PAGE_SIZE = 50;
const PAYMENT_TRANSACTION_MAX_PAGES = 100;
const PLAN_MANAGEMENT_URL = "https://chatgpt.com/settings/subscription";

function setNoStore(reply) {
  reply.header("Cache-Control", "no-store");
  reply.header("Pragma", "no-cache");
}

function consumeExtensionRateLimit(store, key, limit, nowMs = Date.now()) {
  const cutoff = nowMs - EXTENSION_RATE_WINDOW_MS;
  const recent = (store.get(key) || []).filter((item) => item > cutoff);
  if (recent.length >= limit) {
    store.set(key, recent);
    return false;
  }
  recent.push(nowMs);
  store.set(key, recent);
  return true;
}

async function captureRawBody(request, _reply, payload) {
  const chunks = [];
  let total = 0;
  for await (const chunk of payload) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > WEBHOOK_BODY_LIMIT) {
      const tooLarge = new Error("Webhook 请求正文过大");
      tooLarge.statusCode = 413;
      throw tooLarge;
    }
    chunks.push(buffer);
  }
  request.rawBody = Buffer.concat(chunks);
  const replay = Readable.from([request.rawBody]);
  replay.receivedEncodedLength = request.rawBody.length;
  return replay;
}

function validWebhookSignature(secret, rawBody, signature) {
  if (!secret || !Buffer.isBuffer(rawBody) || !/^[a-f0-9]{64}$/.test(String(signature || ""))) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const actual = String(signature);
  return expected.length === actual.length
    && timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(actual, "hex"));
}

function serializePriceContract(row) {
  return {
    id: row.id,
    tier: row.tier,
    version: row.version,
    currency: row.currency,
    minAmount: row.min_amount,
    maxAmount: row.max_amount,
    status: row.status,
    createdAt: row.created_at,
    createdBy: row.created_by,
    activatedAt: row.activated_at || null
  };
}

function serializeCheckoutValidationRun(row) {
  let result = null;
  try {
    result = row.sanitized_result ? JSON.parse(row.sanitized_result) : null;
  } catch {}
  return {
    id: row.id,
    siteId: row.site_id,
    productId: row.product_id,
    tier: row.tier,
    adapterVersion: row.adapter_version,
    priceContractId: row.price_contract_id,
    status: row.status,
    result,
    startedAt: row.started_at,
    completedAt: row.completed_at || null,
    createdBy: row.created_by
  };
}

function serializeSettings(row, extensionSettings) {
  return {
    enabled: row.enabled === 1,
    paymentGateLocked: row.enabled !== 1 || !["canary", "automatic"].includes(row.rollout_mode),
    rolloutMode: row.rollout_mode || "disabled",
    appId: row.spacexcard_app_id || "",
    hasAppSecret: Boolean(row.spacexcard_app_secret_encrypted),
    hasWebhookSecret: Boolean(row.spacexcard_webhook_secret_encrypted),
    inventoryStatus: row.inventory_status,
    inventoryInitializedAt: row.inventory_initialized_at || null,
    lastInventoryError: row.last_inventory_error || null,
    businessTimezone: row.business_timezone,
    resumeRevision: row.resume_revision,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
    dependencies: {
      openApiBaseUrl: spaceXCardOpenApiBaseUrl,
      membershipStateProviderUrl,
      checkoutBrokerUrl: CHECKOUT_BROKER_URL,
      hasGptToken: Boolean(extensionSettings?.spacexcard_api_token_encrypted),
      hasExtensionToken: Boolean(extensionSettings?.extension_token_sha256),
      boundInstallationId: extensionSettings?.bound_installation_id || null
    }
  };
}

export function createMembershipFulfillmentService(options) {
  const {
    app,
    db,
    decryptText,
    encryptText,
    requireAdmin,
    createAuditLog,
    extensionDelivery
  } = options;
  const extensionCommandRateLimits = new Map();
  const extensionEventRateLimits = new Map();

  function getSettings() {
    return db.prepare("SELECT * FROM membership_fulfillment_settings WHERE id = 'default'").get();
  }

  function getExtensionSettings() {
    return db.prepare("SELECT * FROM extension_delivery_settings WHERE id = 'default'").get();
  }

  function listCardProductPolicies(nowMs = Date.now()) {
    const cards = db.prepare(`
      SELECT id, product_code, upstream_status, reconciliation_state
      FROM managed_cards ORDER BY product_code, id
    `).all();
    const policies = db.prepare("SELECT * FROM card_product_policies ORDER BY product_code").all();
    const priceStatement = db.prepare(`
      SELECT tier, found, amount, provider_time
      FROM card_price_signals WHERE card_id = ? ORDER BY tier
    `);
    const byCode = new Map();
    for (const card of cards) {
      const item = byCode.get(card.product_code) || {
        productCode: card.product_code,
        existingCardCount: 0,
        readyCardCount: 0,
        provenTiers: { plus: false, x5: false, x20: false }
      };
      item.existingCardCount += 1;
      if (card.upstream_status === "ACTIVE" && card.reconciliation_state === "READY") {
        item.readyCardCount += 1;
        const signals = priceStatement.all(card.id).map((price) => ({
          tier: price.tier,
          found: price.found === 1,
          amount: price.amount,
          time: price.provider_time
        }));
        for (const tier of membershipTiers) {
          try {
            calculateMembershipBudget(signals, tier, { nowMs });
            item.provenTiers[tier] = true;
          } catch {}
        }
      }
      byCode.set(card.product_code, item);
    }
    for (const policy of policies) {
      const item = byCode.get(policy.product_code) || {
        productCode: policy.product_code,
        existingCardCount: 0,
        readyCardCount: 0,
        provenTiers: { plus: false, x5: false, x20: false }
      };
      item.enabled = policy.enabled === 1;
      item.revision = policy.revision;
      item.updatedAt = policy.updated_at;
      item.updatedBy = policy.updated_by;
      byCode.set(policy.product_code, item);
    }
    return [...byCode.values()]
      .map((item) => ({
        ...item,
        enabled: item.enabled === true,
        revision: item.revision || 0,
        updatedAt: item.updatedAt || null,
        updatedBy: item.updatedBy || null,
        canEnable: Object.values(item.provenTiers).some(Boolean)
      }))
      .sort((left, right) => left.productCode.localeCompare(right.productCode));
  }

  function safeFulfillmentId(value) {
    const id = String(value || "").trim();
    return /^[A-Za-z0-9_-]{1,128}$/.test(id) ? id : null;
  }

  function authenticateExtension(request, reply, store, limit) {
    setNoStore(reply);
    if (!extensionDelivery?.authenticateRequest) {
      reply.code(503).send({ code: "EXTENSION_DELIVERY_DISABLED", message: "扩展交付服务未配置" });
      return null;
    }
    const auth = extensionDelivery.authenticateRequest(request, reply);
    if (!auth) return null;
    if (!auth.settings.enabled) {
      reply.code(503).send({ code: "EXTENSION_DELIVERY_DISABLED", message: "扩展交付未启用" });
      return null;
    }
    const key = `${auth.requestHash}:${auth.installationId}`;
    if (!consumeExtensionRateLimit(store, key, limit)) {
      reply.header("Retry-After", "60");
      reply.code(429).send({
        code: "EXTENSION_RATE_LIMITED",
        message: "扩展请求过于频繁",
        retryable: true,
        retryScope: "global"
      });
      return null;
    }
    return auth;
  }

  function loadFulfillment(id) {
    return db.prepare(`
      SELECT f.*, o.site_id, o.product_id, o.session_payload
      FROM membership_fulfillments f
      JOIN redeem_orders o ON o.id = f.order_id
      WHERE f.id = ?
    `).get(id);
  }

  function serializeFulfillment(row) {
    return {
      id: row.id,
      orderNo: row.order_no,
      targetTier: row.target_tier,
      state: row.state,
      currentStage: row.current_stage || null,
      runMode: row.run_mode || null,
      resumeRevision: row.resume_revision,
      stateRevision: row.state_revision,
      retryAt: row.retry_at || null,
      failureCode: row.failure_code || null,
      browserLeaseEpoch: row.browser_lease_epoch ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      completedAt: row.completed_at || null
    };
  }

  function waitCommand(fulfillment, extra = {}) {
    return {
      command: "WAIT",
      fulfillmentId: fulfillment.id,
      revision: fulfillment.state_revision,
      state: fulfillment.state,
      targetTier: fulfillment.target_tier,
      ...extra
    };
  }

  function currentPlusAttempt(fulfillmentId) {
    return db.prepare(`
      SELECT * FROM membership_fulfillment_attempts
      WHERE fulfillment_id = ? AND stage = 'plus'
      ORDER BY attempt_no DESC LIMIT 1
    `).get(fulfillmentId);
  }

  function currentStageAttempt(fulfillmentId, stageKey) {
    return db.prepare(`
      SELECT * FROM membership_fulfillment_attempts
      WHERE fulfillment_id = ? AND stage = ? AND ended_at IS NULL
      ORDER BY attempt_no DESC LIMIT 1
    `).get(fulfillmentId, stageKey);
  }

  function loadPaymentStage(fulfillmentId, stageKey) {
    return db.prepare(`
      SELECT * FROM membership_payment_stages
      WHERE fulfillment_id = ? AND stage_key = ?
    `).get(fulfillmentId, stageKey);
  }

  function currentPaymentLease(fulfillment, installationId) {
    const lease = db.prepare("SELECT * FROM browser_fulfillment_lease WHERE id = 'default'").get();
    return lease?.state === "leased" && lease.fulfillment_id === fulfillment.id
      && lease.installation_id === installationId
      && lease.epoch === fulfillment.browser_lease_epoch
      ? lease
      : null;
  }

  function paymentGateAllows(fulfillment) {
    if (fulfillment.money_boundary_at) return true;
    const settings = getSettings();
    if (settings.enabled !== 1 || !["canary", "automatic"].includes(settings.rollout_mode)) return false;
    if (fulfillment.run_mode === "canary") return true;
    return fulfillment.run_mode === "automatic" && settings.rollout_mode === "automatic";
  }

  function checkoutRouteSnapshot(fulfillment) {
    const run = db.prepare(`
      SELECT sanitized_result FROM checkout_validation_runs
      WHERE order_id = ? AND status = 'passed'
      ORDER BY completed_at DESC LIMIT 1
    `).get(fulfillment.order_id);
    try {
      const result = JSON.parse(run?.sanitized_result || "null");
      const origin = result?.origin;
      const route = result?.routeTemplate;
      const allowed = (origin === "https://chatgpt.com" && ["/checkout", "/checkout/{id}"].includes(route))
        || (origin === "https://pay.openai.com" && ["/checkout/{id}", "/pay/{id}"].includes(route));
      return allowed ? { origin, route } : null;
    } catch {
      return null;
    }
  }

  function serializePriceContractForExtension(contract) {
    return {
      version: contract.version,
      currency: "PHP",
      minAmount: contract.min_amount,
      maxAmount: contract.max_amount
    };
  }

  function paymentBinding(fulfillment, stage, attempt, lease) {
    return {
      fulfillmentId: fulfillment.id,
      stage: stage.stage_key,
      targetTier: fulfillment.target_tier,
      attempt: attempt.attempt_no,
      leaseEpoch: lease.epoch,
      adapterVersion: attempt.adapter_version
    };
  }

  function approvalCommand(fulfillment, stage, attempt, lease) {
    if (!stage.page_fingerprint || !stage.page_permit_kind || !stage.page_control_id) {
      return waitCommand(fulfillment, { reason: "STAGE_PAGE_SNAPSHOT_MISSING" });
    }
    const authorization = db.prepare(`
      SELECT id, state FROM live_canary_authorizations
      WHERE fulfillment_id = ? AND stage_key = ?
        AND state IN ('approved', 'consumed')
      ORDER BY approved_at DESC LIMIT 1
    `).get(fulfillment.id, stage.stage_key);
    const ready = Boolean(authorization);
    return {
      command: ready ? "CONTINUE_STAGE" : "AWAIT_APPROVAL",
      ...paymentBinding(fulfillment, stage, attempt, lease),
      priceContractVersion: Number(attempt.price_contract_version),
      pageFingerprint: stage.page_fingerprint,
      permitKind: stage.page_permit_kind,
      controlId: stage.page_control_id,
      approvalReady: ready,
      retainContext: true
    };
  }

  function createStageMaterialCommand(fulfillment, stage, attempt, lease) {
    if (!paymentGateAllows(fulfillment)) return waitCommand(fulfillment, { reason: "MEMBERSHIP_PAYMENT_GATE_LOCKED" });
    const contract = db.prepare(`
      SELECT * FROM checkout_price_contracts
      WHERE id = ? AND version = ? AND currency = 'PHP'
    `).get(stage.price_contract_id, attempt.price_contract_version);
    const route = checkoutRouteSnapshot(fulfillment);
    if (!contract || !route) return waitCommand(fulfillment, { reason: "CHECKOUT_PRICE_CONTRACT_MISSING" });
    const now = new Date().toISOString();
    const pendingGrant = db.prepare(`
      SELECT id, claimed_at, expires_at FROM membership_material_grants
      WHERE fulfillment_id = ? AND stage_key = ? AND attempt_no = ?
        AND invalidated_at IS NULL
      ORDER BY created_at DESC LIMIT 1
    `).get(fulfillment.id, stage.stage_key, attempt.attempt_no);
    if (pendingGrant && pendingGrant.expires_at > now) {
      return waitCommand(fulfillment, {
        reason: pendingGrant.claimed_at ? "MATERIAL_GRANT_CLAIMED" : "MATERIAL_GRANT_ALREADY_ISSUED"
      });
    }
    if (pendingGrant) {
      db.prepare("UPDATE membership_material_grants SET invalidated_at = ? WHERE id = ? AND invalidated_at IS NULL")
        .run(now, pendingGrant.id);
    }
    const grant = createMembershipMaterialGrant(db, {
      fulfillmentId: fulfillment.id,
      stageKey: stage.stage_key,
      attemptNo: attempt.attempt_no,
      installationId: lease.installation_id,
      leaseEpoch: lease.epoch,
      adapterVersion: attempt.adapter_version,
      nowMs: Date.parse(now)
    });
    return {
      command: "CLAIM_STAGE_MATERIAL",
      ...paymentBinding(fulfillment, stage, attempt, lease),
      country: "PH",
      expectedOrigin: route.origin,
      expectedRoute: route.route,
      priceContract: serializePriceContractForExtension(contract),
      grantId: grant.grantId,
      grantNonce: grant.nonce
    };
  }

  function prepareUpgradeStage(fulfillment) {
    if (fulfillment.state !== "PLUS_CONFIRMED" || !["x5", "x20"].includes(fulfillment.target_tier)) {
      return fulfillment;
    }
    const at = new Date().toISOString();
    return db.transaction(() => {
      const current = db.prepare("SELECT * FROM membership_fulfillments WHERE id = ?").get(fulfillment.id);
      if (current?.state !== "PLUS_CONFIRMED") return current;
      const stage = loadPaymentStage(current.id, "upgrade");
      const contract = stage?.price_contract_id
        ? db.prepare("SELECT version, status, tier, currency FROM checkout_price_contracts WHERE id = ?")
            .get(stage.price_contract_id)
        : null;
      if (!stage || stage.state !== "checkout_pending" || !stage.card_id
        || contract?.status !== "active" || contract.tier !== current.target_tier || contract.currency !== "PHP") {
        return transitionMembershipFulfillment(db, current.id, "UPGRADE_CHECKOUT_UNAVAILABLE", {
          currentStage: "upgrade",
          failureCode: "UPGRADE_STAGE_SNAPSHOT_MISSING",
          at
        });
      }
      const attemptNo = db.prepare(`
        SELECT COALESCE(MAX(attempt_no), 0) + 1 AS attempt_no
        FROM membership_fulfillment_attempts
        WHERE fulfillment_id = ? AND stage = 'upgrade'
      `).get(current.id).attempt_no;
      db.prepare(`
        UPDATE membership_fulfillment_attempts
        SET ended_at = COALESCE(ended_at, ?), outcome_code = COALESCE(outcome_code, 'PLUS_CONFIRMED')
        WHERE fulfillment_id = ? AND stage = 'plus' AND ended_at IS NULL
      `).run(at, current.id);
      db.prepare(`
        INSERT INTO membership_fulfillment_attempts (
          id, fulfillment_id, stage, attempt_no, resume_revision, adapter_version,
          price_contract_version, started_at
        ) VALUES (?, ?, 'upgrade', ?, ?, ?, ?, ?)
      `).run(
        `mfa_${randomUUID()}`,
        current.id,
        attemptNo,
        current.resume_revision,
        membershipPaymentAdapters.planManagement,
        contract.version,
        at
      );
      db.prepare(`
        UPDATE membership_payment_stages
        SET state = 'preflight_ready', attempt_no = ?, adapter_version = ?,
            adapter_path = 'plan-management-v1+checkout-v1', page_fingerprint = NULL,
            page_permit_kind = NULL, page_control_id = NULL, page_ready_at = NULL,
            page_facts_json = NULL, updated_at = ?
        WHERE id = ? AND state = 'checkout_pending'
      `).run(attemptNo, membershipPaymentAdapters.planManagement, at, stage.id);
      db.prepare(`
        UPDATE membership_fulfillments
        SET state = 'UPGRADE_CHECKOUT_PREFLIGHT', current_stage = 'upgrade',
            state_revision = state_revision + 1, failure_code = NULL, retry_at = NULL,
            updated_at = ? WHERE id = ? AND state = 'PLUS_CONFIRMED'
      `).run(at, current.id);
      return db.prepare("SELECT * FROM membership_fulfillments WHERE id = ?").get(current.id);
    })();
  }

  function paymentCommand(fulfillment, installationId) {
    fulfillment = prepareUpgradeStage(fulfillment);
    if (![
      "PLUS_CHECKOUT_READY", "PLUS_APPROVAL_WAIT", "PLUS_SUBMIT_PERMITTED",
      "PLUS_RECONCILING", "UPGRADE_CHECKOUT_PREFLIGHT", "UPGRADE_CHECKOUT_READY",
      "UPGRADE_APPROVAL_WAIT", "UPGRADE_SUBMIT_PERMITTED", "UPGRADE_RECONCILING",
      "PAYMENT_ACTION_REQUIRED", "PAYMENT_OUTCOME_UNCERTAIN", "UNEXPECTED_PREAUTH",
      "FINAL_TIER_CONFIRMED", "RENEWAL_CANCELLING", "COMPLETED", "PAYMENT_DECLINED",
      "PARTIALLY_FULFILLED", "PARTIAL_FULFILLMENT_EXPIRED",
      "ACTION_REQUIRED_CONTEXT_LOST", "CHECKOUT_UI_UNSUPPORTED"
    ].includes(fulfillment.state)) return null;
    const lease = currentPaymentLease(fulfillment, installationId);
    if (!lease) return waitCommand(fulfillment, { reason: "BROWSER_LEASE_MISMATCH" });
    const stateStage = fulfillment.state.startsWith("UPGRADE_") || fulfillment.current_stage === "upgrade"
      ? "upgrade"
      : "plus";
    const stage = loadPaymentStage(fulfillment.id, stateStage);
    const attempt = currentStageAttempt(fulfillment.id, stateStage);
    if (!stage || !attempt || stage.attempt_no !== attempt.attempt_no
      || stage.adapter_version !== attempt.adapter_version) {
      return waitCommand(fulfillment, { reason: "MEMBERSHIP_STAGE_BINDING_MISMATCH" });
    }
    if (["PLUS_CHECKOUT_READY", "UPGRADE_CHECKOUT_READY"].includes(fulfillment.state)) {
      return createStageMaterialCommand(fulfillment, stage, attempt, lease);
    }
    if (["PLUS_APPROVAL_WAIT", "UPGRADE_APPROVAL_WAIT"].includes(fulfillment.state)) {
      return approvalCommand(fulfillment, stage, attempt, lease);
    }
    if (fulfillment.state === "UPGRADE_CHECKOUT_PREFLIGHT") {
      const contract = db.prepare(`
        SELECT * FROM checkout_price_contracts
        WHERE id = ? AND version = ? AND tier = ? AND currency = 'PHP' AND status = 'active'
      `).get(stage.price_contract_id, attempt.price_contract_version, fulfillment.target_tier);
      if (!contract || attempt.adapter_version !== membershipPaymentAdapters.planManagement) {
        return waitCommand(fulfillment, { reason: "UPGRADE_PRICE_CONTRACT_MISSING" });
      }
      return {
        command: "PREFLIGHT_UPGRADE",
        ...paymentBinding(fulfillment, stage, attempt, lease),
        country: "PH",
        expectedOrigin: "https://chatgpt.com",
        expectedRoute: "/settings/subscription",
        pageUrl: PLAN_MANAGEMENT_URL,
        priceContract: serializePriceContractForExtension(contract)
      };
    }
    if (fulfillment.state === "PAYMENT_ACTION_REQUIRED") {
      return {
        command: "RECONCILE_ONLY",
        ...paymentBinding(fulfillment, stage, attempt, lease),
        retainContext: true,
        requiresLocalAcknowledgement: true
      };
    }
    if ([
      "PLUS_SUBMIT_PERMITTED", "PLUS_RECONCILING", "UPGRADE_SUBMIT_PERMITTED",
      "UPGRADE_RECONCILING", "PAYMENT_OUTCOME_UNCERTAIN", "UNEXPECTED_PREAUTH",
      "FINAL_TIER_CONFIRMED", "RENEWAL_CANCELLING"
    ].includes(fulfillment.state)) {
      return {
        command: "RECONCILE_ONLY",
        ...paymentBinding(fulfillment, stage, attempt, lease),
        retainContext: fulfillment.state === "PAYMENT_OUTCOME_UNCERTAIN"
      };
    }
    if ([
      "COMPLETED", "PAYMENT_DECLINED", "PARTIALLY_FULFILLED",
      "PARTIAL_FULFILLMENT_EXPIRED", "ACTION_REQUIRED_CONTEXT_LOST", "CHECKOUT_UI_UNSUPPORTED"
    ].includes(fulfillment.state)) {
      return { command: "SANITIZE_AND_RELEASE", ...paymentBinding(fulfillment, stage, attempt, lease) };
    }
    return null;
  }

  function dispatchMembershipOutbox() {
    if (!extensionDelivery?.publishMembershipNotification) return 0;
    const rows = db.prepare(`
      SELECT * FROM membership_outbox
      WHERE dispatched_at IS NULL AND event_type IN ('membership.available', 'membership.resume')
      ORDER BY created_at ASC LIMIT 50
    `).all();
    let sent = 0;
    for (const row of rows) {
      const message = row.event_type === "membership.available"
        ? {
            type: "membership.available",
            fulfillmentId: row.fulfillment_id,
            revision: row.state_revision,
            createdAt: row.created_at
          }
        : { type: "membership.resume", resumeRevision: row.state_revision || 0 };
      if (!extensionDelivery.publishMembershipNotification(message)) break;
      db.prepare("UPDATE membership_outbox SET dispatched_at = ? WHERE id = ? AND dispatched_at IS NULL")
        .run(new Date().toISOString(), row.id);
      sent += 1;
    }
    return sent;
  }

  app.get("/api/extension/membership-fulfillments/next", async (request, reply) => {
    const auth = authenticateExtension(request, reply, extensionCommandRateLimits, 60);
    if (!auth) return;
    expireBrowserFulfillmentLease(db);
    const leased = db.prepare(`
      SELECT f.id, f.state_revision
      FROM browser_fulfillment_lease l
      JOIN membership_fulfillments f ON f.id = l.fulfillment_id
      WHERE l.id = 'default' AND l.state = 'leased' AND l.installation_id = ?
    `).get(auth.installationId);
    const next = leased || db.prepare(`
      SELECT id, state_revision
      FROM membership_fulfillments
      WHERE state = 'BROWSER_LEASE_WAIT'
      ORDER BY created_at ASC LIMIT 1
    `).get();
    return { item: next ? { fulfillmentId: next.id, revision: next.state_revision } : null };
  });

  app.get("/api/extension/membership-fulfillments/:id/command", async (request, reply) => {
    const auth = authenticateExtension(request, reply, extensionCommandRateLimits, 60);
    if (!auth) return;
    const id = safeFulfillmentId(request.params?.id);
    if (!id) return reply.code(404).send({ code: "MEMBERSHIP_FULFILLMENT_NOT_FOUND" });
    expireBrowserFulfillmentLease(db);
    let fulfillment = loadFulfillment(id);
    if (!fulfillment) return reply.code(404).send({ code: "MEMBERSHIP_FULFILLMENT_NOT_FOUND" });

    const activeContract = db.prepare(`
      SELECT * FROM checkout_price_contracts
      WHERE tier = 'plus' AND currency = 'PHP' AND status = 'active'
      LIMIT 1
    `).get();
    if (fulfillment.state === "BROWSER_LEASE_WAIT") {
      const resumeStageKey = fulfillment.current_stage === "upgrade" ? "upgrade" : "plus";
      const fundedStage = loadPaymentStage(id, resumeStageKey);
      const fundedCheckout = ["checkout_pending", "preflight_pending"].includes(fundedStage?.state)
        && ["canary", "automatic"].includes(fulfillment.run_mode);
      if (!fundedCheckout && !activeContract) {
        return waitCommand(fulfillment, { reason: "CHECKOUT_PRICE_CONTRACT_MISSING" });
      }
      if (fundedCheckout && !paymentGateAllows(fulfillment)) {
        return waitCommand(fulfillment, { reason: "MEMBERSHIP_PAYMENT_GATE_LOCKED" });
      }
      const acquired = fundedCheckout
        ? acquirePaymentBrowserFulfillmentLease(db, {
            fulfillmentId: id,
            installationId: auth.installationId,
            adapterVersion: membershipCheckoutAdapterVersion
          })
        : acquireBrowserFulfillmentLease(db, {
            fulfillmentId: id,
            installationId: auth.installationId,
            adapterVersion: membershipCheckoutAdapterVersion,
            priceContractVersion: activeContract.version
          });
      if (!acquired.acquired) return waitCommand(fulfillment, {
        reason: acquired.reason === "busy" ? "BROWSER_LEASE_BUSY" : "STATE_NOT_READY",
        retryAt: acquired.retryAt || null
      });
      fulfillment = loadFulfillment(id);
    }
    const stagedPaymentCommand = paymentCommand(fulfillment, auth.installationId);
    if (stagedPaymentCommand) return stagedPaymentCommand;
    if (fulfillment.state !== "INITIAL_CHECKOUT_PREFLIGHT") return waitCommand(fulfillment);

    const lease = db.prepare("SELECT * FROM browser_fulfillment_lease WHERE id = 'default'").get();
    if (lease.state !== "leased" || lease.fulfillment_id !== id
      || lease.installation_id !== auth.installationId
      || lease.epoch !== fulfillment.browser_lease_epoch) {
      return waitCommand(fulfillment, { reason: "BROWSER_LEASE_MISMATCH" });
    }
    const attempt = currentPlusAttempt(id);
    const contract = db.prepare(`
      SELECT * FROM checkout_price_contracts
      WHERE tier = 'plus' AND version = ? AND currency = 'PHP'
    `).get(attempt?.price_contract_version);
    if (!attempt || !contract) return waitCommand(fulfillment, { reason: "CHECKOUT_PRICE_CONTRACT_MISSING" });

    let checkout;
    try {
      const settings = getExtensionSettings();
      const session = JSON.parse(decryptText(fulfillment.session_payload));
      const token = decryptText(settings.spacexcard_api_token_encrypted);
      checkout = await createSpaceXCardCheckout(session, token);
    } catch (error) {
      releaseBrowserFulfillmentLease(db, {
        fulfillmentId: id,
        installationId: auth.installationId,
        epoch: lease.epoch,
        outcome: "wait"
      });
      transitionMembershipFulfillment(db, id, "CHECKOUT_PRE_SUBMIT_FAILED", {
        currentStage: "plus",
        failureCode: typeof error?.code === "string" ? error.code : "CHECKOUT_BROKER_UNAVAILABLE",
        retryAt: new Date(Date.now() + 5 * 60_000).toISOString()
      });
      return reply.code(error?.statusCode || 502).send({
        code: typeof error?.code === "string" ? error.code : "CHECKOUT_BROKER_UNAVAILABLE",
        message: "Checkout 页面暂时无法创建",
        retryable: true,
        retryScope: "global"
      });
    }

    return {
      command: "PREFLIGHT_INITIAL_CHECKOUT",
      fulfillmentId: id,
      revision: fulfillment.state_revision,
      stage: "plus",
      targetTier: fulfillment.target_tier,
      adapterVersion: attempt.adapter_version,
      attempt: attempt.attempt_no,
      leaseEpoch: lease.epoch,
      checkoutUrl: checkout.checkoutUrl,
      expectedOrigin: new URL(checkout.checkoutUrl).origin,
      expectedRoute: "checkout",
      priceContract: {
        version: contract.version,
        currency: "PHP",
        minAmount: contract.min_amount,
        maxAmount: contract.max_amount
      }
    };
  });

  const diagnosticSchema = z.object({
    leaseEpoch: z.number().int().nonnegative(),
    adapterVersion: z.literal(membershipCheckoutAdapterVersion),
    stateId: z.enum(["INITIAL_CHECKOUT_RECOGNIZED", "UNKNOWN_CHECKOUT_STATE"]),
    origin: z.enum(["https://chatgpt.com", "https://pay.openai.com"]).nullable(),
    originRecognized: z.boolean(),
    routeTemplate: z.enum(["/checkout/{id}", "/checkout", "/pay/{id}"]).nullable(),
    plan: z.literal("plus").nullable(),
    currency: z.literal("PHP").nullable(),
    displayedAmount: z.number().finite().positive().max(10_000_000).nullable(),
    expectedElements: z.object({
      cardNumber: z.boolean(),
      expiry: z.boolean(),
      cvc: z.boolean(),
      billingName: z.boolean(),
      billingCountry: z.boolean(),
      billingPostal: z.boolean(),
      finalControl: z.boolean()
    }).strict(),
    structuralHash: z.string().regex(/^[a-f0-9]{64}$/),
    cardMaterialRequested: z.literal(false),
    controlActivated: z.literal(false)
  }).strict();

  app.post("/api/extension/membership-fulfillments/:id/diagnostic", {
    bodyLimit: EXTENSION_BODY_LIMIT
  }, async (request, reply) => {
    const auth = authenticateExtension(request, reply, extensionEventRateLimits, 120);
    if (!auth) return;
    const id = safeFulfillmentId(request.params?.id);
    const parsed = diagnosticSchema.safeParse(request.body);
    if (!id || !parsed.success) {
      return reply.code(400).send({
        code: "MEMBERSHIP_DIAGNOSTIC_INVALID",
        message: "诊断仅接受严格脱敏的白名单事实"
      });
    }
    const fulfillment = loadFulfillment(id);
    const lease = db.prepare("SELECT * FROM browser_fulfillment_lease WHERE id = 'default'").get();
    if (!fulfillment || fulfillment.state !== "INITIAL_CHECKOUT_PREFLIGHT"
      || lease.state !== "leased" || lease.fulfillment_id !== id
      || lease.installation_id !== auth.installationId || lease.epoch !== parsed.data.leaseEpoch) {
      return reply.code(409).send({ code: "BROWSER_LEASE_MISMATCH" });
    }
    const attempt = currentPlusAttempt(id);
    if (!attempt || attempt.adapter_version !== parsed.data.adapterVersion) {
      return reply.code(409).send({ code: "MEMBERSHIP_ATTEMPT_MISMATCH" });
    }
    const contract = db.prepare(`
      SELECT * FROM checkout_price_contracts
      WHERE tier = 'plus' AND version = ? AND currency = 'PHP'
    `).get(attempt.price_contract_version);
    if (!contract) return reply.code(409).send({ code: "CHECKOUT_PRICE_CONTRACT_MISSING" });

    const facts = parsed.data;
    const requiredFields = [
      facts.expectedElements.cardNumber,
      facts.expectedElements.expiry,
      facts.expectedElements.cvc,
      facts.expectedElements.billingName,
      facts.expectedElements.billingCountry,
      facts.expectedElements.billingPostal
    ].every(Boolean);
    const failedChecks = [];
    if (facts.stateId !== "INITIAL_CHECKOUT_RECOGNIZED") failedChecks.push("STATE_UNRECOGNIZED");
    if (!facts.originRecognized || facts.origin === null) failedChecks.push("ORIGIN_UNRECOGNIZED");
    if (facts.routeTemplate === null) failedChecks.push("ROUTE_UNRECOGNIZED");
    if (facts.plan !== "plus") failedChecks.push("PLAN_UNRECOGNIZED");
    if (facts.currency !== "PHP") failedChecks.push("CURRENCY_UNRECOGNIZED");
    if (!requiredFields) failedChecks.push("REQUIRED_FIELDS_UNRECOGNIZED");
    if (!facts.expectedElements.finalControl) failedChecks.push("ALLOWED_CONTROL_UNRECOGNIZED");
    if (facts.displayedAmount === null
      || facts.displayedAmount < contract.min_amount || facts.displayedAmount > contract.max_amount) {
      failedChecks.push("PRICE_OUT_OF_RANGE");
    }
    const status = failedChecks.length ? "failed" : "passed";
    const sanitized = {
      stateId: facts.stateId,
      origin: facts.origin,
      originRecognized: facts.originRecognized,
      routeTemplate: facts.routeTemplate,
      plan: facts.plan,
      currency: facts.currency,
      displayedAmount: facts.displayedAmount,
      expectedElements: facts.expectedElements,
      structuralHash: facts.structuralHash,
      cardMaterialRequested: false,
      controlActivated: false,
      failedChecks
    };
    const serialized = JSON.stringify(sanitized);
    const existing = db.prepare(`
      SELECT * FROM checkout_validation_runs
      WHERE order_id = ? AND adapter_version = ? AND started_at >= ?
      ORDER BY started_at DESC LIMIT 1
    `).get(fulfillment.order_id, attempt.adapter_version, attempt.started_at);
    let run = existing;
    if (!run) {
      const at = new Date().toISOString();
      const runId = `cvr_${randomUUID()}`;
      db.transaction(() => {
        db.prepare(`
          INSERT INTO checkout_validation_runs (
            id, order_id, site_id, product_id, tier, adapter_version,
            price_contract_id, status, sanitized_result, started_at, completed_at, created_by
          ) VALUES (?, ?, ?, ?, 'plus', ?, ?, ?, ?, ?, ?, 'extension')
        `).run(
          runId,
          fulfillment.order_id,
          fulfillment.site_id,
          fulfillment.product_id,
          attempt.adapter_version,
          contract.id,
          status,
          serialized,
          attempt.started_at,
          at
        );
        db.prepare(`
          UPDATE membership_fulfillment_attempts
          SET sanitized_diagnostic = ?
          WHERE id = ? AND sanitized_diagnostic IS NULL
        `).run(serialized, attempt.id);
      })();
      run = db.prepare("SELECT * FROM checkout_validation_runs WHERE id = ?").get(runId);
    } else if (run.sanitized_result !== serialized) {
      return reply.code(409).send({ code: "MEMBERSHIP_DIAGNOSTIC_CONFLICT" });
    }
    return { accepted: true, status: run.status, runId: run.id };
  });

  const stageBindingSchema = {
    stage: z.enum(["plus", "upgrade"]),
    targetTier: z.enum(membershipTiers),
    attempt: z.number().int().positive(),
    leaseEpoch: z.number().int().positive(),
    adapterVersion: z.enum([membershipPaymentAdapters.checkout, membershipPaymentAdapters.planManagement])
  };
  const fingerprintSchema = z.string().regex(/^[a-f0-9]{64}$/);
  const permitKindSchema = z.enum(["progression", "submit"]);
  const controlIdSchema = z.enum([
    "payment-next", "hosted-payment-next", "payment-submit", "hosted-payment-submit",
    "upgrade-x5", "upgrade-x20"
  ]);
  const safeFailureCodeSchema = z.string().regex(/^[A-Z][A-Z0-9_]{0,79}$/);
  const extensionEventSchema = z.discriminatedUnion("type", [
    z.object({
      type: z.literal("LEASE_HEARTBEAT"),
      leaseEpoch: z.number().int().nonnegative(),
      stage: z.enum(["plus", "upgrade"]).optional(),
      targetTier: z.enum(membershipTiers).optional(),
      attempt: z.number().int().positive().optional(),
      adapterVersion: z.enum([membershipPaymentAdapters.checkout, membershipPaymentAdapters.planManagement]).optional()
    }).strict(),
    z.object({
      type: z.literal("PREFLIGHT_FINISHED"),
      leaseEpoch: z.number().int().nonnegative(),
      adapterVersion: z.literal(membershipCheckoutAdapterVersion),
      outcome: z.enum(["recognized", "unsupported"]),
      sanitized: z.literal(true)
    }).strict(),
    z.object({
      type: z.literal("STAGE_PAGE_READY"), ...stageBindingSchema,
      permitKind: permitKindSchema,
      controlId: controlIdSchema,
      pageFingerprint: fingerprintSchema,
      page: z.unknown()
    }).strict(),
    z.object({
      type: z.literal("STAGE_PAGE_CHANGED_WHILE_AWAITING_APPROVAL"), ...stageBindingSchema,
      permitKind: permitKindSchema,
      controlId: controlIdSchema,
      previousPageFingerprint: fingerprintSchema,
      page: z.unknown()
    }).strict(),
    z.object({ type: z.literal("CHECKOUT_UI_UNSUPPORTED"), ...stageBindingSchema, page: z.unknown() }).strict(),
    z.object({ type: z.literal("MATERIAL_CLAIM_OUTCOME_UNCERTAIN"), ...stageBindingSchema }).strict(),
    z.object({
      type: z.literal("CHECKOUT_PRE_SUBMIT_FAILED"), ...stageBindingSchema,
      failureCode: safeFailureCodeSchema
    }).strict(),
    z.object({
      type: z.literal("PROGRESSION_ACTIVATED"), ...stageBindingSchema,
      permitId: z.string().regex(/^[A-Za-z0-9._:-]{1,200}$/),
      controlId: controlIdSchema,
      previousPageFingerprint: fingerprintSchema,
      page: z.unknown()
    }).strict(),
    z.object({ type: z.literal("UPGRADE_PREFLIGHT_FINISHED"), ...stageBindingSchema, page: z.unknown() }).strict(),
    z.object({
      type: z.literal("SUBMIT_ACTIVATED"), ...stageBindingSchema,
      permitId: z.string().regex(/^[A-Za-z0-9._:-]{1,200}$/),
      controlId: controlIdSchema,
      pageFingerprint: fingerprintSchema
    }).strict(),
    z.object({ type: z.literal("POST_SUBMIT_STATE"), ...stageBindingSchema, page: z.unknown() }).strict(),
    z.object({
      type: z.literal("PERMIT_OUTCOME_UNCERTAIN"), ...stageBindingSchema,
      permitKind: permitKindSchema,
      controlId: controlIdSchema.optional(),
      pageFingerprint: fingerprintSchema.optional()
    }).strict(),
    z.object({
      type: z.literal("PAYMENT_OUTCOME_UNCERTAIN"), ...stageBindingSchema,
      permitKind: permitKindSchema.optional()
    }).strict(),
    z.object({
      type: z.literal("PAYMENT_ACTION_REQUIRED"), ...stageBindingSchema,
      challengeId: z.enum(["challenge-3ds", "challenge-captcha", "challenge-sms", "challenge-bank"]),
      pageFingerprint: fingerprintSchema
    }).strict(),
    z.object({ type: z.literal("ACTION_ACK_CLICK_BLOCKED"), ...stageBindingSchema }).strict(),
    z.object({ type: z.literal("ACTION_REQUIRED_CONTEXT_LOST"), ...stageBindingSchema }).strict(),
    z.object({ type: z.literal("PAYMENT_CONTEXT_TIMEOUT"), ...stageBindingSchema }).strict(),
    z.object({ type: z.literal("CONTEXT_SANITIZED"), ...stageBindingSchema, sanitized: z.literal(true) }).strict()
  ]);

  function loadPaymentEventContext(id, body, installationId) {
    const fulfillment = loadFulfillment(id);
    const stage = fulfillment ? loadPaymentStage(id, body.stage) : null;
    const attempt = fulfillment ? currentStageAttempt(id, body.stage) : null;
    const lease = fulfillment ? currentPaymentLease(fulfillment, installationId) : null;
    if (!fulfillment || !stage || !attempt || !lease
      || fulfillment.target_tier !== body.targetTier
      || attempt.attempt_no !== body.attempt || stage.attempt_no !== body.attempt
      || attempt.adapter_version !== body.adapterVersion || stage.adapter_version !== body.adapterVersion) {
      return null;
    }
    const contract = db.prepare(`
      SELECT * FROM checkout_price_contracts
      WHERE id = ? AND version = ? AND currency = 'PHP' AND status = 'active'
    `).get(stage.price_contract_id, attempt.price_contract_version);
    return contract ? { fulfillment, stage, attempt, lease, contract } : null;
  }

  function stageDecision(context, page, permitKind, controlId, proceed, awaitApproval) {
    return {
      ...paymentBinding(context.fulfillment, context.stage, context.attempt, context.lease),
      priceContractVersion: context.contract.version,
      pageFingerprint: page.structuralHash,
      permitKind,
      controlId,
      proceed,
      awaitApproval
    };
  }

  function createOpenApiClient() {
    const settings = getSettings();
    if (!settings?.spacexcard_app_secret_encrypted) {
      const error = new Error("SpaceX Card OpenAPI 未配置");
      error.code = "SPACEXCARD_OPENAPI_NOT_CONFIGURED";
      throw error;
    }
    return new SpaceXCardOpenApiClient({
      appId: settings.spacexcard_app_id,
      appSecret: decryptText(settings.spacexcard_app_secret_encrypted)
    });
  }

  async function loadAllCardTransactions(upstreamCardId) {
    const client = createOpenApiClient();
    const all = [];
    for (let page = 1; page <= PAYMENT_TRANSACTION_MAX_PAGES; page += 1) {
      const rows = await client.listTransactions(upstreamCardId, {
        page,
        pageSize: PAYMENT_TRANSACTION_PAGE_SIZE
      });
      all.push(...rows);
      if (rows.length < PAYMENT_TRANSACTION_PAGE_SIZE) return all;
    }
    const error = new Error("交易记录分页超过安全上限");
    error.code = "CARD_TRANSACTION_PAGINATION_EXCEEDED";
    throw error;
  }

  function addIntervention(fulfillmentId, state, reasonCode, at = new Date().toISOString()) {
    const fulfillment = db.prepare("SELECT state_revision FROM membership_fulfillments WHERE id = ?").get(fulfillmentId);
    if (!fulfillment) return;
    db.prepare(`
      INSERT OR IGNORE INTO fulfillment_interventions (
        id, fulfillment_id, state, state_revision, reason_code, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(`fi_${randomUUID()}`, fulfillmentId, state, fulfillment.state_revision, reasonCode, at);
  }

  function latestActionPermit(context, actionType = null) {
    return actionType
      ? db.prepare(`
          SELECT * FROM membership_action_permits
          WHERE fulfillment_id = ? AND stage_key = ? AND attempt_no = ? AND action_type = ?
          ORDER BY sequence_no DESC LIMIT 1
        `).get(context.fulfillment.id, context.stage.stage_key, context.attempt.attempt_no, actionType)
      : db.prepare(`
          SELECT * FROM membership_action_permits
          WHERE fulfillment_id = ? AND stage_key = ? AND attempt_no = ?
          ORDER BY issued_at DESC LIMIT 1
        `).get(context.fulfillment.id, context.stage.stage_key, context.attempt.attempt_no);
  }

  function markEventUncertain(context, auth, input, reasonCode) {
    const permit = input.permitId
      ? db.prepare("SELECT * FROM membership_action_permits WHERE id = ?").get(input.permitId)
      : latestActionPermit(context, input.permitKind || null);
    if (permit) {
      return markMembershipActionOutcomeUncertain(db, {
        permitId: permit.id,
        fulfillmentId: context.fulfillment.id,
        stageKey: context.stage.stage_key,
        attemptNo: context.attempt.attempt_no,
        actionType: permit.action_type,
        installationId: auth.installationId,
        leaseEpoch: context.lease.epoch,
        reasonCode
      });
    }
    const updated = transitionMembershipFulfillment(db, context.fulfillment.id, "PAYMENT_OUTCOME_UNCERTAIN", {
      currentStage: context.stage.stage_key,
      failureCode: reasonCode
    });
    addIntervention(updated.id, updated.state, reasonCode);
    return { state: updated.state, confirmationOnly: true };
  }

  app.post("/api/extension/membership-fulfillments/:id/events", {
    bodyLimit: EXTENSION_BODY_LIMIT
  }, async (request, reply) => {
    const auth = authenticateExtension(request, reply, extensionEventRateLimits, 120);
    if (!auth) return;
    const id = safeFulfillmentId(request.params?.id);
    const parsed = extensionEventSchema.safeParse(request.body);
    if (!id || !parsed.success) return reply.code(400).send({ code: "MEMBERSHIP_EVENT_INVALID" });
    if (parsed.data.type === "LEASE_HEARTBEAT") {
      const lease = heartbeatBrowserFulfillmentLease(db, {
        fulfillmentId: id,
        installationId: auth.installationId,
        epoch: parsed.data.leaseEpoch
      });
      return lease
        ? { accepted: true, leaseEpoch: lease.epoch, expiresAt: lease.expires_at }
        : reply.code(409).send({ code: "BROWSER_LEASE_MISMATCH" });
    }

    if (parsed.data.type === "PREFLIGHT_FINISHED") {
      const fulfillment = loadFulfillment(id);
      const attempt = currentPlusAttempt(id);
      if (!fulfillment || !attempt || attempt.adapter_version !== parsed.data.adapterVersion
        || !attempt.sanitized_diagnostic) {
        return reply.code(409).send({ code: "MEMBERSHIP_DIAGNOSTIC_REQUIRED" });
      }
      const validation = db.prepare(`
        SELECT status FROM checkout_validation_runs
        WHERE order_id = ? AND adapter_version = ? AND started_at >= ?
        ORDER BY started_at DESC LIMIT 1
      `).get(fulfillment.order_id, attempt.adapter_version, attempt.started_at);
      if (!validation || (parsed.data.outcome === "recognized" && validation.status !== "passed")) {
        return reply.code(409).send({ code: "MEMBERSHIP_PREFLIGHT_NOT_RECOGNIZED" });
      }
      const released = releaseBrowserFulfillmentLease(db, {
        fulfillmentId: id,
        installationId: auth.installationId,
        epoch: parsed.data.leaseEpoch,
        outcome: parsed.data.outcome
      });
      if (!released) return reply.code(409).send({ code: "BROWSER_LEASE_MISMATCH" });
      return {
        accepted: true,
        state: released.fulfillment.state,
        paymentGateLocked: true
      };
    }

    const context = loadPaymentEventContext(id, parsed.data, auth.installationId);
    if (!context) return reply.code(409).send({ code: "MEMBERSHIP_STAGE_BINDING_MISMATCH" });
    const body = parsed.data;
    const page = Object.hasOwn(body, "page")
      ? validateSanitizedMembershipPageShape(body.page)
      : null;

    if (body.type === "STAGE_PAGE_READY") {
      if (!paymentGateAllows(context.fulfillment)) {
        return reply.code(409).send({ code: "MEMBERSHIP_PAYMENT_GATE_LOCKED" });
      }
      if (context.contract.status !== "active") {
        return reply.code(409).send({ code: "CHECKOUT_PRICE_CONTRACT_INACTIVE" });
      }
      const expectedReadyState = body.stage === "plus" ? "PLUS_CHECKOUT_READY" : "UPGRADE_CHECKOUT_READY";
      const expectedApprovalState = body.stage === "plus" ? "PLUS_APPROVAL_WAIT" : "UPGRADE_APPROVAL_WAIT";
      const expectedStageState = body.adapterVersion === membershipPaymentAdapters.planManagement
        ? "preflight_ready"
        : "checkout_ready";
      if (context.stage.state !== expectedStageState) {
        return reply.code(409).send({ code: "MEMBERSHIP_STAGE_NOT_READY" });
      }
      if (body.adapterVersion === membershipPaymentAdapters.planManagement) {
        if (context.fulfillment.state !== "UPGRADE_CHECKOUT_PREFLIGHT") {
          return reply.code(409).send({ code: "MEMBERSHIP_STAGE_NOT_READY" });
        }
      } else {
        if (![expectedReadyState, expectedApprovalState].includes(context.fulfillment.state)) {
          return reply.code(409).send({ code: "MEMBERSHIP_STAGE_NOT_READY" });
        }
        const claimedMaterial = db.prepare(`
          SELECT id FROM membership_material_grants
          WHERE fulfillment_id = ? AND stage_key = ? AND attempt_no = ?
            AND claimed_at IS NOT NULL AND invalidated_at IS NULL
          ORDER BY claimed_at DESC LIMIT 1
        `).get(id, body.stage, body.attempt);
        if (!claimedMaterial) return reply.code(409).send({ code: "MATERIAL_CLAIM_REQUIRED" });
      }
      const validated = validateMembershipPaymentPage(page, {
        stage: body.stage,
        targetTier: body.targetTier,
        adapterVersion: body.adapterVersion,
        priceContract: {
          currency: "PHP",
          minAmount: context.contract.min_amount,
          maxAmount: context.contract.max_amount
        }
      });
      if (validated.structuralHash !== body.pageFingerprint) {
        return reply.code(409).send({ code: "MEMBERSHIP_PAGE_FINGERPRINT_MISMATCH" });
      }
      validateMembershipStageControl(validated, body.permitKind, body.controlId);
      const safeJson = JSON.stringify(validated);
      const at = new Date().toISOString();
      db.transaction(() => {
        db.prepare(`
          UPDATE membership_payment_stages
          SET page_fingerprint = ?, page_permit_kind = ?, page_control_id = ?,
              page_ready_at = ?, page_facts_json = ?,
              updated_at = ? WHERE id = ?
        `).run(
          validated.structuralHash,
          body.permitKind,
          body.controlId,
          at,
          safeJson,
          at,
          context.stage.id
        );
        db.prepare(`
          UPDATE membership_fulfillment_attempts SET sanitized_diagnostic = ? WHERE id = ?
        `).run(safeJson, context.attempt.id);
        if (context.fulfillment.run_mode === "canary"
          && body.adapterVersion === membershipPaymentAdapters.checkout) {
          const nextState = body.stage === "plus" ? "PLUS_APPROVAL_WAIT" : "UPGRADE_APPROVAL_WAIT";
          db.prepare(`
            UPDATE membership_fulfillments
            SET state = ?, state_revision = state_revision + 1, updated_at = ?
            WHERE id = ? AND state = ?
          `).run(nextState, at, context.fulfillment.id, expectedReadyState);
        }
      })();
      const preflightOnly = body.adapterVersion === membershipPaymentAdapters.planManagement;
      const automatic = context.fulfillment.run_mode === "automatic";
      return stageDecision(context, validated, body.permitKind, body.controlId,
        preflightOnly || automatic, !(preflightOnly || automatic));
    }

    if (body.type === "STAGE_PAGE_CHANGED_WHILE_AWAITING_APPROVAL") {
      if (context.stage.page_fingerprint !== body.previousPageFingerprint) {
        return reply.code(409).send({ code: "MEMBERSHIP_PAGE_SNAPSHOT_MISMATCH" });
      }
      db.prepare(`
        UPDATE live_canary_authorizations
        SET state = 'invalidated', invalidated_at = ?
        WHERE fulfillment_id = ? AND stage_key = ? AND state = 'approved'
      `).run(new Date().toISOString(), id, body.stage);
      const updated = transitionMembershipFulfillment(db, id, "CHECKOUT_PRE_SUBMIT_FAILED", {
        currentStage: body.stage,
        failureCode: "STAGE_PAGE_CHANGED_WHILE_AWAITING_APPROVAL",
        retryAt: new Date(Date.now() + 5 * 60_000).toISOString()
      });
      return { accepted: true, state: updated.state };
    }

    if (body.type === "PROGRESSION_ACTIVATED") {
      if (context.stage.page_fingerprint !== body.previousPageFingerprint
        || context.stage.page_control_id !== body.controlId) {
        return reply.code(409).send({ code: "MEMBERSHIP_PAGE_SNAPSHOT_MISMATCH" });
      }
      reportMembershipActionActivation(db, {
        permitId: body.permitId,
        fulfillmentId: id,
        installationId: auth.installationId,
        leaseEpoch: body.leaseEpoch
      });
      try {
        const card = db.prepare("SELECT upstream_card_id FROM managed_cards WHERE id = ?").get(context.stage.card_id);
        if (!card) throw new Error("MANAGED_CARD_NOT_FOUND");
        const transactions = await loadAllCardTransactions(card.upstream_card_id);
        persistManagedCardTransactions(db, context.stage.card_id, transactions);
        const result = evaluateProgressionAuthorizationDelta(db, {
          permitId: body.permitId,
          currentAuthIds: transactions.map((item) => item.authId)
        });
        return result;
      } catch (error) {
        markEventUncertain(context, auth, body, "PERMIT_ACTIVATION_UNCERTAIN");
        return reply.code(502).send({ code: error?.code || "PROGRESSION_RECONCILIATION_FAILED" });
      }
    }

    if (body.type === "UPGRADE_PREFLIGHT_FINISHED") {
      if (body.stage !== "upgrade" || body.adapterVersion !== membershipPaymentAdapters.planManagement) {
        return reply.code(409).send({ code: "UPGRADE_PREFLIGHT_BINDING_MISMATCH" });
      }
      const clearProgression = db.prepare(`
        SELECT id FROM membership_action_permits
        WHERE fulfillment_id = ? AND stage_key = 'upgrade' AND attempt_no = ?
          AND action_type = 'progression' AND installation_id = ?
          AND browser_lease_epoch = ? AND adapter_version = ?
          AND price_contract_id = ? AND control_id = ? AND page_fingerprint = ?
          AND state = 'reported' AND outcome_code = 'AUTHORIZATION_CLEAR'
          AND activated_at IS NOT NULL AND reported_at IS NOT NULL
        ORDER BY sequence_no DESC LIMIT 1
      `).get(
        id,
        body.attempt,
        auth.installationId,
        body.leaseEpoch,
        membershipPaymentAdapters.planManagement,
        context.stage.price_contract_id,
        context.stage.page_control_id,
        context.stage.page_fingerprint
      );
      if (context.fulfillment.state !== "UPGRADE_CHECKOUT_PREFLIGHT"
        || context.stage.state !== "checkout_ready" || !clearProgression) {
        return reply.code(409).send({ code: "UPGRADE_PREFLIGHT_AUTHORIZATION_CLEAR_REQUIRED" });
      }
      const at = new Date().toISOString();
      db.transaction(() => {
        db.prepare(`
          UPDATE membership_payment_stages
          SET state = 'checkout_ready', adapter_version = ?, page_fingerprint = NULL,
              page_permit_kind = NULL, page_control_id = NULL, page_ready_at = NULL,
              page_facts_json = NULL, updated_at = ? WHERE id = ?
        `).run(membershipPaymentAdapters.checkout, at, context.stage.id);
        db.prepare(`
          UPDATE membership_fulfillment_attempts
          SET adapter_version = ?, sanitized_diagnostic = NULL WHERE id = ?
        `).run(membershipPaymentAdapters.checkout, context.attempt.id);
        db.prepare(`
          UPDATE membership_fulfillments
          SET state = 'UPGRADE_CHECKOUT_READY', state_revision = state_revision + 1,
              updated_at = ? WHERE id = ?
        `).run(at, id);
      })();
      return { accepted: true, state: "UPGRADE_CHECKOUT_READY" };
    }

    if (body.type === "SUBMIT_ACTIVATED") {
      if (context.stage.page_fingerprint !== body.pageFingerprint
        || context.stage.page_control_id !== body.controlId) {
        return reply.code(409).send({ code: "MEMBERSHIP_PAGE_SNAPSHOT_MISMATCH" });
      }
      const permit = reportMembershipActionActivation(db, {
        permitId: body.permitId,
        fulfillmentId: id,
        installationId: auth.installationId,
        leaseEpoch: body.leaseEpoch
      });
      return { accepted: true, state: permit.state };
    }

    if (body.type === "PAYMENT_ACTION_REQUIRED") {
      const updated = transitionMembershipFulfillment(db, id, "PAYMENT_ACTION_REQUIRED", {
        currentStage: body.stage,
        failureCode: "PAYMENT_ACTION_REQUIRED"
      });
      addIntervention(id, updated.state, "PAYMENT_ACTION_REQUIRED");
      return { accepted: true, confirmationOnly: true, state: updated.state };
    }

    if (body.type === "ACTION_REQUIRED_CONTEXT_LOST") {
      const updated = transitionMembershipFulfillment(db, id, "ACTION_REQUIRED_CONTEXT_LOST", {
        currentStage: body.stage,
        failureCode: "ACTION_REQUIRED_CONTEXT_LOST"
      });
      addIntervention(id, updated.state, "ACTION_REQUIRED_CONTEXT_LOST");
      return { accepted: true, confirmationOnly: true, state: updated.state };
    }

    if (["PERMIT_OUTCOME_UNCERTAIN", "PAYMENT_OUTCOME_UNCERTAIN", "PAYMENT_CONTEXT_TIMEOUT"].includes(body.type)) {
      const result = markEventUncertain(
        context,
        auth,
        body,
        body.type === "PAYMENT_CONTEXT_TIMEOUT" ? "PAYMENT_CONTEXT_LOST" : "PERMIT_OUTCOME_UNCERTAIN"
      );
      return { accepted: true, state: result.state || "PAYMENT_OUTCOME_UNCERTAIN", confirmationOnly: true };
    }

    if (body.type === "MATERIAL_CLAIM_OUTCOME_UNCERTAIN") {
      db.prepare(`
        UPDATE membership_material_grants SET invalidated_at = COALESCE(invalidated_at, ?)
        WHERE fulfillment_id = ? AND stage_key = ? AND attempt_no = ?
      `).run(new Date().toISOString(), id, body.stage, body.attempt);
      const updated = transitionMembershipFulfillment(db, id, "CHECKOUT_PRE_SUBMIT_FAILED", {
        currentStage: body.stage,
        failureCode: "MATERIAL_CLAIM_OUTCOME_UNCERTAIN",
        retryAt: new Date(Date.now() + 5 * 60_000).toISOString()
      });
      addIntervention(id, updated.state, "MATERIAL_CLAIM_OUTCOME_UNCERTAIN");
      return { accepted: true, state: updated.state };
    }

    if (body.type === "CHECKOUT_PRE_SUBMIT_FAILED") {
      const permit = latestActionPermit(context);
      if (permit && ["issued", "activated", "reported", "outcome_uncertain"].includes(permit.state)) {
        const result = markEventUncertain(context, auth, { ...body, permitId: permit.id }, "PERMIT_ACTIVATION_UNCERTAIN");
        return { accepted: true, state: result.state || "PAYMENT_OUTCOME_UNCERTAIN" };
      }
      const updated = transitionMembershipFulfillment(db, id, "CHECKOUT_PRE_SUBMIT_FAILED", {
        currentStage: body.stage,
        failureCode: body.failureCode,
        retryAt: new Date(Date.now() + 5 * 60_000).toISOString()
      });
      return { accepted: true, state: updated.state };
    }

    if (body.type === "CHECKOUT_UI_UNSUPPORTED") {
      const updated = transitionMembershipFulfillment(db, id, "CHECKOUT_UI_UNSUPPORTED", {
        currentStage: body.stage,
        failureCode: "CHECKOUT_UI_UNSUPPORTED"
      });
      return { accepted: true, state: updated.state };
    }

    if (body.type === "POST_SUBMIT_STATE") {
      db.prepare(`
        UPDATE membership_fulfillment_attempts SET sanitized_diagnostic = ? WHERE id = ?
      `).run(JSON.stringify(page), context.attempt.id);
      return { accepted: true, confirmationOnly: true };
    }

    if (body.type === "CONTEXT_SANITIZED") {
      const retryPreSubmit = context.fulfillment.state === "CHECKOUT_PRE_SUBMIT_FAILED";
      const released = sanitizeAndReleaseBrowserFulfillmentLease(db, {
        fulfillmentId: id,
        installationId: auth.installationId,
        epoch: body.leaseEpoch
      });
      if (!released) return reply.code(409).send({ code: "BROWSER_LEASE_MISMATCH" });
      if (retryPreSubmit) {
        const at = new Date().toISOString();
        const attempts = db.prepare(`
          SELECT COUNT(*) AS count FROM membership_fulfillment_attempts
          WHERE fulfillment_id = ? AND stage = ?
            AND (ended_at IS NULL OR outcome_code = 'CHECKOUT_PRE_SUBMIT_FAILED')
        `).get(id, body.stage).count;
        db.transaction(() => {
          db.prepare(`
            UPDATE membership_fulfillment_attempts
            SET ended_at = COALESCE(ended_at, ?),
                outcome_code = COALESCE(outcome_code, 'CHECKOUT_PRE_SUBMIT_FAILED')
            WHERE id = ?
          `).run(at, context.attempt.id);
          db.prepare(`
            UPDATE live_canary_authorizations
            SET state = 'invalidated', invalidated_at = ?
            WHERE fulfillment_id = ? AND stage_key = ? AND state = 'approved'
          `).run(at, id, body.stage);
          if (Number(attempts) < 3) {
            const pendingState = body.adapterVersion === membershipPaymentAdapters.planManagement
              ? "preflight_pending"
              : "checkout_pending";
            db.prepare(`
              UPDATE membership_payment_stages
              SET state = ?, attempt_no = NULL, page_fingerprint = NULL,
                  page_permit_kind = NULL, page_control_id = NULL, page_ready_at = NULL,
                  page_facts_json = NULL, updated_at = ? WHERE id = ?
            `).run(pendingState, at, context.stage.id);
          }
        })();
        const next = Number(attempts) < 3
          ? transitionMembershipFulfillment(db, id, "BROWSER_LEASE_WAIT", {
              currentStage: body.stage,
              failureCode: "CHECKOUT_PRE_SUBMIT_RETRY",
              at,
              notify: true
            })
          : transitionMembershipFulfillment(db, id, "CHECKOUT_UI_UNSUPPORTED", {
              currentStage: body.stage,
              failureCode: "CHECKOUT_PRE_SUBMIT_ATTEMPTS_EXHAUSTED",
              at
            });
        if (Number(attempts) >= 3) addIntervention(id, next.state, "CHECKOUT_PRE_SUBMIT_ATTEMPTS_EXHAUSTED", at);
        return { accepted: true, released: true, state: next.state };
      }
      return { accepted: true, released: true, state: released.fulfillment.state };
    }

    if (body.type === "ACTION_ACK_CLICK_BLOCKED") {
      return { accepted: true, confirmationOnly: true };
    }
    return reply.code(400).send({ code: "MEMBERSHIP_EVENT_INVALID" });
  });

  app.get("/api/admin/membership-fulfillments", { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = z.object({
      state: z.string().trim().max(64).optional(),
      limit: z.coerce.number().int().min(1).max(200).optional().default(100)
    }).safeParse(request.query || {});
    if (!parsed.success || (parsed.data.state && !membershipFulfillmentStates.includes(parsed.data.state))) {
      return reply.code(400).send({ message: "会员履约筛选参数无效" });
    }
    const rows = parsed.data.state
      ? db.prepare("SELECT * FROM membership_fulfillments WHERE state = ? ORDER BY created_at DESC LIMIT ?")
          .all(parsed.data.state, parsed.data.limit)
      : db.prepare("SELECT * FROM membership_fulfillments ORDER BY created_at DESC LIMIT ?").all(parsed.data.limit);
    setNoStore(reply);
    return { items: rows.map(serializeFulfillment) };
  });

  app.post("/api/admin/membership-fulfillments/backfill", { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = z.object({
      orderNo: z.string().trim().min(1).max(128)
    }).safeParse(request.body || {});
    if (!parsed.success) return reply.code(400).send({ message: "订单号无效" });

    try {
      const result = db.transaction(() => {
        const order = db.prepare(`
          SELECT o.*, c.manual_type AS cdkey_manual_type, c.metadata AS cdkey_metadata
          FROM redeem_orders o
          LEFT JOIN cdkeys c ON c.id = o.cdkey_id
          WHERE o.order_no = ?
        `).get(parsed.data.orderNo);
        if (!order) return { error: "not_found" };

        const existing = db.prepare("SELECT * FROM membership_fulfillments WHERE order_id = ?").get(order.id);
        if (existing) return { item: existing, created: false };
        if (order.extension_delivery_status !== "succeeded") return { error: "delivery" };

        let metadata = {};
        try {
          metadata = JSON.parse(order.cdkey_metadata || "{}");
        } catch {}
        const manualType = String(order.cdkey_manual_type || metadata.manualType || "").trim();
        const item = createMembershipFulfillmentForOrder(db, {
          orderId: order.id,
          orderNo: order.order_no,
          productId: order.product_id,
          manualType,
          createdAt: order.created_at
        });
        if (!item) return { error: "tier" };
        createAuditLog({
          action: "membership.fulfillment.backfill",
          actor: request.admin.username,
          resourceType: "membership_fulfillment",
          resourceId: item.id,
          detail: { orderNo: parsed.data.orderNo, targetTier: item.target_tier }
        });
        return { item, created: true };
      }).immediate();

      if (result.error === "not_found") return reply.code(404).send({ message: "订单不存在" });
      if (result.error === "delivery") {
        return reply.code(409).send({ message: "该订单的 Cookie 交付尚未成功，不能补建会员履约" });
      }
      if (result.error === "tier") return reply.code(409).send({ message: "该订单没有可识别的会员类型" });
      setNoStore(reply);
      return { item: serializeFulfillment(result.item), created: result.created };
    } catch {
      return reply.code(409).send({ message: "该订单的会员类型无效，未补建履约" });
    }
  });

  app.get("/api/admin/membership-fulfillments/:id", { preHandler: requireAdmin }, async (request, reply) => {
    const id = safeFulfillmentId(request.params?.id);
    const row = id ? db.prepare("SELECT * FROM membership_fulfillments WHERE id = ?").get(id) : null;
    if (!row) return reply.code(404).send({ message: "会员履约不存在" });
    const attempts = db.prepare(`
      SELECT stage, attempt_no, resume_revision, adapter_version, price_contract_version,
             started_at, ended_at, outcome_code
      FROM membership_fulfillment_attempts WHERE fulfillment_id = ?
      ORDER BY started_at ASC
    `).all(id).map((item) => ({
      stage: item.stage,
      attemptNo: item.attempt_no,
      resumeRevision: item.resume_revision,
      adapterVersion: item.adapter_version || null,
      priceContractVersion: item.price_contract_version || null,
      startedAt: item.started_at,
      endedAt: item.ended_at || null,
      outcomeCode: item.outcome_code || null
    }));
    const compensation = db.prepare(`
      SELECT * FROM customer_compensation_resolutions
      WHERE fulfillment_id = ? ORDER BY revision DESC LIMIT 1
    `).get(id);
    setNoStore(reply);
    return { item: serializeFulfillment(row), attempts, customerProjection: projectMembershipDelivery(row, compensation) };
  });

  app.get("/api/admin/membership-fulfillment/settings", { preHandler: requireAdmin }, async (_request, reply) => {
    setNoStore(reply);
    return { settings: serializeSettings(getSettings(), getExtensionSettings()) };
  });

  app.patch("/api/admin/membership-fulfillment/settings", { preHandler: requireAdmin }, async (request, reply) => {
    const schema = z.object({
      enabled: z.boolean().optional(),
      appId: z.string().trim().max(256).nullable().optional(),
      appSecret: z.string().trim().max(8192).optional(),
      clearAppSecret: z.boolean().optional().default(false),
      webhookSecret: z.string().trim().max(8192).optional(),
      clearWebhookSecret: z.boolean().optional().default(false)
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ message: "会员履约设置参数无效" });
    if (parsed.data.enabled === true) {
      return reply.code(409).send({
        code: "MEMBERSHIP_PAYMENT_GATE_LOCKED",
        message: "会员付款能力仍在分阶段实施，当前只能保存凭据，不能启用"
      });
    }

    const current = getSettings();
    const activeInventory = db.prepare(`
      SELECT id FROM card_inventory_runs
      WHERE status IN ('discovering', 'reconciling') LIMIT 1
    `).get();
    const changesOpenApiIdentity = (Object.hasOwn(parsed.data, "appId")
        && (parsed.data.appId || null) !== (current.spacexcard_app_id || null))
      || Boolean(parsed.data.appSecret)
      || parsed.data.clearAppSecret;
    if (activeInventory && changesOpenApiIdentity) {
      return reply.code(409).send({
        code: "INVENTORY_ALREADY_RUNNING",
        message: "库存任务运行中，暂不能更改 OpenAPI 身份"
      });
    }
    const appId = Object.hasOwn(parsed.data, "appId") ? (parsed.data.appId || null) : current.spacexcard_app_id;
    const appSecret = parsed.data.clearAppSecret
      ? null
      : (parsed.data.appSecret ? encryptText(parsed.data.appSecret) : current.spacexcard_app_secret_encrypted);
    const webhookSecret = parsed.data.clearWebhookSecret
      ? null
      : (parsed.data.webhookSecret ? encryptText(parsed.data.webhookSecret) : current.spacexcard_webhook_secret_encrypted);
    const now = new Date().toISOString();

    db.transaction(() => {
      db.prepare(`
        UPDATE membership_fulfillment_settings
        SET enabled = 0,
            rollout_mode = 'disabled',
            spacexcard_app_id = ?,
            spacexcard_app_secret_encrypted = ?,
            spacexcard_webhook_secret_encrypted = ?,
            updated_at = ?,
            updated_by = ?
        WHERE id = 'default'
      `).run(appId, appSecret, webhookSecret, now, request.admin.username);
      createAuditLog({
        action: "membership_fulfillment.settings.update",
        actor: request.admin.username,
        resourceType: "membership_fulfillment_settings",
        resourceId: "default",
        detail: {
          appIdAction: Object.hasOwn(parsed.data, "appId") ? (appId ? "updated" : "cleared") : "unchanged",
          appSecretAction: parsed.data.clearAppSecret ? "cleared" : (parsed.data.appSecret ? "replaced" : "unchanged"),
          webhookSecretAction: parsed.data.clearWebhookSecret ? "cleared" : (parsed.data.webhookSecret ? "replaced" : "unchanged"),
          paymentGate: "locked"
        }
      });
    })();

    setNoStore(reply);
    return { settings: serializeSettings(getSettings(), getExtensionSettings()) };
  });

  function startInventory(request, reply, mode) {
    const settings = getSettings();
    if (mode === "refresh" && settings.inventory_status !== "completed") {
      return reply.code(409).send({
        code: "INVENTORY_NOT_READY",
        message: "首次库存初始化完成前不能执行刷新"
      });
    }
    try {
      const run = startMembershipInventoryRun(db, {
        actor: request.admin.username,
        mode
      });
      createAuditLog({
        action: mode === "refresh" ? "membership_inventory.refresh" : "membership_inventory.initialize",
        actor: request.admin.username,
        resourceType: "card_inventory_run",
        resourceId: run.id,
        detail: { mode }
      });
      setNoStore(reply);
      return { run: serializeMembershipInventoryRun(run) };
    } catch (caught) {
      return reply.code(caught?.statusCode || 409).send({
        code: caught?.code || "INVENTORY_START_FAILED",
        message: caught?.message || "库存任务启动失败"
      });
    }
  }

  app.post("/api/admin/membership-inventory/initialize", { preHandler: requireAdmin }, async (request, reply) => (
    startInventory(request, reply, "full")
  ));

  app.post("/api/admin/membership-inventory/refresh", { preHandler: requireAdmin }, async (request, reply) => (
    startInventory(request, reply, "refresh")
  ));

  app.get("/api/admin/membership-inventory/runs/current", { preHandler: requireAdmin }, async (_request, reply) => {
    const run = db.prepare("SELECT * FROM card_inventory_runs ORDER BY started_at DESC LIMIT 1").get();
    setNoStore(reply);
    return { run: serializeMembershipInventoryRun(run) };
  });

  app.get("/api/admin/membership-cards", { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = z.object({
      lane: z.enum(["plus", "x5", "x20"]).optional(),
      reconciliationState: z.enum(["PENDING", "READY", "HOLD"]).optional(),
      limit: z.coerce.number().int().min(1).max(200).optional().default(100)
    }).safeParse(request.query || {});
    if (!parsed.success) return reply.code(400).send({ message: "卡片筛选参数无效" });
    const conditions = [];
    const params = [];
    if (parsed.data.lane) {
      conditions.push("lane = ?");
      params.push(parsed.data.lane);
    }
    if (parsed.data.reconciliationState) {
      conditions.push("reconciliation_state = ?");
      params.push(parsed.data.reconciliationState);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const cards = db.prepare(`
      SELECT * FROM managed_cards
      ${where}
      ORDER BY updated_at DESC, id ASC
      LIMIT ?
    `).all(...params, parsed.data.limit);
    const priceStatement = db.prepare(`
      SELECT tier, found, amount, min_usd, max_usd, provider_time, fetched_at
      FROM card_price_signals WHERE card_id = ? ORDER BY tier ASC
    `);
    setNoStore(reply);
    return {
      items: cards.map((card) => ({
        id: card.id,
        upstreamCardId: card.upstream_card_id,
        display: `${card.bin || "------"}••••${card.last4 || "----"}`,
        productCode: card.product_code,
        upstreamStatus: card.upstream_status,
        availableAmount: card.cached_available_amount,
        lane: card.lane,
        consumedSlots: card.consumed_slots,
        capacityState: card.capacity_state,
        reconciliationState: card.reconciliation_state,
        reconciliationReason: card.reconciliation_reason || null,
        lastBalanceSyncAt: card.last_balance_sync_at || null,
        lastTransactionSyncAt: card.last_transaction_sync_at || null,
        prices: priceStatement.all(card.id).map((price) => ({
          tier: price.tier,
          found: price.found === 1,
          amount: price.amount,
          minUsd: price.min_usd,
          maxUsd: price.max_usd,
          providerTime: price.provider_time || null,
          fetchedAt: price.fetched_at
        }))
      }))
    };
  });

  app.post("/api/admin/membership-cards/:id/confirm-plus-lane", { preHandler: requireAdmin }, async (request, reply) => {
    const id = safeFulfillmentId(request.params?.id);
    const parsed = z.object({
      confirmation: z.literal("legacy_plus_cdk")
    }).safeParse(request.body);
    if (!id || !parsed.success) return reply.code(400).send({ message: "历史 Plus 卡确认参数无效" });

    const card = db.prepare("SELECT * FROM managed_cards WHERE id = ?").get(id);
    if (!card) return reply.code(404).send({ message: "托管卡片不存在" });
    if (card.lane === "plus" && card.reconciliation_state === "READY" && !card.reconciliation_reason) {
      setNoStore(reply);
      return {
        item: {
          id: card.id,
          upstreamCardId: card.upstream_card_id,
          lane: card.lane,
          consumedSlots: card.consumed_slots,
          capacityState: card.capacity_state,
          reconciliationState: card.reconciliation_state
        }
      };
    }
    if (card.upstream_status !== "ACTIVE" || card.lane
      || card.reconciliation_state !== "HOLD" || card.reconciliation_reason !== "PENDING_SETTLEMENT") {
      return reply.code(409).send({
        code: "CARD_PLUS_LANE_CONFIRMATION_NOT_ALLOWED",
        message: "只有正常、未分配且因等待交易结算暂挂的历史卡可以确认为 Plus"
      });
    }
    const activeInventory = db.prepare(`
      SELECT id FROM card_inventory_runs
      WHERE status IN ('discovering', 'reconciling') LIMIT 1
    `).get();
    if (activeInventory) {
      return reply.code(409).send({ code: "INVENTORY_ALREADY_RUNNING", message: "请等待库存刷新完成后再确认 Plus" });
    }

    const transactions = db.prepare(`
      SELECT * FROM managed_card_transactions
      WHERE card_id = ? ORDER BY auth_time ASC, auth_id ASC
    `).all(card.id).map((row) => ({
      authId: row.auth_id,
      authTime: row.auth_time,
      authAmount: row.auth_amount,
      authCurrency: row.auth_currency,
      settleAmount: row.settle_amount,
      settleCurrency: row.settle_currency,
      type: row.type,
      status: row.status,
      merchantNormalized: row.merchant_normalized
    }));
    const hasPendingOpenAiAuthorization = transactions.some((transaction) => (
      transaction.merchantNormalized === "OPENAI"
        && transaction.type === "Authorization"
        && transaction.status === "PENDING"
    ));
    const classification = classifyHistoricalCardFulfillments(transactions, { knownLane: "plus" });
    if (!hasPendingOpenAiAuthorization || classification.lane !== "plus"
      || classification.state === "RECONCILIATION_HOLD" || classification.consumed < 1) {
      return reply.code(409).send({
        code: "CARD_PLUS_LANE_EVIDENCE_CONFLICT",
        message: "已同步的交易不能安全归类为 Plus，请先刷新库存或人工核对交易"
      });
    }

    const at = new Date().toISOString();
    const updated = db.transaction(() => {
      const result = db.prepare(`
        UPDATE managed_cards
        SET lane = 'plus', consumed_slots = ?, capacity_state = ?,
            reconciliation_state = 'READY', reconciliation_reason = NULL, updated_at = ?
        WHERE id = ? AND lane IS NULL AND reconciliation_state = 'HOLD'
          AND reconciliation_reason = 'PENDING_SETTLEMENT'
      `).run(classification.consumed, classification.state, at, card.id);
      if (result.changes !== 1) return null;
      createAuditLog({
        action: "membership_card.legacy_plus_lane.confirm",
        actor: request.admin.username,
        resourceType: "managed_card",
        resourceId: card.id,
        detail: {
          upstreamCardId: card.upstream_card_id,
          previousReason: card.reconciliation_reason,
          lane: "plus",
          consumedSlots: classification.consumed,
          capacityState: classification.state,
          confirmation: parsed.data.confirmation
        }
      });
      return db.prepare("SELECT * FROM managed_cards WHERE id = ?").get(card.id);
    })();
    if (!updated) {
      return reply.code(409).send({ code: "CARD_STATE_CHANGED", message: "卡片状态已经变化，请刷新列表后重试" });
    }
    setNoStore(reply);
    return {
      item: {
        id: updated.id,
        upstreamCardId: updated.upstream_card_id,
        lane: updated.lane,
        consumedSlots: updated.consumed_slots,
        capacityState: updated.capacity_state,
        reconciliationState: updated.reconciliation_state
      }
    };
  });

  app.get("/api/admin/checkout-price-contracts", { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = z.object({ tier: z.enum(membershipTiers).optional() }).safeParse(request.query || {});
    if (!parsed.success) return reply.code(400).send({ message: "价格契约筛选参数无效" });
    const rows = parsed.data.tier
      ? db.prepare("SELECT * FROM checkout_price_contracts WHERE tier = ? ORDER BY version DESC").all(parsed.data.tier)
      : db.prepare("SELECT * FROM checkout_price_contracts ORDER BY tier, version DESC").all();
    setNoStore(reply);
    return { items: rows.map(serializePriceContract) };
  });

  app.post("/api/admin/checkout-price-contracts", { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = z.object({
      tier: z.enum(membershipTiers),
      minAmount: z.number().finite().positive().max(10_000_000),
      maxAmount: z.number().finite().positive().max(10_000_000)
    }).safeParse(request.body);
    if (!parsed.success || parsed.data.maxAmount < parsed.data.minAmount) {
      return reply.code(400).send({ message: "PHP 价格契约参数无效" });
    }
    const at = new Date().toISOString();
    const row = db.transaction(() => {
      const version = db.prepare(`
        SELECT COALESCE(MAX(version), 0) + 1 AS version
        FROM checkout_price_contracts WHERE tier = ?
      `).get(parsed.data.tier).version;
      const id = `cpc_${randomUUID()}`;
      db.prepare(`
        INSERT INTO checkout_price_contracts (
          id, tier, version, currency, min_amount, max_amount, status, created_at, created_by
        ) VALUES (?, ?, ?, 'PHP', ?, ?, 'draft', ?, ?)
      `).run(
        id,
        parsed.data.tier,
        version,
        parsed.data.minAmount,
        parsed.data.maxAmount,
        at,
        request.admin.username
      );
      createAuditLog({
        action: "checkout_price_contract.create",
        actor: request.admin.username,
        resourceType: "checkout_price_contract",
        resourceId: id,
        detail: {
          tier: parsed.data.tier,
          version,
          currency: "PHP",
          minAmount: parsed.data.minAmount,
          maxAmount: parsed.data.maxAmount
        }
      });
      return db.prepare("SELECT * FROM checkout_price_contracts WHERE id = ?").get(id);
    })();
    setNoStore(reply);
    return reply.code(201).send({ item: serializePriceContract(row) });
  });

  app.post("/api/admin/checkout-price-contracts/:id/activate", { preHandler: requireAdmin }, async (request, reply) => {
    const id = String(request.params?.id || "").trim();
    const current = db.prepare("SELECT * FROM checkout_price_contracts WHERE id = ?").get(id);
    if (!current) return reply.code(404).send({ message: "价格契约不存在" });
    if (current.status === "active") {
      setNoStore(reply);
      return { item: serializePriceContract(current) };
    }
    if (current.status !== "draft") {
      return reply.code(409).send({ code: "PRICE_CONTRACT_NOT_DRAFT", message: "只有草稿价格契约可以激活" });
    }
    const at = new Date().toISOString();
    const activated = db.transaction(() => {
      db.prepare(`
        UPDATE checkout_price_contracts
        SET status = 'retired'
        WHERE tier = ? AND status = 'active'
      `).run(current.tier);
      db.prepare(`
        UPDATE checkout_price_contracts
        SET status = 'active', activated_at = ?
        WHERE id = ? AND status = 'draft'
      `).run(at, current.id);
      db.prepare(`
        UPDATE automatic_checkout_scopes
        SET status = 'paused'
        WHERE tier = ? AND status = 'active' AND price_contract_id <> ?
      `).run(current.tier, current.id);
      createAuditLog({
        action: "checkout_price_contract.activate",
        actor: request.admin.username,
        resourceType: "checkout_price_contract",
        resourceId: current.id,
        detail: { tier: current.tier, version: current.version, matchingScopes: "paused" }
      });
      return db.prepare("SELECT * FROM checkout_price_contracts WHERE id = ?").get(current.id);
    })();
    setNoStore(reply);
    return { item: serializePriceContract(activated) };
  });

  app.get("/api/admin/card-product-policies", { preHandler: requireAdmin }, async (_request, reply) => {
    setNoStore(reply);
    return { items: listCardProductPolicies() };
  });

  app.put("/api/admin/card-product-policies", { preHandler: requireAdmin }, async (request, reply) => {
    const schema = z.object({
      items: z.array(z.object({
        productCode: z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/),
        enabled: z.boolean()
      })).min(1).max(100)
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success || new Set(parsed.data?.items.map((item) => item.productCode)).size !== parsed.data?.items.length) {
      return reply.code(400).send({ message: "允许卡产品参数无效" });
    }
    const currentItems = new Map(listCardProductPolicies().map((item) => [item.productCode, item]));
    for (const item of parsed.data.items) {
      const current = currentItems.get(item.productCode);
      if (!current) return reply.code(404).send({ code: "CARD_PRODUCT_NOT_DISCOVERED", message: "卡产品尚未在库存中发现" });
      if (item.enabled && !current.canEnable) {
        return reply.code(409).send({ code: "CARD_PRODUCT_NOT_PROVEN", message: "卡产品没有可用的最新 OpenAI 行情证据" });
      }
    }
    const at = new Date().toISOString();
    const changed = [];
    db.transaction(() => {
      for (const item of parsed.data.items) {
        const existing = db.prepare("SELECT * FROM card_product_policies WHERE product_code = ?").get(item.productCode);
        if (existing && (existing.enabled === 1) === item.enabled) continue;
        const revision = Number(existing?.revision || 0) + 1;
        db.prepare(`
          INSERT INTO card_product_policies (product_code, enabled, revision, updated_at, updated_by)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(product_code) DO UPDATE SET
            enabled = excluded.enabled,
            revision = excluded.revision,
            updated_at = excluded.updated_at,
            updated_by = excluded.updated_by
        `).run(item.productCode, item.enabled ? 1 : 0, revision, at, request.admin.username);
        changed.push({ productCode: item.productCode, enabled: item.enabled, revision });
      }
      if (changed.length) {
        createAuditLog({
          action: "card_product_policies.update",
          actor: request.admin.username,
          resourceType: "card_product_policies",
          resourceId: "catalog",
          detail: { changed }
        });
      }
    })();
    setNoStore(reply);
    return { items: listCardProductPolicies() };
  });

  app.get("/api/admin/fulfillment-circuits", { preHandler: requireAdmin }, async (_request, reply) => {
    const rows = db.prepare(`
      SELECT * FROM fulfillment_dependency_circuits
      ORDER BY CASE state WHEN 'open' THEN 0 WHEN 'half_open' THEN 1 ELSE 2 END,
        updated_at DESC
    `).all();
    setNoStore(reply);
    return { items: rows.map(serializeDependencyCircuit) };
  });

  app.post("/api/admin/fulfillment-circuits/:id/probe", { preHandler: requireAdmin }, async (request, reply) => {
    const id = String(request.params?.id || "").trim();
    const result = requestDependencyProbe(db, id);
    if (result.outcome === "not_found") return reply.code(404).send({ message: "依赖熔断记录不存在" });
    if (result.outcome === "already_probing") {
      return reply.code(409).send({ code: "CIRCUIT_PROBE_ALREADY_RUNNING", message: "半开探测已在进行" });
    }
    if (result.outcome === "scheduled") {
      createAuditLog({
        action: "fulfillment_circuit.probe.request",
        actor: request.admin.username,
        resourceType: "fulfillment_dependency_circuit",
        resourceId: id,
        detail: {
          dependency: result.circuit.dependency,
          scopeKey: result.circuit.scopeKey,
          recoveryRevision: result.circuit.recoveryRevision
        }
      });
    }
    setNoStore(reply);
    return result;
  });

  app.get("/api/admin/checkout-validation-runs", { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = z.object({
      tier: z.enum(membershipTiers).optional(),
      status: z.enum(["passed", "failed"]).optional(),
      limit: z.coerce.number().int().min(1).max(200).optional().default(100)
    }).safeParse(request.query || {});
    if (!parsed.success) return reply.code(400).send({ message: "无扣款验证筛选参数无效" });
    const conditions = [];
    const params = [];
    if (parsed.data.tier) {
      conditions.push("tier = ?");
      params.push(parsed.data.tier);
    }
    if (parsed.data.status) {
      conditions.push("status = ?");
      params.push(parsed.data.status);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const rows = db.prepare(`
      SELECT * FROM checkout_validation_runs ${where}
      ORDER BY started_at DESC LIMIT ?
    `).all(...params, parsed.data.limit);
    setNoStore(reply);
    return { items: rows.map(serializeCheckoutValidationRun) };
  });

  app.post("/api/admin/checkout-validation-runs", { preHandler: requireAdmin }, async (request, reply) => {
    const factsSchema = z.object({
      originRecognized: z.boolean(),
      routeRecognized: z.boolean(),
      planRecognized: z.boolean(),
      currency: z.literal("PHP"),
      displayedAmount: z.number().finite().positive().max(10_000_000),
      requiredFieldsRecognized: z.boolean(),
      allowedControlRecognized: z.boolean(),
      cardMaterialRequested: z.literal(false),
      progressionActivated: z.literal(false),
      finalSubmitActivated: z.literal(false)
    }).strict();
    const schema = z.object({
      siteId: z.string().trim().min(1).max(128),
      productId: z.string().trim().min(1).max(128),
      tier: z.enum(membershipTiers),
      adapterVersion: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9._:-]+$/),
      priceContractId: z.string().trim().min(1).max(128),
      facts: factsSchema
    }).strict();
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        code: "NO_CHARGE_VALIDATION_INVALID",
        message: "无扣款验证只接受脱敏白名单事实，且不得取卡或激活任何控件"
      });
    }
    const site = db.prepare("SELECT id, status, product_id FROM sites WHERE id = ?").get(parsed.data.siteId);
    if (!site || site.status !== "active") return reply.code(404).send({ message: "验证站点不存在或未启用" });
    const product = db.prepare("SELECT id, status, membership_tier FROM products WHERE id = ?").get(parsed.data.productId);
    if (!product || product.status !== "active") return reply.code(404).send({ message: "验证商品不存在或未启用" });
    if (product.membership_tier !== parsed.data.tier || (site.product_id && site.product_id !== product.id)) {
      return reply.code(409).send({ code: "NO_CHARGE_SCOPE_MISMATCH", message: "站点、商品与会员类型不匹配" });
    }
    const contract = db.prepare("SELECT * FROM checkout_price_contracts WHERE id = ?").get(parsed.data.priceContractId);
    if (!contract || contract.status !== "active" || contract.tier !== parsed.data.tier || contract.currency !== "PHP") {
      return reply.code(409).send({ code: "NO_CHARGE_PRICE_CONTRACT_INVALID", message: "缺少匹配的有效 PHP 价格契约" });
    }

    const facts = parsed.data.facts;
    const failedChecks = [];
    if (!facts.originRecognized) failedChecks.push("ORIGIN_UNRECOGNIZED");
    if (!facts.routeRecognized) failedChecks.push("ROUTE_UNRECOGNIZED");
    if (!facts.planRecognized) failedChecks.push("PLAN_UNRECOGNIZED");
    if (!facts.requiredFieldsRecognized) failedChecks.push("REQUIRED_FIELDS_UNRECOGNIZED");
    if (!facts.allowedControlRecognized) failedChecks.push("ALLOWED_CONTROL_UNRECOGNIZED");
    if (facts.displayedAmount < contract.min_amount || facts.displayedAmount > contract.max_amount) {
      failedChecks.push("PRICE_OUT_OF_RANGE");
    }
    const status = failedChecks.length ? "failed" : "passed";
    const at = new Date().toISOString();
    const id = `cvr_${randomUUID()}`;
    const sanitizedResult = {
      originRecognized: facts.originRecognized,
      routeRecognized: facts.routeRecognized,
      planRecognized: facts.planRecognized,
      currency: "PHP",
      displayedAmount: facts.displayedAmount,
      requiredFieldsRecognized: facts.requiredFieldsRecognized,
      allowedControlRecognized: facts.allowedControlRecognized,
      cardMaterialRequested: false,
      progressionActivated: false,
      finalSubmitActivated: false,
      failedChecks
    };
    db.transaction(() => {
      db.prepare(`
        INSERT INTO checkout_validation_runs (
          id, order_id, site_id, product_id, tier, adapter_version,
          price_contract_id, status, sanitized_result, started_at, completed_at, created_by
        ) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        parsed.data.siteId,
        parsed.data.productId,
        parsed.data.tier,
        parsed.data.adapterVersion,
        parsed.data.priceContractId,
        status,
        JSON.stringify(sanitizedResult),
        at,
        at,
        request.admin.username
      );
      createAuditLog({
        action: "checkout_validation_run.record",
        actor: request.admin.username,
        resourceType: "checkout_validation_run",
        resourceId: id,
        detail: {
          siteId: parsed.data.siteId,
          productId: parsed.data.productId,
          tier: parsed.data.tier,
          adapterVersion: parsed.data.adapterVersion,
          priceContractId: parsed.data.priceContractId,
          status,
          failedChecks
        }
      });
    })();
    setNoStore(reply);
    const row = db.prepare("SELECT * FROM checkout_validation_runs WHERE id = ?").get(id);
    return reply.code(201).send({ item: serializeCheckoutValidationRun(row) });
  });

  app.post("/api/webhooks/spacexcard/card-transactions", {
    bodyLimit: WEBHOOK_BODY_LIMIT,
    preParsing: captureRawBody,
    errorHandler(error, _request, reply) {
      if (error?.code === "FST_ERR_CTP_BODY_TOO_LARGE" || error?.statusCode === 413) {
        return reply.code(413).send({ code: "SPACEXCARD_WEBHOOK_TOO_LARGE" });
      }
      if (error?.code === "FST_ERR_CTP_INVALID_MEDIA_TYPE" || error?.statusCode === 415) {
        return reply.code(415).send({ code: "SPACEXCARD_WEBHOOK_CONTENT_TYPE_INVALID" });
      }
      if (error?.statusCode === 400) {
        return reply.code(400).send({ code: "SPACEXCARD_WEBHOOK_INVALID" });
      }
      return reply.code(500).send({ code: "SPACEXCARD_WEBHOOK_FAILED" });
    }
  }, async (request, reply) => {
    const settings = getSettings();
    if (!settings.spacexcard_webhook_secret_encrypted) {
      return reply.code(503).send({ code: "SPACEXCARD_WEBHOOK_NOT_CONFIGURED" });
    }
    let secret;
    try {
      secret = decryptText(settings.spacexcard_webhook_secret_encrypted);
    } catch {
      return reply.code(503).send({ code: "SPACEXCARD_WEBHOOK_NOT_CONFIGURED" });
    }
    if (!validWebhookSignature(secret, request.rawBody, request.headers["x-signature"])) {
      return reply.code(401).send({ code: "SPACEXCARD_WEBHOOK_SIGNATURE_INVALID" });
    }
    const parsed = z.object({
      event: z.literal("card_transaction"),
      auth_id: z.string().trim().min(1).max(256),
      vm_card_id: z.string().trim().min(1).max(256),
      card_id: z.coerce.number().int().positive(),
      card_number: z.string().min(1).max(32),
      settle_amount: z.coerce.number().min(0),
      status: z.enum(["PENDING", "COMPLETE", "DECLINED"]),
      type: z.enum(["Authorization", "Settlement", "Refund", "Reversal"]),
      merchant: z.string().max(256).optional(),
      channel: z.string().max(64).optional()
    }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: "SPACEXCARD_WEBHOOK_INVALID" });

    const event = parsed.data;
    const at = new Date().toISOString();
    const result = db.transaction(() => {
      const card = db.prepare(`
        SELECT id FROM managed_cards
        WHERE upstream_card_id = ? OR vm_card_id = ?
        ORDER BY CASE WHEN upstream_card_id = ? THEN 0 ELSE 1 END
        LIMIT 1
      `).get(event.card_id, event.vm_card_id, event.card_id);
      const inserted = db.prepare(`
        INSERT OR IGNORE INTO spacexcard_webhook_events (
          auth_id, type, status, upstream_card_id, vm_card_id, managed_card_id,
          settle_amount, received_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        event.auth_id,
        event.type,
        event.status,
        event.card_id,
        event.vm_card_id,
        card?.id || null,
        event.settle_amount,
        at
      );
      if (inserted.changes === 0) return { duplicate: true };

      if (card) {
        const merchant = event.merchant && /openai/i.test(event.merchant) ? "OPENAI" : "UNKNOWN";
        const canonicalState = selectCanonicalCardTransactionState(
          db.prepare(`
            SELECT type, status FROM managed_card_transactions
            WHERE card_id = ? AND auth_id = ?
          `).get(card.id, event.auth_id),
          event
        );
        db.prepare(`
          INSERT INTO managed_card_transactions (
            card_id, auth_id, auth_amount, settle_amount, settle_currency,
            type, status, merchant_normalized, authorization_seen, settlement_seen,
            refund_seen, reversal_seen, first_seen_at, last_seen_at
          ) VALUES (?, ?, 0, ?, 'USD', ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(card_id, auth_id) DO UPDATE SET
            settle_amount = CASE WHEN excluded.settle_amount > 0 THEN excluded.settle_amount ELSE managed_card_transactions.settle_amount END,
            settle_currency = COALESCE(excluded.settle_currency, managed_card_transactions.settle_currency),
            type = excluded.type,
            status = excluded.status,
            merchant_normalized = CASE WHEN excluded.merchant_normalized = 'OPENAI' THEN 'OPENAI' ELSE managed_card_transactions.merchant_normalized END,
            authorization_seen = MAX(managed_card_transactions.authorization_seen, excluded.authorization_seen),
            settlement_seen = MAX(managed_card_transactions.settlement_seen, excluded.settlement_seen),
            refund_seen = MAX(managed_card_transactions.refund_seen, excluded.refund_seen),
            reversal_seen = MAX(managed_card_transactions.reversal_seen, excluded.reversal_seen),
            last_seen_at = excluded.last_seen_at
        `).run(
          card.id,
          event.auth_id,
          event.settle_amount,
          canonicalState.type,
          canonicalState.status,
          merchant,
          event.type === "Authorization" ? 1 : 0,
          event.type === "Settlement" ? 1 : 0,
          event.type === "Refund" ? 1 : 0,
          event.type === "Reversal" ? 1 : 0,
          at,
          at
        );
        db.prepare(`
          UPDATE managed_cards
          SET reconciliation_state = 'PENDING', reconciliation_reason = 'WEBHOOK_RECHECK_PENDING',
              updated_at = ?
          WHERE id = ?
        `).run(at, card.id);
      }
      db.prepare(`
        INSERT INTO membership_outbox (
          id, event_type, fulfillment_id, state_revision, payload, created_at
        ) VALUES (?, 'card.transaction.changed', NULL, NULL, ?, ?)
      `).run(
        randomUUID(),
        JSON.stringify({ upstreamCardId: event.card_id, authId: event.auth_id }),
        at
      );
      return { duplicate: false };
    })();
    setNoStore(reply);
    return reply.code(202).send({ accepted: true, duplicate: result.duplicate });
  });

  const outboxTimer = setInterval(() => {
    try {
      expireBrowserFulfillmentLease(db);
      dispatchMembershipOutbox();
    } catch {}
  }, 1000);
  outboxTimer.unref?.();
  app.addHook("onClose", async () => clearInterval(outboxTimer));

  return {
    dispatchMembershipOutbox,
    getSettings,
    serializeSettings: () => serializeSettings(getSettings(), getExtensionSettings())
  };
}
