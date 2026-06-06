import { createHash, randomBytes } from "node:crypto";
import http from "node:http";
import { getDb } from "../../shared/src/database.js";
import { env } from "../../shared/src/env.js";
import { normalizeSourceKey } from "../../shared/src/cdkey-utils.js";
import { decryptText } from "../../shared/src/secure.js";
import { encodeRequestBody, evaluateRule, renderJsonTemplate, renderTemplateString, safeParseJson } from "../../shared/src/templates.js";
import { cdkeyStatuses, endpointTypes, jobStatuses, logActions, notificationEventTypes, orderStatuses } from "../../shared/src/constants.js";
import { getNumber, getStatus, setStatus } from "../../shared/src/fivesim-client.js";
import {
  buildFeishuMarkdown,
  clampIntervalSeconds,
  evaluateMonitorRules,
  fetchMonitorEndpoint,
  normalizeWatchFields,
  sendFeishuMarkdown,
  summarizeResponseInfo
} from "../../shared/src/notifications.js";
import { getAvailableQuota } from "../../shared/src/quota-calc.js";

const db = getDb();
const workerId = `worker-${process.pid}`;
const BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36";

function nowIso() {
  return new Date().toISOString();
}

function addSeconds(dateString, seconds) {
  const date = new Date(dateString);
  date.setSeconds(date.getSeconds() + seconds);
  return date.toISOString();
}

function writeAuditLog(action, resourceType, resourceId, detail) {
  db.prepare(`
    INSERT INTO admin_audit_logs (id, action, actor, resource_type, resource_id, detail, created_at)
    VALUES (lower(hex(randomblob(8))), ?, 'worker', ?, ?, ?, ?)
  `).run(action, resourceType, resourceId, detail ? JSON.stringify(detail) : null, nowIso());
}

function claimJob() {
  const now = nowIso();
  const candidate = db.prepare(`
    SELECT *
    FROM activation_jobs
    WHERE status = 'pending'
      AND (next_retry_at IS NULL OR next_retry_at <= ?)
      AND locked_at IS NULL
    ORDER BY created_at ASC
    LIMIT 1
  `).get(now);

  if (!candidate) return null;

  const result = db.prepare(`
    UPDATE activation_jobs
    SET locked_at = ?, locked_by = ?, status = ?
    WHERE id = ? AND locked_at IS NULL AND status = 'pending'
  `).run(now, workerId, jobStatuses.processing, candidate.id);

  return result.changes ? { ...candidate, status: jobStatuses.processing, locked_at: now, locked_by: workerId } : null;
}

function buildRequestContext(job, order, cdkey, site, endpoint) {
  const sessionJson = JSON.parse(decryptText(order.session_payload));
  const sessionRaw = JSON.stringify(sessionJson);
  const sourceKey = decryptText(cdkey.source_key);
  const jobPayload = safeParseJson(job.payload, {});
  const abandonRemainingTime = Boolean(jobPayload.abandonRemainingTime || order.abandon_remaining_time);
  return {
    orderNo: order.order_no,
    publicKey: cdkey.public_key,
    sourceKey,
    normalizedSourceKey: normalizeSourceKey(sourceKey),
    session: sessionJson,
    sessionRaw,
    // Use this in templates when the remote field expects a JSON string, not an object.
    sessionString: JSON.stringify(sessionRaw),
    abandonRemainingTime,
    endpointName: endpoint?.name || site?.name || "Unknown",
    siteName: site?.name || null,
    siteSlug: site?.slug || null
  };
}

function getUrlOrigin(url) {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}

function is9977Site(site) {
  return String(site?.slug || "").trim().toLowerCase() === "9977";
}

function getResponseSetCookies(headers) {
  if (typeof headers?.getSetCookie === "function") {
    return headers.getSetCookie();
  }
  const fallback = headers?.get("set-cookie");
  return fallback ? [fallback] : [];
}

function compactCookieHeader(cookies = []) {
  return cookies
    .map((item) => String(item ?? "").split(";")[0].trim())
    .filter(Boolean)
    .join("; ");
}

function mergeCookieHeaders(...values) {
  const cookies = new Map();
  for (const value of values) {
    for (const item of String(value ?? "").split(";")) {
      const cookie = item.trim();
      if (!cookie || !cookie.includes("=")) continue;
      const name = cookie.split("=")[0].trim();
      if (name) cookies.set(name, cookie);
    }
  }
  return Array.from(cookies.values()).join("; ");
}

function applyAuthHeaders(headers, remoteConfig, bodyString) {
  if (remoteConfig.authType === "bearer" && remoteConfig.authConfig) {
    headers.Authorization = `Bearer ${remoteConfig.authConfig}`;
    return;
  }

  if (remoteConfig.authType === "header_json" && remoteConfig.authConfig) {
    Object.assign(headers, safeParseJson(remoteConfig.authConfig, {}));
    return;
  }

  if (remoteConfig.authType === "oaifire_sign") {
    const timestamp = Date.now().toString();
    const nonce = randomBytes(16).toString("hex");
    const salt = remoteConfig.authConfig || "ChatGPT#Plus@2026!";
    const bodyHash = bodyString ? createHash("md5").update(bodyString).digest("hex") : "";
    const sign = createHash("sha256").update(`${salt}${timestamp}${nonce}${bodyHash}`).digest("hex");
    const origin = getUrlOrigin(remoteConfig.url);

    headers["X-Timestamp"] = timestamp;
    headers["X-Nonce"] = nonce;
    headers["X-Sign"] = sign;

    if (origin) {
      headers.Origin = headers.Origin || origin;
      headers.Referer = headers.Referer || `${origin}/`;
    }
  }
}

async function fetch9977VerificationCookie(site, context) {
  const renderedHeaders = renderJsonTemplate(site.verify_headers_template || "{}", context);
  const renderedBody = renderJsonTemplate(site.verify_body_template || "{}", context);
  const headers = typeof renderedHeaders === "string"
    ? safeParseJson(renderedHeaders, {})
    : renderedHeaders;
  const body = typeof renderedBody === "string"
    ? safeParseJson(renderedBody, renderedBody)
    : renderedBody;
  const method = site.verify_http_method || "POST";
  const bodyString = method === "GET" ? "" : encodeRequestBody(body, headers);
  const verifyConfig = {
    url: site.verify_api_url,
    method,
    authType: site.auth_type,
    authConfig: site.auth_config,
    timeoutSeconds: site.timeout_seconds || 15
  };
  applyAuthHeaders(headers, verifyConfig, bodyString);

  const origin = getUrlOrigin(site.verify_api_url);
  const fetchHeaders = {
    "User-Agent": BROWSER_UA,
    "Accept": "application/json, text/plain, */*",
    "Referer": origin ? `${origin}/` : undefined,
    "Origin": origin || undefined,
    "Content-Type": "application/json",
    ...headers
  };
  if (site.request_cookies) {
    fetchHeaders.Cookie = site.request_cookies;
  }

  let response;
  let responseText = "";
  let responseJson = null;

  try {
    response = await fetch(site.verify_api_url, {
      method,
      headers: fetchHeaders,
      body: method === "GET" ? undefined : bodyString,
      signal: AbortSignal.timeout((site.timeout_seconds || 15) * 1000)
    });
    responseText = await response.text();
    responseJson = safeParseJson(responseText, null);
  } catch (error) {
    return {
      ok: false,
      status: 599,
      text: error.message,
      json: null,
      cookieHeader: ""
    };
  }

  const responseInfo = {
    ok: response.ok,
    status: response.status,
    text: responseText,
    json: responseJson
  };
  const failureMatched = site.verify_failure_rule ? evaluateRule(site.verify_failure_rule, responseInfo) : false;
  const successMatched = site.verify_success_rule ? evaluateRule(site.verify_success_rule, responseInfo) : responseInfo.ok;

  return {
    ...responseInfo,
    ok: response.ok && !failureMatched && successMatched,
    cookieHeader: compactCookieHeader(getResponseSetCookies(response.headers))
  };
}

