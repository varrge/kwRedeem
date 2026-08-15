import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kawang-store-membership-migration-"));
const databasePath = path.join(tmpDir, "test.db");
const legacy = new Database(databasePath);
legacy.exec(`
  CREATE TABLE store_product_mappings (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL,
    sku_id TEXT NOT NULL DEFAULT '0',
    product_title TEXT,
    manual_type TEXT NOT NULL,
    fulfillment_kind TEXT NOT NULL DEFAULT 'manual',
    spacex_plan TEXT,
    site_id TEXT NOT NULL,
    prefix TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    updated_by TEXT,
    UNIQUE(product_id, sku_id)
  );
  INSERT INTO store_product_mappings (
    id, product_id, sku_id, product_title, manual_type, fulfillment_kind, spacex_plan,
    site_id, prefix, enabled, created_at, updated_at, updated_by
  ) VALUES (
    'legacy-spacex-map', '57', '66', '卡冲PLUS', 'PLUS', 'spacex_cdk', 'plus',
    'site_demo', '91GPTPLUS', 1, '2026-08-13T00:00:00.000Z', '2026-08-13T00:00:00.000Z', 'admin'
  );
  CREATE TABLE automation_product_mappings (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL,
    provider_id TEXT NOT NULL,
    external_plan_id TEXT NOT NULL,
    external_task_type TEXT NOT NULL DEFAULT 'purchase',
    region_code TEXT,
    currency TEXT,
    card_platform_key TEXT NOT NULL,
    card_product_code TEXT,
    capacity_key TEXT NOT NULL,
    card_capacity INTEGER NOT NULL DEFAULT 1,
    funding_amount_usd REAL NOT NULL,
    expected_min_amount REAL NOT NULL,
    expected_max_amount REAL NOT NULL,
    daily_risk_limit_usd REAL NOT NULL,
    priority INTEGER NOT NULL DEFAULT 100,
    enabled INTEGER NOT NULL DEFAULT 0,
    paused_reason TEXT,
    capability_snapshot TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    updated_by TEXT NOT NULL,
    UNIQUE(product_id, provider_id, external_plan_id, region_code)
  );
  INSERT INTO automation_product_mappings VALUES (
    'legacy-local-route', 'prod_demo', 'provider-1', 'plus-monthly', 'purchase',
    'PH', 'PHP', 'efuncard', 'Z-1', 'plus-ph', 5, 80, 900, 990, 16, 100,
    1, NULL, '{}', 1, '2026-08-13T00:00:00.000Z', '2026-08-13T00:00:00.000Z', 'admin'
  );
  INSERT INTO automation_product_mappings VALUES (
    'store-source-route', 'legacy-spacex-map', 'provider-1', 'plus-monthly', 'purchase',
    'PH', 'PHP', 'efuncard', 'Z-1', 'plus-ph', 5, 80, 900, 990, 16, 200,
    1, NULL, '{}', 1, '2026-08-13T00:00:00.000Z', '2026-08-13T00:00:00.000Z', 'admin'
  );
`);
legacy.close();

process.env.DATABASE_PATH = databasePath;
process.env.JWT_SECRET = "store-membership-migration-test-secret";

const { getDb } = await import("../shared/src/database.js");
const db = getDb();

after(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("legacy SpaceX store mappings migrate once to local membership automation", () => {
  const mapping = db.prepare("SELECT * FROM store_product_mappings WHERE id = 'legacy-spacex-map'").get();
  assert.equal(mapping.fulfillment_kind, "membership_auto");
  assert.equal(mapping.spacex_plan, null);
  assert.equal(mapping.manual_type, "PLUS");
  assert.equal(mapping.prefix, "91GPTPLUS");
  assert.equal(db.prepare(`
    SELECT COUNT(*) AS count FROM app_migrations
    WHERE id = '2026-08-14-store-membership-automation'
  `).get().count, 1);
  const legacyRoute = db.prepare("SELECT * FROM automation_product_mappings WHERE id = 'legacy-local-route'").get();
  assert.equal(legacyRoute.enabled, 0);
  assert.equal(legacyRoute.paused_reason, "STORE_MAPPING_REQUIRED");
  const storeRoute = db.prepare("SELECT * FROM automation_product_mappings WHERE id = 'store-source-route'").get();
  assert.equal(storeRoute.enabled, 1);
  assert.equal(storeRoute.paused_reason, null);
  assert.equal(db.prepare(`
    SELECT COUNT(*) AS count FROM app_migrations
    WHERE id = '2026-08-15-automation-store-mapping-sources'
  `).get().count, 1);
});
