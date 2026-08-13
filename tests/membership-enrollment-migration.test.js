import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kawang-membership-enrollment-migration-"));
const databasePath = path.join(tmpDir, "legacy.db");
const legacy = new Database(databasePath);
legacy.exec(`
  CREATE TABLE membership_intake_settings (
    id TEXT PRIMARY KEY,
    accept_orders_created_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    created_by TEXT NOT NULL
  );
  INSERT INTO membership_intake_settings VALUES (
    'default', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', 'system'
  );
  CREATE TABLE membership_fulfillments (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL UNIQUE,
    order_no TEXT NOT NULL UNIQUE,
    target_tier TEXT NOT NULL,
    state TEXT NOT NULL,
    retry_at TEXT,
    account_lock_key TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  INSERT INTO membership_fulfillments VALUES (
    'mf-legacy', 'order-legacy', 'ORDER-LEGACY', 'plus',
    'WAITING_SESSION_VALIDATION', NULL, NULL,
    '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
  );
`);
legacy.close();

process.env.DATABASE_PATH = databasePath;
process.env.JWT_SECRET = "membership-enrollment-migration-test-secret";
const migrationStartedAt = Date.now();
const { getDb } = await import("../shared/src/database.js");
const db = getDb();

after(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("membership enrollment migration leaves every existing fulfillment out of automation", () => {
  const legacyFulfillment = db.prepare(`
    SELECT automation_enrolled_at
    FROM membership_fulfillments WHERE id = 'mf-legacy'
  `).get();
  assert.equal(legacyFulfillment.automation_enrolled_at, null);

  const intake = db.prepare(`
    SELECT accept_orders_created_at
    FROM membership_intake_settings WHERE id = 'default'
  `).get();
  assert.equal(Date.parse(intake.accept_orders_created_at) >= migrationStartedAt, true);
  assert.equal(Date.parse(intake.accept_orders_created_at) <= Date.now(), true);
});
