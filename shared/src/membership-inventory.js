import { nanoid } from "nanoid";
import {
  classifyHistoricalCardFulfillments,
  selectCanonicalCardTransactionState
} from "./membership-fulfillment.js";
import {
  acquireDependencyCircuit,
  recordDependencyFailure,
  recordDependencySuccess
} from "./membership-circuits.js";
import { SpaceXCardOpenApiClient } from "./spacexcard-openapi.js";

const PAGE_SIZE = 20;
const TRANSACTION_PAGE_SIZE = 50;
const MAX_TRANSACTION_PAGES = 100;
const RUN_LOCK_MS = 5 * 60 * 1000;
const PERIODIC_REFRESH_MS = 6 * 60 * 60 * 1000;

function nowIso(now = Date.now()) {
  return new Date(now).toISOString();
}

function inventoryError(code, message, statusCode = 409) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

export function serializeMembershipInventoryRun(row) {
  if (!row) return null;
  return {
    id: row.id,
    providerKey: row.provider_key || "spacexcard",
    mode: row.mode,
    status: row.status,
    nextPage: row.next_page,
    totalCards: row.total_cards,
    discoveredCards: row.discovered_cards,
    processedCards: row.processed_cards,
    heldCards: row.held_cards,
    lastErrorCode: row.last_error_code || null,
    startedAt: row.started_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at || null
  };
}

export function startMembershipInventoryRun(db, options = {}) {
  const at = options.at || nowIso();
  const mode = options.mode === "refresh" ? "refresh" : "full";
  const providerKey = options.providerKey || "spacexcard";
  const id = options.id || `mir_${nanoid(16)}`;
  return db.transaction(() => {
    const settings = db.prepare("SELECT * FROM membership_fulfillment_settings WHERE id = 'default'").get();
    const platform = db.prepare("SELECT * FROM membership_card_platforms WHERE key = ?").get(providerKey);
    const legacySpaceXCredential = providerKey === "spacexcard" && settings?.spacexcard_app_secret_encrypted;
    const migrateLegacySpaceX = Boolean(
      legacySpaceXCredential
      && platform
      && platform.enabled !== 1
      && !platform.credential_encrypted
      && platform.updated_by === "system"
    );
    if (!platform || (platform.enabled !== 1 && !migrateLegacySpaceX)) {
      throw inventoryError("CARD_PLATFORM_DISABLED", "请先启用对应卡台", 400);
    }
    if (!platform.credential_encrypted && !legacySpaceXCredential) {
      throw inventoryError("CARD_PLATFORM_NOT_CONFIGURED", "请先配置对应卡台的 API 凭据", 400);
    }
    if (mode === "refresh" && platform.inventory_status !== "completed") {
      throw inventoryError("INVENTORY_NOT_READY", "该卡台首次库存初始化完成前不能执行刷新");
    }
    const active = db.prepare(`
      SELECT id FROM card_inventory_runs
      WHERE status IN ('discovering', 'reconciling')
      ORDER BY started_at ASC LIMIT 1
    `).get();
    if (active) throw inventoryError("INVENTORY_ALREADY_RUNNING", "卡片库存初始化或刷新正在运行");
    if (migrateLegacySpaceX) {
      db.prepare(`
        UPDATE membership_card_platforms
        SET enabled = 1, updated_at = ?, updated_by = ?
        WHERE key = 'spacexcard'
      `).run(at, options.actor || "system");
    }
    db.prepare(`
      INSERT INTO card_inventory_runs (
        id, provider_key, mode, status, next_page, total_cards, discovered_cards, processed_cards,
        held_cards, started_at, updated_at
      ) VALUES (?, ?, ?, 'discovering', 1, NULL, 0, 0, 0, ?, ?)
    `).run(id, providerKey, mode, at, at);
    db.prepare(`
      UPDATE membership_card_platforms
      SET inventory_status = 'running', last_inventory_error = NULL,
          updated_at = ?, updated_by = ?
      WHERE key = ?
    `).run(at, options.actor || "system", providerKey);
    db.prepare(`
      UPDATE membership_fulfillment_settings
      SET inventory_status = 'running', last_inventory_error = NULL,
          updated_at = ?, updated_by = ?
      WHERE id = 'default'
    `).run(at, options.actor || "system");
    return db.prepare("SELECT * FROM card_inventory_runs WHERE id = ?").get(id);
  })();
}

