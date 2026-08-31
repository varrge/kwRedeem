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
  delete(route, options, handler) { this.register("DELETE", route, options, handler); }
}

const db = getDb();
const app = new FakeApp();
let nowValue = "2026-09-01T00:00:00.000Z";
let subscriptionGrants = 0;
let rateWrites = [];
let globalRechargeWrites = [];
let globalRechargeError = null;
let remoteGlobalRechargeMultiplier = 1;
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
  getGlobalRechargeMultiplier: async () => remoteGlobalRechargeMultiplier,
  setGlobalRechargeMultiplier: async (input) => {
    if (globalRechargeError) throw globalRechargeError;
    globalRechargeWrites.push(input);
    remoteGlobalRechargeMultiplier = input.multiplier;
    return { ok: true };
  },
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
      clearReward, mvpRewards: []
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
  assert.throws(invalid, /PVE 击杀奖励/);

  const invalidPveMvp = campaignConfig(
    reward("参战额度", "balance", { amount: 1 }),
    reward("不允许的 MVP", "balance", { amount: 1 })
  );
  invalidPveMvp.bosses[0].mvpRewards = [reward("不允许的 MVP", "balance", { amount: 1 })];
  assert.throws(() => raid.createCampaign(invalidPveMvp, "test"), /PVE 活动不能配置 MVP/);

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

