import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import { getDb } from "../../shared/src/database.js";
import { env, resolveProjectPath } from "../../shared/src/env.js";
import { normalizeSourceKey } from "../../shared/src/cdkey-utils.js";
import { extractSmsVerificationCode } from "../../shared/src/sms-code.js";
import { decryptText } from "../../shared/src/secure.js";
import { encodeRequestBody, evaluateRule, renderJsonTemplate, renderTemplateString, safeParseJson } from "../../shared/src/templates.js";
import { cdkeyStatuses, endpointTypes, jobStatuses, logActions, notificationEventTypes, orderStatuses } from "../../shared/src/constants.js";
import { getNumber, getStatus, setStatus } from "../../shared/src/fivesim-client.js";
import {
  fetchApiFootballWorldCupFixtures,
  fetchFootballDataWorldCupMatches,
  fetchZafronixWorldCupMatches,
  fetchApiFootballWorldCupLiveOdds,
  fetchApiFootballWorldCupOdds,
  getApiFootballQuotaSnapshot,
  getApiFootballSettings,
  getApiFootballUsageDate,
  parseApiFootballFixture,
  parseFootballDataMatch,
  parseZafronixMatch,
  parseApiFootballMatchWinnerOdds
} from "../../shared/src/api-football.js";
import {
  isSub2ApiWorldCupApiStatusFinal,
  isSub2ApiWorldCupApiStatusHalftime,
  isSub2ApiWorldCupApiStatusLive,
  roundSub2ApiWorldCupAmount,
  sub2apiConnectionStatuses,
  sub2apiWorldCupBetStatuses,
  sub2apiWorldCupMatchStatuses
} from "../../shared/src/sub2api.js";
import {
  buildFeishuMarkdown,
  clampIntervalSeconds,
  evaluateMonitorRules,
  fetchMonitorEndpoint,
  normalizeWatchFields,
  sendFeishuMarkdown,
  summarizeResponseInfo
} from "../../shared/src/notifications.js";
import { getAvailableQuota } from "../../shared/src/quota-calc.js";
import { createStoreFulfillmentRunner } from "../../shared/src/store-fulfillment-runner.js";

const db = getDb();
const workerId = `worker-${process.pid}`;
const BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36";
const maintenancePath = resolveProjectPath(env.maintenancePath);
const storeFulfillmentRunner = createStoreFulfillmentRunner({
  db,
  redeemUrl: env.appUrl,
  workerId
});

function isMaintenanceEnabled() {
  return fs.existsSync(maintenancePath);
}

function nowIso() {
  return new Date().toISOString();
}

function addSeconds(dateString, seconds) {
  const date = new Date(dateString);
  date.setSeconds(date.getSeconds() + seconds);
  return date.toISOString();
}

function writeAuditLog(action, resourceType, resourceId, detail) {
  db.prepare(`
    INSERT INTO admin_audit_logs (id, action, actor, resource_type, resource_id, detail, created_at)
    VALUES (lower(hex(randomblob(8))), ?, 'worker', ?, ?, ?, ?)
  `).run(action, resourceType, resourceId, detail ? JSON.stringify(detail) : null, nowIso());
}

const WORLDCUP_DISCOVERY_INTERVAL_MS = 6 * 60 * 60 * 1000;
const WORLDCUP_INTERNAL_TIMEOUT_MS = 30 * 1000;
const WORLDCUP_TRACKED_FIXTURE_LIMIT = 12;
const WORLDCUP_UPCOMING_ODDS_LIMIT = 2;
const WORLDCUP_ZAFRONIX_ACTIVE_LIMIT = 3;
const WORLDCUP_ZAFRONIX_IDLE_LIMIT = 2;
const WORLDCUP_ZAFRONIX_ACTIVE_BEFORE_MS = 60 * 60 * 1000;
const WORLDCUP_ZAFRONIX_ACTIVE_AFTER_MS = 4 * 60 * 60 * 1000;
const WORLDCUP_SPORTTERY_MATCH_ODDS_URL = "https://webapi.sporttery.cn/gateway/uniform/football/getMatchListV1.qry?clientCode=3001";
const WORLDCUP_SPORTTERY_DRAW_ODDS_URL = "https://webapi.sporttery.cn/gateway/lottery/getFootBallMatchV1.qry?param=90%2C0&lotteryDrawNum=&sellStatus=0&termLimits=10";
const WORLDCUP_ESPN_SCOREBOARD_URL = "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard";
let worldCupSyncRunning = false;
let worldCupLastDiscoveryAt = 0;
let worldCupLastDiscoveryDate = "";
let worldCupLastTickAt = 0;
let worldCupMissingKeyLogged = false;
let worldCupDisabledLogged = false;

function parseTimeMs(value) {
  const ms = new Date(value || "").getTime();
  return Number.isFinite(ms) ? ms : 0;
}

const BEIJING_DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

const WORLDCUP_ODDS_TEAM_ALIASES = new Map(Object.entries({
  algeria: "阿尔及利亚",
  argentina: "阿根廷",
  austria: "奥地利",
  brazil: "巴西",
  canada: "加拿大",
  "刚果": "刚果金",
  congo: "刚果金",
  croatia: "克罗地亚",
  drcongo: "刚果金",
  congodr: "刚果金",
  democraticrepublicofthecongo: "刚果金",
  qatar: "卡塔尔",
  mexico: "墨西哥",
  england: "英格兰",
  france: "法国",
  iraq: "伊拉克",
  jordan: "约旦",
  norway: "挪威",
  portugal: "葡萄牙",
  senegal: "塞内加尔",
  korearepublic: "韩国",
  southkorea: "韩国"
}));

