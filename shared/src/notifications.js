import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { safeParseJson } from "./templates.js";
import { resolveProjectPath } from "./env.js";
import { notificationMatchModes, notificationMonitorTypes, notificationRuleOperators } from "./constants.js";

export const NOTIFICATION_MIN_INTERVAL = 1;
export const NOTIFICATION_MAX_INTERVAL = 3600;

const NOTIFICATION_BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36";
const PLAYWRIGHT_BROWSERS_PATH = resolveProjectPath(".playwright-browsers");

process.env.PLAYWRIGHT_BROWSERS_PATH ??= PLAYWRIGHT_BROWSERS_PATH;
fs.mkdirSync(PLAYWRIGHT_BROWSERS_PATH, { recursive: true });

function normalizePathSegments(dotPath) {
  return String(dotPath || "")
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .map((segment) => segment.trim())
    .filter(Boolean);
}

export function getJsonValueByPath(json, dotPath) {
  if (json === null || json === undefined) return undefined;
  if (!dotPath) return json;
  const segments = normalizePathSegments(dotPath);
  let current = json;
  for (const segment of segments) {
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current) && /^\d+$/.test(segment)) {
      current = current[Number(segment)];
      continue;
    }
    current = current[segment];
  }
  return current;
}

function coerceNumber(value) {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) {
    return Number(value);
  }
  return Number.NaN;
}

function compareEquality(actual, expected) {
  if (actual === expected) return true;
  if (actual === null || actual === undefined) return false;
  return String(actual) === String(expected ?? "");
}

function compareContains(actual, expected) {
  if (actual === null || actual === undefined) return false;
  if (Array.isArray(actual)) {
    return actual.some((item) => compareEquality(item, expected));
  }
  return String(actual).includes(String(expected ?? ""));
}

export function evaluateMonitorOperator(actual, operator, expected) {
  switch (operator) {
    case "equals":
      return compareEquality(actual, expected);
    case "not_equals":
      return !compareEquality(actual, expected);
    case "contains":
      return compareContains(actual, expected);
    case "not_contains":
      return !compareContains(actual, expected);
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      const lhs = coerceNumber(actual);
      const rhs = coerceNumber(expected);
      if (Number.isNaN(lhs) || Number.isNaN(rhs)) return false;
      if (operator === "gt") return lhs > rhs;
      if (operator === "gte") return lhs >= rhs;
      if (operator === "lt") return lhs < rhs;
      return lhs <= rhs;
    }
    case "exists":
      return actual !== undefined && actual !== null && actual !== "";
    case "not_exists":
      return actual === undefined || actual === null || actual === "";
    default:
      return false;
  }
}

export function normalizeMonitorRules(rules) {
  if (!rules) return { matchMode: "all", items: [] };
  const parsed = typeof rules === "string" ? safeParseJson(rules, null) : rules;
  if (!parsed || typeof parsed !== "object") return { matchMode: "all", items: [] };
  const matchMode = notificationMatchModes.includes(parsed.matchMode) ? parsed.matchMode : "all";
  const itemsSource = Array.isArray(parsed.items) ? parsed.items : [];
  const items = itemsSource
    .map((item) => ({
      fieldPath: normalizePathSegments(item?.fieldPath ?? "").join("."),
      operator: notificationRuleOperators.includes(item?.operator) ? item.operator : "equals",
      expectedValue: item?.expectedValue === undefined || item?.expectedValue === null
        ? ""
        : String(item.expectedValue)
    }))
    .filter((item) => item.fieldPath);
  return { matchMode, items };
}

export function normalizeWatchFields(fields) {
  if (!fields) return [];
  const parsed = typeof fields === "string" ? safeParseJson(fields, fields) : fields;
  if (Array.isArray(parsed)) {
    return parsed.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof parsed === "string") {
    return parsed
      .split(/[\n,;\s]+/)
      .map((item) => normalizePathSegments(item).join("."))
      .filter(Boolean);
  }
  return [];
}