test("PVE global recharge multiplier activates on defeat and returns to 1x at month end", async () => {
  db.prepare(`
    INSERT INTO sub2api_connections (id, name, base_url, admin_token, status, created_by, created_at, updated_at)
    VALUES ('phase2-global', 'PVE 全站奖励', 'https://pve.example.com', 'token', 'active', 'test', ?, ?)
  `).run(nowValue, nowValue);
  const globalReward = reward("全服充值加成", "global_recharge_multiplier", { rechargeMultiplier: 1.25 });
  const config = campaignConfig(
    globalReward,
    reward("旧 MVP 配置不会结算", "balance", { amount: 1 })
  );
  config.connectionId = "phase2-global";
  const created = raid.createCampaign(config, "test");
  const boss = db.prepare("SELECT * FROM sub2api_raid_bosses WHERE campaign_id = ?").get(created.id);
  const settlementId = "pve-global-settlement";
  db.prepare(`INSERT INTO sub2api_raid_settlements
    (id, campaign_id, boss_id, defeated_at, defeat_usage_id, total_damage, effective_raider_count, mvp_slots, ranking_snapshot, created_at)
    VALUES (?, ?, ?, ?, 'usage', 10, 10, 0, '[]', ?)`)
    .run(settlementId, created.id, boss.id, nowValue, nowValue);
  db.prepare(`INSERT INTO sub2api_raid_rewards
    (id, campaign_id, boss_id, settlement_id, sub2api_user_id, reward_scope, original_rank, final_rank, reward_snapshot, fulfillment_mode, status, cost, created_at, updated_at)
    VALUES ('pve-global-reward', ?, ?, ?, '__global__', 'global', NULL, NULL, ?, 'auto', 'pending', 10, ?, ?)`)
    .run(created.id, boss.id, settlementId, JSON.stringify(globalReward), nowValue, nowValue);

  await raid.deliverPendingRewards(created.id);
  assert.equal(globalRechargeWrites.at(-1).multiplier, 1.25);
  assert.equal(db.prepare("SELECT status FROM sub2api_raid_rewards WHERE id = 'pve-global-reward'").get().status, "delivered");

  const secondBossId = "pve-global-boss-2";
  const secondReward = reward("第二阶段全服充值加成", "global_recharge_multiplier", { rechargeMultiplier: 1.5 });
  db.prepare(`INSERT INTO sub2api_raid_bosses
    (id, campaign_id, sequence, level, name, asset_key, max_health, remaining_health, status,
      theme_multiplier, entry_cost_threshold, clear_reward, mvp_rewards, created_at, updated_at)
    VALUES (?, ?, 2, 2, '第二阶段', 'sentinel', 10, 0, 'defeated', 1, 1, ?, '[]', ?, ?)`)
    .run(secondBossId, created.id, JSON.stringify(secondReward), nowValue, nowValue);
  db.prepare(`INSERT INTO sub2api_raid_settlements
    (id, campaign_id, boss_id, defeated_at, defeat_usage_id, total_damage, effective_raider_count, mvp_slots, ranking_snapshot, created_at)
    VALUES ('pve-global-settlement-2', ?, ?, ?, 'usage-2', 10, 10, 0, '[]', ?)`)
    .run(created.id, secondBossId, nowValue, nowValue);
  db.prepare(`INSERT INTO sub2api_raid_rewards
    (id, campaign_id, boss_id, settlement_id, sub2api_user_id, reward_scope, original_rank, final_rank, reward_snapshot, fulfillment_mode, status, cost, created_at, updated_at)
    VALUES ('pve-global-reward-2', ?, ?, 'pve-global-settlement-2', '__global__', 'global', NULL, NULL, ?, 'auto', 'pending', 10, ?, ?)`)
    .run(created.id, secondBossId, JSON.stringify(secondReward), nowValue, nowValue);
  db.exec(`
    CREATE TRIGGER reject_stale_global_commit
    BEFORE UPDATE OF status ON sub2api_raid_global_recharge_state
    WHEN NEW.connection_id = 'phase2-global' AND NEW.status = 'applied' AND NEW.desired_multiplier = 1.5
    BEGIN SELECT RAISE(IGNORE); END
  `);
  await raid.deliverPendingRewards(created.id);
  assert.equal(db.prepare("SELECT status FROM sub2api_raid_rewards WHERE id = 'pve-global-reward-2'").get().status, "pending");
  assert.equal(db.prepare("SELECT status FROM sub2api_raid_rewards WHERE id = 'pve-global-reward'").get().status, "delivered");
  db.exec("DROP TRIGGER reject_stale_global_commit");
  nowValue = "2026-09-01T00:00:31.000Z";
  await raid.deliverPendingRewards(created.id);
  assert.equal(globalRechargeWrites.at(-1).multiplier, 1.5);

  remoteGlobalRechargeMultiplier = 0.8;
  await raid.runMaintenance();
  assert.equal(globalRechargeWrites.at(-1).multiplier, 1.5);
  assert.equal(remoteGlobalRechargeMultiplier, 1.5);

  const writesBeforeStaleRetry = globalRechargeWrites.length;
  db.prepare("UPDATE sub2api_raid_rewards SET status = 'delivery_failed' WHERE id = 'pve-global-reward'").run();
  await app.routes.get("POST /api/admin/sub2api/raid/rewards/:id/disposition")({
    params: { id: "pve-global-reward" },
    body: { action: "retry", reason: "验证旧奖励重试不会覆盖新倍率" },
    admin: { username: "test" }
  }, { code() { return this; }, send(payload) { return payload; } });
  assert.equal(globalRechargeWrites.length, writesBeforeStaleRetry);
  assert.equal(globalRechargeWrites.at(-1).multiplier, 1.5);
  assert.equal(db.prepare("SELECT status FROM sub2api_raid_rewards WHERE id = 'pve-global-reward'").get().status, "superseded");

  nowValue = "2026-10-01T00:00:00.000Z";
  globalRechargeError = new Error("模拟月末远端超时");
  await raid.runMaintenance();
  assert.equal(db.prepare("SELECT status FROM sub2api_raid_rewards WHERE id = 'pve-global-reward-2'").get().status, "revert_failed");
  globalRechargeError = null;
  await app.routes.get("POST /api/admin/sub2api/raid/rewards/:id/disposition")({
    params: { id: "pve-global-reward-2" },
    body: { action: "retry", reason: "重试月末倍率对账" },
    admin: { username: "test" }
  }, { code() { return this; }, send(payload) { return payload; } });
  assert.equal(globalRechargeWrites.at(-1).multiplier, 1);
  assert.equal(db.prepare("SELECT status FROM sub2api_raid_rewards WHERE id = 'pve-global-reward-2'").get().status, "expired");
  assert.equal(db.prepare("SELECT status FROM sub2api_raid_rewards WHERE id = 'pve-global-reward'").get().status, "superseded");
});

