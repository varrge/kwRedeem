import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kawang-membership-payment-api-"));
process.env.DATABASE_PATH = path.join(tmpDir, "test.db");
process.env.JWT_SECRET = "membership-payment-api-test-secret";

const { getDb } = await import("../shared/src/database.js");
const { createMembershipMaterialGrant } = await import("../shared/src/membership-actions.js");
const { createMembershipPaymentService } = await import("../api/src/membership-payment.js");

const db = getDb();
const fixedNow = "2026-07-16T00:01:00.000Z";
const adminSecrets = Object.freeze({ username: "admin", password: "fresh-secret" });
const credentials = () => ({ username: "admin", password: "fresh-secret" });
const audits = [];
let upstreamCardId = 700_000;
let materialCalls = 0;
let checkoutCalls = 0;
let addressCalls = 0;

class FakeReply {
  constructor() {
    this.statusCode = 200;
    this.headers = {};
    this.payload = undefined;
  }

  header(name, value) {
    this.headers[String(name).toLowerCase()] = String(value);
    return this;
  }

  code(value) {
    this.statusCode = value;
    return this;
  }

  send(payload) {
    this.payload = payload;
    return payload;
  }
}

class FakeApp {
  constructor() {
    this.routes = new Map();
  }

  register(method, pathName, options, handler) {
    if (typeof options === "function") {
      handler = options;
      options = {};
    }
    this.routes.set(`${method} ${pathName}`, { method, pathName, options, handler });
  }

  get(pathName, options, handler) { this.register("GET", pathName, options, handler); }
  post(pathName, options, handler) { this.register("POST", pathName, options, handler); }

  async injectRoute(method, pathName, request = {}) {
    const route = this.routes.get(`${method} ${pathName}`);
    assert.ok(route, `route not registered: ${method} ${pathName}`);
    const reply = new FakeReply();
    const normalizedRequest = {
      body: request.body,
      query: request.query || {},
      params: request.params || {},
      headers: request.headers || {},
      ip: request.ip || "127.0.0.1",
      admin: request.admin || { username: "admin" }
    };
    if (typeof route.options.preHandler === "function") {
      await route.options.preHandler(normalizedRequest, reply);
    }
    const result = await route.handler(normalizedRequest, reply);
    return {
      statusCode: reply.statusCode,
      headers: reply.headers,
      body: reply.payload === undefined ? result : reply.payload,
      options: route.options
    };
  }
}

const app = new FakeApp();
const service = createMembershipPaymentService({
  app,
  db,
  requireAdmin: async (request) => { request.admin ||= { username: "admin" }; },
  extensionDelivery: {
    authenticateRequest(request) {
      return {
        requestHash: "a".repeat(64),
        installationId: request.headers["x-extension-installation-id"] || "install-api",
        settings: { enabled: true }
      };
    }
  },
  async getCardMaterial(context) {
    materialCalls += 1;
    assert.match(context.cardId, /^card-/);
    return {
      number: "4242424242424242",
      cvv: "123",
      expiryMonth: "12",
      expiryYear: "2028",
      status: "ACTIVE",
      availableAmount: 500
    };
  },
  async getCheckoutUrl(context) {
    checkoutCalls += 1;
    assert.match(context.fulfillmentId, /^mf-/);
    return {
      checkoutUrl: context.stage === "upgrade"
        ? null
        : "https://pay.openai.com/checkout/api-test?secret=one-time"
    };
  },
  async generateAddress(context) {
    addressCalls += 1;
    assert.equal(context.state, "DE");
    return {
      items: [{
        person: { name: "Ada Lovelace" },
        address: {
          line1: "123 Main Street",
          city: "Dover",
          state: "DE",
          postalCode: "19901",
          countryCode: "US"
        }
      }]
    };
  },
  async getCardAuthorizationIds() { return ["auth-existing"]; },
  paymentGate: (fulfillment) => ({ enabled: true, mode: fulfillment?.run_mode }),
  adminCredentials: adminSecrets,
  createAuditLog(entry) { audits.push(structuredClone(entry)); },
  now: () => fixedNow
});

