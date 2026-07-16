import { randomUUID } from "node:crypto";

const FAILURE_WINDOW_MS = 5 * 60 * 1000;
const INITIAL_OPEN_MS = 15 * 60 * 1000;
const MAX_OPEN_MS = 60 * 60 * 1000;

const immediateOpenCodes = new Set([
  "SPACEXCARD_AUTH_FAILED",
  "SPACEXCARD_ACCESS_DENIED",
  "SPACEXCARD_CONTRACT_DRIFT",
  "SPACEXCARD_RESPONSE_INVALID",
  "MEMBERSHIP_CONTRACT_UNKNOWN",
  "MEMBERSHIP_PROVIDER_RESPONSE_INVALID",
  "MEMBERSHIP_PROVIDER_RESPONSE_TOO_LARGE"
]);

const knownGlobalTransientCodes = new Set([
  "SPACEXCARD_RATE_LIMITED",
  "SPACEXCARD_TIMEOUT",
  "SPACEXCARD_UNAVAILABLE",
  "SPACEXCARD_RESPONSE_TOO_LARGE",
  "MEMBERSHIP_PROVIDER_RATE_LIMITED",
  "MEMBERSHIP_PROVIDER_TIMEOUT",
  "MEMBERSHIP_PROVIDER_UNAVAILABLE"
]);

function iso(value = Date.now()) {
  const parsed = typeof value === "number" ? value : Date.parse(value);
  if (!Number.isFinite(parsed)) throw new TypeError("熔断时间无效");
  return new Date(parsed).toISOString();
}

function failureClass(error) {
  const code = String(error?.code || "").trim();
  if (!code) return null;
  if (immediateOpenCodes.has(code)) return { code, immediate: true };
  if (error?.retryScope === "global" || knownGlobalTransientCodes.has(code)) {
    return { code, immediate: false };
  }
  return null;
}

export function serializeDependencyCircuit(row) {
  if (!row) return null;
  return {
    id: row.id,
    dependency: row.dependency,
    scopeKey: row.scope_key,
    state: row.state,
    failureCount: row.failure_count,
    openedAt: row.opened_at || null,
    retryAt: row.retry_at || null,
    recoveryRevision: row.recovery_revision,
    reasonCode: row.reason_code || null,
    updatedAt: row.updated_at
  };
}

export function recordDependencyFailure(db, options) {
  const failure = failureClass(options?.error);
  if (!failure) return { tracked: false, openedNow: false, circuit: null };
  const dependency = String(options?.dependency || "").trim();
  const scopeKey = String(options?.scopeKey || "default").trim();
  if (!dependency || !scopeKey) throw new TypeError("熔断依赖或范围无效");
  const at = iso(options?.at);
  return db.transaction(() => {
    const current = db.prepare(`
      SELECT * FROM fulfillment_dependency_circuits
      WHERE dependency = ? AND scope_key = ?
    `).get(dependency, scopeKey);
    const recent = current && Date.parse(at) - Date.parse(current.updated_at) <= FAILURE_WINDOW_MS;
    const failureCount = current?.state === "half_open"
      ? Math.max(3, Number(current.failure_count || 0) + 1)
      : (recent ? Number(current.failure_count || 0) + 1 : 1);
    const openedNow = failure.immediate || current?.state === "half_open" || failureCount >= 3;
    const recoveryRevision = current?.state === "half_open"
      ? Number(current.recovery_revision || 0) + 1
      : Number(current?.recovery_revision || 0);
    const openMs = Math.min(INITIAL_OPEN_MS * (2 ** recoveryRevision), MAX_OPEN_MS);
    const state = openedNow ? "open" : "closed";
    const openedAt = openedNow ? at : null;
    const retryAt = openedNow ? iso(Date.parse(at) + openMs) : null;
    const id = current?.id || `fdc_${randomUUID()}`;
    db.prepare(`
      INSERT INTO fulfillment_dependency_circuits (
        id, dependency, scope_key, state, failure_count, opened_at, retry_at,
        recovery_revision, reason_code, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(dependency, scope_key) DO UPDATE SET
        state = excluded.state,
        failure_count = excluded.failure_count,
        opened_at = excluded.opened_at,
        retry_at = excluded.retry_at,
        recovery_revision = excluded.recovery_revision,
        reason_code = excluded.reason_code,
        updated_at = excluded.updated_at
    `).run(
      id,
      dependency,
      scopeKey,
      state,
      failureCount,
      openedAt,
      retryAt,
      recoveryRevision,
      failure.code,
      at
    );
    const row = db.prepare("SELECT * FROM fulfillment_dependency_circuits WHERE id = ?").get(id);
    return {
      tracked: true,
      openedNow: openedNow && current?.state !== "open",
      circuit: serializeDependencyCircuit(row)
    };
  })();
}

