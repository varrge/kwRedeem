import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kawang-sub2api-raid-"));
process.env.DATABASE_PATH = path.join(tmpDir, "test.db");

const { getDb } = await import("../shared/src/database.js");
const { createSub2ApiRaidService, getRaidMvpSlots } = await import("../api/src/sub2api-raid.js");

class FakeReply {
  constructor() {
    this.statusCode = 200;
    this.payload = undefined;
  }

  code(value) {
    this.statusCode = value;
    return this;
  }

  send(payload) {
    this.payload = payload;
    return payload;
  }
}

class FakeApp {
  constructor() {
    this.routes = new Map();
  }

  register(method, pathName, options, handler) {
    if (typeof options === "function") {
      handler = options;
      options = {};
    }
    this.routes.set(`${method} ${pathName}`, { options, handler });
  }

  get(pathName, options, handler) { this.register("GET", pathName, options, handler); }
  post(pathName, options, handler) { this.register("POST", pathName, options, handler); }
  delete(pathName, options, handler) { this.register("DELETE", pathName, options, handler); }

  async injectRoute(method, pathName, request = {}) {
    const route = this.routes.get(`${method} ${pathName}`);
    assert.ok(route, `route not registered: ${method} ${pathName}`);
    const reply = new FakeReply();
    const normalized = {
      body: request.body,
      params: request.params || {},
      query: request.query || {},
      headers: request.headers || {},
      admin: request.admin,
      sub2apiRaid: request.sub2apiRaid
    };
    if (typeof route.options.preHandler === "function") {
      await route.options.preHandler(normalized, reply);
      if (reply.payload !== undefined) return { statusCode: reply.statusCode, body: reply.payload };
    }
    const result = await route.handler(normalized, reply);
    return { statusCode: reply.statusCode, body: reply.payload === undefined ? result : reply.payload };
  }
}

const db = getDb();
const app = new FakeApp();
let currentNow = "2026-08-01T00:00:00.000Z";
let remoteUsageItems = [];
let balanceDeliveries = 0;
const auditLogs = [];
let campaignId = "";
let secondBossId = "";

db.prepare(`
  INSERT INTO sub2api_connections (
    id, name, base_url, admin_token, status, created_by, created_at, updated_at
  ) VALUES (?, ?, ?, ?, 'active', 'admin', ?, ?)
`).run("raid-main", "Raid 主站", "https://raid.example.com", "encrypted-token", currentNow, currentNow);

const raid = createSub2ApiRaidService({
  app,
  db,
  now: () => currentNow,
  id: (() => {
    let value = 0;
    return (prefix) => `${prefix}-${++value}`;
  })(),
  async listUsagePage({ connectionId }) {
    const items = remoteUsageItems.filter((item) => (item.connection_id || "raid-main") === connectionId);
    return { items: structuredClone(items), pages: 1 };
  },
  async getUserProfile() {
    return { createdAt: "2026-07-01T00:00:00.000Z" };
  },
  async creditBalance() {
    balanceDeliveries += 1;
    return { ok: true };
  },
  requireAdmin: async (request) => { request.admin ||= { username: "admin" }; },
  createAuditLog: (entry) => auditLogs.push(entry),
  requireSession: async (request, reply) => {
    if (!request.sub2apiRaid) reply.code(401).send({ message: "缺少 Boss 活动会话" });
  }
});

function reward(name, cost = 1) {
  return { name, type: "balance", amount: 1, cost, fulfillmentMode: "auto" };
}

function boss(level, health, entryCostThreshold, options = {}) {
  return {
    level,
    name: `Boss ${level}`,
    title: "测试核心",
    assetKey: "leviathan",
    health,
    entryCostThreshold,
    themeGroupId: 101,
    themeGroupName: "高速中转",
    themeMultiplier: 1.25,
    clearReward: reward(`Clear ${level}`),
    mvpRewards: [],
    ...options
  };
}