function extractFailureMessages(responseInfo = {}) {
  const candidates = [
    responseInfo.json?.error,
    responseInfo.json?.message,
    responseInfo.json?.msg,
    responseInfo.json?.result,
    responseInfo.json?.data?.error,
    responseInfo.json?.data?.msg,
    responseInfo.json?.data?.message,
    responseInfo.json?.data?.statusMessage,
    responseInfo.json?.code,
    responseInfo.json?.data?.code,
    responseInfo.text
  ];

  return candidates
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);
}

// 把远端 `{code, message}` 类响应组合成更可读的错误，方便订单/任务列表展示。
function formatRemoteErrorMessage(responseInfo = {}, fallback = "") {
  const json = responseInfo.json;
  if (json && typeof json === "object") {
    const code = json.code || json.data?.code;
    const message = json.error_msg
      || json.error
      || json.message
      || json.msg
      || json.data?.error_msg
      || json.data?.error
      || json.data?.message
      || json.data?.msg
      || json.data?.statusMessage;
    if (code && message) return `${code}: ${message}`;
    if (message) return String(message);
    if (code) return String(code);
  }
  return fallback || responseInfo.text || `HTTP ${responseInfo.status}`;
}

function extractTaskIdFromText(text) {
  const match = String(text ?? "").match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  return match ? match[0] : "";
}

function extractRemoteTaskId(responseInfo, taskIdPath) {
  const fromJson = getJsonByPath(responseInfo?.json, taskIdPath || "task_id");
  if (fromJson) {
    return String(fromJson);
  }

  const candidates = [
    responseInfo?.json?.error,
    responseInfo?.json?.message,
    responseInfo?.json?.msg,
    responseInfo?.text
  ];

  for (const candidate of candidates) {
    const taskId = extractTaskIdFromText(candidate);
    if (taskId) return taskId;
  }

  return "";
}

function getRemoteTaskStatus(responseInfo = {}) {
  const status = responseInfo.json?.status;
  return typeof status === "string" ? status.trim().toLowerCase() : "";
}

function isKnownSuccessfulTaskStatus(responseInfo = {}) {
  return ["completed", "success", "succeeded"].includes(getRemoteTaskStatus(responseInfo));
}

function isKnownFailedTaskStatus(responseInfo = {}) {
  return ["failed", "error"].includes(getRemoteTaskStatus(responseInfo));
}

function getPollingConfig(site) {
  const intervalMs = Number(site?.poll_interval_ms);
  const maxRounds = Number(site?.poll_max_rounds);
  return {
    intervalMs: Number.isFinite(intervalMs) && intervalMs >= 1000 ? intervalMs : 5000,
    maxRounds: Number.isFinite(maxRounds) && maxRounds >= 1 ? maxRounds : 6
  };
}

function isNonRetryableFailure(responseInfo = {}, fallbackMessage = "") {
  const messages = extractFailureMessages(responseInfo);
  if (fallbackMessage) {
    messages.push(String(fallbackMessage));
  }

  const normalized = messages.join("\n").toLowerCase();
  const exactKeywords = [
    "token已失效",
    "token无效",
    "token 已失效",
    "token 无效",
    "token内容格式错误",
    "token 内容格式错误",
    "session格式错误",
    "session 格式错误",
    "session 无效",
    "session无效",
    "session 已失效",
    "session已失效",
    "缺少account字段",
    "缺少 account 字段",
    "字段缺失",
    "missing account",
    "account field is required",
    "token expired",
    "token invalid",
    "invalid token",
    "expired token",
    "invalid_session",
    "invalid session",
    "session_invalid",
    "cdk_used",
    "cdk used",
    "cdk 已被使用",
    "卡密已被使用",
    "已被使用",
    "cdk_invalid",
    "cdk invalid",
    "invalid_cdk",
    // redeemgpt 特有的不可重试错误
    "cdkey 已充值成功",
    "cdkey 正在充值中",
    "session信息或账号异常",
    "未找到对应cdk",
    "cdk异常",
    "cdk已作废",
    "该账号当前plan为",
    "无法进行充值",
    "参数缺少或错误"
  ];

  if (exactKeywords.some((keyword) => normalized.includes(keyword))) {
    return true;
  }

  // Treat obvious user-correctable payload errors as fail-fast so the card can be resubmitted immediately.
  return (
    (normalized.includes("token") || normalized.includes("session")) &&
    (
      normalized.includes("格式错误")
      || normalized.includes("format error")
      || normalized.includes("invalid format")
      || normalized.includes("missing")
      || normalized.includes("缺少")
      || normalized.includes("字段")
      || normalized.includes("field")
      || normalized.includes("account")
    )
  );
}

function shouldTreatAlreadyUsedAsSuccess(site, responseInfo = {}, fallbackMessage = "") {
  const slug = String(site?.slug || "").trim().toLowerCase();
  if (slug !== "666") return false;

  const normalized = [
    responseInfo.json?.message,
    responseInfo.json?.msg,
    responseInfo.json?.result,
    responseInfo.json?.data?.message,
    responseInfo.json?.data?.msg,
    responseInfo.text,
    fallbackMessage
  ]
    .map((value) => String(value ?? "").trim().toLowerCase())
    .filter(Boolean)
    .join("\n");

  return [
    "cdk_used",
    "cdk used",
    "cdk已被使用",
    "cdk 已被使用",
    "卡密已被使用",
    "已被使用",
    "already used"
  ].some((keyword) => normalized.includes(keyword));
}

