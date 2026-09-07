import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { JSDOM } from "jsdom";

const renderer = fs.readFileSync(new URL("../web/raid-boss.js", import.meta.url), "utf8");
const production = fs.readFileSync(new URL("../web/sub2api-raid.html", import.meta.url), "utf8");
const makeBoss = (extra = {}) => ({
  id: "first", assetKey: "leviathan", name: "测试 Boss", title: "", sequence: 1, level: 1,
  health: 2000, remainingHealth: 1900, totalDamage: 100, status: "active",
  entryCostThreshold: 10, themeMultiplier: 1.2, themeGroupId: null,
  clearReward: { name: "充值加成", type: "global_recharge_multiplier", rechargeMultiplier: 1.02 },
  mvpRewards: [], ...extra
});

test("sprite playback ignores stale image loads, pauses frames and holds the actual death pose", () => {
  const dom = new JSDOM("<div id='boss'></div>", { runScripts: "outside-only", pretendToBeVisual: true });
  try {
    const pending = [];
    const callbacks = new Map();
    let frameId = 0;
    let time = 0;
    dom.window.Image = class {
      set src(value) { this.url = value; pending.push(this); }
      get src() { return this.url; }
    };
    dom.window.requestAnimationFrame = (fn) => { callbacks.set(++frameId, fn); return frameId; };
    dom.window.cancelAnimationFrame = (id) => callbacks.delete(id);
    const advance = (count) => {
      for (let i = 0; i < count; i++) {
        time += 100;
        const batch = [...callbacks.values()];
        callbacks.clear();
        for (const fn of batch) fn(time);
      }
    };
    dom.window.eval(renderer);
    const host = dom.window.document.querySelector("#boss");
    const visual = dom.window.RaidBoss.create(host);
    visual.update(makeBoss());
    assert.ok(pending.at(-1).src.endsWith("idle.webp"));
    pending.at(-1).onload();
    advance(4);
    assert.ok(Number(host.dataset.frame) > 0);
    const pose = host.dataset.frame;
    visual.setPaused(true);
    advance(10);
    assert.equal(host.dataset.frame, pose);
    assert.equal(callbacks.size, 0);
    visual.setPaused(false);
    visual.hit();
    const lateHurt = pending.at(-1);
    assert.ok(lateHurt.src.endsWith("hurt.webp"));
    lateHurt.onload();
    advance(10);
    visual.update(makeBoss({ status: "defeated", remainingHealth: 0 }));
    const death = pending.at(-1);
    assert.ok(death.src.endsWith("death.webp"));
    advance(5);
    assert.equal(pending.at(-1), death, "old hurt must not resume idle while the death atlas is loading");
    death.onload();
    lateHurt.onload();
    assert.equal(host.dataset.clip, "death", "late hurt must not overwrite death");
    let completions = 0;
    host.addEventListener("raid-boss-defeated", () => completions++);
    advance(4);
    assert.equal(completions, 0, "completion must wait until the last frame");
    advance(26);
    assert.equal(host.dataset.frame, "75");
    assert.equal(completions, 1);
    assert.equal(callbacks.size, 0, "final death frame must remain frozen");
    const count = pending.length;
    visual.update(makeBoss({ status: "defeated", remainingHealth: 0 }));
    assert.equal(pending.length, count, "polling must not reload the atlas");
    visual.update(makeBoss({ id: "historical", status: "defeated", remainingHealth: 0 }));
    pending.at(-1).onload();
    assert.equal(host.dataset.frame, "75", "history opens directly on the actual final pose");
    visual.update(makeBoss());
    const staleIdle = pending.at(-1);
    visual.update(makeBoss({ assetKey: "prism", id: "next" }));
    staleIdle.onload?.();
    assert.equal(host.dataset.assetKey, "prism");
    assert.ok(host.querySelector(".rb-sprite-sheet"));
    assert.equal(host.dataset.clip, undefined, "old asset callback cannot set the next boss clip");
    visual.update(makeBoss());
    pending.at(-1).onerror();
    assert.equal(host.dataset.assetError, "true");
    assert.equal(host.querySelector(".rb-sprite-poster").getAttribute("visibility"), "visible");
    visual.update(makeBoss({ status: "defeated", remainingHealth: 0 }));
    visual.setReducedMotion(true);
    pending.at(-1).onload();
    assert.equal(host.dataset.frame, "75");
    assert.equal(callbacks.size, 0);
    visual.destroy();
  } finally { dom.window.close(); }
});

