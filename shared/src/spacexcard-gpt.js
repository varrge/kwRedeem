export const spaceXCardGptCheckoutUrl = "https://spacexcard.com/api/v1/gpt/checkout";

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 128 * 1024;
const CHECKOUT_ORIGINS = new Set(["https://chatgpt.com", "https://pay.openai.com"]);

function checkoutError(code, message, options = {}) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = options.statusCode || 502;
  error.retryable = options.retryable ?? true;
  error.retryScope = options.retryScope || "global";
  if (Number.isInteger(options.retryAfterMs) && options.retryAfterMs >= 0) error.retryAfterMs = options.retryAfterMs;
  return error;
}

function retryAfterMs(response) {
  const value = response.headers.get("retry-after");
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

async function readLimitedText(response) {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    try { await response.body?.cancel(); } catch {}
    throw checkoutError("CHECKOUT_BROKER_RESPONSE_TOO_LARGE", "Checkout 服务响应过大");
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_RESPONSE_BYTES) {
    throw checkoutError("CHECKOUT_BROKER_RESPONSE_TOO_LARGE", "Checkout 服务响应过大");
  }
  return new TextDecoder().decode(bytes);
}

export function validateChatGptCheckoutUrl(value) {
  let url;
  try { url = new URL(String(value || "")); } catch { return null; }
  if (!CHECKOUT_ORIGINS.has(url.origin) || url.username || url.password) return null;
  if (url.origin === "https://chatgpt.com"
    && url.pathname !== "/checkout" && !url.pathname.startsWith("/checkout/")) return null;
  return url.toString();
}

export async function createSpaceXCardCheckout(sessionJson, apiToken, options = {}) {
  if (!sessionJson || typeof sessionJson !== "object" || Array.isArray(sessionJson)) {
    throw checkoutError("SESSION_INVALID", "Session JSON 无效", { statusCode: 422, retryable: false, retryScope: "order" });
  }
  const token = String(apiToken || "").trim();
  if (!token || token.length > 8192) {
    throw checkoutError("CHECKOUT_BROKER_NOT_CONFIGURED", "Checkout 服务凭据未配置", { statusCode: 503 });
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || DEFAULT_TIMEOUT_MS);
  try {
    const response = await (options.fetchImpl || globalThis.fetch)(spaceXCardGptCheckoutUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify({
        token_input: JSON.stringify(sessionJson),
        plan_name: "plus",
        country: "PH",
        currency: "PHP"
      }),
      signal: controller.signal
    });
    if (response.status === 401 || response.status === 403) {
      throw checkoutError("CHECKOUT_BROKER_AUTH_FAILED", "Checkout 服务鉴权失败", { statusCode: 503 });
    }
    if (response.status === 429) {
      throw checkoutError("CHECKOUT_BROKER_RATE_LIMITED", "Checkout 服务请求过于频繁", {
        statusCode: 503,
        retryAfterMs: retryAfterMs(response)
      });
    }
    if (!response.ok) throw checkoutError("CHECKOUT_BROKER_UNAVAILABLE", "Checkout 服务暂时不可用");
    const text = await readLimitedText(response);
    let envelope;
    try { envelope = JSON.parse(text); } catch {
      throw checkoutError("CHECKOUT_BROKER_RESPONSE_INVALID", "Checkout 服务响应不是合法 JSON");
    }
    if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
      throw checkoutError("CHECKOUT_BROKER_RESPONSE_INVALID", "Checkout 服务响应不是有效对象");
    }
    if (!Number.isInteger(envelope.code)) {
      throw checkoutError("CHECKOUT_BROKER_CODE_INVALID", "Checkout 服务响应码无效");
    }
    if (![0, 200].includes(envelope.code)) {
      throw checkoutError("CHECKOUT_BROKER_BUSINESS_REJECTED", "Checkout 服务拒绝了本次请求", {
        retryable: false,
        retryScope: "order"
      });
    }
    if (!envelope.data || typeof envelope.data !== "object" || Array.isArray(envelope.data)
      || typeof envelope.data.link !== "string" || !envelope.data.link.trim()) {
      throw checkoutError("CHECKOUT_BROKER_LINK_MISSING", "Checkout 服务未返回地址");
    }
    if (Object.keys(envelope.data).some((key) => key !== "link")) {
      throw checkoutError("CHECKOUT_BROKER_CONTRACT_DRIFT", "Checkout 服务响应契约无法识别");
    }
    const checkoutUrl = validateChatGptCheckoutUrl(envelope.data.link);
    if (!checkoutUrl) throw checkoutError("CHECKOUT_BROKER_LINK_INVALID", "Checkout 地址不在允许范围");
    return Object.freeze({ checkoutUrl });
  } catch (error) {
    if (error?.code) throw error;
    const timedOut = error?.name === "AbortError" || controller.signal.aborted;
    throw checkoutError(
      timedOut ? "CHECKOUT_BROKER_TIMEOUT" : "CHECKOUT_BROKER_UNAVAILABLE",
      timedOut ? "Checkout 服务请求超时" : "Checkout 服务网络异常",
      { statusCode: timedOut ? 504 : 502 }
    );
  } finally {
    clearTimeout(timeout);
  }
}
