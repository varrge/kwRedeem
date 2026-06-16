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
