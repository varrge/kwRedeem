import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { convertSessionToCookiePayload } from "../../shared/src/session-cookie-converter.js";

const DELIVERY_TTL_MS = 24 * 60 * 60 * 1000;
const RATE_WINDOW_MS = 60_000;
const COOKIE_GET_LIMIT = 30;
const RESULT_POST_LIMIT = 60;
const SUBSCRIPTION_GUARD_LIMIT = 30;
const WS_AUTH_LIMIT = 10;
const WS_MAX_MESSAGE_BYTES = 4096;
const HEARTBEAT_INTERVAL_MS = 20_000;
const AUTH_TIMEOUT_MS = 5_000;
const CONVERTER_URL = "https://spacexcard.com/api/v1/gpt/session-to-cookie";
const SUBSCRIPTION_CHECK_URL = "https://gptserve.freespaces.app/api/subscription/info";
const SUBSCRIPTION_CANCEL_URL = "https://gptserve.freespaces.app/api/subscription/cancel";
const SUBSCRIPTION_REQUEST_TIMEOUT_MS = 15_000;
const SUBSCRIPTION_RESPONSE_MAX_BYTES = 128 * 1024;

const ERROR_DEFINITIONS = Object.freeze({
  EXTENSION_UNAUTHORIZED: { status: 401, message: "Extension Token 无效", retryable: false },
  EXTENSION_INSTALLATION_MISMATCH: { status: 403, message: "扩展安装实例与绑定不一致", retryable: false },
  EXTENSION_DELIVERY_DISABLED: { status: 503, message: "扩展自动交付未启用", retryable: false },
  EXTENSION_RATE_LIMITED: { status: 429, message: "扩展请求过于频繁", retryable: true, retryScope: "global" },
  EXTENSION_DELIVERY_BUSY: { status: 429, message: "当前已有 Cookie 包装请求正在处理", retryable: true, retryScope: "order" },
  DELIVERY_NOT_FOUND: { status: 404, message: "交付订单不存在", retryable: false },
  DELIVERY_ALREADY_FINISHED: { status: 409, message: "交付订单已经结束", retryable: false },
  DELIVERY_RESULT_NOT_EXPECTED: { status: 409, message: "该订单尚未下发 Cookie 载荷", retryable: false },
  SUBSCRIPTION_GUARD_REQUIRED: { status: 409, message: "本次交付尚未完成订阅状态检查", retryable: false },
  DELIVERY_EXPIRED: { status: 410, message: "交付订单已过期", retryable: false },
  RESULT_IDENTITY_MISMATCH: { status: 422, message: "结果邮箱与订单 Session 不一致", retryable: false },
  REQUEST_INVALID: { status: 400, message: "请求参数无效", retryable: false },
  REQUEST_TOO_LARGE: { status: 413, message: "请求正文超过大小限制", retryable: false },
  UNSUPPORTED_MEDIA_TYPE: { status: 415, message: "只接受 application/json", retryable: false },
  SESSION_INVALID: { status: 422, message: "Session 解密或解析失败", retryable: false },
  EXPECTED_IDENTITY_MISSING: { status: 422, message: "Session 或包装响应缺少合法邮箱", retryable: false },
  CONVERTER_IDENTITY_MISMATCH: { status: 422, message: "Session 与包装响应邮箱不一致", retryable: false },
  COOKIE_PAYLOAD_INVALID: { status: 422, message: "Cookie 载荷无效", retryable: false },
  CONVERTER_NOT_CONFIGURED: { status: 503, message: "Cookie 包装服务尚未配置", retryable: true, retryScope: "global" },
  CONVERTER_AUTH_FAILED: { status: 503, message: "Cookie 包装服务鉴权失败", retryable: true, retryScope: "global" },
  CONVERTER_RATE_LIMITED: { status: 503, message: "Cookie 包装服务请求过于频繁", retryable: true, retryScope: "global" },
  CONVERTER_RESPONSE_TOO_LARGE: { status: 502, message: "Cookie 包装服务响应过大", retryable: true, retryScope: "global" },
  CONVERTER_CONTRACT_DRIFT: { status: 502, message: "Cookie 包装服务契约发生变化", retryable: true, retryScope: "global" },
  CONVERTER_UNAVAILABLE: { status: 502, message: "Cookie 包装服务暂时不可用", retryable: true, retryScope: "global" },
  CONVERTER_RESPONSE_INVALID: { status: 502, message: "Cookie 包装服务响应无效", retryable: true, retryScope: "global" },
  CONVERTER_TIMEOUT: { status: 504, message: "Cookie 包装服务请求超时", retryable: true, retryScope: "global" },
  SUBSCRIPTION_CHECK_FAILED: { status: 502, message: "订阅状态查询暂时失败", retryable: true, retryScope: "global" },
  SUBSCRIPTION_CANCEL_FAILED: { status: 502, message: "欠费账号自动续费取消暂时失败", retryable: true, retryScope: "global" },
  SUBSCRIPTION_GUARD_UNAVAILABLE: { status: 502, message: "订阅保护接口暂时不可用", retryable: true, retryScope: "global" }
});

const PERMANENT_RESULT_ERRORS = new Set([
  "CHATGPT_SESSION_UNAUTHORIZED",
  "CHATGPT_IDENTITY_MISSING",
  "CHATGPT_IDENTITY_MISMATCH"
]);

const RETRYABLE_RESULT_SCOPES = new Map([
  ["COOKIE_OPERATION_FAILED", "order"],
  ["CHATGPT_SESSION_VERIFY_RATE_LIMITED", "global"],
  ["CHATGPT_SESSION_VERIFY_UNAVAILABLE", "global"],
  ["CHATGPT_SESSION_VERIFY_TIMEOUT", "global"],
  ["CHATGPT_PAGE_RELOAD_FAILED", "order"],
  ["COOKIE_SCHEMA_UNSUPPORTED", "global"],
  ["COOKIE_PAYLOAD_REJECTED", "global"],
  ["COOKIE_ROLLBACK_FAILED", "global"],
  ["SUBSCRIPTION_CHECK_FAILED", "global"],
  ["SUBSCRIPTION_CANCEL_FAILED", "global"],
  ["SUBSCRIPTION_GUARD_UNAVAILABLE", "global"]
]);

function subscriptionProviderError(code, options = {}) {
  const error = new Error(code);
  error.code = code;
  error.statusCode = options.statusCode || 502;
  error.retryable = true;
  error.retryScope = "global";
  if (Number.isInteger(options.retryAfterMs) && options.retryAfterMs >= 0) {
    error.retryAfterMs = options.retryAfterMs;
  }
  return error;
}

function readRetryAfterMs(response) {
  const value = response.headers.get("retry-after");
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);
  const at = Date.parse(value);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : undefined;
}

