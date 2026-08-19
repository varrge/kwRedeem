import dns from "node:dns/promises";
import net from "node:net";
import { ProxyAgent } from "undici";
import { AutomationAdapterError } from "./automate-v1.js";

const MAX_RESPONSE_BYTES = 512 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;
const PROXY_AGENTS = new Map();
const PLAN_DEFINITIONS = Object.freeze([
  Object.freeze({ id: "plus", name: "ChatGPT Plus", label: "Plus", taskType: "purchase", canonicalOffer: "plus" }),
  Object.freeze({ id: "pro5", name: "ChatGPT Pro 5X", label: "Pro 5X", taskType: "purchase", canonicalOffer: "x5" }),
  Object.freeze({ id: "pro20", name: "ChatGPT Pro 20X", label: "Pro 20X", taskType: "purchase", canonicalOffer: "x20" })
]);
const PLAN_BY_ID = new Map(PLAN_DEFINITIONS.map((item) => [item.id, item]));
const PROVIDER_STATUSES = new Set(["pending", "processing", "success", "failed"]);

function fail(code, message, options = {}) {
  throw new AutomationAdapterError(code, message, options);
}

function boundedString(value, field, max = 200, options = {}) {
  const result = typeof value === "string" ? value.trim() : "";
  if (!result || result.length > max || /[\u0000-\u001f\u007f]/.test(result)) {
    fail("EFUN_AUTOMATION_CONTRACT_INVALID", `eFun 字段 ${field} 无效`, {
      retryable: false,
      ...options
    });
  }
  return result;
}

function optionalString(value, max = 500) {
  if (value === null || value === undefined || value === "") return null;
  const result = typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
  return result && result.length <= max && !/[\u0000-\u001f\u007f]/.test(result) ? result : null;
}

function providerCode(value) {
  const code = optionalString(value, 120);
  return code && /^[A-Za-z0-9_.:-]+$/.test(code) ? code : null;
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

export function normalizeEfunOpenV1BaseUrl(value) {
  let url;
  try {
    url = new URL(String(value || "").trim());
  } catch {
    fail("AUTOMATION_BASE_URL_INVALID", "eFun 站点地址无效", { retryable: false });
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.port) {
    fail("AUTOMATION_BASE_URL_INVALID", "eFun 站点必须使用无附加凭据的标准 HTTPS 地址", { retryable: false });
  }
  const path = url.pathname.replace(/\/+$/, "");
  if (!path.endsWith("/api/v1")) {
    fail("AUTOMATION_BASE_URL_INVALID", "eFun Open API v1 地址必须以 /api/v1 结尾", { retryable: false });
  }
  url.pathname = path;
  return url.toString().replace(/\/$/, "");
}

export function normalizeEfunAutomationProxyUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  let url;
  try { url = new URL(raw); } catch {
    fail("AUTOMATION_PROXY_INVALID", "eFun 自动化代理地址无效", { retryable: false });
  }
  const hostname = url.hostname.toLowerCase();
  if (!["http:", "https:"].includes(url.protocol)
    || !["127.0.0.1", "localhost", "[::1]"].includes(hostname)
    || url.pathname !== "/" || url.username || url.password || url.search || url.hash) {
    fail("AUTOMATION_PROXY_INVALID", "eFun 自动化代理必须是无认证的本机 HTTP/HTTPS 地址", {
      retryable: false
    });
  }
  return url.toString().replace(/\/$/, "");
}

function proxyAgent(proxyUrl) {
  if (!proxyUrl) return undefined;
  if (!PROXY_AGENTS.has(proxyUrl)) PROXY_AGENTS.set(proxyUrl, new ProxyAgent(proxyUrl));
  return PROXY_AGENTS.get(proxyUrl);
}

async function assertPublicEfunOrigin(baseUrl, lookup = dns.lookup) {
  const url = new URL(normalizeEfunOpenV1BaseUrl(baseUrl));
  let results;
  try {
    results = await lookup(url.hostname, { all: true, verbatim: true });
  } catch {
    fail("AUTOMATION_DNS_FAILED", "eFun 站点域名解析失败");
  }
  if (!Array.isArray(results) || results.length === 0 || results.some((item) => isRestrictedIp(item.address))) {
    fail("AUTOMATION_ORIGIN_RESTRICTED", "eFun 站点解析到了受限网络地址", { retryable: false });
  }
  return url.origin;
}

