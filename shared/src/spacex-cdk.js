import { createHmac, timingSafeEqual } from "node:crypto";

export const SPACEX_CDK_PLANS = Object.freeze(["plus", "pro_5x", "pro_20x"]);

export const SPACEX_CDK_PLAN_PREFIXES = Object.freeze({
  plus: "91GPTPLUS",
  pro_5x: "91GPT5X",
  pro_20x: "91GPT20X"
});

export const SPACEX_CDK_PLAN_MANUAL_TYPES = Object.freeze({
  plus: "PLUS",
  pro_5x: "x5",
  pro_20x: "x20"
});

export const SPACEX_CDK_ASSET_STATES = Object.freeze({
  inventory: "inventory",
  allocated: "allocated",
  claimed: "claimed",
  pending: "pending",
  consumed: "consumed",
  refundHold: "refund_hold",
  held: "held",
  heldContract: "held_contract"
});

export const SPACEX_CDK_UNIT_STATES = Object.freeze({
  pending: "pending",
  allocated: "allocated",
  wrapped: "wrapped",
  fundingBlocked: "funding_blocked",
  contractBlocked: "contract_blocked",
  issuanceUncertain: "issuance_uncertain",
  refundHold: "refund_hold",
  refunded: "refunded"
});

export const SPACEX_CDK_ACTIVATION_STATES = Object.freeze({
  submitting: "submitting",
  queued: "queued",
  running: "running",
  review: "review",
  pending: "pending",
  completed: "completed",
  failedResolution: "failed_resolution"
});

export const SPACEX_CDK_PENDING_STATUSES = new Set(["queued", "running", "review", "pending"]);
export const SPACEX_CDK_FAILED_STATUSES = new Set(["declined", "failed_precharge", "cancelled", "canceled"]);

export class SpaceXCdkApiError extends Error {
  constructor(message, { code = "SPACEX_CDK_API_ERROR", status = 0, uncertain = false } = {}) {
    super(message);
    this.name = "SpaceXCdkApiError";
    this.code = code;
    this.status = status;
    this.uncertain = Boolean(uncertain);
  }
}

export function normalizeSpaceXCdkBaseUrl(value) {
  const raw = String(value || "").trim();
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("SpaceX CDK 地址格式不正确");
  }
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && ["127.0.0.1", "localhost"].includes(parsed.hostname))) {
    throw new Error("SpaceX CDK 地址必须使用 HTTPS");
  }
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/+$/, "");
}

