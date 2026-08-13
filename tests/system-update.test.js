import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

import { buildUpdateProcessEnv } from "../api/src/system-update.js";
import {
  canLeaveMaintenance,
  canResumeOnlineMaintenance,
  leaseIsDeployed,
  leaseIsDrained,
  leaseIsHealthy
} from "../scripts/update-runtime.js";

test("online updates prefer the Node binary that is running the API over a stale PM2 PATH", () => {
  const env = buildUpdateProcessEnv({
    processEnv: {
      PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
      KEEP_ME: "yes"
    },
    execPath: "/root/.nvm/versions/node/v20.20.2/bin/node"
  });

  assert.equal(
    env.PATH,
    "/root/.nvm/versions/node/v20.20.2/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
  );
  assert.equal(env.KEEP_ME, "yes");
});

test("online update PATH does not duplicate the API Node binary directory", () => {
  const env = buildUpdateProcessEnv({
    processEnv: {
      PATH: "/root/.nvm/versions/node/v20.20.2/bin:/usr/bin:/bin"
    },
    execPath: "/root/.nvm/versions/node/v20.20.2/bin/node"
  });

  assert.equal(env.PATH, "/root/.nvm/versions/node/v20.20.2/bin:/usr/bin:/bin");
});

test("online update environment resolves node to the same runtime as the API", () => {
  const env = buildUpdateProcessEnv({
    processEnv: { PATH: "/usr/bin:/bin" },
    execPath: process.execPath
  });

  const childVersion = execFileSync("node", ["-v"], { env, encoding: "utf8" }).trim();
  assert.equal(childVersion, process.version);
});

test("online update only resumes and releases its own maintenance marker", () => {
  assert.equal(canResumeOnlineMaintenance({ reason: "online_update", updateId: "old" }), true);
  assert.equal(canResumeOnlineMaintenance({ reason: "migration_restore", updateId: "old" }), false);
  assert.equal(canLeaveMaintenance({ reason: "online_update", updateId: "current" }, "current"), true);
  assert.equal(canLeaveMaintenance({ reason: "online_update", updateId: "old" }, "current"), false);
  assert.equal(canLeaveMaintenance({ reason: "migration_restore", updateId: "current" }, "current"), false);
});

test("membership deployment and active health require the exact source version and fresh lease", () => {
  const now = Date.parse("2026-08-13T10:00:00.000Z");
  const lease = {
    status: "standby",
    version: "commit-a",
    heartbeat_at: "2026-08-13T09:59:55.000Z",
    expires_at: "2026-08-13T10:00:15.000Z"
  };

  assert.equal(leaseIsDeployed(lease, "commit-a", now), true);
  assert.equal(leaseIsHealthy(lease, "commit-a", now), false);
  assert.equal(leaseIsDeployed({ ...lease, version: "commit-b" }, "commit-a", now), false);
  assert.equal(leaseIsDeployed({ ...lease, heartbeat_at: "2026-08-13T09:58:00.000Z" }, "commit-a", now), false);
  assert.equal(leaseIsHealthy({ ...lease, status: "active" }, "commit-a", now), true);
});

test("membership drain accepts standby, stopped, absent, or expired leases", () => {
  const now = Date.parse("2026-08-13T10:00:00.000Z");
  assert.equal(leaseIsDrained(null, now), true);
  assert.equal(leaseIsDrained({ status: "standby" }, now), true);
  assert.equal(leaseIsDrained({ status: "stopped" }, now), true);
  assert.equal(leaseIsDrained({ status: "active", expires_at: "2026-08-13T09:59:59.000Z" }, now), true);
  assert.equal(leaseIsDrained({ status: "active", expires_at: "2026-08-13T10:00:15.000Z" }, now), false);
});

