import dns from "node:dns/promises";
import net from "node:net";

const MAX_RESPONSE_BYTES = 512 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;
const TERMINAL_STATUSES = new Set(["succeeded", "failed", "manual_review", "cancelled"]);
const TASK_STATUSES = new Set(["queued", "running", ...TERMINAL_STATUSES]);
const DIRECT_OFFER_BY_PLAN_ID = Object.freeze({
  "plus-monthly": "plus",
  "go-monthly": "go",
  "pro20x-direct-monthly": "x20"
});

export function automateV1CanonicalOffer(planId, taskType = "purchase") {
  return taskType === "purchase" ? (DIRECT_OFFER_BY_PLAN_ID[String(planId || "")] || null) : null;
}

export class AutomationAdapterError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = "AutomationAdapterError";
    this.code = code;
    this.statusCode = options.statusCode || 502;
    this.definitelyNotCreated = options.definitelyNotCreated === true;
    this.retryable = options.retryable !== false;
    this.providerCode = options.providerCode || null;
  }
}

function fail(code, message, options) {
  throw new AutomationAdapterError(code, message, options);
}

function boundedString(value, field, max = 200) {
  const result = typeof value === "string" ? value.trim() : "";
  if (!result || result.length > max || /[\u0000-\u001f\u007f]/.test(result)) {
    fail("AUTOMATION_CONTRACT_INVALID", `Automate 字段 ${field} 无效`, { retryable: false });
  }
  return result;
}

function optionalString(value, max = 500) {
  if (value === null || value === undefined || value === "") return null;
  const result = typeof value === "string" ? value.trim() : "";
  return result && result.length <= max && !/[\u0000-\u001f\u007f]/.test(result) ? result : null;
}

function isRestrictedIp(address) {
  if (net.isIPv4(address)) {
    const parts = address.split(".").map(Number);
    return parts[0] === 0 || parts[0] === 10 || parts[0] === 127
      || (parts[0] === 169 && parts[1] === 254)
      || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
      || (parts[0] === 192 && parts[1] === 168)
      || (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127)
      || parts[0] >= 224;
  }
  if (net.isIPv6(address)) {
    const normalized = address.toLowerCase().split("%")[0];
    const mappedV4 = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
    if (mappedV4) return isRestrictedIp(mappedV4);
    return normalized === "::" || normalized === "::1" || normalized.startsWith("fc")
      || normalized.startsWith("fd") || /^fe[89ab]/.test(normalized)
      || normalized.startsWith("ff") || normalized.startsWith("2001:db8:");
  }
  return true;
}

export function normalizeAutomateV1BaseUrl(value) {
  let url;
  try {
    url = new URL(String(value || "").trim());
  } catch {
    fail("AUTOMATION_BASE_URL_INVALID", "自动化站点地址无效", { retryable: false });
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.port) {
    fail("AUTOMATION_BASE_URL_INVALID", "自动化站点必须使用无附加凭据的标准 HTTPS 地址", { retryable: false });
  }
  const path = url.pathname.replace(/\/+$/, "");
  if (!path.endsWith("/api/v1/automate")) {
    fail("AUTOMATION_BASE_URL_INVALID", "Automate V1 地址必须以 /api/v1/automate 结尾", { retryable: false });
  }
  url.pathname = path;
  return url.toString().replace(/\/$/, "");
}

export async function assertPublicAutomationOrigin(baseUrl, lookup = dns.lookup) {
  const url = new URL(normalizeAutomateV1BaseUrl(baseUrl));
  let results;
  try {
    results = await lookup(url.hostname, { all: true, verbatim: true });
  } catch {
    fail("AUTOMATION_DNS_FAILED", "自动化站点域名解析失败");
  }
  if (!Array.isArray(results) || results.length === 0 || results.some((item) => isRestrictedIp(item.address))) {
    fail("AUTOMATION_ORIGIN_RESTRICTED", "自动化站点解析到了受限网络地址", { retryable: false });
  }
  return url.origin;
}

async function readJson(response) {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    try { await response.body?.cancel(); } catch {}
    fail("AUTOMATION_RESPONSE_TOO_LARGE", "自动化站点响应过大");
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_RESPONSE_BYTES) fail("AUTOMATION_RESPONSE_TOO_LARGE", "自动化站点响应过大");
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    fail("AUTOMATION_RESPONSE_INVALID", "自动化站点响应不是合法 JSON");
  }
}

