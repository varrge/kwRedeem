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

export function evaluateRule(ruleJson, responseInfo) {
  if (!ruleJson) {
    return responseInfo.ok;
  }

  const rule = safeParseJson(ruleJson, null);
  if (!rule || !rule.kind) {
    return responseInfo.ok;
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