async function invokeEndpoint(job, order, cdkey, site, endpoint) {
  const remoteConfig = site?.submit_api_url ? {
    url: site.submit_api_url,
    method: site.submit_http_method || "POST",
    headersTemplate: site.submit_headers_template || "{}",
    bodyTemplate: site.submit_body_template || '{"card":"{{sourceKey}}","session":{{sessionRaw}}}',
    abandonBodyTemplate: site.abandon_submit_body_template,
    authType: site.auth_type,
    authConfig: site.auth_config,
    successRule: site.submit_success_rule,
    failureRule: site.submit_failure_rule,
    timeoutSeconds: site.timeout_seconds || 15,
    maxRetries: site.max_retries || 3,
    endpointType: "api"
  } : {
    url: endpoint?.submit_url,
    method: endpoint?.http_method || "POST",
    headersTemplate: endpoint?.headers_template || "{}",
    bodyTemplate: endpoint?.body_template || "{}",
    abandonBodyTemplate: endpoint?.abandon_submit_body_template,
    authType: endpoint?.auth_type,
    authConfig: endpoint?.auth_config,
    successRule: endpoint?.success_rule,
    failureRule: endpoint?.failure_rule,
    timeoutSeconds: endpoint?.timeout_seconds || 15,
    maxRetries: endpoint?.max_retries || 3,
    endpointType: endpoint?.endpoint_type || "api"
  };

  if (remoteConfig.endpointType === endpointTypes.browser) {
    return {
      ok: false,
      status: 400,
      text: "browser 类型通道需要二阶段支持，当前 worker 不执行浏览器自动化。",
      json: null
    };
  }

  const context = buildRequestContext(job, order, cdkey, site, endpoint);
  let requestCookieHeader = site?.request_cookies || "";
  if (is9977Site(site) && site?.verify_api_url) {
    const verifyInfo = await fetch9977VerificationCookie(site, context);
    if (!verifyInfo.ok) {
      return {
        ok: false,
        status: verifyInfo.status,
        text: verifyInfo.text,
        json: verifyInfo.json,
        phase: "verify_code"
      };
    }
    requestCookieHeader = mergeCookieHeaders(requestCookieHeader, verifyInfo.cookieHeader);
  }

  const bodyTemplate = context.abandonRemainingTime && remoteConfig.abandonBodyTemplate
    ? remoteConfig.abandonBodyTemplate
    : remoteConfig.bodyTemplate;
  const renderedHeaders = renderJsonTemplate(remoteConfig.headersTemplate || "{}", context);
  const renderedBody = renderJsonTemplate(bodyTemplate || "{}", context);
  const headers = typeof renderedHeaders === "string"
    ? safeParseJson(renderedHeaders, {})
    : renderedHeaders;
  const body = typeof renderedBody === "string"
    ? safeParseJson(renderedBody, renderedBody)
    : renderedBody;
  const bodyString = remoteConfig.method === "GET" ? "" : encodeRequestBody(body, headers);
  applyAuthHeaders(headers, remoteConfig, bodyString);

  let response;
  let responseText = "";
  let responseJson = null;

  try {
    const origin = getUrlOrigin(remoteConfig.url);
    const fetchHeaders = {
      "User-Agent": BROWSER_UA,
      "Accept": "application/json, text/plain, */*",
      "Referer": origin ? `${origin}/` : undefined,
      "Origin": origin || undefined,
      "Content-Type": "application/json",
      ...headers
    };
    if (requestCookieHeader) {
      fetchHeaders.Cookie = requestCookieHeader;
    }
    response = await fetch(remoteConfig.url, {
      method: remoteConfig.method || "POST",
      headers: fetchHeaders,
      body: remoteConfig.method === "GET" ? undefined : bodyString,
      signal: AbortSignal.timeout((remoteConfig.timeoutSeconds || 15) * 1000)
    });
    responseText = await response.text();
    try {
      responseJson = JSON.parse(responseText);
    } catch {
      responseJson = null;
    }
  } catch (error) {
    return {
      ok: false,
      status: 599,
      text: error.message,
      json: null
    };
  }

  return {
    ok: response.ok,
    status: response.status,
    text: responseText,
    json: responseJson
  };
}

function markSuccess(jobId, orderId, cdkeyId, responseInfo) {
  const now = nowIso();
  db.prepare(`
    UPDATE activation_jobs
    SET status = ?, attempt_count = attempt_count + 1, last_error = NULL, last_response = ?,
        locked_at = NULL, locked_by = NULL, delivered_at = ?, updated_at = ?
    WHERE id = ?
  `).run(jobStatuses.succeeded, JSON.stringify(responseInfo), now, now, jobId);

  db.prepare(`
    UPDATE redeem_orders
    SET status = ?, error_message = NULL, completed_at = ?, updated_at = ?
    WHERE id = ?
  `).run(orderStatuses.succeeded, now, now, orderId);

  db.prepare(`
    UPDATE cdkeys
    SET status = ?, used_at = ?, updated_at = ?
    WHERE id = ?
  `).run(cdkeyStatuses.used, now, now, cdkeyId);

  writeAuditLog(logActions.jobSuccess, "activation_job", jobId, responseInfo);
}

function markRetry(job, orderId, errorMessage, responseInfo, maxAttempts) {
  const now = nowIso();
  const nextRetryAt = addSeconds(now, Math.min(300, Math.max(30, job.attempt_count * 30 + 30)));
  db.prepare(`
    UPDATE activation_jobs
    SET status = ?, attempt_count = attempt_count + 1, next_retry_at = ?, last_error = ?, last_response = ?,
        locked_at = NULL, locked_by = NULL, updated_at = ?
    WHERE id = ?
  `).run(jobStatuses.pending, nextRetryAt, errorMessage, JSON.stringify(responseInfo), now, job.id);

  db.prepare(`
    UPDATE redeem_orders
    SET status = ?, error_message = ?, updated_at = ?
    WHERE id = ?
  `).run(orderStatuses.processing, `自动重试中（${job.attempt_count + 1}/${maxAttempts}）: ${errorMessage}`, now, orderId);

  writeAuditLog(logActions.jobFail, "activation_job", job.id, {
    errorMessage,
    nextRetryAt,
    attemptCount: job.attempt_count + 1
  });
}