after(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("raid requires a pre-registered enrollment and starts from zero after each boss", async () => {
  const campaignConfig = {
    connectionId: "raid-main",
    name: "八月全域突袭",
    month: "2026-08",
    startAt: "2026-07-31T16:00:00.000Z",
    endAt: "2026-08-31T16:00:00.000Z",
    settlementEndAt: "2026-08-31T16:10:00.000Z",
    effectiveDamageThreshold: 10,
    rewardBudget: 100,
    bosses: [boss(1, 10, 9), boss(2, 10, 15, {
      themeGroupId: null,
      themeGroupName: "",
      themeMultiplier: 2
    })]
  };
  const created = await app.injectRoute("POST", "/api/admin/sub2api/raid/campaigns", {
    body: campaignConfig
  });
  assert.equal(created.statusCode, 201);
  assert.equal(created.body.campaign.rewardMode, "pve");
  assert.deepEqual(created.body.campaign.bosses.map((item) => item.entryCostThreshold), [9, 15]);
  campaignId = created.body.campaign.id;
  const published = await app.injectRoute("POST", "/api/admin/sub2api/raid/campaigns/:id/publish", {
    params: { id: created.body.campaign.id }
  });
  assert.equal(published.statusCode, 200);
  const locked = await app.injectRoute("POST", "/api/admin/sub2api/raid/campaigns/:id/config", {
    params: { id: created.body.campaign.id },
    body: { ...campaignConfig, name: "不能修改" }
  });
  assert.equal(locked.statusCode, 409);

  remoteUsageItems = [
    { id: 1, user_id: 7, actual_cost: 9, group_id: 101, created_at: "2026-07-31T15:59:00.000Z" },
    { id: 2, user_id: 7, actual_cost: 9, group_id: 101, created_at: "2026-08-01T00:01:00.000Z" }
  ];

  const enrolled = await app.injectRoute("POST", "/api/public/sub2api/raid/enroll", {
    sub2apiRaid: { connectionId: "raid-main", userId: "7", username: "player" }
  });
  assert.equal(enrolled.statusCode, 201);

  const firstSync = await app.injectRoute("POST", "/api/admin/sub2api/raid/connections/:id/sync-usage", {
    params: { id: "raid-main" }
  });
  assert.equal(firstSync.statusCode, 200);
  assert.equal(firstSync.body.imported, 1);
  assert.equal(firstSync.body.pendingSettlement, true);

  const bootstrap = () => app.injectRoute("GET", "/api/public/sub2api/raid/bootstrap", {
    sub2apiRaid: { connectionId: "raid-main", userId: "7", username: "player" }
  });
  let current = await bootstrap();
  assert.equal(current.body.currentBoss.remainingHealth, 0);
  assert.equal(current.body.own.actualCost, 9);
  assert.equal(current.body.own.bonusDamage, 2.25);
  assert.equal(current.body.own.damage, 11.25);
  assert.equal(current.body.ranking[0].rank, 1);
  const damageIds = current.body.battleLog.map((item) => item.id);

  const secondSync = await app.injectRoute("POST", "/api/admin/sub2api/raid/connections/:id/sync-usage", {
    params: { id: "raid-main" }
  });
  assert.equal(secondSync.body.imported, 0);
  current = await bootstrap();
  assert.deepEqual(current.body.battleLog.map((item) => item.id), damageIds);
  remoteUsageItems.unshift({ id: 3, user_id: 7, actual_cost: 9, group_id: 101, created_at: "2026-08-01T00:00:30.000Z" });
  const lateSync = await app.injectRoute("POST", "/api/admin/sub2api/raid/connections/:id/sync-usage", {
    params: { id: "raid-main" }
  });
  assert.equal(lateSync.body.imported, 1);
  assert.equal(lateSync.body.stableSyncCount, 0);
  await app.injectRoute("POST", "/api/admin/sub2api/raid/connections/:id/sync-usage", { params: { id: "raid-main" } });
  const settledSync = await app.injectRoute("POST", "/api/admin/sub2api/raid/connections/:id/sync-usage", { params: { id: "raid-main" } });
  assert.equal(settledSync.body.bossesSettled, 1);

  current = await bootstrap();
  assert.equal(current.body.currentBoss.level, 2);
  assert.equal(current.body.currentBoss.entryCostThreshold, 15);
  secondBossId = current.body.currentBoss.id;
  assert.equal(current.body.currentBoss.totalDamage, 18);
  assert.equal(current.body.own.actualCost, 9);
  assert.equal(current.body.own.bonusDamage, 9);
  assert.equal(current.body.own.damage, 18);
  assert.equal(current.body.own.effective, false);
  assert.equal(current.body.ranking.length, 0);
  assert.equal(current.body.rewards.length, 1);
  assert.equal(balanceDeliveries, 1);
  assert.equal(current.body.history.length, 1);
  assert.equal(current.body.history[0].boss.level, 1);
  assert.equal(current.body.history[0].own.userId, "7");
  const firstBossId = current.body.history[0].boss.id;

  const historicalLeaderboard = await app.injectRoute("GET", "/api/public/sub2api/raid/leaderboard", {
    query: { bossId: firstBossId },
    sub2apiRaid: { connectionId: "raid-main", userId: "7", username: "player" }
  });
  assert.equal(historicalLeaderboard.statusCode, 200);
  assert.equal(historicalLeaderboard.body.finalized, true);
  assert.equal(historicalLeaderboard.body.ranking[0].userId, "7");

  const publicHistory = await app.injectRoute("GET", "/api/public/sub2api/raid/history", {
    sub2apiRaid: { connectionId: "raid-main", userId: "8", username: "observer" }
  });
  assert.equal(publicHistory.body.items[0].bosses[0].ranking[0].userId, undefined);

  const adminHistory = await app.injectRoute("GET", "/api/admin/sub2api/raid/campaigns/:id/history", {
    params: { id: campaignId }
  });
  assert.equal(adminHistory.body.bosses[0].ranking[0].identity.userId, "7");
  await raid.deliverPendingRewards(campaignId);
  assert.equal(balanceDeliveries, 1);
});

test("legacy MVP campaigns keep dynamic winner settlement after the PVE upgrade", async () => {
  db.prepare(`
    INSERT INTO sub2api_connections (
      id, name, base_url, admin_token, status, created_by, created_at, updated_at
    ) VALUES ('raid-legacy', '旧版 MVP 测试', 'https://legacy.example.com', 'token', 'active', 'admin', ?, ?)
  `).run(currentNow, currentNow);
  const created = await app.injectRoute("POST", "/api/admin/sub2api/raid/campaigns", {
    body: {
      connectionId: "raid-legacy",
      name: "旧版 MVP 活动",
      month: "2026-08",
      startAt: "2026-07-31T16:00:00.000Z",
      endAt: "2026-08-31T16:00:00.000Z",
      settlementEndAt: "2026-08-31T16:10:00.000Z",
      effectiveDamageThreshold: 1,
      rewardBudget: 100,
      bosses: [boss(1, 10, 1, { themeGroupId: null, themeGroupName: "", themeMultiplier: 1 })]
    }
  });
  assert.equal(created.body.campaign.rewardMode, "pve");
  db.prepare("UPDATE sub2api_raid_campaigns SET reward_mode = 'legacy_mvp' WHERE id = ?").run(created.body.campaign.id);
  db.prepare("UPDATE sub2api_raid_bosses SET mvp_rewards = ? WHERE campaign_id = ?")
    .run(JSON.stringify([reward("MVP 1"), reward("MVP 2"), reward("MVP 3")]), created.body.campaign.id);
  const published = await app.injectRoute("POST", "/api/admin/sub2api/raid/campaigns/:id/publish", {
    params: { id: created.body.campaign.id }
  });
  assert.equal(published.body.campaign.rewardMode, "legacy_mvp");
  assert.equal(published.body.campaign.bosses[0].mvpRewards.length, 3);

  for (let userId = 1; userId <= 10; userId += 1) {
    await app.injectRoute("POST", "/api/public/sub2api/raid/enroll", {
      sub2apiRaid: { connectionId: "raid-legacy", userId: String(userId), username: `legacy-${userId}` }
    });
    remoteUsageItems.push({
      connection_id: "raid-legacy",
      id: 500 + userId,
      user_id: userId,
      actual_cost: 1,
      group_id: 1,
      created_at: `2026-08-01T00:01:${String(userId).padStart(2, "0")}.000Z`
    });
  }
  for (let sync = 0; sync < 3; sync += 1) {
    await app.injectRoute("POST", "/api/admin/sub2api/raid/connections/:id/sync-usage", {
      params: { id: "raid-legacy" }
    });
  }

  const settlement = db.prepare("SELECT * FROM sub2api_raid_settlements WHERE campaign_id = ?").get(created.body.campaign.id);
  assert.equal(settlement.mvp_slots, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM sub2api_raid_rewards WHERE settlement_id = ? AND reward_scope = 'clear'").get(settlement.id).count, 10);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM sub2api_raid_rewards WHERE settlement_id = ? AND reward_scope = 'mvp'").get(settlement.id).count, 1);
});

