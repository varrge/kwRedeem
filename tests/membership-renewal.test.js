import test from "node:test";
import assert from "node:assert/strict";
import {
  cancelMembershipRenewal,
  checkMembershipRenewal,
  membershipRenewalCheckUrl,
  membershipRenewalCancelUrl
} from "../shared/src/membership-renewal.js";

test("renewal cancellation uses the fixed Session token contract", async () => {
  let captured;
  const result = await cancelMembershipRenewal({ token: "session" }, {
    fetchImpl: async (url, init) => {
      captured = { url, init };
      return new Response(JSON.stringify({ code: 200, data: 1, message: "取消订阅成功" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  });
  assert.deepEqual(result, { requested: true, providerConfirmed: true, message: "取消订阅成功" });
  assert.equal(captured.url, membershipRenewalCancelUrl);
  assert.equal(captured.init.headers.Authorization, undefined);
  assert.deepEqual(JSON.parse(captured.init.body), { token: { token: "session" } });
});

test("renewal cancellation rejects ambiguous provider success", async () => {
  await assert.rejects(() => cancelMembershipRenewal({ token: "session" }, {
    fetchImpl: async () => new Response(JSON.stringify({ code: 200, data: 0 }), { status: 200 })
  }), (error) => error?.code === "RENEWAL_CANCEL_RESPONSE_INVALID");
});

test("renewal check preserves an explicit will_renew boolean and treats missing state as unknown", async () => {
  const calls = [];
  const enabled = await checkMembershipRenewal({ sessionToken: "session" }, {
    fetchImpl: async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      return new Response(JSON.stringify({
        code: 200,
        data: { account_type: "plus", is_delinquent: false, auto_renew: true }
      }), { status: 200 });
    }
  });
  assert.equal(calls[0].url, membershipRenewalCheckUrl);
  assert.equal(calls[0].body.token.sessionToken, "session");
  assert.equal(calls[0].body.token_input, undefined);
  assert.deepEqual(enabled, { isDelinquent: false, willRenew: true });

  const unknown = await checkMembershipRenewal({ sessionToken: "session" }, {
    fetchImpl: async () => new Response(JSON.stringify({
      code: 200,
      data: { account_type: "plus", is_delinquent: false }
    }), { status: 200 })
  });
  assert.deepEqual(unknown, { isDelinquent: false, willRenew: null });

  const free = await checkMembershipRenewal({ sessionToken: "session" }, {
    fetchImpl: async () => new Response(JSON.stringify({
      code: 200,
      data: {
        account_type: "free",
        auto_renew: null,
        is_delinquent: false,
        expire_time: null,
        expires_at: null
      }
    }), { status: 200 })
  });
  assert.deepEqual(free, { isDelinquent: false, willRenew: false });
});

test("renewal check treats the provider no-subscription response as free", async () => {
  const result = await checkMembershipRenewal({ sessionToken: "session" }, {
    fetchImpl: async () => new Response(JSON.stringify({
      code: 200,
      data: { token: { sessionToken: "provider-echo" } },
      message: "您还没有订阅,允许您生成订阅链接"
    }), { status: 200 })
  });
  assert.deepEqual(result, { isDelinquent: false, willRenew: false });
});
