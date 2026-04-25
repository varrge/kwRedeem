import { createHash, randomBytes } from "node:crypto";
import { getDb } from "../../shared/src/database.js";
import { env } from "../../shared/src/env.js";
import { decryptText } from "../../shared/src/secure.js";
import { evaluateRule, renderJsonTemplate, renderTemplateString, safeParseJson } from "../../shared/src/templates.js";
import { cdkeyStatuses, endpointTypes, jobStatuses, logActions, orderStatuses } from "../../shared/src/constants.js";

const db = getDb();
const workerId = `worker-${process.pid}`;

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
    response = await fetch(remoteConfig.url, {
      method: remoteConfig.method || "POST",
      headers: {
        "Content-Type": "application/json",
        ...headers
      },
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

function markFailed(jobId, orderId, errorMessage, responseInfo) {
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

async function queryRemoteTask(queryUrl, site) {
  try {
    const response = await fetch(queryUrl, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
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

const POLL_MAX_ROUNDS = 6;
const POLL_INTERVAL_MS = 5000;

async function pollRemoteTask(job, order, cdkey, site, remoteTaskId) {
  const maxAttempts = site?.max_retries || job.max_attempts || 10;
  const querySuccessRule = site.query_success_rule;

  for (let round = 0; round < POLL_MAX_ROUNDS; round++) {
    if (round > 0) await sleep(POLL_INTERVAL_MS);

    const queryUrl = renderTemplateString(site.query_api_url, { taskId: remoteTaskId });
    const queryResult = await queryRemoteTask(queryUrl, site);

    const isSuccess = querySuccessRule
      ? evaluateRule(querySuccessRule, queryResult)
      : false;

    if (isSuccess) {
      markSuccess(job.id, order.id, cdkey.id, queryResult);
      return;
    }

    const taskStatus = queryResult.json?.data?.taskStatus;
    if (taskStatus && taskStatus !== "PROCESSING" && taskStatus !== "PENDING") {
      const msg = queryResult.json?.data?.statusMessage || `远端任务失败: ${taskStatus}`;
      markFailed(job.id, order.id, msg, queryResult);
      return;
    }
  }

  updateJobPayload(job.id, { remoteTaskId });
  const msg = `远端任务仍在处理中，等待下轮继续轮询 (taskId: ${remoteTaskId})`;

  if (job.attempt_count + 1 >= maxAttempts) {
    markFailed(job.id, order.id, `轮询超过最大重试次数: ${msg}`, null);
    return;
  }

  markRetry(job, order.id, msg, null, maxAttempts);
}

async function processJob(job) {
  const order = db.prepare("SELECT * FROM redeem_orders WHERE id = ?").get(job.order_id);
  const cdkey = db.prepare("SELECT * FROM cdkeys WHERE id = ?").get(job.cdkey_id);
  const site = db.prepare("SELECT * FROM sites WHERE id = ?").get(job.site_id || order?.site_id || cdkey?.site_id);
  const endpoint = db.prepare("SELECT * FROM activation_endpoints WHERE id = ?").get(job.activation_endpoint_id);

  if (!order || !cdkey || (!site && !endpoint)) {
    markFailed(job.id, job.order_id, "任务依赖数据不存在", null);
    return;
  }

  const jobPayload = safeParseJson(job.payload, {});
  const isPollingEnabled = site?.polling_enabled && site?.query_api_url;

  if (isPollingEnabled && jobPayload.remoteTaskId) {
    await pollRemoteTask(job, order, cdkey, site, jobPayload.remoteTaskId);
    return;
  }

  const responseInfo = await invokeEndpoint(job, order, cdkey, site, endpoint);
  const failureRule = site?.submit_failure_rule || endpoint?.failure_rule;
  const successRule = site?.submit_success_rule || endpoint?.success_rule;
  const failureMatched = failureRule ? evaluateRule(failureRule, responseInfo) : false;
  const successMatched = successRule ? evaluateRule(successRule, responseInfo) : responseInfo.ok;

  if (!failureMatched && successMatched && isPollingEnabled) {
    const remoteTaskId = responseInfo.json?.data;
    if (remoteTaskId) {
      updateJobPayload(job.id, { remoteTaskId: String(remoteTaskId) });
      await pollRemoteTask(job, order, cdkey, site, String(remoteTaskId));
      return;
    }
  }

  if (!failureMatched && successMatched) {
    markSuccess(job.id, order.id, cdkey.id, responseInfo);
    return;
  }

  const errorMessage = responseInfo.text || `HTTP ${responseInfo.status}`;
  const maxAttempts = site?.max_retries || endpoint?.max_retries || job.max_attempts || 3;

  if (job.attempt_count + 1 >= maxAttempts) {
    markFailed(job.id, order.id, errorMessage, responseInfo);
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
    markFailed(job.id, job.order_id, error.message || "worker 执行失败", null);
  }
}

console.log(`[KaWang worker] started with poll interval ${env.workerPollMs}ms`);

setInterval(() => {
  tick().catch((error) => {
    console.error("[KaWang worker]", error);
  });
}, env.workerPollMs);

tick().catch((error) => {
  console.error("[KaWang worker]", error);
});
