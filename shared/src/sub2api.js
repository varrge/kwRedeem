import jwt from "jsonwebtoken";

export const SUB2API_INVITE_LIMIT = 3;

export const sub2apiInviteStatuses = {
  processing: "processing",
  active: "active",
  failed: "failed"
};

export const sub2apiConnectionStatuses = {
  active: "active",
  disabled: "disabled",
  deleted: "deleted"
};

export const sub2apiSubscriptionPlanStatuses = {
  active: "active",
  disabled: "disabled",
  deleted: "deleted"
};

export const sub2apiSubscriptionOrderStatuses = {
  processing: "processing",
  succeeded: "succeeded",
  failed: "failed"
};

export function normalizeSub2ApiAmount(value, fieldName = "金额") {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error(`${fieldName}必须大于 0`);
  }
  return Math.round(amount * 10000) / 10000;
}

export function normalizeSub2ApiPositiveInteger(value, fieldName) {
  const number = Math.floor(Number(value));
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error(`${fieldName}必须大于 0`);
  }
  return number;
}

export const sub2apiWorldCupMatchStatuses = {
  open: "open",
  locked: "locked",
  finished: "finished",
  settled: "settled",
  cancelled: "cancelled"
};

export const sub2apiWorldCupBetStatuses = {
  debiting: "debiting",
  placed: "placed",
  won: "won",
  lost: "lost",
  refunded: "refunded",
  debitFailed: "debit_failed",
  payoutFailed: "payout_failed",
  refundFailed: "refund_failed"
};

export const sub2apiWorldCupPredictions = {
  home: "home",
  draw: "draw",
  away: "away"
};

export const sub2apiWorldCupBetPhases = {
  preMatch: "pre_match",
  halftime: "halftime"
};

export const SUB2API_WORLDCUP_PRE_MATCH_LOCK_MS = 0;

const SUB2API_WORLDCUP_LIVE_API_STATUSES = new Set(["1H", "2H", "ET", "BT", "P", "SUSP", "INT"]);
const SUB2API_WORLDCUP_HALFTIME_API_STATUSES = new Set(["HT"]);
const SUB2API_WORLDCUP_FINAL_API_STATUSES = new Set(["FT", "AET", "PEN"]);
const SUB2API_WORLDCUP_CANCELLED_API_STATUSES = new Set(["PST", "CANC", "ABD", "AWD", "WO"]);

export function getSub2ApiWorldCupResult(homeScore, awayScore) {
  const home = Number(homeScore);
  const away = Number(awayScore);
  if (!Number.isInteger(home) || !Number.isInteger(away) || home < 0 || away < 0) {
    throw new Error("比分必须是非负整数");
  }
  if (home > away) return sub2apiWorldCupPredictions.home;
  if (home < away) return sub2apiWorldCupPredictions.away;
  return sub2apiWorldCupPredictions.draw;
}

export function roundSub2ApiWorldCupAmount(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 0;
  return Math.round((amount + Number.EPSILON) * 10000) / 10000;
}

export function getSub2ApiWorldCupBetPhaseLabel(phase) {
  if (phase === sub2apiWorldCupBetPhases.preMatch) return "赛前盘";
  if (phase === sub2apiWorldCupBetPhases.halftime) return "中场盘";
  return phase || "-";
}

export function normalizeSub2ApiWorldCupApiStatus(value) {
  return String(value ?? "").trim().toUpperCase();
}

export function isSub2ApiWorldCupApiStatusHalftime(value) {
  return SUB2API_WORLDCUP_HALFTIME_API_STATUSES.has(normalizeSub2ApiWorldCupApiStatus(value));
}

export function isSub2ApiWorldCupApiStatusLive(value) {
  const status = normalizeSub2ApiWorldCupApiStatus(value);
  return SUB2API_WORLDCUP_LIVE_API_STATUSES.has(status) || SUB2API_WORLDCUP_HALFTIME_API_STATUSES.has(status);
}

export function isSub2ApiWorldCupApiStatusFinal(value) {
  return SUB2API_WORLDCUP_FINAL_API_STATUSES.has(normalizeSub2ApiWorldCupApiStatus(value));
}

