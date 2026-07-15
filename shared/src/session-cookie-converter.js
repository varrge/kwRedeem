const CONVERTER_URL = "https://spacexcard.com/api/v1/gpt/session-to-cookie";
const CONVERTER_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 256 * 1024;
const COOKIE_BASE_NAME = "__Secure-next-auth.session-token";
const ALLOWED_SAME_SITE = new Set(["unspecified", "no_restriction", "lax", "strict"]);
const COOKIE_KEYS = new Set([
  "domain",
  "expirationDate",
  "hostOnly",
  "httpOnly",
  "name",
  "path",
  "sameSite",
  "secure",
  "session",
  "storeId",
  "value"
]);

function converterError(code, message, options = {}) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = options.statusCode || 502;
  error.retryable = options.retryable ?? true;
  if (error.retryable) error.retryScope = options.retryScope || "global";
  if (Number.isInteger(options.retryAfterMs) && options.retryAfterMs >= 0) {
    error.retryAfterMs = options.retryAfterMs;
  }
  return error;
}

function permanentError(code, message) {
  return converterError(code, message, { statusCode: 422, retryable: false });
}

function normalizeEmail(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (normalized.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) return null;
  return normalized;
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
    throw converterError("CONVERTER_RESPONSE_TOO_LARGE", "Cookie 包装服务响应超过大小限制");
  }

  if (!response.body?.getReader) {
    const buffer = new Uint8Array(await response.arrayBuffer());
    if (buffer.byteLength > MAX_RESPONSE_BYTES) {
      throw converterError("CONVERTER_RESPONSE_TOO_LARGE", "Cookie 包装服务响应超过大小限制");
    }
    return new TextDecoder().decode(buffer);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      try { await reader.cancel(); } catch {}
      throw converterError("CONVERTER_RESPONSE_TOO_LARGE", "Cookie 包装服务响应超过大小限制");
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

function normalizeSameSite(value) {
  const normalized = String(value || "").trim().toLowerCase();
  const chromeValue = normalized === "none" ? "no_restriction" : normalized;
  if (!ALLOWED_SAME_SITE.has(chromeValue)) {
    throw permanentError("COOKIE_PAYLOAD_INVALID", "Cookie SameSite 属性非法");
  }
  return chromeValue;
}

function hasOnlyKeys(object, allowed) {
  return Object.keys(object).every((key) => allowed.has(key));
}

function validateCookieContract(cookies) {
  const names = cookies.map((cookie) => cookie?.name);
  if (cookies.length === 1 && names[0] === COOKIE_BASE_NAME) return;
  if (cookies.length < 2) {
    throw converterError("CONVERTER_CONTRACT_DRIFT", "Cookie 分段结构超出当前契约");
  }
  for (let index = 0; index < names.length; index += 1) {
    if (names[index] !== `${COOKIE_BASE_NAME}.${index}`) {
      throw converterError("CONVERTER_CONTRACT_DRIFT", "Cookie 分段结构超出当前契约");
    }
  }
}

function parsePayload(sessionJson, envelope) {
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
    throw converterError("CONVERTER_RESPONSE_INVALID", "Cookie 包装服务响应格式无效");
  }
  if (!hasOnlyKeys(envelope, new Set(["code", "data", "msg"]))) {
    throw converterError("CONVERTER_CONTRACT_DRIFT", "Cookie 包装服务 envelope 已变化");
  }
  if (envelope.code !== 0 || !envelope.data || typeof envelope.data !== "object" || Array.isArray(envelope.data)) {
    throw converterError("CONVERTER_RESPONSE_INVALID", "Cookie 包装服务未返回成功响应");
  }
  if (!hasOnlyKeys(envelope.data, new Set(["cookies", "count", "email"]))) {
    throw converterError("CONVERTER_CONTRACT_DRIFT", "Cookie 包装服务 data 契约已变化");
  }

  const sessionEmail = normalizeEmail(sessionJson?.user?.email);
  const responseEmail = normalizeEmail(envelope.data.email);
  if (!sessionEmail || !responseEmail) {
    throw permanentError("EXPECTED_IDENTITY_MISSING", "Session 或 Cookie 包装响应缺少合法邮箱");
  }
  if (sessionEmail !== responseEmail) {
    throw permanentError("CONVERTER_IDENTITY_MISMATCH", "Session 与 Cookie 包装响应邮箱不一致");
  }

  const sourceCookies = envelope.data.cookies;
  if (!Array.isArray(sourceCookies) || sourceCookies.length === 0 || envelope.data.count !== sourceCookies.length) {
    throw permanentError("COOKIE_PAYLOAD_INVALID", "Cookie 数组为空或数量不一致");
  }
  validateCookieContract(sourceCookies);

  const seen = new Set();
  const cookies = sourceCookies.map((cookie) => {
    if (!cookie || typeof cookie !== "object" || Array.isArray(cookie)) {
      throw permanentError("COOKIE_PAYLOAD_INVALID", "Cookie 记录格式无效");
    }
    if (!hasOnlyKeys(cookie, COOKIE_KEYS)) {
      throw converterError("CONVERTER_CONTRACT_DRIFT", "Cookie 字段契约已变化");
    }
    for (const required of ["domain", "hostOnly", "httpOnly", "name", "path", "sameSite", "secure", "session", "storeId", "value"]) {
      if (!(required in cookie)) {
        throw converterError("CONVERTER_CONTRACT_DRIFT", "Cookie 字段契约已变化");
      }
    }

    const domain = String(cookie.domain || "").toLowerCase();
    if (!["chatgpt.com", ".chatgpt.com"].includes(domain)) {
      throw permanentError("COOKIE_PAYLOAD_INVALID", "Cookie 域名不在允许范围");
    }
    if (domain !== ".chatgpt.com" || cookie.hostOnly !== false || cookie.storeId !== null) {
      throw converterError("CONVERTER_CONTRACT_DRIFT", "Cookie 域属性超出当前契约");
    }
    if (cookie.secure !== true || cookie.httpOnly !== true) {
      throw permanentError("COOKIE_PAYLOAD_INVALID", "Cookie 安全属性无效");
    }
    const name = String(cookie.name || "");
    const value = typeof cookie.value === "string" ? cookie.value : "";
    const cookiePath = typeof cookie.path === "string" ? cookie.path : "";
    if (!name || !value || !cookiePath.startsWith("/")) {
      throw permanentError("COOKIE_PAYLOAD_INVALID", "Cookie 名称、值或路径无效");
    }
    if (cookiePath !== "/") {
      throw converterError("CONVERTER_CONTRACT_DRIFT", "Cookie 路径超出当前契约");
    }
    const key = `${name}\u0000${domain}\u0000${cookiePath}`;
    if (seen.has(key)) {
      throw permanentError("COOKIE_PAYLOAD_INVALID", "Cookie 记录重复");
    }
    seen.add(key);

    const hasExpiration = Object.hasOwn(cookie, "expirationDate");
    if (hasExpiration && (!Number.isFinite(cookie.expirationDate) || cookie.expirationDate <= 0)) {
      throw permanentError("COOKIE_PAYLOAD_INVALID", "Cookie 过期时间无效");
    }
    if ((hasExpiration && cookie.session !== false) || (!hasExpiration && cookie.session !== true)) {
      throw converterError("CONVERTER_CONTRACT_DRIFT", "Cookie 会话属性超出当前契约");
    }

    const normalized = {
      name,
      value,
      domain,
      path: cookiePath,
      secure: true,
      httpOnly: true,
      sameSite: normalizeSameSite(cookie.sameSite)
    };
    if (hasExpiration) normalized.expirationDate = cookie.expirationDate;
    return normalized;
  });

  return {
    schemaVersion: 1,
    expectedEmail: sessionEmail,
    clearCookieRules: [{ match: "prefix", name: COOKIE_BASE_NAME }],
    cookies
  };
}

