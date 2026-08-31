import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

test("existing raid campaigns migrate to legacy MVP mode", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "kawang-raid-mode-migration-"));
  const databasePath = path.join(directory, "legacy.db");
  try {
    const legacy = new Database(databasePath);
    legacy.exec(`
      CREATE TABLE sub2api_raid_campaigns (
        id TEXT PRIMARY KEY, connection_id TEXT NOT NULL, name TEXT NOT NULL, month TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft', start_at TEXT NOT NULL, end_at TEXT NOT NULL,
        settlement_end_at TEXT NOT NULL, effective_damage_threshold REAL NOT NULL,
        reward_budget REAL NOT NULL, worst_case_cost REAL NOT NULL DEFAULT 0,
        excluded_user_ids TEXT NOT NULL DEFAULT '[]', current_boss_id TEXT, abort_reason TEXT,
        created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        published_at TEXT, ended_at TEXT, UNIQUE(connection_id, month)
      );
      INSERT INTO sub2api_raid_campaigns (
        id, connection_id, name, month, status, start_at, end_at, settlement_end_at,
        effective_damage_threshold, reward_budget, created_by, created_at, updated_at
      ) VALUES (
        'existing', 'main', '进行中旧活动', '2026-08', 'active',
        '2026-07-31T16:00:00.000Z', '2026-08-31T16:00:00.000Z',
        '2026-08-31T16:10:00.000Z', 10, 100, 'admin',
        '2026-07-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z'
      );
    `);
    legacy.close();
    const output = execFileSync(process.execPath, ["--input-type=module", "-e", `
      const { getDb } = await import('./shared/src/database.js');
      const db = getDb();
      process.stdout.write(db.prepare("SELECT reward_mode FROM sub2api_raid_campaigns WHERE id = 'existing'").get().reward_mode);
      db.close();
    `], {
      cwd: path.resolve("."),
      env: { ...process.env, DATABASE_PATH: databasePath },
      encoding: "utf8"
    });
    assert.match(output, /legacy_mvp$/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