export function evaluateMonitorRules(rulesObj, json) {
  const normalized = normalizeMonitorRules(rulesObj);
  if (!normalized.items.length) {
    return { matched: false, matchedItems: [], matchMode: normalized.matchMode };
  }

  const evaluated = normalized.items.map((rule) => {
    const actual = getJsonValueByPath(json, rule.fieldPath);
    const ok = evaluateMonitorOperator(actual, rule.operator, rule.expectedValue);
    return {
      fieldPath: rule.fieldPath,
      operator: rule.operator,
      expectedValue: rule.expectedValue,
      actualValue: actual,
      matched: ok
    };
  });

  const matched = normalized.matchMode === "any"
    ? evaluated.some((item) => item.matched)
    : evaluated.every((item) => item.matched);

  return {
    matched,
    matchMode: normalized.matchMode,
    matchedItems: evaluated.filter((item) => item.matched),
    evaluated
  };
}

export function clampIntervalSeconds(value, fallback = 60) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  const rounded = Math.round(num);
  if (rounded < NOTIFICATION_MIN_INTERVAL) return NOTIFICATION_MIN_INTERVAL;
  if (rounded > NOTIFICATION_MAX_INTERVAL) return NOTIFICATION_MAX_INTERVAL;
  return rounded;
}

export function clampBrowserWaitMs(value, fallback = 10000) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(60000, Math.max(1000, Math.round(num)));
}

export function summarizeJsonValue(value, limit = 240) {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (typeof value === "string") {
    if (value.length <= limit) return value;
    return `${value.slice(0, limit)}...`;
  }
  try {
    const text = JSON.stringify(value);
    if (text.length <= limit) return text;
    return `${text.slice(0, limit)}...`;
  } catch {
    return String(value);
  }
}

export function summarizeResponseInfo(responseInfo) {
  if (!responseInfo) return null;
  const text = typeof responseInfo.text === "string" && responseInfo.text.length > 1024
    ? `${responseInfo.text.slice(0, 1024)}...`
    : responseInfo.text || "";
  return {
    ok: !!responseInfo.ok,
    status: responseInfo.status,
    text,
    json: responseInfo.json ?? null
  };
}

function looksLikeHtml(text) {
  const normalized = String(text || "").trim().toLowerCase();
  return normalized.startsWith("<!doctype html")
    || normalized.startsWith("<html")
    || normalized.startsWith("<script")
    || normalized.includes("<body")
    || normalized.includes("<head");
}

function getMonitorType(monitor) {
  const value = String(monitor.monitor_type || monitor.monitorType || "http").trim().toLowerCase();
  return notificationMonitorTypes.includes(value) ? value : "http";
}

function getProfileDir(monitor) {
  const safeId = String(monitor.id || monitor.name || "default").replace(/[^a-zA-Z0-9_-]/g, "_");
  const dir = resolveProjectPath("data", "notification-browser-profiles", safeId);
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  return dir;
}

function sanitizeBrowserHeaders(headers) {
  const blocked = new Set([
    "cookie",
    "host",
    "content-length",
    "connection",
    "sec-fetch-site",
    "sec-fetch-mode",
    "sec-fetch-dest",
    "sec-ch-ua",
    "sec-ch-ua-mobile",
    "sec-ch-ua-platform",
    "user-agent"
  ]);
  return Object.fromEntries(
    Object.entries(headers || {}).filter(([key]) => !blocked.has(String(key).toLowerCase()))
  );
}

