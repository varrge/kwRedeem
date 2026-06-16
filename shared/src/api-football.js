import { randomUUID } from "node:crypto";
import { decryptText } from "./secure.js";
import {
  getSub2ApiWorldCupResult,
  isSub2ApiWorldCupApiStatusCancelled,
  isSub2ApiWorldCupApiStatusFinal,
  isSub2ApiWorldCupApiStatusLive,
  normalizeSub2ApiWorldCupApiStatus,
  roundSub2ApiWorldCupAmount,
  sub2apiWorldCupMatchStatuses
} from "./sub2api.js";

const DEFAULT_TIMEOUT_MS = 12000;

export const DEFAULT_API_FOOTBALL_SETTINGS = Object.freeze({
  provider: "zafronix",
  enabled: false,
  baseUrl: "https://api.zafronix.com/fifa/worldcup/v1",
  footballDataBaseUrl: "https://api.football-data.org/v4",
  footballDataCompetition: "WC",
  zafronixBaseUrl: "https://api.zafronix.com/fifa/worldcup/v1",
  worldCupLeagueId: 1,
  worldCupSeason: 2026,
  timezone: "Asia/Shanghai",
  dailySoftLimit: 80,
  dailyHardLimit: 100,
  syncIntervalMs: 60000
});

function nowIso() {
  return new Date().toISOString();
}

function toIntegerOrNull(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const number = Number(value);
  return Number.isInteger(number) ? number : null;
}

function hasApiFootballErrors(errors) {
  if (!errors) return false;
  if (Array.isArray(errors)) return errors.length > 0;
  if (typeof errors === "object") return Object.keys(errors).length > 0;
  return Boolean(errors);
}

function getApiFootballErrorMessage(errors) {
  if (!errors) return "";
  if (typeof errors === "string") return errors;
  if (Array.isArray(errors)) return errors.join("; ");
  if (typeof errors === "object") {
    return Object.entries(errors).map(([key, value]) => `${key}: ${value}`).join("; ");
  }
  return String(errors);
}

const WORLDCUP_TEAM_CN_NAMES = new Map(Object.entries({
  Argentina: "阿根廷",
  Australia: "澳大利亚",
  Austria: "奥地利",
  Belgium: "比利时",
  Brazil: "巴西",
  Cameroon: "喀麦隆",
  Canada: "加拿大",
  Chile: "智利",
  Colombia: "哥伦比亚",
  "Costa Rica": "哥斯达黎加",
  Croatia: "克罗地亚",
  Denmark: "丹麦",
  Ecuador: "厄瓜多尔",
  Egypt: "埃及",
  England: "英格兰",
  France: "法国",
  Germany: "德国",
  Ghana: "加纳",
  Iran: "伊朗",
  Italy: "意大利",
  Japan: "日本",
  Korea: "韩国",
  "Korea Republic": "韩国",
  Mexico: "墨西哥",
  Morocco: "摩洛哥",
  Netherlands: "荷兰",
  "New Zealand": "新西兰",
  Nigeria: "尼日利亚",
  Norway: "挪威",
  Panama: "巴拿马",
  Paraguay: "巴拉圭",
  Peru: "秘鲁",
  Poland: "波兰",
  Portugal: "葡萄牙",
  Qatar: "卡塔尔",
  "Saudi Arabia": "沙特阿拉伯",
  Scotland: "苏格兰",
  Senegal: "塞内加尔",
  Serbia: "塞尔维亚",
  Spain: "西班牙",
  Sweden: "瑞典",
  Switzerland: "瑞士",
  Tunisia: "突尼斯",
  Ukraine: "乌克兰",
  Uruguay: "乌拉圭",
  USA: "美国",
  "United States": "美国",
  "United States of America": "美国",
  Wales: "威尔士"
}));

function normalizeWorldCupDisplayText(value) {
  return String(value || "").trim().replaceAll("_", " ").replace(/\s+/g, " ");
}

function localizeWorldCupTeamName(value, fallback) {
  const normalized = normalizeWorldCupDisplayText(value);
  if (!normalized) return fallback;
  return WORLDCUP_TEAM_CN_NAMES.get(normalized) || normalized;
}

