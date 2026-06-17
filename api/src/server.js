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
import { cdkeyStatuses, endpointTypes, jobStatuses, logActions, notificationEventTypes, notificationMatchModes, notificationMonitorTypes, notificationRuleOperators, orderStatuses, quotaCardStatuses, quotaBatchStatuses, quotaErrorCodes, quotaSubCardStatuses, smsCardStatuses, smsOrderStatuses, smsSiteStatuses, QUOTA_RATE_LIMIT_WINDOW, QUOTA_RATE_LIMIT_MAX, QUOTA_LOCK_DURATION_MINUTES } from "../../shared/src/constants.js";
import { normalizeSourceKey } from "../../shared/src/cdkey-utils.js";
import { decryptText, encryptText } from "../../shared/src/secure.js";
import { encodeRequestBody, evaluateRule, renderJsonTemplate, renderTemplateString, safeParseJson } from "../../shared/src/templates.js";
import { parseSmsImportContent } from "../../shared/src/sms-parser.js";
import { extractSmsVerificationCode } from "../../shared/src/sms-code.js";
import { purchasePremiumNumber, getPremiumSmsRecords } from "../../shared/src/nexsms-client.js";
import { verifyExternalCard, fetchClaimWarning, claimFromExternal } from "../../shared/src/quota-api.js";
import { getTotalQuota, getAllocatedQuota, getAvailableQuota, getUniqueSubCardCode, generateExportText } from "../../shared/src/quota-calc.js";
import { getBalance } from "../../shared/src/fivesim-client.js";
import { isSmsCardStopped } from "../../shared/src/sms-status.js";
import {
  DEFAULT_API_FOOTBALL_SETTINGS,
  getApiFootballQuotaSnapshot,
  getApiFootballSettings,
  getApiFootballUsageDate
} from "../../shared/src/api-football.js";
import {
  SUB2API_INVITE_LIMIT,
  assertSub2ApiRemoteEnvelopeOk,
  countReservedSub2ApiInvites,
  decodeSub2ApiSsoSelector,
  extractSub2ApiIdentity,
  extractSub2ApiIdentityFromJwtClaims,
  extractRemoteSub2ApiInviteResult,
  getSub2ApiWorldCupBetPhaseLabel,
  getSub2ApiWorldCupBettingState,
  getSub2ApiWorldCupResult,
  getSub2ApiInviteQuota,
  isSub2ApiWorldCupMatchInProgress,
  normalizeSub2ApiBaseUrl,
  normalizeSub2ApiAmount,
  normalizeSub2ApiPositiveInteger,
  reserveSub2ApiInvite,
  roundSub2ApiWorldCupAmount,
  selectSub2ApiWorldCupDisplayMatches,
  sub2apiConnectionStatuses,
  sub2apiInviteStatuses,
  sub2apiSubscriptionOrderStatuses,
  sub2apiSubscriptionPlanStatuses,
  sub2apiWorldCupBetPhases,
  sub2apiWorldCupBetStatuses,
  sub2apiWorldCupMatchStatuses,
  sub2apiWorldCupPredictions,
  unwrapSub2ApiRemoteData,
  verifySub2ApiSsoToken
} from "../../shared/src/sub2api.js";
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
const SMS_ORDER_TIMEOUT_MS = 60 * 1000;
const QUOTA_AUTO_CLAIM_MAX_ACTIVE = 3;
const QUOTA_AUTO_CLAIM_SESSION_TTL_MS = 45_000;
const QUOTA_AUTO_CLAIM_CLEANUP_INTERVAL_MS = 10_000;
const SUB2API_IMAGE_SESSION_TTL_MS = 30 * 60 * 1000;
const SUB2API_IMAGE_KEYS_TTL_MS = 2 * 60 * 1000;
const SUB2API_IMAGE_GENERATE_TIMEOUT_MS = 180 * 1000;
const SUB2API_IMAGE_JOB_TTL_MS = 30 * 60 * 1000;
const SUB2API_IMAGE_RESPONSES_MODEL = "gpt-5.5";
const SUB2API_IMAGE_MAX_COUNT = 5;
const SUB2API_IMAGE_MAX_REFERENCE_IMAGES = 4;
const SUB2API_IMAGE_MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const SUB2API_IMAGE_BODY_LIMIT = 96 * 1024 * 1024;
const SUB2API_IMAGE_MODELS = Object.freeze(["gpt-image-2", "gpt-image-1.5", "gpt-image-1", "dall-e-3"]);
const SUB2API_IMAGE_QUALITIES = Object.freeze(["auto", "low", "medium", "high"]);
const SUB2API_IMAGE_FORMATS = Object.freeze(["png", "webp", "jpeg"]);
const SUB2API_IMAGE_ASPECT_RATIOS = Object.freeze(["auto", "1:1", "16:9", "4:3", "3:4", "9:16"]);
const SUB2API_WORLDCUP_DEFAULT_MIN_STAKE = 0.1;
const SUB2API_WORLDCUP_DEFAULT_MAX_STAKE = 2;
const SUB2API_WORLDCUP_MAX_ADMIN_STAKE = 100;
const SUB2API_WORLDCUP_DEFAULT_ODDS = Object.freeze({
  home: 1.8,
  draw: 3.2,
  away: 1.8
});

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

const quotaAutoClaimSessions = new Map();
const quotaAutoClaimQueue = [];
const sub2apiImageSessions = new Map();
const sub2apiImageJobs = new Map();

function cleanupQuotaAutoClaimSessions() {
  const now = Date.now();
  let changed = false;
  for (const [id, session] of quotaAutoClaimSessions.entries()) {
    if (session.status === "active" && now - session.lastSeenAt > QUOTA_AUTO_CLAIM_SESSION_TTL_MS) {
      quotaAutoClaimSessions.delete(id);
      changed = true;
    }
  }
  for (let i = quotaAutoClaimQueue.length - 1; i >= 0; i -= 1) {
    const session = quotaAutoClaimSessions.get(quotaAutoClaimQueue[i]);
    if (!session || session.status !== "queued" || now - session.lastSeenAt > QUOTA_AUTO_CLAIM_SESSION_TTL_MS) {
      if (session) quotaAutoClaimSessions.delete(session.id);
      quotaAutoClaimQueue.splice(i, 1);
      changed = true;
    }
  }
  if (changed) {
    promoteQuotaAutoClaimQueue();
  }
}

function getActiveQuotaAutoClaimCount() {
  let count = 0;
  for (const session of quotaAutoClaimSessions.values()) {
    if (session.status === "active") count += 1;
  }
  return count;
}

function getQuotaAutoClaimPosition(sessionId) {
  const index = quotaAutoClaimQueue.indexOf(sessionId);
  return index >= 0 ? index + 1 : null;
}

function serializeQuotaAutoClaimSession(session) {
  return {
    sessionId: session.id,
    status: session.status,
    position: session.status === "queued" ? getQuotaAutoClaimPosition(session.id) : null,
    active: getActiveQuotaAutoClaimCount(),
    maxActive: QUOTA_AUTO_CLAIM_MAX_ACTIVE
  };
}

function promoteQuotaAutoClaimQueue() {
  while (getActiveQuotaAutoClaimCount() < QUOTA_AUTO_CLAIM_MAX_ACTIVE && quotaAutoClaimQueue.length > 0) {
    const sessionId = quotaAutoClaimQueue.shift();
    const session = quotaAutoClaimSessions.get(sessionId);
    if (session && session.status === "queued") {
      session.status = "active";
      session.lastSeenAt = Date.now();
      session.startedAt = nowIso();
    }
  }
}

function touchQuotaAutoClaimSession(session) {
  session.lastSeenAt = Date.now();
  session.updatedAt = nowIso();
}

// --- Verification Cache ---
const verificationCache = new Map();
const CACHE_TTL_MS = 300000; // 5 分钟
const CACHE_CLEANUP_INTERVAL_MS = 60000; // 60 秒

function setCacheEntry(publicKey, verificationCode, smsEntryId) {
  const normalizedCode = extractSmsVerificationCode(verificationCode);
  if (!normalizedCode) return false;

  verificationCache.set(publicKey, {
    verificationCode: normalizedCode,
    fetchedAt: new Date().toISOString(),
    smsEntryId,
    status: "ready"
  });
  return true;
}

function setTimeoutEntry(publicKey) {
  verificationCache.set(publicKey, {
    verificationCode: null,
    fetchedAt: new Date().toISOString(),
    smsEntryId: null,
    status: "timeout"
  });
}

function getCacheEntry(publicKey) {
  const entry = verificationCache.get(publicKey);
  if (!entry) return null;

  // TTL 检查
  const age = Date.now() - new Date(entry.fetchedAt).getTime();
  if (age > CACHE_TTL_MS) {
    verificationCache.delete(publicKey);
    return null;
  }
  return entry;
}

function cleanupExpiredEntries() {
  const now = Date.now();
  for (const [key, entry] of verificationCache) {
    const age = now - new Date(entry.fetchedAt).getTime();
    if (age > CACHE_TTL_MS) {
      verificationCache.delete(key);
    }
  }
}

setInterval(cleanupExpiredEntries, CACHE_CLEANUP_INTERVAL_MS);
setInterval(cleanupQuotaAutoClaimSessions, QUOTA_AUTO_CLAIM_CLEANUP_INTERVAL_MS);
setInterval(cleanupSub2ApiImageSessions, 60_000);
setInterval(cleanupSub2ApiImageJobs, 60_000);
// --- End Verification Cache ---

async function fetchStaticSmsCode(smsUrl) {
  if (!smsUrl) return "";

  const response = await fetch(smsUrl, {
    headers: { "User-Agent": BROWSER_UA },
    signal: AbortSignal.timeout(5000)
  });

  if (!response.ok) return "";
  const text = (await response.text()).trim();
  return extractSmsVerificationCode(text) || "";
}

await app.register(cors, {
  origin: true,
  credentials: true,
  methods: ["GET", "HEAD", "PUT", "POST", "DELETE", "PATCH", "OPTIONS"]
});

function nowIso() {
  return new Date().toISOString();
}

