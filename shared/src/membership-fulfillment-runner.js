import { randomUUID } from "node:crypto";
import {
  calculateMembershipBudget,
  classifyStartingMembership,
  membershipCapacityByTier
} from "./membership-fulfillment.js";
import { fetchMembershipObservation } from "./membership-state-provider.js";
import {
  activateMembershipFulfillmentIdentity,
  promoteWaitingMembershipFulfillment,
  transitionMembershipFulfillment
} from "./membership-orchestration.js";

const RETRY_SHARED_MS = 5 * 60_000;
const RETRY_ACCOUNT_MS = 60 * 60_000;

function iso(value = Date.now()) {
  return new Date(value).toISOString();
}

function sessionEmail(session) {
  const value = session?.user?.email ?? session?.email;
  return typeof value === "string" ? value : "";
}

function persistObservation(db, fulfillmentId, observation, purpose, at) {
  const id = `mfo_${randomUUID()}`;
  db.prepare(`
    INSERT INTO membership_observations (
      id, fulfillment_id, stage_key, purpose, provider_code, account_type,
      currency, auto_renew, is_overdue, is_delinquent, expire_time, observed_at
    ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    fulfillmentId,
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

function cardHasCapacity(db, card, targetTier) {
  const capacity = membershipCapacityByTier[targetTier];
  if (!capacity || Number(card.consumed_slots || 0) >= capacity || card.capacity_state === "CAPACITY_FULL") return false;
  const active = db.prepare(`
    SELECT COUNT(*) AS count FROM card_capacity_reservations
    WHERE card_id = ? AND target_lane = ? AND state IN ('reserved', 'consumed', 'retained_partial')
  `).get(card.id, targetTier).count;
  return Math.max(Number(card.consumed_slots || 0), Number(active || 0)) < capacity;
}

function freshBudgetForCard(db, cardId, targetTier, nowMs) {
  const signals = db.prepare(`
    SELECT tier, found, amount, provider_time
    FROM card_price_signals WHERE card_id = ?
  `).all(cardId).map((row) => ({
    tier: row.tier,
    found: row.found === 1,
    amount: row.amount,
    time: row.provider_time
  }));
  try {
    return calculateMembershipBudget(signals, targetTier, { nowMs });
  } catch {
    return null;
  }
}

export function inspectReadOnlyMembershipInventoryPlan(db, targetTier, options = {}) {
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  const cards = db.prepare(`
    SELECT id, product_code, lane, consumed_slots, capacity_state, cached_available_amount
    FROM managed_cards
    WHERE upstream_status = 'ACTIVE' AND reconciliation_state = 'READY'
      AND (lane IS NULL OR lane = ?)
    ORDER BY CASE WHEN lane = ? THEN 0 ELSE 1 END, id ASC
  `).all(targetTier, targetTier);
  for (const card of cards) {
    if (!cardHasCapacity(db, card, targetTier)) continue;
    const budget = freshBudgetForCard(db, card.id, targetTier, nowMs);
    if (budget) return Object.freeze({ kind: "existing", budget });
  }

  const provenProducts = db.prepare(`
    SELECT DISTINCT p.product_code, c.id AS evidence_card_id
    FROM card_product_policies p
    JOIN managed_cards c ON c.product_code = p.product_code
    WHERE p.enabled = 1 AND c.upstream_status = 'ACTIVE' AND c.reconciliation_state = 'READY'
    ORDER BY p.product_code, c.id
  `).all();
  for (const product of provenProducts) {
    const budget = freshBudgetForCard(db, product.evidence_card_id, targetTier, nowMs);
    if (budget) return Object.freeze({ kind: "new", productCode: product.product_code, budget });
  }
  return null;
}

export function createMembershipFulfillmentRunner(options = {}) {
  const {
    db,
    decryptText,
    identitySecret,
    membershipFetcher = fetchMembershipObservation,
    now = () => new Date()
  } = options;
  if (!db || typeof decryptText !== "function") throw new TypeError("会员履约 Runner 配置不完整");
  let running = false;

  function nowMs() {
    return now().getTime();
  }

  function catchUpSessionActivation(limit = 20) {
    const rows = db.prepare(`
      SELECT f.order_no, o.session_payload
      FROM membership_fulfillments f
      JOIN redeem_orders o ON o.id = f.order_id
      WHERE f.state = 'WAITING_SESSION_ACTIVATION'
        AND o.extension_delivery_status = 'succeeded'
      ORDER BY f.created_at ASC LIMIT ?
    `).all(limit);
    let changed = 0;
    for (const row of rows) {
      try {
        const session = JSON.parse(decryptText(row.session_payload));
        if (activateMembershipFulfillmentIdentity(db, {
          orderNo: row.order_no,
          verifiedEmail: sessionEmail(session),
          secret: identitySecret,
          at: nowMs()
        })) changed += 1;
      } catch {
        // A succeeded Session Delivery should be parseable. Keep the aggregate blocked and sanitized.
      }
    }
    return changed;
  }

  function claimOne() {
    const at = iso(nowMs());
    // ponytail: this linear waiter scan is acceptable for the single-worker queue; use an indexed anti-join if volume grows.
    const waiters = db.prepare(`
      SELECT id FROM membership_fulfillments
      WHERE state = 'ACCOUNT_FULFILLMENT_WAIT'
        AND (retry_at IS NULL OR retry_at <= ?)
      ORDER BY created_at ASC
    `).all(at);
    for (const waiter of waiters) {
      const promoted = promoteWaitingMembershipFulfillment(db, waiter.id, { at });
      if (promoted?.state === "QUEUED") break;
    }

    const candidate = db.prepare(`
      SELECT * FROM membership_fulfillments
      WHERE state IN (
        'QUEUED', 'ACCOUNT_CHECKING',
        'ACCOUNT_REPURCHASE_NOT_READY', 'INVENTORY_NOT_READY',
        'CARD_PRICE_UNAVAILABLE', 'CHECKOUT_PRICE_UNRECOGNIZED',
        'CHECKOUT_PRE_SUBMIT_FAILED', 'MEMBERSHIP_CONTRACT_UNKNOWN'
      )
        AND (retry_at IS NULL OR retry_at <= ?)
        AND (state <> 'CHECKOUT_PRE_SUBMIT_FAILED' OR run_mode IS NULL)
      ORDER BY created_at ASC LIMIT 1
    `).get(at);
    if (!candidate) return null;
    const changed = db.prepare(`
      UPDATE membership_fulfillments
      SET state = 'ACCOUNT_CHECKING', current_stage = 'eligibility',
          state_revision = state_revision + 1, retry_at = NULL,
          failure_code = NULL, updated_at = ?
      WHERE id = ? AND state = ? AND state_revision = ?
    `).run(at, candidate.id, candidate.state, candidate.state_revision).changes;
    return changed === 1
      ? db.prepare("SELECT * FROM membership_fulfillments WHERE id = ?").get(candidate.id)
      : null;
  }

  function preflightReadiness(fulfillment, atMs) {
    const settings = db.prepare("SELECT * FROM membership_fulfillment_settings WHERE id = 'default'").get();
    if (settings.inventory_status !== "completed") {
      return transitionMembershipFulfillment(db, fulfillment.id, "INVENTORY_NOT_READY", {
        currentStage: "eligibility",
        failureCode: "INVENTORY_NOT_READY",
        retryAt: iso(atMs + RETRY_SHARED_MS),
        at: atMs
      });
    }
    if (!inspectReadOnlyMembershipInventoryPlan(db, fulfillment.target_tier, { nowMs: atMs })) {
      return transitionMembershipFulfillment(db, fulfillment.id, "CARD_PRICE_UNAVAILABLE", {
        currentStage: "eligibility",
        failureCode: "CARD_PRICE_UNAVAILABLE",
        retryAt: iso(atMs + RETRY_SHARED_MS),
        at: atMs
      });
    }
    const contract = db.prepare(`
      SELECT id FROM checkout_price_contracts
      WHERE tier = 'plus' AND currency = 'PHP' AND status = 'active'
      LIMIT 1
    `).get();
    if (!contract) {
      return transitionMembershipFulfillment(db, fulfillment.id, "CHECKOUT_PRICE_UNRECOGNIZED", {
        currentStage: "eligibility",
        failureCode: "CHECKOUT_PRICE_CONTRACT_MISSING",
        retryAt: iso(atMs + RETRY_SHARED_MS),
        at: atMs
      });
    }
    const extension = db.prepare("SELECT spacexcard_api_token_encrypted FROM extension_delivery_settings WHERE id = 'default'").get();
    if (!extension?.spacexcard_api_token_encrypted) {
      return transitionMembershipFulfillment(db, fulfillment.id, "CHECKOUT_PRE_SUBMIT_FAILED", {
        currentStage: "eligibility",
        failureCode: "CHECKOUT_BROKER_NOT_CONFIGURED",
        retryAt: iso(atMs + RETRY_SHARED_MS),
        at: atMs
      });
    }
    return transitionMembershipFulfillment(db, fulfillment.id, "BROWSER_LEASE_WAIT", {
      currentStage: "plus",
      at: atMs,
      notify: true
    });
  }

  async function processOne(fulfillment) {
    const atMs = nowMs();
    const order = db.prepare("SELECT session_payload FROM redeem_orders WHERE id = ?").get(fulfillment.order_id);
    let session;
    try {
      session = JSON.parse(decryptText(order?.session_payload));
    } catch {
      return transitionMembershipFulfillment(db, fulfillment.id, "MEMBERSHIP_CONTRACT_UNKNOWN", {
        failureCode: "SESSION_INVALID",
        retryAt: iso(atMs + RETRY_SHARED_MS),
        at: atMs
      });
    }

    let observation;
    try {
      observation = await membershipFetcher(session, { nowMs: atMs });
    } catch (error) {
      const code = typeof error?.code === "string" ? error.code : "MEMBERSHIP_PROVIDER_UNAVAILABLE";
      const contractFailure = code === "MEMBERSHIP_CONTRACT_UNKNOWN";
      return transitionMembershipFulfillment(db, fulfillment.id, contractFailure ? "MEMBERSHIP_CONTRACT_UNKNOWN" : "ACCOUNT_CHECKING", {
        currentStage: "eligibility",
        failureCode: code,
        retryAt: iso(atMs + RETRY_SHARED_MS),
        at: atMs
      });
    }
    persistObservation(db, fulfillment.id, observation, "starting_eligibility", iso(atMs));
    const classification = classifyStartingMembership(observation);
    if (classification === "subscribed") {
      return transitionMembershipFulfillment(db, fulfillment.id, "ACCOUNT_ALREADY_SUBSCRIBED", {
        currentStage: "eligibility",
        failureCode: "ACCOUNT_ALREADY_SUBSCRIBED",
        at: atMs
      });
    }
    if (classification === "delinquent") {
      return transitionMembershipFulfillment(db, fulfillment.id, "ACCOUNT_REPURCHASE_NOT_READY", {
        currentStage: "eligibility",
        failureCode: "ACCOUNT_REPURCHASE_NOT_READY",
        retryAt: iso(atMs + RETRY_ACCOUNT_MS),
        at: atMs
      });
    }
    if (classification !== "free") {
      return transitionMembershipFulfillment(db, fulfillment.id, "MEMBERSHIP_CONTRACT_UNKNOWN", {
        currentStage: "eligibility",
        failureCode: "MEMBERSHIP_CONTRACT_UNKNOWN",
        retryAt: iso(atMs + RETRY_SHARED_MS),
        at: atMs
      });
    }
    return preflightReadiness(fulfillment, atMs);
  }

  async function tick() {
    if (running) return { processed: 0, busy: true };
    running = true;
    try {
      const activated = catchUpSessionActivation();
      const fulfillment = claimOne();
      if (!fulfillment) return { activated, processed: 0 };
      await processOne(fulfillment);
      return { activated, processed: 1, fulfillmentId: fulfillment.id };
    } finally {
      running = false;
    }
  }

  return { tick, catchUpSessionActivation, inspectReadOnlyMembershipInventoryPlan };
}
