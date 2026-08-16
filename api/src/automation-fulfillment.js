import { randomUUID } from "node:crypto";
import { z } from "zod";
import { AutomationAdapterError } from "../../shared/src/automation-adapters/automate-v1.js";
import { serializeAutomationExecution, settleAutomationExecution } from "../../shared/src/automation-fulfillment.js";
import {
  automationAdapterKeys,
  normalizeAutomationProviderBaseUrl,
  serializeAutomationProvider,
  syncAutomationProvider,
  validateAutomationMappingCapability
} from "../../shared/src/automation-provider-registry.js";

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;
const SAFE_RETRY_STATUSES = Object.freeze([
  "waiting_gate",
  "waiting_mapping",
  "waiting_capacity",
  "preparing_card"
]);
const MANUAL_TAKEOVER_CODE = "ADMIN_MANUAL_TAKEOVER_PRE_PAYMENT";

function setNoStore(reply) {
  reply.header("Cache-Control", "no-store");
  reply.header("Pragma", "no-cache");
}

function nowIso() {
  return new Date().toISOString();
}

function serializeMapping(row) {
  let capability = null;
  try { capability = JSON.parse(row.capability_snapshot); } catch {}
  return {
    id: row.id,
    storeMappingId: row.store_mapping_id || null,
    productId: row.product_id,
    productTitle: row.store_product_title || null,
    storeProductId: row.store_product_id || null,
    storeSkuId: row.store_sku_id || null,
    storeManualType: row.store_manual_type || null,
    storeFulfillmentKind: row.store_fulfillment_kind || null,
    storeSiteId: row.store_site_id || null,
    storeSiteName: row.store_site_name || null,
    providerId: row.provider_id,
    providerName: row.provider_name || null,
    externalPlanId: row.external_plan_id,
    externalTaskType: row.external_task_type,
    regionCode: row.region_code || null,
    currency: row.currency || null,
    cardPlatformKey: row.card_platform_key,
    cardProductCode: row.card_product_code || null,
    capacityKey: row.capacity_key,
    cardCapacity: Number(row.card_capacity),
    fundingAmountUsd: Number(row.funding_amount_usd),
    expectedMinAmount: Number(row.expected_min_amount),
    expectedMaxAmount: Number(row.expected_max_amount),
    dailyRiskLimitUsd: Number(row.daily_risk_limit_usd),
    priority: Number(row.priority),
    enabled: row.enabled === 1,
    pausedReason: row.paused_reason || null,
    capability,
    revision: Number(row.revision),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by
  };
}

function loadAutomationStoreSource(db, storeMappingId) {
  return db.prepare(`
    SELECT source.*, site.name AS site_name, site.status AS site_status
    FROM store_product_mappings source
    JOIN sites site ON site.id = source.site_id
    WHERE source.id = ?
  `).get(storeMappingId);
}

function assertAutomationStoreSource(source, capability) {
  if (!source || source.enabled !== 1 || source.fulfillment_kind !== "membership_auto") {
    throw new Error("商城交付商品不存在、未启用或不是会员自动化类型");
  }
  if (source.site_status !== "active") throw new Error("商城交付商品绑定的站点未启用");
  const storeOffer = String(source.manual_type || "").trim().toLowerCase();
  const protocolOffer = String(capability?.plan?.canonicalOffer || "").trim().toLowerCase();
  if (!protocolOffer || protocolOffer !== storeOffer) {
    throw new Error(`商城交付套餐 ${source.manual_type || "-"} 与站点直付套餐不一致`);
  }
}

function errorReply(reply, error, fallback = "自动化配置操作失败") {
  if (error instanceof AutomationAdapterError) {
    return reply.code(error.statusCode >= 400 && error.statusCode < 500 ? 409 : 502).send({
      code: error.code,
      message: error.message
    });
  }
  if (error instanceof TypeError) return reply.code(400).send({ message: error.message });
  return reply.code(409).send({ message: error?.message || fallback });
}

