import dns from "node:dns/promises";
import net from "node:net";
import { AutomationAdapterError } from "./automate-v1.js";

const MAX_RESPONSE_BYTES = 512 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;
const PENDING_STATUSES = new Set([
  "queued",
  "awaiting_card",
  "funding_pending",
  "dispatching",
  "running",
  "requires_action",
  "pending",
  "plus_paid"
]);
const FAILED_STATUSES = new Set(["declined", "failed_precharge"]);
const RENEWAL_RUNNING_STATUSES = new Set(["pending", "warning", "retrying"]);
const PLAN_DEFINITIONS = Object.freeze({
  go: Object.freeze({ id: "go", name: "ChatGPT Go", label: "Go", taskType: "purchase", canonicalOffer: "go" }),
  plus: Object.freeze({ id: "plus", name: "ChatGPT Plus", label: "Plus", taskType: "purchase", canonicalOffer: "plus" }),
  pro_5x: Object.freeze({ id: "pro_5x", name: "ChatGPT Pro 5X", label: "Pro 5X", taskType: "purchase", canonicalOffer: "x5" }),
  pro_20x: Object.freeze({ id: "pro_20x", name: "ChatGPT Pro 20X", label: "Pro 20X", taskType: "purchase", canonicalOffer: "x20" }),
  pro_50x: Object.freeze({ id: "pro_50x", name: "ChatGPT Pro 50X", label: "Pro 50X", taskType: "purchase", canonicalOffer: "x50" })
});
const SUPPORTED_PLAN_IDS = new Set(["plus", "pro_5x", "pro_20x", "pro_50x"]);
// Quote names differ from the plan IDs required by the order API.
const QUOTE_PLAN_NAMES = Object.freeze({ plus: "plus", pro_5x: "prolite", pro_20x: "pro", pro_50x: "promax" });
const PLAN_TIERS = Object.freeze({ free: 0, go: 1, plus: 2, prolite: 3, pro_5x: 3, pro: 4, pro_20x: 4, promax: 5, pro_50x: 5 });

function fail(code, message, options = {}) {
  throw new AutomationAdapterError(code, message, options);
}