function localizeWorldCupGroupName(value) {
  const normalized = normalizeWorldCupDisplayText(value);
  if (!normalized) return "";
  const groupMatch = normalized.match(/^group\s+([a-z0-9]+)$/i);
  if (groupMatch) return `小组 ${groupMatch[1].toUpperCase()}`;
  return normalized;
}

function localizeWorldCupStageName(value) {
  const normalized = normalizeWorldCupDisplayText(value);
  if (!normalized) return "";
  const groupMatch = normalized.match(/^group\s+([a-z0-9]+)$/i);
  if (groupMatch) return `小组 ${groupMatch[1].toUpperCase()}`;
  const lower = normalized.toLowerCase();
  if (lower === "group stage") return "小组赛";
  if (lower === "round of 32") return "32 强";
  if (lower === "round of 16") return "16 强";
  if (lower === "quarter finals" || lower === "quarter-finals" || lower === "quarterfinals") return "四分之一决赛";
  if (lower === "semi finals" || lower === "semi-finals" || lower === "semifinals") return "半决赛";
  if (lower === "third place" || lower === "third-place match") return "三四名决赛";
  if (lower === "final") return "决赛";
  return normalized;
}

function normalizeApiFootballLimit(value, fallback) {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function normalizeApiFootballPositiveInteger(value, fallback) {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function normalizeWorldCupApiProvider(value) {
  return "zafronix";
}

function maskApiFootballKey(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return "";
  if (normalized.length <= 10) return `${normalized.slice(0, 2)}***`;
  return `${normalized.slice(0, 6)}...${normalized.slice(-4)}`;
}

export function normalizeApiFootballSettings(row = null, { includeApiKey = false } = {}) {
  const encryptedApiKey = String(row?.api_key || "").trim();
  let apiKey = "";
  if (includeApiKey && encryptedApiKey) {
    try {
      apiKey = decryptText(encryptedApiKey);
    } catch {
      apiKey = "";
    }
  }

  return {
    provider: normalizeWorldCupApiProvider(row?.provider ?? DEFAULT_API_FOOTBALL_SETTINGS.provider),
    enabled: Boolean(Number(row?.enabled ?? DEFAULT_API_FOOTBALL_SETTINGS.enabled)),
    hasApiKey: Boolean(encryptedApiKey),
    apiKey,
    apiKeyMasked: includeApiKey ? maskApiFootballKey(apiKey) : (encryptedApiKey ? "已配置" : ""),
    baseUrl: String(row?.base_url || DEFAULT_API_FOOTBALL_SETTINGS.baseUrl).trim(),
    worldCupLeagueId: normalizeApiFootballPositiveInteger(row?.worldcup_league_id, DEFAULT_API_FOOTBALL_SETTINGS.worldCupLeagueId),
    worldCupSeason: normalizeApiFootballPositiveInteger(row?.worldcup_season, DEFAULT_API_FOOTBALL_SETTINGS.worldCupSeason),
    timezone: String(row?.timezone || DEFAULT_API_FOOTBALL_SETTINGS.timezone).trim(),
    dailySoftLimit: normalizeApiFootballLimit(row?.daily_soft_limit, DEFAULT_API_FOOTBALL_SETTINGS.dailySoftLimit),
    dailyHardLimit: Math.max(
      normalizeApiFootballLimit(row?.daily_soft_limit, DEFAULT_API_FOOTBALL_SETTINGS.dailySoftLimit),
      normalizeApiFootballLimit(row?.daily_hard_limit, DEFAULT_API_FOOTBALL_SETTINGS.dailyHardLimit)
    ),
    syncIntervalMs: Math.max(
      30000,
      normalizeApiFootballPositiveInteger(row?.sync_interval_ms, DEFAULT_API_FOOTBALL_SETTINGS.syncIntervalMs)
    ),
    updatedAt: row?.updated_at || null,
    updatedBy: row?.updated_by || null
  };
}

export function getApiFootballSettings(db, options = {}) {
  const row = db.prepare("SELECT * FROM api_football_settings WHERE id = 'default'").get();
  return normalizeApiFootballSettings(row, options);
}

function getResolvedApiFootballSettings(db, settings = null, { includeApiKey = true } = {}) {
  if (settings) {
    return {
      ...DEFAULT_API_FOOTBALL_SETTINGS,
      ...settings,
      enabled: Boolean(settings.enabled),
      hasApiKey: Boolean(settings.hasApiKey || settings.apiKey),
      dailyHardLimit: Math.max(
        normalizeApiFootballLimit(settings.dailySoftLimit, DEFAULT_API_FOOTBALL_SETTINGS.dailySoftLimit),
        normalizeApiFootballLimit(settings.dailyHardLimit, DEFAULT_API_FOOTBALL_SETTINGS.dailyHardLimit)
      )
    };
  }
  return getApiFootballSettings(db, { includeApiKey });
}

export function getApiFootballUsageDate(date = new Date(), timezone = DEFAULT_API_FOOTBALL_SETTINGS.timezone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone || DEFAULT_API_FOOTBALL_SETTINGS.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function getApiFootballQuotaSnapshot(db, {
  date = null,
  softLimit = DEFAULT_API_FOOTBALL_SETTINGS.dailySoftLimit,
  hardLimit = DEFAULT_API_FOOTBALL_SETTINGS.dailyHardLimit,
  timezone = DEFAULT_API_FOOTBALL_SETTINGS.timezone
} = {}) {
  const usageDate = date || getApiFootballUsageDate(new Date(), timezone);
  const soft = normalizeApiFootballLimit(softLimit, 80);
  const hard = Math.max(soft, normalizeApiFootballLimit(hardLimit, 100));
  const row = db.prepare("SELECT * FROM api_football_daily_usage WHERE usage_date = ?").get(usageDate);
  const used = Number(row?.used || 0);
  return {
    date: usageDate,
    used,
    softLimit: Number(row?.soft_limit || soft),
    hardLimit: Number(row?.hard_limit || hard),
    emergencyUsed: Number(row?.emergency_used || 0),
    remainingSoft: Math.max(0, Number(row?.soft_limit || soft) - used),
    remainingHard: Math.max(0, Number(row?.hard_limit || hard) - used)
  };
}

export function reserveApiFootballRequest(db, {
  endpoint,
  params = {},
  priority = "normal",
  date = getApiFootballUsageDate(),
  softLimit = DEFAULT_API_FOOTBALL_SETTINGS.dailySoftLimit,
  hardLimit = DEFAULT_API_FOOTBALL_SETTINGS.dailyHardLimit
}) {
  const soft = normalizeApiFootballLimit(softLimit, 80);
  const hard = Math.max(soft, normalizeApiFootballLimit(hardLimit, 100));
  const requestPriority = priority === "emergency" ? "emergency" : "normal";
  const reserve = db.transaction(() => {
    const now = nowIso();
    const existing = db.prepare("SELECT * FROM api_football_daily_usage WHERE usage_date = ?").get(date);
    if (!existing) {
      db.prepare(`
        INSERT INTO api_football_daily_usage (usage_date, used, soft_limit, hard_limit, emergency_used, updated_at)
        VALUES (?, 0, ?, ?, 0, ?)
      `).run(date, soft, hard, now);
    } else if (Number(existing.soft_limit) !== soft || Number(existing.hard_limit) !== hard) {
      db.prepare(`
        UPDATE api_football_daily_usage
        SET soft_limit = ?, hard_limit = ?, updated_at = ?
        WHERE usage_date = ?
      `).run(soft, hard, now, date);
    }

    const usage = db.prepare("SELECT * FROM api_football_daily_usage WHERE usage_date = ?").get(date);
    const used = Number(usage?.used || 0);
    if (used >= hard) {
      const error = new Error(`API-Football 今日请求已达到硬上限 ${hard}`);
      error.code = "API_FOOTBALL_HARD_LIMIT";
      error.usage = getApiFootballQuotaSnapshot(db, { date, softLimit: soft, hardLimit: hard });
      throw error;
    }
    if (used >= soft && requestPriority !== "emergency") {
      const error = new Error(`API-Football 今日请求已达到软上限 ${soft}`);
      error.code = "API_FOOTBALL_SOFT_LIMIT";
      error.usage = getApiFootballQuotaSnapshot(db, { date, softLimit: soft, hardLimit: hard });
      throw error;
    }

    const logId = randomUUID();
    const emergencyUsed = requestPriority === "emergency" || used >= soft ? 1 : 0;
    db.prepare(`
      UPDATE api_football_daily_usage
      SET used = used + 1,
          emergency_used = emergency_used + ?,
          soft_limit = ?,
          hard_limit = ?,
          updated_at = ?
      WHERE usage_date = ?
    `).run(emergencyUsed, soft, hard, now, date);
    db.prepare(`
      INSERT INTO api_football_request_logs (
        id, usage_date, endpoint, params, priority, counted, status, error_message, created_at
      )
      VALUES (?, ?, ?, ?, ?, 1, NULL, NULL, ?)
    `).run(logId, date, endpoint, JSON.stringify(params || {}), requestPriority, now);
    return {
      logId,
      usage: getApiFootballQuotaSnapshot(db, { date, softLimit: soft, hardLimit: hard })
    };
  });
  return reserve();
}

export function markApiFootballRequestLog(db, logId, { status = null, errorMessage = "" } = {}) {
  if (!logId) return;
  db.prepare(`
    UPDATE api_football_request_logs
    SET status = ?, error_message = ?
    WHERE id = ?
  `).run(status, errorMessage || null, logId);
}

export function buildApiFootballUrl(endpoint, params = {}, baseUrl = DEFAULT_API_FOOTBALL_SETTINGS.baseUrl) {
  const normalizedBase = String(baseUrl || DEFAULT_API_FOOTBALL_SETTINGS.baseUrl).replace(/\/+$/, "");
  const normalizedEndpoint = `/${String(endpoint || "").replace(/^\/+/, "")}`;
  const url = new URL(`${normalizedBase}${normalizedEndpoint}`);
  for (const [key, value] of Object.entries(params || {})) {
    if (value === undefined || value === null || value === "") continue;
    url.searchParams.set(key, String(value));
  }
  return url;
}

function getWorldCupProviderBaseUrl(settings) {
  if (settings.provider === "football-data") {
    const baseUrl = String(settings.baseUrl || "").trim();
    if (!baseUrl || baseUrl.includes("football.api-sports.io")) {
      return DEFAULT_API_FOOTBALL_SETTINGS.footballDataBaseUrl;
    }
    return baseUrl;
  }
  if (settings.provider === "zafronix") {
    const baseUrl = String(settings.baseUrl || "").trim();
    if (!baseUrl || baseUrl.includes("football.api-sports.io") || baseUrl.includes("football-data.org")) {
      return DEFAULT_API_FOOTBALL_SETTINGS.zafronixBaseUrl;
    }
    return baseUrl;
  }
  return settings.baseUrl || DEFAULT_API_FOOTBALL_SETTINGS.baseUrl;
}

export async function fetchApiFootballJson(db, endpoint, params = {}, {
  priority = "normal",
  timeoutMs = DEFAULT_TIMEOUT_MS,
  settings = null,
  apiKey = null,
  baseUrl = null
} = {}) {
  const resolvedSettings = getResolvedApiFootballSettings(db, settings, { includeApiKey: true });
  const resolvedApiKey = String(apiKey ?? resolvedSettings.apiKey ?? "").trim();
  if (!resolvedApiKey) {
    const error = new Error("未配置 API-Football API Key，跳过 API-Football 同步");
    error.code = "API_FOOTBALL_KEY_MISSING";
    throw error;
  }

  const date = getApiFootballUsageDate(new Date(), resolvedSettings.timezone);
  const reservation = reserveApiFootballRequest(db, {
    endpoint,
    params,
    priority,
    date,
    softLimit: resolvedSettings.dailySoftLimit,
    hardLimit: resolvedSettings.dailyHardLimit
  });
  const url = buildApiFootballUrl(endpoint, params, baseUrl ?? resolvedSettings.baseUrl);
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "x-apisports-key": resolvedApiKey
      },
      signal: AbortSignal.timeout(timeoutMs)
    });
    const json = await response.json().catch(() => null);
    if (!response.ok) {
      const message = getApiFootballErrorMessage(json?.errors) || `HTTP ${response.status}`;
      throw new Error(message);
    }
    if (hasApiFootballErrors(json?.errors)) {
      throw new Error(getApiFootballErrorMessage(json.errors) || "API-Football 返回错误");
    }
    markApiFootballRequestLog(db, reservation.logId, { status: response.status });
    return { json, usage: reservation.usage };
  } catch (error) {
    markApiFootballRequestLog(db, reservation.logId, {
      status: error.name === "TimeoutError" ? 408 : 0,
      errorMessage: error.message || "API-Football 请求失败"
    });
    throw error;
  }
}

