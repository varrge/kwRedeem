import { MembershipContractError, normalizeMembershipEnvelope } from "./membership-fulfillment.js";

export const membershipStateProviderUrl = "https://gptserve.freespaces.app/api/subscription/info";

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 128 * 1024;

function providerError(code, message, options = {}) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = options.statusCode || 502;
  error.retryable = options.retryable ?? true;
  if (error.retryable) error.retryScope = options.retryScope || "global";
  if (Number.isInteger(options.retryAfterMs) && options.retryAfterMs >= 0) error.retryAfterMs = options.retryAfterMs;
  return error;
}

function readRetryAfterMs(response) {
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
    throw providerError("MEMBERSHIP_PROVIDER_RESPONSE_TOO_LARGE", "会员状态服务响应过大");
  }
  const buffer = new Uint8Array(await response.arrayBuffer());
  if (buffer.byteLength > MAX_RESPONSE_BYTES) {
    throw providerError("MEMBERSHIP_PROVIDER_RESPONSE_TOO_LARGE", "会员状态服务响应过大");
  }
  return new TextDecoder().decode(buffer);
}

export async function fetchMembershipObservation(sessionJson, options = {}) {
  if (!sessionJson || typeof sessionJson !== "object" || Array.isArray(sessionJson)) {
    throw providerError("SESSION_INVALID", "Session JSON 无效", { statusCode: 422, retryable: false });
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || REQUEST_TIMEOUT_MS);
  try {
    const response = await (options.fetchImpl || globalThis.fetch)(membershipStateProviderUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ token: sessionJson }),
      signal: controller.signal
    });
    if (response.status === 429) {
      throw providerError("MEMBERSHIP_PROVIDER_RATE_LIMITED", "会员状态服务请求过于频繁", {
        statusCode: 503,
        retryAfterMs: readRetryAfterMs(response)
      });
    }
    if (!response.ok) {
      throw providerError("MEMBERSHIP_PROVIDER_UNAVAILABLE", "会员状态服务暂时不可用", {
        statusCode: response.status >= 500 ? 502 : 503
      });
    }
    const text = await readLimitedText(response);
    let envelope;
    try {
      envelope = JSON.parse(text);
    } catch {
      throw providerError("MEMBERSHIP_PROVIDER_RESPONSE_INVALID", "会员状态服务响应不是合法 JSON");
    }
    try {
      return normalizeMembershipEnvelope(envelope, { nowMs: options.nowMs });
    } catch (error) {
      if (error instanceof MembershipContractError) throw error;
      throw providerError("MEMBERSHIP_CONTRACT_UNKNOWN", "会员状态契约无法识别");
    }
  } catch (error) {
    if (error?.code) throw error;
    const timedOut = error?.name === "AbortError" || controller.signal.aborted;
    throw providerError(
      timedOut ? "MEMBERSHIP_PROVIDER_TIMEOUT" : "MEMBERSHIP_PROVIDER_UNAVAILABLE",
      timedOut ? "会员状态服务请求超时" : "会员状态服务网络异常",
      { statusCode: timedOut ? 504 : 502 }
    );
  } finally {
    clearTimeout(timeout);
  }
}