async function readJson(response) {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    try { await response.body?.cancel(); } catch {}
    fail("AUTOMATION_RESPONSE_TOO_LARGE", "eFun 站点响应过大");
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_RESPONSE_BYTES) fail("AUTOMATION_RESPONSE_TOO_LARGE", "eFun 站点响应过大");
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    fail("AUTOMATION_RESPONSE_INVALID", "eFun 站点响应不是合法 JSON");
  }
}

function validateCard(card) {
  const number = String(card?.number || "").replace(/\D/g, "");
  const cvv = String(card?.cvc || "").trim();
  const expMonth = Number(card?.expMonth);
  const expYear = Number(card?.expYear);
  if (!/^\d{12,19}$/.test(number) || !/^\d{3,4}$/.test(cvv)
    || !Number.isInteger(expMonth) || expMonth < 1 || expMonth > 12
    || !Number.isInteger(expYear) || expYear < 2000 || expYear > 9999) {
    fail("AUTOMATION_CARD_INVALID", "提交给 eFun 站点的卡片资料无效", {
      retryable: false,
      definitelyNotCreated: true
    });
  }
  return Object.freeze({ number, cvv, expMonth, expYear });
}

function validateSession(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("AUTOMATION_SESSION_INVALID", "提交给 eFun 站点的 Session 结构无效", {
      retryable: false,
      definitelyNotCreated: true
    });
  }
  return value;
}

function displayAmount(value) {
  if (value === null || value === undefined || value === "") return null;
  const result = typeof value === "number" || typeof value === "string" ? String(value).trim() : "";
  return result && result.length <= 100 && /^\d+(?:\.\d+)?$/.test(result.replace(/,/g, "")) ? result : null;
}

function cardLast4(value, fallback = null) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length >= 4) return digits.slice(-4);
  return /^\d{4}$/.test(String(fallback || "")) ? String(fallback) : null;
}

function normalizeTask(data, context = {}) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    fail("EFUN_AUTOMATION_CONTRACT_INVALID", "eFun 订单结构无法识别");
  }
  const providerStatus = boundedString(data.status, "data.status", 40);
  if (!PROVIDER_STATUSES.has(providerStatus)) {
    fail("EFUN_AUTOMATION_CONTRACT_INVALID", "eFun 订单状态无法识别");
  }
  const planId = boundedString(data.plan_type, "data.plan_type", 40);
  const plan = PLAN_BY_ID.get(planId);
  if (!plan) fail("EFUN_AUTOMATION_CONTRACT_INVALID", "eFun 订单套餐无法识别");
  if (context.planId && planId !== context.planId) {
    fail("EFUN_AUTOMATION_CONTRACT_INVALID", "eFun 订单套餐与本地映射不一致", { retryable: false });
  }
  if (data.order_type !== "direct") {
    fail("EFUN_AUTOMATION_CONTRACT_INVALID", "eFun 返回了非直充订单", { retryable: false });
  }
  const queryKey = boundedString(data.card_key, "data.card_key", 128);
  const providerOrderId = boundedString(data.order_no, "data.order_no", 120);
  const cancellationKnown = data.is_subscription_cancelled === 0 || data.is_subscription_cancelled === 1;
  const subscriptionCancelled = data.is_subscription_cancelled === 1;
  let status = providerStatus === "pending" ? "queued" : "running";
  if (providerStatus === "success" && subscriptionCancelled) status = "succeeded";
  if (providerStatus === "failed") status = "failed";
  const amount = displayAmount(data.payment_amount);
  if (data.payment_amount !== null && data.payment_amount !== undefined && data.payment_amount !== "" && amount === null) {
    fail("EFUN_AUTOMATION_CONTRACT_INVALID", "eFun 支付金额无法识别");
  }
  const providedCurrency = optionalString(data.payment_currency, 20);
  if (data.payment_currency !== null && data.payment_currency !== undefined && data.payment_currency !== ""
    && !providedCurrency) {
    fail("EFUN_AUTOMATION_CONTRACT_INVALID", "eFun 支付币种无法识别");
  }
  const currency = providedCurrency?.toUpperCase() || "PHP";
  const paymentResult = data.payment_result && typeof data.payment_result === "object"
    && !Array.isArray(data.payment_result) ? data.payment_result : null;
  const failureMessage = optionalString(data.failure_reason, 500);
  const message = status === "succeeded"
    ? "eFun 已完成开通并取消自动续费"
    : (providerStatus === "success" ? "eFun 已开通，等待取消自动续费" : (failureMessage || "eFun 订单处理中"));
  return Object.freeze({
    id: queryKey,
    providerOrderId,
    clientOrderId: boundedString(context.clientOrderId, "clientOrderId", 120),
    status,
    providerStatus,
    terminal: ["succeeded", "failed"].includes(status),
    planId,
    planName: plan.name,
    checkoutCountry: "PH",
    checkoutCurrency: "PHP",
    currentPhase: status === "succeeded"
      ? "finished"
      : (providerStatus === "success" ? "renewal_cancellation" : providerStatus),
    message,
    card: Object.freeze({
      brand: null,
      last4: cardLast4(data.bank_card_no, context.cardLast4)
    }),
    pricing: Object.freeze({
      currency,
      displayTotal: amount,
      displayUsdTotal: null,
      confirmed: providerStatus === "success",
      amountUnavailable: amount === null,
      evidence: providerStatus === "success" && paymentResult?.success === true ? "provider_paid" : "provider_status"
    }),
    subscriptionStatus: providerStatus === "success" ? "active" : null,
    renewalStatus: Object.freeze({
      status: subscriptionCancelled ? "cancelled" : (providerStatus === "success" ? "pending" : null),
      label: subscriptionCancelled ? "已取消自动续费" : null,
      verified: providerStatus === "success" && cancellationKnown,
      willRenew: providerStatus === "success" && cancellationKnown ? !subscriptionCancelled : null
    }),
    billing: null,
    error: status === "failed" ? Object.freeze({
      code: "EFUN_REMOTE_ORDER_FAILED",
      message: failureMessage || "eFun 自动化订单失败"
    }) : null,
    createdAt: optionalString(data.created_at, 100),
    updatedAt: optionalString(data.updated_at, 100),
    completedAt: optionalString(data.finished_at, 100)
  });
}