export async function fetchFootballDataJson(db, endpoint, params = {}, {
  priority = "normal",
  timeoutMs = DEFAULT_TIMEOUT_MS,
  settings = null
} = {}) {
  const resolvedSettings = getResolvedApiFootballSettings(db, settings, { includeApiKey: true });
  const resolvedApiKey = String(resolvedSettings.apiKey || "").trim();
  if (!resolvedApiKey) {
    const error = new Error("未配置 Football-Data.org API Token，跳过世界杯同步");
    error.code = "API_FOOTBALL_KEY_MISSING";
    throw error;
  }

  const date = getApiFootballUsageDate(new Date(), resolvedSettings.timezone);
  const reservation = reserveApiFootballRequest(db, {
    endpoint,
    params,
    priority,
    date,
    softLimit: resolvedSettings.dailySoftLimit,
    hardLimit: resolvedSettings.dailyHardLimit
  });
  const url = buildApiFootballUrl(endpoint, params, getWorldCupProviderBaseUrl(resolvedSettings));
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "X-Auth-Token": resolvedApiKey
      },
      signal: AbortSignal.timeout(timeoutMs)
    });
    const json = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(json?.message || `HTTP ${response.status}`);
    }
    markApiFootballRequestLog(db, reservation.logId, { status: response.status });
    return { json, usage: reservation.usage };
  } catch (error) {
    markApiFootballRequestLog(db, reservation.logId, {
      status: error.name === "TimeoutError" ? 408 : 0,
      errorMessage: error.message || "Football-Data.org 请求失败"
    });
    throw error;
  }
}