function collapseTransactions(events) {
  const rows = new Map();
  for (const event of events) {
    const current = rows.get(event.authId) || {
      authId: event.authId,
      authTime: event.authTime,
      authAmount: 0,
      authCurrency: null,
      settleAmount: 0,
      settleCurrency: null,
      type: event.type,
      status: event.status,
      merchantNormalized: event.merchantNormalized,
      authorizationSeen: 0,
      settlementSeen: 0,
      refundSeen: 0,
      reversalSeen: 0
    };
    current.authTime ||= event.authTime;
    if (Number(event.authAmount) > 0) current.authAmount = Number(event.authAmount);
    if (event.authCurrency) current.authCurrency = event.authCurrency;
    if (Number(event.settleAmount) > 0) current.settleAmount = Number(event.settleAmount);
    if (event.settleCurrency) current.settleCurrency = event.settleCurrency;
    if (event.merchantNormalized === "OPENAI") current.merchantNormalized = "OPENAI";
    if (event.type === "Authorization") current.authorizationSeen = 1;
    if (event.type === "Settlement") current.settlementSeen = 1;
    if (event.type === "Refund") current.refundSeen = 1;
    if (event.type === "Reversal") current.reversalSeen = 1;
    const canonicalState = selectCanonicalCardTransactionState(current, event);
    current.type = canonicalState.type;
    current.status = canonicalState.status;
    rows.set(event.authId, current);
  }
  return [...rows.values()];
}

function nextRetryIso(attempt, now = Date.now()) {
  const delays = [30_000, 120_000, 300_000, 900_000];
  return nowIso(now + delays[Math.min(Math.max(0, attempt - 1), delays.length - 1)]);
}