after(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function insertContract(id, tier, version) {
  db.prepare(`
    INSERT OR IGNORE INTO checkout_price_contracts (
      id, tier, version, currency, min_amount, max_amount, status,
      created_at, created_by, activated_at
    ) VALUES (?, ?, ?, 'PHP', 900, 99999, 'active', ?, 'admin', ?)
  `).run(id, tier, version, "2026-07-15T00:00:00.000Z", "2026-07-15T00:00:00.000Z");
}

function seedStage(id, options = {}) {
  const targetTier = options.targetTier || "plus";
  const stage = options.stage || "plus";
  const adapterVersion = options.adapterVersion || "checkout-v1";
  const contractId = options.contractId || (stage === "plus" ? "contract-api-plus" : "contract-api-x5");
  const contract = db.prepare("SELECT version FROM checkout_price_contracts WHERE id = ?").get(contractId);
  const cardId = `card-${id}`;
  const reservationId = `reservation-${id}`;
  const fingerprint = options.fingerprint || "a".repeat(64);
  db.prepare(`
    INSERT INTO managed_cards (
      id, upstream_card_id, vm_card_id, product_code, last4, upstream_status,
      cached_available_amount, lane, capacity_state, reconciliation_state,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, '4242', 'ACTIVE', 500, ?, 'AVAILABLE', 'READY', ?, ?)
  `).run(cardId, upstreamCardId++, `vm-${id}`, `CARD-${targetTier}`, targetTier, fixedNow, fixedNow);
  db.prepare(`
    INSERT INTO card_capacity_reservations (
      id, fulfillment_id, card_id, target_lane, slot_index, state, reserved_at
    ) VALUES (?, ?, ?, ?, 1, 'reserved', ?)
  `).run(reservationId, id, cardId, targetTier, fixedNow);
  db.prepare(`
    INSERT INTO membership_fulfillments (
      id, order_id, order_no, target_tier, state, current_stage, run_mode,
      browser_lease_epoch, card_reservation_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
  `).run(
    id,
    `order-${id}`,
    `ORDER-${id}`,
    targetTier,
    options.state || (stage === "plus" ? "PLUS_CHECKOUT_READY" : "UPGRADE_CHECKOUT_READY"),
    stage,
    options.runMode === undefined ? "canary" : options.runMode,
    reservationId,
    fixedNow,
    fixedNow
  );
  db.prepare(`
    INSERT INTO membership_payment_stages (
      id, fulfillment_id, stage_key, expected_tier, state, card_id,
      price_signal_amount, price_signal_min, price_signal_max, price_signal_time,
      attempt_no, adapter_version, adapter_path, price_contract_id,
      page_fingerprint, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 'single_page', ?, ?, ?, ?)
  `).run(
    `stage-${id}-${stage}`,
    id,
    stage,
    stage === "plus" ? "plus" : targetTier,
    options.stageState || "checkout_ready",
    cardId,
    options.priceAmount ?? (stage === "plus" ? 16.24 : 99),
    options.priceAmount ?? (stage === "plus" ? 16.24 : 99),
    options.priceAmount ?? (stage === "plus" ? 16.24 : 99),
    fixedNow,
    adapterVersion,
    contractId,
    fingerprint,
    fixedNow,
    fixedNow
  );
  db.prepare(`
    INSERT INTO membership_fulfillment_attempts (
      id, fulfillment_id, stage, attempt_no, resume_revision,
      adapter_version, price_contract_version, started_at
    ) VALUES (?, ?, ?, 1, 0, ?, ?, ?)
  `).run(`attempt-${id}-${stage}`, id, stage, adapterVersion, contract.version, fixedNow);
  db.prepare(`
    UPDATE browser_fulfillment_lease
    SET fulfillment_id = ?, installation_id = 'install-api', epoch = 1,
        state = 'leased', heartbeat_at = ?, expires_at = ?, updated_at = ?
    WHERE id = 'default'
  `).run(id, fixedNow, "2026-07-16T00:20:00.000Z", fixedNow);
  return { id, cardId, reservationId, fingerprint, contractId, contractVersion: contract.version };
}

function paymentPage(overrides = {}) {
  const page = {
    stateId: "PAYMENT_FINAL_READY",
    origin: "https://pay.openai.com",
    routeTemplate: "/checkout/{id}",
    plan: "plus",
    country: "PH",
    currency: "PHP",
    displayedAmount: 1049,
    stateMarker: "review",
    fields: {
      cardNumber: true,
      expiry: true,
      expiryMonth: false,
      expiryYear: false,
      cvc: true,
      billingName: true,
      billingLine1: true,
      billingCity: true,
      billingState: true,
      billingCountry: true,
      billingPostal: true
    },
    controls: {
      progression: null,
      submit: "payment-submit",
      upgradeX5: null,
      upgradeX20: null,
      challenge: null
    },
    ...overrides
  };
  const structural = {
    stateId: page.stateId,
    origin: page.origin,
    routeTemplate: page.routeTemplate,
    plan: page.plan,
    country: page.country,
    currency: page.currency,
    displayedAmount: page.displayedAmount,
    stateMarker: page.stateMarker,
    fields: page.fields,
    controls: page.controls
  };
  page.structuralHash = createHash("sha256").update(JSON.stringify(structural)).digest("hex");
  return page;
}

function permitBody(page, targetTier = "plus") {
  return {
    stage: "plus",
    targetTier,
    attempt: 1,
    leaseEpoch: 1,
    adapterVersion: "checkout-v1",
    priceContractVersion: 41,
    controlId: "payment-submit",
    pageFingerprint: page.structuralHash,
    page
  };
}

before(() => {
  insertContract("contract-api-plus", "plus", 41);
  insertContract("contract-api-x5", "x5", 42);
});

test("service registers the fixed extension/admin surfaces with admin guards", () => {
  assert.deepEqual(service.extensionRoutes, [
    "/api/extension/membership-material-grants/:grantId/claim",
    "/api/extension/membership-fulfillments/:id/progression-permit",
    "/api/extension/membership-fulfillments/:id/submit-permit",
    "/api/extension/membership-fulfillments/:id/action-ack"
  ]);
  for (const route of app.routes.values()) {
    if (route.pathName.startsWith("/api/admin/")) assert.equal(typeof route.options.preHandler, "function");
  }
});

test("rollout gate accepts a ready EfunCard platform and selects only one zero-exposure fulfillment", async () => {
  db.prepare(`
    UPDATE membership_fulfillment_settings
    SET inventory_status = 'not_started', spacexcard_app_secret_encrypted = NULL
    WHERE id = 'default'
  `).run();
  db.prepare(`
    UPDATE extension_delivery_settings
	SET extension_token_sha256 = NULL, bound_installation_id = NULL,
		spacexcard_api_token_encrypted = NULL
    WHERE id = 'default'
	`).run();
  db.prepare(`
    UPDATE membership_card_platforms
    SET enabled = 1, base_url = 'https://cards.example.test/api/open/v1',
      credential_encrypted = 'encrypted-efuncard-test', inventory_status = 'not_started'
    WHERE key = 'efuncard'
  `).run();
  const blocked = await app.injectRoute("POST", "/api/admin/membership-fulfillment/rollout-mode", {
    ip: "127.0.0.3",
    body: { mode: "canary", credentials: adminSecrets }
  });
  assert.equal(blocked.statusCode, 409);
  assert.equal(blocked.body.code, "MEMBERSHIP_ROLLOUT_DEPENDENCIES_NOT_READY");
  db.prepare(`
    UPDATE membership_card_platforms SET inventory_status = 'completed' WHERE key = 'efuncard'
  `).run();
  const enabled = await app.injectRoute("POST", "/api/admin/membership-fulfillment/rollout-mode", {
    ip: "127.0.0.2",
    body: { mode: "canary", credentials: adminSecrets }
  });
  assert.equal(enabled.statusCode, 200);
  assert.equal(enabled.body.item.paymentGateEnabled, true);
	// Legacy extension-route tests below still need their independent transport credential.
	db.prepare(`UPDATE extension_delivery_settings
	  SET extension_token_sha256=?,bound_installation_id='install-api' WHERE id='default'`).run("b".repeat(64));
  db.prepare(`
    INSERT INTO membership_fulfillments (
      id, order_id, order_no, target_tier, state, current_stage, run_mode,
      created_at, updated_at
    ) VALUES ('mf-start-canary', 'order-start-canary', 'ORDER-START-CANARY',
      'plus', 'FUNDING_READY', 'plus', NULL, ?, ?)
  `).run(fixedNow, fixedNow);
  const started = await app.injectRoute("POST", "/api/admin/membership-fulfillments/:id/start-canary", {
    ip: "127.0.0.2",
    params: { id: "mf-start-canary" },
    body: { credentials: adminSecrets }
  });
  assert.equal(started.statusCode, 200);
  assert.equal(started.body.item.runMode, "canary");
  assert.doesNotMatch(JSON.stringify(db.prepare("SELECT * FROM membership_fulfillment_settings WHERE id = 'default'").get()),
    /test-password/);
  db.prepare("UPDATE membership_fulfillments SET state = 'COMPLETED' WHERE id = 'mf-start-canary'").run();
});

test("material claim is strict, single-use, no-store, and never persists returned secrets", async () => {
  const stage = seedStage("mf-api-material", { targetTier: "x5" });
  const grant = createMembershipMaterialGrant(db, {
    fulfillmentId: stage.id,
    stageKey: "plus",
    attemptNo: 1,
    installationId: "install-api",
    leaseEpoch: 1,
    adapterVersion: "checkout-v1",
    nowMs: Date.parse(fixedNow),
    ttlMs: 60_000
  });
  const body = {
    nonce: grant.nonce,
    fulfillmentId: stage.id,
    stage: "plus",
    targetTier: "x5",
    attempt: 1,
    leaseEpoch: 1,
    adapterVersion: "checkout-v1"
  };

  const rejected = await app.injectRoute(
    "POST",
    "/api/extension/membership-material-grants/:grantId/claim",
    { params: { grantId: grant.grantId }, body: { ...body, rawHtml: "secret" } }
  );
  assert.equal(rejected.statusCode, 400);
  assert.equal(materialCalls, 0);

  const response = await app.injectRoute(
    "POST",
    "/api/extension/membership-material-grants/:grantId/claim",
    { params: { grantId: grant.grantId }, body }
  );
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["cache-control"], "no-store");
  assert.equal(response.body.card.number, "4242424242424242");
  assert.equal(response.body.billing.state, "DE");
  assert.deepEqual(response.body.validation, {
    stage: "plus",
    targetTier: "x5",
    currency: "PHP",
    priceContractVersion: 41,
    adapterVersion: "checkout-v1"
  });
  assert.equal(materialCalls, 1);
  assert.equal(checkoutCalls, 1);
  assert.equal(addressCalls, 1);

  const persisted = JSON.stringify({
    grants: db.prepare("SELECT * FROM membership_material_grants WHERE fulfillment_id = ?").all(stage.id),
    fulfillment: db.prepare("SELECT * FROM membership_fulfillments WHERE id = ?").get(stage.id),
    audit: audits
  });
  assert.doesNotMatch(persisted, /4242424242424242|123 Main Street|Ada Lovelace|one-time/);

  const replay = await app.injectRoute(
    "POST",
    "/api/extension/membership-material-grants/:grantId/claim",
    { params: { grantId: grant.grantId }, body }
  );
  assert.equal(replay.statusCode, 409);
  assert.equal(replay.body.code, "MATERIAL_GRANT_ALREADY_CLAIMED");
  assert.equal(materialCalls, 1);
  assert.equal(checkoutCalls, 1);
});

