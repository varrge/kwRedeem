import { createHash } from "node:crypto";
import { nanoid } from "nanoid";
import { cdkeyStatuses, orderStatuses } from "./constants.js";
import { decryptText, encryptText } from "./secure.js";
import {
  SPACEX_CDK_ACTIVATION_STATES,
  SPACEX_CDK_ASSET_STATES,
  SPACEX_CDK_FAILED_STATUSES,
  SPACEX_CDK_PENDING_STATUSES,
  SPACEX_CDK_PLAN_MANUAL_TYPES,
  SPACEX_CDK_PLAN_PREFIXES,
  SPACEX_CDK_PLANS,
  SPACEX_CDK_UNIT_STATES,
  SpaceXCdkApiError,
  SpaceXCdkClient,
  normalizeActivationResult
} from "./spacex-cdk.js";
import { STORE_CDK_ORIGINS, STORE_FULFILLMENT_STATUSES } from "./store-fulfillment.js";

const ACTIVE_LIABILITY_STATES = [
  SPACEX_CDK_ASSET_STATES.inventory,
  SPACEX_CDK_ASSET_STATES.allocated,
  SPACEX_CDK_ASSET_STATES.claimed,
  SPACEX_CDK_ASSET_STATES.pending,
  SPACEX_CDK_ASSET_STATES.refundHold,
  SPACEX_CDK_ASSET_STATES.heldContract
];

const PLAN_RANK = Object.freeze({ disabled: 0, plus: 1, pro_5x: 2, pro_20x: 3 });
const TERMINAL_ACTIVATION_STATES = new Set([
  SPACEX_CDK_ACTIVATION_STATES.completed,
  SPACEX_CDK_ACTIVATION_STATES.failedResolution
]);
const MANUALLY_CLOSEABLE_TASK_STATES = new Set([
  STORE_FULFILLMENT_STATUSES.blocked,
  STORE_FULFILLMENT_STATUSES.retrying
]);
const MANUALLY_CLOSEABLE_UNIT_STATES = new Set([
  SPACEX_CDK_UNIT_STATES.contractBlocked,
  SPACEX_CDK_UNIT_STATES.fundingBlocked
]);

function nowIso() {
  return new Date().toISOString();
}

function addSeconds(value, seconds) {
  return new Date(new Date(value).getTime() + seconds * 1000).toISOString();
}

function safeJson(value, fallback) {
  if (!value) return fallback;
  try {
    return typeof value === "string" ? JSON.parse(value) : value;
  } catch {
    return fallback;
  }
}

function generatePublicKey(db, prefix) {
  const normalized = String(prefix || "").trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "");
  let value;
  do {
    value = `${normalized ? `${normalized}-` : ""}${nanoid(10).toUpperCase()}`;
  } while (db.prepare("SELECT 1 FROM cdkeys WHERE public_key = ?").get(value));
  return value;
}

function taskMappings(task) {
  return safeJson(task?.mapping_snapshot, []).filter(Boolean);
}

function taskCards(task) {
  return safeJson(task?.cdkeys_json, []).filter((item) => item?.id && item?.publicKey);
}

function planAllowed(rolloutPlan, plan) {
  return (PLAN_RANK[rolloutPlan] || 0) >= (PLAN_RANK[plan] || Number.POSITIVE_INFINITY);
}

function readSessionCredential(session) {
  const value = [
    session?.accessToken,
    session?.access_token,
    session?.sessionToken,
    session?.session_token,
    session?.token
  ].find((item) => typeof item === "string" && item.trim());
  if (!value) throw new Error("Session 缺少可用于 SpaceX 预检的登录令牌");
  return value.trim();
}

function accountIdentity(session, preflight) {
  const value = [
    preflight?.account_id,
    preflight?.accountId,
    preflight?.user_id,
    preflight?.userId,
    preflight?.email,
    preflight?.account?.id,
    preflight?.account?.email,
    session?.user?.id,
    session?.account?.id,
    session?.userId,
    session?.accountId,
    session?.user?.email,
    session?.account?.email,
    session?.email
  ].find((item) => typeof item === "string" && item.trim());
  if (!value) throw new Error("SpaceX 预检成功，但无法确定目标 ChatGPT 账号");
  return value.trim().toLowerCase();
}

function maskAccount(value) {
  const normalized = String(value || "").trim();
  if (!normalized.includes("@")) {
    return normalized.length <= 8 ? `${normalized.slice(0, 2)}***` : `${normalized.slice(0, 4)}***${normalized.slice(-3)}`;
  }
  const [local, domain] = normalized.split("@");
  return `${local.slice(0, 2)}***@${domain}`;
}

function accountKey(value) {
  return createHash("sha256").update(`spacex-account:${String(value).trim().toLowerCase()}`).digest("hex");
}

function publicActivationMessage(state, upstreamStatus = "", fallback = "") {
  if (state === SPACEX_CDK_ACTIVATION_STATES.completed) return "会员开通成功";
  if (state === SPACEX_CDK_ACTIVATION_STATES.failedResolution) return "开通未成功，等待人工处理";
  if ([SPACEX_CDK_ACTIVATION_STATES.review, SPACEX_CDK_ACTIVATION_STATES.pending].includes(state)) {
    return "支付结果正在对账，请勿重复提交";
  }
  if ([SPACEX_CDK_ACTIVATION_STATES.queued, SPACEX_CDK_ACTIVATION_STATES.running, SPACEX_CDK_ACTIVATION_STATES.submitting].includes(state)) {
    return "会员正在开通，请稍候";
  }
  if (SPACEX_CDK_FAILED_STATUSES.has(String(upstreamStatus || "").toLowerCase())) return "开通未成功，等待人工处理";
  return String(fallback || "会员状态正在同步").slice(0, 200);
}

function errorWithCode(message, code, extra = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, extra);
  return error;
}

function operationalErrorSummary(error, fallback) {
  const code = String(error?.code || "").trim();
  const status = Number(error?.status || 0);
  if (code && status > 0) return `${fallback}（${code} / HTTP ${status}）`;
  if (code) return `${fallback}（${code}）`;
  return fallback;
}

function issuedContractFailure(issued) {
  if (issued?.upstreamStatus && issued.upstreamStatus !== "unused") {
    return {
      code: "SPACEX_CDK_UPSTREAM_NOT_UNUSED",
      message: `SpaceX CDK 上游状态为 ${issued.upstreamStatus}，禁止自动交付`
    };
  }
  if (issued?.fundingContractMode === "unlimited") {
    return {
      code: "SPACEX_CDK_FUNDING_UNLIMITED",
      message: "SpaceX CDK 使用无限资金授权，禁止按 0 元负债自动交付"
    };
  }
  return {
    code: "SPACEX_CDK_ISSUE_CONTRACT_INVALID",
    message: "SpaceX 发码响应及回读记录均缺少有界资金上限或币种"
  };
}

