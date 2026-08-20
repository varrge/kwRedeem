import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { JSDOM } from "jsdom";

function loadPlanPage() {
  const html = fs.readFileSync(path.resolve("web/boss-raid-plan.html"), "utf8");
  const dom = new JSDOM(html, {
    url: "http://127.0.0.1:4173/boss-raid-plan.html",
    runScripts: "outside-only"
  });
  dom.window.scrollTo = () => {};
  const script = [...dom.window.document.scripts].find((item) => item.textContent.includes("const syncs ="));
  assert.ok(script, "Boss plan page should include its interaction script");
  dom.window.eval(script.textContent);
  return dom;
}

test("Boss Raid plan page exposes the confirmed rules and working demo interactions", () => {
  const dom = loadPlanPage();
  const { document } = dom.window;
  const source = fs.readFileSync(path.resolve("web/boss-raid-plan.html"), "utf8");

  assert.ok(document.querySelector('img[src="./assets/boss-raid-leviathan.jpg"]'));
  assert.match(document.body.textContent, /MVP 名额 = min\(3, floor\(有效参战人数 \/ 10\)\)/);
  assert.match(document.body.textContent, /最多延迟约 60 秒/);
  assert.match(document.body.textContent, /低级抽奖卡 ×6/);
  assert.doesNotMatch(document.body.textContent, /高级抽奖卡|中级抽奖卡/);
  assert.match(document.body.textContent, /首期 MVP 不使用/);
  assert.match(document.body.textContent, /CC BY-SA 2\.0/);
  assert.match(source, /@keyframes bossBreath/);
  assert.match(source, /backdrop-filter: blur/);
  assert.match(source, /stage\.addEventListener\("pointermove", moveScene\)/);

  document.querySelector('[data-view-target="rewards"]').click();
  assert.equal(document.querySelector('[data-view="rewards"]').hidden, false);
  assert.equal(document.querySelector('[data-view="battle"]').hidden, true);

  document.querySelector('[data-view-target="battle"]').click();
  document.querySelector("#join-battle").click();
  assert.equal(document.querySelector("#join-battle").disabled, true);

  const before = Number(document.querySelector(".health-track").getAttribute("aria-valuenow"));
  document.querySelector("#sync-demo").click();
  const after = Number(document.querySelector(".health-track").getAttribute("aria-valuenow"));
  assert.ok(after < before);
  assert.equal(document.querySelector("#sync-time").textContent, "刚刚");

  dom.window.close();
});