test("upgrade material keeps the already selected x5/x20 checkout context instead of replacing it with Plus", async () => {
  seedStage("mf-api-upgrade-material", {
    targetTier: "x5",
    stage: "upgrade",
    contractId: "contract-api-x5"
  });
  const grant = createMembershipMaterialGrant(db, {
    fulfillmentId: "mf-api-upgrade-material",
    stageKey: "upgrade",
    attemptNo: 1,
    installationId: "install-api",
    leaseEpoch: 1,
    adapterVersion: "checkout-v1",
    nowMs: Date.parse(fixedNow)
  });
  const response = await app.injectRoute("POST", "/api/extension/membership-material-grants/:grantId/claim", {
    params: { grantId: grant.grantId },
    headers: { "x-extension-installation-id": "install-api" },
    body: {
      nonce: grant.nonce,
      fulfillmentId: "mf-api-upgrade-material",
      stage: "upgrade",
      targetTier: "x5",
      attempt: 1,
      leaseEpoch: 1,
      adapterVersion: "checkout-v1"
    }
  });
  assert.equal(response.statusCode, 200, JSON.stringify(response.body));
  assert.equal(response.body.checkoutUrl, null);
  assert.equal(response.body.validation.targetTier, "x5");
});

test("submit consumes the original stage approval after a clear multi-step progression", async () => {
  const page = paymentPage();
  const approvedPageFingerprint = "b".repeat(64);
  const stage = seedStage("mf-api-permit", {
    state: "PLUS_APPROVAL_WAIT",
    fingerprint: page.structuralHash
  });
  db.prepare(`
    INSERT INTO live_canary_authorizations (
      id, fulfillment_id, stage_key, target_tier, card_id, funding_budget,
      price_contract_id, adapter_version, snapshot_fingerprint, state,
      approved_by, approved_at
    ) VALUES ('canary-api-permit', ?, 'plus', 'plus', ?, 16.44,
      'contract-api-plus', 'checkout-v1', ?, 'approved', 'admin', ?)
  `).run(stage.id, stage.cardId, approvedPageFingerprint, "2026-07-16T00:00:00.000Z");
  db.prepare(`
    INSERT INTO membership_action_permits (
      id, fulfillment_id, stage_key, attempt_no, action_type, sequence_no,
      installation_id, browser_lease_epoch, adapter_version, price_contract_id,
      control_id, page_fingerprint, state, issued_at, expires_at,
      activated_at, reported_at, outcome_code
    ) VALUES ('permit-api-clear-progression', ?, 'plus', 1, 'progression', 1,
      'install-api', 1, 'checkout-v1', 'contract-api-plus', 'payment-next', ?,
      'reported', '2026-07-16T00:00:30.000Z', '2026-07-16T00:05:00.000Z',
      '2026-07-16T00:00:31.000Z', '2026-07-16T00:00:32.000Z', 'AUTHORIZATION_CLEAR')
  `).run(stage.id, approvedPageFingerprint);
  const body = permitBody(page);

  const extraKey = await app.injectRoute(
    "POST",
    "/api/extension/membership-fulfillments/:id/submit-permit",
    { params: { id: stage.id }, body: { ...body, checkoutUrl: "must-not-accept" } }
  );
  assert.equal(extraKey.statusCode, 400);

  const response = await app.injectRoute(
    "POST",
    "/api/extension/membership-fulfillments/:id/submit-permit",
    { params: { id: stage.id }, body }
  );
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["cache-control"], "no-store");
  assert.deepEqual(Object.keys(response.body).sort(), [
    "adapterVersion", "attempt", "authorizationId", "authorizationMode",
    "authorizationState", "controlId", "expiresAt", "fulfillmentId", "kind",
    "leaseEpoch", "pageFingerprint", "permitId", "priceContractVersion",
    "singleUse", "stage", "targetTier"
  ].sort());
  assert.equal(response.body.authorizationMode, "canary");
  assert.equal(response.body.authorizationId, "canary-api-permit");
  assert.equal(response.body.authorizationState, "clear");
  assert.notEqual(approvedPageFingerprint, page.structuralHash);
  assert.equal(db.prepare(`
    SELECT state FROM live_canary_authorizations WHERE id = 'canary-api-permit'
  `).get().state, "consumed");
  assert.equal(db.prepare("SELECT state FROM membership_fulfillments WHERE id = ?").get(stage.id).state,
    "PLUS_SUBMIT_PERMITTED");
  assert.deepEqual(db.prepare(`
    SELECT auth_id FROM membership_action_auth_snapshots
    WHERE permit_id = ?
  `).all(response.body.permitId), [{ auth_id: "auth-existing" }]);
});

