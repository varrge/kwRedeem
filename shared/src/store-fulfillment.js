export const STORE_FULFILLMENT_STATUSES = {
  pending: "pending",
  retrying: "retrying",
  succeeded: "succeeded",
  blocked: "blocked",
  conflict: "conflict",
  canceled: "canceled"
};

export const STORE_CDK_ORIGINS = {
  admin: "admin_create",
  batch: "batch_import",
  store: "store_order"
};

export class DujiaoApiError extends Error {
  constructor(message, { status = 0, code = "", response = null } = {}) {
    super(message);
    this.name = "DujiaoApiError";
    this.status = status;
    this.code = code;
    this.response = response;
  }

  get retryable() {
    return this.status === 0 || this.status === 429 || this.status >= 500;
  }
}

export function normalizeDujiaoBaseUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) throw new Error("请填写 Dujiao 商城地址");
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Dujiao 商城地址格式不正确");
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Dujiao 商城地址只支持 http 或 https");
  }
  url.hash = "";
  url.search = "";
  return url.toString().replace(/\/+$/, "");
}

function parseJson(text) {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

function readRemoteMessage(json, fallback) {
  return String(json?.msg || json?.message || json?.error || fallback || "Dujiao 请求失败");
}

function assertDujiaoEnvelope(response, text, json) {
  const remoteCode = json?.msg || json?.code || "";
  if (!response.ok || (json && Number(json.status_code) !== 0)) {
    throw new DujiaoApiError(readRemoteMessage(json, text || `HTTP ${response.status}`), {
      status: response.status,
      code: String(remoteCode || ""),
      response: json
    });
  }
  return json || {};
}

export class DujiaoAdminClient {
  constructor({ baseUrl, username, password, fetchImpl = globalThis.fetch, timeoutMs = 15000 }) {
    this.baseUrl = normalizeDujiaoBaseUrl(baseUrl);
    this.username = String(username || "").trim();
    this.password = String(password || "");
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.token = "";
  }

  async login() {
    if (!this.username || !this.password) {
      throw new DujiaoApiError("Dujiao 服务管理员账号或密码未配置", { code: "credentials_missing" });
    }
    const envelope = await this.#requestRaw("/api/v1/admin/login", {
      method: "POST",
      body: { username: this.username, password: this.password }
    });
    if (envelope.data?.requires_totp) {
      throw new DujiaoApiError("Dujiao 服务管理员启用了 2FA，无法无人值守登录", { code: "totp_required" });
    }
    const token = String(envelope.data?.token || "").trim();
    if (!token) {
      throw new DujiaoApiError("Dujiao 登录响应缺少 data.token", { code: "token_missing", response: envelope });
    }
    this.token = token;
    return token;
  }

  async #requestRaw(pathname, { method = "GET", body = null, token = "" } = {}) {
    let response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${pathname}`, {
        method,
        headers: {
          Accept: "application/json",
          ...(body === null ? {} : { "Content-Type": "application/json" }),
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: body === null ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs)
      });
    } catch (error) {
      throw new DujiaoApiError(error?.message || "Dujiao 网络请求失败", { status: 0, code: "network_error" });
    }
    const text = await response.text();
    return assertDujiaoEnvelope(response, text, parseJson(text));
  }

  async request(pathname, options = {}, allowRelogin = true) {
    if (!this.token) await this.login();
    try {
      return await this.#requestRaw(pathname, { ...options, token: this.token });
    } catch (error) {
      if (allowRelogin && error instanceof DujiaoApiError && error.status === 401) {
        this.token = "";
        await this.login();
        return this.request(pathname, options, false);
      }
      throw error;
    }
  }

  async listOrders({ status, page = 1, pageSize = 200, sortBy = "created_at", sortOrder = "asc" }) {
    const params = new URLSearchParams({
      status,
      page: String(page),
      page_size: String(pageSize),
      sort_by: sortBy,
      sort_order: sortOrder
    });
    const envelope = await this.request(`/api/v1/admin/orders?${params.toString()}`);
    return {
      items: Array.isArray(envelope.data) ? envelope.data : [],
      pagination: envelope.pagination || {}
    };
  }

  async getOrder(orderId) {
    const envelope = await this.request(`/api/v1/admin/orders/${encodeURIComponent(orderId)}`);
    return envelope.data || null;
  }

  async createFulfillment({ orderId, payload }) {
    const envelope = await this.request("/api/v1/admin/fulfillments", {
      method: "POST",
      body: { order_id: Number(orderId), payload }
    });
    return envelope.data || null;
  }
}

export function readDujiaoItemTitle(value) {
  if (typeof value === "string") return value.trim();
  if (!value || typeof value !== "object") return "";
  return String(value["zh-CN"] || value.zh_CN || value.en || Object.values(value)[0] || "").trim();
}

export function collectDujiaoFulfillmentTargets(parentOrder) {
  const children = Array.isArray(parentOrder?.children) ? parentOrder.children : [];
  const targets = children.length ? children : [parentOrder];
  return targets.filter(Boolean).map((target) => ({
    orderId: String(target.id || ""),
    orderNo: String(target.order_no || ""),
    parentOrderId: children.length ? String(parentOrder.id || "") : "",
    parentOrderNo: children.length ? String(parentOrder.order_no || "") : String(target.order_no || ""),
    status: String(target.status || ""),
    fulfillment: target.fulfillment || null,
    items: (Array.isArray(target.items) ? target.items : []).map((item) => ({
      id: String(item.id || ""),
      productId: String(item.product_id || ""),
      skuId: String(item.sku_id || 0),
      title: readDujiaoItemTitle(item.title),
      quantity: Math.max(0, Number(item.quantity || 0)),
      fulfillmentType: String(item.fulfillment_type || "")
    }))
  }));
}

export function buildStoreDelivery(taskId, parentOrderNo, targetOrderNo, publicKeys, redeemUrl) {
  const keys = publicKeys.map((item) => String(item || "").trim()).filter(Boolean);
  const lines = keys.map((key, index) => `${index + 1}.${key}`);
  const normalizedRedeemUrl = String(redeemUrl || "").trim().replace(/\/+$/, "");
  if (normalizedRedeemUrl) lines.push(`提交网址：${normalizedRedeemUrl}`);
  return {
    payload: lines.join("\n"),
    deliveryData: {
      source: "kawang",
      schema_version: 1,
      task_id: String(taskId),
      store_order_no: String(parentOrderNo || targetOrderNo || ""),
      fulfillment_target_no: String(targetOrderNo || ""),
      cdkeys: keys
    }
  };
}

export function fulfillmentMatchesTask(fulfillment, taskId, publicKeys, expectedPayload = "") {
  if (!fulfillment) return false;
  const remotePayload = String(fulfillment.payload || "").trim();
  const localPayload = String(expectedPayload || "").trim();
  if (localPayload && remotePayload === localPayload) return true;

  // Historical tasks used structured delivery data; keep them reconcilable after switching to payload-only delivery.
  let data = fulfillment.delivery_data || fulfillment.deliveryData || {};
  if (typeof data === "string") data = parseJson(data) || {};
  const expected = publicKeys.map((item) => String(item || "").trim()).filter(Boolean);
  const actual = Array.isArray(data.cdkeys) ? data.cdkeys.map((item) => String(item || "").trim()) : [];
  return String(data.source || "") === "kawang"
    && String(data.task_id || "") === String(taskId)
    && actual.length === expected.length
    && actual.every((item, index) => item === expected[index]);
}
