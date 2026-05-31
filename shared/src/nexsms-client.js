const BASE_URL = "https://api.nexsms.net";
const DEFAULT_TIMEOUT_MS = 15000;

function requireOk(payload) {
  if (!payload || payload.code !== 0) {
    throw new Error(payload?.message || "NexSMS request failed");
  }
  return payload.data;
}

async function request(path, { apiKey, method = "GET", query = {}, body = null, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  if (!apiKey) throw new Error("NexSMS API key is missing");
  const url = new URL(`${BASE_URL}${path}`);
  url.searchParams.set("apiKey", apiKey);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.message || `NexSMS HTTP ${response.status}`);
    }
    return requireOk(payload);
  } catch (error) {
    if (error.name === "AbortError") throw new Error("NexSMS request timeout");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function purchasePremiumNumber(apiKey, options) {
  const data = await request("/api/premium/purchase", {
    apiKey,
    method: "POST",
    body: {
      appId: Number(options.appId),
      type: Number(options.type || 1),
      quantity: Number(options.quantity || 1),
      expiry: Number(options.expiry || 0),
      prefix: options.prefix || null,
      exclude_prefix: options.excludePrefix || null
    },
    timeoutMs: 20000
  });
  const first = Array.isArray(data) ? data[0] : null;
  if (!first?.tel) throw new Error("NexSMS did not return a phone number");
  return first;
}

export async function getPremiumSmsRecords(apiKey, tel) {
  const data = await request("/api/premium/sms-records", {
    apiKey,
    query: { page: 1, pageSize: 10, tel }
  });
  return Array.isArray(data?.list) ? data.list : [];
}