test("a changed canary page without clear progression lineage cannot consume approval", async () => {
  const page = paymentPage({ displayedAmount: 1050 });
  const stage = seedStage("mf-api-stale-canary", {
    state: "PLUS_APPROVAL_WAIT",
    fingerprint: page.structuralHash
  });
  db.prepare(`
    INSERT INTO live_canary_authorizations (
      id, fulfillment_id, stage_key, target_tier, card_id, funding_budget,
      price_contract_id, adapter_version, snapshot_fingerprint, state,
      approved_by, approved_at
    ) VALUES ('canary-api-stale', ?, 'plus', 'plus', ?, 16.44,
      'contract-api-plus', 'checkout-v1', ?, 'approved', 'admin', ?)
  `).run(stage.id, stage.cardId, "c".repeat(64), "2026-07-16T00:00:00.000Z");
  const response = await app.injectRoute(
    "POST",
    "/api/extension/membership-fulfillments/:id/submit-permit",
    { params: { id: stage.id }, body: permitBody(page) }
  );
  assert.equal(response.statusCode, 409);
  assert.equal(response.body.code, "CANARY_PAGE_SNAPSHOT_STALE");
  assert.equal(db.prepare(`
    SELECT state FROM live_canary_authorizations WHERE id = 'canary-api-stale'
  `).get().state, "approved");
  assert.equal(db.prepare(`
    SELECT COUNT(*) AS count FROM membership_action_permits
    WHERE fulfillment_id = ? AND action_type = 'submit'
  `).get(stage.id).count, 0);
  db.prepare(`
    UPDATE live_canary_authorizations
    SET state = 'invalidated', invalidated_at = ? WHERE id = 'canary-api-stale'
  `).run(fixedNow);
});

