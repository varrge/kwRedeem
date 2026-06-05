const CARD_QUERY_KEYS = ["code", "card", "card_key", "cardCode", "card_code", "cdkey"];

function pickQueryCardCode(searchParams) {
  for (const key of CARD_QUERY_KEYS) {
    const value = searchParams.get(key);
    if (value && value.trim()) return value.trim();
  }
  return "";
}

function extractCardCodeFromUrl(value) {
  try {
    const url = new URL(value);
    const fromQuery = pickQueryCardCode(url.searchParams);
    if (fromQuery) return fromQuery;

    const lastPathSegment = url.pathname.split("/").filter(Boolean).pop();
    return lastPathSegment ? decodeURIComponent(lastPathSegment).trim() : "";
  } catch {
    return "";
  }
}

function extractCardCodeFromQueryLikeText(value) {
  const queryMatch = String(value).match(/(?:^|[?&#\s])(?:code|card|card_key|cardCode|card_code|cdkey)=([^&#\s]+)/i);
  return queryMatch ? decodeURIComponent(queryMatch[1]).trim() : "";
}

export function normalizeSourceKey(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";

  const fromUrl = extractCardCodeFromUrl(raw);
  if (fromUrl) return fromUrl;

  const fromQuery = extractCardCodeFromQueryLikeText(raw);
  if (fromQuery) return fromQuery;

  const segments = raw
    .split(/[\s|,，:：;；]+/)
    .map((segment) => segment.trim())
    .filter(Boolean);

  return segments.length > 1 ? segments[segments.length - 1] : raw;
}
