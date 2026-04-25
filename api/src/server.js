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
import { cdkeyStatuses, endpointTypes, jobStatuses, logActions, orderStatuses } from "../../shared/src/constants.js";
import { decryptText, encryptText } from "../../shared/src/secure.js";
import { evaluateRule, renderJsonTemplate, safeParseJson } from "../../shared/src/templates.js";

const app = Fastify({ logger: false });
const db = getDb();
const execFileAsync = promisify(execFile);
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
  origin: [env.appUrl, env.adminUrl, "http://127.0.0.1:4173", "http://127.0.0.1:4174"],
  credentials: true
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
        hasUpdate: false
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
    hasUpdate: Boolean(remoteCommit && remoteCommit !== localCommit)
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

function getOrderDetail(orderNo) {
  const order = db.prepare(`
    SELECT
      o.*,
      p.title AS product_title,
      s.name AS site_name,
      s.slug AS site_slug,
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

  return {
    orderNo: order.order_no,
    publicKey: order.public_key,
    productTitle: order.site_name || order.product_title,
    siteName: order.site_name || order.product_title,
    siteSlug: order.site_slug || null,
    status: order.status,
    errorMessage: order.error_message,
    sessionPreview: getJsonBodyOrNull(order.session_preview),
    createdAt: order.created_at,
    updatedAt: order.updated_at,
    job: {
      status: order.job_status,
      lastError: order.job_error,
      lastResponse: getJsonBodyOrNull(order.job_response),
      attemptCount: order.job_attempt_count
    }
  };
}

function normalizeOrderNos(input) {
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
          headers_template = ?, body_template = ?, auth_type = ?, auth_config = ?,
          success_rule = ?, failure_rule = ?, polling_enabled = ?, timeout_seconds = ?,
          max_retries = ?, status = ?, updated_at = ?
      WHERE id = ?
    `).run(...endpointValues, endpointId);
  } else {
    db.prepare(`
      INSERT INTO activation_endpoints (
        id, name, endpoint_type, submit_url, query_url, http_method, headers_template, body_template,
        auth_type, auth_config, success_rule, failure_rule, polling_enabled, timeout_seconds,
        max_retries, status, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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

  const renderedHeaders = renderJsonTemplate(config.headersTemplate || "{}", context);
  const renderedBody = renderJsonTemplate(config.bodyTemplate || "{}", context);
  const headers = typeof renderedHeaders === "string"
    ? safeParseJson(renderedHeaders, {})
    : renderedHeaders;
  const body = typeof renderedBody === "string"
    ? safeParseJson(renderedBody, renderedBody)
    : renderedBody;
  const bodyString = config.method === "GET" ? "" : JSON.stringify(body);
  applyAuthHeaders(headers, config, bodyString);

  let response;
  let responseText = "";
  let responseJson = null;

  try {
    response = await fetch(config.url, {
      method: config.method || "POST",
      headers: {
        "Content-Type": "application/json",
        ...headers
      },
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
      s.timeout_seconds
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
      timeoutSeconds: key.timeout_seconds
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
    canRedeem,
    remoteResult: remoteResult ? {
      ok: remoteResult.ok,
      status: remoteResult.status,
      text: remoteResult.text
    } : null
  };
});

app.post("/api/public/redeem", async (request, reply) => {
  const schema = z.object({
    publicKey: z.string().min(6),
    sessionPayload: z.string().min(2)
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

      const now = nowIso();
      const orderId = nanoid(18);
      const jobId = nanoid(18);
      const orderNo = `KW${Date.now()}${Math.floor(Math.random() * 900 + 100)}`;

      db.prepare(`
        INSERT INTO redeem_orders (
          id, order_no, cdkey_id, public_key, product_id, activation_endpoint_id, site_id,
          session_payload, session_preview, customer_ip, status, latest_job_id,
          error_message, completed_at, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)
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
        detail: { publicKey, orderNo }
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

  const normalized = normalizeOrderNos(request.body?.orderNos);
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

app.post("/api/admin/sites", { preHandler: requireAdmin }, async (request, reply) => {
  const schema = z.object({
    id: z.string().optional(),
    name: z.string().min(2),
    slug: z.string().min(2),
    verifyApiUrl: z.string().url().optional().or(z.literal("")).default(""),
    submitApiUrl: z.string().url().optional().or(z.literal("")).default(""),
    verifyHttpMethod: z.enum(["GET", "POST", "PUT"]).default("POST"),
    submitHttpMethod: z.enum(["GET", "POST", "PUT"]).default("POST"),
    verifyHeadersTemplate: z.string().optional().default("{}"),
    verifyBodyTemplate: z.string().optional().default('{"card":"{{sourceKey}}"}'),
    submitHeadersTemplate: z.string().optional().default("{}"),
    submitBodyTemplate: z.string().optional().default('{"card":"{{sourceKey}}","session":{{sessionRaw}}}'),
    authType: z.string().optional().default(""),
    authConfig: z.string().optional().default(""),
    verifySuccessRule: z.string().optional().default('{"kind":"json_path_equals","path":"success","value":"true"}'),
    verifyFailureRule: z.string().optional().default(""),
    submitSuccessRule: z.string().optional().default('{"kind":"json_path_equals","path":"success","value":"true"}'),
    submitFailureRule: z.string().optional().default(""),
    timeoutSeconds: z.number().int().min(5).max(120).default(15),
    maxRetries: z.number().int().min(1).max(10).default(3),
    status: z.enum(["active", "disabled"]).default("active")
  });

  const parsed = schema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({
      message: "网站参数不正确",
      detail: parsed.error.flatten()
    });
  }

  const now = nowIso();
  const normalizedSlug = parsed.data.slug.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-");
  const existingBySlug = db.prepare("SELECT * FROM sites WHERE slug = ?").get(normalizedSlug);
  const id = parsed.data.id || existingBySlug?.id || nanoid(16);
  const resources = ensureSiteLegacyResources(id, {
    ...parsed.data,
    slug: normalizedSlug
  });
  const exists = existingBySlug || getSiteById(id);

  const values = [
    parsed.data.name,
    normalizedSlug,
    parsed.data.verifyApiUrl || null,
    parsed.data.submitApiUrl || null,
    parsed.data.verifyHttpMethod,
    parsed.data.submitHttpMethod,
    parsed.data.verifyHeadersTemplate || "{}",
    parsed.data.verifyBodyTemplate || '{"card":"{{sourceKey}}"}',
    parsed.data.submitHeadersTemplate || "{}",
    parsed.data.submitBodyTemplate || '{"card":"{{sourceKey}}","session":{{sessionRaw}}}',
    parsed.data.authType || null,
    parsed.data.authConfig || null,
    parsed.data.verifySuccessRule || null,
    parsed.data.verifyFailureRule || null,
    parsed.data.submitSuccessRule || null,
    parsed.data.submitFailureRule || null,
    parsed.data.timeoutSeconds,
    parsed.data.maxRetries,
    resources.productId,
    resources.endpointId,
    parsed.data.status,
    now
  ];

  if (exists) {
    db.prepare(`
      UPDATE sites
      SET name = ?, slug = ?, verify_api_url = ?, submit_api_url = ?,
          verify_http_method = ?, submit_http_method = ?,
          verify_headers_template = ?, verify_body_template = ?,
          submit_headers_template = ?, submit_body_template = ?,
          auth_type = ?, auth_config = ?,
          verify_success_rule = ?, verify_failure_rule = ?,
          submit_success_rule = ?, submit_failure_rule = ?,
          timeout_seconds = ?, max_retries = ?, product_id = ?, activation_endpoint_id = ?,
          status = ?, updated_at = ?
      WHERE id = ?
    `).run(...values, id);
  } else {
    db.prepare(`
      INSERT INTO sites (
        id, name, slug, verify_api_url, submit_api_url,
        verify_http_method, submit_http_method,
        verify_headers_template, verify_body_template,
        submit_headers_template, submit_body_template,
        auth_type, auth_config,
        verify_success_rule, verify_failure_rule,
        submit_success_rule, submit_failure_rule,
        timeout_seconds, max_retries, product_id, activation_endpoint_id,
        status, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, ...values.slice(0, -1), now, now);
  }

  createAuditLog({
    action: logActions.siteUpsert,
    actor: request.admin.username,
    resourceType: "site",
    resourceId: id,
    detail: {
      ...parsed.data,
      slug: normalizedSlug
    }
  });

  return { id };
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
          headers_template = ?, body_template = ?, auth_type = ?, auth_config = ?,
          success_rule = ?, failure_rule = ?, polling_enabled = ?, timeout_seconds = ?,
          max_retries = ?, status = ?, updated_at = ?
      WHERE id = ?
    `).run(...values, id);
  } else {
    db.prepare(`
      INSERT INTO activation_endpoints (
        id, name, endpoint_type, submit_url, query_url, http_method, headers_template, body_template,
        auth_type, auth_config, success_rule, failure_rule, polling_enabled, timeout_seconds,
        max_retries, status, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      c.id, c.public_key, c.prefix, c.status, c.used_at, c.locked_at,
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

  const items = db.prepare(sql).all(...params);
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