function getSmsOrderExpiresAt(providerEndTime = null, timeoutMs = SMS_ORDER_TIMEOUT_MS) {
  const cappedTimeoutMs = Math.min(Number(timeoutMs) || SMS_ORDER_TIMEOUT_MS, SMS_ORDER_TIMEOUT_MS);
  const fallbackTime = Date.now() + cappedTimeoutMs;
  const providerTime = providerEndTime ? new Date(providerEndTime).getTime() : NaN;
  return new Date(Number.isFinite(providerTime) ? Math.min(providerTime, fallbackTime) : fallbackTime).toISOString();
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

async function requireInternalSecret(request, reply) {
  const secret = request.headers["x-internal-secret"];
  if (secret !== env.internalSecret) {
    return reply.code(401).send({ message: "unauthorized" });
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

function is987AiSite(siteSlug) {
  return String(siteSlug || "").trim().toLowerCase() === "987ai";
}

function getJsonMessage(json) {
  return json?.error_msg || json?.error || json?.message || json?.msg || json?.data?.status_label || "";
}

function shouldAllow987AiUsedGptReuse(remoteJson) {
  if (!remoteJson || typeof remoteJson !== "object") return false;
  const productType = String(remoteJson.product_api_type || "gpt").trim().toLowerCase() || "gpt";
  const message = String(getJsonMessage(remoteJson));
  return remoteJson.available === false
    && productType === "gpt"
    && typeof remoteJson.used_email === "string"
    && remoteJson.used_email.trim()
    && message.includes("已被使用");
}

function interpretVerifyResult(siteSlug, remoteResult, defaultCanRedeem) {
  if (!is987AiSite(siteSlug)) {
    return {
      canRedeem: defaultCanRedeem,
      message: getJsonMessage(remoteResult?.json)
    };
  }

  if (shouldAllow987AiUsedGptReuse(remoteResult?.json)) {
    return {
      canRedeem: true,
      message: "卡密已使用，可复用原账号继续充值"
    };
  }

  return {
    canRedeem: defaultCanRedeem,
    message: getJsonMessage(remoteResult?.json)
  };
}

const MEIMEI_SITE_SLUG = "meimei_site";
const MEIMEI_SITE_QUEUE_STATUS_URL = "https://ai.dengta-learning.online/api/cdk/queue-status";
const SUPPORT_API_BASE_URL = "https://ai.dengta-learning.online/support/api/support";

async function fetchQueueStatusForSite(site) {
  const slug = String(site?.slug || "").trim().toLowerCase();
  if (slug !== MEIMEI_SITE_SLUG) {
    return null;
  }

  try {
    const response = await fetch(MEIMEI_SITE_QUEUE_STATUS_URL, {
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
    return "老妹plus 队列状态获取失败，请稍后重试";
  }

  const queue = queueStatus.json;
  if (queue.maintenance) {
    return "老妹plus 当前维护中，暂时无法提交兑换";
  }
  if (queue.full || Number(queue.available ?? 0) <= 0) {
    return `老妹plus 当前队列已满（可用 ${Number(queue.available ?? 0)}/${Number(queue.max ?? 0)}），请稍后再试`;
  }
  if (Number(queue.gopay_deny_cooldown_remaining ?? 0) > 0) {
    return `老妹plus 当前受限，请 ${queue.gopay_deny_cooldown_remaining} 秒后再试`;
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

function generateSmsPublicKey(prefix) {
  const normalized = String(prefix || "").trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "");
  return `${normalized}-${nanoid(10).toUpperCase()}`;
}

function getUniqueSmsPublicKey(prefix) {
  let candidate = generateSmsPublicKey(prefix);
  while (db.prepare("SELECT 1 FROM sms_entries WHERE public_key = ?").get(candidate)) {
    candidate = generateSmsPublicKey(prefix);
  }
  return candidate;
}

function generateSmsCardKey(prefix) {
  const normalized = String(prefix || "").trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "");
  return `${normalized}-${nanoid(10).toUpperCase()}`;
}

function getUniqueSmsCardKey(prefix) {
  let candidate = generateSmsCardKey(prefix);
  while (db.prepare("SELECT 1 FROM sms_cards WHERE card_key = ?").get(candidate)) {
    candidate = generateSmsCardKey(prefix);
  }
  return candidate;
}

function generateSmsOrderNo() {
  return `SMS-${nanoid(12).toUpperCase()}`;
}

function getLatestSmsOrderByCardId(cardId) {
  return db.prepare(`
    SELECT o.*, s.name AS site_name, s.slug AS site_slug
    FROM sms_orders o
    LEFT JOIN sms_sites s ON s.id = o.site_id
    WHERE o.card_id = ?
    ORDER BY o.created_at DESC
    LIMIT 1
  `).get(cardId);
}

function getSmsCardDetail(cardKey) {
  return db.prepare(`
    SELECT c.*, s.name AS site_name, s.slug AS site_slug, s.status AS site_status,
           s.inventory_source, s.sms_provider, s.sms_api_key, s.sms_app_id, s.sms_card_type,
           s.sms_expiry, s.sms_prefix_filter, s.sms_exclude_prefix, s.sms_poll_timeout_ms
    FROM sms_cards c
    LEFT JOIN sms_sites s ON s.id = c.site_id
    WHERE c.card_key = ?
  `).get(cardKey);
}

function createSmsOrderEvent(orderId, eventType, detail = null) {
  db.prepare(`
    INSERT INTO sms_order_events (id, order_id, event_type, detail, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(nanoid(16), orderId, eventType, detail ? JSON.stringify(detail) : null, nowIso());
}

function releaseSmsCard(cardId, status = smsCardStatuses.active) {
  db.prepare(`
    UPDATE sms_cards
    SET status = ?, current_order_id = NULL, updated_at = ?
    WHERE id = ?
  `).run(status, nowIso(), cardId);
}

function reserveSmsEntryForOrder() {
  return db.prepare(`
    SELECT id, phone, sms_url
    FROM sms_entries
    WHERE status = 'active'
    ORDER BY created_at ASC
    LIMIT 1
  `).get();
}

function readSmsOrderVerification(order) {
  const storedCode = extractSmsVerificationCode(order?.verification_code);
  if (!order?.sms_entry_id) {
    return {
      verificationStatus: order?.status === smsOrderStatuses.timeout ? "timeout" : (storedCode ? "ready" : "pending"),
      verificationCode: storedCode
    };
  }

  const cacheEntry = getCacheEntry(order.sms_entry_id);
  if (!cacheEntry) {
    return {
      verificationStatus: order?.status === smsOrderStatuses.timeout ? "timeout" : (storedCode ? "ready" : "pending"),
      verificationCode: storedCode
    };
  }

  if (cacheEntry.status === "ready") {
    const cachedCode = extractSmsVerificationCode(cacheEntry.verificationCode);
    if (!cachedCode) {
      return {
        verificationStatus: storedCode ? "ready" : "pending",
        verificationCode: storedCode
      };
    }
    return {
      verificationStatus: "ready",
      verificationCode: cachedCode
    };
  }

  if (cacheEntry.status === "timeout") {
    return {
      verificationStatus: "timeout",
      verificationCode: null
    };
  }

  return {
    verificationStatus: "pending",
    verificationCode: null
  };
}

async function syncNexSmsOrder(order) {
  if (!order || extractSmsVerificationCode(order.verification_code) || !order.provider_payload) return null;
  const payload = safeParseJson(order.provider_payload, {});
  if (payload.provider !== "nexsms" || !payload.apiKeyEncrypted || !order.phone) return null;

  let apiKey;
  try {
    apiKey = decryptText(payload.apiKeyEncrypted);
  } catch {
    return null;
  }

  const records = await getPremiumSmsRecords(apiKey, order.phone);
  const record = records.find((item) => item.code || item.sms);
  const code = extractSmsVerificationCode(record?.code || record?.sms) || "";
  if (!code) return null;

  db.prepare(`
    UPDATE sms_orders
    SET status = ?, verification_code = ?, updated_at = ?
    WHERE id = ?
  `).run(smsOrderStatuses.ready, code, nowIso(), order.id);
  releaseSmsCard(order.card_id, smsCardStatuses.used);
  createSmsOrderEvent(order.id, "verification_ready", { verificationCode: code, provider: "nexsms" });
  order.status = smsOrderStatuses.ready;
  order.verification_code = code;
  return code;
}

function mapSmsOrderForPublic(order) {
  const verification = readSmsOrderVerification(order);
  return {
    orderNo: order.order_no,
    siteName: order.site_name || null,
    siteSlug: order.site_slug || null,
    phone: order.phone || "",
    status: verification.verificationStatus === "ready" ? smsOrderStatuses.ready : order.status,
    verificationStatus: verification.verificationStatus,
    verificationCode: verification.verificationCode,
    errorMessage: order.error_message || null,
    createdAt: order.created_at,
    updatedAt: order.updated_at
  };
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
  const bodyString = config.method === "GET" ? "" : encodeRequestBody(body, headers);
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
  return values
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)
    .join("; ");
}

function getSupportApiMessage(responseInfo = {}) {
  const json = responseInfo.json;
  if (json && typeof json === "object") {
    const message = json.error
      || json.error_msg
      || json.message
      || json.msg
      || json.result
      || json.detail
      || json.data?.error
      || json.data?.error_msg
      || json.data?.message
      || json.data?.msg;
    if (message) return String(message);
  }
  return String(responseInfo.text || "请求失败");
}

function buildSupportAuthCandidates({ token = "", sessionId = "", supportCookie = "" } = {}) {
  const candidates = [];

  if (supportCookie) {
    candidates.push({ label: "cookie", cookie: supportCookie });
  }

  if (sessionId) {
    candidates.push({ label: "support_session_cookie", cookie: `support_session=${sessionId}` });
    candidates.push({ label: "session_cookie", cookie: `session_id=${sessionId}` });
    candidates.push({ label: "session_header", sessionIdHeader: sessionId });
    candidates.push({ label: "session_query", queryParams: { session_id: sessionId } });
    candidates.push({ label: "session_bearer", bearerToken: sessionId });
  }

  if (token) {
    candidates.push({ label: "token_bearer", bearerToken: token });
  }

  return Array.from(new Map(
    candidates.map((candidate) => [JSON.stringify(candidate), candidate])
  ).values());
}

async function callSupportApi(pathname, {
  method = "GET",
  body = null,
  authCandidates = [],
  minimalHeaders = false
} = {}) {
  const attempts = authCandidates.length ? authCandidates : [{}];
  let lastResponse = null;

  for (const auth of attempts) {
    const url = new URL(`${SUPPORT_API_BASE_URL}${pathname}`);
    for (const [key, value] of Object.entries(auth.queryParams || {})) {
      if (value != null && String(value).trim()) {
        url.searchParams.set(key, String(value).trim());
      }
    }

    const headers = minimalHeaders
      ? {}
      : {
          "User-Agent": BROWSER_UA,
          Accept: "application/json, text/plain, */*"
        };
    const shouldSendJsonBody = method !== "GET" && body !== null && body !== undefined;

    if (shouldSendJsonBody) {
      headers["Content-Type"] = "application/json";
    }
    if (auth.bearerToken) {
      headers.Authorization = `Bearer ${auth.bearerToken}`;
    }
    if (auth.sessionIdHeader) {
      headers["X-Session-Id"] = auth.sessionIdHeader;
    }
    if (auth.cookie) {
      headers.Cookie = mergeCookieHeaders(auth.cookie);
    }

    try {
      const response = await fetch(url, {
        method,
        headers,
        body: shouldSendJsonBody ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(15000)
      });
      const text = await response.text();
      const json = safeParseJson(text, null);
      const supportCookie = compactCookieHeader(getResponseSetCookies(response.headers));
      const result = {
        ok: response.ok,
        status: response.status,
        text,
        json,
        supportCookie,
        authMode: auth.label || "none"
      };

      lastResponse = result;
      if (response.status !== 401 && response.status !== 403) {
        return result;
      }
    } catch (error) {
      return {
        ok: false,
        status: 599,
        text: error.message,
        json: null,
        supportCookie: "",
        authMode: auth.label || "none"
      };
    }
  }

  return lastResponse || {
    ok: false,
    status: 400,
    text: "请求失败",
    json: null,
    supportCookie: "",
    authMode: "none"
  };
}

function getSupportRequestContext(request) {
  const query = request.query || {};
  return {
    token: String(query.token || request.headers["x-support-token"] || "").trim(),
    sessionId: String(query.sessionId || query.session_id || request.headers["x-support-session-id"] || "").trim(),
    supportCookie: String(query.supportCookie || request.headers["x-support-cookie"] || "").trim()
  };
}

function parseCdkeyMetadata(value) {
  const parsed = safeParseJson(value, null);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
}

function buildCdkeyMetadata(existingValue, { note, emailToken, supportOnly } = {}) {
  const metadata = parseCdkeyMetadata(existingValue);

  if (note !== undefined) {
    const normalizedNote = String(note ?? "").trim();
    if (normalizedNote) {
      metadata.note = normalizedNote;
    } else {
      delete metadata.note;
    }
  }

  if (emailToken !== undefined) {
    const normalizedToken = String(emailToken ?? "").trim();
    if (normalizedToken) {
      metadata.emailToken = normalizedToken;
    } else {
      delete metadata.emailToken;
      delete metadata.email_token;
    }
  }

  if (supportOnly !== undefined) {
    if (supportOnly) {
      metadata.supportOnly = true;
    } else {
      delete metadata.supportOnly;
    }
  }

  return Object.keys(metadata).length ? JSON.stringify(metadata) : null;
}

function getCdkeyEmailToken(metadataValue) {
  const metadata = parseCdkeyMetadata(metadataValue);
  const token = metadata.emailToken ?? metadata.email_token ?? "";
  return typeof token === "string" ? token.trim() : "";
}

function getCdkeyNote(metadataValue) {
  const metadata = parseCdkeyMetadata(metadataValue);
  const note = metadata.note ?? "";
  return typeof note === "string" ? note.trim() : "";
}

function isSupportOnlyCdkey(metadataValue) {
  const metadata = parseCdkeyMetadata(metadataValue);
  return metadata.supportOnly === true;
}

function buildSupportAccountPayload(raw = {}, supportCookie = null, authMode = null) {
  return {
    email: raw.email ?? null,
    currentEmail: raw.current_email ?? null,
    planType: raw.plan_type ?? null,
    warranty: raw.warranty ?? null,
    replacements: raw.replacements ?? null,
    supportCookie: supportCookie || null,
    authMode: authMode || null,
    raw
  };
}

function buildSupportOtpPayload(raw = {}, supportCookie = null, authMode = null) {
  return {
    otps: Array.isArray(raw.otps) ? raw.otps : [],
    supportCookie: supportCookie || null,
    authMode: authMode || null,
    raw
  };
}

async function verifyCdkeyForPublic(publicKey) {
  const key = db.prepare(`
    SELECT
      c.public_key,
      c.source_key,
      c.status,
      c.prefix,
      c.site_id,
      c.metadata,
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
    return null;
  }

  const supportOnly = isSupportOnlyCdkey(key.metadata);
  const sourceKey = supportOnly ? "" : decryptText(key.source_key);
  const verifyContext = {
    publicKey: key.public_key,
    sourceKey,
    normalizedSourceKey: normalizeSourceKey(sourceKey),
    siteName: key.site_name,
    siteSlug: key.site_slug
  };

  let remoteResult = null;
  let remoteMessage = "";
  let canRedeem = key.status === cdkeyStatuses.active && !supportOnly;
  const canSupportAccess = key.status === cdkeyStatuses.active
    && String(key.site_slug || "").trim().toLowerCase() === MEIMEI_SITE_SLUG;

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
    const interpreted = interpretVerifyResult(key.site_slug, remoteResult, !failureMatched && successMatched);
    canRedeem = interpreted.canRedeem;
    remoteMessage = interpreted.message;
  }

  const emailToken = getCdkeyEmailToken(key.metadata);

  return {
    key,
    emailToken,
    payload: {
      publicKey: key.public_key,
      status: key.status,
      productTitle: key.site_name || "未命名网站",
      productDescription: key.site_slug ? `站点标识：${key.site_slug}` : "未配置网站标识",
      endpointName: key.site_name || "未绑定网站",
      siteId: key.site_id,
      siteName: key.site_name || "未命名网站",
      siteSlug: key.site_slug || null,
      supportOnly,
      canRedeem,
      canSupportAccess,
      hasBoundEmailToken: Boolean(emailToken),
      remoteAvailable: typeof remoteResult?.json?.available === "boolean" ? remoteResult.json.available : null,
      remoteMessage,
      remoteError: remoteMessage,
      stockLevel: typeof remoteResult?.json?.stock_level === "string" ? remoteResult.json.stock_level : "",
      remoteResult: remoteResult ? {
        ok: remoteResult.ok,
        status: remoteResult.status,
        text: remoteResult.text,
        json: remoteResult.json
      } : null
    }
  };
}

async function loadSupportBundleByToken(emailToken) {
  const upstream = await callSupportApi("/auth", {
    method: "POST",
    body: {
      token: emailToken,
      type: "single"
    }
  });

  if (!upstream.ok) {
    return {
      ok: false,
      message: getSupportApiMessage(upstream),
      status: upstream.status,
      raw: upstream.json
    };
  }

  const sessionId = upstream.json?.session_id ?? null;
  const email = upstream.json?.email ?? null;
  let supportCookie = upstream.supportCookie || null;

  const accountUpstream = await callSupportApi("/account", {
    method: "GET",
    authCandidates: buildSupportAuthCandidates({ token: emailToken, sessionId, supportCookie })
  });
  if (accountUpstream.supportCookie) {
    supportCookie = mergeCookieHeaders(supportCookie, accountUpstream.supportCookie);
  }

  const otpUpstream = await callSupportApi("/otp", {
    method: "GET",
    authCandidates: buildSupportAuthCandidates({ token: emailToken, sessionId, supportCookie })
  });
  if (otpUpstream.supportCookie) {
    supportCookie = mergeCookieHeaders(supportCookie, otpUpstream.supportCookie);
  }

  return {
    ok: true,
    sessionId,
    email,
    supportCookie: supportCookie || null,
    account: accountUpstream.ok ? buildSupportAccountPayload(accountUpstream.json, accountUpstream.supportCookie, accountUpstream.authMode) : null,
    accountError: accountUpstream.ok ? null : getSupportApiMessage(accountUpstream),
    otps: otpUpstream.ok ? buildSupportOtpPayload(otpUpstream.json, otpUpstream.supportCookie, otpUpstream.authMode) : null,
    otpError: otpUpstream.ok ? null : getSupportApiMessage(otpUpstream),
    raw: upstream.json
  };
}

function serializeSub2ApiConnection(row) {
  return {
    id: row.id,
    name: row.name,
    baseUrl: row.base_url,
    hasAdminToken: Boolean(row.admin_token),
    status: row.status,
    lastTestAt: row.last_test_at || null,
    lastTestStatus: row.last_test_status || null,
    lastTestError: row.last_test_error || null,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function serializeSub2ApiInvite(row) {
  return {
    id: row.id,
    requestId: row.request_id,
    connectionId: row.connection_id,
    connectionName: row.connection_name || null,
    connectionBaseUrl: row.connection_base_url || null,
    userId: row.sub2api_user_id,
    email: row.email || "",
    username: row.username || "",
    inviteCode: row.invite_code || "",
    remoteInviteId: row.remote_invite_id || "",
    status: row.status,
    errorMessage: row.error_message || "",
    expiresAt: row.expires_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function serializeSub2ApiSubscriptionPlan(row) {
  return {
    id: row.id,
    connectionId: row.connection_id,
    connectionName: row.connection_name || null,
    connectionBaseUrl: row.connection_base_url || null,
    name: row.name,
    description: row.description || "",
    price: Number(row.price || 0),
    subscriptionGroupId: Number(row.subscription_group_id || 0),
    sourceDedicatedGroupId: row.source_dedicated_group_id === null || row.source_dedicated_group_id === undefined ? null : Number(row.source_dedicated_group_id),
    dedicatedGroupId: row.dedicated_group_id === null || row.dedicated_group_id === undefined ? null : Number(row.dedicated_group_id),
    validityDays: Number(row.validity_days || 0),
    sortOrder: Number(row.sort_order || 0),
    status: row.status,
    createdBy: row.created_by || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function serializeSub2ApiSubscriptionOrder(row) {
  return {
    id: row.id,
    requestId: row.request_id,
    planId: row.plan_id,
    planName: row.plan_name || null,
    connectionId: row.connection_id,
    connectionName: row.connection_name || null,
    userId: row.sub2api_user_id,
    email: row.email || "",
    username: row.username || "",
    price: Number(row.price || 0),
    subscriptionGroupId: Number(row.subscription_group_id || 0),
    sourceDedicatedGroupId: row.source_dedicated_group_id === null || row.source_dedicated_group_id === undefined ? null : Number(row.source_dedicated_group_id),
    dedicatedGroupId: row.dedicated_group_id === null || row.dedicated_group_id === undefined ? null : Number(row.dedicated_group_id),
    validityDays: Number(row.validity_days || 0),
    status: row.status,
    errorMessage: row.error_message || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function decryptSub2ApiAdminToken(connection) {
  try {
    return decryptText(connection.admin_token);
  } catch {
    throw new Error("Sub2api adminToken 解密失败");
  }
}

function findSub2ApiConnectionBySelector(selector) {
  const raw = String(selector || "").trim();
  if (!raw) return null;

  let row = db.prepare(`
    SELECT *
    FROM sub2api_connections
    WHERE id = ? AND status <> ?
  `).get(raw, sub2apiConnectionStatuses.deleted);
  if (row) return row;

  try {
    const baseUrl = normalizeSub2ApiBaseUrl(raw);
    row = db.prepare(`
      SELECT *
      FROM sub2api_connections
      WHERE base_url = ? AND status <> ?
      ORDER BY created_at DESC
      LIMIT 1
    `).get(baseUrl, sub2apiConnectionStatuses.deleted);
  } catch {
    row = null;
  }
  return row || null;
}

function getSub2ApiPublicInvites(connectionId, userId) {
  return db.prepare(`
    SELECT i.*, c.name AS connection_name, c.base_url AS connection_base_url
    FROM sub2api_invites i
    LEFT JOIN sub2api_connections c ON c.id = i.connection_id
    WHERE i.connection_id = ?
      AND i.sub2api_user_id = ?
      AND i.status <> ?
    ORDER BY i.created_at DESC
  `).all(connectionId, userId, sub2apiInviteStatuses.failed).map(serializeSub2ApiInvite);
}

function getSub2ApiPublicSubscriptionPlans(connectionId) {
  return db.prepare(`
    SELECT p.*, c.name AS connection_name, c.base_url AS connection_base_url
    FROM sub2api_subscription_plans p
    LEFT JOIN sub2api_connections c ON c.id = p.connection_id
    WHERE p.connection_id = ?
      AND p.status = ?
    ORDER BY p.sort_order ASC, p.price ASC, p.created_at ASC
  `).all(connectionId, sub2apiSubscriptionPlanStatuses.active).map(serializeSub2ApiSubscriptionPlan);
}

function getSub2ApiPublicSubscriptionOrders(connectionId, userId) {
  return db.prepare(`
    SELECT o.*, p.name AS plan_name, c.name AS connection_name
    FROM sub2api_subscription_orders o
    LEFT JOIN sub2api_subscription_plans p ON p.id = o.plan_id
    LEFT JOIN sub2api_connections c ON c.id = o.connection_id
    WHERE o.connection_id = ?
      AND o.sub2api_user_id = ?
    ORDER BY o.created_at DESC
    LIMIT 20
  `).all(connectionId, userId).map(serializeSub2ApiSubscriptionOrder);
}

function buildSub2ApiPublicPayload(connection, identity, sessionToken = null) {
  const quota = getSub2ApiInviteQuota(db, connection.id, identity.userId, SUB2API_INVITE_LIMIT);
  return {
    sessionToken,
    account: {
      userId: identity.userId,
      email: identity.email || "",
      username: identity.username || ""
    },
    connection: {
      id: connection.id,
      name: connection.name,
      baseUrl: connection.base_url
    },
    inviteLimit: quota.limit,
    used: quota.used,
    remaining: quota.remaining,
    invites: getSub2ApiPublicInvites(connection.id, identity.userId)
  };
}

function buildSub2ApiSubscriptionPublicPayload(connection, identity, sessionToken = null) {
  return {
    sessionToken,
    account: {
      userId: identity.userId,
      email: identity.email || "",
      username: identity.username || ""
    },
    connection: {
      id: connection.id,
      name: connection.name,
      baseUrl: connection.base_url
    },
    plans: getSub2ApiPublicSubscriptionPlans(connection.id),
    orders: getSub2ApiPublicSubscriptionOrders(connection.id, identity.userId)
  };
}

function signSub2ApiSessionToken(connection, identity) {
  return jwt.sign({
    scope: "sub2api_public",
    connectionId: connection.id,
    sub2apiUserId: identity.userId,
    email: identity.email || "",
    username: identity.username || ""
  }, env.jwtSecret, { expiresIn: "30m" });
}

async function requireSub2ApiSession(request, reply) {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return reply.code(401).send({ message: "缺少 Sub2api 会话 token" });
  }
  const token = header.slice("Bearer ".length).trim();
  try {
    const payload = jwt.verify(token, env.jwtSecret);
    if (!["sub2api_public", "sub2api_invites"].includes(payload?.scope) || !payload.connectionId || !payload.sub2apiUserId) {
      return reply.code(401).send({ message: "Sub2api 会话无效" });
    }
    request.sub2api = {
      connectionId: String(payload.connectionId),
      userId: String(payload.sub2apiUserId),
      email: String(payload.email || ""),
      username: String(payload.username || "")
    };
  } catch {
    return reply.code(401).send({ message: "Sub2api 会话已失效" });
  }
}

function getReadableErrorMessage(value, fallback = "") {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "string") return value.trim() || fallback;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Error) return value.message || fallback;
  if (Array.isArray(value)) {
    return value.map((item) => getReadableErrorMessage(item, "")).filter(Boolean).join("; ") || fallback;
  }
  if (typeof value === "object") {
    for (const key of ["message", "msg", "error_msg", "detail", "reason", "description"]) {
      const message = getReadableErrorMessage(value[key], "");
      if (message) return message;
    }
    for (const key of ["error", "errors", "details", "data"]) {
      const message = getReadableErrorMessage(value[key], "");
      if (message) return message;
    }
    try {
      return JSON.stringify(value).slice(0, 1000) || fallback;
    } catch {
      return fallback;
    }
  }
  return fallback;
}

function getSub2ApiRemoteMessage(responseInfo = {}) {
  const json = responseInfo.json;
  if (json && typeof json === "object") {
    const message = getReadableErrorMessage(json, "");
    if (message) return message;
  }
  return getReadableErrorMessage(responseInfo.text, "远程 Sub2api 请求失败");
}

async function callSub2ApiRemote(connection, pathname, { method = "GET", body = null, headers = {} } = {}) {
  const adminToken = decryptSub2ApiAdminToken(connection);
  const response = await fetch(`${connection.base_url}${pathname}`, {
    method,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${adminToken}`,
      "x-api-key": adminToken,
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...headers
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10000)
  });
  const text = await response.text();
  const json = safeParseJson(text, null);
  const result = { ok: response.ok, status: response.status, text, json };
  if (!response.ok) {
    const error = new Error(getSub2ApiRemoteMessage(result));
    error.status = response.status;
    error.responseInfo = result;
    throw error;
  }
  assertSub2ApiRemoteEnvelopeOk(result, getSub2ApiRemoteMessage);
  return result;
}

async function callSub2ApiUserRemote(connection, pathname, accessToken) {
  const response = await fetch(`${connection.base_url}${pathname}`, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`
    },
    signal: AbortSignal.timeout(10000)
  });
  const text = await response.text();
  const json = safeParseJson(text, null);
  const result = { ok: response.ok, status: response.status, text, json };
  if (!response.ok) {
    const error = new Error(getSub2ApiRemoteMessage(result));
    error.status = response.status;
    error.responseInfo = result;
    throw error;
  }
  assertSub2ApiRemoteEnvelopeOk(result, getSub2ApiRemoteMessage);
  return result;
}

async function tryAssignSub2ApiDedicatedGroup(connection, userId, sourceGroupId, targetGroupId, orderId) {
  if (!targetGroupId) return null;
  if (sourceGroupId) {
    return callSub2ApiRemote(connection, `/api/v1/admin/users/${encodeURIComponent(String(userId))}/replace-group`, {
      method: "POST",
      headers: { "Idempotency-Key": `${orderId}:dedicated-replace` },
      body: {
        old_group_id: Number(sourceGroupId),
        new_group_id: Number(targetGroupId)
      }
    });
  }

  const userResult = await callSub2ApiRemote(connection, `/api/v1/admin/users/${encodeURIComponent(String(userId))}`);
  const userPayload = unwrapSub2ApiRemoteData(userResult.json);
  const existingGroups = Array.isArray(userPayload?.allowed_groups)
    ? userPayload.allowed_groups.map((item) => Number(item)).filter((item) => Number.isFinite(item) && item > 0)
    : [];
  const allowedGroups = Array.from(new Set([...existingGroups, Number(targetGroupId)]));
  return callSub2ApiRemote(connection, `/api/v1/admin/users/${encodeURIComponent(String(userId))}`, {
    method: "PUT",
    headers: { "Idempotency-Key": `${orderId}:dedicated-allow` },
    body: { allowed_groups: allowedGroups }
  });
}

async function getSub2ApiIdentityFromAccessToken(connection, accessToken, expectedUserId = "") {
  const token = String(accessToken || "").trim();
  if (!token) {
    throw new Error("缺少 Sub2api 登录 token");
  }

  const result = await callSub2ApiUserRemote(connection, "/api/v1/auth/me", token);
  if (result.json && result.json.code !== undefined && Number(result.json.code) !== 0) {
    throw new Error(getSub2ApiRemoteMessage(result));
  }

  const payload = unwrapSub2ApiRemoteData(result.json);
  try {
    let identity;
    try {
      identity = extractSub2ApiIdentity(payload);
    } catch {
      identity = extractSub2ApiIdentityFromJwtClaims(token);
    }
    const normalizedExpectedUserId = String(expectedUserId || "").trim();
    if (normalizedExpectedUserId && normalizedExpectedUserId !== identity.userId) {
      throw new Error("Sub2api 登录 token 与当前用户不匹配");
    }
    return identity;
  } catch (error) {
    throw new Error(error.message || "Sub2api 当前用户信息无效");
  }
}

async function testSub2ApiConnection(connection) {
  try {
    const result = await callSub2ApiRemote(connection, "/api/v1/admin/redeem-codes?type=invitation&page=1&page_size=1");
    if (result.json && result.json.code !== undefined && Number(result.json.code) !== 0) {
      throw new Error(getSub2ApiRemoteMessage(result));
    }
    return result;
  } catch (error) {
    if (Number(error.status) !== 404) throw error;
  }

  const result = await callSub2ApiRemote(connection, "/api/admin/invite-codes/ping");
  if (result.json && result.json.ok === false) {
    throw new Error(getSub2ApiRemoteMessage(result));
  }
  return result;
}

function cleanupSub2ApiImageSessions() {
  const now = Date.now();
  for (const [id, session] of sub2apiImageSessions.entries()) {
    if (!session || session.expiresAtMs <= now) {
      sub2apiImageSessions.delete(id);
    }
  }
}

function cleanupSub2ApiImageJobs() {
  const now = Date.now();
  for (const [id, job] of sub2apiImageJobs.entries()) {
    if (!job || job.expiresAtMs <= now) {
      sub2apiImageJobs.delete(id);
    }
  }
}

function serializeSub2ApiImageJob(job) {
  return {
    jobId: job.id,
    status: job.status,
    mode: job.mode,
    model: job.model,
    quality: job.quality,
    outputFormat: job.outputFormat,
    aspectRatio: job.aspectRatio,
    count: job.count,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    endedAt: job.endedAt,
    elapsedMs: job.endedAt && job.startedAt
      ? Math.max(0, new Date(job.endedAt).getTime() - new Date(job.startedAt).getTime())
      : null,
    error: job.error || "",
    result: job.result || null
  };
}

function buildSub2ApiImagePublicPayload(connection, identity, sessionToken = null, extra = {}) {
  return {
    sessionToken,
    account: {
      userId: identity.userId,
      email: identity.email || "",
      username: identity.username || ""
    },
    connection: {
      id: connection.id,
      name: connection.name,
      baseUrl: connection.base_url
    },
    options: {
      models: SUB2API_IMAGE_MODELS,
      qualities: SUB2API_IMAGE_QUALITIES,
      formats: SUB2API_IMAGE_FORMATS,
      aspectRatios: SUB2API_IMAGE_ASPECT_RATIOS,
      maxCount: SUB2API_IMAGE_MAX_COUNT,
      maxReferenceImages: SUB2API_IMAGE_MAX_REFERENCE_IMAGES,
      maxReferenceImageBytes: SUB2API_IMAGE_MAX_IMAGE_BYTES
    },
    ...extra
  };
}

function signSub2ApiImageSessionToken(connection, identity, accessToken) {
  const sessionId = nanoid(18);
  const expiresAtMs = Date.now() + SUB2API_IMAGE_SESSION_TTL_MS;
  sub2apiImageSessions.set(sessionId, {
    id: sessionId,
    connectionId: connection.id,
    userId: identity.userId,
    email: identity.email || "",
    username: identity.username || "",
    accessToken,
    keys: new Map(),
    keysFetchedAt: 0,
    createdAt: nowIso(),
    lastUsedAt: nowIso(),
    expiresAtMs
  });

  return jwt.sign({
    scope: "sub2api_image",
    imageSessionId: sessionId,
    connectionId: connection.id,
    sub2apiUserId: identity.userId,
    email: identity.email || "",
    username: identity.username || ""
  }, env.jwtSecret, { expiresIn: "30m" });
}

async function requireSub2ApiImageSession(request, reply) {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return reply.code(401).send({ message: "缺少 Sub2api 图片会话 token" });
  }

  const token = header.slice("Bearer ".length).trim();
  try {
    const payload = jwt.verify(token, env.jwtSecret);
    if (payload?.scope !== "sub2api_image" || !payload.imageSessionId || !payload.connectionId || !payload.sub2apiUserId) {
      return reply.code(401).send({ message: "Sub2api 图片会话无效" });
    }

    const session = sub2apiImageSessions.get(String(payload.imageSessionId));
    if (!session || session.expiresAtMs <= Date.now()) {
      if (session) sub2apiImageSessions.delete(session.id);
      return reply.code(401).send({ message: "Sub2api 图片会话已失效" });
    }
    if (session.connectionId !== String(payload.connectionId) || session.userId !== String(payload.sub2apiUserId)) {
      return reply.code(401).send({ message: "Sub2api 图片会话不匹配" });
    }

    session.lastUsedAt = nowIso();
    request.sub2apiImage = {
      session,
      connectionId: session.connectionId,
      userId: session.userId,
      email: session.email || "",
      username: session.username || ""
    };
  } catch {
    return reply.code(401).send({ message: "Sub2api 图片会话已失效" });
  }
}

function getSub2ApiConnectionById(connectionId) {
  return db.prepare(`
    SELECT *
    FROM sub2api_connections
    WHERE id = ? AND status <> ?
  `).get(connectionId, sub2apiConnectionStatuses.deleted);
}

function getSub2ApiImageConnection(connectionId) {
  const connection = getSub2ApiConnectionById(connectionId);
  if (!connection) {
    const error = new Error("Sub2api 连接不存在或已删除");
    error.statusCode = 404;
    throw error;
  }
  if (connection.status !== sub2apiConnectionStatuses.active) {
    const error = new Error("Sub2api 连接已停用");
    error.statusCode = 403;
    throw error;
  }
  return connection;
}

function pickFirstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function getSub2ApiImageKeySecret(item = {}) {
  return pickFirstString(
    item.apiKey,
    item.api_key,
    item.key,
    item.keyValue,
    item.key_value,
    item.token,
    item.value,
    item.secret,
    item.sk
  );
}

function maskSub2ApiImageKeySecret(secret) {
  const value = String(secret || "").trim();
  if (!value) return "";
  if (value.length <= 12) return `${value.slice(0, 4)}****`;
  return `${value.slice(0, 8)}...${value.slice(-4)}`;
}

function formatSub2ApiImageKeyUsage(item = {}) {
  const quota = Number(item.quota ?? 0);
  const used = Number(item.quota_used ?? item.quotaUsed ?? 0);
  if (!Number.isFinite(quota) || quota <= 0) return "";
  const safeUsed = Number.isFinite(used) ? used : 0;
  return `$${safeUsed.toFixed(2)}/$${quota.toFixed(2)}`;
}

function getSub2ApiImageKeyLabel(item = {}, index = 0) {
  const name = pickFirstString(
    item.name,
    item.label,
    item.title,
    item.remark,
    item.description,
    item.alias
  ) || `API Key ${index + 1}`;
  const secret = getSub2ApiImageKeySecret(item);
  const group = pickFirstString(
    item.group?.name,
    item.groupName,
    item.group_name,
    item.group
  );
  const usage = formatSub2ApiImageKeyUsage(item);
  const meta = [
    maskSub2ApiImageKeySecret(secret),
    group,
    usage
  ].filter(Boolean).join(" · ");
  return meta ? `${name} (${meta})` : name;
}

function getSub2ApiImageKeyListPayload(json) {
  const payload = unwrapSub2ApiRemoteData(json);
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  for (const key of ["items", "list", "keys", "records", "data"]) {
    if (Array.isArray(payload[key])) return payload[key];
  }
  return [];
}

function isDisabledSub2ApiKey(item = {}) {
  const status = String(item.status ?? item.state ?? item.enabled ?? "").trim().toLowerCase();
  return ["disabled", "inactive", "deleted", "false", "0", "off"].includes(status);
}

function hasExplicitImageSupport(item = {}) {
  const flags = [
    item.imageEnabled,
    item.image_enabled,
    item.imagesEnabled,
    item.images_enabled,
    item.enableImage,
    item.enable_image,
    item.supportsImages,
    item.supports_images,
    item.supportImage,
    item.support_image,
    item.canImage,
    item.can_image
  ];
  for (const flag of flags) {
    if (typeof flag === "boolean") return flag;
    if (typeof flag === "number") return flag > 0;
    if (typeof flag === "string" && flag.trim()) {
      return ["1", "true", "yes", "on", "enabled"].includes(flag.trim().toLowerCase());
    }
  }
  return null;
}

function shouldIncludeSub2ApiImageKey(item = {}) {
  if (isDisabledSub2ApiKey(item)) return false;
  const explicit = hasExplicitImageSupport(item);
  if (explicit !== null) return explicit;
  const models = Array.isArray(item.models) ? item.models : Array.isArray(item.modelList) ? item.modelList : [];
  if (!models.length) return true;
  return models.some((model) => /image|dall-e/i.test(String(model)));
}

function hashSub2ApiImageKeySecret(secret) {
  return createHash("sha256").update(secret).digest("hex").slice(0, 18);
}

function normalizeSub2ApiImageKeys(json) {
  const items = getSub2ApiImageKeyListPayload(json);
  const keys = [];
  items.forEach((item, index) => {
    if (!item || typeof item !== "object" || !shouldIncludeSub2ApiImageKey(item)) return;
    const secret = getSub2ApiImageKeySecret(item);
    if (!secret || secret.includes("***")) return;
    const id = pickFirstString(item.id, item.keyId, item.key_id, item.uuid) || hashSub2ApiImageKeySecret(secret);
    keys.push({
      id: String(id),
      label: getSub2ApiImageKeyLabel(item, index),
      models: Array.isArray(item.models) ? item.models.map(String) : [],
      maskedKey: maskSub2ApiImageKeySecret(secret),
      status: pickFirstString(item.status, item.state) || "active",
      quota: Number(item.quota ?? 0) || 0,
      quotaUsed: Number(item.quota_used ?? item.quotaUsed ?? 0) || 0,
      secret
    });
  });
  return keys;
}

function serializeSub2ApiImageKey(key) {
  return {
    id: key.id,
    label: key.label,
    maskedKey: key.maskedKey || "",
    status: key.status || "active",
    quota: key.quota || 0,
    quotaUsed: key.quotaUsed || 0,
    models: key.models || []
  };
}

async function refreshSub2ApiImageKeys(connection, session, force = false) {
  const now = Date.now();
  if (!force && session.keys?.size && now - session.keysFetchedAt < SUB2API_IMAGE_KEYS_TTL_MS) {
    return Array.from(session.keys.values()).map(serializeSub2ApiImageKey);
  }

  const result = await callSub2ApiUserRemote(connection, "/api/v1/keys", session.accessToken);
  if (result.json && result.json.code !== undefined && Number(result.json.code) !== 0) {
    throw new Error(getSub2ApiRemoteMessage(result));
  }
  const keys = normalizeSub2ApiImageKeys(result.json);
  session.keys = new Map(keys.map((key) => [key.id, key]));
  session.keysFetchedAt = now;
  return keys.map(serializeSub2ApiImageKey);
}

async function getSub2ApiImageKeyForRequest(connection, session, keyId = "") {
  await refreshSub2ApiImageKeys(connection, session, false);
  let key = keyId ? session.keys.get(keyId) : null;
  if (!key) {
    await refreshSub2ApiImageKeys(connection, session, true);
    key = keyId ? session.keys.get(keyId) : Array.from(session.keys.values())[0];
  }
  if (!key) {
    throw new Error("当前 Sub2api 账号没有可用的图片 API Key");
  }
  return key;
}

function getSub2ApiImageSize(aspectRatio) {
  const normalized = String(aspectRatio || "auto").trim();
  if (normalized === "auto") return "auto";
  if (normalized === "1:1") return "1024x1024";
  if (normalized === "16:9" || normalized === "4:3") return "1536x1024";
  if (normalized === "3:4" || normalized === "9:16") return "1024x1536";
  return "auto";
}

function getSub2ApiImageMime(outputFormat) {
  if (outputFormat === "jpeg") return "image/jpeg";
  if (outputFormat === "webp") return "image/webp";
  return "image/png";
}

function parseSub2ApiImageDataUrl(value) {
  const raw = String(value || "").trim();
  const match = raw.match(/^data:(image\/(?:png|jpe?g|webp));base64,([\s\S]+)$/i);
  if (!match) {
    throw new Error("参考图必须是 PNG、JPG 或 WebP 格式");
  }
  const mimeType = match[1].toLowerCase() === "image/jpg" ? "image/jpeg" : match[1].toLowerCase();
  const buffer = Buffer.from(match[2].replace(/\s/g, ""), "base64");
  if (!buffer.length) {
    throw new Error("参考图内容为空");
  }
  if (buffer.length > SUB2API_IMAGE_MAX_IMAGE_BYTES) {
    throw new Error("单张参考图不能超过 20MB");
  }
  return { mimeType, buffer };
}

async function callSub2ApiOpenAiJson(connection, apiKey, pathname, body) {
  const response = await fetch(`${connection.base_url}${pathname}`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(SUB2API_IMAGE_GENERATE_TIMEOUT_MS)
  });
  const text = await response.text();
  const json = safeParseJson(text, null);
  const result = { ok: response.ok, status: response.status, text, json };
  if (!response.ok) {
    const error = new Error(getSub2ApiRemoteMessage(result));
    error.status = response.status;
    error.responseInfo = result;
    throw error;
  }
  return json;
}

async function callSub2ApiOpenAiForm(connection, apiKey, pathname, form) {
  const response = await fetch(`${connection.base_url}${pathname}`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: form,
    signal: AbortSignal.timeout(SUB2API_IMAGE_GENERATE_TIMEOUT_MS)
  });
  const text = await response.text();
  const json = safeParseJson(text, null);
  const result = { ok: response.ok, status: response.status, text, json };
  if (!response.ok) {
    const error = new Error(getSub2ApiRemoteMessage(result));
    error.status = response.status;
    error.responseInfo = result;
    throw error;
  }
  return json;
}

function walkForSub2ApiImageCall(value) {
  if (!value) return null;
  if (Array.isArray(value)) {
    for (const child of value) {
      const found = walkForSub2ApiImageCall(child);
      if (found) return found;
    }
    return null;
  }
  if (typeof value === "object") {
    if (value.type === "image_generation_call" && value.result) return value;
    for (const child of Object.values(value)) {
      const found = walkForSub2ApiImageCall(child);
      if (found) return found;
    }
  }
  return null;
}

function extractSub2ApiResponsesImageItems(raw) {
  let partialB64 = "";
  let partialPrompt = "";
  for (const line of String(raw || "").split(/\r?\n/)) {
    if (!line.startsWith("data: ")) continue;
    const payload = line.slice(6).trim();
    if (!payload || payload === "[DONE]") continue;
    const event = safeParseJson(payload, null);
    if (!event || typeof event !== "object") continue;
    if (event.type === "response.image_generation_call.partial_image" && event.partial_image_b64) {
      partialB64 = event.partial_image_b64;
      partialPrompt = event.revised_prompt || partialPrompt;
      continue;
    }
    if (event.type === "response.output_item.done" && event.item?.type === "image_generation_call") {
      if (event.item.result) {
        return [{ b64_json: event.item.result, revised_prompt: event.item.revised_prompt || "" }];
      }
      if (partialB64) {
        return [{ b64_json: partialB64, revised_prompt: partialPrompt }];
      }
    }
  }

  const parsed = safeParseJson(raw, null);
  const found = walkForSub2ApiImageCall(parsed);
  if (found?.result) {
    return [{ b64_json: found.result, revised_prompt: found.revised_prompt || "" }];
  }
  if (partialB64) {
    return [{ b64_json: partialB64, revised_prompt: partialPrompt }];
  }
  return [];
}

async function callSub2ApiResponses(connection, apiKey, body) {
  const response = await fetch(`${connection.base_url}/v1/responses`, {
    method: "POST",
    headers: {
      Accept: "text/event-stream, application/json",
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(SUB2API_IMAGE_GENERATE_TIMEOUT_MS)
  });
  const text = await response.text();
  const json = safeParseJson(text, null);
  const result = { ok: response.ok, status: response.status, text, json };
  if (!response.ok) {
    const error = new Error(getSub2ApiRemoteMessage(result));
    error.status = response.status;
    error.responseInfo = result;
    throw error;
  }
  return extractSub2ApiResponsesImageItems(text);
}

function extractSub2ApiImageItems(json) {
  const payload = unwrapSub2ApiRemoteData(json);
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.images)) return payload.images;
  if (payload?.b64_json || payload?.url) return [payload];
  return [];
}

async function dataUrlFromRemoteImageUrl(url, outputFormat) {
  const response = await fetch(url, {
    headers: { Accept: "image/*" },
    signal: AbortSignal.timeout(30000)
  });
  if (!response.ok) {
    throw new Error("图片 URL 拉取失败");
  }
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > SUB2API_IMAGE_MAX_IMAGE_BYTES) {
    throw new Error("图片结果超过直接返回大小限制");
  }
  const arrayBuffer = await response.arrayBuffer();
  if (arrayBuffer.byteLength > SUB2API_IMAGE_MAX_IMAGE_BYTES) {
    throw new Error("图片结果超过直接返回大小限制");
  }
  const mimeType = response.headers.get("content-type")?.split(";")[0] || getSub2ApiImageMime(outputFormat);
  return `data:${mimeType};base64,${Buffer.from(arrayBuffer).toString("base64")}`;
}

async function normalizeSub2ApiImageResult(item, outputFormat) {
  const b64 = item?.b64_json || item?.b64Json || item?.base64 || item?.image_base64 || "";
  if (b64) {
    const mimeType = getSub2ApiImageMime(outputFormat);
    return {
      dataUrl: `data:${mimeType};base64,${String(b64).replace(/^data:[^,]+,/, "")}`,
      url: "",
      revisedPrompt: item?.revised_prompt || item?.revisedPrompt || ""
    };
  }
  const url = item?.url || item?.image_url || "";
  if (url) {
    let dataUrl = "";
    try {
      dataUrl = await dataUrlFromRemoteImageUrl(url, outputFormat);
    } catch {
      dataUrl = "";
    }
    return {
      dataUrl,
      url,
      revisedPrompt: item?.revised_prompt || item?.revisedPrompt || ""
    };
  }
  return null;
}

function buildSub2ApiResponsesImageTool({ mode, model, quality, outputFormat, size }) {
  return {
    type: "image_generation",
    model,
    action: mode === "image" ? "edit" : "generate",
    size: size === "auto" ? "auto" : size,
    quality,
    output_format: outputFormat,
    moderation: "low",
    partial_images: 0
  };
}

function buildSub2ApiResponsesBody({ mode, prompt, model, quality, outputFormat, size, referenceImages = [] }) {
  const content = [{ type: "input_text", text: prompt }];
  if (mode === "image") {
    for (const dataUrl of referenceImages) {
      content.push({ type: "input_image", image_url: dataUrl });
    }
  }
  return {
    model: SUB2API_IMAGE_RESPONSES_MODEL,
    instructions: "You are a tool runner. Pass the user prompt to image_generation VERBATIM. DO NOT rewrite, expand, polish, or revise it in any way. Use the exact text the user gave.",
    input: [{ role: "user", content }],
    tools: [buildSub2ApiResponsesImageTool({ mode, model, quality, outputFormat, size })],
    tool_choice: { type: "image_generation" },
    reasoning: { effort: "xhigh" },
    store: false,
    stream: true
  };
}

function shouldFallbackToSub2ApiImagesApi(error) {
  const status = Number(error?.status || error?.httpStatus || 0);
  if ([404, 405, 501, 503].includes(status)) return true;
  const message = getReadableErrorMessage(error, "").toLowerCase();
  return message.includes("responses") && (
    message.includes("not found")
    || message.includes("not supported")
    || message.includes("unsupported")
    || message.includes("unavailable")
  );
}

async function textToSub2ApiImage({ connection, apiKey, prompt, model, quality, outputFormat, size }) {
  try {
    const body = buildSub2ApiResponsesBody({
      mode: "text",
      prompt,
      model,
      quality,
      outputFormat,
      size
    });
    const items = await callSub2ApiResponses(connection, apiKey, body);
    if (items.length) return items;
  } catch (error) {
    if (!shouldFallbackToSub2ApiImagesApi(error)) throw error;
  }

  const body = {
    model,
    prompt,
    n: 1,
    size,
    quality,
    output_format: outputFormat,
    response_format: "b64_json"
  };
  const json = await callSub2ApiOpenAiJson(connection, apiKey, "/v1/images/generations", body);
  return extractSub2ApiImageItems(json);
}

async function referenceToSub2ApiImage({ connection, apiKey, prompt, model, quality, outputFormat, size, referenceImages }) {
  try {
    const body = buildSub2ApiResponsesBody({
      mode: "image",
      prompt,
      model,
      quality,
      outputFormat,
      size,
      referenceImages
    });
    const items = await callSub2ApiResponses(connection, apiKey, body);
    if (items.length) return items;
  } catch (error) {
    if (!shouldFallbackToSub2ApiImagesApi(error)) throw error;
  }

  const form = new FormData();
  referenceImages.forEach((dataUrl, index) => {
    const parsed = parseSub2ApiImageDataUrl(dataUrl);
    const ext = parsed.mimeType === "image/jpeg" ? "jpg" : parsed.mimeType.split("/")[1] || "png";
    const blob = new Blob([parsed.buffer], { type: parsed.mimeType });
    form.append(index === 0 ? "image" : "image[]", blob, `reference-${index + 1}.${ext}`);
  });
  form.append("model", model);
  form.append("prompt", prompt);
  form.append("n", "1");
  form.append("size", size === "auto" ? "1024x1024" : size);
  form.append("quality", quality);
  form.append("output_format", outputFormat);
  form.append("response_format", "b64_json");

  const json = await callSub2ApiOpenAiForm(connection, apiKey, "/v1/images/edits", form);
  return extractSub2ApiImageItems(json);
}

async function generateSub2ApiImages({ mode, connection, apiKey, prompt, model, quality, outputFormat, size, count, referenceImages }) {
  const images = [];
  for (let i = 0; i < count; i += 1) {
    const rawItems = mode === "image"
      ? await referenceToSub2ApiImage({ connection, apiKey, prompt, model, quality, outputFormat, size, referenceImages })
      : await textToSub2ApiImage({ connection, apiKey, prompt, model, quality, outputFormat, size });
    for (const item of rawItems) {
      const normalized = await normalizeSub2ApiImageResult(item, outputFormat);
      if (normalized) images.push(normalized);
      if (images.length >= count) break;
    }
  }
  return images.slice(0, count);
}

const sub2apiImageGenerateSchema = z.object({
  mode: z.enum(["text", "image"]).default("text"),
  keyId: z.string().trim().optional().default(""),
  prompt: z.string().trim().min(1).max(4000),
  model: z.string().trim().optional().default("gpt-image-2"),
  quality: z.string().trim().optional().default("auto"),
  outputFormat: z.string().trim().optional().default("png"),
  aspectRatio: z.string().trim().optional().default("auto"),
  count: z.coerce.number().int().min(1).max(SUB2API_IMAGE_MAX_COUNT).optional().default(1),
  referenceImages: z.array(z.string()).max(SUB2API_IMAGE_MAX_REFERENCE_IMAGES).optional().default([])
});

function prepareSub2ApiImageGenerateRequest(body) {
  const parsed = sub2apiImageGenerateSchema.safeParse(getBodyObject(body));
  if (!parsed.success) {
    const error = new Error("图片生成参数不正确");
    error.statusCode = 400;
    throw error;
  }

  const payload = parsed.data;
  if (payload.mode === "image" && payload.referenceImages.length < 1) {
    const error = new Error("图生图需要至少 1 张参考图");
    error.statusCode = 400;
    throw error;
  }

  const model = SUB2API_IMAGE_MODELS.includes(payload.model) ? payload.model : "gpt-image-2";
  const quality = SUB2API_IMAGE_QUALITIES.includes(payload.quality) ? payload.quality : "auto";
  const outputFormat = SUB2API_IMAGE_FORMATS.includes(payload.outputFormat) ? payload.outputFormat : "png";
  const aspectRatio = SUB2API_IMAGE_ASPECT_RATIOS.includes(payload.aspectRatio) ? payload.aspectRatio : "auto";
  const size = getSub2ApiImageSize(aspectRatio);
  return { payload, model, quality, outputFormat, aspectRatio, size };
}

function auditSub2ApiImageGenerateFailure({ jobId, payload, connection, imageSession, model, error }) {
  createAuditLog({
    action: "sub2api.image.generate_failed",
    actor: "public",
    resourceType: "sub2api_image_job",
    resourceId: jobId,
    detail: {
      connectionId: connection.id,
      sub2apiUserId: imageSession.userId,
      mode: payload.mode,
      model,
      message: getReadableErrorMessage(error, "生成失败")
    }
  });
}

async function completeSub2ApiImageGeneration({
  jobId,
  startedAt,
  payload,
  connection,
  imageSession,
  model,
  quality,
  outputFormat,
  aspectRatio,
  size
}) {
  const key = await getSub2ApiImageKeyForRequest(connection, imageSession, payload.keyId);
  const images = await generateSub2ApiImages({
    mode: payload.mode,
    connection,
    apiKey: key.secret,
    prompt: payload.prompt,
    model,
    quality,
    outputFormat,
    size,
    count: payload.count,
    referenceImages: payload.referenceImages
  });

  if (!images.length) {
    throw new Error("远程 Sub2api 未返回图片结果");
  }

  const result = {
    success: true,
    jobId,
    mode: payload.mode,
    model,
    quality,
    outputFormat,
    aspectRatio,
    size,
    count: payload.count,
    elapsedMs: Date.now() - startedAt,
    images
  };

  createAuditLog({
    action: "sub2api.image.generate",
    actor: "public",
    resourceType: "sub2api_image_job",
    resourceId: jobId,
    detail: {
      connectionId: connection.id,
      sub2apiUserId: imageSession.userId,
      mode: payload.mode,
      model,
      quality,
      outputFormat,
      aspectRatio,
      count: payload.count,
      returned: images.length,
      elapsedMs: result.elapsedMs
    }
  });

  return result;
}

async function runSub2ApiImageJob(job, params) {
  job.status = "running";
  job.startedAt = nowIso();
  job.expiresAtMs = Date.now() + SUB2API_IMAGE_JOB_TTL_MS;
  try {
    job.result = await completeSub2ApiImageGeneration({
      ...params,
      jobId: job.id,
      startedAt: new Date(job.startedAt).getTime()
    });
    job.status = "succeeded";
  } catch (error) {
    job.status = "failed";
    job.error = getReadableErrorMessage(error, "图片生成失败");
    auditSub2ApiImageGenerateFailure({ ...params, jobId: job.id, error });
  } finally {
    job.endedAt = nowIso();
    job.expiresAtMs = Date.now() + SUB2API_IMAGE_JOB_TTL_MS;
  }
}

function signSub2ApiWorldCupSessionToken(connection, identity) {
  return jwt.sign({
    scope: "sub2api_worldcup",
    connectionId: connection.id,
    sub2apiUserId: identity.userId,
    email: identity.email || "",
    username: identity.username || ""
  }, env.jwtSecret, { expiresIn: "30m" });
}

async function requireSub2ApiWorldCupSession(request, reply) {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return reply.code(401).send({ message: "缺少 Sub2api 竞猜会话 token" });
  }

  const token = header.slice("Bearer ".length).trim();
  try {
    const payload = jwt.verify(token, env.jwtSecret);
    if (payload?.scope !== "sub2api_worldcup" || !payload.connectionId || !payload.sub2apiUserId) {
      return reply.code(401).send({ message: "Sub2api 竞猜会话无效" });
    }
    request.sub2apiWorldCup = {
      connectionId: String(payload.connectionId),
      userId: String(payload.sub2apiUserId),
      email: String(payload.email || ""),
      username: String(payload.username || "")
    };
  } catch {
    return reply.code(401).send({ message: "Sub2api 竞猜会话已失效" });
  }
}

function getSub2ApiWorldCupConnection(connectionId) {
  const connection = getSub2ApiConnectionById(connectionId);
  if (!connection) {
    const error = new Error("Sub2api 连接不存在或已删除");
    error.statusCode = 404;
    throw error;
  }
  if (connection.status !== sub2apiConnectionStatuses.active) {
    const error = new Error("Sub2api 连接已停用");
    error.statusCode = 403;
    throw error;
  }
  return connection;
}

function getSub2ApiWorldCupPredictionLabel(prediction) {
  if (prediction === sub2apiWorldCupPredictions.home) return "主胜";
  if (prediction === sub2apiWorldCupPredictions.away) return "客胜";
  if (prediction === sub2apiWorldCupPredictions.draw) return "平局";
  return prediction || "-";
}

function getSub2ApiWorldCupBetOdds(match, prediction) {
  if (prediction === sub2apiWorldCupPredictions.home) return Number(match.odds_home);
  if (prediction === sub2apiWorldCupPredictions.away) return Number(match.odds_away);
  if (prediction === sub2apiWorldCupPredictions.draw) return Number(match.odds_draw);
  throw new Error("竞猜选项无效");
}

function isSub2ApiWorldCupMatchBettingOpen(match) {
  return getSub2ApiWorldCupBettingState(match).open;
}

function serializeSub2ApiWorldCupMatch(row, userBets = null) {
  if (!row) return null;
  const bettingState = getSub2ApiWorldCupBettingState(row);
  const betsByPhase = userBets?.byPhase || {};
  const currentPhaseBet = bettingState.phase ? betsByPhase[bettingState.phase] : null;
  const latestBet = userBets?.latest || userBets || null;
  const preMatchBet = betsByPhase[sub2apiWorldCupBetPhases.preMatch] || null;
  const halftimeBet = betsByPhase[sub2apiWorldCupBetPhases.halftime] || null;
  const displayBet = currentPhaseBet || latestBet;
  return {
    id: row.id,
    connectionId: row.connection_id,
    connectionName: row.connection_name || null,
    source: row.source || "manual",
    apiFixtureId: row.api_fixture_id || "",
    apiStatusShort: row.api_status_short || "",
    apiStatusLong: row.api_status_long || "",
    apiElapsed: row.api_elapsed,
    apiLastSyncedAt: row.api_last_synced_at || null,
    oddsLastSyncedAt: row.odds_last_synced_at || null,
    displayRole: row.display_role || "",
    inProgress: isSub2ApiWorldCupMatchInProgress(row),
    stage: row.stage || "",
    groupName: row.group_name || "",
    homeTeam: row.home_team,
    awayTeam: row.away_team,
    kickoffAt: row.kickoff_at,
    status: row.status,
    homeScore: row.home_score,
    awayScore: row.away_score,
    result: row.result || "",
    resultLabel: getSub2ApiWorldCupPredictionLabel(row.result),
    odds: {
      home: Number(row.odds_home),
      draw: Number(row.odds_draw),
      away: Number(row.odds_away)
    },
    minStake: Number(row.min_stake),
    maxStake: Number(row.max_stake),
    note: row.note || "",
    bettingOpen: bettingState.open,
    bettingPhase: bettingState.phase,
    bettingPhaseLabel: bettingState.label,
    bettingClosedReason: bettingState.reason,
    bettingClosesAt: bettingState.closesAt,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    settledAt: row.settled_at || null,
    myBet: displayBet ? serializeSub2ApiWorldCupBet(displayBet) : null,
    myBetForCurrentPhase: currentPhaseBet ? serializeSub2ApiWorldCupBet(currentPhaseBet) : null,
    myBets: {
      preMatch: preMatchBet ? serializeSub2ApiWorldCupBet(preMatchBet) : null,
      halftime: halftimeBet ? serializeSub2ApiWorldCupBet(halftimeBet) : null
    }
  };
}

function serializeSub2ApiWorldCupBet(row) {
  if (!row) return null;
  const item = {
    id: row.id,
    requestId: row.request_id,
    connectionId: row.connection_id,
    matchId: row.match_id,
    userId: row.sub2api_user_id,
    email: row.email || "",
    username: row.username || "",
    phase: row.phase || sub2apiWorldCupBetPhases.preMatch,
    phaseLabel: getSub2ApiWorldCupBetPhaseLabel(row.phase || sub2apiWorldCupBetPhases.preMatch),
    prediction: row.prediction,
    predictionLabel: getSub2ApiWorldCupPredictionLabel(row.prediction),
    stake: Number(row.stake),
    odds: Number(row.odds),
    status: row.status,
    payout: Number(row.payout || 0),
    errorMessage: row.error_message || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    settledAt: row.settled_at || null
  };
  if (row.home_team || row.away_team) {
    item.match = {
      id: row.match_id,
      stage: row.stage || "",
      homeTeam: row.home_team || "",
      awayTeam: row.away_team || "",
      kickoffAt: row.kickoff_at || "",
      status: row.match_status || row.status || "",
      homeScore: row.home_score,
      awayScore: row.away_score,
      result: row.result || ""
    };
  }
  return item;
}

function serializeSub2ApiWorldCupRemoteResult(result) {
  try {
    return JSON.stringify({
      status: result?.status || 0,
      json: result?.json ?? null,
      text: result?.json ? undefined : String(result?.text || "").slice(0, 1000)
    });
  } catch {
    return null;
  }
}

async function getSub2ApiWorldCupRemoteUser(connection, userId) {
  const result = await callSub2ApiRemote(
    connection,
    `/api/v1/admin/users/${encodeURIComponent(userId)}?_=${Date.now()}`
  );
  assertSub2ApiRemoteEnvelopeOk(result);
  const payload = unwrapSub2ApiRemoteData(result.json);
  return payload && typeof payload === "object" ? payload : {};
}

function getSub2ApiWorldCupRemoteBalance(user) {
  const balance = Number(user?.balance ?? user?.user?.balance ?? user?.account?.balance);
  return Number.isFinite(balance) ? balance : null;
}

async function adjustSub2ApiWorldCupBalance(connection, userId, {
  amount,
  operation,
  notes,
  idempotencyKey
}) {
  const result = await callSub2ApiRemote(connection, `/api/v1/admin/users/${encodeURIComponent(userId)}/balance`, {
    method: "POST",
    headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {},
    body: {
      balance: roundSub2ApiWorldCupAmount(amount),
      operation,
      notes
    }
  });
  assertSub2ApiRemoteEnvelopeOk(result);
  return result;
}

async function getSub2ApiWorldCupBalancePayload(connection, userId) {
  try {
    const user = await getSub2ApiWorldCupRemoteUser(connection, userId);
    return {
      balance: getSub2ApiWorldCupRemoteBalance(user),
      balanceError: ""
    };
  } catch (error) {
    return {
      balance: null,
      balanceError: error.message || "余额读取失败"
    };
  }
}

function getSub2ApiWorldCupUserBetMap(connectionId, userId) {
  const rows = db.prepare(`
    SELECT b.*
    FROM sub2api_worldcup_bets b
    WHERE b.connection_id = ?
      AND b.sub2api_user_id = ?
      AND b.status <> ?
    ORDER BY b.created_at DESC
  `).all(connectionId, userId, sub2apiWorldCupBetStatuses.debitFailed);
  const map = new Map();
  for (const row of rows) {
    const phase = row.phase || sub2apiWorldCupBetPhases.preMatch;
    const item = map.get(row.match_id) || { byPhase: {}, latest: null };
    if (!item.latest) item.latest = row;
    if (!item.byPhase[phase]) item.byPhase[phase] = row;
    map.set(row.match_id, item);
  }
  return map;
}

function getSub2ApiWorldCupPublicMatches(connectionId, userId) {
  const bets = getSub2ApiWorldCupUserBetMap(connectionId, userId);
  const rows = db.prepare(`
    SELECT m.*
    FROM sub2api_worldcup_matches m
    WHERE m.connection_id = ?
    ORDER BY datetime(m.kickoff_at) ASC, m.created_at ASC
  `).all(connectionId);
  return selectSub2ApiWorldCupDisplayMatches(rows)
    .map((row) => serializeSub2ApiWorldCupMatch(row, bets.get(row.id)));
}

function getSub2ApiWorldCupMyBets(connectionId, userId) {
  return db.prepare(`
    SELECT b.*, m.stage, m.home_team, m.away_team, m.kickoff_at, m.status AS match_status,
           m.home_score, m.away_score, m.result
    FROM sub2api_worldcup_bets b
    LEFT JOIN sub2api_worldcup_matches m ON m.id = b.match_id
    WHERE b.connection_id = ?
      AND b.sub2api_user_id = ?
      AND b.status <> ?
    ORDER BY b.created_at DESC
    LIMIT 50
  `).all(connectionId, userId, sub2apiWorldCupBetStatuses.debitFailed).map(serializeSub2ApiWorldCupBet);
}

function getSub2ApiWorldCupLeaderboard(connectionId, limit = 20) {
  const rows = db.prepare(`
    SELECT sub2api_user_id, email, username,
           COUNT(*) AS bet_count,
           SUM(CASE WHEN status = ? THEN 1 ELSE 0 END) AS win_count,
           SUM(stake) AS total_stake,
           SUM(payout) AS total_payout
    FROM sub2api_worldcup_bets
    WHERE connection_id = ?
      AND status IN (?, ?, ?)
    GROUP BY sub2api_user_id, email, username
  `).all(
    sub2apiWorldCupBetStatuses.won,
    connectionId,
    sub2apiWorldCupBetStatuses.placed,
    sub2apiWorldCupBetStatuses.won,
    sub2apiWorldCupBetStatuses.lost
  );
  return rows
    .map((row) => ({
      userId: row.sub2api_user_id,
      email: row.email || "",
      username: row.username || "",
      betCount: Number(row.bet_count || 0),
      winCount: Number(row.win_count || 0),
      totalStake: roundSub2ApiWorldCupAmount(row.total_stake || 0),
      totalPayout: roundSub2ApiWorldCupAmount(row.total_payout || 0),
      net: roundSub2ApiWorldCupAmount((row.total_payout || 0) - (row.total_stake || 0))
    }))
    .sort((a, b) => b.net - a.net || b.totalPayout - a.totalPayout || a.betCount - b.betCount)
    .slice(0, limit)
    .map((item, index) => ({ ...item, rank: index + 1 }));
}

async function buildSub2ApiWorldCupPublicPayload(connection, identity, sessionToken = null, options = {}) {
  const balance = await getSub2ApiWorldCupBalancePayload(connection, identity.userId);
  const balanceOverride = Number(options.balanceOverride);
  const hasBalanceOverride = options.balanceOverride !== null
    && options.balanceOverride !== undefined
    && Number.isFinite(balanceOverride);
  return {
    sessionToken,
    account: {
      userId: identity.userId,
      email: identity.email || "",
      username: identity.username || ""
    },
    connection: {
      id: connection.id,
      name: connection.name,
      baseUrl: connection.base_url
    },
    balance: hasBalanceOverride ? balanceOverride : balance.balance,
    balanceError: hasBalanceOverride ? "" : balance.balanceError,
    settings: {
      minStake: SUB2API_WORLDCUP_DEFAULT_MIN_STAKE,
      maxStake: SUB2API_WORLDCUP_DEFAULT_MAX_STAKE,
      predictions: [
        { value: sub2apiWorldCupPredictions.home, label: "主胜" },
        { value: sub2apiWorldCupPredictions.draw, label: "平局" },
        { value: sub2apiWorldCupPredictions.away, label: "客胜" }
      ],
      ruleText: "赛前盘开赛时停止下注；中场盘仅在中场休息时开放一次。下注后立即扣除余额，命中后按赔率返还余额。"
    },
    matches: getSub2ApiWorldCupPublicMatches(connection.id, identity.userId),
    bets: getSub2ApiWorldCupMyBets(connection.id, identity.userId),
    leaderboard: getSub2ApiWorldCupLeaderboard(connection.id)
  };
}

const sub2apiWorldCupMatchAdminSchema = z.object({
  connectionId: z.string().trim().min(1),
  stage: z.string().trim().max(80).optional().default(""),
  groupName: z.string().trim().max(80).optional().default(""),
  homeTeam: z.string().trim().min(1).max(80),
  awayTeam: z.string().trim().min(1).max(80),
  kickoffAt: z.string().trim().min(1),
  status: z.enum([
    sub2apiWorldCupMatchStatuses.open,
    sub2apiWorldCupMatchStatuses.locked,
    sub2apiWorldCupMatchStatuses.finished,
    sub2apiWorldCupMatchStatuses.settled,
    sub2apiWorldCupMatchStatuses.cancelled
  ]).optional().default(sub2apiWorldCupMatchStatuses.open),
  oddsHome: z.coerce.number().min(1).max(50).optional().default(SUB2API_WORLDCUP_DEFAULT_ODDS.home),
  oddsDraw: z.coerce.number().min(1).max(50).optional().default(SUB2API_WORLDCUP_DEFAULT_ODDS.draw),
  oddsAway: z.coerce.number().min(1).max(50).optional().default(SUB2API_WORLDCUP_DEFAULT_ODDS.away),
  minStake: z.coerce.number().min(0.01).max(SUB2API_WORLDCUP_MAX_ADMIN_STAKE).optional().default(SUB2API_WORLDCUP_DEFAULT_MIN_STAKE),
  maxStake: z.coerce.number().min(0.01).max(SUB2API_WORLDCUP_MAX_ADMIN_STAKE).optional().default(SUB2API_WORLDCUP_DEFAULT_MAX_STAKE),
  note: z.string().trim().max(500).optional().default("")
});

function parseSub2ApiWorldCupKickoff(value) {
  const raw = String(value || "").trim();
  const beijingLocal = raw.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (beijingLocal) {
    const year = Number(beijingLocal[1]);
    const month = Number(beijingLocal[2]);
    const day = Number(beijingLocal[3]);
    const hour = Number(beijingLocal[4]);
    const minute = Number(beijingLocal[5]);
    const second = Number(beijingLocal[6] || 0);
    const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second) - 8 * 60 * 60000);
    if (Number.isFinite(date.getTime())) return date.toISOString();
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new Error("开赛时间不正确");
  }
  return date.toISOString();
}