export async function fetchZafronixJson(db, endpoint, params = {}, {
  priority = "normal",
  timeoutMs = DEFAULT_TIMEOUT_MS,
  settings = null
} = {}) {
  const resolvedSettings = getResolvedApiFootballSettings(db, settings, { includeApiKey: true });
  const resolvedApiKey = String(resolvedSettings.apiKey || "").trim();
  if (!resolvedApiKey) {
    const error = new Error("未配置 Zafronix API Key，跳过世界杯同步");
    error.code = "API_FOOTBALL_KEY_MISSING";
    throw error;
  }

  const date = getApiFootballUsageDate(new Date(), resolvedSettings.timezone);
  const reservation = reserveApiFootballRequest(db, {
    endpoint,
    params,
    priority,
    date,
    softLimit: resolvedSettings.dailySoftLimit,
    hardLimit: resolvedSettings.dailyHardLimit
  });
  const url = buildApiFootballUrl(endpoint, params, getWorldCupProviderBaseUrl(resolvedSettings));
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "X-API-Key": resolvedApiKey
      },
      signal: AbortSignal.timeout(timeoutMs)
    });
    const json = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(json?.message || json?.error || `HTTP ${response.status}`);
    }
    markApiFootballRequestLog(db, reservation.logId, { status: response.status });
    return { json, usage: reservation.usage };
  } catch (error) {
    markApiFootballRequestLog(db, reservation.logId, {
      status: error.name === "TimeoutError" ? 408 : 0,
      errorMessage: error.message || "Zafronix 请求失败"
    });
    throw error;
  }
}