export function isSub2ApiWorldCupApiStatusCancelled(value) {
  return SUB2API_WORLDCUP_CANCELLED_API_STATUSES.has(normalizeSub2ApiWorldCupApiStatus(value));
}

export function getSub2ApiWorldCupBettingState(match, nowMs = Date.now()) {
  if (!match) {
    return { open: false, phase: null, label: "", reason: "比赛不存在", closesAt: null };
  }
  if ([
    sub2apiWorldCupMatchStatuses.finished,
    sub2apiWorldCupMatchStatuses.settled,
    sub2apiWorldCupMatchStatuses.cancelled
  ].includes(match.status)) {
    return { open: false, phase: null, label: "", reason: "比赛已结束", closesAt: null };
  }

  const halftimeOpenMs = new Date(match.halftime_open_at || match.halftimeOpenAt || "").getTime();
  const halftimeCloseMs = new Date(match.halftime_close_at || match.halftimeCloseAt || "").getTime();
  if (Number.isFinite(halftimeOpenMs) && Number.isFinite(halftimeCloseMs)
    && nowMs >= halftimeOpenMs && nowMs < halftimeCloseMs) {
    return {
      open: true,
      phase: sub2apiWorldCupBetPhases.halftime,
      label: getSub2ApiWorldCupBetPhaseLabel(sub2apiWorldCupBetPhases.halftime),
      reason: "",
      closesAt: new Date(halftimeCloseMs).toISOString()
    };
  }

  const apiStatus = normalizeSub2ApiWorldCupApiStatus(match.api_status_short);
  const kickoffMs = new Date(match.kickoff_at).getTime();
  if (!Number.isFinite(kickoffMs)) {
    return { open: false, phase: null, label: "", reason: "开赛时间无效", closesAt: null };
  }
  const preMatchClosesAt = kickoffMs - SUB2API_WORLDCUP_PRE_MATCH_LOCK_MS;
  if (match.status === sub2apiWorldCupMatchStatuses.open && !apiStatus && nowMs < preMatchClosesAt) {
    return {
      open: true,
      phase: sub2apiWorldCupBetPhases.preMatch,
      label: getSub2ApiWorldCupBetPhaseLabel(sub2apiWorldCupBetPhases.preMatch),
      reason: "",
      closesAt: new Date(preMatchClosesAt).toISOString()
    };
  }
  if (match.status === sub2apiWorldCupMatchStatuses.open && ["NS", "TBD"].includes(apiStatus) && nowMs < preMatchClosesAt) {
    return {
      open: true,
      phase: sub2apiWorldCupBetPhases.preMatch,
      label: getSub2ApiWorldCupBetPhaseLabel(sub2apiWorldCupBetPhases.preMatch),
      reason: "",
      closesAt: new Date(preMatchClosesAt).toISOString()
    };
  }

  if (isSub2ApiWorldCupApiStatusLive(apiStatus)) {
    if (Number.isFinite(halftimeOpenMs) && nowMs < halftimeOpenMs) {
      return { open: false, phase: null, label: "", reason: "比赛进行中，等待中场盘", closesAt: new Date(halftimeOpenMs).toISOString() };
    }
    return { open: false, phase: null, label: "", reason: "比赛进行中", closesAt: null };
  }
  return { open: false, phase: null, label: "", reason: "该比赛已停止竞猜", closesAt: null };
}

export function isSub2ApiWorldCupMatchInProgress(match, nowMs = Date.now()) {
  if (!match || [
    sub2apiWorldCupMatchStatuses.finished,
    sub2apiWorldCupMatchStatuses.settled,
    sub2apiWorldCupMatchStatuses.cancelled
  ].includes(match.status)) {
    return false;
  }
  const apiStatus = normalizeSub2ApiWorldCupApiStatus(match.api_status_short);
  if (isSub2ApiWorldCupApiStatusLive(apiStatus)) return true;
  if (apiStatus) return false;

  const kickoffMs = new Date(match.kickoff_at).getTime();
  return Number.isFinite(kickoffMs)
    && kickoffMs <= nowMs
    && nowMs - kickoffMs <= 3 * 60 * 60 * 1000;
}

