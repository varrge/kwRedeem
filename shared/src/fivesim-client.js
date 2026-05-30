/**
 * 5sim.net API 客户端模块
 * 封装所有 5sim API 交互，提供结构化的请求/响应处理
 *
 * 响应格式:
 *   getNumber: ACCESS_NUMBER:<id>:<number>
 *   getStatus: STATUS_OK:<code> | STATUS_WAIT_CODE | STATUS_CANCEL
 *   setStatus: ACCESS_READY | ACCESS_CANCEL
 *   getBalance: ACCESS_BALANCE:<amount>
 *
 * 错误码: NO_NUMBERS, NO_BALANCE, BAD_KEY, BAD_SERVICE, BAD_STATUS, BAD_ACTION
 */

const BASE_URL = "http://api1.5sim.net/stubs/handler_api.php";
const DEFAULT_TIMEOUT_MS = 15000;

const KNOWN_ERROR_CODES = [
  "NO_NUMBERS",
  "NO_BALANCE",
  "BAD_KEY",
  "BAD_SERVICE",
  "BAD_STATUS",
  "BAD_ACTION",
];

// --- Internal parsers (exported for testing) ---

/**
 * 检查文本是否为已知错误码，如果是则抛出错误
 * @param {string} text - 响应文本
 */
function checkErrorCode(text) {
  const trimmed = text.trim();
  if (KNOWN_ERROR_CODES.includes(trimmed)) {
    throw new Error(trimmed);
  }
}

/**
 * 解析 getNumber 响应
 * @param {string} text - 响应文本，格式: ACCESS_NUMBER:<id>:<number>
 * @returns {{id: string, number: string}}
 */
export function parseGetNumberResponse(text) {
  const trimmed = text.trim();
  checkErrorCode(trimmed);

  const prefix = "ACCESS_NUMBER:";
  if (!trimmed.startsWith(prefix)) {
    throw new Error(`Unexpected response format: ${trimmed}`);
  }

  const rest = trimmed.slice(prefix.length);
  const colonIndex = rest.indexOf(":");
  if (colonIndex === -1) {
    throw new Error(`Unexpected response format: ${trimmed}`);
  }

  const id = rest.slice(0, colonIndex);
  const number = rest.slice(colonIndex + 1);

  if (!id || !number) {
    throw new Error(`Unexpected response format: ${trimmed}`);
  }

  return { id, number };
}

/**
 * 将解析结果格式化回原始响应字符串
 * @param {{id: string, number: string}} result
 * @returns {string}
 */
export function formatGetNumberResponse(result) {
  return `ACCESS_NUMBER:${result.id}:${result.number}`;
}

/**
 * 解析 getStatus 响应
 * @param {string} text - 响应文本
 * @returns {{status: "waiting" | "ok" | "cancelled", code?: string}}
 */
export function parseGetStatusResponse(text) {
  const trimmed = text.trim();
  checkErrorCode(trimmed);

  if (trimmed === "STATUS_WAIT_CODE") {
    return { status: "waiting" };
  }

  if (trimmed === "STATUS_CANCEL") {
    return { status: "cancelled" };
  }

  const prefix = "STATUS_OK:";
  if (trimmed.startsWith(prefix)) {
    const code = trimmed.slice(prefix.length);
    if (!code) {
      throw new Error(`Unexpected response format: ${trimmed}`);
    }
    return { status: "ok", code };
  }

  throw new Error(`Unexpected response format: ${trimmed}`);
}

/**
 * 解析 getBalance 响应
 * @param {string} text - 响应文本，格式: ACCESS_BALANCE:<amount>
 * @returns {number}
 */
export function parseBalanceResponse(text) {
  const trimmed = text.trim();
  checkErrorCode(trimmed);

  const prefix = "ACCESS_BALANCE:";
  if (!trimmed.startsWith(prefix)) {
    throw new Error(`Unexpected response format: ${trimmed}`);
  }

  const amountStr = trimmed.slice(prefix.length);
  const amount = Number(amountStr);

  if (amountStr === "" || Number.isNaN(amount)) {
    throw new Error(`Unexpected response format: ${trimmed}`);
  }

  return amount;
}

// --- API key validation ---

/**
 * 验证 API key 非空
 * @param {string} apiKey
 */
function validateApiKey(apiKey) {
  if (!apiKey || typeof apiKey !== "string" || apiKey.trim() === "") {
    throw new Error("API key is missing");
  }
}

// --- Network helpers ---

/**
 * 发起 HTTP GET 请求到 5sim API
 * @param {string} url - 完整 URL
 * @param {number} timeoutMs - 超时时间
 * @returns {Promise<string>} 响应文本
 */
async function fetchApi(url, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  const urlPath = new URL(url).pathname + new URL(url).search;

  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
    });

    const text = await response.text();
    return text;
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error(`GET ${urlPath} failed: timeout after ${timeoutMs}ms`);
    }
    throw new Error(`GET ${urlPath} failed: ${err.message}`);
  } finally {
    clearTimeout(timeoutId);
  }
}

// --- Public API functions ---

/**
 * 购买手机号码
 * @param {string} apiKey - 5sim API key
 * @param {string} service - 服务名称
 * @param {string} country - 国家
 * @param {string} operator - 运营商
 * @returns {Promise<{id: string, number: string}>}
 */
export async function getNumber(apiKey, service, country, operator) {
  validateApiKey(apiKey);

  const url = `${BASE_URL}?api_key=${encodeURIComponent(apiKey)}&action=getNumber&service=${encodeURIComponent(service)}&country=${encodeURIComponent(country)}&operator=${encodeURIComponent(operator)}`;
  const text = await fetchApi(url);
  return parseGetNumberResponse(text);
}

/**
 * 查询订单状态
 * @param {string} apiKey - 5sim API key
 * @param {string} orderId - 订单 ID
 * @returns {Promise<{status: "waiting" | "ok" | "cancelled", code?: string}>}
 */
export async function getStatus(apiKey, orderId) {
  validateApiKey(apiKey);

  const url = `${BASE_URL}?api_key=${encodeURIComponent(apiKey)}&action=getStatus&id=${encodeURIComponent(orderId)}`;
  const text = await fetchApi(url);
  return parseGetStatusResponse(text);
}

/**
 * 设置订单状态（取消或完成）
 * @param {string} apiKey - 5sim API key
 * @param {string} orderId - 订单 ID
 * @param {"cancel" | "finish"} status - 目标状态
 * @returns {Promise<{success: boolean}>}
 */
export async function setStatus(apiKey, orderId, status) {
  validateApiKey(apiKey);

  const statusCode = status === "cancel" ? -1 : 6;
  const url = `${BASE_URL}?api_key=${encodeURIComponent(apiKey)}&action=setStatus&id=${encodeURIComponent(orderId)}&status=${statusCode}`;
  const text = await fetchApi(url);
  const trimmed = text.trim();

  // setStatus returns ACCESS_READY or ACCESS_CANCEL on success
  if (trimmed === "ACCESS_READY" || trimmed === "ACCESS_CANCEL") {
    return { success: true };
  }

  // Check for error codes
  checkErrorCode(trimmed);

  // Unrecognized response
  throw new Error(`Unexpected response format: ${trimmed}`);
}

/**
 * 查询账户余额
 * @param {string} apiKey - 5sim API key
 * @returns {Promise<number>}
 */
export async function getBalance(apiKey) {
  validateApiKey(apiKey);

  const url = `${BASE_URL}?api_key=${encodeURIComponent(apiKey)}&action=getBalance`;
  const text = await fetchApi(url);
  return parseBalanceResponse(text);
}
