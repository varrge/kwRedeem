const BASE_URL = "https://383api.com";
const DEFAULT_TIMEOUT_MS = 15000;

function assertApiKey(apiKey) {
  if (!apiKey || typeof apiKey !== "string" || !apiKey.trim()) {
    throw new Error("383api API key is missing");
  }
}

function normalizeBaseUrl(baseUrl = BASE_URL) {
  return String(baseUrl || BASE_URL).replace(/\/+$/, "");
}

function getPayloadData(payload) {
  if (payload && typeof payload === "object" && "code" in payload) {
    if (payload.code !== 0) {
      throw new Error(payload.msg || payload.message || `383api error ${payload.code}`);
    }
    return payload.data;
  }
  return payload;
}

async function request(path, { apiKey, method = "GET", query = {}, body = null, timeoutMs = DEFAULT_TIMEOUT_MS, baseUrl = BASE_URL } = {}) {
  assertApiKey(apiKey);
  const url = new URL(`${normalizeBaseUrl(baseUrl)}${path}`);
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
      headers: {
        Authorization: `Bearer ${apiKey}`,
        ...(body ? { "Content-Type": "application/json" } : {})
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.msg || payload?.message || `383api HTTP ${response.status}`);
    }
    return getPayloadData(payload);
  } catch (error) {
    if (error.name === "AbortError") throw new Error("383api request timeout");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function parse383ApiPurchaseData(data) {
  const source = getPayloadData(data);
  const numbers = Array.isArray(source?.numbers) ? source.numbers : (Array.isArray(source) ? source : []);
  const first = numbers[0];
  const phoneNumber = first?.phone_number || first?.phoneNumber || first?.phone || first?.tel || "";
  if (!phoneNumber) {
    throw new Error("383api did not return a phone number");
  }

  return {
    orderNumber: source?.order_number || source?.orderNumber || "",
    projectName: source?.project_name || source?.projectName || "",
    quantity: Number(source?.quantity || numbers.length || 1),
    totalPrice: source?.total_price ?? source?.totalPrice ?? null,
    phoneNumber,
    token: first?.token || "",
    tokenUrl: first?.token_url || first?.tokenUrl || "",
    expiresAt: first?.expires_at || first?.expiresAt || "",
    raw: source
  };
}

export function parse383ApiSmsMessages(data) {
  const source = getPayloadData(data);
  const items = Array.isArray(source?.items)
    ? source.items
    : (Array.isArray(source?.messages) ? source.messages : (Array.isArray(source) ? source : []));

  return items.map((item) => ({
    id: item?.id ?? null,
    phoneNumber: item?.phone_number || item?.phoneNumber || item?.phone || "",
    country: item?.country || "",
    sender: item?.sender || "",
    content: item?.content || item?.sms || item?.message || item?.text || "",
    projectName: item?.project_name || item?.projectName || "",
    receivedAt: item?.received_at || item?.receivedAt || item?.created_at || item?.createdAt || "",
    raw: item
  }));
}

export async function purchase383ApiNumber(apiKey, options = {}) {
  const projectId = String(options.projectId || options.project_id || "").trim();
  if (!projectId) throw new Error("383api project_id is missing");

  const data = await request("/api/open/purchase", {
    apiKey,
    method: "POST",
    body: {
      project_id: Number(projectId),
      quantity: Number(options.quantity || 1),
      ...(options.prefix ? { prefix: options.prefix } : {})
    },
    timeoutMs: options.timeoutMs || 20000,
    baseUrl: options.baseUrl || BASE_URL
  });
  return parse383ApiPurchaseData(data);
}

export async function get383ApiSmsMessages(apiKey, options = {}) {
  const data = await request("/api/open/sms", {
    apiKey,
    query: {
      phone_number: options.phoneNumber || options.phone_number || "",
      project_id: options.projectId || options.project_id || "",
      country: options.country || "",
      page: options.page || 1,
      page_size: options.pageSize || options.page_size || 50
    },
    timeoutMs: options.timeoutMs || DEFAULT_TIMEOUT_MS,
    baseUrl: options.baseUrl || BASE_URL
  });
  return parse383ApiSmsMessages(data);
}
