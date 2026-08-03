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
      throw new Error(payload?.detail || payload?.msg || payload?.message || `383api HTTP ${response.status}`);
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

function normalizeMarketplacePhone(value) {
  return String(value ?? "").trim();
}

export function parse383ApiMarketplaceInventory(data) {
  const source = getPayloadData(data) || {};
  const items = Array.isArray(source.items)
    ? source.items
    : (Array.isArray(source.numbers) ? source.numbers : (Array.isArray(source) ? source : []));
  return {
    items: items.map((item) => ({
      phoneNumber: normalizeMarketplacePhone(item?.phone_number || item?.phoneNumber || item?.phone || item?.number),
      expiresAt: item?.expires_at || item?.expiresAt || "",
      raw: item
    })).filter((item) => item.phoneNumber),
    total: Math.max(0, Number(source.total ?? source.pagination?.total ?? items.length) || 0),
    page: Math.max(1, Number(source.page ?? source.pagination?.page) || 1),
    pageSize: Math.max(1, Number(source.page_size ?? source.pageSize ?? source.pagination?.page_size) || 100)
  };
}

export async function get383ApiMarketplaceInventoryPage(apiKey, options = {}) {
  const projectId = String(options.projectId || options.project_id || "").trim();
  if (!projectId) throw new Error("383api marketplace project_id is missing");
  const page = Math.max(1, Math.floor(Number(options.page) || 1));
  const pageSize = Math.min(100, Math.max(1, Math.floor(Number(options.pageSize || options.page_size) || 100)));
  const data = await request(`/api/marketplace/${encodeURIComponent(projectId)}/inventory`, {
    apiKey,
    query: { page, page_size: pageSize },
    timeoutMs: options.timeoutMs || DEFAULT_TIMEOUT_MS,
    baseUrl: options.baseUrl || BASE_URL
  });
  return { ...parse383ApiMarketplaceInventory(data), page, pageSize };
}

export async function get383ApiMarketplaceLastInventoryPage(apiKey, options = {}) {
  const pageSize = Math.min(100, Math.max(1, Math.floor(Number(options.pageSize || options.page_size) || 100)));
  const firstPage = await get383ApiMarketplaceInventoryPage(apiKey, { ...options, page: 1, pageSize });
  const lastPageNumber = Math.max(1, Math.ceil(firstPage.total / pageSize));
  if (lastPageNumber === 1) {
    return { ...firstPage, lastPage: 1 };
  }
  const lastPage = await get383ApiMarketplaceInventoryPage(apiKey, {
    ...options,
    page: lastPageNumber,
    pageSize
  });
  return { ...lastPage, total: firstPage.total, lastPage: lastPageNumber };
}

export function pick383ApiMarketplaceNumber(items, excludedNumbers = [], random = Math.random) {
  const excluded = new Set((excludedNumbers || []).map(normalizeMarketplacePhone).filter(Boolean));
  const candidates = (items || []).filter((item) => item?.phoneNumber && !excluded.has(item.phoneNumber));
  if (!candidates.length) return null;
  const randomValue = Number(random());
  const index = Math.min(candidates.length - 1, Math.max(0, Math.floor((Number.isFinite(randomValue) ? randomValue : 0) * candidates.length)));
  return candidates[index];
}

function normalizeMarketplaceNumberList(items) {
  return (Array.isArray(items) ? items : [])
    .map((item) => normalizeMarketplacePhone(
      typeof item === "string" ? item : (item?.number || item?.phone_number || item?.phoneNumber || item?.phone)
    ))
    .filter(Boolean);
}

export async function validate383ApiMarketplaceNumbers(apiKey, options = {}) {
  const projectId = String(options.projectId || options.project_id || "").trim();
  if (!projectId) throw new Error("383api marketplace project_id is missing");
  const numbers = normalizeMarketplaceNumberList(options.numbers);
  if (!numbers.length) throw new Error("383api marketplace numbers are missing");
  const data = await request(`/api/marketplace/${encodeURIComponent(projectId)}/validate-numbers`, {
    apiKey,
    method: "POST",
    body: { numbers },
    timeoutMs: options.timeoutMs || DEFAULT_TIMEOUT_MS,
    baseUrl: options.baseUrl || BASE_URL
  });
  const source = data || {};
  return {
    valid: normalizeMarketplaceNumberList(source.valid),
    invalid: Array.isArray(source.invalid) ? source.invalid : [],
    unitPrice: source.unit_price ?? source.unitPrice ?? null,
    totalPrice: source.total_price ?? source.totalPrice ?? null,
    raw: source
  };
}

export async function purchase383ApiMarketplaceNumbers(apiKey, options = {}) {
  const projectId = String(options.projectId || options.project_id || "").trim();
  if (!projectId) throw new Error("383api marketplace project_id is missing");
  const numbers = normalizeMarketplaceNumberList(options.numbers);
  if (!numbers.length) throw new Error("383api marketplace numbers are missing");
  const data = await request(`/api/marketplace/${encodeURIComponent(projectId)}/designated-purchase`, {
    apiKey,
    method: "POST",
    body: { numbers },
    timeoutMs: options.timeoutMs || 20000,
    baseUrl: options.baseUrl || BASE_URL
  });
  const source = data || {};
  return {
    orderNumber: source.order_number || source.orderNumber || "",
    projectName: source.project_name || source.projectName || "",
    quantity: Number(source.quantity || numbers.length),
    totalPrice: source.total_price ?? source.totalPrice ?? null,
    numbers,
    raw: source
  };
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
