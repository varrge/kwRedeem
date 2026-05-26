/**
 * External API Proxy Module for Card Quota System
 *
 * All calls to the external card platform are encapsulated here.
 * Error messages are sanitized to never expose the external API address.
 */

const EXTERNAL_BASE_URL = "https://gpt.kedaya.xyz";

/**
 * Sanitize error messages to remove any reference to the external API address.
 * @param {string} message - The original error message
 * @returns {string} Sanitized message
 */
function sanitizeError(message) {
  if (!message) return "外部接口请求失败";
  return message
    .replaceAll(EXTERNAL_BASE_URL, "[external-api]")
    .replaceAll("gpt.kedaya.xyz", "[external-api]");
}

/**
 * Internal helper to perform fetch with timeout and error sanitization.
 * @param {string} url - Full URL to fetch
 * @param {object} options - Fetch options (method, headers, body, etc.)
 * @param {number} timeoutMs - Timeout in milliseconds
 * @returns {Promise<object>} Parsed JSON response
 */
async function safeFetch(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });

    const data = await response.json();
    return data;
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("外部接口请求超时");
    }
    throw new Error(sanitizeError(error.message || "外部接口请求失败"));
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 验证卡密信息
 * POST https://gpt.kedaya.xyz/api/card-info
 * Body: { code: "[card_code]" }
 * Response: { ok: boolean, quota: number, remaining: number, used: boolean }
 *
 * @param {string} cardCode - The card code to verify
 * @returns {Promise<object>} Verification result
 */
export async function verifyExternalCard(cardCode) {
  return safeFetch(
    `${EXTERNAL_BASE_URL}/api/card-info`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: cardCode }),
    },
    15_000
  );
}

/**
 * 合并卡密
 * POST https://gpt.kedaya.xyz/api/merge-cards
 * Body: { codes: "code1\ncode2\ncode3" }
 * Response: { ok: boolean, newCode: string, ... } or { error: string }
 *
 * @param {string[]} cardCodes - Array of card codes to merge
 * @returns {Promise<object>} Merge result
 */
export async function mergeExternalCards(cardCodes) {
  return safeFetch(
    `${EXTERNAL_BASE_URL}/api/merge-cards`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ codes: cardCodes.join("\n") }),
    },
    30_000
  );
}

/**
 * 获取提取警告（需每5秒轮询）
 * GET https://gpt.kedaya.xyz/api/claim-warning
 * Response: { warning: { id: string, title: string, message: string } }
 *
 * @returns {Promise<object>} Warning object with id, title, message
 */
export async function fetchClaimWarning() {
  return safeFetch(
    `${EXTERNAL_BASE_URL}/api/claim-warning`,
    { method: "GET" },
    5_000
  );
}

/**
 * 执行提取操作
 * POST https://gpt.kedaya.xyz/api/claim
 * Body: { code: "[merged_card_code]", count: number, warningAckId: string }
 * Response: { ok: boolean, quota: number, remaining: number, chargedQuota: number, accounts: string[] }
 *
 * @param {string} cardCode - The merged card code
 * @param {number} count - Number of accounts to claim
 * @param {string} warningAckId - The warning acknowledgment ID from claim-warning
 * @returns {Promise<object>} Claim result
 */
export async function claimFromExternal(cardCode, count, warningAckId) {
  // Fetch the required acknowledgment text dynamically from claim-warning
  let warningAckText = "";
  if (warningAckId) {
    try {
      const warningResp = await safeFetch(
        `${EXTERNAL_BASE_URL}/api/claim-warning`,
        { method: "GET" },
        5_000
      );
      warningAckText = warningResp?.warning?.requiredText || "";
    } catch {
      // If we can't fetch the warning text, proceed without it
    }
  }

  return safeFetch(
    `${EXTERNAL_BASE_URL}/api/claim`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: cardCode, count, warningAckId, warningAckText }),
    },
    15_000
  );
}

/**
 * 获取提取历史
 * GET https://gpt.kedaya.xyz/api/claim-history?cardCode=[code]
 * Response: { history: [{ id, cardCode, accountCount, chargedQuota, accounts, hasAccounts, claimedAt }] }
 *
 * @param {string} cardCode - The card code to query history for
 * @returns {Promise<object>} History result
 */
export async function fetchClaimHistory(cardCode) {
  return safeFetch(
    `${EXTERNAL_BASE_URL}/api/claim-history?cardCode=${encodeURIComponent(cardCode)}`,
    { method: "GET" },
    15_000
  );
}
