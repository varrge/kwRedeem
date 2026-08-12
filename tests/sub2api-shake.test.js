import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kawang-sub2api-shake-"));
process.env.DATABASE_PATH = path.join(tmpDir, "test.db");

const { getDb } = await import("../shared/src/database.js");
const { createSub2ApiShakeService } = await import("../api/src/sub2api-shake.js");

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
      sub2apiShake: request.sub2apiShake
    };
    if (typeof route.options.preHandler === "function") {
      await route.options.preHandler(normalized, reply);
      if (reply.payload !== undefined) {
        return { statusCode: reply.statusCode, body: reply.payload };
      }
    }
    const result = await route.handler(normalized, reply);
    return {
      statusCode: reply.statusCode,
      body: reply.payload === undefined ? result : reply.payload
    };
  }
}

const db = getDb();
const app = new FakeApp();
let currentNow = "2026-08-12T04:00:00.000Z";
const now = currentNow;
const audits = [];
const balanceCredits = [];
let balanceCreditError = null;
let randomValue = 0.05;
let remoteUsageItems = [];

db.prepare(`
  INSERT INTO sub2api_connections (
    id, name, base_url, admin_token, status, created_by, created_at, updated_at
  ) VALUES (?, ?, ?, ?, 'active', 'admin', ?, ?)
`).run("sub-main", "Sub2api 主站", "https://sub.example.com", "encrypted-token", now, now);

const shake = createSub2ApiShakeService({
  app,
  db,
  now: () => currentNow,
  id: (() => {
    let value = 0;
    return (prefix) => `${prefix}-${++value}`;
  })(),
  random: () => randomValue,
  async creditBalance(input) {
    balanceCredits.push(structuredClone(input));
    if (balanceCreditError) throw balanceCreditError;
    return { balance: 130, transactionId: `remote-${input.drawId}` };
  },
  async listUsagePage() {
    return { items: structuredClone(remoteUsageItems), pages: 1 };
  },
  requireAdmin: async (request) => { request.admin ||= { username: "admin" }; },
  requireSession: async (request, reply) => {
    if (!request.sub2apiShake) reply.code(401).send({ message: "缺少摇摇乐会话" });
  },
  createAuditLog(entry) { audits.push(structuredClone(entry)); }
});

