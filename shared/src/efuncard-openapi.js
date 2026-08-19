import { createHash } from "node:crypto";
import { ProxyAgent } from "undici";

const MAX_RESPONSE_BYTES = 256 * 1024;
const DEFAULT_TIMEOUT_MS = 20_000;
const RATE_WINDOW_MS = 60_000;
const RATE_BUCKETS = new Map();

export class EfunCardOpenApiError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = "EfunCardOpenApiError";
    this.code = code;
    this.retryable = options.retryable !== false;
    this.knownNoWrite = options.knownNoWrite === true;
    this.statusCode = options.statusCode || 502;
    this.providerCode = options.providerCode || null;
    this.retryAfterSeconds = Number.isFinite(options.retryAfterSeconds) ? options.retryAfterSeconds : null;
  }
}

function fail(code, message, options) {
  throw new EfunCardOpenApiError(code, message, options);
}

function requiredString(value, field) {
  const result = typeof value === "string" ? value.trim() : "";
  if (!result) fail("EFUNCARD_CONTRACT_DRIFT", `EfunCard 字段 ${field} 无效`, { retryable: false });
  return result;
}

function number(value, field, options = {}) {
  if (value === null || value === undefined || (typeof value === "string" && !value.trim())) {
    fail("EFUNCARD_CONTRACT_DRIFT", `EfunCard 字段 ${field} 无效`, { retryable: false });
  }
  const result = Number(value);
  if (!Number.isFinite(result) || result < 0 || (options.positive && result <= 0)) {
    fail("EFUNCARD_CONTRACT_DRIFT", `EfunCard 字段 ${field} 无效`, { retryable: false });
  }
  return result;
}

function closeEnough(left, right, tolerance) {
  return Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= tolerance;
}

export function normalizeEfunCardOpenApiBaseUrl(value) {
  let url;
  try { url = new URL(String(value || "").trim()); } catch {
    fail("EFUNCARD_CONFIGURATION_INVALID", "EfunCard 地址无效", { retryable: false, knownNoWrite: true });
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    fail("EFUNCARD_CONFIGURATION_INVALID", "EfunCard 必须使用标准 HTTPS 地址", { retryable: false, knownNoWrite: true });
  }
  url.pathname = url.pathname.replace(/\/+$/, "");
  if (!["/api/open/v1", "/openapi/v1"].includes(url.pathname)) {
    fail("EFUNCARD_CONFIGURATION_INVALID", "EfunCard 地址必须以 /api/open/v1 或 /openapi/v1 结尾", { retryable: false, knownNoWrite: true });
  }
  return url.toString().replace(/\/$/, "");
}

async function readJson(response) {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) fail("EFUNCARD_RESPONSE_TOO_LARGE", "EfunCard 响应过大");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_RESPONSE_BYTES) fail("EFUNCARD_RESPONSE_TOO_LARGE", "EfunCard 响应过大");
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch {
    const contentType = String(response.headers.get("content-type") || "")
      .split(";", 1)[0].trim().slice(0, 80);
    const metadata = [
      `HTTP ${response.status}`,
      contentType ? `Content-Type ${contentType}` : null,
      `${bytes.byteLength} 字节`
    ].filter(Boolean).join(", ");
    fail("EFUNCARD_RESPONSE_INVALID", `EfunCard 响应不是合法 JSON（${metadata}）`, {
      statusCode: response.status,
      retryable: response.status >= 500 || response.status === 429,
      knownNoWrite: response.status >= 400 && response.status < 500
    });
  }
}

function luhnValid(value) {
  let sum = 0;
  let doubled = false;
  for (let index = value.length - 1; index >= 0; index -= 1) {
    let digit = Number(value[index]);
    if (doubled) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    doubled = !doubled;
  }
  return sum % 10 === 0;
}