test("plan-management progression is a confirmation-only preflight and consumes no live canary", async () => {
  const page = paymentPage({
    stateId: "UPGRADE_SELECTION_READY",
    origin: "https://chatgpt.com",
    routeTemplate: "/settings/subscription",
    plan: "prolite",
    displayedAmount: 4999,
    stateMarker: "upgrade-selection",
    fields: {
      cardNumber: false,
      expiry: false,
      expiryMonth: false,
      expiryYear: false,
      cvc: false,
      billingName: false,
      billingLine1: false,
      billingCity: false,
      billingState: false,
      billingCountry: false,
      billingPostal: false
    },
    controls: {
      progression: null,
      submit: null,
      upgradeX5: "upgrade-x5",
      upgradeX20: null,
      challenge: null
    }
  });
  const stage = seedStage("mf-api-plan-preflight", {
    targetTier: "x5",
    stage: "upgrade",
    adapterVersion: "plan-management-v1",
    contractId: "contract-api-x5",
    state: "UPGRADE_CHECKOUT_PREFLIGHT",
    stageState: "preflight_ready",
    fingerprint: page.structuralHash
  });
  const response = await app.injectRoute(
    "POST",
    "/api/extension/membership-fulfillments/:id/progression-permit",
    {
      params: { id: stage.id },
      body: {
        stage: "upgrade",
        targetTier: "x5",
        attempt: 1,
        leaseEpoch: 1,
        adapterVersion: "plan-management-v1",
        priceContractVersion: 42,
        controlId: "upgrade-x5",
        pageFingerprint: page.structuralHash,
        page
      }
    }
  );
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.kind, "progression");
  assert.equal(response.body.authorizationMode, "canary");
  assert.equal(response.body.authorizationId, `preflight:${stage.id}:1`);
  assert.equal(response.body.authorizationState, "snapshotted");
  assert.equal(db.prepare(`
    SELECT COUNT(*) AS count FROM live_canary_authorizations WHERE fulfillment_id = ?
  `).get(stage.id).count, 0);
  assert.equal(db.prepare(`
    SELECT state FROM membership_payment_stages WHERE fulfillment_id = ? AND stage_key = 'upgrade'
  `).get(stage.id).state, "progression_permitted");
});

