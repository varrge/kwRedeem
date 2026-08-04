import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import {
  SpaceXCdkApiError,
  SpaceXCdkClient,
  decimalToMinor,
  verifySpaceXCdkWebhookSignature
} from "../shared/src/spacex-cdk.js";

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" }
  });
}

test("SpaceX CDK client issues one code with a stable idempotency key and authoritative cap", async () => {
  let request;
  const client = new SpaceXCdkClient({
    baseUrl: "https://spacex.example.com",
    apiKey: "secret-key",
    fetchImpl: async (url, options) => {
      request = { url, options };
      return jsonResponse({
        code: 0,
        data: {
          issued: [{
            id: 123,
            code: "SXC-FULL-SECRET",
            code_prefix: "SXC-FULL",
            plan: "plus",
            fee_amount_minor: 100,
            owner_funding_cap_minor: 2500,
            funding_currency: "USD"
          }]
        }
      });
    }
  });

  const result = await client.issueOne({ plan: "plus", idempotencyKey: "unit-1" });
  assert.equal(request.url, "https://spacex.example.com/openapi/v1/gpt-direct/cdks");
  assert.equal(request.options.headers["X-API-Key"], "secret-key");
  assert.equal(request.options.headers["Idempotency-Key"], "unit-1");
  assert.deepEqual(JSON.parse(request.options.body), { plan: "plus", count: 1, funding_confirmed: true });
  assert.deepEqual(result, {
    upstreamId: "123",
    code: "SXC-FULL-SECRET",
    codePrefix: "SXC-FULL",
    plan: "plus",
    feeAmountMinor: 100,
    fundingCapMinor: 2500,
    fundingCurrency: "USD",
    contractValid: true
  });
});

test("SpaceX CDK client preserves a returned full code while flagging a missing funding cap", async () => {
  const client = new SpaceXCdkClient({
    baseUrl: "https://spacex.example.com",
    apiKey: "secret-key",
    fetchImpl: async () => jsonResponse({
      code: 0,
      data: { issued: [{ id: 9, code: "SXC-ONLY-ONCE", code_prefix: "SXC-ONLY", plan: "plus", fee_amount_minor: 100 }] }
    })
  });
  const result = await client.issueOne({ plan: "plus", idempotencyKey: "unit-2" });
  assert.equal(result.code, "SXC-ONLY-ONCE");
  assert.equal(result.contractValid, false);
  assert.equal(result.fundingCapMinor, null);
});

test("SpaceX CDK issuance treats a lost response as uncertain", async () => {
  const client = new SpaceXCdkClient({
    baseUrl: "https://spacex.example.com",
    apiKey: "secret-key",
    fetchImpl: async () => { throw new Error("socket closed"); }
  });
  await assert.rejects(
    client.issueOne({ plan: "plus", idempotencyKey: "unit-3" }),
    (error) => error instanceof SpaceXCdkApiError && error.uncertain === true
  );
});

test("SpaceX public redemption keeps one device identity through preview, preflight, redeem and result", async () => {
  const calls = [];
  const client = new SpaceXCdkClient({
    baseUrl: "https://spacex.example.com",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith("/preview")) return jsonResponse({ code: 200, data: { redemption_token: "redemption", plan: "plus" } });
      if (url.endsWith("/preflight")) return jsonResponse({ code: 200, data: { preflight_token: "preflight" } });
      if (url.endsWith("/redeem")) return jsonResponse({ code: 200, data: { order_id: "order-1", status: "queued" } });
      return jsonResponse({ code: 200, data: { order_id: "order-1", status: "completed" } });
    }
  });
  const preview = await client.preview({ code: "SXC", deviceId: "device-1" });
  const preflight = await client.preflight({ redemptionToken: preview.redemptionToken, session: "session", deviceId: "device-1" });
  const accepted = await client.redeem({ redemptionToken: preview.redemptionToken, preflightToken: preflight.preflightToken, clientRequestId: "request-1", deviceId: "device-1" });
  const completed = await client.result({ redemptionToken: preview.redemptionToken, deviceId: "device-1" });
  assert.equal(accepted.status, "queued");
  assert.equal(completed.status, "completed");
  assert.ok(calls.every((call) => call.options.headers["X-Redemption-Device"] === "device-1"));
});

test("SpaceX helpers convert balances exactly and verify raw-body HMAC", () => {
  assert.equal(decimalToMinor("128.5"), 12850);
  assert.equal(decimalToMinor("0.01"), 1);
  assert.equal(decimalToMinor("1.234"), null);
  const raw = Buffer.from('{"event_id":"evt-1"}');
  const signature = createHmac("sha256", "webhook-secret").update(raw).digest("hex");
  assert.equal(verifySpaceXCdkWebhookSignature(raw, signature, "webhook-secret"), true);
  assert.equal(verifySpaceXCdkWebhookSignature(raw, "0".repeat(64), "webhook-secret"), false);
});
