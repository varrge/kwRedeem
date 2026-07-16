export const membershipRenewalCancelUrl = "https://spacexcard.com/api/v1/gpt/cancel-renewal";

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 128 * 1024;

function renewalError(code, message, statusCode = 502) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  error.retryable = true;
  error.retryScope = "global";
  return error;
}

export async function cancelMembershipRenewal(sessionJson, apiToken, options = {}) {
  if (!sessionJson || typeof sessionJson !== "object" || Array.isArray(sessionJson)) {
    throw renewalError("SESSION_INVALID", "Session JSON 无效", 422);
  }
  const token = String(apiToken || "").trim();
  if (!token || token.length > 8192) {
    throw renewalError("RENEWAL_CANCEL_NOT_CONFIGURED", "续费取消服务凭据未配置", 503);
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || DEFAULT_TIMEOUT_MS);
  try {
    const response = await (options.fetchImpl || globalThis.fetch)(membershipRenewalCancelUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify({ token_input: JSON.stringify(sessionJson) }),
      signal: controller.signal
    });
    if ([401, 403].includes(response.status)) {
      throw renewalError("RENEWAL_CANCEL_AUTH_FAILED", "续费取消服务鉴权失败", 503);
    }
    if (response.status === 429) {
      throw renewalError("RENEWAL_CANCEL_RATE_LIMITED", "续费取消服务请求过于频繁", 503);
    }
    if (!response.ok) throw renewalError("RENEWAL_CANCEL_FAILED", "续费取消服务暂时不可用");
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
      throw renewalError("RENEWAL_CANCEL_RESPONSE_TOO_LARGE", "续费取消响应过大");
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_RESPONSE_BYTES) {
      throw renewalError("RENEWAL_CANCEL_RESPONSE_TOO_LARGE", "续费取消响应过大");
    }
    let envelope;
    try { envelope = JSON.parse(new TextDecoder().decode(bytes)); } catch {
      throw renewalError("RENEWAL_CANCEL_RESPONSE_INVALID", "续费取消响应不是合法 JSON");
    }
    const data = envelope?.code === 0 && envelope.data && typeof envelope.data === "object"
      ? envelope.data
      : null;
    if (!data || (data.cancelled !== true && data.will_renew !== false && data.auto_renew !== false)) {
      throw renewalError("RENEWAL_CANCEL_RESPONSE_INVALID", "续费取消结果无法确认");
    }
    return Object.freeze({ requested: true, providerConfirmed: true });
  } catch (error) {
    if (error?.code) throw error;
    throw renewalError(
      error?.name === "AbortError" || controller.signal.aborted
        ? "RENEWAL_CANCEL_TIMEOUT"
        : "RENEWAL_CANCEL_FAILED",
      "续费取消请求失败",
      error?.name === "AbortError" || controller.signal.aborted ? 504 : 502
    );
  } finally {
    clearTimeout(timeout);
  }
}