test("an expired lease cannot let an older remote write win", async () => {
  let raceNow = "2026-09-01T00:00:00.000Z";
  let remoteMultiplier = 1;
  let releaseOldWrite;
  const writes = [];
  const makeRaid = (raceApp, setter) => createSub2ApiRaidService({
    app: raceApp,
    db,
    requireAdmin: async () => {},
    requireSession: async () => {},
    now: () => raceNow,
    id: (prefix) => `${prefix}-${Math.random().toString(36).slice(2)}`,
    getUserProfile: async () => ({ createdAt: "2026-01-01T00:00:00.000Z" }),
    getGlobalRechargeMultiplier: async () => remoteMultiplier,
    setGlobalRechargeMultiplier: setter,
    creditBalance: async () => ({ ok: true })
  });
  const appA = new FakeApp();
  const appB = new FakeApp();
  let firstWrite = true;
  const raidA = makeRaid(appA, async (input) => {
    writes.push(`A:${input.multiplier}`);
    if (firstWrite) {
      firstWrite = false;
      await new Promise((resolve) => {
        releaseOldWrite = () => {
          remoteMultiplier = input.multiplier;
          resolve();
        };
      });
    } else {
      remoteMultiplier = input.multiplier;
    }
    return { ok: true };
  });
  const raidB = makeRaid(appB, async (input) => {
    writes.push(`B:${input.multiplier}`);
    remoteMultiplier = input.multiplier;
    return { ok: true };
  });
  db.prepare(`
    INSERT INTO sub2api_connections (id, name, base_url, admin_token, status, created_by, created_at, updated_at)
    VALUES ('phase2-race', '倍率竞态测试', 'https://race.example.com', 'token', 'active', 'test', ?, ?)
  `).run(raceNow, raceNow);
  const firstReward = reward("第一阶段", "global_recharge_multiplier", { rechargeMultiplier: 1.25 });
  const raceConfig = campaignConfig(firstReward, reward("unused", "balance", { amount: 1 }));
  raceConfig.connectionId = "phase2-race";
  const campaign = raidA.createCampaign(raceConfig, "test");
  const firstBoss = db.prepare("SELECT * FROM sub2api_raid_bosses WHERE campaign_id = ?").get(campaign.id);
  db.prepare(`INSERT INTO sub2api_raid_settlements
    (id, campaign_id, boss_id, defeated_at, defeat_usage_id, total_damage, effective_raider_count, mvp_slots, ranking_snapshot, created_at)
    VALUES ('race-settlement-1', ?, ?, ?, 'usage-1', 10, 10, 0, '[]', ?)`)
    .run(campaign.id, firstBoss.id, raceNow, raceNow);
  db.prepare(`INSERT INTO sub2api_raid_rewards
    (id, campaign_id, boss_id, settlement_id, sub2api_user_id, reward_scope, original_rank, final_rank, reward_snapshot, fulfillment_mode, status, cost, created_at, updated_at)
    VALUES ('race-reward-1', ?, ?, 'race-settlement-1', '__global__', 'global', NULL, NULL, ?, 'auto', 'pending', 10, ?, ?)`)
    .run(campaign.id, firstBoss.id, JSON.stringify(firstReward), raceNow, raceNow);

  const oldDelivery = raidA.deliverPendingRewards(campaign.id);
  while (!releaseOldWrite) await new Promise((resolve) => setImmediate(resolve));
  const secondReward = reward("第二阶段", "global_recharge_multiplier", { rechargeMultiplier: 1.5 });
  db.prepare(`INSERT INTO sub2api_raid_bosses
    (id, campaign_id, sequence, level, name, asset_key, max_health, remaining_health, status,
      theme_multiplier, entry_cost_threshold, clear_reward, mvp_rewards, created_at, updated_at)
    VALUES ('race-boss-2', ?, 2, 2, '第二阶段', 'sentinel', 10, 0, 'defeated', 1, 1, ?, '[]', ?, ?)`)
    .run(campaign.id, JSON.stringify(secondReward), raceNow, raceNow);
  db.prepare(`INSERT INTO sub2api_raid_settlements
    (id, campaign_id, boss_id, defeated_at, defeat_usage_id, total_damage, effective_raider_count, mvp_slots, ranking_snapshot, created_at)
    VALUES ('race-settlement-2', ?, 'race-boss-2', ?, 'usage-2', 10, 10, 0, '[]', ?)`)
    .run(campaign.id, raceNow, raceNow);
  db.prepare(`INSERT INTO sub2api_raid_rewards
    (id, campaign_id, boss_id, settlement_id, sub2api_user_id, reward_scope, original_rank, final_rank, reward_snapshot, fulfillment_mode, status, cost, created_at, updated_at)
    VALUES ('race-reward-2', ?, 'race-boss-2', 'race-settlement-2', '__global__', 'global', NULL, NULL, ?, 'auto', 'pending', 10, ?, ?)`)
    .run(campaign.id, JSON.stringify(secondReward), raceNow, raceNow);

  raceNow = "2026-09-01T00:00:31.000Z";
  await raidB.deliverPendingRewards(campaign.id);
  assert.equal(remoteMultiplier, 1.5);
  releaseOldWrite();
  await oldDelivery;
  assert.equal(remoteMultiplier, 1.5);
  assert.deepEqual(writes, ["A:1.25", "B:1.5", "A:1.5"]);
});
