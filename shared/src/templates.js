function stringifyValue(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function renderTemplateString(template, payload) {
  if (!template) return "";

  return String(template).replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_, key) => {
    const segments = key.split(".");
    let current = payload;

    for (const segment of segments) {
      if (current === null || current === undefined) return "";
      current = current[segment];
    }

    return stringifyValue(current);
  });
}

export function safeParseJson(value, fallback) {
  if (!value) return fallback;

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function renderJsonTemplate(template, payload) {
  const parsed = safeParseJson(template, null);
  if (parsed === null) return renderTemplateString(template, payload);

  return JSON.parse(renderTemplateString(JSON.stringify(parsed), payload));
}

export function shouldSendFormBody(headers = {}) {
  return Object.entries(headers || {}).some(([key, value]) => (
    key.toLowerCase() === "content-type"
    && String(value || "").toLowerCase().includes("application/x-www-form-urlencoded")
  ));
}

export function encodeRequestBody(body, headers = {}) {
  if (shouldSendFormBody(headers)) {
    if (typeof body === "string") return body;

    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(body && typeof body === "object" ? body : {})) {
      if (value === null || value === undefined) continue;
      params.set(key, typeof value === "object" ? JSON.stringify(value) : String(value));
    }
    return params.toString();
  }

  return typeof body === "string" ? body : JSON.stringify(body);
}

function valuesMatch(expected, actual) {
  if (expected && typeof expected === "object") {
    if (!actual || typeof actual !== "object") return false;

    if (Array.isArray(expected)) {
      if (!Array.isArray(actual) || actual.length < expected.length) return false;
      return expected.every((item, index) => valuesMatch(item, actual[index]));
    }

    return Object.entries(expected).every(([key, value]) => valuesMatch(value, actual[key]));
  }

  return actual === expected;
}

export function evaluateRule(ruleJson, responseInfo) {
  if (!ruleJson) {
    return responseInfo.ok;
  }

  const rule = safeParseJson(ruleJson, null);
  if (!rule) {
    return responseInfo.ok;
  }

  if (!rule.kind) {
    return valuesMatch(rule, responseInfo.json);
  }

  if (rule.kind === "http_status") {
    return Number(responseInfo.status) === Number(rule.value);
  }

  if (rule.kind === "text_includes") {
    return String(responseInfo.text ?? "").includes(String(rule.value ?? ""));
  }

  if (rule.kind === "json_path_equals") {
    const path = String(rule.path ?? "").split(".").filter(Boolean);
    let current = responseInfo.json;
    for (const segment of path) {
      current = current?.[segment];
    }
    return String(current) === String(rule.value);
  }

  return responseInfo.ok;
}
