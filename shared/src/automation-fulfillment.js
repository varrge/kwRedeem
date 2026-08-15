import { randomUUID } from "node:crypto";
import { cdkeyStatuses, orderStatuses } from "./constants.js";

export const automationExecutionStatuses = Object.freeze([
  "waiting_gate",
  "waiting_mapping",
  "waiting_capacity",
  "preparing_card",
  "submitting",
  "submit_unknown",
  "queued",
  "running",
  "manual_review",
  "manual_hold",
  "succeeded",
  "failed",
  "cancelled"
]);

const TERMINAL = new Set(["succeeded", "failed", "cancelled"]);

function iso(value = Date.now()) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new TypeError("时间无效");
  return date.toISOString();
}

function required(value, field, max = 200) {
  const result = typeof value === "string" ? value.trim() : "";
  if (!result || result.length > max) throw new TypeError(`${field} 无效`);
  return result;
}

function parseJson(value, fallback = null) {
  if (!value) return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

export function enrollAutomationOrder(db, input = {}) {
  const orderId = required(input.orderId, "orderId");
  const orderNo = required(input.orderNo, "orderNo", 120);
  const productId = required(input.productId, "productId");
  const at = iso(input.createdAt);
  return db.transaction(() => {
    const existing = db.prepare("SELECT * FROM automation_executions WHERE order_id = ?").get(orderId);
    if (existing) {
      if (existing.order_no !== orderNo || existing.product_id !== productId) {
        throw new Error("订单已有不一致的自动化履约记录");
      }
      return existing;
    }
    const excluded = db.prepare("SELECT reason_code FROM automation_order_exclusions WHERE order_no = ?").get(orderNo);
    const status = excluded ? "manual_hold" : "waiting_gate";
    const errorCode = excluded?.reason_code || null;
    const executionId = input.id || `afe_${randomUUID()}`;
    db.prepare(`
      INSERT INTO automation_executions (
        id, order_id, order_no, product_id, status, public_message,
        last_error_code, next_action_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      executionId,
      orderId,
      orderNo,
      productId,
      status,
      excluded ? "人工核验中" : "等待处理",
      errorCode,
      excluded ? null : at,
      at,
      at
    );
    return db.prepare("SELECT * FROM automation_executions WHERE id = ?").get(executionId);
  }).immediate();
}

export function serializeAutomationExecution(row, options = {}) {
  if (!row) return null;
  const admin = options.admin === true;
  const result = {
    id: row.id,
    orderNo: row.order_no,
    productId: row.product_id,
    status: row.status,
    publicStatus: row.status === "succeeded"
      ? "completed"
      : (["failed", "cancelled"].includes(row.status) ? "failed"
          : (["manual_review", "manual_hold", "submit_unknown"].includes(row.status) ? "manual_review" : "processing")),
    message: row.public_message || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at || null
  };
  if (!admin) return result;
  return {
    ...result,
    mappingId: row.mapping_id || null,
    providerId: row.provider_id || null,
    credentialId: row.credential_id || null,
    clientOrderId: row.client_order_id || null,
    remoteTaskId: row.remote_task_id || null,
    remoteStatus: row.remote_status || null,
    currentPhase: row.current_phase || null,
    mappingSnapshot: parseJson(row.mapping_snapshot),
    remoteSnapshot: parseJson(row.remote_snapshot),
    cardId: row.card_id || null,
    cardBrand: row.card_brand || null,
    cardLast4: row.card_last4 || null,
    cardReservationState: row.card_reservation_state || null,
    pricingCurrency: row.pricing_currency || null,
    pricingTotal: row.pricing_total || null,
    pricingConfirmed: row.pricing_confirmed === null ? null : row.pricing_confirmed === 1,
    lastErrorCode: row.last_error_code || null,
    lastErrorMessage: row.last_error_message || null,
    attemptCount: Number(row.attempt_count || 0),
    pollFailureCount: Number(row.poll_failure_count || 0),
    nextActionAt: row.next_action_at || null,
    acceptedAt: row.accepted_at || null
  };
}

function releaseCardReservation(db, execution, at) {
  const reservation = db.prepare(`
    SELECT * FROM automation_card_reservations WHERE execution_id = ?
  `).get(execution.id);
  if (!reservation || reservation.state === "released") return;
  db.prepare(`
    UPDATE automation_card_reservations
    SET state = 'released', released_at = COALESCE(released_at, ?)
    WHERE id = ?
  `).run(at, reservation.id);
}

function consumeCardReservation(db, execution, at, allowNoCard = false) {
  const reservation = db.prepare(`
    SELECT * FROM automation_card_reservations WHERE execution_id = ?
  `).get(execution.id);
  if (!reservation) {
    if (allowNoCard) return;
    throw new Error("自动化订单成功但缺少卡片容量预留");
  }
  if (reservation.state === "consumed") return;
  if (!reservation.card_id) throw new Error("自动化订单成功但缺少卡片容量预留");
  db.prepare(`
    UPDATE automation_card_reservations
    SET state = 'consumed', consumed_at = COALESCE(consumed_at, ?)
    WHERE id = ?
  `).run(at, reservation.id);
  db.prepare(`
    UPDATE managed_cards
    SET consumed_slots = consumed_slots + 1,
        lane = COALESCE(lane, ?), updated_at = ?
    WHERE id = ?
  `).run(reservation.capacity_key, at, reservation.card_id);
}

export function settleAutomationExecution(db, executionId, status, options = {}) {
  if (!TERMINAL.has(status)) throw new TypeError("自动化终态无效");
  const at = iso(options.at);
  return db.transaction(() => {
    const execution = db.prepare("SELECT * FROM automation_executions WHERE id = ?").get(executionId);
    if (!execution) throw new Error("自动化履约不存在");
    if (TERMINAL.has(execution.status)) {
      if (execution.status !== status) throw new Error("自动化履约终态冲突");
      return execution;
    }
    const order = db.prepare("SELECT * FROM redeem_orders WHERE id = ?").get(execution.order_id);
    if (!order) throw new Error("自动化履约订单不存在");
    if (status === "succeeded") {
      consumeCardReservation(db, execution, at, options.allowNoCard === true);
      db.prepare(`
        UPDATE redeem_orders
        SET status = ?, error_message = NULL, session_payload = '', completed_at = ?, updated_at = ?
        WHERE id = ?
      `).run(orderStatuses.succeeded, at, at, order.id);
      db.prepare(`
        UPDATE cdkeys
        SET status = ?, used_at = COALESCE(used_at, ?), locked_at = NULL,
            locked_by_order_id = NULL, updated_at = ?
        WHERE id = ?
      `).run(cdkeyStatuses.used, at, at, order.cdkey_id);
    } else {
      releaseCardReservation(db, execution, at);
      db.prepare(`
        UPDATE redeem_orders
        SET status = ?, error_message = ?, session_payload = '', completed_at = ?, updated_at = ?
        WHERE id = ?
      `).run(orderStatuses.failed, options.message || "自动化处理失败", at, at, order.id);
      db.prepare(`
        UPDATE cdkeys
        SET status = ?, locked_at = NULL, locked_by_order_id = NULL, updated_at = ?
        WHERE id = ? AND status = ? AND locked_by_order_id = ?
      `).run(cdkeyStatuses.active, at, order.cdkey_id, cdkeyStatuses.locked, order.id);
    }
    db.prepare(`
      UPDATE automation_executions
      SET status = ?, public_message = ?, last_error_code = ?, last_error_message = ?,
          card_reservation_state = ?, next_action_at = NULL, locked_at = NULL,
          locked_by = NULL, completed_at = ?, updated_at = ?
      WHERE id = ?
    `).run(
      status,
      status === "succeeded" ? "已完成" : "处理失败",
      status === "succeeded" ? null : (options.code || execution.last_error_code || "AUTOMATION_FAILED"),
      status === "succeeded" ? null : (options.message || execution.last_error_message || "自动化处理失败"),
      status === "succeeded" ? "consumed" : "released",
      at,
      at,
      execution.id
    );
    return db.prepare("SELECT * FROM automation_executions WHERE id = ?").get(execution.id);
  }).immediate();
}