function markFailed(jobId, orderId, cdkeyId, errorMessage, responseInfo) {
  const now = nowIso();
  db.prepare(`
    UPDATE activation_jobs
    SET status = ?, attempt_count = attempt_count + 1, last_error = ?, last_response = ?,
        locked_at = NULL, locked_by = NULL, updated_at = ?
    WHERE id = ?
  `).run(jobStatuses.failed, errorMessage, JSON.stringify(responseInfo), now, jobId);

  db.prepare(`
    UPDATE redeem_orders
    SET status = ?, error_message = ?, updated_at = ?
    WHERE id = ?
  `).run(orderStatuses.failed, errorMessage, now, orderId);

  db.prepare(`
    UPDATE cdkeys
    SET status = ?, locked_at = NULL, locked_by_order_id = NULL, updated_at = ?
    WHERE id = ? AND status = ? AND locked_by_order_id = ?
  `).run(cdkeyStatuses.active, now, cdkeyId, cdkeyStatuses.locked, orderId);

  writeAuditLog(logActions.jobFail, "activation_job", jobId, {
    errorMessage,
    final: true
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function updateJobPayload(jobId, extraFields) {
  const row = db.prepare("SELECT payload FROM activation_jobs WHERE id = ?").get(jobId);
  const existing = safeParseJson(row?.payload, {});
  const merged = { ...existing, ...extraFields };
  db.prepare("UPDATE activation_jobs SET payload = ?, updated_at = ? WHERE id = ?")
    .run(JSON.stringify(merged), nowIso(), jobId);
}

/**
 * 5sim SMS 验证流程处理函数
 * 流程: 购买号码 → 提交手机号到目标 → 轮询验证码 → 提交验证码到目标 → 完成
 */
async function processFiveSimJob(job, order, cdkey, site) {
  const maxAttempts = site?.max_retries || job.max_attempts || 3;
  const apiKey = decryptText(site.sms_api_key);

  // Build base context from existing helper
  const baseContext = buildRequestContext(job, order, cdkey, site, null);

  // ── Step 1: Purchase phone number ──
  let fivesimOrderId;
  let fivesimPhone;

  try {
    const result = await getNumber(
      apiKey,
      site.sms_service,
      site.sms_country || "china",
      site.sms_operator || "any"
    );
    fivesimOrderId = result.id;
    fivesimPhone = result.number;
  } catch (err) {
    const errMsg = err.message || "unknown error";

    // Error-to-action mapping for getNumber failures
    if (errMsg === "NO_BALANCE") {
      updateJobPayload(job.id, { fivesimStatus: "error", fivesimError: "5sim: 余额不足" });
      markFailed(job.id, order.id, cdkey.id, "5sim: 余额不足", null);
      return;
    }
    if (errMsg === "BAD_KEY") {
      updateJobPayload(job.id, { fivesimStatus: "error", fivesimError: "5sim: API Key 无效" });
      markFailed(job.id, order.id, cdkey.id, "5sim: API Key 无效", null);
      return;
    }
    if (errMsg === "BAD_SERVICE") {
      updateJobPayload(job.id, { fivesimStatus: "error", fivesimError: "5sim: 服务名称无效" });
      markFailed(job.id, order.id, cdkey.id, "5sim: 服务名称无效", null);
      return;
    }

    // NO_NUMBERS and network errors are retryable
    let retryMessage;
    if (errMsg === "NO_NUMBERS") {
      retryMessage = "5sim: 暂无可用号码";
    } else if (errMsg.includes("failed:")) {
      // Network error from fetchApi (e.g., "GET /path failed: timeout after 15000ms")
      retryMessage = `5sim: network: ${errMsg}`;
    } else {
      retryMessage = `5sim: ${errMsg}`;
    }

    updateJobPayload(job.id, { fivesimStatus: "error", fivesimError: retryMessage });

    if (job.attempt_count + 1 >= maxAttempts) {
      markFailed(job.id, order.id, cdkey.id, retryMessage, null);
    } else {
      markRetry(job, order.id, retryMessage, null, maxAttempts);
    }
    return;
  }

  // Store order info in payload
  updateJobPayload(job.id, {
    fivesimOrderId,
    fivesimPhone,
    fivesimStatus: "waiting"
  });

  // Build extended template context with SMS-specific variables
  const phone = fivesimPhone.startsWith("+") ? fivesimPhone.slice(1) : fivesimPhone;
  const phoneWithPrefix = fivesimPhone.startsWith("+") ? fivesimPhone : `+${fivesimPhone}`;

  const smsContext = {
    ...baseContext,
    phone,
    phoneWithPrefix,
    smsCode: "",
    fivesimOrderId
  };

  // ── Step 2: Submit phone number to target service ──
  const phoneTemplate = site.sms_submit_phone_template || site.submit_body_template || '{}';
  const phoneHeaders = site.submit_headers_template || "{}";
  const phoneUrl = site.submit_api_url;
  const phoneMethod = site.submit_http_method || "POST";

  const renderedPhoneHeaders = renderJsonTemplate(phoneHeaders, smsContext);
  const renderedPhoneBody = renderJsonTemplate(phoneTemplate, smsContext);
  const parsedPhoneHeaders = typeof renderedPhoneHeaders === "string"
    ? safeParseJson(renderedPhoneHeaders, {})
    : renderedPhoneHeaders;
  const parsedPhoneBody = typeof renderedPhoneBody === "string"
    ? safeParseJson(renderedPhoneBody, renderedPhoneBody)
    : renderedPhoneBody;
  const phoneBodyString = phoneMethod === "GET" ? "" : JSON.stringify(parsedPhoneBody);

  applyAuthHeaders(parsedPhoneHeaders, {
    url: phoneUrl,
    authType: site.auth_type,
    authConfig: site.auth_config
  }, phoneBodyString);

  let phoneResponse;
  try {
    const origin = getUrlOrigin(phoneUrl);
    const fetchHeaders = {
      "User-Agent": BROWSER_UA,
      "Accept": "application/json, text/plain, */*",
      "Referer": origin ? `${origin}/` : undefined,
      "Origin": origin || undefined,
      "Content-Type": "application/json",
      ...parsedPhoneHeaders
    };
    if (site?.request_cookies) {
      fetchHeaders.Cookie = site.request_cookies;
    }
    const resp = await fetch(phoneUrl, {
      method: phoneMethod,
      headers: fetchHeaders,
      body: phoneMethod === "GET" ? undefined : phoneBodyString,
      signal: AbortSignal.timeout((site.timeout_seconds || 15) * 1000)
    });
    const text = await resp.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    phoneResponse = { ok: resp.ok, status: resp.status, text, json };
  } catch (error) {
    phoneResponse = { ok: false, status: 599, text: error.message, json: null };
  }

  // Evaluate phone submission success
  const phoneSuccessRule = site.submit_success_rule;
  const phoneSuccess = phoneSuccessRule
    ? evaluateRule(phoneSuccessRule, phoneResponse)
    : phoneResponse.ok;

  if (!phoneSuccess) {
    // Phone submission failed — cancel 5sim order and retry
    try {
      await setStatus(apiKey, fivesimOrderId, "cancel");
    } catch (cancelErr) {
      console.error(`[KaWang worker] 5sim cancel failed after phone submit error:`, cancelErr.message);
    }
    updateJobPayload(job.id, { fivesimStatus: "cancelled" });

    const errorMessage = formatRemoteErrorMessage(phoneResponse, phoneResponse.text || `HTTP ${phoneResponse.status}`);
    if (job.attempt_count + 1 >= maxAttempts) {
      markFailed(job.id, order.id, cdkey.id, errorMessage, phoneResponse);
    } else {
      markRetry(job, order.id, errorMessage, phoneResponse, maxAttempts);
    }
    return;
  }

  // ── Step 3: Poll for verification code ──
  const pollIntervalMs = Number(site.sms_poll_interval_ms) || 5000;
  const pollTimeoutMs = Number(site.sms_poll_timeout_ms) || 300000;
  const maxPollRounds = Math.floor(pollTimeoutMs / pollIntervalMs);

  let smsCode = null;

  for (let round = 0; round < maxPollRounds; round++) {
    if (round > 0) await sleep(pollIntervalMs);

    // Increment poll count in payload
    const currentPayload = safeParseJson(
      db.prepare("SELECT payload FROM activation_jobs WHERE id = ?").get(job.id)?.payload,
      {}
    );
    updateJobPayload(job.id, { fivesimPollCount: (currentPayload.fivesimPollCount || 0) + 1 });

    let statusResult;
    try {
      statusResult = await getStatus(apiKey, fivesimOrderId);
    } catch (err) {
      // Network error during polling — retry the job
      const errMsg = err.message || "unknown error";
      let retryMessage;
      if (errMsg.includes("failed:")) {
        retryMessage = `5sim: network: ${errMsg}`;
      } else {
        retryMessage = `5sim: ${errMsg}`;
      }

      try {
        await setStatus(apiKey, fivesimOrderId, "cancel");
      } catch (cancelErr) {
        console.error(`[KaWang worker] 5sim cancel failed after poll error:`, cancelErr.message);
      }
      updateJobPayload(job.id, { fivesimStatus: "cancelled" });

      if (job.attempt_count + 1 >= maxAttempts) {
        markFailed(job.id, order.id, cdkey.id, retryMessage, null);
      } else {
        markRetry(job, order.id, retryMessage, null, maxAttempts);
      }
      return;
    }

    if (statusResult.status === "cancelled") {
      // 5sim order was cancelled externally
      updateJobPayload(job.id, { fivesimStatus: "cancelled" });
      if (job.attempt_count + 1 >= maxAttempts) {
        markFailed(job.id, order.id, cdkey.id, "5sim: 订单已被取消", null);
      } else {
        markRetry(job, order.id, "5sim: 订单已被取消", null, maxAttempts);
      }
      return;
    }

    if (statusResult.status === "ok" && statusResult.code) {
      smsCode = statusResult.code;
      updateJobPayload(job.id, { fivesimCode: smsCode, fivesimStatus: "code_received" });
      break;
    }

    // status === "waiting" — continue polling
  }

  // ── Step 4: Handle poll timeout ──
  if (!smsCode) {
    // Timed out waiting for code — cancel and retry
    try {
      await setStatus(apiKey, fivesimOrderId, "cancel");
    } catch (cancelErr) {
      console.error(`[KaWang worker] 5sim cancel failed after poll timeout:`, cancelErr.message);
    }
    updateJobPayload(job.id, { fivesimStatus: "cancelled" });

    if (job.attempt_count + 1 >= maxAttempts) {
      markFailed(job.id, order.id, cdkey.id, "5sim: 验证码接收超时", null);
    } else {
      markRetry(job, order.id, "5sim: 验证码接收超时", null, maxAttempts);
    }
    return;
  }

  // ── Step 5: Submit verification code to target service ──
  const codeContext = {
    ...baseContext,
    phone,
    phoneWithPrefix,
    smsCode,
    fivesimOrderId
  };

  const codeTemplate = site.sms_submit_code_template || site.submit_body_template || '{}';
  const codeHeaders = site.submit_headers_template || "{}";
  const codeUrl = site.submit_api_url;
  const codeMethod = site.submit_http_method || "POST";

  const renderedCodeHeaders = renderJsonTemplate(codeHeaders, codeContext);
  const renderedCodeBody = renderJsonTemplate(codeTemplate, codeContext);
  const parsedCodeHeaders = typeof renderedCodeHeaders === "string"
    ? safeParseJson(renderedCodeHeaders, {})
    : renderedCodeHeaders;
  const parsedCodeBody = typeof renderedCodeBody === "string"
    ? safeParseJson(renderedCodeBody, renderedCodeBody)
    : renderedCodeBody;
  const codeBodyString = codeMethod === "GET" ? "" : JSON.stringify(parsedCodeBody);

  applyAuthHeaders(parsedCodeHeaders, {
    url: codeUrl,
    authType: site.auth_type,
    authConfig: site.auth_config
  }, codeBodyString);

  let codeResponse;
  try {
    const origin = getUrlOrigin(codeUrl);
    const fetchHeaders = {
      "User-Agent": BROWSER_UA,
      "Accept": "application/json, text/plain, */*",
      "Referer": origin ? `${origin}/` : undefined,
      "Origin": origin || undefined,
      "Content-Type": "application/json",
      ...parsedCodeHeaders
    };
    if (site?.request_cookies) {
      fetchHeaders.Cookie = site.request_cookies;
    }
    const resp = await fetch(codeUrl, {
      method: codeMethod,
      headers: fetchHeaders,
      body: codeMethod === "GET" ? undefined : codeBodyString,
      signal: AbortSignal.timeout((site.timeout_seconds || 15) * 1000)
    });
    const text = await resp.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    codeResponse = { ok: resp.ok, status: resp.status, text, json };
  } catch (error) {
    codeResponse = { ok: false, status: 599, text: error.message, json: null };
  }

  // Evaluate code submission success
  const codeSuccessRule = site.submit_success_rule;
  const codeSuccess = codeSuccessRule
    ? evaluateRule(codeSuccessRule, codeResponse)
    : codeResponse.ok;

  if (!codeSuccess) {
    // Code submission failed — cancel-before-fail: attempt to cancel 5sim order
    try {
      await setStatus(apiKey, fivesimOrderId, "cancel");
    } catch (cancelErr) {
      console.error(`[KaWang worker] 5sim cancel failed after code submit error:`, cancelErr.message);
    }
    updateJobPayload(job.id, { fivesimStatus: "cancelled" });

    // Mark as failed (code is consumed, cannot retry)
    const errorMessage = formatRemoteErrorMessage(codeResponse, codeResponse.text || `HTTP ${codeResponse.status}`);
    markFailed(job.id, order.id, cdkey.id, errorMessage, codeResponse);
    return;
  }

  // ── Step 6: Complete 5sim order and mark success ──
  try {
    await setStatus(apiKey, fivesimOrderId, "finish");
  } catch (finishErr) {
    console.error(`[KaWang worker] 5sim finish call failed:`, finishErr.message);
  }
  updateJobPayload(job.id, { fivesimStatus: "completed" });
  markSuccess(job.id, order.id, cdkey.id, codeResponse);
}

async function queryRemoteTask(queryUrl, site, context) {
  try {
    const method = (site?.query_http_method || "GET").toUpperCase();
    const origin = getUrlOrigin(queryUrl);
    const baseHeaders = {
      "User-Agent": BROWSER_UA,
      "Accept": "application/json, text/plain, */*",
      "Referer": origin ? `${origin}/` : undefined,
      "Content-Type": "application/json"
    };
    if (site?.query_headers_template && context) {
      const rendered = renderJsonTemplate(site.query_headers_template, context);
      const extra = typeof rendered === "string" ? safeParseJson(rendered, {}) : rendered;
      Object.assign(baseHeaders, extra);
    }
    if (site?.request_cookies) {
      baseHeaders.Cookie = site.request_cookies;
    }

    let bodyString;
    if (method !== "GET" && site?.query_body_template && context) {
      const rendered = renderJsonTemplate(site.query_body_template, context);
      bodyString = typeof rendered === "string" ? rendered : JSON.stringify(rendered);
    }

    const response = await fetch(queryUrl, {
      method,
      headers: baseHeaders,
      body: method === "GET" ? undefined : bodyString,
      signal: AbortSignal.timeout((site.timeout_seconds || 15) * 1000)
    });
    const text = await response.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    return { ok: response.ok, status: response.status, text, json };
  } catch (error) {
    return { ok: false, status: 599, text: error.message, json: null };
  }
}

function getJsonByPath(json, dotPath) {
  if (!json || !dotPath) return undefined;
  const segments = String(dotPath).split(".").filter(Boolean);
  let current = json;
  for (const segment of segments) {
    if (current === null || current === undefined) return undefined;
    current = current[segment];
  }
  return current;
}

async function pollRemoteTask(job, order, cdkey, site, remoteTaskId, endpoint) {
  const maxAttempts = site?.max_retries || job.max_attempts || 10;
  const querySuccessRule = site.query_success_rule;
  const queryFailureRule = site.query_failure_rule;
  const { intervalMs, maxRounds } = getPollingConfig(site);

  const baseContext = buildRequestContext(job, order, cdkey, site, endpoint);
  const queryContext = { ...baseContext, taskId: remoteTaskId };
  let latestQueryResult = null;

  for (let round = 0; round < maxRounds; round++) {
    if (round > 0) await sleep(intervalMs);

    const queryUrl = renderTemplateString(site.query_api_url, queryContext);
    const queryResult = await queryRemoteTask(queryUrl, site, queryContext);
    latestQueryResult = queryResult;

    const isSuccess = (querySuccessRule
      ? evaluateRule(querySuccessRule, queryResult)
      : false) || isKnownSuccessfulTaskStatus(queryResult);
    const queryErrorMessage = formatRemoteErrorMessage(
      queryResult,
      queryResult.json?.error_msg || queryResult.json?.error || queryResult.text || `HTTP ${queryResult.status}`
    );

    if (isSuccess) {
      markSuccess(job.id, order.id, cdkey.id, queryResult);
      return;
    }

    if (shouldTreatAlreadyUsedAsSuccess(site, queryResult, queryErrorMessage)) {
      markSuccess(job.id, order.id, cdkey.id, {
        ...queryResult,
        treatedAsSuccess: true,
        successReason: "666 站点返回 CDK 已使用，按成功处理"
      });
      return;
    }

    if (isNonRetryableFailure(queryResult, queryErrorMessage)) {
      markFailed(job.id, order.id, cdkey.id, queryErrorMessage, queryResult);
      return;
    }

    if ((queryFailureRule && evaluateRule(queryFailureRule, queryResult)) || isKnownFailedTaskStatus(queryResult)) {
      markFailed(job.id, order.id, cdkey.id, queryErrorMessage, queryResult);
      return;
    }

    if (!queryFailureRule) {
      const taskStatus = queryResult.json?.data?.taskStatus;
      if (taskStatus && taskStatus !== "PROCESSING" && taskStatus !== "PENDING") {
        const msg = queryResult.json?.data?.statusMessage || `远端任务失败: ${taskStatus}`;
        markFailed(job.id, order.id, cdkey.id, msg, queryResult);
        return;
      }
    }
  }

  updateJobPayload(job.id, { remoteTaskId });
  const msg = `远端任务仍在处理中，等待下轮继续轮询 (taskId: ${remoteTaskId})`;

  if (job.attempt_count + 1 >= maxAttempts) {
    markFailed(job.id, order.id, cdkey.id, `轮询超过最大重试次数: ${msg}`, latestQueryResult);
    return;
  }

  markRetry(job, order.id, msg, latestQueryResult, maxAttempts);
}

async function processJob(job) {
  const order = db.prepare("SELECT * FROM redeem_orders WHERE id = ?").get(job.order_id);
  const cdkey = db.prepare("SELECT * FROM cdkeys WHERE id = ?").get(job.cdkey_id);
  const site = db.prepare("SELECT * FROM sites WHERE id = ?").get(job.site_id || order?.site_id || cdkey?.site_id);
  const endpoint = db.prepare("SELECT * FROM activation_endpoints WHERE id = ?").get(job.activation_endpoint_id);

  if (!order || !cdkey || (!site && !endpoint)) {
    markFailed(job.id, job.order_id, job.cdkey_id, "任务依赖数据不存在", null);
    return;
  }

  if (site?.sms_provider === "5sim") {
    await processFiveSimJob(job, order, cdkey, site);
    return;
  }

  const jobPayload = safeParseJson(job.payload, {});
  const isPollingEnabled = site?.polling_enabled && site?.query_api_url;

  if (isPollingEnabled && jobPayload.remoteTaskId) {
    await pollRemoteTask(job, order, cdkey, site, jobPayload.remoteTaskId, endpoint);
    return;
  }

  const responseInfo = await invokeEndpoint(job, order, cdkey, site, endpoint);
  const failureRule = site?.submit_failure_rule || endpoint?.failure_rule;
  const successRule = site?.submit_success_rule || endpoint?.success_rule;
  const failureMatched = failureRule ? evaluateRule(failureRule, responseInfo) : false;
  const successMatched = successRule ? evaluateRule(successRule, responseInfo) : responseInfo.ok;
  const taskIdPath = site?.task_id_path || "data";
  const remoteTaskId = isPollingEnabled ? extractRemoteTaskId(responseInfo, taskIdPath) : "";
  const acceptedAsyncTask = Boolean(remoteTaskId) && Number(responseInfo.status) >= 200 && Number(responseInfo.status) < 300;

  if (!failureMatched && isPollingEnabled && (successMatched || acceptedAsyncTask)) {
    if (remoteTaskId) {
      updateJobPayload(job.id, { remoteTaskId: String(remoteTaskId) });
      await pollRemoteTask(job, order, cdkey, site, String(remoteTaskId), endpoint);
      return;
    }
  }

  if (isPollingEnabled && Number(responseInfo.status) === 409) {
    if (remoteTaskId) {
      updateJobPayload(job.id, { remoteTaskId: String(remoteTaskId) });
      await pollRemoteTask(job, order, cdkey, site, String(remoteTaskId), endpoint);
      return;
    }
  }

  if (!failureMatched && successMatched) {
    markSuccess(job.id, order.id, cdkey.id, responseInfo);
    return;
  }

  let errorMessage = formatRemoteErrorMessage(responseInfo, responseInfo.text || `HTTP ${responseInfo.status}`);
  if (errorMessage.includes("<!doctype") || errorMessage.includes("<!DOCTYPE") || errorMessage.includes("<html") || errorMessage.includes("<HTML")) {
    errorMessage = `远端服务器返回 HTML 错误页 (HTTP ${responseInfo.status})`;
  }
  const maxAttempts = site?.max_retries || endpoint?.max_retries || job.max_attempts || 3;

  if (shouldTreatAlreadyUsedAsSuccess(site, responseInfo, errorMessage)) {
    markSuccess(job.id, order.id, cdkey.id, {
      ...responseInfo,
      treatedAsSuccess: true,
      successReason: "666 站点返回 CDK 已使用，按成功处理"
    });
    return;
  }

  if (isNonRetryableFailure(responseInfo, errorMessage)) {
    markFailed(job.id, order.id, cdkey.id, errorMessage, responseInfo);
    return;
  }

  if (job.attempt_count + 1 >= maxAttempts) {
    markFailed(job.id, order.id, cdkey.id, errorMessage, responseInfo);
    return;
  }

  markRetry(job, order.id, errorMessage, responseInfo, maxAttempts);
}

async function tick() {
  const job = claimJob();
  if (!job) return;

  try {
    await processJob(job);
  } catch (error) {
    markFailed(job.id, job.order_id, job.cdkey_id, error.message || "worker 执行失败", null);
  }
}

// ── Notification monitors ──

const NOTIFICATION_TICK_INTERVAL_MS = 1000;
const NOTIFICATION_LOCK_TIMEOUT_MS = 60 * 1000;

function getNotificationGlobalWebhook() {
  const row = db.prepare("SELECT global_feishu_webhook FROM notification_settings WHERE id = 'default'").get();
  return row?.global_feishu_webhook || "";
}

function claimNotificationMonitor() {
  const now = nowIso();
  const expiredLockTime = new Date(Date.now() - NOTIFICATION_LOCK_TIMEOUT_MS).toISOString();

  const candidate = db.prepare(`
    SELECT *
    FROM notification_monitors
    WHERE enabled = 1
      AND (next_run_at IS NULL OR next_run_at <= ?)
      AND (locked_at IS NULL OR locked_at < ?)
    ORDER BY (next_run_at IS NULL) DESC, next_run_at ASC
    LIMIT 1
  `).get(now, expiredLockTime);

  if (!candidate) return null;

  const result = db.prepare(`
    UPDATE notification_monitors
    SET locked_at = ?, locked_by = ?
    WHERE id = ? AND (locked_at IS NULL OR locked_at < ?)
  `).run(now, workerId, candidate.id, expiredLockTime);

  if (!result.changes) return null;
  return { ...candidate, locked_at: now, locked_by: workerId };
}

function recordMonitorEvent({ monitorId, monitorName, eventType, matched, summary, detail }) {
  db.prepare(`
    INSERT INTO notification_events (id, monitor_id, monitor_name, event_type, matched, summary, detail, created_at)
    VALUES (lower(hex(randomblob(8))), ?, ?, ?, ?, ?, ?, ?)
  `).run(
    monitorId || null,
    monitorName || null,
    eventType,
    matched ? 1 : 0,
    summary || null,
    detail ? JSON.stringify(detail) : null,
    nowIso()
  );
}

function updateMonitorAfterRun(monitor, patch) {
  const intervalSeconds = clampIntervalSeconds(monitor.interval_seconds || 60);
  const next = addSeconds(nowIso(), intervalSeconds);
  db.prepare(`
    UPDATE notification_monitors
    SET last_run_at = ?, last_match_at = COALESCE(?, last_match_at), last_notified_at = COALESCE(?, last_notified_at),
        last_status = ?, last_error = ?, last_response_summary = ?,
        next_run_at = ?, locked_at = NULL, locked_by = NULL, updated_at = ?
    WHERE id = ?
  `).run(
    patch.lastRunAt || nowIso(),
    patch.lastMatchAt || null,
    patch.lastNotifiedAt || null,
    patch.lastStatus || null,
    patch.lastError || null,
    patch.lastResponseSummary ? JSON.stringify(patch.lastResponseSummary) : null,
    next,
    nowIso(),
    monitor.id
  );
}

async function processMonitor(monitor) {
  const startedAt = nowIso();
  const watchFields = normalizeWatchFields(monitor.watch_fields);
  const responseInfo = await fetchMonitorEndpoint(monitor);
  const responseSummary = summarizeResponseInfo(responseInfo);

  if (!responseInfo.ok && responseInfo.status === 0) {
    const errorMessage = responseInfo.text || "请求失败";
    recordMonitorEvent({
      monitorId: monitor.id,
      monitorName: monitor.name,
      eventType: notificationEventTypes.fetchError,
      matched: false,
      summary: `请求失败：${errorMessage.slice(0, 200)}`,
      detail: { response: responseSummary }
    });
    updateMonitorAfterRun(monitor, {
      lastRunAt: startedAt,
      lastStatus: "error",
      lastError: errorMessage,
      lastResponseSummary: responseSummary
    });
    return;
  }

  const ruleResult = evaluateMonitorRules(safeParseJson(monitor.rules_json, null), responseInfo.json);

  if (!ruleResult.matched) {
    recordMonitorEvent({
      monitorId: monitor.id,
      monitorName: monitor.name,
      eventType: notificationEventTypes.notMatched,
      matched: false,
      summary: `未命中 (HTTP ${responseInfo.status})`,
      detail: { response: responseSummary, rules: ruleResult, watchFields }
    });
    updateMonitorAfterRun(monitor, {
      lastRunAt: startedAt,
      lastStatus: responseInfo.ok ? "no_match" : "http_error",
      lastError: responseInfo.ok ? null : `HTTP ${responseInfo.status}`,
      lastResponseSummary: responseSummary
    });
    return;
  }

  // Matched — apply cooldown if configured.
  const cooldownSeconds = Number(monitor.cooldown_seconds || 0);
  if (cooldownSeconds > 0 && monitor.last_notified_at) {
    const lastNotifiedMs = Date.parse(monitor.last_notified_at);
    if (Number.isFinite(lastNotifiedMs) && (Date.now() - lastNotifiedMs) < cooldownSeconds * 1000) {
      recordMonitorEvent({
        monitorId: monitor.id,
        monitorName: monitor.name,
        eventType: notificationEventTypes.matched,
        matched: true,
        summary: `命中但处于冷却期，未发送（剩余 ${Math.ceil((cooldownSeconds * 1000 - (Date.now() - lastNotifiedMs)) / 1000)}s）`,
        detail: { response: responseSummary, rules: ruleResult, watchFields, suppressed: true }
      });
      updateMonitorAfterRun(monitor, {
        lastRunAt: startedAt,
        lastMatchAt: startedAt,
        lastStatus: "matched_cooldown",
        lastResponseSummary: responseSummary
      });
      return;
    }
  }

  recordMonitorEvent({
    monitorId: monitor.id,
    monitorName: monitor.name,
    eventType: notificationEventTypes.matched,
    matched: true,
    summary: `命中规则 (HTTP ${responseInfo.status})`,
    detail: { response: responseSummary, rules: ruleResult, watchFields }
  });

  const webhookUrl = monitor.feishu_webhook_override || getNotificationGlobalWebhook();
  if (!webhookUrl) {
    recordMonitorEvent({
      monitorId: monitor.id,
      monitorName: monitor.name,
      eventType: notificationEventTypes.sendError,
      matched: true,
      summary: "命中但未配置飞书 Webhook，未发送",
      detail: { rules: ruleResult }
    });
    updateMonitorAfterRun(monitor, {
      lastRunAt: startedAt,
      lastMatchAt: startedAt,
      lastStatus: "matched_no_webhook",
      lastError: "未配置飞书 Webhook",
      lastResponseSummary: responseSummary
    });
    return;
  }

  const message = buildFeishuMarkdown({
    monitorName: monitor.name,
    monitorUrl: monitor.request_url,
    matchMode: ruleResult.matchMode,
    matchedItems: ruleResult.matchedItems,
    watchFields,
    responseJson: responseInfo.json,
    timestamp: startedAt,
    customTitle: monitor.notify_title || `KaWang 监听触发：${monitor.name}`
  });

  const sendResult = await sendFeishuMarkdown(webhookUrl, message);

  if (sendResult.ok) {
    recordMonitorEvent({
      monitorId: monitor.id,
      monitorName: monitor.name,
      eventType: notificationEventTypes.sendOk,
      matched: true,
      summary: "飞书通知发送成功",
      detail: { message, result: sendResult }
    });
    updateMonitorAfterRun(monitor, {
      lastRunAt: startedAt,
      lastMatchAt: startedAt,
      lastNotifiedAt: startedAt,
      lastStatus: "notified",
      lastError: null,
      lastResponseSummary: responseSummary
    });
    return;
  }

  const sendError = `飞书发送失败：${(sendResult.text || sendResult.status || "未知错误").toString().slice(0, 200)}`;
  recordMonitorEvent({
    monitorId: monitor.id,
    monitorName: monitor.name,
    eventType: notificationEventTypes.sendError,
    matched: true,
    summary: sendError,
    detail: { message, result: sendResult }
  });
  updateMonitorAfterRun(monitor, {
    lastRunAt: startedAt,
    lastMatchAt: startedAt,
    lastStatus: "send_error",
    lastError: sendError,
    lastResponseSummary: responseSummary
  });
}

async function notificationTick() {
  // Drain due monitors quickly so that 1-second polling is responsive.
  for (let i = 0; i < 50; i++) {
    const monitor = claimNotificationMonitor();
    if (!monitor) return;

    try {
      await processMonitor(monitor);
    } catch (error) {
      const message = error?.message || "监听任务执行异常";
      recordMonitorEvent({
        monitorId: monitor.id,
        monitorName: monitor.name,
        eventType: notificationEventTypes.fetchError,
        matched: false,
        summary: `执行异常：${message.slice(0, 200)}`,
        detail: { error: message }
      });
      updateMonitorAfterRun(monitor, {
        lastRunAt: nowIso(),
        lastStatus: "error",
        lastError: message
      });
    }
  }
}

// ── Quota sub-card auto-unlock ──

const QUOTA_UNLOCK_INTERVAL_MS = 60 * 1000; // 每分钟检查一次

function quotaUnlockTick() {
  const now = nowIso();
  const expiredCards = db.prepare(`
    SELECT id FROM quota_sub_cards
    WHERE status = 'locked' AND locked_until < ?
  `).all(now);

  if (expiredCards.length === 0) return;

  const updateStmt = db.prepare(`
    UPDATE quota_sub_cards
    SET status = 'active', locked_at = NULL, locked_until = NULL, lock_reason = NULL, updated_at = ?
    WHERE id = ?
  `);

  for (const card of expiredCards) {
    updateStmt.run(now, card.id);
  }

  console.log(`[KaWang worker] quota-unlock: unlocked ${expiredCards.length} expired sub-card(s)`);
}

// ── Quota low stock notification ──

const QUOTA_LOW_STOCK_INTERVAL_MS = 5 * 60 * 1000; // 每 5 分钟检查一次
const QUOTA_LOW_STOCK_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 小时内不重复发送

async function quotaLowStockTick() {
  const settings = db.prepare(
    "SELECT low_stock_threshold, last_low_stock_notify_at FROM quota_settings WHERE id = 'default'"
  ).get();

  if (!settings) return;

  const threshold = settings.low_stock_threshold ?? 5;
  const availableQuota = getAvailableQuota(db);

  if (availableQuota >= threshold) return;

  // Check 24-hour cooldown
  if (settings.last_low_stock_notify_at) {
    const lastNotifyMs = Date.parse(settings.last_low_stock_notify_at);
    if (Number.isFinite(lastNotifyMs) && (Date.now() - lastNotifyMs) < QUOTA_LOW_STOCK_COOLDOWN_MS) {
      return;
    }
  }

  // Get feishu webhook URL (use global notification webhook)
  const webhookUrl = getNotificationGlobalWebhook();
  if (!webhookUrl) {
    console.log("[KaWang worker] quota-low-stock: 低库存告警触发但未配置飞书 Webhook");
    return;
  }

  // Send notification
  const now = nowIso();
  const message = {
    title: "KaWang 低库存警告",
    content: [
      `**触发时间**：${now}`,
      `**当前可分配额度**：${availableQuota}`,
      `**低库存阈值**：${threshold}`,
      "",
      "可分配额度已低于设定阈值，请及时补充卡密。"
    ].join("\n")
  };

  const result = await sendFeishuMarkdown(webhookUrl, message);

  if (result.ok) {
    // Update last_low_stock_notify_at
    db.prepare(
      "UPDATE quota_settings SET last_low_stock_notify_at = ?, updated_at = ? WHERE id = 'default'"
    ).run(now, now);
    console.log(`[KaWang worker] quota-low-stock: 低库存通知已发送 (available=${availableQuota}, threshold=${threshold})`);
  } else {
    console.error(`[KaWang worker] quota-low-stock: 飞书通知发送失败 - ${result.text || result.status}`);
  }
}

// ── SMS Poll Task Manager ──

const activePollTasks = new Map(); // publicKey → PollTask
const MAX_ACTIVE_POLLS = 100;
const POLL_INTERVAL_MS = 5000;
const POLL_TIMEOUT_MS = 300000; // 5 分钟
const POLL_HTTP_TIMEOUT_MS = 10000; // 10 秒

/**
 * Submit a successfully fetched verification code to the API Server's internal endpoint.
 */
async function submitVerification(publicKey, code, smsEntryId) {
  const url = `${env.apiUrl}/api/internal/sms/verification`;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Secret": env.internalSecret
      },
      body: JSON.stringify({ publicKey, verificationCode: code, smsEntryId }),
      signal: AbortSignal.timeout(POLL_HTTP_TIMEOUT_MS)
    });
    if (!response.ok) {
      console.error(`[SMS Poll] submitVerification failed for ${publicKey}: HTTP ${response.status}`);
    }
  } catch (error) {
    console.error(`[SMS Poll] submitVerification error for ${publicKey}:`, error.message);
  }
}

