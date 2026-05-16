import { createHash, randomBytes } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import cors from "@fastify/cors";
import jwt from "jsonwebtoken";
import { nanoid } from "nanoid";
import { z } from "zod";
import { getDb, withTransaction } from "../../shared/src/database.js";
import { env } from "../../shared/src/env.js";
import { cdkeyStatuses, endpointTypes, jobStatuses, logActions, notificationEventTypes, notificationMatchModes, notificationMonitorTypes, notificationRuleOperators, orderStatuses } from "../../shared/src/constants.js";
import { decryptText, encryptText } from "../../shared/src/secure.js";
import { evaluateRule, renderJsonTemplate, renderTemplateString, safeParseJson } from "../../shared/src/templates.js";
import {
  NOTIFICATION_MAX_INTERVAL,
  NOTIFICATION_MIN_INTERVAL,
  buildFeishuMarkdown,
  clampBrowserWaitMs,
  clampIntervalSeconds,
  evaluateMonitorRules,
  fetchMonitorEndpoint,
  normalizeMonitorRules,
  normalizeWatchFields,
  sendFeishuMarkdown,
  summarizeResponseInfo
} from "../../shared/src/notifications.js";

const app = Fastify({ logger: false });
const db = getDb();
const execFileAsync = promisify(execFile);
const BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36";
const __filename = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(__filename), "../..");
const logsDir = path.join(projectRoot, "logs");
const updateLogPath = path.join(logsDir, "update.log");
const updateStatePath = path.join(logsDir, "update-state.json");

const updateState = {
  status: "idle",
  startedAt: null,
  endedAt: null,
  localCommit: null,
  remoteCommit: null,
  branch: null,
  hasUpdate: false,
  error: null
};

await app.register(cors, {
  origin: true,
  credentials: true,
  methods: ["GET", "HEAD", "PUT", "POST", "DELETE", "PATCH", "OPTIONS"]
});

function nowIso() {
  return new Date().toISOString();
}

function ensureLogsDir() {
  fs.mkdirSync(logsDir, { recursive: true });
}

function writeUpdateState(patch = {}) {
  Object.assign(updateState, patch);
  ensureLogsDir();
  fs.writeFileSync(updateStatePath, JSON.stringify(updateState, null, 2));
}

function appendUpdateLog(message) {
  ensureLogsDir();
  fs.appendFileSync(updateLogPath, `[${nowIso()}] ${message}\n`);
}

function readUpdateLog(limit = 12000) {
  try {
    const content = fs.readFileSync(updateLogPath, "utf8");
    return content.length > limit ? content.slice(content.length - limit) : content;
  } catch {
    return "";
  }
}

async function runGit(args) {
  const { stdout } = await execFileAsync("git", args, {
    cwd: projectRoot,
    timeout: 30000
  });
  return stdout.trim();
}

async function getGitVersionInfo(fetchRemote = false) {
  const isGitRepo = await runGit(["rev-parse", "--is-inside-work-tree"]).catch(() => "false");
  if (isGitRepo !== "true") {
    return {
      isGitRepo: false,
      branch: null,
      localCommit: null,
      remoteCommit: null,
      hasUpdate: false
    };
  }

  const branch = await runGit(["rev-parse", "--abbrev-ref", "HEAD"]);
  const localCommit = await runGit(["rev-parse", "HEAD"]);
  const upstream = await runGit(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]).catch(() => "");
  const localChangesText = await runGit(["status", "--porcelain"]).catch(() => "");
  const localChanges = localChangesText.split("\n").filter(Boolean);

  if (fetchRemote) {
    try {
      await runGit(["fetch", "--prune"]);
    } catch (error) {
      error.versionPartial = {
        isGitRepo: true,
        branch,
        upstream,
        localCommit,
        remoteCommit: null,
        hasUpdate: false,
        hasLocalChanges: localChanges.length > 0,
        localChanges
      };
      throw error;
    }
  }

  const remoteCommit = upstream ? await runGit(["rev-parse", upstream]) : null;

  return {
    isGitRepo: true,
    branch,
    upstream,
    localCommit,
    remoteCommit,
    hasUpdate: Boolean(remoteCommit && remoteCommit !== localCommit),
    hasLocalChanges: localChanges.length > 0,
    localChanges
  };
}

function startUpdateTask(actor) {
  writeUpdateState({
    status: "running",
    startedAt: nowIso(),
    endedAt: null,
    error: null
  });

  appendUpdateLog(`管理员 ${actor} 触发在线更新`);

  const child = spawn("bash", ["scripts/update.sh"], {
    cwd: projectRoot,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"]
  });

  child.stdout.on("data", (chunk) => {
    appendUpdateLog(chunk.toString().trimEnd());
  });

  child.stderr.on("data", (chunk) => {
    appendUpdateLog(chunk.toString().trimEnd());
  });

  child.on("error", (error) => {
    appendUpdateLog(`更新任务启动失败：${error.message}`);
    writeUpdateState({
      status: "failed",
      endedAt: nowIso(),
      error: error.message
    });
  });

  child.on("close", async (code) => {
    const nextStatus = code === 0 ? "succeeded" : "failed";
    appendUpdateLog(`更新任务结束，退出码：${code}`);

    let versionInfo = {};
    try {
      versionInfo = await getGitVersionInfo(false);
    } catch {
      versionInfo = {};
    }

    writeUpdateState({
      status: nextStatus,
      endedAt: nowIso(),
      localCommit: versionInfo.localCommit ?? updateState.localCommit,
      remoteCommit: versionInfo.remoteCommit ?? updateState.remoteCommit,
      branch: versionInfo.branch ?? updateState.branch,
      hasUpdate: versionInfo.hasUpdate ?? updateState.hasUpdate,
      error: code === 0 ? null : `更新脚本退出码：${code}`
    });
  });
}

function signAdminToken(payload) {
  return jwt.sign(payload, env.jwtSecret, { expiresIn: "12h" });
}

async function requireAdmin(request, reply) {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return reply.code(401).send({ message: "未登录或 token 缺失" });
  }

  const token = header.slice("Bearer ".length).trim();
  if (!token) {
    return reply.code(401).send({ message: "登录态已失效" });
  }

  try {
    request.admin = jwt.verify(token, env.jwtSecret);
    return;
  } catch {
    return reply.code(401).send({ message: "登录态已失效" });
  }
}