async function readLimitedSubscriptionText(response, errorCode) {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > SUBSCRIPTION_RESPONSE_MAX_BYTES) {
    try { await response.body?.cancel(); } catch {}
    throw subscriptionProviderError(errorCode);
  }

  if (!response.body?.getReader) {
    const buffer = new Uint8Array(await response.arrayBuffer());
    if (buffer.byteLength > SUBSCRIPTION_RESPONSE_MAX_BYTES) throw subscriptionProviderError(errorCode);
    return new TextDecoder().decode(buffer);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > SUBSCRIPTION_RESPONSE_MAX_BYTES) {
      try { await reader.cancel(); } catch {}
      throw subscriptionProviderError(errorCode);
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

async function requestSubscriptionProvider(url, sessionJson, errorCode) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SUBSCRIPTION_REQUEST_TIMEOUT_MS);
  try {
    const response = await globalThis.fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify({ token: sessionJson }),
      signal: controller.signal
    });
    if (response.status === 401 || response.status === 403) {
      throw subscriptionProviderError(errorCode, { statusCode: 503 });
    }
    if (response.status === 429) {
      throw subscriptionProviderError(errorCode, {
        statusCode: 503,
        retryAfterMs: readRetryAfterMs(response)
      });
    }
    if (!response.ok) throw subscriptionProviderError(errorCode);

    const text = await readLimitedSubscriptionText(response, errorCode);
    let envelope;
    try { envelope = JSON.parse(text); } catch { throw subscriptionProviderError(errorCode); }
    if (!envelope || typeof envelope !== "object" || Array.isArray(envelope) || envelope.code !== 200) {
      throw subscriptionProviderError(errorCode);
    }
    return envelope;
  } catch (error) {
    if (error?.code) throw error;
    throw subscriptionProviderError(errorCode, {
      statusCode: error?.name === "AbortError" || controller.signal.aborted ? 504 : 502
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function runSubscriptionGuard(sessionJson) {
  const checkEnvelope = await requestSubscriptionProvider(
    SUBSCRIPTION_CHECK_URL,
    sessionJson,
    "SUBSCRIPTION_CHECK_FAILED"
  );
  const subscription = checkEnvelope.data;
  if (!subscription || typeof subscription !== "object" || Array.isArray(subscription)
    || typeof subscription.is_delinquent !== "boolean") {
    throw subscriptionProviderError("SUBSCRIPTION_CHECK_FAILED");
  }

  const isDelinquent = subscription.is_delinquent;
  const accountType = typeof subscription.account_type === "string"
    ? subscription.account_type.trim().toLowerCase()
    : "";
  const hasNoPaidExpiry = subscription.expire_time === null && subscription.expires_at === null;
  const queriedWillRenew = typeof subscription.auto_renew === "boolean"
    ? subscription.auto_renew
    : (accountType === "free" && hasNoPaidExpiry ? false : null);
  if (typeof queriedWillRenew !== "boolean") throw subscriptionProviderError("SUBSCRIPTION_CHECK_FAILED");
  let renewalCancelled = false;
  let willRenew = queriedWillRenew;
  if (queriedWillRenew === true) {
    const cancellationEnvelope = await requestSubscriptionProvider(
      SUBSCRIPTION_CANCEL_URL,
      sessionJson,
      "SUBSCRIPTION_CANCEL_FAILED"
    );
    if (cancellationEnvelope.data !== 1) throw subscriptionProviderError("SUBSCRIPTION_CANCEL_FAILED");
    const recheckEnvelope = await requestSubscriptionProvider(
      SUBSCRIPTION_CHECK_URL,
      sessionJson,
      "SUBSCRIPTION_CHECK_FAILED"
    );
    if (!recheckEnvelope.data || typeof recheckEnvelope.data !== "object"
      || recheckEnvelope.data.auto_renew !== false) {
      throw subscriptionProviderError("SUBSCRIPTION_CANCEL_FAILED");
    }
    renewalCancelled = true;
    willRenew = false;
  }
  return { isDelinquent, willRenew, renewalCancelled };
}

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

function constantTimeHashEqual(actual, expected) {
  if (!actual || !expected || actual.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

function normalizeEmail(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (normalized.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) return null;
  return normalized;
}

function parseAllowedSiteSlugs(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed)
      ? [...new Set(parsed.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim()))]
      : [];
  } catch {
    return [];
  }
}

function isIsoDate(value) {
  return typeof value === "string" && value.length <= 40 && Number.isFinite(Date.parse(value));
}

function encodeCursor(row) {
  return Buffer.from(JSON.stringify({ createdAt: row.created_at, orderNo: row.order_no })).toString("base64url");
}

function decodeCursor(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(String(value), "base64url").toString("utf8"));
    if (!isIsoDate(parsed.createdAt) || typeof parsed.orderNo !== "string" || parsed.orderNo.length > 100) return null;
    return parsed;
  } catch {
    return null;
  }
}

function closeSocket(socket, code, reason) {
  try {
    if (socket?.readyState === 0 || socket?.readyState === 1) socket.close(code, reason);
  } catch {}
}

function sendSocket(socket, message) {
  if (socket?.readyState !== 1) return false;
  try {
    socket.send(JSON.stringify(message));
    return true;
  } catch {
    return false;
  }
}

function consumeRateLimit(store, key, max, nowMs = Date.now()) {
  const cutoff = nowMs - RATE_WINDOW_MS;
  const recent = (store.get(key) || []).filter((timestamp) => timestamp > cutoff);
  if (recent.length >= max) {
    store.set(key, recent);
    return Math.max(0, recent[0] + RATE_WINDOW_MS - nowMs);
  }
  recent.push(nowMs);
  store.set(key, recent);
  return null;
}

function safeOrderNo(value) {
  const orderNo = String(value || "").trim();
  return orderNo && orderNo.length <= 100 && /^[A-Za-z0-9_-]+$/.test(orderNo) ? orderNo : null;
}