/**
 * Report a poll timeout to the API Server's internal endpoint.
 */
async function reportTimeout(publicKey) {
  const url = `${env.apiUrl}/api/internal/sms/timeout`;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Secret": env.internalSecret
      },
      body: JSON.stringify({ publicKey }),
      signal: AbortSignal.timeout(POLL_HTTP_TIMEOUT_MS)
    });
    if (!response.ok) {
      console.error(`[SMS Poll] reportTimeout failed for ${publicKey}: HTTP ${response.status}`);
    }
  } catch (error) {
    console.error(`[SMS Poll] reportTimeout error for ${publicKey}:`, error.message);
  }
}

class PollTask {
  constructor(publicKey, smsUrl, smsEntryId) {
    this.publicKey = publicKey;
    this.smsUrl = smsUrl;
    this.smsEntryId = smsEntryId;
    this.startedAt = Date.now();
    this.intervalId = null;
    this.attemptCount = 0;
  }

  start() {
    this.poll(); // 立即执行第一次
    this.intervalId = setInterval(() => this.poll(), POLL_INTERVAL_MS);
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    activePollTasks.delete(this.publicKey);
  }

  async poll() {
    this.attemptCount++;

    // 超时检查
    if (Date.now() - this.startedAt >= POLL_TIMEOUT_MS) {
      await reportTimeout(this.publicKey);
      this.stop();
      return;
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), POLL_HTTP_TIMEOUT_MS);