export function createAutomationFulfillmentService(options = {}) {
  const {
    app,
    db,
    requireAdmin,
    encryptText,
    decryptText,
    createAuditLog,
    verifyFreshAdmin
  } = options;
  if (!app || !db || typeof requireAdmin !== "function" || typeof encryptText !== "function"
    || typeof decryptText !== "function") throw new TypeError("automation fulfillment service 配置不完整");

  const audit = (request, action, resourceType, resourceId, detail = null) => createAuditLog?.({
    action,
    actor: request.admin?.username || "admin",
    resourceType,
    resourceId,
    detail
  });

  app.get("/api/admin/automation/settings", { preHandler: requireAdmin }, async (_request, reply) => {
    setNoStore(reply);
    const row = db.prepare("SELECT * FROM automation_fulfillment_settings WHERE id = 'default'").get();
    return {
      paymentGateEnabled: row.payment_gate_enabled === 1,
      mode: row.mode,
      configTtlSeconds: Number(row.config_ttl_seconds),
      updatedAt: row.updated_at,
      updatedBy: row.updated_by
    };
  });

  app.put("/api/admin/automation/settings", { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = z.object({
      paymentGateEnabled: z.boolean(),
      configTtlSeconds: z.number().int().min(60).max(3600).default(300),
      credentials: z.object({ username: z.string().min(1), password: z.string().min(1) }),
      confirmation: z.literal("ENABLE_LIVE_AUTOMATION")
    }).safeParse(request.body || {});
    if (!parsed.success) return reply.code(400).send({ message: "自动付款 Gate 参数不正确" });
    try {
      verifyFreshAdmin?.(parsed.data.credentials);
      const at = nowIso();
      db.prepare(`
        UPDATE automation_fulfillment_settings
        SET payment_gate_enabled = ?, mode = ?, config_ttl_seconds = ?, updated_at = ?, updated_by = ?
        WHERE id = 'default'
      `).run(
        parsed.data.paymentGateEnabled ? 1 : 0,
        parsed.data.paymentGateEnabled ? "automatic" : "disabled",
        parsed.data.configTtlSeconds,
        at,
        request.admin.username
      );
      audit(request, "automation.gate.update", "automation_settings", "default", {
        paymentGateEnabled: parsed.data.paymentGateEnabled,
        configTtlSeconds: parsed.data.configTtlSeconds
      });
      return { ok: true, paymentGateEnabled: parsed.data.paymentGateEnabled };
    } catch {
      return reply.code(403).send({ message: "管理员重新验证失败" });
    }
  });

  app.get("/api/admin/automation/providers", { preHandler: requireAdmin }, async (_request, reply) => {
    setNoStore(reply);
    return {
      adapterKeys: automationAdapterKeys,
      items: db.prepare("SELECT * FROM automation_providers ORDER BY name, id").all().map(serializeAutomationProvider)
    };
  });

  app.post("/api/admin/automation/providers", { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = z.object({
      id: z.string().regex(SAFE_ID).optional(),
      name: z.string().trim().min(1).max(120),
      adapterKey: z.enum(automationAdapterKeys),
      baseUrl: z.string().trim().min(1).max(500),
      apiKey: z.string().trim().max(500).default(""),
      status: z.enum(["active", "paused"]).default("paused")
    }).safeParse(request.body || {});
    if (!parsed.success) return reply.code(400).send({ message: "自动化站点参数不正确" });
    const at = nowIso();
    const id = parsed.data.id || `ap_${randomUUID()}`;
    try {
      const baseUrl = normalizeAutomationProviderBaseUrl(parsed.data.adapterKey, parsed.data.baseUrl);
      const existing = db.prepare("SELECT * FROM automation_providers WHERE id = ?").get(id);
      if (existing && existing.adapter_key !== parsed.data.adapterKey) {
        return reply.code(409).send({ message: "已创建站点不能修改 Adapter 类型" });
      }
      if (!existing && !parsed.data.apiKey) return reply.code(400).send({ message: "首次配置必须提供 API Key" });
      db.transaction(() => {
        if (!existing) {
          db.prepare(`
            INSERT INTO automation_providers (
              id, name, adapter_key, base_url, status, max_concurrency,
              config_status, circuit_state, created_at, updated_at, updated_by
            ) VALUES (?, ?, ?, ?, 'paused', 1, 'not_synced', 'closed', ?, ?, ?)
          `).run(id, parsed.data.name, parsed.data.adapterKey, baseUrl, at, at, request.admin.username);
        } else {
          db.prepare(`
            UPDATE automation_providers
            SET name = ?, base_url = ?, status = 'paused', config_status = 'not_synced',
                config_error = NULL, updated_at = ?, updated_by = ? WHERE id = ?
          `).run(parsed.data.name, baseUrl, at, request.admin.username, id);
        }
        if (parsed.data.apiKey) {
          const credentialId = `apc_${randomUUID()}`;
          db.prepare(`
            UPDATE automation_provider_credentials
            SET status = 'retained', retired_at = ?
            WHERE provider_id = ? AND status = 'current'
          `).run(at, id);
          db.prepare(`
            INSERT INTO automation_provider_credentials (
              id, provider_id, api_key_encrypted, status, created_at, created_by
            ) VALUES (?, ?, ?, 'current', ?, ?)
          `).run(credentialId, id, encryptText(parsed.data.apiKey), at, request.admin.username);
          db.prepare("UPDATE automation_providers SET current_credential_id = ? WHERE id = ?")
            .run(credentialId, id);
        }
      }).immediate();
      await syncAutomationProvider(db, { providerId: id, decryptText });
      db.prepare("UPDATE automation_providers SET status = ?, updated_at = ? WHERE id = ?")
        .run(parsed.data.status, nowIso(), id);
      audit(request, "automation.provider.upsert", "automation_provider", id, {
        adapterKey: parsed.data.adapterKey,
        status: parsed.data.status,
        credentialChanged: Boolean(parsed.data.apiKey)
      });
      return { item: serializeAutomationProvider(db.prepare("SELECT * FROM automation_providers WHERE id = ?").get(id)) };
    } catch (error) {
      return errorReply(reply, error);
    }
  });

  app.post("/api/admin/automation/providers/:id/sync", { preHandler: requireAdmin }, async (request, reply) => {
    const id = String(request.params.id || "").trim();
    if (!SAFE_ID.test(id)) return reply.code(400).send({ message: "站点 ID 无效" });
    try {
      const item = await syncAutomationProvider(db, { providerId: id, decryptText });
      audit(request, "automation.provider.sync", "automation_provider", id, { configHash: item.configHash });
      return { item };
    } catch (error) {
      return errorReply(reply, error);
    }
  });

  app.post("/api/admin/automation/providers/:id/reset-circuit", { preHandler: requireAdmin }, async (request, reply) => {
    const id = String(request.params.id || "").trim();
    const at = nowIso();
    const changed = db.prepare(`
      UPDATE automation_providers
      SET circuit_state = 'closed', circuit_reason = NULL, circuit_opened_at = NULL,
          consecutive_failures = 0, updated_at = ?, updated_by = ? WHERE id = ?
    `).run(at, request.admin.username, id).changes;
    if (!changed) return reply.code(404).send({ message: "自动化站点不存在" });
    audit(request, "automation.provider.circuit_reset", "automation_provider", id);
    return { ok: true };
  });

  app.get("/api/admin/automation/mappings", { preHandler: requireAdmin }, async (_request, reply) => {
    setNoStore(reply);
    const items = db.prepare(`
      SELECT m.*, source.id AS store_mapping_id,
             source.product_id AS store_product_id, source.sku_id AS store_sku_id,
             source.product_title AS store_product_title,
             source.manual_type AS store_manual_type,
             source.fulfillment_kind AS store_fulfillment_kind,
             source.site_id AS store_site_id, site.name AS store_site_name,
             provider.name AS provider_name
      FROM automation_product_mappings m
      LEFT JOIN store_product_mappings source ON source.id = m.product_id
      LEFT JOIN sites site ON site.id = source.site_id
      JOIN automation_providers provider ON provider.id = m.provider_id
      ORDER BY COALESCE(source.product_title, source.product_id, m.product_id), m.priority, provider.name
    `).all().map(serializeMapping);
    return { items };
  });

  app.post("/api/admin/automation/mappings", { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = z.object({
      id: z.string().regex(SAFE_ID).optional(),
      storeMappingId: z.string().trim().min(1).max(120),
      providerId: z.string().regex(SAFE_ID),
      externalPlanId: z.string().trim().min(1).max(120),
      regionCode: z.string().trim().min(1).max(20).transform((value) => value.toUpperCase()),
      cardPlatformKey: z.enum(["spacexcard", "efuncard"]),
      cardProductCode: z.string().trim().max(120).optional().default(""),
      capacityKey: z.string().trim().min(1).max(120),
      cardCapacity: z.number().int().min(1).max(100),
      fundingAmountUsd: z.number().positive().max(10000),
      expectedMinAmount: z.number().positive().max(10000000),
      expectedMaxAmount: z.number().positive().max(10000000),
      dailyRiskLimitUsd: z.number().positive().max(1000000),
      priority: z.number().int().min(1).max(10000),
      enabled: z.boolean().default(false)
    }).safeParse(request.body || {});
    if (!parsed.success) return reply.code(400).send({ message: "自动化商城交付映射参数不正确" });
    if (parsed.data.expectedMaxAmount < parsed.data.expectedMinAmount
      || parsed.data.dailyRiskLimitUsd < (parsed.data.fundingAmountUsd / parsed.data.cardCapacity)) {
      return reply.code(400).send({ message: "价格或资金上限配置不正确" });
    }
    try {
      const storeSource = loadAutomationStoreSource(db, parsed.data.storeMappingId);
      const provider = db.prepare("SELECT * FROM automation_providers WHERE id = ?").get(parsed.data.providerId);
      const platform = db.prepare("SELECT key FROM membership_card_platforms WHERE key = ? AND enabled = 1")
        .get(parsed.data.cardPlatformKey);
      if (!provider) throw new Error("自动化站点不存在");
      if (!platform) throw new Error("所选卡台未启用");
      const capability = validateAutomationMappingCapability(provider, parsed.data);
      assertAutomationStoreSource(storeSource, capability);
      const at = nowIso();
      const id = parsed.data.id || `apm_${randomUUID()}`;
      const existing = db.prepare("SELECT * FROM automation_product_mappings WHERE id = ?").get(id);
      const snapshot = JSON.stringify({
        configHash: capability.configHash,
        plan: capability.plan,
        region: capability.region
      });
      if (existing) {
        db.prepare(`
          UPDATE automation_product_mappings
          SET product_id = ?, provider_id = ?, external_plan_id = ?, external_task_type = ?,
              region_code = ?, currency = ?, card_platform_key = ?, card_product_code = ?,
              capacity_key = ?, card_capacity = ?, funding_amount_usd = ?,
              expected_min_amount = ?, expected_max_amount = ?, daily_risk_limit_usd = ?,
              priority = ?, enabled = ?, paused_reason = NULL, capability_snapshot = ?,
              revision = revision + 1, updated_at = ?, updated_by = ?
          WHERE id = ?
        `).run(
          parsed.data.storeMappingId, parsed.data.providerId, capability.plan.id, capability.plan.taskType,
          capability.region.code, capability.region.currency, parsed.data.cardPlatformKey,
          parsed.data.cardProductCode || null, parsed.data.capacityKey, parsed.data.cardCapacity,
          parsed.data.fundingAmountUsd, parsed.data.expectedMinAmount, parsed.data.expectedMaxAmount,
          parsed.data.dailyRiskLimitUsd, parsed.data.priority, parsed.data.enabled ? 1 : 0,
          snapshot, at, request.admin.username, id
        );
      } else {
        db.prepare(`
          INSERT INTO automation_product_mappings (
            id, product_id, provider_id, external_plan_id, external_task_type,
            region_code, currency, card_platform_key, card_product_code, capacity_key,
            card_capacity, funding_amount_usd, expected_min_amount, expected_max_amount,
            daily_risk_limit_usd, priority, enabled, capability_snapshot,
            created_at, updated_at, updated_by
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          id, parsed.data.storeMappingId, parsed.data.providerId, capability.plan.id, capability.plan.taskType,
          capability.region.code, capability.region.currency, parsed.data.cardPlatformKey,
          parsed.data.cardProductCode || null, parsed.data.capacityKey, parsed.data.cardCapacity,
          parsed.data.fundingAmountUsd, parsed.data.expectedMinAmount, parsed.data.expectedMaxAmount,
          parsed.data.dailyRiskLimitUsd, parsed.data.priority, parsed.data.enabled ? 1 : 0,
          snapshot, at, at, request.admin.username
        );
      }
      audit(request, "automation.mapping.upsert", "automation_mapping", id, {
        storeMappingId: parsed.data.storeMappingId,
        storeProductId: storeSource.product_id,
        storeSkuId: storeSource.sku_id,
        storeManualType: storeSource.manual_type,
        providerId: parsed.data.providerId,
        externalPlanId: capability.plan.id,
        regionCode: capability.region.code,
        enabled: parsed.data.enabled
      });
      const row = db.prepare(`
        SELECT m.*, source.id AS store_mapping_id,
               source.product_id AS store_product_id, source.sku_id AS store_sku_id,
               source.product_title AS store_product_title,
               source.manual_type AS store_manual_type,
               source.fulfillment_kind AS store_fulfillment_kind,
               source.site_id AS store_site_id, site.name AS store_site_name,
               provider.name AS provider_name
        FROM automation_product_mappings m
        LEFT JOIN store_product_mappings source ON source.id = m.product_id
        LEFT JOIN sites site ON site.id = source.site_id
        JOIN automation_providers provider ON provider.id = m.provider_id WHERE m.id = ?
      `).get(id);
      return { item: serializeMapping(row) };
    } catch (error) {
      return errorReply(reply, error);
    }
  });

  app.patch("/api/admin/automation/mappings/:id/status", { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = z.object({ enabled: z.boolean() }).safeParse(request.body || {});
    if (!parsed.success) return reply.code(400).send({ message: "映射状态参数不正确" });
    const id = String(request.params.id || "").trim();
    const mapping = db.prepare("SELECT * FROM automation_product_mappings WHERE id = ?").get(id);
    if (!mapping) return reply.code(404).send({ message: "自动化商品映射不存在" });
    if (parsed.data.enabled) {
      try {
        const provider = db.prepare("SELECT * FROM automation_providers WHERE id = ?").get(mapping.provider_id);
        if (!provider) throw new Error("自动化站点不存在");
        const capability = validateAutomationMappingCapability(provider, {
          externalPlanId: mapping.external_plan_id,
          regionCode: mapping.region_code
        });
        assertAutomationStoreSource(loadAutomationStoreSource(db, mapping.product_id), capability);
      } catch (error) {
        return errorReply(reply, error);
      }
    }
    const at = nowIso();
    const changed = db.prepare(`
      UPDATE automation_product_mappings
      SET enabled = ?, paused_reason = ?, revision = revision + 1, updated_at = ?, updated_by = ?
      WHERE id = ?
    `).run(parsed.data.enabled ? 1 : 0, parsed.data.enabled ? null : "ADMIN_PAUSED", at, request.admin.username, id).changes;
    if (!changed) return reply.code(404).send({ message: "自动化商品映射不存在" });
    audit(request, "automation.mapping.status", "automation_mapping", id, { enabled: parsed.data.enabled });
    return { ok: true };
  });

  app.get("/api/admin/automation/executions", { preHandler: requireAdmin }, async (_request, reply) => {
    setNoStore(reply);
    const items = db.prepare(`
      SELECT * FROM automation_executions ORDER BY created_at DESC LIMIT 300
    `).all().map((row) => serializeAutomationExecution(row, { admin: true }));
    return { items };
  });

  app.get("/api/admin/automation/executions/:id", { preHandler: requireAdmin }, async (request, reply) => {
    setNoStore(reply);
    const row = db.prepare("SELECT * FROM automation_executions WHERE id = ?").get(String(request.params.id || ""));
    if (!row) return reply.code(404).send({ message: "自动化履约不存在" });
    const attempts = db.prepare(`
      SELECT id, attempt_no, mapping_id, provider_id, credential_id, client_order_id,
             status, remote_task_id, error_code, error_message, created_at, updated_at
      FROM automation_execution_attempts WHERE execution_id = ? ORDER BY attempt_no
    `).all(row.id).map((item) => ({
      id: item.id,
      attemptNo: Number(item.attempt_no),
      mappingId: item.mapping_id,
      providerId: item.provider_id,
      credentialId: item.credential_id,
      clientOrderId: item.client_order_id,
      status: item.status,
      remoteTaskId: item.remote_task_id || null,
      errorCode: item.error_code || null,
      errorMessage: item.error_message || null,
      createdAt: item.created_at,
      updatedAt: item.updated_at
    }));
    return { item: serializeAutomationExecution(row, { admin: true }), attempts };
  });

  app.post("/api/admin/automation/executions/:id/query-now", { preHandler: requireAdmin }, async (request, reply) => {
    const id = String(request.params.id || "");
    const changed = db.prepare(`
      UPDATE automation_executions SET next_action_at = ?, updated_at = ?
      WHERE id = ? AND status IN ('queued', 'running', 'submit_unknown')
    `).run(nowIso(), nowIso(), id).changes;
    if (!changed) return reply.code(409).send({ message: "当前状态不能立即查询" });
    return { ok: true };
  });

  app.post("/api/admin/automation/executions/:id/retry", { preHandler: requireAdmin }, async (request, reply) => {
    const id = String(request.params.id || "");
    const current = db.prepare("SELECT * FROM automation_executions WHERE id = ?").get(id);
    if (!current) return reply.code(404).send({ message: "自动化履约不存在" });
    if (!SAFE_RETRY_STATUSES.includes(current.status) || current.remote_task_id) {
      return reply.code(409).send({ message: "当前状态不能手动重试，只能继续查询或对账" });
    }
    const settings = db.prepare("SELECT payment_gate_enabled FROM automation_fulfillment_settings WHERE id = 'default'").get();
    if (settings?.payment_gate_enabled !== 1) {
      return reply.code(409).send({ message: "付款 Gate 已关闭，手动重试不会越过 Gate" });
    }
    const at = nowIso();
    db.prepare(`
      UPDATE automation_executions
      SET next_action_at = ?, public_message = '等待处理', updated_at = ?
      WHERE id = ?
    `).run(at, at, id);
    audit(request, "automation.execution.retry_requested", "automation_execution", id, {
      orderNo: current.order_no,
      status: current.status
    });
    return {
      item: serializeAutomationExecution(
        db.prepare("SELECT * FROM automation_executions WHERE id = ?").get(id),
        { admin: true }
      )
    };
  });

  app.post("/api/admin/automation/executions/:id/manual-review", { preHandler: requireAdmin }, async (request, reply) => {
    const id = String(request.params.id || "");
    const current = db.prepare("SELECT * FROM automation_executions WHERE id = ?").get(id);
    if (!current) return reply.code(404).send({ message: "自动化履约不存在" });
    if (!["waiting_gate", "waiting_mapping"].includes(current.status) || current.remote_task_id) {
      return reply.code(409).send({ message: "当前订单已越过安全人工接管状态" });
    }
    const activeReservation = db.prepare(`
      SELECT 1 FROM automation_card_reservations
      WHERE execution_id = ? AND state <> 'released'
    `).get(id);
    const fundingIntent = db.prepare(`
      SELECT 1 FROM automation_funding_intents WHERE execution_id = ?
    `).get(id);
    if (activeReservation || fundingIntent) {
      return reply.code(409).send({ message: "订单已有卡片或资金边界，只能继续对账" });
    }
    const at = nowIso();
    const staleLockAt = new Date(Date.parse(at) - 120_000).toISOString();
    const changed = db.prepare(`
      UPDATE automation_executions
      SET status = 'manual_review', current_phase = 'manual_processing',
          public_message = '人工核验中', last_error_code = ?,
          last_error_message = '管理员已接管处理', next_action_at = NULL,
          locked_at = NULL, locked_by = NULL, updated_at = ?
      WHERE id = ? AND status IN ('waiting_gate', 'waiting_mapping')
        AND remote_task_id IS NULL
        AND (locked_at IS NULL OR locked_at <= ?)
    `).run(MANUAL_TAKEOVER_CODE, at, id, staleLockAt).changes;
    if (!changed) return reply.code(409).send({ message: "worker 正在处理该订单，请稍后再接管" });
    audit(request, "automation.execution.manual_takeover", "automation_execution", id, {
      orderNo: current.order_no,
      previousStatus: current.status
    });
    return {
      item: serializeAutomationExecution(
        db.prepare("SELECT * FROM automation_executions WHERE id = ?").get(id),
        { admin: true }
      )
    };
  });

  app.post("/api/admin/automation/executions/:id/resolve", { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = z.object({
      outcome: z.enum(["succeeded", "failed"]),
      evidenceReference: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/),
      confirmation: z.literal("RESOLVE_AUTOMATION_REVIEW")
    }).safeParse(request.body || {});
    if (!parsed.success) return reply.code(400).send({ message: "人工处理参数不正确" });
    const id = String(request.params.id || "");
    const current = db.prepare("SELECT * FROM automation_executions WHERE id = ?").get(id);
    if (!current || !["manual_review", "manual_hold"].includes(current.status)) {
      return reply.code(409).send({ message: "当前履约不在人工处理状态" });
    }
    try {
      const item = settleAutomationExecution(db, id, parsed.data.outcome, {
        code: parsed.data.outcome === "failed" ? "MANUAL_REVIEW_FAILED" : null,
        message: parsed.data.outcome === "failed" ? "人工核验确认失败" : null,
        allowNoCard: current.status === "manual_hold" || current.last_error_code === MANUAL_TAKEOVER_CODE,
        at: nowIso()
      });
      audit(request, "automation.execution.resolve", "automation_execution", id, {
        outcome: parsed.data.outcome,
        evidenceReference: parsed.data.evidenceReference
      });
      return { item: serializeAutomationExecution(item, { admin: true }) };
    } catch (error) {
      return errorReply(reply, error);
    }
  });
}