function prepareSub2ApiWorldCupMatchPayload(body, { partial = false } = {}) {
  const rawBody = getBodyObject(body);
  const schema = partial ? sub2apiWorldCupMatchAdminSchema.partial() : sub2apiWorldCupMatchAdminSchema;
  const parsed = schema.safeParse(rawBody);
  if (!parsed.success) {
    const error = new Error("比赛参数不正确");
    error.statusCode = 400;
    throw error;
  }
  const payload = parsed.data;
  if (partial && rawBody && typeof rawBody === "object" && !Array.isArray(rawBody)) {
    for (const key of [
      "connectionId", "stage", "groupName", "homeTeam", "awayTeam", "kickoffAt",
      "status", "oddsHome", "oddsDraw", "oddsAway", "minStake", "maxStake", "note"
    ]) {
      if (!Object.prototype.hasOwnProperty.call(rawBody, key)) {
        delete payload[key];
      }
    }
  }
  if (payload.homeTeam && payload.awayTeam && payload.homeTeam === payload.awayTeam) {
    const error = new Error("主队和客队不能相同");
    error.statusCode = 400;
    throw error;
  }
  if (payload.kickoffAt) payload.kickoffAt = parseSub2ApiWorldCupKickoff(payload.kickoffAt);
  if (payload.minStake !== undefined) payload.minStake = roundSub2ApiWorldCupAmount(payload.minStake);
  if (payload.maxStake !== undefined) payload.maxStake = roundSub2ApiWorldCupAmount(payload.maxStake);
  const minStake = payload.minStake ?? SUB2API_WORLDCUP_DEFAULT_MIN_STAKE;
  const maxStake = payload.maxStake ?? SUB2API_WORLDCUP_DEFAULT_MAX_STAKE;
  if (maxStake < minStake) {
    const error = new Error("最高投注额不能小于最低投注额");
    error.statusCode = 400;
    throw error;
  }
  return payload;
}

function getSub2ApiWorldCupMatchById(matchId) {
  return db.prepare(`
    SELECT m.*, c.name AS connection_name
    FROM sub2api_worldcup_matches m
    LEFT JOIN sub2api_connections c ON c.id = m.connection_id
    WHERE m.id = ?
  `).get(matchId);
}

function getSub2ApiWorldCupActiveBet(matchId, userId, phase = sub2apiWorldCupBetPhases.preMatch) {
  return db.prepare(`
    SELECT *
    FROM sub2api_worldcup_bets
    WHERE match_id = ?
      AND sub2api_user_id = ?
      AND phase = ?
      AND status NOT IN (?, ?)
    ORDER BY created_at DESC
    LIMIT 1
  `).get(
    matchId,
    userId,
    phase,
    sub2apiWorldCupBetStatuses.debitFailed,
    sub2apiWorldCupBetStatuses.refunded
  );
}

const sub2apiWorldCupBetSchema = z.object({
  matchId: z.string().trim().min(1),
  prediction: z.enum([
    sub2apiWorldCupPredictions.home,
    sub2apiWorldCupPredictions.draw,
    sub2apiWorldCupPredictions.away
  ]),
  stake: z.coerce.number().min(0.01).refine(Number.isFinite, "投注额不正确")
});

async function placeSub2ApiWorldCupBet({ connection, identity, body }) {
  const parsed = sub2apiWorldCupBetSchema.safeParse(getBodyObject(body));
  if (!parsed.success) {
    const error = new Error("投注参数不正确");
    error.statusCode = 400;
    throw error;
  }
  const payload = parsed.data;
  payload.stake = roundSub2ApiWorldCupAmount(payload.stake);

  const match = db.prepare(`
    SELECT *
    FROM sub2api_worldcup_matches
    WHERE id = ? AND connection_id = ?
  `).get(payload.matchId, connection.id);
  if (!match) {
    const error = new Error("比赛不存在");
    error.statusCode = 404;
    throw error;
  }
  const bettingState = getSub2ApiWorldCupBettingState(match);
  if (!bettingState.open || !bettingState.phase) {
    const error = new Error("该比赛已停止竞猜");
    error.statusCode = 403;
    throw error;
  }
  const minStake = Number(match.min_stake);
  const maxStake = Number(match.max_stake);
  if (Number.isFinite(maxStake) && payload.stake > maxStake) {
    payload.stake = roundSub2ApiWorldCupAmount(maxStake);
  }
  if (!Number.isFinite(minStake) || payload.stake < minStake) {
    const error = new Error(`投注额必须不低于 ${Number(match.min_stake)}`);
    error.statusCode = 400;
    throw error;
  }

  const odds = roundSub2ApiWorldCupAmount(getSub2ApiWorldCupBetOdds(match, payload.prediction));
  const now = nowIso();
  const betId = nanoid(16);
  const requestId = `worldcup_${Date.now()}_${nanoid(8)}`;
  let balanceAfter = null;
  const insertBet = db.transaction(() => {
    const existing = getSub2ApiWorldCupActiveBet(match.id, identity.userId, bettingState.phase);
    if (existing) {
      const error = new Error(`该比赛${bettingState.label || "当前阶段"}已经提交过竞猜`);
      error.statusCode = 409;
      throw error;
    }
    db.prepare(`
      INSERT INTO sub2api_worldcup_bets (
        id, request_id, connection_id, match_id, sub2api_user_id, email, username,
        phase, prediction, stake, odds, status, payout, remote_debit_response,
        remote_credit_response, error_message, created_at, updated_at, settled_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL, NULL, ?, ?, NULL)
    `).run(
      betId,
      requestId,
      connection.id,
      match.id,
      identity.userId,
      identity.email || null,
      identity.username || null,
      bettingState.phase,
      payload.prediction,
      payload.stake,
      odds,
      sub2apiWorldCupBetStatuses.debiting,
      now,
      now
    );
  });
  try {
    insertBet();
  } catch (error) {
    if (error.statusCode) throw error;
    if (String(error.message || "").toLowerCase().includes("unique")) {
      const duplicate = new Error(`该比赛${bettingState.label || "当前阶段"}已经提交过竞猜`);
      duplicate.statusCode = 409;
      throw duplicate;
    }
    throw error;
  }

  try {
    const remoteUser = await getSub2ApiWorldCupRemoteUser(connection, identity.userId);
    const balance = getSub2ApiWorldCupRemoteBalance(remoteUser);
    if (balance !== null && balance + 1e-9 < payload.stake) {
      throw Object.assign(new Error(`余额不足，当前余额 ${balance}`), { statusCode: 402 });
    }
    const debitResult = await adjustSub2ApiWorldCupBalance(connection, identity.userId, {
      amount: payload.stake,
      operation: "subtract",
      notes: `世界杯竞猜扣款：${match.home_team} 对阵 ${match.away_team}，${bettingState.label}，${getSub2ApiWorldCupPredictionLabel(payload.prediction)}，投注 ${payload.stake}`,
      idempotencyKey: `worldcup_bet_${betId}`
    });
    const debitPayload = unwrapSub2ApiRemoteData(debitResult.json);
    const debitBalance = getSub2ApiWorldCupRemoteBalance(debitPayload);
    try {
      const refreshedRemoteUser = await getSub2ApiWorldCupRemoteUser(connection, identity.userId);
      balanceAfter = getSub2ApiWorldCupRemoteBalance(refreshedRemoteUser);
    } catch {
      balanceAfter = null;
    }
    if (balanceAfter === null) {
      balanceAfter = debitBalance === null && balance !== null
        ? roundSub2ApiWorldCupAmount(balance - payload.stake)
        : debitBalance;
    }
    const updatedAt = nowIso();
    db.prepare(`
      UPDATE sub2api_worldcup_bets
      SET status = ?, remote_debit_response = ?, error_message = NULL, updated_at = ?
      WHERE id = ?
    `).run(
      sub2apiWorldCupBetStatuses.placed,
      serializeSub2ApiWorldCupRemoteResult(debitResult),
      updatedAt,
      betId
    );
    createAuditLog({
      action: "sub2api.worldcup.bet.place",
      actor: "public",
      resourceType: "sub2api_worldcup_bet",
      resourceId: betId,
      detail: {
        connectionId: connection.id,
        matchId: match.id,
        phase: bettingState.phase,
        sub2apiUserId: identity.userId,
        prediction: payload.prediction,
        stake: payload.stake,
        odds
      }
    });
  } catch (error) {
    const updatedAt = nowIso();
    db.prepare(`
      UPDATE sub2api_worldcup_bets
      SET status = ?, error_message = ?, updated_at = ?
      WHERE id = ?
    `).run(
      sub2apiWorldCupBetStatuses.debitFailed,
      error.message || "余额扣款失败",
      updatedAt,
      betId
    );
    throw error;
  }

  const row = db.prepare(`
    SELECT b.*, m.stage, m.home_team, m.away_team, m.kickoff_at, m.status AS match_status,
           m.home_score, m.away_score, m.result
    FROM sub2api_worldcup_bets b
    LEFT JOIN sub2api_worldcup_matches m ON m.id = b.match_id
    WHERE b.id = ?
  `).get(betId);
  return {
    ...serializeSub2ApiWorldCupBet(row),
    balanceAfter
  };
}

async function settleSub2ApiWorldCupMatch(match, actor = "system") {
  const connection = getSub2ApiWorldCupConnection(match.connection_id);
  const result = getSub2ApiWorldCupResult(match.home_score, match.away_score);
  const now = nowIso();
  const bets = db.prepare(`
    SELECT *
    FROM sub2api_worldcup_bets
    WHERE match_id = ?
      AND status IN (?, ?)
    ORDER BY created_at ASC
  `).all(
    match.id,
    sub2apiWorldCupBetStatuses.placed,
    sub2apiWorldCupBetStatuses.payoutFailed
  );

  const stats = {
    total: bets.length,
    won: 0,
    lost: 0,
    payoutFailed: 0,
    payoutTotal: 0,
    payouts: []
  };

  for (const bet of bets) {
    if (bet.prediction !== result) {
      db.prepare(`
        UPDATE sub2api_worldcup_bets
        SET status = ?, payout = 0, settled_at = ?, updated_at = ?, error_message = NULL
        WHERE id = ?
      `).run(sub2apiWorldCupBetStatuses.lost, now, now, bet.id);
      stats.lost += 1;
      continue;
    }

    const payout = roundSub2ApiWorldCupAmount(Number(bet.stake) * Number(bet.odds));
    try {
      const creditResult = await adjustSub2ApiWorldCupBalance(connection, bet.sub2api_user_id, {
        amount: payout,
        operation: "add",
        notes: `世界杯竞猜派奖：${match.home_team} ${match.home_score}-${match.away_score} ${match.away_team}，投注 ${bet.stake}，赔率 ${bet.odds}`,
        idempotencyKey: `worldcup_payout_${bet.id}`
      });
      const creditPayload = unwrapSub2ApiRemoteData(creditResult.json);
      let balanceAfter = getSub2ApiWorldCupRemoteBalance(creditPayload);
      try {
        const refreshedRemoteUser = await getSub2ApiWorldCupRemoteUser(connection, bet.sub2api_user_id);
        const refreshedBalance = getSub2ApiWorldCupRemoteBalance(refreshedRemoteUser);
        if (refreshedBalance !== null) balanceAfter = refreshedBalance;
      } catch {
        // The credit response is still enough to prove the remote add call succeeded.
      }
      db.prepare(`
        UPDATE sub2api_worldcup_bets
        SET status = ?, payout = ?, remote_credit_response = ?, error_message = NULL,
            settled_at = ?, updated_at = ?
        WHERE id = ?
      `).run(
        sub2apiWorldCupBetStatuses.won,
        payout,
        serializeSub2ApiWorldCupRemoteResult(creditResult),
        now,
        now,
        bet.id
      );
      stats.won += 1;
      stats.payoutTotal = roundSub2ApiWorldCupAmount(stats.payoutTotal + payout);
      stats.payouts.push({
        betId: bet.id,
        userId: bet.sub2api_user_id,
        payout,
        balanceAfter,
        status: sub2apiWorldCupBetStatuses.won
      });
    } catch (error) {
      db.prepare(`
        UPDATE sub2api_worldcup_bets
        SET status = ?, payout = ?, error_message = ?, updated_at = ?
        WHERE id = ?
      `).run(
        sub2apiWorldCupBetStatuses.payoutFailed,
        payout,
        error.message || "派奖失败",
        now,
        bet.id
      );
      stats.payoutFailed += 1;
      stats.payouts.push({
        betId: bet.id,
        userId: bet.sub2api_user_id,
        payout,
        errorMessage: error.message || "派奖失败",
        status: sub2apiWorldCupBetStatuses.payoutFailed
      });
    }
  }

  const finalStatus = stats.payoutFailed > 0
    ? sub2apiWorldCupMatchStatuses.finished
    : sub2apiWorldCupMatchStatuses.settled;
  db.prepare(`
    UPDATE sub2api_worldcup_matches
    SET status = ?, result = ?, settled_at = ?, updated_at = ?
    WHERE id = ?
  `).run(finalStatus, result, finalStatus === sub2apiWorldCupMatchStatuses.settled ? now : null, now, match.id);

  createAuditLog({
    action: "sub2api.worldcup.match.settle",
    actor,
    resourceType: "sub2api_worldcup_match",
    resourceId: match.id,
    detail: {
      connectionId: match.connection_id,
      result,
      homeScore: match.home_score,
      awayScore: match.away_score,
      stats
    }
  });

  return {
    match: serializeSub2ApiWorldCupMatch(getSub2ApiWorldCupMatchById(match.id)),
    stats
  };
}

async function cancelSub2ApiWorldCupMatch(match, actor = "system") {
  if (match.status === sub2apiWorldCupMatchStatuses.settled) {
    const error = new Error("已结算比赛不能取消");
    error.statusCode = 409;
    throw error;
  }
  const connection = getSub2ApiWorldCupConnection(match.connection_id);
  const now = nowIso();
  const bets = db.prepare(`
    SELECT *
    FROM sub2api_worldcup_bets
    WHERE match_id = ?
      AND status IN (?, ?, ?)
    ORDER BY created_at ASC
  `).all(
    match.id,
    sub2apiWorldCupBetStatuses.placed,
    sub2apiWorldCupBetStatuses.payoutFailed,
    sub2apiWorldCupBetStatuses.refundFailed
  );

  const stats = { total: bets.length, refunded: 0, refundFailed: 0 };
  for (const bet of bets) {
    try {
      const refundResult = await adjustSub2ApiWorldCupBalance(connection, bet.sub2api_user_id, {
        amount: Number(bet.stake),
        operation: "add",
        notes: `世界杯竞猜取消退款：${match.home_team} 对阵 ${match.away_team}，投注 ${bet.stake}`,
        idempotencyKey: `worldcup_refund_${bet.id}`
      });
      db.prepare(`
        UPDATE sub2api_worldcup_bets
        SET status = ?, payout = ?, remote_credit_response = ?, error_message = NULL,
            settled_at = ?, updated_at = ?
        WHERE id = ?
      `).run(
        sub2apiWorldCupBetStatuses.refunded,
        Number(bet.stake),
        serializeSub2ApiWorldCupRemoteResult(refundResult),
        now,
        now,
        bet.id
      );
      stats.refunded += 1;
    } catch (error) {
      db.prepare(`
        UPDATE sub2api_worldcup_bets
        SET status = ?, error_message = ?, updated_at = ?
        WHERE id = ?
      `).run(
        sub2apiWorldCupBetStatuses.refundFailed,
        error.message || "退款失败",
        now,
        bet.id
      );
      stats.refundFailed += 1;
    }
  }

  const status = stats.refundFailed > 0
    ? sub2apiWorldCupMatchStatuses.locked
    : sub2apiWorldCupMatchStatuses.cancelled;
  db.prepare(`
    UPDATE sub2api_worldcup_matches
    SET status = ?, updated_at = ?
    WHERE id = ?
  `).run(status, now, match.id);

  createAuditLog({
    action: "sub2api.worldcup.match.cancel",
    actor,
    resourceType: "sub2api_worldcup_match",
    resourceId: match.id,
    detail: { connectionId: match.connection_id, stats }
  });

  return {
    match: serializeSub2ApiWorldCupMatch(getSub2ApiWorldCupMatchById(match.id)),
    stats
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

app.post("/api/public/support/auth", async (request, reply) => {
  const schema = z.object({
    token: z.string().min(1),
    type: z.string().trim().min(1).optional().default("single")
  });
  const parsed = schema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ message: "临时 token 不能为空" });
  }

  const upstream = await callSupportApi("/auth", {
    method: "POST",
    body: {
      token: parsed.data.token.trim(),
      type: parsed.data.type
    }
  });

  if (!upstream.ok) {
    const statusCode = upstream.status >= 400 && upstream.status < 600 ? upstream.status : 400;
    return reply.code(statusCode).send({
      message: getSupportApiMessage(upstream),
      status: upstream.status,
      raw: upstream.json
    });
  }

  return {
    ok: Boolean(upstream.json?.ok ?? upstream.ok),
    sessionId: upstream.json?.session_id ?? null,
    email: upstream.json?.email ?? null,
    supportCookie: upstream.supportCookie || null,
    raw: upstream.json
  };
});