export function selectSub2ApiWorldCupDisplayMatches(matches, nowMs = Date.now()) {
  const sorted = [...(matches || [])]
    .filter(Boolean)
    .sort((a, b) => {
      const aTime = new Date(a.kickoff_at ?? a.kickoffAt).getTime();
      const bTime = new Date(b.kickoff_at ?? b.kickoffAt).getTime();
      return (Number.isFinite(aTime) ? aTime : 0) - (Number.isFinite(bTime) ? bTime : 0);
    });
  const isTerminal = (match) => [
    sub2apiWorldCupMatchStatuses.finished,
    sub2apiWorldCupMatchStatuses.settled,
    sub2apiWorldCupMatchStatuses.cancelled
  ].includes(match.status);
  const current = sorted.find((match) => isSub2ApiWorldCupMatchInProgress(match, nowMs));
  const currentTime = current ? new Date(current.kickoff_at ?? current.kickoffAt).getTime() : nowMs;
  const upcoming = sorted.filter((match) => {
    if (current && match.id === current.id) return false;
    if (isTerminal(match) || isSub2ApiWorldCupMatchInProgress(match, nowMs)) return false;
    const kickoffMs = new Date(match.kickoff_at ?? match.kickoffAt).getTime();
    return Number.isFinite(kickoffMs) && kickoffMs >= currentTime;
  });

  const selected = current
    ? [current, ...upcoming.slice(0, 2)]
    : upcoming.slice(0, 2);
  return selected.map((match, index) => ({
    ...match,
    display_role: current
      ? (index === 0 ? "current" : index === 1 ? "next" : "preview")
      : (index === 0 ? "next" : "preview")
  }));
}

export function normalizeSub2ApiBaseUrl(value) {
  const raw = String(value ?? "").trim();
  if (!raw) {
    throw new Error("baseUrl 不能为空");
  }
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("baseUrl 必须是合法 URL");
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("baseUrl 只支持 http 或 https");
  }
  url.pathname = url.pathname.replace(/\/+$/, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/+$/, "");
}

export function decodeSub2ApiSsoSelector(token) {
  const decoded = jwt.decode(token);
  if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) {
    throw new Error("SSO token 无效");
  }
  const selector = decoded.connectionId
    ?? decoded.connection_id
    ?? decoded.connection
    ?? decoded.iss
    ?? "";
  const normalized = String(selector).trim();
  if (!normalized) {
    throw new Error("SSO token 缺少连接标识");
  }
  return normalized;
}

export function extractSub2ApiIdentity(payload) {
  const user = payload?.user && typeof payload.user === "object" ? payload.user : {};
  const userId = payload?.sub
    ?? payload?.userId
    ?? payload?.user_id
    ?? payload?.id
    ?? user.id
    ?? "";
  const normalizedUserId = String(userId).trim();
  if (!normalizedUserId) {
    throw new Error("SSO token 缺少 user.id");
  }
  return {
    userId: normalizedUserId,
    email: String(payload?.email ?? user.email ?? "").trim(),
    username: String(payload?.username ?? payload?.name ?? user.username ?? user.name ?? "").trim()
  };
}

export function extractSub2ApiIdentityFromJwtClaims(token) {
  const payload = jwt.decode(token);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Sub2api 登录 token 内容格式错误");
  }
  return extractSub2ApiIdentity(payload);
}

export function verifySub2ApiSsoToken(token, secret) {
  const payload = jwt.verify(token, secret, { algorithms: ["HS256"] });
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("SSO token 无效");
  }
  return {
    payload,
    identity: extractSub2ApiIdentity(payload)
  };
}

export function unwrapSub2ApiRemoteData(data, depth = 0) {
  if (depth >= 5) return data;
  if (!data || typeof data !== "object" || Array.isArray(data)) return data;
  if (data.data === undefined) return data;
  return unwrapSub2ApiRemoteData(data.data, depth + 1);
}