test("raid MVP slots keep the legacy participant boundaries", () => {
  assert.deepEqual([9, 10, 19, 20, 29, 30].map(getRaidMvpSlots), [0, 1, 1, 2, 2, 3]);
});

test("raid battle log aggregates each player's damage by authoritative minute", async () => {
  db.prepare(`
    INSERT INTO sub2api_connections (
      id, name, base_url, admin_token, status, created_by, created_at, updated_at
    ) VALUES ('raid-battle-log', '战报聚合测试', 'https://battle-log.example.com', 'token', 'active', 'admin', ?, ?)
  `).run(currentNow, currentNow);
  const created = await app.injectRoute("POST", "/api/admin/sub2api/raid/campaigns", {
    body: {
      connectionId: "raid-battle-log",
      name: "八月聚合战报",
      month: "2026-08",
      startAt: "2026-07-31T16:00:00.000Z",
      endAt: "2026-08-31T16:00:00.000Z",
      settlementEndAt: "2026-08-31T16:10:00.000Z",
      effectiveDamageThreshold: 10,
      rewardBudget: 100,
      bosses: [boss(1, 100, 10)]
    }
  });
  await app.injectRoute("POST", "/api/admin/sub2api/raid/campaigns/:id/publish", {
    params: { id: created.body.campaign.id }
  });
  const identity = { connectionId: "raid-battle-log", userId: "53", username: "player53" };
  await app.injectRoute("POST", "/api/public/sub2api/raid/enroll", { sub2apiRaid: identity });
  remoteUsageItems.push(
    { connection_id: "raid-battle-log", id: 401, user_id: 53, actual_cost: 4, group_id: 101, created_at: "2026-08-01T00:01:05.000Z" },
    { connection_id: "raid-battle-log", id: 402, user_id: 53, actual_cost: 4, group_id: 101, created_at: "2026-08-01T00:01:55.000Z" }
  );
  await app.injectRoute("POST", "/api/admin/sub2api/raid/connections/:id/sync-usage", {
    params: { id: "raid-battle-log" }
  });

  const state = await app.injectRoute("GET", "/api/public/sub2api/raid/bootstrap", { sub2apiRaid: identity });
  assert.equal(state.body.battleLog.length, 1);
  assert.equal(state.body.battleLog[0].actualCost, 8);
  assert.equal(state.body.battleLog[0].bonusDamage, 2);
  assert.equal(state.body.battleLog[0].damage, 10);
  assert.equal(state.body.battleLog[0].occurredAt, "2026-08-01T00:01:00.000Z");
  await app.injectRoute("POST", "/api/admin/sub2api/raid/campaigns/:id/abort", {
    params: { id: created.body.campaign.id },
    body: { reason: "聚合测试完成" }
  });
});

