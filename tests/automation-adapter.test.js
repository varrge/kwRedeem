import assert from "node:assert/strict";
import test from "node:test";
import {
  AutomateV1Adapter,
  AutomationAdapterError,
  normalizeAutomateV1BaseUrl,
  normalizeAutomateV1Config
} from "../shared/src/automation-adapters/automate-v1.js";
import {
  EfunOpenV1Adapter,
  normalizeEfunAutomationProxyUrl,
  normalizeEfunOpenV1BaseUrl
} from "../shared/src/automation-adapters/efun-open-v1.js";

function response(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

const publicLookup = async () => [{ address: "203.0.113.10", family: 4 }];

test("Automate V1 normalizes documented configuration", () => {
  const config = normalizeAutomateV1Config({
    success: true,
    plans: [
      { id: "plus-monthly", name: "ChatGPT Plus", label: "Plus", taskType: "purchase" },
      { id: "subscription-upgrade", name: "Upgrade", label: "Upgrade", taskType: "upgrade" }
    ],
    regions: [{ code: "PH", currency: "PHP", label: "Philippines" }],
    defaultRegion: "PH",
    billingAddressSource: "platform_managed"
  });
  assert.deepEqual(config.plans.map((item) => item.id), ["plus-monthly", "subscription-upgrade"]);
  assert.deepEqual(config.plans.map((item) => item.canonicalOffer), ["plus", null]);
  assert.deepEqual(config.regions, [{ code: "PH", currency: "PHP", label: "Philippines" }]);
});

test("Automate V1 rejects unsafe base URLs", () => {
  assert.throws(() => normalizeAutomateV1BaseUrl("http://pro20x.com/api/v1/automate"), AutomationAdapterError);
  assert.throws(() => normalizeAutomateV1BaseUrl("https://user:pass@pro20x.com/api/v1/automate"), AutomationAdapterError);
  assert.throws(() => normalizeAutomateV1BaseUrl("https://pro20x.com/other"), AutomationAdapterError);
});

test("Automate V1 creates and normalizes a direct purchase task", async () => {
  let requestBody;
  const adapter = new AutomateV1Adapter({
    baseUrl: "https://pro20x.com/api/v1/automate",
    apiKey: "atk_live_test",
    lookup: publicLookup,
    fetchImpl: async (_url, options) => {
      requestBody = JSON.parse(options.body);
      return response({
        success: true,
        idempotentReplay: false,
        task: {
          id: "AUTO-1",
          clientOrderId: "KW1",
          planId: "plus-monthly",
          planName: "ChatGPT Plus",
          checkoutCountry: "PH",
          checkoutCurrency: "PHP",
          status: "queued",
          currentPhase: "submitted",
          message: "accepted",
          card: { brand: "MC", last4: "4444" },
          pricing: { currency: "PHP", displayTotal: "", displayUsdTotal: "", confirmed: false },
          renewalStatus: { status: "pending", verified: false, willRenew: null }
        }
      }, 201);
    }
  });
  const result = await adapter.createTask({
    clientOrderId: "KW1",
    planId: "plus-monthly",
    checkoutCountry: "PH",
    authSessionJson: { accessToken: "secret", user: { email: "test@example.com" } },
    card: { number: "5555555555554444", cvc: "123", expMonth: "12", expYear: "2029" }
  });
  assert.equal(result.task.status, "queued");
  assert.equal(result.task.card.last4, "4444");
  assert.equal(requestBody.planId, "plus-monthly");
  assert.equal(requestBody.checkoutCountry, "PH");
  assert.deepEqual(Object.keys(requestBody).sort(), ["authSessionJson", "card", "checkoutCountry", "clientOrderId", "planId"]);
});

test("Automate V1 marks documented 4xx creation rejection as no task created", async () => {
  const adapter = new AutomateV1Adapter({
    baseUrl: "https://pro20x.com/api/v1/automate",
    apiKey: "atk_live_test",
    lookup: publicLookup,
    fetchImpl: async () => response({
      success: false,
      code: "automate_points_insufficient",
      message: "insufficient"
    }, 402)
  });
  await assert.rejects(adapter.createTask({
    clientOrderId: "KW1",
    planId: "plus-monthly",
    checkoutCountry: "PH",
    authSessionJson: { accessToken: "secret" },
    card: { number: "5555555555554444", cvc: "123", expMonth: "12", expYear: "2029" }
  }), (error) => {
    assert.equal(error.code, "AUTOMATION_POINTS_INSUFFICIENT");
    assert.equal(error.definitelyNotCreated, true);
    return true;
  });
});

test("eFun Open V1 validates its documented user endpoint and exposes fixed capabilities", async () => {
  let request;
  const adapter = new EfunOpenV1Adapter({
    baseUrl: "https://efun.example/api/v1",
    apiKey: "fixed-downstream-key",
    lookup: publicLookup,
    fetchImpl: async (url, options) => {
      request = { url: String(url), options };
      return response({
        code: 0,
        message: "success",
        data: { id: "0", username: "api-user", is_active: true }
      });
    }
  });
  const config = await adapter.discoverCapabilities();
  assert.equal(request.url, "https://efun.example/api/v1/third-party/user");
  assert.equal(request.options.headers["X-API-Key"], "fixed-downstream-key");
  assert.deepEqual(config.plans.map((item) => [item.id, item.canonicalOffer]), [
    ["plus", "plus"],
    ["pro5", "x5"],
    ["pro20", "x20"]
  ]);
  assert.deepEqual(config.regions, [{ code: "PH", currency: "PHP", label: "Philippines" }]);
});

test("eFun Open V1 sends requests through its configured local proxy", async () => {
  let requestOptions;
  const adapter = new EfunOpenV1Adapter({
    baseUrl: "https://efun.example/api/v1",
    apiKey: "fixed-downstream-key",
    proxyUrl: "http://127.0.0.1:7890",
    lookup: publicLookup,
    fetchImpl: async (_url, options) => {
      requestOptions = options;
      return response({
        code: 0,
        message: "success",
        data: { id: "0", username: "api-user", is_active: true }
      });
    }
  });

  await adapter.discoverCapabilities();
  assert.ok(requestOptions.dispatcher);
  const secondAdapter = new EfunOpenV1Adapter({
    baseUrl: "https://efun.example/api/v1",
    apiKey: "fixed-downstream-key",
    proxyUrl: "http://127.0.0.1:7890",
    lookup: publicLookup,
    fetchImpl: async () => response({ code: 0, data: { is_active: true } })
  });
  assert.equal(secondAdapter.dispatcher, adapter.dispatcher);
  assert.equal(normalizeEfunAutomationProxyUrl("http://127.0.0.1:7890"), "http://127.0.0.1:7890");
  assert.throws(
    () => normalizeEfunAutomationProxyUrl("http://proxy.example:7890"),
    AutomationAdapterError
  );
});

test("eFun Open V1 sends direct card orders and keeps sensitive response fields out of normalized tasks", async () => {
  const requests = [];
  let cancelled = false;
  const adapter = new EfunOpenV1Adapter({
    baseUrl: "https://efun.example/api/v1",
    apiKey: "fixed-downstream-key",
    lookup: publicLookup,
    fetchImpl: async (url, options) => {
      requests.push({ url: String(url), options, body: options.body ? JSON.parse(options.body) : null });
      if (String(url).endsWith("/orders/direct")) {
        return response({
          code: 0,
          message: "success",
          data: {
            order_no: "12",
            status: "processing",
            card_key: "DIRECT-query-key",
            order_type: "direct",
            plan_type: "pro5"
          }
        }, 201);
      }
      return response({
        code: 0,
        message: "success",
        data: {
          order_no: "12",
          order_type: "direct",
          plan_type: "pro5",
          card_key: "DIRECT-query-key",
          bank_card_no: "5555555555554444",
          email: "secret@example.com",
          token: { accessToken: "secret-access", sessionToken: "secret-session" },
          status: "success",
          payment_amount: null,
          payment_currency: null,
          payment_result: { success: true, status: "paid", proxy: "secret-proxy" },
          is_subscription_cancelled: cancelled ? 1 : 0,
          created_at: "2026-8-16 17:30:00",
          updated_at: "2026-8-16 17:32:00"
        }
      });
    }
  });
  const session = {
    user: { id: "user-1", email: "secret@example.com" },
    account: { id: "account-1" },
    accessToken: "secret-access",
    sessionToken: "secret-session",
    expires: "2026-11-01T08:34:59.567Z"
  };
  const created = await adapter.createTask({
    clientOrderId: "KW-EFUN-1",
    planId: "pro5",
    checkoutCountry: "PH",
    authSessionJson: session,
    card: { number: "5555555555554444", cvc: "123", expMonth: "12", expYear: "2029" }
  });
  assert.equal(adapter.createReplaySafe, false);
  assert.equal(created.task.id, "DIRECT-query-key");
  assert.equal(created.task.status, "running");
  assert.deepEqual(Object.keys(requests[0].body).sort(), [
    "cardNumber", "cvv", "expMonth", "expYear", "orderType", "planType", "token"
  ]);
  assert.equal(requests[0].body.orderType, "direct");
  assert.equal(requests[0].body.planType, "pro5");

  const renewalPending = await adapter.getTask("DIRECT-query-key", {
    clientOrderId: "KW-EFUN-1",
    planId: "pro5",
    cardLast4: "4444"
  });
  assert.equal(renewalPending.task.status, "running");
  assert.equal(renewalPending.task.currentPhase, "renewal_cancellation");
  assert.equal(renewalPending.task.renewalStatus.willRenew, true);
  const persistedShape = JSON.stringify(renewalPending.task);
  assert.doesNotMatch(persistedShape, /secret-access|secret-session|secret@example\.com|5555555555554444|secret-proxy/);

  cancelled = true;
  const completed = await adapter.getTask("DIRECT-query-key", {
    clientOrderId: "KW-EFUN-1",
    planId: "pro5",
    cardLast4: "4444"
  });
  assert.equal(completed.task.status, "succeeded");
  assert.equal(completed.task.pricing.currency, "PHP");
  assert.equal(completed.task.pricing.amountUnavailable, true);
  assert.equal(completed.task.renewalStatus.willRenew, false);
  assert.equal(completed.task.card.last4, "4444");
});

test("eFun Open V1 rejects unsafe URLs and marks ambiguous creates as unsafe to replay", async () => {
  assert.throws(() => normalizeEfunOpenV1BaseUrl("http://efun.example/api/v1"), AutomationAdapterError);
  assert.throws(() => normalizeEfunOpenV1BaseUrl("https://efun.example/api/v2"), AutomationAdapterError);
  const adapter = new EfunOpenV1Adapter({
    baseUrl: "https://efun.example/api/v1",
    apiKey: "fixed-downstream-key",
    lookup: publicLookup,
    fetchImpl: async () => { throw new TypeError("connection reset"); }
  });
  await assert.rejects(adapter.createTask({
    clientOrderId: "KW-EFUN-UNKNOWN",
    planId: "plus",
    checkoutCountry: "PH",
    authSessionJson: { user: {}, account: {} },
    card: { number: "5555555555554444", cvc: "123", expMonth: "12", expYear: "2029" }
  }), (error) => {
    assert.equal(error.code, "AUTOMATION_UNAVAILABLE");
    assert.equal(error.definitelyNotCreated, false);
    assert.equal(error.unsafeToReplay, true);
    return true;
  });
});