function parseJson(text) {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

function readMessage(json, fallback) {
  const message = String(json?.msg || json?.message || json?.error || fallback || "SpaceX CDK 请求失败");
  return message.slice(0, 300);
}

function envelopeSucceeded(json) {
  if (!json || typeof json !== "object") return true;
  if (json.code === undefined || json.code === null || json.code === "") return true;
  return [0, 200, "0", "200"].includes(json.code);
}

function unwrapData(json) {
  return json && typeof json === "object" && "data" in json ? json.data : json;
}

function integerMinor(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

export function decimalToMinor(value) {
  const raw = String(value ?? "").trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) return null;
  const [whole, decimal = ""] = raw.split(".");
  const result = Number(whole) * 100 + Number(decimal.padEnd(2, "0"));
  return Number.isSafeInteger(result) ? result : null;
}

export function decimalToMinorFloor(value) {
  const raw = String(value ?? "").trim();
  const match = raw.match(/^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i);
  if (!match) return null;
  const whole = match[1];
  const fraction = match[2] || "";
  const exponent = Number(match[3] || 0);
  if (!Number.isSafeInteger(exponent)) return null;
  const digits = `${whole}${fraction}`;
  const shift = exponent - fraction.length + 2;
  const minorDigits = shift >= 0
    ? `${digits}${"0".repeat(shift)}`
    : digits.slice(0, Math.max(0, digits.length + shift));
  const minor = BigInt(minorDigits || "0");
  return minor <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(minor) : null;
}

function normalizeStatus(value) {
  return String(value || "").trim().toLowerCase();
}

export class SpaceXCdkClient {
  constructor({ baseUrl = "https://spacexcard.com", apiKey = "", fetchImpl = globalThis.fetch, timeoutMs = 15000 }) {
    this.baseUrl = normalizeSpaceXCdkBaseUrl(baseUrl);
    this.apiKey = String(apiKey || "").trim();
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  async request(pathname, { method = "GET", body = null, headers = {}, authenticated = false, uncertainOnFailure = false } = {}) {
    if (authenticated && !this.apiKey) {
      throw new SpaceXCdkApiError("SpaceX CDK API Key 未配置", { code: "SPACEX_CDK_NOT_CONFIGURED" });
    }
    let response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${pathname}`, {
        method,
        headers: {
          Accept: "application/json",
          ...(body === null ? {} : { "Content-Type": "application/json" }),
          ...(authenticated ? { "X-API-Key": this.apiKey } : {}),
          ...headers
        },
        body: body === null ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs)
      });
    } catch (error) {
      throw new SpaceXCdkApiError("SpaceX CDK 网络请求结果不确定", {
        code: "SPACEX_CDK_NETWORK_UNCERTAIN",
        uncertain: uncertainOnFailure
      });
    }

    const text = await response.text();
    const json = parseJson(text);
    if (!response.ok || !envelopeSucceeded(json)) {
      const uncertain = uncertainOnFailure && (response.status >= 500 || response.status === 0);
      throw new SpaceXCdkApiError(readMessage(json, `SpaceX CDK HTTP ${response.status}`), {
        code: uncertain ? "SPACEX_CDK_UPSTREAM_UNCERTAIN" : "SPACEX_CDK_UPSTREAM_REJECTED",
        status: response.status,
        uncertain
      });
    }
    if (!json) {
      throw new SpaceXCdkApiError("SpaceX CDK 返回了无法识别的响应", {
        code: "SPACEX_CDK_INVALID_RESPONSE",
        status: response.status,
        uncertain: uncertainOnFailure
      });
    }
    return { json, data: unwrapData(json) };
  }

  async getBalance() {
    const { data } = await this.request("/openapi/v1/balance", { authenticated: true });
    const balanceMinor = decimalToMinorFloor(data?.balance);
    const currency = String(data?.currency || "").trim().toUpperCase();
    if (balanceMinor === null || !currency) {
      throw new SpaceXCdkApiError("SpaceX 余额响应缺少金额或币种", { code: "SPACEX_CDK_BALANCE_CONTRACT_INVALID" });
    }
    return { balanceMinor, currency };
  }

  async issueOne({ plan, idempotencyKey }) {
    if (!SPACEX_CDK_PLANS.includes(plan)) {
      throw new SpaceXCdkApiError("SpaceX CDK 套餐不受支持", { code: "SPACEX_CDK_PLAN_INVALID" });
    }
    const { data } = await this.request("/openapi/v1/gpt-direct/cdks", {
      method: "POST",
      authenticated: true,
      uncertainOnFailure: true,
      headers: { "Idempotency-Key": String(idempotencyKey) },
      body: { plan, count: 1, funding_confirmed: true }
    });
    const issued = Array.isArray(data?.issued) ? data.issued : [];
    if (issued.length !== 1 || !issued[0]?.code || issued[0]?.id === undefined || issued[0]?.id === null) {
      throw new SpaceXCdkApiError("SpaceX 发码响应未完整返回唯一明文码", {
        code: "SPACEX_CDK_ISSUANCE_UNCERTAIN",
        uncertain: true
      });
    }
    const item = issued[0];
    const fundingCapMinor = integerMinor(item.owner_funding_cap_minor ?? item.funding_cap_minor);
    const fundingCurrency = String(item.funding_currency || item.currency || data?.currency || "").trim().toUpperCase() || null;
    return {
      upstreamId: String(item.id),
      code: String(item.code),
      codePrefix: String(item.code_prefix || String(item.code).slice(0, 16)),
      plan: String(item.plan || plan),
      feeAmountMinor: integerMinor(item.fee_amount_minor) ?? 0,
      fundingCapMinor,
      fundingCurrency,
      contractValid: fundingCapMinor !== null && Boolean(fundingCurrency)
    };
  }

  async listCdks({ q = "", status = "", plan = "", page = 1, pageSize = 20 } = {}) {
    const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
    if (q) params.set("q", String(q));
    if (status) params.set("status", String(status));
    if (plan) params.set("plan", String(plan));
    const { data } = await this.request(`/openapi/v1/gpt-direct/cdks?${params}`, { authenticated: true });
    if (Array.isArray(data)) return data;
    return Array.isArray(data?.list) ? data.list : (Array.isArray(data?.items) ? data.items : []);
  }

  async getCdk(upstreamId) {
    const rows = await this.listCdks({ q: String(upstreamId), pageSize: 100 });
    const row = rows.find((item) => String(item?.id ?? item?.cdk_id ?? "") === String(upstreamId));
    if (!row) return null;
    return {
      upstreamId: String(row.id ?? row.cdk_id),
      plan: String(row.plan || ""),
      status: normalizeStatus(row.status),
      codePrefix: String(row.code_prefix || "")
    };
  }

  async preview({ code, deviceId }) {
    const { data } = await this.request("/api/v1/cdk/preview", {
      method: "POST",
      headers: { "X-Redemption-Device": String(deviceId) },
      body: { code: String(code) }
    });
    const redemptionToken = String(data?.redemption_token || "").trim();
    if (!redemptionToken) {
      throw new SpaceXCdkApiError("SpaceX 预览响应缺少兑换令牌", { code: "SPACEX_CDK_PREVIEW_CONTRACT_INVALID" });
    }
    return { ...data, redemptionToken };
  }

  async preflight({ redemptionToken, session, deviceId }) {
    const { data } = await this.request("/api/v1/cdk/preflight", {
      method: "POST",
      headers: { "X-Redemption-Device": String(deviceId) },
      body: {
        redemption_token: String(redemptionToken),
        credential: { mode: "session", session: String(session) }
      }
    });
    const preflightToken = String(data?.preflight_token || "").trim();
    if (!preflightToken) {
      throw new SpaceXCdkApiError("SpaceX 预检响应缺少预检令牌", { code: "SPACEX_CDK_PREFLIGHT_CONTRACT_INVALID" });
    }
    return { ...data, preflightToken };
  }

  async redeem({ redemptionToken, preflightToken, clientRequestId, deviceId }) {
    const { data } = await this.request("/api/v1/cdk/redeem", {
      method: "POST",
      uncertainOnFailure: true,
      headers: { "X-Redemption-Device": String(deviceId) },
      body: {
        redemption_token: String(redemptionToken),
        preflight_token: String(preflightToken),
        client_request_id: String(clientRequestId)
      }
    });
    return normalizeActivationResult(data);
  }

  async result({ redemptionToken, deviceId }) {
    const params = new URLSearchParams({ token: String(redemptionToken) });
    const { data } = await this.request(`/api/v1/cdk/result?${params}`, {
      headers: { "X-Redemption-Device": String(deviceId) }
    });
    return normalizeActivationResult(data);
  }
}

export function normalizeActivationResult(data = {}) {
  const status = normalizeStatus(data?.status || data?.order?.status || data?.result?.status);
  return {
    status,
    stage: String(data?.stage || data?.order?.stage || data?.result?.stage || "").trim(),
    message: String(data?.message || data?.msg || data?.result?.message || "").trim().slice(0, 300),
    upstreamOrderId: String(data?.order_id || data?.orderId || data?.order?.id || "").trim() || null
  };
}

export function verifySpaceXCdkWebhookSignature(rawBody, signature, secret) {
  const expected = createHmac("sha256", String(secret || "")).update(rawBody).digest("hex");
  const provided = String(signature || "").trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(provided)) return false;
  return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(provided, "hex"));
}
