import test from "node:test";
import assert from "node:assert/strict";
import { EfunCardOpenApiClient } from "../shared/src/efuncard-openapi.js";

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
    apiKey: "efun-open-test-key",
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
    apiKey: "efun-recharge-test-key",
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