test("raid ignores duplicate usage and refuses a budget-overflowing campaign", async () => {
  const rejected = await app.injectRoute("POST", "/api/admin/sub2api/raid/campaigns", {
    body: {
      connectionId: "raid-main",
      name: "超预算",
      month: "2026-09",
      startAt: "2026-08-31T16:00:00.000Z",
      endAt: "2026-09-30T16:00:00.000Z",
      settlementEndAt: "2026-09-30T16:10:00.000Z",
      effectiveDamageThreshold: 1,
      rewardBudget: 0,
      bosses: [boss(1, 10)]
    }
  });
  assert.equal(rejected.statusCode, 409);
});

test("raid reports an existing connection-month campaign without leaking a SQLite constraint", async () => {
  const config = {
    connectionId: "raid-main",
    name: "十月活动",
    month: "2026-10",
    startAt: "2026-09-30T16:00:00.000Z",
    endAt: "2026-10-31T16:00:00.000Z",
    settlementEndAt: "2026-10-31T16:10:00.000Z",
    effectiveDamageThreshold: 10,
    rewardBudget: 100,
    bosses: [boss(1, 10)]
  };
  const created = await app.injectRoute("POST", "/api/admin/sub2api/raid/campaigns", { body: config });
  assert.equal(created.statusCode, 201);
  const duplicate = await app.injectRoute("POST", "/api/admin/sub2api/raid/campaigns", {
    body: { ...config, name: "重复月份活动" }
  });
  assert.equal(duplicate.statusCode, 409);
  assert.equal(duplicate.body.message, "该连接在 2026-10 已存在 Boss 活动，请编辑现有草稿");

  const published = await app.injectRoute("POST", "/api/admin/sub2api/raid/campaigns/:id/publish", {
    params: { id: created.body.campaign.id }
  });
  assert.equal(published.statusCode, 200);
  const locked = await app.injectRoute("POST", "/api/admin/sub2api/raid/campaigns", {
    body: { ...config, name: "不能覆盖已发布活动" }
  });
  assert.equal(locked.statusCode, 409);
  assert.equal(locked.body.message, "该连接在 2026-10 已存在 Boss 活动，该月活动已发布，不能重复创建");
});