function getBeijingDateKey(value) {
  const date = new Date(value || "");
  if (!Number.isFinite(date.getTime())) return "";
  const parts = Object.fromEntries(
    BEIJING_DATE_FORMATTER.formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function addMinutesIso(value, minutes) {
  const ms = parseTimeMs(value);
  if (!ms) return null;
  return new Date(ms + Number(minutes || 0) * 60 * 1000).toISOString();
}

function getWorldCupAddedMinutes(parsedFixture, fallback = 0) {
  const elapsed = Number(parsedFixture?.apiElapsed);
  if (!Number.isFinite(elapsed)) return fallback;
  if (elapsed > 45 && elapsed < 70) return Math.max(0, Math.round(elapsed - 45));
  if (elapsed > 90 && elapsed < 130) return Math.max(0, Math.round(elapsed - 90));
  return fallback;
}

function normalizeWorldCupMatchName(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[（(].*?[）)]/g, "")
    .replace(/[\s_\-·.。]+/g, "")
    .replace(/[^\p{Script=Han}a-z0-9]/gu, "");
  return WORLDCUP_ODDS_TEAM_ALIASES.get(normalized) || normalized;
}

function buildWorldCupMatchKey(date, homeTeam, awayTeam) {
  return [
    date,
    normalizeWorldCupMatchName(homeTeam),
    normalizeWorldCupMatchName(awayTeam)
  ].join("|");
}

function formatCompactUtcDate(value) {
  const date = new Date(value || "");
  if (!Number.isFinite(date.getTime())) return "";
  return date.toISOString().slice(0, 10).replace(/-/g, "");
}

function randomWorldCupId() {
  return randomBytes(8).toString("hex");
}

function isApiFootballLimitError(error) {
  return ["API_FOOTBALL_SOFT_LIMIT", "API_FOOTBALL_HARD_LIMIT"].includes(error?.code);
}

function logApiFootballSyncError(scope, error) {
  if (error?.code === "API_FOOTBALL_KEY_MISSING") {
    if (!worldCupMissingKeyLogged) {
      console.warn(`[KaWang worker] worldcup: ${error.message}`);
      worldCupMissingKeyLogged = true;
    }
    return;
  }
  if (isApiFootballLimitError(error)) {
    console.warn(`[KaWang worker] worldcup ${scope}: ${error.message}`);
    return;
  }
  console.error(`[KaWang worker] worldcup ${scope}:`, error.message || error);
}

function getWorldCupRequestPriority(settings, urgent = false) {
  if (!urgent) return "normal";
  const usage = getApiFootballQuotaSnapshot(db, {
    timezone: settings.timezone,
    softLimit: settings.dailySoftLimit,
    hardLimit: settings.dailyHardLimit
  });
  return usage.used >= usage.softLimit ? "emergency" : "normal";
}

function getActiveSub2ApiConnections() {
  return db.prepare(`
    SELECT id, name
    FROM sub2api_connections
    WHERE status = ?
    ORDER BY created_at ASC
  `).all(sub2apiConnectionStatuses.active);
}

function upsertApiFootballWorldCupFixture(parsedFixture, connections) {
  if (!parsedFixture?.apiFixtureId || !parsedFixture.homeTeam || !parsedFixture.awayTeam || !parsedFixture.kickoffAt) {
    return 0;
  }
  const now = nowIso();
  const source = parsedFixture.source || "api-football";
  const displayDate = getBeijingDateKey(parsedFixture.kickoffAt);
  const sync = db.transaction(() => {
    let count = 0;
    for (const connection of connections) {
      const existing = db.prepare(`
        SELECT *
        FROM sub2api_worldcup_matches
        WHERE connection_id = ?
          AND api_fixture_id = ?
          AND source = ?
      `).get(connection.id, parsedFixture.apiFixtureId, source);

      const terminalStatus = existing && [
        sub2apiWorldCupMatchStatuses.settled,
        sub2apiWorldCupMatchStatuses.cancelled
      ].includes(existing.status);
      const nextStatus = terminalStatus ? existing.status : parsedFixture.status;
      const halftimeSyncedAt = parsedFixture.apiStatusShort === "HT" ? now : null;

      if (existing) {
        db.prepare(`
          UPDATE sub2api_worldcup_matches
          SET stage = ?,
              group_name = ?,
              home_team = ?,
              away_team = ?,
              kickoff_at = ?,
              status = ?,
              home_score = ?,
              away_score = ?,
              result = ?,
              source = ?,
              api_league_id = ?,
              api_season = ?,
              api_status_short = ?,
              api_status_long = ?,
              api_elapsed = ?,
              api_last_synced_at = ?,
              display_date = ?,
              halftime_betting_opened_at = CASE
                WHEN ? IS NOT NULL AND halftime_betting_opened_at IS NULL THEN ?
                ELSE halftime_betting_opened_at
              END,
              updated_at = ?
          WHERE id = ?
        `).run(
          parsedFixture.stage || existing.stage || null,
          parsedFixture.groupName || existing.group_name || null,
          parsedFixture.homeTeam,
          parsedFixture.awayTeam,
          parsedFixture.kickoffAt,
          nextStatus,
          parsedFixture.homeScore,
          parsedFixture.awayScore,
          parsedFixture.result,
          source,
          parsedFixture.apiLeagueId,
          parsedFixture.apiSeason,
          parsedFixture.apiStatusShort || null,
          parsedFixture.apiStatusLong || null,
          parsedFixture.apiElapsed,
          now,
          displayDate || existing.display_date || null,
          halftimeSyncedAt,
          halftimeSyncedAt,
          now,
          existing.id
        );
      } else {
        db.prepare(`
          INSERT INTO sub2api_worldcup_matches (
            id, connection_id, stage, group_name, home_team, away_team, kickoff_at, status,
            home_score, away_score, result, odds_home, odds_draw, odds_away, min_stake,
            max_stake, note, source, api_fixture_id, api_league_id, api_season,
            api_status_short, api_status_long, api_elapsed, api_last_synced_at,
            odds_last_synced_at, halftime_betting_opened_at, display_date, auto_settle_attempted_at,
            created_at, updated_at, settled_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1.8, 3.2, 1.8, 0.1, 2, NULL,
                  ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL, ?, ?, NULL)
        `).run(
          randomWorldCupId(),
          connection.id,
          parsedFixture.stage || null,
          parsedFixture.groupName || null,
          parsedFixture.homeTeam,
          parsedFixture.awayTeam,
          parsedFixture.kickoffAt,
          nextStatus,
          parsedFixture.homeScore,
          parsedFixture.awayScore,
          parsedFixture.result,
          source,
          parsedFixture.apiFixtureId,
          parsedFixture.apiLeagueId,
          parsedFixture.apiSeason,
          parsedFixture.apiStatusShort || null,
          parsedFixture.apiStatusLong || null,
          parsedFixture.apiElapsed,
          now,
          halftimeSyncedAt,
          displayDate || null,
          now,
          now
        );
      }
      count += 1;
    }
    return count;
  });
  return sync();
}

function updateApiFootballWorldCupOdds(apiFixtureId, odds, source = "api-football") {
  if (!apiFixtureId || !odds?.home || !odds?.draw || !odds?.away) return 0;
  const now = nowIso();
  const result = db.prepare(`
    UPDATE sub2api_worldcup_matches
    SET odds_home = ?,
        odds_draw = ?,
        odds_away = ?,
        odds_last_synced_at = ?,
        updated_at = ?
    WHERE api_fixture_id = ?
      AND source = ?
      AND status NOT IN (?, ?)
  `).run(
    roundSub2ApiWorldCupAmount(odds.home),
    roundSub2ApiWorldCupAmount(odds.draw),
    roundSub2ApiWorldCupAmount(odds.away),
    now,
    now,
    apiFixtureId,
    source,
    sub2apiWorldCupMatchStatuses.settled,
    sub2apiWorldCupMatchStatuses.cancelled
  );
  return result.changes || 0;
}

function markApiFootballWorldCupOddsAttempt(apiFixtureId, source = "api-football") {
  if (!apiFixtureId) return 0;
  const now = nowIso();
  const result = db.prepare(`
    UPDATE sub2api_worldcup_matches
    SET odds_last_synced_at = ?,
        updated_at = ?
    WHERE api_fixture_id = ?
      AND source = ?
      AND status NOT IN (?, ?)
  `).run(
    now,
    now,
    apiFixtureId,
    source,
    sub2apiWorldCupMatchStatuses.settled,
    sub2apiWorldCupMatchStatuses.cancelled
  );
  return result.changes || 0;
}

function isZafronixMatchFinalOrCancelled(match) {
  return isSub2ApiWorldCupApiStatusFinal(match?.apiStatusShort)
    || match?.status === sub2apiWorldCupMatchStatuses.cancelled;
}

function isZafronixMatchInActiveWindow(match, nowMs) {
  if (!match?.kickoffAt || match.status === sub2apiWorldCupMatchStatuses.cancelled) return false;
  if (isSub2ApiWorldCupApiStatusLive(match.apiStatusShort)) return true;
  const kickoffMs = parseTimeMs(match.kickoffAt);
  if (!kickoffMs) return false;
  return kickoffMs - nowMs <= WORLDCUP_ZAFRONIX_ACTIVE_BEFORE_MS
    && nowMs - kickoffMs <= WORLDCUP_ZAFRONIX_ACTIVE_AFTER_MS;
}

function getPinnedZafronixWorldCupFixtureIds() {
  return new Set(db.prepare(`
    SELECT DISTINCT m.api_fixture_id
    FROM sub2api_worldcup_matches m
    WHERE m.source = 'zafronix'
      AND m.api_fixture_id IS NOT NULL
      AND m.status NOT IN (?, ?)
      AND EXISTS (
        SELECT 1
        FROM sub2api_worldcup_bets b
        WHERE b.match_id = m.id
          AND b.status IN (?, ?, ?)
      )
  `).all(
    sub2apiWorldCupMatchStatuses.settled,
    sub2apiWorldCupMatchStatuses.cancelled,
    sub2apiWorldCupBetStatuses.placed,
    sub2apiWorldCupBetStatuses.payoutFailed,
    sub2apiWorldCupBetStatuses.refundFailed
  ).map((row) => String(row.api_fixture_id)));
}

function extractZafronixMatchItems(json) {
  if (Array.isArray(json)) return json;
  if (Array.isArray(json?.data)) return json.data;
  if (Array.isArray(json?.items)) return json.items;
  if (Array.isArray(json?.matches)) return json.matches;
  if (Array.isArray(json?.fixtures)) return json.fixtures;
  if (Array.isArray(json?.data?.matches)) return json.data.matches;
  if (Array.isArray(json?.data?.items)) return json.data.items;
  return [];
}

function selectZafronixWorldCupMatches(matches, nowMs, pinnedFixtureIds = new Set()) {
  const validMatches = matches
    .filter((match) => match?.apiFixtureId && match.kickoffAt && parseTimeMs(match.kickoffAt))
    .sort((left, right) => parseTimeMs(left.kickoffAt) - parseTimeMs(right.kickoffAt));

  const pinnedMatches = validMatches.filter((match) => pinnedFixtureIds.has(match.apiFixtureId));
  const activeMatches = validMatches
    .filter((match) => !isZafronixMatchFinalOrCancelled(match) && isZafronixMatchInActiveWindow(match, nowMs))
    .slice(0, WORLDCUP_ZAFRONIX_ACTIVE_LIMIT);
  if (activeMatches.length) {
    const selected = new Map(pinnedMatches.map((match) => [match.apiFixtureId, match]));
    for (const match of activeMatches) selected.set(match.apiFixtureId, match);
    for (const match of validMatches) {
      if (selected.size >= pinnedMatches.length + WORLDCUP_ZAFRONIX_ACTIVE_LIMIT) break;
      if (selected.has(match.apiFixtureId)) continue;
      if (isZafronixMatchFinalOrCancelled(match) || parseTimeMs(match.kickoffAt) < nowMs) continue;
      selected.set(match.apiFixtureId, match);
    }
    return [...selected.values()];
  }

  const idleMatches = validMatches
    .filter((match) => !isZafronixMatchFinalOrCancelled(match) && parseTimeMs(match.kickoffAt) >= nowMs)
    .slice(0, WORLDCUP_ZAFRONIX_IDLE_LIMIT);
  const selected = new Map(pinnedMatches.map((match) => [match.apiFixtureId, match]));
  for (const match of idleMatches) selected.set(match.apiFixtureId, match);
  return [...selected.values()];
}

function pruneUnselectedZafronixWorldCupMatches(selectedFixtureIds) {
  if (!selectedFixtureIds.length) {
    const result = db.prepare(`
      DELETE FROM sub2api_worldcup_matches
      WHERE source = 'zafronix'
        AND NOT EXISTS (
          SELECT 1
          FROM sub2api_worldcup_bets b
          WHERE b.match_id = sub2api_worldcup_matches.id
        )
    `).run();
    return result.changes || 0;
  }
  const placeholders = selectedFixtureIds.map(() => "?").join(", ");
  const result = db.prepare(`
    DELETE FROM sub2api_worldcup_matches
    WHERE source = 'zafronix'
      AND api_fixture_id NOT IN (${placeholders})
      AND NOT EXISTS (
        SELECT 1
        FROM sub2api_worldcup_bets b
        WHERE b.match_id = sub2api_worldcup_matches.id
      )
  `).run(...selectedFixtureIds);
  return result.changes || 0;
}

function pruneLegacyWorldCupProviderMatches() {
  const result = db.prepare(`
    DELETE FROM sub2api_worldcup_matches
    WHERE source IN ('api-football', 'football-data')
      AND NOT EXISTS (
        SELECT 1
        FROM sub2api_worldcup_bets b
        WHERE b.match_id = sub2api_worldcup_matches.id
      )
  `).run();
  return result.changes || 0;
}

async function discoverApiFootballWorldCupFixtures(connections, nowMs, settings) {
  if (settings.provider === "zafronix") {
    const stats = { requests: 0, fixturesReturned: 0, fixturesSeen: 0, rowsSynced: 0, rowsPruned: 0 };
    try {
      stats.requests += 1;
      const response = await fetchZafronixWorldCupMatches(db, { priority: "normal", settings });
      const items = extractZafronixMatchItems(response?.json);
      stats.fixturesReturned = items.length;
      const selectedMatches = items
        .map((item) => parseZafronixMatch(item, nowMs))
        .filter((match) => match?.apiFixtureId && match.kickoffAt && parseTimeMs(match.kickoffAt));
      stats.rowsPruned = pruneLegacyWorldCupProviderMatches();
      const seen = new Set();
      let synced = 0;
      for (const match of selectedMatches) {
        if (!match.apiFixtureId || seen.has(match.apiFixtureId)) continue;
        seen.add(match.apiFixtureId);
        synced += upsertApiFootballWorldCupFixture(match, connections);
      }
      stats.fixturesSeen = seen.size;
      stats.rowsSynced = synced;
      worldCupLastDiscoveryAt = nowMs;
      worldCupLastDiscoveryDate = getApiFootballUsageDate(new Date(nowMs), settings.timezone || "Asia/Shanghai");
      if (synced > 0) {
        console.log(`[KaWang worker] worldcup: synced ${seen.size} Zafronix matches for ${connections.length} Sub2api connections`);
      }
    } catch (error) {
      logApiFootballSyncError("zafronix discovery", error);
      if (error?.code === "API_FOOTBALL_HARD_LIMIT") throw error;
    }
    return stats;
  }

  if (settings.provider === "football-data") {
    const stats = { requests: 0, fixturesReturned: 0, fixturesSeen: 0, rowsSynced: 0 };
    try {
      stats.requests += 1;
      const response = await fetchFootballDataWorldCupMatches(db, { priority: "normal", settings });
      const items = Array.isArray(response?.json?.matches) ? response.json.matches : [];
      stats.fixturesReturned = items.length;
      const seen = new Set();
      let synced = 0;
      for (const item of items) {
        const parsed = parseFootballDataMatch(item, nowMs);
        if (!parsed.apiFixtureId || seen.has(parsed.apiFixtureId)) continue;
        seen.add(parsed.apiFixtureId);
        synced += upsertApiFootballWorldCupFixture(parsed, connections);
      }
      stats.fixturesSeen = seen.size;
      stats.rowsSynced = synced;
      worldCupLastDiscoveryAt = nowMs;
      worldCupLastDiscoveryDate = getApiFootballUsageDate(new Date(nowMs), settings.timezone || "Asia/Shanghai");
      if (synced > 0) {
        console.log(`[KaWang worker] worldcup: synced ${seen.size} Football-Data matches for ${connections.length} Sub2api connections`);
      }
    } catch (error) {
      logApiFootballSyncError("football-data discovery", error);
      if (error?.code === "API_FOOTBALL_HARD_LIMIT") throw error;
    }
    return stats;
  }

  const today = getApiFootballUsageDate(new Date(nowMs), settings.timezone);
  const requests = [
    { priority: "normal" },
    { next: 3, priority: "normal" },
    { date: today, priority: "normal" }
  ];
  const seen = new Set();
  const stats = { requests: 0, fixturesReturned: 0, fixturesSeen: 0, rowsSynced: 0 };
  let synced = 0;
  for (const request of requests) {
    try {
      stats.requests += 1;
      const response = await fetchApiFootballWorldCupFixtures(db, { ...request, settings });
      const items = Array.isArray(response?.json?.response) ? response.json.response : [];
      stats.fixturesReturned += items.length;
      for (const item of items) {
        const parsed = parseApiFootballFixture(item, nowMs);
        if (!parsed.apiFixtureId || seen.has(parsed.apiFixtureId)) continue;
        seen.add(parsed.apiFixtureId);
        synced += upsertApiFootballWorldCupFixture(parsed, connections);
      }
    } catch (error) {
      logApiFootballSyncError("discovery", error);
      if (error?.code === "API_FOOTBALL_HARD_LIMIT") break;
    }
  }
  worldCupLastDiscoveryAt = nowMs;
  worldCupLastDiscoveryDate = getApiFootballUsageDate(new Date(nowMs), settings.timezone || "Asia/Shanghai");
  stats.fixturesSeen = seen.size;
  stats.rowsSynced = synced;
  if (synced > 0) {
    console.log(`[KaWang worker] worldcup: synced ${seen.size} fixtures for ${connections.length} Sub2api connections`);
  }
  return stats;
}

function getTrackedApiFootballFixtures() {
  return db.prepare(`
    SELECT api_fixture_id,
           MIN(kickoff_at) AS kickoff_at,
           MAX(api_status_short) AS api_status_short,
           MAX(api_last_synced_at) AS api_last_synced_at
    FROM sub2api_worldcup_matches
    WHERE source = 'api-football'
      AND api_fixture_id IS NOT NULL
      AND status NOT IN (?, ?)
    GROUP BY api_fixture_id
    ORDER BY datetime(kickoff_at) ASC
    LIMIT ?
  `).all(
    sub2apiWorldCupMatchStatuses.settled,
    sub2apiWorldCupMatchStatuses.cancelled,
    WORLDCUP_TRACKED_FIXTURE_LIMIT
  );
}

function shouldRefreshApiFootballFixture(row, nowMs) {
  const apiStatus = String(row.api_status_short || "").toUpperCase();
  if (isSub2ApiWorldCupApiStatusFinal(apiStatus)) return false;

  const kickoffMs = parseTimeMs(row.kickoff_at);
  if (!kickoffMs) return false;
  const lastMs = parseTimeMs(row.api_last_synced_at);
  if (!lastMs) return true;

  const untilKickoff = kickoffMs - nowMs;
  const sinceKickoff = nowMs - kickoffMs;
  const sinceLast = nowMs - lastMs;

  if (untilKickoff > 24 * 60 * 60 * 1000) return false;
  if (untilKickoff > 2 * 60 * 60 * 1000) return sinceLast >= 6 * 60 * 60 * 1000;
  if (untilKickoff > -10 * 60 * 1000) return sinceLast >= 15 * 60 * 1000;
  if (isSub2ApiWorldCupApiStatusHalftime(apiStatus)) return sinceLast >= 2 * 60 * 1000;
  if (isSub2ApiWorldCupApiStatusLive(apiStatus)) return sinceLast >= 10 * 60 * 1000;
  if (sinceKickoff <= 3 * 60 * 60 * 1000) return sinceLast >= 5 * 60 * 1000;
  if (sinceKickoff <= 24 * 60 * 60 * 1000) return sinceLast >= 30 * 60 * 1000;
  return false;
}

function isUrgentApiFootballFixtureRefresh(row, nowMs) {
  const apiStatus = String(row.api_status_short || "").toUpperCase();
  const kickoffMs = parseTimeMs(row.kickoff_at);
  if (!kickoffMs) return false;
  return isSub2ApiWorldCupApiStatusHalftime(apiStatus)
    || (nowMs - kickoffMs >= 35 * 60 * 1000 && nowMs - kickoffMs <= 75 * 60 * 1000)
    || (nowMs - kickoffMs >= 105 * 60 * 1000 && nowMs - kickoffMs <= 4 * 60 * 60 * 1000);
}

async function syncApiFootballFixtureById(apiFixtureId, connections, nowMs, settings, priority = "normal") {
  const response = await fetchApiFootballWorldCupFixtures(db, { fixtureId: apiFixtureId, priority, settings });
  const item = Array.isArray(response?.json?.response) ? response.json.response[0] : null;
  if (!item) return null;
  const parsed = parseApiFootballFixture(item, nowMs);
  upsertApiFootballWorldCupFixture(parsed, connections);
  return parsed;
}

async function syncApiFootballHalftimeOdds(parsedFixture, priority, settings) {
  if (!parsedFixture?.apiFixtureId || parsedFixture.apiStatusShort !== "HT") return { attempted: 0, updated: 0 };
  const row = db.prepare(`
    SELECT MAX(odds_last_synced_at) AS odds_last_synced_at
    FROM sub2api_worldcup_matches
    WHERE api_fixture_id = ?
      AND source = 'api-football'
  `).get(parsedFixture.apiFixtureId);
  if (parseTimeMs(row?.odds_last_synced_at) && Date.now() - parseTimeMs(row.odds_last_synced_at) < 2 * 60 * 1000) {
    return { attempted: 0, updated: 0 };
  }
  try {
    const response = await fetchApiFootballWorldCupLiveOdds(db, {
      fixtureId: parsedFixture.apiFixtureId,
      priority,
      settings
    });
    const odds = parseApiFootballMatchWinnerOdds(response.json, {
      homeTeam: parsedFixture.homeTeam,
      awayTeam: parsedFixture.awayTeam
    });
    if (odds) {
      return { attempted: 1, updated: updateApiFootballWorldCupOdds(parsedFixture.apiFixtureId, odds) };
    } else {
      markApiFootballWorldCupOddsAttempt(parsedFixture.apiFixtureId);
      return { attempted: 1, updated: 0 };
    }
  } catch (error) {
    logApiFootballSyncError("live-odds", error);
    if (!isApiFootballLimitError(error)) {
      markApiFootballWorldCupOddsAttempt(parsedFixture.apiFixtureId);
    }
    return { attempted: 1, updated: 0, failed: 1 };
  }
}

async function syncTrackedApiFootballWorldCupFixtures(connections, nowMs, settings) {
  const rows = getTrackedApiFootballFixtures().filter((row) => shouldRefreshApiFootballFixture(row, nowMs));
  const stats = { targets: rows.length, refreshed: 0, halftimeOddsAttempted: 0, halftimeOddsUpdated: 0, failed: 0 };
  for (const row of rows) {
    const urgent = isUrgentApiFootballFixtureRefresh(row, nowMs);
    const priority = getWorldCupRequestPriority(settings, urgent);
    try {
      const parsed = await syncApiFootballFixtureById(row.api_fixture_id, connections, nowMs, settings, priority);
      if (parsed) stats.refreshed += 1;
      const oddsStats = await syncApiFootballHalftimeOdds(parsed, getWorldCupRequestPriority(settings, true), settings);
      stats.halftimeOddsAttempted += oddsStats?.attempted || 0;
      stats.halftimeOddsUpdated += oddsStats?.updated || 0;
    } catch (error) {
      stats.failed += 1;
      logApiFootballSyncError(`fixture ${row.api_fixture_id}`, error);
      if (error?.code === "API_FOOTBALL_HARD_LIMIT") break;
    }
  }
  return stats;
}

async function refreshWorldCupFixtureById(row, connections, nowMs, settings, priority = "emergency") {
  if (!row?.api_fixture_id) return null;
  if (settings.provider === "api-football") {
    return await syncApiFootballFixtureById(row.api_fixture_id, connections, nowMs, settings, priority);
  }
  if (settings.provider === "football-data") {
    const response = await fetchFootballDataWorldCupMatches(db, { priority, settings });
    const items = Array.isArray(response?.json?.matches) ? response.json.matches : [];
    const item = items.find((candidate) => String(candidate?.id || "") === String(row.api_fixture_id));
    if (!item) return null;
    const parsed = parseFootballDataMatch(item, nowMs);
    upsertApiFootballWorldCupFixture(parsed, connections);
    return parsed;
  }
  if (settings.provider === "zafronix") {
    const response = await fetchZafronixWorldCupMatches(db, { priority, settings });
    const items = extractZafronixMatchItems(response?.json);
    const item = items.find((candidate) => String(candidate?.id || "") === String(row.api_fixture_id));
    if (!item) return null;
    const parsed = parseZafronixMatch(item, nowMs);
    upsertApiFootballWorldCupFixture(parsed, connections);
    return parsed;
  }
  return null;
}

async function checkWorldCupHalftimeWindows(connections, nowMs, settings) {
  const now = new Date(nowMs).toISOString();
  const rows = db.prepare(`
    SELECT api_fixture_id,
           MIN(kickoff_at) AS kickoff_at,
           MIN(source) AS source,
           MAX(halftime_schedule_checked_at) AS halftime_schedule_checked_at
    FROM sub2api_worldcup_matches
    WHERE source IN ('api-football', 'football-data', 'zafronix')
      AND api_fixture_id IS NOT NULL
      AND status NOT IN (?, ?, ?)
      AND halftime_open_at IS NULL
      AND datetime(kickoff_at, '+45 minutes') <= datetime(?)
    GROUP BY api_fixture_id
    ORDER BY datetime(kickoff_at) ASC
    LIMIT 10
  `).all(
    sub2apiWorldCupMatchStatuses.finished,
    sub2apiWorldCupMatchStatuses.settled,
    sub2apiWorldCupMatchStatuses.cancelled,
    now
  );

  const stats = { targets: rows.length, checked: 0, opened: 0, failed: 0 };
  for (const row of rows) {
    try {
      const parsed = await refreshWorldCupFixtureById(row, connections, nowMs, settings, getWorldCupRequestPriority(settings, true));
      const addedMinutes = getWorldCupAddedMinutes(parsed, 0);
      const halftimeOpenAt = addMinutesIso(row.kickoff_at, 45 + addedMinutes);
      const halftimeCloseAt = addMinutesIso(halftimeOpenAt, 15);
      const checkedAt = nowIso();
      const result = db.prepare(`
        UPDATE sub2api_worldcup_matches
        SET first_half_added_minutes = ?,
            halftime_open_at = ?,
            halftime_close_at = ?,
            halftime_betting_opened_at = COALESCE(halftime_betting_opened_at, ?),
            halftime_schedule_checked_at = ?,
            updated_at = ?
        WHERE api_fixture_id = ?
          AND source = ?
          AND status NOT IN (?, ?)
      `).run(
        addedMinutes,
        halftimeOpenAt,
        halftimeCloseAt,
        halftimeOpenAt,
        checkedAt,
        checkedAt,
        row.api_fixture_id,
        row.source,
        sub2apiWorldCupMatchStatuses.settled,
        sub2apiWorldCupMatchStatuses.cancelled
      );
      stats.checked += 1;
      stats.opened += result.changes || 0;
    } catch (error) {
      stats.failed += 1;
      logApiFootballSyncError(`halftime ${row.api_fixture_id}`, error);
      if (isApiFootballLimitError(error)) break;
    }
  }
  return stats;
}

async function checkWorldCupFinishWindows(connections, nowMs, settings) {
  const now = new Date(nowMs).toISOString();
  const rows = db.prepare(`
    SELECT api_fixture_id,
           MIN(halftime_close_at) AS halftime_close_at,
           MIN(source) AS source
    FROM sub2api_worldcup_matches
    WHERE source IN ('api-football', 'football-data', 'zafronix')
      AND api_fixture_id IS NOT NULL
      AND status NOT IN (?, ?, ?)
      AND halftime_close_at IS NOT NULL
      AND finish_check_at IS NULL
      AND datetime(halftime_close_at, '+45 minutes') <= datetime(?)
    GROUP BY api_fixture_id
    ORDER BY datetime(halftime_close_at) ASC
    LIMIT 10
  `).all(
    sub2apiWorldCupMatchStatuses.finished,
    sub2apiWorldCupMatchStatuses.settled,
    sub2apiWorldCupMatchStatuses.cancelled,
    now
  );

  const stats = { targets: rows.length, checked: 0, scheduled: 0, failed: 0 };
  for (const row of rows) {
    try {
      const parsed = await refreshWorldCupFixtureById(row, connections, nowMs, settings, getWorldCupRequestPriority(settings, true));
      const addedMinutes = getWorldCupAddedMinutes(parsed, 0);
      const finishCheckAt = addMinutesIso(row.halftime_close_at, 45 + addedMinutes);
      const checkedAt = nowIso();
      const result = db.prepare(`
        UPDATE sub2api_worldcup_matches
        SET second_half_added_minutes = ?,
            finish_check_at = ?,
            finish_schedule_checked_at = ?,
            updated_at = ?
        WHERE api_fixture_id = ?
          AND source = ?
          AND status NOT IN (?, ?)
      `).run(
        addedMinutes,
        finishCheckAt,
        checkedAt,
        checkedAt,
        row.api_fixture_id,
        row.source,
        sub2apiWorldCupMatchStatuses.settled,
        sub2apiWorldCupMatchStatuses.cancelled
      );
      stats.checked += 1;
      stats.scheduled += result.changes || 0;
    } catch (error) {
      stats.failed += 1;
      logApiFootballSyncError(`finish-window ${row.api_fixture_id}`, error);
      if (isApiFootballLimitError(error)) break;
    }
  }
  return stats;
}

async function checkWorldCupFinalResults(connections, nowMs, settings) {
  const retryBefore = new Date(nowMs - 10 * 60 * 1000).toISOString();
  const rows = db.prepare(`
    SELECT api_fixture_id,
           MIN(source) AS source,
           MIN(finish_check_at) AS finish_check_at,
           MAX(final_result_checked_at) AS final_result_checked_at
    FROM sub2api_worldcup_matches
    WHERE source IN ('api-football', 'football-data', 'zafronix')
      AND api_fixture_id IS NOT NULL
      AND status NOT IN (?, ?, ?)
      AND finish_check_at IS NOT NULL
      AND datetime(finish_check_at) <= datetime(?)
      AND (final_result_checked_at IS NULL OR final_result_checked_at <= ?)
    GROUP BY api_fixture_id
    ORDER BY datetime(finish_check_at) ASC
    LIMIT 10
  `).all(
    sub2apiWorldCupMatchStatuses.finished,
    sub2apiWorldCupMatchStatuses.settled,
    sub2apiWorldCupMatchStatuses.cancelled,
    new Date(nowMs).toISOString(),
    retryBefore
  );

  const stats = { targets: rows.length, checked: 0, finished: 0, settled: 0, failed: 0 };
  for (const row of rows) {
    const checkedAt = nowIso();
    db.prepare(`
      UPDATE sub2api_worldcup_matches
      SET final_result_checked_at = ?, updated_at = ?
      WHERE api_fixture_id = ?
        AND source = ?
    `).run(checkedAt, checkedAt, row.api_fixture_id, row.source);
    try {
      const parsed = await refreshWorldCupFixtureById(row, connections, nowMs, settings, getWorldCupRequestPriority(settings, true));
      stats.checked += 1;
      if (parsed?.status === sub2apiWorldCupMatchStatuses.finished && parsed.result) {
        stats.finished += 1;
        const matches = db.prepare(`
          SELECT id
          FROM sub2api_worldcup_matches
          WHERE api_fixture_id = ?
            AND source = ?
            AND status = ?
        `).all(row.api_fixture_id, row.source, sub2apiWorldCupMatchStatuses.finished);
        for (const match of matches) {
          await requestWorldCupInternalSettle(match.id);
          stats.settled += 1;
        }
      }
    } catch (error) {
      stats.failed += 1;
      logApiFootballSyncError(`final ${row.api_fixture_id}`, error);
      if (isApiFootballLimitError(error)) break;
    }
  }
  return stats;
}

function getUpcomingApiFootballOddsTargets(now = nowIso()) {
  return db.prepare(`
    SELECT api_fixture_id,
           MIN(home_team) AS home_team,
           MIN(away_team) AS away_team,
           MIN(kickoff_at) AS kickoff_at,
           MAX(odds_last_synced_at) AS odds_last_synced_at
    FROM sub2api_worldcup_matches
    WHERE source = 'api-football'
      AND api_fixture_id IS NOT NULL
      AND status = ?
      AND datetime(kickoff_at) > datetime(?)
    GROUP BY api_fixture_id
    ORDER BY datetime(kickoff_at) ASC
    LIMIT ?
  `).all(sub2apiWorldCupMatchStatuses.open, now, WORLDCUP_UPCOMING_ODDS_LIMIT);
}

function shouldRefreshApiFootballOdds(row, nowMs) {
  const kickoffMs = parseTimeMs(row.kickoff_at);
  if (!kickoffMs) return false;
  const untilKickoff = kickoffMs - nowMs;
  if (untilKickoff <= 60 * 60 * 1000 || untilKickoff > 14 * 24 * 60 * 60 * 1000) return false;
  const lastMs = parseTimeMs(row.odds_last_synced_at);
  if (!lastMs) return true;
  const sinceLast = nowMs - lastMs;
  if (untilKickoff <= 2 * 60 * 60 * 1000) return sinceLast >= 30 * 60 * 1000;
  if (untilKickoff <= 24 * 60 * 60 * 1000) return sinceLast >= 2 * 60 * 60 * 1000;
  return sinceLast >= 12 * 60 * 60 * 1000;
}

async function syncUpcomingApiFootballWorldCupOdds(nowMs, settings) {
  const targets = getUpcomingApiFootballOddsTargets(new Date(nowMs).toISOString())
    .filter((row) => shouldRefreshApiFootballOdds(row, nowMs));
  const stats = { targets: targets.length, attempted: 0, updated: 0, failed: 0 };
  for (const target of targets) {
    try {
      stats.attempted += 1;
      const response = await fetchApiFootballWorldCupOdds(db, {
        fixtureId: target.api_fixture_id,
        priority: "normal",
        settings
      });
      const odds = parseApiFootballMatchWinnerOdds(response.json, {
        homeTeam: target.home_team,
        awayTeam: target.away_team
      });
      if (odds) {
        stats.updated += updateApiFootballWorldCupOdds(target.api_fixture_id, odds);
      } else {
        markApiFootballWorldCupOddsAttempt(target.api_fixture_id);
      }
    } catch (error) {
      stats.failed += 1;
      logApiFootballSyncError(`odds ${target.api_fixture_id}`, error);
      if (isApiFootballLimitError(error)) break;
      markApiFootballWorldCupOddsAttempt(target.api_fixture_id);
    }
  }
  return stats;
}

function extractSportteryMatchList(json) {
  if (!json || typeof json !== "object") return [];
  if (Array.isArray(json.matchList)) return json.matchList;
  const stack = [json];
  while (stack.length) {
    const current = stack.pop();
    if (!current || typeof current !== "object") continue;
    if (Array.isArray(current.matchList)) return current.matchList;
    for (const value of Object.values(current)) {
      if (value && typeof value === "object") stack.push(value);
    }
  }
  return [];
}

function extractSportteryNestedLists(json, listKey) {
  if (!json || typeof json !== "object") return [];
  const lists = [];
  const stack = [json];
  while (stack.length) {
    const current = stack.pop();
    if (!current || typeof current !== "object") continue;
    if (Array.isArray(current[listKey])) lists.push(...current[listKey]);
    for (const value of Object.values(current)) {
      if (value && typeof value === "object") stack.push(value);
    }
  }
  return lists;
}

function extractSportteryUniformMatchList(json) {
  return extractSportteryNestedLists(json, "subMatchList");
}

function parseSportteryOdd(value) {
  const number = Number(String(value || "").trim());
  return Number.isFinite(number) && number > 0 ? number : null;
}

function parseAmericanOddsToDecimal(value) {
  const number = Number(String(value || "").trim());
  if (!Number.isFinite(number) || number === 0) return null;
  if (number > 0) return Number((1 + number / 100).toFixed(2));
  return Number((1 + 100 / Math.abs(number)).toFixed(2));
}

function parseEspnMoneylineDecimal(value) {
  const direct = parseSportteryOdd(value?.decimal ?? value?.value);
  if (direct) return direct;
  return parseAmericanOddsToDecimal(value?.odds ?? value?.american ?? value?.moneyLine ?? value);
}

function parseSportteryOddsPool(item) {
  if (Array.isArray(item?.oddsList)) {
    return item.oddsList.find((odds) => String(odds?.poolCode || "").toUpperCase() === "HAD") || null;
  }
  return item;
}

function parseSportteryUniformWorldCupOddsMatch(item) {
  const pool = parseSportteryOddsPool(item);
  const home = parseSportteryOdd(pool?.h);
  const draw = parseSportteryOdd(pool?.d);
  const away = parseSportteryOdd(pool?.a);
  const homeTeam = String(item?.homeTeamAllName || item?.homeTeamAbbName || "").trim();
  const awayTeam = String(item?.awayTeamAllName || item?.awayTeamAbbName || "").trim();
  const date = String(item?.matchDate || item?.businessDate || "").trim().slice(0, 10);
  if (!home || !draw || !away || !homeTeam || !awayTeam || !date) return null;
  return {
    date,
    homeTeam,
    awayTeam,
    key: buildWorldCupMatchKey(date, homeTeam, awayTeam),
    reverseKey: buildWorldCupMatchKey(date, awayTeam, homeTeam),
    odds: { home, draw, away }
  };
}

function parseSportteryWorldCupOddsMatch(item) {
  const home = parseSportteryOdd(item?.h);
  const draw = parseSportteryOdd(item?.d);
  const away = parseSportteryOdd(item?.a);
  const homeTeam = String(item?.masterTeamAllName || item?.masterTeamName || "").trim();
  const awayTeam = String(item?.guestTeamAllName || item?.guestTeamName || "").trim();
  const date = String(item?.startTime || item?.matchDate || "").trim().slice(0, 10);
  if (!home || !draw || !away || !homeTeam || !awayTeam || !date) return null;
  return {
    date,
    homeTeam,
    awayTeam,
    key: buildWorldCupMatchKey(date, homeTeam, awayTeam),
    reverseKey: buildWorldCupMatchKey(date, awayTeam, homeTeam),
    odds: { home, draw, away }
  };
}

function normalizeProvidedSportteryWorldCupOddsMatch(item) {
  const home = parseSportteryOdd(item?.odds?.home ?? item?.home);
  const draw = parseSportteryOdd(item?.odds?.draw ?? item?.draw);
  const away = parseSportteryOdd(item?.odds?.away ?? item?.away);
  const homeTeam = String(item?.homeTeam || "").trim();
  const awayTeam = String(item?.awayTeam || "").trim();
  const date = String(item?.date || "").trim().slice(0, 10);
  if (!home || !draw || !away || !homeTeam || !awayTeam || !date) return null;
  return {
    date,
    homeTeam,
    awayTeam,
    key: buildWorldCupMatchKey(date, homeTeam, awayTeam),
    reverseKey: buildWorldCupMatchKey(date, awayTeam, homeTeam),
    odds: { home, draw, away }
  };
}

function getSportteryWorldCupOddsTargets(now = nowIso()) {
  return db.prepare(`
    SELECT api_fixture_id,
           MIN(home_team) AS home_team,
           MIN(away_team) AS away_team,
           MIN(kickoff_at) AS kickoff_at
    FROM sub2api_worldcup_matches
    WHERE source = 'zafronix'
      AND api_fixture_id IS NOT NULL
      AND status NOT IN (?, ?)
      AND datetime(kickoff_at) >= datetime(?)
    GROUP BY api_fixture_id
    ORDER BY datetime(kickoff_at) ASC
  `).all(
    sub2apiWorldCupMatchStatuses.settled,
    sub2apiWorldCupMatchStatuses.cancelled,
    now
  );
}

async function fetchSportteryJson(url) {
  const requestUrl = new URL(url);
  requestUrl.searchParams.set("_", String(Date.now()));
  const response = await fetch(requestUrl, {
    headers: {
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
      Origin: "https://www.sporttery.cn",
      Referer: "https://www.sporttery.cn/",
      "Sec-Fetch-Dest": "empty",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "same-site",
      "User-Agent": BROWSER_UA
    },
    signal: AbortSignal.timeout(12000)
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`体彩赔率返回非 JSON 内容，HTTP ${response.status}`);
  }
  if (!response.ok) {
    throw new Error(json?.errorMessage || json?.message || `体彩赔率 HTTP ${response.status}`);
  }
  if (json?.success === false || (json?.errorCode && String(json.errorCode) !== "0")) {
    throw new Error(json?.errorMessage || json?.message || `体彩赔率错误 ${json.errorCode}`);
  }
  return json;
}

async function fetchSportteryWorldCupOddsMatches() {
  const uniformJson = await fetchSportteryJson(WORLDCUP_SPORTTERY_MATCH_ODDS_URL);
  const uniformItems = extractSportteryUniformMatchList(uniformJson);
  const uniformMatches = uniformItems
    .map(parseSportteryUniformWorldCupOddsMatch)
    .filter(Boolean);
  if (uniformMatches.length) {
    return {
      matches: uniformMatches,
      diagnostics: {
        source: "uniform",
        uniformRaw: uniformItems.length,
        uniformParsed: uniformMatches.length,
        drawRaw: 0,
        drawParsed: 0
      }
    };
  }

  const drawJson = await fetchSportteryJson(WORLDCUP_SPORTTERY_DRAW_ODDS_URL);
  const drawItems = extractSportteryMatchList(drawJson);
  const drawMatches = drawItems
    .map(parseSportteryWorldCupOddsMatch)
    .filter(Boolean);
  return {
    matches: drawMatches,
    diagnostics: {
      source: "draw",
      uniformRaw: uniformItems.length,
      uniformParsed: uniformMatches.length,
      drawRaw: drawItems.length,
      drawParsed: drawMatches.length
    }
  };
}

function parseEspnWorldCupOddsMatch(event) {
  const competition = Array.isArray(event?.competitions) ? event.competitions[0] : null;
  const competitors = Array.isArray(competition?.competitors) ? competition.competitors : [];
  const homeCompetitor = competitors.find((item) => item?.homeAway === "home");
  const awayCompetitor = competitors.find((item) => item?.homeAway === "away");
  const odds = Array.isArray(competition?.odds)
    ? competition.odds.find((item) => item && (item.moneyline || item.homeTeamOdds || item.awayTeamOdds || item.drawOdds))
    : null;
  const homeTeam = String(homeCompetitor?.team?.displayName || homeCompetitor?.team?.shortDisplayName || "").trim();
  const awayTeam = String(awayCompetitor?.team?.displayName || awayCompetitor?.team?.shortDisplayName || "").trim();
  const date = getBeijingDateKey(competition?.date || event?.date);
  const home = parseEspnMoneylineDecimal(
    odds?.moneyline?.home?.current
      ?? odds?.moneyline?.home?.close
      ?? odds?.homeTeamOdds?.current?.moneyLine
      ?? odds?.homeTeamOdds?.close?.moneyLine
      ?? odds?.homeTeamOdds?.moneyLine
  );
  const draw = parseEspnMoneylineDecimal(
    odds?.moneyline?.draw?.current
      ?? odds?.moneyline?.draw?.close
      ?? odds?.drawOdds?.current?.moneyLine
      ?? odds?.drawOdds?.close?.moneyLine
      ?? odds?.drawOdds?.moneyLine
  );
  const away = parseEspnMoneylineDecimal(
    odds?.moneyline?.away?.current
      ?? odds?.moneyline?.away?.close
      ?? odds?.awayTeamOdds?.current?.moneyLine
      ?? odds?.awayTeamOdds?.close?.moneyLine
      ?? odds?.awayTeamOdds?.moneyLine
  );
  if (!home || !draw || !away || !homeTeam || !awayTeam || !date) return null;
  return {
    date,
    homeTeam,
    awayTeam,
    key: buildWorldCupMatchKey(date, homeTeam, awayTeam),
    reverseKey: buildWorldCupMatchKey(date, awayTeam, homeTeam),
    odds: { home, draw, away }
  };
}

async function fetchEspnWorldCupOddsMatches(targets = []) {
  const targetTimes = targets
    .map((target) => new Date(target.kickoff_at || "").getTime())
    .filter(Number.isFinite);
  const minTime = targetTimes.length ? Math.min(...targetTimes) : Date.now();
  const maxTime = targetTimes.length ? Math.max(...targetTimes) : Date.now() + 2 * 24 * 60 * 60 * 1000;
  const requestUrl = new URL(WORLDCUP_ESPN_SCOREBOARD_URL);
  requestUrl.searchParams.set("limit", "200");
  requestUrl.searchParams.set("dates", `${formatCompactUtcDate(minTime - 24 * 60 * 60 * 1000)}-${formatCompactUtcDate(maxTime + 24 * 60 * 60 * 1000)}`);
  const response = await fetch(requestUrl, {
    headers: {
      Accept: "application/json",
      "User-Agent": BROWSER_UA
    },
    signal: AbortSignal.timeout(12000)
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`ESPN 赔率返回非 JSON 内容，HTTP ${response.status}`);
  }
  if (!response.ok) {
    throw new Error(json?.message || `ESPN 赔率 HTTP ${response.status}`);
  }
  const events = Array.isArray(json?.events) ? json.events : [];
  return {
    matches: events.map(parseEspnWorldCupOddsMatch).filter(Boolean),
    diagnostics: {
      source: "espn",
      uniformRaw: events.length,
      uniformParsed: events.filter((event) => Array.isArray(event?.competitions?.[0]?.odds) && event.competitions[0].odds.some(Boolean)).length,
      drawRaw: 0,
      drawParsed: 0
    }
  };
}

async function syncSportteryWorldCupOdds(nowMs, providedMatches = [], providedError = "") {
  const targets = getSportteryWorldCupOddsTargets(new Date(nowMs).toISOString());
  const stats = {
    targets: targets.length,
    attempted: 0,
    updated: 0,
    failed: 0,
    returned: 0,
    matched: 0,
    source: "",
    uniformRaw: 0,
    uniformParsed: 0,
    drawRaw: 0,
    drawParsed: 0,
    error: ""
  };
  if (!targets.length) return stats;
  try {
    stats.attempted = 1;
    let matches = [];
    const browserMatches = Array.isArray(providedMatches)
      ? providedMatches.map(normalizeProvidedSportteryWorldCupOddsMatch).filter(Boolean)
      : [];
    if (browserMatches.length) {
      matches = browserMatches;
      Object.assign(stats, {
        source: "browser",
        uniformRaw: providedMatches.length,
        uniformParsed: browserMatches.length,
        drawRaw: 0,
        drawParsed: 0
      });
    } else {
      try {
        const { matches: fetchedMatches, diagnostics } = providedError
          ? await fetchEspnWorldCupOddsMatches(targets)
          : await fetchSportteryWorldCupOddsMatches();
        matches = fetchedMatches;
        Object.assign(stats, diagnostics);
        if (providedError) stats.error = `浏览器体彩失败，已用 ESPN：${providedError}`.slice(0, 180);
      } catch (primaryError) {
        if (providedError) throw primaryError;
        const { matches: espnMatches, diagnostics } = await fetchEspnWorldCupOddsMatches(targets);
        matches = espnMatches;
        Object.assign(stats, diagnostics);
        stats.error = `体彩失败，已用 ESPN：${String(primaryError?.message || primaryError || "").slice(0, 120)}`;
      }
    }
    stats.returned = matches.length;
    const oddsByKey = new Map();
    for (const item of matches) {
      oddsByKey.set(item.key, item);
      oddsByKey.set(item.reverseKey, {
        ...item,
        odds: {
          home: item.odds.away,
          draw: item.odds.draw,
          away: item.odds.home
        }
      });
    }
    for (const target of targets) {
      const key = buildWorldCupMatchKey(getBeijingDateKey(target.kickoff_at), target.home_team, target.away_team);
      const matched = oddsByKey.get(key);
      if (!matched) continue;
      stats.matched += 1;
      stats.updated += updateApiFootballWorldCupOdds(target.api_fixture_id, matched.odds, "zafronix");
    }
  } catch (error) {
    stats.failed += 1;
    stats.error = String(error?.message || error || "").slice(0, 180);
    console.warn("[KaWang worker] worldcup sporttery odds:", error.message || error);
  }
  return stats;
}

async function requestWorldCupInternalSettle(matchId) {
  const response = await fetch(`${env.apiUrl}/api/internal/sub2api/worldcup/settle`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Internal-Secret": env.internalSecret
    },
    body: JSON.stringify({ matchId }),
    signal: AbortSignal.timeout(WORLDCUP_INTERNAL_TIMEOUT_MS)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.message || `HTTP ${response.status}`);
  }
  return payload;
}

