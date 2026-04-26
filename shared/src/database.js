import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { env, resolveProjectPath } from "./env.js";

const dbPath = path.isAbsolute(env.databasePath)
  ? env.databasePath
  : resolveProjectPath(env.databasePath);

let database;

function ensureParentDirectory(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function hasColumn(db, tableName, columnName) {
  return db.prepare(`PRAGMA table_info(${tableName})`).all().some((column) => column.name === columnName);
}

function ensureColumn(db, tableName, columnName, definition) {
  if (!hasColumn(db, tableName, columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

function upsertSite(db, site) {
  const exists = db.prepare("SELECT id FROM sites WHERE slug = ?").get(site.slug);
  if (exists) {
    db.prepare(`
      UPDATE sites
      SET name = ?, verify_api_url = ?, submit_api_url = ?, verify_http_method = ?, submit_http_method = ?,
          verify_headers_template = ?, verify_body_template = ?, submit_headers_template = ?, submit_body_template = ?,
          abandon_submit_body_template = ?, auth_type = ?, auth_config = ?, verify_success_rule = ?, verify_failure_rule = ?,
          submit_success_rule = ?, submit_failure_rule = ?, timeout_seconds = ?, max_retries = ?,
          product_id = ?, activation_endpoint_id = ?,
          query_api_url = ?, query_success_rule = ?, polling_enabled = ?,
          status = ?, updated_at = ?
      WHERE slug = ?
    `).run(
      site.name,
      site.verifyApiUrl || null,
      site.submitApiUrl || null,
      site.verifyHttpMethod,
      site.submitHttpMethod,
      site.verifyHeadersTemplate || "{}",
      site.verifyBodyTemplate || "{}",
      site.submitHeadersTemplate || "{}",
      site.submitBodyTemplate || "{}",
      site.abandonSubmitBodyTemplate || site.submitBodyTemplate || "{}",
      site.authType || null,
      site.authConfig || null,
      site.verifySuccessRule || null,
      site.verifyFailureRule || null,
      site.submitSuccessRule || null,
      site.submitFailureRule || null,
      site.timeoutSeconds,
      site.maxRetries,
      site.productId || null,
      site.activationEndpointId || null,
      site.queryApiUrl || null,
      site.querySuccessRule || null,
      site.pollingEnabled || 0,
      site.status,
      site.updatedAt,
      site.slug
    );
    return;
  }

  db.prepare(`
    INSERT INTO sites (
      id, name, slug, verify_api_url, submit_api_url, verify_http_method, submit_http_method,
      verify_headers_template, verify_body_template, submit_headers_template, submit_body_template,
      abandon_submit_body_template, auth_type, auth_config, verify_success_rule, verify_failure_rule, submit_success_rule, submit_failure_rule,
      timeout_seconds, max_retries, product_id, activation_endpoint_id,
      query_api_url, query_success_rule, polling_enabled,
      status, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    site.id,
    site.name,
    site.slug,
    site.verifyApiUrl || null,
    site.submitApiUrl || null,
    site.verifyHttpMethod,
    site.submitHttpMethod,
    site.verifyHeadersTemplate || "{}",
    site.verifyBodyTemplate || "{}",
    site.submitHeadersTemplate || "{}",
    site.submitBodyTemplate || "{}",
    site.abandonSubmitBodyTemplate || site.submitBodyTemplate || "{}",
    site.authType || null,
    site.authConfig || null,
    site.verifySuccessRule || null,
    site.verifyFailureRule || null,
    site.submitSuccessRule || null,
    site.submitFailureRule || null,
    site.timeoutSeconds,
    site.maxRetries,
    site.productId || null,
    site.activationEndpointId || null,
    site.queryApiUrl || null,
    site.querySuccessRule || null,
    site.pollingEnabled || 0,
    site.status,
    site.createdAt,
    site.updatedAt
  );
}

function createSchema(db) {
  db.exec(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      default_activation_endpoint_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS activation_endpoints (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      endpoint_type TEXT NOT NULL,
      submit_url TEXT NOT NULL,
      query_url TEXT,
      http_method TEXT NOT NULL DEFAULT 'POST',
      headers_template TEXT,
      body_template TEXT,
      abandon_submit_body_template TEXT,
      auth_type TEXT,
      auth_config TEXT,
      success_rule TEXT,
      failure_rule TEXT,
      polling_enabled INTEGER NOT NULL DEFAULT 0,
      timeout_seconds INTEGER NOT NULL DEFAULT 15,
      max_retries INTEGER NOT NULL DEFAULT 3,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sites (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      verify_api_url TEXT,
      submit_api_url TEXT,
      verify_http_method TEXT NOT NULL DEFAULT 'POST',
      submit_http_method TEXT NOT NULL DEFAULT 'POST',
      verify_headers_template TEXT,
      verify_body_template TEXT,
      submit_headers_template TEXT,
      submit_body_template TEXT,
      abandon_submit_body_template TEXT,
      auth_type TEXT,
      auth_config TEXT,
      verify_success_rule TEXT,
      verify_failure_rule TEXT,
      submit_success_rule TEXT,
      submit_failure_rule TEXT,
      timeout_seconds INTEGER NOT NULL DEFAULT 15,
      max_retries INTEGER NOT NULL DEFAULT 3,
      product_id TEXT,
      activation_endpoint_id TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cdkey_batches (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      prefix TEXT NOT NULL,
      product_id TEXT NOT NULL,
      activation_endpoint_id TEXT NOT NULL,
      site_id TEXT,
      imported_count INTEGER NOT NULL DEFAULT 0,
      note TEXT,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cdkeys (
      id TEXT PRIMARY KEY,
      batch_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      activation_endpoint_id TEXT NOT NULL,
      site_id TEXT,
      source_key TEXT NOT NULL,
      public_key TEXT NOT NULL UNIQUE,
      prefix TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      locked_at TEXT,
      locked_by_order_id TEXT,
      used_at TEXT,
      disabled_reason TEXT,
      metadata TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS redeem_orders (
      id TEXT PRIMARY KEY,
      order_no TEXT NOT NULL UNIQUE,
      cdkey_id TEXT NOT NULL,
      public_key TEXT NOT NULL,
      product_id TEXT NOT NULL,
      activation_endpoint_id TEXT NOT NULL,
      site_id TEXT,
      session_payload TEXT NOT NULL,
      session_preview TEXT,
      customer_ip TEXT,
      abandon_remaining_time INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      latest_job_id TEXT,
      error_message TEXT,
      completed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS activation_jobs (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      cdkey_id TEXT NOT NULL,
      activation_endpoint_id TEXT NOT NULL,
      site_id TEXT,
      dedupe_key TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'pending',
      payload TEXT NOT NULL,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 3,
      next_retry_at TEXT,
      last_error TEXT,
      last_response TEXT,
      locked_at TEXT,
      locked_by TEXT,
      delivered_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS admin_audit_logs (
      id TEXT PRIMARY KEY,
      action TEXT NOT NULL,
      actor TEXT NOT NULL,
      resource_type TEXT NOT NULL,
      resource_id TEXT,
      detail TEXT,
      created_at TEXT NOT NULL
    );

  `);

  ensureColumn(db, "cdkey_batches", "site_id", "TEXT");
  ensureColumn(db, "cdkeys", "site_id", "TEXT");
  ensureColumn(db, "redeem_orders", "site_id", "TEXT");
  ensureColumn(db, "redeem_orders", "abandon_remaining_time", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "activation_jobs", "site_id", "TEXT");
  ensureColumn(db, "activation_endpoints", "abandon_submit_body_template", "TEXT");
  ensureColumn(db, "sites", "abandon_submit_body_template", "TEXT");
  ensureColumn(db, "sites", "last_health_check", "TEXT");
  ensureColumn(db, "sites", "last_health_result", "TEXT");
  ensureColumn(db, "sites", "query_api_url", "TEXT");
  ensureColumn(db, "sites", "query_success_rule", "TEXT");
  ensureColumn(db, "sites", "polling_enabled", "INTEGER NOT NULL DEFAULT 0");

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_cdkeys_status ON cdkeys(status, updated_at);
    CREATE INDEX IF NOT EXISTS idx_cdkeys_site ON cdkeys(site_id, status, updated_at);
    CREATE INDEX IF NOT EXISTS idx_orders_status ON redeem_orders(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_orders_site ON redeem_orders(site_id, status, created_at);
    CREATE INDEX IF NOT EXISTS idx_jobs_status ON activation_jobs(status, next_retry_at);
    CREATE INDEX IF NOT EXISTS idx_jobs_site ON activation_jobs(site_id, status, next_retry_at);
    CREATE INDEX IF NOT EXISTS idx_logs_action ON admin_audit_logs(action, created_at);
    CREATE INDEX IF NOT EXISTS idx_sites_status ON sites(status, updated_at);
  `);
}

function seedDefaults(db) {
  const hasProduct = db.prepare("SELECT COUNT(*) AS count FROM products").get();
  const now = new Date().toISOString();
  if (hasProduct.count === 0) {
    db.prepare(`
      INSERT INTO products (id, code, title, description, status, created_at, updated_at)
      VALUES (@id, @code, @title, @description, 'active', @createdAt, @updatedAt)
    `).run({
      id: "prod_demo",
      code: "chatgpt_plus",
      title: "ChatGPT Plus Recharge",
      description: "默认演示商品，用于新项目初始化验证。",
      createdAt: now,
      updatedAt: now
    });
  }

  const hasEndpoint = db.prepare("SELECT COUNT(*) AS count FROM activation_endpoints").get();
  if (hasEndpoint.count === 0) {
    db.prepare(`
      INSERT INTO activation_endpoints (
        id, name, endpoint_type, submit_url, query_url, http_method,
        headers_template, body_template, auth_type, auth_config,
        success_rule, failure_rule, polling_enabled, timeout_seconds,
        max_retries, status, created_at, updated_at
      )
      VALUES (
        @id, @name, 'api', @submitUrl, NULL, 'POST',
        '{}', '{"card":"{{sourceKey}}","session":{{sessionRaw}}}', NULL, NULL,
        '{"kind":"json_path_equals","path":"success","value":"true"}', NULL, 0, 15,
        3, 'active', @createdAt, @updatedAt
      )
    `).run({
      id: "endpoint_demo",
      name: "Demo Submit Endpoint",
      submitUrl: `${env.apiUrl}/api/mock/activate`,
      createdAt: now,
      updatedAt: now
    });
  }

  const hasSite = db.prepare("SELECT COUNT(*) AS count FROM sites").get();
  if (hasSite.count === 0) {
    upsertSite(db, {
      id: "site_demo",
      name: "Demo Website",
      slug: "demo-website",
      verifyApiUrl: `${env.apiUrl}/api/mock/verify`,
      submitApiUrl: `${env.apiUrl}/api/mock/activate`,
      verifyHttpMethod: "POST",
      submitHttpMethod: "POST",
      verifyHeadersTemplate: "{}",
      verifyBodyTemplate: '{"card":"{{sourceKey}}"}',
      submitHeadersTemplate: "{}",
      submitBodyTemplate: '{"card":"{{sourceKey}}","session":{{sessionRaw}}}',
      abandonSubmitBodyTemplate: '{"card":"{{sourceKey}}","session":{{sessionRaw}}}',
      authType: null,
      authConfig: null,
      verifySuccessRule: '{"kind":"json_path_equals","path":"success","value":"true"}',
      verifyFailureRule: null,
      submitSuccessRule: '{"kind":"json_path_equals","path":"success","value":"true"}',
      submitFailureRule: null,
      timeoutSeconds: 15,
      maxRetries: 3,
      productId: "prod_demo",
      activationEndpointId: "endpoint_demo",
      status: "active",
      createdAt: now,
      updatedAt: now
    });
  }

  const presetSites = [
    {
      id: "site_preset_oaifire",
      name: "OAIFire",
      slug: "oaifire",
      verifyApiUrl: "https://oaifire.win/api/verify-cdk",
      submitApiUrl: null,
      verifyHttpMethod: "POST",
      submitHttpMethod: "POST",
      verifyHeadersTemplate: "{}",
      verifyBodyTemplate: '{"uniqueCode":"{{sourceKey}}"}',
      submitHeadersTemplate: "{}",
      submitBodyTemplate: '{"card":"{{sourceKey}}","session":{{sessionRaw}}}',
      abandonSubmitBodyTemplate: '{"card":"{{sourceKey}}","session":{{sessionRaw}}}',
      authType: "oaifire_sign",
      authConfig: "ChatGPT#Plus@2026!",
      verifySuccessRule: '{"kind":"json_path_equals","path":"status","value":"true"}',
      verifyFailureRule: '{"kind":"json_path_equals","path":"status","value":"false"}',
      submitSuccessRule: '{"kind":"json_path_equals","path":"success","value":"true"}',
      submitFailureRule: '{"kind":"json_path_equals","path":"success","value":"false"}',
      timeoutSeconds: 15,
      maxRetries: 3,
      productId: "prod_demo",
      activationEndpointId: null,
      status: "disabled",
      createdAt: now,
      updatedAt: now
    },
    {
      id: "site_preset_redeemgpt",
      name: "RedeemGPT",
      slug: "redeemgpt",
      verifyApiUrl: "https://redeemgpt.com/api/check",
      submitApiUrl: "https://redeemgpt.com/api/activate",
      verifyHttpMethod: "POST",
      submitHttpMethod: "POST",
      verifyHeadersTemplate: "{}",
      verifyBodyTemplate: '{"cdkey":"{{sourceKey}}"}',
      submitHeadersTemplate: "{}",
      submitBodyTemplate: '{"cdkey":"{{sourceKey}}","session_info":{{sessionRaw}}}',
      abandonSubmitBodyTemplate: '{"cdkey":"{{sourceKey}}","session_info":{{sessionRaw}},"force":1}',
      authType: null,
      authConfig: null,
      verifySuccessRule: '{"kind":"json_path_equals","path":"success","value":"true"}',
      verifyFailureRule: '{"kind":"json_path_equals","path":"success","value":"false"}',
      submitSuccessRule: '{"kind":"json_path_equals","path":"success","value":"true"}',
      submitFailureRule: '{"kind":"json_path_equals","path":"success","value":"false"}',
      timeoutSeconds: 15,
      maxRetries: 3,
      productId: "prod_demo",
      activationEndpointId: null,
      status: "disabled",
      createdAt: now,
      updatedAt: now
    },
    {
      id: "site_preset_niuniuai",
      name: "NiuniuAI",
      slug: "niuniuai",
      verifyApiUrl: "https://niuniuai.online/api/redeem/verify",
      submitApiUrl: "https://niuniuai.online/api/redeem/submit",
      verifyHttpMethod: "POST",
      submitHttpMethod: "POST",
      verifyHeadersTemplate: "{}",
      verifyBodyTemplate: '{"cardCode":"{{sourceKey}}"}',
      submitHeadersTemplate: "{}",
      submitBodyTemplate: '{"cardCode":"{{sourceKey}}","tokenContent":{{sessionString}},"allowOverwrite":false}',
      abandonSubmitBodyTemplate: '{"cardCode":"{{sourceKey}}","tokenContent":{{sessionString}},"allowOverwrite":true}',
      authType: null,
      authConfig: null,
      verifySuccessRule: '{"data":{"valid":true,"exists":true}}',
      verifyFailureRule: '{"data":{"valid":false}}',
      submitSuccessRule: '{"kind":"json_path_equals","path":"code","value":"200"}',
      submitFailureRule: null,
      queryApiUrl: "https://niuniuai.online/api/redeem/query/{{taskId}}",
      querySuccessRule: '{"kind":"json_path_equals","path":"data.taskStatus","value":"SUCCESS"}',
      pollingEnabled: 1,
      timeoutSeconds: 15,
      maxRetries: 10,
      productId: "prod_demo",
      activationEndpointId: null,
      status: "disabled",
      createdAt: now,
      updatedAt: now
    }
  ];

  for (const presetSite of presetSites) {
    upsertSite(db, presetSite);
  }

  db.prepare(`
    UPDATE cdkey_batches
    SET site_id = COALESCE(site_id, 'site_demo')
    WHERE site_id IS NULL OR site_id = ''
  `).run();

  db.prepare(`
    UPDATE cdkeys
    SET site_id = COALESCE(site_id, 'site_demo')
    WHERE site_id IS NULL OR site_id = ''
  `).run();

  db.prepare(`
    UPDATE redeem_orders
    SET site_id = COALESCE(site_id, 'site_demo')
    WHERE site_id IS NULL OR site_id = ''
  `).run();

  db.prepare(`
    UPDATE activation_jobs
    SET site_id = COALESCE(site_id, 'site_demo')
    WHERE site_id IS NULL OR site_id = ''
  `).run();
}

export function getDb() {
  if (!database) {
    ensureParentDirectory(dbPath);
    database = new Database(dbPath);
    createSchema(database);
    seedDefaults(database);
  }

  return database;
}

export function withTransaction(callback) {
  const db = getDb();
  const wrapped = db.transaction(callback);
  return wrapped();
}