function hasBoundedFundingContract(item) {
  return item?.funding_contract_mode === "bounded"
    || (
      item?.funding_contract_mode !== "unlimited"
      && Number(item?.funding_cap_minor) > 0
      && Boolean(item?.funding_currency)
    );
}

export function createSpaceXCdkService({ db, clientFactory = null, logger = console } = {}) {
  let cachedClient = null;
  let cachedVersion = "";

  function settings() {
    return db.prepare("SELECT * FROM spacex_cdk_settings WHERE id = 'default'").get();
  }

  function client() {
    const current = settings();
    const version = `${current?.base_url || ""}|${current?.api_key_encrypted || ""}|${current?.updated_at || ""}`;
    if (!cachedClient || cachedVersion !== version) {
      cachedClient = clientFactory
        ? clientFactory(current)
        : new SpaceXCdkClient({
          baseUrl: current?.base_url || "https://spacexcard.com",
          apiKey: current?.api_key_encrypted ? decryptText(current.api_key_encrypted) : ""
        });
      cachedVersion = version;
    }
    return cachedClient;
  }

  function assertIssuanceAllowed(plan) {
    const current = settings();
    if (!current?.enabled || !planAllowed(current.rollout_plan, plan)) {
      throw errorWithCode(`SpaceX CDK ${plan} 履约尚未启用`, "SPACEX_CDK_ROLLOUT_DISABLED");
    }
    if (!current.api_key_encrypted) {
      throw errorWithCode("SpaceX CDK API Key 未配置", "SPACEX_CDK_NOT_CONFIGURED");
    }
  }

  function ensureTaskUnits(task, mappings = taskMappings(task)) {
    const createdAt = nowIso();
    const insert = db.prepare(`
      INSERT OR IGNORE INTO spacex_cdk_units (
        id, task_id, item_id, unit_index, plan, state, idempotency_key,
        recovery_revision, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
    `);
    for (const mapping of mappings.filter((item) => item.fulfillmentKind === "spacex_cdk")) {
      if (!SPACEX_CDK_PLANS.includes(mapping.spacexPlan)) {
        throw errorWithCode("SpaceX 商品映射缺少有效套餐", "SPACEX_CDK_MAPPING_INVALID");
      }
      for (let index = 0; index < Number(mapping.quantity || 0); index += 1) {
        const itemId = String(mapping.itemId || `${mapping.productId}:${mapping.skuId}`);
        insert.run(
          nanoid(18),
          task.id,
          itemId,
          index,
          mapping.spacexPlan,
          SPACEX_CDK_UNIT_STATES.pending,
          `kawang:store:${task.id}:${itemId}:${index}:r0`,
          createdAt,
          createdAt
        );
      }
    }
  }

  function mappingForUnit(task, unit) {
    return taskMappings(task).find((mapping) => String(mapping.itemId || `${mapping.productId}:${mapping.skuId}`) === String(unit.item_id));
  }

  async function refreshFundingSnapshot() {
    const current = settings();
    const balance = await client().getBalance();
    const placeholders = ACTIVE_LIABILITY_STATES.map(() => "?").join(",");
    const assets = db.prepare(`
      SELECT funding_cap_minor, funding_currency, funding_contract_mode
      FROM spacex_cdks
      WHERE state IN (${placeholders})
    `).all(...ACTIVE_LIABILITY_STATES);
    const unknownCount = assets.filter((item) => !hasBoundedFundingContract(item)).length;
    const currencyMismatch = assets.some((item) => item.funding_currency && String(item.funding_currency).toUpperCase() !== balance.currency);
    const liabilityMinor = assets.reduce((sum, item) => sum + Number(item.funding_cap_minor || 0), 0);
    const covered = unknownCount === 0 && !currencyMismatch && balance.balanceMinor >= liabilityMinor;
    db.prepare(`
      UPDATE spacex_cdk_settings
      SET last_balance_minor = ?, balance_currency = ?, last_balance_at = ?, last_balance_error = NULL
      WHERE id = 'default'
    `).run(balance.balanceMinor, balance.currency, nowIso());
    return { ...balance, liabilityMinor, unknownCount, currencyMismatch, covered };
  }

  function recordBalanceError(error) {
    db.prepare("UPDATE spacex_cdk_settings SET last_balance_error = ? WHERE id = 'default'")
      .run(String(error?.message || "SpaceX 余额查询失败").slice(0, 300));
  }

  async function claimReusableAsset(unit) {
    while (true) {
      const candidate = db.prepare(`
        SELECT * FROM spacex_cdks
        WHERE plan = ? AND state = ? AND current_unit_id IS NULL AND current_wrapper_cdkey_id IS NULL
        ORDER BY COALESCE(recycled_at, created_at) ASC
        LIMIT 1
      `).get(unit.plan, SPACEX_CDK_ASSET_STATES.inventory);
      if (!candidate) return null;
      let upstream;
      try {
        upstream = await client().getCdk(candidate.upstream_id);
      } catch (error) {
        throw errorWithCode("可复用 SpaceX CDK 状态暂时无法核实，已暂停履约", "SPACEX_CDK_INVENTORY_VERIFY_FAILED", { cause: error });
      }
      const verifiedAt = nowIso();
      if (!upstream || upstream.status !== "unused" || upstream.plan !== unit.plan) {
        db.prepare(`
          UPDATE spacex_cdks
          SET state = ?, upstream_status = ?, last_verified_at = ?, updated_at = ?
          WHERE id = ? AND state = ?
        `).run(
          SPACEX_CDK_ASSET_STATES.held,
          upstream?.status || "missing",
          verifiedAt,
          verifiedAt,
          candidate.id,
          SPACEX_CDK_ASSET_STATES.inventory
        );
        continue;
      }
      const allocated = db.transaction(() => {
        const changed = db.prepare(`
          UPDATE spacex_cdks
          SET state = ?, current_unit_id = ?, upstream_status = 'unused', last_verified_at = ?, updated_at = ?
          WHERE id = ? AND state = ? AND current_unit_id IS NULL AND current_wrapper_cdkey_id IS NULL
        `).run(
          SPACEX_CDK_ASSET_STATES.allocated,
          unit.id,
          verifiedAt,
          verifiedAt,
          candidate.id,
          SPACEX_CDK_ASSET_STATES.inventory
        ).changes;
        if (!changed) return false;
        db.prepare(`
          UPDATE spacex_cdk_units
          SET state = ?, spacex_cdk_id = ?, last_error = NULL, updated_at = ?
          WHERE id = ?
        `).run(SPACEX_CDK_UNIT_STATES.allocated, candidate.id, verifiedAt, unit.id);
        return true;
      })();
      if (allocated) return db.prepare("SELECT * FROM spacex_cdks WHERE id = ?").get(candidate.id);
    }
  }

  function persistIssuedAsset(unit, issued) {
    const createdAt = nowIso();
    return db.transaction(() => {
      const existing = db.prepare("SELECT * FROM spacex_cdks WHERE upstream_id = ?").get(issued.upstreamId);
      if (existing) {
        if (existing.current_unit_id !== unit.id) {
          throw errorWithCode("SpaceX 发码结果与另一履约单位冲突", "SPACEX_CDK_ISSUE_CONFLICT");
        }
        return existing;
      }
      const assetId = nanoid(18);
      const failure = issued.contractValid ? null : issuedContractFailure(issued);
      const state = issued.contractValid
        ? SPACEX_CDK_ASSET_STATES.allocated
        : (issued.upstreamStatus && issued.upstreamStatus !== "unused"
          ? SPACEX_CDK_ASSET_STATES.held
          : SPACEX_CDK_ASSET_STATES.heldContract);
      db.prepare(`
        INSERT INTO spacex_cdks (
          id, upstream_id, code_encrypted, code_prefix, plan, state, upstream_status,
          funding_cap_minor, funding_currency, funding_contract_mode, funding_snapshot,
          fee_amount_minor, current_unit_id,
          current_wrapper_cdkey_id, last_verified_at, recycled_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, ?, ?)
      `).run(
        assetId,
        issued.upstreamId,
        encryptText(issued.code),
        issued.codePrefix,
        issued.plan,
        state,
        issued.upstreamStatus || "unused",
        issued.fundingCapMinor,
        issued.fundingCurrency,
        issued.fundingContractMode || (issued.contractValid ? "bounded" : "missing"),
        issued.fundingSnapshot || null,
        issued.feeAmountMinor,
        unit.id,
        createdAt,
        createdAt,
        createdAt
      );
      db.prepare(`
        UPDATE spacex_cdk_units
        SET state = ?, spacex_cdk_id = ?, last_error = ?, updated_at = ?
        WHERE id = ?
      `).run(
        issued.contractValid ? SPACEX_CDK_UNIT_STATES.allocated : SPACEX_CDK_UNIT_STATES.contractBlocked,
        assetId,
        failure?.message || null,
        createdAt,
        unit.id
      );
      return db.prepare("SELECT * FROM spacex_cdks WHERE id = ?").get(assetId);
    })();
  }

  async function allocateOrIssue(unit) {
    const reusable = await claimReusableAsset(unit);
    if (reusable) return reusable;

    assertIssuanceAllowed(unit.plan);
    try {
      const before = await refreshFundingSnapshot();
      if (!before.covered) {
        throw errorWithCode("SpaceX 可用余额不足以覆盖已有 CDK 负债", "SPACEX_CDK_FUNDING_BLOCKED");
      }
    } catch (error) {
      if (error.code === "SPACEX_CDK_FUNDING_BLOCKED") throw error;
      recordBalanceError(error);
      throw errorWithCode("SpaceX 资金状态暂时无法核实，已暂停新发码", "SPACEX_CDK_FUNDING_VERIFY_FAILED", { cause: error });
    }

    let issued;
    try {
      issued = await client().issueOne({ plan: unit.plan, idempotencyKey: unit.idempotency_key });
    } catch (error) {
      const uncertain = error instanceof SpaceXCdkApiError && error.uncertain;
      db.prepare(`
        UPDATE spacex_cdk_units
        SET state = ?, last_error = ?, updated_at = ?
        WHERE id = ?
      `).run(
        uncertain ? SPACEX_CDK_UNIT_STATES.issuanceUncertain : SPACEX_CDK_UNIT_STATES.pending,
        String(error?.message || "SpaceX 发码失败").slice(0, 300),
        nowIso(),
        unit.id
      );
      if (uncertain) {
        throw errorWithCode("SpaceX 发码结果不确定，禁止自动补发", "SPACEX_CDK_ISSUANCE_UNCERTAIN", { uncertain: true, cause: error });
      }
      throw error;
    }
    if (issued.plan !== unit.plan) {
      issued.contractValid = false;
    }
    if (!issued.contractValid) {
      try {
        const readBack = await client().getCdk(issued.upstreamId);
        if (readBack) {
          issued = {
            ...issued,
            fundingCapMinor: readBack.fundingCapMinor,
            fundingCurrency: readBack.fundingCurrency,
            fundingContractMode: readBack.fundingContractMode,
            fundingSnapshot: readBack.fundingSnapshot,
            upstreamStatus: readBack.status || "unused",
            contractValid: readBack.contractValid && readBack.plan === unit.plan && readBack.status === "unused"
          };
        }
      } catch {
        // Preserve the only full code below; an unreadable contract must remain blocked.
      }
    }
    const asset = persistIssuedAsset(unit, issued);
    if (!issued.contractValid) {
      const failure = issuedContractFailure(issued);
      throw errorWithCode(failure.message, failure.code);
    }
    return asset;
  }

  function createWrapper(task, unit, mapping, asset) {
    const createdAt = nowIso();
    return db.transaction(() => {
      const freshUnit = db.prepare("SELECT * FROM spacex_cdk_units WHERE id = ?").get(unit.id);
      if (freshUnit.wrapper_cdkey_id) {
        return db.prepare("SELECT * FROM cdkeys WHERE id = ?").get(freshUnit.wrapper_cdkey_id);
      }
      const freshAsset = db.prepare("SELECT * FROM spacex_cdks WHERE id = ?").get(asset.id);
      if (!freshAsset || freshAsset.current_unit_id !== unit.id || freshAsset.state !== SPACEX_CDK_ASSET_STATES.allocated) {
        throw errorWithCode("SpaceX CDK 资产不再属于当前履约单位", "SPACEX_CDK_ALLOCATION_LOST");
      }
      const id = nanoid(18);
      const prefix = SPACEX_CDK_PLAN_PREFIXES[unit.plan];
      const publicKey = generatePublicKey(db, prefix);
      db.prepare(`
        INSERT INTO cdkeys (
          id, batch_id, product_id, activation_endpoint_id, site_id, source_key, public_key, prefix, status,
          locked_at, locked_by_order_id, used_at, disabled_reason, metadata, processing_mode, manual_type,
          origin, store_order_no, store_fulfillment_target_no, store_fulfillment_task_id, created_at, updated_at
        ) VALUES (?, '', ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?, 'spacex_cdk', ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        mapping.kawangProductId,
        mapping.kawangActivationEndpointId,
        mapping.siteId,
        encryptText(`spacex-cdk-asset:${asset.id}`),
        publicKey,
        prefix,
        cdkeyStatuses.active,
        JSON.stringify({ processingMode: "spacex_cdk", spacexPlan: unit.plan, spacexCdkId: asset.id }),
        SPACEX_CDK_PLAN_MANUAL_TYPES[unit.plan],
        STORE_CDK_ORIGINS.store,
        task.parent_order_no || task.remote_order_no,
        task.remote_order_no,
        task.id,
        createdAt,
        createdAt
      );
      db.prepare(`
        UPDATE spacex_cdks SET current_wrapper_cdkey_id = ?, updated_at = ? WHERE id = ?
      `).run(id, createdAt, asset.id);
      db.prepare(`
        UPDATE spacex_cdk_units SET state = ?, wrapper_cdkey_id = ?, last_error = NULL, updated_at = ? WHERE id = ?
      `).run(SPACEX_CDK_UNIT_STATES.wrapped, id, createdAt, unit.id);
      const cards = taskCards(db.prepare("SELECT * FROM store_fulfillment_tasks WHERE id = ?").get(task.id));
      cards.push({
        id,
        publicKey,
        productId: mapping.productId,
        skuId: mapping.skuId,
        manualType: SPACEX_CDK_PLAN_MANUAL_TYPES[unit.plan],
        siteId: mapping.siteId,
        fulfillmentKind: "spacex_cdk",
        spacexPlan: unit.plan,
        spacexCdkId: asset.id
      });
      db.prepare("UPDATE store_fulfillment_tasks SET cdkeys_json = ?, updated_at = ? WHERE id = ?")
        .run(JSON.stringify(cards), createdAt, task.id);
      return db.prepare("SELECT * FROM cdkeys WHERE id = ?").get(id);
    })();
  }

  async function provisionTask(task) {
    const mappings = taskMappings(task);
    ensureTaskUnits(task, mappings);
    const units = db.prepare(`
      SELECT * FROM spacex_cdk_units WHERE task_id = ? ORDER BY item_id, unit_index
    `).all(task.id);
    for (const originalUnit of units) {
      let unit = db.prepare("SELECT * FROM spacex_cdk_units WHERE id = ?").get(originalUnit.id);
      if (unit.state === SPACEX_CDK_UNIT_STATES.wrapped) continue;
      if (unit.state === SPACEX_CDK_UNIT_STATES.issuanceUncertain) {
        throw errorWithCode("SpaceX 发码结果不确定，等待超级管理员核对", "SPACEX_CDK_ISSUANCE_UNCERTAIN", { uncertain: true });
      }
      if (unit.state === SPACEX_CDK_UNIT_STATES.contractBlocked) {
        const blockedAsset = unit.spacex_cdk_id
          ? db.prepare("SELECT * FROM spacex_cdks WHERE id = ?").get(unit.spacex_cdk_id)
          : null;
        const failure = issuedContractFailure(blockedAsset ? {
          upstreamStatus: blockedAsset.upstream_status,
          fundingContractMode: blockedAsset.funding_contract_mode
        } : null);
        throw errorWithCode(unit.last_error || failure.message, failure.code);
      }
      const mapping = mappingForUnit(task, unit);
      if (!mapping) throw errorWithCode("商城任务缺少 SpaceX 商品映射快照", "SPACEX_CDK_MAPPING_SNAPSHOT_MISSING");
      let asset = unit.spacex_cdk_id
        ? db.prepare("SELECT * FROM spacex_cdks WHERE id = ?").get(unit.spacex_cdk_id)
        : null;
      if (!asset) asset = await allocateOrIssue(unit);
      unit = db.prepare("SELECT * FROM spacex_cdk_units WHERE id = ?").get(unit.id);
      if (!asset || asset.state === SPACEX_CDK_ASSET_STATES.heldContract || unit.state === SPACEX_CDK_UNIT_STATES.contractBlocked) {
        throw errorWithCode("SpaceX 发码响应缺少权威资金上限或币种", "SPACEX_CDK_ISSUE_CONTRACT_INVALID");
      }
      let funding;
      try {
        funding = await refreshFundingSnapshot();
      } catch (error) {
        recordBalanceError(error);
        db.prepare("UPDATE spacex_cdk_units SET state = ?, last_error = ?, updated_at = ? WHERE id = ?")
          .run(SPACEX_CDK_UNIT_STATES.fundingBlocked, "SpaceX 资金状态暂时无法核实", nowIso(), unit.id);
        throw errorWithCode("SpaceX 资金状态暂时无法核实，已暂停交付", "SPACEX_CDK_FUNDING_VERIFY_FAILED", { cause: error });
      }
      if (!funding.covered) {
        db.prepare("UPDATE spacex_cdk_units SET state = ?, last_error = ?, updated_at = ? WHERE id = ?")
          .run(SPACEX_CDK_UNIT_STATES.fundingBlocked, "SpaceX 余额不足以覆盖全部未兑换 CDK 负债", nowIso(), unit.id);
        throw errorWithCode("SpaceX 余额不足以覆盖全部未兑换 CDK 负债", "SPACEX_CDK_FUNDING_BLOCKED");
      }
      if (asset.state !== SPACEX_CDK_ASSET_STATES.allocated) {
        db.prepare("UPDATE spacex_cdks SET state = ?, current_unit_id = ?, updated_at = ? WHERE id = ?")
          .run(SPACEX_CDK_ASSET_STATES.allocated, unit.id, nowIso(), asset.id);
        asset = db.prepare("SELECT * FROM spacex_cdks WHERE id = ?").get(asset.id);
      }
      createWrapper(task, unit, mapping, asset);
    }
    return db.prepare("SELECT * FROM store_fulfillment_tasks WHERE id = ?").get(task.id);
  }

  function claimActivation({ wrapper, asset, session, preflight, redemptionToken, deviceId, customerIp }) {
    const identity = accountIdentity(session, preflight);
    const identityKey = accountKey(identity);
    const masked = maskAccount(identity);
    const createdAt = nowIso();
    return db.transaction(() => {
      const existing = db.prepare("SELECT * FROM spacex_cdk_activations WHERE wrapper_cdkey_id = ?").get(wrapper.id);
      if (existing) {
        if (existing.account_key !== identityKey) throw new Error("该 CDK 已绑定其他 ChatGPT 账号");
        return { activation: existing, created: false };
      }
      const freshWrapper = db.prepare("SELECT * FROM cdkeys WHERE id = ?").get(wrapper.id);
      const freshAsset = db.prepare("SELECT * FROM spacex_cdks WHERE id = ?").get(asset.id);
      if (freshWrapper.status !== cdkeyStatuses.active) throw new Error("当前卡密状态不可兑换");
      if (freshAsset.current_wrapper_cdkey_id !== wrapper.id || freshAsset.state !== SPACEX_CDK_ASSET_STATES.allocated) {
        throw new Error("当前卡密绑定的 SpaceX CDK 不可用");
      }
      const site = db.prepare("SELECT * FROM sites WHERE id = ? AND status = 'active'").get(wrapper.site_id);
      if (!site) throw new Error("当前卡密未绑定有效网站");
      const orderId = nanoid(18);
      const activationId = nanoid(18);
      const orderNo = `KW${Date.now()}${Math.floor(Math.random() * 900 + 100)}`;
      const clientRequestId = `kawang:activate:${activationId}`;
      db.prepare(`
        INSERT INTO redeem_orders (
          id, order_no, cdkey_id, public_key, product_id, activation_endpoint_id, site_id,
          session_payload, session_preview, customer_ip, abandon_remaining_time, status, latest_job_id,
          error_message, completed_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, NULL, NULL, NULL, ?, ?)
      `).run(
        orderId,
        orderNo,
        wrapper.id,
        wrapper.public_key,
        site.product_id || wrapper.product_id,
        site.activation_endpoint_id || wrapper.activation_endpoint_id,
        site.id,
        encryptText(JSON.stringify({ ephemeral: true })),
        JSON.stringify({ email: masked, ephemeral: true }),
        customerIp || null,
        orderStatuses.processing,
        createdAt,
        createdAt
      );
      db.prepare(`
        INSERT INTO spacex_cdk_activations (
          id, wrapper_cdkey_id, spacex_cdk_id, redeem_order_id, account_key, account_masked,
          state, client_request_id, redemption_token_encrypted, device_id, upstream_status,
          reconcile_attempts, next_reconcile_at, claimed_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, ?, ?, ?, ?)
      `).run(
        activationId,
        wrapper.id,
        asset.id,
        orderId,
        identityKey,
        masked,
        SPACEX_CDK_ACTIVATION_STATES.submitting,
        clientRequestId,
        encryptText(redemptionToken),
        deviceId,
        addSeconds(createdAt, 15),
        createdAt,
        createdAt,
        createdAt
      );
      db.prepare("UPDATE cdkeys SET status = ?, locked_at = ?, locked_by_order_id = ?, updated_at = ? WHERE id = ?")
        .run(cdkeyStatuses.locked, createdAt, orderId, createdAt, wrapper.id);
      db.prepare("UPDATE spacex_cdks SET state = ?, updated_at = ? WHERE id = ?")
        .run(SPACEX_CDK_ASSET_STATES.claimed, createdAt, asset.id);
      return { activation: db.prepare("SELECT * FROM spacex_cdk_activations WHERE id = ?").get(activationId), created: true, orderNo };
    })();
  }

  function applyActivationResult(activationId, result, { errorMessage = "" } = {}) {
    const activation = db.prepare("SELECT * FROM spacex_cdk_activations WHERE id = ?").get(activationId);
    if (!activation) return null;
    if (TERMINAL_ACTIVATION_STATES.has(activation.state)) return activation;
    const upstreamStatus = String(result?.status || "").toLowerCase();
    const updatedAt = nowIso();
    let state = SPACEX_CDK_ACTIVATION_STATES.pending;
    if (upstreamStatus === "completed") state = SPACEX_CDK_ACTIVATION_STATES.completed;
    else if (SPACEX_CDK_FAILED_STATUSES.has(upstreamStatus)) state = SPACEX_CDK_ACTIVATION_STATES.failedResolution;
    else if (SPACEX_CDK_PENDING_STATUSES.has(upstreamStatus)) state = upstreamStatus;
    const message = publicActivationMessage(state, upstreamStatus, result?.message);
    return db.transaction(() => {
      db.prepare(`
        UPDATE spacex_cdk_activations
        SET state = ?, upstream_status = ?, stage = ?, public_message = ?, last_error = ?,
            upstream_order_id = COALESCE(?, upstream_order_id),
            next_reconcile_at = ?, completed_at = ?, failed_at = ?, updated_at = ?
        WHERE id = ?
      `).run(
        state,
        upstreamStatus || null,
        result?.stage || null,
        message,
        errorMessage || null,
        result?.upstreamOrderId || null,
        [SPACEX_CDK_ACTIVATION_STATES.completed, SPACEX_CDK_ACTIVATION_STATES.failedResolution].includes(state) ? null : addSeconds(updatedAt, 30),
        state === SPACEX_CDK_ACTIVATION_STATES.completed ? updatedAt : null,
        state === SPACEX_CDK_ACTIVATION_STATES.failedResolution ? updatedAt : null,
        updatedAt,
        activation.id
      );
      if (state === SPACEX_CDK_ACTIVATION_STATES.completed) {
        db.prepare("UPDATE redeem_orders SET status = ?, completed_at = ?, error_message = NULL, updated_at = ? WHERE id = ?")
          .run(orderStatuses.succeeded, updatedAt, updatedAt, activation.redeem_order_id);
        db.prepare("UPDATE cdkeys SET status = ?, used_at = ?, updated_at = ? WHERE id = ?")
          .run(cdkeyStatuses.used, updatedAt, updatedAt, activation.wrapper_cdkey_id);
        db.prepare("UPDATE spacex_cdks SET state = ?, upstream_status = 'consumed', updated_at = ? WHERE id = ?")
          .run(SPACEX_CDK_ASSET_STATES.consumed, updatedAt, activation.spacex_cdk_id);
      } else if (state === SPACEX_CDK_ACTIVATION_STATES.failedResolution) {
        db.prepare("UPDATE redeem_orders SET status = ?, error_message = ?, updated_at = ? WHERE id = ?")
          .run(orderStatuses.failed, message, updatedAt, activation.redeem_order_id);
        db.prepare("UPDATE spacex_cdks SET state = ?, upstream_status = ?, updated_at = ? WHERE id = ?")
          .run(SPACEX_CDK_ASSET_STATES.held, upstreamStatus || "failed", updatedAt, activation.spacex_cdk_id);
      } else {
        db.prepare("UPDATE redeem_orders SET status = ?, error_message = NULL, updated_at = ? WHERE id = ?")
          .run(orderStatuses.processing, updatedAt, activation.redeem_order_id);
        db.prepare("UPDATE spacex_cdks SET state = ?, upstream_status = ?, updated_at = ? WHERE id = ?")
          .run(SPACEX_CDK_ASSET_STATES.pending, upstreamStatus || "pending", updatedAt, activation.spacex_cdk_id);
      }
      return db.prepare("SELECT * FROM spacex_cdk_activations WHERE id = ?").get(activation.id);
    })();
  }

  async function activate({ publicKey, session, customerIp = "" }) {
    const wrapper = db.prepare("SELECT * FROM cdkeys WHERE public_key = ?").get(String(publicKey).trim().toUpperCase());
    if (!wrapper || wrapper.processing_mode !== "spacex_cdk") throw new Error("SpaceX 激活卡密不存在");
    const asset = db.prepare("SELECT * FROM spacex_cdks WHERE current_wrapper_cdkey_id = ?").get(wrapper.id);
    if (!asset) throw new Error("当前卡密未绑定可用的 SpaceX CDK");
    const existing = db.prepare("SELECT * FROM spacex_cdk_activations WHERE wrapper_cdkey_id = ?").get(wrapper.id);
    if (existing) {
      const order = db.prepare("SELECT order_no FROM redeem_orders WHERE id = ?").get(existing.redeem_order_id);
      return { orderNo: order?.order_no, processingMode: "spacex_cdk", spacexPlan: asset.plan, activationState: existing.state };
    }
    if (wrapper.status !== cdkeyStatuses.active || asset.state !== SPACEX_CDK_ASSET_STATES.allocated) {
      throw new Error("当前卡密状态不可兑换");
    }
    const credential = readSessionCredential(session);
    const deviceId = `kawang-${nanoid(24)}`;
    const upstreamCode = decryptText(asset.code_encrypted);
    const preview = await client().preview({ code: upstreamCode, deviceId });
    const previewPlan = String(preview.plan || preview.cdk?.plan || "").trim();
    if (previewPlan && previewPlan !== asset.plan) throw new Error("SpaceX CDK 套餐与本地包装不一致");
    const preflight = await client().preflight({
      redemptionToken: preview.redemptionToken,
      session: credential,
      deviceId
    });
    const claimed = claimActivation({
      wrapper,
      asset,
      session,
      preflight,
      redemptionToken: preview.redemptionToken,
      deviceId,
      customerIp
    });
    const order = db.prepare("SELECT order_no FROM redeem_orders WHERE id = ?").get(claimed.activation.redeem_order_id);
    if (!claimed.created) {
      return { orderNo: order?.order_no, processingMode: "spacex_cdk", spacexPlan: asset.plan, activationState: claimed.activation.state };
    }
    try {
      const result = await client().redeem({
        redemptionToken: preview.redemptionToken,
        preflightToken: preflight.preflightToken,
        clientRequestId: claimed.activation.client_request_id,
        deviceId
      });
      const updated = applyActivationResult(claimed.activation.id, result);
      return { orderNo: order?.order_no, processingMode: "spacex_cdk", spacexPlan: asset.plan, activationState: updated?.state };
    } catch (error) {
      if (error instanceof SpaceXCdkApiError && error.uncertain) {
        const updated = applyActivationResult(claimed.activation.id, { status: "pending", message: "兑换结果正在确认" }, { errorMessage: "兑换提交结果不确定，等待查询" });
        return { orderNo: order?.order_no, processingMode: "spacex_cdk", spacexPlan: asset.plan, activationState: updated?.state };
      }
      applyActivationResult(
        claimed.activation.id,
        { status: "cancelled", message: "兑换未被受理" },
        { errorMessage: operationalErrorSummary(error, "SpaceX 兑换提交失败") }
      );
      throw new Error("SpaceX 兑换未成功，已转人工处理");
    }
  }

  async function reconcileDue({ limit = 20 } = {}) {
    const due = db.prepare(`
      SELECT * FROM spacex_cdk_activations
      WHERE state IN (?, ?, ?, ?, ?)
        AND redemption_token_encrypted IS NOT NULL
        AND (next_reconcile_at IS NULL OR next_reconcile_at <= ?)
      ORDER BY created_at ASC LIMIT ?
    `).all(
      SPACEX_CDK_ACTIVATION_STATES.submitting,
      SPACEX_CDK_ACTIVATION_STATES.queued,
      SPACEX_CDK_ACTIVATION_STATES.running,
      SPACEX_CDK_ACTIVATION_STATES.review,
      SPACEX_CDK_ACTIVATION_STATES.pending,
      nowIso(),
      Math.max(1, Math.min(100, Number(limit || 20)))
    );
    let processed = 0;
    for (const activation of due) {
      try {
        const result = await client().result({
          redemptionToken: decryptText(activation.redemption_token_encrypted),
          deviceId: activation.device_id
        });
        applyActivationResult(activation.id, result);
      } catch (error) {
        const attempts = Number(activation.reconcile_attempts || 0) + 1;
        const delay = Math.min(300, 15 * (2 ** Math.min(4, attempts - 1)));
        db.prepare(`
          UPDATE spacex_cdk_activations
          SET reconcile_attempts = ?, next_reconcile_at = ?, last_error = ?, updated_at = ?
          WHERE id = ?
        `).run(
          attempts,
          addSeconds(nowIso(), delay),
          operationalErrorSummary(error, "SpaceX 状态查询失败"),
          nowIso(),
          activation.id
        );
      }
      processed += 1;
    }
    return { processed };
  }

  function applyWebhookEvent(event) {
    const eventId = String(event?.event_id || event?.id || "").trim();
    const eventType = String(event?.type || event?.event_type || "").trim();
    if (!eventId || !eventType) throw new Error("SpaceX Webhook 缺少 event_id 或 type");
    const data = event?.data && typeof event.data === "object" ? event.data : event;
    const payloadHash = createHash("sha256").update(JSON.stringify(event)).digest("hex");
    const inserted = db.prepare(`
      INSERT OR IGNORE INTO spacex_cdk_webhook_events (
        event_id, event_type, payload_hash, processing_status, received_at
      ) VALUES (?, ?, ?, 'received', ?)
    `).run(eventId, eventType, payloadHash, nowIso()).changes;
    if (!inserted) return { duplicate: true };
    const upstreamOrderId = String(data.order_id || data.orderId || data.gpt_direct_order_id || "").trim();
    const clientRequestId = String(data.client_request_id || data.clientRequestId || "").trim();
    const activation = upstreamOrderId
      ? db.prepare("SELECT * FROM spacex_cdk_activations WHERE upstream_order_id = ?").get(upstreamOrderId)
      : (clientRequestId ? db.prepare("SELECT * FROM spacex_cdk_activations WHERE client_request_id = ?").get(clientRequestId) : null);
    if (!activation) {
      db.prepare("UPDATE spacex_cdk_webhook_events SET processing_status = 'unmatched', processed_at = ? WHERE event_id = ?")
        .run(nowIso(), eventId);
      return { duplicate: false, matched: false };
    }
    const result = normalizeActivationResult(data);
    applyActivationResult(activation.id, result);
    db.prepare(`
      UPDATE spacex_cdk_webhook_events
      SET activation_id = ?, processing_status = 'processed', processed_at = ? WHERE event_id = ?
    `).run(activation.id, nowIso(), eventId);
    return { duplicate: false, matched: true, activationId: activation.id };
  }

  function beginRefundHold(task) {
    return db.transaction(() => {
      const uncertainUnit = db.prepare(`
        SELECT 1 FROM spacex_cdk_units WHERE task_id = ? AND state = ? LIMIT 1
      `).get(task.id, SPACEX_CDK_UNIT_STATES.issuanceUncertain);
      if (uncertainUnit) {
        throw errorWithCode("商城订单已退款，但 SpaceX 发码结果仍不确定，需先人工核对", "SPACEX_CDK_ISSUANCE_UNCERTAIN");
      }
      const cards = db.prepare("SELECT * FROM cdkeys WHERE store_fulfillment_task_id = ?").all(task.id);
      const blocked = cards.filter((card) => card.status !== cdkeyStatuses.active
        && !(card.status === cdkeyStatuses.void && card.disabled_reason === "商城订单取消或退款"));
      if (blocked.length) {
        throw errorWithCode(`商城订单已退款，但 ${blocked.length} 张 CDK 已绑定或核销`, "SPACEX_CDK_REFUND_RACE_LOST");
      }
      const spacexCards = db.prepare(`
        SELECT u.id AS unit_id, u.state AS unit_state, u.wrapper_cdkey_id,
               a.id AS asset_id, a.upstream_id, a.plan AS asset_plan, a.state AS asset_state
        FROM spacex_cdk_units u
        LEFT JOIN spacex_cdks a ON a.id = u.spacex_cdk_id
        WHERE u.task_id = ? AND u.state NOT IN (?, ?)
      `).all(task.id, SPACEX_CDK_UNIT_STATES.refunded, SPACEX_CDK_UNIT_STATES.issuanceUncertain)
        .filter((item) => item.asset_id);
      if (spacexCards.some((card) => card.unit_state === SPACEX_CDK_UNIT_STATES.contractBlocked
        || card.asset_state === SPACEX_CDK_ASSET_STATES.heldContract)) {
        throw errorWithCode("商城订单已退款，但上游 CDK 缺少权威资金契约，需人工核对", "SPACEX_CDK_ISSUE_CONTRACT_INVALID");
      }
      if (spacexCards.some((card) => card.wrapper_cdkey_id
        && db.prepare("SELECT 1 FROM spacex_cdk_activations WHERE wrapper_cdkey_id = ?").get(card.wrapper_cdkey_id))) {
        throw errorWithCode("商城退款发生时已有 SpaceX CDK 完成账号绑定", "SPACEX_CDK_REFUND_RACE_LOST");
      }
      const updatedAt = nowIso();
      for (const card of cards) {
        if (card.status === cdkeyStatuses.active) {
          db.prepare("UPDATE cdkeys SET status = ?, disabled_reason = '商城订单取消或退款', updated_at = ? WHERE id = ? AND status = ?")
            .run(cdkeyStatuses.void, updatedAt, card.id, cdkeyStatuses.active);
        }
      }
      for (const item of spacexCards) {
        if (![SPACEX_CDK_ASSET_STATES.allocated, SPACEX_CDK_ASSET_STATES.refundHold].includes(item.asset_state)) {
          throw errorWithCode("商城退款时 SpaceX CDK 资产状态不允许自动回收", "SPACEX_CDK_REFUND_RACE_LOST");
        }
        db.prepare("UPDATE spacex_cdks SET state = ?, updated_at = ? WHERE id = ? AND state IN (?, ?)")
          .run(
            SPACEX_CDK_ASSET_STATES.refundHold,
            updatedAt,
            item.asset_id,
            SPACEX_CDK_ASSET_STATES.allocated,
            SPACEX_CDK_ASSET_STATES.refundHold
          );
        db.prepare("UPDATE spacex_cdk_units SET state = ?, updated_at = ? WHERE id = ?")
          .run(SPACEX_CDK_UNIT_STATES.refundHold, updatedAt, item.unit_id);
      }
      return spacexCards;
    })();
  }

  async function reclaimCanceledTask(task) {
    const cards = beginRefundHold(task);
    for (const card of cards) {
      let upstream;
      try {
        upstream = await client().getCdk(card.upstream_id);
      } catch (error) {
        throw errorWithCode("退款 CDK 的 SpaceX 状态暂时无法核实", "SPACEX_CDK_REFUND_VERIFY_FAILED", { cause: error });
      }
      if (!upstream || upstream.status !== "unused" || upstream.plan !== card.asset_plan) {
        throw errorWithCode("退款 CDK 的 SpaceX 状态不是可复用的 unused", "SPACEX_CDK_REFUND_NOT_REUSABLE");
      }
    }
    const recycledAt = nowIso();
    db.transaction(() => {
      for (const card of cards) {
        const changed = db.prepare(`
          UPDATE spacex_cdks
          SET state = ?, upstream_status = 'unused', current_unit_id = NULL, current_wrapper_cdkey_id = NULL,
              last_verified_at = ?, recycled_at = ?, updated_at = ?
          WHERE id = ? AND state = ?
        `).run(
          SPACEX_CDK_ASSET_STATES.inventory,
          recycledAt,
          recycledAt,
          recycledAt,
          card.asset_id,
          SPACEX_CDK_ASSET_STATES.refundHold
        ).changes;
        if (!changed) {
          throw errorWithCode("退款核验后 SpaceX CDK 资产状态发生变化", "SPACEX_CDK_REFUND_RACE_LOST");
        }
        db.prepare("UPDATE spacex_cdk_units SET state = ?, updated_at = ? WHERE id = ?")
          .run(SPACEX_CDK_UNIT_STATES.refunded, recycledAt, card.unit_id);
      }
    })();
    return { recycled: cards.length };
  }

  async function manuallyCloseConsumedAsset(assetId) {
    const context = db.prepare(`
      SELECT a.*, u.id AS unit_id, u.task_id, u.state AS unit_state,
             t.remote_order_no, t.status AS task_status, t.locked_at, t.locked_by
      FROM spacex_cdks a
      LEFT JOIN spacex_cdk_units u ON u.id = a.current_unit_id
      LEFT JOIN store_fulfillment_tasks t ON t.id = u.task_id
      WHERE a.id = ?
    `).get(assetId);
    if (!context) throw errorWithCode("SpaceX CDK 资产不存在", "SPACEX_CDK_ASSET_NOT_FOUND");
    if (!context.unit_id || !context.task_id) {
      throw errorWithCode("该 SpaceX CDK 没有关联的自动交付任务", "SPACEX_CDK_MANUAL_CLOSE_TASK_MISSING");
    }
    if (!MANUALLY_CLOSEABLE_TASK_STATES.has(context.task_status)
      || !MANUALLY_CLOSEABLE_UNIT_STATES.has(context.unit_state)) {
      throw errorWithCode("当前 SpaceX CDK 或交付任务状态不允许人工收尾", "SPACEX_CDK_MANUAL_CLOSE_STATE_INVALID");
    }
    if (context.locked_at || context.locked_by) {
      throw errorWithCode("交付任务正在处理中，请稍后刷新再操作", "SPACEX_CDK_MANUAL_CLOSE_TASK_BUSY");
    }
    if (context.current_wrapper_cdkey_id) {
      throw errorWithCode("该资产已经生成包装 CDK，不能从资产列表人工收尾", "SPACEX_CDK_MANUAL_CLOSE_WRAPPER_EXISTS");
    }
    if (db.prepare("SELECT 1 FROM spacex_cdk_activations WHERE spacex_cdk_id = ?").get(context.id)) {
      throw errorWithCode("该资产已有激活记录，不能从资产列表人工收尾", "SPACEX_CDK_MANUAL_CLOSE_ACTIVATION_EXISTS");
    }

    let upstream;
    try {
      upstream = await client().getCdk(context.upstream_id);
    } catch (error) {
      throw errorWithCode("SpaceX CDK 上游状态暂时无法核实", "SPACEX_CDK_MANUAL_CLOSE_VERIFY_FAILED", { cause: error });
    }
    if (!upstream || upstream.status !== "consumed" || upstream.plan !== context.plan) {
      throw errorWithCode("仅能收尾上游已确认 consumed 的同套餐 CDK", "SPACEX_CDK_MANUAL_CLOSE_NOT_CONSUMED");
    }

    const closedAt = nowIso();
    db.transaction(() => {
      const freshTask = db.prepare("SELECT status, locked_at, locked_by FROM store_fulfillment_tasks WHERE id = ?").get(context.task_id);
      const freshUnit = db.prepare("SELECT state, wrapper_cdkey_id FROM spacex_cdk_units WHERE id = ?").get(context.unit_id);
      const freshAsset = db.prepare("SELECT current_wrapper_cdkey_id FROM spacex_cdks WHERE id = ?").get(context.id);
      if (!freshTask || !freshUnit || !freshAsset
        || !MANUALLY_CLOSEABLE_TASK_STATES.has(freshTask.status)
        || !MANUALLY_CLOSEABLE_UNIT_STATES.has(freshUnit.state)
        || freshTask.locked_at || freshTask.locked_by
        || freshUnit.wrapper_cdkey_id || freshAsset.current_wrapper_cdkey_id) {
        throw errorWithCode("人工收尾前任务状态已变化，请刷新后重试", "SPACEX_CDK_MANUAL_CLOSE_RACE_LOST");
      }
      if (db.prepare("SELECT 1 FROM spacex_cdk_activations WHERE spacex_cdk_id = ?").get(context.id)) {
        throw errorWithCode("人工收尾前出现了激活记录，请刷新后核对", "SPACEX_CDK_MANUAL_CLOSE_RACE_LOST");
      }
      db.prepare(`
        UPDATE spacex_cdks
        SET state = ?, upstream_status = 'consumed', last_verified_at = ?, updated_at = ?
        WHERE id = ?
      `).run(SPACEX_CDK_ASSET_STATES.consumed, closedAt, closedAt, context.id);
      db.prepare(`
        UPDATE spacex_cdk_units
        SET state = ?, last_error = NULL, updated_at = ?
        WHERE id = ?
      `).run(SPACEX_CDK_UNIT_STATES.manuallyClosed, closedAt, context.unit_id);
      db.prepare(`
        UPDATE store_fulfillment_tasks
        SET status = ?, next_retry_at = NULL, last_error = NULL, locked_at = NULL, locked_by = NULL,
            canceled_at = ?, updated_at = ?
        WHERE id = ?
      `).run(STORE_FULFILLMENT_STATUSES.canceled, closedAt, closedAt, context.task_id);
    })();
    return {
      assetId: context.id,
      upstreamId: context.upstream_id,
      taskId: context.task_id,
      remoteOrderNo: context.remote_order_no,
      state: SPACEX_CDK_ASSET_STATES.consumed,
      taskStatus: STORE_FULFILLMENT_STATUSES.canceled,
      closedAt
    };
  }

  function activationForOrder(orderId) {
    const row = db.prepare("SELECT * FROM spacex_cdk_activations WHERE redeem_order_id = ?").get(orderId);
    if (!row) return null;
    return {
      id: row.id,
      state: row.state,
      stateText: publicActivationMessage(row.state, row.upstream_status, row.public_message),
      upstreamStatus: row.upstream_status || null,
      stage: row.stage || null,
      accountMasked: row.account_masked || null,
      message: row.public_message || publicActivationMessage(row.state, row.upstream_status),
      completedAt: row.completed_at || null,
      failedAt: row.failed_at || null,
      updatedAt: row.updated_at
    };
  }

  function revealAsset(assetId) {
    const asset = db.prepare("SELECT * FROM spacex_cdks WHERE id = ?").get(assetId);
    if (!asset) return null;
    return { asset, code: decryptText(asset.code_encrypted) };
  }

  return {
    settings,
    client,
    ensureTaskUnits,
    provisionTask,
    refreshFundingSnapshot,
    activate,
    reconcileDue,
    applyWebhookEvent,
    reclaimCanceledTask,
    manuallyCloseConsumedAsset,
    activationForOrder,
    revealAsset
  };
}