async function requestWorldCupInternalCancel(matchId) {
  const response = await fetch(`${env.apiUrl}/api/internal/sub2api/worldcup/cancel`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Internal-Secret": env.internalSecret
    },
    body: JSON.stringify({ matchId }),
    signal: AbortSignal.timeout(WORLDCUP_INTERNAL_TIMEOUT_MS)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.message || `HTTP ${response.status}`);
  }
  return payload;
}

async function autoSettleFinishedApiFootballWorldCupMatches(nowMs) {
  const retryBefore = new Date(nowMs - 30 * 60 * 1000).toISOString();
  const rows = db.prepare(`
    SELECT id, home_team, away_team, home_score, away_score
    FROM sub2api_worldcup_matches
    WHERE source IN ('api-football', 'football-data', 'zafronix')
      AND status = ?
      AND result IS NOT NULL
      AND (auto_settle_attempted_at IS NULL OR auto_settle_attempted_at <= ?)
    ORDER BY datetime(kickoff_at) ASC
    LIMIT 10
  `).all(sub2apiWorldCupMatchStatuses.finished, retryBefore);

  const stats = { targets: rows.length, settled: 0, failed: 0 };
  for (const row of rows) {
    const now = nowIso();
    db.prepare(`
      UPDATE sub2api_worldcup_matches
      SET auto_settle_attempted_at = ?, updated_at = ?
      WHERE id = ?
    `).run(now, now, row.id);
    try {
      await requestWorldCupInternalSettle(row.id);
      stats.settled += 1;
      console.log(`[KaWang worker] worldcup: settled ${row.home_team} ${row.home_score}-${row.away_score} ${row.away_team}`);
    } catch (error) {
      stats.failed += 1;
      console.error(`[KaWang worker] worldcup settle ${row.id}:`, error.message || error);
    }
  }
  return stats;
}

