import assert from "node:assert/strict";
import test from "node:test";
import {
  AutomateV1Adapter,
  AutomationAdapterError,
  normalizeAutomateV1BaseUrl,
  normalizeAutomateV1Config
} from "../shared/src/automation-adapters/automate-v1.js";

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