test("local challenge acknowledgement is confirmation-only and fully lease-bound", async () => {
  const stage = seedStage("mf-api-ack", { state: "PAYMENT_ACTION_REQUIRED" });
  db.prepare(`
    INSERT INTO fulfillment_interventions (
      id, fulfillment_id, state, state_revision, reason_code, created_at
    ) VALUES ('intervention-api-ack', ?, 'PAYMENT_ACTION_REQUIRED', 0,
      'PAYMENT_ACTION_REQUIRED', ?)
  `).run(stage.id, fixedNow);
  const response = await app.injectRoute(
    "POST",
    "/api/extension/membership-fulfillments/:id/action-ack",
    {
      params: { id: stage.id },
      body: {
        acknowledgement: "LOCAL_VERIFICATION_COMPLETED",
        stage: "plus",
        targetTier: "plus",
        attempt: 1,
        leaseEpoch: 1,
        adapterVersion: "checkout-v1"
      }
    }
  );
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, { accepted: true, confirmationOnly: true });
  assert.equal(db.prepare(`
    SELECT acknowledged_by FROM fulfillment_interventions WHERE id = 'intervention-api-ack'
  `).get().acknowledged_by, "extension-local");
});

test("admin canary preparation removes manual guessing and fresh credentials never persist or echo", async () => {
  const page = paymentPage();
  const stage = seedStage("mf-api-canary-admin", {
    state: "PLUS_APPROVAL_WAIT",
    runMode: null,
    fingerprint: page.structuralHash
  });
  const preparation = await app.injectRoute(
    "GET",
    "/api/admin/live-canary-authorizations",
    { query: { fulfillmentId: stage.id } }
  );
  assert.equal(preparation.statusCode, 200);
  assert.deepEqual(preparation.body.canaryPreparation, {
    ready: true,
    stage: "plus",
    cardId: stage.cardId,
    fundingBudgetUsd: 16.44,
    priceContractId: "contract-api-plus",
    adapterVersion: "checkout-v1",
    pageFingerprint: page.structuralHash,
    preparedAt: fixedNow,
    reasonCode: null
  });

  const approvalBody = {
    fulfillmentId: stage.id,
    stage: "plus",
    cardId: stage.cardId,
    fundingBudgetUsd: 16.44,
    priceContractId: "contract-api-plus",
    adapterVersion: "checkout-v1",
    pageFingerprint: page.structuralHash,
    credentials: { username: "admin", password: "wrong-secret" }
  };
  const rejected = await app.injectRoute(
    "POST",
    "/api/admin/live-canary-authorizations",
    { body: approvalBody, ip: "10.0.0.1" }
  );
  assert.equal(rejected.statusCode, 403);
  assert.equal(rejected.body.code, "FRESH_ADMIN_AUTH_FAILED");
  assert.doesNotMatch(JSON.stringify(rejected.body), /wrong-secret/);

  const approved = await app.injectRoute(
    "POST",
    "/api/admin/live-canary-authorizations",
    { body: { ...approvalBody, credentials: credentials() }, ip: "10.0.0.1" }
  );
  assert.equal(approved.statusCode, 200);
  assert.equal(approved.body.item.stage, "plus");
  assert.equal(Object.hasOwn(approved.body.item, "stageKey"), false);
  assert.equal(approved.body.item.snapshotBound, true);
  assert.equal(Object.hasOwn(approved.body.item, "pageFingerprint"), false);

  const stored = JSON.stringify({
    canary: db.prepare("SELECT * FROM live_canary_authorizations WHERE fulfillment_id = ?").all(stage.id),
    audits
  });
  assert.doesNotMatch(stored, /fresh-secret|wrong-secret/);
});