test("unified update drains and backs up before pulling or installing dependencies", () => {
  const script = fs.readFileSync(new URL("../scripts/update.sh", import.meta.url), "utf8");
  const maintenance = script.indexOf('enter-maintenance "$UPDATE_ID"');
  const backup = script.indexOf('backup-database "$BACKUP_DIR/kawang-$STAMP.db"');
  const pull = script.indexOf("git pull --ff-only");
  const install = script.lastIndexOf("npm install");
  const migrate = script.indexOf("npm run db:init");
  const deploy = script.lastIndexOf('sudo -n "$MEMBERSHIP_DEPLOY_HELPER"');
  const release = script.indexOf('leave-maintenance "$UPDATE_ID"');

  assert.ok(maintenance >= 0 && maintenance < backup);
  assert.ok(backup < pull && pull < install && install < migrate);
  assert.ok(migrate < deploy && deploy < release);
  assert.match(script, /tmp\/update-runtime-\$UPDATE_ID\.js/);
  assert.match(script, /run_update_runtime state succeeded/);
  assert.match(script, /MEMBERSHIP_DEPLOY_HELPER="\/usr\/local\/sbin\/kawang-membership-deploy"/);
  assert.doesNotMatch(script, /KWMEMBERSHIP_DEPLOY_HELPER:-/);
  assert.match(script, /finish_update\(\) \{\n  local exit_code=\$\?\n  set \+e/);
});

test("the snapshotted update runtime does not import mutable project helpers", () => {
  const runtime = fs.readFileSync(new URL("../scripts/update-runtime.js", import.meta.url), "utf8");
  assert.doesNotMatch(runtime, /shared\/src/);
  assert.match(runtime, /path\.resolve\(path\.dirname\(fileURLToPath\(import\.meta\.url\)\), "\.\."\)/);
});

test("online update creates a readable SQLite backup with committed data", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "kawang-update-backup-"));
  const source = path.join(directory, "source.db");
  const destination = path.join(directory, "backup.db");
  const database = new Database(source);
  try {
    database.exec("CREATE TABLE marker (value TEXT NOT NULL); INSERT INTO marker VALUES ('ready')");
  } finally {
    database.close();
  }

  try {
    execFileSync(process.execPath, ["scripts/update-runtime.js", "backup-database", destination], {
      cwd: path.resolve(new URL("..", import.meta.url).pathname),
      env: { ...process.env, DATABASE_PATH: source },
      stdio: "pipe"
    });
    const backup = new Database(destination, { readonly: true });
    try {
      assert.equal(backup.prepare("SELECT value FROM marker").pluck().get(), "ready");
      assert.equal(backup.pragma("integrity_check", { simple: true }), "ok");
    } finally {
      backup.close();
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("git environment checks never hard-reset an existing repository", () => {
  const script = fs.readFileSync(new URL("../scripts/ensure-git.sh", import.meta.url), "utf8");
  const reset = script.indexOf('git reset --hard "origin/$BRANCH"');
  const initializedGuard = script.indexOf('if [ "$INITIALIZED" -eq 1 ]');
  assert.ok(initializedGuard >= 0 && initializedGuard < reset);
});

test("online update survives the API process being reloaded", () => {
  const server = fs.readFileSync(new URL("../api/src/server.js", import.meta.url), "utf8");
  const spawnStart = server.indexOf('const child = spawn("bash", ["scripts/update.sh"]');
  const detached = server.indexOf("detached: true", spawnStart);
  const directLog = server.indexOf('stdio: ["ignore", logDescriptor, logDescriptor]', spawnStart);
  const unref = server.indexOf("child.unref()", spawnStart);
  assert.ok(spawnStart >= 0 && detached > spawnStart && directLog > detached && unref > directLog);
});

test("online update stashes tracked and untracked source changes", () => {
  const script = fs.readFileSync(new URL("../scripts/update.sh", import.meta.url), "utf8");
  const dirtyCheck = script.indexOf("git status --porcelain");
  const stash = script.indexOf("git stash push --include-untracked");
  const upToDateBranch = script.indexOf('if [ "$LOCAL_COMMIT" = "$REMOTE_COMMIT" ]');
  assert.ok(dirtyCheck >= 0 && dirtyCheck < stash && stash < upToDateBranch);
});

test("membership installer normalizes the managed kwRedeem root to an absolute path", () => {
  const installer = fs.readFileSync(
    new URL("../modules/kwMembership/scripts/install-systemd.sh", import.meta.url),
    "utf8"
  );
  assert.match(installer, /mktemp "\$\{ENV_FILE\}\.XXXXXX"/);
  assert.match(installer, /KAWANG_ROOT="\$\(cd "\$ROOT_DIR\/\.\.\/\.\." && pwd\)"/);
  assert.match(installer, /DATABASE_PATH="\$\{DATABASE_PATH:-\.\/data\/kawang\.db\}"/);
  assert.match(installer, /KAWANG_DATA_DIR="\$\{KAWANG_DATA_DIR:-\$\(dirname "\$DATABASE_PATH"\)\}"/);
  assert.match(installer, /RUN_GROUP="\$\(id -gn "\$RUN_USER"\)"/);
  assert.match(installer, /ENV_FILE="\/etc\/kwmembership\.env"/);
  assert.match(installer, /DEPLOY_HELPER="\/usr\/local\/sbin\/kawang-membership-deploy"/);
  assert.doesNotMatch(installer, /KWMEMBERSHIP_DEPLOY_HELPER:-/);
  assert.match(installer, /print "KAWANG_PROJECT_ROOT=" kawang_root/);
  assert.match(installer, /install -m 0640 -o root -g "\$RUN_GROUP" "\$ENV_TMP" "\$ENV_FILE"/);
});

test("membership deployment removes legacy runtime env copies", () => {
  const helper = fs.readFileSync(
    new URL("../modules/kwMembership/deploy/kawang-membership-deploy", import.meta.url),
    "utf8"
  );
  assert.match(helper, /rm -f "\$INSTALL_DIR\/\.env"/);
  assert.match(helper, /ENV_FILE="@@ENV_FILE@@"/);
});