function createAuditLog({ action, actor = "system", resourceType, resourceId = null, detail = null }) {
  db.prepare(`
    INSERT INTO admin_audit_logs (id, action, actor, resource_type, resource_id, detail, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(nanoid(16), action, actor, resourceType, resourceId, detail ? JSON.stringify(detail) : null, nowIso());
}

function parseSessionPayload(rawValue) {
  let parsed;
  try {
    parsed = JSON.parse(rawValue);
  } catch {
    throw new Error("session 必须是合法 JSON");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("session JSON 必须是对象");
  }

  const preview = {
    keys: Object.keys(parsed),
    email: parsed.user?.email ?? parsed.email ?? null,
    name: parsed.user?.name ?? parsed.name ?? null
  };

  return { parsed, preview };
}

// 站点级 session 校验：根据 site.slug 在订单创建前校验 session 关键字段，
// 避免明显无效的 session 浪费一次卡密锁定 + 任务重试周期。
function validateSessionForSite(site, session) {
  const slug = String(site?.slug || "").toLowerCase();
  const accessToken = typeof session?.accessToken === "string" ? session.accessToken.trim() : "";
  const email = typeof session?.user?.email === "string" ? session.user.email.trim() : "";

  if (slug === "666") {
    if (!accessToken) {
      throw new Error("666 站 session 缺少 accessToken 字段，请重新获取完整 Session JSON");
    }
    if (!email) {
      throw new Error("666 站 session 缺少 user.email 字段，请重新获取完整 Session JSON");
    }
  }
}

const DENGTA_PLUS_SLUG = "dengta-plus";
const DENGTA_PLUS_QUEUE_STATUS_URL = "https://ai.dengta-learning.online/api/cdk/queue-status";

async function fetchQueueStatusForSite(site) {
  const slug = String(site?.slug || "").trim().toLowerCase();
  if (slug !== DENGTA_PLUS_SLUG) {
    return null;
  }

  try {
    const response = await fetch(DENGTA_PLUS_QUEUE_STATUS_URL, {
      method: "GET",
      headers: {
        "User-Agent": BROWSER_UA,
        Accept: "application/json, text/plain, */*"
      },
      signal: AbortSignal.timeout(10000)
    });
    const text = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      text,
      json: safeParseJson(text, null)
    };
  } catch (error) {
    return {
      ok: false,
      status: 599,
      text: error.message,
      json: null
    };
  }
}

function getQueueStatusBlockMessage(queueStatus) {
  if (!queueStatus?.ok || !queueStatus.json) {
    return "老蹬plus 队列状态获取失败，请稍后重试";
  }

  const queue = queueStatus.json;
  if (queue.maintenance) {
    return "老蹬plus 当前维护中，暂时无法提交兑换";
  }
  if (queue.full || Number(queue.available ?? 0) <= 0) {
    return `老蹬plus 当前队列已满（可用 ${Number(queue.available ?? 0)}/${Number(queue.max ?? 0)}），请稍后再试`;
  }
  if (Number(queue.gopay_deny_cooldown_remaining ?? 0) > 0) {
    return `老蹬plus 当前受限，请 ${queue.gopay_deny_cooldown_remaining} 秒后再试`;
  }
  return "";
}

async function assertSiteQueueReady(site) {
  const queueStatus = await fetchQueueStatusForSite(site);
  if (!queueStatus) {
    return;
  }

  const blockMessage = getQueueStatusBlockMessage(queueStatus);
  if (!blockMessage) {
    return;
  }

  const extra = queueStatus.json?.gopay_deny_count
    ? `（最近拒绝次数 ${queueStatus.json.gopay_deny_count}）`
    : "";
  throw new Error(`${blockMessage}${extra}`);
}

function getJsonBodyOrNull(value) {
  if (!value) return null;

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function getBodyObject(value) {
  if (typeof value === "string") {
    return safeParseJson(value, value);
  }
  return value;
}

function getUrlOrigin(url) {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}

function applyAuthHeaders(headers, config, bodyString) {
  if (config.authType === "bearer" && config.authConfig) {
    headers.Authorization = `Bearer ${config.authConfig}`;
    return;
  }

  if (config.authType === "header_json" && config.authConfig) {
    Object.assign(headers, safeParseJson(config.authConfig, {}));
    return;
  }

  if (config.authType === "oaifire_sign") {
    const timestamp = Date.now().toString();
    const nonce = randomBytes(16).toString("hex");
    const salt = config.authConfig || "ChatGPT#Plus@2026!";
    const bodyHash = bodyString ? createHash("md5").update(bodyString).digest("hex") : "";
    const sign = createHash("sha256").update(`${salt}${timestamp}${nonce}${bodyHash}`).digest("hex");
    const origin = getUrlOrigin(config.url);

    headers["X-Timestamp"] = timestamp;
    headers["X-Nonce"] = nonce;
    headers["X-Sign"] = sign;

    if (origin) {
      headers.Origin = headers.Origin || origin;
      headers.Referer = headers.Referer || `${origin}/`;
    }
  }
}

function generatePublicKey(prefix) {
  const normalized = String(prefix || "").trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "");
  const actualPrefix = normalized ? `${normalized}-` : "";
  return `${actualPrefix}${nanoid(10).toUpperCase()}`;
}

function getUniquePublicKey(prefix) {
  let candidate = generatePublicKey(prefix);
  while (db.prepare("SELECT 1 FROM cdkeys WHERE public_key = ?").get(candidate)) {
    candidate = generatePublicKey(prefix);
  }
  return candidate;
}

function extractLiveTaskInfo(lastResponse, pollingEnabled) {
  if (!pollingEnabled || !lastResponse) return {};
  const remoteJson = lastResponse.json;
  if (!remoteJson || typeof remoteJson.status !== "string") return {};

  const remoteStatus = remoteJson.status.toLowerCase();
  const stage = typeof remoteJson.stage === "string" ? remoteJson.stage.trim() : "";
  const progress = Number.isFinite(Number(remoteJson.progress)) ? Number(remoteJson.progress) : null;
  const errorMessage = remoteJson.error_msg || remoteJson.error || remoteJson.result || remoteJson.message || "";
  const buildProgressHint = () => {
    if (!stage && progress === null) return "";
    if (stage && progress !== null) return `${stage}（${progress}%）`;
    return stage || `${progress}%`;
  };
  if (remoteStatus === "pending") {
    const pos = remoteJson.queue_position ?? null;
    return {
      liveTaskStatus: "pending",
      queuePosition: pos,
      liveStage: stage || null,
      liveProgress: progress,
      liveErrorMessage: null,
      liveMessage: pos != null
        ? `排队中，前方还有 ${pos} 个任务`
        : (buildProgressHint() || "排队中，请稍候")
    };
  }
  if (remoteStatus === "processing") {
    return {
      liveTaskStatus: "processing",
      queuePosition: null,
      liveStage: stage || null,
      liveProgress: progress,
      liveErrorMessage: null,
      liveMessage: buildProgressHint() || "正在处理充值订单！"
    };
  }
  if (["completed", "success", "succeeded"].includes(remoteStatus)) {
    return {
      liveTaskStatus: "completed",
      queuePosition: null,
      liveStage: stage || null,
      liveProgress: progress,
      liveErrorMessage: null,
      liveMessage: stage || remoteJson.result || remoteJson.message || "充值成功！"
    };
  }
  if (["failed", "error"].includes(remoteStatus)) {
    return {
      liveTaskStatus: "failed",
      queuePosition: null,
      liveStage: stage || null,
      liveProgress: progress,
      liveErrorMessage: errorMessage || null,
      liveMessage: errorMessage || buildProgressHint() || "远端任务失败"
    };
  }
  return {};
}

function getOrderDetail(orderNo) {
  const order = db.prepare(`
    SELECT
      o.*,
      p.title AS product_title,
      s.name AS site_name,
      s.slug AS site_slug,
      s.polling_enabled AS site_polling_enabled,
      j.status AS job_status,
      j.last_error AS job_error,
      j.last_response AS job_response,
      j.attempt_count AS job_attempt_count
    FROM redeem_orders o
    LEFT JOIN products p ON p.id = o.product_id
    LEFT JOIN sites s ON s.id = o.site_id
    LEFT JOIN activation_jobs j ON j.id = o.latest_job_id
    WHERE o.order_no = ?
  `).get(orderNo);

  if (!order) return null;

  const lastResponse = getJsonBodyOrNull(order.job_response);
  const liveInfo = extractLiveTaskInfo(lastResponse, order.site_polling_enabled);

  return {
    orderNo: order.order_no,
    publicKey: order.public_key,
    productTitle: order.site_name || order.product_title,
    siteName: order.site_name || order.product_title,
    siteSlug: order.site_slug || null,
    status: order.status,
    errorMessage: order.error_message,
    abandonRemainingTime: Boolean(order.abandon_remaining_time),
    sessionPreview: getJsonBodyOrNull(order.session_preview),
    createdAt: order.created_at,
    updatedAt: order.updated_at,
    liveTaskStatus: liveInfo.liveTaskStatus || null,
    queuePosition: liveInfo.queuePosition ?? null,
    liveMessage: liveInfo.liveMessage || null,
    liveStage: liveInfo.liveStage || null,
    liveProgress: liveInfo.liveProgress ?? null,
    liveErrorMessage: liveInfo.liveErrorMessage || null,
    job: {
      status: order.job_status,
      lastError: order.job_error,
      lastResponse,
      attemptCount: order.job_attempt_count
    }
  };
}

function getCdkeyLookupDetail(publicKey) {
  const key = db.prepare(`
    SELECT
      c.public_key,
      c.status,
      c.prefix,
      c.locked_at,
      c.used_at,
      c.updated_at,
      s.name AS site_name,
      s.slug AS site_slug,
      p.title AS product_title,
      (
        SELECT ro.order_no
        FROM redeem_orders ro
        WHERE ro.public_key = c.public_key
        ORDER BY ro.created_at DESC
        LIMIT 1
      ) AS latest_order_no
    FROM cdkeys c
    LEFT JOIN sites s ON s.id = c.site_id
    LEFT JOIN products p ON p.id = c.product_id
    WHERE c.public_key = ?
  `).get(publicKey);

  if (!key) return null;

  return {
    publicKey: key.public_key,
    status: key.status,
    prefix: key.prefix,
    productTitle: key.site_name || key.product_title || "未命名网站",
    siteName: key.site_name || key.product_title || "未命名网站",
    siteSlug: key.site_slug || null,
    latestOrderNo: key.latest_order_no || null,
    lockedAt: key.locked_at,
    usedAt: key.used_at,
    updatedAt: key.updated_at
  };
}

function looksLikeOrderNo(value) {
  return /^KW\d{8,}$/i.test(String(value ?? "").trim());
}

function getLookupDetail(identifier) {
  const normalized = String(identifier ?? "").trim().toUpperCase();
  if (!normalized) return null;

  if (looksLikeOrderNo(normalized)) {
    const orderDetail = getOrderDetail(normalized);
    if (orderDetail) {
      return {
        ...orderDetail,
        lookupKind: "order",
        lookupType: "orderNo",
        queryValue: normalized
      };
    }
  }

  const keyDetail = getCdkeyLookupDetail(normalized);
  if (!keyDetail) return null;

  if (keyDetail.latestOrderNo) {
    const latestOrderDetail = getOrderDetail(keyDetail.latestOrderNo);
    if (latestOrderDetail) {
      return {
        ...latestOrderDetail,
        lookupKind: "order",
        lookupType: "publicKey",
        queryValue: normalized,
        cdkeyStatus: keyDetail.status
      };
    }
  }

  return {
    ...keyDetail,
    lookupKind: "cdkey",
    lookupType: "publicKey",
    queryValue: normalized,
    canRedeem: keyDetail.status === cdkeyStatuses.active
  };
}

function normalizeLookupIdentifiers(input) {
  const values = Array.isArray(input) ? input : [input];
  return Array.from(new Set(
    values
      .flatMap((item) => String(item ?? "").split(/[\s,]+/))
      .map((item) => item.trim())
      .filter(Boolean)
  ));
}

function ensureSiteLegacyResources(siteId, payload) {
  const now = nowIso();
  const existingProductByCode = db.prepare("SELECT id FROM products WHERE code = ?").get(payload.slug);
  const productId = existingProductByCode?.id || `site_product_${payload.slug}`;
  const endpointId = `site_submit_${payload.slug}`;

  const hasProduct = db.prepare("SELECT id FROM products WHERE id = ?").get(productId);
  if (hasProduct) {
    db.prepare(`
      UPDATE products
      SET code = ?, title = ?, description = ?, status = ?, default_activation_endpoint_id = ?, updated_at = ?
      WHERE id = ?
    `).run(
      payload.slug,
      payload.name,
      `网站 ${payload.name} 的展示占位商品`,
      payload.status,
      endpointId,
      now,
      productId
    );
  } else {
    db.prepare(`
      INSERT INTO products (id, code, title, description, status, default_activation_endpoint_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      productId,
      payload.slug,
      payload.name,
      `网站 ${payload.name} 的展示占位商品`,
      payload.status,
      endpointId,
      now,
      now
    );
  }

  const hasEndpoint = db.prepare("SELECT id FROM activation_endpoints WHERE id = ?").get(endpointId);
  const endpointValues = [
    `${payload.name} Submit API`,
    endpointTypes.api,
    payload.submitApiUrl || "",
    null,
    payload.submitHttpMethod,
    payload.submitHeadersTemplate || "{}",
    payload.submitBodyTemplate || '{"card":"{{sourceKey}}","session":{{sessionRaw}}}',
    payload.abandonSubmitBodyTemplate || payload.submitBodyTemplate || '{"card":"{{sourceKey}}","session":{{sessionRaw}}}',
    payload.authType || null,
    payload.authConfig || null,
    payload.submitSuccessRule || null,
    payload.submitFailureRule || null,
    0,
    payload.timeoutSeconds,
    payload.maxRetries,
    payload.status,
    now
  ];

  if (hasEndpoint) {
    db.prepare(`
      UPDATE activation_endpoints
      SET name = ?, endpoint_type = ?, submit_url = ?, query_url = ?, http_method = ?,
          headers_template = ?, body_template = ?, abandon_submit_body_template = ?, auth_type = ?, auth_config = ?,
          success_rule = ?, failure_rule = ?, polling_enabled = ?, timeout_seconds = ?,
          max_retries = ?, status = ?, updated_at = ?
      WHERE id = ?
    `).run(...endpointValues, endpointId);
  } else {
    db.prepare(`
      INSERT INTO activation_endpoints (
        id, name, endpoint_type, submit_url, query_url, http_method, headers_template, body_template,
        abandon_submit_body_template, auth_type, auth_config, success_rule, failure_rule, polling_enabled, timeout_seconds,
        max_retries, status, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(endpointId, ...endpointValues, now);
  }

  return {
    productId,
    endpointId
  };
}

function getSiteById(siteId) {
  return db.prepare(`
    SELECT *
    FROM sites
    WHERE id = ?
  `).get(siteId);
}

async function callConfiguredApi(config, context) {
  if (!config.url) {
    return {
      skipped: true,
      ok: true,
      status: 204,
      text: "",
      json: null
    };
  }

  const url = renderTemplateString(config.url, context) || config.url;
  const renderedHeaders = renderJsonTemplate(config.headersTemplate || "{}", context);
  const renderedBody = renderJsonTemplate(config.bodyTemplate || "{}", context);
  const headers = typeof renderedHeaders === "string"
    ? safeParseJson(renderedHeaders, {})
    : renderedHeaders;
  const body = typeof renderedBody === "string"
    ? safeParseJson(renderedBody, renderedBody)
    : renderedBody;
  const bodyString = config.method === "GET" ? "" : JSON.stringify(body);
  applyAuthHeaders(headers, { ...config, url }, bodyString);

  let response;
  let responseText = "";
  let responseJson = null;

  try {
    const origin = getUrlOrigin(url);
    const fetchHeaders = {
      "User-Agent": BROWSER_UA,
      "Accept": "application/json, text/plain, */*",
      "Referer": origin ? `${origin}/` : undefined,
      "Origin": origin || undefined,
      "Content-Type": "application/json",
      ...headers
    };
    if (config.cookies) {
      fetchHeaders.Cookie = config.cookies;
    }
    response = await fetch(url, {
      method: config.method || "POST",
      headers: fetchHeaders,
      body: config.method === "GET" ? undefined : bodyString,
      signal: AbortSignal.timeout((config.timeoutSeconds || env.requestTimeoutMs / 1000 || 15) * 1000)
    });
    responseText = await response.text();
    responseJson = safeParseJson(responseText, null);
  } catch (error) {
    return {
      skipped: false,
      ok: false,
      status: 599,
      text: error.message,
      json: null
    };
  }

  return {
    skipped: false,
    ok: response.ok,
    status: response.status,
    text: responseText,
    json: responseJson
  };
}

app.get("/healthz", async () => ({
  ok: true,
  now: nowIso()
}));

app.get("/api/credential-status", async () => {
  try {
    const upstream = await fetch("https://stock.makerich.club/api/credential-status", {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10000)
    });
    return await upstream.json();
  } catch (error) {
    return { ok: false, fetched_at: nowIso(), data: null, error: error.message };
  }
});

app.get("/api/stock-sparklines", async (request) => {
  const days = request.query.days || "1";
  try {
    const upstream = await fetch(
      `https://stock.makerich.club/api/stock-sparklines?days=${encodeURIComponent(days)}`,
      { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15000) }
    );
    return await upstream.json();
  } catch (error) {
    return { series: {}, error: error.message };
  }
});