function boundedString(value, field, max = 200, options = {}) {
  const result = typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
  if (!result || result.length > max || /[\u0000-\u001f\u007f]/.test(result)) {
    fail("SPACEX_GPT_CONTRACT_INVALID", `SpaceX GPT 字段 ${field} 无效`, {
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

function positiveInteger(value, field, options = {}) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result <= 0) {
    fail("SPACEX_GPT_CONTRACT_INVALID", `SpaceX GPT 字段 ${field} 无效`, {
      retryable: false,
      ...options
    });
  }
  return result;
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

export function normalizeSpaceXGptDirectV1BaseUrl(value) {
  let url;
  try {
    url = new URL(String(value || "").trim());
  } catch {
    fail("AUTOMATION_BASE_URL_INVALID", "SpaceX GPT 站点地址无效", { retryable: false });
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.port) {
    fail("AUTOMATION_BASE_URL_INVALID", "SpaceX GPT 站点必须使用无附加凭据的标准 HTTPS 地址", {
      retryable: false
    });
  }
  const path = url.pathname.replace(/\/+$/, "");
  if (!path.endsWith("/openapi/v1")) {
    fail("AUTOMATION_BASE_URL_INVALID", "SpaceX GPT Open API 地址必须以 /openapi/v1 结尾", {
      retryable: false
    });
  }
  url.pathname = path;
  return url.toString().replace(/\/$/, "");
}

async function assertPublicOrigin(baseUrl, lookup) {
  const url = new URL(normalizeSpaceXGptDirectV1BaseUrl(baseUrl));
  let results;
  try {
    results = await lookup(url.hostname, { all: true, verbatim: true });
  } catch {
    fail("AUTOMATION_DNS_FAILED", "SpaceX GPT 站点域名解析失败");
  }
  if (!Array.isArray(results) || results.length === 0 || results.some((item) => isRestrictedIp(item.address))) {
    fail("AUTOMATION_ORIGIN_RESTRICTED", "SpaceX GPT 站点解析到了受限网络地址", { retryable: false });
  }
}

async function readJson(response) {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    try { await response.body?.cancel(); } catch {}
    fail("AUTOMATION_RESPONSE_TOO_LARGE", "SpaceX GPT 站点响应过大");
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_RESPONSE_BYTES) fail("AUTOMATION_RESPONSE_TOO_LARGE", "SpaceX GPT 站点响应过大");
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    fail("AUTOMATION_RESPONSE_INVALID", "SpaceX GPT 站点响应不是合法 JSON");
  }
}

function providerCode(payload) {
  const value = optionalString(payload?.error_code ?? payload?.code, 120);
  return value && /^[A-Za-z0-9_.:-]+$/.test(value) ? value : null;
}

function normalizeCapabilities(payload) {
  const data = payload?.data;
  if (!data || typeof data !== "object" || Array.isArray(data)
    || !data.plans || typeof data.plans !== "object" || Array.isArray(data.plans)
    || !Array.isArray(data.registry) || !Array.isArray(data.payment_regions)) {
    fail("SPACEX_GPT_CONTRACT_INVALID", "ZovoCard 套餐注册表或付款地区无法识别", { retryable: false });
  }
  const plans = [];
  const seen = new Set();
  for (const entry of data.registry) {
    if (entry?.product !== "gpt" || !SUPPORTED_PLAN_IDS.has(entry.key)
      || entry.purchasable !== true || entry.is_credit === true || entry.requires_active_subscription === true) continue;
    const item = data.plans[entry.acc_plan_key];
    if (item?.enabled !== true) continue;
    if (seen.has(entry.key) || item.key !== entry.acc_plan_key) {
      fail("SPACEX_GPT_CONTRACT_INVALID", "ZovoCard 套餐注册表映射无效", { retryable: false });
    }
    const serviceFeeUsdMinor = Number(entry.service_fee_usd_minor ?? item.serviceFeeUsdMinor);
    if (!Number.isSafeInteger(serviceFeeUsdMinor) || serviceFeeUsdMinor < 0) {
      fail("SPACEX_GPT_CONTRACT_INVALID", "ZovoCard 套餐服务费无效", { retryable: false });
    }
    seen.add(entry.key);
    plans.push(Object.freeze({ ...PLAN_DEFINITIONS[entry.key], serviceFeeUsdMinor }));
  }
  const regionCodes = new Set();
  const regions = data.payment_regions.filter((entry) => entry?.enabled !== false).map((entry) => {
    const code = boundedString(entry.code ?? entry.country ?? entry.payment_country, "payment_regions.country", 2).toUpperCase();
    const currency = boundedString(entry.currency ?? entry.payment_currency, "payment_regions.currency", 3).toUpperCase();
    if (!/^[A-Z]{2}$/.test(code) || !/^[A-Z]{3}$/.test(currency) || regionCodes.has(code)) {
      fail("SPACEX_GPT_CONTRACT_INVALID", "ZovoCard 付款地区配置无效", { retryable: false });
    }
    regionCodes.add(code);
    return Object.freeze({ code, currency, label: optionalString(entry.label ?? entry.name, 100) || code });
  });
  if (regions.length === 0) {
    fail("SPACEX_GPT_CONTRACT_INVALID", "ZovoCard 没有可用付款地区", { retryable: false });
  }
  const configuredDefault = optionalString(data.default_region ?? data.default_payment_country, 2)?.toUpperCase();
  return Object.freeze({
    plans: Object.freeze(plans),
    regions: Object.freeze(regions),
    defaultRegion: regions.find((entry) => entry.code === configuredDefault)?.code
      || regions.find((entry) => entry.code === "PH")?.code || regions[0].code,
    billingAddressSource: "provider_managed",
    pricingEvidence: "provider_quote",
    pricingVersion: positiveInteger(data.version, "version")
  });
}

function sessionCredential(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("AUTOMATION_SESSION_INVALID", "提交给 SpaceX GPT 的 Session 结构无效", {
      retryable: false,
      definitelyNotCreated: true
    });
  }
  const session = JSON.stringify(value);
  if (session.length > 64 * 1024) {
    fail("AUTOMATION_SESSION_INVALID", "提交给 SpaceX GPT 的 Session 过大", {
      retryable: false,
      definitelyNotCreated: true
    });
  }
  const sessionCookieName = /^(?:__Secure-)?next-auth\.session-token(?:\.\d+)?$/;
  const hasSessionCookie = [value.sessionToken, value.session_token]
    .some((item) => typeof item === "string" && item.trim())
    || Object.entries(value).some(([name, item]) => sessionCookieName.test(name)
      && typeof item === "string" && item.trim())
    || (value.cookies && typeof value.cookies === "object" && !Array.isArray(value.cookies)
      && Object.entries(value.cookies).some(([name, item]) => sessionCookieName.test(name)
        && typeof item === "string" && item.trim()))
    || (Array.isArray(value.cookies) && value.cookies.some((item) => sessionCookieName.test(String(item?.name || ""))
      && typeof item?.value === "string" && item.value.trim()))
    || [value.cookie, typeof value.cookies === "string" ? value.cookies : ""]
      .some((item) => typeof item === "string"
        && /(?:^|;\s*)(?:__Secure-)?next-auth\.session-token(?:\.\d+)?=\S+/.test(item));
  if (hasSessionCookie) return Object.freeze({ mode: "session", session });
  const accessToken = [value.accessToken, value.access_token]
    .find((item) => typeof item === "string" && item.trim());
  if (accessToken) return Object.freeze({ mode: "access_token", accessToken: accessToken.trim() });
  return Object.freeze({ mode: "session", session });
}

