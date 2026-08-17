import test from "node:test";
import assert from "node:assert/strict";
import { EfunCardOpenApiClient, normalizeEfunCardProxyUrl } from "../shared/src/efuncard-openapi.js";
import { createConfiguredAutomationCardProvider } from "../shared/src/automation-card-funding.js";

function response(data, status = 200) {
  return new Response(JSON.stringify({ success: status >= 200 && status < 300, data }), {
    status,
    headers: { "content-type": "application/json" }
  });
}

const catalog = {
  cardTypes: [{
    id: 29,
    cardType: "Z-43612081",
    effectiveCardFeeUsdt: "0.00",
    effectiveFeeRate: "0.0030",
    minServiceFeeUsdt: "0.00",
    minAmount: "5.00",
    minRechargeAmount: "5.00",
    maxAmount: "200.00",
    requireMinBalance: 1,
    minBalanceUsdt: "20.00"
  }],
  purchaseEnabled: true
};

test("EfunCard validates opening cost and reconciles the activated card", async () => {
  const requests = [];
  const client = new EfunCardOpenApiClient({
    baseUrl: "https://efun.example/api/open/v1",
    apiKey: "efk_open_test_key",
    fetchImpl: async (url, options = {}) => {
      const target = new URL(url);
      requests.push({ path: target.pathname, options });
      if (target.pathname.endsWith("/card-types")) return response(catalog);
      if (target.pathname.endsWith("/account/balance")) return response({ balance: "100.00", currency: "USDT" });
      if (target.pathname.endsWith("/cards/purchase")) {
        assert.equal(options.headers["X-Idempotency-Key"], "kwa:KWTEST:open:v1");
        assert.deepEqual(JSON.parse(options.body), {
          cardTypeId: 29,
          quantity: 1,
          openCardAmount: 25,
          remark: "kwautomation:kwa:KWTEST:open:v1"
        });
        return response({ cards: [{ id: 101, status: "PENDING" }], totalCostUsdt: "25.08" });
      }
      if (target.pathname.endsWith("/cards/101")) {
        return response({ id: 101, cardType: "Z-43612081", status: "ACTIVE", cardBalance: "25.00" });
      }
      throw new Error(`unexpected path ${target.pathname}`);
    }
  });
  const opened = await client.openCard({ productCode: "Z-43612081", initAmount: 25 }, "kwa:KWTEST:open:v1");
  assert.equal(opened.upstreamCardId, 101);
  assert.equal(opened.availableAmount, 25);
  assert.equal(opened.openFee, 0.08);
  assert.ok(requests.some((item) => item.path.endsWith("/cards/purchase")));
});

test("EfunCard validates recharge receipt before accepting the balance delta", async () => {
  let detailCalls = 0;
  const client = new EfunCardOpenApiClient({
    baseUrl: "https://efun.example/api/open/v1",
    apiKey: "efk_recharge_test_key",
    fetchImpl: async (url, options = {}) => {
      const target = new URL(url);
      if (target.pathname.endsWith("/cards/101") && (options.method || "GET") === "GET") {
        detailCalls += 1;
        return response({ id: 101, cardType: "Z-43612081", status: "ACTIVE", cardBalance: "10.00" });
      }
      if (target.pathname.endsWith("/card-types")) return response(catalog);
      if (target.pathname.endsWith("/account/balance")) return response({ balance: "100.00", currency: "USDT" });
      if (target.pathname.endsWith("/cards/101/recharge")) {
        assert.deepEqual(JSON.parse(options.body), { amount: 5 });
        return response({
          taskId: "RECHARGE-1",
          rechargeAmountUsd: 5,
          serviceFeeUsd: 0.02,
          totalCostUsdt: 5.02
        });
      }
      if (target.pathname.endsWith("/cards/101/refresh-balance")) return response({ cardBalance: "15.00" });
      throw new Error(`unexpected path ${target.pathname}`);
    }
  });
  const result = await client.rechargeCard({ cardId: 101, amount: 5 });
  assert.equal(result.succeeded, true);
  assert.equal(result.taskId, "RECHARGE-1");
  assert.equal(detailCalls, 1);
});

test("EfunCard reports sanitized metadata when the upstream returns non-JSON", async () => {
  const client = new EfunCardOpenApiClient({
    baseUrl: "https://efun.example/api/open/v1",
    apiKey: "efk_invalid_response_key",
    fetchImpl: async () => new Response("<html>proxy failure: secret-marker</html>", {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" }
    })
  });
  await assert.rejects(
    () => client.getBalance(),
    (error) => {
      assert.equal(error.code, "EFUNCARD_RESPONSE_INVALID");
      assert.equal(error.statusCode, 200);
      assert.equal(error.retryable, false);
      assert.match(error.message, /HTTP 200/);
      assert.match(error.message, /Content-Type text\/html/);
      assert.match(error.message, /字节/);
      assert.doesNotMatch(error.message, /secret-marker|proxy failure/);
      return true;
    }
  );
});

test("EfunCard classifies an HTML 403 as access denied", async () => {
  const client = new EfunCardOpenApiClient({
    baseUrl: "https://efun.example/api/open/v1",
    apiKey: "efk_forbidden_response_key",
    fetchImpl: async () => new Response("<html>blocked by gateway</html>", {
      status: 403,
      headers: { "content-type": "text/html" }
    })
  });
  await assert.rejects(
    () => client.getBalance(),
    (error) => {
      assert.equal(error.code, "EFUNCARD_ACCESS_DENIED");
      assert.equal(error.statusCode, 403);
      assert.equal(error.knownNoWrite, true);
      assert.match(error.message, /拒绝访问/);
      assert.match(error.message, /HTTP 403/);
      assert.doesNotMatch(error.message, /blocked by gateway/);
      return true;
    }
  );
});