async function fetchBrowserMonitorEndpoint(monitor, { timeoutMsOverride } = {}) {
  const method = String(monitor.http_method || monitor.httpMethod || "GET").toUpperCase();
  const headersSource = monitor.headers_json ?? monitor.headersJson ?? "";
  const bodySource = monitor.body_json ?? monitor.bodyJson ?? "";
  const requestUrl = monitor.request_url || monitor.requestUrl;
  const pageUrl = monitor.browser_page_url || monitor.browserPageUrl || requestUrl;
  const readySelector = String(monitor.browser_ready_selector || monitor.browserReadySelector || "").trim();
  const timeoutMs = timeoutMsOverride ?? (Number(monitor.timeout_seconds ?? monitor.timeoutSeconds ?? 15) * 1000);
  const browserWaitMs = clampBrowserWaitMs(monitor.browser_wait_ms ?? monitor.browserWaitMs ?? 10000);

  if (!requestUrl) {
    return { ok: false, status: 0, text: "browser 模式缺少请求 URL", json: null };
  }
  if (!pageUrl) {
    return { ok: false, status: 0, text: "browser 模式缺少页面 URL", json: null };
  }

  let headers = {};
  if (headersSource) {
    const parsed = safeParseJson(headersSource, null);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      headers = sanitizeBrowserHeaders(parsed);
    } else {
      return { ok: false, status: 0, text: "Headers 必须是合法的 JSON 对象", json: null };
    }
  }

  let bodyString;
  if (method !== "GET" && method !== "HEAD" && bodySource) {
    const parsed = safeParseJson(bodySource, null);
    bodyString = parsed === null ? String(bodySource) : JSON.stringify(parsed);
  }

  let context;
  try {
    context = await chromium.launchPersistentContext(getProfileDir(monitor), {
      headless: true,
      userAgent: NOTIFICATION_BROWSER_UA,
      viewport: { width: 1440, height: 900 }
    });
    const page = context.pages()[0] || await context.newPage();
    await page.goto(pageUrl, {
      waitUntil: "domcontentloaded",
      timeout: browserWaitMs
    });

    if (readySelector) {
      await page.waitForSelector(readySelector, {
        timeout: browserWaitMs,
        state: "attached"
      });
    } else {
      await page.waitForTimeout(1200);
    }

    const referer = page.url() || pageUrl;
    const origin = (() => {
      try {
        return new URL(referer).origin;
      } catch {
        return "";
      }
    })();

    const response = await context.request.fetch(requestUrl, {
      method,
      headers: {
        "Accept": "application/json, text/plain, */*",
        "Content-Type": "application/json",
        ...(origin ? { Origin: origin } : {}),
        ...(referer ? { Referer: referer } : {}),
        ...headers
      },
      ...(method === "GET" || method === "HEAD" ? {} : { data: bodyString || "" }),
      timeout: timeoutMs
    });

    const text = await response.text();
    const json = safeParseJson(text, null);
    const contentType = response.headers()["content-type"] || "";

    if (response.ok() && json === null) {
      if (looksLikeHtml(text)) {
        return {
          ok: false,
          status: response.status(),
          text: `浏览器模式下目标接口返回了 HTML 页面，不是 JSON 数据，可能仍触发了风控/验证页。content-type=${contentType || "-"}`,
          json: null
        };
      }
      return {
        ok: false,
        status: response.status(),
        text: `浏览器模式下目标接口返回的内容不是合法 JSON。content-type=${contentType || "-"}`,
        json: null
      };
    }

    return {
      ok: response.ok(),
      status: response.status(),
      text,
      json
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      text: error.message || "浏览器模式请求失败",
      json: null
    };
  } finally {
    if (context) {
      await context.close().catch(() => {});
    }
  }
}

export async function fetchMonitorEndpoint(monitor, { timeoutMsOverride } = {}) {
  if (getMonitorType(monitor) === "browser") {
    return fetchBrowserMonitorEndpoint(monitor, { timeoutMsOverride });
  }

  const method = String(monitor.http_method || monitor.httpMethod || "GET").toUpperCase();
  const headersSource = monitor.headers_json ?? monitor.headersJson ?? "";
  const bodySource = monitor.body_json ?? monitor.bodyJson ?? "";
  const url = monitor.request_url || monitor.requestUrl;
  const timeoutMs = timeoutMsOverride ?? (Number(monitor.timeout_seconds ?? monitor.timeoutSeconds ?? 15) * 1000);

  if (!url) {
    return { ok: false, status: 0, text: "缺少请求 URL", json: null };
  }

  let headers = {};
  if (headersSource) {
    const parsed = safeParseJson(headersSource, null);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      headers = { ...parsed };
    } else {
      return { ok: false, status: 0, text: "Headers 必须是合法的 JSON 对象", json: null };
    }
  }

  let bodyString;
  if (method !== "GET" && method !== "HEAD" && bodySource) {
    const parsed = safeParseJson(bodySource, null);
    if (parsed === null) {
      bodyString = String(bodySource);
    } else {
      bodyString = JSON.stringify(parsed);
    }
  }

  const fetchHeaders = {
    "User-Agent": NOTIFICATION_BROWSER_UA,
    "Accept": "application/json, text/plain, */*",
    "Content-Type": "application/json",
    ...headers
  };

  try {
    const response = await fetch(url, {
      method,
      headers: fetchHeaders,
      body: method === "GET" || method === "HEAD" ? undefined : bodyString,
      signal: AbortSignal.timeout(timeoutMs)
    });
    const text = await response.text();
    const json = safeParseJson(text, null);
    const contentType = response.headers.get("content-type") || "";

    if (response.ok && json === null) {
      if (looksLikeHtml(text)) {
        return {
          ok: false,
          status: response.status,
          text: `目标接口返回了 HTML 页面，不是 JSON 数据，可能触发了风控/验证页。content-type=${contentType || "-"}`,
          json: null
        };
      }

      return {
        ok: false,
        status: response.status,
        text: `目标接口返回的内容不是合法 JSON。content-type=${contentType || "-"}`,
        json: null
      };
    }

    return { ok: response.ok, status: response.status, text, json };
  } catch (error) {
    return { ok: false, status: 0, text: error.message || "请求失败", json: null };
  }
}