      const response = await fetch(this.smsUrl, {
        signal: controller.signal,
        headers: { "User-Agent": BROWSER_UA }
      });
      clearTimeout(timeout);

      if (response.ok) {
        const text = (await response.text()).trim();
        if (text) {
          await submitVerification(this.publicKey, text, this.smsEntryId);
          this.stop();
          return;
        }
      }
    } catch (error) {
      console.error(`[SMS Poll] ${this.publicKey} attempt ${this.attemptCount} failed:`, error.message);
    }
  }
}

/**
 * Start a new poll task for the given publicKey.
 * Deduplication: ignores if a task for the same publicKey is already active.
 * Capacity check: rejects if active tasks have reached MAX_ACTIVE_POLLS.
 */
function startPollTask(publicKey, smsUrl, smsEntryId) {
  // 去重：同一 publicKey 已有活跃任务时忽略
  if (activePollTasks.has(publicKey)) {
    return { accepted: false, reason: "already_polling" };
  }
  // 容量检查
  if (activePollTasks.size >= MAX_ACTIVE_POLLS) {
    return { accepted: false, reason: "capacity_full" };
  }
  const task = new PollTask(publicKey, smsUrl, smsEntryId);
  activePollTasks.set(publicKey, task);
  task.start();
  return { accepted: true };
}