async function autoCancelApiFootballWorldCupMatches(nowMs) {
  const retryBefore = new Date(nowMs - 30 * 60 * 1000).toISOString();
  const rows = db.prepare(`
    SELECT m.id, m.home_team, m.away_team
    FROM sub2api_worldcup_matches m
    WHERE m.source IN ('api-football', 'football-data', 'zafronix')
      AND m.status = ?
      AND (m.auto_settle_attempted_at IS NULL OR m.auto_settle_attempted_at <= ?)
      AND EXISTS (
        SELECT 1
        FROM sub2api_worldcup_bets b
        WHERE b.match_id = m.id
          AND b.status IN (?, ?, ?)
      )
    ORDER BY datetime(m.kickoff_at) ASC
    LIMIT 10
  `).all(
    sub2apiWorldCupMatchStatuses.cancelled,
    retryBefore,
    sub2apiWorldCupBetStatuses.placed,
    sub2apiWorldCupBetStatuses.payoutFailed,
    sub2apiWorldCupBetStatuses.refundFailed
  );

  const stats = { targets: rows.length, cancelled: 0, failed: 0 };
  for (const row of rows) {
    const now = nowIso();
    db.prepare(`
      UPDATE sub2api_worldcup_matches
      SET auto_settle_attempted_at = ?, updated_at = ?
      WHERE id = ?
    `).run(now, now, row.id);
    try {
      await requestWorldCupInternalCancel(row.id);
      stats.cancelled += 1;
      console.log(`[KaWang worker] worldcup: cancelled ${row.home_team} vs ${row.away_team}`);
    } catch (error) {
      stats.failed += 1;
      console.error(`[KaWang worker] worldcup cancel ${row.id}:`, error.message || error);
    }
  }
  return stats;
}

function shouldDiscoverApiFootballWorldCupFixtures(connections, nowMs, settings = {}) {
  if (!connections.length) return false;
  const dateKey = getApiFootballUsageDate(new Date(nowMs), settings.timezone || "Asia/Shanghai");
  if (worldCupLastDiscoveryDate !== dateKey) return true;
  return !worldCupLastDiscoveryAt;
}

async function apiFootballWorldCupTick({ force = false, sportteryOddsMatches = [], sportteryBrowserError = "" } = {}) {
  if (worldCupSyncRunning) {
    return { accepted: false, reason: "already_running" };
  }
  worldCupSyncRunning = true;
  try {
    const settings = getApiFootballSettings(db, { includeApiKey: true });
    if (!settings.enabled) {
      if (!worldCupDisabledLogged) {
        console.log("[KaWang worker] worldcup: Zafronix 后台配置未启用，跳过自动同步");
        worldCupDisabledLogged = true;
      }
      return { accepted: false, reason: "disabled" };
    }
    worldCupDisabledLogged = false;

    const nowMs = Date.now();
    if (!force && worldCupLastTickAt && nowMs - worldCupLastTickAt < settings.syncIntervalMs) {
      return { accepted: false, reason: "interval_not_due" };
    }
    worldCupLastTickAt = nowMs;

    const connections = getActiveSub2ApiConnections();
    if (!connections.length) return { accepted: false, reason: "no_active_connections" };
    if (!settings.apiKey) {
      logApiFootballSyncError("config", Object.assign(new Error("未在后台配置 Zafronix API Key，跳过世界杯同步"), {
        code: "API_FOOTBALL_KEY_MISSING"
      }));
      return { accepted: false, reason: "missing_api_key" };
    }
    worldCupMissingKeyLogged = false;

    const stats = {
      connections: connections.length,
      discovery: { requests: 0, fixturesReturned: 0, fixturesSeen: 0, rowsSynced: 0, rowsPruned: 0 },
      halftimeWindows: { targets: 0, checked: 0, opened: 0, failed: 0 },
      finishWindows: { targets: 0, checked: 0, scheduled: 0, failed: 0 },
      finalResults: { targets: 0, checked: 0, finished: 0, settled: 0, failed: 0 },
      upcomingOdds: { targets: 0, attempted: 0, updated: 0, failed: 0 },
      settle: { targets: 0, settled: 0, failed: 0 },
      cancel: { targets: 0, cancelled: 0, failed: 0 }
    };

    if (force || shouldDiscoverApiFootballWorldCupFixtures(connections, nowMs, settings)) {
      try {
        stats.discovery = await discoverApiFootballWorldCupFixtures(connections, nowMs, settings);
      } catch (error) {
        logApiFootballSyncError("discovery", error);
      }
    }
    if (["api-football", "football-data", "zafronix"].includes(settings.provider)) {
      stats.halftimeWindows = await checkWorldCupHalftimeWindows(connections, nowMs, settings);
      stats.finishWindows = await checkWorldCupFinishWindows(connections, nowMs, settings);
      stats.finalResults = await checkWorldCupFinalResults(connections, nowMs, settings);
    }
    if (settings.provider === "api-football") {
      stats.upcomingOdds = await syncUpcomingApiFootballWorldCupOdds(nowMs, settings);
    } else if (settings.provider === "zafronix") {
      stats.upcomingOdds = await syncSportteryWorldCupOdds(nowMs, sportteryOddsMatches, sportteryBrowserError);
    }
    stats.settle = await autoSettleFinishedApiFootballWorldCupMatches(nowMs);
    stats.cancel = await autoCancelApiFootballWorldCupMatches(nowMs);
    return { accepted: true, forced: force, stats };
  } finally {
    worldCupSyncRunning = false;
  }
}