app.get("/api/iostuqu-stock-info", async () => {
  try {
    const upstream = await fetch("https://api.987ai.vip/api/stock-info", {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10000)
    });
    return await upstream.json();
  } catch (error) {
    return { items: [], error: error.message };
  }
});

app.get("/api/ow800-stock-info", async () => {
  try {
    const upstream = await fetch("https://kkk.ow800.com/api/cards/gpt-inventory?productId=3", {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10000)
    });
    return await upstream.json();
  } catch (error) {
    return { success: false, data: null, error: error.message };
  }
});

app.post("/api/mock/verify", async (request, reply) => {
  const sourceKey = request.body?.card || request.body?.sourceKey;
  if (!sourceKey) {
    return reply.code(400).send({
      success: false,
      message: "缺少原始卡密"
    });
  }

  return {
    success: true,
    status: "active",
    message: "mock 校验通过"
  };
});

app.post("/api/mock/activate", async (request, reply) => {
  const sourceKey = request.body?.card || request.body?.sourceKey;
  const session = request.body?.session;

  if (!sourceKey) {
    return reply.code(400).send({
      success: false,
      message: "缺少原始卡密"
    });
  }

  if (!session || typeof session !== "object") {
    return reply.code(400).send({
      success: false,
      message: "缺少 session"
    });
  }

  return {
    success: true,
    activateId: nanoid(12),
    message: "mock 激活成功"
  };
});

app.post("/api/admin/auth/login", async (request, reply) => {
  const schema = z.object({
    username: z.string().min(1),
    password: z.string().min(1)
  });

  const parsed = schema.safeParse(getBodyObject(request.body));
  if (!parsed.success) {
    return reply.code(400).send({ message: "用户名和密码不能为空" });
  }

  if (
    parsed.data.username !== env.adminUsername ||
    parsed.data.password !== env.adminPassword
  ) {
    return reply.code(401).send({ message: "账号或密码错误" });
  }

  createAuditLog({
    action: logActions.login,
    actor: parsed.data.username,
    resourceType: "admin_user"
  });

  return {
    token: signAdminToken({ username: parsed.data.username }),
    username: parsed.data.username
  };
});

app.get("/api/public/products", async () => {
  const items = db.prepare(`
    SELECT id, code, title, description, status
    FROM products
    WHERE status = 'active'
    ORDER BY created_at DESC
  `).all();

  return { items };
});

app.post("/api/public/cdkeys/verify", async (request, reply) => {
  const schema = z.object({
    publicKey: z.string().min(6)
  });
  const parsed = schema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ message: "卡密格式不正确" });
  }

  const publicKey = parsed.data.publicKey.trim().toUpperCase();
  const key = db.prepare(`
    SELECT
      c.public_key,
      c.source_key,
      c.status,
      c.prefix,
      c.site_id,
      s.name AS site_name,
      s.slug AS site_slug,
      s.verify_api_url,
      s.verify_http_method,
      s.verify_headers_template,
      s.verify_body_template,
      s.auth_type,
      s.auth_config,
      s.verify_success_rule,
      s.verify_failure_rule,
      s.timeout_seconds,
      s.request_cookies
    FROM cdkeys c
    LEFT JOIN sites s ON s.id = c.site_id
    WHERE c.public_key = ?
  `).get(publicKey);

  if (!key) {
    return reply.code(404).send({ message: "卡密不存在" });
  }

  const verifyContext = {
    publicKey: key.public_key,
    sourceKey: decryptText(key.source_key),
    siteName: key.site_name,
    siteSlug: key.site_slug
  };

  let remoteResult = null;
  let canRedeem = key.status === cdkeyStatuses.active;

  if (canRedeem && key.verify_api_url) {
    remoteResult = await callConfiguredApi({
      url: key.verify_api_url,
      method: key.verify_http_method,
      headersTemplate: key.verify_headers_template,
      bodyTemplate: key.verify_body_template,
      authType: key.auth_type,
      authConfig: key.auth_config,
      timeoutSeconds: key.timeout_seconds,
      cookies: key.request_cookies || null
    }, verifyContext);

    const failureMatched = key.verify_failure_rule ? evaluateRule(key.verify_failure_rule, remoteResult) : false;
    const successMatched = key.verify_success_rule ? evaluateRule(key.verify_success_rule, remoteResult) : remoteResult.ok;
    canRedeem = !failureMatched && successMatched;
  }

  return {
    publicKey: key.public_key,
    status: key.status,
    productTitle: key.site_name || "未命名网站",
    productDescription: key.site_slug ? `站点标识：${key.site_slug}` : "未配置网站标识",
    endpointName: key.site_name || "未绑定网站",
    siteId: key.site_id,
    siteName: key.site_name || "未命名网站",
    siteSlug: key.site_slug || null,
    canRedeem,
    remoteAvailable: typeof remoteResult?.json?.available === "boolean" ? remoteResult.json.available : null,
    remoteError: typeof remoteResult?.json?.error_msg === "string"
      ? remoteResult.json.error_msg
      : (typeof remoteResult?.json?.error === "string"
        ? remoteResult.json.error
        : (typeof remoteResult?.json?.message === "string"
          ? remoteResult.json.message
          : (typeof remoteResult?.json?.msg === "string" ? remoteResult.json.msg : ""))),
    stockLevel: typeof remoteResult?.json?.stock_level === "string" ? remoteResult.json.stock_level : "",
    remoteResult: remoteResult ? {
      ok: remoteResult.ok,
      status: remoteResult.status,
      text: remoteResult.text,
      json: remoteResult.json
    } : null
  };
});

app.post("/api/public/redeem", async (request, reply) => {
  const schema = z.object({
    publicKey: z.string().min(6),
    sessionPayload: z.string().min(2),
    abandonRemainingTime: z.boolean().optional().default(false)
  });
  const parsed = schema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ message: "参数不完整" });
  }

  const publicKey = parsed.data.publicKey.trim().toUpperCase();
  let session;

  try {
    session = parseSessionPayload(parsed.data.sessionPayload);
  } catch (error) {
    return reply.code(400).send({ message: error.message });
  }

  try {
    const preflight = db.prepare(`
      SELECT
        c.id AS cdkey_id,
        c.status AS cdkey_status,
        c.site_id,
        s.*
      FROM cdkeys c
      LEFT JOIN sites s ON s.id = c.site_id
      WHERE c.public_key = ?
    `).get(publicKey);

    if (!preflight) {
      return reply.code(404).send({ message: "卡密不存在" });
    }
    if (preflight.cdkey_status !== cdkeyStatuses.active) {
      return reply.code(400).send({ message: `当前卡密状态不可兑换：${preflight.cdkey_status}` });
    }
    if (!preflight.site_id || preflight.status !== "active") {
      return reply.code(400).send({ message: "当前卡密未绑定有效网站" });
    }

    await assertSiteQueueReady(preflight);

    const result = withTransaction(() => {
      const cdkey = db.prepare(`
        SELECT *
        FROM cdkeys
        WHERE public_key = ?
      `).get(publicKey);

      if (!cdkey) {
        throw new Error("卡密不存在");
      }
      if (cdkey.status !== cdkeyStatuses.active) {
        throw new Error(`当前卡密状态不可兑换：${cdkey.status}`);
      }

      const site = db.prepare(`
        SELECT *
        FROM sites
        WHERE id = ? AND status = 'active'
      `).get(cdkey.site_id);

      if (!site) {
        throw new Error("当前卡密未绑定有效网站");
      }

      validateSessionForSite(site, session.parsed);

      const now = nowIso();
      const orderId = nanoid(18);
      const jobId = nanoid(18);
      const orderNo = `KW${Date.now()}${Math.floor(Math.random() * 900 + 100)}`;

      db.prepare(`
        INSERT INTO redeem_orders (
          id, order_no, cdkey_id, public_key, product_id, activation_endpoint_id, site_id,
          session_payload, session_preview, customer_ip, abandon_remaining_time, status, latest_job_id,
          error_message, completed_at, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)
      `).run(
        orderId,
        orderNo,
        cdkey.id,
        publicKey,
        site.product_id || cdkey.product_id,
        site.activation_endpoint_id || cdkey.activation_endpoint_id,
        site.id,
        encryptText(JSON.stringify(session.parsed)),
        JSON.stringify(session.preview),
        request.ip,
        parsed.data.abandonRemainingTime ? 1 : 0,
        orderStatuses.processing,
        jobId,
        now,
        now
      );

      db.prepare(`
        INSERT INTO activation_jobs (
          id, order_id, cdkey_id, activation_endpoint_id, site_id, dedupe_key, status, payload,
          attempt_count, max_attempts, next_retry_at, last_error, last_response,
          locked_at, locked_by, delivered_at, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, NULL, NULL, NULL, NULL, NULL, ?, ?)
      `).run(
        jobId,
        orderId,
        cdkey.id,
        site.activation_endpoint_id || cdkey.activation_endpoint_id,
        site.id,
        `redeem:${orderNo}`,
        jobStatuses.pending,
        JSON.stringify({
          orderNo,
          publicKey,
          siteId: site.id,
          abandonRemainingTime: parsed.data.abandonRemainingTime,
          session: session.parsed
        }),
        site.max_retries || 3,
        now,
        now,
        now
      );

      db.prepare(`
        UPDATE cdkeys
        SET status = ?, locked_at = ?, locked_by_order_id = ?, updated_at = ?
        WHERE id = ?
      `).run(cdkeyStatuses.locked, now, orderId, now, cdkey.id);

      createAuditLog({
        action: logActions.orderCreate,
        actor: "public",
        resourceType: "redeem_order",
        resourceId: orderId,
        detail: { publicKey, orderNo, abandonRemainingTime: parsed.data.abandonRemainingTime }
      });

      return { orderNo };
    });

    return result;
  } catch (error) {
    return reply.code(400).send({ message: error.message || "提交失败" });
  }
});