// Export for testing
export { PollTask, activePollTasks, MAX_ACTIVE_POLLS, POLL_INTERVAL_MS, POLL_TIMEOUT_MS, POLL_HTTP_TIMEOUT_MS, submitVerification, reportTimeout, startPollTask, processFiveSimJob };

// ── Worker Internal HTTP Service ──

/**
 * Lightweight HTTP server that listens for poll trigger requests from the API Server.
 * Exposes POST /api/internal/sms/poll to receive {publicKey, smsUrl, smsEntryId}.
 * Uses X-Internal-Secret header for authentication.
 */
function createWorkerHttpServer() {
  const server = http.createServer((req, res) => {
    // Only accept POST /api/internal/sms/poll
    if (req.method !== "POST" || req.url !== "/api/internal/sms/poll") {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ message: "not found" }));
      return;
    }

    // Auth check
    const secret = req.headers["x-internal-secret"];
    if (secret !== env.internalSecret) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ message: "unauthorized" }));
      return;
    }

    // Parse request body
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      let parsed;
      try {
        parsed = JSON.parse(body);
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ message: "invalid JSON" }));
        return;
      }

      const { publicKey, smsUrl, smsEntryId } = parsed;
      if (!publicKey || !smsUrl || !smsEntryId) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ message: "参数不正确" }));
        return;
      }

      const result = startPollTask(publicKey, smsUrl, smsEntryId);

      if (result.accepted) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ accepted: true }));
      } else if (result.reason === "already_polling") {
        res.writeHead(409, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ accepted: false, reason: "already_polling" }));
      } else if (result.reason === "capacity_full") {
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ accepted: false, reason: "capacity_full" }));
      } else {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ accepted: false, reason: "unknown" }));
      }
    });
  });

  return server;
}

