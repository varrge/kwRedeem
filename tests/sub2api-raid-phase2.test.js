import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kawang-raid-phase2-"));
process.env.DATABASE_PATH = path.join(tmpDir, "test.db");

const { getDb } = await import("../shared/src/database.js");
const { createSub2ApiRaidService } = await import("../api/src/sub2api-raid.js");

class FakeApp {
  constructor() { this.routes = new Map(); }
  register(method, route, options, handler) {
    if (typeof options === "function") handler = options;
    this.routes.set(`${method} ${route}`, handler);
  }
  post(route, options, handler) { this.register("POST", route, options, handler); }
  get(route, options, handler) { this.register("GET", route, options, handler); }
}

const db = getDb();
const app = new FakeApp();
let nowValue = "2026-09-01T00:00:00.000Z";
let subscriptionGrants = 0;
let rateWrites = [];
const raid = createSub2ApiRaidService({
  app,
  db,
  requireAdmin: async () => {},
  requireSession: async () => {},
  now: () => nowValue,
  id: (prefix) => `${prefix}-${Math.random().toString(36).slice(2)}`,
  getUserProfile: async () => ({ createdAt: "2026-01-01T00:00:00.000Z" }),
  grantSubscription: async (input) => { subscriptionGrants += 1; return { mode: "extended", ...input }; },
  getUserGroupRate: async () => null,
  applyRateEntitlement: async (input) => { rateWrites.push(input); return { ok: true }; },
  creditBalance: async () => ({ ok: true })
});

db.prepare(`
  INSERT INTO sub2api_connections (id, name, base_url, admin_token, status, created_by, created_at, updated_at)
  VALUES ('phase2-connection', '二期奖励测试', 'https://phase2.example.com', 'token', 'active', 'test', ?, ?)
`).run(nowValue, nowValue);

function reward(name, type, extra = {}) {
  return { name, type, cost: 10, fulfillmentMode: "auto", ...extra };
}

function campaignConfig(clearReward, mvpReward) {
  return {
    connectionId: "phase2-connection",
    name: "二期奖励测试",
    month: "2026-09",
    startAt: "2026-08-31T16:00:00.000Z",
    endAt: "2026-09-30T16:00:00.000Z",
    settlementEndAt: "2026-09-30T16:10:00.000Z",
    effectiveDamageThreshold: 1,
    rewardBudget: 1000,
    bosses: [{
      level: 1, name: "测试 Boss", title: "", assetKey: "sentinel", health: 10,
      themeGroupId: null, themeGroupName: "", themeMultiplier: 1,
      clearReward, mvpRewards: [mvpReward, reward("MVP 2", "balance", { amount: 1 }), reward("MVP 3", "balance", { amount: 1 })]
    }]
  };
}

after(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("phase 2 keeps advanced rewards in MVP and delivers subscription/rate types", async () => {
  const invalid = () => raid.createCampaign(campaignConfig(
    reward("共享订阅", "subscription", { subscriptionGroupId: 7, validityDays: 7 }),
    reward("MVP", "balance", { amount: 1 })
  ), "test");
  assert.throws(invalid, /共享奖励/);

  const created = raid.createCampaign(campaignConfig(
    reward("共享额度", "balance", { amount: 1 }),
    reward("MVP 订阅", "subscription", { subscriptionGroupId: 7, validityDays: 14 })
  ), "test");
  const boss = db.prepare("SELECT * FROM sub2api_raid_bosses WHERE campaign_id = ?").get(created.id);
  const settlementId = "phase2-settlement-subscription";
  db.prepare(`INSERT INTO sub2api_raid_settlements
    (id, campaign_id, boss_id, defeated_at, defeat_usage_id, total_damage, effective_raider_count, mvp_slots, ranking_snapshot, created_at)
    VALUES (?, ?, ?, ?, 'usage', 10, 10, 1, '[]', ?)`)
    .run(settlementId, created.id, boss.id, nowValue, nowValue);
  db.prepare(`INSERT INTO sub2api_raid_rewards
    (id, campaign_id, boss_id, settlement_id, sub2api_user_id, reward_scope, original_rank, final_rank, reward_snapshot, fulfillment_mode, status, cost, created_at, updated_at)
    VALUES ('phase2-subscription-reward', ?, ?, ?, '42', 'mvp', 1, 1, ?, 'auto', 'pending', 10, ?, ?)`)
    .run(created.id, boss.id, settlementId, JSON.stringify(reward("MVP 订阅", "subscription", { subscriptionGroupId: 7, validityDays: 14 })), nowValue, nowValue);
  await raid.deliverPendingRewards(created.id);
  assert.equal(subscriptionGrants, 1);
  assert.equal(db.prepare("SELECT status FROM sub2api_raid_rewards WHERE id = 'phase2-subscription-reward'").get().status, "delivered");

  const rateReward = reward("MVP 倍率", "rate_multiplier", {
    rateGroupId: 7, rateMultiplier: 0.8, durationDays: 7, usageCap: 100, fallbackAmount: 25
  });
  db.prepare(`INSERT INTO sub2api_raid_rewards
    (id, campaign_id, boss_id, settlement_id, sub2api_user_id, reward_scope, original_rank, final_rank, reward_snapshot, fulfillment_mode, status, cost, created_at, updated_at)
    VALUES ('phase2-rate-reward', ?, ?, ?, '43', 'mvp', 2, 2, ?, 'auto', 'pending', 25, ?, ?)`)
    .run(created.id, boss.id, settlementId, JSON.stringify(rateReward), nowValue, nowValue);
  await raid.deliverPendingRewards(created.id);
  assert.equal(rateWrites[0].multiplier, 0.8);
  assert.equal(db.prepare("SELECT status FROM sub2api_raid_rate_entitlements WHERE reward_id = 'phase2-rate-reward'").get().status, "active");
});
