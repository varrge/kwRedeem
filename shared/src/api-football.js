import { randomUUID } from "node:crypto";
import { env } from "./env.js";
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

function nowIso() {
  return new Date().toISOString();
}

function toIntegerOrNull(value) {
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

function normalizeApiFootballLimit(value, fallback) {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

export function getApiFootballUsageDate(date = new Date(), timezone = env.apiFootballTimezone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone || "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function getApiFootballQuotaSnapshot(db, {
  date = getApiFootballUsageDate(),
  softLimit = env.apiFootballDailySoftLimit,
  hardLimit = env.apiFootballDailyHardLimit
} = {}) {
  const soft = normalizeApiFootballLimit(softLimit, 80);
  const hard = Math.max(soft, normalizeApiFootballLimit(hardLimit, 100));
  const row = db.prepare("SELECT * FROM api_football_daily_usage WHERE usage_date = ?").get(date);
  const used = Number(row?.used || 0);
  return {
    date,
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
  softLimit = env.apiFootballDailySoftLimit,
  hardLimit = env.apiFootballDailyHardLimit
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

export function buildApiFootballUrl(endpoint, params = {}, baseUrl = env.apiFootballBaseUrl) {
  const normalizedBase = String(baseUrl || "https://v3.football.api-sports.io").replace(/\/+$/, "");
  const normalizedEndpoint = `/${String(endpoint || "").replace(/^\/+/, "")}`;
  const url = new URL(`${normalizedBase}${normalizedEndpoint}`);
  for (const [key, value] of Object.entries(params || {})) {
    if (value === undefined || value === null || value === "") continue;
    url.searchParams.set(key, String(value));
  }
  return url;
}

export async function fetchApiFootballJson(db, endpoint, params = {}, {
  priority = "normal",
  timeoutMs = DEFAULT_TIMEOUT_MS,
  apiKey = env.apiFootballKey,
  baseUrl = env.apiFootballBaseUrl
} = {}) {
  if (!apiKey) {
    const error = new Error("未配置 API_FOOTBALL_KEY，跳过 API-Football 同步");
    error.code = "API_FOOTBALL_KEY_MISSING";
    throw error;
  }

  const reservation = reserveApiFootballRequest(db, { endpoint, params, priority });
  const url = buildApiFootballUrl(endpoint, params, baseUrl);
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "x-apisports-key": apiKey
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

export async function fetchApiFootballWorldCupFixtures(db, {
  next = null,
  fixtureId = null,
  priority = "normal"
} = {}) {
  const params = {
    league: env.apiFootballWorldCupLeagueId,
    season: env.apiFootballWorldCupSeason,
    timezone: env.apiFootballTimezone
  };
  if (next) params.next = next;
  if (fixtureId) params.id = fixtureId;
  return fetchApiFootballJson(db, "/fixtures", params, { priority });
}

export async function fetchApiFootballWorldCupOdds(db, {
  fixtureId,
  priority = "normal"
} = {}) {
  const params = {
    league: env.apiFootballWorldCupLeagueId,
    season: env.apiFootballWorldCupSeason,
    fixture: fixtureId
  };
  return fetchApiFootballJson(db, "/odds", params, { priority });
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
  } else if (Number.isFinite(kickoffMs) && kickoffMs - nowMs <= 60 * 60 * 1000) {
    status = sub2apiWorldCupMatchStatuses.locked;
  }

  return {
    apiFixtureId: String(fixture.id || ""),
    apiLeagueId: toIntegerOrNull(league.id),
    apiSeason: toIntegerOrNull(league.season),
    stage: String(league.round || ""),
    groupName: "",
    homeTeam: String(teams.home?.name || ""),
    awayTeam: String(teams.away?.name || ""),
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