function claimJob() {
  const now = nowIso();
  const candidate = db.prepare(`
    SELECT *
    FROM activation_jobs
    WHERE status = 'pending'
      AND (next_retry_at IS NULL OR next_retry_at <= ?)
      AND locked_at IS NULL
    ORDER BY created_at ASC
    LIMIT 1
  `).get(now);

  if (!candidate) return null;

  const result = db.prepare(`
    UPDATE activation_jobs
    SET locked_at = ?, locked_by = ?, status = ?
    WHERE id = ? AND locked_at IS NULL AND status = 'pending'
  `).run(now, workerId, jobStatuses.processing, candidate.id);

  return result.changes ? { ...candidate, status: jobStatuses.processing, locked_at: now, locked_by: workerId } : null;
}

function buildRequestContext(job, order, cdkey, site, endpoint) {
  const sessionJson = JSON.parse(decryptText(order.session_payload));
  const sessionRaw = JSON.stringify(sessionJson);
  const sourceKey = decryptText(cdkey.source_key);
  const jobPayload = safeParseJson(job.payload, {});
  const abandonRemainingTime = Boolean(jobPayload.abandonRemainingTime || order.abandon_remaining_time);
  return {
    orderNo: order.order_no,
    publicKey: cdkey.public_key,
    sourceKey,
    normalizedSourceKey: normalizeSourceKey(sourceKey),
    session: sessionJson,
    sessionRaw,
    // Use this in templates when the remote field expects a JSON string, not an object.
    sessionString: JSON.stringify(sessionRaw),
    abandonRemainingTime,
    endpointName: endpoint?.name || site?.name || "Unknown",
    siteName: site?.name || null,
    siteSlug: site?.slug || null
  };
}

function getUrlOrigin(url) {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}

function is9977Site(site) {
  return String(site?.slug || "").trim().toLowerCase() === "9977";
}

function getResponseSetCookies(headers) {
  if (typeof headers?.getSetCookie === "function") {
    return headers.getSetCookie();
  }
  const fallback = headers?.get("set-cookie");
  return fallback ? [fallback] : [];
}

function compactCookieHeader(cookies = []) {
  return cookies
    .map((item) => String(item ?? "").split(";")[0].trim())
    .filter(Boolean)
    .join("; ");
}

function mergeCookieHeaders(...values) {
  const cookies = new Map();
  for (const value of values) {
    for (const item of String(value ?? "").split(";")) {
      const cookie = item.trim();
      if (!cookie || !cookie.includes("=")) continue;
      const name = cookie.split("=")[0].trim();
      if (name) cookies.set(name, cookie);
    }
  }
  return Array.from(cookies.values()).join("; ");
}

function applyAuthHeaders(headers, remoteConfig, bodyString) {
  if (remoteConfig.authType === "bearer" && remoteConfig.authConfig) {
    headers.Authorization = `Bearer ${remoteConfig.authConfig}`;
    return;
  }

  if (remoteConfig.authType === "header_json" && remoteConfig.authConfig) {
    Object.assign(headers, safeParseJson(remoteConfig.authConfig, {}));
    return;
  }

  if (remoteConfig.authType === "oaifire_sign") {
    const timestamp = Date.now().toString();
    const nonce = randomBytes(16).toString("hex");
    const salt = remoteConfig.authConfig || "ChatGPT#Plus@2026!";
    const bodyHash = bodyString ? createHash("md5").update(bodyString).digest("hex") : "";
    const sign = createHash("sha256").update(`${salt}${timestamp}${nonce}${bodyHash}`).digest("hex");
    const origin = getUrlOrigin(remoteConfig.url);

    headers["X-Timestamp"] = timestamp;
    headers["X-Nonce"] = nonce;
    headers["X-Sign"] = sign;

    if (origin) {
      headers.Origin = headers.Origin || origin;
      headers.Referer = headers.Referer || `${origin}/`;
    }
  }
}

async function fetch9977VerificationCookie(site, context) {
  const renderedHeaders = renderJsonTemplate(site.verify_headers_template || "{}", context);
  const renderedBody = renderJsonTemplate(site.verify_body_template || "{}", context);
  const headers = typeof renderedHeaders === "string"
    ? safeParseJson(renderedHeaders, {})
    : renderedHeaders;
  const body = typeof renderedBody === "string"
    ? safeParseJson(renderedBody, renderedBody)
    : renderedBody;
  const method = site.verify_http_method || "POST";
  const bodyString = method === "GET" ? "" : encodeRequestBody(body, headers);
  const verifyConfig = {
    url: site.verify_api_url,
    method,
    authType: site.auth_type,
    authConfig: site.auth_config,
    timeoutSeconds: site.timeout_seconds || 15
  };
  applyAuthHeaders(headers, verifyConfig, bodyString);

  const origin = getUrlOrigin(site.verify_api_url);
  const fetchHeaders = {
    "User-Agent": BROWSER_UA,
    "Accept": "application/json, text/plain, */*",
    "Referer": origin ? `${origin}/` : undefined,
    "Origin": origin || undefined,
    "Content-Type": "application/json",
    ...headers
  };
  if (site.request_cookies) {
    fetchHeaders.Cookie = site.request_cookies;
  }

  let response;
  let responseText = "";
  let responseJson = null;

  try {
    response = await fetch(site.verify_api_url, {
      method,
      headers: fetchHeaders,
      body: method === "GET" ? undefined : bodyString,
      signal: AbortSignal.timeout((site.timeout_seconds || 15) * 1000)
    });
    responseText = await response.text();
    responseJson = safeParseJson(responseText, null);
  } catch (error) {
    return {
      ok: false,
      status: 599,
      text: error.message,
      json: null,
      cookieHeader: ""
    };
  }

  const responseInfo = {
    ok: response.ok,
    status: response.status,
    text: responseText,
    json: responseJson
  };
  const failureMatched = site.verify_failure_rule ? evaluateRule(site.verify_failure_rule, responseInfo) : false;
  const successMatched = site.verify_success_rule ? evaluateRule(site.verify_success_rule, responseInfo) : responseInfo.ok;

  return {
    ...responseInfo,
    ok: response.ok && !failureMatched && successMatched,
    cookieHeader: compactCookieHeader(getResponseSetCookies(response.headers))
  };
}

function extractFailureMessages(responseInfo = {}) {
  const candidates = [
    responseInfo.json?.error,
    responseInfo.json?.message,
    responseInfo.json?.msg,
    responseInfo.json?.result,
    responseInfo.json?.data?.error,
    responseInfo.json?.data?.msg,
    responseInfo.json?.data?.message,
    responseInfo.json?.data?.statusMessage,
    responseInfo.json?.code,
    responseInfo.json?.data?.code,
    responseInfo.text
  ];

  return candidates
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);
}

// 把远端 `{code, message}` 类响应组合成更可读的错误，方便订单/任务列表展示。
function formatRemoteErrorMessage(responseInfo = {}, fallback = "") {
  const json = responseInfo.json;
  if (json && typeof json === "object") {
    const code = json.code || json.data?.code;
    const message = json.error_msg
      || json.error
      || json.message
      || json.msg
      || json.data?.error_msg
      || json.data?.error
      || json.data?.message
      || json.data?.msg
      || json.data?.statusMessage;
    if (code && message) return `${code}: ${message}`;
    if (message) return String(message);
    if (code) return String(code);
  }
  return fallback || responseInfo.text || `HTTP ${responseInfo.status}`;
}

function extractTaskIdFromText(text) {
  const match = String(text ?? "").match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  return match ? match[0] : "";
}

function extractRemoteTaskId(responseInfo, taskIdPath) {
  const fromJson = getJsonByPath(responseInfo?.json, taskIdPath || "task_id");
  if (fromJson) {
    return String(fromJson);
  }

  const candidates = [
    responseInfo?.json?.error,
    responseInfo?.json?.message,
    responseInfo?.json?.msg,
    responseInfo?.text
  ];

  for (const candidate of candidates) {
    const taskId = extractTaskIdFromText(candidate);
    if (taskId) return taskId;
  }

  return "";
}

function getRemoteTaskStatus(responseInfo = {}) {
  const status = responseInfo.json?.status;
  return typeof status === "string" ? status.trim().toLowerCase() : "";
}

function isKnownSuccessfulTaskStatus(responseInfo = {}) {
  return ["completed", "success", "succeeded"].includes(getRemoteTaskStatus(responseInfo));
}

function isKnownFailedTaskStatus(responseInfo = {}) {
  return ["failed", "error"].includes(getRemoteTaskStatus(responseInfo));
}

function getPollingConfig(site) {
  const intervalMs = Number(site?.poll_interval_ms);
  const maxRounds = Number(site?.poll_max_rounds);
  return {
    intervalMs: Number.isFinite(intervalMs) && intervalMs >= 1000 ? intervalMs : 5000,
    maxRounds: Number.isFinite(maxRounds) && maxRounds >= 1 ? maxRounds : 6
  };
}

function isNonRetryableFailure(responseInfo = {}, fallbackMessage = "") {
  const messages = extractFailureMessages(responseInfo);
  if (fallbackMessage) {
    messages.push(String(fallbackMessage));
  }

  const normalized = messages.join("\n").toLowerCase();
  const exactKeywords = [
    "token已失效",
    "token无效",
    "token 已失效",
    "token 无效",
    "token内容格式错误",
    "token 内容格式错误",
    "session格式错误",
    "session 格式错误",
    "session 无效",
    "session无效",
    "session 已失效",
    "session已失效",
    "缺少account字段",
    "缺少 account 字段",
    "字段缺失",
    "missing account",
    "account field is required",
    "token expired",
    "token invalid",
    "invalid token",
    "expired token",
    "invalid_session",
    "invalid session",
    "session_invalid",
    "cdk_used",
    "cdk used",
    "cdk 已被使用",
    "卡密已被使用",
    "已被使用",
    "cdk_invalid",
    "cdk invalid",
    "invalid_cdk",
    // redeemgpt 特有的不可重试错误
    "cdkey 已充值成功",
    "cdkey 正在充值中",
    "session信息或账号异常",
    "未找到对应cdk",
    "cdk异常",
    "cdk已作废",
    "该账号当前plan为",
    "无法进行充值",
    "参数缺少或错误"
  ];

  if (exactKeywords.some((keyword) => normalized.includes(keyword))) {
    return true;
  }

  // Treat obvious user-correctable payload errors as fail-fast so the card can be resubmitted immediately.
  return (
    (normalized.includes("token") || normalized.includes("session")) &&
    (
      normalized.includes("格式错误")
      || normalized.includes("format error")
      || normalized.includes("invalid format")
      || normalized.includes("missing")
      || normalized.includes("缺少")
      || normalized.includes("字段")
      || normalized.includes("field")
      || normalized.includes("account")
    )
  );
}

function shouldTreatAlreadyUsedAsSuccess(site, responseInfo = {}, fallbackMessage = "") {
  const slug = String(site?.slug || "").trim().toLowerCase();
  if (slug !== "666") return false;

  const normalized = [
    responseInfo.json?.message,
    responseInfo.json?.msg,
    responseInfo.json?.result,
    responseInfo.json?.data?.message,
    responseInfo.json?.data?.msg,
    responseInfo.text,
    fallbackMessage
  ]
    .map((value) => String(value ?? "").trim().toLowerCase())
    .filter(Boolean)
    .join("\n");

  return [
    "cdk_used",
    "cdk used",
    "cdk已被使用",
    "cdk 已被使用",
    "卡密已被使用",
    "已被使用",
    "already used"
  ].some((keyword) => normalized.includes(keyword));
}

async function invokeEndpoint(job, order, cdkey, site, endpoint) {
  const remoteConfig = site?.submit_api_url ? {
    url: site.submit_api_url,
    method: site.submit_http_method || "POST",
    headersTemplate: site.submit_headers_template || "{}",
    bodyTemplate: site.submit_body_template || '{"card":"{{sourceKey}}","session":{{sessionRaw}}}',
    abandonBodyTemplate: site.abandon_submit_body_template,
    authType: site.auth_type,
    authConfig: site.auth_config,
    successRule: site.submit_success_rule,
    failureRule: site.submit_failure_rule,
    timeoutSeconds: site.timeout_seconds || 15,
    maxRetries: site.max_retries || 3,
    endpointType: "api"
  } : {
    url: endpoint?.submit_url,
    method: endpoint?.http_method || "POST",
    headersTemplate: endpoint?.headers_template || "{}",
    bodyTemplate: endpoint?.body_template || "{}",
    abandonBodyTemplate: endpoint?.abandon_submit_body_template,
    authType: endpoint?.auth_type,
    authConfig: endpoint?.auth_config,
    successRule: endpoint?.success_rule,
    failureRule: endpoint?.failure_rule,
    timeoutSeconds: endpoint?.timeout_seconds || 15,
    maxRetries: endpoint?.max_retries || 3,
    endpointType: endpoint?.endpoint_type || "api"
  };

  if (remoteConfig.endpointType === endpointTypes.browser) {
    return {
      ok: false,
      status: 400,
      text: "browser 类型通道需要二阶段支持，当前 worker 不执行浏览器自动化。",
      json: null
    };
  }

  const context = buildRequestContext(job, order, cdkey, site, endpoint);
  let requestCookieHeader = site?.request_cookies || "";
  if (is9977Site(site) && site?.verify_api_url) {
    const verifyInfo = await fetch9977VerificationCookie(site, context);
    if (!verifyInfo.ok) {
      return {
        ok: false,
        status: verifyInfo.status,
        text: verifyInfo.text,
        json: verifyInfo.json,
        phase: "verify_code"
      };
    }
    requestCookieHeader = mergeCookieHeaders(requestCookieHeader, verifyInfo.cookieHeader);
  }

  const bodyTemplate = context.abandonRemainingTime && remoteConfig.abandonBodyTemplate
    ? remoteConfig.abandonBodyTemplate
    : remoteConfig.bodyTemplate;
  const renderedHeaders = renderJsonTemplate(remoteConfig.headersTemplate || "{}", context);
  const renderedBody = renderJsonTemplate(bodyTemplate || "{}", context);
  const headers = typeof renderedHeaders === "string"
    ? safeParseJson(renderedHeaders, {})
    : renderedHeaders;
  const body = typeof renderedBody === "string"
    ? safeParseJson(renderedBody, renderedBody)
    : renderedBody;
  const bodyString = remoteConfig.method === "GET" ? "" : encodeRequestBody(body, headers);
  applyAuthHeaders(headers, remoteConfig, bodyString);

  let response;
  let responseText = "";
  let responseJson = null;

  try {
    const origin = getUrlOrigin(remoteConfig.url);
    const fetchHeaders = {
      "User-Agent": BROWSER_UA,
      "Accept": "application/json, text/plain, */*",
      "Referer": origin ? `${origin}/` : undefined,
      "Origin": origin || undefined,
      "Content-Type": "application/json",
      ...headers
    };
    if (requestCookieHeader) {
      fetchHeaders.Cookie = requestCookieHeader;
    }
    response = await fetch(remoteConfig.url, {
      method: remoteConfig.method || "POST",
      headers: fetchHeaders,
      body: remoteConfig.method === "GET" ? undefined : bodyString,
      signal: AbortSignal.timeout((remoteConfig.timeoutSeconds || 15) * 1000)
    });
    responseText = await response.text();
    try {
      responseJson = JSON.parse(responseText);
    } catch {
      responseJson = null;
    }
  } catch (error) {
    return {
      ok: false,
      status: 599,
      text: error.message,
      json: null
    };
  }

  return {
    ok: response.ok,
    status: response.status,
    text: responseText,
    json: responseJson
  };
}

