import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import Database from "better-sqlite3";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const command = process.argv[2] || "";
const argument = process.argv[3] || "";
const extra = process.argv[4] || "";
loadEnvironmentFile(path.join(projectRoot, ".env"));
loadEnvironmentFile(path.join(projectRoot, "config", ".env.example"));
const logsDir = resolveProjectPath("logs");
const statePath = path.join(logsDir, "update-state.json");
const maintenancePath = resolveProjectPath(process.env.MAINTENANCE_PATH || "./data/maintenance.json");
const databasePath = resolveProjectPath(process.env.DATABASE_PATH || "./data/kawang.db");

function resolveProjectPath(...parts) {
  if (parts.length === 1 && path.isAbsolute(parts[0])) return parts[0];
  return path.join(projectRoot, ...parts);
}

function loadEnvironmentFile(filePath) {
  let contents;
  try {
    contents = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  for (const sourceLine of contents.split(/\r?\n/)) {
    const line = sourceLine.trim().replace(/^export\s+/, "");
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || process.env[key] !== undefined) continue;
    let value = line.slice(separator + 1).trim();
    if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, "").trim();
    }
    process.env[key] = value;
  }
}

function readJson(filePath, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporaryPath, filePath);
}

function gitValue(args) {
  try {
    return execFileSync("git", args, {
      cwd: resolveProjectPath(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim() || null;
  } catch {
    return null;
  }
}

function writeState(status, error = null) {
  const previous = readJson(statePath, {});
  const now = new Date().toISOString();
  const next = {
    status,
    startedAt: status === "running"
      ? (previous.status === "running" ? (previous.startedAt || now) : now)
      : (previous.startedAt || null),
    endedAt: status === "running" ? null : now,
    localCommit: gitValue(["rev-parse", "HEAD"]) || previous.localCommit || null,
    remoteCommit: previous.remoteCommit || null,
    branch: gitValue(["rev-parse", "--abbrev-ref", "HEAD"]) || previous.branch || null,
    hasUpdate: false,
    error: error || null,
    processId: status === "running" ? process.ppid : null
  };
  writeJson(statePath, next);
}

function enterMaintenance(updateId) {
  if (!updateId) throw new Error("update id is required");
  if (fs.existsSync(maintenancePath)) {
    const current = readJson(maintenancePath, {});
    if (!canResumeOnlineMaintenance(current)) {
      throw new Error(`maintenance mode is already active (${current.reason || "unknown"})`);
    }
    writeJson(maintenancePath, {
      ...current,
      previousUpdateId: current.updateId || null,
      updateId,
      resumedAt: new Date().toISOString()
    });
    return;
  }
  writeJson(maintenancePath, {
    reason: "online_update",
    actor: "system-update",
    updateId,
    startedAt: new Date().toISOString()
  });
}

function leaveMaintenance(updateId) {
  const current = readJson(maintenancePath, null);
  if (!current) return;
  if (!canLeaveMaintenance(current, updateId)) {
    throw new Error("refusing to remove maintenance marker owned by another operation");
  }
  fs.rmSync(maintenancePath);
}

function canResumeOnlineMaintenance(current) {
  return current?.reason === "online_update";
}

function canLeaveMaintenance(current, updateId) {
  return current?.reason === "online_update" && current?.updateId === updateId;
}

function membershipLease() {
  if (!fs.existsSync(databasePath)) return null;
  const database = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    const table = database.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='membership_processor_lease'`).get();
    if (!table) return null;
    return database.prepare(`SELECT status,version,heartbeat_at,expires_at FROM membership_processor_lease WHERE id='default'`).get() || null;
  } finally {
    database.close();
  }
}

async function backupDatabase(destination) {
  if (!destination) throw new Error("backup destination is required");
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const database = new Database(databasePath, { fileMustExist: true });
  try {
    await database.backup(destination);
  } finally {
    database.close();
  }
  const backup = new Database(destination, { readonly: true, fileMustExist: true });
  try {
    const result = backup.pragma("integrity_check", { simple: true });
    if (result !== "ok") throw new Error(`database backup integrity check failed: ${result}`);
  } finally {
    backup.close();
  }
}

function leaseIsDrained(lease, now = Date.now()) {
  if (!lease || ["standby", "stopped"].includes(lease.status)) return true;
  const expiry = new Date(lease.expires_at || 0).getTime();
  return Number.isFinite(expiry) && expiry <= now;
}

function leaseIsHealthy(lease, expectedVersion, now = Date.now()) {
  if (!lease || lease.status !== "active") return false;
  if (expectedVersion && lease.version !== expectedVersion) return false;
  const heartbeat = new Date(lease.heartbeat_at || 0).getTime();
  const expiry = new Date(lease.expires_at || 0).getTime();
  return Number.isFinite(heartbeat) && now - heartbeat <= 30_000 && Number.isFinite(expiry) && expiry > now;
}

function leaseIsDeployed(lease, expectedVersion, now = Date.now()) {
  if (!lease || !["active", "standby"].includes(lease.status)) return false;
  if (!expectedVersion || lease.version !== expectedVersion) return false;
  const heartbeat = new Date(lease.heartbeat_at || 0).getTime();
  const expiry = new Date(lease.expires_at || 0).getTime();
  return Number.isFinite(heartbeat) && now - heartbeat <= 30_000 && Number.isFinite(expiry) && expiry > now;
}

async function waitForLease(predicate, expectedVersion = "", timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  do {
    const lease = membershipLease();
    if (predicate(lease, expectedVersion, Date.now())) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  } while (Date.now() < deadline);
  const lease = membershipLease();
  throw new Error(`membership worker did not reach the required state: ${JSON.stringify(lease)}`);
}

async function main() {
  switch (command) {
    case "state":
      if (!new Set(["running", "succeeded", "failed"]).has(argument)) throw new Error("invalid update state");
      writeState(argument, extra || null);
      break;
    case "enter-maintenance":
      enterMaintenance(argument);
      break;
    case "leave-maintenance":
      leaveMaintenance(argument);
      break;
    case "wait-membership-standby":
      await waitForLease((lease, _version, now) => leaseIsDrained(lease, now));
      break;
    case "wait-membership-active":
      await waitForLease((lease, version, now) => leaseIsHealthy(lease, version, now), argument);
      break;
    case "wait-membership-deployed":
      await waitForLease((lease, version, now) => leaseIsDeployed(lease, version, now), argument);
      break;
    case "backup-database":
      await backupDatabase(argument);
      break;
    default:
      throw new Error("unknown update runtime command");
  }
}

if (path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

export {
  backupDatabase,
  canLeaveMaintenance,
  canResumeOnlineMaintenance,
  leaseIsDeployed,
  leaseIsDrained,
  leaseIsHealthy
};