app.get("/api/public/support/account", async (request, reply) => {
  const parsed = z.object({
    token: z.string().optional(),
    sessionId: z.string().optional(),
    supportCookie: z.string().optional()
  }).safeParse(getSupportRequestContext(request));

  if (!parsed.success) {
    return reply.code(400).send({ message: "账号查询参数不正确" });
  }
  if (!parsed.data.token && !parsed.data.sessionId && !parsed.data.supportCookie) {
    return reply.code(400).send({ message: "缺少 support 鉴权信息，请先完成前台验证" });
  }

  const upstream = await callSupportApi("/account", {
    method: "GET",
    authCandidates: buildSupportAuthCandidates(parsed.data)
  });

  if (!upstream.ok) {
    const statusCode = upstream.status >= 400 && upstream.status < 600 ? upstream.status : 400;
    return reply.code(statusCode).send({
      message: getSupportApiMessage(upstream),
      status: upstream.status,
      authMode: upstream.authMode,
      raw: upstream.json
    });
  }

  return {
    email: upstream.json?.email ?? null,
    currentEmail: upstream.json?.current_email ?? null,
    planType: upstream.json?.plan_type ?? null,
    warranty: upstream.json?.warranty ?? null,
    replacements: upstream.json?.replacements ?? null,
    supportCookie: upstream.supportCookie || null,
    authMode: upstream.authMode,
    raw: upstream.json
  };
});

app.get("/api/public/support/otp", async (request, reply) => {
  const parsed = z.object({
    token: z.string().optional(),
    sessionId: z.string().optional(),
    supportCookie: z.string().optional()
  }).safeParse(getSupportRequestContext(request));

  if (!parsed.success) {
    return reply.code(400).send({ message: "验证码查询参数不正确" });
  }
  if (!parsed.data.token && !parsed.data.sessionId && !parsed.data.supportCookie) {
    return reply.code(400).send({ message: "缺少 support 鉴权信息，请先完成前台验证" });
  }

  const upstream = await callSupportApi("/otp", {
    method: "GET",
    authCandidates: buildSupportAuthCandidates(parsed.data)
  });

  if (!upstream.ok) {
    const statusCode = upstream.status >= 400 && upstream.status < 600 ? upstream.status : 400;
    return reply.code(statusCode).send({
      message: getSupportApiMessage(upstream),
      status: upstream.status,
      authMode: upstream.authMode,
      raw: upstream.json
    });
  }

  return {
    otps: Array.isArray(upstream.json?.otps) ? upstream.json.otps : [],
    supportCookie: upstream.supportCookie || null,
    authMode: upstream.authMode,
    raw: upstream.json
  };
});

app.post("/api/public/support/logout", async (request, reply) => {
  const parsed = z.object({
    token: z.string().optional(),
    sessionId: z.string().optional(),
    supportCookie: z.string().optional()
  }).safeParse(getSupportRequestContext(request));

  if (!parsed.success) {
    return reply.code(400).send({ message: "退出参数不正确" });
  }
  if (!parsed.data.token && !parsed.data.sessionId && !parsed.data.supportCookie) {
    return reply.code(400).send({ message: "缺少 support 鉴权信息，请先完成前台验证" });
  }

  const upstream = await callSupportApi("/logout", {
    method: "POST",
    authCandidates: buildSupportAuthCandidates(parsed.data),
    minimalHeaders: true
  });

  if (!upstream.ok) {
    const statusCode = upstream.status >= 400 && upstream.status < 600 ? upstream.status : 400;
    return reply.code(statusCode).send({
      message: getSupportApiMessage(upstream),
      status: upstream.status,
      authMode: upstream.authMode,
      raw: upstream.json
    });
  }

  return {
    ok: Boolean(upstream.json?.ok ?? upstream.ok),
    supportCookie: upstream.supportCookie || null,
    authMode: upstream.authMode,
    raw: upstream.json
  };
});

app.post("/api/public/support/export", async (request, reply) => {
  const parsedAuth = z.object({
    token: z.string().optional(),
    sessionId: z.string().optional(),
    supportCookie: z.string().optional()
  }).safeParse(getSupportRequestContext(request));
  const parsedBody = z.object({
    format: z.enum(["cpa", "sub2api"])
  }).safeParse(request.body);

  if (!parsedAuth.success || !parsedBody.success) {
    return reply.code(400).send({ message: "导出参数不正确" });
  }
  if (!parsedAuth.data.token && !parsedAuth.data.sessionId && !parsedAuth.data.supportCookie) {
    return reply.code(400).send({ message: "缺少 support 鉴权信息，请先完成前台验证" });
  }

  const upstream = await callSupportApi("/export", {
    method: "POST",
    body: { format: parsedBody.data.format },
    authCandidates: buildSupportAuthCandidates(parsedAuth.data)
  });

  if (!upstream.ok) {
    const statusCode = upstream.status >= 400 && upstream.status < 600 ? upstream.status : 400;
    return reply.code(statusCode).send({
      message: getSupportApiMessage(upstream),
      status: upstream.status,
      authMode: upstream.authMode,
      raw: upstream.json
    });
  }

  return {
    ok: Boolean(upstream.json?.ok ?? upstream.ok),
    format: String(upstream.json?.format || parsedBody.data.format),
    data: upstream.json?.data ?? "",
    supportCookie: upstream.supportCookie || null,
    authMode: upstream.authMode
  };
});

app.post("/api/public/support/cdkey-auth", async (request, reply) => {
  const schema = z.object({
    publicKey: z.string().min(6)
  });
  const parsed = schema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ message: "卡密格式不正确" });
  }

  const publicKey = parsed.data.publicKey.trim().toUpperCase();
  const verified = await verifyCdkeyForPublic(publicKey);
  if (!verified) {
    return reply.code(404).send({ message: "卡密不存在" });
  }

  if (!verified.payload.canSupportAccess) {
    return reply.code(400).send({
      message: verified.payload.remoteError || "当前卡密不可用于接码页面",
      ...verified.payload
    });
  }

  if (!verified.emailToken) {
    return {
      ...verified.payload,
      autoAuthorized: false,
      requiresManualToken: false,
      message: "该卡密尚未绑定接码信息，请联系后台重新生成或补录绑定。"
    };
  }

  const supportBundle = await loadSupportBundleByToken(verified.emailToken);
  if (!supportBundle.ok) {
    return {
      ...verified.payload,
      autoAuthorized: false,
      requiresManualToken: false,
      message: `已读取绑定的 email_token，但自动认证失败：${supportBundle.message}`,
      authError: supportBundle.message
    };
  }

  return {
    ...verified.payload,
    autoAuthorized: true,
    requiresManualToken: false,
    message: "已根据卡密绑定的 email_token 自动完成认证。",
    sessionId: supportBundle.sessionId,
    email: supportBundle.email,
    supportCookie: supportBundle.supportCookie,
    account: supportBundle.account,
    accountError: supportBundle.accountError,
    otp: supportBundle.otps,
    otpError: supportBundle.otpError
  };
});

app.post("/api/public/sub2api/session", async (request, reply) => {
  const parsed = z.object({
    sso: z.string().min(20),
    accessToken: z.string().trim().optional().default(""),
    userId: z.union([z.string(), z.number()]).optional().default("")
  }).safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ message: "缺少 SSO token" });
  }

  let selector;
  try {
    selector = decodeSub2ApiSsoSelector(parsed.data.sso);
  } catch (error) {
    return reply.code(400).send({ message: error.message });
  }

  const connection = findSub2ApiConnectionBySelector(selector);
  if (!connection) {
    return reply.code(404).send({ message: "Sub2api 连接不存在或已删除" });
  }
  if (connection.status !== sub2apiConnectionStatuses.active) {
    return reply.code(403).send({ message: "Sub2api 连接已停用" });
  }

  try {
    const adminToken = decryptSub2ApiAdminToken(connection);
    const { identity } = verifySub2ApiSsoToken(parsed.data.sso, adminToken);
    const sessionToken = signSub2ApiSessionToken(connection, identity);
    return buildSub2ApiPublicPayload(connection, identity, sessionToken);
  } catch (error) {
    if (parsed.data.accessToken && /缺少 user\.id/.test(String(error.message || ""))) {
      try {
        const identity = await getSub2ApiIdentityFromAccessToken(connection, parsed.data.accessToken, parsed.data.userId);
        const sessionToken = signSub2ApiSessionToken(connection, identity);
        return buildSub2ApiPublicPayload(connection, identity, sessionToken);
      } catch (tokenError) {
        return reply.code(401).send({ message: tokenError.message || "Sub2api 登录 token 验证失败" });
      }
    }
    return reply.code(401).send({ message: error.message || "SSO token 验证失败" });
  }
});

app.post("/api/public/sub2api/session-from-token", async (request, reply) => {
  const parsed = z.object({
    connectionId: z.string().trim().min(1),
    accessToken: z.string().trim().min(20),
    userId: z.union([z.string(), z.number()]).optional().default("")
  }).safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ message: "缺少连接 ID 或 Sub2api 登录 token" });
  }

  const connection = findSub2ApiConnectionBySelector(parsed.data.connectionId);
  if (!connection) {
    return reply.code(404).send({ message: "Sub2api 连接不存在或已删除" });
  }
  if (connection.status !== sub2apiConnectionStatuses.active) {
    return reply.code(403).send({ message: "Sub2api 连接已停用" });
  }

  try {
    const identity = await getSub2ApiIdentityFromAccessToken(connection, parsed.data.accessToken, parsed.data.userId);
    const sessionToken = signSub2ApiSessionToken(connection, identity);
    return buildSub2ApiPublicPayload(connection, identity, sessionToken);
  } catch (error) {
    return reply.code(401).send({ message: error.message || "Sub2api 登录 token 验证失败" });
  }
});

app.post("/api/public/sub2api/image/session-from-token", async (request, reply) => {
  const parsed = z.object({
    connectionId: z.string().trim().min(1),
    accessToken: z.string().trim().min(20)
  }).safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ message: "缺少连接 ID 或 Sub2api 登录 token" });
  }

  const connection = findSub2ApiConnectionBySelector(parsed.data.connectionId);
  if (!connection) {
    return reply.code(404).send({ message: "Sub2api 连接不存在或已删除" });
  }
  if (connection.status !== sub2apiConnectionStatuses.active) {
    return reply.code(403).send({ message: "Sub2api 连接已停用" });
  }

  try {
    const identity = await getSub2ApiIdentityFromAccessToken(connection, parsed.data.accessToken);
    const sessionToken = signSub2ApiImageSessionToken(connection, identity, parsed.data.accessToken);
    return buildSub2ApiImagePublicPayload(connection, identity, sessionToken);
  } catch (error) {
    return reply.code(401).send({ message: error.message || "Sub2api 登录 token 验证失败" });
  }
});

app.post("/api/public/sub2api/worldcup/session", async (request, reply) => {
  const parsed = z.object({
    sso: z.string().min(20)
  }).safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ message: "缺少 SSO token" });
  }

  let selector;
  try {
    selector = decodeSub2ApiSsoSelector(parsed.data.sso);
  } catch (error) {
    return reply.code(400).send({ message: error.message });
  }

  const connection = findSub2ApiConnectionBySelector(selector);
  if (!connection) {
    return reply.code(404).send({ message: "Sub2api 连接不存在或已删除" });
  }
  if (connection.status !== sub2apiConnectionStatuses.active) {
    return reply.code(403).send({ message: "Sub2api 连接已停用" });
  }

  try {
    const adminToken = decryptSub2ApiAdminToken(connection);
    const { identity } = verifySub2ApiSsoToken(parsed.data.sso, adminToken);
    const sessionToken = signSub2ApiWorldCupSessionToken(connection, identity);
    return await buildSub2ApiWorldCupPublicPayload(connection, identity, sessionToken);
  } catch (error) {
    return reply.code(401).send({ message: error.message || "SSO token 验证失败" });
  }
});

app.post("/api/public/sub2api/worldcup/session-from-token", async (request, reply) => {
  const parsed = z.object({
    connectionId: z.string().trim().min(1),
    accessToken: z.string().trim().min(20)
  }).safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ message: "缺少连接 ID 或 Sub2api 登录 token" });
  }

  const connection = findSub2ApiConnectionBySelector(parsed.data.connectionId);
  if (!connection) {
    return reply.code(404).send({ message: "Sub2api 连接不存在或已删除" });
  }
  if (connection.status !== sub2apiConnectionStatuses.active) {
    return reply.code(403).send({ message: "Sub2api 连接已停用" });
  }

  try {
    const identity = await getSub2ApiIdentityFromAccessToken(connection, parsed.data.accessToken);
    const sessionToken = signSub2ApiWorldCupSessionToken(connection, identity);
    return await buildSub2ApiWorldCupPublicPayload(connection, identity, sessionToken);
  } catch (error) {
    return reply.code(401).send({ message: error.message || "Sub2api 登录 token 验证失败" });
  }
});

app.get("/api/public/sub2api/worldcup/bootstrap", { preHandler: requireSub2ApiWorldCupSession }, async (request, reply) => {
  let connection;
  try {
    connection = getSub2ApiWorldCupConnection(request.sub2apiWorldCup.connectionId);
  } catch (error) {
    return reply.code(error.statusCode || 400).send({ message: error.message });
  }

  return await buildSub2ApiWorldCupPublicPayload(connection, {
    userId: request.sub2apiWorldCup.userId,
    email: request.sub2apiWorldCup.email,
    username: request.sub2apiWorldCup.username
  });
});

app.post("/api/public/sub2api/worldcup/bets", { preHandler: requireSub2ApiWorldCupSession }, async (request, reply) => {
  let connection;
  try {
    connection = getSub2ApiWorldCupConnection(request.sub2apiWorldCup.connectionId);
  } catch (error) {
    return reply.code(error.statusCode || 400).send({ message: error.message });
  }

  const identity = {
    userId: request.sub2apiWorldCup.userId,
    email: request.sub2apiWorldCup.email,
    username: request.sub2apiWorldCup.username
  };

  try {
    const bet = await placeSub2ApiWorldCupBet({ connection, identity, body: request.body });
    const payload = await buildSub2ApiWorldCupPublicPayload(connection, identity, null, { balanceOverride: bet.balanceAfter });
    return reply.code(201).send({ success: true, bet, ...payload });
  } catch (error) {
    return reply.code(error.statusCode || error.status || 400).send({ message: error.message || "竞猜提交失败" });
  }
});

app.get("/api/public/sub2api/image/bootstrap", { preHandler: requireSub2ApiImageSession }, async (request, reply) => {
  let connection;
  try {
    connection = getSub2ApiImageConnection(request.sub2apiImage.connectionId);
  } catch (error) {
    return reply.code(error.statusCode || 400).send({ message: error.message });
  }

  try {
    const keys = await refreshSub2ApiImageKeys(connection, request.sub2apiImage.session, true);
    return buildSub2ApiImagePublicPayload(connection, {
      userId: request.sub2apiImage.userId,
      email: request.sub2apiImage.email,
      username: request.sub2apiImage.username
    }, null, { keys });
  } catch (error) {
    return reply.code(502).send({ message: error.message || "获取 Sub2api 图片 Key 失败" });
  }
});

app.get("/api/public/sub2api/image/keys", { preHandler: requireSub2ApiImageSession }, async (request, reply) => {
  let connection;
  try {
    connection = getSub2ApiImageConnection(request.sub2apiImage.connectionId);
  } catch (error) {
    return reply.code(error.statusCode || 400).send({ message: error.message });
  }

  try {
    return { keys: await refreshSub2ApiImageKeys(connection, request.sub2apiImage.session, true) };
  } catch (error) {
    return reply.code(502).send({ message: error.message || "获取 Sub2api 图片 Key 失败" });
  }
});

app.post("/api/public/sub2api/image/jobs", {
  preHandler: requireSub2ApiImageSession,
  bodyLimit: SUB2API_IMAGE_BODY_LIMIT
}, async (request, reply) => {
  let prepared;
  try {
    prepared = prepareSub2ApiImageGenerateRequest(request.body);
  } catch (error) {
    return reply.code(error.statusCode || 400).send({ message: error.message || "图片生成参数不正确" });
  }

  let connection;
  try {
    connection = getSub2ApiImageConnection(request.sub2apiImage.connectionId);
  } catch (error) {
    return reply.code(error.statusCode || 400).send({ message: error.message });
  }

  const jobId = nanoid(16);
  const job = {
    id: jobId,
    status: "queued",
    connectionId: connection.id,
    sub2apiUserId: request.sub2apiImage.userId,
    mode: prepared.payload.mode,
    model: prepared.model,
    quality: prepared.quality,
    outputFormat: prepared.outputFormat,
    aspectRatio: prepared.aspectRatio,
    count: prepared.payload.count,
    createdAt: nowIso(),
    startedAt: null,
    endedAt: null,
    expiresAtMs: Date.now() + SUB2API_IMAGE_JOB_TTL_MS,
    error: "",
    result: null
  };
  sub2apiImageJobs.set(jobId, job);

  setTimeout(() => {
    void runSub2ApiImageJob(job, {
      payload: prepared.payload,
      connection,
      imageSession: request.sub2apiImage.session,
      model: prepared.model,
      quality: prepared.quality,
      outputFormat: prepared.outputFormat,
      aspectRatio: prepared.aspectRatio,
      size: prepared.size
    });
  }, 0);

  return reply.code(202).send(serializeSub2ApiImageJob(job));
});

app.get("/api/public/sub2api/image/jobs/:jobId", { preHandler: requireSub2ApiImageSession }, async (request, reply) => {
  const jobId = String(request.params?.jobId || "").trim();
  const job = sub2apiImageJobs.get(jobId);
  if (!job || job.expiresAtMs <= Date.now()) {
    if (job) sub2apiImageJobs.delete(job.id);
    return reply.code(404).send({ message: "图片任务不存在或已过期" });
  }
  if (job.connectionId !== request.sub2apiImage.connectionId || job.sub2apiUserId !== request.sub2apiImage.userId) {
    return reply.code(403).send({ message: "无权查看该图片任务" });
  }
  return serializeSub2ApiImageJob(job);
});

app.post("/api/public/sub2api/image/generate", {
  preHandler: requireSub2ApiImageSession,
  bodyLimit: SUB2API_IMAGE_BODY_LIMIT
}, async (request, reply) => {
  let prepared;
  try {
    prepared = prepareSub2ApiImageGenerateRequest(request.body);
  } catch (error) {
    return reply.code(error.statusCode || 400).send({ message: error.message || "图片生成参数不正确" });
  }

  let connection;
  try {
    connection = getSub2ApiImageConnection(request.sub2apiImage.connectionId);
  } catch (error) {
    return reply.code(error.statusCode || 400).send({ message: error.message });
  }

  const jobId = nanoid(16);
  const startedAt = Date.now();
  try {
    return await completeSub2ApiImageGeneration({
      jobId,
      startedAt,
      payload: prepared.payload,
      connection,
      imageSession: request.sub2apiImage.session,
      model: prepared.model,
      quality: prepared.quality,
      outputFormat: prepared.outputFormat,
      aspectRatio: prepared.aspectRatio,
      size: prepared.size
    });
  } catch (error) {
    auditSub2ApiImageGenerateFailure({
      jobId,
      payload: prepared.payload,
      connection,
      imageSession: request.sub2apiImage.session,
      model: prepared.model,
      error
    });
    return reply.code(error.status ? 502 : 400).send({ message: error.message || "图片生成失败" });
  }
});

app.get("/api/public/sub2api/invites", { preHandler: requireSub2ApiSession }, async (request, reply) => {
  const connection = db.prepare(`
    SELECT *
    FROM sub2api_connections
    WHERE id = ? AND status <> ?
  `).get(request.sub2api.connectionId, sub2apiConnectionStatuses.deleted);
  if (!connection) {
    return reply.code(404).send({ message: "Sub2api 连接不存在或已删除" });
  }
  if (connection.status !== sub2apiConnectionStatuses.active) {
    return reply.code(403).send({ message: "Sub2api 连接已停用" });
  }

  return buildSub2ApiPublicPayload(connection, {
    userId: request.sub2api.userId,
    email: request.sub2api.email,
    username: request.sub2api.username
  });
});

app.post("/api/public/sub2api/invites/apply", { preHandler: requireSub2ApiSession }, async (request, reply) => {
  const connection = db.prepare(`
    SELECT *
    FROM sub2api_connections
    WHERE id = ? AND status <> ?
  `).get(request.sub2api.connectionId, sub2apiConnectionStatuses.deleted);
  if (!connection) {
    return reply.code(404).send({ message: "Sub2api 连接不存在或已删除" });
  }
  if (connection.status !== sub2apiConnectionStatuses.active) {
    return reply.code(403).send({ message: "Sub2api 连接已停用" });
  }

  const now = nowIso();
  const inviteId = nanoid(16);
  const requestId = `sub2api_${Date.now()}_${nanoid(8)}`;
  const identity = {
    userId: request.sub2api.userId,
    email: request.sub2api.email,
    username: request.sub2api.username
  };
  const reserved = reserveSub2ApiInvite(db, {
    id: inviteId,
    requestId,
    connectionId: connection.id,
    userId: identity.userId,
    email: identity.email,
    username: identity.username,
    now
  }, SUB2API_INVITE_LIMIT);

  if (!reserved.ok) {
    return reply.code(403).send({
      message: `每个账号最多申请 ${SUB2API_INVITE_LIMIT} 个邀请码`,
      inviteLimit: reserved.quota.limit,
      used: reserved.quota.used,
      remaining: reserved.quota.remaining
    });
  }

  try {
    const remoteResult = await callSub2ApiRemote(connection, "/api/v1/admin/redeem-codes/generate", {
      method: "POST",
      headers: {
        "Idempotency-Key": requestId
      },
      body: {
        count: 1,
        type: "invitation",
        value: 0
      }
    });
    const inviteResult = extractRemoteSub2ApiInviteResult(remoteResult);
    const updatedAt = nowIso();
    db.prepare(`
      UPDATE sub2api_invites
      SET invite_code = ?, remote_invite_id = ?, status = ?, remote_response = ?, expires_at = ?, updated_at = ?
      WHERE id = ?
    `).run(
      inviteResult.inviteCode,
      inviteResult.remoteInviteId || null,
      inviteResult.status,
      null,
      inviteResult.expiresAt,
      updatedAt,
      inviteId
    );

    createAuditLog({
      action: "sub2api.invite.apply",
      actor: "public",
      resourceType: "sub2api_invite",
      resourceId: inviteId,
      detail: {
        connectionId: connection.id,
        sub2apiUserId: identity.userId,
        requestId
      }
    });

    const row = db.prepare(`
      SELECT i.*, c.name AS connection_name, c.base_url AS connection_base_url
      FROM sub2api_invites i
      LEFT JOIN sub2api_connections c ON c.id = i.connection_id
      WHERE i.id = ?
    `).get(inviteId);
    const quota = getSub2ApiInviteQuota(db, connection.id, identity.userId, SUB2API_INVITE_LIMIT);
    return {
      success: true,
      invite: serializeSub2ApiInvite(row),
      inviteLimit: quota.limit,
      used: quota.used,
      remaining: quota.remaining,
      invites: getSub2ApiPublicInvites(connection.id, identity.userId)
    };
  } catch (error) {
    const failedAt = nowIso();
    db.prepare(`
      UPDATE sub2api_invites
      SET status = ?, remote_response = ?, error_message = ?, updated_at = ?
      WHERE id = ?
    `).run(
      sub2apiInviteStatuses.failed,
      null,
      error.message || "远程 Sub2api 创建邀请码失败",
      failedAt,
      inviteId
    );
    return reply.code(502).send({
      message: error.message || "远程 Sub2api 创建邀请码失败",
      inviteLimit: SUB2API_INVITE_LIMIT,
      used: countReservedSub2ApiInvites(db, connection.id, identity.userId),
      remaining: Math.max(0, SUB2API_INVITE_LIMIT - countReservedSub2ApiInvites(db, connection.id, identity.userId))
    });
  }
});

app.get("/api/public/sub2api/subscriptions", { preHandler: requireSub2ApiSession }, async (request, reply) => {
  const connection = db.prepare(`
    SELECT *
    FROM sub2api_connections
    WHERE id = ? AND status <> ?
  `).get(request.sub2api.connectionId, sub2apiConnectionStatuses.deleted);
  if (!connection) {
    return reply.code(404).send({ message: "Sub2api 连接不存在或已删除" });
  }
  if (connection.status !== sub2apiConnectionStatuses.active) {
    return reply.code(403).send({ message: "Sub2api 连接已停用" });
  }

  return buildSub2ApiSubscriptionPublicPayload(connection, {
    userId: request.sub2api.userId,
    email: request.sub2api.email,
    username: request.sub2api.username
  });
});