function markSuccess(jobId, orderId, cdkeyId, responseInfo) {
  const now = nowIso();
  db.prepare(`
    UPDATE activation_jobs
    SET status = ?, attempt_count = attempt_count + 1, last_error = NULL, last_response = ?,
        locked_at = NULL, locked_by = NULL, delivered_at = ?, updated_at = ?
    WHERE id = ?
  `).run(jobStatuses.succeeded, JSON.stringify(responseInfo), now, now, jobId);

  db.prepare(`
    UPDATE redeem_orders
    SET status = ?, error_message = NULL, completed_at = ?, updated_at = ?
    WHERE id = ?
  `).run(orderStatuses.succeeded, now, now, orderId);

  db.prepare(`
    UPDATE cdkeys
    SET status = ?, used_at = ?, updated_at = ?
    WHERE id = ?
  `).run(cdkeyStatuses.used, now, now, cdkeyId);

  writeAuditLog(logActions.jobSuccess, "activation_job", jobId, responseInfo);
}

function markRetry(job, orderId, errorMessage, responseInfo, maxAttempts) {
  const now = nowIso();
  const nextRetryAt = addSeconds(now, Math.min(300, Math.max(30, job.attempt_count * 30 + 30)));
  db.prepare(`
    UPDATE activation_jobs
    SET status = ?, attempt_count = attempt_count + 1, next_retry_at = ?, last_error = ?, last_response = ?,
        locked_at = NULL, locked_by = NULL, updated_at = ?
    WHERE id = ?
  `).run(jobStatuses.pending, nextRetryAt, errorMessage, JSON.stringify(responseInfo), now, job.id);

  db.prepare(`
    UPDATE redeem_orders
    SET status = ?, error_message = ?, updated_at = ?
    WHERE id = ?
  `).run(orderStatuses.processing, `自动重试中（${job.attempt_count + 1}/${maxAttempts}）: ${errorMessage}`, now, orderId);

  writeAuditLog(logActions.jobFail, "activation_job", job.id, {
    errorMessage,
    nextRetryAt,
    attemptCount: job.attempt_count + 1
  });
}

