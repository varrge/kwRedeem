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
  assert.match(html, /id="shake-sync-usage-btn"/);
  assert.match(html, /id="shake-manual-grant-form"/);
  assert.match(html, /id="shake-draw-list"/);
  assert.match(html, /sub2api-shake\.html\?connectionId=/);
  assert.match(script, /_kwredeem\/sub2api-shake\.html/);
  assert.match(script, /connection\?\.baseUrl/);
});

test("embedded Shake page presents a horizontal case-opening reveal with accessible motion and sound controls", () => {
  const html = fs.readFileSync(path.resolve("web/sub2api-shake.html"), "utf8");

  assert.match(html, /apple-design\.css/);
  assert.match(html, /id="case-track"/);
  assert.match(html, /id="case-marker"/);
  assert.match(html, /id="open-case-btn"/);
  assert.match(html, /id="sound-toggle"/);
  assert.match(html, /id="probability-list"/);
  assert.match(html, /id="prize-modal"/);
  assert.match(html, /id="modal-claim-btn"/);
  assert.match(html, /showPrizeModal/);
  assert.match(html, /playVictoryChime/);
  assert.match(html, /prefers-reduced-motion/);
  assert.match(html, /params\.get\("token"\)/);
  assert.doesNotMatch(html, /<canvas[^>]+wheel|class="[^"]*roulette/i);
});