app.get("/api/public/orders/:orderNo", async (request, reply) => {
  const order = getOrderDetail(request.params.orderNo);
  if (!order) {
    return reply.code(404).send({ message: "订单不存在" });
  }

  return order;
});

app.post("/api/public/orders/batch", async (request, reply) => {
  const schema = z.object({
    orderNos: z.array(z.string().min(1)).min(1).max(50)
  });

  const normalized = normalizeLookupIdentifiers(request.body?.orderNos);
  const parsed = schema.safeParse({ orderNos: normalized });
  if (!parsed.success) {
    return reply.code(400).send({ message: "请提供 1-50 个有效订单号" });
  }

  const items = [];
  const missingOrderNos = [];

  for (const orderNo of parsed.data.orderNos) {
    const detail = getOrderDetail(orderNo);
    if (detail) {
      items.push(detail);
    } else {
      missingOrderNos.push(orderNo);
    }
  }

  return {
    total: parsed.data.orderNos.length,
    found: items.length,
    missing: missingOrderNos.length,
    missingOrderNos,
    items
  };
});

app.post("/api/public/lookups/batch", async (request, reply) => {
  const schema = z.object({
    identifiers: z.array(z.string().min(1)).min(1).max(50)
  });

  const normalized = normalizeLookupIdentifiers(request.body?.identifiers);
  const parsed = schema.safeParse({ identifiers: normalized });
  if (!parsed.success) {
    return reply.code(400).send({ message: "请提供 1-50 个有效订单号或卡密" });
  }

  const items = [];
  const missingIdentifiers = [];

  for (const identifier of parsed.data.identifiers) {
    const detail = getLookupDetail(identifier);
    if (detail) {
      items.push(detail);
    } else {
      missingIdentifiers.push(identifier);
    }
  }

  return {
    total: parsed.data.identifiers.length,
    found: items.length,
    missing: missingIdentifiers.length,
    missingIdentifiers,
    items
  };
});

app.get("/api/admin/dashboard", { preHandler: requireAdmin }, async () => {
  const counts = {
    websites: db.prepare("SELECT COUNT(*) AS count FROM sites WHERE status = 'active'").get().count,
    cdkeys: db.prepare("SELECT COUNT(*) AS count FROM cdkeys").get().count,
    inProgressJobs: db.prepare("SELECT COUNT(*) AS count FROM activation_jobs WHERE status IN ('pending', 'processing')").get().count,
    failedJobs: db.prepare("SELECT COUNT(*) AS count FROM activation_jobs WHERE status = 'failed'").get().count,
    succeededJobs: db.prepare("SELECT COUNT(*) AS count FROM activation_jobs WHERE status = 'succeeded'").get().count
  };

  const recentLogs = db.prepare(`
    SELECT id, action, actor, resource_type, resource_id, detail, created_at
    FROM admin_audit_logs
    ORDER BY created_at DESC
    LIMIT 5
  `).all().map((item) => ({
    ...item,
    detail: getJsonBodyOrNull(item.detail)
  }));

  return { counts, recentLogs };
});

app.get("/api/admin/system/version", { preHandler: requireAdmin }, async () => {
  try {
    const version = await getGitVersionInfo(false);
    return {
      ...version,
      nodeEnv: env.nodeEnv,
      updateState,
      log: readUpdateLog()
    };
  } catch (error) {
    return {
      isGitRepo: false,
      message: error.message,
      nodeEnv: env.nodeEnv,
      updateState,
      log: readUpdateLog()
    };
  }
});

app.post("/api/admin/system/check-update", { preHandler: requireAdmin }, async () => {
  if (updateState.status === "running" || updateState.status === "checking") {
    return {
      message: "已有更新任务正在执行",
      updateState,
      log: readUpdateLog()
    };
  }

  writeUpdateState({
    status: "checking",
    startedAt: nowIso(),
    endedAt: null,
    error: null
  });
  appendUpdateLog("开始检查远端更新");

  try {
    const version = await getGitVersionInfo(true);
    writeUpdateState({
      status: "idle",
      endedAt: nowIso(),
      localCommit: version.localCommit,
      remoteCommit: version.remoteCommit,
      branch: version.branch,
      hasUpdate: version.hasUpdate,
      error: null
    });
    if (version.hasLocalChanges) {
      appendUpdateLog(`检测到本地改动：${version.localChanges.join(", ")}`);
    }
    appendUpdateLog(version.hasUpdate ? "发现可用更新" : "当前已是最新版本");

    return {
      ...version,
      updateState,
      log: readUpdateLog()
    };
  } catch (error) {
    const partial = error.versionPartial || {};
    writeUpdateState({
      status: "failed",
      endedAt: nowIso(),
      localCommit: partial.localCommit ?? updateState.localCommit,
      remoteCommit: partial.remoteCommit ?? updateState.remoteCommit,
      branch: partial.branch ?? updateState.branch,
      hasUpdate: partial.hasUpdate ?? false,
      error: error.message
    });
    appendUpdateLog(`检查更新失败：${error.message}`);

    return {
      isGitRepo: partial.isGitRepo ?? false,
      branch: partial.branch ?? null,
      upstream: partial.upstream ?? null,
      localCommit: partial.localCommit ?? null,
      remoteCommit: partial.remoteCommit ?? null,
      hasUpdate: partial.hasUpdate ?? false,
      hasLocalChanges: partial.hasLocalChanges ?? false,
      localChanges: partial.localChanges ?? [],
      message: error.message,
      updateState,
      log: readUpdateLog()
    };
  }
});

app.post("/api/admin/system/update", { preHandler: requireAdmin }, async (request, reply) => {
  if (updateState.status === "running" || updateState.status === "checking") {
    return reply.code(409).send({
      message: "已有更新任务正在执行",
      updateState,
      log: readUpdateLog()
    });
  }

  createAuditLog({
    action: "system.update",
    actor: request.admin.username,
    resourceType: "system",
    detail: {
      localCommit: updateState.localCommit,
      remoteCommit: updateState.remoteCommit,
      branch: updateState.branch
    }
  });

  startUpdateTask(request.admin.username);

  return {
    message: "更新任务已启动",
    updateState,
    log: readUpdateLog()
  };
});

app.get("/api/admin/system/update-status", { preHandler: requireAdmin }, async () => ({
  updateState,
  log: readUpdateLog()
}));

app.get("/api/admin/sites", { preHandler: requireAdmin }, async () => {
  const items = db.prepare(`
    SELECT *
    FROM sites
    ORDER BY created_at DESC
  `).all();
  return { items };
});

app.patch("/api/admin/sites/:id/status", { preHandler: requireAdmin }, async (request, reply) => {
  const schema = z.object({
    status: z.enum(["active", "disabled"])
  });

  const parsed = schema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ message: "状态参数不正确，仅支持 active / disabled" });
  }

  const site = getSiteById(request.params.id);
  if (!site) {
    return reply.code(404).send({ message: "站点不存在" });
  }

  const now = nowIso();
  db.prepare("UPDATE sites SET status = ?, updated_at = ? WHERE id = ?")
    .run(parsed.data.status, now, site.id);

  ensureSiteLegacyResources(site.id, {
    ...site,
    name: site.name,
    slug: site.slug,
    submitApiUrl: site.submit_api_url,
    submitHttpMethod: site.submit_http_method,
    submitHeadersTemplate: site.submit_headers_template,
    submitBodyTemplate: site.submit_body_template,
    abandonSubmitBodyTemplate: site.abandon_submit_body_template,
    authType: site.auth_type,
    authConfig: site.auth_config,
    submitSuccessRule: site.submit_success_rule,
    submitFailureRule: site.submit_failure_rule,
    timeoutSeconds: site.timeout_seconds,
    maxRetries: site.max_retries,
    status: parsed.data.status
  });

  createAuditLog({
    action: logActions.siteToggleStatus,
    actor: request.admin.username,
    resourceType: "site",
    resourceId: site.id,
    detail: { from: site.status, to: parsed.data.status }
  });

  return { id: site.id, status: parsed.data.status };
});

app.patch("/api/admin/sites/:id/cookies", { preHandler: requireAdmin }, async (request, reply) => {
  const schema = z.object({
    requestCookies: z.string().max(4096).default("")
  });

  const parsed = schema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ message: "Cookie 参数不正确" });
  }

  const site = getSiteById(request.params.id);
  if (!site) {
    return reply.code(404).send({ message: "站点不存在" });
  }

  const now = nowIso();
  const value = parsed.data.requestCookies.trim() || null;
  db.prepare("UPDATE sites SET request_cookies = ?, updated_at = ? WHERE id = ?")
    .run(value, now, site.id);

  createAuditLog({
    action: logActions.siteUpdateCookies || "site.update_cookies",
    actor: request.admin.username,
    resourceType: "site",
    resourceId: site.id,
    detail: { hasCookies: Boolean(value) }
  });

  return { id: site.id, requestCookies: value };
});

