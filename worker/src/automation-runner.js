import { randomUUID, createHash } from "node:crypto";
import { AutomationAdapterError } from "../../shared/src/automation-adapters/automate-v1.js";
import {
  AutomationFundingError,
  automationRiskAllocationUsd,
  prepareAutomationCard
} from "../../shared/src/automation-card-funding.js";
import { isSpaceXGptCardUnavailableMessage } from "../../shared/src/automation-adapters/spacex-gpt-direct-v1.js";
import { settleAutomationExecution } from "../../shared/src/automation-fulfillment.js";
import {
  createAutomationAdapter,
  syncAutomationProvider
} from "../../shared/src/automation-provider-registry.js";

const CLAIMABLE_STATUSES = Object.freeze([
  "waiting_gate",
  "waiting_mapping",
  "waiting_capacity",
  "preparing_card",
  "submitting",
  "submit_unknown",
  "queued",
  "running"
]);
const PROVIDER_BUSY_STATUSES = Object.freeze([
  "preparing_card",
  "waiting_capacity",
  "submitting",
  "submit_unknown",
  "queued",
  "running",
  "manual_review"
]);
const POLL_BACKOFF_SECONDS = Object.freeze([3, 6, 15, 30, 60]);
const LOCK_TIMEOUT_SECONDS = 120;
const LONG_RUNNING_ALERT_SECONDS = 30 * 60;

function iso(value = Date.now()) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new TypeError("时间无效");
  return date.toISOString();
}

function addSeconds(value, seconds) {
  return new Date(new Date(value).getTime() + seconds * 1000).toISOString();
}