app.post("/api/public/sub2api/subscriptions/purchase", { preHandler: requireSub2ApiSession }, async (request, reply) => {
  const parsed = z.object({
    planId: z.string().trim().min(1)
  }).safeParse(getBodyObject(request.body));
  if (!parsed.success) {
    return reply.code(400).send({ message: "请选择套餐" });
  }

  const connection = db.prepare(`
    SELECT *
    FROM sub2api_connections
    WHERE id = ? AND status <> ?
  `).get(request.sub2api.connectionId, sub2apiConnectionStatuses.deleted);
  if (!connection) {
    return reply.code(404).send({ message: "Sub2api 连接不存在或已删除" });
  }
  if (connection.status !== sub2apiConnectionStatuses.active) {
    return reply.code(403).send({ message: "Sub2api 连接已停用" });
  }

  const plan = db.prepare(`
    SELECT *
    FROM sub2api_subscription_plans
    WHERE id = ? AND connection_id = ? AND status = ?
  `).get(parsed.data.planId, connection.id, sub2apiSubscriptionPlanStatuses.active);
  if (!plan) {
    return reply.code(404).send({ message: "套餐不存在或已下架" });
  }

  const userId = normalizeSub2ApiPositiveInteger(request.sub2api.userId, "用户 ID");
  const orderId = nanoid(16);
  const requestId = `sub2api_sub_${Date.now()}_${nanoid(8)}`;
  const now = nowIso();
  db.prepare(`
    INSERT INTO sub2api_subscription_orders (
      id, request_id, plan_id, connection_id, sub2api_user_id, email, username,
      price, subscription_group_id, source_dedicated_group_id, dedicated_group_id, validity_days,
      status, remote_balance_response, remote_subscription_response, error_message,
      created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?)
  `).run(
    orderId,
    requestId,
    plan.id,
    connection.id,
    request.sub2api.userId,
    request.sub2api.email || null,
    request.sub2api.username || null,
    plan.price,
    plan.subscription_group_id,
    plan.source_dedicated_group_id,
    plan.dedicated_group_id,
    plan.validity_days,
    sub2apiSubscriptionOrderStatuses.processing,
    now,
    now
  );

  let balanceResult = null;
  let subscriptionResult = null;
  let dedicatedGroupResult = null;
  let dedicatedGroupWarning = "";
  try {
    balanceResult = await callSub2ApiRemote(connection, `/api/v1/admin/users/${encodeURIComponent(String(userId))}/balance`, {
      method: "POST",
      headers: { "Idempotency-Key": `${requestId}:balance` },
      body: {
        balance: Number(plan.price),
        operation: "subtract",
        notes: `KaWang 订阅套餐扣款：${plan.name}，订单 ${orderId}`
      }
    });

    subscriptionResult = await callSub2ApiRemote(connection, "/api/v1/admin/subscriptions/assign", {
      method: "POST",
      headers: { "Idempotency-Key": `${requestId}:subscription` },
      body: {
        user_id: userId,
        group_id: Number(plan.subscription_group_id),
        validity_days: Number(plan.validity_days),
        notes: `KaWang 余额购买套餐：${plan.name}，订单 ${orderId}${plan.dedicated_group_id ? `，专属分组 ${plan.dedicated_group_id}` : ""}`
      }
    });

    try {
      dedicatedGroupResult = await tryAssignSub2ApiDedicatedGroup(
        connection,
        userId,
        plan.source_dedicated_group_id,
        plan.dedicated_group_id,
        orderId
      );
    } catch (dedicatedError) {
      dedicatedGroupWarning = dedicatedError.message || "专属分组分配失败";
    }

    const updatedAt = nowIso();
    db.prepare(`
      UPDATE sub2api_subscription_orders
      SET status = ?, remote_balance_response = ?, remote_subscription_response = ?, error_message = ?, updated_at = ?
      WHERE id = ?
    `).run(
      sub2apiSubscriptionOrderStatuses.succeeded,
      JSON.stringify(balanceResult.json ?? balanceResult.text ?? null),
      JSON.stringify({
        subscription: subscriptionResult.json ?? subscriptionResult.text ?? null,
        dedicatedGroup: dedicatedGroupResult?.json ?? dedicatedGroupResult?.text ?? null
      }),
      dedicatedGroupWarning || null,
      updatedAt,
      orderId
    );

    createAuditLog({
      action: "sub2api.subscription.purchase",
      actor: "public",
      resourceType: "sub2api_subscription_order",
      resourceId: orderId,
      detail: {
        connectionId: connection.id,
        sub2apiUserId: request.sub2api.userId,
        planId: plan.id,
        price: Number(plan.price),
        subscriptionGroupId: Number(plan.subscription_group_id),
        dedicatedGroupId: plan.dedicated_group_id,
        validityDays: Number(plan.validity_days)
      }
    });

    const row = db.prepare(`
      SELECT o.*, p.name AS plan_name, c.name AS connection_name
      FROM sub2api_subscription_orders o
      LEFT JOIN sub2api_subscription_plans p ON p.id = o.plan_id
      LEFT JOIN sub2api_connections c ON c.id = o.connection_id
      WHERE o.id = ?
    `).get(orderId);
    return {
      success: true,
      order: serializeSub2ApiSubscriptionOrder(row),
      plans: getSub2ApiPublicSubscriptionPlans(connection.id),
      orders: getSub2ApiPublicSubscriptionOrders(connection.id, request.sub2api.userId)
    };
  } catch (error) {
    let rollbackError = "";
    if (balanceResult && !subscriptionResult) {
      try {
        await callSub2ApiRemote(connection, `/api/v1/admin/users/${encodeURIComponent(String(userId))}/balance`, {
          method: "POST",
          headers: { "Idempotency-Key": `${requestId}:rollback` },
          body: {
            balance: Number(plan.price),
            operation: "add",
            notes: `KaWang 订阅套餐开通失败退款：${plan.name}，订单 ${orderId}`
          }
        });
      } catch (rollback) {
        rollbackError = rollback.message || "退款失败";
      }
    }

    const message = [error.message || "购买失败", rollbackError ? `退款失败：${rollbackError}` : ""].filter(Boolean).join("；");
    db.prepare(`
      UPDATE sub2api_subscription_orders
      SET status = ?, remote_balance_response = ?, remote_subscription_response = ?, error_message = ?, updated_at = ?
      WHERE id = ?
    `).run(
      sub2apiSubscriptionOrderStatuses.failed,
      balanceResult ? JSON.stringify(balanceResult.json ?? balanceResult.text ?? null) : null,
      subscriptionResult ? JSON.stringify(subscriptionResult.json ?? subscriptionResult.text ?? null) : null,
      message,
      nowIso(),
      orderId
    );
    return reply.code(502).send({ message });
  }
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
  const verified = await verifyCdkeyForPublic(publicKey);
  if (!verified) {
    return reply.code(404).send({ message: "卡密不存在" });
  }
  return verified.payload;
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
        c.metadata AS cdkey_metadata,
        c.site_id,
        s.*
      FROM cdkeys c
      LEFT JOIN sites s ON s.id = c.site_id
      WHERE c.public_key = ?
    `).get(publicKey);

    if (!preflight) {
      return reply.code(404).send({ message: "卡密不存在" });
    }
    if (isSupportOnlyCdkey(preflight.cdkey_metadata)) {
      return reply.code(400).send({ message: "该卡密为接码专用卡密，请在接码验证页使用" });
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
      if (isSupportOnlyCdkey(cdkey.metadata)) {
        throw new Error("该卡密为接码专用卡密，请在接码验证页使用");
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

app.get("/api/admin/sub2api/connections", { preHandler: requireAdmin }, async () => {
  const rows = db.prepare(`
    SELECT *
    FROM sub2api_connections
    WHERE status <> ?
    ORDER BY created_at DESC
  `).all(sub2apiConnectionStatuses.deleted);
  return { items: rows.map(serializeSub2ApiConnection) };
});

app.post("/api/admin/sub2api/connections", { preHandler: requireAdmin }, async (request, reply) => {
  const parsed = z.object({
    name: z.string().trim().min(1),
    baseUrl: z.string().trim().min(1),
    adminToken: z.string().trim().min(1),
    status: z.enum([sub2apiConnectionStatuses.active, sub2apiConnectionStatuses.disabled]).optional().default(sub2apiConnectionStatuses.active)
  }).safeParse(getBodyObject(request.body));
  if (!parsed.success) {
    return reply.code(400).send({ message: "请提供名称、baseUrl 和 adminToken" });
  }

  let baseUrl;
  try {
    baseUrl = normalizeSub2ApiBaseUrl(parsed.data.baseUrl);
  } catch (error) {
    return reply.code(400).send({ message: error.message });
  }

  const exists = db.prepare(`
    SELECT id FROM sub2api_connections
    WHERE base_url = ? AND status <> ?
  `).get(baseUrl, sub2apiConnectionStatuses.deleted);
  if (exists) {
    return reply.code(409).send({ message: "该 Sub2api baseUrl 已存在" });
  }

  const now = nowIso();
  const id = nanoid(16);
  db.prepare(`
    INSERT INTO sub2api_connections (
      id, name, base_url, admin_token, status,
      last_test_at, last_test_status, last_test_error,
      created_by, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?)
  `).run(
    id,
    parsed.data.name,
    baseUrl,
    encryptText(parsed.data.adminToken),
    parsed.data.status,
    request.admin.username,
    now,
    now
  );

  createAuditLog({
    action: "sub2api.connection.create",
    actor: request.admin.username,
    resourceType: "sub2api_connection",
    resourceId: id,
    detail: { baseUrl, status: parsed.data.status }
  });

  const row = db.prepare("SELECT * FROM sub2api_connections WHERE id = ?").get(id);
  return { item: serializeSub2ApiConnection(row) };
});

app.patch("/api/admin/sub2api/connections/:id", { preHandler: requireAdmin }, async (request, reply) => {
  const id = String(request.params.id || "").trim();
  const existing = db.prepare(`
    SELECT *
    FROM sub2api_connections
    WHERE id = ? AND status <> ?
  `).get(id, sub2apiConnectionStatuses.deleted);
  if (!existing) {
    return reply.code(404).send({ message: "Sub2api 连接不存在" });
  }

  const parsed = z.object({
    name: z.string().trim().min(1).optional(),
    baseUrl: z.string().trim().min(1).optional(),
    adminToken: z.string().trim().optional(),
    status: z.enum([sub2apiConnectionStatuses.active, sub2apiConnectionStatuses.disabled]).optional()
  }).safeParse(getBodyObject(request.body));
  if (!parsed.success) {
    return reply.code(400).send({ message: "连接参数不正确" });
  }

  let baseUrl = existing.base_url;
  if (parsed.data.baseUrl !== undefined) {
    try {
      baseUrl = normalizeSub2ApiBaseUrl(parsed.data.baseUrl);
    } catch (error) {
      return reply.code(400).send({ message: error.message });
    }
    const duplicate = db.prepare(`
      SELECT id FROM sub2api_connections
      WHERE base_url = ? AND id <> ? AND status <> ?
    `).get(baseUrl, id, sub2apiConnectionStatuses.deleted);
    if (duplicate) {
      return reply.code(409).send({ message: "该 Sub2api baseUrl 已存在" });
    }
  }

  const adminToken = parsed.data.adminToken
    ? encryptText(parsed.data.adminToken)
    : existing.admin_token;
  const now = nowIso();
  db.prepare(`
    UPDATE sub2api_connections
    SET name = ?, base_url = ?, admin_token = ?, status = ?, updated_at = ?
    WHERE id = ?
  `).run(
    parsed.data.name ?? existing.name,
    baseUrl,
    adminToken,
    parsed.data.status ?? existing.status,
    now,
    id
  );

  createAuditLog({
    action: "sub2api.connection.update",
    actor: request.admin.username,
    resourceType: "sub2api_connection",
    resourceId: id,
    detail: { baseUrl, status: parsed.data.status ?? existing.status, tokenUpdated: Boolean(parsed.data.adminToken) }
  });

  const row = db.prepare("SELECT * FROM sub2api_connections WHERE id = ?").get(id);
  return { item: serializeSub2ApiConnection(row) };
});

app.delete("/api/admin/sub2api/connections/:id", { preHandler: requireAdmin }, async (request, reply) => {
  const id = String(request.params.id || "").trim();
  const existing = db.prepare(`
    SELECT *
    FROM sub2api_connections
    WHERE id = ? AND status <> ?
  `).get(id, sub2apiConnectionStatuses.deleted);
  if (!existing) {
    return reply.code(404).send({ message: "Sub2api 连接不存在" });
  }

  const now = nowIso();
  db.prepare(`
    UPDATE sub2api_connections
    SET status = ?, admin_token = ?, updated_at = ?
    WHERE id = ?
  `).run(sub2apiConnectionStatuses.deleted, encryptText(""), now, id);

  createAuditLog({
    action: "sub2api.connection.delete",
    actor: request.admin.username,
    resourceType: "sub2api_connection",
    resourceId: id
  });

  return { success: true, id };
});

app.post("/api/admin/sub2api/connections/:id/test", { preHandler: requireAdmin }, async (request, reply) => {
  const id = String(request.params.id || "").trim();
  const connection = db.prepare(`
    SELECT *
    FROM sub2api_connections
    WHERE id = ? AND status <> ?
  `).get(id, sub2apiConnectionStatuses.deleted);
  if (!connection) {
    return reply.code(404).send({ message: "Sub2api 连接不存在" });
  }

  const now = nowIso();
  try {
    const result = await testSub2ApiConnection(connection);
    db.prepare(`
      UPDATE sub2api_connections
      SET last_test_at = ?, last_test_status = ?, last_test_error = NULL, updated_at = ?
      WHERE id = ?
    `).run(now, "ok", now, id);
    createAuditLog({
      action: "sub2api.connection.test",
      actor: request.admin.username,
      resourceType: "sub2api_connection",
      resourceId: id,
      detail: { ok: true, status: result.status }
    });
    const row = db.prepare("SELECT * FROM sub2api_connections WHERE id = ?").get(id);
    return { ok: true, item: serializeSub2ApiConnection(row) };
  } catch (error) {
    db.prepare(`
      UPDATE sub2api_connections
      SET last_test_at = ?, last_test_status = ?, last_test_error = ?, updated_at = ?
      WHERE id = ?
    `).run(now, "failed", error.message || "测试连接失败", now, id);
    return reply.code(502).send({ ok: false, message: error.message || "测试连接失败" });
  }
});

app.get("/api/admin/sub2api/invites", { preHandler: requireAdmin }, async (request) => {
  const page = Math.max(1, Math.floor(Number(request.query.page) || 1));
  const pageSize = Math.min(200, Math.max(1, Math.floor(Number(request.query.pageSize) || 50)));
  const offset = (page - 1) * pageSize;
  const conditions = [];
  const params = [];

  const connectionId = String(request.query.connectionId || "").trim();
  if (connectionId) {
    conditions.push("i.connection_id = ?");
    params.push(connectionId);
  }

  const userId = String(request.query.userId || "").trim();
  if (userId) {
    conditions.push("i.sub2api_user_id LIKE ?");
    params.push(`%${userId}%`);
  }

  const status = String(request.query.status || "").trim();
  const allowedStatuses = new Set([
    sub2apiInviteStatuses.processing,
    sub2apiInviteStatuses.active,
    sub2apiInviteStatuses.failed
  ]);
  if (status && allowedStatuses.has(status)) {
    conditions.push("i.status = ?");
    params.push(status);
  }

  const whereSql = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const total = db.prepare(`
    SELECT COUNT(*) AS count
    FROM sub2api_invites i
    ${whereSql}
  `).get(...params).count;
  const rows = db.prepare(`
    SELECT i.*, c.name AS connection_name, c.base_url AS connection_base_url
    FROM sub2api_invites i
    LEFT JOIN sub2api_connections c ON c.id = i.connection_id
    ${whereSql}
    ORDER BY i.created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, pageSize, offset);

  return {
    items: rows.map(serializeSub2ApiInvite),
    total,
    page,
    pageSize
  };
});

app.get("/api/admin/sub2api/subscription-plans", { preHandler: requireAdmin }, async (request) => {
  const connectionId = String(request.query.connectionId || "").trim();
  const conditions = ["p.status <> ?"];
  const params = [sub2apiSubscriptionPlanStatuses.deleted];
  if (connectionId) {
    conditions.push("p.connection_id = ?");
    params.push(connectionId);
  }
  const rows = db.prepare(`
    SELECT p.*, c.name AS connection_name, c.base_url AS connection_base_url
    FROM sub2api_subscription_plans p
    LEFT JOIN sub2api_connections c ON c.id = p.connection_id
    WHERE ${conditions.join(" AND ")}
    ORDER BY p.sort_order ASC, p.created_at DESC
  `).all(...params);
  return { items: rows.map(serializeSub2ApiSubscriptionPlan) };
});

app.post("/api/admin/sub2api/subscription-plans", { preHandler: requireAdmin }, async (request, reply) => {
  const parsed = z.object({
    connectionId: z.string().trim().min(1),
    name: z.string().trim().min(1),
    description: z.string().trim().optional().default(""),
    price: z.union([z.number(), z.string()]),
    subscriptionGroupId: z.union([z.number(), z.string()]),
    sourceDedicatedGroupId: z.union([z.number(), z.string(), z.null()]).optional().default(null),
    dedicatedGroupId: z.union([z.number(), z.string(), z.null()]).optional().default(null),
    validityDays: z.union([z.number(), z.string()]),
    sortOrder: z.union([z.number(), z.string()]).optional().default(0),
    status: z.enum([sub2apiSubscriptionPlanStatuses.active, sub2apiSubscriptionPlanStatuses.disabled]).optional().default(sub2apiSubscriptionPlanStatuses.active)
  }).safeParse(getBodyObject(request.body));
  if (!parsed.success) {
    return reply.code(400).send({ message: "套餐参数不正确" });
  }

  const connection = getSub2ApiConnectionById(parsed.data.connectionId);
  if (!connection || connection.status === sub2apiConnectionStatuses.deleted) {
    return reply.code(404).send({ message: "Sub2api 连接不存在" });
  }

  let price;
  let subscriptionGroupId;
  let sourceDedicatedGroupId = null;
  let dedicatedGroupId = null;
  let validityDays;
  try {
    price = normalizeSub2ApiAmount(parsed.data.price);
    subscriptionGroupId = normalizeSub2ApiPositiveInteger(parsed.data.subscriptionGroupId, "订阅分组 ID");
    if (parsed.data.sourceDedicatedGroupId !== null && String(parsed.data.sourceDedicatedGroupId).trim()) {
      sourceDedicatedGroupId = normalizeSub2ApiPositiveInteger(parsed.data.sourceDedicatedGroupId, "原专属分组 ID");
    }
    if (parsed.data.dedicatedGroupId !== null && String(parsed.data.dedicatedGroupId).trim()) {
      dedicatedGroupId = normalizeSub2ApiPositiveInteger(parsed.data.dedicatedGroupId, "专属分组 ID");
    }
    validityDays = normalizeSub2ApiPositiveInteger(parsed.data.validityDays, "有效天数");
  } catch (error) {
    return reply.code(400).send({ message: error.message });
  }

  const now = nowIso();
  const id = nanoid(16);
  db.prepare(`
    INSERT INTO sub2api_subscription_plans (
      id, connection_id, name, description, price, subscription_group_id, source_dedicated_group_id, dedicated_group_id,
      validity_days, sort_order, status, created_by, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    parsed.data.connectionId,
    parsed.data.name,
    parsed.data.description || null,
    price,
    subscriptionGroupId,
    sourceDedicatedGroupId,
    dedicatedGroupId,
    validityDays,
    Math.floor(Number(parsed.data.sortOrder) || 0),
    parsed.data.status,
    request.admin.username,
    now,
    now
  );

  createAuditLog({
    action: "sub2api.subscription_plan.create",
    actor: request.admin.username,
    resourceType: "sub2api_subscription_plan",
    resourceId: id,
    detail: { connectionId: parsed.data.connectionId, price, subscriptionGroupId, sourceDedicatedGroupId, dedicatedGroupId, validityDays }
  });

  const row = db.prepare(`
    SELECT p.*, c.name AS connection_name, c.base_url AS connection_base_url
    FROM sub2api_subscription_plans p
    LEFT JOIN sub2api_connections c ON c.id = p.connection_id
    WHERE p.id = ?
  `).get(id);
  return { item: serializeSub2ApiSubscriptionPlan(row) };
});

app.patch("/api/admin/sub2api/subscription-plans/:id", { preHandler: requireAdmin }, async (request, reply) => {
  const id = String(request.params.id || "").trim();
  const existing = db.prepare(`
    SELECT *
    FROM sub2api_subscription_plans
    WHERE id = ? AND status <> ?
  `).get(id, sub2apiSubscriptionPlanStatuses.deleted);
  if (!existing) {
    return reply.code(404).send({ message: "套餐不存在" });
  }

  const parsed = z.object({
    connectionId: z.string().trim().min(1).optional(),
    name: z.string().trim().min(1).optional(),
    description: z.string().trim().optional(),
    price: z.union([z.number(), z.string()]).optional(),
    subscriptionGroupId: z.union([z.number(), z.string()]).optional(),
    sourceDedicatedGroupId: z.union([z.number(), z.string(), z.null()]).optional(),
    dedicatedGroupId: z.union([z.number(), z.string(), z.null()]).optional(),
    validityDays: z.union([z.number(), z.string()]).optional(),
    sortOrder: z.union([z.number(), z.string()]).optional(),
    status: z.enum([sub2apiSubscriptionPlanStatuses.active, sub2apiSubscriptionPlanStatuses.disabled]).optional()
  }).safeParse(getBodyObject(request.body));
  if (!parsed.success) {
    return reply.code(400).send({ message: "套餐参数不正确" });
  }

  const connectionId = parsed.data.connectionId ?? existing.connection_id;
  const connection = getSub2ApiConnectionById(connectionId);
  if (!connection || connection.status === sub2apiConnectionStatuses.deleted) {
    return reply.code(404).send({ message: "Sub2api 连接不存在" });
  }

  let price = Number(existing.price);
  let subscriptionGroupId = Number(existing.subscription_group_id);
  let sourceDedicatedGroupId = existing.source_dedicated_group_id === null ? null : Number(existing.source_dedicated_group_id);
  let dedicatedGroupId = existing.dedicated_group_id === null ? null : Number(existing.dedicated_group_id);
  let validityDays = Number(existing.validity_days);
  try {
    if (parsed.data.price !== undefined) price = normalizeSub2ApiAmount(parsed.data.price);
    if (parsed.data.subscriptionGroupId !== undefined) {
      subscriptionGroupId = normalizeSub2ApiPositiveInteger(parsed.data.subscriptionGroupId, "订阅分组 ID");
    }
    if (parsed.data.sourceDedicatedGroupId !== undefined) {
      sourceDedicatedGroupId = parsed.data.sourceDedicatedGroupId === null || !String(parsed.data.sourceDedicatedGroupId).trim()
        ? null
        : normalizeSub2ApiPositiveInteger(parsed.data.sourceDedicatedGroupId, "原专属分组 ID");
    }
    if (parsed.data.dedicatedGroupId !== undefined) {
      dedicatedGroupId = parsed.data.dedicatedGroupId === null || !String(parsed.data.dedicatedGroupId).trim()
        ? null
        : normalizeSub2ApiPositiveInteger(parsed.data.dedicatedGroupId, "专属分组 ID");
    }
    if (parsed.data.validityDays !== undefined) {
      validityDays = normalizeSub2ApiPositiveInteger(parsed.data.validityDays, "有效天数");
    }
  } catch (error) {
    return reply.code(400).send({ message: error.message });
  }

  db.prepare(`
    UPDATE sub2api_subscription_plans
    SET connection_id = ?, name = ?, description = ?, price = ?, subscription_group_id = ?,
        source_dedicated_group_id = ?, dedicated_group_id = ?, validity_days = ?, sort_order = ?, status = ?, updated_at = ?
    WHERE id = ?
  `).run(
    connectionId,
    parsed.data.name ?? existing.name,
    parsed.data.description ?? existing.description,
    price,
    subscriptionGroupId,
    sourceDedicatedGroupId,
    dedicatedGroupId,
    validityDays,
    parsed.data.sortOrder === undefined ? existing.sort_order : Math.floor(Number(parsed.data.sortOrder) || 0),
    parsed.data.status ?? existing.status,
    nowIso(),
    id
  );

  createAuditLog({
    action: "sub2api.subscription_plan.update",
    actor: request.admin.username,
    resourceType: "sub2api_subscription_plan",
    resourceId: id
  });

  const row = db.prepare(`
    SELECT p.*, c.name AS connection_name, c.base_url AS connection_base_url
    FROM sub2api_subscription_plans p
    LEFT JOIN sub2api_connections c ON c.id = p.connection_id
    WHERE p.id = ?
  `).get(id);
  return { item: serializeSub2ApiSubscriptionPlan(row) };
});

app.delete("/api/admin/sub2api/subscription-plans/:id", { preHandler: requireAdmin }, async (request, reply) => {
  const id = String(request.params.id || "").trim();
  const existing = db.prepare(`
    SELECT id
    FROM sub2api_subscription_plans
    WHERE id = ? AND status <> ?
  `).get(id, sub2apiSubscriptionPlanStatuses.deleted);
  if (!existing) {
    return reply.code(404).send({ message: "套餐不存在" });
  }
  db.prepare(`
    UPDATE sub2api_subscription_plans
    SET status = ?, updated_at = ?
    WHERE id = ?
  `).run(sub2apiSubscriptionPlanStatuses.deleted, nowIso(), id);
  createAuditLog({
    action: "sub2api.subscription_plan.delete",
    actor: request.admin.username,
    resourceType: "sub2api_subscription_plan",
    resourceId: id
  });
  return { success: true, id };
});

app.get("/api/admin/sub2api/subscription-orders", { preHandler: requireAdmin }, async (request) => {
  const page = Math.max(1, Math.floor(Number(request.query.page) || 1));
  const pageSize = Math.min(200, Math.max(1, Math.floor(Number(request.query.pageSize) || 50)));
  const offset = (page - 1) * pageSize;
  const conditions = [];
  const params = [];
  const connectionId = String(request.query.connectionId || "").trim();
  if (connectionId) {
    conditions.push("o.connection_id = ?");
    params.push(connectionId);
  }
  const userId = String(request.query.userId || "").trim();
  if (userId) {
    conditions.push("o.sub2api_user_id LIKE ?");
    params.push(`%${userId}%`);
  }
  const status = String(request.query.status || "").trim();
  if (Object.values(sub2apiSubscriptionOrderStatuses).includes(status)) {
    conditions.push("o.status = ?");
    params.push(status);
  }
  const whereSql = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const total = db.prepare(`SELECT COUNT(*) AS count FROM sub2api_subscription_orders o ${whereSql}`).get(...params).count;
  const rows = db.prepare(`
    SELECT o.*, p.name AS plan_name, c.name AS connection_name
    FROM sub2api_subscription_orders o
    LEFT JOIN sub2api_subscription_plans p ON p.id = o.plan_id
    LEFT JOIN sub2api_connections c ON c.id = o.connection_id
    ${whereSql}
    ORDER BY o.created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, pageSize, offset);
  return {
    items: rows.map(serializeSub2ApiSubscriptionOrder),
    total,
    page,
    pageSize
  };
});

function buildApiFootballAdminPayload() {
  const settings = getApiFootballSettings(db);
  const usage = getApiFootballQuotaSnapshot(db, {
    date: getApiFootballUsageDate(new Date(), settings.timezone),
    softLimit: settings.dailySoftLimit,
    hardLimit: settings.dailyHardLimit
  });
  return {
    defaults: DEFAULT_API_FOOTBALL_SETTINGS,
    settings,
    usage
  };
}

const apiFootballSettingsSchema = z.object({
  provider: z.enum(["zafronix"]).optional(),
  enabled: z.boolean().optional(),
  apiKey: z.string().trim().optional(),
  clearApiKey: z.boolean().optional(),
  baseUrl: z.string().trim().optional(),
  worldCupLeagueId: z.coerce.number().int().min(1).max(999999).optional(),
  worldCupSeason: z.coerce.number().int().min(1900).max(2200).optional(),
  timezone: z.string().trim().min(1).max(80).optional(),
  dailySoftLimit: z.coerce.number().int().min(1).max(10000).optional(),
  dailyHardLimit: z.coerce.number().int().min(1).max(10000).optional(),
  syncIntervalMs: z.coerce.number().int().min(30000).max(86400000).optional()
});

app.get("/api/admin/sub2api/worldcup/api-football/settings", { preHandler: requireAdmin }, async () => (
  buildApiFootballAdminPayload()
));

app.patch("/api/admin/sub2api/worldcup/api-football/settings", { preHandler: requireAdmin }, async (request, reply) => {
  const parsed = apiFootballSettingsSchema.safeParse(getBodyObject(request.body));
  if (!parsed.success) {
    return reply.code(400).send({ message: "Zafronix 配置参数不正确" });
  }

  const currentRow = db.prepare("SELECT * FROM api_football_settings WHERE id = 'default'").get();
  const current = getApiFootballSettings(db);
  const provider = "zafronix";
  let baseUrl = parsed.data.baseUrl || current.baseUrl || DEFAULT_API_FOOTBALL_SETTINGS.zafronixBaseUrl;
  if (baseUrl.includes("football.api-sports.io") || baseUrl.includes("football-data.org")) {
    baseUrl = DEFAULT_API_FOOTBALL_SETTINGS.zafronixBaseUrl;
  }
  const next = {
    provider,
    enabled: parsed.data.enabled ?? current.enabled,
    baseUrl,
    worldCupLeagueId: parsed.data.worldCupLeagueId ?? current.worldCupLeagueId,
    worldCupSeason: parsed.data.worldCupSeason ?? current.worldCupSeason,
    timezone: parsed.data.timezone || current.timezone || DEFAULT_API_FOOTBALL_SETTINGS.timezone,
    dailySoftLimit: parsed.data.dailySoftLimit ?? current.dailySoftLimit,
    dailyHardLimit: parsed.data.dailyHardLimit ?? current.dailyHardLimit,
    syncIntervalMs: parsed.data.syncIntervalMs ?? current.syncIntervalMs
  };

  try {
    // Validate early so the worker does not fail later on an invalid base URL.
    new URL(next.baseUrl);
    getApiFootballUsageDate(new Date(), next.timezone);
  } catch {
    return reply.code(400).send({ message: "Base URL 或时区配置不正确" });
  }

  if (next.dailyHardLimit < next.dailySoftLimit) {
    return reply.code(400).send({ message: "硬上限不能小于软上限" });
  }

  let apiKey = currentRow?.api_key || null;
  if (parsed.data.clearApiKey) {
    apiKey = null;
  } else if (parsed.data.apiKey) {
    apiKey = encryptText(parsed.data.apiKey);
  }

  const now = nowIso();
  db.prepare(`
    INSERT OR IGNORE INTO api_football_settings (
      id, provider, enabled, api_key, base_url, worldcup_league_id, worldcup_season,
      timezone, daily_soft_limit, daily_hard_limit, sync_interval_ms, updated_at, updated_by
    )
    VALUES ('default', 'zafronix', 0, NULL, ?, 1, 2026, 'Asia/Shanghai', 80, 100, 60000, ?, 'system')
  `).run(DEFAULT_API_FOOTBALL_SETTINGS.zafronixBaseUrl, now);

  db.prepare(`
    UPDATE api_football_settings
    SET provider = ?,
        enabled = ?,
        api_key = ?,
        base_url = ?,
        worldcup_league_id = ?,
        worldcup_season = ?,
        timezone = ?,
        daily_soft_limit = ?,
        daily_hard_limit = ?,
        sync_interval_ms = ?,
        updated_at = ?,
        updated_by = ?
    WHERE id = 'default'
  `).run(
    next.provider,
    next.enabled ? 1 : 0,
    apiKey,
    next.baseUrl,
    next.worldCupLeagueId,
    next.worldCupSeason,
    next.timezone,
    next.dailySoftLimit,
    next.dailyHardLimit,
    next.syncIntervalMs,
    now,
    request.admin.username
  );

  createAuditLog({
    action: "sub2api.worldcup.api_football.settings.update",
    actor: request.admin.username,
    resourceType: "api_football_settings",
    resourceId: "default",
    detail: {
      enabled: next.enabled,
      provider: next.provider,
      baseUrl: next.baseUrl,
      worldCupLeagueId: next.worldCupLeagueId,
      worldCupSeason: next.worldCupSeason,
      timezone: next.timezone,
      dailySoftLimit: next.dailySoftLimit,
      dailyHardLimit: next.dailyHardLimit,
      syncIntervalMs: next.syncIntervalMs,
      apiKeyChanged: Boolean(parsed.data.apiKey),
      apiKeyCleared: Boolean(parsed.data.clearApiKey)
    }
  });

  return buildApiFootballAdminPayload();
});

app.post("/api/admin/sub2api/worldcup/api-football/sync", { preHandler: requireAdmin }, async (request, reply) => {
  const workerUrl = `http://127.0.0.1:${env.workerInternalPort}/api/internal/sub2api/worldcup/sync`;
  const requestBody = getBodyObject(request.body);
  const sportteryOddsMatches = Array.isArray(requestBody.sportteryOddsMatches)
    ? requestBody.sportteryOddsMatches.slice(0, 300)
    : [];
  const sportteryBrowserError = String(requestBody.sportteryBrowserError || "").slice(0, 180);
  let response;
  try {
    response = await fetch(workerUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Secret": env.internalSecret
      },
      body: JSON.stringify({ sportteryOddsMatches, sportteryBrowserError }),
      signal: AbortSignal.timeout(120000)
    });
  } catch (error) {
    return reply.code(502).send({ message: `无法连接 worker：${error.message || "请求失败"}` });
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const reasonText = {
      already_running: "世界杯同步正在执行中",
      disabled: "Zafronix 自动同步未启用",
      no_active_connections: "没有 active 的 Sub2api 连接",
      missing_api_key: "未配置 Zafronix API Key",
      interval_not_due: "同步间隔尚未到期"
    }[payload.reason] || payload.message || "worker 执行失败";
    return reply.code(response.status).send({ message: reasonText, worker: payload });
  }

  createAuditLog({
    action: "sub2api.worldcup.api_football.manual_sync",
    actor: request.admin.username,
    resourceType: "api_football_settings",
    resourceId: "default",
    detail: payload
  });

  return {
    success: true,
    worker: payload,
    ...buildApiFootballAdminPayload()
  };
});

app.get("/api/admin/sub2api/worldcup/matches", { preHandler: requireAdmin }, async (request) => {
  const conditions = [];
  const params = [];

  const connectionId = String(request.query.connectionId || "").trim();
  if (connectionId) {
    conditions.push("m.connection_id = ?");
    params.push(connectionId);
  }

  const status = String(request.query.status || "").trim();
  const allowedStatuses = new Set(Object.values(sub2apiWorldCupMatchStatuses));
  if (status && allowedStatuses.has(status)) {
    conditions.push("m.status = ?");
    params.push(status);
  }

  const whereSql = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = db.prepare(`
    SELECT m.*, c.name AS connection_name
    FROM sub2api_worldcup_matches m
    LEFT JOIN sub2api_connections c ON c.id = m.connection_id
    ${whereSql}
    ORDER BY datetime(m.kickoff_at) ASC, m.created_at ASC
  `).all(...params);
  return { items: rows.map((row) => serializeSub2ApiWorldCupMatch(row)) };
});

app.post("/api/admin/sub2api/worldcup/matches", { preHandler: requireAdmin }, async (request, reply) => {
  let payload;
  try {
    payload = prepareSub2ApiWorldCupMatchPayload(request.body);
  } catch (error) {
    return reply.code(error.statusCode || 400).send({ message: error.message });
  }

  const connection = getSub2ApiConnectionById(payload.connectionId);
  if (!connection || connection.status === sub2apiConnectionStatuses.deleted) {
    return reply.code(404).send({ message: "Sub2api 连接不存在" });
  }

  const now = nowIso();
  const id = nanoid(16);
  db.prepare(`
    INSERT INTO sub2api_worldcup_matches (
      id, connection_id, stage, group_name, home_team, away_team, kickoff_at, status,
      home_score, away_score, result, odds_home, odds_draw, odds_away, min_stake,
      max_stake, note, created_at, updated_at, settled_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
  `).run(
    id,
    payload.connectionId,
    payload.stage || null,
    payload.groupName || null,
    payload.homeTeam,
    payload.awayTeam,
    payload.kickoffAt,
    payload.status,
    roundSub2ApiWorldCupAmount(payload.oddsHome),
    roundSub2ApiWorldCupAmount(payload.oddsDraw),
    roundSub2ApiWorldCupAmount(payload.oddsAway),
    payload.minStake,
    payload.maxStake,
    payload.note || null,
    now,
    now
  );

  createAuditLog({
    action: "sub2api.worldcup.match.create",
    actor: request.admin.username,
    resourceType: "sub2api_worldcup_match",
    resourceId: id,
    detail: { connectionId: payload.connectionId, homeTeam: payload.homeTeam, awayTeam: payload.awayTeam }
  });

  return reply.code(201).send({ item: serializeSub2ApiWorldCupMatch(getSub2ApiWorldCupMatchById(id)) });
});