function last4(value, fallback = null) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length >= 4) return digits.slice(-4);
  return /^\d{4}$/.test(String(fallback || "")) ? String(fallback) : null;
}

function amountMajor(order, context = {}) {
  const minor = Number(order.final_amount_minor ?? order.quoted_amount_minor);
  if (!Number.isSafeInteger(minor) || minor < 0) return null;
  const currency = String(order.currency ?? order.payment_currency ?? context.checkoutCurrency ?? "PHP").toUpperCase();
  const exponent = Number(order.minor_unit_exponent ?? context.minorUnitExponent
    ?? (["PHP", "USD", "EGP"].includes(currency) ? 2 : NaN));
  if (!Number.isInteger(exponent) || exponent < 0 || exponent > 6) return null;
  return (minor / (10 ** exponent)).toFixed(exponent);
}

function purchaseWaitSeconds(data, fallback = null) {
  const value = data?.can_purchase_at;
  if (value === null || value === undefined || value === "") return fallback;
  const timestamp = Date.parse(String(value));
  if (!Number.isFinite(timestamp)) {
    fail("SPACEX_GPT_CONTRACT_INVALID", "SpaceX GPT 可购买时间无法识别", {
      retryable: false,
      definitelyNotCreated: true
    });
  }
  const seconds = Math.ceil((timestamp - Date.now()) / 1000);
  return seconds > 0 ? Math.max(30, seconds) : fallback;
}

function rejectActiveSubscription(data) {
  const plan = optionalString(data?.currentPlan ?? data?.current_plan, 40)?.toLowerCase();
  // A live Free result overrides stale subscription metadata after cancellation.
  if (plan === "free") return;
  const futureTimes = [data?.can_purchase_at, data?.subscription_active_until]
    .filter((value) => typeof value === "string"
      && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value))
    .map((value) => Date.parse(value))
    .filter((value) => Number.isFinite(value) && value > Date.now());
  const hasSubscription = data?.subscription_has_active === true
    || ["plus", "go", "pro", "prolite", "promax", "pro_5x", "pro_20x", "pro_50x", "team", "business"].includes(plan);
  if (!hasSubscription && futureTimes.length === 0) return;
  const availableAt = futureTimes.length ? Math.max(...futureTimes) : null;
  const timeText = availableAt
    ? new Date(availableAt + 8 * 60 * 60 * 1000).toISOString().slice(0, 19).replace("T", " ")
    : null;
  const message = timeText
    ? `当前账号仍有订阅，本次充值失败。预计可于 ${timeText}（北京时间）后充值，请确认账号已恢复 Free 后重新提交。`
    : "当前账号仍有订阅，本次充值失败。上游未返回有效的可充值时间，请在 ChatGPT 中查看订阅到期时间，待账号恢复 Free 后重新提交。";
  fail("AUTOMATION_SUBSCRIPTION_ACTIVE", message, {
    retryable: false,
    definitelyNotCreated: true,
    requestNotSent: true
  });
}

function waitForPurchasableAccount(data, fallback = 120) {
  rejectActiveSubscription(data);
  fail("SPACEX_GPT_ACCOUNT_WAIT", "欠费订阅已取消，等待账号恢复可购买状态", {
    requestNotSent: true,
    retryAfterSeconds: purchaseWaitSeconds(data, fallback)
  });
}

