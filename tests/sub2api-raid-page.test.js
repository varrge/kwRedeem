import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

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
  assert.match(script, /defaultRaidCardReward\("MVP 第 1 名低级抽奖卡", boss\.level \* 3\)/);
  assert.match(script, /defaultRaidCardReward\("MVP 第 3 名低级抽奖卡", boss\.level\)/);
  assert.doesNotMatch(script, /MVP 第 [123] 名额度/);
});

test("production battlefield uses server-confirmed damage and eight switchable licensed assets", () => {
  const html = fs.readFileSync(path.resolve("web/sub2api-raid.html"), "utf8");
  const assets = ["leviathan", "sentinel", "prism", "zero-core", "warden", "overmind", "behemoth", "singularity"];

  assert.match(html, /class="battlefield"/);
  assert.match(html, /class="boss-scene"/);
  assert.match(html, /backdrop-filter:\s*blur/);
  assert.match(html, /state\.lastDamageIds/);
  assert.match(html, /item\.id/);
  assert.match(html, /setInterval\(refresh, 8000\)/);
  assert.match(html, /id="sync-time"/);
  assert.match(html, /id="my-reward-list"/);
  assert.match(html, /id="history-tabs"/);
  assert.match(html, /payload\.history/);
  assert.match(html, /payload\.currentBoss \|\|/);
  assert.match(html, /pointermove/);
  assert.match(html, /prefers-reduced-motion/);
  assert.doesNotMatch(html, /@keyframes\s+(breathe|pulseBoss|bossIdle)/i);

  for (const key of assets) {
    assert.match(html, new RegExp(`boss-raid-${key}\\.jpg`));
    assert.ok(fs.existsSync(path.resolve(`web/assets/boss-raid-${key}.jpg`)), `${key} asset should exist`);
  }
});
