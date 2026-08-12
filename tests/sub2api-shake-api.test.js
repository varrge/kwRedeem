import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import jwt from "jsonwebtoken";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kawang-sub2api-shake-api-"));
process.env.DATABASE_PATH = path.join(tmpDir, "test.db");
process.env.JWT_SECRET = "sub2api-shake-api-secret";
process.env.ADMIN_USERNAME = "admin";
process.env.ADMIN_PASSWORD = "test-password";
process.env.KAWANG_SKIP_LISTEN = "1";

const { app } = await import("../api/src/server.js");

after(async () => {
  await app.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("the production server exposes authenticated Shake campaign administration and public bootstrap", async () => {
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
      name: "Shake test upstream",
      baseUrl: "https://shake-upstream.example.com",
      adminToken: "remote-admin-token"
    }
  });
  assert.equal(connection.statusCode, 200);
  const connectionId = connection.json().item.id;

  const campaign = await app.inject({
    method: "POST",
    url: "/api/admin/sub2api/shake/campaigns",
    headers: adminHeaders,
    payload: {
      connectionId,
      name: "生产路由摇摇乐",
      startAt: "2026-01-01T00:00:00.000Z",
      endAt: "2026-12-31T23:59:59.000Z",
      eligibilityRules: [{ source: "subscription_purchase", threshold: 2000 }],
      prizes: [{ name: "谢谢参与", type: "empty", weight: 1, rarity: "common" }]
    }
  });
  assert.equal(campaign.statusCode, 201);
  const campaignId = campaign.json().campaign.id;

  const activated = await app.inject({
    method: "POST",
    url: `/api/admin/sub2api/shake/campaigns/${campaignId}/activate`,
    headers: adminHeaders
  });
  assert.equal(activated.statusCode, 200);

  const shakeSession = jwt.sign({
    scope: "sub2api_shake",
    connectionId,
    sub2apiUserId: "77",
    email: "user@example.com",
    username: "user"
  }, process.env.JWT_SECRET, { expiresIn: "30m" });
  const bootstrap = await app.inject({
    method: "GET",
    url: "/api/public/sub2api/shake/bootstrap",
    headers: { authorization: `Bearer ${shakeSession}` }
  });

  assert.equal(bootstrap.statusCode, 200);
  assert.equal(bootstrap.json().campaign.name, "生产路由摇摇乐");
  assert.equal(bootstrap.json().availableCards, 0);

  const sso = jwt.sign({
    connectionId,
    user: { id: 78, email: "sso@example.com", username: "sso-user" }
  }, "remote-admin-token", { algorithm: "HS256", expiresIn: "5m" });
  const session = await app.inject({
    method: "POST",
    url: "/api/public/sub2api/shake/session",
    payload: { sso }
  });
  assert.equal(session.statusCode, 200);
  assert.equal(session.json().campaign.name, "生产路由摇摇乐");
  assert.equal(jwt.verify(session.json().sessionToken, process.env.JWT_SECRET).scope, "sub2api_shake");
});