function quoteContext(quote, { planId, currency, country, kind, now, expiresAt, serviceFeeUsdMinor }) {
  const quoteCurrency = String(quote?.currency || "").toUpperCase();
  const amountMinor = Number(quote?.amount_minor ?? quote?.amountMinor);
  const exponentValue = quote?.minor_unit_exponent ?? quote?.minorUnitExponent;
  const minorUnitExponent = exponentValue === undefined && quoteCurrency === "PHP" ? 2 : Number(exponentValue);
  const fundingValue = quote?.funding_usd_minor ?? quote?.fundingUsdMinor;
  const fundingUsdMinor = fundingValue === undefined || fundingValue === null ? null : Number(fundingValue);
  const quoteCountry = optionalString(quote?.country ?? quote?.payment_country, 2)?.toUpperCase();
  const problem = !quote ? "缺少目标套餐报价"
    : ![planId, QUOTE_PLAN_NAMES[planId]].includes(quote.plan) ? "报价套餐不匹配"
      : !/^[A-Z]{3}$/.test(quoteCurrency) || (kind === "purchase" && quoteCurrency !== currency) ? "报价币种不匹配"
        : kind === "purchase" && quoteCountry && quoteCountry !== country ? "报价地区不匹配"
          : !Number.isSafeInteger(amountMinor) || amountMinor <= 0 ? "报价金额无效"
            : !Number.isInteger(minorUnitExponent) || minorUnitExponent < 0 || minorUnitExponent > 6 ? "最小货币单位无效"
              : fundingUsdMinor !== null && (!Number.isSafeInteger(fundingUsdMinor) || fundingUsdMinor <= 0) ? "注资估算无效" : null;
  if (problem) {
    fail("SPACEX_GPT_QUOTE_INVALID", `ZovoCard 预检报价无法识别（${planId}：${problem}）`, {
      retryable: false, definitelyNotCreated: true
    });
  }
  const deadline = now + (kind === "upgrade" ? 5 : 10) * 60_000;
  const expiry = expiresAt == null ? deadline : Date.parse(String(expiresAt));
  if (!Number.isFinite(expiry) || expiry <= now) {
    fail("SPACEX_GPT_PREFLIGHT_EXPIRED", "ZovoCard 报价凭证已过期或有效期无效，请重新预检", {
      retryable: false, definitelyNotCreated: true
    });
  }
  return Object.freeze({
    kind, amountMinor, currency: quoteCurrency, minorUnitExponent, fundingUsdMinor,
    expiresAt: new Date(Math.min(expiry, deadline)).toISOString(), serviceFeeUsdMinor
  });
}

function normalizeTask(raw, context = {}) {
  const order = raw?.order && typeof raw.order === "object" && !Array.isArray(raw.order) ? raw.order : raw;
  if (!order || typeof order !== "object" || Array.isArray(order)) {
    fail("SPACEX_GPT_CONTRACT_INVALID", "SpaceX GPT 订单结构无法识别");
  }
  const id = boundedString(order.id, "order.id", 120);
  const providerStatus = boundedString(order.status, "order.status", 40).toLowerCase();
  const planId = boundedString(order.plan, "order.plan", 40);
  if (order.product !== undefined && order.product !== "gpt") {
    fail("SPACEX_GPT_CONTRACT_INVALID", "ZovoCard 订单产品与 GPT 不一致", { retryable: false });
  }
  if (!PLAN_DEFINITIONS[planId] || (context.planId && context.planId !== planId)) {
    fail("SPACEX_GPT_CONTRACT_INVALID", "SpaceX GPT 订单套餐与本地映射不一致", { retryable: false });
  }
  const clientOrderId = boundedString(order.client_request_id, "order.client_request_id", 80);
  if (context.clientOrderId && clientOrderId !== context.clientOrderId) {
    fail("SPACEX_GPT_CONTRACT_INVALID", "SpaceX GPT 订单号与本地订单不一致", { retryable: false });
  }
  const renewalStatus = optionalString(order.renewal_status ?? order.renewal?.status, 40)?.toLowerCase() || null;
  let status;
  let errorCode = null;
  if (PENDING_STATUSES.has(providerStatus)) status = providerStatus === "queued" ? "queued" : "running";
  else if (providerStatus === "review" || providerStatus.endsWith("_review")) status = "manual_review";
  else if (FAILED_STATUSES.has(providerStatus)) status = "failed";
  else if (providerStatus === "cancelled" || providerStatus === "canceled") status = "cancelled";
  else if (providerStatus === "completed" && renewalStatus === "success") status = "succeeded";
  else if (providerStatus === "completed" && RENEWAL_RUNNING_STATUSES.has(renewalStatus)) status = "running";
  else if (providerStatus === "completed") {
    status = "manual_review";
    errorCode = "SPACEX_GPT_RENEWAL_STATUS_UNKNOWN";
  } else {
    fail("SPACEX_GPT_CONTRACT_INVALID", "SpaceX GPT 订单状态无法识别");
  }
  if (status === "manual_review" && !errorCode) errorCode = "SPACEX_GPT_REMOTE_REVIEW";
  if (["failed", "cancelled"].includes(status)) errorCode = `SPACEX_GPT_${providerStatus.toUpperCase()}`;
  const currency = optionalString(order.currency ?? order.payment_currency ?? context.checkoutCurrency, 20)?.toUpperCase() || "PHP";
  const total = amountMajor(order, context);
  if (providerStatus === "completed" && total === null) {
    fail("SPACEX_GPT_CONTRACT_INVALID", "SpaceX GPT 完成订单缺少支付金额");
  }
  const renewalPending = providerStatus === "completed" && RENEWAL_RUNNING_STATUSES.has(renewalStatus);
  const message = optionalString(order.message, 500)
    || (status === "succeeded" ? "SpaceX GPT 已完成开通并取消自动续费" : "SpaceX GPT 订单处理中");
  return Object.freeze({
    id,
    clientOrderId,
    status,
    providerStatus,
    terminal: ["succeeded", "failed", "cancelled"].includes(status),
    planId,
    planName: PLAN_DEFINITIONS[planId].name,
    checkoutCountry: optionalString(order.payment_country, 20)?.toUpperCase() || context.checkoutCountry || "PH",
    checkoutCurrency: currency,
    currentPhase: status === "succeeded"
      ? "finished"
      : (renewalPending ? "renewal_cancellation" : (optionalString(order.stage, 100) || providerStatus)),
    message,
    card: Object.freeze({
      brand: null,
      last4: last4(order.card_last_four ?? order.card_number, context.cardLast4)
    }),
    pricing: Object.freeze({
      currency,
      displayTotal: total,
      displayUsdTotal: null,
      confirmed: providerStatus === "completed"
    }),
    subscriptionStatus: providerStatus === "completed" ? "active" : null,
    renewalStatus: Object.freeze({
      status: renewalStatus,
      label: optionalString(order.renewal_message, 200),
      verified: providerStatus === "completed" && renewalStatus !== null,
      willRenew: providerStatus === "completed" ? renewalStatus !== "success" : null
    }),
    billing: Object.freeze({
      pointsCost: null,
      pointsStatus: optionalString(order.service_fee_status, 40)
    }),
    error: errorCode ? Object.freeze({ code: errorCode, message }) : null,
    createdAt: optionalString(order.created_at, 100),
    updatedAt: optionalString(order.updated_at, 100),
    completedAt: optionalString(order.completed_at, 100)
  });
}