function markFailed(jobId, orderId, cdkeyId, errorMessage, responseInfo) {
  const now = nowIso();
  db.prepare(`
    UPDATE activation_jobs
    SET status = ?, attempt_count = attempt_count + 1, last_error = ?, last_response = ?,
        locked_at = NULL, locked_by = NULL, updated_at = ?
    WHERE id = ?
  `).run(jobStatuses.failed, errorMessage, JSON.stringify(responseInfo), now, jobId);

  db.prepare(`
    UPDATE redeem_orders
    SET status = ?, error_message = ?, updated_at = ?
    WHERE id = ?
  `).run(orderStatuses.failed, errorMessage, now, orderId);

  db.prepare(`
    UPDATE cdkeys
    SET status = ?, locked_at = NULL, locked_by_order_id = NULL, updated_at = ?
    WHERE id = ? AND status = ? AND locked_by_order_id = ?
  `).run(cdkeyStatuses.active, now, cdkeyId, cdkeyStatuses.locked, orderId);

  writeAuditLog(logActions.jobFail, "activation_job", jobId, {
    errorMessage,
    final: true
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function updateJobPayload(jobId, extraFields) {
  const row = db.prepare("SELECT payload FROM activation_jobs WHERE id = ?").get(jobId);
  const existing = safeParseJson(row?.payload, {});
  const merged = { ...existing, ...extraFields };
  db.prepare("UPDATE activation_jobs SET payload = ?, updated_at = ? WHERE id = ?")
    .run(JSON.stringify(merged), nowIso(), jobId);
}

/**
 * 5sim SMS 验证流程处理函数
 * 流程: 购买号码 → 提交手机号到目标 → 轮询验证码 → 提交验证码到目标 → 完成
 */
async function processFiveSimJob(job, order, cdkey, site) {
  const maxAttempts = site?.max_retries || job.max_attempts || 3;
  const apiKey = decryptText(site.sms_api_key);

  // Build base context from existing helper
  const baseContext = buildRequestContext(job, order, cdkey, site, null);

  // ── Step 1: Purchase phone number ──
  let fivesimOrderId;
  let fivesimPhone;

  try {
    const result = await getNumber(
      apiKey,
      site.sms_service,
      site.sms_country || "china",
      site.sms_operator || "any"
    );
    fivesimOrderId = result.id;
    fivesimPhone = result.number;
  } catch (err) {
    const errMsg = err.message || "unknown error";

    // Error-to-action mapping for getNumber failures
    if (errMsg === "NO_BALANCE") {
      updateJobPayload(job.id, { fivesimStatus: "error", fivesimError: "5sim: 余额不足" });
      markFailed(job.id, order.id, cdkey.id, "5sim: 余额不足", null);
      return;
    }
    if (errMsg === "BAD_KEY") {
      updateJobPayload(job.id, { fivesimStatus: "error", fivesimError: "5sim: API Key 无效" });
      markFailed(job.id, order.id, cdkey.id, "5sim: API Key 无效", null);
      return;
    }
    if (errMsg === "BAD_SERVICE") {
      updateJobPayload(job.id, { fivesimStatus: "error", fivesimError: "5sim: 服务名称无效" });
      markFailed(job.id, order.id, cdkey.id, "5sim: 服务名称无效", null);
      return;
    }

    // NO_NUMBERS and network errors are retryable
    let retryMessage;
    if (errMsg === "NO_NUMBERS") {
      retryMessage = "5sim: 暂无可用号码";
    } else if (errMsg.includes("failed:")) {
      // Network error from fetchApi (e.g., "GET /path failed: timeout after 15000ms")
      retryMessage = `5sim: network: ${errMsg}`;
    } else {
      retryMessage = `5sim: ${errMsg}`;
    }

    updateJobPayload(job.id, { fivesimStatus: "error", fivesimError: retryMessage });

    if (job.attempt_count + 1 >= maxAttempts) {
      markFailed(job.id, order.id, cdkey.id, retryMessage, null);
    } else {
      markRetry(job, order.id, retryMessage, null, maxAttempts);
    }
    return;
  }

  // Store order info in payload
  updateJobPayload(job.id, {
    fivesimOrderId,
    fivesimPhone,
    fivesimStatus: "waiting"
  });

  // Build extended template context with SMS-specific variables
  const phone = fivesimPhone.startsWith("+") ? fivesimPhone.slice(1) : fivesimPhone;
  const phoneWithPrefix = fivesimPhone.startsWith("+") ? fivesimPhone : `+${fivesimPhone}`;

  const smsContext = {
    ...baseContext,
    phone,
    phoneWithPrefix,
    smsCode: "",
    fivesimOrderId
  };

  // ── Step 2: Submit phone number to target service ──
  const phoneTemplate = site.sms_submit_phone_template || site.submit_body_template || '{}';
  const phoneHeaders = site.submit_headers_template || "{}";
  const phoneUrl = site.submit_api_url;
  const phoneMethod = site.submit_http_method || "POST";

  const renderedPhoneHeaders = renderJsonTemplate(phoneHeaders, smsContext);
  const renderedPhoneBody = renderJsonTemplate(phoneTemplate, smsContext);
  const parsedPhoneHeaders = typeof renderedPhoneHeaders === "string"
    ? safeParseJson(renderedPhoneHeaders, {})
    : renderedPhoneHeaders;
  const parsedPhoneBody = typeof renderedPhoneBody === "string"
    ? safeParseJson(renderedPhoneBody, renderedPhoneBody)
    : renderedPhoneBody;
  const phoneBodyString = phoneMethod === "GET" ? "" : JSON.stringify(parsedPhoneBody);

  applyAuthHeaders(parsedPhoneHeaders, {
    url: phoneUrl,
    authType: site.auth_type,
    authConfig: site.auth_config
  }, phoneBodyString);

  let phoneResponse;
  try {
    const origin = getUrlOrigin(phoneUrl);
    const fetchHeaders = {
      "User-Agent": BROWSER_UA,
      "Accept": "application/json, text/plain, */*",
      "Referer": origin ? `${origin}/` : undefined,
      "Origin": origin || undefined,
      "Content-Type": "application/json",
      ...parsedPhoneHeaders
    };
    if (site?.request_cookies) {
      fetchHeaders.Cookie = site.request_cookies;
    }
    const resp = await fetch(phoneUrl, {
      method: phoneMethod,
      headers: fetchHeaders,
      body: phoneMethod === "GET" ? undefined : phoneBodyString,
      signal: AbortSignal.timeout((site.timeout_seconds || 15) * 1000)
    });
    const text = await resp.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    phoneResponse = { ok: resp.ok, status: resp.status, text, json };
  } catch (error) {
    phoneResponse = { ok: false, status: 599, text: error.message, json: null };
  }

  // Evaluate phone submission success
  const phoneSuccessRule = site.submit_success_rule;
  const phoneSuccess = phoneSuccessRule
    ? evaluateRule(phoneSuccessRule, phoneResponse)
    : phoneResponse.ok;

  if (!phoneSuccess) {
    // Phone submission failed — cancel 5sim order and retry
    try {
      await setStatus(apiKey, fivesimOrderId, "cancel");
    } catch (cancelErr) {
      console.error(`[KaWang worker] 5sim cancel failed after phone submit error:`, cancelErr.message);
    }
    updateJobPayload(job.id, { fivesimStatus: "cancelled" });

    const errorMessage = formatRemoteErrorMessage(phoneResponse, phoneResponse.text || `HTTP ${phoneResponse.status}`);
    if (job.attempt_count + 1 >= maxAttempts) {
      markFailed(job.id, order.id, cdkey.id, errorMessage, phoneResponse);
    } else {
      markRetry(job, order.id, errorMessage, phoneResponse, maxAttempts);
    }
    return;
  }

  // ── Step 3: Poll for verification code ──
  const configuredPollIntervalMs = Number(site.sms_poll_interval_ms);
  const configuredPollTimeoutMs = Number(site.sms_poll_timeout_ms);
  const pollIntervalMs = Number.isFinite(configuredPollIntervalMs) && configuredPollIntervalMs > 0
    ? Math.max(configuredPollIntervalMs, POLL_INTERVAL_MS)
    : POLL_INTERVAL_MS;
  const pollTimeoutMs = Number.isFinite(configuredPollTimeoutMs) && configuredPollTimeoutMs > 0
    ? Math.min(configuredPollTimeoutMs, POLL_TIMEOUT_MS)
    : POLL_TIMEOUT_MS;
  const maxPollRounds = Math.max(1, Math.floor(pollTimeoutMs / pollIntervalMs));

  let smsCode = null;

  for (let round = 0; round < maxPollRounds; round++) {
    if (round > 0) await sleep(pollIntervalMs);

    // Increment poll count in payload
    const currentPayload = safeParseJson(
      db.prepare("SELECT payload FROM activation_jobs WHERE id = ?").get(job.id)?.payload,
      {}
    );
    updateJobPayload(job.id, { fivesimPollCount: (currentPayload.fivesimPollCount || 0) + 1 });

    let statusResult;
    try {
      statusResult = await getStatus(apiKey, fivesimOrderId);
    } catch (err) {
      // Network error during polling — retry the job
      const errMsg = err.message || "unknown error";
      let retryMessage;
      if (errMsg.includes("failed:")) {
        retryMessage = `5sim: network: ${errMsg}`;
      } else {
        retryMessage = `5sim: ${errMsg}`;
      }

      try {
        await setStatus(apiKey, fivesimOrderId, "cancel");
      } catch (cancelErr) {
        console.error(`[KaWang worker] 5sim cancel failed after poll error:`, cancelErr.message);
      }
      updateJobPayload(job.id, { fivesimStatus: "cancelled" });

      if (job.attempt_count + 1 >= maxAttempts) {
        markFailed(job.id, order.id, cdkey.id, retryMessage, null);
      } else {
        markRetry(job, order.id, retryMessage, null, maxAttempts);
      }
      return;
    }

    if (statusResult.status === "cancelled") {
      // 5sim order was cancelled externally
      updateJobPayload(job.id, { fivesimStatus: "cancelled" });
      if (job.attempt_count + 1 >= maxAttempts) {
        markFailed(job.id, order.id, cdkey.id, "5sim: 订单已被取消", null);
      } else {
        markRetry(job, order.id, "5sim: 订单已被取消", null, maxAttempts);
      }
      return;
    }

    if (statusResult.status === "ok" && statusResult.code) {
      smsCode = statusResult.code;
      updateJobPayload(job.id, { fivesimCode: smsCode, fivesimStatus: "code_received" });
      break;
    }

    // status === "waiting" — continue polling
  }

  // ── Step 4: Handle poll timeout ──
  if (!smsCode) {
    // Timed out waiting for code — cancel and retry
    try {
      await setStatus(apiKey, fivesimOrderId, "cancel");
    } catch (cancelErr) {
      console.error(`[KaWang worker] 5sim cancel failed after poll timeout:`, cancelErr.message);
    }
    updateJobPayload(job.id, { fivesimStatus: "cancelled" });

    if (job.attempt_count + 1 >= maxAttempts) {
      markFailed(job.id, order.id, cdkey.id, "5sim: 验证码接收超时", null);
    } else {
      markRetry(job, order.id, "5sim: 验证码接收超时", null, maxAttempts);
    }
    return;
  }

  // ── Step 5: Submit verification code to target service ──
  const codeContext = {
    ...baseContext,
    phone,
    phoneWithPrefix,
    smsCode,
    fivesimOrderId
  };

  const codeTemplate = site.sms_submit_code_template || site.submit_body_template || '{}';
  const codeHeaders = site.submit_headers_template || "{}";
  const codeUrl = site.submit_api_url;
  const codeMethod = site.submit_http_method || "POST";

  const renderedCodeHeaders = renderJsonTemplate(codeHeaders, codeContext);
  const renderedCodeBody = renderJsonTemplate(codeTemplate, codeContext);
  const parsedCodeHeaders = typeof renderedCodeHeaders === "string"
    ? safeParseJson(renderedCodeHeaders, {})
    : renderedCodeHeaders;
  const parsedCodeBody = typeof renderedCodeBody === "string"
    ? safeParseJson(renderedCodeBody, renderedCodeBody)
    : renderedCodeBody;
  const codeBodyString = codeMethod === "GET" ? "" : JSON.stringify(parsedCodeBody);

  applyAuthHeaders(parsedCodeHeaders, {
    url: codeUrl,
    authType: site.auth_type,
    authConfig: site.auth_config
  }, codeBodyString);

  let codeResponse;
  try {
    const origin = getUrlOrigin(codeUrl);
    const fetchHeaders = {
      "User-Agent": BROWSER_UA,
      "Accept": "application/json, text/plain, */*",
      "Referer": origin ? `${origin}/` : undefined,
      "Origin": origin || undefined,
      "Content-Type": "application/json",
      ...parsedCodeHeaders
    };
    if (site?.request_cookies) {
      fetchHeaders.Cookie = site.request_cookies;
    }
    const resp = await fetch(codeUrl, {
      method: codeMethod,
      headers: fetchHeaders,
      body: codeMethod === "GET" ? undefined : codeBodyString,
      signal: AbortSignal.timeout((site.timeout_seconds || 15) * 1000)
    });
    const text = await resp.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    codeResponse = { ok: resp.ok, status: resp.status, text, json };
  } catch (error) {
    codeResponse = { ok: false, status: 599, text: error.message, json: null };
  }

  // Evaluate code submission success
  const codeSuccessRule = site.submit_success_rule;
  const codeSuccess = codeSuccessRule
    ? evaluateRule(codeSuccessRule, codeResponse)
    : codeResponse.ok;

  if (!codeSuccess) {
    // Code submission failed — cancel-before-fail: attempt to cancel 5sim order
    try {
      await setStatus(apiKey, fivesimOrderId, "cancel");
    } catch (cancelErr) {
      console.error(`[KaWang worker] 5sim cancel failed after code submit error:`, cancelErr.message);
    }
    updateJobPayload(job.id, { fivesimStatus: "cancelled" });

    // Mark as failed (code is consumed, cannot retry)
    const errorMessage = formatRemoteErrorMessage(codeResponse, codeResponse.text || `HTTP ${codeResponse.status}`);
    markFailed(job.id, order.id, cdkey.id, errorMessage, codeResponse);
    return;
  }

  // ── Step 6: Complete 5sim order and mark success ──
  try {
    await setStatus(apiKey, fivesimOrderId, "finish");
  } catch (finishErr) {
    console.error(`[KaWang worker] 5sim finish call failed:`, finishErr.message);
  }
  updateJobPayload(job.id, { fivesimStatus: "completed" });
  markSuccess(job.id, order.id, cdkey.id, codeResponse);
}

async function queryRemoteTask(queryUrl, site, context) {
  try {
    const method = (site?.query_http_method || "GET").toUpperCase();
    const origin = getUrlOrigin(queryUrl);
    const baseHeaders = {
      "User-Agent": BROWSER_UA,
      "Accept": "application/json, text/plain, */*",
      "Referer": origin ? `${origin}/` : undefined,
      "Content-Type": "application/json"
    };
    if (site?.query_headers_template && context) {
      const rendered = renderJsonTemplate(site.query_headers_template, context);
      const extra = typeof rendered === "string" ? safeParseJson(rendered, {}) : rendered;
      Object.assign(baseHeaders, extra);
    }
    if (site?.request_cookies) {
      baseHeaders.Cookie = site.request_cookies;
    }

    let bodyString;
    if (method !== "GET" && site?.query_body_template && context) {
      const rendered = renderJsonTemplate(site.query_body_template, context);
      bodyString = typeof rendered === "string" ? rendered : JSON.stringify(rendered);
    }

    const response = await fetch(queryUrl, {
      method,
      headers: baseHeaders,
      body: method === "GET" ? undefined : bodyString,
      signal: AbortSignal.timeout((site.timeout_seconds || 15) * 1000)
    });
    const text = await response.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    return { ok: response.ok, status: response.status, text, json };
  } catch (error) {
    return { ok: false, status: 599, text: error.message, json: null };
  }
}

function getJsonByPath(json, dotPath) {
  if (!json || !dotPath) return undefined;
  const segments = String(dotPath).split(".").filter(Boolean);
  let current = json;
  for (const segment of segments) {
    if (current === null || current === undefined) return undefined;
    current = current[segment];
  }
  return current;
}

async function pollRemoteTask(job, order, cdkey, site, remoteTaskId, endpoint) {
  const maxAttempts = site?.max_retries || job.max_attempts || 10;
  const querySuccessRule = site.query_success_rule;
  const queryFailureRule = site.query_failure_rule;
  const { intervalMs, maxRounds } = getPollingConfig(site);

  const baseContext = buildRequestContext(job, order, cdkey, site, endpoint);
  const queryContext = { ...baseContext, taskId: remoteTaskId };
  let latestQueryResult = null;

  for (let round = 0; round < maxRounds; round++) {
    if (round > 0) await sleep(intervalMs);

    const queryUrl = renderTemplateString(site.query_api_url, queryContext);
    const queryResult = await queryRemoteTask(queryUrl, site, queryContext);
    latestQueryResult = queryResult;

    const isSuccess = (querySuccessRule
      ? evaluateRule(querySuccessRule, queryResult)
      : false) || isKnownSuccessfulTaskStatus(queryResult);
    const queryErrorMessage = formatRemoteErrorMessage(
      queryResult,
      queryResult.json?.error_msg || queryResult.json?.error || queryResult.text || `HTTP ${queryResult.status}`
    );

    if (isSuccess) {
      markSuccess(job.id, order.id, cdkey.id, queryResult);
      return;
    }

    if (shouldTreatAlreadyUsedAsSuccess(site, queryResult, queryErrorMessage)) {
      markSuccess(job.id, order.id, cdkey.id, {
        ...queryResult,
        treatedAsSuccess: true,
        successReason: "666 站点返回 CDK 已使用，按成功处理"
      });
      return;
    }

    if (isNonRetryableFailure(queryResult, queryErrorMessage)) {
      markFailed(job.id, order.id, cdkey.id, queryErrorMessage, queryResult);
      return;
    }

    if ((queryFailureRule && evaluateRule(queryFailureRule, queryResult)) || isKnownFailedTaskStatus(queryResult)) {
      markFailed(job.id, order.id, cdkey.id, queryErrorMessage, queryResult);
      return;
    }

    if (!queryFailureRule) {
      const taskStatus = queryResult.json?.data?.taskStatus;
      if (taskStatus && taskStatus !== "PROCESSING" && taskStatus !== "PENDING") {
        const msg = queryResult.json?.data?.statusMessage || `远端任务失败: ${taskStatus}`;
        markFailed(job.id, order.id, cdkey.id, msg, queryResult);
        return;
      }
    }
  }

  updateJobPayload(job.id, { remoteTaskId });
  const msg = `远端任务仍在处理中，等待下轮继续轮询 (taskId: ${remoteTaskId})`;

  if (job.attempt_count + 1 >= maxAttempts) {
    markFailed(job.id, order.id, cdkey.id, `轮询超过最大重试次数: ${msg}`, latestQueryResult);
    return;
  }

  markRetry(job, order.id, msg, latestQueryResult, maxAttempts);
}

async function processJob(job) {
  const order = db.prepare("SELECT * FROM redeem_orders WHERE id = ?").get(job.order_id);
  const cdkey = db.prepare("SELECT * FROM cdkeys WHERE id = ?").get(job.cdkey_id);
  const site = db.prepare("SELECT * FROM sites WHERE id = ?").get(job.site_id || order?.site_id || cdkey?.site_id);
  const endpoint = db.prepare("SELECT * FROM activation_endpoints WHERE id = ?").get(job.activation_endpoint_id);

  if (!order || !cdkey || (!site && !endpoint)) {
    markFailed(job.id, job.order_id, job.cdkey_id, "任务依赖数据不存在", null);
    return;
  }

  if (site?.sms_provider === "5sim") {
    await processFiveSimJob(job, order, cdkey, site);
    return;
  }

  const jobPayload = safeParseJson(job.payload, {});
  const isPollingEnabled = site?.polling_enabled && site?.query_api_url;

  if (isPollingEnabled && jobPayload.remoteTaskId) {
    await pollRemoteTask(job, order, cdkey, site, jobPayload.remoteTaskId, endpoint);
    return;
  }

  const responseInfo = await invokeEndpoint(job, order, cdkey, site, endpoint);
  const failureRule = site?.submit_failure_rule || endpoint?.failure_rule;
  const successRule = site?.submit_success_rule || endpoint?.success_rule;
  const failureMatched = failureRule ? evaluateRule(failureRule, responseInfo) : false;
  const successMatched = successRule ? evaluateRule(successRule, responseInfo) : responseInfo.ok;
  const taskIdPath = site?.task_id_path || "data";
  const remoteTaskId = isPollingEnabled ? extractRemoteTaskId(responseInfo, taskIdPath) : "";
  const acceptedAsyncTask = Boolean(remoteTaskId) && Number(responseInfo.status) >= 200 && Number(responseInfo.status) < 300;

  if (!failureMatched && isPollingEnabled && (successMatched || acceptedAsyncTask)) {
    if (remoteTaskId) {
      updateJobPayload(job.id, { remoteTaskId: String(remoteTaskId) });
      await pollRemoteTask(job, order, cdkey, site, String(remoteTaskId), endpoint);
      return;
    }
  }

  if (isPollingEnabled && Number(responseInfo.status) === 409) {
    if (remoteTaskId) {
      updateJobPayload(job.id, { remoteTaskId: String(remoteTaskId) });
      await pollRemoteTask(job, order, cdkey, site, String(remoteTaskId), endpoint);
      return;
    }
  }

  if (!failureMatched && successMatched) {
    markSuccess(job.id, order.id, cdkey.id, responseInfo);
    return;
  }

  let errorMessage = formatRemoteErrorMessage(responseInfo, responseInfo.text || `HTTP ${responseInfo.status}`);
  if (errorMessage.includes("<!doctype") || errorMessage.includes("<!DOCTYPE") || errorMessage.includes("<html") || errorMessage.includes("<HTML")) {
    errorMessage = `远端服务器返回 HTML 错误页 (HTTP ${responseInfo.status})`;
  }
  const maxAttempts = site?.max_retries || endpoint?.max_retries || job.max_attempts || 3;

  if (shouldTreatAlreadyUsedAsSuccess(site, responseInfo, errorMessage)) {
    markSuccess(job.id, order.id, cdkey.id, {
      ...responseInfo,
      treatedAsSuccess: true,
      successReason: "666 站点返回 CDK 已使用，按成功处理"
    });
    return;
  }

  if (isNonRetryableFailure(responseInfo, errorMessage)) {
    markFailed(job.id, order.id, cdkey.id, errorMessage, responseInfo);
    return;
  }

  if (job.attempt_count + 1 >= maxAttempts) {
    markFailed(job.id, order.id, cdkey.id, errorMessage, responseInfo);
    return;
  }

  markRetry(job, order.id, errorMessage, responseInfo, maxAttempts);
}

async function tick() {
  const job = claimJob();
  if (!job) return;

  try {
    await processJob(job);
  } catch (error) {
    markFailed(job.id, job.order_id, job.cdkey_id, error.message || "worker 执行失败", null);
  }
}

// ── Notification monitors ──

const NOTIFICATION_TICK_INTERVAL_MS = 1000;
const NOTIFICATION_LOCK_TIMEOUT_MS = 60 * 1000;

function getNotificationGlobalWebhook() {
  const row = db.prepare("SELECT global_feishu_webhook FROM notification_settings WHERE id = 'default'").get();
  return row?.global_feishu_webhook || "";
}

function claimNotificationMonitor() {
  const now = nowIso();
  const expiredLockTime = new Date(Date.now() - NOTIFICATION_LOCK_TIMEOUT_MS).toISOString();

  const candidate = db.prepare(`
    SELECT *
    FROM notification_monitors
    WHERE enabled = 1
      AND (next_run_at IS NULL OR next_run_at <= ?)
      AND (locked_at IS NULL OR locked_at < ?)
    ORDER BY (next_run_at IS NULL) DESC, next_run_at ASC
    LIMIT 1
  `).get(now, expiredLockTime);

  if (!candidate) return null;

  const result = db.prepare(`
    UPDATE notification_monitors
    SET locked_at = ?, locked_by = ?
    WHERE id = ? AND (locked_at IS NULL OR locked_at < ?)
  `).run(now, workerId, candidate.id, expiredLockTime);

  if (!result.changes) return null;
  return { ...candidate, locked_at: now, locked_by: workerId };
}

function recordMonitorEvent({ monitorId, monitorName, eventType, matched, summary, detail }) {
  db.prepare(`
    INSERT INTO notification_events (id, monitor_id, monitor_name, event_type, matched, summary, detail, created_at)
    VALUES (lower(hex(randomblob(8))), ?, ?, ?, ?, ?, ?, ?)
  `).run(
    monitorId || null,
    monitorName || null,
    eventType,
    matched ? 1 : 0,
    summary || null,
    detail ? JSON.stringify(detail) : null,
    nowIso()
  );
}

function updateMonitorAfterRun(monitor, patch) {
  const intervalSeconds = clampIntervalSeconds(monitor.interval_seconds || 60);
  const next = addSeconds(nowIso(), intervalSeconds);
  db.prepare(`
    UPDATE notification_monitors
    SET last_run_at = ?, last_match_at = COALESCE(?, last_match_at), last_notified_at = COALESCE(?, last_notified_at),
        last_status = ?, last_error = ?, last_response_summary = ?,
        next_run_at = ?, locked_at = NULL, locked_by = NULL, updated_at = ?
    WHERE id = ?
  `).run(
    patch.lastRunAt || nowIso(),
    patch.lastMatchAt || null,
    patch.lastNotifiedAt || null,
    patch.lastStatus || null,
    patch.lastError || null,
    patch.lastResponseSummary ? JSON.stringify(patch.lastResponseSummary) : null,
    next,
    nowIso(),
    monitor.id
  );
}

async function processMonitor(monitor) {
  const startedAt = nowIso();
  const watchFields = normalizeWatchFields(monitor.watch_fields);
  const responseInfo = await fetchMonitorEndpoint(monitor);
  const responseSummary = summarizeResponseInfo(responseInfo);

  if (!responseInfo.ok && responseInfo.status === 0) {
    const errorMessage = responseInfo.text || "请求失败";
    recordMonitorEvent({
      monitorId: monitor.id,
      monitorName: monitor.name,
      eventType: notificationEventTypes.fetchError,
      matched: false,
      summary: `请求失败：${errorMessage.slice(0, 200)}`,
      detail: { response: responseSummary }
    });
    updateMonitorAfterRun(monitor, {
      lastRunAt: startedAt,
      lastStatus: "error",
      lastError: errorMessage,
      lastResponseSummary: responseSummary
    });
    return;
  }

  const ruleResult = evaluateMonitorRules(safeParseJson(monitor.rules_json, null), responseInfo.json);

  if (!ruleResult.matched) {
    recordMonitorEvent({
      monitorId: monitor.id,
      monitorName: monitor.name,
      eventType: notificationEventTypes.notMatched,
      matched: false,
      summary: `未命中 (HTTP ${responseInfo.status})`,
      detail: { response: responseSummary, rules: ruleResult, watchFields }
    });
    updateMonitorAfterRun(monitor, {
      lastRunAt: startedAt,
      lastStatus: responseInfo.ok ? "no_match" : "http_error",
      lastError: responseInfo.ok ? null : `HTTP ${responseInfo.status}`,
      lastResponseSummary: responseSummary
    });
    return;
  }

  // Matched — apply cooldown if configured.
  const cooldownSeconds = Number(monitor.cooldown_seconds || 0);
  if (cooldownSeconds > 0 && monitor.last_notified_at) {
    const lastNotifiedMs = Date.parse(monitor.last_notified_at);
    if (Number.isFinite(lastNotifiedMs) && (Date.now() - lastNotifiedMs) < cooldownSeconds * 1000) {
      recordMonitorEvent({
        monitorId: monitor.id,
        monitorName: monitor.name,
        eventType: notificationEventTypes.matched,
        matched: true,
        summary: `命中但处于冷却期，未发送（剩余 ${Math.ceil((cooldownSeconds * 1000 - (Date.now() - lastNotifiedMs)) / 1000)}s）`,
        detail: { response: responseSummary, rules: ruleResult, watchFields, suppressed: true }
      });
      updateMonitorAfterRun(monitor, {
        lastRunAt: startedAt,
        lastMatchAt: startedAt,
        lastStatus: "matched_cooldown",
        lastResponseSummary: responseSummary
      });
      return;
    }
  }

  recordMonitorEvent({
    monitorId: monitor.id,
    monitorName: monitor.name,
    eventType: notificationEventTypes.matched,
    matched: true,
    summary: `命中规则 (HTTP ${responseInfo.status})`,
    detail: { response: responseSummary, rules: ruleResult, watchFields }
  });

  const webhookUrl = monitor.feishu_webhook_override || getNotificationGlobalWebhook();
  if (!webhookUrl) {
    recordMonitorEvent({
      monitorId: monitor.id,
      monitorName: monitor.name,
      eventType: notificationEventTypes.sendError,
      matched: true,
      summary: "命中但未配置飞书 Webhook，未发送",
      detail: { rules: ruleResult }
    });
    updateMonitorAfterRun(monitor, {
      lastRunAt: startedAt,
      lastMatchAt: startedAt,
      lastStatus: "matched_no_webhook",
      lastError: "未配置飞书 Webhook",
      lastResponseSummary: responseSummary
    });
    return;
  }

  const message = buildFeishuMarkdown({
    monitorName: monitor.name,
    monitorUrl: monitor.request_url,
    matchMode: ruleResult.matchMode,
    matchedItems: ruleResult.matchedItems,
    watchFields,
    responseJson: responseInfo.json,
    timestamp: startedAt,
    customTitle: monitor.notify_title || `KaWang 监听触发：${monitor.name}`
  });

  const sendResult = await sendFeishuMarkdown(webhookUrl, message);

  if (sendResult.ok) {
    recordMonitorEvent({
      monitorId: monitor.id,
      monitorName: monitor.name,
      eventType: notificationEventTypes.sendOk,
      matched: true,
      summary: "飞书通知发送成功",
      detail: { message, result: sendResult }
    });
    updateMonitorAfterRun(monitor, {
      lastRunAt: startedAt,
      lastMatchAt: startedAt,
      lastNotifiedAt: startedAt,
      lastStatus: "notified",
      lastError: null,
      lastResponseSummary: responseSummary
    });
    return;
  }

  const sendError = `飞书发送失败：${(sendResult.text || sendResult.status || "未知错误").toString().slice(0, 200)}`;
  recordMonitorEvent({
    monitorId: monitor.id,
    monitorName: monitor.name,
    eventType: notificationEventTypes.sendError,
    matched: true,
    summary: sendError,
    detail: { message, result: sendResult }
  });
  updateMonitorAfterRun(monitor, {
    lastRunAt: startedAt,
    lastMatchAt: startedAt,
    lastStatus: "send_error",
    lastError: sendError,
    lastResponseSummary: responseSummary
  });
}

async function notificationTick() {
  // Drain due monitors quickly so that 1-second polling is responsive.
  for (let i = 0; i < 50; i++) {
    const monitor = claimNotificationMonitor();
    if (!monitor) return;

    try {
      await processMonitor(monitor);
    } catch (error) {
      const message = error?.message || "监听任务执行异常";
      recordMonitorEvent({
        monitorId: monitor.id,
        monitorName: monitor.name,
        eventType: notificationEventTypes.fetchError,
        matched: false,
        summary: `执行异常：${message.slice(0, 200)}`,
        detail: { error: message }
      });
      updateMonitorAfterRun(monitor, {
        lastRunAt: nowIso(),
        lastStatus: "error",
        lastError: message
      });
    }
  }
}

// ── Quota sub-card auto-unlock ──

const QUOTA_UNLOCK_INTERVAL_MS = 60 * 1000; // 每分钟检查一次

function quotaUnlockTick() {
  const now = nowIso();
  const expiredCards = db.prepare(`
    SELECT id FROM quota_sub_cards
    WHERE status = 'locked' AND locked_until < ?
  `).all(now);

  if (expiredCards.length === 0) return;

  const updateStmt = db.prepare(`
    UPDATE quota_sub_cards
    SET status = 'active', locked_at = NULL, locked_until = NULL, lock_reason = NULL, updated_at = ?
    WHERE id = ?
  `);

  for (const card of expiredCards) {
    updateStmt.run(now, card.id);
  }

  console.log(`[KaWang worker] quota-unlock: unlocked ${expiredCards.length} expired sub-card(s)`);
}

// ── Quota low stock notification ──

const QUOTA_LOW_STOCK_INTERVAL_MS = 5 * 60 * 1000; // 每 5 分钟检查一次
const QUOTA_LOW_STOCK_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 小时内不重复发送

async function quotaLowStockTick() {
  const settings = db.prepare(
    "SELECT low_stock_threshold, last_low_stock_notify_at FROM quota_settings WHERE id = 'default'"
  ).get();

  if (!settings) return;

  const threshold = settings.low_stock_threshold ?? 5;
  const availableQuota = getAvailableQuota(db);

  if (availableQuota >= threshold) return;

  // Check 24-hour cooldown
  if (settings.last_low_stock_notify_at) {
    const lastNotifyMs = Date.parse(settings.last_low_stock_notify_at);
    if (Number.isFinite(lastNotifyMs) && (Date.now() - lastNotifyMs) < QUOTA_LOW_STOCK_COOLDOWN_MS) {
      return;
    }
  }

  // Get feishu webhook URL (use global notification webhook)
  const webhookUrl = getNotificationGlobalWebhook();
  if (!webhookUrl) {
    console.log("[KaWang worker] quota-low-stock: 低库存告警触发但未配置飞书 Webhook");
    return;
  }

  // Send notification
  const now = nowIso();
  const message = {
    title: "KaWang 低库存警告",
    content: [
      `**触发时间**：${now}`,
      `**当前可分配额度**：${availableQuota}`,
      `**低库存阈值**：${threshold}`,
      "",
      "可分配额度已低于设定阈值，请及时补充卡密。"
    ].join("\n")
  };

  const result = await sendFeishuMarkdown(webhookUrl, message);

  if (result.ok) {
    // Update last_low_stock_notify_at
    db.prepare(
      "UPDATE quota_settings SET last_low_stock_notify_at = ?, updated_at = ? WHERE id = 'default'"
    ).run(now, now);
    console.log(`[KaWang worker] quota-low-stock: 低库存通知已发送 (available=${availableQuota}, threshold=${threshold})`);
  } else {
    console.error(`[KaWang worker] quota-low-stock: 飞书通知发送失败 - ${result.text || result.status}`);
  }
}

// ── SMS Poll Task Manager ──

const activePollTasks = new Map(); // publicKey → PollTask
const MAX_ACTIVE_POLLS = 100;
const POLL_INTERVAL_MS = 10000;
const POLL_TIMEOUT_MS = 60000; // 1 分钟
const POLL_HTTP_TIMEOUT_MS = 10000; // 10 秒

/**
 * Submit a successfully fetched verification code to the API Server's internal endpoint.
 */
async function submitVerification(publicKey, code, smsEntryId) {
  const url = `${env.apiUrl}/api/internal/sms/verification`;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Secret": env.internalSecret
      },
      body: JSON.stringify({ publicKey, verificationCode: code, smsEntryId }),
      signal: AbortSignal.timeout(POLL_HTTP_TIMEOUT_MS)
    });
    if (!response.ok) {
      console.error(`[SMS Poll] submitVerification failed for ${publicKey}: HTTP ${response.status}`);
    }
  } catch (error) {
    console.error(`[SMS Poll] submitVerification error for ${publicKey}:`, error.message);
  }
}

