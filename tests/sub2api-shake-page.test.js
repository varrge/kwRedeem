import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("admin exposes a dedicated Shake & Win system with campaign, prize, sync, grant, and reward controls", () => {
  const html = fs.readFileSync(path.resolve("admin/index.html"), "utf8");
  const script = fs.readFileSync(path.resolve("admin/app.js"), "utf8");

  assert.match(html, /data-tab="sub2api-shake"[^>]*>[\s\S]*摇摇乐系统/);
  assert.match(html, /data-panel="sub2api-shake"/);
  assert.match(html, /id="shake-campaign-form"/);
  assert.match(html, /id="shake-prize-editor"/);
  assert.match(html, /id="shake-subscription-rule-editor"/);
  assert.match(html, /id="shake-add-subscription-rule-btn"/);
  assert.match(html, /id="shake-usage-rule-editor"/);
  assert.match(html, /id="shake-add-usage-rule-btn"/);
  assert.match(html, /id="shake-balance-tier"/);
  assert.match(html, /id="shake-grant-tier"/);
  assert.match(html, /id="shake-sync-usage-btn"/);
  assert.match(html, /id="shake-manual-grant-form"/);
  assert.match(html, /id="shake-draw-list"/);
  assert.match(html, /sub2api-shake\.html\?connectionId=/);
  assert.match(script, /_kwredeem\/sub2api-shake\.html/);
  assert.match(script, /connection\?\.baseUrl/);
  assert.match(script, /data-field="lowWeight"/);
  assert.match(script, /data-field="mediumWeight"/);
  assert.match(script, /data-field="highWeight"/);
  assert.match(script, /data-field="subscriptionGroupId"/);
  assert.match(script, /data-field="cardQuantity"/);
  assert.match(script, /data-field="usageSubscriptionGroupId"/);
  assert.match(script, /data-field="usageThreshold"/);
  assert.doesNotMatch(html, /id="shake-subscription-threshold"/);
});

test("Shake campaign numeric inputs accept valid whole-number configuration", () => {
  const html = fs.readFileSync(path.resolve("admin/index.html"), "utf8");
  const script = fs.readFileSync(path.resolve("admin/app.js"), "utf8");
  const inputs = [
    script.match(/<input[^>]+data-field="subscriptionGroupId"[^>]*>/)?.[0],
    script.match(/<input[^>]+data-field="cardQuantity"[^>]*>/)?.[0],
    script.match(/<input[^>]+data-field="usageSubscriptionGroupId"[^>]*>/)?.[0],
    script.match(/<input[^>]+data-field="usageThreshold"[^>]*>/)?.[0],
    html.match(/<input[^>]+id="shake-balance-threshold"[^>]*>/)?.[0],
    script.match(/<input[^>]+data-field="amount"[^>]*>/)?.[0],
    script.match(/<input[^>]+data-field="lowWeight"[^>]*>/)?.[0],
    script.match(/<input[^>]+data-field="mediumWeight"[^>]*>/)?.[0],
    script.match(/<input[^>]+data-field="highWeight"[^>]*>/)?.[0]
  ];

  for (const input of inputs) {
    assert.ok(input, "expected every Shake monetary input to be present");
    const minimum = Number(input.match(/\bmin="([^"]+)"/)?.[1]);
    const step = Number(input.match(/\bstep="([^"]+)"/)?.[1]);
    const stepsFromMinimum = (120 - minimum) / step;
    assert.ok(
      Math.abs(stepsFromMinimum - Math.round(stepsFromMinimum)) < 1e-9,
      `${input} rejects the whole-number amount 120 because min and step are misaligned`
    );
  }
});

test("embedded Shake page presents a horizontal case-opening reveal with accessible motion and sound controls", () => {
  const html = fs.readFileSync(path.resolve("web/sub2api-shake.html"), "utf8");

  assert.match(html, /apple-design\.css/);
  assert.match(html, /id="case-track"/);
  assert.match(html, /id="case-marker"/);
  assert.match(html, /id="open-case-btn"/);
  assert.match(html, /id="card-tier-selector"/);
  assert.match(html, /data-card-tier="low"/);
  assert.match(html, /data-card-tier="medium"/);
  assert.match(html, /data-card-tier="high"/);
  assert.match(html, /id="sound-toggle"/);
  assert.match(html, /id="probability-list"/);
  assert.match(html, /body\.embedded/);
  assert.match(html, /id="prize-modal"/);
  assert.match(html, /id="modal-claim-btn"/);
  assert.match(html, /showPrizeModal/);
  assert.match(html, /playVictoryChime/);
  assert.match(html, /prefers-reduced-motion/);
  assert.match(html, /params\.get\("token"\)/);
  assert.doesNotMatch(html, /<canvas[^>]+wheel|class="[^"]*roulette/i);
});