async function requestEnvelope(sessionJson, apiToken, fetchImpl) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CONVERTER_TIMEOUT_MS);
    try {
      const response = await fetchImpl(CONVERTER_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify({ token_input: JSON.stringify(sessionJson) }),
        signal: controller.signal
      });

      if (response.status === 401 || response.status === 403) {
        throw converterError("CONVERTER_AUTH_FAILED", "Cookie 包装服务鉴权失败", { statusCode: 503 });
      }
      if (response.status === 429) {
        const error = converterError("CONVERTER_RATE_LIMITED", "Cookie 包装服务请求过于频繁", {
          statusCode: 503,
          retryAfterMs: retryAfterMs(response)
        });
        if (attempt === 0) {
          lastError = error;
          continue;
        }
        throw error;
      }
      if (response.status >= 500) {
        const error = converterError("CONVERTER_UNAVAILABLE", "Cookie 包装服务暂时不可用");
        if (attempt === 0) {
          lastError = error;
          continue;
        }
        throw error;
      }
      if (!response.ok) {
        throw converterError("CONVERTER_RESPONSE_INVALID", "Cookie 包装服务返回非预期状态");
      }

      const text = await readLimitedText(response);
      let envelope;
      try {
        envelope = JSON.parse(text);
      } catch {
        throw converterError("CONVERTER_RESPONSE_INVALID", "Cookie 包装服务响应不是合法 JSON");
      }
      return envelope;
    } catch (error) {
      if (error?.code) throw error;
      const timedOut = error?.name === "AbortError" || controller.signal.aborted;
      const mapped = converterError(
        timedOut ? "CONVERTER_TIMEOUT" : "CONVERTER_UNAVAILABLE",
        timedOut ? "Cookie 包装服务请求超时" : "Cookie 包装服务网络异常",
        { statusCode: timedOut ? 504 : 502 }
      );
      if (attempt === 0) {
        lastError = mapped;
        continue;
      }
      throw mapped;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError || converterError("CONVERTER_UNAVAILABLE", "Cookie 包装服务暂时不可用");
}

export async function convertSessionToCookiePayload(sessionJson, options = {}) {
  if (!sessionJson || typeof sessionJson !== "object" || Array.isArray(sessionJson)) {
    throw permanentError("SESSION_INVALID", "Session JSON 无效");
  }
  const apiToken = typeof options.apiToken === "string" ? options.apiToken.trim() : "";
  if (!apiToken) {
    throw converterError("CONVERTER_NOT_CONFIGURED", "Cookie 包装服务 Token 未配置", { statusCode: 503 });
  }
  const envelope = await requestEnvelope(sessionJson, apiToken, options.fetchImpl || globalThis.fetch);
  return parsePayload(sessionJson, envelope);
}