// Start the internal HTTP server
const workerHttpServer = createWorkerHttpServer();
workerHttpServer.listen(env.workerInternalPort, "127.0.0.1", () => {
  console.log(`[KaWang worker] internal HTTP server listening on 127.0.0.1:${env.workerInternalPort}`);
});

export { createWorkerHttpServer, workerHttpServer };

console.log(`[KaWang worker] started with poll interval ${env.workerPollMs}ms`);

setInterval(() => {
  tick().catch((error) => {
    console.error("[KaWang worker]", error);
  });
}, env.workerPollMs);

setInterval(() => {
  notificationTick().catch((error) => {
    console.error("[KaWang worker] notification", error);
  });
}, NOTIFICATION_TICK_INTERVAL_MS);

setInterval(() => {
  try {
    quotaUnlockTick();
  } catch (error) {
    console.error("[KaWang worker] quota-unlock", error);
  }
}, QUOTA_UNLOCK_INTERVAL_MS);

setInterval(() => {
  quotaLowStockTick().catch((error) => {
    console.error("[KaWang worker] quota-low-stock", error);
  });
}, QUOTA_LOW_STOCK_INTERVAL_MS);

tick().catch((error) => {
  console.error("[KaWang worker]", error);
});

notificationTick().catch((error) => {
  console.error("[KaWang worker] notification", error);
});

try {
  quotaUnlockTick();
} catch (error) {
  console.error("[KaWang worker] quota-unlock", error);
}

quotaLowStockTick().catch((error) => {
  console.error("[KaWang worker] quota-low-stock", error);
});