/**
 * Report a poll timeout to the API Server's internal endpoint.
 */
async function reportTimeout(publicKey) {
  const url = `${env.apiUrl}/api/internal/sms/timeout`;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Secret": env.internalSecret
      },
      body: JSON.stringify({ publicKey }),
      signal: AbortSignal.timeout(POLL_HTTP_TIMEOUT_MS)
    });
    if (!response.ok) {
      console.error(`[SMS Poll] reportTimeout failed for ${publicKey}: HTTP ${response.status}`);
    }
  } catch (error) {
    console.error(`[SMS Poll] reportTimeout error for ${publicKey}:`, error.message);
  }
}

class PollTask {
  constructor(publicKey, smsUrl, smsEntryId) {
    this.publicKey = publicKey;
    this.smsUrl = smsUrl;
    this.smsEntryId = smsEntryId;
    this.startedAt = Date.now();
    this.intervalId = null;
    this.attemptCount = 0;
  }

  start() {
    this.poll(); // 立即执行第一次
    this.intervalId = setInterval(() => this.poll(), POLL_INTERVAL_MS);
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    activePollTasks.delete(this.publicKey);
  }

  async poll() {
    this.attemptCount++;

    // 超时检查
    if (Date.now() - this.startedAt >= POLL_TIMEOUT_MS) {
      await reportTimeout(this.publicKey);
      this.stop();
      return;
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), POLL_HTTP_TIMEOUT_MS);

      const response = await fetch(this.smsUrl, {
        signal: controller.signal,
        headers: { "User-Agent": BROWSER_UA }
      });
      clearTimeout(timeout);

      if (response.ok) {
        const text = (await response.text()).trim();
        const verificationCode = extractSmsVerificationCode(text);
        if (verificationCode) {
          await submitVerification(this.publicKey, verificationCode, this.smsEntryId);
          this.stop();
          return;
        }
      }
    } catch (error) {
      console.error(`[SMS Poll] ${this.publicKey} attempt ${this.attemptCount} failed:`, error.message);
    }
  }
}

/**
 * Start a new poll task for the given publicKey.
 * Deduplication: ignores if a task for the same publicKey is already active.
 * Capacity check: rejects if active tasks have reached MAX_ACTIVE_POLLS.
 */
function startPollTask(publicKey, smsUrl, smsEntryId) {
  // 去重：同一 publicKey 已有活跃任务时忽略
  if (activePollTasks.has(publicKey)) {
    return { accepted: false, reason: "already_polling" };
  }
  // 容量检查
  if (activePollTasks.size >= MAX_ACTIVE_POLLS) {
    return { accepted: false, reason: "capacity_full" };
  }
  const task = new PollTask(publicKey, smsUrl, smsEntryId);
  activePollTasks.set(publicKey, task);
  task.start();
  return { accepted: true };
}

// Export for testing
export { PollTask, activePollTasks, MAX_ACTIVE_POLLS, POLL_INTERVAL_MS, POLL_TIMEOUT_MS, POLL_HTTP_TIMEOUT_MS, submitVerification, reportTimeout, startPollTask, processFiveSimJob };

// ── Worker Internal HTTP Service ──

/**
 * Lightweight HTTP server that listens for poll trigger requests from the API Server.
 * Exposes POST /api/internal/sms/poll to receive {publicKey, smsUrl, smsEntryId}.
 * Uses X-Internal-Secret header for authentication.
 */
function createWorkerHttpServer() {
  const server = http.createServer((req, res) => {
    if (req.method !== "POST" || !["/api/internal/sms/poll", "/api/internal/sub2api/worldcup/sync"].includes(req.url)) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ message: "not found" }));
      return;
    }

    // Auth check
    const secret = req.headers["x-internal-secret"];
    if (secret !== env.internalSecret) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ message: "unauthorized" }));
      return;
    }

    if (isMaintenanceEnabled()) {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ message: "系统正在迁移维护，请稍后再试", code: "MAINTENANCE_MODE" }));
      return;
    }

    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", async () => {
      let parsed;
      try {
        parsed = body ? JSON.parse(body) : {};
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ message: "invalid JSON" }));
        return;
      }

      if (req.url === "/api/internal/sub2api/worldcup/sync") {
        try {
          const result = await apiFootballWorldCupTick({
            force: true,
            sportteryOddsMatches: Array.isArray(parsed.sportteryOddsMatches) ? parsed.sportteryOddsMatches : [],
            sportteryBrowserError: String(parsed.sportteryBrowserError || "")
          });
          if (result.accepted) {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(result));
            return;
          }
          const status = result.reason === "already_running" ? 409 : 400;
          res.writeHead(status, { "Content-Type": "application/json" });
          res.end(JSON.stringify(result));
        } catch (error) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ accepted: false, message: error.message || "worldcup sync failed" }));
        }
        return;
      }

      const { publicKey, smsUrl, smsEntryId } = parsed;
      if (!publicKey || !smsUrl || !smsEntryId) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ message: "参数不正确" }));
        return;
      }

      const result = startPollTask(publicKey, smsUrl, smsEntryId);

      if (result.accepted) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ accepted: true }));
      } else if (result.reason === "already_polling") {
        res.writeHead(409, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ accepted: false, reason: "already_polling" }));
      } else if (result.reason === "capacity_full") {
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ accepted: false, reason: "capacity_full" }));
      } else {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ accepted: false, reason: "unknown" }));
      }
    });
  });

  return server;
}

// Start the internal HTTP server
const workerHttpServer = createWorkerHttpServer();
workerHttpServer.listen(env.workerInternalPort, "127.0.0.1", () => {
  console.log(`[KaWang worker] internal HTTP server listening on 127.0.0.1:${env.workerInternalPort}`);
});

export { createWorkerHttpServer, workerHttpServer };

console.log(`[KaWang worker] started with poll interval ${env.workerPollMs}ms`);

setInterval(() => {
  if (isMaintenanceEnabled()) return;
  tick().catch((error) => {
    console.error("[KaWang worker]", error);
  });
}, env.workerPollMs);

setInterval(() => {
  if (isMaintenanceEnabled()) return;
  notificationTick().catch((error) => {
    console.error("[KaWang worker] notification", error);
  });
}, NOTIFICATION_TICK_INTERVAL_MS);

setInterval(() => {
  if (isMaintenanceEnabled()) return;
  try {
    quotaUnlockTick();
  } catch (error) {
    console.error("[KaWang worker] quota-unlock", error);
  }
}, QUOTA_UNLOCK_INTERVAL_MS);

setInterval(() => {
  if (isMaintenanceEnabled()) return;
  quotaLowStockTick().catch((error) => {
    console.error("[KaWang worker] quota-low-stock", error);
  });
}, QUOTA_LOW_STOCK_INTERVAL_MS);

setInterval(() => {
  if (isMaintenanceEnabled()) return;
  apiFootballWorldCupTick().catch((error) => {
    console.error("[KaWang worker] worldcup", error);
  });
}, 30000);

setInterval(() => {
  if (isMaintenanceEnabled()) return;
  storeFulfillmentRunner.tick().catch((error) => {
    console.error("[KaWang worker] store-fulfillment", error);
  });
}, 5000);

if (!isMaintenanceEnabled()) {
  tick().catch((error) => {
    console.error("[KaWang worker]", error);
  });

  notificationTick().catch((error) => {
    console.error("[KaWang worker] notification", error);
  });

  try {
    quotaUnlockTick();
  } catch (error) {
    console.error("[KaWang worker] quota-unlock", error);
  }

  quotaLowStockTick().catch((error) => {
    console.error("[KaWang worker] quota-low-stock", error);
  });

  apiFootballWorldCupTick().catch((error) => {
    console.error("[KaWang worker] worldcup", error);
  });

  storeFulfillmentRunner.tick().catch((error) => {
    console.error("[KaWang worker] store-fulfillment", error);
  });

}