test("automatic scopes create one/day, revise upward, disable, and expose stable serializers", async () => {
  db.prepare(`
    INSERT INTO sites (id, name, slug, status, created_at, updated_at)
    VALUES ('site-api-payment', 'API Payment', 'api-payment', 'active', ?, ?)
  `).run(fixedNow, fixedNow);
  db.prepare(`
    INSERT INTO products (id, code, title, membership_tier, status, created_at, updated_at)
    VALUES ('product-api-payment', 'API-PAY', 'API Pay', 'plus', 'active', ?, ?)
  `).run(fixedNow, fixedNow);
  db.prepare(`
    INSERT INTO tier_rollout_qualifications (
      id, tier, adapter_version, adapter_path, price_contract_id,
      fulfillment_id, qualified_at
    ) VALUES ('qualification-api-payment', 'plus', 'checkout-v1', 'single_page',
      'contract-api-plus', 'mf-qualified-api-payment', ?)
  `).run(fixedNow);

  const created = await app.injectRoute(
    "POST",
    "/api/admin/automatic-checkout-scopes",
    {
      ip: "10.0.0.2",
      body: {
        siteId: "site-api-payment",
        productId: "product-api-payment",
        tier: "plus",
        adapterVersion: "checkout-v1",
        priceContractId: "contract-api-plus",
        dailyOrderLimit: 1,
        dailyRiskLimitUsd: 50,
        credentials: credentials()
      }
    }
  );
  assert.equal(created.statusCode, 200);
  assert.equal(created.body.item.dailyOrderLimit, 1);
  assert.equal(created.body.item.updatedAt, fixedNow);

  const revised = await app.injectRoute(
    "POST",
    "/api/admin/automatic-checkout-scopes/:id/increase-limits",
    {
      params: { id: created.body.item.id },
      ip: "10.0.0.2",
      body: {
        dailyOrderLimit: 2,
        dailyRiskLimitUsd: 100,
        credentials: credentials()
      }
    }
  );
  assert.equal(revised.statusCode, 200);
  assert.equal(revised.body.item.revision, 2);
  assert.equal(revised.body.item.status, "active");

  const disabled = await app.injectRoute(
    "POST",
    "/api/admin/automatic-checkout-scopes/:id/disable",
    { params: { id: revised.body.item.id }, body: {} }
  );
  assert.equal(disabled.statusCode, 200);
  assert.equal(disabled.body.item.status, "disabled");
  assert.equal(disabled.body.item.disabledAt, fixedNow);
  assert.equal(db.prepare("SELECT status FROM automatic_checkout_scopes WHERE id = ?")
    .get(created.body.item.id).status, "paused");

  const listed = await app.injectRoute("GET", "/api/admin/automatic-checkout-scopes");
  assert.equal(listed.headers["cache-control"], "no-store");
  assert.equal(listed.body.items.length, 2);
});

