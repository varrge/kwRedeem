import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kawang-shake-tier-migration-"));
const databasePath = path.join(tmpDir, "legacy.db");
const legacy = new Database(databasePath);

legacy.exec(`
  CREATE TABLE sub2api_shake_eligibility_rules (
    id TEXT PRIMARY KEY,
    config_version_id TEXT NOT NULL,
    source TEXT NOT NULL,
    threshold REAL NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(config_version_id, source)
  );
  CREATE TABLE sub2api_shake_prizes (
    id TEXT PRIMARY KEY,
    config_version_id TEXT NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    amount REAL,
    weight REAL NOT NULL,
    rarity TEXT NOT NULL,
    display_text TEXT,
    icon TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL
  );
  CREATE TABLE sub2api_shake_cards (
    id TEXT PRIMARY KEY,
    campaign_id TEXT NOT NULL,
    connection_id TEXT NOT NULL,
    sub2api_user_id TEXT NOT NULL,
    source TEXT NOT NULL,
    source_record_id TEXT,
    status TEXT NOT NULL DEFAULT 'available',
    granted_at TEXT NOT NULL,
    reserved_at TEXT,
    consumed_at TEXT,
    expired_at TEXT
  );
  CREATE TABLE sub2api_shake_progress (
    id TEXT PRIMARY KEY,
    campaign_id TEXT NOT NULL,
    sub2api_user_id TEXT NOT NULL,
    source TEXT NOT NULL,
    amount REAL NOT NULL DEFAULT 0,
    cards_earned INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    UNIQUE(campaign_id, sub2api_user_id, source)
  );
`);
legacy.prepare(`
  INSERT INTO sub2api_shake_eligibility_rules (id, config_version_id, source, threshold, created_at)
  VALUES ('legacy-rule', 'legacy-config', 'subscription_purchase', 120, '2026-08-01T00:00:00.000Z')
`).run();
legacy.prepare(`
  INSERT INTO sub2api_shake_prizes (
    id, config_version_id, name, type, weight, rarity, status, created_at
  ) VALUES ('legacy-prize', 'legacy-config', '旧奖品', 'empty', 7, 'common', 'active', '2026-08-01T00:00:00.000Z')
`).run();
legacy.prepare(`
  INSERT INTO sub2api_shake_cards (
    id, campaign_id, connection_id, sub2api_user_id, source, status, granted_at
  ) VALUES ('legacy-card', 'legacy-campaign', 'legacy-connection', '42', 'manual_grant', 'available', '2026-08-01T00:00:00.000Z')
`).run();
legacy.close();

process.env.DATABASE_PATH = databasePath;
const { getDb } = await import("../shared/src/database.js");
const db = getDb();

after(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("legacy Shake cards, rules, and weights migrate to the low tier without changing odds", () => {
  const rule = db.prepare(`
    SELECT card_tier, threshold, subscription_group_id, card_quantity
    FROM sub2api_shake_eligibility_rules WHERE id = 'legacy-rule'
  `).get();
  const prize = db.prepare(`
    SELECT weight, low_weight, medium_weight, high_weight
    FROM sub2api_shake_prizes WHERE id = 'legacy-prize'
  `).get();
  const card = db.prepare("SELECT card_tier, status FROM sub2api_shake_cards WHERE id = 'legacy-card'").get();

  assert.deepEqual(rule, {
    card_tier: "low", threshold: 120, subscription_group_id: null, card_quantity: null
  });
  assert.deepEqual(prize, { weight: 7, low_weight: 7, medium_weight: 7, high_weight: 7 });
  assert.deepEqual(card, { card_tier: "low", status: "available" });
});

test("the migrated rule table accepts multiple subscription group mappings in one config", () => {
  const insert = db.prepare(`
    INSERT INTO sub2api_shake_eligibility_rules (
      id, config_version_id, source, card_tier, threshold,
      subscription_group_id, card_quantity, created_at
    ) VALUES (?, 'new-config', 'subscription_purchase', ?, NULL, ?, ?, '2026-08-12T00:00:00.000Z')
  `);
  insert.run("group-rule-101", "low", 101, 1);
  insert.run("group-rule-202", "high", 202, 3);

  const rules = db.prepare(`
    SELECT subscription_group_id, card_tier, card_quantity
    FROM sub2api_shake_eligibility_rules
    WHERE config_version_id = 'new-config'
    ORDER BY subscription_group_id
  `).all();
  assert.deepEqual(rules, [
    { subscription_group_id: 101, card_tier: "low", card_quantity: 1 },
    { subscription_group_id: 202, card_tier: "high", card_quantity: 3 }
  ]);
});

test("the migrated progress table keeps subscription group usage balances independent", () => {
  const insert = db.prepare(`
    INSERT INTO sub2api_shake_progress (
      id, campaign_id, sub2api_user_id, source, card_tier,
      subscription_group_id, amount, cards_earned, updated_at
    ) VALUES (?, 'campaign', 'user', 'balance_consumption', ?, ?, ?, 0, '2026-08-12T00:00:00.000Z')
  `);
  insert.run("progress-101", "medium", 101, 1.25);
  insert.run("progress-202", "high", 202, 2);

  assert.deepEqual(db.prepare(`
    SELECT subscription_group_id, card_tier, amount
    FROM sub2api_shake_progress ORDER BY subscription_group_id
  `).all(), [
    { subscription_group_id: 101, card_tier: "medium", amount: 1.25 },
    { subscription_group_id: 202, card_tier: "high", amount: 2 }
  ]);
});