function normalizePlan(item) {
  const taskType = boundedString(item?.taskType, "plans.taskType", 40);
  if (!["purchase", "upgrade"].includes(taskType)) {
    fail("AUTOMATION_CONTRACT_INVALID", "Automate 套餐类型无法识别", { retryable: false });
  }
  const id = boundedString(item?.id, "plans.id", 120);
  return Object.freeze({
    id,
    name: boundedString(item?.name, "plans.name", 200),
    label: boundedString(item?.label, "plans.label", 100),
    taskType,
    canonicalOffer: automateV1CanonicalOffer(id, taskType)
  });
}

function normalizeRegion(item) {
  const code = boundedString(item?.code, "regions.code", 20).toUpperCase();
  const currency = boundedString(item?.currency, "regions.currency", 20).toUpperCase();
  return Object.freeze({ code, currency, label: boundedString(item?.label, "regions.label", 100) });
}

export function normalizeAutomateV1Config(payload) {
  if (!payload || payload.success !== true || !Array.isArray(payload.plans)
    || !Array.isArray(payload.regions) || payload.plans.length === 0 || payload.regions.length === 0) {
    fail("AUTOMATION_CONTRACT_INVALID", "Automate 配置响应结构无法识别", { retryable: false });
  }
  const plans = payload.plans.map(normalizePlan);
  const regions = payload.regions.map(normalizeRegion);
  if (new Set(plans.map((item) => item.id)).size !== plans.length
    || new Set(regions.map((item) => item.code)).size !== regions.length) {
    fail("AUTOMATION_CONTRACT_INVALID", "Automate 配置包含重复能力", { retryable: false });
  }
  const defaultRegion = boundedString(payload.defaultRegion, "defaultRegion", 20).toUpperCase();
  if (!regions.some((item) => item.code === defaultRegion)) {
    fail("AUTOMATION_CONTRACT_INVALID", "Automate 默认区域不在启用区域中", { retryable: false });
  }
  return Object.freeze({
    plans: Object.freeze(plans),
    regions: Object.freeze(regions),
    defaultRegion,
    billingAddressSource: optionalString(payload.billingAddressSource, 100),
    syncedRequestId: optionalString(payload.requestId, 200)
  });
}

function normalizedTask(task) {
  if (!task || typeof task !== "object") fail("AUTOMATION_CONTRACT_INVALID", "Automate 任务结构无法识别");
  const status = boundedString(task.status, "task.status", 40);
  if (!TASK_STATUSES.has(status)) fail("AUTOMATION_CONTRACT_INVALID", "Automate 任务状态无法识别");
  const pricing = task.pricing && typeof task.pricing === "object" ? task.pricing : {};
  const renewal = task.renewalStatus && typeof task.renewalStatus === "object" ? task.renewalStatus : {};
  const card = task.card && typeof task.card === "object" ? task.card : {};
  const error = task.error && typeof task.error === "object" ? task.error : null;
  return Object.freeze({
    id: boundedString(task.id, "task.id", 200),
    clientOrderId: boundedString(task.clientOrderId, "task.clientOrderId", 120),
    status,
    terminal: TERMINAL_STATUSES.has(status),
    planId: optionalString(task.planId, 120),
    planName: optionalString(task.planName, 200),
    checkoutCountry: optionalString(task.checkoutCountry, 20),
    checkoutCurrency: optionalString(task.checkoutCurrency, 20)?.toUpperCase() || null,
    currentPhase: optionalString(task.currentPhase, 100),
    message: optionalString(task.message, 500),
    card: Object.freeze({
      brand: optionalString(card.brand, 40),
      last4: /^\d{4}$/.test(String(card.last4 || "")) ? String(card.last4) : null
    }),
    pricing: Object.freeze({
      currency: optionalString(pricing.currency, 20)?.toUpperCase() || null,
      displayTotal: optionalString(pricing.displayTotal, 100),
      displayUsdTotal: optionalString(pricing.displayUsdTotal, 100),
      confirmed: pricing.confirmed === true
    }),
    subscriptionStatus: optionalString(task.subscriptionStatus, 100),
    renewalStatus: Object.freeze({
      status: optionalString(renewal.status, 100),
      label: optionalString(renewal.label, 200),
      verified: renewal.verified === true,
      willRenew: typeof renewal.willRenew === "boolean" ? renewal.willRenew : null
    }),
    billing: task.billing && typeof task.billing === "object" ? Object.freeze({
      pointsCost: Number.isFinite(Number(task.billing.pointsCost)) ? Number(task.billing.pointsCost) : null,
      pointsStatus: optionalString(task.billing.pointsStatus, 40)
    }) : null,
    error: error ? Object.freeze({
      code: optionalString(error.code, 120),
      message: optionalString(error.message, 500)
    }) : null,
    createdAt: optionalString(task.createdAt, 100),
    updatedAt: optionalString(task.updatedAt, 100),
    completedAt: optionalString(task.completedAt, 100)
  });
}