export async function fetchApiFootballWorldCupFixtures(db, {
  next = null,
  fixtureId = null,
  date = null,
  priority = "normal",
  settings = null
} = {}) {
  const resolvedSettings = getResolvedApiFootballSettings(db, settings, { includeApiKey: true });
  const params = {
    league: resolvedSettings.worldCupLeagueId,
    season: resolvedSettings.worldCupSeason
  };
  if (next) params.next = next;
  if (fixtureId) params.id = fixtureId;
  if (date) params.date = date;
  return fetchApiFootballJson(db, "/fixtures", params, { priority, settings: resolvedSettings });
}

export async function fetchFootballDataWorldCupMatches(db, {
  priority = "normal",
  settings = null
} = {}) {
  const resolvedSettings = getResolvedApiFootballSettings(db, settings, { includeApiKey: true });
  const competition = DEFAULT_API_FOOTBALL_SETTINGS.footballDataCompetition;
  return fetchFootballDataJson(
    db,
    `/competitions/${competition}/matches`,
    { season: resolvedSettings.worldCupSeason },
    { priority, settings: resolvedSettings }
  );
}

export async function fetchZafronixWorldCupMatches(db, {
  priority = "normal",
  settings = null
} = {}) {
  const resolvedSettings = getResolvedApiFootballSettings(db, settings, { includeApiKey: true });
  return fetchZafronixJson(
    db,
    "/matches",
    { year: resolvedSettings.worldCupSeason },
    { priority, settings: resolvedSettings }
  );
}