function escapeMarkdownValue(value) {
  if (value === null || value === undefined) return "_(空)_";
  if (typeof value === "string") {
    const trimmed = value.length > 600 ? `${value.slice(0, 600)}...` : value;
    return trimmed.replace(/\|/g, "\\|").replace(/\n/g, " ");
  }
  try {
    const text = JSON.stringify(value);
    if (text.length > 600) return `${text.slice(0, 600)}...`;
    return text;
  } catch {
    return String(value);
  }
}

export function buildFeishuMarkdown({
  monitorName,
  monitorUrl,
  matchMode,
  matchedItems,
  watchFields,
  responseJson,
  timestamp,
  customTitle
}) {
  const lines = [];
  lines.push(`**触发时间**：${timestamp || new Date().toISOString()}`);
  lines.push(`**监听名称**：${monitorName || "-"}`);
  if (monitorUrl) lines.push(`**接口地址**：${monitorUrl}`);
  lines.push(`**匹配模式**：${matchMode === "any" ? "任一命中" : "全部命中"}`);

  if (matchedItems?.length) {
    lines.push("\n**命中规则**");
    for (const item of matchedItems) {
      const expected = item.expectedValue === "" || item.expectedValue === null || item.expectedValue === undefined
        ? "_(空)_"
        : escapeMarkdownValue(item.expectedValue);
      lines.push(`- \`${item.fieldPath}\` ${item.operator} ${expected} → 当前值：${escapeMarkdownValue(item.actualValue)}`);
    }
  }

  if (watchFields?.length) {
    lines.push("\n**监听字段当前值**");
    for (const fieldPath of watchFields) {
      const value = getJsonValueByPath(responseJson, fieldPath);
      lines.push(`- \`${fieldPath}\` = ${escapeMarkdownValue(value)}`);
    }
  }

  return {
    title: customTitle || `通知触发：${monitorName || "未命名监听"}`,
    content: lines.join("\n")
  };
}

export async function sendFeishuMarkdown(webhookUrl, { title, content }) {
  if (!webhookUrl) {
    return { ok: false, status: 0, text: "未配置飞书 Webhook", json: null };
  }
  const payload = {
    msg_type: "interactive",
    card: {
      config: { wide_screen_mode: true },
      header: {
        title: { tag: "plain_text", content: String(title || "通知").slice(0, 100) },
        template: "blue"
      },
      elements: [
        { tag: "markdown", content: String(content || "") }
      ]
    }
  };

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": NOTIFICATION_BROWSER_UA
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000)
    });
    const text = await response.text();
    const json = safeParseJson(text, null);
    // Feishu webhook returns { StatusCode: 0, ... } or { code: 0, ... } on success
    const feishuOk = !json || json.StatusCode === 0 || json.code === 0;
    return { ok: response.ok && feishuOk, status: response.status, text, json };
  } catch (error) {
    return { ok: false, status: 0, text: error.message || "飞书请求失败", json: null };
  }
}