function getSub2ApiInviteCandidate(payload) {
  if (Array.isArray(payload)) return payload[0] || null;
  if (!payload || typeof payload !== "object") return null;
  for (const key of ["items", "list", "records", "codes", "redeem_codes", "invites", "result", "results", "response", "body", "data"]) {
    const value = payload[key];
    if (Array.isArray(value)) return value[0] || null;
    if (value && typeof value === "object") {
      const nested = getSub2ApiInviteCandidate(value);
      if (nested) return nested;
    }
  }
  return payload;
}

function pickSub2ApiInviteCode(invite) {
  if (typeof invite === "string") {
    return invite.trim();
  }
  for (const key of ["inviteCode", "invite_code", "invitationCode", "invitation_code", "code"]) {
    const value = invite?.[key];
    if (typeof value !== "string") continue;
    const normalized = value.trim();
    if (normalized) return normalized;
  }
  return "";
}

export function extractRemoteSub2ApiInviteResult(result) {
  const data = result?.json && typeof result.json === "object" ? result.json : {};
  const payload = unwrapSub2ApiRemoteData(data);
  const invite = getSub2ApiInviteCandidate(payload);
  const inviteCode = pickSub2ApiInviteCode(invite);
  if (!inviteCode) {
    throw new Error("远程 Sub2api 未返回邀请码 code");
  }
  const rawStatus = String(invite?.status || sub2apiInviteStatuses.active).trim();
  const status = [
    sub2apiInviteStatuses.processing,
    sub2apiInviteStatuses.active,
    sub2apiInviteStatuses.failed,
    "unused"
  ].includes(rawStatus) ? rawStatus : sub2apiInviteStatuses.active;
  return {
    inviteCode,
    remoteInviteId: String(invite?.id ?? invite?.inviteId ?? invite?.invite_id ?? "").trim(),
    status: status === "unused" ? sub2apiInviteStatuses.active : status,
    expiresAt: invite?.expiresAt ?? invite?.expires_at ?? null
  };
}

export function assertSub2ApiRemoteEnvelopeOk(result, getMessage = null) {
  const json = result?.json;
  if (!json || typeof json !== "object") return;
  const readMessage = () => {
    if (typeof getMessage === "function") return getMessage(result);
    return String(json.message || json.msg || json.error || "远程 Sub2api 请求失败").trim() || "远程 Sub2api 请求失败";
  };
  const codeNumber = Number(json.code);
  if (json.code !== undefined && Number.isFinite(codeNumber) && codeNumber !== 0) {
    throw new Error(readMessage());
  }
  if (json.success === false || json.ok === false) {
    throw new Error(readMessage());
  }
}

export function countReservedSub2ApiInvites(db, connectionId, userId) {
  const row = db.prepare(`
    SELECT COUNT(*) AS count
    FROM sub2api_invites
    WHERE connection_id = ?
      AND sub2api_user_id = ?
      AND status <> ?
  `).get(connectionId, userId, sub2apiInviteStatuses.failed);
  return Number(row?.count || 0);
}

export function getSub2ApiInviteQuota(db, connectionId, userId, limit = SUB2API_INVITE_LIMIT) {
  const used = countReservedSub2ApiInvites(db, connectionId, userId);
  return {
    limit,
    used,
    remaining: Math.max(0, limit - used)
  };
}

export function reserveSub2ApiInvite(db, {
  id,
  requestId,
  connectionId,
  userId,
  email = "",
  username = "",
  now
}, limit = SUB2API_INVITE_LIMIT) {
  const reserve = db.transaction(() => {
    const quota = getSub2ApiInviteQuota(db, connectionId, userId, limit);
    if (quota.remaining <= 0) {
      return { ok: false, quota };
    }
    db.prepare(`
      INSERT INTO sub2api_invites (
        id, request_id, connection_id, sub2api_user_id, email, username,
        invite_code, remote_invite_id, status, remote_response, error_message,
        expires_at, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, NULL, NULL, NULL, ?, ?)
    `).run(
      id,
      requestId,
      connectionId,
      userId,
      email || null,
      username || null,
      sub2apiInviteStatuses.processing,
      now,
      now
    );
    return {
      ok: true,
      quota: getSub2ApiInviteQuota(db, connectionId, userId, limit)
    };
  });

  return reserve();
}