export function createMembershipInventoryRunner(options) {
  const {
    db,
    decryptText,
    workerId = `membership-inventory-${process.pid}`,
    logger = console,
    clientFactory
  } = options;

  function buildClient() {
    if (clientFactory) return clientFactory();
    const settings = db.prepare("SELECT * FROM membership_fulfillment_settings WHERE id = 'default'").get();
    const platform = db.prepare("SELECT base_url FROM membership_card_platforms WHERE key = 'spacexcard'").get();
    if (!settings?.spacexcard_app_secret_encrypted) {
      throw inventoryError("SPACEXCARD_OPENAPI_NOT_CONFIGURED", "SpaceX Card OpenAPI app_secret 未配置", 503);
    }
    return new SpaceXCardOpenApiClient({
      baseUrl: platform?.base_url || undefined,
      appId: settings.spacexcard_app_id,
      appSecret: decryptText(settings.spacexcard_app_secret_encrypted)
    });
  }

  function recordOpenApiFailure(caught, at) {
    const result = recordDependencyFailure(db, {
      dependency: "spacexcard_openapi",
      scopeKey: "default",
      error: caught,
      at
    });
    if (result.openedNow) {
      db.prepare(`
        INSERT INTO membership_outbox (
          id, event_type, fulfillment_id, state_revision, payload, created_at
        ) VALUES (?, 'dependency.circuit.opened', NULL, NULL, ?, ?)
      `).run(
        `mo_${nanoid(16)}`,
        JSON.stringify({
          dependency: result.circuit.dependency,
          scopeKey: result.circuit.scopeKey,
          reasonCode: result.circuit.reasonCode
        }),
        at
      );
    }
    return result;
  }

  function claimRun(at = nowIso()) {
    const staleAt = nowIso(Date.parse(at) - RUN_LOCK_MS);
    return db.transaction(() => {
      const candidate = db.prepare(`
        SELECT id FROM card_inventory_runs
        WHERE provider_key = 'spacexcard'
          AND status IN ('discovering', 'reconciling')
          AND (locked_at IS NULL OR locked_at < ? OR locked_by = ?)
        ORDER BY started_at ASC LIMIT 1
      `).get(staleAt, workerId);
      if (!candidate) return null;
      const changed = db.prepare(`
        UPDATE card_inventory_runs
        SET locked_at = ?, locked_by = ?, updated_at = ?
        WHERE id = ? AND status IN ('discovering', 'reconciling')
          AND (locked_at IS NULL OR locked_at < ? OR locked_by = ?)
      `).run(at, workerId, at, candidate.id, staleAt, workerId);
      return changed.changes === 1
        ? db.prepare("SELECT * FROM card_inventory_runs WHERE id = ?").get(candidate.id)
        : null;
    })();
  }

  function releaseRun(runId, at = nowIso()) {
    db.prepare(`
      UPDATE card_inventory_runs
      SET locked_at = NULL, locked_by = NULL, updated_at = ?
      WHERE id = ? AND locked_by = ?
    `).run(at, runId, workerId);
  }

  function scheduleTargetedRun(at) {
    return db.transaction(() => {
      const settings = db.prepare("SELECT inventory_status FROM membership_fulfillment_settings WHERE id = 'default'").get();
      if (settings?.inventory_status !== "completed") return null;
      const active = db.prepare(`
        SELECT id FROM card_inventory_runs
        WHERE status IN ('discovering', 'reconciling') LIMIT 1
      `).get();
      if (active) return null;
      const card = db.prepare(`
        SELECT upstream_card_id FROM managed_cards
        WHERE provider_key = 'spacexcard'
          AND reconciliation_state = 'PENDING'
          AND reconciliation_reason = 'WEBHOOK_RECHECK_PENDING'
        ORDER BY updated_at, upstream_card_id LIMIT 1
      `).get();
      if (!card) return null;
      const runId = `mir_target_${nanoid(16)}`;
      db.prepare(`
        INSERT INTO card_inventory_runs (
          id, provider_key, mode, status, next_page, total_cards, discovered_cards,
          processed_cards, held_cards, started_at, updated_at
        ) VALUES (?, 'spacexcard', 'targeted', 'reconciling', 1, 1, 1, 0, 0, ?, ?)
      `).run(runId, at, at);
      db.prepare(`
        INSERT INTO card_inventory_run_items (
          run_id, upstream_card_id, status, attempt_count, updated_at
        ) VALUES (?, ?, 'pending', 0, ?)
      `).run(runId, card.upstream_card_id, at);
      db.prepare(`
        UPDATE membership_fulfillment_settings
        SET inventory_status = 'running', last_inventory_error = NULL,
            updated_at = ?, updated_by = 'worker'
        WHERE id = 'default'
      `).run(at);
      return { runId, upstreamCardId: card.upstream_card_id };
    })();
  }

  function schedulePeriodicRefresh(at) {
    const settings = db.prepare(`
      SELECT inventory_status, spacexcard_app_secret_encrypted
      FROM membership_fulfillment_settings WHERE id = 'default'
    `).get();
    if (settings?.inventory_status !== "completed" || !settings.spacexcard_app_secret_encrypted) return null;
    const latest = db.prepare(`
      SELECT completed_at FROM card_inventory_runs
      WHERE provider_key = 'spacexcard' AND mode IN ('full', 'refresh') AND status = 'completed'
      ORDER BY completed_at DESC LIMIT 1
    `).get();
    if (!latest?.completed_at || Date.parse(at) - Date.parse(latest.completed_at) < PERIODIC_REFRESH_MS) return null;
    try {
      const run = startMembershipInventoryRun(db, { mode: "refresh", actor: "worker", at });
      return { runId: run.id };
    } catch (caught) {
      if (caught?.code === "INVENTORY_ALREADY_RUNNING") return null;
      throw caught;
    }
  }

  function discoverPage(run, client, at) {
    return client.listCards({ page: run.next_page, pageSize: PAGE_SIZE, sync: true }).then((page) => {
      db.transaction(() => {
        for (const card of page.cards) {
          const localId = `mc_spacexcard_${card.upstreamCardId}`;
          db.prepare(`
            INSERT INTO managed_cards (
              id, provider_key, upstream_card_id, vm_card_id, product_code, bin, last4, upstream_status,
              cached_available_amount, capacity_state, reconciliation_state,
              last_balance_sync_at, created_at, updated_at
            ) VALUES (?, 'spacexcard', ?, ?, ?, ?, ?, ?, ?, 'PENDING', 'PENDING', ?, ?, ?)
            ON CONFLICT(provider_key, upstream_card_id) DO UPDATE SET
              vm_card_id = excluded.vm_card_id,
              product_code = excluded.product_code,
              bin = excluded.bin,
              last4 = excluded.last4,
              upstream_status = excluded.upstream_status,
              cached_available_amount = excluded.cached_available_amount,
              last_balance_sync_at = excluded.last_balance_sync_at,
              updated_at = excluded.updated_at
          `).run(
            localId,
            card.upstreamCardId,
            card.vmCardId,
            card.productCode,
            card.bin,
            card.last4,
            card.status,
            card.availableAmount,
            at,
            at,
            at
          );
          db.prepare(`
            INSERT OR IGNORE INTO card_inventory_run_items (
              run_id, upstream_card_id, status, attempt_count, updated_at
            ) VALUES (?, ?, 'pending', 0, ?)
          `).run(run.id, card.upstreamCardId, at);
        }
        const discovered = db.prepare("SELECT COUNT(*) AS count FROM card_inventory_run_items WHERE run_id = ?").get(run.id).count;
        const done = page.cards.length === 0 || discovered >= page.total;
        db.prepare(`
          UPDATE card_inventory_runs
          SET status = ?, next_page = next_page + 1, total_cards = ?, discovered_cards = ?,
              last_error_code = NULL, updated_at = ?
          WHERE id = ?
        `).run(done ? "reconciling" : "discovering", page.total, discovered, at, run.id);
      })();
      return { accepted: true, runId: run.id, action: "discovered", cards: page.cards.length };
    });
  }

  async function loadAllTransactions(client, upstreamCardId) {
    const all = [];
    for (let page = 1; page <= MAX_TRANSACTION_PAGES; page += 1) {
      const items = await client.listTransactions(upstreamCardId, { page, pageSize: TRANSACTION_PAGE_SIZE });
      all.push(...items);
      if (items.length < TRANSACTION_PAGE_SIZE) return all;
    }
    throw inventoryError("CARD_TRANSACTION_PAGINATION_EXCEEDED", "卡片交易记录分页超过安全上限", 502);
  }

  async function reconcileCard(run, item, client, at) {
    const card = db.prepare("SELECT * FROM managed_cards WHERE provider_key=? AND upstream_card_id=?")
      .get(run.provider_key || "spacexcard", item.upstream_card_id);
    if (!card) throw inventoryError("MANAGED_CARD_NOT_FOUND", "库存卡片记录不存在", 500);
    const transactions = await loadAllTransactions(client, item.upstream_card_id);
    const prices = await client.getOpenAiPayments(item.upstream_card_id);
    const reservationLanes = db.prepare(`
      SELECT DISTINCT target_lane FROM card_capacity_reservations
      WHERE card_id = ? AND state IN ('reserved', 'consumed', 'retained_partial')
    `).all(card.id);
    const knownLane = card.lane || (reservationLanes.length === 1 ? reservationLanes[0].target_lane : null);
    const classification = classifyHistoricalCardFulfillments(transactions, { knownLane });
    const collapsed = collapseTransactions(transactions);
    const held = classification.state === "RECONCILIATION_HOLD";

    db.transaction(() => {
      for (const transaction of collapsed) {
        db.prepare(`
          INSERT INTO managed_card_transactions (
            card_id, auth_id, auth_time, auth_amount, auth_currency, settle_amount,
            settle_currency, type, status, merchant_normalized, authorization_seen,
            settlement_seen, refund_seen, reversal_seen, first_seen_at, last_seen_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
            last_seen_at = excluded.last_seen_at
        `).run(
          card.id,
          transaction.authId,
          transaction.authTime,
          transaction.authAmount,
          transaction.authCurrency,
          transaction.settleAmount,
          transaction.settleCurrency,
          transaction.type,
          transaction.status,
          transaction.merchantNormalized,
          transaction.authorizationSeen,
          transaction.settlementSeen,
          transaction.refundSeen,
          transaction.reversalSeen,
          at,
          at
        );
      }
      for (const price of prices) {
        db.prepare(`
          INSERT INTO card_price_signals (
            card_id, tier, found, amount, min_usd, max_usd, provider_time, fetched_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(card_id, tier) DO UPDATE SET
            found = excluded.found,
            amount = excluded.amount,
            min_usd = excluded.min_usd,
            max_usd = excluded.max_usd,
            provider_time = excluded.provider_time,
            fetched_at = excluded.fetched_at
        `).run(card.id, price.tier, price.found ? 1 : 0, price.amount, price.minUsd, price.maxUsd, price.time || null, at);
      }
      db.prepare(`
        UPDATE managed_cards
        SET lane = ?, consumed_slots = ?, capacity_state = ?, reconciliation_state = ?, reconciliation_reason = ?,
            last_transaction_sync_at = ?, updated_at = ?
        WHERE id = ?
      `).run(
        classification.lane,
        classification.consumed,
        held ? "HOLD" : classification.state,
        held ? "HOLD" : "READY",
        classification.reason,
        at,
        at,
        card.id
      );
      db.prepare(`
        UPDATE card_inventory_run_items
        SET status = ?, error_code = ?, next_retry_at = NULL, updated_at = ?
        WHERE run_id = ? AND upstream_card_id = ?
      `).run(held ? "held" : "succeeded", classification.reason, at, run.id, item.upstream_card_id);
      updateRunProgress(run.id, at);
    })();
    return { accepted: true, runId: run.id, action: held ? "held" : "reconciled", upstreamCardId: item.upstream_card_id };
  }

  function updateRunProgress(runId, at) {
    const counts = db.prepare(`
      SELECT
        SUM(CASE WHEN status IN ('succeeded', 'held') THEN 1 ELSE 0 END) AS processed,
        SUM(CASE WHEN status = 'held' THEN 1 ELSE 0 END) AS held,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending
      FROM card_inventory_run_items WHERE run_id = ?
    `).get(runId);
    const processed = Number(counts.processed) || 0;
    const held = Number(counts.held) || 0;
    const pending = Number(counts.pending) || 0;
    db.prepare(`
      UPDATE card_inventory_runs
      SET processed_cards = ?, held_cards = ?, updated_at = ?
      WHERE id = ?
    `).run(processed, held, at, runId);
    if (pending === 0) {
      const completedRun = db.prepare("SELECT mode,provider_key FROM card_inventory_runs WHERE id = ?").get(runId);
      if (["full", "refresh"].includes(completedRun?.mode)) {
        db.prepare(`
          UPDATE managed_cards
          SET upstream_status = 'MISSING', capacity_state = 'HOLD', reconciliation_state = 'HOLD',
              reconciliation_reason = 'UPSTREAM_CARD_MISSING', updated_at = ?
          WHERE NOT EXISTS (
            SELECT 1 FROM card_inventory_run_items item
            WHERE item.run_id = ? AND item.upstream_card_id = managed_cards.upstream_card_id
          )
            AND provider_key = ?
        `).run(at, runId, completedRun.provider_key || "spacexcard");
      }
      db.prepare(`
        UPDATE card_inventory_runs
        SET status = 'completed', completed_at = ?, last_error_code = NULL,
            locked_at = NULL, locked_by = NULL, updated_at = ?
        WHERE id = ?
      `).run(at, at, runId);
      db.prepare(`
        UPDATE membership_fulfillment_settings
        SET inventory_status = 'completed', inventory_initialized_at = COALESCE(inventory_initialized_at, ?),
            last_inventory_error = NULL, updated_at = ?, updated_by = 'worker'
        WHERE id = 'default'
      `).run(at, at);
      db.prepare(`
        UPDATE membership_card_platforms
        SET inventory_status='completed',inventory_initialized_at=COALESCE(inventory_initialized_at,?),
            last_inventory_error=NULL,updated_at=?,updated_by='worker'
        WHERE key=?
      `).run(at, at, completedRun?.provider_key || "spacexcard");
    }
    return { processed, held, pending };
  }

  function recordItemFailure(run, item, caught, at) {
    const attempt = Number(item.attempt_count || 0) + 1;
    const cardSpecific = caught?.code === "SPACEXCARD_OPERATION_REJECTED" && attempt >= 3;
    db.transaction(() => {
      db.prepare(`
        UPDATE card_inventory_run_items
        SET status = ?, attempt_count = ?, next_retry_at = ?, error_code = ?, updated_at = ?
        WHERE run_id = ? AND upstream_card_id = ?
      `).run(
        cardSpecific ? "held" : "pending",
        attempt,
        cardSpecific ? null : nextRetryIso(attempt, Date.parse(at)),
        caught?.code || "INVENTORY_CARD_SYNC_FAILED",
        at,
        run.id,
        item.upstream_card_id
      );
      if (cardSpecific) {
        db.prepare(`
          UPDATE managed_cards
          SET capacity_state = 'HOLD', reconciliation_state = 'HOLD',
              reconciliation_reason = 'CARD_SYNC_REJECTED', updated_at = ?
          WHERE provider_key=? AND upstream_card_id = ?
        `).run(at, run.provider_key || "spacexcard", item.upstream_card_id);
      }
      db.prepare(`
        UPDATE card_inventory_runs
        SET last_error_code = ?, updated_at = ? WHERE id = ?
      `).run(caught?.code || "INVENTORY_CARD_SYNC_FAILED", at, run.id);
      db.prepare(`
        UPDATE membership_fulfillment_settings
        SET last_inventory_error = ?, updated_at = ?, updated_by = 'worker'
        WHERE id = 'default'
      `).run(caught?.code || "INVENTORY_CARD_SYNC_FAILED", at);
      updateRunProgress(run.id, at);
    })();
    logger.warn?.(`[membership inventory] ${caught?.code || "INVENTORY_CARD_SYNC_FAILED"}`);
  }

  async function tick() {
    const at = nowIso();
    const run = claimRun(at);
    if (!run) {
      const targeted = scheduleTargetedRun(at);
      if (targeted) return { accepted: true, action: "scheduled_targeted", ...targeted };
      const periodic = schedulePeriodicRefresh(at);
      if (periodic) return { accepted: true, action: "scheduled_refresh", ...periodic };
      return { accepted: false, reason: "idle" };
    }
    try {
      let item = null;
      if (run.status !== "discovering") {
        item = db.prepare(`
          SELECT * FROM card_inventory_run_items
          WHERE run_id = ? AND status = 'pending'
            AND (next_retry_at IS NULL OR next_retry_at <= ?)
          ORDER BY upstream_card_id ASC LIMIT 1
        `).get(run.id, at);
        if (!item) {
          const remaining = db.prepare(`
            SELECT COUNT(*) AS count FROM card_inventory_run_items
            WHERE run_id = ? AND status = 'pending'
          `).get(run.id).count;
          if (remaining === 0) {
            db.transaction(() => updateRunProgress(run.id, at))();
            return { accepted: true, runId: run.id, action: "completed" };
          }
          return { accepted: false, runId: run.id, reason: "retry_wait" };
        }
      }
      const circuit = acquireDependencyCircuit(db, {
        dependency: "spacexcard_openapi",
        scopeKey: "default",
        at
      });
      if (!circuit.allowed) {
        return {
          accepted: false,
          runId: run.id,
          reason: "circuit_open",
          code: circuit.circuit?.reasonCode || "SPACEXCARD_CIRCUIT_OPEN"
        };
      }
      const client = buildClient();
      if (run.status === "discovering") {
        const result = await discoverPage(run, client, at);
        recordDependencySuccess(db, { dependency: "spacexcard_openapi", scopeKey: "default", at });
        return result;
      }
      try {
        const result = await reconcileCard(run, item, client, at);
        recordDependencySuccess(db, { dependency: "spacexcard_openapi", scopeKey: "default", at });
        return result;
      } catch (caught) {
        recordOpenApiFailure(caught, at);
        recordItemFailure(run, item, caught, at);
        return { accepted: false, runId: run.id, reason: "card_error", code: caught?.code || "INVENTORY_CARD_SYNC_FAILED" };
      }
    } catch (caught) {
      recordOpenApiFailure(caught, at);
      db.prepare(`
        UPDATE card_inventory_runs
        SET last_error_code = ?, updated_at = ? WHERE id = ?
      `).run(caught?.code || "INVENTORY_RUN_FAILED", at, run.id);
      db.prepare(`
        UPDATE membership_fulfillment_settings
        SET last_inventory_error = ?, updated_at = ?, updated_by = 'worker'
        WHERE id = 'default'
      `).run(caught?.code || "INVENTORY_RUN_FAILED", at);
      logger.warn?.(`[membership inventory] ${caught?.code || "INVENTORY_RUN_FAILED"}`);
      return { accepted: false, runId: run.id, reason: "run_error", code: caught?.code || "INVENTORY_RUN_FAILED" };
    } finally {
      releaseRun(run.id);
    }
  }

  return { tick };
}