app.post("/api/admin/sites/:id/health-check", { preHandler: requireAdmin }, async (request, reply) => {
  const site = getSiteById(request.params.id);
  if (!site) {
    return reply.code(404).send({ message: "站点不存在" });
  }

  async function pingUrl(url) {
    if (!url) return { ok: false, status: 0, latencyMs: 0, skipped: true };
    const methods = ["HEAD", "OPTIONS", "GET"];
    const start = Date.now();
    for (const method of methods) {
      try {
        const response = await fetch(url, { method, signal: AbortSignal.timeout(10000) });
        if (response.status === 405) continue;
        return { ok: response.status < 500, status: response.status, latencyMs: Date.now() - start, skipped: false };
      } catch {
        return { ok: false, status: 0, latencyMs: Date.now() - start, skipped: false, error: "不可达" };
      }
    }
    return { ok: false, status: 405, latencyMs: Date.now() - start, skipped: false, error: "所有方法均返回 405" };
  }

  const [verify, submit] = await Promise.all([
    pingUrl(site.verify_api_url),
    pingUrl(site.submit_api_url)
  ]);

  const now = nowIso();
  const result = { verify, submit };

  db.prepare("UPDATE sites SET last_health_check = ?, last_health_result = ?, updated_at = ? WHERE id = ?")
    .run(now, JSON.stringify(result), now, site.id);

  createAuditLog({
    action: logActions.siteHealthCheck,
    actor: request.admin.username,
    resourceType: "site",
    resourceId: site.id,
    detail: result
  });

  return { id: site.id, checkedAt: now, ...result };
});

app.get("/api/admin/products", { preHandler: requireAdmin }, async () => {
  const items = db.prepare(`
    SELECT
      p.*,
      e.name AS default_endpoint_name
    FROM products p
    LEFT JOIN activation_endpoints e ON e.id = p.default_activation_endpoint_id
    ORDER BY p.created_at DESC
  `).all();
  return { items };
});

app.post("/api/admin/products", { preHandler: requireAdmin }, async (request, reply) => {
  const schema = z.object({
    id: z.string().optional(),
    code: z.string().min(2),
    title: z.string().min(2),
    description: z.string().optional().default(""),
    status: z.enum(["active", "disabled"]).default("active"),
    defaultActivationEndpointId: z.string().nullable().optional()
  });
  const parsed = schema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ message: "商品参数不正确" });
  }

  const now = nowIso();
  const id = parsed.data.id || nanoid(16);
  const exists = db.prepare("SELECT id FROM products WHERE id = ?").get(id);

  if (exists) {
    db.prepare(`
      UPDATE products
      SET code = ?, title = ?, description = ?, status = ?, default_activation_endpoint_id = ?, updated_at = ?
      WHERE id = ?
    `).run(
      parsed.data.code,
      parsed.data.title,
      parsed.data.description,
      parsed.data.status,
      parsed.data.defaultActivationEndpointId ?? null,
      now,
      id
    );
  } else {
    db.prepare(`
      INSERT INTO products (id, code, title, description, status, default_activation_endpoint_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      parsed.data.code,
      parsed.data.title,
      parsed.data.description,
      parsed.data.status,
      parsed.data.defaultActivationEndpointId ?? null,
      now,
      now
    );
  }

  createAuditLog({
    action: logActions.productUpsert,
    actor: request.admin.username,
    resourceType: "product",
    resourceId: id,
    detail: parsed.data
  });

  return { id };
});

app.get("/api/admin/endpoints", { preHandler: requireAdmin }, async () => {
  const items = db.prepare(`
    SELECT *
    FROM activation_endpoints
    ORDER BY created_at DESC
  `).all();
  return { items };
});

app.post("/api/admin/endpoints", { preHandler: requireAdmin }, async (request, reply) => {
  const schema = z.object({
    id: z.string().optional(),
    name: z.string().min(2),
    endpointType: z.enum([endpointTypes.api, endpointTypes.webhook, endpointTypes.browser]),
    submitUrl: z.string().url(),
    queryUrl: z.string().url().optional().or(z.literal("")).default(""),
    httpMethod: z.enum(["GET", "POST", "PUT"]).default("POST"),
    headersTemplate: z.string().optional().default(""),
    bodyTemplate: z.string().optional().default(""),
    abandonSubmitBodyTemplate: z.string().optional().default(""),
    authType: z.string().optional().default(""),
    authConfig: z.string().optional().default(""),
    successRule: z.string().optional().default(""),
    failureRule: z.string().optional().default(""),
    pollingEnabled: z.boolean().default(false),
    timeoutSeconds: z.number().int().min(5).max(120).default(15),
    maxRetries: z.number().int().min(1).max(10).default(3),
    status: z.enum(["active", "disabled"]).default("active")
  });
  const parsed = schema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ message: "激活通道参数不正确" });
  }

  const now = nowIso();
  const id = parsed.data.id || nanoid(16);
  const exists = db.prepare("SELECT id FROM activation_endpoints WHERE id = ?").get(id);

  const values = [
    parsed.data.name,
    parsed.data.endpointType,
    parsed.data.submitUrl,
    parsed.data.queryUrl || null,
    parsed.data.httpMethod,
    parsed.data.headersTemplate || null,
    parsed.data.bodyTemplate || null,
    parsed.data.abandonSubmitBodyTemplate || parsed.data.bodyTemplate || null,
    parsed.data.authType || null,
    parsed.data.authConfig || null,
    parsed.data.successRule || null,
    parsed.data.failureRule || null,
    parsed.data.pollingEnabled ? 1 : 0,
    parsed.data.timeoutSeconds,
    parsed.data.maxRetries,
    parsed.data.status,
    now
  ];

  if (exists) {
    db.prepare(`
      UPDATE activation_endpoints
      SET name = ?, endpoint_type = ?, submit_url = ?, query_url = ?, http_method = ?,
          headers_template = ?, body_template = ?, abandon_submit_body_template = ?, auth_type = ?, auth_config = ?,
          success_rule = ?, failure_rule = ?, polling_enabled = ?, timeout_seconds = ?,
          max_retries = ?, status = ?, updated_at = ?
      WHERE id = ?
    `).run(...values, id);
  } else {
    db.prepare(`
      INSERT INTO activation_endpoints (
        id, name, endpoint_type, submit_url, query_url, http_method, headers_template, body_template,
        abandon_submit_body_template, auth_type, auth_config, success_rule, failure_rule, polling_enabled, timeout_seconds,
        max_retries, status, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, ...values, now);
  }

  createAuditLog({
    action: logActions.endpointUpsert,
    actor: request.admin.username,
    resourceType: "activation_endpoint",
    resourceId: id,
    detail: parsed.data
  });

  return { id };
});

app.get("/api/admin/batches", { preHandler: requireAdmin }, async () => {
  const items = db.prepare(`
    SELECT
      b.*,
      s.name AS site_name,
      s.slug AS site_slug
    FROM cdkey_batches b
    LEFT JOIN sites s ON s.id = b.site_id
    ORDER BY b.created_at DESC
  `).all();
  return { items };
});