export function createExtensionDeliveryService({
  app,
  db,
  decryptText,
  encryptText,
  requireAdmin,
  createAuditLog,
  converter = convertSessionToCookiePayload,
  now = () => new Date(),
  onDeliverySucceeded = null,
  isMaintenanceEnabled = () => false
}) {
  const wsRateLimits = new Map();
  const getRateLimits = new Map();
  const resultRateLimits = new Map();
  const subscriptionGuardRateLimits = new Map();
  const subscriptionGuardPromises = new Map();
  const activeConverterOrders = new Set();
  let converterBusy = false;
  let currentConnection = null;

  function nowIso() {
    return now().toISOString();
  }

  function getSettings() {
    const row = db.prepare("SELECT * FROM extension_delivery_settings WHERE id = 'default'").get();
    return {
      ...row,
      enabled: row?.enabled === 1,
      allowedSiteSlugs: parseAllowedSiteSlugs(row?.allowed_site_slugs)
    };
  }

  function setNoStore(reply) {
    reply.header("Cache-Control", "no-store");
    reply.header("Pragma", "no-cache");
  }

  function sendError(reply, code, overrides = {}) {
    setNoStore(reply);
    const definition = ERROR_DEFINITIONS[code] || ERROR_DEFINITIONS.CONVERTER_UNAVAILABLE;
    const retryAfterMs = Number.isInteger(overrides.retryAfterMs) && overrides.retryAfterMs >= 0
      ? overrides.retryAfterMs
      : undefined;
    if (retryAfterMs !== undefined && definition.status === 429) {
      reply.header("Retry-After", String(Math.max(0, Math.ceil(retryAfterMs / 1000))));
    }
    return reply.code(overrides.status || definition.status).send({
      code,
      message: overrides.message || definition.message,
      retryable: overrides.retryable ?? definition.retryable,
      ...((overrides.retryable ?? definition.retryable)
        ? { retryScope: overrides.retryScope || definition.retryScope || "global" }
        : {}),
      ...(retryAfterMs !== undefined ? { retryAfterMs } : {})
    });
  }

  function disconnectCurrent(code = "EXTENSION_UNAUTHORIZED") {
    if (!currentConnection) return;
    sendSocket(currentConnection.socket, { type: "auth.failed", code });
    closeSocket(currentConnection.socket, 1008, code);
    currentConnection = null;
  }

  function expirePendingDeliveries() {
    const at = nowIso();
    return db.prepare(`
      UPDATE redeem_orders
      SET extension_delivery_status = 'expired',
          extension_delivery_error = 'DELIVERY_EXPIRED',
          extension_delivery_updated_at = ?
      WHERE extension_delivery_status = 'pending'
        AND extension_delivery_expires_at IS NOT NULL
        AND extension_delivery_expires_at <= ?
    `).run(at, at).changes;
  }

  function expireOrderIfNeeded(orderNo) {
    const at = nowIso();
    return db.prepare(`
      UPDATE redeem_orders
      SET extension_delivery_status = 'expired',
          extension_delivery_error = 'DELIVERY_EXPIRED',
          extension_delivery_updated_at = ?
      WHERE order_no = ?
        AND extension_delivery_status = 'pending'
        AND extension_delivery_expires_at IS NOT NULL
        AND extension_delivery_expires_at <= ?
    `).run(at, orderNo, at).changes > 0;
  }

  function pendingMessage(row) {
    return {
      type: "session.available",
      orderNo: row.order_no,
      createdAt: row.created_at,
      expiresAt: row.extension_delivery_expires_at,
      retryRevision: row.extension_delivery_retry_revision || 0
    };
  }

  function getEligiblePendingRows() {
    expirePendingDeliveries();
    const settings = getSettings();
    if (!settings.enabled || !settings.spacexcard_api_token_encrypted || !settings.extension_token_sha256) return [];
    const allowed = new Set(settings.allowedSiteSlugs);
    return db.prepare(`
      SELECT o.order_no, o.created_at, o.extension_delivery_expires_at,
             o.extension_delivery_retry_revision, s.slug AS site_slug
      FROM redeem_orders o
      LEFT JOIN sites s ON s.id = o.site_id
      WHERE o.extension_delivery_status = 'pending'
        AND o.extension_delivery_expires_at > ?
      ORDER BY o.created_at ASC, o.order_no ASC
    `).all(nowIso()).filter((row) => allowed.has(row.site_slug));
  }

  function publishAllEligible() {
    if (!currentConnection) return 0;
    let count = 0;
    for (const row of getEligiblePendingRows()) {
      if (sendSocket(currentConnection.socket, pendingMessage(row))) count += 1;
    }
    return count;
  }

  function publishSessionAvailable(orderNo) {
    if (!currentConnection) return false;
    expireOrderIfNeeded(orderNo);
    const settings = getSettings();
    if (!settings.enabled || !settings.spacexcard_api_token_encrypted) return false;
    const row = db.prepare(`
      SELECT o.order_no, o.created_at, o.extension_delivery_expires_at,
             o.extension_delivery_retry_revision, o.extension_delivery_status,
             s.slug AS site_slug
      FROM redeem_orders o
      LEFT JOIN sites s ON s.id = o.site_id
      WHERE o.order_no = ?
    `).get(orderNo);
    if (!row || row.extension_delivery_status !== "pending" || !settings.allowedSiteSlugs.includes(row.site_slug)) return false;
    return sendSocket(currentConnection.socket, pendingMessage(row));
  }

  function isSiteEligibleForNewOrder(siteSlug) {
    const settings = getSettings();
    return settings.enabled && settings.allowedSiteSlugs.includes(siteSlug);
  }

  function enrollmentForSite(siteSlug, createdAt) {
    if (!isSiteEligibleForNewOrder(siteSlug)) {
      return { status: null, expiresAt: null, updatedAt: null };
    }
    return {
      status: "pending",
      expiresAt: new Date(new Date(createdAt).getTime() + DELIVERY_TTL_MS).toISOString(),
      updatedAt: createdAt
    };
  }

  function authHeaderToken(request) {
    const header = request.headers.authorization;
    if (typeof header !== "string" || !header.startsWith("Bearer ")) return null;
    const token = header.slice(7).trim();
    return token && token.length <= 2048 ? token : null;
  }

  function authenticateRequest(request, reply) {
    setNoStore(reply);
    const token = authHeaderToken(request);
    const installationId = String(request.headers["x-extension-installation-id"] || "").trim();
    const settings = getSettings();
    const requestHash = token ? hashToken(token) : null;
    if (!requestHash || !constantTimeHashEqual(requestHash, settings.extension_token_sha256)) {
      sendError(reply, "EXTENSION_UNAUTHORIZED");
      return null;
    }
    if (!installationId || installationId.length > 200 || settings.bound_installation_id !== installationId) {
      sendError(reply, "EXTENSION_INSTALLATION_MISMATCH");
      return null;
    }
    return { requestHash, installationId, settings };
  }

  function applyRestRateLimit(store, limit, auth, reply) {
    const retryAfterMs = consumeRateLimit(store, `${auth.requestHash}:${auth.installationId}`, limit);
    if (retryAfterMs === null) return true;
    sendError(reply, "EXTENSION_RATE_LIMITED", { retryAfterMs });
    return false;
  }

  function loadDelivery(orderNo) {
    return db.prepare(`
      SELECT o.*, s.slug AS site_slug
      FROM redeem_orders o
      LEFT JOIN sites s ON s.id = o.site_id
      WHERE o.order_no = ?
    `).get(orderNo);
  }

  function deliveryStateError(reply, row) {
    if (row?.extension_delivery_status === "expired") return sendError(reply, "DELIVERY_EXPIRED");
    if (row?.extension_delivery_status && row.extension_delivery_status !== "pending") {
      return sendError(reply, "DELIVERY_ALREADY_FINISHED");
    }
    return sendError(reply, "DELIVERY_NOT_FOUND");
  }

  function recheckBeforePayload(auth, orderNo, permanentErrorCode = null) {
    return db.transaction(() => {
      const settings = getSettings();
      if (!constantTimeHashEqual(auth.requestHash, settings.extension_token_sha256)) return { error: "EXTENSION_UNAUTHORIZED" };
      if (settings.bound_installation_id !== auth.installationId) return { error: "EXTENSION_INSTALLATION_MISMATCH" };
      if (!settings.enabled) return { error: "EXTENSION_DELIVERY_DISABLED" };
      if (!settings.spacexcard_api_token_encrypted) return { error: "CONVERTER_NOT_CONFIGURED" };

      const row = loadDelivery(orderNo);
      if (!row || !settings.allowedSiteSlugs.includes(row.site_slug)) return { error: "DELIVERY_NOT_FOUND" };
      const at = nowIso();
      if (row.extension_delivery_status === "pending" && row.extension_delivery_expires_at <= at) {
        db.prepare(`
          UPDATE redeem_orders
          SET extension_delivery_status = 'expired', extension_delivery_error = 'DELIVERY_EXPIRED',
              extension_delivery_updated_at = ?
          WHERE order_no = ? AND extension_delivery_status = 'pending'
        `).run(at, orderNo);
        return { error: "DELIVERY_EXPIRED" };
      }
      if (row.extension_delivery_status === "expired") return { error: "DELIVERY_EXPIRED" };
      if (row.extension_delivery_status !== "pending") return { error: "DELIVERY_ALREADY_FINISHED" };

      if (permanentErrorCode) {
        const changed = db.prepare(`
          UPDATE redeem_orders
          SET extension_delivery_status = 'failed', extension_delivery_error = ?,
              extension_delivered_at = NULL, extension_delivery_updated_at = ?
          WHERE order_no = ? AND extension_delivery_status = 'pending'
        `).run(permanentErrorCode, at, orderNo).changes;
        return changed ? { error: permanentErrorCode } : { error: "DELIVERY_ALREADY_FINISHED" };
      }

      const changed = db.prepare(`
        UPDATE redeem_orders
        SET extension_delivery_attempts = extension_delivery_attempts + 1,
            extension_delivery_updated_at = ?
        WHERE order_no = ? AND extension_delivery_status = 'pending'
      `).run(at, orderNo).changes;
      return changed ? { row: { ...row, extension_delivery_updated_at: at } } : { error: "DELIVERY_ALREADY_FINISHED" };
    })();
  }

  function sendMappedError(reply, error) {
    const code = ERROR_DEFINITIONS[error?.code] ? error.code : "CONVERTER_UNAVAILABLE";
    return sendError(reply, code, {
      status: error?.statusCode,
      retryable: error?.retryable,
      retryScope: error?.retryScope,
      retryAfterMs: error?.retryAfterMs
    });
  }

  async function handleGetDelivery(request, reply) {
    const auth = authenticateRequest(request, reply);
    if (!auth || !applyRestRateLimit(getRateLimits, COOKIE_GET_LIMIT, auth, reply)) return;
    const orderNo = safeOrderNo(request.params.orderNo);
    if (!orderNo) return sendError(reply, "DELIVERY_NOT_FOUND");
    if (!auth.settings.enabled) return sendError(reply, "EXTENSION_DELIVERY_DISABLED");
    if (!auth.settings.spacexcard_api_token_encrypted) return sendError(reply, "CONVERTER_NOT_CONFIGURED");

    expireOrderIfNeeded(orderNo);
    const row = loadDelivery(orderNo);
    if (!row || !auth.settings.allowedSiteSlugs.includes(row.site_slug)) return sendError(reply, "DELIVERY_NOT_FOUND");
    if (row.extension_delivery_status !== "pending") return deliveryStateError(reply, row);
    if (converterBusy || activeConverterOrders.has(orderNo)) {
      return sendError(reply, "EXTENSION_DELIVERY_BUSY", { retryAfterMs: 1000 });
    }

    converterBusy = true;
    activeConverterOrders.add(orderNo);
    let payload;
    let conversionError;
    try {
      let sessionJson;
      let apiToken;
      try {
        sessionJson = JSON.parse(decryptText(row.session_payload));
      } catch {
        conversionError = Object.assign(new Error("Session 解密或解析失败"), {
          code: "SESSION_INVALID",
          statusCode: 422,
          retryable: false
        });
      }
      if (!conversionError) {
        try {
          apiToken = decryptText(auth.settings.spacexcard_api_token_encrypted);
        } catch {
          conversionError = Object.assign(new Error("Cookie 包装服务 Token 无法解密"), {
            code: "CONVERTER_NOT_CONFIGURED",
            statusCode: 503,
            retryable: true,
            retryScope: "global"
          });
        }
      }
      if (!conversionError) payload = await converter(sessionJson, { apiToken });
    } catch (error) {
      conversionError = error;
    } finally {
      activeConverterOrders.delete(orderNo);
      converterBusy = false;
    }

    if (conversionError) {
      if (conversionError.retryable === false && [
        "SESSION_INVALID",
        "EXPECTED_IDENTITY_MISSING",
        "CONVERTER_IDENTITY_MISMATCH",
        "COOKIE_PAYLOAD_INVALID"
      ].includes(conversionError.code)) {
        const rechecked = recheckBeforePayload(auth, orderNo, conversionError.code);
        if (rechecked.error !== conversionError.code) return sendError(reply, rechecked.error);
      }
      return sendMappedError(reply, conversionError);
    }

    const rechecked = recheckBeforePayload(auth, orderNo);
    if (rechecked.error) return sendError(reply, rechecked.error);
    setNoStore(reply);
    return {
      orderNo,
      schemaVersion: payload.schemaVersion,
      expectedEmail: payload.expectedEmail,
      expiresAt: rechecked.row.extension_delivery_expires_at,
      clearCookieRules: payload.clearCookieRules,
      cookies: payload.cookies
    };
  }

  function hasCurrentSubscriptionGuard(row) {
    return Boolean(row?.extension_subscription_checked_at)
      && Number(row.extension_subscription_checked_attempt) === Number(row.extension_delivery_attempts);
  }

  function subscriptionGuardResponse(row) {
    const rawWillRenew = row.extension_subscription_will_renew;
    return {
      checked: true,
      checkedAt: row.extension_subscription_checked_at,
      isDelinquent: row.extension_subscription_delinquent === 1,
      willRenew: rawWillRenew === null || rawWillRenew === undefined ? null : rawWillRenew === 1,
      renewalCancelled: Boolean(row.extension_subscription_cancelled_at),
      cancelledAt: row.extension_subscription_cancelled_at || null
    };
  }

  function throwDeliveryCode(code) {
    throw Object.assign(new Error(code), { code });
  }

  async function executeSubscriptionGuard(auth, orderNo) {
    expireOrderIfNeeded(orderNo);
    const row = loadDelivery(orderNo);
    if (!row || row.extension_delivery_status === null) throwDeliveryCode("DELIVERY_NOT_FOUND");
    if (row.extension_delivery_status !== "pending") {
      throwDeliveryCode(row.extension_delivery_status === "expired" ? "DELIVERY_EXPIRED" : "DELIVERY_ALREADY_FINISHED");
    }
    if (!(row.extension_delivery_attempts > 0)) throwDeliveryCode("DELIVERY_RESULT_NOT_EXPECTED");
    if (hasCurrentSubscriptionGuard(row)) return row;

    const settings = getSettings();
    if (!constantTimeHashEqual(auth.requestHash, settings.extension_token_sha256)) throwDeliveryCode("EXTENSION_UNAUTHORIZED");
    if (settings.bound_installation_id !== auth.installationId) throwDeliveryCode("EXTENSION_INSTALLATION_MISMATCH");
    let sessionJson;
    try {
      sessionJson = JSON.parse(decryptText(row.session_payload));
    } catch {
      throw subscriptionProviderError("SUBSCRIPTION_CHECK_FAILED", { statusCode: 503 });
    }
    if (!sessionJson || typeof sessionJson !== "object" || Array.isArray(sessionJson)) {
      throw subscriptionProviderError("SUBSCRIPTION_CHECK_FAILED", { statusCode: 503 });
    }
    const guard = await runSubscriptionGuard(sessionJson);
    const saved = db.transaction(() => {
      const currentSettings = getSettings();
      if (!constantTimeHashEqual(auth.requestHash, currentSettings.extension_token_sha256)) return { error: "EXTENSION_UNAUTHORIZED" };
      if (currentSettings.bound_installation_id !== auth.installationId) return { error: "EXTENSION_INSTALLATION_MISMATCH" };

      const current = loadDelivery(orderNo);
      if (!current || current.extension_delivery_status === null) return { error: "DELIVERY_NOT_FOUND" };
      const at = nowIso();
      if (current.extension_delivery_status === "pending" && current.extension_delivery_expires_at <= at) {
        db.prepare(`
          UPDATE redeem_orders
          SET extension_delivery_status = 'expired', extension_delivery_error = 'DELIVERY_EXPIRED',
              extension_delivery_updated_at = ?
          WHERE order_no = ? AND extension_delivery_status = 'pending'
        `).run(at, orderNo);
        return { error: "DELIVERY_EXPIRED" };
      }
      if (current.extension_delivery_status !== "pending") {
        return { error: current.extension_delivery_status === "expired" ? "DELIVERY_EXPIRED" : "DELIVERY_ALREADY_FINISHED" };
      }
      if (!(current.extension_delivery_attempts > 0)) return { error: "DELIVERY_RESULT_NOT_EXPECTED" };
      if (hasCurrentSubscriptionGuard(current)) return { row: current };

      db.prepare(`
        UPDATE redeem_orders
        SET extension_subscription_checked_attempt = ?, extension_subscription_checked_at = ?,
            extension_subscription_delinquent = ?, extension_subscription_will_renew = ?,
            extension_subscription_cancelled_at = CASE WHEN ? = 1 THEN ? ELSE extension_subscription_cancelled_at END,
            extension_delivery_updated_at = ?
        WHERE order_no = ? AND extension_delivery_status = 'pending'
      `).run(
        current.extension_delivery_attempts,
        at,
        guard.isDelinquent ? 1 : 0,
        guard.willRenew === null ? null : (guard.willRenew ? 1 : 0),
        guard.renewalCancelled ? 1 : 0,
        at,
        at,
        orderNo
      );
      createAuditLog({
        action: "extension_delivery.subscription_guard",
        actor: "extension",
        resourceType: "redeem_order",
        resourceId: orderNo,
        detail: {
          attempt: current.extension_delivery_attempts,
          isDelinquent: guard.isDelinquent,
          willRenew: guard.willRenew,
          renewalCancelled: guard.renewalCancelled
        }
      });
      return { row: loadDelivery(orderNo) };
    })();
    if (saved.error) throwDeliveryCode(saved.error);
    return saved.row;
  }

  async function handleSubscriptionGuard(request, reply) {
    const auth = authenticateRequest(request, reply);
    if (!auth || !applyRestRateLimit(subscriptionGuardRateLimits, SUBSCRIPTION_GUARD_LIMIT, auth, reply)) return;
    const orderNo = safeOrderNo(request.params.orderNo);
    if (!orderNo) return sendError(reply, "DELIVERY_NOT_FOUND");

    let promise = subscriptionGuardPromises.get(orderNo);
    if (!promise) {
      promise = executeSubscriptionGuard(auth, orderNo);
      subscriptionGuardPromises.set(orderNo, promise);
    }
    try {
      const row = await promise;
      setNoStore(reply);
      return subscriptionGuardResponse(row);
    } catch (error) {
      const code = ERROR_DEFINITIONS[error?.code] ? error.code : "SUBSCRIPTION_CHECK_FAILED";
      return sendError(reply, code, {
        status: error?.statusCode,
        retryable: error?.retryable,
        retryScope: error?.retryScope,
        retryAfterMs: error?.retryAfterMs
      });
    } finally {
      if (subscriptionGuardPromises.get(orderNo) === promise) subscriptionGuardPromises.delete(orderNo);
    }
  }

  function parseStoredSessionEmail(row) {
    try {
      return normalizeEmail(JSON.parse(decryptText(row.session_payload))?.user?.email);
    } catch {
      return null;
    }
  }

  function finalResultResponse(row) {
    return {
      orderNo: row.order_no,
      status: row.extension_delivery_status,
      expiresAt: row.extension_delivery_expires_at,
      deliveredAt: row.extension_delivered_at || null
    };
  }

  function handleResultTransaction(auth, orderNo, body) {
    return db.transaction(() => {
      const settings = getSettings();
      if (!constantTimeHashEqual(auth.requestHash, settings.extension_token_sha256)) return { error: "EXTENSION_UNAUTHORIZED" };
      if (settings.bound_installation_id !== auth.installationId) return { error: "EXTENSION_INSTALLATION_MISMATCH" };
      const row = loadDelivery(orderNo);
      if (!row || row.extension_delivery_status === null) return { error: "DELIVERY_NOT_FOUND" };
      const at = nowIso();
      if (row.extension_delivery_status === "pending" && row.extension_delivery_expires_at <= at) {
        db.prepare(`
          UPDATE redeem_orders
          SET extension_delivery_status = 'expired', extension_delivery_error = 'DELIVERY_EXPIRED',
              extension_delivery_updated_at = ?
          WHERE order_no = ? AND extension_delivery_status = 'pending'
        `).run(at, orderNo);
        return { error: "DELIVERY_EXPIRED" };
      }
      if (row.extension_delivery_status === "expired") return { error: "DELIVERY_EXPIRED" };

      if (["succeeded", "failed"].includes(row.extension_delivery_status)) {
        const sameSucceeded = row.extension_delivery_status === "succeeded" && body.status === "succeeded"
          && normalizeEmail(body.email) === parseStoredSessionEmail(row);
        const sameFailed = row.extension_delivery_status === "failed" && body.status === "failed"
          && row.extension_delivery_error === body.error;
        return sameSucceeded || sameFailed
          ? { row }
          : { error: "DELIVERY_ALREADY_FINISHED" };
      }
      if (row.extension_delivery_status !== "pending") return { error: "DELIVERY_NOT_FOUND" };
      if (!(row.extension_delivery_attempts > 0)) return { error: "DELIVERY_RESULT_NOT_EXPECTED" };

      if (body.status === "retryable_failure") {
        const expectedScope = RETRYABLE_RESULT_SCOPES.get(body.error);
        if (!expectedScope || body.retryScope !== expectedScope) return { error: "REQUEST_INVALID" };
        db.prepare(`
          UPDATE redeem_orders
          SET extension_delivery_error = ?, extension_delivery_updated_at = ?
          WHERE order_no = ? AND extension_delivery_status = 'pending'
        `).run(body.error, at, orderNo);
        return { row: { ...row, extension_delivery_error: body.error, extension_delivery_updated_at: at } };
      }

      if (body.status === "failed") {
        if (!PERMANENT_RESULT_ERRORS.has(body.error)) return { error: "REQUEST_INVALID" };
        db.prepare(`
          UPDATE redeem_orders
          SET extension_delivery_status = 'failed', extension_delivery_error = ?,
              extension_delivered_at = NULL, extension_delivery_updated_at = ?
          WHERE order_no = ? AND extension_delivery_status = 'pending'
        `).run(body.error, at, orderNo);
        return { row: { ...row, extension_delivery_status: "failed", extension_delivery_error: body.error, extension_delivery_updated_at: at } };
      }

      if (body.status === "succeeded") {
        if (!hasCurrentSubscriptionGuard(row)) return { error: "SUBSCRIPTION_GUARD_REQUIRED" };
        const expectedEmail = parseStoredSessionEmail(row);
        const reportedEmail = normalizeEmail(body.email);
        if (!expectedEmail || !reportedEmail || expectedEmail !== reportedEmail) return { error: "RESULT_IDENTITY_MISMATCH" };
        db.prepare(`
          UPDATE redeem_orders
          SET extension_delivery_status = 'succeeded', extension_delivery_error = NULL,
              extension_delivered_at = ?, extension_delivery_updated_at = ?
          WHERE order_no = ? AND extension_delivery_status = 'pending'
        `).run(at, at, orderNo);
        return { row: { ...row, extension_delivery_status: "succeeded", extension_delivery_error: null, extension_delivered_at: at, extension_delivery_updated_at: at } };
      }
      return { error: "REQUEST_INVALID" };
    })();
  }

  async function handleResult(request, reply) {
    const auth = authenticateRequest(request, reply);
    if (!auth || !applyRestRateLimit(resultRateLimits, RESULT_POST_LIMIT, auth, reply)) return;
    const contentType = String(request.headers["content-type"] || "").toLowerCase();
    if (!contentType.startsWith("application/json")) return sendError(reply, "UNSUPPORTED_MEDIA_TYPE");
    const orderNo = safeOrderNo(request.params.orderNo);
    const body = request.body;
    if (!orderNo || !body || typeof body !== "object" || Array.isArray(body)
      || !["succeeded", "failed", "retryable_failure"].includes(body.status)) {
      return sendError(reply, "REQUEST_INVALID");
    }
    if (body.status === "succeeded" && (typeof body.email !== "string" || Object.keys(body).some((key) => !["status", "email"].includes(key)))) {
      return sendError(reply, "REQUEST_INVALID");
    }
    if (body.status === "failed" && (typeof body.error !== "string" || Object.keys(body).some((key) => !["status", "error"].includes(key)))) {
      return sendError(reply, "REQUEST_INVALID");
    }
    if (body.status === "retryable_failure" && (typeof body.error !== "string" || typeof body.retryScope !== "string"
      || Object.keys(body).some((key) => !["status", "error", "retryScope"].includes(key)))) {
      return sendError(reply, "REQUEST_INVALID");
    }

    const outcome = handleResultTransaction(auth, orderNo, body);
    if (outcome.error) return sendError(reply, outcome.error);
    if (body.status === "succeeded" && outcome.row?.extension_delivery_status === "succeeded") {
      try {
        onDeliverySucceeded?.({
          orderNo,
          verifiedEmail: normalizeEmail(body.email),
          at: outcome.row.extension_delivery_updated_at || nowIso()
        });
      } catch {
        // The worker also reconciles succeeded Session Deliveries, so this hint is safely retryable.
      }
    }
    setNoStore(reply);
    return finalResultResponse(outcome.row);
  }

  function publishMembershipNotification(message) {
    if (!message || typeof message !== "object" || Array.isArray(message)) return false;
    if (message.type === "membership.available") {
      const fulfillmentId = String(message.fulfillmentId || "");
      const revision = Number(message.revision);
      const createdAt = String(message.createdAt || "");
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(fulfillmentId) || !Number.isInteger(revision)
        || revision < 0 || !isIsoDate(createdAt)) return false;
      return sendSocket(currentConnection?.socket, {
        type: "membership.available",
        fulfillmentId,
        revision,
        createdAt: new Date(createdAt).toISOString()
      });
    }
    if (message.type === "membership.resume") {
      const resumeRevision = Number(message.resumeRevision);
      if (!Number.isInteger(resumeRevision) || resumeRevision < 0) return false;
      return sendSocket(currentConnection?.socket, { type: "membership.resume", resumeRevision });
    }
    return false;
  }

  function websocketAuthFailure(socket, code) {
    sendSocket(socket, { type: "auth.failed", code });
    closeSocket(socket, 1008, code);
  }

  function bindInstallation(requestHash, installationId) {
    return db.transaction(() => {
      const settings = getSettings();
      if (!settings.enabled || !settings.spacexcard_api_token_encrypted || !settings.extension_token_sha256) {
        return { error: "EXTENSION_DELIVERY_DISABLED" };
      }
      if (!constantTimeHashEqual(requestHash, settings.extension_token_sha256)) {
        return { error: "EXTENSION_UNAUTHORIZED" };
      }
      if (settings.bound_installation_id && settings.bound_installation_id !== installationId) {
        return { error: "EXTENSION_INSTALLATION_MISMATCH" };
      }
      if (!settings.bound_installation_id) {
        const changed = db.prepare(`
          UPDATE extension_delivery_settings
          SET bound_installation_id = ?, updated_at = ?
          WHERE id = 'default' AND bound_installation_id IS NULL AND extension_token_sha256 = ?
        `).run(installationId, nowIso(), requestHash).changes;
        if (changed !== 1) return { error: "EXTENSION_INSTALLATION_MISMATCH" };
      }
      return { settings: getSettings() };
    })();
  }

  function registerWebSocketRoute() {
    app.get("/api/extension/session-delivery/ws", { websocket: true }, (socket, request) => {
      const retryAfterMs = consumeRateLimit(wsRateLimits, request.ip || "unknown", WS_AUTH_LIMIT);
      if (retryAfterMs !== null) {
        sendSocket(socket, { type: "EXTENSION_RATE_LIMITED", code: "EXTENSION_RATE_LIMITED", retryAfterMs });
        return closeSocket(socket, 1013, "EXTENSION_RATE_LIMITED");
      }

      let authenticated = false;
      const timeout = setTimeout(() => closeSocket(socket, 1008, "AUTH_TIMEOUT"), AUTH_TIMEOUT_MS);
      socket.on("message", (raw) => {
        const bytes = typeof raw === "string" ? Buffer.byteLength(raw, "utf8") : raw.byteLength;
        if (bytes > WS_MAX_MESSAGE_BYTES) return closeSocket(socket, 1009, "MESSAGE_TOO_LARGE");
        let message;
        try {
          message = JSON.parse(typeof raw === "string" ? raw : raw.toString("utf8"));
        } catch {
          return closeSocket(socket, 1008, "INVALID_MESSAGE");
        }

        if (!authenticated) {
          if (message?.type !== "auth" || typeof message.token !== "string" || message.token.length > 2048
            || typeof message.installationId !== "string" || !message.installationId.trim() || message.installationId.length > 200) {
            clearTimeout(timeout);
            return websocketAuthFailure(socket, "EXTENSION_UNAUTHORIZED");
          }
          const outcome = bindInstallation(hashToken(message.token.trim()), message.installationId.trim());
          if (outcome.error) {
            clearTimeout(timeout);
            return websocketAuthFailure(socket, outcome.error);
          }

          authenticated = true;
          clearTimeout(timeout);
          if (currentConnection?.socket !== socket) closeSocket(currentConnection?.socket, 1000, "REPLACED");
          currentConnection = {
            socket,
            installationId: message.installationId.trim(),
            connectedAt: nowIso(),
            lastHeartbeatAt: nowIso()
          };
          sendSocket(socket, {
            type: "authenticated",
            heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
            resumeRevision: outcome.settings.resume_revision || 0
          });
          publishAllEligible();
          return;
        }

        if (message?.type === "ping") {
          if (currentConnection?.socket === socket) currentConnection.lastHeartbeatAt = nowIso();
          sendSocket(socket, { type: "pong" });
        } else if (message?.type === "pong" && currentConnection?.socket === socket) {
          currentConnection.lastHeartbeatAt = nowIso();
        }
      });

      socket.on("close", () => {
        clearTimeout(timeout);
        if (currentConnection?.socket === socket) currentConnection = null;
      });
      socket.on("error", () => {});
    });
  }

  function serializeSettings() {
    const settings = getSettings();
    return {
      enabled: settings.enabled,
      allowedSiteSlugs: settings.allowedSiteSlugs,
      provider: "spacexcard",
      converterUrl: CONVERTER_URL,
      hasSpacexcardToken: Boolean(settings.spacexcard_api_token_encrypted),
      hasExtensionToken: Boolean(settings.extension_token_sha256),
      boundInstallationId: settings.bound_installation_id || null,
      resumeRevision: settings.resume_revision || 0,
      online: Boolean(currentConnection),
      connectedAt: currentConnection?.connectedAt || null,
      lastHeartbeatAt: currentConnection?.lastHeartbeatAt || null,
      updatedAt: settings.updated_at,
      updatedBy: settings.updated_by || null
    };
  }

  function registerAdminRoutes() {
    app.get("/api/admin/extension-delivery/settings", { preHandler: requireAdmin }, async (_request, reply) => {
      setNoStore(reply);
      return {
        settings: serializeSettings(),
        sites: db.prepare("SELECT name, slug, status FROM sites ORDER BY name ASC, slug ASC").all()
      };
    });

    app.put("/api/admin/extension-delivery/settings", { preHandler: requireAdmin }, async (request, reply) => {
      setNoStore(reply);
      const body = request.body;
      if (!body || typeof body !== "object" || Array.isArray(body) || typeof body.enabled !== "boolean"
        || !Array.isArray(body.allowedSiteSlugs) || body.allowedSiteSlugs.length > 100) {
        return reply.code(400).send({ message: "扩展交付设置无效" });
      }
      const allowedSiteSlugs = [...new Set(body.allowedSiteSlugs.map((item) => String(item || "").trim()).filter(Boolean))];
      if (allowedSiteSlugs.some((slug) => slug.length > 100)) return reply.code(400).send({ message: "站点标识无效" });
      const knownSites = new Set(db.prepare("SELECT slug FROM sites").all().map((row) => row.slug));
      if (allowedSiteSlugs.some((slug) => !knownSites.has(slug))) return reply.code(400).send({ message: "包含不存在的站点" });

      const existing = getSettings();
      const providedToken = typeof body.spacexcardApiToken === "string" ? body.spacexcardApiToken.trim() : "";
      if (providedToken.length > 8192) return reply.code(400).send({ message: "spacexcard Token 过长" });
      const encryptedToken = body.clearSpacexcardToken === true
        ? null
        : (providedToken ? encryptText(providedToken) : existing.spacexcard_api_token_encrypted);
      if (body.enabled && (!encryptedToken || !existing.extension_token_sha256)) {
        return reply.code(400).send({ message: "启用前必须配置 spacexcard Token 并生成 Extension Token" });
      }

      const at = nowIso();
      db.prepare(`
        UPDATE extension_delivery_settings
        SET enabled = ?, allowed_site_slugs = ?, spacexcard_api_token_encrypted = ?,
            updated_at = ?, updated_by = ?
        WHERE id = 'default'
      `).run(body.enabled ? 1 : 0, JSON.stringify(allowedSiteSlugs), encryptedToken, at, request.admin.username);
      createAuditLog({
        action: "extension_delivery.settings.update",
        actor: request.admin.username,
        resourceType: "extension_delivery_settings",
        resourceId: "default",
        detail: {
          enabled: body.enabled,
          allowedSiteSlugs,
          spacexcardTokenAction: body.clearSpacexcardToken === true ? "cleared" : (providedToken ? "replaced" : "unchanged")
        }
      });
      if (!body.enabled || !encryptedToken) disconnectCurrent("EXTENSION_DELIVERY_DISABLED");
      else publishAllEligible();
      return { settings: serializeSettings() };
    });

    app.post("/api/admin/extension-delivery/token", { preHandler: requireAdmin }, async (request, reply) => {
      setNoStore(reply);
      const action = request.body?.action;
      if (!["generate", "reset", "revoke"].includes(action)) return reply.code(400).send({ message: "Token 操作无效" });
      const existing = getSettings();
      if (action === "generate" && existing.extension_token_sha256) {
        return reply.code(409).send({ message: "Extension Token 已存在，遗失时请执行重置" });
      }

      const token = action === "revoke" ? null : randomBytes(32).toString("base64url");
      const at = nowIso();
      db.prepare(`
        UPDATE extension_delivery_settings
        SET extension_token_sha256 = ?, bound_installation_id = NULL,
            enabled = CASE WHEN ? = 'revoke' THEN 0 ELSE enabled END,
            updated_at = ?, updated_by = ?
        WHERE id = 'default'
      `).run(token ? hashToken(token) : null, action, at, request.admin.username);
      createAuditLog({
        action: `extension_delivery.token.${action}`,
        actor: request.admin.username,
        resourceType: "extension_delivery_settings",
        resourceId: "default",
        detail: { action }
      });
      disconnectCurrent(action === "revoke" ? "EXTENSION_DELIVERY_DISABLED" : "EXTENSION_UNAUTHORIZED");
      return { settings: serializeSettings(), ...(token ? { token } : {}) };
    });

    app.get("/api/admin/extension-deliveries", { preHandler: requireAdmin }, async (request, reply) => {
      expirePendingDeliveries();
      const status = String(request.query?.status || "").trim();
      const siteSlug = String(request.query?.siteSlug || "").trim();
      const from = String(request.query?.from || "").trim();
      const to = String(request.query?.to || "").trim();
      const limit = Math.min(100, Math.max(1, Number.parseInt(request.query?.limit || "50", 10) || 50));
      const cursorValue = String(request.query?.cursor || "").trim();
      const cursor = decodeCursor(cursorValue);
      if (status && !["pending", "succeeded", "failed", "expired"].includes(status)) return reply.code(400).send({ message: "交付状态无效" });
      if (siteSlug.length > 100 || (from && !isIsoDate(from)) || (to && !isIsoDate(to)) || (cursorValue && !cursor)) {
        return reply.code(400).send({ message: "筛选参数无效" });
      }
      const clauses = ["o.extension_delivery_status IS NOT NULL"];
      const values = [];
      if (status) { clauses.push("o.extension_delivery_status = ?"); values.push(status); }
      if (siteSlug) { clauses.push("s.slug = ?"); values.push(siteSlug); }
      if (from) { clauses.push("o.created_at >= ?"); values.push(new Date(from).toISOString()); }
      if (to) { clauses.push("o.created_at <= ?"); values.push(new Date(to).toISOString()); }
      if (cursor) {
        clauses.push("(o.created_at < ? OR (o.created_at = ? AND o.order_no < ?))");
        values.push(cursor.createdAt, cursor.createdAt, cursor.orderNo);
      }
      const rows = db.prepare(`
        SELECT o.order_no, s.slug AS site_slug, o.extension_delivery_status,
               o.extension_delivery_attempts, o.extension_delivery_error, o.created_at,
               o.extension_delivery_expires_at, o.extension_delivered_at,
               o.extension_delivery_updated_at, o.extension_subscription_checked_attempt,
               o.extension_subscription_checked_at,
               o.extension_subscription_delinquent, o.extension_subscription_will_renew,
               o.extension_subscription_cancelled_at
        FROM redeem_orders o
        LEFT JOIN sites s ON s.id = o.site_id
        WHERE ${clauses.join(" AND ")}
        ORDER BY o.created_at DESC, o.order_no DESC
        LIMIT ?
      `).all(...values, limit + 1);
      const page = rows.slice(0, limit);
      setNoStore(reply);
      return {
        items: page.map((row) => {
          const currentSubscriptionGuard = hasCurrentSubscriptionGuard(row);
          return {
            orderNo: row.order_no,
            siteSlug: row.site_slug || null,
            status: row.extension_delivery_status,
            attempts: row.extension_delivery_attempts || 0,
            errorCode: row.extension_delivery_error || null,
            createdAt: row.created_at,
            expiresAt: row.extension_delivery_expires_at,
            deliveredAt: row.extension_delivered_at || null,
            updatedAt: row.extension_delivery_updated_at || null,
            subscriptionCheckedAt: currentSubscriptionGuard ? row.extension_subscription_checked_at : null,
            subscriptionDelinquent: currentSubscriptionGuard ? row.extension_subscription_delinquent === 1 : null,
            subscriptionWillRenew: currentSubscriptionGuard && row.extension_subscription_will_renew !== null
              ? row.extension_subscription_will_renew === 1
              : null,
            renewalCancelledAt: row.extension_subscription_cancelled_at || null
          };
        }),
        nextCursor: rows.length > limit ? encodeCursor(page[page.length - 1]) : null
      };
    });

    app.post("/api/admin/extension-deliveries/:orderNo/retry", { preHandler: requireAdmin }, async (request, reply) => {
      const orderNo = safeOrderNo(request.params.orderNo);
      if (!orderNo) return reply.code(404).send({ message: "交付订单不存在" });
      expireOrderIfNeeded(orderNo);
      const result = db.transaction(() => {
        const row = loadDelivery(orderNo);
        if (!row || row.extension_delivery_status === null) return { error: "DELIVERY_NOT_FOUND" };
        if (row.extension_delivery_status !== "pending") return { error: "DELIVERY_ALREADY_FINISHED" };
        const at = nowIso();
        db.prepare(`
          UPDATE redeem_orders
          SET extension_delivery_retry_revision = extension_delivery_retry_revision + 1,
              extension_delivery_updated_at = ?
          WHERE order_no = ? AND extension_delivery_status = 'pending'
        `).run(at, orderNo);
        const updated = loadDelivery(orderNo);
        createAuditLog({
          action: "extension_delivery.retry",
          actor: request.admin.username,
          resourceType: "redeem_order",
          resourceId: orderNo,
          detail: { orderNo, retryRevision: updated.extension_delivery_retry_revision }
        });
        return { row: updated };
      })();
      if (result.error === "DELIVERY_NOT_FOUND") return reply.code(404).send({ code: result.error, message: "交付订单不存在" });
      if (result.error) return reply.code(409).send({ code: result.error, message: "终态交付不能重试" });
      publishSessionAvailable(orderNo);
      setNoStore(reply);
      return { orderNo, retryRevision: result.row.extension_delivery_retry_revision };
    });

    app.post("/api/admin/extension-delivery/resume", { preHandler: requireAdmin }, async (request, reply) => {
      const at = nowIso();
      const revision = db.transaction(() => {
        db.prepare(`
          UPDATE extension_delivery_settings
          SET resume_revision = resume_revision + 1, updated_at = ?, updated_by = ?
          WHERE id = 'default'
        `).run(at, request.admin.username);
        const next = getSettings().resume_revision;
        createAuditLog({
          action: "extension_delivery.resume",
          actor: request.admin.username,
          resourceType: "extension_delivery_settings",
          resourceId: "default",
          detail: { resumeRevision: next }
        });
        return next;
      })();
      sendSocket(currentConnection?.socket, { type: "delivery.resume", resumeRevision: revision });
      publishAllEligible();
      setNoStore(reply);
      return { resumeRevision: revision };
    });
  }

  app.get("/api/extension/session-deliveries/:orderNo", handleGetDelivery);
  app.post("/api/extension/session-deliveries/:orderNo/subscription-guard", handleSubscriptionGuard);
  app.post("/api/extension/session-deliveries/:orderNo/result", {
    bodyLimit: WS_MAX_MESSAGE_BYTES,
    onRequest: async (_request, reply) => setNoStore(reply),
    errorHandler(error, _request, reply) {
      if (error?.code === "FST_ERR_CTP_BODY_TOO_LARGE" || error?.statusCode === 413) {
        return sendError(reply, "REQUEST_TOO_LARGE");
      }
      if (error?.code === "FST_ERR_CTP_INVALID_MEDIA_TYPE" || error?.statusCode === 415) {
        return sendError(reply, "UNSUPPORTED_MEDIA_TYPE");
      }
      return sendError(reply, "REQUEST_INVALID");
    }
  }, handleResult);
  registerWebSocketRoute();
  registerAdminRoutes();

  if (!isMaintenanceEnabled()) expirePendingDeliveries();
  const expiryTimer = setInterval(() => {
    if (!isMaintenanceEnabled()) expirePendingDeliveries();
  }, 60_000);
  expiryTimer.unref?.();
  app.addHook("onClose", async () => {
    clearInterval(expiryTimer);
    closeSocket(currentConnection?.socket, 1001, "SERVER_SHUTDOWN");
    currentConnection = null;
  });

  return {
    authenticateRequest,
    enrollmentForSite,
    expirePendingDeliveries,
    isSiteEligibleForNewOrder,
    publishMembershipNotification,
    publishSessionAvailable,
    publishAllEligible,
    hasActiveWork() {
      return converterBusy || activeConverterOrders.size > 0 || subscriptionGuardPromises.size > 0;
    },
    closeForMaintenance() {
      closeSocket(currentConnection?.socket, 1012, "MAINTENANCE_MODE");
      currentConnection = null;
    },
    serializeSettings
  };
}
