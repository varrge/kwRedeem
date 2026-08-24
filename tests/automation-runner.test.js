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
  automationRiskAllocationUsd,
  prepareAutomationCard
} = await import("../shared/src/automation-card-funding.js");
const { createAutomationRunner } = await import("../worker/src/automation-runner.js");
const { AutomationAdapterError } = await import("../shared/src/automation-adapters/automate-v1.js");

const db = getDb();
let clock = new Date("2026-08-15T00:00:00.000Z");

after(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("Plus allocates one fifth of the opening funds to each slot", () => {
  assert.equal(automationRiskAllocationUsd({ funding_amount_usd: 82, card_capacity: 5 }), 16.4);
  for (const mapping of [
    { funding_amount_usd: 100, card_capacity: 1 },
    { funding_amount_usd: 200, card_capacity: 1 }
  ]) {
    assert.equal(automationRiskAllocationUsd(mapping), mapping.funding_amount_usd);
  }
});

test("an existing Plus card receives one slot amount instead of the remaining card pool", async () => {
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
    ) VALUES ('card-pool', 'spacexcard', 8801, '8801', 'P5556XV', '3673',
      'ACTIVE', 4.03, 'plus-ph', 1, 'AVAILABLE', 'READY', ?, ?)
  `).run(at, at);
  let rechargeInput = null;
  const provider = {
    listCards: async () => ({
      cards: [{ upstreamCardId: 8801, availableAmount: 4.03, status: 'ACTIVE' }],
      total: 1
    }),
    listProducts: async () => [{
      productCode: "P5556XV",
      minAmount: 20,
      maxAmount: 50_000
    }],
    rechargeCard: async (input) => {
      rechargeInput = input;
      return { succeeded: true };
    },
    getCardMaterial: async () => ({
      number: "5555555555553673",
      cvv: "123",
      expiryMonth: "12",
      expiryYear: "2029"
    })
  };
  const result = await prepareAutomationCard(db, {
    execution: db.prepare("SELECT * FROM automation_executions WHERE id = 'execution-pool'").get(),
    mapping: {
      card_platform_key: "spacexcard",
      card_product_code: "P5556XV",
      capacity_key: "plus-ph",
      card_capacity: 5,
      funding_amount_usd: 82
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
  assert.deepEqual(rechargeInput, { cardId: 8801, amount: 20 });
  assert.equal(db.prepare(`
    SELECT amount_usd FROM automation_funding_intents WHERE execution_id = 'execution-pool'
  `).get().amount_usd, 20);
  db.prepare("DELETE FROM automation_funding_intents WHERE execution_id = 'execution-pool'").run();
  db.prepare("DELETE FROM automation_card_reservations WHERE execution_id = 'execution-pool'").run();
  db.prepare("DELETE FROM automation_executions WHERE id = 'execution-pool'").run();
  db.prepare("DELETE FROM managed_cards WHERE id = 'card-pool'").run();
});

test("a new Plus card still opens with the full 82 USD funding amount", async () => {
  const at = clock.toISOString();
  db.prepare(`
    INSERT INTO automation_executions (
      id, order_id, order_no, product_id, status, public_message,
      card_reservation_state, created_at, updated_at
    ) VALUES ('execution-open-full', 'order-open-full', 'KWOPENFULL82', 'product-open-full',
      'preparing_card', '处理中', 'unassigned', ?, ?)
  `).run(at, at);
  let openInput = null;
  const provider = {
    listCards: async () => ({ cards: [], total: 0 }),
    openCard: async (input) => {
      openInput = input;
      return {
        upstreamCardId: 8802,
        vmCardId: "8802",
        productCode: "P5556XV",
        availableAmount: 82
      };
    },
    getCardMaterial: async () => ({
      number: "5555555555558802",
      cvv: "123",
      expiryMonth: "12",
      expiryYear: "2029"
    })
  };
  await prepareAutomationCard(db, {
    execution: db.prepare("SELECT * FROM automation_executions WHERE id = 'execution-open-full'").get(),
    mapping: {
      card_platform_key: "spacexcard",
      card_product_code: "P5556XV",
      capacity_key: "plus-ph",
      card_capacity: 5,
      funding_amount_usd: 82
    },
    decryptText,
    encryptText,
    provider,
    getCardholder: async () => ({ firstName: "Test", lastName: "User" }),
    at
  });
  assert.equal(openInput.initAmount, 82);
  assert.equal(db.prepare(`
    SELECT amount_usd FROM automation_funding_intents WHERE execution_id = 'execution-open-full'
  `).get().amount_usd, 82);
  const openedCardId = db.prepare(`
    SELECT card_id FROM automation_card_reservations WHERE execution_id = 'execution-open-full'
  `).get().card_id;
  db.prepare("DELETE FROM automation_funding_intents WHERE execution_id = 'execution-open-full'").run();
  db.prepare("DELETE FROM automation_card_reservations WHERE execution_id = 'execution-open-full'").run();
  db.prepare("DELETE FROM automation_executions WHERE id = 'execution-open-full'").run();
  db.prepare("DELETE FROM managed_cards WHERE id = ?").run(openedCardId);
});

test("an existing Plus card is not recharged while it already covers one slot", async () => {
  const at = clock.toISOString();
  db.prepare(`
    INSERT INTO automation_executions (
      id, order_id, order_no, product_id, status, public_message,
      card_reservation_state, created_at, updated_at
    ) VALUES ('execution-funded-slot', 'order-funded-slot', 'KWFUNDEDSLOT', 'product-funded-slot',
      'preparing_card', '处理中', 'unassigned', ?, ?)
  `).run(at, at);
  db.prepare(`
    INSERT INTO managed_cards (
      id, provider_key, upstream_card_id, vm_card_id, product_code, last4,
      upstream_status, cached_available_amount, lane, consumed_slots,
      capacity_state, reconciliation_state, created_at, updated_at
    ) VALUES ('card-funded-slot', 'spacexcard', 8803, '8803', 'P5556XV', '8803',
      'ACTIVE', 65, 'plus-ph', 1, 'AVAILABLE', 'READY', ?, ?)
  `).run(at, at);
  let rechargeCalls = 0;
  const provider = {
    listCards: async () => ({
      cards: [{ upstreamCardId: 8803, availableAmount: 65, status: "ACTIVE" }],
      total: 1
    }),
    listProducts: async () => [{ productCode: "P5556XV", minAmount: 20, maxAmount: 50_000 }],
    rechargeCard: async () => { rechargeCalls += 1; },
    getCardMaterial: async () => ({
      number: "5555555555558803",
      cvv: "123",
      expiryMonth: "12",
      expiryYear: "2029"
    })
  };
  await prepareAutomationCard(db, {
    execution: db.prepare("SELECT * FROM automation_executions WHERE id = 'execution-funded-slot'").get(),
    mapping: {
      card_platform_key: "spacexcard",
      card_product_code: "P5556XV",
      capacity_key: "plus-ph",
      card_capacity: 5,
      funding_amount_usd: 82
    },
    decryptText,
    encryptText,
    provider,
    at
  });
  assert.equal(rechargeCalls, 0);
  assert.equal(db.prepare(`
    SELECT COUNT(*) AS count FROM automation_funding_intents WHERE execution_id = 'execution-funded-slot'
  `).get().count, 0);
  db.prepare("DELETE FROM automation_card_reservations WHERE execution_id = 'execution-funded-slot'").run();
  db.prepare("DELETE FROM automation_executions WHERE id = 'execution-funded-slot'").run();
  db.prepare("DELETE FROM managed_cards WHERE id = 'card-funded-slot'").run();
});

test("a retryable Efun funding rejection keeps the intent prepared for the same-key retry", async () => {
  const at = clock.toISOString();
  db.prepare(`
    INSERT INTO automation_executions (
      id, order_id, order_no, product_id, status, public_message,
      card_reservation_state, created_at, updated_at
    ) VALUES ('execution-retryable-funding', 'order-retryable-funding', 'KWRETRYFUNDING',
      'product-retryable-funding', 'preparing_card', '处理中', 'reserved', ?, ?)
  `).run(at, at);
  db.prepare(`
    INSERT INTO managed_cards (
      id, provider_key, upstream_card_id, vm_card_id, product_code, last4,
      upstream_status, cached_available_amount, lane, consumed_slots,
      capacity_state, reconciliation_state, created_at, updated_at
    ) VALUES ('card-retryable-funding', 'efuncard', 8811, '8811', 'Z-43612081', '4411',
      'ACTIVE', 0, 'x20', 0, 'AVAILABLE', 'READY', ?, ?)
  `).run(at, at);
  db.prepare(`
    INSERT INTO automation_card_reservations (
      id, execution_id, provider_key, card_id, capacity_key, slot_index, state, reserved_at
    ) VALUES ('reservation-retryable-funding', 'execution-retryable-funding', 'efuncard',
      'card-retryable-funding', 'x20', 1, 'reserved', ?)
  `).run(at);

  const provider = {
    listCards: async () => ({
      cards: [{ upstreamCardId: 8811, availableAmount: 0, status: "ACTIVE" }],
      total: 1
    }),
    listProducts: async () => [{
      productCode: "Z-43612081",
      minimumRechargeAmount: 5,
      maxAmount: 200
    }],
    rechargeCard: async () => {
      const error = new Error("Request is being processed, please do not resubmit");
      error.code = "EFUNCARD_IDEMPOTENCY_IN_PROGRESS";
      error.retryAfterSeconds = 3;
      throw error;
    },
    classifyFundingError: (error) => [
      "EFUNCARD_IDEMPOTENCY_IN_PROGRESS",
      "EFUNCARD_RATE_LIMITED"
    ].includes(error?.code) ? "retryable_no_write" : "unknown"
  };
  await assert.rejects(
    () => prepareAutomationCard(db, {
      execution: db.prepare("SELECT * FROM automation_executions WHERE id = 'execution-retryable-funding'").get(),
      mapping: {
        card_platform_key: "efuncard",
        card_product_code: "Z-43612081",
        capacity_key: "x20",
        card_capacity: 1,
        funding_amount_usd: 82
      },
      decryptText,
      encryptText,
      provider,
      at
    }),
    (error) => error.code === "AUTOMATION_FUNDING_RETRYABLE"
      && /Request is being processed/.test(error.message)
      && error.retryAfterSeconds === 3
  );
  const intent = db.prepare(`
    SELECT state, submitted_at, resolved_at
    FROM automation_funding_intents WHERE execution_id = 'execution-retryable-funding'
  `).get();
  assert.equal(intent.state, "prepared");
  assert.equal(intent.submitted_at, null);
  assert.equal(intent.resolved_at, null);
  db.prepare("DELETE FROM automation_funding_intents WHERE execution_id = 'execution-retryable-funding'").run();
  db.prepare("DELETE FROM automation_card_reservations WHERE execution_id = 'execution-retryable-funding'").run();
  db.prepare("DELETE FROM automation_executions WHERE id = 'execution-retryable-funding'").run();
  db.prepare("DELETE FROM managed_cards WHERE id = 'card-retryable-funding'").run();
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

test("automation runner keeps Gate closed, honors pre-submit retry timing, then settles one accepted remote task", async () => {
  seedOrder();
  let prepareCalls = 0;
  let preflightCalls = 0;
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
      prepareAccount: async () => {
        preflightCalls += 1;
        if (preflightCalls === 1) {
          throw new AutomationAdapterError("SPACEX_GPT_ACCOUNT_WAIT", "等待账号可购买", {
            requestNotSent: true,
            retryAfterSeconds: 120
          });
        }
      },
      createTask: async (input) => {
        createCalls += 1;
        assert.equal(input.authSessionJson.accessToken, "session-secret");
        assert.equal(input.planId, "plus-monthly");
        assert.equal(input.cardProviderKey, "spacexcard");
        assert.equal(input.providerCardId, 101);
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
  const waiting = db.prepare(`
    SELECT status, next_action_at FROM automation_executions WHERE id = 'execution-auto'
  `).get();
  assert.equal(waiting.status, "preparing_card");
  assert.equal(waiting.next_action_at, new Date(clock.getTime() + 120_000).toISOString());
  assert.equal(prepareCalls, 0);
  assert.equal(createCalls, 0);

  clock = new Date(clock.getTime() + 120_000);
  await runner.tick();
  assert.equal(db.prepare("SELECT status FROM automation_executions WHERE id = 'execution-auto'").get().status, "submitting");
  assert.equal(prepareCalls, 1);
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

test("admin retry reuses one definitely-not-created mapping without repeating card funding", async () => {
  const failedAt = clock.toISOString();
  if (!db.prepare("SELECT 1 FROM automation_product_mappings WHERE id = 'mapping-auto'").get()) seedOrder();
  db.prepare(`
    UPDATE automation_fulfillment_settings
    SET payment_gate_enabled = 1, mode = 'automatic', updated_at = ?
    WHERE id = 'default'
  `).run(failedAt);
  db.prepare(`
    UPDATE automation_executions SET next_action_at = '2099-01-01T00:00:00.000Z'
    WHERE id = 'execution-auto' AND status NOT IN ('succeeded', 'failed', 'cancelled')
  `).run();
  const snapshot = JSON.stringify({
    mappingId: "mapping-auto",
    mappingRevision: 1,
    providerId: "provider-auto",
    providerName: "Provider",
    adapterKey: "automate_v1",
    configHash: "config-hash",
    externalPlanId: "plus-monthly",
    externalTaskType: "purchase",
    regionCode: "PH",
    currency: "PHP",
    cardPlatformKey: "spacexcard",
    cardProductCode: "CARD-PRODUCT",
    capacityKey: "plus",
    cardCapacity: 1,
    fundingAmountUsd: 25,
    expectedMinAmount: 900,
    expectedMaxAmount: 1200,
    dailyRiskLimitUsd: 100,
    priority: 1
  });
  db.prepare(`
    INSERT INTO automation_executions (
      id, order_id, order_no, product_id, status, current_phase, public_message,
      card_id, card_reservation_state, attempt_count, next_action_at, created_at, updated_at
    ) VALUES ('execution-admin-retry', 'order-admin-retry', 'KWADMINRETRY', 'product-auto',
      'waiting_mapping', 'routing', '等待处理', 'card-admin-retry', 'reserved', 1, ?, ?, ?)
  `).run(failedAt, failedAt, failedAt);
  db.prepare(`
    INSERT INTO managed_cards (
      id, provider_key, upstream_card_id, vm_card_id, product_code, last4,
      upstream_status, cached_available_amount, lane, consumed_slots,
      capacity_state, reconciliation_state, created_at, updated_at
    ) VALUES ('card-admin-retry', 'spacexcard', 213357, '213357', 'CARD-PRODUCT', '9992',
      'ACTIVE', 25, 'plus', 0, 'AVAILABLE', 'READY', ?, ?)
  `).run(failedAt, failedAt);
  db.prepare(`
    INSERT INTO automation_card_reservations (
      id, execution_id, provider_key, card_id, capacity_key, slot_index, state, reserved_at
    ) VALUES ('reservation-admin-retry', 'execution-admin-retry', 'spacexcard',
      'card-admin-retry', 'plus', 1, 'reserved', ?)
  `).run(failedAt);
  db.prepare(`
    INSERT INTO automation_funding_intents (
      id, execution_id, provider_key, operation, target_card_id, amount_usd,
      idempotency_key, request_fingerprint, request_body_encrypted, state,
      provider_resource_id, created_at, submitted_at, resolved_at
    ) VALUES ('funding-admin-retry', 'execution-admin-retry', 'spacexcard', 'recharge',
      'card-admin-retry', 5, 'kwa:KWADMINRETRY:recharge:v1', 'fingerprint', 'encrypted',
      'succeeded', '213357', ?, ?, ?)
  `).run(failedAt, failedAt, failedAt);
  db.prepare(`
    INSERT INTO automation_execution_attempts (
      id, execution_id, attempt_no, mapping_id, provider_id, credential_id,
      client_order_id, status, mapping_snapshot, error_code, error_message, created_at, updated_at
    ) VALUES ('attempt-admin-retry-1', 'execution-admin-retry', 1, 'mapping-auto',
      'provider-auto', 'credential-auto', 'KWADMINRETRY', 'not_created', ?,
      'AUTOMATION_REMOTE_REJECTED', 'session rejected', ?, ?)
  `).run(snapshot, failedAt, failedAt);
  const runner = createAutomationRunner({
    db,
    decryptText,
    encryptText,
    workerId: "admin-retry-worker",
    now: () => new Date(clock),
    providerSync: async () => false
  });

  await runner.tick();
  assert.equal(db.prepare(`
    SELECT COUNT(*) AS count FROM automation_execution_attempts
    WHERE execution_id = 'execution-admin-retry'
  `).get().count, 1);

  clock = new Date(clock.getTime() + 1_000);
  const retryAt = clock.toISOString();
  db.prepare(`
    INSERT INTO admin_audit_logs (id, action, actor, resource_type, resource_id, created_at)
    VALUES ('audit-admin-retry', 'automation.execution.retry_requested', 'admin',
      'automation_execution', 'execution-admin-retry', ?)
  `).run(retryAt);
  db.prepare(`
    UPDATE automation_executions SET next_action_at = ?, updated_at = ?
    WHERE id = 'execution-admin-retry'
  `).run(retryAt, retryAt);
  await runner.tick();

  const retry = db.prepare(`
    SELECT attempt_no, mapping_id, status FROM automation_execution_attempts
    WHERE execution_id = 'execution-admin-retry' ORDER BY attempt_no DESC LIMIT 1
  `).get();
  assert.deepEqual(retry, { attempt_no: 2, mapping_id: "mapping-auto", status: "selected" });
  assert.equal(db.prepare(`
    SELECT state FROM automation_funding_intents WHERE execution_id = 'execution-admin-retry'
  `).get().state, "succeeded");
  assert.equal(db.prepare(`
    SELECT state FROM automation_card_reservations WHERE execution_id = 'execution-admin-retry'
  `).get().state, "reserved");

  clock = new Date(clock.getTime() + 1_000);
  const failedAgainAt = clock.toISOString();
  db.prepare(`
    UPDATE automation_execution_attempts SET status = 'not_created', updated_at = ?
    WHERE execution_id = 'execution-admin-retry' AND attempt_no = 2
  `).run(failedAgainAt);
  db.prepare(`
    UPDATE automation_executions
    SET status = 'waiting_mapping', mapping_id = NULL, provider_id = NULL,
        credential_id = NULL, client_order_id = NULL, mapping_snapshot = NULL,
        attempt_count = 2, next_action_at = ?, updated_at = ?
    WHERE id = 'execution-admin-retry'
  `).run(failedAgainAt, failedAgainAt);
  await runner.tick();
  assert.equal(db.prepare(`
    SELECT COUNT(*) AS count FROM automation_execution_attempts
    WHERE execution_id = 'execution-admin-retry'
  `).get().count, 2);

  db.prepare("DELETE FROM automation_execution_attempts WHERE execution_id = 'execution-admin-retry'").run();
  db.prepare("DELETE FROM automation_funding_intents WHERE execution_id = 'execution-admin-retry'").run();
  db.prepare("DELETE FROM automation_card_reservations WHERE execution_id = 'execution-admin-retry'").run();
  db.prepare("DELETE FROM automation_executions WHERE id = 'execution-admin-retry'").run();
  db.prepare("DELETE FROM managed_cards WHERE id = 'card-admin-retry'").run();
  db.prepare("DELETE FROM admin_audit_logs WHERE id = 'audit-admin-retry'").run();
});

test("renewal cancellation does not occupy provider checkout concurrency", async () => {
  const at = clock.toISOString();
  db.prepare(`
    UPDATE automation_fulfillment_settings
    SET payment_gate_enabled = 1, mode = 'automatic', updated_at = ?
    WHERE id = 'default'
  `).run(at);
  const snapshot = JSON.stringify({
    mappingId: "mapping-auto",
    providerId: "provider-auto",
    externalPlanId: "plus-monthly",
    regionCode: "PH",
    currency: "PHP",
    cardPlatformKey: "spacexcard",
    cardProductCode: "CARD-PRODUCT",
    capacityKey: "plus",
    cardCapacity: 1,
    fundingAmountUsd: 25,
    expectedMinAmount: 900,
    expectedMaxAmount: 1200,
    dailyRiskLimitUsd: 100
  });
  db.prepare(`
    INSERT INTO automation_executions (
      id, order_id, order_no, product_id, status, mapping_id, provider_id,
      credential_id, client_order_id, remote_task_id, remote_status,
      current_phase, mapping_snapshot, remote_snapshot, attempt_count, next_action_at,
      accepted_at, created_at, updated_at
    ) VALUES ('execution-renewal-busy', 'order-renewal-busy', 'KWRENEWALBUSY',
      'product-auto', 'running', 'mapping-auto', 'provider-auto', 'credential-auto',
      'KWRENEWALBUSY', 'REMOTE-RENEWAL-BUSY', 'running', 'renewal_cancellation',
      ?, ?, 1, '2099-01-01T00:00:00.000Z', ?, ?, ?)
  `).run(snapshot, JSON.stringify({
    renewalStatus: { status: "pending", verified: true, willRenew: true }
  }), at, at, at);
  enrollAutomationOrder(db, {
    id: "execution-after-renewal",
    orderId: "order-after-renewal",
    orderNo: "KWAFTERRENEWAL",
    productId: "product-auto",
    createdAt: at
  });

  const runner = createAutomationRunner({
    db,
    decryptText,
    encryptText,
    workerId: "renewal-capacity-worker",
    now: () => new Date(clock),
    providerSync: async () => false
  });
  await runner.tick();

  assert.equal(db.prepare(`
    SELECT status FROM automation_executions WHERE id = 'execution-after-renewal'
  `).get().status, "preparing_card");
  db.prepare("DELETE FROM automation_executions WHERE id IN ('execution-renewal-busy', 'execution-after-renewal')").run();
});

test("an overdue renewal cancellation moves to manual review", async () => {
  const at = clock.toISOString();
  const acceptedAt = new Date(clock.getTime() - (30 * 60 + 1) * 1000).toISOString();
  const snapshot = JSON.stringify({
    mappingId: "mapping-auto",
    providerId: "provider-auto",
    externalPlanId: "plus-monthly",
    regionCode: "PH",
    currency: "PHP"
  });
  db.prepare(`
    INSERT INTO automation_executions (
      id, order_id, order_no, product_id, status, mapping_id, provider_id,
      credential_id, client_order_id, remote_task_id, remote_status,
      current_phase, mapping_snapshot, attempt_count, next_action_at,
      accepted_at, created_at, updated_at
    ) VALUES ('execution-renewal-overdue', 'order-renewal-overdue', 'KWRENEWALOVERDUE',
      'product-auto', 'running', 'mapping-auto', 'provider-auto', 'credential-auto',
      'KWRENEWALOVERDUE', 'REMOTE-RENEWAL-OVERDUE', 'running', 'renewal_cancellation',
      ?, 1, ?, ?, ?, ?)
  `).run(snapshot, at, acceptedAt, acceptedAt, at);
  db.prepare(`
    INSERT INTO automation_execution_attempts (
      id, execution_id, attempt_no, mapping_id, provider_id, credential_id,
      client_order_id, status, mapping_snapshot, remote_task_id, created_at, updated_at
    ) VALUES ('attempt-renewal-overdue', 'execution-renewal-overdue', 1,
      'mapping-auto', 'provider-auto', 'credential-auto', 'KWRENEWALOVERDUE',
      'accepted', ?, 'REMOTE-RENEWAL-OVERDUE', ?, ?)
  `).run(snapshot, acceptedAt, at);
  const task = {
    id: "REMOTE-RENEWAL-OVERDUE",
    clientOrderId: "KWRENEWALOVERDUE",
    status: "running",
    terminal: false,
    planId: "plus-monthly",
    checkoutCountry: "PH",
    checkoutCurrency: "PHP",
    currentPhase: "renewal_cancellation",
    message: "已开通，等待取消自动续费",
    card: { brand: null, last4: "4444" },
    pricing: { currency: "PHP", displayTotal: null, confirmed: true },
    renewalStatus: { status: "pending", verified: true, willRenew: true },
    error: null
  };
  const runner = createAutomationRunner({
    db,
    decryptText,
    encryptText,
    workerId: "renewal-review-worker",
    now: () => new Date(clock),
    adapterFactory: () => ({ adapter: { getTask: async () => ({ task }) } }),
    providerSync: async () => false
  });
  await runner.tick();

  const execution = db.prepare(`
    SELECT status, last_error_code FROM automation_executions
    WHERE id = 'execution-renewal-overdue'
  `).get();
  assert.equal(execution.status, "manual_review");
  assert.equal(execution.last_error_code, "AUTOMATION_RENEWAL_CANCELLATION_REQUIRED");
  db.prepare("DELETE FROM automation_execution_attempts WHERE id = 'attempt-renewal-overdue'").run();
  db.prepare("DELETE FROM automation_executions WHERE id = 'execution-renewal-overdue'").run();
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

test("a non-idempotent eFun submit marker is never replayed after worker recovery", async () => {
  const at = clock.toISOString();
  db.prepare(`
    INSERT INTO cdkeys (
      id, batch_id, product_id, activation_endpoint_id, source_key, public_key,
      prefix, status, locked_at, locked_by_order_id, processing_mode, created_at, updated_at
    ) VALUES ('cdkey-efun-recovery', 'batch-efun-recovery', 'product-auto', 'endpoint-auto',
      'source-efun-recovery', 'PUBLIC-EFUN-RECOVERY', 'EFUN', 'locked', ?,
      'order-efun-recovery', 'membership_auto', ?, ?)
  `).run(at, at, at);
  db.prepare(`
    INSERT INTO redeem_orders (
      id, order_no, cdkey_id, public_key, product_id, activation_endpoint_id,
      session_payload, status, created_at, updated_at
    ) VALUES ('order-efun-recovery', 'KWEFUNRECOVERY', 'cdkey-efun-recovery',
      'PUBLIC-EFUN-RECOVERY', 'product-auto', 'endpoint-auto', ?, 'pending', ?, ?)
  `).run(encryptText(JSON.stringify({ accessToken: "session-secret" })), at, at);
  enrollAutomationOrder(db, {
    id: "execution-efun-recovery",
    orderId: "order-efun-recovery",
    orderNo: "KWEFUNRECOVERY",
    productId: "product-auto",
    createdAt: at
  });
  const snapshot = {
    mappingId: "mapping-auto",
    mappingRevision: 1,
    providerId: "provider-auto",
    providerName: "eFun",
    adapterKey: "efun_open_v1",
    configHash: "config-hash",
    externalPlanId: "plus",
    externalTaskType: "purchase",
    regionCode: "PH",
    currency: "PHP",
    cardPlatformKey: "spacexcard",
    cardProductCode: "CARD-PRODUCT",
    capacityKey: "plus",
    cardCapacity: 1,
    fundingAmountUsd: 25,
    expectedMinAmount: 900,
    expectedMaxAmount: 1200,
    dailyRiskLimitUsd: 100,
    priority: 1
  };
  db.prepare(`
    UPDATE automation_executions
    SET status = 'submitting', mapping_id = 'mapping-auto', provider_id = 'provider-auto',
        credential_id = 'credential-auto', client_order_id = 'KWEFUNRECOVERY',
        mapping_snapshot = ?, attempt_count = 1, current_phase = 'remote_submit_started',
        next_action_at = ?, updated_at = ?
    WHERE id = 'execution-efun-recovery'
  `).run(JSON.stringify(snapshot), at, at);
  db.prepare(`
    INSERT INTO automation_execution_attempts (
      id, execution_id, attempt_no, mapping_id, provider_id, credential_id,
      client_order_id, status, mapping_snapshot, created_at, updated_at
    ) VALUES ('attempt-efun-recovery', 'execution-efun-recovery', 1, 'mapping-auto',
      'provider-auto', 'credential-auto', 'KWEFUNRECOVERY', 'submit_started', ?, ?, ?)
  `).run(JSON.stringify(snapshot), at, at);
  let createCalls = 0;
  const runner = createAutomationRunner({
    db,
    decryptText,
    encryptText,
    workerId: "efun-recovery-worker",
    now: () => new Date(clock),
    prepareCard: async () => ({
      card: { id: "card-not-needed" },
      material: { number: "5555555555554444", cvc: "123", expMonth: "12", expYear: "2029" }
    }),
    adapterFactory: () => ({
      adapter: {
        createReplaySafe: false,
        createTask: async () => {
          createCalls += 1;
          throw new AutomationAdapterError("AUTOMATION_UNAVAILABLE", "must not run", { unsafeToReplay: true });
        }
      }
    }),
    providerSync: async () => false
  });
  await runner.tick();
  assert.equal(createCalls, 0);
  const execution = db.prepare("SELECT * FROM automation_executions WHERE id = 'execution-efun-recovery'").get();
  assert.equal(execution.status, "manual_review");
  assert.equal(execution.last_error_code, "AUTOMATION_SUBMIT_OUTCOME_UNKNOWN");
  assert.equal(db.prepare(`
    SELECT status FROM automation_execution_attempts WHERE id = 'attempt-efun-recovery'
  `).get().status, "manual_review");
});