export function acquireDependencyCircuit(db, options) {
  const dependency = String(options?.dependency || "").trim();
  const scopeKey = String(options?.scopeKey || "default").trim();
  if (!dependency || !scopeKey) throw new TypeError("熔断依赖或范围无效");
  const at = iso(options?.at);
  return db.transaction(() => {
    const current = db.prepare(`
      SELECT * FROM fulfillment_dependency_circuits
      WHERE dependency = ? AND scope_key = ?
    `).get(dependency, scopeKey);
    if (!current || current.state === "closed") {
      return { allowed: true, probe: false, circuit: serializeDependencyCircuit(current) };
    }
    if (current.state !== "open" || !current.retry_at || Date.parse(current.retry_at) > Date.parse(at)) {
      return { allowed: false, probe: false, circuit: serializeDependencyCircuit(current) };
    }
    const changed = db.prepare(`
      UPDATE fulfillment_dependency_circuits
      SET state = 'half_open', updated_at = ?
      WHERE id = ? AND state = 'open' AND retry_at <= ?
    `).run(at, current.id, at);
    const row = db.prepare("SELECT * FROM fulfillment_dependency_circuits WHERE id = ?").get(current.id);
    return changed.changes === 1
      ? { allowed: true, probe: true, circuit: serializeDependencyCircuit(row) }
      : { allowed: false, probe: false, circuit: serializeDependencyCircuit(row) };
  })();
}

export function recordDependencySuccess(db, options) {
  const dependency = String(options?.dependency || "").trim();
  const scopeKey = String(options?.scopeKey || "default").trim();
  if (!dependency || !scopeKey) throw new TypeError("熔断依赖或范围无效");
  const at = iso(options?.at);
  db.prepare(`
    UPDATE fulfillment_dependency_circuits
    SET state = 'closed', failure_count = 0, opened_at = NULL, retry_at = NULL,
        recovery_revision = 0, reason_code = NULL, updated_at = ?
    WHERE dependency = ? AND scope_key = ?
  `).run(at, dependency, scopeKey);
  return serializeDependencyCircuit(db.prepare(`
    SELECT * FROM fulfillment_dependency_circuits
    WHERE dependency = ? AND scope_key = ?
  `).get(dependency, scopeKey));
}

export function requestDependencyProbe(db, id, options = {}) {
  const at = iso(options.at);
  const current = db.prepare("SELECT * FROM fulfillment_dependency_circuits WHERE id = ?").get(id);
  if (!current) return { outcome: "not_found", circuit: null };
  if (current.state === "half_open") return { outcome: "already_probing", circuit: serializeDependencyCircuit(current) };
  if (current.state === "closed") return { outcome: "already_closed", circuit: serializeDependencyCircuit(current) };
  db.prepare(`
    UPDATE fulfillment_dependency_circuits
    SET retry_at = ?, updated_at = ? WHERE id = ? AND state = 'open'
  `).run(at, at, current.id);
  return {
    outcome: "scheduled",
    circuit: serializeDependencyCircuit(db.prepare("SELECT * FROM fulfillment_dependency_circuits WHERE id = ?").get(id))
  };
}
