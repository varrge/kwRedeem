import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kawang-automation-runner-"));
process.env.DATABASE_PATH = path.join(tmpDir, "test.db");
process.env.JWT_SECRET = "automation-runner-test-secret";

const { getDb } = await import("../shared/src/database.js");
const { encryptText, decryptText } = await import("../shared/src/secure.js");
const { enrollAutomationOrder } = await import("../shared/src/automation-fulfillment.js");
const {
  automationCardPoolTargetUsd,
  automationRiskAllocationUsd,
  prepareAutomationCard
} = await import("../shared/src/automation-card-funding.js");
const { createAutomationRunner } = await import("../worker/src/automation-runner.js");

const db = getDb();
let clock = new Date("2026-08-15T00:00:00.000Z");

after(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("Plus shares one prefunded card across five slots while x5 and x20 keep one card per order", () => {
  const plus = { funding_amount_usd: 80, card_capacity: 5 };
  assert.equal(automationRiskAllocationUsd(plus), 16);
  assert.deepEqual(
    [0, 1, 2, 3, 4].map((occupied) => automationCardPoolTargetUsd(plus, occupied)),
    [80, 64, 48, 32, 16]
  );
  for (const mapping of [
    { funding_amount_usd: 100, card_capacity: 1 },
    { funding_amount_usd: 200, card_capacity: 1 }
  ]) {
    assert.equal(automationRiskAllocationUsd(mapping), mapping.funding_amount_usd);
    assert.equal(automationCardPoolTargetUsd(mapping, 0), mapping.funding_amount_usd);
  }
});

test("the second Plus slot reuses a 64 USD pool balance without topping the card back to 80", async () => {
  const at = clock.toISOString();
  db.prepare(`
    INSERT INTO automation_executions (
      id, order_id, order_no, product_id, status, public_message,
      card_reservation_state, created_at, updated_at
    ) VALUES ('execution-pool', 'order-pool', 'KWPOOLPLUS2', 'product-pool',
      'preparing_card', '处理中', 'unassigned', ?, ?)
  `).run(at, at);
  db.prepare(`
    INSERT INTO managed_cards (
      id, provider_key, upstream_card_id, vm_card_id, product_code, last4,
      upstream_status, cached_available_amount, lane, consumed_slots,
      capacity_state, reconciliation_state, created_at, updated_at
    ) VALUES ('card-pool', 'efuncard', 8801, '8801', 'Z-43612081', '4444',
      'ACTIVE', 64, 'plus-ph', 1, 'AVAILABLE', 'READY', ?, ?)
  `).run(at, at);
  let rechargeCalls = 0;
  const provider = {
    listCards: async () => ({
      cards: [{ upstreamCardId: 8801, availableAmount: 64, status: 'ACTIVE' }],
      total: 1
    }),
    rechargeCard: async () => {
      rechargeCalls += 1;
      throw new Error("64 USD should satisfy the second pooled slot");
    },
    getCardMaterial: async () => ({
      number: "5555555555554444",
      cvv: "123",
      expiryMonth: "12",
      expiryYear: "2029"
    })
  };
  const result = await prepareAutomationCard(db, {
    execution: db.prepare("SELECT * FROM automation_executions WHERE id = 'execution-pool'").get(),
    mapping: {
      card_platform_key: "efuncard",
      card_product_code: "Z-43612081",
      capacity_key: "plus-ph",
      card_capacity: 5,
      funding_amount_usd: 80
    },
    decryptText,
    encryptText,
    provider,
    at
  });
  const reservation = db.prepare(`
    SELECT * FROM automation_card_reservations WHERE execution_id = 'execution-pool'
  `).get();
  assert.equal(result.card.id, "card-pool");
  assert.equal(reservation.slot_index, 2);
  assert.equal(rechargeCalls, 0);
  assert.equal(db.prepare(`
    SELECT COUNT(*) AS count FROM automation_funding_intents WHERE execution_id = 'execution-pool'
  `).get().count, 0);
  db.prepare("DELETE FROM automation_card_reservations WHERE execution_id = 'execution-pool'").run();
  db.prepare("DELETE FROM automation_executions WHERE id = 'execution-pool'").run();
  db.prepare("DELETE FROM managed_cards WHERE id = 'card-pool'").run();
});

function seedOrder() {
  const at = clock.toISOString();
  db.prepare(`
    INSERT INTO products (id, code, title, status, created_at, updated_at)
    VALUES ('product-auto', 'AUTO-PRODUCT', 'Automation Product', 'active', ?, ?)
  `).run(at, at);
  db.prepare(`
    INSERT INTO cdkeys (
      id, batch_id, product_id, activation_endpoint_id, source_key, public_key,
      prefix, status, locked_at, locked_by_order_id, processing_mode, created_at, updated_at
    ) VALUES ('cdkey-auto', 'batch-auto', 'product-auto', 'endpoint-auto', 'source-auto',
      'PUBLIC-AUTO', 'AUTO', 'locked', ?, 'order-auto', 'membership_auto', ?, ?)
  `).run(at, at, at);
  db.prepare(`
    INSERT INTO redeem_orders (
      id, order_no, cdkey_id, public_key, product_id, activation_endpoint_id,
      session_payload, status, created_at, updated_at
    ) VALUES ('order-auto', 'KWTESTAUTO1', 'cdkey-auto', 'PUBLIC-AUTO', 'product-auto',
      'endpoint-auto', ?, 'pending', ?, ?)
  `).run(encryptText(JSON.stringify({ accessToken: "session-secret", user: { email: "test@example.com" } })), at, at);
  enrollAutomationOrder(db, {
    id: "execution-auto",
    orderId: "order-auto",
    orderNo: "KWTESTAUTO1",
    productId: "product-auto",
    createdAt: at
  });
  db.prepare(`
    INSERT INTO automation_providers (
      id, name, adapter_key, base_url, status, current_credential_id,
      max_concurrency, config_snapshot, config_hash, config_synced_at,
      config_status, circuit_state, created_at, updated_at, updated_by
    ) VALUES ('provider-auto', 'Provider', 'automate_v1',
      'https://example.com/api/v1/automate', 'active', 'credential-auto', 1,
      ?, 'config-hash', ?, 'ready', 'closed', ?, ?, 'test')
  `).run(JSON.stringify({
    plans: [{ id: "plus-monthly", name: "Plus", label: "Plus", taskType: "purchase" }],
    regions: [{ code: "PH", currency: "PHP", label: "Philippines" }],
    defaultRegion: "PH"
  }), at, at, at);
  db.prepare(`
    INSERT INTO automation_provider_credentials (
      id, provider_id, api_key_encrypted, status, created_at, created_by
    ) VALUES ('credential-auto', 'provider-auto', ?, 'current', ?, 'test')
  `).run(encryptText("test-api-key"), at);
  db.prepare(`
    INSERT INTO automation_product_mappings (
      id, product_id, provider_id, external_plan_id, external_task_type,
      region_code, currency, card_platform_key, card_product_code, capacity_key,
      card_capacity, funding_amount_usd, expected_min_amount, expected_max_amount,
      daily_risk_limit_usd, priority, enabled, capability_snapshot,
      created_at, updated_at, updated_by
    ) VALUES ('mapping-auto', 'product-auto', 'provider-auto', 'plus-monthly', 'purchase',
      'PH', 'PHP', 'spacexcard', 'CARD-PRODUCT', 'plus', 1, 25, 900, 1200,
      100, 1, 1, '{}', ?, ?, 'test')
  `).run(at, at);
}

function normalizedTask(status) {
  return {
    id: "REMOTE-AUTO-1",
    clientOrderId: "KWTESTAUTO1",
    status,
    terminal: status === "succeeded",
    planId: "plus-monthly",
    checkoutCountry: "PH",
    checkoutCurrency: "PHP",
    currentPhase: status === "succeeded" ? "finished" : "submitted",
    message: status === "succeeded" ? "completed" : "accepted",
    card: { brand: "MC", last4: "4444" },
    pricing: {
      currency: "PHP",
      displayTotal: status === "succeeded" ? "PHP 1,100.00" : "",
      displayUsdTotal: "",
      confirmed: status === "succeeded"
    },
    renewalStatus: { status: status === "succeeded" ? "cancelled" : "pending", verified: status === "succeeded", willRenew: false },
    error: null
  };
}

test("automation runner keeps Gate closed, then settles one accepted remote task", async () => {
  seedOrder();
  let prepareCalls = 0;
  let createCalls = 0;
  let queryCalls = 0;
  const prepareCard = async (database, { execution }) => {
    prepareCalls += 1;
    if (!database.prepare("SELECT id FROM managed_cards WHERE id = 'card-auto'").get()) {
      const at = clock.toISOString();
      database.prepare(`
        INSERT INTO managed_cards (
          id, provider_key, upstream_card_id, vm_card_id, product_code, last4,
          upstream_status, cached_available_amount, lane, consumed_slots,
          capacity_state, reconciliation_state, created_at, updated_at
        ) VALUES ('card-auto', 'spacexcard', 101, 'vm-101', 'CARD-PRODUCT', '4444',
          'ACTIVE', 25, 'plus', 0, 'AVAILABLE', 'READY', ?, ?)
      `).run(at, at);
      database.prepare(`
        INSERT INTO automation_card_reservations (
          id, execution_id, provider_key, card_id, capacity_key, slot_index, state, reserved_at
        ) VALUES ('reservation-auto', ?, 'spacexcard', 'card-auto', 'plus', 1, 'reserved', ?)
      `).run(execution.id, at);
      database.prepare(`
        UPDATE automation_executions
        SET card_id = 'card-auto', card_last4 = '4444', card_reservation_state = 'reserved'
        WHERE id = ?
      `).run(execution.id);
    }
    return {
      card: database.prepare("SELECT * FROM managed_cards WHERE id = 'card-auto'").get(),
      material: { number: "5555555555554444", cvc: "123", expMonth: "12", expYear: "2029" }
    };
  };
  const adapterFactory = () => ({
    adapter: {
      createTask: async (input) => {
        createCalls += 1;
        assert.equal(input.authSessionJson.accessToken, "session-secret");
        assert.equal(input.planId, "plus-monthly");
        return { task: normalizedTask("queued") };
      },
      getTask: async () => {
        queryCalls += 1;
        return { task: normalizedTask("succeeded") };
      }
    }
  });
  const runner = createAutomationRunner({
    db,
    decryptText,
    encryptText,
    workerId: "test-worker",
    now: () => new Date(clock),
    prepareCard,
    adapterFactory,
    providerSync: async () => {
      throw new Error("fresh config must not sync");
    }
  });

  await runner.tick();
  assert.equal(db.prepare("SELECT status FROM automation_executions WHERE id = 'execution-auto'").get().status, "waiting_gate");
  assert.equal(prepareCalls, 0);
  assert.equal(createCalls, 0);

  db.prepare(`
    UPDATE automation_fulfillment_settings
    SET payment_gate_enabled = 1, mode = 'automatic', updated_at = ?
    WHERE id = 'default'
  `).run(clock.toISOString());
  db.prepare("UPDATE automation_executions SET next_action_at = ? WHERE id = 'execution-auto'").run(clock.toISOString());

  await runner.tick();
  assert.equal(db.prepare("SELECT status FROM automation_executions WHERE id = 'execution-auto'").get().status, "preparing_card");
  await runner.tick();
  assert.equal(db.prepare("SELECT status FROM automation_executions WHERE id = 'execution-auto'").get().status, "submitting");
  await runner.tick();
  assert.equal(db.prepare("SELECT status FROM automation_executions WHERE id = 'execution-auto'").get().status, "queued");
  assert.equal(createCalls, 1);

  clock = new Date(clock.getTime() + 3_000);
  await runner.tick();
  assert.equal(queryCalls, 1);
  assert.equal(db.prepare("SELECT status FROM automation_executions WHERE id = 'execution-auto'").get().status, "succeeded");
  assert.equal(db.prepare("SELECT status FROM redeem_orders WHERE id = 'order-auto'").get().status, "succeeded");
  assert.equal(db.prepare("SELECT session_payload FROM redeem_orders WHERE id = 'order-auto'").get().session_payload, "");
  assert.equal(db.prepare("SELECT status FROM cdkeys WHERE id = 'cdkey-auto'").get().status, "used");
  assert.equal(db.prepare("SELECT consumed_slots FROM managed_cards WHERE id = 'card-auto'").get().consumed_slots, 1);
});

test("the explicit no-payment order is enrolled directly into manual hold", () => {
  const at = clock.toISOString();
  db.prepare(`
    INSERT INTO redeem_orders (
      id, order_no, cdkey_id, public_key, product_id, activation_endpoint_id,
      session_payload, status, created_at, updated_at
    ) VALUES ('order-no-payment', 'KW1786762677460466', 'cdkey-auto', 'PUBLIC-AUTO',
      'product-auto', 'endpoint-auto', 'encrypted-session', 'pending', ?, ?)
  `).run(at, at);
  const execution = enrollAutomationOrder(db, {
    orderId: "order-no-payment",
    orderNo: "KW1786762677460466",
    productId: "product-auto",
    createdAt: at
  });
  assert.equal(execution.status, "manual_hold");
  assert.equal(execution.last_error_code, "NO_PAYMENT_MANUAL_HOLD");
  assert.equal(execution.next_action_at, null);
});