export class SpaceXGptDirectV1Adapter {
  constructor(options = {}) {
    this.baseUrl = normalizeSpaceXGptDirectV1BaseUrl(options.baseUrl);
    this.apiKey = boundedString(options.apiKey, "apiKey", 500);
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    this.lookup = options.lookup || dns.lookup;
    this.timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : DEFAULT_TIMEOUT_MS;
    this.now = options.now || Date.now;
    // A fresh preflight changes a single-use payment request. Recover by order lookup,
    // never by preparing another payment after an ambiguous submission.
    this.createReplaySafe = false;
    this.preparedAccounts = new WeakMap();
    this.consumedPreflightTokens = new Set();
  }

  async request(path, options = {}) {
    try {
      await assertPublicOrigin(this.baseUrl, this.lookup);
    } catch (error) {
      if (error instanceof AutomationAdapterError) error.requestNotSent = true;
      throw error;
    }
    const url = new URL(`${this.baseUrl}${path}`);
    if (url.origin !== new URL(this.baseUrl).origin) {
      fail("AUTOMATION_ORIGIN_CHANGED", "SpaceX GPT 请求越过了已配置站点 Origin", {
        retryable: false,
        requestNotSent: true
      });
    }
    const headers = { Accept: "application/json", "X-API-Key": this.apiKey };
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    if (options.idempotencyKey) headers["Idempotency-Key"] = options.idempotencyKey;
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
        timedOut ? "SpaceX GPT 请求超时" : "SpaceX GPT 网络异常", {
          definitelyNotCreated: options.preCreate === true,
          requestNotSent: options.preCreate === true
        });
    }
    if (response.status >= 300 && response.status < 400) {
      fail("AUTOMATION_REDIRECT_BLOCKED", "SpaceX GPT 返回了不允许的重定向", {
        retryable: false,
        definitelyNotCreated: options.preCreate === true
      });
    }
    const payload = await readJson(response);
    if (!response.ok || Number(payload?.code) !== 0) {
      const remoteCode = providerCode(payload);
      const remoteMessage = optionalString(payload?.msg ?? payload?.message, 500);
      const knownPreCreateFailure = [
        "GPT_DIRECT_ACCESS_DENIED",
        "RECHARGE_REQUIRED",
        "GPT_SESSION_INVALID",
        "SESSION_REQUIRED",
        "GPT_PLAN_ALREADY_ACTIVE",
        "INSUFFICIENT_BALANCE",
        "INVALID_REQUEST",
        "DIRECT_PRODUCT_DISABLED",
        "PRECHECK_REJECTED",
        "GPT_PRICE_UNCONFIRMED"
      ].includes(remoteCode);
      fail("AUTOMATION_REMOTE_REJECTED", remoteMessage
        || `SpaceX GPT 返回 HTTP ${response.status}`, {
        statusCode: response.status,
        providerCode: remoteCode,
        definitelyNotCreated: options.preCreate === true || knownPreCreateFailure,
        requestNotSent: options.preCreate === true,
        // GPT_DIRECT_ORDER_REJECTED and generic 400s do not prove no write.
        // The protocol publishes no stable exhausted-card error code.
        cardUnavailable: false,
        retryable: response.status >= 500 || [429, 503].includes(response.status)
      });
    }
    return payload;
  }

  async discoverCapabilities() {
    return normalizeCapabilities(await this.request("/gpt-direct/plans?product=gpt", { preCreate: true }));
  }

  async prepareAccount(input = {}) {
    const planId = boundedString(input.planId, "planId", 40, { definitelyNotCreated: true });
    if (!SUPPORTED_PLAN_IDS.has(planId)) {
      fail("SPACEX_GPT_PLAN_UNSUPPORTED", "SpaceX GPT 套餐暂不支持安全库存对账", {
        retryable: false,
        definitelyNotCreated: true
      });
    }
    const country = boundedString(input.checkoutCountry, "checkoutCountry", 20, {
      definitelyNotCreated: true
    }).toUpperCase();
    const capabilities = await this.discoverCapabilities();
    const plan = capabilities.plans.find((entry) => entry.id === planId);
    const region = capabilities.regions.find((entry) => entry.code === country);
    if (!plan) {
      fail("SPACEX_GPT_PLAN_UNAVAILABLE", "ZovoCard 目标套餐尚未上架、不可购买或已停用", {
        retryable: false, definitelyNotCreated: true
      });
    }
    if (!region || (input.checkoutCurrency && String(input.checkoutCurrency).toUpperCase() !== region.currency)) {
      fail("SPACEX_GPT_REGION_INVALID", "ZovoCard 付款地区或币种与实时配置不一致", {
        retryable: false, definitelyNotCreated: true
      });
    }
    const credential = sessionCredential(input.authSessionJson);
    const preflight = () => this.request("/gpt-direct/preflight", {
      method: "POST",
      preCreate: true,
      body: { product: "gpt", plan: planId, credential, payment_country: country, payment_currency: region.currency }
    });
    let preflightData = (await preflight())?.data;
    let currentPlan = optionalString(preflightData?.currentPlan ?? preflightData?.current_plan, 40)?.toLowerCase();
    if (currentPlan !== "free" && preflightData?.subscription_is_delinquent === true) {
      if (preflightData.subscription_will_renew === true) {
        if (credential.mode !== "session") {
          rejectActiveSubscription(preflightData);
          fail("SPACEX_GPT_SESSION_REQUIRED", "欠费订阅只能使用完整 Session 自动取消", {
            retryable: false,
            definitelyNotCreated: true
          });
        }
        let renewal;
        try {
          renewal = await this.request("/gpt-direct/cancel-renewal", {
            method: "POST",
            preCreate: true,
            body: { session: credential.session }
          });
        } catch (error) {
          rejectActiveSubscription(preflightData);
          if (error instanceof AutomationAdapterError && error.retryable) waitForPurchasableAccount(preflightData);
          throw error;
        }
        const renewalStatus = optionalString(renewal?.data?.renewal_status, 40)?.toLowerCase();
        if (renewalStatus === "pending") waitForPurchasableAccount(preflightData);
        if (renewalStatus !== "success") {
          rejectActiveSubscription(preflightData);
          fail("SPACEX_GPT_RENEWAL_STATUS_UNKNOWN", "SpaceX GPT 欠费订阅取消状态无法识别", {
            requestNotSent: true,
            retryAfterSeconds: 120
          });
        }
        try {
          preflightData = (await preflight())?.data;
        } catch (error) {
          rejectActiveSubscription(preflightData);
          if (error instanceof AutomationAdapterError && error.retryable) waitForPurchasableAccount(preflightData);
          throw error;
        }
      }
      currentPlan = optionalString(preflightData?.currentPlan ?? preflightData?.current_plan, 40)?.toLowerCase();
      if (currentPlan !== "free" && (preflightData?.subscription_is_delinquent === true
        || preflightData?.subscription_has_active === true
        || preflightData?.subscription_will_renew === true)) {
        waitForPurchasableAccount(preflightData);
      }
    }
    currentPlan = optionalString(preflightData?.currentPlan ?? preflightData?.current_plan, 40)?.toLowerCase();
    const hasSubscription = currentPlan !== "free" && (preflightData?.subscription_has_active === true
      || (PLAN_TIERS[currentPlan] || 0) > 0 || ["team", "business"].includes(currentPlan));
    if (hasSubscription) {
      const currentTier = PLAN_TIERS[currentPlan];
      // The upgrade endpoint only supports 5x/20x/50x. Same/lower and unknown
      // subscription tiers cannot become a new-subscription purchase.
      if (!["pro_5x", "pro_20x", "pro_50x"].includes(planId)
        || currentTier === undefined || currentTier >= PLAN_TIERS[planId]) rejectActiveSubscription(preflightData);
    } else rejectActiveSubscription(preflightData);
    const sourceToken = boundedString(preflightData?.preflight_token, "preflight_token", 16 * 1024, {
      definitelyNotCreated: true
    });
    let token = sourceToken;
    let quote;
    if (hasSubscription) {
      const upgraded = await this.request("/gpt-direct/upgrade-quotes", {
        method: "POST", preCreate: true, body: { preflight_token: sourceToken }
      });
      const selected = upgraded?.data?.quotes?.find((entry) => entry?.plan === planId);
      if (!selected || selected.available !== true) {
        fail("SPACEX_GPT_UPGRADE_UNAVAILABLE", "ZovoCard 未提供目标套餐的可支付升级报价", {
          retryable: false, definitelyNotCreated: true,
          providerCode: providerCode(selected)
        });
      }
      token = boundedString(selected.preflight_token, "upgrade.preflight_token", 16 * 1024, { definitelyNotCreated: true });
      if (token === sourceToken) {
        fail("SPACEX_GPT_CONTRACT_INVALID", "ZovoCard 升级报价未返回独立凭证", { retryable: false, definitelyNotCreated: true });
      }
      quote = quoteContext(selected, { planId, kind: "upgrade", country, now: this.now(),
        expiresAt: selected.expires_at, serviceFeeUsdMinor: plan.serviceFeeUsdMinor });
    } else {
      rejectActiveSubscription(preflightData);
      if (optionalString(preflightData?.quote_error, 500)) {
        fail("SPACEX_GPT_QUOTE_UNAVAILABLE", "ZovoCard 当前报价不可用", {
          retryable: false, definitelyNotCreated: true
        });
      }
      const returnedCountry = optionalString(preflightData?.payment_country, 2)?.toUpperCase();
      const returnedCurrency = optionalString(preflightData?.payment_currency, 3)?.toUpperCase();
      if ((returnedCountry && returnedCountry !== country) || (returnedCurrency && returnedCurrency !== region.currency)) {
        fail("SPACEX_GPT_QUOTE_INVALID", "ZovoCard 预检付款地区或币种不匹配", { retryable: false, definitelyNotCreated: true });
      }
      quote = quoteContext(preflightData?.quotes?.[planId], { planId, currency: region.currency,
        country, kind: "purchase", now: this.now(), expiresAt: preflightData?.preflight_expires_at,
        serviceFeeUsdMinor: plan.serviceFeeUsdMinor });
    }
    const email = optionalString(preflightData?.email, 320)?.toLowerCase();
    const prepared = Object.freeze({
      credential, preflightData: Object.freeze({ ...preflightData, preflight_token: token }),
      planId, checkoutCountry: country, checkoutCurrency: quote.currency, quote,
      // Only the upstream-authenticated email identifies a reusable account.
      verifiedAccountId: email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? `email:${email}` : null
    });
    this.preparedAccounts.set(prepared, {
      token, credential, pricingVersion: preflightData.pricing_version ?? preflightData.version ?? capabilities.pricingVersion,
      consumed: false
    });
    return prepared;
  }

  async createTask(input = {}) {
    const clientOrderId = boundedString(input.clientOrderId, "clientOrderId", 80, {
      definitelyNotCreated: true
    });
    if (!/^[A-Za-z0-9._:-]+$/.test(clientOrderId)) {
      fail("SPACEX_GPT_CONTRACT_INVALID", "ZovoCard 订单编号不符合幂等键格式", { retryable: false, definitelyNotCreated: true });
    }
    const planId = boundedString(input.planId, "planId", 40, { definitelyNotCreated: true });
    if (!SUPPORTED_PLAN_IDS.has(planId)) {
      fail("SPACEX_GPT_PLAN_UNSUPPORTED", "ZovoCard 套餐不在支持的会员开通范围内", {
        retryable: false, definitelyNotCreated: true
      });
    }
    const country = boundedString(input.checkoutCountry, "checkoutCountry", 20, {
      definitelyNotCreated: true
    }).toUpperCase();
    if (input.cardProviderKey !== "spacexcard") {
      fail("SPACEX_GPT_CARD_PLATFORM_INVALID", "ZovoCard 直充只能使用 SpaceX Card 卡片", {
        retryable: false, definitelyNotCreated: true
      });
    }
    const cardId = positiveInteger(input.providerCardId, "card_id", { definitelyNotCreated: true });
    const prepared = input.preparedAccount || await this.prepareAccount({
      planId, authSessionJson: input.authSessionJson, checkoutCountry: country, checkoutCurrency: input.checkoutCurrency
    });
    const ticket = this.preparedAccounts.get(prepared);
    if (!ticket || prepared.planId !== planId || prepared.checkoutCountry !== country) {
      fail("SPACEX_GPT_PREFLIGHT_MISMATCH", "ZovoCard 预检凭证与当前订单不匹配", {
        retryable: false, definitelyNotCreated: true
      });
    }
    if (ticket.consumed || this.consumedPreflightTokens.has(ticket.token)) {
      fail("SPACEX_GPT_PREFLIGHT_CONSUMED", "ZovoCard 预检凭证已提交，请查询原订单", {
        retryable: false, unsafeToReplay: true
      });
    }
    if (Date.parse(prepared.quote.expiresAt) <= this.now()) {
      fail("SPACEX_GPT_PREFLIGHT_EXPIRED", "ZovoCard 预检凭证已过期，请重新预检", {
        retryable: false, definitelyNotCreated: true
      });
    }
    const body = {
      product: "gpt", card_id: cardId, plan: planId, credential: ticket.credential,
      preflight_token: ticket.token, payment_country: country, payment_currency: prepared.checkoutCurrency,
      payment_mode: "direct", client_request_id: clientOrderId, no_auto_card_switch: true
    };
    const pricingVersion = Number(ticket.pricingVersion);
    if (Number.isSafeInteger(pricingVersion) && pricingVersion > 0) body.pricing_version = pricingVersion;
    ticket.consumed = true;
    this.consumedPreflightTokens.add(ticket.token);
    let created;
    try {
      created = await this.request("/gpt-direct/orders", { method: "POST", body, idempotencyKey: clientOrderId });
    } catch (error) {
      // A local failure before transport cannot have consumed the upstream ticket.
      if (error.requestNotSent === true) {
        ticket.consumed = false;
        this.consumedPreflightTokens.delete(ticket.token);
      }
      throw error;
    }
    return Object.freeze({
      idempotentReplay: false, requestId: optionalString(input.requestId, 200),
      task: normalizeTask(created.data, {
        clientOrderId, planId, checkoutCountry: country, checkoutCurrency: prepared.checkoutCurrency,
        minorUnitExponent: prepared.quote.minorUnitExponent,
        cardLast4: input.card?.number ? last4(input.card.number) : null
      })
    });
  }

  async getCardRules() {
    return (await this.request("/gpt-direct/card-rules?product=gpt", { preCreate: true })).data;
  }

  async getCardUsage(cardId) {
    const id = positiveInteger(cardId, "card_id", { definitelyNotCreated: true });
    return (await this.request(`/gpt-direct/cards/${id}/usage?product=gpt`, { preCreate: true })).data;
  }

  async findTaskByClientOrderId(clientOrderId, context = {}) {
    const id = boundedString(clientOrderId, "clientOrderId", 80);
    for (let page = 1; page <= 100; page += 1) {
      const data = (await this.request(`/gpt-direct/orders?page=${page}&page_size=100`)).data;
      if (!Array.isArray(data?.list) || !Number.isSafeInteger(Number(data?.total)) || Number(data.total) < 0) {
        fail("SPACEX_GPT_CONTRACT_INVALID", "ZovoCard 订单列表无法识别", { retryable: false });
      }
      const matches = data.list.filter((order) => order?.client_request_id === id);
      if (matches.length > 1) fail("SPACEX_GPT_CONTRACT_INVALID", "ZovoCard 订单编号不唯一", { retryable: false });
      if (matches.length === 1) {
        return this.getTask(matches[0].id, { ...context, clientOrderId: id });
      }
      if (page * 100 >= Number(data.total)) return null;
      if (data.list.length === 0) break;
    }
    fail("SPACEX_GPT_LOOKUP_INCOMPLETE", "ZovoCard 订单查询未能覆盖全部记录，需要人工核对", { retryable: false });
  }

  async getTask(taskId, context = {}) {
    const id = boundedString(taskId, "taskId", 120);
    let payload = await this.request(`/gpt-direct/orders/${encodeURIComponent(id)}`);
    let order = payload?.data?.order || payload?.data;
    const renewalStatus = optionalString(order?.renewal_status ?? order?.renewal?.status, 40)?.toLowerCase();
    if (String(order?.status || "").toLowerCase() === "completed"
      && ["pending", "warning"].includes(renewalStatus)) {
      const renewal = await this.request(`/gpt-direct/orders/${encodeURIComponent(id)}/cancel-renewal`, {
        method: "POST",
        body: {}
      });
      const renewalData = renewal?.data?.order || renewal?.data;
      if (renewalData && typeof renewalData === "object" && !Array.isArray(renewalData)) {
        order = { ...order, ...renewalData };
        payload = { ...payload, data: { ...(payload.data || {}), order } };
      }
    }
    const task = normalizeTask(payload.data, {
      clientOrderId: context.clientOrderId,
      planId: context.planId,
      checkoutCountry: context.checkoutCountry,
      checkoutCurrency: context.checkoutCurrency,
      minorUnitExponent: context.minorUnitExponent,
      cardLast4: context.cardLast4
    });
    if (task.id !== id) {
      fail("SPACEX_GPT_CONTRACT_INVALID", "SpaceX GPT 查询结果与任务号不一致", { retryable: false });
    }
    return Object.freeze({ requestId: null, task });
  }
}
