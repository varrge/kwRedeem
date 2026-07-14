import { nanoid } from "nanoid";
import { cdkeyStatuses } from "./constants.js";
import { decryptText, encryptText } from "./secure.js";
import {
  DujiaoAdminClient,
  DujiaoApiError,
  STORE_CDK_ORIGINS,
  STORE_FULFILLMENT_STATUSES,
  buildStoreDelivery,
  collectDujiaoFulfillmentTargets,
  fulfillmentMatchesTask
} from "./store-fulfillment.js";

const ACTIVE_TARGET_STATUS = "fulfilling";
const TERMINAL_REMOTE_STATUSES = new Set(["canceled", "cancelled", "refunded", "partially_refunded"]);
const CONFIRMABLE_REMOTE_STATUSES = new Set(["delivered", "completed"]);
const TASK_LOCK_MS = 2 * 60 * 1000;
const RETRY_DELAYS_SECONDS = [30, 60, 120, 300];

function nowIso() {
  return new Date().toISOString();
}

function safeJson(value, fallback) {
  if (!value) return fallback;
  try {
    return typeof value === "string" ? JSON.parse(value) : value;
  } catch {
    return fallback;
  }
}

function generatePublicKey(db, prefix) {
  const normalized = String(prefix || "").trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "");
  const actualPrefix = normalized ? `${normalized}-` : "";
  let value;
  do {
    value = `${actualPrefix}${nanoid(10).toUpperCase()}`;
  } while (db.prepare("SELECT 1 FROM cdkeys WHERE public_key = ?").get(value));
  return value;
}

function taskCards(task) {
  return safeJson(task?.cdkeys_json, []).filter((item) => item?.id && item?.publicKey);
}

function taskItems(task) {
  return safeJson(task?.items_json, []).filter(Boolean);
}

function taskMappings(task) {
  return safeJson(task?.mapping_snapshot, []).filter(Boolean);
}

function writeAuditLog(db, action, resourceId, detail) {
  db.prepare(`
    INSERT INTO admin_audit_logs (id, action, actor, resource_type, resource_id, detail, created_at)
    VALUES (?, ?, 'worker', 'store_fulfillment_task', ?, ?, ?)
  `).run(nanoid(16), action, resourceId, detail ? JSON.stringify(detail) : null, nowIso());
}

function resolveMapping(db, item) {
  return db.prepare(`
    SELECT m.*, s.name AS site_name, s.product_id AS kawang_product_id,
           s.activation_endpoint_id AS kawang_activation_endpoint_id, s.status AS site_status
    FROM store_product_mappings m
    JOIN sites s ON s.id = m.site_id
    WHERE m.product_id = ? AND m.sku_id = ? AND m.enabled = 1
    LIMIT 1
  `).get(item.productId, item.skuId)
    || (item.skuId !== "0" ? db.prepare(`
      SELECT m.*, s.name AS site_name, s.product_id AS kawang_product_id,
             s.activation_endpoint_id AS kawang_activation_endpoint_id, s.status AS site_status
      FROM store_product_mappings m
      JOIN sites s ON s.id = m.site_id
      WHERE m.product_id = ? AND m.sku_id = '0' AND m.enabled = 1
      LIMIT 1
    `).get(item.productId) : null);
}

function buildMappingSnapshot(db, items) {
  const snapshots = [];
  const errors = [];
  for (const item of items) {
    if (item.fulfillmentType !== "manual") {
      errors.push(`商品 ${item.productId}/${item.skuId} 不是 manual 交付类型`);
      continue;
    }
    if (!Number.isInteger(item.quantity) || item.quantity < 1) {
      errors.push(`商品 ${item.productId}/${item.skuId} 的购买数量无效`);
      continue;
    }
    const mapping = resolveMapping(db, item);
    if (!mapping) {
      errors.push(`未配置商品映射：product_id=${item.productId}, sku_id=${item.skuId}`);
      continue;
    }
    if (mapping.site_status !== "active") {
      errors.push(`商品映射绑定的 KaWang 站点已停用：${mapping.site_name || mapping.site_id}`);
      continue;
    }
    snapshots.push({
      itemId: item.id,
      productId: item.productId,
      skuId: item.skuId,
      title: item.title,
      quantity: item.quantity,
      mappingId: mapping.id,
      manualType: mapping.manual_type,
      siteId: mapping.site_id,
      siteName: mapping.site_name || "",
      prefix: mapping.prefix,
      kawangProductId: mapping.kawang_product_id || "prod_demo",
      kawangActivationEndpointId: mapping.kawang_activation_endpoint_id || "endpoint_demo"
    });
  }
  return { snapshots, errors };
}