export async function fetchApiFootballWorldCupOdds(db, {
  fixtureId,
  priority = "normal",
  settings = null
} = {}) {
  const resolvedSettings = getResolvedApiFootballSettings(db, settings, { includeApiKey: true });
  const params = {
    league: resolvedSettings.worldCupLeagueId,
    season: resolvedSettings.worldCupSeason,
    fixture: fixtureId
  };
  return fetchApiFootballJson(db, "/odds", params, { priority, settings: resolvedSettings });
}

export async function fetchApiFootballWorldCupLiveOdds(db, {
  fixtureId,
  priority = "emergency",
  settings = null
} = {}) {
  return fetchApiFootballJson(db, "/odds/live", { fixture: fixtureId }, { priority, settings });
}

export function parseApiFootballFixture(item, nowMs = Date.now()) {
  const fixture = item?.fixture || {};
  const league = item?.league || {};
  const teams = item?.teams || {};
  const goals = item?.goals || {};
  const score = item?.score || {};
  const statusShort = normalizeSub2ApiWorldCupApiStatus(fixture.status?.short);
  const kickoffDate = fixture.date ? new Date(fixture.date) : new Date(Number(fixture.timestamp || 0) * 1000);
  const kickoffMs = kickoffDate.getTime();
  const homeScore = toIntegerOrNull(goals.home ?? score.fulltime?.home);
  const awayScore = toIntegerOrNull(goals.away ?? score.fulltime?.away);
  const result = isSub2ApiWorldCupApiStatusFinal(statusShort) && homeScore !== null && awayScore !== null
    ? getSub2ApiWorldCupResult(homeScore, awayScore)
    : null;

  let status = sub2apiWorldCupMatchStatuses.open;
  if (isSub2ApiWorldCupApiStatusFinal(statusShort)) {
    status = sub2apiWorldCupMatchStatuses.finished;
  } else if (isSub2ApiWorldCupApiStatusCancelled(statusShort)) {
    status = sub2apiWorldCupMatchStatuses.cancelled;
  } else if (isSub2ApiWorldCupApiStatusLive(statusShort)) {
    status = sub2apiWorldCupMatchStatuses.locked;
  } else if (Number.isFinite(kickoffMs) && kickoffMs <= nowMs) {
    status = sub2apiWorldCupMatchStatuses.locked;
  }

  return {
    apiFixtureId: String(fixture.id || ""),
    source: "api-football",
    apiLeagueId: toIntegerOrNull(league.id),
    apiSeason: toIntegerOrNull(league.season),
    stage: localizeWorldCupStageName(league.round),
    groupName: "",
    homeTeam: localizeWorldCupTeamName(teams.home?.name, "待定主队"),
    awayTeam: localizeWorldCupTeamName(teams.away?.name, "待定客队"),
    kickoffAt: Number.isFinite(kickoffMs) ? kickoffDate.toISOString() : "",
    status,
    apiStatusShort: statusShort,
    apiStatusLong: String(fixture.status?.long || ""),
    apiElapsed: toIntegerOrNull(fixture.status?.elapsed),
    homeScore,
    awayScore,
    result
  };
}