app.patch("/api/admin/sub2api/worldcup/matches/:id", { preHandler: requireAdmin }, async (request, reply) => {
  const id = String(request.params.id || "").trim();
  const existing = getSub2ApiWorldCupMatchById(id);
  if (!existing) {
    return reply.code(404).send({ message: "比赛不存在" });
  }
  if (existing.status === sub2apiWorldCupMatchStatuses.settled) {
    return reply.code(409).send({ message: "已结算比赛不能直接编辑，请新建修正场次或手动处理投注记录" });
  }

  let payload;
  try {
    payload = prepareSub2ApiWorldCupMatchPayload(request.body, { partial: true });
  } catch (error) {
    return reply.code(error.statusCode || 400).send({ message: error.message });
  }

  const connectionId = payload.connectionId ?? existing.connection_id;
  if (connectionId !== existing.connection_id) {
    const betCount = db.prepare("SELECT COUNT(*) AS count FROM sub2api_worldcup_bets WHERE match_id = ?").get(id).count;
    if (betCount > 0) {
      return reply.code(409).send({ message: "已有投注记录，不能切换比赛连接" });
    }
  }
  const connection = getSub2ApiConnectionById(connectionId);
  if (!connection || connection.status === sub2apiConnectionStatuses.deleted) {
    return reply.code(404).send({ message: "Sub2api 连接不存在" });
  }

  const homeTeam = payload.homeTeam ?? existing.home_team;
  const awayTeam = payload.awayTeam ?? existing.away_team;
  if (homeTeam === awayTeam) {
    return reply.code(400).send({ message: "主队和客队不能相同" });
  }
  const minStake = payload.minStake !== undefined ? payload.minStake : Number(existing.min_stake);
  const maxStake = payload.maxStake !== undefined ? payload.maxStake : Number(existing.max_stake);
  if (maxStake < minStake) {
    return reply.code(400).send({ message: "最高投注额不能小于最低投注额" });
  }

  const now = nowIso();
  db.prepare(`
    UPDATE sub2api_worldcup_matches
    SET connection_id = ?, stage = ?, group_name = ?, home_team = ?, away_team = ?,
        kickoff_at = ?, status = ?, odds_home = ?, odds_draw = ?, odds_away = ?,
        min_stake = ?, max_stake = ?, note = ?, updated_at = ?
    WHERE id = ?
  `).run(
    connectionId,
    payload.stage ?? existing.stage,
    payload.groupName ?? existing.group_name,
    homeTeam,
    awayTeam,
    payload.kickoffAt ?? existing.kickoff_at,
    payload.status ?? existing.status,
    payload.oddsHome !== undefined ? roundSub2ApiWorldCupAmount(payload.oddsHome) : Number(existing.odds_home),
    payload.oddsDraw !== undefined ? roundSub2ApiWorldCupAmount(payload.oddsDraw) : Number(existing.odds_draw),
    payload.oddsAway !== undefined ? roundSub2ApiWorldCupAmount(payload.oddsAway) : Number(existing.odds_away),
    minStake,
    maxStake,
    payload.note ?? existing.note,
    now,
    id
  );

  createAuditLog({
    action: "sub2api.worldcup.match.update",
    actor: request.admin.username,
    resourceType: "sub2api_worldcup_match",
    resourceId: id,
    detail: { connectionId, status: payload.status ?? existing.status }
  });

  return { item: serializeSub2ApiWorldCupMatch(getSub2ApiWorldCupMatchById(id)) };
});

app.delete("/api/admin/sub2api/worldcup/matches/:id", { preHandler: requireAdmin }, async (request, reply) => {
  const id = String(request.params.id || "").trim();
  const existing = getSub2ApiWorldCupMatchById(id);
  if (!existing) {
    return reply.code(404).send({ message: "比赛不存在" });
  }
  const betCount = db.prepare("SELECT COUNT(*) AS count FROM sub2api_worldcup_bets WHERE match_id = ?").get(id).count;
  if (betCount > 0) {
    return reply.code(409).send({ message: "已有投注记录，不能删除；可以取消比赛并退款" });
  }
  db.prepare("DELETE FROM sub2api_worldcup_matches WHERE id = ?").run(id);
  createAuditLog({
    action: "sub2api.worldcup.match.delete",
    actor: request.admin.username,
    resourceType: "sub2api_worldcup_match",
    resourceId: id
  });
  return { success: true, id };
});

app.post("/api/admin/sub2api/worldcup/matches/:id/settle", { preHandler: requireAdmin }, async (request, reply) => {
  const id = String(request.params.id || "").trim();
  const existing = getSub2ApiWorldCupMatchById(id);
  if (!existing) {
    return reply.code(404).send({ message: "比赛不存在" });
  }
  if (existing.status === sub2apiWorldCupMatchStatuses.settled) {
    return reply.code(409).send({ message: "比赛已结算，不能重复结算" });
  }
  if (existing.status === sub2apiWorldCupMatchStatuses.cancelled) {
    return reply.code(409).send({ message: "比赛已取消，不能结算" });
  }

  const parsed = z.object({
    homeScore: z.coerce.number().int().min(0).max(99),
    awayScore: z.coerce.number().int().min(0).max(99)
  }).safeParse(getBodyObject(request.body));
  if (!parsed.success) {
    return reply.code(400).send({ message: "请提供有效比分" });
  }

  let result;
  try {
    result = getSub2ApiWorldCupResult(parsed.data.homeScore, parsed.data.awayScore);
  } catch (error) {
    return reply.code(400).send({ message: error.message });
  }

  const now = nowIso();
  db.prepare(`
    UPDATE sub2api_worldcup_matches
    SET home_score = ?, away_score = ?, result = ?, status = ?, updated_at = ?
    WHERE id = ?
  `).run(
    parsed.data.homeScore,
    parsed.data.awayScore,
    result,
    sub2apiWorldCupMatchStatuses.finished,
    now,
    id
  );

  try {
    return await settleSub2ApiWorldCupMatch(getSub2ApiWorldCupMatchById(id), request.admin.username);
  } catch (error) {
    return reply.code(error.statusCode || 502).send({ message: error.message || "比赛结算失败" });
  }
});

app.post("/api/admin/sub2api/worldcup/matches/:id/cancel", { preHandler: requireAdmin }, async (request, reply) => {
  const id = String(request.params.id || "").trim();
  const existing = getSub2ApiWorldCupMatchById(id);
  if (!existing) {
    return reply.code(404).send({ message: "比赛不存在" });
  }
  try {
    return await cancelSub2ApiWorldCupMatch(existing, request.admin.username);
  } catch (error) {
    return reply.code(error.statusCode || 502).send({ message: error.message || "取消比赛失败" });
  }
});

app.get("/api/admin/sub2api/worldcup/bets", { preHandler: requireAdmin }, async (request) => {
  const page = Math.max(1, Math.floor(Number(request.query.page) || 1));
  const pageSize = Math.min(200, Math.max(1, Math.floor(Number(request.query.pageSize) || 50)));
  const offset = (page - 1) * pageSize;
  const conditions = [];
  const params = [];

  const connectionId = String(request.query.connectionId || "").trim();
  if (connectionId) {
    conditions.push("b.connection_id = ?");
    params.push(connectionId);
  }
  const matchId = String(request.query.matchId || "").trim();
  if (matchId) {
    conditions.push("b.match_id = ?");
    params.push(matchId);
  }
  const userId = String(request.query.userId || "").trim();
  if (userId) {
    conditions.push("b.sub2api_user_id LIKE ?");
    params.push(`%${userId}%`);
  }
  const status = String(request.query.status || "").trim();
  const allowedStatuses = new Set(Object.values(sub2apiWorldCupBetStatuses));
  if (status && allowedStatuses.has(status)) {
    conditions.push("b.status = ?");
    params.push(status);
  }

  const whereSql = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const total = db.prepare(`
    SELECT COUNT(*) AS count
    FROM sub2api_worldcup_bets b
    ${whereSql}
  `).get(...params).count;
  const rows = db.prepare(`
    SELECT b.*, m.stage, m.home_team, m.away_team, m.kickoff_at, m.status AS match_status,
           m.home_score, m.away_score, m.result, c.name AS connection_name
    FROM sub2api_worldcup_bets b
    LEFT JOIN sub2api_worldcup_matches m ON m.id = b.match_id
    LEFT JOIN sub2api_connections c ON c.id = b.connection_id
    ${whereSql}
    ORDER BY b.created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, pageSize, offset);

  return {
    items: rows.map((row) => ({
      ...serializeSub2ApiWorldCupBet(row),
      connectionName: row.connection_name || null
    })),
    total,
    page,
    pageSize
  };
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
    importType: z.enum(["auto", "support", "normal"]).optional().default("auto"),
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

  const defaultPrefix = parsed.data.prefix.trim();
  const importType = parsed.data.importType;
  const rawEntries = Array.from(new Map(
    parsed.data.rawKeys
      .split(/\r?\n/)
      .flatMap((line) => {
        const trimmedLine = String(line ?? "").trim();
        if (!trimmedLine) return [];

        if (importType === "support") {
          if (trimmedLine.includes("|")) {
            const [prefixPart, ...tokenParts] = trimmedLine.split("|");
            const emailToken = tokenParts.join("|").trim();
            if (!emailToken) return [];
            return [{
              sourceKey: "",
              emailToken,
              supportOnly: true,
              prefix: prefixPart.trim() || defaultPrefix
            }];
          }

          return [{
            sourceKey: "",
            emailToken: trimmedLine,
            supportOnly: true,
            prefix: defaultPrefix
          }];
        }

        if (importType === "normal") {
          return trimmedLine
            .split(",")
            .map((item) => ({
              sourceKey: item.trim(),
              emailToken: "",
              supportOnly: false,
              prefix: defaultPrefix
            }))
            .filter((item) => item.sourceKey);
        }

        if (trimmedLine.includes("|")) {
          const [sourceKey, ...tokenParts] = trimmedLine.split("|");
          const emailToken = tokenParts.join("|").trim();
          if (!emailToken) {
            return sourceKey.trim()
              ? [{
                sourceKey: sourceKey.trim(),
                emailToken: "",
                supportOnly: false,
                prefix: defaultPrefix
              }]
              : [];
          }
          return [{
            sourceKey: sourceKey.trim(),
            emailToken,
            supportOnly: true,
            prefix: defaultPrefix
          }];
        }

        return trimmedLine
          .split(",")
          .map((item) => ({
            sourceKey: item.trim(),
            emailToken: "",
            supportOnly: false,
            prefix: defaultPrefix
          }))
          .filter((item) => item.sourceKey);
      })
      .filter((item) => item.emailToken || item.sourceKey)
      .map((item) => [`${item.prefix}::${item.sourceKey}::${item.emailToken}::${item.supportOnly ? 1 : 0}`, item])
  ).values());

  if (!rawEntries.length) {
    return reply.code(400).send({ message: "没有可导入的卡密" });
  }

  if (rawEntries.some((item) => item.supportOnly) && String(site.slug || "").trim().toLowerCase() !== MEIMEI_SITE_SLUG) {
    return reply.code(400).send({ message: "批量导入接码专用卡密时，归属网站必须选择老妹plus" });
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
      rawEntries.length,
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
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?, ?, ?)
    `);

    let supportOnlyCount = 0;
    let normalCount = 0;

    for (const entry of rawEntries) {
      const supportOnly = Boolean(entry.supportOnly);
      const sourceKey = String(entry.sourceKey || "").trim();
      const emailToken = String(entry.emailToken || "").trim();
      const cardPrefix = String(entry.prefix || defaultPrefix).trim() || defaultPrefix;
      const storedSourceKey = supportOnly
        ? (sourceKey || `support-card:${cardPrefix}:${Date.now()}:${nanoid(6)}`)
        : sourceKey;

      insertKey.run(
        nanoid(18),
        batchId,
        site.product_id || "prod_demo",
        site.activation_endpoint_id || "endpoint_demo",
        site.id,
        encryptText(storedSourceKey),
        getUniquePublicKey(cardPrefix),
        cardPrefix,
        cdkeyStatuses.active,
        buildCdkeyMetadata(null, {
          emailToken,
          supportOnly
        }),
        now,
        now
      );

      if (supportOnly) {
        supportOnlyCount += 1;
      } else {
        normalCount += 1;
      }
    }

    createAuditLog({
      action: logActions.batchImport,
      actor: request.admin.username,
      resourceType: "cdkey_batch",
      resourceId: batchId,
      detail: {
        count: rawEntries.length,
        prefix: parsed.data.prefix,
        siteId: site.id,
        importType,
        supportOnlyCount,
        normalCount
      }
    });

    return {
      batchId,
      importedCount: rawEntries.length,
      supportOnlyCount,
      normalCount
    };
  });

  return result;
});

app.post("/api/admin/cdkeys/create", { preHandler: requireAdmin }, async (request, reply) => {
  const schema = z.object({
    sourceKey: z.string().optional().default(""),
    prefix: z.string().min(1),
    siteId: z.string().min(1),
    note: z.string().optional().default(""),
    emailToken: z.string().optional().default("")
  });

  const parsed = schema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ message: "单次添加参数不正确" });
  }

  const site = getSiteById(parsed.data.siteId);
  if (!site) {
    return reply.code(400).send({ message: "网站不存在" });
  }

  const sourceKey = parsed.data.sourceKey.trim();
  const emailToken = parsed.data.emailToken.trim();
  const supportOnly = !sourceKey && Boolean(emailToken);
  if (!sourceKey && !emailToken) {
    return reply.code(400).send({ message: "请至少填写原始卡密或 email_token" });
  }
  if (supportOnly && String(site.slug || "").trim().toLowerCase() !== MEIMEI_SITE_SLUG) {
    return reply.code(400).send({ message: "接码专用卡密必须绑定到老妹plus站点" });
  }

  const now = nowIso();
  const id = nanoid(18);
  const publicKey = getUniquePublicKey(parsed.data.prefix);
  const storedSourceKey = sourceKey || `support-card:${publicKey}`;

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
    encryptText(storedSourceKey),
    publicKey,
    parsed.data.prefix,
    cdkeyStatuses.active,
    buildCdkeyMetadata(null, {
      note: parsed.data.note,
      emailToken,
      supportOnly
    }),
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
      publicKey,
      hasEmailToken: Boolean(emailToken),
      supportOnly
    }
  });

  return {
    id,
    publicKey,
    mode: supportOnly ? "support" : "standard"
  };
});

app.get("/api/admin/cdkeys", { preHandler: requireAdmin }, async (request) => {
  const status = request.query.status ? String(request.query.status) : null;
  const batchId = request.query.batchId ? String(request.query.batchId) : null;
  const siteId = request.query.siteId ? String(request.query.siteId) : null;
  const keyword = request.query.q ? `%${String(request.query.q).trim().toUpperCase()}%` : null;

  let sql = `
    SELECT
      c.id, c.public_key, c.source_key, c.prefix, c.status, c.used_at, c.locked_at, c.metadata,
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
    source_key: isSupportOnlyCdkey(item.metadata) ? "" : decryptText(item.source_key),
    note: getCdkeyNote(item.metadata),
    email_token: getCdkeyEmailToken(item.metadata),
    has_email_token: Boolean(getCdkeyEmailToken(item.metadata)),
    support_only: isSupportOnlyCdkey(item.metadata)
  }));
  return { items };
});

app.get("/api/admin/cdkeys/export-excel", { preHandler: requireAdmin }, async (request) => {
  const status = request.query.status ? String(request.query.status) : null;
  const batchId = request.query.batchId ? String(request.query.batchId) : null;
  const siteId = request.query.siteId ? String(request.query.siteId) : null;
  const keyword = request.query.q ? `%${String(request.query.q).trim().toUpperCase()}%` : null;

  let sql = `
    SELECT
      c.public_key, c.source_key, c.prefix, c.status, c.metadata, c.created_at,
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

  sql += " ORDER BY c.created_at DESC LIMIT 50000";

  const rows = db.prepare(sql).all(...params);
  const items = rows.map((row) => {
    let sourceKey = "";
    if (!isSupportOnlyCdkey(row.metadata)) {
      try {
        sourceKey = decryptText(row.source_key) || "";
      } catch {
        sourceKey = "";
      }
    }
    return {
      public_key: row.public_key,
      source_key: sourceKey,
      prefix: row.prefix || "",
      status: row.status,
      site_name: row.site_name || "",
      batch_name: row.batch_name || "",
      email_token: getCdkeyEmailToken(row.metadata),
      created_at: row.created_at || ""
    };
  });

  return { items, total: items.length };
});

app.patch("/api/admin/cdkeys/:id/email-token", { preHandler: requireAdmin }, async (request, reply) => {
  const schema = z.object({
    emailToken: z.string().optional().default("")
  });
  const parsed = schema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ message: "email_token 参数不正确" });
  }

  const cdkey = db.prepare("SELECT id, public_key, metadata FROM cdkeys WHERE id = ?").get(request.params.id);
  if (!cdkey) {
    return reply.code(404).send({ message: "卡密不存在" });
  }

  const now = nowIso();
  const metadata = buildCdkeyMetadata(cdkey.metadata, {
    emailToken: parsed.data.emailToken
  });

  db.prepare("UPDATE cdkeys SET metadata = ?, updated_at = ? WHERE id = ?")
    .run(metadata, now, cdkey.id);

  createAuditLog({
    action: "cdkey.email_token.update",
    actor: request.admin.username,
    resourceType: "cdkey",
    resourceId: cdkey.id,
    detail: {
      publicKey: cdkey.public_key,
      hasEmailToken: Boolean(parsed.data.emailToken?.trim())
    }
  });

  return {
    id: cdkey.id,
    publicKey: cdkey.public_key,
    hasEmailToken: Boolean(parsed.data.emailToken?.trim())
  };
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

app.post("/api/admin/cdkeys/export-source-keys", { preHandler: requireAdmin }, async (request, reply) => {
  const schema = z.object({
    ids: z.array(z.string()).min(1).max(200)
  });
  const parsed = schema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ message: "导出参数不正确" });
  }

  const placeholders = parsed.data.ids.map(() => "?").join(",");
  const rows = db.prepare(`
    SELECT id, source_key, metadata
    FROM cdkeys
    WHERE id IN (${placeholders})
  `).all(...parsed.data.ids);

  const rowMap = new Map(rows.map((row) => [row.id, row]));

  const items = parsed.data.ids
    .filter((id) => rowMap.has(id))
    .map((id) => {
      const row = rowMap.get(id);
      let sourceKey = "";
      if (!isSupportOnlyCdkey(row.metadata)) {
        try {
          sourceKey = decryptText(row.source_key);
        } catch (error) {
          console.warn(`[export-source-keys] 解密失败 id=${id}:`, error.message);
          sourceKey = "";
        }
      }
      return { id, sourceKey };
    });

  return { items };
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

// ─── 接码管理后台接口 ───────────────────────────────────────────────

// ─── SMS 批量导入接口 ─────────────────────────────────────────────────
app.post("/api/admin/sms/import", { preHandler: requireAdmin }, async (request, reply) => {
  const schema = z.object({
    batchName: z.string().min(2).max(50),
    prefix: z.string().min(1).max(10).regex(/^[A-Z0-9_-]+$/i),
    content: z.string().min(1)
  });

  const parsed = schema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ message: "导入参数不正确" });
  }

  const { batchName, prefix, content } = parsed.data;

  // 按换行符拆分
  const allLines = content.split(/\r?\n/);

  // 校验总行数不超过 5000
  if (allLines.length > 5000) {
    return reply.code(400).send({ message: "单次导入不能超过 5000 行" });
  }

  // 使用提取的解析函数
  const { validEntries, skippedLines } = parseSmsImportContent(content);

  // 若无有效数据
  if (validEntries.length === 0) {
    return reply.code(400).send({ message: "无有效数据可导入" });
  }

  // 使用事务批量插入
  const result = withTransaction(() => {
    const batchId = nanoid(16);
    const now = nowIso();

    db.prepare(`
      INSERT INTO sms_batches (id, name, prefix, imported_count, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      batchId,
      batchName,
      prefix.toUpperCase().replace(/[^A-Z0-9_-]/g, ""),
      validEntries.length,
      request.admin.username,
      now,
      now
    );

    const insertEntry = db.prepare(`
      INSERT INTO sms_entries (id, phone, sms_url, public_key, prefix, batch_id, status, note, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'active', NULL, ?, ?)
    `);

    for (const entry of validEntries) {
      const publicKey = getUniqueSmsPublicKey(prefix);
      insertEntry.run(
        nanoid(16),
        entry.phone,
        entry.smsUrl,
        publicKey,
        prefix.toUpperCase().replace(/[^A-Z0-9_-]/g, ""),
        batchId,
        now,
        now
      );
    }

    createAuditLog({
      action: "sms_import",
      actor: request.admin.username,
      resourceType: "sms_batch",
      resourceId: batchId,
      detail: {
        batchName,
        prefix,
        importedCount: validEntries.length,
        skippedCount: skippedLines.length
      }
    });

    return { batchId, importedCount: validEntries.length, skippedLines };
  });

  return result;
});

app.get("/api/admin/sms/entries", { preHandler: requireAdmin }, async (request) => {
  const page = Math.max(1, Math.floor(Number(request.query.page) || 1));
  const pageSize = Math.min(100, Math.max(1, Math.floor(Number(request.query.pageSize) || 100)));
  const offset = (page - 1) * pageSize;

  const total = db.prepare("SELECT COUNT(*) AS count FROM sms_entries").get().count;

  const items = db.prepare(`
    SELECT
      e.id, e.phone, e.sms_url, e.public_key, e.prefix, e.batch_id, e.status, e.note, e.created_at,
      b.name AS batch_name
    FROM sms_entries e
    LEFT JOIN sms_batches b ON b.id = e.batch_id
    ORDER BY e.created_at DESC
    LIMIT ? OFFSET ?
  `).all(pageSize, offset).map((row) => ({
    id: row.id,
    phone: row.phone,
    smsUrl: row.sms_url,
    publicKey: row.public_key,
    prefix: row.prefix,
    batchId: row.batch_id,
    batchName: row.batch_name || null,
    status: row.status,
    note: row.note || null,
    createdAt: row.created_at
  }));

  return { items, total, page, pageSize };
});

// ─── 接码导出接口 ─────────────────────────────────────────────────────
app.get("/api/admin/sms/export", { preHandler: requireAdmin }, async () => {
  const rows = db.prepare(`
    SELECT
      e.public_key, e.phone, e.sms_url, e.prefix, e.status, e.created_at,
      b.name AS batch_name
    FROM sms_entries e
    LEFT JOIN sms_batches b ON b.id = e.batch_id
    ORDER BY e.created_at DESC
    LIMIT 50000
  `).all();

  const items = rows.map((row) => ({
    publicKey: row.public_key,
    phone: row.phone,
    smsUrl: row.sms_url,
    prefix: row.prefix || "",
    batchName: row.batch_name || "",
    status: row.status,
    createdAt: row.created_at || ""
  }));

  return { items };
});

// ─── SMS Public: Card Verify / Order Flow ───────────────────────────────
app.post("/api/public/sms/cards/verify", async (request, reply) => {
  const schema = z.object({
    cardKey: z.string().min(1)
  });
  const parsed = schema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ message: "请提供 cardKey" });
  }

  const card = getSmsCardDetail(parsed.data.cardKey.trim());
  if (!card) {
    const entry = db.prepare("SELECT id, phone, sms_url, public_key, status FROM sms_entries WHERE public_key = ?").get(parsed.data.cardKey.trim());
    if (!entry) {
      return reply.code(404).send({ message: "接码卡密无效或不存在" });
    }
    if (isSmsCardStopped(entry.status)) {
      return reply.code(403).send({ message: "该接码卡密已停用" });
    }
    return {
      valid: true,
      legacyStaticEntry: true,
      cardKey: entry.public_key,
      site: {
        id: "legacy_static",
        name: "静态库存",
        slug: "legacy_static"
      },
      status: entry.status,
      hasActiveOrder: false,
      latestOrder: null
    };
  }
  if (isSmsCardStopped(card.status)) {
    return reply.code(403).send({ message: "该接码卡密已停用" });
  }
  if (card.site_status !== smsSiteStatuses.active) {
    return reply.code(403).send({ message: "该接码站点暂不可用" });
  }

  const latestOrder = getLatestSmsOrderByCardId(card.id);
  return {
    valid: true,
    cardKey: card.card_key,
    site: {
      id: card.site_id,
      name: card.site_name,
      slug: card.site_slug
    },
    status: card.status,
    hasActiveOrder: Boolean(card.current_order_id),
    latestOrder: latestOrder ? mapSmsOrderForPublic(latestOrder) : null
  };
});

app.post("/api/public/sms/orders", async (request, reply) => {
  const schema = z.object({
    cardKey: z.string().min(1)
  });
  const parsed = schema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ message: "请提供 cardKey" });
  }

  const card = getSmsCardDetail(parsed.data.cardKey.trim());
  if (!card) {
    return reply.code(404).send({ message: "接码卡密无效或不存在" });
  }
  if ([smsCardStatuses.disabled, smsCardStatuses.void, smsCardStatuses.used].includes(card.status)) {
    return reply.code(403).send({ message: "该接码卡密已停用" });
  }
  if (card.site_status !== smsSiteStatuses.active) {
    return reply.code(403).send({ message: "该接码站点暂不可用" });
  }

  if (card.current_order_id) {
    const currentOrder = db.prepare(`
      SELECT o.*, s.name AS site_name, s.slug AS site_slug
      FROM sms_orders o
      LEFT JOIN sms_sites s ON s.id = o.site_id
      WHERE o.id = ?
    `).get(card.current_order_id);
    if (currentOrder) {
      return mapSmsOrderForPublic(currentOrder);
    }
  }

  const now = nowIso();
  const orderId = nanoid(16);
  const orderNo = generateSmsOrderNo();

  if (card.inventory_source === "nexsms" || card.sms_provider === "nexsms") {
    if (!card.sms_api_key || !card.sms_app_id) {
      return reply.code(400).send({ message: "佬友站点未配置 NexSMS API Key 或 appId" });
    }

    let apiKey;
    try {
      apiKey = decryptText(card.sms_api_key);
    } catch {
      return reply.code(400).send({ message: "NexSMS API Key 解密失败" });
    }

    let purchased;
    try {
      purchased = await purchasePremiumNumber(apiKey, {
        appId: card.sms_app_id,
        type: card.sms_card_type || 1,
        quantity: 1,
        expiry: card.sms_expiry || 0,
        prefix: card.sms_prefix_filter || null,
        excludePrefix: card.sms_exclude_prefix || null
      });
    } catch (error) {
      return reply.code(502).send({ message: `NexSMS 买号失败: ${error.message}` });
    }

    db.prepare(`
      INSERT INTO sms_orders (
        id, order_no, site_id, card_id, sms_entry_id, phone, sms_url,
        verification_code, status, error_message, provider_payload, refunded_at,
        expires_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, NULL, ?, NULL, NULL, ?, NULL, ?, NULL, ?, ?, ?)
    `).run(
      orderId,
      orderNo,
      card.site_id,
      card.id,
      purchased.tel,
      smsOrderStatuses.waiting_code,
      JSON.stringify({
        provider: "nexsms",
        apiKeyEncrypted: card.sms_api_key,
        appId: card.sms_app_id,
        type: card.sms_card_type || 1,
        expiry: card.sms_expiry || 0,
        purchase: purchased
      }),
      getSmsOrderExpiresAt(purchased.endTime, card.sms_poll_timeout_ms),
      now,
      now
    );

    db.prepare(`
      UPDATE sms_cards
      SET status = ?, current_order_id = ?, resource_entry_id = NULL, updated_at = ?
      WHERE id = ?
    `).run(smsCardStatuses.in_use, orderId, now, card.id);

    createSmsOrderEvent(orderId, "number_reserved", { provider: "nexsms", phone: purchased.tel, appName: purchased.appName || null });
  } else {
    const smsEntry = reserveSmsEntryForOrder();
    if (!smsEntry) {
      return reply.code(409).send({ message: "当前没有可分配的号码库存" });
    }

    db.prepare(`
      INSERT INTO sms_orders (
        id, order_no, site_id, card_id, sms_entry_id, phone, sms_url,
        verification_code, status, error_message, provider_payload, refunded_at,
        expires_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, ?, NULL, ?, ?, ?)
    `).run(
      orderId,
      orderNo,
      card.site_id,
      card.id,
      smsEntry.id,
      smsEntry.phone,
      smsEntry.sms_url,
      smsOrderStatuses.waiting_code,
      JSON.stringify({ source: "sms_entries" }),
      getSmsOrderExpiresAt(),
      now,
      now
    );

    db.prepare(`
      UPDATE sms_cards
      SET status = ?, current_order_id = ?, resource_entry_id = ?, updated_at = ?
      WHERE id = ?
    `).run(smsCardStatuses.in_use, orderId, smsEntry.id, now, card.id);

    db.prepare(`
      UPDATE sms_entries
      SET status = 'locked', updated_at = ?
      WHERE id = ?
    `).run(now, smsEntry.id);

    createSmsOrderEvent(orderId, "number_reserved", { smsEntryId: smsEntry.id, phone: smsEntry.phone });

    try {
      const workerUrl = `http://127.0.0.1:${env.workerInternalPort}/api/internal/sms/poll`;
      await fetch(workerUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Secret": env.internalSecret
        },
        body: JSON.stringify({
          publicKey: String(smsEntry.id),
          smsUrl: smsEntry.sms_url,
          smsEntryId: String(smsEntry.id)
        }),
        signal: AbortSignal.timeout(5000)
      });
    } catch {
      // Worker unavailable; frontend polling will keep reading the order state.
    }
  }

  const createdOrder = db.prepare(`
    SELECT o.*, s.name AS site_name, s.slug AS site_slug
    FROM sms_orders o
    LEFT JOIN sms_sites s ON s.id = o.site_id
    WHERE o.id = ?
  `).get(orderId);
  return mapSmsOrderForPublic(createdOrder);
});

app.get("/api/public/sms/orders/:orderNo", async (request, reply) => {
  const orderNo = String(request.params.orderNo || "").trim();
  const order = db.prepare(`
    SELECT o.*, s.name AS site_name, s.slug AS site_slug
    FROM sms_orders o
    LEFT JOIN sms_sites s ON s.id = o.site_id
    WHERE o.order_no = ?
  `).get(orderNo);
  if (!order) {
    return reply.code(404).send({ message: "接码订单不存在" });
  }

  await syncNexSmsOrder(order).catch((error) => {
    createSmsOrderEvent(order.id, "nexsms_sync_error", { message: error.message });
  });

  let verification = readSmsOrderVerification(order);
  if (
    verification.verificationStatus !== "ready" &&
    order.sms_url &&
    ![smsOrderStatuses.refunded, smsOrderStatuses.timeout, smsOrderStatuses.failed, smsOrderStatuses.cancelled].includes(order.status)
  ) {
    try {
      const code = await fetchStaticSmsCode(order.sms_url);
      if (code) {
        if (order.sms_entry_id) {
          setCacheEntry(String(order.sms_entry_id), code, String(order.sms_entry_id));
        }
        verification = { verificationStatus: "ready", verificationCode: code };
      }
    } catch (error) {
      createSmsOrderEvent(order.id, "sms_url_fetch_error", { message: error.message });
    }
  }

  if (
    verification.verificationStatus !== "ready" &&
    order.status === smsOrderStatuses.ready &&
    order.verification_code &&
    !extractSmsVerificationCode(order.verification_code)
  ) {
    db.prepare(`
      UPDATE sms_orders
      SET status = ?, verification_code = NULL, updated_at = ?
      WHERE id = ?
    `).run(smsOrderStatuses.waiting_code, nowIso(), order.id);
    createSmsOrderEvent(order.id, "invalid_verification_ignored", { value: order.verification_code });
    order.status = smsOrderStatuses.waiting_code;
    order.verification_code = null;
  }

  if (
    verification.verificationStatus === "ready" &&
    (order.status !== smsOrderStatuses.ready || order.verification_code !== verification.verificationCode)
  ) {
    db.prepare(`
      UPDATE sms_orders
      SET status = ?, verification_code = ?, updated_at = ?
      WHERE id = ?
    `).run(smsOrderStatuses.ready, verification.verificationCode, nowIso(), order.id);
    releaseSmsCard(order.card_id, smsCardStatuses.used);
    if (order.sms_entry_id) {
      db.prepare(`UPDATE sms_entries SET status = 'used', updated_at = ? WHERE id = ?`).run(nowIso(), order.sms_entry_id);
    }
    createSmsOrderEvent(order.id, "verification_ready", { verificationCode: verification.verificationCode });
    order.status = smsOrderStatuses.ready;
    order.verification_code = verification.verificationCode;
  }

  if (
    verification.verificationStatus !== "ready" &&
    order.expires_at &&
    new Date(order.expires_at) <= new Date() &&
    ![smsOrderStatuses.ready, smsOrderStatuses.refunded, smsOrderStatuses.timeout].includes(order.status)
  ) {
    db.prepare(`
      UPDATE sms_orders
      SET status = ?, refunded_at = ?, updated_at = ?
      WHERE id = ?
    `).run(smsOrderStatuses.refunded, nowIso(), nowIso(), order.id);
    releaseSmsCard(order.card_id, smsCardStatuses.used);
    if (order.sms_entry_id) {
      db.prepare(`UPDATE sms_entries SET status = 'used', updated_at = ? WHERE id = ?`).run(nowIso(), order.sms_entry_id);
    }
    createSmsOrderEvent(order.id, "expired_used", null);
    order.status = smsOrderStatuses.refunded;
  }

  if (verification.verificationStatus === "timeout" && ![smsOrderStatuses.timeout, smsOrderStatuses.refunded, smsOrderStatuses.ready].includes(order.status)) {
    db.prepare(`
      UPDATE sms_orders
      SET status = ?, refunded_at = ?, updated_at = ?
      WHERE id = ?
    `).run(smsOrderStatuses.refunded, nowIso(), nowIso(), order.id);
    releaseSmsCard(order.card_id, smsCardStatuses.used);
    if (order.sms_entry_id) {
      db.prepare(`UPDATE sms_entries SET status = 'used', updated_at = ? WHERE id = ?`).run(nowIso(), order.sms_entry_id);
    }
    createSmsOrderEvent(order.id, "timeout_refunded", null);
    order.status = smsOrderStatuses.refunded;
  }

  return mapSmsOrderForPublic(order);
});

