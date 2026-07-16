import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { JSDOM } from "jsdom";

const html = fs.readFileSync(path.resolve("admin/index.html"), "utf8");
const app = fs.readFileSync(path.resolve("admin/app.js"), "utf8");

test("membership rollout console exposes only controlled phase 4-7 operations", () => {
  const dom = new JSDOM(html);
  const panel = dom.window.document.querySelector('[data-panel="membership-fulfillment"]');
  assert.ok(panel);

  const requiredIds = [
    "membership-canary-form",
    "membership-canary-ready-list",
    "membership-canary-authorization-list",
    "membership-qualification-form",
    "membership-qualification-list",
    "membership-automatic-scope-form",
    "membership-automatic-revision-form",
    "membership-automatic-scope-list",
    "membership-intervention-list",
    "membership-compensation-form"
  ];
  for (const id of requiredIds) {
    assert.equal(panel.querySelectorAll(`#${id}`).length, 1, `${id} should exist exactly once`);
  }

  for (const id of [
    "membership-canary-admin-password",
    "membership-automatic-admin-password",
    "membership-automatic-revision-admin-password"
  ]) {
    const input = panel.querySelector(`#${id}`);
    assert.equal(input?.type, "password");
    assert.equal(input?.autocomplete, "new-password");
  }
  for (const id of [
    "membership-canary-fulfillment",
    "membership-canary-card",
    "membership-canary-budget",
    "membership-canary-contract",
    "membership-canary-adapter",
    "membership-canary-fingerprint"
  ]) {
    assert.equal(panel.querySelector(`#${id}`)?.readOnly, true, `${id} must come from the prepared snapshot`);
  }
  assert.equal(panel.querySelector("#membership-canary-submit")?.disabled, true);

  const prohibitedButton = /(直接)?(开卡|充值|退款|冻结|删卡)|付款重试|强制成功|强制失败|无证据释放/;
  const buttonLabels = [...panel.querySelectorAll("button")].map((button) => button.textContent.trim());
  assert.equal(buttonLabels.some((label) => prohibitedButton.test(label)), false);
  dom.window.close();
});

test("membership rollout console uses the spec routes and clears fresh passwords", () => {
  for (const route of [
    "/api/admin/live-canary-authorizations",
    "/api/admin/tier-rollout-qualifications",
    "/api/admin/automatic-checkout-scopes",
    "/disable",
    "/increase-limits",
    "/api/admin/fulfillment-interventions",
    "/ack",
    "/compensations"
  ]) {
    assert.ok(app.includes(route), `missing route ${route}`);
  }

  assert.match(app, /stage:\s*refs\.membershipCanaryStage\.value/);
  assert.match(app, /pageFingerprint:\s*refs\.membershipCanaryFingerprint\.value/);
  assert.match(app, /credentials:\s*\{/);
  assert.match(app, /membershipCanaryAdminPassword\.value\s*=\s*""/);
  assert.match(app, /membershipAutomaticAdminPassword\.value\s*=\s*""/);
  assert.match(app, /membershipAutomaticRevisionAdminPassword\.value\s*=\s*""/);
  assert.doesNotMatch(app, /localStorage\.setItem\([^\n]*(membershipCanary|membershipAutomatic)/);
  assert.doesNotMatch(app, /\/api\/admin\/membership-(?:cards|fulfillments)[^"'`]*(?:open|recharge|refund|freeze|delete|force)/i);
});

test("admin script boots with the phase 4-7 DOM without an authenticated session", () => {
  const dom = new JSDOM(html, {
    url: "http://127.0.0.1:4174/",
    runScripts: "outside-only"
  });
  dom.window.alert = () => {};
  dom.window.confirm = () => false;
  assert.doesNotThrow(() => dom.window.eval(app));
  dom.window.close();
});