function serviceFee(amount, rate, minimum = 0, roundUp = false) {
  const value = Math.max(amount * rate, minimum);
  return (roundUp ? Math.ceil(value * 100 - 1e-9) : Math.round(value * 100)) / 100;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function consumeRate(key, method, path, at = Date.now()) {
  const bucket = RATE_BUCKETS.get(key) || { total: [], purchases: [], refreshes: [] };
  const prune = (items) => items.filter((value) => value > at - RATE_WINDOW_MS);
  bucket.total = prune(bucket.total);
  bucket.purchases = prune(bucket.purchases);
  bucket.refreshes = prune(bucket.refreshes);
  const purchase = method === "POST" && path === "/cards/purchase";
  const refresh = method === "POST" && /\/cards\/\d+\/refresh-balance$/.test(path);
  if (bucket.total.length >= 60 || (purchase && bucket.purchases.length >= 10)
    || (refresh && bucket.refreshes.length >= 30)) return false;
  bucket.total.push(at);
  if (purchase) bucket.purchases.push(at);
  if (refresh) bucket.refreshes.push(at);
  RATE_BUCKETS.set(key, bucket);
  return true;
}

function normalizeIdempotencyKey(value) {
  const key = String(value || "").trim();
  if (/^[A-Za-z0-9_\-:.]{16,128}$/.test(key)) return key;
  if (!key || !/^[A-Za-z0-9_\-:.]+$/.test(key)) {
    fail("EFUNCARD_IDEMPOTENCY_KEY_INVALID", "EfunCard 幂等键无效", { retryable: false, knownNoWrite: true });
  }
  return `kwr:${createHash("sha256").update(key).digest("hex")}`;
}

export function normalizeEfunCardProxyUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  let url;
  try { url = new URL(raw); } catch {
    fail("EFUNCARD_CONFIGURATION_INVALID", "EfunCard 代理地址无效", {
      retryable: false,
      knownNoWrite: true
    });
  }
  const hostname = url.hostname.toLowerCase();
  if (!["http:", "https:"].includes(url.protocol)
    || !["127.0.0.1", "localhost", "[::1]"].includes(hostname)
    || url.pathname !== "/" || url.username || url.password || url.search || url.hash) {
    fail("EFUNCARD_CONFIGURATION_INVALID", "EfunCard 代理必须是无认证的本机 HTTP/HTTPS 地址", {
      retryable: false,
      knownNoWrite: true
    });
  }
  url.pathname = "/";
  return url.toString().replace(/\/$/, "");
}

export class EfunCardOpenApiClient {
  constructor(options = {}) {
    this.baseUrl = normalizeEfunCardOpenApiBaseUrl(options.baseUrl);
    this.apiKey = requiredString(options.apiKey, "apiKey");
    if (!/^(?:efk_|sk_).+$/.test(this.apiKey)) {
      fail("EFUNCARD_CONFIGURATION_INVALID", "EfunCard API Key 必须以 efk_ 或 sk_ 开头", {
        retryable: false,
        knownNoWrite: true
      });
    }
    this.rateKey = createHash("sha256").update(this.apiKey).digest("hex");
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    this.timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : DEFAULT_TIMEOUT_MS;
    this.proxyUrl = normalizeEfunCardProxyUrl(options.proxyUrl);
    this.dispatcher = this.proxyUrl ? new ProxyAgent(this.proxyUrl) : undefined;
  }

