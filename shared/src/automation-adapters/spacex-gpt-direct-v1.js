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
  pro_20x: Object.freeze({ id: "pro_20x", name: "ChatGPT Pro 20X", label: "Pro 20X", taskType: "purchase", canonicalOffer: "x20" })
});
const SUPPORTED_PLAN_IDS = new Set(["plus", "pro_5x", "pro_20x"]);

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
    || !data.plans || typeof data.plans !== "object" || Array.isArray(data.plans)) {
    fail("SPACEX_GPT_CONTRACT_INVALID", "SpaceX GPT 套餐配置无法识别", { retryable: false });
  }
  const plans = [];
  const currencies = new Set();
  for (const [id, item] of Object.entries(data.plans)) {
    if (item?.enabled !== true) continue;
    const definition = PLAN_DEFINITIONS[id];
    if (!definition) continue;
    if (item.key !== id) {
      fail("SPACEX_GPT_CONTRACT_INVALID", "SpaceX GPT 返回了未知套餐", { retryable: false });
    }
    if (!SUPPORTED_PLAN_IDS.has(id)) continue;
    const currency = boundedString(item.currency, `plans.${id}.currency`, 20).toUpperCase();
    currencies.add(currency);
    plans.push(Object.freeze({ ...definition }));
  }
  if (plans.length === 0 || currencies.size !== 1) {
    fail("SPACEX_GPT_CONTRACT_INVALID", "SpaceX GPT 没有可用的统一币种套餐", { retryable: false });
  }
  return Object.freeze({
    plans: Object.freeze(plans),
    regions: Object.freeze([
      Object.freeze({ code: "PH", currency: [...currencies][0], label: "Philippines" })
    ]),
    defaultRegion: "PH",
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

function amountMajor(order) {
  const minor = Number(order.final_amount_minor ?? order.quoted_amount_minor);
  if (!Number.isSafeInteger(minor) || minor < 0) return null;
  const exponent = Number(order.minor_unit_exponent ?? 2);
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

function waitForPurchasableAccount(data, fallback = 120) {
  fail("SPACEX_GPT_ACCOUNT_WAIT", "欠费订阅已取消，等待账号恢复可购买状态", {
    requestNotSent: true,
    retryAfterSeconds: purchaseWaitSeconds(data, fallback)
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
  else if (providerStatus === "review") status = "manual_review";
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
  if (providerStatus === "review") errorCode = "SPACEX_GPT_REMOTE_REVIEW";
  if (["failed", "cancelled"].includes(status)) errorCode = `SPACEX_GPT_${providerStatus.toUpperCase()}`;
  const currency = optionalString(order.currency ?? order.payment_currency, 20)?.toUpperCase() || "PHP";
  const total = amountMajor(order);
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
    this.createReplaySafe = true;
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
      const knownPreCreateFailure = [
        "GPT_DIRECT_ACCESS_DENIED",
        "RECHARGE_REQUIRED",
        "GPT_SESSION_INVALID",
        "SESSION_REQUIRED",
        "GPT_PLAN_ALREADY_ACTIVE",
        "INSUFFICIENT_BALANCE"
      ].includes(remoteCode);
      fail("AUTOMATION_REMOTE_REJECTED", optionalString(payload?.msg ?? payload?.message, 500)
        || `SpaceX GPT 返回 HTTP ${response.status}`, {
        statusCode: response.status,
        providerCode: remoteCode,
        definitelyNotCreated: options.preCreate === true || knownPreCreateFailure,
        requestNotSent: options.preCreate === true,
        retryable: response.status >= 500 || [429, 503].includes(response.status)
      });
    }
    return payload;
  }

  async discoverCapabilities() {
    return normalizeCapabilities(await this.request("/gpt-direct/plans"));
  }

  async prepareAccount(input = {}) {
    const country = boundedString(input.checkoutCountry, "checkoutCountry", 20, {
      definitelyNotCreated: true
    }).toUpperCase();
    if (country !== "PH") {
      fail("SPACEX_GPT_REGION_INVALID", "SpaceX GPT 直充当前仅支持 PH 地区", {
        retryable: false,
        definitelyNotCreated: true
      });
    }
    const credential = sessionCredential(input.authSessionJson);
    const preflight = () => this.request("/gpt-direct/preflight", {
      method: "POST",
      preCreate: true,
      body: { credential, payment_country: country, payment_currency: "PHP" }
    });
    let preflightData = (await preflight())?.data;
    if (preflightData?.subscription_is_delinquent === true) {
      if (preflightData.subscription_will_renew === true) {
        if (credential.mode !== "session") {
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
          if (error instanceof AutomationAdapterError && error.retryable) waitForPurchasableAccount(preflightData);
          throw error;
        }
        const renewalStatus = optionalString(renewal?.data?.renewal_status, 40)?.toLowerCase();
        if (renewalStatus === "pending") waitForPurchasableAccount(preflightData);
        if (renewalStatus !== "success") {
          fail("SPACEX_GPT_RENEWAL_STATUS_UNKNOWN", "SpaceX GPT 欠费订阅取消状态无法识别", {
            requestNotSent: true,
            retryAfterSeconds: 120
          });
        }
        try {
          preflightData = (await preflight())?.data;
        } catch (error) {
          if (error instanceof AutomationAdapterError && error.retryable) waitForPurchasableAccount(preflightData);
          throw error;
        }
      }
      if (preflightData?.subscription_is_delinquent === true
        || preflightData?.subscription_has_active === true
        || preflightData?.subscription_will_renew === true) {
        waitForPurchasableAccount(preflightData);
      }
    }
    const currentPlan = optionalString(preflightData?.currentPlan ?? preflightData?.current_plan, 40)?.toLowerCase();
    const purchaseWait = currentPlan === "free" ? null : purchaseWaitSeconds(preflightData);
    if (purchaseWait !== null) {
      fail("SPACEX_GPT_ACCOUNT_WAIT", "等待账号恢复可购买状态", {
        requestNotSent: true,
        retryAfterSeconds: purchaseWait
      });
    }
    return Object.freeze({ credential, preflightData });
  }

  async createTask(input = {}) {
    const clientOrderId = boundedString(input.clientOrderId, "clientOrderId", 80, {
      definitelyNotCreated: true
    });
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
    if (country !== "PH") {
      fail("SPACEX_GPT_REGION_INVALID", "SpaceX GPT 直充当前仅支持 PH 地区", {
        retryable: false,
        definitelyNotCreated: true
      });
    }
    if (input.cardProviderKey !== "spacexcard") {
      fail("SPACEX_GPT_CARD_PLATFORM_INVALID", "SpaceX GPT 直充只能使用 SpaceX Card 卡片", {
        retryable: false,
        definitelyNotCreated: true
      });
    }
    const cardId = positiveInteger(input.providerCardId, "card_id", { definitelyNotCreated: true });
    const { credential, preflightData } = await this.prepareAccount({
      authSessionJson: input.authSessionJson,
      checkoutCountry: country
    });
    const preflightToken = boundedString(preflightData?.preflight_token, "preflight_token", 16 * 1024, {
      definitelyNotCreated: true
    });
    if (optionalString(preflightData?.quote_error, 500)) {
      fail("SPACEX_GPT_QUOTE_UNAVAILABLE", "SpaceX GPT 当前报价不可用", {
        retryable: false,
        definitelyNotCreated: true
      });
    }
    const quote = preflightData?.quotes?.[planId];
    if (!quote || quote.plan !== planId || String(quote.currency || "").toUpperCase() !== "PHP"
      || !Number.isSafeInteger(Number(quote.amountMinor)) || Number(quote.amountMinor) <= 0) {
      fail("SPACEX_GPT_QUOTE_INVALID", "SpaceX GPT 预检报价无法识别", {
        retryable: false,
        definitelyNotCreated: true
      });
    }
    const body = {
      card_id: cardId,
      plan: planId,
      credential,
      preflight_token: preflightToken,
      client_request_id: clientOrderId,
      no_auto_card_switch: true
    };
    const pricingVersion = Number(preflightData.pricing_version ?? preflightData.version);
    if (Number.isSafeInteger(pricingVersion) && pricingVersion > 0) body.pricing_version = pricingVersion;
    const created = await this.request("/gpt-direct/orders", {
      method: "POST",
      body,
      idempotencyKey: clientOrderId
    });
    return Object.freeze({
      idempotentReplay: false,
      requestId: optionalString(input.requestId, 200),
      task: normalizeTask(created.data, {
        clientOrderId,
        planId,
        checkoutCountry: country,
        cardLast4: input.card?.number ? last4(input.card.number) : null
      })
    });
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
      cardLast4: context.cardLast4
    });
    if (task.id !== id) {
      fail("SPACEX_GPT_CONTRACT_INVALID", "SpaceX GPT 查询结果与任务号不一致", { retryable: false });
    }
    return Object.freeze({ requestId: null, task });
  }
}