function createCapabilities() {
  return Object.freeze({
    plans: Object.freeze(PLAN_DEFINITIONS.map((item) => Object.freeze({ ...item }))),
    regions: Object.freeze([
      Object.freeze({ code: "PH", currency: "PHP", label: "Philippines" })
    ]),
    defaultRegion: "PH",
    billingAddressSource: "provider_managed",
    pricingEvidence: "provider_status_with_optional_amount"
  });
}

function unsafeCreateError(error) {
  if (!(error instanceof AutomationAdapterError) || error.definitelyNotCreated || error.unsafeToReplay) return error;
  return new AutomationAdapterError(error.code, error.message, {
    statusCode: error.statusCode,
    definitelyNotCreated: false,
    unsafeToReplay: true,
    retryable: error.retryable,
    providerCode: error.providerCode
  });
}

export class EfunOpenV1Adapter {
  constructor(options = {}) {
    this.baseUrl = normalizeEfunOpenV1BaseUrl(options.baseUrl);
    this.apiKey = boundedString(options.apiKey, "apiKey", 500);
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    this.lookup = options.lookup || dns.lookup;
    this.timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : DEFAULT_TIMEOUT_MS;
    this.proxyUrl = normalizeEfunAutomationProxyUrl(options.proxyUrl);
    this.dispatcher = proxyAgent(this.proxyUrl);
    this.createReplaySafe = false;
  }