function normalizeFootballDataStatus(value) {
  const status = String(value || "").trim().toUpperCase();
  if (["IN_PLAY", "LIVE"].includes(status)) return "1H";
  if (status === "PAUSED") return "HT";
  if (status === "FINISHED") return "FT";
  if (["POSTPONED", "SUSPENDED", "CANCELLED", "CANCELED"].includes(status)) return "PST";
  return "NS";
}

export function parseFootballDataMatch(item, nowMs = Date.now()) {
  const statusShort = normalizeFootballDataStatus(item?.status);
  const kickoffDate = item?.utcDate ? new Date(item.utcDate) : new Date("");
  const kickoffMs = kickoffDate.getTime();
  const homeScore = toIntegerOrNull(item?.score?.fullTime?.home);
  const awayScore = toIntegerOrNull(item?.score?.fullTime?.away);
  const result = isSub2ApiWorldCupApiStatusFinal(statusShort) && homeScore !== null && awayScore !== null
    ? getSub2ApiWorldCupResult(homeScore, awayScore)
    : null;

  let status = sub2apiWorldCupMatchStatuses.open;
  if (isSub2ApiWorldCupApiStatusFinal(statusShort)) {
    status = sub2apiWorldCupMatchStatuses.finished;
  } else if (isSub2ApiWorldCupApiStatusCancelled(statusShort)) {
    status = sub2apiWorldCupMatchStatuses.cancelled;
  } else if (isSub2ApiWorldCupApiStatusLive(statusShort)) {
    status = sub2apiWorldCupMatchStatuses.locked;
  } else if (Number.isFinite(kickoffMs) && kickoffMs <= nowMs) {
    status = sub2apiWorldCupMatchStatuses.locked;
  }

  return {
    apiFixtureId: String(item?.id || ""),
    source: "football-data",
    apiLeagueId: null,
    apiSeason: toIntegerOrNull(item?.season?.startDate?.slice(0, 4)) || null,
    stage: localizeWorldCupStageName(item?.stage || item?.matchday || item?.group),
    groupName: localizeWorldCupGroupName(item?.group),
    homeTeam: localizeWorldCupTeamName(item?.homeTeam?.name || item?.homeTeam?.shortName, "待定主队"),
    awayTeam: localizeWorldCupTeamName(item?.awayTeam?.name || item?.awayTeam?.shortName, "待定客队"),
    kickoffAt: Number.isFinite(kickoffMs) ? kickoffDate.toISOString() : "",
    status,
    apiStatusShort: statusShort,
    apiStatusLong: String(item?.status || ""),
    apiElapsed: null,
    homeScore,
    awayScore,
    result
  };
}

function normalizeZafronixStatus(value, homeScore, awayScore) {
  const status = String(value || "").trim().toLowerCase();
  if (["live", "in_play", "in-progress", "in_progress"].includes(status)) return "1H";
  if (["halftime", "half_time", "paused"].includes(status)) return "HT";
  if (["finished", "final", "completed"].includes(status)) return "FT";
  if (["postponed", "abandoned", "cancelled", "canceled"].includes(status)) return "PST";
  if (homeScore !== null && awayScore !== null) return "FT";
  return "NS";
}

function parseZafronixKickoff(item) {
  const utcValue = item?.kickoffUtc || item?.utcDate || item?.startTimeUtc || item?.startsAt;
  if (utcValue) return new Date(utcValue);
  if (item?.date && item?.kickoff) return new Date(`${item.date}T${item.kickoff}:00Z`);
  if (item?.date) return new Date(`${item.date}T04:00:00Z`);
  return new Date("");
}