test("raid refuses a shake-card reward without a positive internal cost", async () => {
  const invalidBoss = boss(1, 10);
  invalidBoss.clearReward = {
    name: "MVP 高级抽奖卡",
    type: "shake_card",
    quantity: 1,
    shakeCampaignId: "shake-campaign-1",
    cardTier: "high",
    cost: 0,
    fulfillmentMode: "auto"
  };
  const rejected = await app.injectRoute("POST", "/api/admin/sub2api/raid/campaigns", {
    body: {
      connectionId: "raid-main",
      name: "无成本抽奖卡",
      month: "2026-09",
      startAt: "2026-08-31T16:00:00.000Z",
      endAt: "2026-09-30T16:00:00.000Z",
      settlementEndAt: "2026-09-30T16:10:00.000Z",
      effectiveDamageThreshold: 10,
      rewardBudget: 100,
      bosses: [invalidBoss]
    }
  });
  assert.equal(rejected.statusCode, 400);
  assert.match(rejected.body.message, /内部成本/);
});

test("raid tie ordering is deterministic by the stable numeric user ID", () => {
  const insert = db.prepare(`
    INSERT INTO sub2api_raid_contributions (
      id, campaign_id, boss_id, sub2api_user_id, actual_cost, bonus_damage, damage, reached_at, updated_at
    ) VALUES (?, ?, ?, ?, 20, 0, 20, ?, ?)
  `);
  insert.run("tie-10", campaignId, secondBossId, "10", currentNow, currentNow);
  insert.run("tie-2", campaignId, secondBossId, "2", currentNow, currentNow);
  const ranking = raid.getRanking(secondBossId);
  assert.deepEqual(ranking.map((item) => item.userId), ["2", "10", "7"]);
  assert.deepEqual(ranking.map((item) => item.rank), [1, 2, null]);
});

