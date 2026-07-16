export const spaceXCardOpenApiBaseUrl = "https://spacexcard.com/openapi/v1";

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 256 * 1024;
const OPENAI_TIERS = Object.freeze(["plus", "x5", "x20"]);

export class SpaceXCardOpenApiError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = "SpaceXCardOpenApiError";
    this.code = code;
    this.statusCode = options.statusCode || 502;
    this.retryable = options.retryable ?? true;
    this.retryScope = options.retryScope || "global";
    if (options.providerCode !== undefined) this.providerCode = options.providerCode;
    if (Number.isInteger(options.retryAfterMs) && options.retryAfterMs >= 0) this.retryAfterMs = options.retryAfterMs;
  }
}

function error(code, message, options) {
  return new SpaceXCardOpenApiError(code, message, options);
}

function requireObject(value, code = "SPACEXCARD_CONTRACT_DRIFT") {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw error(code, "SpaceX Card OpenAPI 响应契约无法识别");
  }
  return value;
}

function requireString(value, field) {
  if (typeof value !== "string" || !value.trim()) {
    throw error("SPACEXCARD_CONTRACT_DRIFT", `SpaceX Card 字段 ${field} 无效`);
  }
  return value.trim();
}

function requireNumber(value, field, options = {}) {
  const number = Number(value);
  if (!Number.isFinite(number) || (!options.allowNegative && number < 0)) {
    throw error("SPACEXCARD_CONTRACT_DRIFT", `SpaceX Card 字段 ${field} 无效`);
  }
  return number;
}

function nullableString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function retryAfterMs(response) {
  const value = response.headers.get("retry-after");
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);
  const at = Date.parse(value);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : undefined;
}

async function readLimitedText(response) {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    try { await response.body?.cancel(); } catch {}
    throw error("SPACEXCARD_RESPONSE_TOO_LARGE", "SpaceX Card OpenAPI 响应过大");
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_RESPONSE_BYTES) {
    throw error("SPACEXCARD_RESPONSE_TOO_LARGE", "SpaceX Card OpenAPI 响应过大");
  }
  return new TextDecoder().decode(bytes);
}

function normalizeCardNumber(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length < 12 || digits.length > 19) return { bin: null, last4: null };
  return { bin: digits.slice(0, 6), last4: digits.slice(-4) };
}

function normalizeProduct(item) {
  const product = requireObject(item);
  return Object.freeze({
    productCode: requireString(product.product_code, "product_code"),
    issuer: nullableString(product.issuer),
    network: requireString(product.network, "network"),
    issuingArea: requireString(product.issuing_area, "issuing_area"),
    cardType: requireString(product.card_type, "card_type"),
    openFee: requireNumber(product.open_fee, "open_fee"),
    rechargeFeeRate: requireNumber(product.recharge_fee, "recharge_fee"),
    refundRate: requireNumber(product.rtf_rate, "rtf_rate"),
    minAmount: requireNumber(product.min_amount, "min_amount"),
    maxAmount: requireNumber(product.max_amount, "max_amount")
  });
}

function normalizeCardSummary(item) {
  const card = requireObject(item);
  const number = normalizeCardNumber(card.card_number);
  return Object.freeze({
    upstreamCardId: requireNumber(card.id, "id"),
    vmCardId: requireString(card.vm_card_id, "vm_card_id"),
    productCode: requireString(card.product_code, "product_code"),
    network: nullableString(card.network),
    issuingArea: nullableString(card.issuing_area),
    availableAmount: requireNumber(card.available_amount, "available_amount"),
    status: requireString(card.status, "status").toUpperCase(),
    bin: number.bin,
    last4: number.last4,
    createdAt: nullableString(card.created_at)
  });
}

function normalizeTransaction(item) {
  const transaction = requireObject(item);
  const merchant = nullableString(transaction.merchant_name);
  return Object.freeze({
    authId: requireString(transaction.auth_id, "auth_id"),
    authTime: nullableString(transaction.auth_time),
    authAmount: requireNumber(transaction.auth_amount, "auth_amount"),
    authCurrency: nullableString(transaction.auth_currency)?.toUpperCase() || null,
    settleAmount: requireNumber(transaction.settle_amount, "settle_amount"),
    settleCurrency: nullableString(transaction.settle_currency)?.toUpperCase() || null,
    status: requireString(transaction.status, "status").toUpperCase(),
    type: requireString(transaction.type, "type"),
    merchantNormalized: merchant && /openai/i.test(merchant) ? "OPENAI" : "OTHER",
    createdAt: nullableString(transaction.create_time)
  });
}

