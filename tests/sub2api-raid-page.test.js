import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";

test("raid admin exposes campaign, sync, reward, and battlefield controls", () => {
  const html = fs.readFileSync(path.resolve("admin/index.html"), "utf8");
  const script = fs.readFileSync(path.resolve("admin/app.js"), "utf8");

  assert.match(html, /data-tab="sub2api-raid"/);
  assert.match(html, /data-panel="sub2api-raid"/);
  for (const id of ["raid-campaign-form", "raid-boss-editor", "raid-sync-usage-btn", "raid-reward-list", "raid-history-list", "raid-copy-embed-btn"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(script, /saveRaidCampaign\(\)/);
  assert.match(script, /syncRaidUsage\(\)/);
  assert.match(script, /viewRaidHistory\(campaignId\)/);
  assert.match(script, /updateRaidRewardControls/);
  assert.match(script, /_kwredeem\/sub2api-raid\.html/);
  assert.match(script, /defaultRaidGlobalRechargeReward/);
  assert.match(script, /global_recharge_multiplier/);
  assert.match(script, /rewardMode === "legacy_mvp"/);
  assert.match(script, /existing\?\.status === "draft"/);
  assert.match(script, /发布后不能修改/);
  assert.match(script, /deleteRaidCampaign\(id\)/);
  assert.match(script, /\/api\/admin\/sub2api\/raid\/campaigns\/\$\{encodeURIComponent\(id\)\}/);
  assert.match(script, /item\.canDelete/);
  assert.match(script, /options\.body === undefined \|\| options\.body === null/);
  assert.doesNotMatch(html, /raid-damage-threshold/);
  assert.match(script, /data-field="entryCostThreshold"/);
  assert.match(script, /留空则倍率作用于全站/);
  assert.match(script, /defaultRaidLegacyMvpReward/);
});

test("production battlefield uses server-confirmed damage and eight switchable licensed assets", () => {
  const html = fs.readFileSync(path.resolve("web/sub2api-raid.html"), "utf8");
  const assets = ["leviathan", "sentinel", "prism", "zero-core", "warden", "overmind", "behemoth", "singularity"];

  assert.match(html, /class="battlefield"/);
  assert.match(html, /class="boss-scene"/);
  assert.match(html, /backdrop-filter:\s*blur/);
  assert.match(html, /Number\(boss\.totalDamage\) - Number\(previousBoss\.totalDamage\)/);
  assert.match(html, /\.\/raid-boss\.js/);
  assert.match(html, /\.\/raid-boss\.css/);
  assert.match(html, /setInterval\(refresh, 60000\)/);
  assert.match(html, /每分钟汇总同一玩家的实际消耗与伤害/);
  assert.match(html, /<script src="\.\/runtime-config\.js"><\/script>/);
  assert.match(html, /fetch\(`\$\{API_BASE\}\$\{path\}`/);
  assert.match(html, /\/api\/public\/sub2api\/raid\/session-from-token/);
  assert.match(html, /\/api\/public\/sub2api\/raid\/bootstrap/);
  assert.doesNotMatch(html, /\/api\/public\/sub2api\/raid\/state/);
  assert.match(html, /id="sync-time"/);
  assert.match(html, /id="my-reward-list"/);
  assert.match(html, /id="history-tabs"/);
  assert.match(html, /payload\.history/);
  assert.match(html, /payload\.currentBoss \|\|/);
  assert.match(html, /boss\.entryCostThreshold/);
  assert.match(html, /全站伤害 · \$\{boss\.themeMultiplier\}x/);
  assert.match(html, /pointermove/);
  assert.match(html, /prefers-reduced-motion/);
  assert.doesNotMatch(html, /@keyframes\s+(breathe|pulseBoss|bossIdle)/i);

  for (const key of assets) {
    assert.match(html, new RegExp(`boss-raid-${key}\\.jpg`));
    assert.ok(fs.existsSync(path.resolve(`web/assets/boss-raid-${key}.jpg`)), `${key} asset should exist`);
  }
});

test("production battlefield exchanges browser auth through the configured API host", async () => {
  const html = fs.readFileSync(path.resolve("web/sub2api-raid.html"), "utf8");
  const requests = [];
  const boss = {
    id: "boss-1", sequence: 1, level: 1, name: "测试核心", title: "",
    assetKey: "leviathan", health: 100, remainingHealth: 90, totalDamage: 10,
    status: "active", entryCostThreshold: 10, themeGroupId: null, themeMultiplier: 1,
    clearReward: { name: "全服充值加成", type: "global_recharge_multiplier", rechargeMultiplier: 1.2 },
    mvpRewards: []
  };
  const payload = {
    sessionToken: "raid-token",
    campaign: { name: "测试战斗", status: "active", rewardMode: "pve", bosses: [boss] },
    currentBoss: boss,
    enrollment: { enrolledAt: "2026-08-01T00:00:00.000Z" },
    effectiveRaiderCount: 1,
    mvpSlots: 0,
    ranking: [{ rank: 1, userId: "53", maskedName: "排***名", actualCost: 10, damage: 10 }],
    own: { userId: "53", actualCost: 10, damage: 10, effective: true },
    battleLog: [{ id: "log-1", maskedName: "战***报", actualCost: 10, bonusDamage: 0, damage: 10, occurredAt: "2026-08-01T00:01:00.000Z" }],
    rewards: [{ reward: { name: "我的共享奖励", type: "balance", amount: 1 }, scope: "clear", status: "delivered" }],
    history: [],
    sync: null
  };
  const dom = new JSDOM(html, {
    runScripts: "dangerously",
    url: "https://sub.vsakura.top/_kwredeem/sub2api-raid.html?connectionId=main&token=browser-token",
    beforeParse(window) {
      window.KAWANG_CONFIG = { apiUrl: "https://apikey.vsakura.top" };
      window.fetch = async (url, options) => {
        requests.push({ url: String(url), options });
        return { ok: true, status: 200, json: async () => payload };
      };
    }
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(requests[0]?.url, "https://apikey.vsakura.top/api/public/sub2api/raid/session-from-token");
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    connectionId: "main",
    accessToken: "browser-token",
    refreshToken: "",
    userId: ""
  });
  assert.match(dom.window.document.querySelector("#ranking").textContent, /排\*\*\*名/);
  assert.doesNotMatch(dom.window.document.querySelector("#ranking").textContent, /战\*\*\*报/);
  assert.match(dom.window.document.querySelector("#reward-list").textContent, /全站充值 1.20x/);
  assert.match(dom.window.document.querySelector("#my-reward-list").textContent, /我的共享奖励/);
  dom.window.document.querySelector("#refresh-btn").click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(requests[1]?.url, "https://apikey.vsakura.top/api/public/sub2api/raid/bootstrap");
  assert.equal(requests[1].options.headers.get("Authorization"), "Bearer raid-token");
  dom.window.close();
});

test("production battlefield preserves legacy MVP rewards and ranking highlights", async () => {
  const html = fs.readFileSync(path.resolve("web/sub2api-raid.html"), "utf8");
  const boss = {
    id: "legacy-boss", sequence: 1, level: 1, name: "旧版核心", title: "",
    assetKey: "sentinel", health: 100, remainingHealth: 80, totalDamage: 20,
    status: "active", entryCostThreshold: 10, themeGroupId: null, themeMultiplier: 1,
    clearReward: { name: "共享额度", type: "balance", amount: 1 },
    mvpRewards: [{ name: "MVP 一等奖", type: "shake_card", quantity: 3 }]
  };
  const payload = {
    sessionToken: "legacy-token",
    campaign: { name: "旧版活动", status: "active", rewardMode: "legacy_mvp", bosses: [boss] },
    currentBoss: boss,
    enrollment: { enrolledAt: "2026-08-01T00:00:00.000Z" },
    effectiveRaiderCount: 10,
    mvpSlots: 1,
    ranking: [{ rank: 1, userId: "53", maskedName: "旧***将", actualCost: 20, damage: 20 }],
    own: { rank: 1, userId: "53", actualCost: 20, damage: 20, effective: true },
    battleLog: [], rewards: [], history: [], sync: null
  };
  const dom = new JSDOM(html, {
    runScripts: "dangerously",
    url: "https://sub.vsakura.top/_kwredeem/sub2api-raid.html?connectionId=main&token=browser-token",
    beforeParse(window) {
      window.KAWANG_CONFIG = { apiUrl: "https://apikey.vsakura.top" };
      window.fetch = async () => ({ ok: true, status: 200, json: async () => payload });
    }
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.match(dom.window.document.querySelector("#reward-list").textContent, /MVP 一等奖/);
  assert.equal(dom.window.document.querySelector("#mvp-slots").textContent, "TOP 1");
  assert.ok(dom.window.document.querySelector("#ranking .rank").classList.contains("mvp"));
  dom.window.close();
});