after(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("subscription purchase consumption grants every crossed Shake Card threshold and keeps the remainder", async () => {
  const created = await app.injectRoute("POST", "/api/admin/sub2api/shake/campaigns", {
    body: {
      connectionId: "sub-main",
      name: "八月摇摇乐",
      startAt: "2026-08-01T00:00:00.000Z",
      endAt: "2026-08-31T23:59:59.000Z",
      eligibilityRules: [{ source: "subscription_purchase", threshold: 2000 }],
      prizes: [{
        name: "谢谢参与",
        type: "empty",
        weight: 1,
        rarity: "common"
      }]
    }
  });
  assert.equal(created.statusCode, 201);

  const activated = await app.injectRoute("POST", "/api/admin/sub2api/shake/campaigns/:id/activate", {
    params: { id: created.body.campaign.id }
  });
  assert.equal(activated.statusCode, 200);

  const accepted = shake.recordConsumption({
    connectionId: "sub-main",
    userId: "42",
    email: "player@example.com",
    source: "subscription_purchase",
    cardTier: "low",
    sourceId: "subscription-order-1001",
    amount: 4500,
    occurredAt: now
  });
  assert.equal(accepted.cardsGranted, 2);

  const bootstrap = await app.injectRoute("GET", "/api/public/sub2api/shake/bootstrap", {
    sub2apiShake: {
      connectionId: "sub-main",
      userId: "42",
      email: "player@example.com",
      username: "player"
    }
  });

  assert.equal(bootstrap.statusCode, 200);
  assert.equal(bootstrap.body.availableCards, 2);
  assert.deepEqual(bootstrap.body.progress, [{
    source: "subscription_purchase",
    cardTier: "low",
    threshold: 2000,
    amount: 500,
    remaining: 1500,
    cardsEarned: 2
  }]);
  assert.equal(bootstrap.body.campaign.name, "八月摇摇乐");
  assert.equal(audits.some((entry) => entry.action === "sub2api.shake.campaign.activate"), true);
});

test("replaying the same consumption source record never grants duplicate Shake Cards", async () => {
  const first = shake.recordConsumption({
    connectionId: "sub-main",
    userId: "42",
    source: "subscription_purchase",
    sourceId: "subscription-order-1002",
    amount: 1500,
    occurredAt: now
  });
  const replayed = shake.recordConsumption({
    connectionId: "sub-main",
    userId: "42",
    source: "subscription_purchase",
    sourceId: "subscription-order-1002",
    amount: 1500,
    occurredAt: now
  });

  assert.equal(first.cardsGranted, 1);
  assert.deepEqual(replayed, { cardsGranted: 0, duplicate: true });

  const bootstrap = await app.injectRoute("GET", "/api/public/sub2api/shake/bootstrap", {
    sub2apiShake: { connectionId: "sub-main", userId: "42" }
  });
  assert.equal(bootstrap.body.availableCards, 3);
  assert.equal(bootstrap.body.progress[0].amount, 0);
});

test("changing an active eligibility rule applies on the next consumption without discarding existing progress", async () => {
  const beforeChange = shake.recordConsumption({
    connectionId: "sub-main",
    userId: "43",
    source: "subscription_purchase",
    sourceId: "subscription-order-2001",
    amount: 500,
    occurredAt: now
  });
  assert.equal(beforeChange.cardsGranted, 0);

  const changed = await app.injectRoute("POST", "/api/admin/sub2api/shake/campaigns/:id/config", {
    params: { id: "shake-campaign-1" },
    body: {
      eligibilityRules: [{ source: "subscription_purchase", threshold: 1000 }],
      prizes: [{ name: "谢谢参与", type: "empty", weight: 1, rarity: "common" }]
    }
  });
  assert.equal(changed.statusCode, 201);
  assert.equal(changed.body.version, 2);

  const afterChange = shake.recordConsumption({
    connectionId: "sub-main",
    userId: "43",
    source: "subscription_purchase",
    sourceId: "subscription-order-2002",
    amount: 500,
    occurredAt: now
  });
  assert.equal(afterChange.cardsGranted, 1);

  const bootstrap = await app.injectRoute("GET", "/api/public/sub2api/shake/bootstrap", {
    sub2apiShake: { connectionId: "sub-main", userId: "43" }
  });
  assert.equal(bootstrap.body.availableCards, 1);
  assert.deepEqual(bootstrap.body.progress, [{
    source: "subscription_purchase",
    cardTier: "low",
    threshold: 1000,
    amount: 0,
    remaining: 1000,
    cardsEarned: 1
  }]);
});

test("the public prize pool exposes admin-configured weights, probabilities, and rarity", async () => {
  const changed = await app.injectRoute("POST", "/api/admin/sub2api/shake/campaigns/:id/config", {
    params: { id: "shake-campaign-1" },
    body: {
      eligibilityRules: [{ source: "subscription_purchase", threshold: 1000 }],
      prizes: [
        { name: "$30 余额", type: "balance", amount: 30, weight: 1, rarity: "rare", sortOrder: 10 },
        { name: "再抽一次", type: "extra_draw", weight: 2, rarity: "epic", sortOrder: 20 },
        { name: "谢谢参与", type: "empty", weight: 7, rarity: "common", sortOrder: 30 }
      ]
    }
  });
  assert.equal(changed.statusCode, 201);

  const bootstrap = await app.injectRoute("GET", "/api/public/sub2api/shake/bootstrap", {
    sub2apiShake: { connectionId: "sub-main", userId: "44" }
  });
  assert.deepEqual(bootstrap.body.prizes.map((prize) => ({
    name: prize.name,
    type: prize.type,
    amount: prize.amount,
    weight: prize.weight,
    probability: prize.probability,
    rarity: prize.rarity
  })), [
    { name: "$30 余额", type: "balance", amount: 30, weight: 1, probability: 10, rarity: "rare" },
    { name: "再抽一次", type: "extra_draw", amount: null, weight: 2, probability: 20, rarity: "epic" },
    { name: "谢谢参与", type: "empty", amount: null, weight: 7, probability: 70, rarity: "common" }
  ]);
});

test("a draw consumes one Shake Card and credits the server-selected balance prize", async () => {
  const drawn = await app.injectRoute("POST", "/api/public/sub2api/shake/draws", {
    sub2apiShake: { connectionId: "sub-main", userId: "42", email: "player@example.com" },
    body: { requestId: "opening-1001" }
  });

  assert.equal(drawn.statusCode, 201);
  assert.equal(drawn.body.draw.status, "delivered");
  assert.deepEqual(drawn.body.draw.prize, {
    id: drawn.body.draw.prize.id,
    name: "$30 余额",
    type: "balance",
    amount: 30,
    rarity: "rare"
  });
  assert.equal(drawn.body.availableCards, 2);
  assert.deepEqual(balanceCredits, [{
    connectionId: "sub-main",
    userId: "42",
    amount: 30,
    drawId: drawn.body.draw.id,
    idempotencyKey: `${drawn.body.draw.id}:reward`,
    notes: `KaWang 摇摇乐奖励：八月摇摇乐 / $30 余额 / ${drawn.body.draw.id}`
  }]);
});

test("a failed balance reward keeps its fixed result and retries without consuming another card", async () => {
  balanceCreditError = new Error("remote Sub2api timeout");
  const failed = await app.injectRoute("POST", "/api/public/sub2api/shake/draws", {
    sub2apiShake: { connectionId: "sub-main", userId: "42", email: "player@example.com" },
    body: { requestId: "opening-1002" }
  });

  assert.equal(failed.statusCode, 202);
  assert.equal(failed.body.draw.status, "delivery_failed");
  assert.equal(failed.body.draw.prize.name, "$30 余额");
  assert.equal(failed.body.availableCards, 1);
  const fixedDrawId = failed.body.draw.id;

  balanceCreditError = null;
  const recovered = await app.injectRoute("POST", "/api/public/sub2api/shake/draws", {
    sub2apiShake: { connectionId: "sub-main", userId: "42", email: "player@example.com" },
    body: { requestId: "opening-1002" }
  });

  assert.equal(recovered.statusCode, 200);
  assert.equal(recovered.body.draw.id, fixedDrawId);
  assert.equal(recovered.body.draw.prize.name, "$30 余额");
  assert.equal(recovered.body.draw.status, "delivered");
  assert.equal(recovered.body.availableCards, 1);
  assert.equal(balanceCredits.at(-1).idempotencyKey, `${fixedDrawId}:reward`);
});

test("an extra-draw prize grants one new campaign-bound Shake Card without auto-drawing it", async () => {
  randomValue = 0.15;
  const drawn = await app.injectRoute("POST", "/api/public/sub2api/shake/draws", {
    sub2apiShake: { connectionId: "sub-main", userId: "43" },
    body: { requestId: "opening-extra-1001" }
  });
  randomValue = 0.05;

  assert.equal(drawn.statusCode, 201);
  assert.equal(drawn.body.draw.status, "delivered");
  assert.equal(drawn.body.draw.prize.type, "extra_draw");
  assert.equal(drawn.body.availableCards, 1);
});

test("usage sync grants cards from remote actual_cost once per stable usage ID", async () => {
  const changed = await app.injectRoute("POST", "/api/admin/sub2api/shake/campaigns/:id/config", {
    params: { id: "shake-campaign-1" },
    body: {
      eligibilityRules: [
        { source: "subscription_purchase", threshold: 1000 },
        { source: "balance_consumption", threshold: 2 }
      ],
      prizes: [{ name: "谢谢参与", type: "empty", weight: 1, rarity: "common" }]
    }
  });
  assert.equal(changed.statusCode, 201);

  remoteUsageItems = [
    { id: 903, user_id: 45, actual_cost: 0, created_at: "2026-08-12T04:03:00.000Z" },
    { id: 902, user_id: 45, actual_cost: 0.75, created_at: "2026-08-12T04:02:00.000Z" },
    { id: 901, user_id: 45, actual_cost: 1.25, created_at: "2026-08-12T04:01:00.000Z" },
    { id: 899, user_id: 45, actual_cost: 20, created_at: "2026-07-31T23:59:59.000Z" }
  ];
  const first = await app.injectRoute("POST", "/api/admin/sub2api/shake/connections/:id/sync-usage", {
    params: { id: "sub-main" }
  });
  assert.equal(first.statusCode, 200);
  assert.deepEqual(first.body, { imported: 2, cardsGranted: 1, cursor: "903" });

  const replay = await app.injectRoute("POST", "/api/admin/sub2api/shake/connections/:id/sync-usage", {
    params: { id: "sub-main" }
  });
  assert.deepEqual(replay.body, { imported: 0, cardsGranted: 0, cursor: "903" });

  const bootstrap = await app.injectRoute("GET", "/api/public/sub2api/shake/bootstrap", {
    sub2apiShake: { connectionId: "sub-main", userId: "45" }
  });
  assert.equal(bootstrap.body.availableCards, 1);
  assert.deepEqual(bootstrap.body.progress.find((item) => item.source === "balance_consumption"), {
    source: "balance_consumption",
    cardTier: "low",
    threshold: 2,
    amount: 0,
    remaining: 2,
    cardsEarned: 1
  });
});

test("subscription group usage rules stay independent from non-subscription actual-cost progress", async () => {
  const previousConfigVersionId = db.prepare(`
    SELECT active_config_version_id FROM sub2api_shake_campaigns WHERE id = 'shake-campaign-1'
  `).get().active_config_version_id;
  const changed = await app.injectRoute("POST", "/api/admin/sub2api/shake/campaigns/:id/config", {
    params: { id: "shake-campaign-1" },
    body: {
      eligibilityRules: [
        { source: "subscription_purchase", threshold: 1000 },
        { source: "balance_consumption", subscriptionGroupId: 101, cardTier: "medium", threshold: 2 },
        { source: "balance_consumption", subscriptionGroupId: 202, cardTier: "high", threshold: 3 },
        { source: "balance_consumption", cardTier: "low", threshold: 5 }
      ],
      prizes: [{ name: "谢谢参与", type: "empty", weight: 1, rarity: "common" }]
    }
  });
  assert.equal(changed.statusCode, 201);

  remoteUsageItems = [
    { id: 906, user_id: 47, group_id: 101, subscription_id: 5001, actual_cost: 1.25, created_at: "2026-08-12T04:06:00.000Z" },
    { id: 905, user_id: 47, group_id: 202, subscription_id: 5002, actual_cost: 2, created_at: "2026-08-12T04:05:00.000Z" },
    { id: 904, user_id: 47, group_id: 101, subscription_id: 5001, actual_cost: 0.75, created_at: "2026-08-12T04:04:00.000Z" }
  ];
  const first = await app.injectRoute("POST", "/api/admin/sub2api/shake/connections/:id/sync-usage", {
    params: { id: "sub-main" }
  });
  assert.deepEqual(first.body, { imported: 3, cardsGranted: 1, cursor: "906" });

  remoteUsageItems = [
    { id: 909, user_id: 47, group_id: 999, subscription_id: 5003, actual_cost: 5, created_at: "2026-08-12T04:09:00.000Z" },
    { id: 908, user_id: 47, group_id: 202, subscription_id: 5002, actual_cost: 1, created_at: "2026-08-12T04:08:00.000Z" },
    { id: 907, user_id: 47, group_id: 101, subscription_id: null, actual_cost: 5, created_at: "2026-08-12T04:07:00.000Z" }
  ];
  const second = await app.injectRoute("POST", "/api/admin/sub2api/shake/connections/:id/sync-usage", {
    params: { id: "sub-main" }
  });
  assert.deepEqual(second.body, { imported: 3, cardsGranted: 2, cursor: "909" });

  const bootstrap = await app.injectRoute("GET", "/api/public/sub2api/shake/bootstrap", {
    sub2apiShake: { connectionId: "sub-main", userId: "47" }
  });
  assert.deepEqual(bootstrap.body.availableCardsByTier, { low: 1, medium: 1, high: 1 });
  assert.deepEqual(bootstrap.body.progress.filter((item) => item.source === "balance_consumption"), [
    {
      source: "balance_consumption", subscriptionGroupId: 101, cardTier: "medium",
      threshold: 2, amount: 0, remaining: 2, cardsEarned: 1
    },
    {
      source: "balance_consumption", subscriptionGroupId: 202, cardTier: "high",
      threshold: 3, amount: 0, remaining: 3, cardsEarned: 1
    },
    {
      source: "balance_consumption", cardTier: "low",
      threshold: 5, amount: 0, remaining: 5, cardsEarned: 1
    }
  ]);

  const testConfigVersionId = db.prepare(`
    SELECT active_config_version_id FROM sub2api_shake_campaigns WHERE id = 'shake-campaign-1'
  `).get().active_config_version_id;
  db.transaction(() => {
    db.prepare("DELETE FROM sub2api_shake_cards WHERE campaign_id = 'shake-campaign-1' AND sub2api_user_id = '47'").run();
    db.prepare("DELETE FROM sub2api_shake_consumptions WHERE campaign_id = 'shake-campaign-1' AND sub2api_user_id = '47'").run();
    db.prepare("DELETE FROM sub2api_shake_progress WHERE campaign_id = 'shake-campaign-1' AND sub2api_user_id = '47'").run();
    db.prepare("DELETE FROM sub2api_shake_usage_records WHERE remote_usage_id IN ('904', '905', '906', '907', '908', '909')").run();
    db.prepare("UPDATE sub2api_shake_usage_sync SET cursor = '903' WHERE connection_id = 'sub-main'").run();
    db.prepare("UPDATE sub2api_shake_campaigns SET active_config_version_id = ? WHERE id = 'shake-campaign-1'").run(previousConfigVersionId);
    db.prepare("DELETE FROM sub2api_shake_eligibility_rules WHERE config_version_id = ?").run(testConfigVersionId);
    db.prepare("DELETE FROM sub2api_shake_prizes WHERE config_version_id = ?").run(testConfigVersionId);
    db.prepare("DELETE FROM sub2api_shake_config_versions WHERE id = ?").run(testConfigVersionId);
  })();
});

test("an audited manual grant adds campaign-bound Shake Cards for one player", async () => {
  const granted = await app.injectRoute("POST", "/api/admin/sub2api/shake/cards/grant", {
    body: {
      campaignId: "shake-campaign-1",
      userId: "46",
      email: "support-user@example.com",
      quantity: 2,
      reason: "客服补偿：订单延迟"
    }
  });
  assert.equal(granted.statusCode, 201);
  assert.equal(granted.body.granted, 2);

  const bootstrap = await app.injectRoute("GET", "/api/public/sub2api/shake/bootstrap", {
    sub2apiShake: { connectionId: "sub-main", userId: "46" }
  });
  assert.equal(bootstrap.body.availableCards, 2);
  assert.equal(audits.some((entry) => (
    entry.action === "sub2api.shake.cards.grant"
      && entry.detail.reason === "客服补偿：订单延迟"
  )), true);
});

test("an administrator can disposition a failed reward without changing its fixed prize", async () => {
  const changed = await app.injectRoute("POST", "/api/admin/sub2api/shake/campaigns/:id/config", {
    params: { id: "shake-campaign-1" },
    body: {
      eligibilityRules: [{ source: "subscription_purchase", threshold: 1000 }],
      prizes: [{ name: "$88 余额", type: "balance", amount: 88, weight: 1, rarity: "legendary" }]
    }
  });
  assert.equal(changed.statusCode, 201);

  balanceCreditError = new Error("remote delivery unknown");
  const failed = await app.injectRoute("POST", "/api/public/sub2api/shake/draws", {
    sub2apiShake: { connectionId: "sub-main", userId: "46" },
    body: { requestId: "opening-disposition-1001" }
  });
  balanceCreditError = null;
  assert.equal(failed.statusCode, 202);
  const fixedPrize = structuredClone(failed.body.draw.prize);

  const listed = await app.injectRoute("GET", "/api/admin/sub2api/shake/draws", {
    query: { status: "delivery_failed" }
  });
  assert.equal(listed.statusCode, 200);
  const listedDraw = listed.body.items.find((item) => item.id === failed.body.draw.id);
  assert.ok(listedDraw);
  assert.equal(listedDraw.userId, "46");
  assert.equal(listedDraw.dispositionReason, "");

  const confirmed = await app.injectRoute("POST", "/api/admin/sub2api/shake/draws/:id/disposition", {
    params: { id: failed.body.draw.id },
    body: { action: "confirm", reason: "远端账单 TX-1009 已核实到账" }
  });
  assert.equal(confirmed.statusCode, 200);
  assert.equal(confirmed.body.draw.status, "delivered");
  assert.deepEqual(confirmed.body.draw.prize, fixedPrize);
  assert.equal(audits.some((entry) => (
    entry.action === "sub2api.shake.reward.confirm"
      && entry.detail.reason === "远端账单 TX-1009 已核实到账"
  )), true);
});

test("public bootstrap restores fixed draw results after a refresh", async () => {
  const bootstrap = await app.injectRoute("GET", "/api/public/sub2api/shake/bootstrap", {
    sub2apiShake: { connectionId: "sub-main", userId: "46" }
  });

  assert.equal(bootstrap.statusCode, 200);
  assert.equal(bootstrap.body.draws.length, 1);
  assert.equal(bootstrap.body.draws[0].status, "delivered");
  assert.equal(bootstrap.body.draws[0].prize.name, "$88 余额");
  assert.equal(bootstrap.body.draws[0].prize.amount, 88);
});

test("the admin campaign list returns the current rules, prize pool, and card totals", async () => {
  const listed = await app.injectRoute("GET", "/api/admin/sub2api/shake/campaigns", {
    query: { connectionId: "sub-main" }
  });

  assert.equal(listed.statusCode, 200);
  assert.equal(listed.body.items.length, 1);
  assert.equal(listed.body.items[0].configVersion, 5);
  assert.deepEqual(listed.body.items[0].eligibilityRules, [
    { source: "subscription_purchase", cardTier: "low", threshold: 1000 }
  ]);
  assert.deepEqual(listed.body.items[0].prizes.map((prize) => ({
    name: prize.name,
    type: prize.type,
    amount: prize.amount,
    weight: prize.weight,
    rarity: prize.rarity
  })), [{
    name: "$88 余额",
    type: "balance",
    amount: 88,
    weight: 1,
    rarity: "legendary"
  }]);
  assert.deepEqual(listed.body.items[0].cardTotals, {
    available: 4,
    reserved: 0,
    consumed: 4,
    expired: 0
  });
});

test("ending a campaign expires every unused Shake Card and prevents further draws", async () => {
  const ended = await app.injectRoute("POST", "/api/admin/sub2api/shake/campaigns/:id/end", {
    params: { id: "shake-campaign-1" },
    body: { reason: "活动提前结束" }
  });
  assert.equal(ended.statusCode, 200);
  assert.equal(ended.body.campaign.status, "ended");
  assert.equal(ended.body.expiredCards, 4);

  const bootstrap = await app.injectRoute("GET", "/api/public/sub2api/shake/bootstrap", {
    sub2apiShake: { connectionId: "sub-main", userId: "42" }
  });
  assert.equal(bootstrap.body.campaign, null);
  assert.equal(bootstrap.body.availableCards, 0);

  const blocked = await app.injectRoute("POST", "/api/public/sub2api/shake/draws", {
    sub2apiShake: { connectionId: "sub-main", userId: "42" },
    body: { requestId: "opening-after-end" }
  });
  assert.equal(blocked.statusCode, 404);
});

test("scheduled campaigns activate and expire automatically during maintenance", async () => {
  currentNow = "2026-09-01T00:00:00.000Z";
  const created = await app.injectRoute("POST", "/api/admin/sub2api/shake/campaigns", {
    body: {
      connectionId: "sub-main",
      name: "九月摇摇乐",
      startAt: "2026-09-02T00:00:00.000Z",
      endAt: "2026-09-03T00:00:00.000Z",
      eligibilityRules: [{ source: "balance_consumption", threshold: 1 }],
      prizes: [{ name: "谢谢参与", type: "empty", weight: 1, rarity: "common" }]
    }
  });
  const activated = await app.injectRoute("POST", "/api/admin/sub2api/shake/campaigns/:id/activate", {
    params: { id: created.body.campaign.id }
  });
  assert.equal(activated.body.campaign.status, "scheduled");

  currentNow = "2026-09-02T00:00:01.000Z";
  remoteUsageItems = [{ id: 1001, user_id: 50, actual_cost: 1, created_at: currentNow }];
  const activeMaintenance = await shake.runMaintenance();
  assert.equal(activeMaintenance.campaignsActivated, 1);
  assert.equal(activeMaintenance.connectionsSynced, 1);
  assert.equal(activeMaintenance.cardsGranted, 1);

  currentNow = "2026-09-03T00:00:01.000Z";
  const endedMaintenance = await shake.runMaintenance();
  assert.equal(endedMaintenance.campaignsEnded, 1);
  assert.equal(endedMaintenance.cardsExpired, 1);
  const bootstrap = await app.injectRoute("GET", "/api/public/sub2api/shake/bootstrap", {
    sub2apiShake: { connectionId: "sub-main", userId: "50" }
  });
  assert.equal(bootstrap.body.campaign, null);
  assert.equal(bootstrap.body.availableCards, 0);
});

test("card tiers use independently configured prize probabilities", async () => {
  currentNow = "2026-10-01T00:00:00.000Z";
  const created = await app.injectRoute("POST", "/api/admin/sub2api/shake/campaigns", {
    body: {
      connectionId: "sub-main",
      name: "分级抽奖卡活动",
      startAt: "2026-10-01T00:00:00.000Z",
      endAt: "2026-10-31T23:59:59.000Z",
      eligibilityRules: [{ source: "subscription_purchase", cardTier: "high", threshold: 100 }],
      prizes: [
        {
          name: "普通奖励", type: "empty", rarity: "common", sortOrder: 10,
          weights: { low: 9, medium: 5, high: 1 }
        },
        {
          name: "高级奖励", type: "balance", amount: 100, rarity: "legendary", sortOrder: 20,
          weights: { low: 1, medium: 5, high: 9 }
        }
      ]
    }
  });
  assert.equal(created.statusCode, 201);
  await app.injectRoute("POST", "/api/admin/sub2api/shake/campaigns/:id/activate", {
    params: { id: created.body.campaign.id }
  });

  const earned = shake.recordConsumption({
    connectionId: "sub-main",
    userId: "tier-user",
    source: "subscription_purchase",
    sourceId: "tier-order-1",
    amount: 100,
    occurredAt: currentNow
  });
  assert.deepEqual(earned, { cardsGranted: 1, cardTier: "high", duplicate: false });

  const bootstrap = await app.injectRoute("GET", "/api/public/sub2api/shake/bootstrap", {
    sub2apiShake: { connectionId: "sub-main", userId: "tier-user" }
  });
  assert.deepEqual(bootstrap.body.availableCardsByTier, { low: 0, medium: 0, high: 1 });
  assert.deepEqual(bootstrap.body.prizes.map((prize) => ({
    name: prize.name,
    weights: prize.weights,
    probabilities: prize.probabilities
  })), [
    {
      name: "普通奖励",
      weights: { low: 9, medium: 5, high: 1 },
      probabilities: { low: 90, medium: 50, high: 10 }
    },
    {
      name: "高级奖励",
      weights: { low: 1, medium: 5, high: 9 },
      probabilities: { low: 10, medium: 50, high: 90 }
    }
  ]);

  randomValue = 0.15;
  const drawn = await app.injectRoute("POST", "/api/public/sub2api/shake/draws", {
    sub2apiShake: { connectionId: "sub-main", userId: "tier-user" },
    body: { requestId: "opening-high-tier-1", cardTier: "high" }
  });
  randomValue = 0.05;
  assert.equal(drawn.statusCode, 201);
  assert.equal(drawn.body.draw.cardTier, "high");
  assert.equal(drawn.body.draw.prize.name, "高级奖励");
  assert.deepEqual(drawn.body.availableCardsByTier, { low: 0, medium: 0, high: 0 });
});

test("an extra draw returns a card of the tier that was consumed", async () => {
  const changed = await app.injectRoute("POST", "/api/admin/sub2api/shake/campaigns/:id/config", {
    params: { id: db.prepare("SELECT id FROM sub2api_shake_campaigns WHERE name = ?").get("分级抽奖卡活动").id },
    body: {
      eligibilityRules: [{ source: "subscription_purchase", cardTier: "high", threshold: 100 }],
      prizes: [{
        name: "同级再抽一次", type: "extra_draw", rarity: "epic",
        weights: { low: 1, medium: 1, high: 1 }
      }]
    }
  });
  assert.equal(changed.statusCode, 201);
  const campaignId = db.prepare("SELECT id FROM sub2api_shake_campaigns WHERE name = ?").get("分级抽奖卡活动").id;
  const granted = await app.injectRoute("POST", "/api/admin/sub2api/shake/cards/grant", {
    body: {
      campaignId,
      userId: "extra-tier-user",
      cardTier: "medium",
      quantity: 1,
      reason: "分级卡测试补发"
    }
  });
  assert.equal(granted.statusCode, 201);
  assert.equal(granted.body.cardTier, "medium");

  const drawn = await app.injectRoute("POST", "/api/public/sub2api/shake/draws", {
    sub2apiShake: { connectionId: "sub-main", userId: "extra-tier-user" },
    body: { requestId: "opening-medium-tier-1", cardTier: "medium" }
  });
  assert.equal(drawn.body.draw.cardTier, "medium");
  assert.equal(drawn.body.draw.prize.type, "extra_draw");
  assert.deepEqual(drawn.body.availableCardsByTier, { low: 0, medium: 1, high: 0 });
});

test("subscription group rules grant the configured card tier and quantity once per order", async () => {
  const campaignId = db.prepare("SELECT id FROM sub2api_shake_campaigns WHERE name = ?").get("分级抽奖卡活动").id;
  const changed = await app.injectRoute("POST", "/api/admin/sub2api/shake/campaigns/:id/config", {
    params: { id: campaignId },
    body: {
      eligibilityRules: [
        { source: "subscription_purchase", subscriptionGroupId: 101, cardTier: "low", cardQuantity: 1 },
        { source: "subscription_purchase", subscriptionGroupId: 202, cardTier: "high", cardQuantity: 3 },
        { source: "balance_consumption", cardTier: "medium", threshold: 10 }
      ],
      prizes: [{
        name: "分组规则测试奖品", type: "empty", rarity: "common",
        weights: { low: 1, medium: 1, high: 1 }
      }]
    }
  });
  assert.equal(changed.statusCode, 201);

  const highCards = shake.recordConsumption({
    connectionId: "sub-main",
    userId: "group-rule-user",
    source: "subscription_purchase",
    sourceId: "subscription-order-group-202",
    subscriptionGroupId: 202,
    amount: 1,
    occurredAt: currentNow
  });
  assert.deepEqual(highCards, { cardsGranted: 3, cardTier: "high", duplicate: false });

  const lowCards = shake.recordConsumption({
    connectionId: "sub-main",
    userId: "group-rule-user",
    source: "subscription_purchase",
    sourceId: "subscription-order-group-101",
    subscriptionGroupId: 101,
    amount: 9999,
    occurredAt: currentNow
  });
  assert.deepEqual(lowCards, { cardsGranted: 1, cardTier: "low", duplicate: false });

  const ignored = shake.recordConsumption({
    connectionId: "sub-main",
    userId: "group-rule-user",
    source: "subscription_purchase",
    sourceId: "subscription-order-group-999",
    subscriptionGroupId: 999,
    amount: 9999,
    occurredAt: currentNow
  });
  assert.deepEqual(ignored, { cardsGranted: 0, accepted: false });

  const replayed = shake.recordConsumption({
    connectionId: "sub-main",
    userId: "group-rule-user",
    source: "subscription_purchase",
    sourceId: "subscription-order-group-202",
    subscriptionGroupId: 202,
    amount: 1,
    occurredAt: currentNow
  });
  assert.deepEqual(replayed, { cardsGranted: 0, duplicate: true });

  const bootstrap = await app.injectRoute("GET", "/api/public/sub2api/shake/bootstrap", {
    sub2apiShake: { connectionId: "sub-main", userId: "group-rule-user" }
  });
  assert.deepEqual(bootstrap.body.availableCardsByTier, { low: 1, medium: 0, high: 3 });
  assert.deepEqual(bootstrap.body.progress.slice(0, 2), [
    {
      source: "subscription_purchase", mode: "per_purchase", subscriptionGroupId: 101,
      cardTier: "low", cardQuantity: 1
    },
    {
      source: "subscription_purchase", mode: "per_purchase", subscriptionGroupId: 202,
      cardTier: "high", cardQuantity: 3
    }
  ]);
});
