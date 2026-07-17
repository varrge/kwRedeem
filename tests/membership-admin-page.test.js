import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { JSDOM } from "jsdom";
import { membershipFulfillmentStates } from "../shared/src/membership-fulfillment.js";

const html = fs.readFileSync(path.resolve("admin/index.html"), "utf8");
const app = fs.readFileSync(path.resolve("admin/app.js"), "utf8");

test("membership rollout console exposes only controlled phase 4-7 operations", () => {
  const dom = new JSDOM(html);
  const panel = dom.window.document.querySelector('[data-panel="membership-fulfillment"]');
  assert.ok(panel);
  assert.match(
    dom.window.document.querySelector('[data-tab="membership-fulfillment"]')?.textContent || "",
    /会员自动化/
  );

  const requiredIds = [
    "membership-rollout-mode-form",
    "membership-canary-start-form",
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
  const dashboard = dom.window.document.querySelector('[data-panel="dashboard"]');
  assert.equal(dashboard?.querySelector("#membership-rollout-mode-form"), null);
  assert.equal(dashboard?.querySelector("#membership-canary-start-form"), null);

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

test("membership fulfillment states are displayed in Chinese", () => {
  const dom = new JSDOM(html, {
    url: "http://127.0.0.1:4174/",
    runScripts: "outside-only"
  });
  dom.window.eval(app);

  assert.equal(dom.window.getMembershipFulfillmentStatusLabel("QUEUED"), "已排队");
  assert.equal(dom.window.getMembershipFulfillmentStatusLabel("ACCOUNT_CHECKING"), "正在检查订阅状态");
  assert.equal(dom.window.getMembershipFulfillmentStatusLabel("CARD_PRICE_UNAVAILABLE"), "卡片价格不可用");
  assert.equal(dom.window.getMembershipFulfillmentStatusLabel("FUNDING_READY"), "资金准备就绪");
  for (const state of membershipFulfillmentStates) {
    assert.notEqual(dom.window.getMembershipFulfillmentStatusLabel(state), state, `${state} 缺少中文显示名称`);
  }
  assert.equal(dom.window.getMembershipFulfillmentStatusLabel("UNKNOWN_NEW_STATE"), "UNKNOWN_NEW_STATE");

  dom.window.close();
});

test("membership card inventory states and reconciliation reasons are displayed in Chinese", async () => {
  const dom = new JSDOM(html, {
    url: "http://127.0.0.1:4174/",
    runScripts: "outside-only"
  });
  dom.window.fetch = async (url) => {
    const pathname = new URL(String(url)).pathname;
    const payload = pathname.endsWith("/membership-cards")
      ? {
          items: [
            {
              display: "**** 1111",
              upstreamCardId: "card_1",
              productCode: "product_1",
              upstreamStatus: "HOLD",
              availableAmount: 0,
              lane: null,
              consumedSlots: 0,
              capacityState: "AVAILABLE",
              reconciliationState: "HOLD",
              reconciliationReason: "PENDING_SETTLEMENT",
              prices: []
            },
            {
              display: "**** 2222",
              upstreamCardId: "card_2",
              productCode: "product_1",
              upstreamStatus: "HOLD",
              availableAmount: 0,
              lane: null,
              consumedSlots: 0,
              capacityState: "AVAILABLE",
              reconciliationState: "HOLD",
              reconciliationReason: "UNCLASSIFIABLE_OPENAI_PAYMENT",
              prices: []
            }
          ]
        }
      : { run: null };
    return { ok: true, status: 200, json: async () => payload };
  };
  dom.window.eval(app);

  await dom.window.refreshMembershipInventoryConsole({ hasAppSecret: true, inventoryStatus: "completed" });
  const inventoryText = dom.window.document.querySelector("#membership-card-list")?.textContent || "";
  assert.match(inventoryText, /暂挂/);
  assert.match(inventoryText, /等待交易结算/);
  assert.match(inventoryText, /无法分类的 OpenAI 支付/);
  assert.doesNotMatch(inventoryText, /HOLD|PENDING_SETTLEMENT|UNCLASSIFIABLE_OPENAI_PAYMENT/);

  for (const value of [
    "ACTIVE", "FROZEN", "CANCELLED", "DELETED", "MISSING",
    "PENDING", "READY", "HOLD", "AVAILABLE", "CAPACITY_FULL",
    "REFUNDED_FULFILLMENT", "PENDING_SETTLEMENT", "UNCLASSIFIABLE_OPENAI_PAYMENT",
    "UPGRADE_PAIR_MISSING", "MIXED_MEMBERSHIP_LANES", "MIXED_FINAL_TIERS",
    "CAPACITY_EXCEEDED", "UPSTREAM_CARD_MISSING", "CARD_SYNC_REJECTED",
    "WEBHOOK_RECHECK_PENDING"
  ]) {
    assert.notEqual(dom.window.getMembershipInventoryLabel(value), value, `${value} 缺少中文显示名称`);
  }

  dom.window.close();
});

test("legacy pending cards expose one explicit Plus confirmation action", async () => {
  const dom = new JSDOM(html, {
    url: "http://127.0.0.1:4174/",
    runScripts: "outside-only"
  });
  const requests = [];
  const cards = [{
    id: "card-legacy-plus",
    display: "525962••••7995",
    upstreamCardId: 37226,
    productCode: "USMAB01",
    upstreamStatus: "ACTIVE",
    availableAmount: 3.94,
    lane: null,
    consumedSlots: 0,
    capacityState: "HOLD",
    reconciliationState: "HOLD",
    reconciliationReason: "PENDING_SETTLEMENT",
    prices: []
  }, {
    id: "card-unclassifiable",
    display: "525962••••0001",
    upstreamCardId: 37227,
    productCode: "USMAB01",
    upstreamStatus: "ACTIVE",
    availableAmount: 0,
    lane: null,
    consumedSlots: 0,
    capacityState: "HOLD",
    reconciliationState: "HOLD",
    reconciliationReason: "UNCLASSIFIABLE_OPENAI_PAYMENT",
    prices: []
  }];
  dom.window.fetch = async (url, options = {}) => {
    const pathname = new URL(String(url)).pathname;
    requests.push({ pathname, method: options.method || "GET", body: options.body || null });
    const payload = pathname.endsWith("/membership-cards")
      ? { items: cards }
      : (pathname.endsWith("/runs/current") ? { run: null } : { item: { lane: "plus" } });
    return { ok: true, status: 200, json: async () => payload };
  };
  dom.window.confirm = () => true;
  dom.window.alert = () => {};
  dom.window.eval(app);

  await dom.window.refreshMembershipInventoryConsole({ hasAppSecret: true, inventoryStatus: "completed" });
  const buttons = [...dom.window.document.querySelectorAll("#membership-card-list [data-confirm-plus-lane]")];
  assert.deepEqual(buttons.map((button) => button.textContent.trim()), ["确认为 Plus"]);

  await dom.window.confirmMembershipCardPlusLane("card-legacy-plus");
  const request = requests.find((item) => item.method === "POST");
  assert.deepEqual(request, {
    pathname: "/api/admin/membership-cards/card-legacy-plus/confirm-plus-lane",
    method: "POST",
    body: JSON.stringify({ confirmation: "legacy_plus_cdk" })
  });

  dom.window.close();
});

test("auto refresh leaves heavy admin consoles and unsaved credentials untouched", async () => {
  const dom = new JSDOM(html, {
    url: "http://127.0.0.1:4174/",
    runScripts: "outside-only",
    pretendToBeVisual: true
  });
  const requests = [];
  const payload = {
    counts: {},
    recentLogs: [],
    items: [],
    sites: [],
    run: null,
    settings: { appId: "server_app", dependencies: {} }
  };
  dom.window.fetch = async (url) => {
    requests.push(new URL(String(url)).pathname);
    return { ok: true, status: 200, json: async () => payload };
  };
  dom.window.alert = () => {};
  dom.window.confirm = () => false;

  try {
    dom.window.eval(app);
    let tick = null;
    dom.window.setInterval = (callback) => {
      tick = callback;
      return 1;
    };
    dom.window.clearInterval = () => {};

    dom.window.switchTab("membership-fulfillment");
    const appId = dom.window.document.querySelector("#membership-app-id");
    const appSecret = dom.window.document.querySelector("#membership-app-secret");
    appId.value = "ak_unsaved";
    appSecret.value = "sk_unsaved";

    dom.window.startAutoRefresh();
    assert.equal(typeof tick, "function");
    tick();
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.deepEqual(requests, []);
    assert.equal(appId.value, "ak_unsaved");
    assert.equal(appSecret.value, "sk_unsaved");

    dom.window.switchTab("extension-delivery");
    const extensionToken = dom.window.document.querySelector("#extension-delivery-spacexcard-token");
    extensionToken.value = "gpt_token_unsaved";
    tick();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(requests, []);
    assert.equal(extensionToken.value, "gpt_token_unsaved");

    dom.window.switchTab("dashboard");
    tick();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(requests, ["/api/admin/dashboard"]);
  } finally {
    dom.window.close();
  }
});
