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

function upsertSite(db, site, options = {}) {
  const existingSite = db.prepare("SELECT id, status FROM sites WHERE slug = ?").get(site.slug);
  if (existingSite) {
    const status = options.preserveExistingStatus ? existingSite.status : site.status;
    db.prepare(`
      UPDATE sites
      SET name = ?, verify_api_url = ?, submit_api_url = ?, verify_http_method = ?, submit_http_method = ?,
          verify_headers_template = ?, verify_body_template = ?, submit_headers_template = ?, submit_body_template = ?,
          abandon_submit_body_template = ?, auth_type = ?, auth_config = ?, verify_success_rule = ?, verify_failure_rule = ?,
          submit_success_rule = ?, submit_failure_rule = ?, timeout_seconds = ?, max_retries = ?,
          product_id = ?, activation_endpoint_id = ?,
          query_api_url = ?, query_success_rule = ?, query_failure_rule = ?, polling_enabled = ?,
          task_id_path = ?, poll_interval_ms = ?, poll_max_rounds = ?,
          query_http_method = ?, query_headers_template = ?, query_body_template = ?,
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
      site.queryFailureRule || null,
      site.pollingEnabled || 0,
      site.taskIdPath || null,
      site.pollIntervalMs || 5000,
      site.pollMaxRounds || 6,
      site.queryHttpMethod || null,
      site.queryHeadersTemplate || null,
      site.queryBodyTemplate || null,
      status,
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
      query_api_url, query_success_rule, query_failure_rule, polling_enabled,
      task_id_path, poll_interval_ms, poll_max_rounds,
      query_http_method, query_headers_template, query_body_template,
      status, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    site.queryFailureRule || null,
    site.pollingEnabled || 0,
    site.taskIdPath || null,
    site.pollIntervalMs || 5000,
    site.pollMaxRounds || 6,
    site.queryHttpMethod || null,
    site.queryHeadersTemplate || null,
    site.queryBodyTemplate || null,
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
      membership_tier TEXT,
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
      poll_interval_ms INTEGER NOT NULL DEFAULT 5000,
      poll_max_rounds INTEGER NOT NULL DEFAULT 6,
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
      processing_mode TEXT NOT NULL DEFAULT 'auto',
      manual_type TEXT,
      origin TEXT NOT NULL DEFAULT 'admin_create',
      store_order_no TEXT,
      store_fulfillment_target_no TEXT,
      store_fulfillment_task_id TEXT,
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

    CREATE TABLE IF NOT EXISTS subscription_card_types (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      total_subscriptions INTEGER NOT NULL DEFAULT 0,
      visible INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS subscription_requests (
      id TEXT PRIMARY KEY,
      identifier TEXT NOT NULL,
      card_type_id TEXT NOT NULL,
      drop_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      reviewed_at TEXT,
      reviewed_by TEXT
    );

    CREATE TABLE IF NOT EXISTS notification_settings (
      id TEXT PRIMARY KEY,
      global_feishu_webhook TEXT,
      updated_at TEXT NOT NULL,
      updated_by TEXT
    );

    CREATE TABLE IF NOT EXISTS extension_delivery_settings (
      id TEXT PRIMARY KEY,
      enabled INTEGER NOT NULL DEFAULT 0,
      allowed_site_slugs TEXT NOT NULL DEFAULT '[]',
      spacexcard_api_token_encrypted TEXT,
      extension_token_sha256 TEXT,
      bound_installation_id TEXT,
      resume_revision INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      updated_by TEXT
    );

    CREATE TABLE IF NOT EXISTS notification_monitors (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      monitor_type TEXT NOT NULL DEFAULT 'http',
      enabled INTEGER NOT NULL DEFAULT 1,
      request_url TEXT NOT NULL,
      http_method TEXT NOT NULL DEFAULT 'GET',
      headers_json TEXT,
      body_json TEXT,
      browser_page_url TEXT,
      browser_ready_selector TEXT,
      browser_wait_ms INTEGER NOT NULL DEFAULT 10000,
      interval_seconds INTEGER NOT NULL DEFAULT 60,
      timeout_seconds INTEGER NOT NULL DEFAULT 15,
      watch_fields TEXT,
      rules_json TEXT,
      feishu_webhook_override TEXT,
      notify_title TEXT,
      cooldown_seconds INTEGER NOT NULL DEFAULT 0,
      last_response_summary TEXT,
      last_run_at TEXT,
      last_match_at TEXT,
      last_notified_at TEXT,
      last_status TEXT,
      last_error TEXT,
      next_run_at TEXT,
      locked_at TEXT,
      locked_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS notification_events (
      id TEXT PRIMARY KEY,
      monitor_id TEXT,
      monitor_name TEXT,
      event_type TEXT NOT NULL,
      matched INTEGER NOT NULL DEFAULT 0,
      summary TEXT,
      detail TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sms_batches (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      prefix TEXT NOT NULL,
      imported_count INTEGER DEFAULT 0,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sms_entries (
      id TEXT PRIMARY KEY,
      phone TEXT NOT NULL,
      sms_url TEXT NOT NULL,
      public_key TEXT NOT NULL UNIQUE,
      prefix TEXT NOT NULL,
      batch_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','locked','used','disabled','void')),
      note TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sms_sites (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      inventory_source TEXT NOT NULL DEFAULT 'sms_entries',
      status TEXT NOT NULL DEFAULT 'active',
      note TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sms_card_batches (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      prefix TEXT NOT NULL,
      total_count INTEGER NOT NULL DEFAULT 0,
      note TEXT,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sms_cards (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      batch_id TEXT,
      card_key TEXT NOT NULL UNIQUE,
      prefix TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      current_order_id TEXT,
      resource_entry_id TEXT,
      note TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sms_orders (
      id TEXT PRIMARY KEY,
      order_no TEXT NOT NULL UNIQUE,
      site_id TEXT NOT NULL,
      card_id TEXT NOT NULL,
      sms_entry_id TEXT,
      phone TEXT,
      sms_url TEXT,
      verification_code TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      error_message TEXT,
      provider_payload TEXT,
      refunded_at TEXT,
      expires_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sms_order_events (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      detail TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS quota_source_cards (
      id TEXT PRIMARY KEY,
      source_key TEXT NOT NULL,
      quota INTEGER NOT NULL,
      remaining INTEGER NOT NULL,
      status TEXT NOT NULL,
      import_batch_id TEXT,
      merged_into_id TEXT,
      verify_response TEXT,
      retry_count INTEGER DEFAULT 0,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS quota_import_batches (
      id TEXT PRIMARY KEY,
      total_count INTEGER NOT NULL,
      success_count INTEGER DEFAULT 0,
      failed_count INTEGER DEFAULT 0,
      merged_card_id TEXT,
      status TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS quota_sub_cards (
      id TEXT PRIMARY KEY,
      card_code TEXT NOT NULL UNIQUE,
      total_quota INTEGER NOT NULL,
      used_quota INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      locked_at TEXT,
      locked_until TEXT,
      lock_reason TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS quota_claim_logs (
      id TEXT PRIMARY KEY,
      sub_card_id TEXT NOT NULL,
      card_code TEXT NOT NULL,
      amount INTEGER NOT NULL,
      account_count INTEGER,
      accounts TEXT,
      warning_ack_id TEXT,
      source_ip TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS quota_rate_limits (
      id TEXT PRIMARY KEY,
      sub_card_id TEXT NOT NULL,
      request_count INTEGER NOT NULL DEFAULT 0,
      window_start TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS quota_settings (
      id TEXT PRIMARY KEY,
      low_stock_threshold INTEGER DEFAULT 5,
      last_low_stock_notify_at TEXT,
      updated_at TEXT NOT NULL,
      updated_by TEXT
    );

    CREATE TABLE IF NOT EXISTS sub2api_connections (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      base_url TEXT NOT NULL,
      admin_token TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      last_test_at TEXT,
      last_test_status TEXT,
      last_test_error TEXT,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sub2api_invites (
      id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL UNIQUE,
      connection_id TEXT NOT NULL,
      sub2api_user_id TEXT NOT NULL,
      email TEXT,
      username TEXT,
      invite_code TEXT,
      remote_invite_id TEXT,
      status TEXT NOT NULL DEFAULT 'processing',
      remote_response TEXT,
      error_message TEXT,
      expires_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sub2api_inviter_levels (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      spend_threshold REAL NOT NULL DEFAULT 0,
      lifetime_invite_limit INTEGER NOT NULL DEFAULT 3,
      unused_invite_limit INTEGER NOT NULL DEFAULT 3,
      rebate_rate REAL NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sub2api_known_users (
      id TEXT PRIMARY KEY,
      connection_id TEXT NOT NULL,
      sub2api_user_id TEXT NOT NULL,
      email TEXT,
      username TEXT,
      subscription_spend REAL NOT NULL DEFAULT 0,
      auto_level_id TEXT,
      override_level_id TEXT,
      effective_level_id TEXT,
      spend_synced_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(connection_id, sub2api_user_id)
    );

    CREATE TABLE IF NOT EXISTS sub2api_invite_rebates (
      id TEXT PRIMARY KEY,
      invite_id TEXT NOT NULL,
      connection_id TEXT NOT NULL,
      inviter_user_id TEXT NOT NULL,
      invitee_user_id TEXT NOT NULL,
      invite_code TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_remote_id TEXT,
      source_occurred_at TEXT NOT NULL,
      first_amount REAL NOT NULL,
      rebate_rate REAL NOT NULL,
      rebate_amount REAL NOT NULL,
      level_id TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      review_reason TEXT,
      remote_balance_response TEXT,
      approved_at TEXT,
      rejected_at TEXT,
      revoked_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(invite_id)
    );

    CREATE TABLE IF NOT EXISTS sub2api_subscription_plans (
      id TEXT PRIMARY KEY,
      connection_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      price REAL NOT NULL,
      subscription_group_id INTEGER NOT NULL,
      source_dedicated_group_id INTEGER,
      dedicated_group_id INTEGER,
      validity_days INTEGER NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sub2api_subscription_orders (
      id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL UNIQUE,
      plan_id TEXT NOT NULL,
      connection_id TEXT NOT NULL,
      sub2api_user_id TEXT NOT NULL,
      email TEXT,
      username TEXT,
      price REAL NOT NULL,
      subscription_group_id INTEGER NOT NULL,
      source_dedicated_group_id INTEGER,
      dedicated_group_id INTEGER,
      validity_days INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'processing',
      remote_balance_response TEXT,
      remote_subscription_response TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sub2api_worldcup_matches (
      id TEXT PRIMARY KEY,
      connection_id TEXT NOT NULL,
      stage TEXT,
      group_name TEXT,
      home_team TEXT NOT NULL,
      away_team TEXT NOT NULL,
      kickoff_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      home_score INTEGER,
      away_score INTEGER,
      result TEXT,
      odds_home REAL NOT NULL DEFAULT 1.8,
      odds_draw REAL NOT NULL DEFAULT 3.2,
      odds_away REAL NOT NULL DEFAULT 1.8,
      min_stake REAL NOT NULL DEFAULT 0.1,
      max_stake REAL NOT NULL DEFAULT 2,
      note TEXT,
      source TEXT NOT NULL DEFAULT 'manual',
      api_fixture_id TEXT,
      api_league_id INTEGER,
      api_season INTEGER,
      api_status_short TEXT,
      api_status_long TEXT,
      api_elapsed INTEGER,
      api_last_synced_at TEXT,
      odds_last_synced_at TEXT,
      halftime_betting_opened_at TEXT,
      display_date TEXT,
      first_half_added_minutes INTEGER,
      second_half_added_minutes INTEGER,
      halftime_open_at TEXT,
      halftime_close_at TEXT,
      finish_check_at TEXT,
      halftime_schedule_checked_at TEXT,
      finish_schedule_checked_at TEXT,
      final_result_checked_at TEXT,
      auto_settle_attempted_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      settled_at TEXT
    );

    CREATE TABLE IF NOT EXISTS sub2api_worldcup_bets (
      id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL UNIQUE,
      connection_id TEXT NOT NULL,
      match_id TEXT NOT NULL,
      sub2api_user_id TEXT NOT NULL,
      email TEXT,
      username TEXT,
      phase TEXT NOT NULL DEFAULT 'pre_match',
      prediction TEXT NOT NULL,
      stake REAL NOT NULL,
      odds REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'debiting',
      payout REAL NOT NULL DEFAULT 0,
      remote_debit_response TEXT,
      remote_credit_response TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      settled_at TEXT
    );

    CREATE TABLE IF NOT EXISTS api_football_daily_usage (
      usage_date TEXT PRIMARY KEY,
      used INTEGER NOT NULL DEFAULT 0,
      soft_limit INTEGER NOT NULL DEFAULT 80,
      hard_limit INTEGER NOT NULL DEFAULT 100,
      emergency_used INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS api_football_settings (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL DEFAULT 'zafronix',
      enabled INTEGER NOT NULL DEFAULT 0,
      api_key TEXT,
      base_url TEXT NOT NULL DEFAULT 'https://api.zafronix.com/fifa/worldcup/v1',
      worldcup_league_id INTEGER NOT NULL DEFAULT 1,
      worldcup_season INTEGER NOT NULL DEFAULT 2026,
      timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai',
      daily_soft_limit INTEGER NOT NULL DEFAULT 80,
      daily_hard_limit INTEGER NOT NULL DEFAULT 100,
      sync_interval_ms INTEGER NOT NULL DEFAULT 60000,
      updated_at TEXT NOT NULL,
      updated_by TEXT
    );

    CREATE TABLE IF NOT EXISTS api_football_request_logs (
      id TEXT PRIMARY KEY,
      usage_date TEXT NOT NULL,
      endpoint TEXT NOT NULL,
      params TEXT,
      priority TEXT NOT NULL DEFAULT 'normal',
      counted INTEGER NOT NULL DEFAULT 1,
      status INTEGER,
      error_message TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS store_fulfillment_settings (
      id TEXT PRIMARY KEY,
      base_url TEXT,
      admin_username TEXT,
      admin_password TEXT,
      enabled INTEGER NOT NULL DEFAULT 0,
      poll_interval_seconds INTEGER NOT NULL DEFAULT 30,
      last_sync_at TEXT,
      last_sync_status TEXT,
      last_sync_error TEXT,
      last_test_at TEXT,
      last_test_status TEXT,
      last_test_error TEXT,
      updated_at TEXT NOT NULL,
      updated_by TEXT
    );

    CREATE TABLE IF NOT EXISTS store_product_mappings (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL,
      sku_id TEXT NOT NULL DEFAULT '0',
      product_title TEXT,
      manual_type TEXT NOT NULL,
      fulfillment_kind TEXT NOT NULL DEFAULT 'manual',
      spacex_plan TEXT,
      site_id TEXT NOT NULL,
      prefix TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      updated_by TEXT,
      UNIQUE(product_id, sku_id)
    );

    CREATE TABLE IF NOT EXISTS store_fulfillment_tasks (
      id TEXT PRIMARY KEY,
      remote_order_id TEXT NOT NULL UNIQUE,
      remote_order_no TEXT NOT NULL,
      parent_order_id TEXT,
      parent_order_no TEXT,
      items_json TEXT NOT NULL,
      mapping_snapshot TEXT,
      quantity INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      cdkeys_json TEXT,
      payload TEXT,
      delivery_data TEXT,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      next_retry_at TEXT,
      last_error TEXT,
      remote_fulfillment_id TEXT,
      locked_at TEXT,
      locked_by TEXT,
      completed_at TEXT,
      canceled_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS spacex_cdk_settings (
      id TEXT PRIMARY KEY,
      enabled INTEGER NOT NULL DEFAULT 0,
      rollout_plan TEXT NOT NULL DEFAULT 'disabled',
      unlimited_funding_policy TEXT NOT NULL DEFAULT 'block',
      base_url TEXT NOT NULL DEFAULT 'https://spacexcard.com',
      api_key_encrypted TEXT,
      webhook_secret_encrypted TEXT,
      last_balance_minor INTEGER,
      balance_currency TEXT,
      last_balance_at TEXT,
      last_balance_error TEXT,
      updated_at TEXT NOT NULL,
      updated_by TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS spacex_cdks (
      id TEXT PRIMARY KEY,
      upstream_id TEXT NOT NULL UNIQUE,
      code_encrypted TEXT NOT NULL,
      code_prefix TEXT NOT NULL,
      plan TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'inventory',
      upstream_status TEXT NOT NULL DEFAULT 'unused',
      funding_cap_minor INTEGER,
      funding_liability_minor INTEGER,
      funding_currency TEXT,
      funding_contract_mode TEXT NOT NULL DEFAULT 'missing',
      funding_snapshot TEXT,
      fee_amount_minor INTEGER NOT NULL DEFAULT 0,
      current_unit_id TEXT,
      current_wrapper_cdkey_id TEXT,
      last_verified_at TEXT,
      recycled_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS spacex_cdk_units (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      item_id TEXT NOT NULL,
      unit_index INTEGER NOT NULL,
      plan TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'pending',
      idempotency_key TEXT NOT NULL UNIQUE,
      recovery_revision INTEGER NOT NULL DEFAULT 0,
      spacex_cdk_id TEXT,
      wrapper_cdkey_id TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(task_id, item_id, unit_index)
    );

    CREATE TABLE IF NOT EXISTS spacex_cdk_activations (
      id TEXT PRIMARY KEY,
      wrapper_cdkey_id TEXT NOT NULL UNIQUE,
      spacex_cdk_id TEXT NOT NULL,
      redeem_order_id TEXT NOT NULL UNIQUE,
      account_key TEXT NOT NULL,
      account_masked TEXT,
      state TEXT NOT NULL,
      client_request_id TEXT NOT NULL UNIQUE,
      redemption_token_encrypted TEXT,
      device_id TEXT NOT NULL,
      upstream_order_id TEXT,
      upstream_status TEXT,
      stage TEXT,
      public_message TEXT,
      last_error TEXT,
      reconcile_attempts INTEGER NOT NULL DEFAULT 0,
      next_reconcile_at TEXT,
      claimed_at TEXT NOT NULL,
      completed_at TEXT,
      failed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS spacex_cdk_webhook_events (
      event_id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      activation_id TEXT,
      payload_hash TEXT NOT NULL,
      processing_status TEXT NOT NULL,
      received_at TEXT NOT NULL,
      processed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS membership_fulfillment_settings (
      id TEXT PRIMARY KEY,
      enabled INTEGER NOT NULL DEFAULT 0,
      spacexcard_app_id TEXT,
      spacexcard_app_secret_encrypted TEXT,
      spacexcard_webhook_secret_encrypted TEXT,
      inventory_status TEXT NOT NULL DEFAULT 'not_started',
      inventory_initialized_at TEXT,
      last_inventory_error TEXT,
      business_timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai',
      resume_revision INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      updated_by TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS membership_processor_lease (
      id TEXT PRIMARY KEY,
      owner TEXT,
      holder_token TEXT,
      epoch INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'stopped',
      version TEXT,
      started_at TEXT,
      heartbeat_at TEXT,
      expires_at TEXT,
      last_tick_at TEXT,
      last_success_at TEXT,
      last_error_code TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS membership_intake_settings (
      id TEXT PRIMARY KEY,
      accept_orders_created_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      created_by TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS membership_fulfillments (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL UNIQUE,
      order_no TEXT NOT NULL UNIQUE,
      target_tier TEXT NOT NULL,
      state TEXT NOT NULL,
      current_stage TEXT,
      run_mode TEXT,
      account_lock_key TEXT,
      resume_revision INTEGER NOT NULL DEFAULT 0,
      state_revision INTEGER NOT NULL DEFAULT 0,
      retry_at TEXT,
      money_boundary_at TEXT,
      browser_lease_epoch INTEGER,
      card_reservation_id TEXT,
      failure_code TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS membership_fulfillment_attempts (
      id TEXT PRIMARY KEY,
      fulfillment_id TEXT NOT NULL,
      stage TEXT NOT NULL,
      attempt_no INTEGER NOT NULL,
      resume_revision INTEGER NOT NULL DEFAULT 0,
      adapter_version TEXT,
      price_contract_version INTEGER,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      outcome_code TEXT,
      sanitized_diagnostic TEXT,
      UNIQUE(fulfillment_id, stage, attempt_no)
    );

    CREATE TABLE IF NOT EXISTS membership_payment_stages (
      id TEXT PRIMARY KEY,
      fulfillment_id TEXT NOT NULL,
      stage_key TEXT NOT NULL,
      expected_tier TEXT NOT NULL,
      state TEXT NOT NULL,
      card_id TEXT,
      price_signal_amount REAL,
      price_signal_min REAL,
      price_signal_max REAL,
      price_signal_time TEXT,
      auth_snapshot_at TEXT,
      attempt_no INTEGER,
      adapter_version TEXT,
      adapter_path TEXT,
      price_contract_id TEXT,
      page_fingerprint TEXT,
      page_permit_kind TEXT,
      page_control_id TEXT,
      page_ready_at TEXT,
      page_facts_json TEXT,
      progression_permitted_at TEXT,
      progression_reported_at TEXT,
      submit_permitted_at TEXT,
      submit_reported_at TEXT,
      matched_auth_id TEXT,
      settlement_state TEXT,
      membership_observation_id TEXT,
      confirmed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(fulfillment_id, stage_key)
    );

    CREATE TABLE IF NOT EXISTS membership_observations (
      id TEXT PRIMARY KEY,
      fulfillment_id TEXT NOT NULL,
      stage_key TEXT,
      purpose TEXT NOT NULL,
      provider_code INTEGER NOT NULL,
      account_type TEXT NOT NULL,
      currency TEXT,
      auto_renew INTEGER,
      is_overdue INTEGER NOT NULL,
      is_delinquent INTEGER NOT NULL,
      expire_time TEXT,
      observed_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS managed_cards (
      id TEXT PRIMARY KEY,
      upstream_card_id INTEGER NOT NULL UNIQUE,
      vm_card_id TEXT NOT NULL UNIQUE,
      product_code TEXT NOT NULL,
      bin TEXT,
      last4 TEXT,
      upstream_status TEXT NOT NULL,
      cached_available_amount REAL NOT NULL DEFAULT 0,
      lane TEXT,
      consumed_slots INTEGER NOT NULL DEFAULT 0,
      capacity_state TEXT NOT NULL DEFAULT 'AVAILABLE',
      reconciliation_state TEXT NOT NULL DEFAULT 'PENDING',
      reconciliation_reason TEXT,
      last_balance_sync_at TEXT,
      last_transaction_sync_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS managed_card_transactions (
      card_id TEXT NOT NULL,
      auth_id TEXT NOT NULL,
      auth_time TEXT,
      auth_amount REAL NOT NULL DEFAULT 0,
      auth_currency TEXT,
      settle_amount REAL NOT NULL DEFAULT 0,
      settle_currency TEXT,
      type TEXT NOT NULL,
      status TEXT NOT NULL,
      merchant_normalized TEXT NOT NULL,
      authorization_seen INTEGER NOT NULL DEFAULT 0,
      settlement_seen INTEGER NOT NULL DEFAULT 0,
      refund_seen INTEGER NOT NULL DEFAULT 0,
      reversal_seen INTEGER NOT NULL DEFAULT 0,
      decline_reason_code TEXT,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      PRIMARY KEY(card_id, auth_id)
    );

    CREATE TABLE IF NOT EXISTS card_price_signals (
      card_id TEXT NOT NULL,
      tier TEXT NOT NULL,
      found INTEGER NOT NULL,
      amount REAL NOT NULL DEFAULT 0,
      min_usd REAL NOT NULL,
      max_usd REAL NOT NULL,
      provider_time TEXT,
      fetched_at TEXT NOT NULL,
      PRIMARY KEY(card_id, tier)
    );

    CREATE TABLE IF NOT EXISTS card_inventory_runs (
      id TEXT PRIMARY KEY,
      mode TEXT NOT NULL DEFAULT 'full',
      status TEXT NOT NULL,
      next_page INTEGER NOT NULL DEFAULT 1,
      total_cards INTEGER,
      discovered_cards INTEGER NOT NULL DEFAULT 0,
      processed_cards INTEGER NOT NULL DEFAULT 0,
      held_cards INTEGER NOT NULL DEFAULT 0,
      started_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT,
      last_error_code TEXT,
      locked_at TEXT,
      locked_by TEXT
    );

    CREATE TABLE IF NOT EXISTS card_inventory_run_items (
      run_id TEXT NOT NULL,
      upstream_card_id INTEGER NOT NULL,
      status TEXT NOT NULL,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      next_retry_at TEXT,
      error_code TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(run_id, upstream_card_id)
    );

    CREATE TABLE IF NOT EXISTS card_product_policies (
      product_code TEXT PRIMARY KEY,
      enabled INTEGER NOT NULL DEFAULT 0,
      revision INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL,
      updated_by TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS card_capacity_reservations (
      id TEXT PRIMARY KEY,
      fulfillment_id TEXT NOT NULL UNIQUE,
      card_id TEXT,
      planned_product_code TEXT,
      target_lane TEXT NOT NULL,
      slot_index INTEGER,
      state TEXT NOT NULL,
      reserved_at TEXT NOT NULL,
      consumed_at TEXT,
      released_at TEXT,
      release_evidence_revision INTEGER
    );

    CREATE TABLE IF NOT EXISTS funding_intents (
      id TEXT PRIMARY KEY,
      fulfillment_id TEXT NOT NULL UNIQUE,
      operation TEXT NOT NULL,
      target_card_id TEXT,
      product_code TEXT,
      amount REAL NOT NULL,
      fee REAL NOT NULL DEFAULT 0,
      idempotency_key TEXT NOT NULL UNIQUE,
      request_fingerprint TEXT NOT NULL,
      request_body_encrypted TEXT NOT NULL,
      state TEXT NOT NULL,
      provider_resource_id TEXT,
      created_at TEXT NOT NULL,
      submitted_at TEXT,
      resolved_at TEXT
    );

    CREATE TABLE IF NOT EXISTS browser_fulfillment_lease (
      id TEXT PRIMARY KEY,
      fulfillment_id TEXT,
      installation_id TEXT,
      epoch INTEGER NOT NULL DEFAULT 0,
      state TEXT NOT NULL DEFAULT 'available',
      heartbeat_at TEXT,
      expires_at TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS membership_material_grants (
      id TEXT PRIMARY KEY,
      nonce_sha256 TEXT NOT NULL UNIQUE,
      fulfillment_id TEXT NOT NULL,
      stage_key TEXT NOT NULL,
      attempt_no INTEGER NOT NULL,
      installation_id TEXT NOT NULL,
      browser_lease_epoch INTEGER NOT NULL,
      adapter_version TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      claimed_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS membership_action_permits (
      id TEXT PRIMARY KEY,
      fulfillment_id TEXT NOT NULL,
      stage_key TEXT NOT NULL,
      attempt_no INTEGER NOT NULL,
      action_type TEXT NOT NULL,
      sequence_no INTEGER NOT NULL DEFAULT 1,
      installation_id TEXT NOT NULL,
      browser_lease_epoch INTEGER NOT NULL,
      adapter_version TEXT NOT NULL,
      price_contract_id TEXT NOT NULL,
      control_id TEXT NOT NULL,
      page_fingerprint TEXT NOT NULL,
      state TEXT NOT NULL,
      issued_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      activated_at TEXT,
      reported_at TEXT,
      outcome_code TEXT,
      authorization_mode TEXT,
      authorization_id TEXT,
      UNIQUE(fulfillment_id, stage_key, attempt_no, action_type, sequence_no)
    );

    CREATE TABLE IF NOT EXISTS membership_action_auth_snapshots (
      permit_id TEXT NOT NULL,
      card_id TEXT NOT NULL,
      auth_id TEXT NOT NULL,
      snapshotted_at TEXT NOT NULL,
      PRIMARY KEY(permit_id, auth_id)
    );

    CREATE TABLE IF NOT EXISTS membership_no_payment_checks (
      id TEXT PRIMARY KEY,
      fulfillment_id TEXT NOT NULL,
      stage_key TEXT NOT NULL,
      checkpoint TEXT NOT NULL,
      membership_unchanged INTEGER NOT NULL,
      no_effective_transaction INTEGER NOT NULL,
      no_pending_authorization INTEGER NOT NULL,
      observed_at TEXT NOT NULL,
      UNIQUE(fulfillment_id, stage_key, checkpoint)
    );

    CREATE TABLE IF NOT EXISTS automatic_checkout_quota_reservations (
      id TEXT PRIMARY KEY,
      scope_id TEXT NOT NULL,
      fulfillment_id TEXT NOT NULL UNIQUE,
      business_date TEXT NOT NULL,
      order_units INTEGER NOT NULL,
      risk_reserved_usd REAL NOT NULL,
      state TEXT NOT NULL,
      reserved_at TEXT NOT NULL,
      released_at TEXT
    );

    CREATE TABLE IF NOT EXISTS checkout_price_contracts (
      id TEXT PRIMARY KEY,
      tier TEXT NOT NULL,
      version INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'PHP',
      min_amount REAL NOT NULL,
      max_amount REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      created_at TEXT NOT NULL,
      created_by TEXT NOT NULL,
      activated_at TEXT,
      UNIQUE(tier, version)
    );

    CREATE TABLE IF NOT EXISTS checkout_validation_runs (
      id TEXT PRIMARY KEY,
      order_id TEXT,
      site_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      tier TEXT NOT NULL,
      adapter_version TEXT NOT NULL,
      price_contract_id TEXT NOT NULL,
      status TEXT NOT NULL,
      sanitized_result TEXT,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      created_by TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS live_canary_authorizations (
      id TEXT PRIMARY KEY,
      fulfillment_id TEXT NOT NULL,
      stage_key TEXT NOT NULL,
      target_tier TEXT NOT NULL,
      card_id TEXT NOT NULL,
      funding_budget REAL NOT NULL,
      price_contract_id TEXT NOT NULL,
      adapter_version TEXT NOT NULL,
      snapshot_fingerprint TEXT NOT NULL,
      state TEXT NOT NULL,
      approved_by TEXT NOT NULL,
      approved_at TEXT NOT NULL,
      consumed_at TEXT,
      invalidated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS tier_rollout_qualifications (
      id TEXT PRIMARY KEY,
      tier TEXT NOT NULL,
      adapter_version TEXT NOT NULL,
      adapter_path TEXT NOT NULL,
      price_contract_id TEXT NOT NULL,
      fulfillment_id TEXT NOT NULL,
      qualified_at TEXT NOT NULL,
      UNIQUE(tier, adapter_version, adapter_path, price_contract_id)
    );

    CREATE TABLE IF NOT EXISTS automatic_checkout_scopes (
      id TEXT PRIMARY KEY,
      scope_key TEXT NOT NULL,
      revision INTEGER NOT NULL,
      site_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      tier TEXT NOT NULL,
      adapter_version TEXT NOT NULL,
      price_contract_id TEXT NOT NULL,
      daily_order_limit INTEGER NOT NULL,
      daily_risk_limit_usd REAL NOT NULL,
      status TEXT NOT NULL,
      activated_at TEXT,
      created_at TEXT NOT NULL,
      created_by TEXT NOT NULL,
      UNIQUE(scope_key, revision)
    );

    CREATE TABLE IF NOT EXISTS automatic_checkout_daily_usage (
      scope_id TEXT NOT NULL,
      business_date TEXT NOT NULL,
      order_units INTEGER NOT NULL DEFAULT 0,
      risk_reserved_usd REAL NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(scope_id, business_date)
    );

    CREATE TABLE IF NOT EXISTS fulfillment_dependency_circuits (
      id TEXT PRIMARY KEY,
      dependency TEXT NOT NULL,
      scope_key TEXT NOT NULL,
      state TEXT NOT NULL,
      failure_count INTEGER NOT NULL DEFAULT 0,
      opened_at TEXT,
      retry_at TEXT,
      recovery_revision INTEGER NOT NULL DEFAULT 0,
      reason_code TEXT,
      updated_at TEXT NOT NULL,
      UNIQUE(dependency, scope_key)
    );

    CREATE TABLE IF NOT EXISTS fulfillment_interventions (
      id TEXT PRIMARY KEY,
      fulfillment_id TEXT NOT NULL,
      state TEXT NOT NULL,
      state_revision INTEGER NOT NULL,
      reason_code TEXT NOT NULL,
      acknowledged_at TEXT,
      acknowledged_by TEXT,
      feishu_status TEXT,
      feishu_sent_at TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(fulfillment_id, state, state_revision)
    );

    CREATE TABLE IF NOT EXISTS customer_compensation_resolutions (
      id TEXT PRIMARY KEY,
      fulfillment_id TEXT NOT NULL,
      revision INTEGER NOT NULL,
      resolution_type TEXT NOT NULL,
      evidence_reference TEXT NOT NULL,
      created_at TEXT NOT NULL,
      created_by TEXT NOT NULL,
      UNIQUE(fulfillment_id, revision)
    );

    CREATE TABLE IF NOT EXISTS membership_outbox (
      id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      fulfillment_id TEXT,
      state_revision INTEGER,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL,
      dispatched_at TEXT
    );

    CREATE TABLE IF NOT EXISTS spacexcard_webhook_events (
      auth_id TEXT NOT NULL,
      type TEXT NOT NULL,
      status TEXT NOT NULL,
      upstream_card_id INTEGER NOT NULL,
      vm_card_id TEXT NOT NULL,
      managed_card_id TEXT,
      settle_amount REAL NOT NULL DEFAULT 0,
      received_at TEXT NOT NULL,
      PRIMARY KEY(auth_id, type, status)
    );

  `);

  ensureColumn(db, "products", "membership_tier", "TEXT");
  ensureColumn(db, "membership_fulfillment_settings", "last_inventory_error", "TEXT");
  ensureColumn(db, "membership_fulfillment_settings", "rollout_mode", "TEXT NOT NULL DEFAULT 'disabled'");
  ensureColumn(db, "membership_payment_stages", "attempt_no", "INTEGER");
  ensureColumn(db, "membership_payment_stages", "adapter_version", "TEXT");
  ensureColumn(db, "membership_payment_stages", "adapter_path", "TEXT");
  ensureColumn(db, "membership_payment_stages", "price_contract_id", "TEXT");
  ensureColumn(db, "membership_payment_stages", "page_fingerprint", "TEXT");
  ensureColumn(db, "membership_payment_stages", "page_permit_kind", "TEXT");
  ensureColumn(db, "membership_payment_stages", "page_control_id", "TEXT");
  ensureColumn(db, "membership_payment_stages", "page_ready_at", "TEXT");
  ensureColumn(db, "membership_payment_stages", "page_facts_json", "TEXT");
  ensureColumn(db, "membership_payment_stages", "progression_permitted_at", "TEXT");
  ensureColumn(db, "membership_payment_stages", "progression_reported_at", "TEXT");
  ensureColumn(db, "membership_material_grants", "invalidated_at", "TEXT");
  ensureColumn(db, "membership_action_permits", "authorization_mode", "TEXT");
  ensureColumn(db, "membership_action_permits", "authorization_id", "TEXT");
  ensureColumn(db, "live_canary_authorizations", "expires_at", "TEXT");
  ensureColumn(db, "automatic_checkout_scopes", "updated_at", "TEXT");
  ensureColumn(db, "automatic_checkout_scopes", "disabled_at", "TEXT");
  ensureColumn(db, "managed_cards", "reconciliation_reason", "TEXT");
  ensureColumn(db, "managed_cards", "consumed_slots", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "card_inventory_runs", "mode", "TEXT NOT NULL DEFAULT 'full'");
  ensureColumn(db, "card_inventory_runs", "discovered_cards", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "card_inventory_runs", "locked_at", "TEXT");
  ensureColumn(db, "card_inventory_runs", "locked_by", "TEXT");
  ensureColumn(db, "card_inventory_run_items", "attempt_count", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "card_inventory_run_items", "next_retry_at", "TEXT");
  ensureColumn(db, "cdkey_batches", "site_id", "TEXT");
  ensureColumn(db, "cdkeys", "site_id", "TEXT");
  ensureColumn(db, "cdkeys", "processing_mode", "TEXT NOT NULL DEFAULT 'auto'");
  ensureColumn(db, "cdkeys", "manual_type", "TEXT");
  ensureColumn(db, "cdkeys", "origin", "TEXT NOT NULL DEFAULT 'admin_create'");
  ensureColumn(db, "cdkeys", "store_order_no", "TEXT");
  ensureColumn(db, "cdkeys", "store_fulfillment_target_no", "TEXT");
  ensureColumn(db, "cdkeys", "store_fulfillment_task_id", "TEXT");
  ensureColumn(db, "store_product_mappings", "fulfillment_kind", "TEXT NOT NULL DEFAULT 'manual'");
  ensureColumn(db, "store_product_mappings", "spacex_plan", "TEXT");
  ensureColumn(db, "spacex_cdk_settings", "unlimited_funding_policy", "TEXT NOT NULL DEFAULT 'block'");
  ensureColumn(db, "spacex_cdks", "funding_liability_minor", "INTEGER");
  ensureColumn(db, "spacex_cdks", "funding_contract_mode", "TEXT NOT NULL DEFAULT 'missing'");
  ensureColumn(db, "spacex_cdks", "funding_snapshot", "TEXT");
  db.prepare(`
    UPDATE spacex_cdks
    SET funding_contract_mode = 'bounded'
    WHERE funding_contract_mode = 'missing'
      AND funding_cap_minor IS NOT NULL
      AND funding_cap_minor > 0
      AND funding_currency IS NOT NULL
  `).run();
  db.prepare(`
    UPDATE spacex_cdks
    SET funding_liability_minor = funding_cap_minor
    WHERE funding_liability_minor IS NULL
      AND funding_contract_mode = 'bounded'
      AND funding_cap_minor IS NOT NULL
      AND funding_cap_minor > 0
      AND funding_currency IS NOT NULL
  `).run();
  ensureColumn(db, "redeem_orders", "site_id", "TEXT");
  ensureColumn(db, "redeem_orders", "abandon_remaining_time", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "redeem_orders", "extension_delivery_status", "TEXT");
  ensureColumn(db, "redeem_orders", "extension_delivery_attempts", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "redeem_orders", "extension_delivery_error", "TEXT");
  ensureColumn(db, "redeem_orders", "extension_delivered_at", "TEXT");
  ensureColumn(db, "redeem_orders", "extension_delivery_expires_at", "TEXT");
  ensureColumn(db, "redeem_orders", "extension_delivery_retry_revision", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "redeem_orders", "extension_delivery_updated_at", "TEXT");
  ensureColumn(db, "redeem_orders", "extension_subscription_checked_attempt", "INTEGER");
  ensureColumn(db, "redeem_orders", "extension_subscription_checked_at", "TEXT");
  ensureColumn(db, "redeem_orders", "extension_subscription_delinquent", "INTEGER");
  ensureColumn(db, "redeem_orders", "extension_subscription_will_renew", "INTEGER");
  ensureColumn(db, "redeem_orders", "extension_subscription_cancelled_at", "TEXT");
  ensureColumn(db, "activation_jobs", "site_id", "TEXT");
  ensureColumn(db, "activation_endpoints", "abandon_submit_body_template", "TEXT");
  ensureColumn(db, "sites", "abandon_submit_body_template", "TEXT");
  ensureColumn(db, "sites", "last_health_check", "TEXT");
  ensureColumn(db, "sites", "last_health_result", "TEXT");
  ensureColumn(db, "sites", "query_api_url", "TEXT");
  ensureColumn(db, "sites", "query_success_rule", "TEXT");
  ensureColumn(db, "sites", "polling_enabled", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "sites", "request_cookies", "TEXT");
  ensureColumn(db, "sites", "task_id_path", "TEXT");
  ensureColumn(db, "sites", "query_failure_rule", "TEXT");
  ensureColumn(db, "sites", "query_http_method", "TEXT");
  ensureColumn(db, "sites", "query_headers_template", "TEXT");
  ensureColumn(db, "sites", "query_body_template", "TEXT");
  ensureColumn(db, "sites", "poll_interval_ms", "INTEGER NOT NULL DEFAULT 5000");
  ensureColumn(db, "sites", "poll_max_rounds", "INTEGER NOT NULL DEFAULT 6");
  ensureColumn(db, "sites", "sms_provider", "TEXT");
  ensureColumn(db, "sites", "sms_api_key", "TEXT");
  ensureColumn(db, "sites", "sms_country", "TEXT");
  ensureColumn(db, "sites", "sms_service", "TEXT");
  ensureColumn(db, "sites", "sms_operator", "TEXT");
  ensureColumn(db, "sites", "sms_app_id", "TEXT");
  ensureColumn(db, "sites", "sms_card_type", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn(db, "sites", "sms_expiry", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "sites", "sms_prefix_filter", "TEXT");
  ensureColumn(db, "sites", "sms_exclude_prefix", "TEXT");
  ensureColumn(db, "sites", "sms_poll_interval_ms", "INTEGER NOT NULL DEFAULT 10000");
  ensureColumn(db, "sites", "sms_poll_timeout_ms", "INTEGER NOT NULL DEFAULT 60000");
  ensureColumn(db, "sites", "sms_submit_phone_template", "TEXT");
  ensureColumn(db, "sites", "sms_submit_code_template", "TEXT");
  ensureColumn(db, "sms_sites", "sms_provider", "TEXT");
  ensureColumn(db, "sms_sites", "sms_api_key", "TEXT");
  ensureColumn(db, "sms_sites", "sms_app_id", "TEXT");
  ensureColumn(db, "sms_sites", "sms_card_type", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn(db, "sms_sites", "sms_expiry", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "sms_sites", "sms_prefix_filter", "TEXT");
  ensureColumn(db, "sms_sites", "sms_exclude_prefix", "TEXT");
  ensureColumn(db, "sms_sites", "sms_poll_timeout_ms", "INTEGER NOT NULL DEFAULT 60000");
  ensureColumn(db, "notification_monitors", "monitor_type", "TEXT NOT NULL DEFAULT 'http'");
  ensureColumn(db, "notification_monitors", "browser_page_url", "TEXT");
  ensureColumn(db, "notification_monitors", "browser_ready_selector", "TEXT");
  ensureColumn(db, "notification_monitors", "browser_wait_ms", "INTEGER NOT NULL DEFAULT 10000");
  ensureColumn(db, "sub2api_subscription_plans", "source_dedicated_group_id", "INTEGER");
  ensureColumn(db, "sub2api_subscription_orders", "source_dedicated_group_id", "INTEGER");
  ensureColumn(db, "sub2api_worldcup_matches", "source", "TEXT NOT NULL DEFAULT 'manual'");
  ensureColumn(db, "sub2api_worldcup_matches", "api_fixture_id", "TEXT");
  ensureColumn(db, "sub2api_worldcup_matches", "api_league_id", "INTEGER");
  ensureColumn(db, "sub2api_worldcup_matches", "api_season", "INTEGER");
  ensureColumn(db, "sub2api_worldcup_matches", "api_status_short", "TEXT");
  ensureColumn(db, "sub2api_worldcup_matches", "api_status_long", "TEXT");
  ensureColumn(db, "sub2api_worldcup_matches", "api_elapsed", "INTEGER");
  ensureColumn(db, "sub2api_worldcup_matches", "api_last_synced_at", "TEXT");
  ensureColumn(db, "sub2api_worldcup_matches", "odds_last_synced_at", "TEXT");
  ensureColumn(db, "sub2api_worldcup_matches", "halftime_betting_opened_at", "TEXT");
  ensureColumn(db, "sub2api_worldcup_matches", "display_date", "TEXT");
  ensureColumn(db, "sub2api_worldcup_matches", "first_half_added_minutes", "INTEGER");
  ensureColumn(db, "sub2api_worldcup_matches", "second_half_added_minutes", "INTEGER");
  ensureColumn(db, "sub2api_worldcup_matches", "halftime_open_at", "TEXT");
  ensureColumn(db, "sub2api_worldcup_matches", "halftime_close_at", "TEXT");
  ensureColumn(db, "sub2api_worldcup_matches", "finish_check_at", "TEXT");
  ensureColumn(db, "sub2api_worldcup_matches", "halftime_schedule_checked_at", "TEXT");
  ensureColumn(db, "sub2api_worldcup_matches", "finish_schedule_checked_at", "TEXT");
  ensureColumn(db, "sub2api_worldcup_matches", "final_result_checked_at", "TEXT");
  ensureColumn(db, "sub2api_worldcup_matches", "auto_settle_attempted_at", "TEXT");
  ensureColumn(db, "sub2api_worldcup_bets", "phase", "TEXT NOT NULL DEFAULT 'pre_match'");
  ensureColumn(db, "api_football_settings", "enabled", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "api_football_settings", "provider", "TEXT NOT NULL DEFAULT 'zafronix'");
  ensureColumn(db, "api_football_settings", "api_key", "TEXT");
  ensureColumn(db, "api_football_settings", "base_url", "TEXT NOT NULL DEFAULT 'https://api.zafronix.com/fifa/worldcup/v1'");
  ensureColumn(db, "api_football_settings", "worldcup_league_id", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn(db, "api_football_settings", "worldcup_season", "INTEGER NOT NULL DEFAULT 2026");
  ensureColumn(db, "api_football_settings", "timezone", "TEXT NOT NULL DEFAULT 'Asia/Shanghai'");
  ensureColumn(db, "api_football_settings", "daily_soft_limit", "INTEGER NOT NULL DEFAULT 80");
  ensureColumn(db, "api_football_settings", "daily_hard_limit", "INTEGER NOT NULL DEFAULT 100");
  ensureColumn(db, "api_football_settings", "sync_interval_ms", "INTEGER NOT NULL DEFAULT 60000");
  ensureColumn(db, "api_football_settings", "updated_at", "TEXT");
  ensureColumn(db, "api_football_settings", "updated_by", "TEXT");
  ensureColumn(db, "sub2api_invites", "used_by_user_id", "TEXT");
  ensureColumn(db, "sub2api_invites", "used_by_email", "TEXT");
  ensureColumn(db, "sub2api_invites", "used_by_username", "TEXT");
  ensureColumn(db, "sub2api_invites", "used_at", "TEXT");
  ensureColumn(db, "sub2api_invites", "abnormal_reason", "TEXT");

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_cdkeys_status ON cdkeys(status, updated_at);
    CREATE INDEX IF NOT EXISTS idx_cdkeys_site ON cdkeys(site_id, status, updated_at);
    CREATE INDEX IF NOT EXISTS idx_cdkeys_origin_order ON cdkeys(origin, store_order_no, updated_at);
    CREATE INDEX IF NOT EXISTS idx_orders_status ON redeem_orders(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_orders_site ON redeem_orders(site_id, status, created_at);
    CREATE INDEX IF NOT EXISTS idx_orders_extension_delivery
      ON redeem_orders(extension_delivery_status, extension_delivery_expires_at, created_at);
    CREATE INDEX IF NOT EXISTS idx_jobs_status ON activation_jobs(status, next_retry_at);
    CREATE INDEX IF NOT EXISTS idx_jobs_site ON activation_jobs(site_id, status, next_retry_at);
    CREATE INDEX IF NOT EXISTS idx_logs_action ON admin_audit_logs(action, created_at);
    CREATE INDEX IF NOT EXISTS idx_sites_status ON sites(status, updated_at);
    CREATE INDEX IF NOT EXISTS idx_sub_requests_card_status ON subscription_requests(card_type_id, status, reviewed_at);
    CREATE INDEX IF NOT EXISTS idx_sub_requests_status ON subscription_requests(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_notify_monitors_due ON notification_monitors(enabled, next_run_at);
    CREATE INDEX IF NOT EXISTS idx_notify_events_monitor ON notification_events(monitor_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_notify_events_created ON notification_events(created_at);
    CREATE INDEX IF NOT EXISTS idx_sms_entries_status ON sms_entries(status, updated_at);
    CREATE INDEX IF NOT EXISTS idx_sms_entries_batch ON sms_entries(batch_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_sms_entries_public_key ON sms_entries(public_key);
    CREATE INDEX IF NOT EXISTS idx_sms_sites_status ON sms_sites(status, updated_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_sms_cards_key ON sms_cards(card_key);
    CREATE INDEX IF NOT EXISTS idx_sms_cards_site_status ON sms_cards(site_id, status, updated_at);
    CREATE INDEX IF NOT EXISTS idx_sms_orders_card_status ON sms_orders(card_id, status, updated_at);
    CREATE INDEX IF NOT EXISTS idx_sms_orders_site_status ON sms_orders(site_id, status, updated_at);
    CREATE INDEX IF NOT EXISTS idx_sms_order_events_order ON sms_order_events(order_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_quota_source_cards_status ON quota_source_cards(status);
    CREATE INDEX IF NOT EXISTS idx_quota_source_cards_batch ON quota_source_cards(import_batch_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_quota_sub_cards_code ON quota_sub_cards(card_code);
    CREATE INDEX IF NOT EXISTS idx_quota_sub_cards_status ON quota_sub_cards(status);
    CREATE INDEX IF NOT EXISTS idx_quota_claim_logs_card ON quota_claim_logs(sub_card_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_quota_rate_limits_card ON quota_rate_limits(sub_card_id, window_start);
    CREATE INDEX IF NOT EXISTS idx_sub2api_connections_status ON sub2api_connections(status, updated_at);
    CREATE INDEX IF NOT EXISTS idx_sub2api_invites_account ON sub2api_invites(connection_id, sub2api_user_id, status, created_at);
    CREATE INDEX IF NOT EXISTS idx_sub2api_invites_connection ON sub2api_invites(connection_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_sub2api_invites_status ON sub2api_invites(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_sub2api_inviter_levels_status ON sub2api_inviter_levels(status, spend_threshold);
    CREATE INDEX IF NOT EXISTS idx_sub2api_known_users_connection ON sub2api_known_users(connection_id, sub2api_user_id);
    CREATE INDEX IF NOT EXISTS idx_sub2api_invite_rebates_status ON sub2api_invite_rebates(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_sub2api_invite_rebates_inviter ON sub2api_invite_rebates(connection_id, inviter_user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_sub2api_subscription_plans_connection ON sub2api_subscription_plans(connection_id, status, sort_order);
    CREATE INDEX IF NOT EXISTS idx_sub2api_subscription_orders_account ON sub2api_subscription_orders(connection_id, sub2api_user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_sub2api_subscription_orders_plan ON sub2api_subscription_orders(plan_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_sub2api_subscription_orders_status ON sub2api_subscription_orders(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_sub2api_wc_matches_connection ON sub2api_worldcup_matches(connection_id, status, kickoff_at);
    CREATE INDEX IF NOT EXISTS idx_sub2api_wc_matches_status ON sub2api_worldcup_matches(status, kickoff_at);
    DROP INDEX IF EXISTS idx_sub2api_wc_matches_api_fixture;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_sub2api_wc_matches_api_fixture
      ON sub2api_worldcup_matches(connection_id, api_fixture_id)
      WHERE api_fixture_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_sub2api_wc_matches_api_status ON sub2api_worldcup_matches(source, api_status_short, kickoff_at);
    CREATE INDEX IF NOT EXISTS idx_sub2api_wc_bets_match ON sub2api_worldcup_bets(match_id, status, created_at);
    CREATE INDEX IF NOT EXISTS idx_sub2api_wc_bets_account ON sub2api_worldcup_bets(connection_id, sub2api_user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_sub2api_wc_bets_status ON sub2api_worldcup_bets(status, created_at);
    DROP INDEX IF EXISTS idx_sub2api_wc_bets_one_active;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_sub2api_wc_bets_one_active
      ON sub2api_worldcup_bets(connection_id, match_id, sub2api_user_id, phase)
      WHERE status NOT IN ('debit_failed', 'refunded');
    CREATE INDEX IF NOT EXISTS idx_api_football_logs_usage_date ON api_football_request_logs(usage_date, created_at);
    CREATE INDEX IF NOT EXISTS idx_store_product_mappings_lookup ON store_product_mappings(product_id, sku_id, enabled);
    CREATE INDEX IF NOT EXISTS idx_store_fulfillment_tasks_status ON store_fulfillment_tasks(status, next_retry_at, created_at);
    CREATE INDEX IF NOT EXISTS idx_store_fulfillment_tasks_parent ON store_fulfillment_tasks(parent_order_no, remote_order_no);
    CREATE INDEX IF NOT EXISTS idx_spacex_cdks_inventory ON spacex_cdks(plan, state, created_at);
    CREATE INDEX IF NOT EXISTS idx_spacex_cdks_wrapper ON spacex_cdks(current_wrapper_cdkey_id);
    CREATE INDEX IF NOT EXISTS idx_spacex_cdk_units_task ON spacex_cdk_units(task_id, state, unit_index);
    CREATE INDEX IF NOT EXISTS idx_spacex_cdk_activations_due ON spacex_cdk_activations(state, next_reconcile_at, created_at);
    CREATE INDEX IF NOT EXISTS idx_spacex_cdk_activations_upstream ON spacex_cdk_activations(upstream_order_id);
    CREATE INDEX IF NOT EXISTS idx_membership_fulfillments_due ON membership_fulfillments(state, retry_at, created_at);
    CREATE INDEX IF NOT EXISTS idx_membership_fulfillments_order ON membership_fulfillments(order_no);
    DROP INDEX IF EXISTS idx_membership_active_account_lock;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_membership_active_account_lock
      ON membership_fulfillments(account_lock_key)
      WHERE account_lock_key IS NOT NULL
        AND state <> 'ACCOUNT_FULFILLMENT_WAIT'
        AND state NOT IN ('ACCOUNT_ALREADY_SUBSCRIBED', 'PAYMENT_DECLINED', 'PARTIAL_FULFILLMENT_EXPIRED', 'CANCELLED', 'COMPLETED');
    CREATE INDEX IF NOT EXISTS idx_membership_attempts_fulfillment ON membership_fulfillment_attempts(fulfillment_id, stage, attempt_no);
    CREATE INDEX IF NOT EXISTS idx_membership_observations_fulfillment ON membership_observations(fulfillment_id, observed_at);
    CREATE INDEX IF NOT EXISTS idx_managed_cards_selection ON managed_cards(lane, capacity_state, reconciliation_state, upstream_status);
    CREATE INDEX IF NOT EXISTS idx_managed_transactions_auth ON managed_card_transactions(auth_id, last_seen_at);
    CREATE INDEX IF NOT EXISTS idx_inventory_runs_status ON card_inventory_runs(status, updated_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_one_active
      ON card_inventory_runs((1))
      WHERE status IN ('discovering', 'reconciling');
    CREATE UNIQUE INDEX IF NOT EXISTS idx_card_capacity_active_slot
      ON card_capacity_reservations(card_id, target_lane, slot_index)
      WHERE card_id IS NOT NULL AND state IN ('reserved', 'consumed', 'retained_partial');
    CREATE INDEX IF NOT EXISTS idx_material_grants_expiry ON membership_material_grants(expires_at, claimed_at);
    CREATE INDEX IF NOT EXISTS idx_membership_action_permits_lookup
      ON membership_action_permits(fulfillment_id, stage_key, attempt_no, action_type, state);
    CREATE INDEX IF NOT EXISTS idx_membership_action_permits_expiry
      ON membership_action_permits(state, expires_at);
    CREATE INDEX IF NOT EXISTS idx_membership_no_payment_checks
      ON membership_no_payment_checks(fulfillment_id, stage_key, checkpoint);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_automatic_quota_reservation_scope_order
      ON automatic_checkout_quota_reservations(scope_id, fulfillment_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_checkout_price_contract_active
      ON checkout_price_contracts(tier)
      WHERE status = 'active';
    CREATE UNIQUE INDEX IF NOT EXISTS idx_canary_active_stage
      ON live_canary_authorizations(fulfillment_id, stage_key)
      WHERE state = 'approved';
    CREATE UNIQUE INDEX IF NOT EXISTS idx_automatic_checkout_scope_active
      ON automatic_checkout_scopes(site_id, product_id, tier)
      WHERE status = 'active';
    CREATE INDEX IF NOT EXISTS idx_fulfillment_interventions_open ON fulfillment_interventions(acknowledged_at, created_at);
    CREATE INDEX IF NOT EXISTS idx_membership_outbox_pending ON membership_outbox(dispatched_at, created_at);
    CREATE INDEX IF NOT EXISTS idx_spacexcard_webhook_card ON spacexcard_webhook_events(upstream_card_id, received_at);
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
      submitBodyTemplate: '{"cdkey":"{{sourceKey}}","session_info":{{sessionString}}}',
      abandonSubmitBodyTemplate: '{"cdkey":"{{sourceKey}}","session_info":{{sessionString}},"force":1}',
      authType: null,
      authConfig: null,
      verifySuccessRule: '{"kind":"json_path_equals","path":"data.use_status","value":"0"}',
      verifyFailureRule: '{"kind":"json_path_equals","path":"success","value":"false"}',
      submitSuccessRule: '{"kind":"json_path_equals","path":"success","value":"true"}',
      submitFailureRule: '{"kind":"json_path_equals","path":"success","value":"false"}',
      timeoutSeconds: 60,
      maxRetries: 3,
      productId: "prod_demo",
      activationEndpointId: null,
      status: "active",
      createdAt: now,
      updatedAt: now
    },
    {
      id: "site_preset_plus91",
      name: "plus91",
      slug: "plus91",
      verifyApiUrl: "https://gpt.86gamestore.com/api/manual/check",
      submitApiUrl: "https://gpt.86gamestore.com/api/manual/submit",
      verifyHttpMethod: "POST",
      submitHttpMethod: "POST",
      verifyHeadersTemplate: "{}",
      verifyBodyTemplate: '{"cdkey":"{{sourceKey}}"}',
      submitHeadersTemplate: "{}",
      submitBodyTemplate: '{"cdkey":"{{sourceKey}}","session_info":{{sessionString}}}',
      abandonSubmitBodyTemplate: '{"cdkey":"{{sourceKey}}","session_info":{{sessionString}},"force":1}',
      authType: null,
      authConfig: null,
      verifySuccessRule: '{"kind":"json_path_equals","path":"data.available","value":"true"}',
      verifyFailureRule: '{"kind":"json_path_equals","path":"data.available","value":"false"}',
      submitSuccessRule: '{"kind":"json_path_equals","path":"success","value":"true"}',
      submitFailureRule: '{"kind":"json_path_equals","path":"success","value":"false"}',
      timeoutSeconds: 60,
      maxRetries: 3,
      productId: "prod_demo",
      activationEndpointId: null,
      status: "active",
      createdAt: now,
      updatedAt: now
    },
    {
      id: "site_preset_666",
      name: "666站",
      slug: "666",
      verifyApiUrl: null,
      submitApiUrl: "https://6661231.xyz/external/redeem/appstore/start",
      verifyHttpMethod: "POST",
      submitHttpMethod: "POST",
      verifyHeadersTemplate: "{}",
      verifyBodyTemplate: "{}",
      submitHeadersTemplate: "{}",
      // 666 站现网契约：cdk + session_json (字符串) + sku，sku 固定为 chatgpt_plus_tr_499
      submitBodyTemplate: '{"cdk":"{{sourceKey}}","session_json":{{sessionString}},"sku":"chatgpt_plus_tr_499"}',
      abandonSubmitBodyTemplate: '{"cdk":"{{sourceKey}}","session_json":{{sessionString}},"sku":"chatgpt_plus_tr_499"}',
      authType: null,
      authConfig: null,
      verifySuccessRule: null,
      verifyFailureRule: null,
      submitSuccessRule: null,
      submitFailureRule: null,
      queryApiUrl: "https://6661231.xyz/external/redeem/appstore/status?id={{taskId}}",
      querySuccessRule: '{"kind":"json_path_equals","path":"data.status","value":"success"}',
      queryFailureRule: '{"kind":"json_path_equals","path":"data.status","value":"failed"}',
      pollingEnabled: 1,
      taskIdPath: "data.taskId",
      pollIntervalMs: 5000,
      pollMaxRounds: 12,
      timeoutSeconds: 60,
      maxRetries: 20,
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
    },
    {
      id: "site_preset_meimei_site",
      name: "老妹plus",
      slug: "meimei_site",
      verifyApiUrl: "https://ai.dengta-learning.online/api/cdk/validate",
      submitApiUrl: "https://ai.dengta-learning.online/api/cdk/redeem",
      verifyHttpMethod: "POST",
      submitHttpMethod: "POST",
      verifyHeadersTemplate: "{}",
      verifyBodyTemplate: '{"code":"{{sourceKey}}"}',
      submitHeadersTemplate: "{}",
      submitBodyTemplate: '{"code":"{{sourceKey}}","session_json":{{sessionString}}}',
      abandonSubmitBodyTemplate: '{"code":"{{sourceKey}}","session_json":{{sessionString}}}',
      authType: null,
      authConfig: null,
      verifySuccessRule: '{"kind":"json_path_equals","path":"valid","value":"true"}',
      verifyFailureRule: '{"kind":"json_path_equals","path":"valid","value":"false"}',
      submitSuccessRule: null,
      submitFailureRule: null,
      queryApiUrl: "https://ai.dengta-learning.online/api/cdk/status/{{taskId}}",
      querySuccessRule: '{"kind":"json_path_equals","path":"status","value":"completed"}',
      queryFailureRule: '{"kind":"json_path_equals","path":"status","value":"failed"}',
      pollingEnabled: 1,
      taskIdPath: "task_id",
      pollIntervalMs: 3000,
      pollMaxRounds: 20,
      timeoutSeconds: 15,
      maxRetries: 20,
      productId: "prod_demo",
      activationEndpointId: null,
      status: "disabled",
      createdAt: now,
      updatedAt: now
    },
    {
      id: "site_preset_987ai",
      name: "987AI",
      slug: "987ai",
      verifyApiUrl: "https://api.987ai.vip/api/card-keys/{{normalizedSourceKey}}",
      submitApiUrl: "https://api.987ai.vip/api/tasks",
      verifyHttpMethod: "GET",
      submitHttpMethod: "POST",
      verifyHeadersTemplate: "{}",
      verifyBodyTemplate: "{}",
      submitHeadersTemplate: "{}",
      submitBodyTemplate: '{"card_key":"{{normalizedSourceKey}}","access_token":"{{session.accessToken}}","idp":"","force_recharge":false}',
      abandonSubmitBodyTemplate: '{"card_key":"{{normalizedSourceKey}}","access_token":"{{session.accessToken}}","idp":"","force_recharge":true}',
      authType: null,
      authConfig: null,
      verifySuccessRule: '{"kind":"json_path_equals","path":"available","value":"true"}',
      verifyFailureRule: '{"kind":"json_path_equals","path":"available","value":"false"}',
      submitSuccessRule: '{"kind":"json_path_equals","path":"success","value":"true"}',
      submitFailureRule: '{"kind":"json_path_equals","path":"success","value":"false"}',
      queryApiUrl: "https://api.987ai.vip/api/tasks/{{taskId}}",
      querySuccessRule: '{"kind":"json_path_equals","path":"status","value":"completed"}',
      queryFailureRule: '{"kind":"json_path_equals","path":"status","value":"failed"}',
      pollingEnabled: 1,
      taskIdPath: "task_id",
      pollIntervalMs: 5000,
      pollMaxRounds: 6,
      timeoutSeconds: 15,
      maxRetries: 20,
      productId: "prod_demo",
      activationEndpointId: null,
      status: "disabled",
      createdAt: now,
      updatedAt: now
    },
    {
      id: "site_preset_ow800",
      name: "三总",
      slug: "ow800",
      verifyApiUrl: "https://kkk.ow800.com/api/cards/verify",
      submitApiUrl: "https://kkk.ow800.com/api/cards/verify-gpt",
      verifyHttpMethod: "POST",
      submitHttpMethod: "POST",
      verifyHeadersTemplate: "{}",
      verifyBodyTemplate: '{"cardInfo":"{{sourceKey}}"}',
      submitHeadersTemplate: "{}",
      submitBodyTemplate: '{"cardInfo":"{{sourceKey}}","userEmail":"{{session.user.email}}","userGptToken":"{{session.accessToken}}","fullAuthData":{{sessionString}},"productId":3}',
      abandonSubmitBodyTemplate: '{"cardInfo":"{{sourceKey}}","userEmail":"{{session.user.email}}","userGptToken":"{{session.accessToken}}","fullAuthData":{{sessionString}},"productId":9}',
      authType: null,
      authConfig: null,
      verifySuccessRule: '{"kind":"json_path_equals","path":"success","value":"true"}',
      verifyFailureRule: '{"kind":"json_path_equals","path":"success","value":"false"}',
      submitSuccessRule: '{"kind":"json_path_equals","path":"success","value":"true"}',
      submitFailureRule: '{"kind":"json_path_equals","path":"success","value":"false"}',
      queryApiUrl: "https://kkk.ow800.com/api/recharge/query-task-status",
      queryHttpMethod: "POST",
      queryBodyTemplate: '{"taskId":"{{taskId}}","productId":3,"cardInfo":"{{sourceKey}}"}',
      querySuccessRule: '{"kind":"json_path_equals","path":"data.status","value":"success"}',
      queryFailureRule: '{"kind":"json_path_equals","path":"data.status","value":"failed"}',
      pollingEnabled: 1,
      taskIdPath: "data.taskId",
      pollIntervalMs: 5000,
      pollMaxRounds: 6,
      timeoutSeconds: 15,
      maxRetries: 20,
      productId: "prod_demo",
      activationEndpointId: null,
      status: "disabled",
      createdAt: now,
      updatedAt: now
    },
    {
      id: "site_preset_9977",
      name: "9977",
      slug: "9977",
      verifyApiUrl: "https://9977ai.vip/",
      submitApiUrl: "https://9977ai.vip/",
      verifyHttpMethod: "POST",
      submitHttpMethod: "POST",
      verifyHeadersTemplate: '{"Content-Type":"application/x-www-form-urlencoded"}',
      verifyBodyTemplate: '{"ajax":"1","action":"verify_code","activation_code":"{{sourceKey}}"}',
      submitHeadersTemplate: '{"Content-Type":"application/x-www-form-urlencoded"}',
      submitBodyTemplate: '{"ajax":"1","action":"submit_json","json_token":{{sessionString}}}',
      abandonSubmitBodyTemplate: '{"ajax":"1","action":"submit_json","json_token":{{sessionString}}}',
      authType: null,
      authConfig: null,
      verifySuccessRule: '{"kind":"json_path_equals","path":"is_new","value":"true"}',
      verifyFailureRule: '{"is_new":false}',
      submitSuccessRule: '{"kind":"json_path_equals","path":"success","value":"true"}',
      submitFailureRule: '{"kind":"json_path_equals","path":"success","value":"false"}',
      timeoutSeconds: 15,
      maxRetries: 3,
      productId: "prod_demo",
      activationEndpointId: null,
      status: "active",
      createdAt: now,
      updatedAt: now
    }
  ];

  for (const presetSite of presetSites) {
    upsertSite(db, presetSite, { preserveExistingStatus: true });
  }

  const hasInviterLevel = db.prepare("SELECT COUNT(*) AS count FROM sub2api_inviter_levels").get();
  if (hasInviterLevel.count === 0) {
    db.prepare(`
      INSERT INTO sub2api_inviter_levels (
        id, name, spend_threshold, lifetime_invite_limit, unused_invite_limit,
        rebate_rate, sort_order, status, created_at, updated_at
      )
      VALUES (?, ?, 0, 3, 3, 0, 0, 'active', ?, ?)
    `).run("sub2api_inviter_level_default", "默认", now, now);
  }

  db.prepare(`
    UPDATE sites
    SET
      verify_api_url = 'https://api.987ai.vip/api/card-keys/{{normalizedSourceKey}}',
      verify_http_method = 'GET',
      verify_body_template = '{}',
      submit_api_url = 'https://api.987ai.vip/api/tasks',
      submit_http_method = 'POST',
      submit_body_template = '{"card_key":"{{normalizedSourceKey}}","access_token":"{{session.accessToken}}","idp":"","force_recharge":false}',
      abandon_submit_body_template = '{"card_key":"{{normalizedSourceKey}}","access_token":"{{session.accessToken}}","idp":"","force_recharge":true}',
      query_api_url = 'https://api.987ai.vip/api/tasks/{{taskId}}',
      task_id_path = 'task_id',
      updated_at = ?
    WHERE slug = '987ai'
  `).run(now);

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

  const hasNotificationSettings = db.prepare("SELECT COUNT(*) AS count FROM notification_settings").get();
  if (hasNotificationSettings.count === 0) {
    db.prepare(`
      INSERT INTO notification_settings (id, global_feishu_webhook, updated_at, updated_by)
      VALUES ('default', NULL, ?, 'system')
    `).run(new Date().toISOString());
  }

  db.prepare(`
    INSERT OR IGNORE INTO quota_settings (id, low_stock_threshold, updated_at)
    VALUES ('default', 5, ?)
  `).run(new Date().toISOString());

  db.prepare(`
    INSERT OR IGNORE INTO api_football_settings (
      id, provider, enabled, api_key, base_url, worldcup_league_id, worldcup_season,
      timezone, daily_soft_limit, daily_hard_limit, sync_interval_ms, updated_at, updated_by
    )
    VALUES ('default', 'zafronix', 0, NULL, 'https://api.zafronix.com/fifa/worldcup/v1', 1, 2026,
            'Asia/Shanghai', 80, 100, 60000, ?, 'system')
  `).run(new Date().toISOString());

  db.prepare(`
    INSERT OR IGNORE INTO store_fulfillment_settings (
      id, enabled, poll_interval_seconds, updated_at, updated_by
    )
    VALUES ('default', 0, 30, ?, 'system')
  `).run(new Date().toISOString());

  db.prepare(`
    INSERT OR IGNORE INTO spacex_cdk_settings (
      id, enabled, rollout_plan, base_url, updated_at, updated_by
    )
    VALUES ('default', 0, 'disabled', 'https://spacexcard.com', ?, 'system')
  `).run(new Date().toISOString());

  db.prepare(`
    INSERT OR IGNORE INTO extension_delivery_settings (
      id, enabled, allowed_site_slugs, resume_revision, updated_at, updated_by
    )
    VALUES ('default', 0, '[]', 0, ?, 'system')
  `).run(new Date().toISOString());

  db.prepare(`
    INSERT OR IGNORE INTO membership_fulfillment_settings (
      id, enabled, inventory_status, business_timezone, resume_revision, updated_at, updated_by
    )
    VALUES ('default', 0, 'not_started', 'Asia/Shanghai', 0, ?, 'system')
  `).run(new Date().toISOString());

  db.prepare(`
    INSERT OR IGNORE INTO membership_processor_lease (
      id, owner, holder_token, epoch, status, updated_at
    ) VALUES ('default', NULL, NULL, 0, 'stopped', ?)
  `).run(new Date().toISOString());

  db.prepare(`
    INSERT OR IGNORE INTO membership_intake_settings (
      id, accept_orders_created_at, created_at, created_by
    ) VALUES ('default', ?, ?, 'system')
  `).run(new Date().toISOString(), new Date().toISOString());

  db.prepare(`
    INSERT OR IGNORE INTO browser_fulfillment_lease (id, epoch, state, updated_at)
    VALUES ('default', 0, 'available', ?)
  `).run(new Date().toISOString());

  db.prepare(`
    UPDATE cdkeys
    SET origin = CASE
      WHEN batch_id IS NOT NULL AND batch_id <> '' THEN 'batch_import'
      ELSE 'admin_create'
    END
    WHERE store_fulfillment_task_id IS NULL
      AND (origin IS NULL OR origin = '' OR origin = 'admin_create')
  `).run();

  db.prepare(`
    UPDATE api_football_settings
    SET provider = 'zafronix',
        base_url = CASE
          WHEN base_url LIKE '%football.api-sports.io%' OR base_url LIKE '%football-data.org%' OR base_url IS NULL OR base_url = ''
          THEN 'https://api.zafronix.com/fifa/worldcup/v1'
          ELSE base_url
        END
    WHERE id = 'default'
  `).run();

  db.prepare(`
    INSERT OR IGNORE INTO sms_sites (id, name, slug, inventory_source, status, note, created_at, updated_at)
    VALUES ('sms_site_laoyou', '佬友站点', 'laoyou_site', 'nexsms', 'active', 'NexSMS Activate Pro 动态接码站点', ?, ?)
  `).run(new Date().toISOString(), new Date().toISOString());

  db.prepare(`
    UPDATE sms_sites
    SET sms_provider = COALESCE(sms_provider, 'nexsms')
    WHERE id = 'sms_site_laoyou'
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