test("intervention acknowledgement and partial compensation are append-only admin operations", async () => {
  db.prepare(`
    INSERT INTO membership_fulfillments (
      id, order_id, order_no, target_tier, state, current_stage, created_at, updated_at
    ) VALUES ('mf-api-partial', 'order-api-partial', 'ORDER-API-PARTIAL', 'x5',
      'PARTIALLY_FULFILLED', 'upgrade', ?, ?)
  `).run(fixedNow, fixedNow);
  db.prepare(`
    INSERT INTO fulfillment_interventions (
      id, fulfillment_id, state, state_revision, reason_code, created_at
    ) VALUES ('intervention-api-admin', 'mf-api-partial', 'PARTIALLY_FULFILLED', 3,
      'UPGRADE_PAYMENT_DECLINED', ?)
  `).run(fixedNow);

  const ack = await app.injectRoute(
    "POST",
    "/api/admin/fulfillment-interventions/:id/ack",
    { params: { id: "intervention-api-admin" }, body: {} }
  );
  assert.equal(ack.statusCode, 200);
  assert.deepEqual(Object.keys(ack.body.item).sort(), [
    "acknowledgedAt", "acknowledgedBy", "createdAt", "feishuSentAt", "feishuStatus",
    "fulfillmentId", "id", "reasonCode", "state", "stateRevision"
  ].sort());

  const compensation = await app.injectRoute(
    "POST",
    "/api/admin/membership-fulfillments/:id/compensations",
    {
      params: { id: "mf-api-partial" },
      body: { resolutionType: "CUSTOMER_ACCEPTED_PARTIAL", evidenceReference: "ticket:SUP-1001" }
    }
  );
  assert.equal(compensation.statusCode, 200);
  assert.equal(compensation.body.item.revision, 1);
  assert.equal(compensation.body.item.resolutionType, "CUSTOMER_ACCEPTED_PARTIAL");
  assert.equal(db.prepare(`
    SELECT COUNT(*) AS count FROM customer_compensation_resolutions
    WHERE fulfillment_id = 'mf-api-partial'
  `).get().count, 1);
});

test("extension and fresh-admin boundaries are independently rate limited", async () => {
  for (let index = 0; index < 30; index += 1) {
    const allowed = await app.injectRoute(
      "POST",
      "/api/extension/membership-fulfillments/:id/action-ack",
      {
        params: { id: "mf-rate-limit" },
        headers: { "x-extension-installation-id": "install-rate-limit" },
        body: {}
      }
    );
    assert.equal(allowed.statusCode, 400);
  }
  const extensionLimited = await app.injectRoute(
    "POST",
    "/api/extension/membership-fulfillments/:id/action-ack",
    {
      params: { id: "mf-rate-limit" },
      headers: { "x-extension-installation-id": "install-rate-limit" },
      body: {}
    }
  );
  assert.equal(extensionLimited.statusCode, 429);
  assert.equal(extensionLimited.body.code, "EXTENSION_RATE_LIMITED");
  assert.equal(extensionLimited.headers["retry-after"], "60");
  assert.equal(extensionLimited.headers["cache-control"], "no-store");

  const freshBody = {
    fulfillmentId: "mf-admin-rate-limit",
    stage: "plus",
    cardId: "card-admin-rate-limit",
    fundingBudgetUsd: 16.44,
    priceContractId: "contract-api-plus",
    adapterVersion: "checkout-v1",
    pageFingerprint: "f".repeat(64),
    credentials: credentials()
  };
  for (let index = 0; index < 5; index += 1) {
    const allowed = await app.injectRoute(
      "POST",
      "/api/admin/live-canary-authorizations",
      { ip: "10.0.0.99", body: freshBody }
    );
    assert.equal(allowed.statusCode, 409);
  }
  const adminLimited = await app.injectRoute(
    "POST",
    "/api/admin/live-canary-authorizations",
    { ip: "10.0.0.99", body: freshBody }
  );
  assert.equal(adminLimited.statusCode, 429);
  assert.equal(adminLimited.body.code, "FRESH_ADMIN_AUTH_RATE_LIMITED");
  assert.equal(adminLimited.headers["retry-after"], "60");
});