function validateWriteInput(body, idempotencyKey) {
  if (!idempotencyKey || typeof idempotencyKey !== "string" || idempotencyKey.length > 200) {
    throw new TypeError("SpaceX Card 写操作必须提供合法 Idempotency-Key");
  }
  requireObject(body, "SPACEXCARD_REQUEST_INVALID");
}

export class SpaceXCardOpenApiClient {
  constructor(options = {}) {
    this.appSecret = String(options.appSecret || "").trim();
    this.appId = String(options.appId || "").trim();
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    this.timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
    if (!this.appSecret) throw new TypeError("SpaceX Card OpenAPI app_secret 未配置");
  }

  async request(path, options = {}) {
    const method = options.method || "GET";
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const headers = { "X-API-Key": this.appSecret, Accept: "application/json" };
      if (this.appId) headers["X-App-Id"] = this.appId;
      if (options.body !== undefined) headers["Content-Type"] = "application/json";
      if (options.idempotencyKey) headers["Idempotency-Key"] = options.idempotencyKey;
      const response = await this.fetchImpl(`${spaceXCardOpenApiBaseUrl}${path}`, {
        method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal
      });
      if (response.status === 401) {
        throw error("SPACEXCARD_AUTH_FAILED", "SpaceX Card OpenAPI 鉴权失败", { statusCode: 503 });
      }
      if (response.status === 403) {
        throw error("SPACEXCARD_ACCESS_DENIED", "SpaceX Card OpenAPI 访问被拒绝", { statusCode: 503 });
      }
      if (response.status === 429) {
        throw error("SPACEXCARD_RATE_LIMITED", "SpaceX Card OpenAPI 请求过于频繁", {
          statusCode: 503,
          retryAfterMs: retryAfterMs(response)
        });
      }
      if (!response.ok) {
        throw error("SPACEXCARD_UNAVAILABLE", "SpaceX Card OpenAPI 暂时不可用");
      }
      const text = await readLimitedText(response);
      let envelope;
      try {
        envelope = JSON.parse(text);
      } catch {
        throw error("SPACEXCARD_RESPONSE_INVALID", "SpaceX Card OpenAPI 响应不是合法 JSON");
      }
      const root = requireObject(envelope);
      if (root.code !== 0) {
        throw error("SPACEXCARD_OPERATION_REJECTED", "SpaceX Card OpenAPI 拒绝了操作", {
          statusCode: 409,
          retryable: false,
          retryScope: "order",
          providerCode: root.code
        });
      }
      return root.data;
    } catch (caught) {
      if (caught?.code) throw caught;
      const timedOut = caught?.name === "AbortError" || controller.signal.aborted;
      throw error(
        timedOut ? "SPACEXCARD_TIMEOUT" : "SPACEXCARD_UNAVAILABLE",
        timedOut ? "SpaceX Card OpenAPI 请求超时" : "SpaceX Card OpenAPI 网络异常",
        { statusCode: timedOut ? 504 : 502 }
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  async listProducts() {
    const data = await this.request("/products");
    if (!Array.isArray(data)) throw error("SPACEXCARD_CONTRACT_DRIFT", "SpaceX Card 产品列表契约无法识别");
    return data.map(normalizeProduct);
  }

  async listCards(options = {}) {
    const page = Math.max(1, Number(options.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(options.pageSize) || 20));
    const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
    if (options.sync) params.set("sync", "1");
    const data = requireObject(await this.request(`/cards?${params}`));
    if (!Array.isArray(data.list)) throw error("SPACEXCARD_CONTRACT_DRIFT", "SpaceX Card 卡列表契约无法识别");
    return Object.freeze({
      total: requireNumber(data.total, "total"),
      cards: Object.freeze(data.list.map(normalizeCardSummary))
    });
  }

  async getCardMaterial(cardId) {
    const data = requireObject(await this.request(`/cards/${encodeURIComponent(cardId)}`));
    const number = String(data.card_number || "").replace(/\D/g, "");
    const cvv = String(data.cvv || "").trim();
    const expiry = String(data.expire || "").trim();
    if (number.length < 12 || number.length > 19 || !/^\d{3,4}$/.test(cvv) || !/^(0[1-9]|1[0-2])\/\d{2}$/.test(expiry)) {
      throw error("SPACEXCARD_CARD_MATERIAL_INVALID", "SpaceX Card 卡片敏感资料不完整");
    }
    const [expiryMonth, shortYear] = expiry.split("/");
    return Object.freeze({
      number,
      cvv,
      expiryMonth,
      expiryYear: `20${shortYear}`,
      status: requireString(data.status, "status").toUpperCase(),
      availableAmount: requireNumber(data.available_amount, "available_amount")
    });
  }

  async listTransactions(cardId, options = {}) {
    const page = Math.max(1, Number(options.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(options.pageSize) || 50));
    const data = await this.request(`/cards/${encodeURIComponent(cardId)}/transactions?page=${page}&page_size=${pageSize}`);
    if (!Array.isArray(data)) throw error("SPACEXCARD_CONTRACT_DRIFT", "SpaceX Card 交易列表契约无法识别");
    return data.map(normalizeTransaction);
  }

  async getOpenAiPayments(cardId) {
    const data = await this.request(`/cards/${encodeURIComponent(cardId)}/openai-payments`);
    if (!Array.isArray(data) || data.length !== OPENAI_TIERS.length) {
      throw error("SPACEXCARD_CONTRACT_DRIFT", "SpaceX Card OpenAI 行情契约无法识别");
    }
    const byTier = new Map();
    for (const item of data) {
      const row = requireObject(item);
      const tier = requireString(row.tier, "tier");
      if (!OPENAI_TIERS.includes(tier) || byTier.has(tier) || typeof row.found !== "boolean") {
        throw error("SPACEXCARD_CONTRACT_DRIFT", "SpaceX Card OpenAI 行情档位无效");
      }
      const normalized = Object.freeze({
        tier,
        label: requireString(row.label, "label"),
        minUsd: requireNumber(row.min_usd, "min_usd"),
        maxUsd: requireNumber(row.max_usd, "max_usd"),
        amount: requireNumber(row.amount, "amount"),
        time: nullableString(row.time) || "",
        found: row.found
      });
      if (normalized.maxUsd < normalized.minUsd || (normalized.found && (!normalized.time || normalized.amount <= 0))) {
        throw error("SPACEXCARD_CONTRACT_DRIFT", "SpaceX Card OpenAI 行情字段无效");
      }
      byTier.set(tier, normalized);
    }
    return Object.freeze(OPENAI_TIERS.map((tier) => byTier.get(tier)));
  }

  async getBalance() {
    const data = requireObject(await this.request("/balance"));
    return Object.freeze({
      balance: requireNumber(data.balance, "balance"),
      currency: requireString(data.currency, "currency").toUpperCase()
    });
  }

  async openCard(input, idempotencyKey) {
    const body = {
      product_code: requireString(input?.productCode, "productCode"),
      first_name: requireString(input?.firstName, "firstName"),
      last_name: requireString(input?.lastName, "lastName"),
      init_amount: requireNumber(input?.initAmount, "initAmount")
    };
    validateWriteInput(body, idempotencyKey);
    const data = requireObject(await this.request("/cards/open", {
      method: "POST",
      body,
      idempotencyKey
    }));
    return Object.freeze({
      upstreamCardId: requireNumber(data.id, "id"),
      vmCardId: requireString(data.vm_card_id, "vm_card_id"),
      productCode: requireString(data.product_code, "product_code"),
      availableAmount: requireNumber(data.available_amount, "available_amount"),
      status: requireString(data.status, "status").toUpperCase(),
      openFee: requireNumber(data.open_fee, "open_fee")
    });
  }

  async rechargeCard(input, idempotencyKey) {
    const body = {
      card_id: requireNumber(input?.cardId, "cardId"),
      amount: requireNumber(input?.amount, "amount")
    };
    validateWriteInput(body, idempotencyKey);
    await this.request("/cards/recharge", { method: "POST", body, idempotencyKey });
    return Object.freeze({ succeeded: true });
  }
}