  async request(path, options = {}) {
    try {
      await assertPublicEfunOrigin(this.baseUrl, this.lookup);
    } catch (error) {
      if (error instanceof AutomationAdapterError) error.requestNotSent = true;
      throw error;
    }
    const url = new URL(`${this.baseUrl}${path}`);
    if (url.origin !== new URL(this.baseUrl).origin) {
      fail("AUTOMATION_ORIGIN_CHANGED", "eFun 请求越过了已配置站点 Origin", {
        retryable: false,
        requestNotSent: true
      });
    }
    const headers = { Accept: "application/json", "X-API-Key": this.apiKey };
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    let response;
    try {
      response = await this.fetchImpl(url, {
        method: options.method || "GET",
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        redirect: "manual",
        signal: AbortSignal.timeout(this.timeoutMs),
        ...(this.dispatcher ? { dispatcher: this.dispatcher } : {})
      });
    } catch (error) {
      const timedOut = error?.name === "TimeoutError" || error?.name === "AbortError";
      fail(timedOut ? "AUTOMATION_TIMEOUT" : "AUTOMATION_UNAVAILABLE",
        timedOut ? "eFun 站点请求超时" : "eFun 站点网络异常", {
          unsafeToReplay: options.create === true
        });
    }
    if (response.status >= 300 && response.status < 400) {
      fail("AUTOMATION_REDIRECT_BLOCKED", "eFun 站点返回了不允许的重定向", {
        retryable: false,
        unsafeToReplay: options.create === true
      });
    }
    let payload;
    try {
      payload = await readJson(response);
    } catch (error) {
      throw options.create === true ? unsafeCreateError(error) : error;
    }
    if (!response.ok || Number(payload?.code) !== 0) {
      const remoteCode = providerCode(payload?.code);
      const definitelyNotCreated = options.create === true
        && response.status >= 400 && response.status < 500;
      const code = remoteCode === "42902" ? "AUTOMATION_REMOTE_BUSY"
        : (remoteCode === "40305" ? "AUTOMATION_REMOTE_MAINTENANCE" : "AUTOMATION_REMOTE_REJECTED");
      fail(code, optionalString(payload?.message, 500) || `eFun 站点返回 HTTP ${response.status}`, {
        statusCode: response.status,
        providerCode: remoteCode,
        definitelyNotCreated,
        unsafeToReplay: options.create === true && !definitelyNotCreated,
        retryable: response.status >= 500 || response.status === 429
      });
    }
    return payload;
  }

  async discoverCapabilities() {
    const payload = await this.request("/third-party/user");
    if (!payload.data || typeof payload.data !== "object" || payload.data.is_active !== true) {
      fail("EFUN_AUTOMATION_CONTRACT_INVALID", "eFun 用户信息响应结构无法识别", { retryable: false });
    }
    return createCapabilities();
  }

  async createTask(input = {}) {
    const clientOrderId = boundedString(input.clientOrderId, "clientOrderId", 120, {
      definitelyNotCreated: true
    });
    const planId = boundedString(input.planId, "planId", 40, { definitelyNotCreated: true });
    if (!PLAN_BY_ID.has(planId)) {
      fail("EFUN_AUTOMATION_PLAN_INVALID", "eFun 套餐无法识别", {
        retryable: false,
        definitelyNotCreated: true
      });
    }
    const country = boundedString(input.checkoutCountry, "checkoutCountry", 20, {
      definitelyNotCreated: true
    }).toUpperCase();
    if (country !== "PH") {
      fail("EFUN_AUTOMATION_REGION_INVALID", "eFun 直充仅支持 PH 地区", {
        retryable: false,
        definitelyNotCreated: true
      });
    }
    const card = validateCard(input.card);
    const body = {
      orderType: "direct",
      cardNumber: card.number,
      expMonth: card.expMonth,
      expYear: card.expYear,
      cvv: card.cvv,
      token: validateSession(input.authSessionJson),
      planType: planId
    };
    const payload = await this.request("/third-party/orders/direct", {
      method: "POST",
      body,
      create: true
    });
    try {
      return Object.freeze({
        idempotentReplay: false,
        requestId: null,
        task: normalizeTask(payload.data, {
          clientOrderId,
          planId,
          cardLast4: card.number.slice(-4)
        })
      });
    } catch (error) {
      throw unsafeCreateError(error);
    }
  }

  async getTask(taskId, context = {}) {
    const queryKey = boundedString(taskId, "cardKey", 128);
    const payload = await this.request("/third-party/orders/status", {
      method: "POST",
      body: { cardKey: queryKey }
    });
    if (Array.isArray(payload.data)) {
      fail("EFUN_AUTOMATION_CONTRACT_INVALID", "eFun 单订单查询返回了批量结果");
    }
    const task = normalizeTask(payload.data, {
      clientOrderId: context.clientOrderId,
      planId: context.planId,
      cardLast4: context.cardLast4
    });
    if (task.id !== queryKey) {
      fail("EFUN_AUTOMATION_CONTRACT_INVALID", "eFun 查询结果与卡密不一致", { retryable: false });
    }
    return Object.freeze({ requestId: null, task });
  }
}
