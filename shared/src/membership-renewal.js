export const membershipRenewalCancelUrl = "https://cat.freespaces.app/api/subscription/cancel";
export const membershipRenewalCheckUrl = "https://cat.freespaces.app/api/subscription/info";

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 128 * 1024;
const NO_SUBSCRIPTION_MESSAGE = "您还没有订阅允许您生成订阅链接";

function isNoSubscriptionResponseMessage(value) {
  return String(value || "")
    .trim()
    .replace(/[，,]/g, "")
    .replace(/\s+/g, "") === NO_SUBSCRIPTION_MESSAGE;
}

function renewalError(code, message, statusCode = 502) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  error.retryable = true;
  error.retryScope = "global";
  return error;
}

export async function checkMembershipRenewal(sessionJson, options = {}) {
  if (!sessionJson || typeof sessionJson !== "object" || Array.isArray(sessionJson)) {
    throw renewalError("SESSION_INVALID", "Session JSON 无效", 422);
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || DEFAULT_TIMEOUT_MS);
  try {
    const response = await (options.fetchImpl || globalThis.fetch)(membershipRenewalCheckUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify({ token: sessionJson }),
      signal: controller.signal
    });
    if ([401, 403].includes(response.status)) {
      throw renewalError("RENEWAL_CHECK_AUTH_FAILED", "续费检查服务鉴权失败", 503);
    }
    if (response.status === 429) {
      throw renewalError("RENEWAL_CHECK_RATE_LIMITED", "续费检查服务请求过于频繁", 503);
    }
    if (!response.ok) throw renewalError("RENEWAL_CHECK_FAILED", "续费检查服务暂时不可用");
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
      throw renewalError("RENEWAL_CHECK_RESPONSE_TOO_LARGE", "续费检查响应过大");
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_RESPONSE_BYTES) {
      throw renewalError("RENEWAL_CHECK_RESPONSE_TOO_LARGE", "续费检查响应过大");
    }
    let envelope;
    try { envelope = JSON.parse(new TextDecoder().decode(bytes)); } catch {
      throw renewalError("RENEWAL_CHECK_RESPONSE_INVALID", "续费检查响应不是合法 JSON");
    }
    const data = envelope?.code === 200 && envelope.data && typeof envelope.data === "object"
      ? envelope.data
      : null;
    if (!data || Array.isArray(data)) {
      throw renewalError("RENEWAL_CHECK_RESPONSE_INVALID", "续费检查结果无法确认");
    }
    const noSubscription = isNoSubscriptionResponseMessage(envelope?.message);
    const isDelinquent = typeof data.is_delinquent === "boolean" ? data.is_delinquent : (noSubscription ? false : null);
    const accountType = typeof data.account_type === "string" ? data.account_type.trim().toLowerCase() : "";
    const hasNoPaidExpiry = data.expire_time === null && data.expires_at === null;
    const hasPaidExpiry = (data.expire_time !== null && data.expire_time !== undefined)
      || (data.expires_at !== null && data.expires_at !== undefined);
    const hasActiveSubscription = noSubscription || hasNoPaidExpiry
      ? false
      : (hasPaidExpiry || (accountType && accountType !== "free") ? true : null);
    const willRenew = typeof data.auto_renew === "boolean"
      ? data.auto_renew
      : (noSubscription || (accountType === "free" && hasNoPaidExpiry) ? false : null);
    return Object.freeze({ isDelinquent, willRenew, hasActiveSubscription });
  } catch (error) {
    if (error?.code) throw error;
    throw renewalError(
      error?.name === "AbortError" || controller.signal.aborted
        ? "RENEWAL_CHECK_TIMEOUT"
        : "RENEWAL_CHECK_FAILED",
      "续费检查请求失败",
      error?.name === "AbortError" || controller.signal.aborted ? 504 : 502
    );
  } finally {
    clearTimeout(timeout);
  }
}

export async function cancelMembershipRenewal(sessionJson, options = {}) {
  if (!sessionJson || typeof sessionJson !== "object" || Array.isArray(sessionJson)) {
    throw renewalError("SESSION_INVALID", "Session JSON 无效", 422);
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || DEFAULT_TIMEOUT_MS);
  try {
    const response = await (options.fetchImpl || globalThis.fetch)(membershipRenewalCancelUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify({ token: sessionJson }),
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
    if (envelope?.code !== 200 || envelope.data !== 1) {
      throw renewalError("RENEWAL_CANCEL_RESPONSE_INVALID", "续费取消结果无法确认");
    }
    return Object.freeze({ requested: true, providerConfirmed: true, message: envelope.message || null });
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