function issueTaskCards(db, task, redeemUrl) {
  const items = taskItems(task);
  const existingMappings = taskMappings(task);
  const resolved = existingMappings.length
    ? { snapshots: existingMappings, errors: [] }
    : buildMappingSnapshot(db, items);
  if (resolved.errors.length) {
    db.prepare(`
      UPDATE store_fulfillment_tasks
      SET status = ?, last_error = ?, next_retry_at = NULL,
          locked_at = NULL, locked_by = NULL, updated_at = ?
      WHERE id = ?
    `).run(STORE_FULFILLMENT_STATUSES.blocked, resolved.errors.join("；"), nowIso(), task.id);
    return null;
  }

  const cards = [];
  const insert = db.prepare(`
    INSERT INTO cdkeys (
      id, batch_id, product_id, activation_endpoint_id, site_id, source_key, public_key, prefix, status,
      locked_at, locked_by_order_id, used_at, disabled_reason, metadata, processing_mode, manual_type,
      origin, store_order_no, store_fulfillment_target_no, store_fulfillment_task_id, created_at, updated_at
    )
    VALUES (?, '', ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?, 'manual', ?, ?, ?, ?, ?, ?, ?)
  `);
  const createdAt = nowIso();
  for (const mapping of resolved.snapshots) {
    for (let index = 0; index < mapping.quantity; index += 1) {
      const id = nanoid(18);
      const publicKey = generatePublicKey(db, mapping.prefix);
      insert.run(
        id,
        mapping.kawangProductId,
        mapping.kawangActivationEndpointId,
        mapping.siteId,
        encryptText(`manual-card:${mapping.manualType}:${publicKey}`),
        publicKey,
        mapping.prefix,
        cdkeyStatuses.active,
        JSON.stringify({ processingMode: "manual", manualType: mapping.manualType }),
        mapping.manualType,
        STORE_CDK_ORIGINS.store,
        task.parent_order_no || task.remote_order_no,
        task.remote_order_no,
        task.id,
        createdAt,
        createdAt
      );
      cards.push({
        id,
        publicKey,
        productId: mapping.productId,
        skuId: mapping.skuId,
        manualType: mapping.manualType,
        siteId: mapping.siteId
      });
    }
  }

  const delivery = buildStoreDelivery(
    task.id,
    task.parent_order_no || task.remote_order_no,
    task.remote_order_no,
    cards.map((item) => item.publicKey),
    redeemUrl
  );
  db.prepare(`
    UPDATE store_fulfillment_tasks
    SET mapping_snapshot = ?, quantity = ?, cdkeys_json = ?, payload = ?, delivery_data = ?,
        status = ?, last_error = NULL, updated_at = ?
    WHERE id = ?
  `).run(
    JSON.stringify(resolved.snapshots),
    cards.length,
    JSON.stringify(cards),
    delivery.payload,
    JSON.stringify(delivery.deliveryData),
    STORE_FULFILLMENT_STATUSES.pending,
    createdAt,
    task.id
  );
  writeAuditLog(db, "store_fulfillment.cards_issued", task.id, {
    storeOrderNo: task.parent_order_no || task.remote_order_no,
    targetOrderNo: task.remote_order_no,
    publicKeys: cards.map((item) => item.publicKey)
  });
  return cards;
}