test("all eight bosses mount local artwork and retain their animation nodes", () => {
  const dom = new JSDOM("<div id='boss'></div>", { runScripts: "outside-only", pretendToBeVisual: true });
  try {
    dom.window.eval(renderer);
    const host = dom.window.document.querySelector("#boss");
    const visual = dom.window.RaidBoss.create(host);
    assert.equal(Object.keys(dom.window.RaidBoss.skins).length, 8);
    const art = new Set();
    for (const key of Object.keys(dom.window.RaidBoss.skins)) {
      const boss = makeBoss({ assetKey: key });
      visual.update(boss);
      assert.equal(host.dataset.assetKey, key);
      const svg = host.querySelector("svg");
      assert.ok(svg.classList.contains("rb-painted"));
      assert.equal(svg.querySelector("image").getAttribute("href"), `./assets/raid-${key}/poster.webp`);
      assert.ok(fs.existsSync(new URL(`../web/assets/raid-${key}/CREDITS.md`, import.meta.url)));
      for (const clip of ["idle", "idle-battle", "hurt", "death"]) {
        assert.ok(fs.existsSync(new URL(`../web/assets/raid-${key}/${clip}.webp`, import.meta.url)));
        assert.ok(dom.window.RaidBoss.skins[key].clips[clip].frames > 1);
      }
      assert.equal(svg.querySelectorAll("script, foreignObject").length, 0);
      const defined = new Set([...svg.querySelectorAll("[id]")].map((node) => node.id));
      for (const match of svg.outerHTML.matchAll(/url\(#([^)]+)\)/g)) assert.ok(defined.has(match[1]));
      art.add(svg.innerHTML);
      visual.update({ ...boss, totalDamage: 120, remainingHealth: 1880 });
      assert.equal(host.querySelector("svg"), svg, "polling must not rebuild SVG or restart idle animation");
    }
    assert.equal(art.size, 8);
    visual.update(makeBoss({ assetKey: "__proto__" }));
    assert.equal(host.dataset.assetKey, "leviathan");
    visual.destroy();
  } finally { dom.window.close(); }
});

test("every character plays its own frame count and source before freezing its final pose", () => {
  const dom = new JSDOM("<div id='boss'></div>", { runScripts: "outside-only", pretendToBeVisual: true });
  try {
    const loads=[];
    const callbacks=new Map();
    let id=0, clock=0;
    dom.window.Image=class { set src(v) { this.url=v; loads.push(this); } get src() { return this.url; } };
    dom.window.requestAnimationFrame=fn=>{callbacks.set(++id,fn);return id;};
    dom.window.cancelAnimationFrame=id=>callbacks.delete(id);
    dom.window.eval(renderer);
    const host=dom.window.document.querySelector("#boss");
    const visual=dom.window.RaidBoss.create(host);
    for (const [key,skin] of Object.entries(dom.window.RaidBoss.skins)) {
      const boss=makeBoss({id:key,assetKey:key});
      visual.update(boss);
      assert.equal(loads.at(-1).src,`./assets/raid-${key}/idle.webp`);
      loads.at(-1).onload();
      visual.update({...boss,remainingHealth:100});
      assert.equal(loads.at(-1).src,`./assets/raid-${key}/idle-battle.webp`);
      loads.at(-1).onload();
      visual.hit();
      assert.equal(loads.at(-1).src,`./assets/raid-${key}/hurt.webp`);
      loads.at(-1).onload();
      visual.update({...boss,status:"defeated",remainingHealth:0});
      loads.at(-1).onload();
      for(let i=0;i<50;i++) { clock+=100;const batch=[...callbacks.values()];callbacks.clear();for(const fn of batch)fn(clock); }
      assert.equal(host.dataset.frame,String(skin.clips.death.frames-1),key);
      assert.equal(callbacks.size,0,key);
      const sheet=host.querySelector(".rb-sprite-sheet");
      assert.equal(sheet.getAttribute("width"),String(skin.frame.width*skin.frame.columns));
      assert.equal(sheet.getAttribute("height"),String(skin.frame.height*Math.ceil(skin.clips.death.frames/skin.frame.columns)));
    }
    visual.destroy();
  } finally { dom.window.close(); }
});

test("zero HP waits for confirmation, defeat plays once, aborted battles sleep and motion can pause", () => {
  const dom = new JSDOM("<div id='boss'></div>", { runScripts: "outside-only", pretendToBeVisual: true });
  try {
    dom.window.eval(renderer);
    const host = dom.window.document.querySelector("#boss");
    const visual = dom.window.RaidBoss.create(host);
    visual.update(makeBoss());
    visual.update(makeBoss({ remainingHealth: 500 }));
    assert.equal(host.dataset.state, "enraged");
    visual.update(makeBoss({ remainingHealth: 0, status: "settling" }));
    assert.equal(host.dataset.state, "unstable");
    assert.equal(host.dataset.transition, "");
    const dead = makeBoss({ remainingHealth: 0, status: "defeated" });
    visual.update(dead);
    assert.equal(host.dataset.state, "defeated");
    assert.equal(host.dataset.transition, "defeat");
    const svg = host.firstElementChild;
    visual.update(dead);
    assert.equal(host.firstElementChild, svg);
    assert.equal(host.dataset.transition, "defeat");
    visual.update({ ...dead, id: "historical" });
    assert.equal(host.dataset.transition, "", "opening a historical result must not replay death");
    visual.update({ ...dead, id: "historical" });
    assert.equal(host.dataset.transition, "");
    visual.update(makeBoss({ status: "aborted" }), "aborted");
    assert.equal(host.dataset.state, "dormant");
    visual.hit();
    assert.equal(host.classList.contains("rb-hit"), false);
    visual.update(makeBoss());
    visual.setPaused(true);
    assert.equal(host.dataset.paused, "true");
    visual.hit();
    assert.equal(host.classList.contains("rb-hit"), false);
    visual.setReducedMotion(true);
    assert.equal(host.dataset.reducedMotion, "true");
    visual.update(dead, "active", false);
    assert.equal(host.dataset.transition, "");
    visual.destroy();
  } finally { dom.window.close(); }
});

test("production animates cumulative damage once and transitions only after authoritative defeat", async () => {
  let boss = makeBoss();
  let campaignStatus = "active";
  let bosses = [boss];
  let requests = 0;
  const dom = new JSDOM(production, {
    runScripts: "dangerously", pretendToBeVisual: true,
    url: "https://example.test/sub2api-raid.html?connectionId=main&token=test",
    beforeParse(window) {
      window.eval(renderer);
      window.HTMLCanvasElement.prototype.getContext = () => null;
      window.fetch = async () => {
        requests++;
        const payload = {
          sessionToken: "test", campaign: { id: "campaign", name: "测试活动", status: campaignStatus, rewardMode: "pve", bosses },
          currentBoss: boss, effectiveRaiderCount: 1, enrollment: {}, ranking: [], own: null, rewards: [], history: [], sync: null,
          // Same minute ID even when damage increases.
          battleLog: [{ id: "same-minute", damage: boss.totalDamage, actualCost: 100, maskedName: "玩家", occurredAt: "2026-09-05T00:00:00Z" }]
        };
        return { ok: true, json: async () => JSON.parse(JSON.stringify(payload)) };
      };
    }
  });
  const tick = () => new Promise((resolve) => setImmediate(resolve));
  const query = (selector) => dom.window.document.querySelector(selector);
  const refresh = async () => { query("#refresh-btn").click(); await tick(); };
  try {
    await tick();
    const host = query("#boss-scene");
    const svg = host.firstElementChild;
    assert.equal(host.dataset.state, "idle");
    assert.equal(query("#damage-float").textContent, "");
    boss = { ...boss, totalDamage: 115, remainingHealth: 1885 }; bosses = [boss];
    await refresh();
    assert.equal(host.firstElementChild, svg);
    assert.equal(query("#damage-float").textContent, "-15.00");
    assert.equal(host.classList.contains("rb-hit"), true);
    host.classList.remove("rb-hit");
    await refresh();
    assert.equal(host.classList.contains("rb-hit"), false, "identical refresh must not hit again");
    boss = { ...boss, totalDamage: 110, remainingHealth: 1890 }; bosses = [boss];
    await refresh();
    assert.equal(host.classList.contains("rb-hit"), false, "usage corrections must not fabricate hits");
    boss = { ...boss, status: "settling", remainingHealth: 0, totalDamage: 2000 }; bosses = [boss];
    await refresh();
    assert.equal(host.dataset.state, "unstable");
    assert.equal(host.dataset.transition, "");
    const firstDefeated = { ...boss, status: "defeated" };
    boss = makeBoss({ id: "second", assetKey: "prism", level: 2, sequence: 2, totalDamage: 20, remainingHealth: 1980 });
    bosses = [firstDefeated, boss];
    await refresh();
    assert.equal(host.dataset.assetKey, "leviathan");
    assert.equal(host.dataset.state, "defeated");
    assert.equal(query("#health-track").getAttribute("aria-valuenow"), "0");
    host.dispatchEvent(new dom.window.Event("raid-boss-defeated"));
    await tick();
    assert.equal(host.dataset.assetKey, "prism");
    assert.equal(host.dataset.state, "idle");
    assert.equal(host.classList.contains("rb-hit"), false, "next boss has a separate damage baseline");
    campaignStatus = "aborted";
    await refresh();
    assert.equal(host.dataset.state, "dormant");
    assert.equal(host.dataset.transition, "");
    assert.ok(requests >= 6);
  } finally { dom.window.close(); }
});