  async request(path, options = {}) {
    const method = options.method || "GET";
    if (!consumeRate(this.rateKey, method, path)) {
      fail("EFUNCARD_RATE_LIMITED", "EfunCard 本地请求频率已达上限", {
        retryable: true,
        knownNoWrite: true,
        statusCode: 429
      });
    }
    let response;
    try {
      const headers = {
        Accept: "application/json",
        "X-API-Key": this.apiKey,
        Authorization: `Bearer ${this.apiKey}`
      };
      if (options.body !== undefined) headers["Content-Type"] = "application/json";
      if (options.idempotencyKey) {
        headers["X-Idempotency-Key"] = options.idempotencyKey;
        headers["Idempotency-Key"] = options.idempotencyKey;
      }
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        redirect: "manual",
        signal: AbortSignal.timeout(this.timeoutMs),
        ...(this.dispatcher ? { dispatcher: this.dispatcher } : {})
      });
    } catch (error) {
      const timedOut = error?.name === "TimeoutError" || error?.name === "AbortError";
      fail(timedOut ? "EFUNCARD_TIMEOUT" : "EFUNCARD_UNAVAILABLE",
        timedOut ? "EfunCard 请求超时" : "EfunCard 网络异常");
    }
    if (response.status >= 300 && response.status < 400) {
      fail("EFUNCARD_REDIRECT_BLOCKED", "EfunCard 返回了不允许的重定向", { retryable: false });
    }
    let envelope;
    try {
      envelope = await readJson(response);
    } catch (error) {
      // A WAF commonly returns an HTML 401/403 page. The HTTP status is the
      // authoritative classification; do not surface it as contract drift.
      if (error?.code === "EFUNCARD_RESPONSE_INVALID" && response.status === 401) {
        fail("EFUNCARD_AUTH_FAILED", `EfunCard 鉴权失败（${error.message.match(/（(.+)）$/)?.[1] || `HTTP ${response.status}`}）`, {
          statusCode: response.status,
          retryable: false,
          knownNoWrite: true
        });
      }
      if (error?.code === "EFUNCARD_RESPONSE_INVALID" && response.status === 403) {
        fail("EFUNCARD_ACCESS_DENIED", `EfunCard 拒绝访问（${error.message.match(/（(.+)）$/)?.[1] || `HTTP ${response.status}`}）`, {
          statusCode: response.status,
          retryable: false,
          knownNoWrite: true
        });
      }
      throw error;
    }
    if (!response.ok || envelope?.success !== true) {
      const knownNoWrite = envelope?.success === false
        || [400, 401, 403, 404, 422, 429].includes(response.status);
      const providerCode = typeof envelope?.code === "string" ? envelope.code.trim() : "";
      const providerMessage = typeof envelope?.message === "string" ? envelope.message.trim() : "";
      const retryAfter = Number(response.headers.get("retry-after"));
      const code = response.status === 401
        ? "EFUNCARD_AUTH_FAILED"
        : (response.status === 403 ? "EFUNCARD_ACCESS_DENIED"
            : (response.status === 409 ? "EFUNCARD_IDEMPOTENCY_IN_PROGRESS"
              : (response.status === 429 ? "EFUNCARD_RATE_LIMITED" : "EFUNCARD_OPERATION_REJECTED")));
      fail(code,
        providerMessage || (response.status === 401 ? "EfunCard 鉴权失败" : "EfunCard 拒绝了操作"), {
          statusCode: response.status,
          retryable: response.status >= 500 || [409, 429].includes(response.status),
          knownNoWrite: response.status !== 409,
          providerCode,
          retryAfterSeconds: Number.isFinite(retryAfter) && retryAfter >= 0 ? retryAfter : null
        });
    }
    return envelope.data;
  }

  async catalog() {
    const data = await this.request("/card-types");
    if (!data || !Array.isArray(data.cardTypes) || typeof data.purchaseEnabled !== "boolean") {
      fail("EFUNCARD_CONTRACT_DRIFT", "EfunCard 卡产品结构无法识别");
    }
    const legacyCny = data.exchangeRate !== null && data.exchangeRate !== undefined && data.exchangeRate !== "";
    const exchangeRate = legacyCny ? number(data.exchangeRate, "exchangeRate", { positive: true }) : null;
    let discount = 1;
    if (legacyCny && data.discount) {
      const percent = number(data.discount.discountPercent, "discountPercent", { positive: true });
      if (percent > 100) fail("EFUNCARD_CONTRACT_DRIFT", "EfunCard 折扣字段无效");
      discount = percent / 100;
    }
    const ids = new Map();
    const products = data.cardTypes.map((item) => {
      const productCode = requiredString(item.cardType, "cardType");
      const productId = number(item.id, "id", { positive: true });
      if (ids.has(productCode)) fail("EFUNCARD_CONTRACT_DRIFT", "EfunCard 卡产品重复");
      ids.set(productCode, productId);
      const openFee = legacyCny
        ? number(item.baseCardFeeRmb, "baseCardFeeRmb") * discount / exchangeRate
        : number(item.effectiveCardFeeUsdt, "effectiveCardFeeUsdt");
      const feeRate = legacyCny
        ? number(item.feeRate, "feeRate") * discount
        : number(item.effectiveFeeRate, "effectiveFeeRate");
      const minAmount = number(item.minAmount, "minAmount");
      const maxAmount = number(item.maxAmount, "maxAmount", { positive: true });
      const requireMinBalance = legacyCny ? 0 : Number(item.requireMinBalance);
      const minimumRechargeAmount = legacyCny
        ? minAmount
        : number(item.minRechargeAmount ?? item.minAmount, "minRechargeAmount");
      if (feeRate > 1 || maxAmount < minAmount || minimumRechargeAmount > maxAmount
        || ![0, 1].includes(requireMinBalance)) {
        fail("EFUNCARD_CONTRACT_DRIFT", "EfunCard 卡产品字段无效");
      }
      return Object.freeze({
        productCode,
        openEnabled: data.purchaseEnabled,
        openFee,
        openFeeRate: feeRate,
        rechargeFeeRate: feeRate,
        minimumServiceFee: legacyCny ? 0 : number(item.minServiceFeeUsdt || 0, "minServiceFeeUsdt"),
        minimumPlatformBalance: requireMinBalance === 1 ? number(item.minBalanceUsdt, "minBalanceUsdt") : 0,
        minAmount,
        minimumRechargeAmount,
        maxAmount,
        roundOpenFeeUp: !legacyCny
      });
    });
    return Object.freeze({
      products: Object.freeze(products),
      ids,
      purchaseEnabled: data.purchaseEnabled,
      debitCurrency: legacyCny ? "CNY" : "USDT",
      exchangeRate
    });
  }

  async listProducts() {
    return (await this.catalog()).products;
  }

  async getBalance() {
    const data = await this.request("/account/balance");
    const balance = number(data?.balance, "balance");
    const currency = requiredString(data?.currency, "currency").toUpperCase();
    if (["USD", "USDT"].includes(currency)) return Object.freeze({ balance, currency: "USD" });
    if (currency !== "CNY") fail("EFUNCARD_CONTRACT_DRIFT", "EfunCard 余额币种无法识别");
    const catalog = await this.catalog();
    return Object.freeze({ balance: balance / catalog.exchangeRate, currency: "USD" });
  }

  async listCards(options = {}) {
    const page = Math.max(1, Number(options.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(options.pageSize) || 20));
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    const status = options.status === undefined ? "active" : String(options.status || "").trim();
    if (status) params.set("status", status);
    const data = await this.request(`/cards?${params.toString()}`);
    const hasCards = Array.isArray(data?.cards);
    const hasItems = Array.isArray(data?.items);
    const items = hasCards ? data.cards : data?.items;
    if (hasCards === hasItems || !Number.isInteger(Number(data?.total)) || Number(data.total) < 0) {
      fail("EFUNCARD_CONTRACT_DRIFT", "EfunCard 卡列表结构无法识别");
    }
    return Object.freeze({
      total: Number(data.total),
      cards: Object.freeze(items.map((item) => {
        const cardNo = String(item.cardNo || "").trim();
        const cardNumber = String(item.cardNumber || "").trim();
        if (cardNo && cardNumber && cardNo !== cardNumber) fail("EFUNCARD_CONTRACT_DRIFT", "EfunCard 卡号摘要冲突");
        const rawNumber = String(cardNo || cardNumber).replace(/\D/g, "");
        if (rawNumber.length < 4) fail("EFUNCARD_CONTRACT_DRIFT", "EfunCard 卡号摘要缺失");
        return Object.freeze({
          upstreamCardId: number(item.id, "cards.id", { positive: true }),
          vmCardId: String(item.id),
          productCode: requiredString(item.cardType, "cards.cardType"),
          availableAmount: number(item.cardBalance, "cards.cardBalance"),
          status: requiredString(item.status, "cards.status").toUpperCase(),
          last4: rawNumber.slice(-4),
          createdAt: typeof item.createdAt === "string" ? item.createdAt : null
        });
      }))
    });
  }

  async getCardDetail(cardId) {
    const data = await this.request(`/cards/${encodeURIComponent(cardId)}`);
    if (Number(data?.id) !== Number(cardId)) fail("EFUNCARD_CONTRACT_DRIFT", "EfunCard 卡片身份不一致");
    return data;
  }

  async getCardMaterial(cardId) {
    const data = await this.getCardDetail(cardId);
    const numberValue = String(data.cardNumber || "").replace(/\D/g, "");
    const cvv = String(data.cvv || "").trim();
    const expiryMonth = String(data.expiryMonth || "").padStart(2, "0");
    const expiryYear = String(data.expiryYear || "").trim();
    const status = requiredString(data.status, "status").toUpperCase();
    if (!/^\d{12,19}$/.test(numberValue) || !luhnValid(numberValue) || !/^\d{3,4}$/.test(cvv)
      || !/^(0[1-9]|1[0-2])$/.test(expiryMonth) || !/^20\d{2}$/.test(expiryYear) || status !== "ACTIVE") {
      fail("EFUNCARD_CARD_MATERIAL_INVALID", "EfunCard 卡片敏感资料不完整");
    }
    const expiryBoundary = new Date(Date.UTC(Number(expiryYear), Number(expiryMonth), 1));
    if (expiryBoundary <= new Date()) fail("EFUNCARD_CARD_EXPIRED", "EfunCard 卡片已过期", { retryable: false });
    return Object.freeze({
      number: numberValue,
      cvv,
      expiryMonth,
      expiryYear,
      status,
      availableAmount: number(data.cardBalance, "cardBalance")
    });
  }

  async openCard(input, idempotencyKey) {
    const catalog = await this.catalog();
    const product = catalog.products.find((item) => item.productCode === input.productCode);
    if (!product || !catalog.purchaseEnabled) {
      fail("EFUNCARD_PURCHASE_DISABLED", "EfunCard 卡产品不可开卡", { retryable: false, knownNoWrite: true });
    }
    const amount = number(input.initAmount, "initAmount", { positive: true });
    if (amount < product.minAmount || amount > product.maxAmount) {
      fail("EFUNCARD_OPERATION_REJECTED", "EfunCard 开卡金额超出产品范围", { retryable: false, knownNoWrite: true });
    }
    const expectedFee = product.openFee
      + serviceFee(amount, product.openFeeRate, product.minimumServiceFee, product.roundOpenFeeUp);
    const requiredBalance = amount + expectedFee + product.minimumPlatformBalance;
    const platformBalance = await this.getBalance();
    if (platformBalance.currency !== "USD" || platformBalance.balance + 0.001 < requiredBalance) {
      fail("EFUNCARD_BALANCE_INSUFFICIENT", "EfunCard 平台余额不足", { retryable: false, knownNoWrite: true });
    }
    const normalizedKey = normalizeIdempotencyKey(idempotencyKey);
    const data = await this.request("/cards/purchase", {
      method: "POST",
      idempotencyKey: normalizedKey,
      body: {
        cardTypeId: catalog.ids.get(product.productCode),
        quantity: 1,
        openCardAmount: amount,
        remark: `kwautomation:${normalizedKey}`
      }
    });
    if (!Array.isArray(data?.cards) || data.cards.length !== 1 || !Number(data.cards[0]?.id)) {
      fail("EFUNCARD_FUNDING_OUTCOME_UNKNOWN", "EfunCard 已受理开卡但结果无法识别", { retryable: false });
    }
    const rawTotal = catalog.debitCurrency === "CNY"
      ? (data.totalCostCny ?? data.totalCost)
      : (data.totalCostUsdt ?? data.totalCost);
    const providerTotal = Number(rawTotal);
    const totalUsd = catalog.debitCurrency === "CNY" ? providerTotal / catalog.exchangeRate : providerTotal;
    if (!Number.isFinite(totalUsd) || totalUsd <= 0 || !closeEnough(totalUsd - amount, expectedFee, 0.02)) {
      fail("EFUNCARD_FUNDING_OUTCOME_UNKNOWN", "EfunCard 已受理开卡但成本不匹配", { retryable: false });
    }
    const cardId = Number(data.cards[0].id);
    const deadline = Date.now() + 5 * 60_000;
    while (Date.now() < deadline) {
      const detail = await this.getCardDetail(cardId);
      const status = requiredString(detail.status, "status").toUpperCase();
      if (status === "ACTIVE") {
        if (requiredString(detail.cardType, "cardType") !== product.productCode) {
          fail("EFUNCARD_FUNDING_OUTCOME_UNKNOWN", "EfunCard 激活卡片与请求产品不一致", { retryable: false });
        }
        return Object.freeze({
          upstreamCardId: cardId,
          vmCardId: String(cardId),
          productCode: product.productCode,
          availableAmount: number(detail.cardBalance, "cardBalance"),
          status,
          openFee: expectedFee
        });
      }
      if (!["PENDING", "PROCESSING"].includes(status)) break;
      await sleep(2_000);
    }
    fail("EFUNCARD_FUNDING_OUTCOME_UNKNOWN", "EfunCard 开卡结果仍未确认", { retryable: false });
  }

  async rechargeCard(input, idempotencyKey) {
    const cardId = number(input.cardId, "cardId", { positive: true });
    const amount = number(input.amount, "amount", { positive: true });
    const before = await this.getCardDetail(cardId);
    const previous = number(before.cardBalance, "cardBalance");
    if (requiredString(before.status, "status").toUpperCase() !== "ACTIVE") {
      fail("EFUNCARD_OPERATION_REJECTED", "EfunCard 卡片不可充值", { retryable: false, knownNoWrite: true });
    }
    const catalog = await this.catalog();
    const product = catalog.products.find((item) => item.productCode === requiredString(before.cardType, "cardType"));
    if (catalog.debitCurrency === "USDT" && !Number.isInteger(amount)) {
      fail("EFUNCARD_OPERATION_REJECTED", "EfunCard 充值金额必须为正整数", { retryable: false, knownNoWrite: true });
    }
    if (!product || amount < product.minimumRechargeAmount || amount > product.maxAmount) {
      fail("EFUNCARD_OPERATION_REJECTED", "EfunCard 充值金额或卡产品无效", { retryable: false, knownNoWrite: true });
    }
    const expectedFee = serviceFee(amount, product.rechargeFeeRate, product.minimumServiceFee, false);
    const requiredBalance = amount + expectedFee + product.minimumPlatformBalance;
    const platformBalance = await this.getBalance();
    if (platformBalance.currency !== "USD" || platformBalance.balance + 0.001 < requiredBalance) {
      fail("EFUNCARD_BALANCE_INSUFFICIENT", "EfunCard 平台余额不足", { retryable: false, knownNoWrite: true });
    }
    const receipt = await this.request(`/cards/${cardId}/recharge`, {
      method: "POST",
      body: { amount },
      idempotencyKey
    });
    const totalCost = catalog.debitCurrency === "CNY" ? Number(receipt?.totalCostCny) : Number(receipt?.totalCostUsdt);
    const expectedTotal = catalog.debitCurrency === "CNY"
      ? (amount + expectedFee) * catalog.exchangeRate
      : amount + expectedFee;
    const totalTolerance = catalog.debitCurrency === "CNY" ? 0.05 : 0.005;
    if (!requiredString(receipt?.taskId, "taskId")
      || !closeEnough(Number(receipt?.rechargeAmountUsd), amount, 0.005)
      || !closeEnough(Number(receipt?.serviceFeeUsd), expectedFee, 0.005)
      || !closeEnough(totalCost, expectedTotal, totalTolerance)) {
      fail("EFUNCARD_FUNDING_OUTCOME_UNKNOWN", "EfunCard 已受理充值但收据无法确认", { retryable: false });
    }
    const deadline = Date.now() + 5 * 60_000;
    while (Date.now() < deadline) {
      const data = await this.request(`/cards/${cardId}/refresh-balance`, { method: "POST" });
      const current = number(data?.cardBalance, "cardBalance");
      if (current + 0.001 >= previous + amount) {
        return Object.freeze({ succeeded: true, taskId: String(receipt.taskId) });
      }
      await sleep(10_000);
    }
    fail("EFUNCARD_FUNDING_OUTCOME_UNKNOWN", "EfunCard 充值结果仍未确认", { retryable: false });
  }

  classifyFundingError(error) {
    if (["EFUNCARD_IDEMPOTENCY_IN_PROGRESS", "EFUNCARD_RATE_LIMITED"].includes(error?.code)) {
      return "retryable_no_write";
    }
    return error?.knownNoWrite === true ? "known_no_write" : "unknown";
  }
}
