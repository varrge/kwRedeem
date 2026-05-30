/**
 * External API proxy module for the quota claim system.
 *
 * The current upstream API uses Bearer API keys:
 * - GET /api/auth/me verifies a key and returns account balance.
 * - POST /api/user-claim claims accounts for that key.
 */

const EXTERNAL_BASE_URL = "https://gpt.kedaya.xyz";
const CLAIM_WARNING_ID = "claim-warranty-first-login-1h-20260530";

function sanitizeError(message) {
  if (!message) return "外部接口请求失败";
  return message
    .replaceAll(EXTERNAL_BASE_URL, "[external-api]")
    .replaceAll("gpt.kedaya.xyz", "[external-api]");
}

async function safeFetch(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = data?.error || data?.message || `外部接口请求失败 (${response.status})`;
      const wrapped = new Error(sanitizeError(error));
      wrapped.status = response.status;
      wrapped.retryAfterSeconds = data?.retryAfterSeconds;
      wrapped.warning = data?.warning;
      throw wrapped;
    }
    return data;
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("外部接口请求超时");
    }
    if (error.status) {
      throw error;
    }
    throw new Error(sanitizeError(error.message || "外部接口请求失败"));
  } finally {
    clearTimeout(timer);
  }
}

function bearerHeaders(apiKey) {
  return { Authorization: `Bearer ${apiKey}` };
}

export async function verifyExternalCard(cardCode) {
  const result = await safeFetch(
    `${EXTERNAL_BASE_URL}/api/auth/me`,
    {
      method: "GET",
      headers: bearerHeaders(cardCode),
    },
    15_000
  );

  const balance = Number(result?.user?.balance ?? 0);
  const authed = result?.authed === true;
  return {
    ok: authed,
    quota: balance,
    remaining: balance,
    used: authed ? balance <= 0 : true,
    raw: result
  };
}

export async function mergeExternalCards(cardCodes) {
  return {
    ok: false,
    error: "新版 API 不支持合并源卡密，请直接保留多个 API key 源卡使用",
    ignoredCount: Array.isArray(cardCodes) ? cardCodes.length : 0
  };
}

export async function fetchClaimWarning() {
  return {
    warning: {
      id: CLAIM_WARNING_ID,
      title: "提号须知",
      message: "仅质保提号，且仅限首登后 1 小时内。",
      requiredText: ""
    }
  };
}

export async function fetchExternalStatus() {
  return safeFetch(
    `${EXTERNAL_BASE_URL}/api/status`,
    { method: "GET" },
    5_000
  );
}

export async function claimFromExternal(cardCode, count, warningAckId = CLAIM_WARNING_ID, maxPriceTenths) {
  const body = { count, warningAckId };
  if (Number.isInteger(maxPriceTenths)) {
    body.maxPriceTenths = maxPriceTenths;
  }

  return safeFetch(
    `${EXTERNAL_BASE_URL}/api/user-claim`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...bearerHeaders(cardCode)
      },
      body: JSON.stringify(body),
    },
    15_000
  );
}

export async function fetchClaimHistory(cardCode) {
  return safeFetch(
    `${EXTERNAL_BASE_URL}/api/user-history?limit=500&includeAccounts=1`,
    {
      method: "GET",
      headers: bearerHeaders(cardCode),
    },
    15_000
  );
}