export function parseZafronixMatch(item, nowMs = Date.now()) {
  const homeScore = toIntegerOrNull(item?.homeScore);
  const awayScore = toIntegerOrNull(item?.awayScore);
  const statusShort = normalizeZafronixStatus(item?.status, homeScore, awayScore);
  const kickoffDate = parseZafronixKickoff(item);
  const kickoffMs = kickoffDate.getTime();
  const result = isSub2ApiWorldCupApiStatusFinal(statusShort) && homeScore !== null && awayScore !== null
    ? getSub2ApiWorldCupResult(homeScore, awayScore)
    : null;

  let status = sub2apiWorldCupMatchStatuses.open;
  if (isSub2ApiWorldCupApiStatusFinal(statusShort)) {
    status = sub2apiWorldCupMatchStatuses.finished;
  } else if (isSub2ApiWorldCupApiStatusCancelled(statusShort)) {
    status = sub2apiWorldCupMatchStatuses.cancelled;
  } else if (isSub2ApiWorldCupApiStatusLive(statusShort)) {
    status = sub2apiWorldCupMatchStatuses.locked;
  } else if (Number.isFinite(kickoffMs) && kickoffMs <= nowMs) {
    status = sub2apiWorldCupMatchStatuses.locked;
  }

  return {
    apiFixtureId: String(item?.id || ""),
    source: "zafronix",
    apiLeagueId: null,
    apiSeason: toIntegerOrNull(item?.year) || null,
    stage: localizeWorldCupStageName(item?.stage || item?.group),
    groupName: localizeWorldCupGroupName(item?.group),
    homeTeam: localizeWorldCupTeamName(item?.homeTeam || item?.home || item?.homeRef, "待定主队"),
    awayTeam: localizeWorldCupTeamName(item?.awayTeam || item?.away || item?.awayRef, "待定客队"),
    kickoffAt: Number.isFinite(kickoffMs) ? kickoffDate.toISOString() : "",
    status,
    apiStatusShort: statusShort,
    apiStatusLong: String(item?.status || ""),
    apiElapsed: null,
    homeScore,
    awayScore,
    result
  };
}

function normalizeOddsChoice(value, homeTeam = "", awayTeam = "") {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return "";
  const home = String(homeTeam || "").trim().toLowerCase();
  const away = String(awayTeam || "").trim().toLowerCase();
  if (["home", "1"].includes(normalized) || normalized === home) return "home";
  if (["draw", "x"].includes(normalized)) return "draw";
  if (["away", "2"].includes(normalized) || normalized === away) return "away";
  return "";
}

function normalizeOdd(value) {
  const number = Number(String(value ?? "").replace(",", "."));
  if (!Number.isFinite(number) || number < 1 || number > 50) return null;
  return roundSub2ApiWorldCupAmount(number);
}

export function parseApiFootballMatchWinnerOdds(payload, {
  homeTeam = "",
  awayTeam = ""
} = {}) {
  const items = Array.isArray(payload?.response) ? payload.response : [];
  for (const item of items) {
    const bookmakers = Array.isArray(item.bookmakers) ? item.bookmakers : [];
    for (const bookmaker of bookmakers) {
      const bets = Array.isArray(bookmaker.bets) ? bookmaker.bets : [];
      for (const bet of bets) {
        const betName = String(bet.name || "").toLowerCase();
        if (bet.id !== 1 && !betName.includes("match winner") && !betName.includes("winner")) {
          continue;
        }
        const odds = {};
        for (const value of Array.isArray(bet.values) ? bet.values : []) {
          const choice = normalizeOddsChoice(value.value, homeTeam, awayTeam);
          const odd = normalizeOdd(value.odd);
          if (choice && odd !== null) odds[choice] = odd;
        }
        if (odds.home && odds.draw && odds.away) {
          return {
            home: odds.home,
            draw: odds.draw,
            away: odds.away,
            bookmaker: bookmaker.name || "",
            betName: bet.name || "",
            updatedAt: item.update || item.fixture?.date || ""
          };
        }
      }
    }
  }
  return null;
}