app.post("/api/admin/batches/import", { preHandler: requireAdmin }, async (request, reply) => {
  const schema = z.object({
    name: z.string().min(2),
    prefix: z.string().min(1),
    siteId: z.string().min(1),
    rawKeys: z.string().min(2),
    note: z.string().optional().default("")
  });
  const parsed = schema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ message: "导入参数不正确" });
  }

  const site = db.prepare("SELECT * FROM sites WHERE id = ?").get(parsed.data.siteId);
  if (!site) {
    return reply.code(400).send({ message: "网站不存在" });
  }

  const rawKeys = Array.from(new Set(
    parsed.data.rawKeys
      .split(/\r?\n|,/)
      .map((item) => item.trim())
      .filter(Boolean)
  ));

  if (!rawKeys.length) {
    return reply.code(400).send({ message: "没有可导入的卡密" });
  }

  const result = withTransaction(() => {
    const batchId = nanoid(16);
    const now = nowIso();

    db.prepare(`
      INSERT INTO cdkey_batches (
        id, name, prefix, product_id, activation_endpoint_id, site_id, imported_count, note, created_by, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      batchId,
      parsed.data.name,
      parsed.data.prefix,
      site.product_id || "prod_demo",
      site.activation_endpoint_id || "endpoint_demo",
      site.id,
      rawKeys.length,
      parsed.data.note,
      request.admin.username,
      now,
      now
    );

    const insertKey = db.prepare(`
      INSERT INTO cdkeys (
        id, batch_id, product_id, activation_endpoint_id, site_id, source_key, public_key, prefix, status,
        locked_at, locked_by_order_id, used_at, disabled_reason, metadata, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, ?, ?)
    `);

    for (const rawKey of rawKeys) {
      insertKey.run(
        nanoid(18),
        batchId,
        site.product_id || "prod_demo",
        site.activation_endpoint_id || "endpoint_demo",
        site.id,
        encryptText(rawKey),
        getUniquePublicKey(parsed.data.prefix),
        parsed.data.prefix,
        cdkeyStatuses.active,
        now,
        now
      );
    }

    createAuditLog({
      action: logActions.batchImport,
      actor: request.admin.username,
      resourceType: "cdkey_batch",
      resourceId: batchId,
      detail: {
        count: rawKeys.length,
        prefix: parsed.data.prefix,
        siteId: site.id
      }
    });

    return {
      batchId,
      importedCount: rawKeys.length
    };
  });

  return result;
});

app.post("/api/admin/cdkeys/create", { preHandler: requireAdmin }, async (request, reply) => {
  const schema = z.object({
    sourceKey: z.string().min(1),
    prefix: z.string().min(1),
    siteId: z.string().min(1),
    note: z.string().optional().default("")
  });

  const parsed = schema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ message: "单次添加参数不正确" });
  }

  const site = getSiteById(parsed.data.siteId);
  if (!site) {
    return reply.code(400).send({ message: "网站不存在" });
  }

  const now = nowIso();
  const id = nanoid(18);
  const publicKey = getUniquePublicKey(parsed.data.prefix);

  db.prepare(`
    INSERT INTO cdkeys (
      id, batch_id, product_id, activation_endpoint_id, site_id, source_key, public_key, prefix, status,
      locked_at, locked_by_order_id, used_at, disabled_reason, metadata, created_at, updated_at
    )
    VALUES (?, '', ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?, ?, ?)
  `).run(
    id,
    site.product_id || "prod_demo",
    site.activation_endpoint_id || "endpoint_demo",
    site.id,
    encryptText(parsed.data.sourceKey),
    publicKey,
    parsed.data.prefix,
    cdkeyStatuses.active,
    parsed.data.note ? JSON.stringify({ note: parsed.data.note }) : null,
    now,
    now
  );

  createAuditLog({
    action: logActions.cdkeySingleCreate,
    actor: request.admin.username,
    resourceType: "cdkey",
    resourceId: id,
    detail: {
      siteId: site.id,
      prefix: parsed.data.prefix,
      publicKey
    }
  });

  return {
    id,
    publicKey
  };
});

app.get("/api/admin/cdkeys", { preHandler: requireAdmin }, async (request) => {
  const status = request.query.status ? String(request.query.status) : null;
  const batchId = request.query.batchId ? String(request.query.batchId) : null;
  const siteId = request.query.siteId ? String(request.query.siteId) : null;
  const keyword = request.query.q ? `%${String(request.query.q).trim().toUpperCase()}%` : null;

  let sql = `
    SELECT
      c.id, c.public_key, c.source_key, c.prefix, c.status, c.used_at, c.locked_at,
      b.name AS batch_name,
      s.name AS site_name
    FROM cdkeys c
    LEFT JOIN cdkey_batches b ON b.id = c.batch_id
    LEFT JOIN sites s ON s.id = c.site_id
    WHERE 1 = 1
  `;
  const params = [];

  if (status) {
    sql += " AND c.status = ?";
    params.push(status);
  }
  if (batchId) {
    sql += " AND c.batch_id = ?";
    params.push(batchId);
  }
  if (siteId) {
    sql += " AND c.site_id = ?";
    params.push(siteId);
  }
  if (keyword) {
    sql += " AND c.public_key LIKE ?";
    params.push(keyword);
  }

  sql += " ORDER BY c.created_at DESC LIMIT 200";

  const items = db.prepare(sql).all(...params).map((item) => ({
    ...item,
    source_key: decryptText(item.source_key)
  }));
  return { items };
});

app.post("/api/admin/cdkeys/bulk-action", { preHandler: requireAdmin }, async (request, reply) => {
  const schema = z.object({
    ids: z.array(z.string()).min(1),
    action: z.enum(["enable", "disable", "void", "reset"])
  });
  const parsed = schema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ message: "批量操作参数不正确" });
  }

  const now = nowIso();
  const placeholders = parsed.data.ids.map(() => "?").join(",");
  let nextStatus = cdkeyStatuses.active;
  let reason = null;

  if (parsed.data.action === "disable") {
    nextStatus = cdkeyStatuses.disabled;
    reason = "后台批量禁用";
  } else if (parsed.data.action === "void") {
    nextStatus = cdkeyStatuses.void;
    reason = "后台批量作废";
  } else if (parsed.data.action === "reset") {
    nextStatus = cdkeyStatuses.active;
  }

  db.prepare(`
    UPDATE cdkeys
    SET status = ?, disabled_reason = ?, locked_at = NULL, locked_by_order_id = NULL,
        used_at = CASE WHEN ? = 'active' THEN NULL ELSE used_at END,
        updated_at = ?
    WHERE id IN (${placeholders})
  `).run(nextStatus, reason, nextStatus, now, ...parsed.data.ids);

  createAuditLog({
    action: logActions.cdkeyBulk,
    actor: request.admin.username,
    resourceType: "cdkey",
    detail: parsed.data
  });

  return { updated: parsed.data.ids.length };
});

app.get("/api/admin/orders", { preHandler: requireAdmin }, async () => {
  const items = db.prepare(`
    SELECT
      o.order_no, o.public_key, o.status, o.error_message, o.created_at,
      s.name AS site_name
    FROM redeem_orders o
    LEFT JOIN sites s ON s.id = o.site_id
    ORDER BY o.created_at DESC
    LIMIT 200
  `).all();
  return { items };
});

app.get("/api/admin/jobs", { preHandler: requireAdmin }, async () => {
  const items = db.prepare(`
    SELECT
      j.id, j.status, j.attempt_count, j.max_attempts, j.last_error, j.updated_at,
      o.order_no,
      s.name AS site_name
    FROM activation_jobs j
    JOIN redeem_orders o ON o.id = j.order_id
    LEFT JOIN sites s ON s.id = j.site_id
    ORDER BY j.updated_at DESC
    LIMIT 200
  `).all();
  return { items };
});

app.post("/api/admin/jobs/retry", { preHandler: requireAdmin }, async (request, reply) => {
  const schema = z.object({
    ids: z.array(z.string()).min(1)
  });
  const parsed = schema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ message: "重试参数不正确" });
  }

  const now = nowIso();
  const placeholders = parsed.data.ids.map(() => "?").join(",");

  db.prepare(`
    UPDATE activation_jobs
    SET status = 'pending', attempt_count = 0, next_retry_at = ?, last_error = NULL,
        locked_at = NULL, locked_by = NULL, updated_at = ?
    WHERE id IN (${placeholders})
  `).run(now, now, ...parsed.data.ids);

  createAuditLog({
    action: logActions.jobRetry,
    actor: request.admin.username,
    resourceType: "activation_job",
    detail: parsed.data
  });

  return { retried: parsed.data.ids.length };
});

app.get("/api/admin/logs", { preHandler: requireAdmin }, async () => {
  const items = db.prepare(`
    SELECT *
    FROM admin_audit_logs
    ORDER BY created_at DESC
    LIMIT 200
  `).all().map((item) => ({
    ...item,
    detail: getJsonBodyOrNull(item.detail)
  }));

  return { items };
});

// ── Notification Monitors ──

function getNotificationSettings() {
  let row = db.prepare("SELECT * FROM notification_settings WHERE id = 'default'").get();
  if (!row) {
    const now = nowIso();
    db.prepare(`
      INSERT INTO notification_settings (id, global_feishu_webhook, updated_at, updated_by)
      VALUES ('default', NULL, ?, 'system')
    `).run(now);
    row = db.prepare("SELECT * FROM notification_settings WHERE id = 'default'").get();
  }
  return row;
}

function serializeMonitor(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    monitorType: row.monitor_type || "http",
    enabled: !!row.enabled,
    requestUrl: row.request_url,
    httpMethod: row.http_method,
    headersJson: row.headers_json || "",
    bodyJson: row.body_json || "",
    browserPageUrl: row.browser_page_url || "",
    browserReadySelector: row.browser_ready_selector || "",
    browserWaitMs: row.browser_wait_ms || 10000,
    intervalSeconds: row.interval_seconds,
    timeoutSeconds: row.timeout_seconds,
    watchFields: normalizeWatchFields(row.watch_fields),
    rules: normalizeMonitorRules(row.rules_json),
    feishuWebhookOverride: row.feishu_webhook_override || "",
    notifyTitle: row.notify_title || "",
    cooldownSeconds: row.cooldown_seconds || 0,
    lastRunAt: row.last_run_at,
    lastMatchAt: row.last_match_at,
    lastNotifiedAt: row.last_notified_at,
    lastStatus: row.last_status,
    lastError: row.last_error,
    nextRunAt: row.next_run_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

const monitorPayloadSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1, "请填写监听名称").max(80, "名称过长"),
  monitorType: z.enum(notificationMonitorTypes).optional().default("http"),
  enabled: z.boolean().optional().default(true),
  requestUrl: z.string().url("请输入合法的请求 URL"),
  httpMethod: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).default("GET"),
  headersJson: z.string().optional().default(""),
  bodyJson: z.string().optional().default(""),
  browserPageUrl: z.string().optional().default(""),
  browserReadySelector: z.string().optional().default(""),
  browserWaitMs: z.number().int().min(1000).max(60000).optional().default(10000),
  intervalSeconds: z
    .number({ invalid_type_error: "轮询间隔必须是数字" })
    .int("轮询间隔必须是整数")
    .min(NOTIFICATION_MIN_INTERVAL, "轮询间隔最小 1 秒")
    .max(NOTIFICATION_MAX_INTERVAL, "轮询间隔最大 3600 秒"),
  timeoutSeconds: z.number().int().min(1).max(120).optional().default(15),
  watchFields: z.array(z.string()).optional().default([]),
  rules: z
    .object({
      matchMode: z.enum(notificationMatchModes).optional().default("all"),
      items: z
        .array(
          z.object({
            fieldPath: z.string().min(1, "字段路径不能为空"),
            operator: z.enum(notificationRuleOperators),
            expectedValue: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional()
          })
        )
        .optional()
        .default([])
    })
    .optional()
    .default({ matchMode: "all", items: [] }),
  feishuWebhookOverride: z.string().optional().default(""),
  notifyTitle: z.string().optional().default(""),
  cooldownSeconds: z.number().int().min(0).max(86400).optional().default(0)
});

function validateOptionalJsonObject(value, fieldLabel) {
  if (!value || !String(value).trim()) return null;
  const parsed = safeParseJson(value, null);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${fieldLabel} 必须是合法的 JSON 对象`);
  }
  return parsed;
}

