import test from "node:test";
import assert from "node:assert/strict";
import {
  cancelMembershipRenewal,
  membershipRenewalCancelUrl
} from "../shared/src/membership-renewal.js";

test("renewal cancellation uses the fixed authenticated token_input contract", async () => {
  let captured;
  const result = await cancelMembershipRenewal({ token: "session" }, "api-token", {
    fetchImpl: async (url, init) => {
      captured = { url, init };
      return new Response(JSON.stringify({ code: 0, data: { cancelled: true } }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  });
  assert.deepEqual(result, { requested: true, providerConfirmed: true });
  assert.equal(captured.url, membershipRenewalCancelUrl);
  assert.equal(captured.init.headers.Authorization, "Bearer api-token");
  assert.deepEqual(JSON.parse(captured.init.body), { token_input: JSON.stringify({ token: "session" }) });
});

test("renewal cancellation rejects ambiguous provider success", async () => {
  await assert.rejects(() => cancelMembershipRenewal({ token: "session" }, "api-token", {
    fetchImpl: async () => new Response(JSON.stringify({ code: 0, data: {} }), { status: 200 })
  }), (error) => error?.code === "RENEWAL_CANCEL_RESPONSE_INVALID");
});