function parseJson(value, fallback = null) {
  if (!value) return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

function boundedError(value, fallback = "自动化处理异常") {
  const text = String(value || fallback).replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  return (text || fallback).slice(0, 500);
}

function placeholders(values) {
  return values.map(() => "?").join(", ");
}

function mappingSnapshot(mapping, provider) {
  return Object.freeze({
    mappingId: mapping.id,
    mappingRevision: Number(mapping.revision),
    providerId: provider.id,
    providerName: provider.name,
    adapterKey: provider.adapter_key,
    configHash: provider.config_hash,
    externalPlanId: mapping.external_plan_id,
    externalTaskType: mapping.external_task_type,
    regionCode: mapping.region_code,
    currency: mapping.currency,
    cardPlatformKey: mapping.card_platform_key,
    cardProductCode: mapping.card_product_code || null,
    capacityKey: mapping.capacity_key,
    cardCapacity: Number(mapping.card_capacity),
    fundingAmountUsd: Number(mapping.funding_amount_usd),
    expectedMinAmount: Number(mapping.expected_min_amount),
    expectedMaxAmount: Number(mapping.expected_max_amount),
    dailyRiskLimitUsd: Number(mapping.daily_risk_limit_usd),
    priority: Number(mapping.priority)
  });
}

function mappingFromSnapshot(snapshot) {
  if (!snapshot) throw new Error("自动化订单缺少商品映射快照");
  return Object.freeze({
    id: snapshot.mappingId,
    provider_id: snapshot.providerId,
    external_plan_id: snapshot.externalPlanId,
    external_task_type: snapshot.externalTaskType,
    region_code: snapshot.regionCode,
    currency: snapshot.currency,
    card_platform_key: snapshot.cardPlatformKey,
    card_product_code: snapshot.cardProductCode,
    capacity_key: snapshot.capacityKey,
    card_capacity: snapshot.cardCapacity,
    funding_amount_usd: snapshot.fundingAmountUsd,
    expected_min_amount: snapshot.expectedMinAmount,
    expected_max_amount: snapshot.expectedMaxAmount,
    daily_risk_limit_usd: snapshot.dailyRiskLimitUsd,
    priority: snapshot.priority
  });
}

function deterministicCardholder(orderNo) {
  const firstNames = ["James", "Michael", "Robert", "John", "David", "William", "Daniel", "Joseph"];
  const lastNames = ["Smith", "Johnson", "Williams", "Brown", "Jones", "Miller", "Davis", "Wilson"];
  const digest = createHash("sha256").update(String(orderNo)).digest();
  return Object.freeze({
    firstName: firstNames[digest[0] % firstNames.length],
    lastName: lastNames[digest[1] % lastNames.length]
  });
}

function parseDisplayAmount(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const normalized = value.replace(/,/g, "");
  const matches = normalized.match(/-?\d+(?:\.\d+)?/g);
  if (!matches || matches.length !== 1) return null;
  const amount = Number(matches[0]);
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

function remoteSnapshot(task) {
  return JSON.stringify(task);
}

function taskContractProblem(task, execution, snapshot) {
  if (task.clientOrderId !== execution.client_order_id) return "REMOTE_CLIENT_ORDER_MISMATCH";
  if (task.planId && task.planId !== snapshot.externalPlanId) return "REMOTE_PLAN_MISMATCH";
  if (task.checkoutCountry && task.checkoutCountry.toUpperCase() !== snapshot.regionCode) {
    return "REMOTE_REGION_MISMATCH";
  }
  return null;
}

function priceProblem(task, snapshot) {
  if (task.status !== "succeeded") return null;
  const currency = task.pricing.currency || task.checkoutCurrency;
  const total = parseDisplayAmount(task.pricing.displayTotal);
  if (!task.pricing.confirmed) return "REMOTE_PRICE_NOT_CONFIRMED";
  if (currency !== snapshot.currency) return "REMOTE_PRICE_CURRENCY_MISMATCH";
  if (snapshot.adapterKey === "efun_open_v1" && task.pricing.amountUnavailable === true) return null;
  if (total === null) return "REMOTE_PRICE_UNREADABLE";
  if (total < snapshot.expectedMinAmount || total > snapshot.expectedMaxAmount) {
    return "REMOTE_PRICE_OUT_OF_RANGE";
  }
  return null;
}

function requestId(execution) {
  return `kwa:${execution.id}:${execution.attempt_count}`.slice(0, 80);
}

export function createAutomationRunner(options = {}) {
  const {
    db,
    decryptText,
    encryptText,
    workerId = `automation-worker-${process.pid}`,
    fetchImpl,
    efuncardProxyUrl,
    efunAutomationProxyUrl,
    lookup,
    audit = () => {},
    notify = () => {},
    now = () => new Date(),
    prepareCard = prepareAutomationCard,
    adapterFactory = createAutomationAdapter,
    providerSync = syncAutomationProvider
  } = options;
  if (!db || typeof decryptText !== "function" || typeof encryptText !== "function") {
    throw new TypeError("自动化 Runner 配置不完整");
  }
  let running = false;

  const writeAudit = (action, execution, detail = null) => {
    audit(action, "automation_execution", execution?.id || null, detail);
  };
  const emitAlert = (kind, execution, detail = null) => {
    Promise.resolve(notify({
      kind,
      executionId: execution?.id || null,
      orderNo: execution?.order_no || null,
      detail
    })).catch((error) => {
      writeAudit("automation.notification_failed", execution, {
        kind,
        message: boundedError(error?.message, "自动化告警发送失败")
      });
    });
  };

  function settings() {
    return db.prepare("SELECT * FROM automation_fulfillment_settings WHERE id = 'default'").get();
  }

  function gateEnabled() {
    const row = settings();
    return row?.payment_gate_enabled === 1 && row?.mode === "automatic";
  }

  function releaseLock(executionId) {
    db.prepare(`
      UPDATE automation_executions SET locked_at = NULL, locked_by = NULL
      WHERE id = ? AND locked_by = ?
    `).run(executionId, workerId);
  }

  function claimDue(at) {
    const staleAt = addSeconds(at, -LOCK_TIMEOUT_SECONDS);
    return db.transaction(() => {
      const row = db.prepare(`
        SELECT * FROM automation_executions
        WHERE status IN (${placeholders(CLAIMABLE_STATUSES)})
          AND (next_action_at IS NULL OR next_action_at <= ?)
          AND (locked_at IS NULL OR locked_at <= ?)
        ORDER BY COALESCE(next_action_at, created_at), created_at, id
        LIMIT 1
      `).get(...CLAIMABLE_STATUSES, at, staleAt);
      if (!row) return null;
      const changed = db.prepare(`
        UPDATE automation_executions SET locked_at = ?, locked_by = ?
        WHERE id = ? AND (locked_at IS NULL OR locked_at <= ?)
      `).run(at, workerId, row.id, staleAt).changes;
      return changed ? db.prepare("SELECT * FROM automation_executions WHERE id = ?").get(row.id) : null;
    }).immediate();
  }

  function schedule(execution, seconds, fields = {}) {
    const at = iso(now());
    const nextAt = addSeconds(at, seconds);
    db.prepare(`
      UPDATE automation_executions
      SET status = COALESCE(?, status), public_message = COALESCE(?, public_message),
          last_error_code = ?, last_error_message = ?, next_action_at = ?, updated_at = ?
      WHERE id = ?
    `).run(
      fields.status || null,
      fields.publicMessage || null,
      fields.errorCode || null,
      fields.errorMessage || null,
      nextAt,
      at,
      execution.id
    );
  }

  function openCircuit(providerId, reason, at, pauseProvider = false) {
    db.prepare(`
      UPDATE automation_providers
      SET circuit_state = 'open', circuit_reason = ?, circuit_opened_at = ?,
          status = CASE WHEN ? = 1 THEN 'paused' ELSE status END,
          consecutive_failures = consecutive_failures + 1, updated_at = ?, updated_by = 'worker'
      WHERE id = ?
    `).run(reason, at, pauseProvider ? 1 : 0, at, providerId);
  }

  function recordProviderFailure(providerId, reason, at) {
    const provider = db.prepare(`
      SELECT consecutive_failures FROM automation_providers WHERE id = ?
    `).get(providerId);
    if (!provider) return;
    const failures = Number(provider.consecutive_failures || 0) + 1;
    db.prepare(`
      UPDATE automation_providers
      SET consecutive_failures = ?,
          circuit_state = CASE WHEN ? >= 3 THEN 'open' ELSE circuit_state END,
          circuit_reason = CASE WHEN ? >= 3 THEN ? ELSE circuit_reason END,
          circuit_opened_at = CASE WHEN ? >= 3 THEN COALESCE(circuit_opened_at, ?) ELSE circuit_opened_at END,
          updated_at = ? WHERE id = ?
    `).run(failures, failures, failures, reason, failures, at, at, providerId);
  }

  function pauseMapping(mappingId, reason, at) {
    db.prepare(`
      UPDATE automation_product_mappings
      SET enabled = 0, paused_reason = ?, revision = revision + 1,
          updated_at = ?, updated_by = 'worker' WHERE id = ?
    `).run(reason, at, mappingId);
  }

  function markManualReview(execution, code, message, task = null) {
    const at = iso(now());
    db.transaction(() => {
      db.prepare(`
        UPDATE automation_executions
        SET status = 'manual_review', remote_task_id = COALESCE(?, remote_task_id),
            remote_status = COALESCE(?, remote_status),
            current_phase = COALESCE(?, current_phase), public_message = '人工核验中',
            remote_snapshot = COALESCE(?, remote_snapshot), card_brand = COALESCE(?, card_brand),
            card_last4 = COALESCE(?, card_last4), last_error_code = ?, last_error_message = ?,
            card_reservation_state = CASE WHEN card_id IS NULL THEN card_reservation_state ELSE 'manual_review' END,
            manual_review_alerted_at = COALESCE(manual_review_alerted_at, ?),
            next_action_at = NULL, locked_at = NULL, locked_by = NULL, updated_at = ?
        WHERE id = ?
      `).run(
        task?.id || null,
        task?.status || null,
        task?.currentPhase || null,
        task ? remoteSnapshot(task) : null,
        task?.card?.brand || null,
        task?.card?.last4 || null,
        code,
        boundedError(message),
        at,
        at,
        execution.id
      );
      db.prepare(`
        UPDATE automation_card_reservations SET state = 'manual_review'
        WHERE execution_id = ? AND state = 'reserved'
      `).run(execution.id);
      db.prepare(`
        UPDATE automation_execution_attempts
        SET status = 'manual_review', remote_task_id = COALESCE(?, remote_task_id),
            error_code = ?, error_message = ?, updated_at = ?
        WHERE execution_id = ? AND attempt_no = ?
      `).run(task?.id || null, code, boundedError(message), at, execution.id, execution.attempt_count);
    }).immediate();
    writeAudit("automation.manual_review", execution, { code, message: boundedError(message) });
    emitAlert("manual_review", execution, { code });
  }

  function completeAttempt(execution, task, status) {
    const at = iso(now());
    db.prepare(`
      UPDATE automation_execution_attempts
      SET status = ?, remote_task_id = COALESCE(remote_task_id, ?),
          error_code = ?, error_message = ?, updated_at = ?
      WHERE execution_id = ? AND attempt_no = ?
    `).run(
      status,
      task.id,
      task.error?.code || null,
      task.error?.message || null,
      at,
      execution.id,
      execution.attempt_count
    );
  }

  function persistRemoteTask(execution, task) {
    const at = iso(now());
    db.prepare(`
      UPDATE automation_executions
      SET remote_task_id = ?, remote_status = ?, current_phase = ?,
          remote_snapshot = ?, card_brand = COALESCE(?, card_brand),
          card_last4 = COALESCE(?, card_last4), pricing_currency = ?,
          pricing_total = ?, pricing_confirmed = ?, poll_failure_count = 0,
          accepted_at = COALESCE(accepted_at, ?), updated_at = ?
      WHERE id = ?
    `).run(
      task.id,
      task.status,
      task.currentPhase,
      remoteSnapshot(task),
      task.card.brand,
      task.card.last4,
      task.pricing.currency || task.checkoutCurrency,
      task.pricing.displayTotal,
      task.pricing.confirmed ? 1 : 0,
      at,
      at,
      execution.id
    );
    db.prepare(`
      UPDATE automation_execution_attempts
      SET status = 'accepted', remote_task_id = ?, error_code = NULL,
          error_message = NULL, updated_at = ?
      WHERE execution_id = ? AND attempt_no = ?
    `).run(task.id, at, execution.id, execution.attempt_count);
  }

  function processRemoteTask(execution, task) {
    const snapshot = parseJson(execution.mapping_snapshot);
    const contractCode = taskContractProblem(task, execution, snapshot);
    if (contractCode) {
      const at = iso(now());
      openCircuit(execution.provider_id, contractCode, at, true);
      markManualReview(execution, contractCode, "远端任务身份与本地订单不一致", task);
      return;
    }
    const acceptedAt = Date.parse(execution.accepted_at || "");
    const renewalCancellationOverdue = task.status === "running"
      && task.currentPhase === "renewal_cancellation"
      && task.renewalStatus?.verified === true
      && task.renewalStatus?.willRenew === true
      && Number.isFinite(acceptedAt)
      && now().getTime() - acceptedAt >= LONG_RUNNING_ALERT_SECONDS * 1000;
    if (renewalCancellationOverdue) {
      markManualReview(
        execution,
        "AUTOMATION_RENEWAL_CANCELLATION_REQUIRED",
        "会员已开通，但自动续费仍未关闭，请人工处理",
        task
      );
      return;
    }
    persistRemoteTask(execution, task);
    if (["queued", "running"].includes(task.status)) {
      const at = iso(now());
      db.prepare(`
        UPDATE automation_providers SET consecutive_failures = 0, updated_at = ? WHERE id = ?
      `).run(at, execution.provider_id);
      db.prepare(`
        UPDATE automation_executions
        SET status = ?, public_message = '处理中', next_action_at = ?,
            last_error_code = NULL, last_error_message = NULL, updated_at = ? WHERE id = ?
      `).run(task.status, addSeconds(at, 3), at, execution.id);
      return;
    }
    if (task.status === "manual_review") {
      markManualReview(
        execution,
        task.error?.code || "REMOTE_MANUAL_REVIEW",
        task.error?.message || task.message || "远端任务需要人工核验",
        task
      );
      return;
    }
    completeAttempt(execution, task, task.status);
    if (task.status === "succeeded") {
      const anomaly = priceProblem(task, snapshot);
      settleAutomationExecution(db, execution.id, "succeeded", { at: iso(now()) });
      if (anomaly) {
        const at = iso(now());
        pauseMapping(execution.mapping_id, anomaly, at);
        openCircuit(execution.provider_id, anomaly, at, false);
        writeAudit("automation.price_anomaly", execution, {
          code: anomaly,
          currency: task.pricing.currency || task.checkoutCurrency,
          total: task.pricing.displayTotal
        });
        emitAlert("price_anomaly", execution, { code: anomaly });
      } else {
        db.prepare(`
          UPDATE automation_providers
          SET consecutive_failures = 0, updated_at = ? WHERE id = ?
        `).run(iso(now()), execution.provider_id);
      }
      writeAudit("automation.succeeded", execution, { remoteTaskId: task.id });
      return;
    }
    settleAutomationExecution(db, execution.id, task.status, {
      code: task.error?.code || `REMOTE_${task.status.toUpperCase()}`,
      message: task.error?.message || task.message || "远端自动化任务失败",
      at: iso(now())
    });
    writeAudit("automation.failed", execution, {
      remoteTaskId: task.id,
      status: task.status,
      code: task.error?.code || null
    });
  }

  function providerCapacityAvailable(providerId) {
    const provider = db.prepare("SELECT * FROM automation_providers WHERE id = ?").get(providerId);
    if (!provider) return false;
    const active = db.prepare(`
      SELECT COUNT(*) AS count FROM automation_executions
      WHERE provider_id = ? AND status IN (${placeholders(PROVIDER_BUSY_STATUSES)})
        AND NOT (
          (
            status = 'running'
            AND current_phase = 'renewal_cancellation'
            AND json_valid(remote_snapshot) = 1
            AND json_extract(remote_snapshot, '$.renewalStatus.verified') = 1
            AND json_extract(remote_snapshot, '$.renewalStatus.willRenew') = 1
          ) OR (
            status = 'manual_review'
            AND last_error_code = 'AUTOMATION_RENEWAL_CANCELLATION_REQUIRED'
          )
        )
    `).get(providerId, ...PROVIDER_BUSY_STATUSES).count;
    return Number(active) < Math.max(1, Number(provider.max_concurrency || 1));
  }

  function dailyRiskUsed(mappingId, at) {
    const day = at.slice(0, 10);
    const rows = db.prepare(`
      SELECT mapping_snapshot FROM automation_executions
      WHERE mapping_id = ? AND substr(created_at, 1, 10) = ?
        AND status NOT IN ('failed', 'cancelled', 'waiting_gate', 'waiting_mapping')
    `).all(mappingId, day);
    return rows.reduce((sum, row) => {
      const snapshot = parseJson(row.mapping_snapshot);
      if (!snapshot) return sum;
      return sum + automationRiskAllocationUsd({
        funding_amount_usd: snapshot.fundingAmountUsd,
        card_capacity: snapshot.cardCapacity
      });
    }, 0);
  }

  function reservationCompatible(execution, mapping) {
    const reservation = db.prepare(`
      SELECT * FROM automation_card_reservations WHERE execution_id = ?
    `).get(execution.id);
    if (!reservation) return true;
    if (reservation.provider_key !== mapping.card_platform_key
      || reservation.capacity_key !== mapping.capacity_key) return false;
    if (!reservation.card_id && reservation.planned_product_code !== mapping.card_product_code) return false;
    if (reservation.card_id && mapping.card_product_code) {
      const card = db.prepare("SELECT product_code FROM managed_cards WHERE id = ?").get(reservation.card_id);
      if (!card || card.product_code !== mapping.card_product_code) return false;
    }
    const intent = db.prepare(`
      SELECT operation, target_card_id, amount_usd
      FROM automation_funding_intents WHERE execution_id = ?
      ORDER BY intent_no DESC LIMIT 1
    `).get(execution.id);
    if (intent?.operation === "recharge") {
      const attempt = db.prepare(`
        SELECT mapping_snapshot FROM automation_execution_attempts
        WHERE execution_id = ? AND mapping_id = ?
        ORDER BY attempt_no DESC LIMIT 1
      `).get(execution.id, mapping.id);
      const snapshot = parseJson(attempt?.mapping_snapshot);
      return intent.target_card_id === reservation.card_id
        && Number(snapshot?.cardCapacity) === Number(mapping.card_capacity)
        && Number(mapping.funding_amount_usd) <= Number(snapshot?.fundingAmountUsd);
    }
    return !intent || Number(mapping.funding_amount_usd) <= Number(intent.amount_usd);
  }

  function routeExecution(execution) {
    const at = iso(now());
    const ttl = Math.max(60, Number(settings()?.config_ttl_seconds || 300));
    const freshAfter = addSeconds(at, -ttl);
    const rows = db.prepare(`
      SELECT mapping.*, provider.name AS provider_name, provider.adapter_key,
             provider.config_hash, provider.config_synced_at,
             provider.current_credential_id, provider.status AS provider_status,
             provider.circuit_state
      FROM automation_product_mappings mapping
      JOIN automation_providers provider ON provider.id = mapping.provider_id
      WHERE mapping.product_id = ? AND mapping.enabled = 1
        AND mapping.paused_reason IS NULL
        AND provider.status = 'active' AND provider.circuit_state = 'closed'
        AND provider.config_status = 'ready' AND provider.config_synced_at >= ?
        AND provider.current_credential_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM automation_execution_attempts attempt
          WHERE attempt.execution_id = ? AND attempt.mapping_id = mapping.id
            AND (
              attempt.status <> 'not_created'
              OR NOT EXISTS (
                SELECT 1 FROM admin_audit_logs retry
                WHERE retry.action = 'automation.execution.retry_requested'
                  AND retry.resource_type = 'automation_execution'
                  AND retry.resource_id = ?
                  AND retry.created_at >= attempt.updated_at
              )
            )
        )
      ORDER BY mapping.priority, mapping.updated_at, mapping.id
    `).all(execution.product_id, freshAfter, execution.id, execution.id);
    const mapping = rows.find((row) => reservationCompatible(execution, row)
      && providerCapacityAvailable(row.provider_id)
      && dailyRiskUsed(row.id, at) + automationRiskAllocationUsd(row) <= Number(row.daily_risk_limit_usd));
    if (!mapping) {
      schedule(execution, 15, { status: "waiting_mapping", publicMessage: "等待处理" });
      return;
    }
    const provider = {
      id: mapping.provider_id,
      name: mapping.provider_name,
      adapter_key: mapping.adapter_key,
      config_hash: mapping.config_hash
    };
    const snapshot = mappingSnapshot(mapping, provider);
    const attemptNo = Number(execution.attempt_count || 0) + 1;
    const clientOrderId = attemptNo === 1 ? execution.order_no : `${execution.order_no}-${attemptNo}`;
    db.transaction(() => {
      db.prepare(`
        INSERT INTO automation_execution_attempts (
          id, execution_id, attempt_no, mapping_id, provider_id, credential_id,
          client_order_id, status, mapping_snapshot, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'selected', ?, ?, ?)
      `).run(
        `aea_${randomUUID()}`,
        execution.id,
        attemptNo,
        mapping.id,
        mapping.provider_id,
        mapping.current_credential_id,
        clientOrderId,
        JSON.stringify(snapshot),
        at,
        at
      );
      db.prepare(`
        UPDATE automation_executions
        SET status = 'preparing_card', mapping_id = ?, provider_id = ?, credential_id = ?,
            client_order_id = ?, remote_task_id = NULL, remote_status = NULL,
            current_phase = 'preparing_card', public_message = '处理中',
            mapping_snapshot = ?, remote_snapshot = NULL, attempt_count = ?,
            poll_failure_count = 0, last_error_code = NULL, last_error_message = NULL,
            next_action_at = ?, updated_at = ? WHERE id = ?
      `).run(
        mapping.id,
        mapping.provider_id,
        mapping.current_credential_id,
        clientOrderId,
        JSON.stringify(snapshot),
        attemptNo,
        at,
        at,
        execution.id
      );
    }).immediate();
  }

  async function prepareExecutionCard(execution) {
    const snapshot = parseJson(execution.mapping_snapshot);
    const mapping = mappingFromSnapshot(snapshot);
    try {
      const { adapter } = adapterFactory(db, {
        providerId: execution.provider_id,
        credentialId: execution.credential_id,
        decryptText,
        fetchImpl,
        lookup,
        efunAutomationProxyUrl
      });
      if (typeof adapter.prepareAccount === "function") {
        const order = db.prepare("SELECT session_payload FROM redeem_orders WHERE id = ?").get(execution.order_id);
        let authSessionJson;
        try {
          authSessionJson = JSON.parse(decryptText(order?.session_payload || ""));
        } catch {
          throw new AutomationAdapterError("AUTOMATION_SESSION_UNAVAILABLE", "订单 Session 无法读取", {
            retryable: false
          });
        }
        await adapter.prepareAccount({
          authSessionJson,
          checkoutCountry: snapshot.regionCode
        });
      }
      await prepareCard(db, {
        execution,
        mapping,
        decryptText,
        encryptText,
        fetchImpl,
        efuncardProxyUrl,
        getCardholder: () => deterministicCardholder(execution.order_no),
        at: iso(now())
      });
      const at = iso(now());
      db.prepare(`
        UPDATE automation_executions
        SET status = 'submitting', current_phase = 'submitting', public_message = '处理中',
            next_action_at = ?, last_error_code = NULL, last_error_message = NULL, updated_at = ?
        WHERE id = ?
      `).run(at, at, execution.id);
      db.prepare(`
        UPDATE automation_execution_attempts SET status = 'card_ready', updated_at = ?
        WHERE execution_id = ? AND attempt_no = ?
      `).run(at, execution.id, execution.attempt_count);
    } catch (error) {
      if (error instanceof AutomationAdapterError && error.requestNotSent) {
        const retryAfter = Number(error.retryAfterSeconds);
        schedule(execution, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 30, {
          status: "preparing_card",
          publicMessage: "等待处理",
          errorCode: error.code,
          errorMessage: boundedError(error.message)
        });
        return;
      }
      if (error instanceof AutomationFundingError && error.unknownOutcome) {
        markManualReview(execution, error.code, error.message);
        return;
      }
      if (error instanceof AutomationFundingError && error.retryable) {
        const intent = db.prepare(`
          SELECT state FROM automation_funding_intents
          WHERE execution_id = ? ORDER BY intent_no DESC LIMIT 1
        `).get(execution.id);
        if (intent && intent.state !== "prepared") {
          settleAutomationExecution(db, execution.id, "failed", {
            code: error?.code || "AUTOMATION_CARD_PREPARATION_FAILED",
            message: boundedError(error?.message, "卡片准备失败"),
            at: iso(now())
          });
          writeAudit("automation.card_failed", execution, { code: error?.code || null });
          return;
        }
        const retryAfter = Number(error.retryAfterSeconds);
        schedule(execution, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 30, {
          status: "waiting_capacity",
          publicMessage: "等待处理",
          errorCode: error.code,
          errorMessage: boundedError(error.message)
        });
        return;
      }
      settleAutomationExecution(db, execution.id, "failed", {
        code: error?.code || "AUTOMATION_CARD_PREPARATION_FAILED",
        message: boundedError(error?.message, "卡片准备失败"),
        at: iso(now())
      });
      writeAudit("automation.card_failed", execution, { code: error?.code || null });
    }
  }

  function markDefinitelyNotCreated(execution, error) {
    const at = iso(now());
    const code = error.code || "AUTOMATION_NOT_CREATED";
    db.transaction(() => {
      db.prepare(`
        UPDATE automation_execution_attempts
        SET status = 'not_created', error_code = ?, error_message = ?, updated_at = ?
        WHERE execution_id = ? AND attempt_no = ?
      `).run(code, boundedError(error.message), at, execution.id, execution.attempt_count);
      db.prepare(`
        UPDATE automation_executions
        SET status = 'waiting_mapping', mapping_id = NULL, provider_id = NULL,
            credential_id = NULL, client_order_id = NULL, remote_task_id = NULL,
            remote_status = NULL, current_phase = 'routing', public_message = '等待处理',
            mapping_snapshot = NULL, remote_snapshot = NULL,
            last_error_code = ?, last_error_message = ?, next_action_at = ?, updated_at = ?
        WHERE id = ?
      `).run(code, boundedError(error.message), at, at, execution.id);
    }).immediate();
    const providerCode = error.providerCode || "";
    if (code === "AUTOMATION_POINTS_INSUFFICIENT") {
      pauseMapping(execution.mapping_id, code, at);
      openCircuit(execution.provider_id, code, at, true);
    } else if ([401, 403].includes(Number(error.statusCode))
      || ["automate_key_invalid", "automate_key_required"].includes(providerCode)) {
      openCircuit(execution.provider_id, providerCode || code, at, true);
    } else if (["automate_plan_disabled", "automate_region_disabled", "automate_plan_invalid", "automate_region_invalid"]
      .includes(providerCode)) {
      pauseMapping(execution.mapping_id, providerCode, at);
    }
    writeAudit("automation.task_not_created", execution, { code, providerCode: providerCode || null });
  }

  function replaceExhaustedCard(execution, error) {
    const snapshot = parseJson(execution.mapping_snapshot);
    const reservation = db.prepare(`
      SELECT * FROM automation_card_reservations WHERE execution_id = ?
    `).get(execution.id);
    const intents = db.prepare(`
      SELECT operation, state FROM automation_funding_intents
      WHERE execution_id = ? ORDER BY intent_no
    `).all(execution.id);
    if (snapshot?.adapterKey !== "spacex_gpt_direct_v1"
      || snapshot.cardPlatformKey !== "spacexcard"
      || !snapshot.cardProductCode
      || !reservation?.card_id
      || reservation.state !== "reserved"
      || intents.some((intent) => intent.state !== "succeeded")
      || intents.some((intent) => intent.operation === "open")) {
      markManualReview(
        execution,
        "SPACEX_GPT_CARD_REPLACEMENT_UNSAFE",
        "卡片额度已满，但当前资金或卡片状态不允许自动换卡"
      );
      return;
    }
    const at = iso(now());
    const oldCardId = reservation.card_id;
    db.transaction(() => {
      db.prepare(`
        UPDATE managed_cards
        SET consumed_slots = MAX(consumed_slots, ?), capacity_state = 'CAPACITY_FULL', updated_at = ?
        WHERE id = ?
      `).run(Number(snapshot.cardCapacity), at, oldCardId);
      db.prepare(`
        UPDATE automation_card_reservations
        SET card_id = NULL, planned_product_code = ?, slot_index = NULL,
            state = 'reserved', reserved_at = ?, consumed_at = NULL, released_at = NULL
        WHERE id = ?
      `).run(snapshot.cardProductCode, at, reservation.id);
      db.prepare(`
        UPDATE automation_execution_attempts
        SET status = 'selected', error_code = ?, error_message = ?, updated_at = ?
        WHERE execution_id = ? AND attempt_no = ?
      `).run(
        "SPACEX_GPT_CARD_EXHAUSTED",
        boundedError(error?.message, "卡片直充额度已满"),
        at,
        execution.id,
        execution.attempt_count
      );
      db.prepare(`
        UPDATE automation_executions
        SET status = 'preparing_card', current_phase = 'opening_replacement_card',
            public_message = '处理中', card_id = NULL, card_last4 = NULL,
            card_reservation_state = 'reserved', remote_task_id = NULL,
            remote_status = NULL, remote_snapshot = NULL, poll_failure_count = 0,
            last_error_code = 'SPACEX_GPT_CARD_EXHAUSTED', last_error_message = ?,
            next_action_at = ?, updated_at = ?
        WHERE id = ?
      `).run(boundedError(error?.message, "卡片直充额度已满"), at, at, execution.id);
    }).immediate();
    writeAudit("automation.card_replacement_planned", execution, {
      reason: "SPACEX_GPT_CARD_EXHAUSTED"
    });
  }

  function createBackoff(execution) {
    const failures = Number(execution.poll_failure_count || 0) + 1;
    const attempt = db.prepare(`
      SELECT created_at FROM automation_execution_attempts
      WHERE execution_id = ? AND attempt_no = ?
    `).get(execution.id, execution.attempt_count);
    const ageSeconds = (now().getTime() - new Date(attempt?.created_at || execution.created_at).getTime()) / 1000;
    return ageSeconds >= LONG_RUNNING_ALERT_SECONDS
      ? 60
      : POLL_BACKOFF_SECONDS[Math.min(failures - 1, POLL_BACKOFF_SECONDS.length - 1)];
  }

  function recordAmbiguousCreate(execution, error) {
    const at = iso(now());
    const failures = Number(execution.poll_failure_count || 0) + 1;
    const delay = createBackoff(execution);
    const attempt = db.prepare(`
      SELECT created_at FROM automation_execution_attempts
      WHERE execution_id = ? AND attempt_no = ?
    `).get(execution.id, execution.attempt_count);
    const overdue = now().getTime() - new Date(attempt?.created_at || execution.created_at).getTime()
      >= LONG_RUNNING_ALERT_SECONDS * 1000;
    const alertNow = overdue && !execution.delayed_alerted_at;
    db.prepare(`
      UPDATE automation_executions
      SET status = 'submit_unknown', public_message = '人工核验中',
          last_error_code = ?, last_error_message = ?, poll_failure_count = ?,
          next_action_at = ?, delayed_alerted_at = CASE WHEN ? = 1 THEN ? ELSE delayed_alerted_at END,
          updated_at = ? WHERE id = ?
    `).run(
      error.code || "AUTOMATION_SUBMIT_UNKNOWN",
      boundedError(error.message),
      failures,
      addSeconds(at, delay),
      alertNow ? 1 : 0,
      at,
      at,
      execution.id
    );
    db.prepare(`
      UPDATE automation_execution_attempts
      SET status = 'submit_unknown', error_code = ?, error_message = ?, updated_at = ?
      WHERE execution_id = ? AND attempt_no = ?
    `).run(error.code || "AUTOMATION_SUBMIT_UNKNOWN", boundedError(error.message), at,
      execution.id, execution.attempt_count);
    if (alertNow) {
      writeAudit("automation.submit_unknown_long_running", execution, {
        clientOrderId: execution.client_order_id
      });
      emitAlert("long_running", execution, { phase: "submit_unknown" });
    }
    recordProviderFailure(execution.provider_id, error.code || "AUTOMATION_SUBMIT_UNKNOWN", at);
  }

  async function submitExecution(execution) {
    const snapshot = parseJson(execution.mapping_snapshot);
    const mapping = mappingFromSnapshot(snapshot);
    if (!execution.remote_task_id
      && snapshot.adapterKey === "spacex_gpt_direct_v1"
      && isSpaceXGptCardUnavailableMessage(execution.last_error_message)) {
      replaceExhaustedCard(execution, {
        message: execution.last_error_message
      });
      return;
    }
    const order = db.prepare("SELECT session_payload FROM redeem_orders WHERE id = ?").get(execution.order_id);
    let authSessionJson;
    try {
      authSessionJson = JSON.parse(decryptText(order?.session_payload || ""));
    } catch {
      settleAutomationExecution(db, execution.id, "failed", {
        code: "AUTOMATION_SESSION_UNAVAILABLE",
        message: "订单 Session 无法读取",
        at: iso(now())
      });
      return;
    }
    try {
      const prepared = await prepareCard(db, {
        execution,
        mapping,
        decryptText,
        encryptText,
        fetchImpl,
        efuncardProxyUrl,
        getCardholder: () => deterministicCardholder(execution.order_no),
        at: iso(now())
      });
      const { adapter } = adapterFactory(db, {
        providerId: execution.provider_id,
        credentialId: execution.credential_id,
        decryptText,
        fetchImpl,
        lookup,
        efunAutomationProxyUrl
      });
      const attempt = db.prepare(`
        SELECT status FROM automation_execution_attempts
        WHERE execution_id = ? AND attempt_no = ?
      `).get(execution.id, execution.attempt_count);
      if (adapter.createReplaySafe === false && attempt?.status === "submit_started") {
        markManualReview(
          execution,
          "AUTOMATION_SUBMIT_OUTCOME_UNKNOWN",
          "当前站点协议不支持幂等重放，已停止自动重提"
        );
        return;
      }
      const submittedAt = iso(now());
      db.transaction(() => {
        db.prepare(`
          UPDATE automation_execution_attempts
          SET status = 'submit_started', updated_at = ?
          WHERE execution_id = ? AND attempt_no = ?
        `).run(submittedAt, execution.id, execution.attempt_count);
        db.prepare(`
          UPDATE automation_executions SET current_phase = 'remote_submit_started', updated_at = ?
          WHERE id = ?
        `).run(submittedAt, execution.id);
      }).immediate();
      const result = await adapter.createTask({
        clientOrderId: execution.client_order_id,
        planId: snapshot.externalPlanId,
        checkoutCountry: snapshot.regionCode,
        authSessionJson,
        card: prepared.material,
        cardProviderKey: prepared.card.provider_key,
        providerCardId: prepared.card.upstream_card_id,
        requestId: requestId(execution)
      });
      processRemoteTask(execution, result.task);
    } catch (error) {
      if (error instanceof AutomationAdapterError && error.cardUnavailable) {
        replaceExhaustedCard(execution, error);
        return;
      }
      if (error instanceof AutomationAdapterError && error.definitelyNotCreated) {
        markDefinitelyNotCreated(execution, error);
        return;
      }
      if (error instanceof AutomationAdapterError && error.requestNotSent) {
        const retryAt = iso(now());
        db.prepare(`
          UPDATE automation_execution_attempts
          SET status = 'card_ready', error_code = ?, error_message = ?, updated_at = ?
          WHERE execution_id = ? AND attempt_no = ?
        `).run(error.code, boundedError(error.message), retryAt, execution.id, execution.attempt_count);
        const retryAfter = Number(error.retryAfterSeconds);
        schedule(execution, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 30, {
          status: "submitting",
          publicMessage: "等待处理",
          errorCode: error.code,
          errorMessage: boundedError(error.message)
        });
        return;
      }
      if (error instanceof AutomationAdapterError && error.unsafeToReplay) {
        markManualReview(
          execution,
          "AUTOMATION_SUBMIT_OUTCOME_UNKNOWN",
          "远端创建结果不明确且当前协议不支持幂等重放"
        );
        return;
      }
      if (error instanceof AutomationFundingError) {
        if (error.unknownOutcome) markManualReview(execution, error.code, error.message);
        else settleAutomationExecution(db, execution.id, "failed", {
          code: error.code,
          message: boundedError(error.message),
          at: iso(now())
        });
        return;
      }
      recordAmbiguousCreate(execution, error);
    }
  }

  async function pollExecution(execution) {
    try {
      const { adapter } = adapterFactory(db, {
        providerId: execution.provider_id,
        credentialId: execution.credential_id,
        decryptText,
        fetchImpl,
        lookup,
        efunAutomationProxyUrl
      });
      const snapshot = parseJson(execution.mapping_snapshot);
      const result = await adapter.getTask(execution.remote_task_id, {
        clientOrderId: execution.client_order_id,
        planId: snapshot?.externalPlanId,
        checkoutCountry: snapshot?.regionCode,
        cardLast4: execution.card_last4
      });
      processRemoteTask(execution, result.task);
    } catch (error) {
      const at = iso(now());
      const providerCode = error?.providerCode || "";
      if (error instanceof AutomationAdapterError
        && (error.statusCode === 404 || providerCode === "automate_task_not_found")) {
        markManualReview(execution, "REMOTE_TASK_NOT_FOUND", "已受理的远端任务无法查询");
        return;
      }
      if (error instanceof AutomationAdapterError
        && ([401, 403].includes(Number(error.statusCode))
          || ["automate_key_invalid", "automate_key_required"].includes(providerCode))) {
        openCircuit(execution.provider_id, providerCode || error.code, at, true);
      } else {
        recordProviderFailure(execution.provider_id, error?.code || "AUTOMATION_QUERY_FAILED", at);
      }
      const failures = Number(execution.poll_failure_count || 0) + 1;
      const acceptedAt = new Date(execution.accepted_at || execution.updated_at).getTime();
      const overdue = Number.isFinite(acceptedAt) && now().getTime() - acceptedAt >= LONG_RUNNING_ALERT_SECONDS * 1000;
      const alertNow = overdue && !execution.delayed_alerted_at;
      db.prepare(`
        UPDATE automation_executions
        SET poll_failure_count = ?, last_error_code = ?, last_error_message = ?,
            next_action_at = ?, delayed_alerted_at = CASE WHEN ? = 1 THEN ? ELSE delayed_alerted_at END,
            updated_at = ? WHERE id = ?
      `).run(
        failures,
        error?.code || "AUTOMATION_QUERY_FAILED",
        boundedError(error?.message),
        addSeconds(at, overdue ? 60 : POLL_BACKOFF_SECONDS[Math.min(failures - 1, POLL_BACKOFF_SECONDS.length - 1)]),
        alertNow ? 1 : 0,
        at,
        at,
        execution.id
      );
      if (alertNow) {
        writeAudit("automation.long_running", execution, { remoteTaskId: execution.remote_task_id });
        emitAlert("long_running", execution, { phase: execution.status });
      }
    }
  }

  async function syncOneStaleProvider() {
    const at = iso(now());
    const configTtlSeconds = Math.max(60, Number(settings()?.config_ttl_seconds || 300));
    const staleBefore = addSeconds(at, -configTtlSeconds);
    const failedRetryBefore = addSeconds(at, -60);
    const row = db.prepare(`
      SELECT provider.* FROM automation_providers provider
      WHERE provider.status = 'active'
        AND provider.current_credential_id IS NOT NULL
        AND (
          provider.config_synced_at IS NULL
          OR provider.config_synced_at <= ?
        )
        AND (provider.config_status <> 'failed' OR provider.updated_at <= ?)
      ORDER BY COALESCE(provider.config_synced_at, ''), provider.id LIMIT 1
    `).get(staleBefore, failedRetryBefore);
    if (!row) return false;
    try {
      await providerSync(db, {
        providerId: row.id,
        decryptText,
        fetchImpl,
        lookup,
        efunAutomationProxyUrl,
        at
      });
    } catch (error) {
      if (error instanceof AutomationAdapterError
        && ([401, 403].includes(Number(error.statusCode))
          || ["automate_key_invalid", "automate_key_required"].includes(error.providerCode))) {
        openCircuit(row.id, error.providerCode || error.code, at, true);
      } else {
        const current = db.prepare(`
          SELECT consecutive_failures FROM automation_providers WHERE id = ?
        `).get(row.id);
        if (Number(current?.consecutive_failures || 0) >= 3 || error?.retryable === false) {
          openCircuit(row.id, error?.code || "AUTOMATION_CONFIG_SYNC_FAILED", at, false);
        }
      }
      writeAudit("automation.config_sync_failed", { id: row.id }, { code: error?.code || null });
    }
    return true;
  }

  async function advance(execution) {
    if (["waiting_gate", "waiting_mapping"].includes(execution.status)) {
      if (!gateEnabled()) {
        schedule(execution, 30, { status: "waiting_gate", publicMessage: "等待处理" });
        return;
      }
      routeExecution(execution);
      return;
    }
    if (["preparing_card", "waiting_capacity", "submitting", "submit_unknown"].includes(execution.status)
      && !gateEnabled()) {
      schedule(execution, 30, { publicMessage: "等待处理" });
      return;
    }
    if (["preparing_card", "waiting_capacity"].includes(execution.status)) {
      await prepareExecutionCard(execution);
      return;
    }
    if (["submitting", "submit_unknown"].includes(execution.status)) {
      await submitExecution(execution);
      return;
    }
    if (["queued", "running"].includes(execution.status)) await pollExecution(execution);
  }

  async function tick() {
    if (running) return false;
    running = true;
    let execution = null;
    try {
      if (await syncOneStaleProvider()) return true;
      execution = claimDue(iso(now()));
      if (!execution) return false;
      await advance(execution);
      return true;
    } finally {
      if (execution) releaseLock(execution.id);
      running = false;
    }
  }

  return Object.freeze({ tick });
}

export const automationRunnerInternals = Object.freeze({
  deterministicCardholder,
  mappingFromSnapshot,
  parseDisplayAmount,
  priceProblem,
  taskContractProblem
});
