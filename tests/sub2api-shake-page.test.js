import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("admin exposes a dedicated Shake & Win system with campaign, prize, sync, grant, and reward controls", () => {
  const html = fs.readFileSync(path.resolve("admin/index.html"), "utf8");

  assert.match(html, /data-tab="sub2api-shake"[^>]*>[\s\S]*摇摇乐系统/);
  assert.match(html, /data-panel="sub2api-shake"/);
  assert.match(html, /id="shake-campaign-form"/);
  assert.match(html, /id="shake-prize-editor"/);
  assert.match(html, /id="shake-sync-usage-btn"/);
  assert.match(html, /id="shake-manual-grant-form"/);
  assert.match(html, /id="shake-draw-list"/);
  assert.match(html, /sub2api-shake\.html\?connectionId=/);
});

test("embedded Shake page presents a horizontal case-opening reveal with accessible motion and sound controls", () => {
  const html = fs.readFileSync(path.resolve("web/sub2api-shake.html"), "utf8");

  assert.match(html, /id="case-track"/);
  assert.match(html, /id="case-marker"/);
  assert.match(html, /id="open-case-btn"/);
  assert.match(html, /id="sound-toggle"/);
  assert.match(html, /id="probability-list"/);
  assert.match(html, /prefers-reduced-motion/);
  assert.match(html, /params\.get\("token"\)/);
  assert.doesNotMatch(html, /<canvas[^>]+wheel|class="[^"]*roulette/i);
});