test("EfunCard rejects a non-Open-API base URL and non-efk key", () => {
  assert.throws(
    () => new EfunCardOpenApiClient({ baseUrl: "https://efun.example/api/v1", apiKey: "efk-valid-key" }),
    (error) => error.code === "EFUNCARD_CONFIGURATION_INVALID"
      && /api\/open\/v1/.test(error.message)
  );
  assert.throws(
    () => new EfunCardOpenApiClient({ baseUrl: "https://efun.example/api/open/v1", apiKey: "plain-key" }),
    (error) => error.code === "EFUNCARD_CONFIGURATION_INVALID"
      && /efk_/.test(error.message)
  );
});

test("EfunCard sends requests through a configured local HTTP proxy", async () => {
  let requestOptions;
  const client = new EfunCardOpenApiClient({
    baseUrl: "https://efun.example/api/open/v1",
    apiKey: "efk_proxy_test_key",
    proxyUrl: "http://127.0.0.1:7890",
    fetchImpl: async (_url, options) => {
      requestOptions = options;
      return response({ balance: "100.00", currency: "USDT" });
    }
  });
  await client.getBalance();
  assert.equal(normalizeEfunCardProxyUrl("http://127.0.0.1:7890"), "http://127.0.0.1:7890");
  assert.ok(requestOptions.dispatcher);
});

test("EfunCard rejects non-local or non-HTTP proxy URLs", () => {
  for (const proxyUrl of ["socks5://127.0.0.1:7890", "http://proxy.example:7890", "http://127.0.0.1:7890/path"]) {
    assert.throws(
      () => new EfunCardOpenApiClient({
        baseUrl: "https://efun.example/api/open/v1",
        apiKey: "efk_proxy_validation_key",
        proxyUrl
      }),
      (error) => error.code === "EFUNCARD_CONFIGURATION_INVALID"
    );
  }
});

test("EfunCard defaults card listing to active cards", async () => {
  let requestedPath = "";
  const client = new EfunCardOpenApiClient({
    baseUrl: "https://efun.example/api/open/v1",
    apiKey: "efk_list_test_key",
    fetchImpl: async (url) => {
      requestedPath = new URL(url).pathname + new URL(url).search;
      return response({ total: 0, cards: [] });
    }
  });
  await client.listCards({ page: 2, pageSize: 10 });
  assert.equal(requestedPath, "/api/open/v1/cards?page=2&pageSize=10&status=active");
});

test("EfunCard extracts the API key from the stored credential envelope", () => {
  const db = {
    prepare(sql) {
      return {
        get() {
          assert.match(sql, /membership_card_platforms/);
          return {
            key: "efuncard",
            enabled: 1,
            base_url: "https://efun.example/api/open/v1",
            credential_encrypted: "encrypted-credential"
          };
        }
      };
    }
  };
  const provider = createConfiguredAutomationCardProvider(
    db,
    "efuncard",
    () => JSON.stringify({ apiKey: "efk_envelope_test_key" }),
    { efuncardProxyUrl: "http://127.0.0.1:7890" }
  );
  assert.equal(provider.apiKey, "efk_envelope_test_key");
  assert.equal(provider.proxyUrl, "http://127.0.0.1:7890");
});

test("EfunCard rejects fractional USDT recharge amounts before writing", async () => {
  const calls = [];
  const client = new EfunCardOpenApiClient({
    baseUrl: "https://efun.example/api/open/v1",
    apiKey: "efk_fractional_test_key",
    fetchImpl: async (url) => {
      const target = new URL(url);
      calls.push(target.pathname);
      if (target.pathname.endsWith("/cards/101")) {
        return response({ id: 101, cardType: "Z-43612081", status: "ACTIVE", cardBalance: "10.00" });
      }
      if (target.pathname.endsWith("/card-types")) return response(catalog);
      throw new Error(`unexpected path ${target.pathname}`);
    }
  });
  await assert.rejects(
    () => client.rechargeCard({ cardId: 101, amount: 5.5 }),
    (error) => error.code === "EFUNCARD_OPERATION_REJECTED" && /正整数/.test(error.message)
  );
  assert.deepEqual(calls, ["/api/open/v1/cards/101", "/api/open/v1/card-types"]);
});

test("EfunCard uses minRechargeAmount for recharge validation", async () => {
  const strictCatalog = {
    ...catalog,
    cardTypes: [{ ...catalog.cardTypes[0], minRechargeAmount: "10.00" }]
  };
  const calls = [];
  const client = new EfunCardOpenApiClient({
    baseUrl: "https://efun.example/api/open/v1",
    apiKey: "efk_min_recharge_test_key",
    fetchImpl: async (url) => {
      const target = new URL(url);
      calls.push(target.pathname);
      if (target.pathname.endsWith("/cards/101")) {
        return response({ id: 101, cardType: "Z-43612081", status: "ACTIVE", cardBalance: "10.00" });
      }
      if (target.pathname.endsWith("/card-types")) return response(strictCatalog);
      throw new Error(`unexpected path ${target.pathname}`);
    }
  });
  await assert.rejects(
    () => client.rechargeCard({ cardId: 101, amount: 5 }),
    (error) => error.code === "EFUNCARD_OPERATION_REJECTED"
  );
  assert.deepEqual(calls, ["/api/open/v1/cards/101", "/api/open/v1/card-types"]);
});