test("raid disqualification preserves the original ranking and promotes the next eligible raider", async () => {
  const settlementId = "settlement-promotion";
  const ranking = ["2", "10", "20"].map((userId, index) => ({
    rank: index + 1, userId, damage: 10 - index, reachedAt: currentNow, effective: true
  }));
  db.prepare(`
    INSERT INTO sub2api_raid_settlements (
      id, campaign_id, boss_id, defeated_at, defeat_usage_id, total_damage,
      effective_raider_count, mvp_slots, ranking_snapshot, created_at
    ) VALUES (?, ?, ?, ?, 'promotion-boundary', 27, 3, 1, ?, ?)
  `).run(settlementId, campaignId, secondBossId, currentNow, JSON.stringify(ranking), currentNow);
  db.prepare(`
    INSERT INTO sub2api_raid_rewards (
      id, campaign_id, boss_id, settlement_id, sub2api_user_id, reward_scope,
      original_rank, final_rank, reward_snapshot, fulfillment_mode, status,
      cost, created_at, updated_at
    ) VALUES ('promotion-reward', ?, ?, ?, '2', 'mvp', 1, 1, ?, 'review', 'awaiting_review', 1, ?, ?)
  `).run(campaignId, secondBossId, settlementId, JSON.stringify({ ...reward("MVP"), fulfillmentMode: "review" }), currentNow, currentNow);

  const first = await app.injectRoute("POST", "/api/admin/sub2api/raid/settlements/:id/disqualify", {
    params: { id: settlementId },
    body: { userId: "2", reason: "关联账号异常", evidence: "risk-case-1" }
  });
  assert.equal(first.statusCode, 200);
  assert.equal(first.body.replacement.userId, "10");

  const second = await app.injectRoute("POST", "/api/admin/sub2api/raid/settlements/:id/disqualify", {
    params: { id: settlementId },
    body: { userId: "10", reason: "用量模式异常", evidence: "risk-case-2" }
  });
  assert.equal(second.statusCode, 200);
  assert.equal(second.body.replacement.userId, "20");
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM sub2api_raid_disqualifications WHERE settlement_id = ?").get(settlementId).count, 2);
});

test("aborting a raid preserves settled rewards and creates none for the active boss", async () => {
  const rewardCount = db.prepare("SELECT COUNT(*) AS count FROM sub2api_raid_rewards WHERE campaign_id = ?").get(campaignId).count;
  const settlementCount = db.prepare("SELECT COUNT(*) AS count FROM sub2api_raid_settlements WHERE campaign_id = ?").get(campaignId).count;
  const result = await app.injectRoute("POST", "/api/admin/sub2api/raid/campaigns/:id/abort", {
    params: { id: campaignId },
    body: { reason: "权威同步异常，停止本月活动" }
  });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.campaign.status, "aborted");
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM sub2api_raid_rewards WHERE campaign_id = ?").get(campaignId).count, rewardCount);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM sub2api_raid_settlements WHERE campaign_id = ?").get(campaignId).count, settlementCount);
});