function validateCard(card) {
  const number = String(card?.number || "").replace(/\D/g, "");
  const cvc = String(card?.cvc || "").trim();
  const expMonth = String(card?.expMonth || "").padStart(2, "0");
  const expYear = String(card?.expYear || "").trim();
  if (!/^\d{13,19}$/.test(number) || !/^\d{3,4}$/.test(cvc)
    || !/^(0[1-9]|1[0-2])$/.test(expMonth) || !/^20\d{2}$/.test(expYear)) {
    fail("AUTOMATION_CARD_INVALID", "提交给自动化站点的卡片资料无效", { retryable: false });
  }
  return { number, cvc, expMonth, expYear };
}

export class AutomateV1Adapter {
  constructor(options = {}) {
    this.baseUrl = normalizeAutomateV1BaseUrl(options.baseUrl);
    this.apiKey = boundedString(options.apiKey, "apiKey", 500);
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    this.lookup = options.lookup || dns.lookup;
    this.timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : DEFAULT_TIMEOUT_MS;
  }

  async request(path, options = {}) {
    await assertPublicAutomationOrigin(this.baseUrl, this.lookup);
    const url = new URL(`${this.baseUrl}${path}`);
    if (url.origin !== new URL(this.baseUrl).origin) {
      fail("AUTOMATION_ORIGIN_CHANGED", "自动化请求越过了已配置站点 Origin", { retryable: false });
    }
    const headers = { Accept: "application/json", "X-Automate-Key": this.apiKey };
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    if (options.requestId) headers["X-Request-Id"] = options.requestId;
    let response;
    try {
      response = await this.fetchImpl(url, {
        method: options.method || "GET",
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        redirect: "manual",
        signal: AbortSignal.timeout(this.timeoutMs)
      });
    } catch (error) {
      const timedOut = error?.name === "TimeoutError" || error?.name === "AbortError";
      fail(timedOut ? "AUTOMATION_TIMEOUT" : "AUTOMATION_UNAVAILABLE",
        timedOut ? "自动化站点请求超时" : "自动化站点网络异常");
    }
    if (response.status >= 300 && response.status < 400) {
      fail("AUTOMATION_REDIRECT_BLOCKED", "自动化站点返回了不允许的重定向", { retryable: false });
    }
    const payload = await readJson(response);
    if (!response.ok || payload?.success !== true) {
      const providerCode = optionalString(payload?.code, 120);
      const definitelyNotCreated = options.create === true && response.status >= 400 && response.status < 500
        && Boolean(providerCode) && !payload?.task;
      fail(providerCode === "automate_points_insufficient" ? "AUTOMATION_POINTS_INSUFFICIENT" : "AUTOMATION_REMOTE_REJECTED",
        optionalString(payload?.message, 500) || `自动化站点返回 HTTP ${response.status}`, {
          statusCode: response.status,
          providerCode,
          definitelyNotCreated,
          retryable: response.status >= 500 || response.status === 429
        });
    }
    return payload;
  }

  async discoverCapabilities() {
    return normalizeAutomateV1Config(await this.request("/config"));
  }

  async createTask(input = {}) {
    const body = {
      clientOrderId: boundedString(input.clientOrderId, "clientOrderId", 120),
      planId: boundedString(input.planId, "planId", 120),
      checkoutCountry: boundedString(input.checkoutCountry, "checkoutCountry", 20).toUpperCase(),
      authSessionJson: input.authSessionJson,
      card: validateCard(input.card)
    };
    const payload = await this.request("/tasks", {
      method: "POST",
      body,
      requestId: input.requestId,
      create: true
    });
    return Object.freeze({
      idempotentReplay: payload.idempotentReplay === true,
      requestId: optionalString(payload.requestId, 200),
      task: normalizedTask(payload.task)
    });
  }

  async getTask(taskId) {
    const payload = await this.request(`/tasks/${encodeURIComponent(boundedString(taskId, "taskId", 200))}`);
    return Object.freeze({ requestId: optionalString(payload.requestId, 200), task: normalizedTask(payload.task) });
  }
}