// 兼容旧前台查询入口：优先走新 sms_cards，其次回退到旧 sms_entries public_key 查询
app.get("/api/public/sms/query", async (request, reply) => {
  const key = String(request.query.key ?? "").trim();
  if (!key) {
    return reply.code(400).send({ message: "卡密格式不正确" });
  }

  const smsCard = getSmsCardDetail(key);
  if (smsCard) {
    if (isSmsCardStopped(smsCard.status)) {
      return reply.code(403).send({ message: "该接码卡密已停用" });
    }
    let order = smsCard.current_order_id
      ? db.prepare(`
          SELECT o.*, s.name AS site_name, s.slug AS site_slug
          FROM sms_orders o
          LEFT JOIN sms_sites s ON s.id = o.site_id
          WHERE o.id = ?
        `).get(smsCard.current_order_id)
      : getLatestSmsOrderByCardId(smsCard.id);
    if (!order) {
      return {
        phone: "",
        smsUrl: "",
        verificationStatus: "pending",
        verificationCode: null,
        cardStatus: smsCard.status,
        siteName: smsCard.site_name || ""
      };
    }
    const payload = mapSmsOrderForPublic(order);
    return {
      phone: payload.phone,
      smsUrl: order.sms_url || "",
      verificationStatus: payload.verificationStatus,
      verificationCode: payload.verificationCode,
      orderNo: payload.orderNo,
      siteName: payload.siteName,
      cardStatus: smsCard.status
    };
  }

  const entry = db.prepare("SELECT id, phone, sms_url, status FROM sms_entries WHERE public_key = ?").get(key);
  if (!entry) {
    return reply.code(404).send({ message: "卡密无效或不存在" });
  }

  if (isSmsCardStopped(entry.status)) {
    return reply.code(403).send({ message: "该卡密已停用" });
  }

  const cacheEntry = getCacheEntry(key);
  let verificationStatus = "pending";
  let verificationCode = null;

  if (cacheEntry) {
    if (cacheEntry.status === "ready") {
      verificationStatus = "ready";
      verificationCode = cacheEntry.verificationCode;
    } else if (cacheEntry.status === "timeout") {
      verificationStatus = "timeout";
      verificationCode = null;
    }
  }

  if (verificationStatus === "pending" && entry.sms_url) {
    try {
      const code = await fetchStaticSmsCode(entry.sms_url);
      if (code) {
        verificationStatus = "ready";
        verificationCode = code;
        setCacheEntry(key, code, String(entry.id));
      }
    } catch (error) {
      console.error("[SMS Query] Failed to fetch static SMS URL:", error.message);
    }
  }

  if (verificationStatus === "ready" || verificationStatus === "timeout") {
    db.prepare("UPDATE sms_entries SET status = 'used', updated_at = ? WHERE id = ? AND status != 'used'")
      .run(nowIso(), entry.id);
  }

  return {
    phone: entry.phone,
    smsUrl: entry.sms_url,
    verificationStatus,
    verificationCode,
    siteName: "静态库存",
    legacyStaticEntry: true
  };
});

// ─── SMS 内部接口 ─────────────────────────────────────────────────────────────
app.post("/api/internal/sms/verification", { preHandler: [requireInternalSecret] }, async (request, reply) => {
  const schema = z.object({
    publicKey: z.string().min(1),
    verificationCode: z.string().min(1),
    smsEntryId: z.string().min(1)
  });

  const parsed = schema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ message: "参数不正确" });
  }

  const { publicKey, verificationCode, smsEntryId } = parsed.data;
  const normalizedCode = extractSmsVerificationCode(verificationCode);
  if (!normalizedCode) {
    return { stored: false, reason: "verification_code_not_found" };
  }

  setCacheEntry(publicKey, normalizedCode, smsEntryId);
  db.prepare("UPDATE sms_entries SET status = 'used', updated_at = ? WHERE id = ? AND status != 'used'")
    .run(nowIso(), smsEntryId);

  const smsOrder = db.prepare("SELECT id, card_id FROM sms_orders WHERE sms_entry_id = ? AND status IN (?, ?)")
    .get(smsEntryId, smsOrderStatuses.waiting_code, smsOrderStatuses.number_reserved);
  if (smsOrder) {
    db.prepare("UPDATE sms_orders SET status = ?, verification_code = ?, updated_at = ? WHERE id = ?")
      .run(smsOrderStatuses.ready, normalizedCode, nowIso(), smsOrder.id);
    releaseSmsCard(smsOrder.card_id, smsCardStatuses.used);
    db.prepare("UPDATE sms_entries SET status = 'used', updated_at = ? WHERE id = ?").run(nowIso(), smsEntryId);
    createSmsOrderEvent(smsOrder.id, "verification_ready", { verificationCode: normalizedCode });
  }

  return { stored: true };
});

app.post("/api/internal/sms/timeout", { preHandler: [requireInternalSecret] }, async (request, reply) => {
  const schema = z.object({
    publicKey: z.string().min(1)
  });

  const parsed = schema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ message: "参数不正确" });
  }

  const { publicKey } = parsed.data;
  setTimeoutEntry(publicKey);
  db.prepare("UPDATE sms_entries SET status = 'used', updated_at = ? WHERE (id = ? OR public_key = ?) AND status != 'used'")
    .run(nowIso(), publicKey, publicKey);

  const smsOrder = db.prepare("SELECT id, card_id, sms_entry_id FROM sms_orders WHERE sms_entry_id = ? AND status IN (?, ?)")
    .get(publicKey, smsOrderStatuses.waiting_code, smsOrderStatuses.number_reserved);
  if (smsOrder) {
    db.prepare("UPDATE sms_orders SET status = ?, refunded_at = ?, updated_at = ? WHERE id = ?")
      .run(smsOrderStatuses.refunded, nowIso(), nowIso(), smsOrder.id);
    releaseSmsCard(smsOrder.card_id, smsCardStatuses.used);
    db.prepare("UPDATE sms_entries SET status = 'used', updated_at = ? WHERE id = ?").run(nowIso(), smsOrder.sms_entry_id);
    createSmsOrderEvent(smsOrder.id, "timeout_refunded", null);
  }

  return { marked: true };
});

app.post("/api/internal/sms/poll", { preHandler: [requireInternalSecret] }, async (request, reply) => {
  const schema = z.object({
    publicKey: z.string().min(1),
    smsUrl: z.string().min(1),
    smsEntryId: z.string().min(1)
  });

  const parsed = schema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ message: "参数不正确" });
  }

  // Stub: accept the poll request. Actual poll task management is handled by the Worker (Task 4).
  return { accepted: true };
});

app.post("/api/internal/sub2api/worldcup/settle", { preHandler: [requireInternalSecret] }, async (request, reply) => {
  const parsed = z.object({
    matchId: z.string().trim().min(1)
  }).safeParse(getBodyObject(request.body));
  if (!parsed.success) {
    return reply.code(400).send({ message: "参数不正确" });
  }

  const match = getSub2ApiWorldCupMatchById(parsed.data.matchId);
  if (!match) {
    return reply.code(404).send({ message: "比赛不存在" });
  }
  if (match.status === sub2apiWorldCupMatchStatuses.settled) {
    return { alreadySettled: true, match: serializeSub2ApiWorldCupMatch(match) };
  }
  if (match.status === sub2apiWorldCupMatchStatuses.cancelled) {
    return reply.code(409).send({ message: "比赛已取消，不能结算" });
  }
  if (match.home_score === null || match.home_score === undefined || match.away_score === null || match.away_score === undefined) {
    return reply.code(409).send({ message: "比赛比分尚未同步，不能结算" });
  }

  let result;
  try {
    result = getSub2ApiWorldCupResult(match.home_score, match.away_score);
  } catch (error) {
    return reply.code(400).send({ message: error.message });
  }

  if (match.status !== sub2apiWorldCupMatchStatuses.finished || match.result !== result) {
    db.prepare(`
      UPDATE sub2api_worldcup_matches
      SET status = ?, result = ?, updated_at = ?
      WHERE id = ?
    `).run(sub2apiWorldCupMatchStatuses.finished, result, nowIso(), match.id);
  }

  try {
    return await settleSub2ApiWorldCupMatch(getSub2ApiWorldCupMatchById(match.id), "worker");
  } catch (error) {
    return reply.code(error.statusCode || 502).send({ message: error.message || "比赛结算失败" });
  }
});

app.post("/api/internal/sub2api/worldcup/cancel", { preHandler: [requireInternalSecret] }, async (request, reply) => {
  const parsed = z.object({
    matchId: z.string().trim().min(1)
  }).safeParse(getBodyObject(request.body));
  if (!parsed.success) {
    return reply.code(400).send({ message: "参数不正确" });
  }

  const match = getSub2ApiWorldCupMatchById(parsed.data.matchId);
  if (!match) {
    return reply.code(404).send({ message: "比赛不存在" });
  }
  try {
    return await cancelSub2ApiWorldCupMatch(match, "worker");
  } catch (error) {
    return reply.code(error.statusCode || 502).send({ message: error.message || "取消比赛失败" });
  }
});

// ─── SMS 接码管理：批量状态修改 ───────────────────────────────────────────────
app.patch("/api/admin/sms/entries/status", { preHandler: requireAdmin }, async (request, reply) => {
  const schema = z.object({
    ids: z.array(z.string()).min(1),
    status: z.enum(["active", "disabled", "void"])
  });

  const parsed = schema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ message: "参数不正确，ids 至少包含一个，status 仅支持 active/disabled/void" });
  }

  const now = nowIso();
  let updatedCount = 0;

  for (const id of parsed.data.ids) {
    const result = db.prepare("UPDATE sms_entries SET status = ?, updated_at = ? WHERE id = ?")
      .run(parsed.data.status, now, id);
    if (result.changes > 0) {
      updatedCount++;
    }
  }

  createAuditLog({
    action: "sms_status_update",
    actor: request.admin.username,
    resourceType: "sms_entry",
    resourceId: null,
    detail: { ids: parsed.data.ids, status: parsed.data.status, updatedCount }
  });

  return { updatedCount };
});

// ─── SMS 站点 / 卡密 / 订单管理 ───────────────────────────────────────────────
app.get("/api/admin/sms/sites", { preHandler: requireAdmin }, async () => {
  const items = db.prepare(`
    SELECT s.*, COUNT(c.id) AS card_count
    FROM sms_sites s
    LEFT JOIN sms_cards c ON c.site_id = s.id
    GROUP BY s.id
    ORDER BY s.created_at DESC
  `).all().map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    inventorySource: row.inventory_source,
    smsProvider: row.sms_provider || null,
    smsAppId: row.sms_app_id || null,
    smsCardType: row.sms_card_type ?? null,
    smsExpiry: row.sms_expiry ?? null,
    status: row.status,
    note: row.note || "",
    cardCount: Number(row.card_count) || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
  return { items };
});

app.post("/api/admin/sms/sites", { preHandler: requireAdmin }, async (request, reply) => {
  const schema = z.object({
    name: z.string().min(1),
    slug: z.string().min(1),
    inventorySource: z.enum(["sms_entries", "nexsms"]).optional().default("sms_entries"),
    apiKey: z.string().optional().default(""),
    appId: z.string().optional().default(""),
    cardType: z.number().int().min(1).max(3).optional().default(1),
    expiry: z.number().int().min(0).max(6).optional().default(0),
    note: z.string().optional().default("")
  });
  const parsed = schema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ message: "请提供有效的站点名称和 slug" });
  }

  const { name, slug, inventorySource, apiKey, appId, cardType, expiry, note } = parsed.data;
  const normalizedSlug = slug.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-");
  const exists = db.prepare("SELECT id FROM sms_sites WHERE slug = ?").get(normalizedSlug);
  if (exists) {
    return reply.code(409).send({ message: "该接码站点 slug 已存在" });
  }

  const now = nowIso();
  const id = nanoid(16);
  db.prepare(`
    INSERT INTO sms_sites (id, name, slug, inventory_source, status, note, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, name.trim(), normalizedSlug, inventorySource, smsSiteStatuses.active, note.trim(), now, now);

  if (inventorySource === "nexsms") {
    db.prepare(`
      UPDATE sms_sites
      SET sms_provider = 'nexsms', sms_api_key = ?, sms_app_id = ?, sms_card_type = ?, sms_expiry = ?, updated_at = ?
      WHERE id = ?
    `).run(apiKey ? encryptText(apiKey) : null, appId || null, cardType, expiry, now, id);
  }

  createAuditLog({
    action: "sms_site_create",
    actor: request.admin.username,
    resourceType: "sms_site",
    resourceId: id,
    detail: { name: name.trim(), slug: normalizedSlug }
  });

  return { id, name: name.trim(), slug: normalizedSlug };
});

app.patch("/api/admin/sms/sites/:id/nexsms", { preHandler: requireAdmin }, async (request, reply) => {
  const siteId = String(request.params.id || "").trim();
  const site = db.prepare("SELECT id FROM sms_sites WHERE id = ?").get(siteId);
  if (!site) {
    return reply.code(404).send({ message: "接码站点不存在" });
  }

  const schema = z.object({
    apiKey: z.string().optional().default(""),
    appId: z.string().min(1),
    cardType: z.number().int().min(1).max(3).optional().default(1),
    expiry: z.number().int().min(0).max(6).optional().default(0),
    prefix: z.string().optional().default(""),
    excludePrefix: z.string().optional().default("")
  });
  const parsed = schema.safeParse(request.body || {});
  if (!parsed.success) {
    return reply.code(400).send({ message: "NexSMS 配置参数不正确" });
  }

  const now = nowIso();
  const encryptedKey = parsed.data.apiKey ? encryptText(parsed.data.apiKey.trim()) : null;
  if (encryptedKey) {
    db.prepare(`
      UPDATE sms_sites
      SET inventory_source = 'nexsms', sms_provider = 'nexsms', sms_api_key = ?, sms_app_id = ?,
          sms_card_type = ?, sms_expiry = ?, sms_prefix_filter = ?, sms_exclude_prefix = ?, updated_at = ?
      WHERE id = ?
    `).run(encryptedKey, parsed.data.appId.trim(), parsed.data.cardType, parsed.data.expiry, parsed.data.prefix.trim() || null, parsed.data.excludePrefix.trim() || null, now, siteId);
  } else {
    db.prepare(`
      UPDATE sms_sites
      SET inventory_source = 'nexsms', sms_provider = 'nexsms', sms_app_id = ?,
          sms_card_type = ?, sms_expiry = ?, sms_prefix_filter = ?, sms_exclude_prefix = ?, updated_at = ?
      WHERE id = ?
    `).run(parsed.data.appId.trim(), parsed.data.cardType, parsed.data.expiry, parsed.data.prefix.trim() || null, parsed.data.excludePrefix.trim() || null, now, siteId);
  }

  createAuditLog({
    action: "sms_site_nexsms_config",
    actor: request.admin.username,
    resourceType: "sms_site",
    resourceId: siteId,
    detail: { appId: parsed.data.appId.trim(), cardType: parsed.data.cardType, expiry: parsed.data.expiry }
  });

  return { success: true };
});

app.get("/api/admin/sms/cards", { preHandler: requireAdmin }, async () => {
  const items = db.prepare(`
    SELECT c.*, s.name AS site_name, s.slug AS site_slug
    FROM sms_cards c
    LEFT JOIN sms_sites s ON s.id = c.site_id
    ORDER BY c.created_at DESC
  `).all().map((row) => ({
    id: row.id,
    cardKey: row.card_key,
    prefix: row.prefix,
    status: row.status,
    siteId: row.site_id,
    siteName: row.site_name || "-",
    siteSlug: row.site_slug || "-",
    currentOrderId: row.current_order_id || null,
    resourceEntryId: row.resource_entry_id || null,
    note: row.note || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
  return { items };
});

app.post("/api/admin/sms/cards", { preHandler: requireAdmin }, async (request, reply) => {
  const schema = z.object({
    siteId: z.string().min(1),
    prefix: z.string().min(1).max(20),
    count: z.number().int().min(1).max(200),
    note: z.string().optional().default("")
  });
  const parsed = schema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ message: "请提供有效的站点、前缀和数量" });
  }

  const site = db.prepare("SELECT id, name, slug, status FROM sms_sites WHERE id = ?").get(parsed.data.siteId);
  if (!site) {
    return reply.code(404).send({ message: "接码站点不存在" });
  }

  const now = nowIso();
  const batchId = nanoid(16);
  const normalizedPrefix = parsed.data.prefix.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "");
  db.prepare(`
    INSERT INTO sms_card_batches (id, site_id, prefix, total_count, note, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(batchId, site.id, normalizedPrefix, parsed.data.count, parsed.data.note.trim(), request.admin.username, now, now);

  const cards = [];
  for (let i = 0; i < parsed.data.count; i += 1) {
    const id = nanoid(16);
    const cardKey = getUniqueSmsCardKey(normalizedPrefix);
    db.prepare(`
      INSERT INTO sms_cards (id, site_id, batch_id, card_key, prefix, status, current_order_id, resource_entry_id, note, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?)
    `).run(id, site.id, batchId, cardKey, normalizedPrefix, smsCardStatuses.active, parsed.data.note.trim(), now, now);
    cards.push({ id, cardKey });
  }

  createAuditLog({
    action: "sms_card_batch_create",
    actor: request.admin.username,
    resourceType: "sms_card_batch",
    resourceId: batchId,
    detail: { siteId: site.id, count: parsed.data.count, prefix: normalizedPrefix }
  });

  return { batchId, cards };
});

app.patch("/api/admin/sms/cards/status", { preHandler: requireAdmin }, async (request, reply) => {
  const schema = z.object({
    ids: z.array(z.string()).min(1),
    status: z.enum([smsCardStatuses.active, smsCardStatuses.disabled, smsCardStatuses.void])
  });
  const parsed = schema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ message: "参数不正确" });
  }

  const now = nowIso();
  let updatedCount = 0;
  for (const id of parsed.data.ids) {
    const result = db.prepare("UPDATE sms_cards SET status = ?, updated_at = ? WHERE id = ?")
      .run(parsed.data.status, now, id);
    if (result.changes > 0) updatedCount += 1;
  }

  createAuditLog({
    action: "sms_card_status_update",
    actor: request.admin.username,
    resourceType: "sms_card",
    resourceId: null,
    detail: { ids: parsed.data.ids, status: parsed.data.status, updatedCount }
  });

  return { updatedCount };
});