function upsertMonitor(payload, isUpdate, existing) {
  const now = nowIso();
  const id = isUpdate ? existing.id : nanoid(16);
  const monitorType = notificationMonitorTypes.includes(payload.monitorType) ? payload.monitorType : "http";
  const intervalSeconds = clampIntervalSeconds(payload.intervalSeconds);
  const browserWaitMs = clampBrowserWaitMs(payload.browserWaitMs);
  const headersTrimmed = String(payload.headersJson || "").trim();
  const bodyTrimmed = String(payload.bodyJson || "").trim();
  const browserPageUrl = String(payload.browserPageUrl || "").trim();
  const browserReadySelector = String(payload.browserReadySelector || "").trim();
  validateOptionalJsonObject(headersTrimmed, "Headers");

  if (monitorType === "browser") {
    if (!browserPageUrl) {
      throw new Error("browser 模式必须填写页面 URL");
    }
    try {
      new URL(browserPageUrl);
    } catch {
      throw new Error("browser 模式的页面 URL 不合法");
    }
  }

  if (bodyTrimmed && payload.httpMethod !== "GET" && payload.httpMethod !== "HEAD") {
    const parsed = safeParseJson(bodyTrimmed, null);
    if (parsed === null && !bodyTrimmed.startsWith("{")) {
      // tolerate raw string bodies but warn if obvious JSON-looking but invalid
    }
  }

  const watchFields = normalizeWatchFields(payload.watchFields);
  const normalizedRules = normalizeMonitorRules(payload.rules);
  const rulesJson = JSON.stringify(normalizedRules);

  if (isUpdate) {
    db.prepare(`
      UPDATE notification_monitors
      SET name = ?, monitor_type = ?, enabled = ?, request_url = ?, http_method = ?, headers_json = ?, body_json = ?,
          browser_page_url = ?, browser_ready_selector = ?, browser_wait_ms = ?,
          interval_seconds = ?, timeout_seconds = ?, watch_fields = ?, rules_json = ?,
          feishu_webhook_override = ?, notify_title = ?, cooldown_seconds = ?, updated_at = ?
      WHERE id = ?
    `).run(
      payload.name.trim(),
      monitorType,
      payload.enabled ? 1 : 0,
      payload.requestUrl.trim(),
      payload.httpMethod,
      headersTrimmed || null,
      bodyTrimmed || null,
      browserPageUrl || null,
      browserReadySelector || null,
      browserWaitMs,
      intervalSeconds,
      payload.timeoutSeconds || 15,
      JSON.stringify(watchFields),
      rulesJson,
      payload.feishuWebhookOverride?.trim() || null,
      payload.notifyTitle?.trim() || null,
      payload.cooldownSeconds || 0,
      now,
      id
    );
  } else {
    db.prepare(`
      INSERT INTO notification_monitors (
        id, name, monitor_type, enabled, request_url, http_method, headers_json, body_json,
        browser_page_url, browser_ready_selector, browser_wait_ms,
        interval_seconds, timeout_seconds, watch_fields, rules_json,
        feishu_webhook_override, notify_title, cooldown_seconds,
        next_run_at, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      payload.name.trim(),
      monitorType,
      payload.enabled ? 1 : 0,
      payload.requestUrl.trim(),
      payload.httpMethod,
      headersTrimmed || null,
      bodyTrimmed || null,
      browserPageUrl || null,
      browserReadySelector || null,
      browserWaitMs,
      intervalSeconds,
      payload.timeoutSeconds || 15,
      JSON.stringify(watchFields),
      rulesJson,
      payload.feishuWebhookOverride?.trim() || null,
      payload.notifyTitle?.trim() || null,
      payload.cooldownSeconds || 0,
      now,
      now,
      now
    );
  }

  return id;
}

function recordNotificationEvent({ monitorId, monitorName, eventType, matched, summary, detail }) {
  db.prepare(`
    INSERT INTO notification_events (id, monitor_id, monitor_name, event_type, matched, summary, detail, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    nanoid(16),
    monitorId || null,
    monitorName || null,
    eventType,
    matched ? 1 : 0,
    summary || null,
    detail ? JSON.stringify(detail) : null,
    nowIso()
  );
}

app.get("/api/admin/notifications/settings", { preHandler: requireAdmin }, async () => {
  const settings = getNotificationSettings();
  return {
    globalFeishuWebhook: settings.global_feishu_webhook || "",
    updatedAt: settings.updated_at,
    updatedBy: settings.updated_by,
    intervalBounds: { min: NOTIFICATION_MIN_INTERVAL, max: NOTIFICATION_MAX_INTERVAL }
  };
});

app.patch("/api/admin/notifications/settings", { preHandler: requireAdmin }, async (request, reply) => {
  const schema = z.object({
    globalFeishuWebhook: z.string().max(4096).optional().default("")
  });
  const parsed = schema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ message: parsed.error.issues[0]?.message || "参数不正确" });
  }

  const value = parsed.data.globalFeishuWebhook.trim() || null;
  if (value && !/^https?:\/\//i.test(value)) {
    return reply.code(400).send({ message: "飞书 Webhook 必须以 http(s):// 开头" });
  }

  const now = nowIso();
  db.prepare(`
    UPDATE notification_settings
    SET global_feishu_webhook = ?, updated_at = ?, updated_by = ?
    WHERE id = 'default'
  `).run(value, now, request.admin.username);

  createAuditLog({
    action: logActions.notificationSettingsUpdate,
    actor: request.admin.username,
    resourceType: "notification_settings",
    resourceId: "default",
    detail: { hasGlobalWebhook: !!value }
  });

  return { globalFeishuWebhook: value || "", updatedAt: now };
});

app.get("/api/admin/notifications/monitors", { preHandler: requireAdmin }, async () => {
  const rows = db.prepare("SELECT * FROM notification_monitors ORDER BY created_at DESC").all();
  return {
    items: rows.map(serializeMonitor),
    intervalBounds: { min: NOTIFICATION_MIN_INTERVAL, max: NOTIFICATION_MAX_INTERVAL }
  };
});

app.post("/api/admin/notifications/monitors", { preHandler: requireAdmin }, async (request, reply) => {
  const parsed = monitorPayloadSchema.safeParse(getBodyObject(request.body));
  if (!parsed.success) {
    return reply.code(400).send({ message: parsed.error.issues[0]?.message || "参数不正确" });
  }

  const payload = parsed.data;
  const existing = payload.id ? db.prepare("SELECT * FROM notification_monitors WHERE id = ?").get(payload.id) : null;
  if (payload.id && !existing) {
    return reply.code(404).send({ message: "监听项不存在" });
  }

  try {
    const id = upsertMonitor(payload, !!existing, existing);
    createAuditLog({
      action: logActions.notificationMonitorUpsert,
      actor: request.admin.username,
      resourceType: "notification_monitor",
      resourceId: id,
      detail: {
        name: payload.name,
        enabled: !!payload.enabled,
        intervalSeconds: clampIntervalSeconds(payload.intervalSeconds),
        ruleCount: payload.rules?.items?.length || 0
      }
    });

    return { id };
  } catch (error) {
    return reply.code(400).send({ message: error.message || "保存失败" });
  }
});

app.patch("/api/admin/notifications/monitors/:id/status", { preHandler: requireAdmin }, async (request, reply) => {
  const schema = z.object({ enabled: z.boolean() });
  const parsed = schema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ message: "参数不正确" });
  }

  const monitor = db.prepare("SELECT * FROM notification_monitors WHERE id = ?").get(request.params.id);
  if (!monitor) {
    return reply.code(404).send({ message: "监听项不存在" });
  }

  const now = nowIso();
  db.prepare(`
    UPDATE notification_monitors
    SET enabled = ?, next_run_at = CASE WHEN ? = 1 THEN ? ELSE next_run_at END, updated_at = ?
    WHERE id = ?
  `).run(parsed.data.enabled ? 1 : 0, parsed.data.enabled ? 1 : 0, now, now, monitor.id);

  createAuditLog({
    action: logActions.notificationMonitorToggle,
    actor: request.admin.username,
    resourceType: "notification_monitor",
    resourceId: monitor.id,
    detail: { enabled: parsed.data.enabled }
  });

  return { id: monitor.id, enabled: parsed.data.enabled };
});

app.delete("/api/admin/notifications/monitors/:id", { preHandler: requireAdmin }, async (request, reply) => {
  const monitor = db.prepare("SELECT * FROM notification_monitors WHERE id = ?").get(request.params.id);
  if (!monitor) {
    return reply.code(404).send({ message: "监听项不存在" });
  }

  db.prepare("DELETE FROM notification_monitors WHERE id = ?").run(monitor.id);

  createAuditLog({
    action: logActions.notificationMonitorDelete,
    actor: request.admin.username,
    resourceType: "notification_monitor",
    resourceId: monitor.id,
    detail: { name: monitor.name }
  });

  return { id: monitor.id };
});

app.post("/api/admin/notifications/monitors/:id/test-run", { preHandler: requireAdmin }, async (request, reply) => {
  const monitor = db.prepare("SELECT * FROM notification_monitors WHERE id = ?").get(request.params.id);
  if (!monitor) {
    return reply.code(404).send({ message: "监听项不存在" });
  }

  const responseInfo = await fetchMonitorEndpoint(monitor);
  const ruleResult = evaluateMonitorRules(safeParseJson(monitor.rules_json, null), responseInfo.json);
  const watchFields = normalizeWatchFields(monitor.watch_fields);

  const summary = summarizeResponseInfo(responseInfo);
  const eventDetail = {
    response: summary,
    rules: ruleResult,
    watchFields
  };

  recordNotificationEvent({
    monitorId: monitor.id,
    monitorName: monitor.name,
    eventType: notificationEventTypes.test,
    matched: ruleResult.matched,
    summary: responseInfo.ok ? `HTTP ${responseInfo.status} ${ruleResult.matched ? "命中" : "未命中"}` : `请求失败：${responseInfo.text?.slice(0, 120) || "-"}`,
    detail: eventDetail
  });

  createAuditLog({
    action: logActions.notificationMonitorTest,
    actor: request.admin.username,
    resourceType: "notification_monitor",
    resourceId: monitor.id,
    detail: { matched: ruleResult.matched, ok: responseInfo.ok, status: responseInfo.status }
  });

  return {
    monitorId: monitor.id,
    monitorName: monitor.name,
    response: summary,
    ruleResult,
    watchFields
  };
});

app.post("/api/admin/notifications/test-feishu", { preHandler: requireAdmin }, async (request, reply) => {
  const schema = z.object({
    webhookUrl: z.string().optional().default(""),
    monitorId: z.string().optional()
  });
  const parsed = schema.safeParse(getBodyObject(request.body));
  if (!parsed.success) {
    return reply.code(400).send({ message: "参数不正确" });
  }

  let webhookUrl = parsed.data.webhookUrl.trim();
  let monitor = null;
  if (!webhookUrl && parsed.data.monitorId) {
    monitor = db.prepare("SELECT * FROM notification_monitors WHERE id = ?").get(parsed.data.monitorId);
    if (monitor?.feishu_webhook_override) {
      webhookUrl = monitor.feishu_webhook_override;
    }
  }
  if (!webhookUrl) {
    const settings = getNotificationSettings();
    webhookUrl = settings.global_feishu_webhook || "";
  }
  if (!webhookUrl) {
    return reply.code(400).send({ message: "未配置飞书 Webhook" });
  }

  const message = buildFeishuMarkdown({
    monitorName: monitor?.name || "测试通知",
    monitorUrl: monitor?.request_url || "",
    matchMode: "all",
    matchedItems: [
      { fieldPath: "test", operator: "equals", expectedValue: "ok", actualValue: "ok" }
    ],
    watchFields: monitor ? normalizeWatchFields(monitor.watch_fields) : [],
    responseJson: { test: "ok" },
    timestamp: nowIso(),
    customTitle: monitor?.notify_title || "KaWang 通知测试"
  });

  const sendResult = await sendFeishuMarkdown(webhookUrl, message);

  recordNotificationEvent({
    monitorId: monitor?.id || null,
    monitorName: monitor?.name || "(测试)",
    eventType: sendResult.ok ? notificationEventTypes.sendOk : notificationEventTypes.sendError,
    matched: false,
    summary: sendResult.ok
      ? "飞书测试通知发送成功"
      : `飞书测试发送失败：${(sendResult.text || sendResult.status || "未知错误").toString().slice(0, 200)}`,
    detail: { message, result: sendResult }
  });

  createAuditLog({
    action: logActions.notificationFeishuSend,
    actor: request.admin.username,
    resourceType: "notification_monitor",
    resourceId: monitor?.id || "(test)",
    detail: { test: true, ok: sendResult.ok, status: sendResult.status }
  });

  return { ok: sendResult.ok, status: sendResult.status, text: sendResult.text, json: sendResult.json };
});