test("raid deletion removes drafts and empty aborted campaigns but preserves audited campaigns", async () => {
  const config = (month, name) => ({
    connectionId: "raid-main",
    name,
    month,
    startAt: `${month}-01T00:00:00.000Z`,
    endAt: month === "2026-11" ? "2026-11-30T16:00:00.000Z" : "2026-12-31T16:00:00.000Z",
    settlementEndAt: month === "2026-11" ? "2026-11-30T16:10:00.000Z" : "2026-12-31T16:10:00.000Z",
    effectiveDamageThreshold: 10,
    rewardBudget: 100,
    bosses: [boss(1, 100)]
  });
  const draftConfig = {
    ...config("2026-11", "十一月草稿"),
    startAt: "2026-10-31T16:00:00.000Z"
  };
  const draft = await app.injectRoute("POST", "/api/admin/sub2api/raid/campaigns", { body: draftConfig });
  const draftId = draft.body.campaign.id;
  assert.equal(draft.statusCode, 201);
  assert.equal((await app.injectRoute("DELETE", "/api/admin/sub2api/raid/campaigns/:id", { params: { id: draftId } })).statusCode, 200);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM sub2api_raid_campaigns WHERE id = ?").get(draftId).count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM sub2api_raid_bosses WHERE campaign_id = ?").get(draftId).count, 0);

  const abortedConfig = {
    ...config("2026-12", "十二月中止活动"),
    startAt: "2026-11-30T16:00:00.000Z"
  };
  const created = await app.injectRoute("POST", "/api/admin/sub2api/raid/campaigns", { body: abortedConfig });
  const abortedId = created.body.campaign.id;
  await app.injectRoute("POST", "/api/admin/sub2api/raid/campaigns/:id/publish", { params: { id: abortedId } });
  const publishedDelete = await app.injectRoute("DELETE", "/api/admin/sub2api/raid/campaigns/:id", { params: { id: abortedId } });
  assert.equal(publishedDelete.statusCode, 409);
  await app.injectRoute("POST", "/api/admin/sub2api/raid/campaigns/:id/abort", {
    params: { id: abortedId },
    body: { reason: "测试中止后删除活动" }
  });
  const deleted = await app.injectRoute("DELETE", "/api/admin/sub2api/raid/campaigns/:id", { params: { id: abortedId } });
  assert.deepEqual(deleted.body, { success: true, id: abortedId });
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM sub2api_raid_campaigns WHERE id = ?").get(abortedId).count, 0);

  const protectedDelete = await app.injectRoute("DELETE", "/api/admin/sub2api/raid/campaigns/:id", { params: { id: campaignId } });
  assert.equal(protectedDelete.statusCode, 409);
  assert.match(protectedDelete.body.message, /结算、奖励或倍率权益/);
  assert.equal(auditLogs.at(-1).action, "sub2api.raid.campaign.delete");
});

test("month-end maintenance imports the final usage before ending an uncleared boss without rewards", async () => {
  db.prepare(`
    INSERT INTO sub2api_connections (
      id, name, base_url, admin_token, status, created_by, created_at, updated_at
    ) VALUES ('raid-month-end', '月末测试', 'https://month-end.example.com', 'token', 'active', 'admin', ?, ?)
  `).run(currentNow, currentNow);
  currentNow = "2026-08-01T00:00:00.000Z";
  const created = await app.injectRoute("POST", "/api/admin/sub2api/raid/campaigns", {
    body: {
      connectionId: "raid-month-end",
      name: "月末未击败测试",
      month: "2026-08",
      startAt: "2026-07-31T16:00:00.000Z",
      endAt: "2026-08-31T16:00:00.000Z",
      settlementEndAt: "2026-08-31T16:10:00.000Z",
      effectiveDamageThreshold: 10,
      rewardBudget: 100,
      bosses: [boss(1, 100)]
    }
  });
  const monthEndCampaignId = created.body.campaign.id;
  await app.injectRoute("POST", "/api/admin/sub2api/raid/campaigns/:id/publish", { params: { id: monthEndCampaignId } });
  await app.injectRoute("POST", "/api/public/sub2api/raid/enroll", {
    sub2apiRaid: { connectionId: "raid-month-end", userId: "5", username: "month-end-user" }
  });
  remoteUsageItems.push({
    connection_id: "raid-month-end", id: 900, user_id: 5, actual_cost: 1,
    group_id: 101, created_at: "2026-08-31T15:59:00.000Z"
  });
  currentNow = "2026-08-31T16:11:00.000Z";
  const maintenance = await raid.runMaintenance();
  assert.equal(maintenance.ended, 1);
  assert.equal(db.prepare("SELECT status FROM sub2api_raid_campaigns WHERE id = ?").get(monthEndCampaignId).status, "ended");
  assert.equal(db.prepare("SELECT actual_cost FROM sub2api_raid_contributions WHERE campaign_id = ?").get(monthEndCampaignId).actual_cost, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM sub2api_raid_rewards WHERE campaign_id = ?").get(monthEndCampaignId).count, 0);
});
