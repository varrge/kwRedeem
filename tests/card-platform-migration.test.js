import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kawang-card-platform-migration-"));
const databasePath = path.join(tmpDir, "legacy.db");
const legacy = new Database(databasePath);
legacy.exec(`
  CREATE TABLE managed_cards (
    id TEXT PRIMARY KEY,
    upstream_card_id INTEGER NOT NULL UNIQUE,
    vm_card_id TEXT NOT NULL UNIQUE,
    product_code TEXT NOT NULL,
    bin TEXT,
    last4 TEXT,
    upstream_status TEXT NOT NULL,
    cached_available_amount REAL NOT NULL DEFAULT 0,
    lane TEXT,
    consumed_slots INTEGER NOT NULL DEFAULT 0,
    capacity_state TEXT NOT NULL DEFAULT 'AVAILABLE',
    reconciliation_state TEXT NOT NULL DEFAULT 'PENDING',
    reconciliation_reason TEXT,
    last_balance_sync_at TEXT,
    last_transaction_sync_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE card_product_policies (
    product_code TEXT PRIMARY KEY,
    enabled INTEGER NOT NULL DEFAULT 0,
    revision INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL,
    updated_by TEXT NOT NULL
  );
  INSERT INTO managed_cards (
    id,upstream_card_id,vm_card_id,product_code,upstream_status,created_at,updated_at
  ) VALUES ('legacy-card',101,'legacy-vm','shared-product','ACTIVE','2026-08-01T00:00:00Z','2026-08-01T00:00:00Z');
  INSERT INTO card_product_policies (product_code,enabled,revision,updated_at,updated_by)
  VALUES ('shared-product',1,3,'2026-08-01T00:00:00Z','admin');
`);
legacy.close();

process.env.DATABASE_PATH = databasePath;
process.env.JWT_SECRET = "card-platform-migration-test-secret";
const { getDb } = await import("../shared/src/database.js");
const db = getDb();

after(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("legacy SpaceX card records migrate to provider-scoped identities", () => {
  const card = db.prepare("SELECT * FROM managed_cards WHERE id='legacy-card'").get();
  const policy = db.prepare("SELECT * FROM card_product_policies WHERE product_code='shared-product'").get();
  assert.equal(card.provider_key, "spacexcard");
  assert.equal(policy.provider_key, "spacexcard");
  assert.equal(policy.revision, 3);

  db.prepare(`INSERT INTO managed_cards (
    id,provider_key,upstream_card_id,vm_card_id,product_code,upstream_status,created_at,updated_at
  ) VALUES ('efun-card','efuncard',101,'legacy-vm','shared-product','ACTIVE',?,?)`)
    .run(new Date().toISOString(), new Date().toISOString());
  db.prepare(`INSERT INTO card_product_policies (
    provider_key,product_code,enabled,revision,updated_at,updated_by
  ) VALUES ('efuncard','shared-product',0,1,?,'admin')`).run(new Date().toISOString());

  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM managed_cards WHERE upstream_card_id=101").get().count, 2);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM card_product_policies WHERE product_code='shared-product'").get().count, 2);
  assert.ok(db.prepare("PRAGMA index_list(managed_cards)").all().some((item) => item.name === "idx_managed_cards_selection"));
});
