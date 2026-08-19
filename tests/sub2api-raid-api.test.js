import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import jwt from "jsonwebtoken";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kawang-sub2api-raid-api-"));
process.env.DATABASE_PATH = path.join(tmpDir, "test.db");
process.env.JWT_SECRET = "sub2api-raid-api-secret";
process.env.ADMIN_USERNAME = "admin";
process.env.ADMIN_PASSWORD = "test-password";
process.env.KAWANG_SKIP_LISTEN = "1";

const { app } = await import("../api/src/server.js");

after(async () => {
  await app.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function reward(name, amount = 1, fulfillmentMode = "auto") {
  return { name, type: "balance", amount, cost: amount, fulfillmentMode };
}

test("production routes authenticate raid administration and keep published rules immutable", async () => {
  const unauthorized = await app.inject({ method: "GET", url: "/api/admin/sub2api/raid/campaigns" });
  assert.equal(unauthorized.statusCode, 401);

  const login = await app.inject({
    method: "POST",
    url: "/api/admin/auth/login",
    payload: { username: "admin", password: "test-password" }
  });
  assert.equal(login.statusCode, 200);
  const adminHeaders = { authorization: `Bearer ${login.json().token}` };

  const connection = await app.inject({
    method: "POST",
    url: "/api/admin/sub2api/connections",
    headers: adminHeaders,
    payload: {
      name: "Raid production route",
      baseUrl: "https://raid-upstream.example.com",
      adminToken: "remote-admin-token"
    }
  });
  assert.equal(connection.statusCode, 200);
  const connectionId = connection.json().item.id;
  const config = {
    connectionId,
    name: "八月全域突袭",
    month: "2026-08",
    startAt: "2026-07-31T16:00:00.000Z",
    endAt: "2026-08-31T16:00:00.000Z",
    settlementEndAt: "2026-08-31T16:10:00.000Z",
    effectiveDamageThreshold: 10,
    rewardBudget: 1000,
    excludedUserIds: ["99"],
    bosses: [{
      level: 1,
      name: "边界哨兵",
      title: "第一防线",
      assetKey: "sentinel",
      health: 2000,
      themeGroupId: 101,
      themeGroupName: "高速中转",
      themeMultiplier: 1.25,
      clearReward: reward("共享额度"),
      mvpRewards: [reward("第一名", 20, "review"), reward("第二名", 10, "review"), reward("第三名", 5, "review")]
    }]
  };
  const created = await app.inject({
    method: "POST",
    url: "/api/admin/sub2api/raid/campaigns",
    headers: adminHeaders,
    payload: config
  });
  assert.equal(created.statusCode, 201);
  const campaignId = created.json().campaign.id;

  const published = await app.inject({
    method: "POST",
    url: `/api/admin/sub2api/raid/campaigns/${campaignId}/publish`,
    headers: adminHeaders,
    payload: {}
  });
  assert.equal(published.statusCode, 200);
  assert.equal(published.json().campaign.status, "active");

  const locked = await app.inject({
    method: "POST",
    url: `/api/admin/sub2api/raid/campaigns/${campaignId}/config`,
    headers: adminHeaders,
    payload: { ...config, name: "试图改榜" }
  });
  assert.equal(locked.statusCode, 409);

  const raidToken = jwt.sign({
    scope: "sub2api_raid",
    connectionId,
    sub2apiUserId: "77",
    email: "user@example.com",
    username: "user"
  }, process.env.JWT_SECRET, { expiresIn: "30m" });
  const bootstrap = await app.inject({
    method: "GET",
    url: "/api/public/sub2api/raid/bootstrap",
    headers: { authorization: `Bearer ${raidToken}` }
  });
  assert.equal(bootstrap.statusCode, 200);
  assert.equal(bootstrap.json().campaign.name, "八月全域突袭");
  assert.equal(bootstrap.json().currentBoss.assetKey, "sentinel");

  const leaderboard = await app.inject({
    method: "GET",
    url: `/api/public/sub2api/raid/leaderboard?bossId=${bootstrap.json().currentBoss.id}`,
    headers: { authorization: `Bearer ${raidToken}` }
  });
  assert.equal(leaderboard.statusCode, 200);
  assert.equal(leaderboard.json().finalized, false);

  const history = await app.inject({
    method: "GET",
    url: "/api/public/sub2api/raid/history",
    headers: { authorization: `Bearer ${raidToken}` }
  });
  assert.equal(history.statusCode, 200);
  assert.deepEqual(history.json().items, []);

  const adminHistory = await app.inject({
    method: "GET",
    url: `/api/admin/sub2api/raid/campaigns/${campaignId}/history`,
    headers: adminHeaders
  });
  assert.equal(adminHistory.statusCode, 200);
  assert.deepEqual(adminHistory.json().bosses, []);

  const wrongScope = jwt.sign({
    scope: "sub2api_shake", connectionId, sub2apiUserId: "77"
  }, process.env.JWT_SECRET, { expiresIn: "30m" });
  const rejected = await app.inject({
    method: "GET",
    url: "/api/public/sub2api/raid/bootstrap",
    headers: { authorization: `Bearer ${wrongScope}` }
  });
  assert.equal(rejected.statusCode, 401);
});