app.get("/api/admin/sms/orders", { preHandler: requireAdmin }, async () => {
  const items = db.prepare(`
    SELECT o.*, c.card_key, s.name AS site_name
    FROM sms_orders o
    LEFT JOIN sms_cards c ON c.id = o.card_id
    LEFT JOIN sms_sites s ON s.id = o.site_id
    ORDER BY o.created_at DESC
    LIMIT 200
  `).all().map((row) => ({
    id: row.id,
    orderNo: row.order_no,
    cardKey: row.card_key || "-",
    siteName: row.site_name || "-",
    phone: row.phone || "",
    verificationCode: row.verification_code || "",
    status: row.status,
    errorMessage: row.error_message || "",
    refundedAt: row.refunded_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
  return { items };
});

// ─── SMS 单条添加接口 ───────────────────────────────────────────────────────
app.post("/api/admin/sms/entries", { preHandler: requireAdmin }, async (request, reply) => {
  const schema = z.object({
    phone: z.string().min(1),
    smsUrl: z.string().min(1),
    prefix: z.string().min(1).max(10)
  });

  const parsed = schema.safeParse(request.body);
  if (!parsed.success) {
    // Determine which validation failed
    const fieldErrors = parsed.error.flatten().fieldErrors;
    if (fieldErrors.prefix) {
      return reply.code(400).send({ message: "卡密前缀不正确" });
    }
    return reply.code(400).send({ message: "手机号和接码网址不能为空" });
  }

  const { phone, smsUrl, prefix } = parsed.data;

  const now = nowIso();

  // Find or create a "单条添加" batch for this prefix
  let batch = db.prepare(
    "SELECT id FROM sms_batches WHERE name = ? AND prefix = ?"
  ).get("单条添加", prefix.toUpperCase().replace(/[^A-Z0-9_-]/g, ""));

  if (!batch) {
    const batchId = nanoid(16);
    db.prepare(`
      INSERT INTO sms_batches (id, name, prefix, imported_count, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      batchId,
      "单条添加",
      prefix.toUpperCase().replace(/[^A-Z0-9_-]/g, ""),
      0,
      request.admin.username,
      now,
      now
    );
    batch = { id: batchId };
  }

  const id = nanoid(16);
  const publicKey = getUniqueSmsPublicKey(prefix);

  db.prepare(`
    INSERT INTO sms_entries (id, phone, sms_url, public_key, prefix, batch_id, status, note, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'active', NULL, ?, ?)
  `).run(
    id,
    phone.trim(),
    smsUrl.trim(),
    publicKey,
    prefix.toUpperCase().replace(/[^A-Z0-9_-]/g, ""),
    batch.id,
    now,
    now
  );

  // Update batch imported_count
  db.prepare("UPDATE sms_batches SET imported_count = imported_count + 1, updated_at = ? WHERE id = ?")
    .run(now, batch.id);

  createAuditLog({
    action: "sms_single_add",
    actor: request.admin.username,
    resourceType: "sms_entry",
    resourceId: id,
    detail: { phone: phone.trim(), prefix, publicKey }
  });

  return { id, publicKey };
});

// ── Quota Public: Verify Sub-Card ──
app.post("/api/public/quota/verify", async (request, reply) => {
  const schema = z.object({
    cardCode: z.string().min(1)
  });
  const parsed = schema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({
      message: "请提供 cardCode",
      code: quotaErrorCodes.VALIDATION_ERROR
    });
  }

  const cardCode = parsed.data.cardCode.trim();
  const card = db.prepare(`
    SELECT id, card_code, total_quota, used_quota, status
    FROM quota_sub_cards
    WHERE card_code = ?
  `).get(cardCode);

  if (!card) {
    return reply.code(401).send({
      message: "卡密无效",
      code: quotaErrorCodes.CARD_INVALID
    });
  }

  if (card.status === quotaSubCardStatuses.void) {
    return reply.code(403).send({
      message: "卡密无效",
      code: quotaErrorCodes.CARD_INVALID
    });
  }

  if (card.status === quotaSubCardStatuses.locked) {
    return reply.code(429).send({
      message: "操作过于频繁，请稍后重试",
      code: quotaErrorCodes.CARD_LOCKED
    });
  }

  return {
    valid: true,
    cardCode: card.card_code,
    remaining: card.total_quota - card.used_quota
  };
});

// ── Quota Admin: Cards List ──
app.get("/api/admin/quota/cards", { preHandler: requireAdmin }, async (request) => {
  const page = Math.max(1, Math.floor(Number(request.query.page) || 1));
  const pageSize = Math.min(100, Math.max(1, Math.floor(Number(request.query.pageSize) || 20)));
  const offset = (page - 1) * pageSize;
  const status = request.query.status ? String(request.query.status) : null;

  const validStatuses = ["active", "used", "failed"];
  const statusFilter = status && validStatuses.includes(status) ? status : null;

  const countSql = statusFilter
    ? "SELECT COUNT(*) AS count FROM quota_source_cards WHERE status = ?"
    : "SELECT COUNT(*) AS count FROM quota_source_cards";
  const total = statusFilter
    ? db.prepare(countSql).get(statusFilter).count
    : db.prepare(countSql).get().count;

  const querySql = statusFilter
    ? `SELECT * FROM quota_source_cards WHERE status = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`
    : `SELECT * FROM quota_source_cards ORDER BY created_at DESC LIMIT ? OFFSET ?`;
  const rows = statusFilter
    ? db.prepare(querySql).all(statusFilter, pageSize, offset)
    : db.prepare(querySql).all(pageSize, offset);

  const cards = rows.map((row) => {
    let sourceKeyDisplay = "";
    try {
      const decrypted = decryptText(row.source_key);
      if (decrypted && decrypted.length > 8) {
        sourceKeyDisplay = decrypted.slice(0, 4) + "****" + decrypted.slice(-4);
      } else if (decrypted) {
        sourceKeyDisplay = decrypted.slice(0, 2) + "****";
      }
    } catch {
      // If decryption fails, source_key might be stored in plain text
      const raw = row.source_key || "";
      if (raw.length > 8) {
        sourceKeyDisplay = raw.slice(0, 4) + "****" + raw.slice(-4);
      } else if (raw.length > 0) {
        sourceKeyDisplay = raw.slice(0, 2) + "****";
      }
    }

    return {
      id: row.id,
      sourceKey: sourceKeyDisplay,
      quota: row.quota,
      remaining: row.remaining,
      status: row.status,
      importBatchId: row.import_batch_id || null,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  });

  return { cards, total, page, pageSize };
});

// ── Quota Admin: Import Cards ──
app.post("/api/admin/quota/cards/import", { preHandler: requireAdmin }, async (request, reply) => {
  const schema = z.object({
    cards: z.array(z.string().min(1)).min(1).max(100)
  });

  const parsed = schema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({
      message: "请提供 cards 数组（1-100 张卡密）",
      code: quotaErrorCodes.VALIDATION_ERROR
    });
  }

  const { cards } = parsed.data;
  const now = nowIso();

  // 重复卡密检测：检查是否有 source_key 已存在于 quota_source_cards 表中
  const existingRows = db.prepare("SELECT source_key FROM quota_source_cards").all();
  const existingKeys = new Set();
  for (const row of existingRows) {
    try {
      existingKeys.add(decryptText(row.source_key));
    } catch {
      existingKeys.add(row.source_key);
    }
  }

  for (const code of cards) {
    if (existingKeys.has(code.trim())) {
      return reply.code(409).send({
        message: "该卡密已存在",
        code: quotaErrorCodes.CARD_EXISTS
      });
    }
  }

  // 检查批次内是否有重复
  const uniqueCards = [...new Set(cards.map(c => c.trim()))];
  if (uniqueCards.length !== cards.length) {
    return reply.code(409).send({
      message: "该卡密已存在",
      code: quotaErrorCodes.CARD_EXISTS
    });
  }

  // 创建导入批次
  const batchId = nanoid(16);
  db.prepare(`
    INSERT INTO quota_import_batches (id, total_count, success_count, failed_count, merged_card_id, status, created_by, created_at, updated_at)
    VALUES (?, ?, 0, 0, NULL, ?, ?, ?, ?)
  `).run(batchId, uniqueCards.length, quotaBatchStatuses.pending, request.admin.username, now, now);

  let successCount = 0;
  let failureCount = 0;
  const failures = [];
  const activeCardCodes = [];

  // 逐一验证卡密
  for (const cardCode of uniqueCards) {
    const trimmedCode = cardCode.trim();
    const cardId = nanoid(16);

    try {
      const result = await verifyExternalCard(trimmedCode);

      if (result.ok === true && result.remaining > 0) {
        // 验证成功：插入 quota_source_cards（status=active）
        db.prepare(`
          INSERT INTO quota_source_cards (id, source_key, quota, remaining, status, import_batch_id, merged_into_id, verify_response, retry_count, last_error, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, NULL, ?, 0, NULL, ?, ?)
        `).run(
          cardId,
          encryptText(trimmedCode),
          result.quota || result.remaining,
          result.remaining,
          quotaCardStatuses.active,
          batchId,
          JSON.stringify(result),
          now,
          now
        );
        successCount++;
        activeCardCodes.push(trimmedCode);
      } else {
        // 验证失败（ok=false 或 remaining=0）：插入 quota_source_cards（status=failed）并记录错误
        const reason = result.ok === false
          ? "卡密无效"
          : "卡密额度已耗尽";

        db.prepare(`
          INSERT INTO quota_source_cards (id, source_key, quota, remaining, status, import_batch_id, merged_into_id, verify_response, retry_count, last_error, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, NULL, ?, 0, ?, ?, ?)
        `).run(
          cardId,
          encryptText(trimmedCode),
          result.quota || 0,
          result.remaining || 0,
          quotaCardStatuses.failed,
          batchId,
          JSON.stringify(result),
          reason,
          now,
          now
        );
        failureCount++;
        failures.push({ code: trimmedCode, reason });
      }
    } catch (error) {
      // 外部 API 超时或异常
      const reason = error.message || "外部接口请求失败";
      db.prepare(`
        INSERT INTO quota_source_cards (id, source_key, quota, remaining, status, import_batch_id, merged_into_id, verify_response, retry_count, last_error, created_at, updated_at)
        VALUES (?, ?, 0, 0, ?, ?, NULL, NULL, 0, ?, ?, ?)
      `).run(
        cardId,
        encryptText(trimmedCode),
        quotaCardStatuses.failed,
        batchId,
        reason,
        now,
        now
      );
      failureCount++;
      failures.push({ code: trimmedCode, reason });
    }
  }

  // 更新批次状态
  const batchStatus = successCount > 0 && failureCount === 0
    ? quotaBatchStatuses.completed
    : quotaBatchStatuses.partial;
  db.prepare(`
    UPDATE quota_import_batches
    SET success_count = ?, failed_count = ?, status = ?, updated_at = ?
    WHERE id = ?
  `).run(successCount, failureCount, batchStatus, now, batchId);

  // The new upstream API no longer supports source-card merging; keep imported API keys active.
  const mergeResult = activeCardCodes.length >= 2
    ? {
        success: false,
        skipped: true,
        error: "新版 API 不支持合并源卡密，已保留为多张 active API key 源卡"
      }
    : null;
  return {
    successCount,
    failureCount,
    failures,
    mergeResult
  };
});

// ── Quota Admin: Merge Cards ──
app.post("/api/admin/quota/cards/merge", { preHandler: requireAdmin }, async (request, reply) => {
  return reply.code(410).send({
    success: false,
    error: "新版 API 不支持合并源卡密，请直接保留多个 API key 源卡使用",
    code: quotaErrorCodes.EXTERNAL_API_ERROR
  });
});

// ── Quota Admin: Verify (Refresh) Merged Card Quota ──
// Proxy that wraps shared/src/quota-api.js#verifyExternalCard so the admin
// browser never talks directly to the external host. We look up the card by
// id, decrypt source_key, call external verify, and on ok=true write back
// the external remaining to quota_source_cards so local data stays in sync.
// Pass through { ok, quota, remaining, used } to the caller.
app.post("/api/admin/quota/cards/verify", { preHandler: requireAdmin }, async (request, reply) => {
  const schema = z.object({
    cardId: z.string().min(1)
  });

  const parsed = schema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({
      ok: false,
      error: "请提供 cardId",
      code: quotaErrorCodes.VALIDATION_ERROR
    });
  }

  const card = db.prepare(`
    SELECT id, source_key
    FROM quota_source_cards
    WHERE id = ?
  `).get(parsed.data.cardId);

  if (!card) {
    return reply.code(404).send({
      ok: false,
      error: "卡密不存在",
      code: quotaErrorCodes.CARD_INVALID
    });
  }

  let cardCode;
  try {
    cardCode = decryptText(card.source_key);
  } catch {
    return reply.code(500).send({
      ok: false,
      error: "卡密解密失败"
    });
  }

  try {
    const result = await verifyExternalCard(cardCode);

    // Write back external remaining to local DB when verify succeeds
    if (result.ok === true && typeof result.remaining === 'number' && result.remaining >= 0) {
      db.prepare('UPDATE quota_source_cards SET remaining = ?, updated_at = ? WHERE id = ?').run(result.remaining, nowIso(), card.id);
    }

    return {
      ok: Boolean(result?.ok),
      quota: result?.quota ?? null,
      remaining: result?.remaining ?? null,
      used: Boolean(result?.used)
    };
  } catch (error) {
    return reply.code(502).send({
      ok: false,
      error: error.message || "外部接口请求失败"
    });
  }
});

// ── Quota Admin: Dashboard ──
app.patch("/api/admin/quota/cards/:id", { preHandler: requireAdmin }, async (request, reply) => {
  const id = String(request.params.id || "").trim();
  const apiKey = String(request.body?.apiKey || "").trim();
  if (!id || !apiKey) {
    return reply.code(400).send({ message: "请提供 id 和 apiKey", code: quotaErrorCodes.VALIDATION_ERROR });
  }

  const existing = db.prepare("SELECT id FROM quota_source_cards WHERE id = ?").get(id);
  if (!existing) {
    return reply.code(404).send({ message: "API 密钥不存在", code: quotaErrorCodes.CARD_INVALID });
  }

  const rows = db.prepare("SELECT id, source_key FROM quota_source_cards WHERE id <> ?").all(id);
  for (const row of rows) {
    try {
      if (decryptText(row.source_key) === apiKey) {
        return reply.code(409).send({ message: "API 密钥已存在", code: quotaErrorCodes.CARD_EXISTS });
      }
    } catch {
      if (row.source_key === apiKey) {
        return reply.code(409).send({ message: "API 密钥已存在", code: quotaErrorCodes.CARD_EXISTS });
      }
    }
  }

  let result;
  try {
    result = await verifyExternalCard(apiKey);
  } catch (error) {
    return reply.code(502).send({ message: error.message || "外部接口请求失败", code: quotaErrorCodes.EXTERNAL_API_ERROR });
  }

  if (result.ok !== true || !(result.remaining > 0)) {
    return reply.code(400).send({ message: "API 密钥无效或余额已耗尽", code: quotaErrorCodes.CARD_INVALID });
  }

  const now = nowIso();
  db.prepare(`
    UPDATE quota_source_cards
    SET source_key = ?, quota = ?, remaining = ?, status = ?, verify_response = ?, last_error = NULL, updated_at = ?
    WHERE id = ?
  `).run(
    encryptText(apiKey),
    result.quota || result.remaining,
    result.remaining,
    quotaCardStatuses.active,
    JSON.stringify(result),
    now,
    id
  );

  createAuditLog({
    action: "quota_source_card_update",
    actor: request.admin.username,
    resourceType: "quota_source_card",
    resourceId: id
  });

  return { success: true, id, quota: result.quota, remaining: result.remaining, updatedAt: now };
});

app.delete("/api/admin/quota/cards/:id", { preHandler: requireAdmin }, async (request, reply) => {
  const id = String(request.params.id || "").trim();
  const row = db.prepare("SELECT id FROM quota_source_cards WHERE id = ?").get(id);
  if (!row) {
    return reply.code(404).send({ message: "API 密钥不存在", code: quotaErrorCodes.CARD_INVALID });
  }

  db.prepare("DELETE FROM quota_source_cards WHERE id = ?").run(id);
  createAuditLog({
    action: "quota_source_card_delete",
    actor: request.admin.username,
    resourceType: "quota_source_card",
    resourceId: id
  });

  return { success: true, id };
});

app.post("/api/admin/quota/cards/export", { preHandler: requireAdmin }, async (request, reply) => {
  const ids = Array.isArray(request.body?.ids) ? request.body.ids.map((id) => String(id).trim()).filter(Boolean) : [];
  const exportAll = request.body?.all === true;
  if (!exportAll && ids.length === 0) {
    return reply.code(400).send({ message: "请选择要导出的 API 密钥", code: quotaErrorCodes.VALIDATION_ERROR });
  }

  const rows = exportAll
    ? db.prepare("SELECT id, source_key, quota, remaining, status, created_at, updated_at FROM quota_source_cards ORDER BY created_at DESC").all()
    : db.prepare(`SELECT id, source_key, quota, remaining, status, created_at, updated_at FROM quota_source_cards WHERE id IN (${ids.map(() => "?").join(",")}) ORDER BY created_at DESC`).all(...ids);

  const items = rows.map((row) => {
    let apiKey = "";
    try {
      apiKey = decryptText(row.source_key);
    } catch {
      apiKey = row.source_key || "";
    }
    return {
      id: row.id,
      apiKey,
      quota: row.quota,
      remaining: row.remaining,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  });

  return { items };
});

app.get("/api/admin/quota/dashboard", { preHandler: requireAdmin }, async () => {
  const totalQuota = getTotalQuota(db);
  const allocatedQuota = getAllocatedQuota(db);
  const availableQuota = getAvailableQuota(db);

  const activeSubCards = db.prepare(
    "SELECT COUNT(*) AS count FROM quota_sub_cards WHERE status = 'active'"
  ).get().count;

  const totalClaims = db.prepare(
    "SELECT COUNT(*) AS count FROM quota_claim_logs"
  ).get().count;

  return {
    totalQuota,
    allocatedQuota,
    availableQuota,
    activeSubCards,
    totalClaims
  };
});

// ── Quota Admin: Create Sub-Cards ──
app.post("/api/admin/quota/sub-cards", { preHandler: requireAdmin }, async (request, reply) => {
  const { quota, count } = request.body || {};

  // Validate input
  if (
    !Number.isInteger(quota) || quota < 1 || quota > 999999 ||
    !Number.isInteger(count) || count < 1 || count > 100
  ) {
    return reply.code(400).send({
      message: "输入不合法：quota 必须为 1-999999 的整数，count 必须为 1-100 的整数",
      code: quotaErrorCodes.VALIDATION_ERROR
    });
  }

  // Check available quota
  const availableQuota = getAvailableQuota(db);
  const totalRequired = quota * count;
  if (totalRequired > availableQuota) {
    return reply.code(400).send({
      message: `额度不足，当前可分配额度为 ${availableQuota}`,
      code: quotaErrorCodes.QUOTA_INSUFFICIENT
    });
  }

  // Create sub-cards in a transaction
  const now = nowIso();
  const cards = [];

  const insertStmt = db.prepare(`
    INSERT INTO quota_sub_cards (id, card_code, total_quota, used_quota, status, created_at, updated_at)
    VALUES (?, ?, ?, 0, 'active', ?, ?)
  `);

  const createCards = db.transaction(() => {
    for (let i = 0; i < count; i++) {
      const id = nanoid(16);
      const cardCode = getUniqueSubCardCode(db);
      insertStmt.run(id, cardCode, quota, now, now);
      cards.push({
        id,
        cardCode,
        totalQuota: quota,
        status: "active",
        createdAt: now
      });
    }
  });

  createCards();

  return { success: true, cards, count };
});

// ── Quota Admin: Sub-Cards List ──
app.get("/api/admin/quota/sub-cards", { preHandler: requireAdmin }, async (request) => {
  const page = Math.max(1, Math.floor(Number(request.query.page) || 1));
  const pageSize = Math.min(100, Math.max(1, Math.floor(Number(request.query.pageSize) || 20)));
  const offset = (page - 1) * pageSize;
  const status = request.query.status ? String(request.query.status) : null;

  const validStatuses = ["active", "locked", "void"];
  const statusFilter = status && validStatuses.includes(status) ? status : null;

  const countSql = statusFilter
    ? "SELECT COUNT(*) AS count FROM quota_sub_cards WHERE status = ?"
    : "SELECT COUNT(*) AS count FROM quota_sub_cards";
  const total = statusFilter
    ? db.prepare(countSql).get(statusFilter).count
    : db.prepare(countSql).get().count;

  const querySql = statusFilter
    ? `SELECT * FROM quota_sub_cards WHERE status = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`
    : `SELECT * FROM quota_sub_cards ORDER BY created_at DESC LIMIT ? OFFSET ?`;
  const rows = statusFilter
    ? db.prepare(querySql).all(statusFilter, pageSize, offset)
    : db.prepare(querySql).all(pageSize, offset);

  const subCards = rows.map((row) => ({
    id: row.id,
    cardCode: row.card_code,
    totalQuota: row.total_quota,
    usedQuota: row.used_quota,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));

  return { subCards, total, page, pageSize };
});

// ── Quota Admin: Sub-Card Detail ──
app.get("/api/admin/quota/sub-cards/:id", { preHandler: requireAdmin }, async (request, reply) => {
  const { id } = request.params;

  const row = db.prepare("SELECT * FROM quota_sub_cards WHERE id = ?").get(id);
  if (!row) {
    return reply.code(404).send({ message: "子卡密不存在", code: quotaErrorCodes.CARD_INVALID });
  }

  return {
    id: row.id,
    cardCode: row.card_code,
    totalQuota: row.total_quota,
    usedQuota: row.used_quota,
    remaining: row.total_quota - row.used_quota,
    status: row.status,
    lockedAt: row.locked_at,
    lockedUntil: row.locked_until,
    lockReason: row.lock_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
});

// ── Quota Admin: Sub-Card History ──
app.get("/api/admin/quota/sub-cards/:id/history", { preHandler: requireAdmin }, async (request, reply) => {
  const { id } = request.params;

  const row = db.prepare("SELECT * FROM quota_sub_cards WHERE id = ?").get(id);
  if (!row) {
    return reply.code(404).send({ message: "子卡密不存在", code: quotaErrorCodes.CARD_INVALID });
  }

  const logs = db.prepare(`
    SELECT id, amount, account_count, accounts, warning_ack_id, source_ip, created_at
    FROM quota_claim_logs
    WHERE sub_card_id = ?
    ORDER BY created_at DESC
  `).all(id);

  const history = logs.map(log => ({
    id: log.id,
    amount: log.amount,
    accountCount: log.account_count,
    accounts: log.accounts ? JSON.parse(log.accounts) : [],
    warningAckId: log.warning_ack_id,
    sourceIp: log.source_ip,
    createdAt: log.created_at
  }));

  return { history };
});

// ── Quota Admin: Cancel Sub-Card ──
app.post("/api/admin/quota/sub-cards/:id/cancel", { preHandler: requireAdmin }, async (request, reply) => {
  const { id } = request.params;

  const row = db.prepare("SELECT * FROM quota_sub_cards WHERE id = ?").get(id);
  if (!row) {
    return reply.code(404).send({ message: "子卡密不存在", code: quotaErrorCodes.CARD_INVALID });
  }

  if (row.status === quotaSubCardStatuses.locked) {
    return reply.code(409).send({ message: "该卡密正在使用中，无法取消", code: quotaErrorCodes.CANCEL_DENIED });
  }

  if (row.status === quotaSubCardStatuses.void) {
    return reply.code(400).send({ message: "该卡密已被取消" });
  }

  const remaining = row.total_quota - row.used_quota;
  const now = nowIso();

  db.prepare(`
    UPDATE quota_sub_cards
    SET status = ?, updated_at = ?
    WHERE id = ?
  `).run(quotaSubCardStatuses.void, now, id);

  createAuditLog({
    action: "quota_sub_card_cancel",
    actor: request.admin.username,
    resourceType: "quota_sub_card",
    resourceId: id,
    detail: {
      card_code: row.card_code,
      returned_quota: remaining,
      operator: request.admin.username
    }
  });

  return {
    success: true,
    returnedQuota: remaining,
    cardCode: row.card_code,
    newStatus: quotaSubCardStatuses.void
  };
});

// ── Quota Admin: Get Settings ──
app.post("/api/admin/quota/sub-cards/:id/unlock", { preHandler: requireAdmin }, async (request, reply) => {
  const { id } = request.params;

  const row = db.prepare("SELECT * FROM quota_sub_cards WHERE id = ?").get(id);
  if (!row) {
    return reply.code(404).send({ message: "子卡密不存在", code: quotaErrorCodes.CARD_INVALID });
  }

  if (row.status !== quotaSubCardStatuses.locked) {
    return reply.code(400).send({ message: "该子卡密不是 locked 状态", code: quotaErrorCodes.VALIDATION_ERROR });
  }

  const now = nowIso();
  db.prepare(`
    UPDATE quota_sub_cards
    SET status = 'active', locked_at = NULL, locked_until = NULL, lock_reason = NULL, updated_at = ?
    WHERE id = ?
  `).run(now, id);

  createAuditLog({
    action: "quota_sub_card_unlock",
    actor: request.admin.username,
    resourceType: "quota_sub_card",
    resourceId: id,
    detail: {
      card_code: row.card_code,
      operator: request.admin.username
    }
  });

  return { success: true, id, newStatus: quotaSubCardStatuses.active };
});

app.get("/api/admin/quota/settings", { preHandler: requireAdmin }, async () => {
  const row = db.prepare(
    "SELECT low_stock_threshold, updated_at, updated_by FROM quota_settings WHERE id = 'default'"
  ).get();
  return {
    lowStockThreshold: row?.low_stock_threshold ?? 5,
    updatedAt: row?.updated_at || null,
    updatedBy: row?.updated_by || null
  };
});

// ── Quota Admin: Update Settings ──
app.patch("/api/admin/quota/settings", { preHandler: requireAdmin }, async (request, reply) => {
  const { low_stock_threshold } = request.body || {};

  if (
    low_stock_threshold === undefined ||
    !Number.isInteger(low_stock_threshold) ||
    low_stock_threshold < 1
  ) {
    return reply.code(400).send({
      message: "low_stock_threshold 必须为正整数（>= 1）",
      code: quotaErrorCodes.VALIDATION_ERROR
    });
  }

  const now = nowIso();
  db.prepare(`
    UPDATE quota_settings
    SET low_stock_threshold = ?, updated_at = ?, updated_by = ?
    WHERE id = 'default'
  `).run(low_stock_threshold, now, request.admin.username);

  return {
    id: "default",
    lowStockThreshold: low_stock_threshold,
    updatedAt: now,
    updatedBy: request.admin.username
  };
});

// ── Quota Public: Get Card Info ──
app.get("/api/public/quota/info", async (request, reply) => {
  const cardCode = String(request.query.cardCode || "").trim();
  if (!cardCode) {
    return reply.code(400).send({ message: "缺少 cardCode 参数", code: quotaErrorCodes.VALIDATION_ERROR });
  }

  const row = db.prepare("SELECT * FROM quota_sub_cards WHERE card_code = ?").get(cardCode);
  if (!row || row.status === quotaSubCardStatuses.void) {
    return reply.code(401).send({ message: "卡密无效", code: quotaErrorCodes.CARD_INVALID });
  }

  if (row.status === quotaSubCardStatuses.locked) {
    return reply.code(429).send({ message: "卡密已被锁定，请稍后重试", code: quotaErrorCodes.CARD_LOCKED });
  }

  const remaining = row.total_quota - row.used_quota;
  const activeSubCardCount = db.prepare(`
    SELECT COUNT(*) AS cnt FROM quota_sub_cards WHERE status = 'active'
  `).get().cnt;

  return {
    remaining,
    totalQuota: row.total_quota,
    usedQuota: row.used_quota,
    availableStock: activeSubCardCount
  };
});

// ── Quota Public: Claim History ──
app.get("/api/public/quota/history", async (request, reply) => {
  const cardCode = String(request.query.cardCode || "").trim();
  if (!cardCode) {
    return reply.code(400).send({ message: "缺少 cardCode 参数", code: quotaErrorCodes.VALIDATION_ERROR });
  }

  const row = db.prepare("SELECT * FROM quota_sub_cards WHERE card_code = ?").get(cardCode);
  if (!row || row.status === quotaSubCardStatuses.void) {
    return reply.code(401).send({ message: "卡密无效", code: quotaErrorCodes.CARD_INVALID });
  }

  const logs = db.prepare(`
    SELECT id, amount, account_count, accounts, created_at
    FROM quota_claim_logs
    WHERE card_code = ?
    ORDER BY created_at DESC
  `).all(cardCode);

  const history = logs.map(log => ({
    id: log.id,
    amount: log.amount,
    accountCount: log.account_count,
    accounts: log.accounts ? JSON.parse(log.accounts) : [],
    createdAt: log.created_at
  }));

  return { history };
});

// ── Quota Public: Claim History Download ──
app.get("/api/public/quota/history/download", async (request, reply) => {
  const cardCode = String(request.query.cardCode || "").trim();
  if (!cardCode) {
    return reply.code(400).send({ message: "缺少 cardCode 参数", code: quotaErrorCodes.VALIDATION_ERROR });
  }

  const row = db.prepare("SELECT * FROM quota_sub_cards WHERE card_code = ?").get(cardCode);
  if (!row || row.status === quotaSubCardStatuses.void) {
    return reply.code(401).send({ message: "卡密无效", code: quotaErrorCodes.CARD_INVALID });
  }

  const logs = db.prepare(`
    SELECT amount, account_count, accounts, created_at
    FROM quota_claim_logs
    WHERE card_code = ?
    ORDER BY created_at DESC
  `).all(cardCode);

  const content = generateExportText(cardCode, logs);

  reply.header("Content-Type", "text/plain; charset=utf-8");
  reply.header("Content-Disposition", `attachment; filename="quota-history-${cardCode}.txt"`);
  return reply.send(content);
});

// ── Quota Public: Claim Warning ──
app.get("/api/public/quota/claim-warning", async () => {
  try {
    const response = await fetchClaimWarning();
    if (response && response.warning && response.warning.id) {
      return {
        warning: {
          id: response.warning.id,
          title: response.warning.title,
          message: response.warning.message,
          requiredText: response.warning.requiredText || ""
        }
      };
    }
    return { warning: null };
  } catch {
    return { warning: null };
  }
});

// ── Quota Public: External Status ──
app.get("/api/public/quota/status", async () => {
  const availableQuota = getAvailableQuota(db);
  let available = "无货";
  if (availableQuota > 1000) {
    available = "1000多";
  } else if (availableQuota > 100) {
    available = "100多";
  } else if (availableQuota > 0) {
    available = "小于100";
  }

  return {
    available,
    availableQuota,
    cachedAt: nowIso()
  };
});

app.post("/api/public/quota/auto-claim/session", async (request, reply) => {
  const schema = z.object({
    cardCode: z.string().min(1)
  });
  const parsed = schema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({
      message: "请提供 cardCode",
      code: quotaErrorCodes.VALIDATION_ERROR
    });
  }

  cleanupQuotaAutoClaimSessions();

  const subCard = db.prepare("SELECT id, status FROM quota_sub_cards WHERE card_code = ?").get(parsed.data.cardCode);
  if (!subCard || subCard.status === quotaSubCardStatuses.void) {
    return reply.code(401).send({ message: "卡密无效", code: quotaErrorCodes.CARD_INVALID });
  }
  if (subCard.status === quotaSubCardStatuses.used) {
    return reply.code(403).send({ message: "额度已用完", code: quotaErrorCodes.CARD_EXHAUSTED });
  }

  const session = {
    id: nanoid(16),
    cardCode: parsed.data.cardCode,
    status: getActiveQuotaAutoClaimCount() < QUOTA_AUTO_CLAIM_MAX_ACTIVE ? "active" : "queued",
    createdAt: nowIso(),
    updatedAt: nowIso(),
    startedAt: null,
    lastSeenAt: Date.now()
  };
  if (session.status === "active") {
    session.startedAt = nowIso();
  } else {
    quotaAutoClaimQueue.push(session.id);
  }
  quotaAutoClaimSessions.set(session.id, session);

  return serializeQuotaAutoClaimSession(session);
});

app.get("/api/public/quota/auto-claim/session/:id", async (request, reply) => {
  cleanupQuotaAutoClaimSessions();

  const session = quotaAutoClaimSessions.get(request.params.id);
  if (!session) {
    return reply.code(404).send({
      message: "自动提取会话已过期，请重新启动",
      code: quotaErrorCodes.VALIDATION_ERROR
    });
  }

  touchQuotaAutoClaimSession(session);
  promoteQuotaAutoClaimQueue();
  return serializeQuotaAutoClaimSession(session);
});

app.delete("/api/public/quota/auto-claim/session/:id", async (request) => {
  const sessionId = request.params.id;
  quotaAutoClaimSessions.delete(sessionId);
  const index = quotaAutoClaimQueue.indexOf(sessionId);
  if (index >= 0) {
    quotaAutoClaimQueue.splice(index, 1);
  }
  promoteQuotaAutoClaimQueue();

  return {
    success: true,
    active: getActiveQuotaAutoClaimCount(),
    maxActive: QUOTA_AUTO_CLAIM_MAX_ACTIVE
  };
});

// ── Quota Public: Claim ──
app.post("/api/public/quota/claim", async (request, reply) => {
  const schema = z.object({
    cardCode: z.string().min(1),
    count: z.number().int().min(1),
    warningAckId: z.string().default(""),
    autoSessionId: z.string().optional().default("")
  });
  const parsed = schema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({
      message: "请提供 cardCode、count 和 warningAckId",
      code: quotaErrorCodes.VALIDATION_ERROR
    });
  }

  const { cardCode, count, warningAckId, autoSessionId } = parsed.data;
  const sourceIp = request.ip || request.headers["x-forwarded-for"] || "";

  if (!autoSessionId) {
    return reply.code(400).send({
      message: "请先启动自动提取并进入队列",
      code: quotaErrorCodes.VALIDATION_ERROR
    });
  }

  cleanupQuotaAutoClaimSessions();
  const autoSession = quotaAutoClaimSessions.get(autoSessionId);
  if (!autoSession || autoSession.cardCode !== cardCode) {
    return reply.code(409).send({
      message: "自动提取会话已过期，请重新启动",
      code: quotaErrorCodes.VALIDATION_ERROR
    });
  }
  touchQuotaAutoClaimSession(autoSession);
  promoteQuotaAutoClaimQueue();
  if (autoSession.status !== "active") {
    return reply.code(202).send({
      success: false,
      queued: true,
      message: "自动提取排队中，请等待进入提取阶段",
      queue: serializeQuotaAutoClaimSession(autoSession)
    });
  }

  // Step 1: Look up sub-card by card_code, validate status is 'active'
  const subCard = db.prepare("SELECT * FROM quota_sub_cards WHERE card_code = ?").get(cardCode);
  if (!subCard || subCard.status === quotaSubCardStatuses.void) {
    return reply.code(401).send({ message: "卡密无效", code: quotaErrorCodes.CARD_INVALID });
  }

  if (subCard.status === quotaSubCardStatuses.used) {
    return reply.code(403).send({ message: "额度已用完", code: quotaErrorCodes.CARD_EXHAUSTED });
  }

  // Check if card is locked but lock has expired (auto-unlock)
  if (subCard.status === quotaSubCardStatuses.locked) {
    if (subCard.locked_until && new Date(subCard.locked_until) <= new Date()) {
      // Auto-unlock: lock duration has passed
      db.prepare(`
        UPDATE quota_sub_cards
        SET status = 'active', locked_at = NULL, locked_until = NULL, lock_reason = NULL, updated_at = ?
        WHERE id = ?
      `).run(nowIso(), subCard.id);
      subCard.status = quotaSubCardStatuses.active;
    } else {
      return reply.code(429).send({
        message: "操作过于频繁，请稍后重试",
        code: quotaErrorCodes.RATE_LIMITED
      });
    }
  }

  // Step 2: Check rate limit
  const windowStart = new Date(Date.now() - QUOTA_RATE_LIMIT_WINDOW * 1000).toISOString();
  const rateRow = db.prepare(`
    SELECT id, request_count FROM quota_rate_limits
    WHERE sub_card_id = ? AND window_start > ?
    ORDER BY window_start DESC
    LIMIT 1
  `).get(subCard.id, windowStart);

  if (rateRow && rateRow.request_count >= QUOTA_RATE_LIMIT_MAX) {
    // Lock the card for 30 minutes
    const now = nowIso();
    const lockedUntil = new Date(Date.now() + QUOTA_LOCK_DURATION_MINUTES * 60 * 1000).toISOString();
    db.prepare(`
      UPDATE quota_sub_cards
      SET status = 'locked', locked_at = ?, locked_until = ?, lock_reason = 'rate_limit', updated_at = ?
      WHERE id = ?
    `).run(now, lockedUntil, now, subCard.id);

    return reply.code(429).send({
      message: "操作过于频繁，请稍后重试",
      code: quotaErrorCodes.RATE_LIMITED
    });
  }

  // Step 3: Increment rate limit counter
  const now = nowIso();
  if (rateRow) {
    db.prepare("UPDATE quota_rate_limits SET request_count = request_count + 1 WHERE id = ?").run(rateRow.id);
  } else {
    db.prepare(`
      INSERT INTO quota_rate_limits (id, sub_card_id, request_count, window_start, created_at)
      VALUES (?, ?, 1, ?, ?)
    `).run(nanoid(16), subCard.id, now, now);
  }

  // Step 4: Check remaining quota
  const remaining = subCard.total_quota - subCard.used_quota;
  if (remaining < count) {
    return reply.code(403).send({
      message: "额度已用完",
      code: quotaErrorCodes.CARD_EXHAUSTED
    });
  }

  // Step 5: 选取一张本地仍有库存的 active 源卡密（FIFO，先排空旧卡）
  const sourceCard = db.prepare(`
    SELECT id, source_key FROM quota_source_cards
    WHERE status = 'active' AND remaining > 0
    ORDER BY created_at ASC
    LIMIT 1
  `).get();

  if (!sourceCard) {
    return reply.code(500).send({
      message: "系统无可用源卡密",
      code: quotaErrorCodes.EXTERNAL_API_ERROR
    });
  }

  let sourceCardCode;
  try {
    sourceCardCode = decryptText(sourceCard.source_key);
  } catch {
    return reply.code(500).send({
      message: "源卡密解密失败",
      code: quotaErrorCodes.EXTERNAL_API_ERROR
    });
  }

  let externalResult;
  try {
    externalResult = await claimFromExternal(sourceCardCode, count, warningAckId);
  } catch (error) {
    // External API failed: don't modify local state
    return reply.code(502).send({
      message: error.message || "外部接口请求失败",
      code: quotaErrorCodes.EXTERNAL_API_ERROR
    });
  }

  // Step 7: If external API returns ok=true, update local state
  if (externalResult && externalResult.ok === true) {
    const chargedQuota = externalResult.chargedQuota || count;
    const accounts = externalResult.accounts || [];
    const accountCount = accounts.length;

    // Atomic update: used_quota += chargedQuota, insert claim_log
    db.prepare(`
      UPDATE quota_sub_cards
      SET used_quota = used_quota + ?, updated_at = ?
      WHERE id = ?
    `).run(chargedQuota, nowIso(), subCard.id);

    db.prepare(`
      INSERT INTO quota_claim_logs (id, sub_card_id, card_code, amount, account_count, accounts, warning_ack_id, source_ip, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      nanoid(16),
      subCard.id,
      cardCode,
      chargedQuota,
      accountCount,
      JSON.stringify(accounts),
      warningAckId,
      sourceIp,
      nowIso()
    );

    // Bug C fix: write back source card remaining from external response
    if (typeof externalResult.remaining === 'number' && externalResult.remaining >= 0) {
      db.prepare('UPDATE quota_source_cards SET remaining = ?, updated_at = ? WHERE id = ?').run(externalResult.remaining, nowIso(), sourceCard.id);
    }

    const newRemaining = subCard.total_quota - subCard.used_quota - chargedQuota;

    // Auto-transition: sub-card exhausted → mark as used
    if (newRemaining <= 0) {
      db.prepare(`UPDATE quota_sub_cards SET status = 'used', updated_at = ? WHERE id = ?`).run(nowIso(), subCard.id);
    }

    return {
      success: true,
      remaining: newRemaining,
      chargedQuota,
      accounts
    };
  }

  // Step 8: External API returned ok=false or unexpected response
  return reply.code(502).send({
    message: externalResult?.message || externalResult?.error || "外部接口返回失败",
    code: quotaErrorCodes.EXTERNAL_API_ERROR
  });
});

// ── 5sim Balance ──
app.get("/api/admin/5sim/balance", { preHandler: requireAdmin }, async (request, reply) => {
  const siteId = request.query.siteId ? String(request.query.siteId).trim() : "";
  if (!siteId) {
    return reply.code(400).send({ message: "缺少 siteId 参数" });
  }

  const site = db.prepare("SELECT * FROM sites WHERE id = ?").get(siteId);
  if (!site) {
    return reply.code(400).send({ message: "站点不存在" });
  }

  if (!site.sms_api_key) {
    return reply.code(400).send({ message: "该站点未配置 5sim API Key" });
  }

  let decryptedKey;
  try {
    decryptedKey = decryptText(site.sms_api_key);
  } catch {
    return reply.code(400).send({ message: "API Key 解密失败" });
  }

  try {
    const balance = await Promise.race([
      getBalance(decryptedKey),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 10000))
    ]);
    return { balance, currency: "RUB" };
  } catch (error) {
    return reply.code(502).send({ message: `5sim 余额查询失败: ${error.message}` });
  }
});

// ── 5sim SMS Config ──
const smsConfigSchema = z.object({
  sms_provider: z.string().max(50).optional(),
  sms_api_key: z.string().max(512).optional(),
  sms_country: z.string().max(100).optional(),
  sms_service: z.string().max(100).optional(),
  sms_operator: z.string().max(100).optional(),
  sms_poll_interval_ms: z.number().int().min(1000).optional(),
  sms_poll_timeout_ms: z.number().int().min(5000).optional(),
  sms_submit_phone_template: z.string().max(4096).optional(),
  sms_submit_code_template: z.string().max(4096).optional(),
}).strict();

app.patch("/api/admin/sites/:id/sms-config", { preHandler: requireAdmin }, async (request, reply) => {
  const siteId = request.params.id;
  const site = db.prepare("SELECT * FROM sites WHERE id = ?").get(siteId);
  if (!site) {
    return reply.code(404).send({ message: "站点不存在" });
  }

  if (!request.body || Object.keys(request.body).length === 0) {
    return reply.code(400).send({ message: "请求体不能为空" });
  }

  const parsed = smsConfigSchema.safeParse(request.body);
  if (!parsed.success) {
    const firstError = parsed.error.issues[0];
    return reply.code(400).send({ message: `字段 ${firstError.path.join(".")} 无效: ${firstError.message}` });
  }

  const fields = parsed.data;
  if (Object.keys(fields).length === 0) {
    return reply.code(400).send({ message: "请求体不能为空" });
  }

  // Encrypt sms_api_key if provided
  if (fields.sms_api_key) {
    fields.sms_api_key = encryptText(fields.sms_api_key);
  }

  // Build dynamic UPDATE
  const setClauses = Object.keys(fields).map((k) => `${k} = ?`);
  const values = Object.values(fields);
  const now = nowIso();
  setClauses.push("updated_at = ?");
  values.push(now);
  values.push(siteId);

  db.prepare(`UPDATE sites SET ${setClauses.join(", ")} WHERE id = ?`).run(...values);

  // Audit log
  createAuditLog({
    action: "site.sms_config_update",
    actor: request.admin.username,
    resourceType: "site",
    resourceId: siteId,
    detail: { fields: Object.keys(parsed.data) },
  });

  // Return updated config with masked api key
  const updated = db.prepare("SELECT * FROM sites WHERE id = ?").get(siteId);
  const smsFields = {
    sms_provider: updated.sms_provider || null,
    sms_api_key: maskApiKey(updated.sms_api_key),
    sms_country: updated.sms_country || null,
    sms_service: updated.sms_service || null,
    sms_operator: updated.sms_operator || null,
    sms_poll_interval_ms: updated.sms_poll_interval_ms ?? null,
    sms_poll_timeout_ms: updated.sms_poll_timeout_ms ?? null,
    sms_submit_phone_template: updated.sms_submit_phone_template || null,
    sms_submit_code_template: updated.sms_submit_code_template || null,
  };
  return smsFields;
});

function maskApiKey(val) {
  if (!val || val.length <= 12) return val || null;
  return val.slice(0, 6) + "..." + val.slice(-4);
}

// ── 5sim Jobs ──
app.get("/api/admin/5sim/jobs", { preHandler: requireAdmin }, async (request, reply) => {
  const rows = db.prepare(`
    SELECT j.id, j.status, j.payload, j.updated_at,
           o.order_no, s.name AS site_name
    FROM activation_jobs j
    LEFT JOIN redeem_orders o ON o.id = j.order_id
    LEFT JOIN sites s ON s.id = j.site_id
    WHERE j.payload LIKE '%fivesimOrderId%'
    ORDER BY j.updated_at DESC
    LIMIT 100
  `).all();

  const items = rows.map((row) => {
    const payload = safeParseJson(row.payload, {});
    return {
      id: row.id,
      order_no: row.order_no || null,
      site_name: row.site_name || null,
      status: row.status,
      fivesimOrderId: payload.fivesimOrderId || null,
      fivesimPhone: payload.fivesimPhone || null,
      fivesimCode: payload.fivesimCode || null,
      fivesimStatus: payload.fivesimStatus || null,
      fivesimPollCount: payload.fivesimPollCount ?? null,
      updated_at: row.updated_at
    };
  });

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

export {
  verificationCache,
  CACHE_TTL_MS,
  CACHE_CLEANUP_INTERVAL_MS,
  setCacheEntry,
  setTimeoutEntry,
  getCacheEntry,
  cleanupExpiredEntries
};
