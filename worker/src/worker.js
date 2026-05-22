import { createHash, randomBytes } from "node:crypto";
import { getDb } from "../../shared/src/database.js";
import { env } from "../../shared/src/env.js";
import { decryptText } from "../../shared/src/secure.js";
import { evaluateRule, renderJsonTemplate, renderTemplateString, safeParseJson } from "../../shared/src/templates.js";
import { cdkeyStatuses, endpointTypes, jobStatuses, logActions, notificationEventTypes, orderStatuses } from "../../shared/src/constants.js";
import {
  buildFeishuMarkdown,
  clampIntervalSeconds,
  evaluateMonitorRules,
  fetchMonitorEndpoint,
  normalizeWatchFields,
  sendFeishuMarkdown,
  summarizeResponseInfo
} from "../../shared/src/notifications.js";

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
  const bodyString = remoteConfig.method === "GET" ? "" : JSON.stringify(body);
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
    if (site?.request_cookies) {
      fetchHeaders.Cookie = site.request_cookies;
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

tick().catch((error) => {
  console.error("[KaWang worker]", error);
});

notificationTick().catch((error) => {
  console.error("[KaWang worker] notification", error);
});