app.get("/api/admin/notifications/events", { preHandler: requireAdmin }, async (request) => {
  const monitorId = request.query?.monitorId ? String(request.query.monitorId) : null;
  const limit = Math.min(200, Math.max(1, Number(request.query?.limit) || 100));

  let sql = "SELECT * FROM notification_events";
  const params = [];
  if (monitorId) {
    sql += " WHERE monitor_id = ?";
    params.push(monitorId);
  }
  sql += " ORDER BY created_at DESC LIMIT ?";
  params.push(limit);

  const items = db.prepare(sql).all(...params).map((row) => ({
    id: row.id,
    monitorId: row.monitor_id,
    monitorName: row.monitor_name,
    eventType: row.event_type,
    matched: !!row.matched,
    summary: row.summary,
    detail: getJsonBodyOrNull(row.detail),
    createdAt: row.created_at
  }));

  return { items };
});

// ── Subscription System ──

function getTodayStart() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
}

function getThreeDaysAgoStart() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 3).toISOString();
}

function computeStability(dropsLast3Days, totalSubscriptions) {
  if (!totalSubscriptions || totalSubscriptions <= 0) return "stable";
  const avgDaily = dropsLast3Days / 3;
  const ratio = avgDaily / totalSubscriptions;
  if (ratio === 0) return "stable";
  if (ratio >= 0.5) return "danger";
  return "bumpy";
}

app.get("/api/public/subscriptions/dashboard", async () => {
  const todayStart = getTodayStart();
  const todayDrops = db.prepare(`
    SELECT COUNT(*) AS count FROM subscription_requests
    WHERE status = 'approved' AND drop_type = '被杀害' AND reviewed_at >= ?
  `).get(todayStart).count;
  const totalDrops = db.prepare(`
    SELECT COUNT(*) AS count FROM subscription_requests
    WHERE status = 'approved' AND drop_type = '被杀害'
  `).get().count;
  return { todayDrops, totalDrops };
});

app.get("/api/public/subscriptions/card-types", async () => {
  const todayStart = getTodayStart();
  const threeDaysAgo = getThreeDaysAgoStart();
  const cardTypes = db.prepare(`
    SELECT * FROM subscription_card_types WHERE visible = 1 ORDER BY created_at DESC
  `).all();

  const items = cardTypes.map((ct) => {
    const todayDrops = db.prepare(`
      SELECT COUNT(*) AS count FROM subscription_requests
      WHERE card_type_id = ? AND status = 'approved' AND drop_type = '被杀害' AND reviewed_at >= ?
    `).get(ct.id, todayStart).count;
    const dropsLast3Days = db.prepare(`
      SELECT COUNT(*) AS count FROM subscription_requests
      WHERE card_type_id = ? AND status = 'approved' AND drop_type = '被杀害' AND reviewed_at >= ?
    `).get(ct.id, threeDaysAgo).count;
    const totalDrops = db.prepare(`
      SELECT COUNT(*) AS count FROM subscription_requests
      WHERE card_type_id = ? AND status = 'approved' AND drop_type = '被杀害'
    `).get(ct.id).count;
    return {
      id: ct.id,
      name: ct.name,
      totalSubscriptions: ct.total_subscriptions,
      totalDrops,
      todayDrops,
      stability: computeStability(dropsLast3Days, ct.total_subscriptions)
    };
  });

  return { items };
});

app.post("/api/public/subscriptions/submit", async (request, reply) => {
  const schema = z.object({
    identifier: z.string().min(1, "订单号或QQ号不能为空"),
    cardTypeId: z.string().min(1, "请选择卡种"),
    dropType: z.enum(["平安夜", "被杀害"], { message: "请选择类型" })
  });
  const parsed = schema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ message: parsed.error.issues[0]?.message || "参数不正确" });
  }

  const cardType = db.prepare("SELECT id FROM subscription_card_types WHERE id = ? AND visible = 1").get(parsed.data.cardTypeId);
  if (!cardType) {
    return reply.code(400).send({ message: "卡种不存在或已隐藏" });
  }

  const todayStart = getTodayStart();
  const duplicate = db.prepare(`
    SELECT id FROM subscription_requests
    WHERE identifier = ? AND created_at >= ?
  `).get(parsed.data.identifier.trim(), todayStart);
  if (duplicate) {
    return reply.code(400).send({ message: "该订单号/QQ号今日已提交过，请勿重复提交" });
  }

  const id = nanoid(16);
  const now = nowIso();
  db.prepare(`
    INSERT INTO subscription_requests (id, identifier, card_type_id, drop_type, status, created_at)
    VALUES (?, ?, ?, ?, 'pending', ?)
  `).run(id, parsed.data.identifier.trim(), parsed.data.cardTypeId, parsed.data.dropType, now);

  const isNewSubscriber = !db.prepare(`
    SELECT id FROM subscription_requests
    WHERE identifier = ? AND card_type_id = ? AND id != ?
  `).get(parsed.data.identifier.trim(), parsed.data.cardTypeId, id);

  if (isNewSubscriber) {
    db.prepare(`
      UPDATE subscription_card_types SET total_subscriptions = total_subscriptions + 1, updated_at = ? WHERE id = ?
    `).run(now, parsed.data.cardTypeId);
  }

  return { id, message: "提交成功，等待管理员审批" };
});

// ── Subscription Admin ──

app.get("/api/admin/subscriptions/card-types", { preHandler: requireAdmin }, async () => {
  const todayStart = getTodayStart();
  const threeDaysAgo = getThreeDaysAgoStart();
  const cardTypes = db.prepare("SELECT * FROM subscription_card_types ORDER BY created_at DESC").all();

  const items = cardTypes.map((ct) => {
    const todayDrops = db.prepare(`
      SELECT COUNT(*) AS count FROM subscription_requests
      WHERE card_type_id = ? AND status = 'approved' AND drop_type = '被杀害' AND reviewed_at >= ?
    `).get(ct.id, todayStart).count;
    const dropsLast3Days = db.prepare(`
      SELECT COUNT(*) AS count FROM subscription_requests
      WHERE card_type_id = ? AND status = 'approved' AND drop_type = '被杀害' AND reviewed_at >= ?
    `).get(ct.id, threeDaysAgo).count;
    const totalDrops = db.prepare(`
      SELECT COUNT(*) AS count FROM subscription_requests
      WHERE card_type_id = ? AND status = 'approved' AND drop_type = '被杀害'
    `).get(ct.id).count;
    return {
      id: ct.id,
      name: ct.name,
      totalSubscriptions: ct.total_subscriptions,
      totalDrops,
      todayDrops,
      stability: computeStability(dropsLast3Days, ct.total_subscriptions),
      visible: ct.visible,
      createdAt: ct.created_at,
      updatedAt: ct.updated_at
    };
  });

  return { items };
});

app.post("/api/admin/subscriptions/card-types", { preHandler: requireAdmin }, async (request, reply) => {
  const schema = z.object({
    id: z.string().optional(),
    name: z.string().min(1, "卡种名称不能为空"),
    totalSubscriptions: z.number().int().min(0).default(0)
  });
  const parsed = schema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ message: parsed.error.issues[0]?.message || "参数不正确" });
  }

  const now = nowIso();
  const id = parsed.data.id || nanoid(16);
  const exists = db.prepare("SELECT id FROM subscription_card_types WHERE id = ?").get(id);

  if (exists) {
    db.prepare(`
      UPDATE subscription_card_types SET name = ?, total_subscriptions = ?, updated_at = ? WHERE id = ?
    `).run(parsed.data.name, parsed.data.totalSubscriptions, now, id);
  } else {
    db.prepare(`
      INSERT INTO subscription_card_types (id, name, total_subscriptions, visible, created_at, updated_at)
      VALUES (?, ?, ?, 1, ?, ?)
    `).run(id, parsed.data.name, parsed.data.totalSubscriptions, now, now);
  }

  createAuditLog({
    action: "subscription.cardType.upsert",
    actor: request.admin.username,
    resourceType: "subscription_card_type",
    resourceId: id,
    detail: parsed.data
  });

  return { id };
});

app.patch("/api/admin/subscriptions/card-types/:id/visibility", { preHandler: requireAdmin }, async (request, reply) => {
  const ct = db.prepare("SELECT * FROM subscription_card_types WHERE id = ?").get(request.params.id);
  if (!ct) {
    return reply.code(404).send({ message: "卡种不存在" });
  }

  const newVisible = ct.visible ? 0 : 1;
  const now = nowIso();
  db.prepare("UPDATE subscription_card_types SET visible = ?, updated_at = ? WHERE id = ?").run(newVisible, now, ct.id);

  createAuditLog({
    action: "subscription.cardType.toggleVisibility",
    actor: request.admin.username,
    resourceType: "subscription_card_type",
    resourceId: ct.id,
    detail: { from: ct.visible, to: newVisible }
  });

  return { id: ct.id, visible: newVisible };
});

app.get("/api/admin/subscriptions/requests", { preHandler: requireAdmin }, async () => {
  const items = db.prepare(`
    SELECT r.*, ct.name AS card_type_name
    FROM subscription_requests r
    LEFT JOIN subscription_card_types ct ON ct.id = r.card_type_id
    ORDER BY r.created_at DESC
    LIMIT 200
  `).all();
  return { items };
});

app.post("/api/admin/subscriptions/requests/:id/review", { preHandler: requireAdmin }, async (request, reply) => {
  const schema = z.object({
    action: z.enum(["approve", "reject"])
  });
  const parsed = schema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ message: "操作参数不正确" });
  }

  const req = db.prepare("SELECT * FROM subscription_requests WHERE id = ?").get(request.params.id);
  if (!req) {
    return reply.code(404).send({ message: "申请不存在" });
  }
  if (req.status !== "pending") {
    return reply.code(400).send({ message: "该申请已被处理" });
  }

  const now = nowIso();
  const newStatus = parsed.data.action === "approve" ? "approved" : "rejected";

  db.prepare(`
    UPDATE subscription_requests SET status = ?, reviewed_at = ?, reviewed_by = ? WHERE id = ?
  `).run(newStatus, now, request.admin.username, req.id);

  createAuditLog({
    action: `subscription.request.${parsed.data.action}`,
    actor: request.admin.username,
    resourceType: "subscription_request",
    resourceId: req.id,
    detail: { identifier: req.identifier, cardTypeId: req.card_type_id, dropType: req.drop_type }
  });

  return { id: req.id, status: newStatus };
});

app.setErrorHandler((error, _request, reply) => {
  reply.code(500).send({
    message: error.message || "服务器异常"
  });
});

app.listen({
  port: env.port,
  host: "127.0.0.1",
  listenTextResolver: () => `KaWang API listening on http://127.0.0.1:${env.port}`
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
