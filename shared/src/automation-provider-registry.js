import { createHash } from "node:crypto";
import { AutomateV1Adapter, automateV1CanonicalOffer } from "./automation-adapters/automate-v1.js";

export const automationAdapterKeys = Object.freeze(["automate_v1"]);

function parseJson(value, fallback = null) {
  if (!value) return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function automationCapabilityHash(config) {
  return createHash("sha256").update(stableJson(config)).digest("hex");
}

export function serializeAutomationProvider(row) {
  if (!row) return null;
  const config = parseJson(row.config_snapshot);
  return {
    id: row.id,
    name: row.name,
    adapterKey: row.adapter_key,
    baseUrl: row.base_url,
    status: row.status,
    hasCredential: Boolean(row.current_credential_id),
    currentCredentialId: row.current_credential_id || null,
    maxConcurrency: Number(row.max_concurrency || 1),
    config,
    configHash: row.config_hash || null,
    configSyncedAt: row.config_synced_at || null,
    configStatus: row.config_status,
    configError: row.config_error || null,
    circuitState: row.circuit_state,
    circuitReason: row.circuit_reason || null,
    circuitOpenedAt: row.circuit_opened_at || null,
    consecutiveFailures: Number(row.consecutive_failures || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by
  };
}

export function createAutomationAdapter(db, input = {}) {
  const provider = typeof input.provider === "object"
    ? input.provider
    : db.prepare("SELECT * FROM automation_providers WHERE id = ?").get(input.providerId);
  if (!provider) throw new Error("自动化站点不存在");
  const credentialId = input.credentialId || provider.current_credential_id;
  const credential = db.prepare(`
    SELECT * FROM automation_provider_credentials WHERE id = ? AND provider_id = ?
  `).get(credentialId, provider.id);
  if (!credential) throw new Error("自动化站点凭证不存在");
  if (typeof input.decryptText !== "function") throw new TypeError("自动化站点缺少解密函数");
  if (provider.adapter_key === "automate_v1") {
    return {
      provider,
      credential,
      adapter: new AutomateV1Adapter({
        baseUrl: provider.base_url,
        apiKey: input.decryptText(credential.api_key_encrypted),
        fetchImpl: input.fetchImpl,
        lookup: input.lookup
      })
    };
  }
  throw new Error("自动化站点 Adapter 不受支持");
}

export function validateAutomationMappingCapability(provider, input = {}) {
  const config = parseJson(provider?.config_snapshot);
  if (!config || !Array.isArray(config.plans) || !Array.isArray(config.regions)) {
    throw new Error("自动化站点尚未同步有效能力");
  }
  const storedPlan = config.plans.find((item) => item.id === input.externalPlanId);
  if (!storedPlan) throw new Error("站点没有提供所选套餐");
  if (storedPlan.taskType !== "purchase") throw new Error("当前系统只允许映射站点明确提供的直付套餐");
  const plan = provider.adapter_key === "automate_v1" && !storedPlan.canonicalOffer
    ? { ...storedPlan, canonicalOffer: automateV1CanonicalOffer(storedPlan.id, storedPlan.taskType) }
    : storedPlan;
  const region = config.regions.find((item) => item.code === input.regionCode);
  if (!region) throw new Error("站点没有提供所选充值区域");
  return Object.freeze({ plan, region, configHash: provider.config_hash });
}

export async function syncAutomationProvider(db, input = {}) {
  const at = input.at || new Date().toISOString();
  const { provider, adapter } = createAutomationAdapter(db, input);
  try {
    const config = await adapter.discoverCapabilities();
    const snapshot = JSON.stringify(config);
    const hash = automationCapabilityHash(config);
    db.transaction(() => {
      db.prepare(`
        UPDATE automation_providers
        SET config_snapshot = ?, config_hash = ?, config_synced_at = ?,
            config_status = 'ready', config_error = NULL,
            consecutive_failures = 0, updated_at = ?
        WHERE id = ?
      `).run(snapshot, hash, at, at, provider.id);
      const mappings = db.prepare("SELECT * FROM automation_product_mappings WHERE provider_id = ?").all(provider.id);
      for (const mapping of mappings) {
        const plan = config.plans.find((item) => item.id === mapping.external_plan_id);
        const region = config.regions.find((item) => item.code === mapping.region_code);
        const source = db.prepare(`
          SELECT mapping.*, site.status AS site_status
          FROM store_product_mappings mapping
          JOIN sites site ON site.id = mapping.site_id
          WHERE mapping.id = ?
        `).get(mapping.product_id);
        const sourceOffer = String(source?.manual_type || "").trim().toLowerCase();
        const planOffer = String(plan?.canonicalOffer || "").trim().toLowerCase();
        if (!plan || plan.taskType !== "purchase" || !region || region.currency !== mapping.currency
          || !source || source.enabled !== 1 || source.fulfillment_kind !== "membership_auto"
          || source.site_status !== "active" || !planOffer || planOffer !== sourceOffer) {
          db.prepare(`
            UPDATE automation_product_mappings
            SET enabled = 0, paused_reason = 'CAPABILITY_OR_STORE_MAPPING_CHANGED',
                updated_at = ?, revision = revision + 1
            WHERE id = ?
          `).run(at, mapping.id);
        }
      }
    }).immediate();
    return serializeAutomationProvider(db.prepare("SELECT * FROM automation_providers WHERE id = ?").get(provider.id));
  } catch (error) {
    db.prepare(`
      UPDATE automation_providers
      SET config_status = 'failed', config_error = ?, consecutive_failures = consecutive_failures + 1,
          updated_at = ? WHERE id = ?
    `).run(String(error?.code || error?.message || "AUTOMATION_CONFIG_SYNC_FAILED").slice(0, 300), at, provider.id);
    throw error;
  }
}