export function createStoreFulfillmentRunner({ db, redeemUrl, workerId = `worker-${process.pid}`, logger = console }) {
  let running = false;
  let client = null;
  let clientSettingsVersion = "";

  function settings() {
    return db.prepare("SELECT * FROM store_fulfillment_settings WHERE id = 'default'").get();
  }

  function getClient(current) {
    const version = `${current.base_url}|${current.admin_username}|${current.updated_at}`;
    if (!client || clientSettingsVersion !== version) {
      client = new DujiaoAdminClient({
        baseUrl: current.base_url,
        username: current.admin_username,
        password: decryptText(current.admin_password)
      });
      clientSettingsVersion = version;
    }
    return client;
  }

  function updateSyncState(status, error = "") {
    db.prepare(`
      UPDATE store_fulfillment_settings
      SET last_sync_at = ?, last_sync_status = ?, last_sync_error = ?
      WHERE id = 'default'
    `).run(nowIso(), status, error || null);
  }

  function pauseForAuthentication(error) {
    db.prepare(`
      UPDATE store_fulfillment_settings
      SET enabled = 0, last_sync_at = ?, last_sync_status = 'auth_error', last_sync_error = ?
      WHERE id = 'default'
    `).run(nowIso(), error.message || "Dujiao 鉴权失败");
  }

  function createTask(target) {
    if (!target.orderId || !target.orderNo) return null;
    const existing = db.prepare("SELECT * FROM store_fulfillment_tasks WHERE remote_order_id = ?").get(target.orderId);
    if (existing) return existing;
    const id = nanoid(18);
    const createdAt = nowIso();
    const create = db.transaction(() => {
      db.prepare(`
        INSERT INTO store_fulfillment_tasks (
          id, remote_order_id, remote_order_no, parent_order_id, parent_order_no,
          items_json, quantity, status, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        target.orderId,
        target.orderNo,
        target.parentOrderId || null,
        target.parentOrderNo || target.orderNo,
        JSON.stringify(target.items),
        target.items.reduce((sum, item) => sum + item.quantity, 0),
        STORE_FULFILLMENT_STATUSES.pending,
        createdAt,
        createdAt
      );
      const task = db.prepare("SELECT * FROM store_fulfillment_tasks WHERE id = ?").get(id);
      issueTaskCards(db, task, redeemUrl);
    });
    create();
    return db.prepare("SELECT * FROM store_fulfillment_tasks WHERE id = ?").get(id);
  }

  async function listAllOrders(remote, status) {
    const all = [];
    let page = 1;
    let totalPages = 1;
    do {
      const result = await remote.listOrders({ status, page, pageSize: 200 });
      all.push(...result.items);
      totalPages = Math.max(1, Number(result.pagination.total_page || 1));
      page += 1;
    } while (page <= totalPages);
    return all;
  }

  async function discover(current) {
    const remote = getClient(current);
    const parents = [
      ...(await listAllOrders(remote, "fulfilling")),
      ...(await listAllOrders(remote, "partially_delivered"))
    ];
    const seen = new Set();
    let discovered = 0;
    for (const parent of parents) {
      for (const target of collectDujiaoFulfillmentTargets(parent)) {
        if (target.status !== ACTIVE_TARGET_STATUS || seen.has(target.orderId)) continue;
        seen.add(target.orderId);
        if (!db.prepare("SELECT 1 FROM store_fulfillment_tasks WHERE remote_order_id = ?").get(target.orderId)) {
          createTask(target);
          discovered += 1;
        }
      }
    }
    updateSyncState("success");
    return discovered;
  }

  function claimTask() {
    const now = nowIso();
    const expired = new Date(Date.now() - TASK_LOCK_MS).toISOString();
    const candidate = db.prepare(`
      SELECT *
      FROM store_fulfillment_tasks
      WHERE status IN (?, ?)
        AND (next_retry_at IS NULL OR next_retry_at <= ?)
        AND (locked_at IS NULL OR locked_at < ?)
      ORDER BY created_at ASC
      LIMIT 1
    `).get(STORE_FULFILLMENT_STATUSES.pending, STORE_FULFILLMENT_STATUSES.retrying, now, expired);
    if (!candidate) return null;
    const changed = db.prepare(`
      UPDATE store_fulfillment_tasks
      SET locked_at = ?, locked_by = ?, updated_at = ?
      WHERE id = ? AND (locked_at IS NULL OR locked_at < ?)
    `).run(now, workerId, now, candidate.id, expired).changes;
    return changed ? db.prepare("SELECT * FROM store_fulfillment_tasks WHERE id = ?").get(candidate.id) : null;
  }

  function markSucceeded(task, fulfillment) {
    db.prepare(`
      UPDATE store_fulfillment_tasks
      SET status = ?, attempt_count = attempt_count + 1, next_retry_at = NULL, last_error = NULL,
          remote_fulfillment_id = ?, locked_at = NULL, locked_by = NULL,
          completed_at = ?, updated_at = ?
      WHERE id = ?
    `).run(
      STORE_FULFILLMENT_STATUSES.succeeded,
      fulfillment?.id == null ? null : String(fulfillment.id),
      nowIso(),
      nowIso(),
      task.id
    );
    writeAuditLog(db, "store_fulfillment.succeeded", task.id, {
      targetOrderNo: task.remote_order_no,
      fulfillmentId: fulfillment?.id || null
    });
  }

  function markBlocked(task, message, status = STORE_FULFILLMENT_STATUSES.blocked) {
    db.prepare(`
      UPDATE store_fulfillment_tasks
      SET status = ?, attempt_count = attempt_count + 1, next_retry_at = NULL, last_error = ?,
          locked_at = NULL, locked_by = NULL, updated_at = ?
      WHERE id = ?
    `).run(status, message, nowIso(), task.id);
  }

  function markRetry(task, error) {
    const attempt = Number(task.attempt_count || 0) + 1;
    const delay = RETRY_DELAYS_SECONDS[Math.min(attempt - 1, RETRY_DELAYS_SECONDS.length - 1)];
    const nextRetryAt = new Date(Date.now() + delay * 1000).toISOString();
    db.prepare(`
      UPDATE store_fulfillment_tasks
      SET status = ?, attempt_count = ?, next_retry_at = ?, last_error = ?,
          locked_at = NULL, locked_by = NULL, updated_at = ?
      WHERE id = ?
    `).run(
      STORE_FULFILLMENT_STATUSES.retrying,
      attempt,
      nextRetryAt,
      error.message || "Dujiao 临时请求失败",
      nowIso(),
      task.id
    );
  }

  function cancelTask(task) {
    const cards = taskCards(task);
    const cancel = db.transaction(() => {
      if (cards.length) {
        const placeholders = cards.map(() => "?").join(",");
        const rows = db.prepare(`SELECT id, status FROM cdkeys WHERE id IN (${placeholders})`).all(...cards.map((item) => item.id));
        const nonActive = rows.filter((item) => item.status !== cdkeyStatuses.active);
        if (nonActive.length) {
          markBlocked(task, `商城订单已取消或退款，但 ${nonActive.length} 张 CDK 已锁定或核销，需人工处理`);
          return;
        }
        db.prepare(`
          UPDATE cdkeys
          SET status = ?, disabled_reason = '商城订单取消或退款', updated_at = ?
          WHERE id IN (${placeholders}) AND status = ?
        `).run(cdkeyStatuses.void, nowIso(), ...cards.map((item) => item.id), cdkeyStatuses.active);
      }
      db.prepare(`
        UPDATE store_fulfillment_tasks
        SET status = ?, next_retry_at = NULL, last_error = NULL, locked_at = NULL, locked_by = NULL,
            canceled_at = ?, updated_at = ?
        WHERE id = ?
      `).run(STORE_FULFILLMENT_STATUSES.canceled, nowIso(), nowIso(), task.id);
    });
    cancel();
  }

  async function processTask(current, claimed) {
    const remote = getClient(current);
    let task = claimed;
    try {
      const order = await remote.getOrder(task.remote_order_id);
      if (!order) {
        markBlocked(task, "Dujiao 订单不存在");
        return;
      }
      const cards = taskCards(task);
      const publicKeys = cards.map((item) => item.publicKey);
      if (order.fulfillment || CONFIRMABLE_REMOTE_STATUSES.has(String(order.status || ""))) {
        if (fulfillmentMatchesTask(order.fulfillment, task.id, publicKeys, task.payload)) {
          markSucceeded(task, order.fulfillment);
        } else {
          markBlocked(task, "Dujiao 已存在与 KaWang 分配不一致的交付内容", STORE_FULFILLMENT_STATUSES.conflict);
        }
        return;
      }
      if (TERMINAL_REMOTE_STATUSES.has(String(order.status || ""))) {
        cancelTask(task);
        return;
      }
      if (String(order.status || "") !== ACTIVE_TARGET_STATUS) {
        markBlocked(task, `Dujiao 订单状态已变为 ${order.status || "unknown"}，不再允许自动交付`);
        return;
      }
      if (!cards.length) {
        const issue = db.transaction(() => issueTaskCards(db, task, redeemUrl));
        issue();
        task = db.prepare("SELECT * FROM store_fulfillment_tasks WHERE id = ?").get(task.id);
        if (task.status === STORE_FULFILLMENT_STATUSES.blocked) return;
      }
      const assignedKeys = taskCards(task).map((item) => item.publicKey);
      const expectedPayload = buildStoreDelivery(
        task.id,
        task.parent_order_no || task.remote_order_no,
        task.remote_order_no,
        assignedKeys,
        redeemUrl
      ).payload;
      if (task.payload !== expectedPayload) {
        db.prepare("UPDATE store_fulfillment_tasks SET payload = ?, updated_at = ? WHERE id = ?")
          .run(expectedPayload, nowIso(), task.id);
        task = { ...task, payload: expectedPayload };
      }
      const fulfillment = await remote.createFulfillment({
        orderId: task.remote_order_id,
        payload: task.payload
      });
      markSucceeded(task, fulfillment);
    } catch (error) {
      if (error instanceof DujiaoApiError && error.code === "error.fulfillment_exists") {
        try {
          const order = await remote.getOrder(task.remote_order_id);
          const publicKeys = taskCards(task).map((item) => item.publicKey);
          if (fulfillmentMatchesTask(order?.fulfillment, task.id, publicKeys, task.payload)) {
            markSucceeded(task, order.fulfillment);
          } else {
            markBlocked(task, "Dujiao 已存在与 KaWang 分配不一致的交付内容", STORE_FULFILLMENT_STATUSES.conflict);
          }
        } catch (recheckError) {
          markRetry(task, recheckError);
        }
        return;
      }
      if (error instanceof DujiaoApiError && ["credentials_missing", "totp_required", "token_missing"].includes(error.code)) {
        pauseForAuthentication(error);
        markBlocked(task, error.message);
        return;
      }
      if (error instanceof DujiaoApiError && error.status === 401) {
        pauseForAuthentication(error);
        markBlocked(task, "Dujiao 登录失败，商城自动交付已暂停");
        return;
      }
      if (error instanceof DujiaoApiError && error.retryable) {
        markRetry(task, error);
        return;
      }
      markBlocked(task, error?.message || "商城交付失败");
    }
  }

  function syncDue(current, force) {
    if (force || !current.last_sync_at) return true;
    const elapsed = Date.now() - Date.parse(current.last_sync_at);
    return !Number.isFinite(elapsed) || elapsed >= Number(current.poll_interval_seconds || 30) * 1000;
  }

  async function tick({ force = false } = {}) {
    if (running) return { accepted: false, reason: "already_running" };
    const current = settings();
    if (!current?.enabled) return { accepted: false, reason: "disabled" };
    if (!current.base_url || !current.admin_username || !current.admin_password) {
      updateSyncState("config_error", "商城地址或服务管理员凭据未配置");
      return { accepted: false, reason: "not_configured" };
    }
    running = true;
    let discovered = 0;
    let processed = 0;
    try {
      if (syncDue(current, force)) {
        try {
          discovered = await discover(current);
        } catch (error) {
          if (error instanceof DujiaoApiError && (error.status === 401 || ["credentials_missing", "totp_required", "token_missing"].includes(error.code))) {
            pauseForAuthentication(error);
          } else {
            updateSyncState("error", error?.message || "Dujiao 订单同步失败");
          }
          throw error;
        }
      }
      for (let index = 0; index < 10; index += 1) {
        const task = claimTask();
        if (!task) break;
        await processTask(current, task);
        processed += 1;
      }
      return { accepted: true, discovered, processed };
    } catch (error) {
      logger.error?.("[KaWang worker] store-fulfillment", error);
      return { accepted: false, reason: "error", message: error?.message || "商城交付执行失败" };
    } finally {
      running = false;
    }
  }

  return { tick, createTask, issueTaskCards: (task) => issueTaskCards(db, task, redeemUrl) };
}
