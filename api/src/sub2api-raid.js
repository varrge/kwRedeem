import { z } from "zod";

const BOSS_ASSETS = ["leviathan", "sentinel", "prism", "zero-core", "warden", "overmind", "behemoth", "singularity"];
const REWARD_TYPES = ["balance", "shake_card", "subscription", "rate_multiplier"];
const FULFILLMENT_MODES = ["auto", "review"];
const ACTIVE_SYNC_LOOKBACK_MS = 24 * 60 * 60 * 1000;

function monthWindow(month) {
  const [year, monthNumber] = String(month).split("-").map(Number);
  const offset = 8 * 60 * 60 * 1000;
  const start = Date.UTC(year, monthNumber - 1, 1) - offset;
  const end = Date.UTC(year, monthNumber, 1) - offset;
  return { start, end, settlementEnd: end + 10 * 60 * 1000 };
}

export function getRaidMvpSlots(effectiveRaiderCount) {
  return Math.min(3, Math.floor(Math.max(0, Number(effectiveRaiderCount)) / 10));
}

const rewardSchema = z.object({
  name: z.string().trim().min(1).max(100),
  type: z.enum(REWARD_TYPES),
  amount: z.number().finite().positive().optional(),
  quantity: z.number().int().min(1).max(100).optional(),
  shakeCampaignId: z.string().trim().min(1).optional(),
  cardTier: z.enum(["low", "medium", "high"]).optional().default("low"),
  subscriptionGroupId: z.number().int().positive().optional(),
  validityDays: z.number().int().min(1).max(365).optional(),
  rateGroupId: z.number().int().positive().optional(),
  rateMultiplier: z.number().finite().gt(0).lte(1).optional(),
  durationDays: z.number().int().min(1).max(90).optional(),
  usageCap: z.number().finite().positive().max(100000).optional(),
  fallbackAmount: z.number().finite().positive().optional(),
  cost: z.number().finite().nonnegative(),
  fulfillmentMode: z.enum(FULFILLMENT_MODES)
}).superRefine((reward, context) => {
  if (reward.type === "balance" && !(Number(reward.amount) > 0)) {
    context.addIssue({ code: "custom", path: ["amount"], message: "额度奖励金额必须大于 0" });
  }
  if (reward.type === "shake_card" && (!reward.shakeCampaignId || !(Number(reward.quantity) > 0))) {
    context.addIssue({ code: "custom", path: ["shakeCampaignId"], message: "抽奖卡奖励必须指定活动和数量" });
  }
  if (reward.type === "subscription" && (!(Number(reward.subscriptionGroupId) > 0) || !(Number(reward.validityDays) > 0))) {
    context.addIssue({ code: "custom", path: ["subscriptionGroupId"], message: "订阅套餐奖励必须指定分组和有效天数" });
  }
  if (reward.type === "rate_multiplier" && (
    !(Number(reward.rateGroupId) > 0)
    || !(Number(reward.rateMultiplier) > 0 && Number(reward.rateMultiplier) <= 1)
    || !(Number(reward.durationDays) > 0)
    || !(Number(reward.usageCap) > 0)
    || !(Number(reward.fallbackAmount) > 0)
  )) {
    context.addIssue({ code: "custom", path: ["rateGroupId"], message: "限时倍率奖励必须指定分组、0-1 绝对倍率、天数、优惠用量上限和备用额度" });
  }
});

const bossSchema = z.object({
  level: z.number().int().min(1).max(99),
  name: z.string().trim().min(1).max(100),
  title: z.string().trim().max(120).optional().default(""),
  assetKey: z.enum(BOSS_ASSETS),
  health: z.number().finite().positive(),
  themeGroupId: z.number().int().positive().nullable().optional().default(null),
  themeGroupName: z.string().trim().max(100).optional().default(""),
  themeMultiplier: z.number().finite().min(1).max(5).optional().default(1),
  clearReward: rewardSchema,
  mvpRewards: z.array(rewardSchema).length(3)
});

const campaignSchema = z.object({
  connectionId: z.string().trim().min(1),
  name: z.string().trim().min(1).max(100),
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "活动月份格式应为 YYYY-MM"),
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
  settlementEndAt: z.string().datetime(),
  effectiveDamageThreshold: z.number().finite().positive(),
  rewardBudget: z.number().finite().nonnegative(),
  excludedUserIds: z.array(z.union([z.string(), z.number()])).optional().default([]),
  bosses: z.array(bossSchema).min(1).max(12)
}).superRefine((campaign, context) => {
  const expected = monthWindow(campaign.month);
  if (Date.parse(campaign.startAt) !== expected.start || Date.parse(campaign.endAt) !== expected.end) {
    context.addIssue({ code: "custom", path: ["month"], message: "活动必须覆盖对应的北京时间自然月" });
  }
  if (Date.parse(campaign.settlementEndAt) !== expected.settlementEnd) {
    context.addIssue({ code: "custom", path: ["settlementEndAt"], message: "月末结算窗口必须为 10 分钟" });
  }
  if (new Set(campaign.bosses.map((boss) => boss.level)).size !== campaign.bosses.length) {
    context.addIssue({ code: "custom", path: ["bosses"], message: "Boss 等级不能重复" });
  }
  for (const boss of campaign.bosses) {
    if (boss.clearReward.type === "subscription" || boss.clearReward.type === "rate_multiplier") {
      context.addIssue({ code: "custom", path: ["bosses"], message: "共享奖励暂只支持小额额度或活动抽奖卡；订阅套餐和限时倍率请配置为 MVP 奖励" });
    }
  }
});

const abortSchema = z.object({ reason: z.string().trim().min(2).max(500) });
const dispositionSchema = z.object({
  action: z.enum(["approve", "retry", "confirm", "void"]),
  reason: z.string().trim().min(2).max(500)
});
const disqualifySchema = z.object({
  userId: z.union([z.string(), z.number()]).transform(String).pipe(z.string().trim().min(1)),
  reason: z.string().trim().min(2).max(500),
  evidence: z.string().trim().max(1000).optional().default("")
});

function parseBody(request) {
  return request?.body && typeof request.body === "object" ? request.body : {};
}

function roundAmount(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100_000_000) / 100_000_000;
}

function compareStableIds(left, right) {
  const a = String(left);
  const b = String(right);
  if (/^\d+$/.test(a) && /^\d+$/.test(b)) {
    const lengthDifference = a.length - b.length;
    return lengthDifference || a.localeCompare(b);
  }
  return a.localeCompare(b);
}

function compareUsage(left, right) {
  return String(left.occurred_at).localeCompare(String(right.occurred_at))
    || compareStableIds(left.remote_usage_id, right.remote_usage_id);
}

function shanghaiDate(value) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date(value)).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function maskIdentity(identity) {
  const source = String(identity.username || identity.email?.split("@")[0] || identity.userId || "玩家");
  if (source.length <= 2) return `${source[0] || "玩"}***`;
  return `${source.slice(0, 2)}***${source.slice(-2)}`;
}

function rewardWorstCaseCost(boss, threshold) {
  const maxRaiders = Math.ceil(Number(boss.health) / Number(threshold));
  const slots = getRaidMvpSlots(maxRaiders);
  const rewardCost = (reward) => Math.max(Number(reward.cost), reward.type === "rate_multiplier" ? Number(reward.fallbackAmount || 0) : 0);
  return roundAmount(
    rewardCost(boss.clearReward) * maxRaiders
      + boss.mvpRewards.slice(0, slots).reduce((sum, reward) => sum + rewardCost(reward), 0)
  );
}

function campaignWorstCaseCost(campaign) {
  return roundAmount(campaign.bosses.reduce(
    (sum, boss) => sum + rewardWorstCaseCost(boss, campaign.effectiveDamageThreshold),
    0
  ));
}

function parseJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function createSub2ApiRaidService({
  app,
  db,
  requireAdmin,
  requireSession,
  createAuditLog = () => {},
  now = () => new Date().toISOString(),
  id = (prefix) => `${prefix}-${crypto.randomUUID()}`,
  listUsagePage = async () => { throw new Error("Sub2api 用量同步适配器未配置"); },
  getUserProfile = async (identity) => ({ createdAt: identity.accountCreatedAt || "" }),
  creditBalance = async () => { throw new Error("Sub2api 余额奖励适配器未配置"); },
  grantSubscription = async () => { throw new Error("Sub2api 订阅奖励适配器未配置"); },
  getUserGroupRate = async () => null,
  applyRateEntitlement = async () => { throw new Error("Sub2api 倍率奖励适配器未配置"); }
}) {
  const syncingConnections = new Set();

  function getCampaign(campaignId) {
    return db.prepare("SELECT * FROM sub2api_raid_campaigns WHERE id = ?").get(campaignId);
  }

  function getBoss(bossId) {
    return db.prepare("SELECT * FROM sub2api_raid_bosses WHERE id = ?").get(bossId);
  }

  function findVisibleCampaign(connectionId, at = now()) {
    return db.prepare(`
      SELECT * FROM sub2api_raid_campaigns
      WHERE connection_id = ?
        AND status IN ('scheduled', 'active', 'settling', 'cleared', 'ended', 'aborted')
        AND start_at <= ?
      ORDER BY start_at DESC LIMIT 1
    `).get(connectionId, at);
  }

  function serializeRewardConfig(reward) {
    return {
      name: reward.name,
      type: reward.type,
      amount: reward.amount ?? null,
      quantity: reward.quantity ?? null,
      shakeCampaignId: reward.shakeCampaignId || null,
      cardTier: reward.cardTier || "low",
      subscriptionGroupId: reward.subscriptionGroupId ?? null,
      validityDays: reward.validityDays ?? null,
      rateGroupId: reward.rateGroupId ?? null,
      rateMultiplier: reward.rateMultiplier ?? null,
      durationDays: reward.durationDays ?? null,
      usageCap: reward.usageCap ?? null,
      fallbackAmount: reward.fallbackAmount ?? null,
      cost: Number(reward.cost),
      fulfillmentMode: reward.fulfillmentMode
    };
  }

  function serializeBoss(row) {
    if (!row) return null;
    const damage = db.prepare(`
      SELECT COALESCE(SUM(damage), 0) AS total FROM sub2api_raid_damage_assignments WHERE boss_id = ?
    `).get(row.id).total;
    return {
      id: row.id,
      campaignId: row.campaign_id,
      sequence: Number(row.sequence),
      level: Number(row.level),
      name: row.name,
      title: row.title || "",
      assetKey: row.asset_key,
      health: Number(row.max_health),
      remainingHealth: Math.max(0, Number(row.remaining_health)),
      totalDamage: roundAmount(damage),
      status: row.status,
      themeGroupId: row.theme_group_id === null ? null : Number(row.theme_group_id),
      themeGroupName: row.theme_group_name || "",
      themeMultiplier: Number(row.theme_multiplier),
      clearReward: parseJson(row.clear_reward, null),
      mvpRewards: parseJson(row.mvp_rewards, []),
      startedAt: row.started_at || null,
      defeatedAt: row.defeated_at || null
    };
  }

  function serializeCampaign(row, { includeExcluded = false } = {}) {
    if (!row) return null;
    const bosses = db.prepare(`
      SELECT * FROM sub2api_raid_bosses WHERE campaign_id = ? ORDER BY sequence ASC
    `).all(row.id).map(serializeBoss);
    return {
      id: row.id,
      connectionId: row.connection_id,
      name: row.name,
      month: row.month,
      timezone: "Asia/Shanghai",
      status: row.status,
      startAt: row.start_at,
      endAt: row.end_at,
      settlementEndAt: row.settlement_end_at,
      effectiveDamageThreshold: Number(row.effective_damage_threshold),
      rewardBudget: Number(row.reward_budget),
      worstCaseCost: Number(row.worst_case_cost),
      currentBossId: row.current_boss_id || null,
      abortReason: row.abort_reason || "",
      ...(includeExcluded ? { excludedUserIds: parseJson(row.excluded_user_ids, []) } : {}),
      bosses
    };
  }

  function validateRewardTargets(data) {
    for (const boss of data.bosses) {
      for (const reward of [boss.clearReward, ...boss.mvpRewards]) {
        if (reward.type !== "shake_card") continue;
        const target = db.prepare(`
          SELECT id, connection_id, status, end_at FROM sub2api_shake_campaigns WHERE id = ?
        `).get(reward.shakeCampaignId);
        if (!target || target.connection_id !== data.connectionId
          || target.status === "ended" || target.end_at < data.settlementEndAt) {
          const error = new Error(`抽奖卡奖励“${reward.name}”绑定的摇摇乐活动无效或过早结束`);
          error.statusCode = 409;
          throw error;
        }
      }
    }
  }

  function createCampaign(input, actor) {
    const parsed = campaignSchema.safeParse(input);
    if (!parsed.success) {
      const error = new Error(parsed.error.issues[0]?.message || "Boss 活动配置无效");
      error.statusCode = 400;
      throw error;
    }
    const data = parsed.data;
    const connection = db.prepare("SELECT id FROM sub2api_connections WHERE id = ? AND status = 'active'").get(data.connectionId);
    if (!connection) {
      const error = new Error("Sub2api 连接不存在或未启用");
      error.statusCode = 404;
      throw error;
    }
    const worstCaseCost = campaignWorstCaseCost(data);
    if (worstCaseCost > data.rewardBudget) {
      const error = new Error(`最坏奖励成本 ${worstCaseCost} 超过月度预算 ${data.rewardBudget}`);
      error.statusCode = 409;
      throw error;
    }
    const campaignId = id("raid-campaign");
    const createdAt = now();
    db.transaction(() => {
      db.prepare(`
        INSERT INTO sub2api_raid_campaigns (
          id, connection_id, name, month, status, start_at, end_at, settlement_end_at,
          effective_damage_threshold, reward_budget, worst_case_cost, excluded_user_ids,
          created_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        campaignId, data.connectionId, data.name, data.month, data.startAt, data.endAt,
        data.settlementEndAt, data.effectiveDamageThreshold, data.rewardBudget, worstCaseCost,
        JSON.stringify([...new Set(data.excludedUserIds.map(String))]), actor, createdAt, createdAt
      );
      const insertBoss = db.prepare(`
        INSERT INTO sub2api_raid_bosses (
          id, campaign_id, sequence, level, name, title, asset_key, max_health,
          remaining_health, status, theme_group_id, theme_group_name, theme_multiplier,
          clear_reward, mvp_rewards, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'locked', ?, ?, ?, ?, ?, ?, ?)
      `);
      data.bosses.forEach((boss, index) => insertBoss.run(
        id("raid-boss"), campaignId, index + 1, boss.level, boss.name, boss.title || null,
        boss.assetKey, boss.health, boss.health, boss.themeGroupId, boss.themeGroupName || null,
        boss.themeMultiplier, JSON.stringify(serializeRewardConfig(boss.clearReward)),
        JSON.stringify(boss.mvpRewards.map(serializeRewardConfig)), createdAt, createdAt
      ));
    })();
    createAuditLog({
      action: "sub2api.raid.campaign.create",
      actor,
      resourceType: "sub2api_raid_campaign",
      resourceId: campaignId,
      detail: { connectionId: data.connectionId, month: data.month, worstCaseCost }
    });
    return getCampaign(campaignId);
  }

  function updateDraftCampaign(campaignId, input, actor) {
    const parsed = campaignSchema.safeParse(input);
    if (!parsed.success) {
      const error = new Error(parsed.error.issues[0]?.message || "Boss 活动配置无效");
      error.statusCode = 400;
      throw error;
    }
    const campaign = getCampaign(campaignId);
    if (!campaign) throw Object.assign(new Error("Boss 活动不存在"), { statusCode: 404 });
    if (campaign.status !== "draft") {
      throw Object.assign(new Error("活动发布后配置已锁定，不能修改"), { statusCode: 409 });
    }
    const data = parsed.data;
    const connection = db.prepare("SELECT id FROM sub2api_connections WHERE id = ? AND status = 'active'").get(data.connectionId);
    if (!connection) throw Object.assign(new Error("Sub2api 连接不存在或未启用"), { statusCode: 404 });
    const worstCaseCost = campaignWorstCaseCost(data);
    if (worstCaseCost > data.rewardBudget) {
      throw Object.assign(
        new Error(`最坏奖励成本 ${worstCaseCost} 超过月度预算 ${data.rewardBudget}`),
        { statusCode: 409 }
      );
    }
    const updatedAt = now();
    db.transaction(() => {
      db.prepare(`
        UPDATE sub2api_raid_campaigns SET
          connection_id = ?, name = ?, month = ?, start_at = ?, end_at = ?,
          settlement_end_at = ?, effective_damage_threshold = ?, reward_budget = ?,
          worst_case_cost = ?, excluded_user_ids = ?, updated_at = ?
        WHERE id = ?
      `).run(
        data.connectionId, data.name, data.month, data.startAt, data.endAt,
        data.settlementEndAt, data.effectiveDamageThreshold, data.rewardBudget, worstCaseCost,
        JSON.stringify([...new Set(data.excludedUserIds.map(String))]), updatedAt, campaign.id
      );
      db.prepare("DELETE FROM sub2api_raid_bosses WHERE campaign_id = ?").run(campaign.id);
      const insertBoss = db.prepare(`
        INSERT INTO sub2api_raid_bosses (
          id, campaign_id, sequence, level, name, title, asset_key, max_health,
          remaining_health, status, theme_group_id, theme_group_name, theme_multiplier,
          clear_reward, mvp_rewards, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'locked', ?, ?, ?, ?, ?, ?, ?)
      `);
      data.bosses.forEach((boss, index) => insertBoss.run(
        id("raid-boss"), campaign.id, index + 1, boss.level, boss.name, boss.title || null,
        boss.assetKey, boss.health, boss.health, boss.themeGroupId, boss.themeGroupName || null,
        boss.themeMultiplier, JSON.stringify(serializeRewardConfig(boss.clearReward)),
        JSON.stringify(boss.mvpRewards.map(serializeRewardConfig)), updatedAt, updatedAt
      ));
    })();
    createAuditLog({
      action: "sub2api.raid.campaign.update",
      actor,
      resourceType: "sub2api_raid_campaign",
      resourceId: campaign.id,
      detail: { connectionId: data.connectionId, month: data.month, worstCaseCost }
    });
    return getCampaign(campaign.id);
  }

  function publishCampaign(campaignId, actor) {
    const campaign = getCampaign(campaignId);
    if (!campaign) {
      const error = new Error("Boss 活动不存在");
      error.statusCode = 404;
      throw error;
    }
    if (campaign.status !== "draft") {
      const error = new Error("只有草稿活动可以发布");
      error.statusCode = 409;
      throw error;
    }
    const serialized = serializeCampaign(campaign, { includeExcluded: true });
    validateRewardTargets({ ...serialized, bosses: serialized.bosses.map((boss) => ({
      ...boss,
      clearReward: boss.clearReward,
      mvpRewards: boss.mvpRewards
    })) });
    if (Number(campaign.worst_case_cost) > Number(campaign.reward_budget)) {
      const error = new Error("最坏奖励成本超过月度预算，无法发布");
      error.statusCode = 409;
      throw error;
    }
    const conflict = db.prepare(`
      SELECT id FROM sub2api_raid_campaigns
      WHERE connection_id = ? AND id <> ?
        AND status IN ('scheduled', 'active', 'settling')
        AND start_at < ? AND end_at > ? LIMIT 1
    `).get(campaign.connection_id, campaign.id, campaign.end_at, campaign.start_at);
    if (conflict) {
      const error = new Error("该连接在此月份已有已发布的 Boss 活动");
      error.statusCode = 409;
      throw error;
    }
    const publishedAt = now();
    if (campaign.end_at <= publishedAt) {
      const error = new Error("活动月份已经结束，不能发布");
      error.statusCode = 409;
      throw error;
    }
    const active = campaign.start_at <= publishedAt && campaign.end_at > publishedAt;
    const firstBoss = db.prepare(`
      SELECT id FROM sub2api_raid_bosses WHERE campaign_id = ? ORDER BY sequence ASC LIMIT 1
    `).get(campaign.id);
    db.transaction(() => {
      db.prepare(`
        UPDATE sub2api_raid_campaigns
        SET status = ?, current_boss_id = ?, published_at = ?, updated_at = ? WHERE id = ?
      `).run(active ? "active" : "scheduled", firstBoss.id, publishedAt, publishedAt, campaign.id);
      if (active) {
        db.prepare(`
          UPDATE sub2api_raid_bosses SET status = 'active', started_at = ?, updated_at = ? WHERE id = ?
        `).run(publishedAt, publishedAt, firstBoss.id);
      }
    })();
    createAuditLog({
      action: "sub2api.raid.campaign.publish",
      actor,
      resourceType: "sub2api_raid_campaign",
      resourceId: campaign.id,
      detail: { status: active ? "active" : "scheduled", worstCaseCost: Number(campaign.worst_case_cost) }
    });
    return getCampaign(campaign.id);
  }

  async function enroll(identity) {
    const campaign = findVisibleCampaign(identity.connectionId);
    if (!campaign || campaign.status !== "active") {
      const error = new Error("当前没有可加入的 Boss 活动");
      error.statusCode = 409;
      throw error;
    }
    const userId = String(identity.userId);
    if (parseJson(campaign.excluded_user_ids, []).map(String).includes(userId)) {
      const error = new Error("该账号不在本次活动参战范围内");
      error.statusCode = 403;
      throw error;
    }
    const existing = db.prepare(`
      SELECT * FROM sub2api_raid_enrollments WHERE campaign_id = ? AND sub2api_user_id = ?
    `).get(campaign.id, userId);
    if (existing) return existing;
    const profile = await getUserProfile(identity);
    const accountCreatedAt = String(profile?.createdAt || profile?.created_at || "");
    const accountCreatedMs = Date.parse(accountCreatedAt);
    if (!Number.isFinite(accountCreatedMs) || accountCreatedMs >= Date.parse(campaign.start_at)) {
      const error = new Error("只有活动开始前已注册的账号可以参战");
      error.statusCode = 403;
      throw error;
    }
    const enrolledAt = now();
    db.prepare(`
      INSERT INTO sub2api_raid_enrollments (
        id, campaign_id, connection_id, sub2api_user_id, email, username,
        masked_name, account_created_at, enrolled_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id("raid-enrollment"), campaign.id, campaign.connection_id, userId,
      identity.email || null, identity.username || null, maskIdentity(identity), accountCreatedAt, enrolledAt
    );
    return db.prepare(`
      SELECT * FROM sub2api_raid_enrollments WHERE campaign_id = ? AND sub2api_user_id = ?
    `).get(campaign.id, userId);
  }

  function getRanking(bossId) {
    const boss = getBoss(bossId);
    if (!boss) return [];
    const campaign = getCampaign(boss.campaign_id);
    const rows = db.prepare(`
      SELECT c.*, e.masked_name, e.username, e.email
      FROM sub2api_raid_contributions c
      LEFT JOIN sub2api_raid_enrollments e
        ON e.campaign_id = c.campaign_id AND e.sub2api_user_id = c.sub2api_user_id
      WHERE c.boss_id = ?
    `).all(bossId).sort((left, right) => (
      Number(right.damage) - Number(left.damage)
        || String(left.reached_at).localeCompare(String(right.reached_at))
        || compareStableIds(left.sub2api_user_id, right.sub2api_user_id)
    ));
    return rows.map((row, index) => ({
      rank: index + 1,
      userId: row.sub2api_user_id,
      maskedName: row.masked_name || maskIdentity({ userId: row.sub2api_user_id }),
      actualCost: Number(row.actual_cost),
      bonusDamage: Number(row.bonus_damage),
      damage: Number(row.damage),
      reachedAt: row.reached_at,
      effective: Number(row.damage) >= Number(campaign.effective_damage_threshold)
    }));
  }

  function rebuildCurrentBoss(campaign) {
    const boss = getBoss(campaign.current_boss_id);
    if (!boss || !["active", "settling"].includes(boss.status)) return { changed: false, defeated: false };
    const previousBoss = db.prepare(`
      SELECT defeated_at, provisional_defeat_usage_id FROM sub2api_raid_bosses
      WHERE campaign_id = ? AND sequence < ? AND status = 'defeated'
      ORDER BY sequence DESC LIMIT 1
    `).get(campaign.id, boss.sequence);
    const prior = db.prepare(`
      SELECT COUNT(*) AS count, COALESCE(SUM(damage), 0) AS damage
      FROM sub2api_raid_damage_assignments WHERE boss_id = ?
    `).get(boss.id);
    const priorBoundary = boss.provisional_defeat_usage_id || "";
    const excluded = new Set(parseJson(campaign.excluded_user_ids, []).map(String));
    const allUsage = db.prepare(`
      SELECT u.*, e.enrolled_at
      FROM sub2api_raid_usage_records u
      INNER JOIN sub2api_raid_enrollments e
        ON e.campaign_id = ? AND e.sub2api_user_id = u.sub2api_user_id
      WHERE u.connection_id = ?
        AND u.occurred_at >= ? AND u.occurred_at < ?
        AND u.occurred_at >= e.enrolled_at
        AND NOT EXISTS (
          SELECT 1 FROM sub2api_raid_damage_assignments d
          INNER JOIN sub2api_raid_bosses settled ON settled.id = d.boss_id
          WHERE d.usage_record_id = u.id AND settled.status = 'defeated'
        )
    `).all(campaign.id, campaign.connection_id, campaign.start_at, campaign.end_at)
      .filter((usage) => !excluded.has(String(usage.sub2api_user_id)))
      .filter((usage) => {
        if (!previousBoss?.defeated_at) return true;
        if (usage.occurred_at > previousBoss.defeated_at) return true;
        return usage.occurred_at === previousBoss.defeated_at
          && compareStableIds(usage.remote_usage_id, previousBoss.provisional_defeat_usage_id) > 0;
      })
      .sort(compareUsage);

    let remaining = Number(boss.max_health);
    const assignments = [];
    for (const usage of allUsage) {
      const actualCost = Number(usage.actual_cost);
      if (!(actualCost > 0)) continue;
      const multiplier = Number(usage.subscription_group_id) === Number(boss.theme_group_id)
        && boss.theme_group_id !== null
        ? Number(boss.theme_multiplier)
        : 1;
      const damage = roundAmount(actualCost * multiplier);
      assignments.push({ usage, multiplier, damage, bonusDamage: roundAmount(damage - actualCost) });
      remaining = roundAmount(remaining - damage);
      if (remaining <= 0) break;
    }
    const boundary = remaining <= 0 ? assignments.at(-1)?.usage.remote_usage_id || "" : "";
    const totalDamage = roundAmount(assignments.reduce((sum, item) => sum + item.damage, 0));
    const changed = Number(prior.count) !== assignments.length
      || roundAmount(prior.damage) !== totalDamage
      || priorBoundary !== boundary;
    const updatedAt = now();
    db.transaction(() => {
      db.prepare("DELETE FROM sub2api_raid_damage_assignments WHERE boss_id = ?").run(boss.id);
      db.prepare("DELETE FROM sub2api_raid_contributions WHERE boss_id = ?").run(boss.id);
      const insertDamage = db.prepare(`
        INSERT INTO sub2api_raid_damage_assignments (
          id, campaign_id, boss_id, usage_record_id, remote_usage_id, sub2api_user_id,
          subscription_group_id, actual_cost, multiplier, bonus_damage, damage, occurred_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const contributionByUser = new Map();
      for (const assignment of assignments) {
        const usage = assignment.usage;
        insertDamage.run(
          `raid-damage-${usage.id}`, campaign.id, boss.id, usage.id, usage.remote_usage_id,
          usage.sub2api_user_id, usage.subscription_group_id, usage.actual_cost,
          assignment.multiplier, assignment.bonusDamage, assignment.damage, usage.occurred_at, updatedAt
        );
        const aggregate = contributionByUser.get(usage.sub2api_user_id) || {
          actualCost: 0, bonusDamage: 0, damage: 0, reachedAt: usage.occurred_at
        };
        aggregate.actualCost = roundAmount(aggregate.actualCost + Number(usage.actual_cost));
        aggregate.bonusDamage = roundAmount(aggregate.bonusDamage + assignment.bonusDamage);
        aggregate.damage = roundAmount(aggregate.damage + assignment.damage);
        aggregate.reachedAt = usage.occurred_at;
        contributionByUser.set(usage.sub2api_user_id, aggregate);
      }
      const insertContribution = db.prepare(`
        INSERT INTO sub2api_raid_contributions (
          id, campaign_id, boss_id, sub2api_user_id, actual_cost,
          bonus_damage, damage, reached_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const [userId, aggregate] of contributionByUser) {
        insertContribution.run(
          id("raid-contribution"), campaign.id, boss.id, userId, aggregate.actualCost,
          aggregate.bonusDamage, aggregate.damage, aggregate.reachedAt, updatedAt
        );
      }
      const stableSyncCount = boundary ? (changed ? 0 : Number(boss.stable_sync_count) + 1) : 0;
      db.prepare(`
        UPDATE sub2api_raid_bosses
        SET remaining_health = ?, status = ?, provisional_defeated_at = ?,
            provisional_defeat_usage_id = ?, stable_sync_count = ?, updated_at = ?
        WHERE id = ?
      `).run(
        Math.max(0, remaining), boundary ? "settling" : "active",
        boundary ? assignments.at(-1).usage.occurred_at : null,
        boundary || null, stableSyncCount, updatedAt, boss.id
      );
    })();
    return {
      changed,
      defeated: Boolean(boundary),
      stableSyncCount: boundary ? (changed ? 0 : Number(boss.stable_sync_count) + 1) : 0,
      boundary,
      totalDamage
    };
  }

  function createReward(settlement, boss, userId, scope, rank, reward) {
    const rewardId = id("raid-reward");
    const createdAt = now();
    db.prepare(`
      INSERT INTO sub2api_raid_rewards (
        id, campaign_id, boss_id, settlement_id, sub2api_user_id, reward_scope,
        original_rank, final_rank, reward_snapshot, fulfillment_mode, status,
        cost, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      rewardId, settlement.campaign_id, boss.id, settlement.id, userId, scope,
      rank, rank, JSON.stringify(reward), reward.fulfillmentMode,
      reward.fulfillmentMode === "auto" ? "pending" : "awaiting_review",
      Number(reward.cost), createdAt, createdAt
    );
    return rewardId;
  }

  function getRateEntitlement(id) {
    return db.prepare("SELECT * FROM sub2api_raid_rate_entitlements WHERE id = ?").get(id);
  }

  function getActiveRateEntitlement(connectionId, userId, groupId, at = now()) {
    return db.prepare(`
      SELECT * FROM sub2api_raid_rate_entitlements
      WHERE connection_id = ? AND sub2api_user_id = ? AND group_id = ? AND status = 'active'
        AND starts_at <= ? AND expires_at > ?
      ORDER BY multiplier ASC, starts_at ASC, created_at ASC
      LIMIT 1
    `).get(connectionId, String(userId), Number(groupId), at, at);
  }

  async function activateRateEntitlement(entitlement, reward, at = now(), inheritedPreviousMultiplier = undefined) {
    const current = getActiveRateEntitlement(entitlement.connection_id, entitlement.sub2api_user_id, entitlement.group_id, at);
    if (current && Number(current.multiplier) <= Number(entitlement.multiplier)) return current;
    const previousMultiplier = inheritedPreviousMultiplier !== undefined
      ? inheritedPreviousMultiplier
      : await getUserGroupRate({
        connectionId: entitlement.connection_id,
        userId: entitlement.sub2api_user_id,
        groupId: entitlement.group_id
      });
    await applyRateEntitlement({
      connectionId: entitlement.connection_id,
      userId: entitlement.sub2api_user_id,
      groupId: entitlement.group_id,
      multiplier: Number(entitlement.multiplier),
      rewardId: entitlement.reward_id,
      idempotencyKey: `${entitlement.reward_id}:rate:activate`,
      notes: `KaWang Boss Raid 限时倍率：${reward.name} / ${entitlement.reward_id}`
    });
    const startedAt = at;
    const expiresAt = new Date(Date.parse(startedAt) + Number(entitlement.duration_days) * 24 * 60 * 60 * 1000).toISOString();
    db.prepare(`
      UPDATE sub2api_raid_rate_entitlements
      SET status = 'active', starts_at = ?, expires_at = ?, previous_multiplier = ?, error_message = NULL, updated_at = ?
      WHERE id = ?
    `).run(startedAt, expiresAt, previousMultiplier === null || previousMultiplier === undefined ? null : Number(previousMultiplier), startedAt, entitlement.id);
    return getRateEntitlement(entitlement.id);
  }

  async function createRateEntitlement(rewardRow, reward) {
    const campaign = getCampaign(rewardRow.campaign_id);
    const existing = db.prepare("SELECT * FROM sub2api_raid_rate_entitlements WHERE reward_id = ?").get(rewardRow.id);
    if (existing && ["active", "queued", "fallback_delivered"].includes(existing.status)) return existing;
    const createdAt = now();
    const idValue = existing?.id || id("raid-rate");
    const current = getActiveRateEntitlement(campaign.connection_id, rewardRow.sub2api_user_id, reward.rateGroupId, createdAt);
    const status = current && Number(current.multiplier) <= Number(reward.rateMultiplier) ? "queued" : "pending";
    if (!existing) db.prepare(`
      INSERT INTO sub2api_raid_rate_entitlements (
        id, reward_id, campaign_id, connection_id, sub2api_user_id, group_id,
        multiplier, usage_cap, discounted_usage, duration_days, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)
    `).run(
      idValue, rewardRow.id, rewardRow.campaign_id, campaign.connection_id, rewardRow.sub2api_user_id,
      Number(reward.rateGroupId), Number(reward.rateMultiplier), Number(reward.usageCap),
      Number(reward.durationDays), status, createdAt, createdAt
    );
    else db.prepare("UPDATE sub2api_raid_rate_entitlements SET status = ?, error_message = NULL, updated_at = ? WHERE id = ?")
      .run(status, createdAt, existing.id);
    const entitlement = getRateEntitlement(idValue);
    if (status === "queued") return entitlement;
    try {
      const remoteMultiplier = await getUserGroupRate({
        connectionId: campaign.connection_id,
        userId: rewardRow.sub2api_user_id,
        groupId: reward.rateGroupId
      });
      if (remoteMultiplier !== null && Number(remoteMultiplier) <= Number(reward.rateMultiplier)) {
        const response = await creditBalance({
          connectionId: campaign.connection_id,
          userId: rewardRow.sub2api_user_id,
          amount: Number(reward.fallbackAmount),
          rewardId: rewardRow.id,
          idempotencyKey: `${rewardRow.id}:rate:fallback`,
          notes: `KaWang Boss Raid 倍率冲突备用额度：${reward.name} / ${rewardRow.id}`
        });
        db.prepare("UPDATE sub2api_raid_rate_entitlements SET status = 'fallback_delivered', previous_multiplier = ?, updated_at = ? WHERE id = ?")
          .run(Number(remoteMultiplier), now(), entitlement.id);
        return { ...getRateEntitlement(entitlement.id), fallbackResponse: response };
      }
      return await activateRateEntitlement(entitlement, reward, createdAt);
    } catch (error) {
      db.prepare("UPDATE sub2api_raid_rate_entitlements SET status = 'delivery_failed', error_message = ?, updated_at = ? WHERE id = ?")
        .run(error.message || "倍率权益写入失败", now(), idValue);
      throw error;
    }
  }

  async function maintainRateEntitlements(at = now()) {
    const rows = db.prepare(`
      SELECT * FROM sub2api_raid_rate_entitlements
      WHERE status = 'active' ORDER BY expires_at ASC
    `).all();
    let ended = 0;
    for (const row of rows) {
      const usage = Number(db.prepare(`
        SELECT COALESCE(SUM(actual_cost), 0) AS total FROM sub2api_raid_usage_records
        WHERE connection_id = ? AND sub2api_user_id = ? AND subscription_group_id = ?
          AND occurred_at >= ? AND occurred_at < ?
      `).get(row.connection_id, row.sub2api_user_id, row.group_id, row.starts_at, at).total);
      const reachedCap = usage >= Number(row.usage_cap);
      const expired = String(row.expires_at) <= String(at);
      db.prepare("UPDATE sub2api_raid_rate_entitlements SET discounted_usage = ?, updated_at = ? WHERE id = ?")
        .run(roundAmount(usage), at, row.id);
      if (!reachedCap && !expired) continue;
      db.prepare("UPDATE sub2api_raid_rate_entitlements SET status = 'ended', updated_at = ? WHERE id = ?")
        .run(at, row.id);
      ended += 1;
      const next = db.prepare(`
        SELECT * FROM sub2api_raid_rate_entitlements
        WHERE connection_id = ? AND sub2api_user_id = ? AND group_id = ? AND status = 'queued'
        ORDER BY multiplier ASC, created_at ASC LIMIT 1
      `).get(row.connection_id, row.sub2api_user_id, row.group_id);
      if (next) {
        const rewardRow = db.prepare("SELECT * FROM sub2api_raid_rewards WHERE id = ?").get(next.reward_id);
        const reward = parseJson(rewardRow?.reward_snapshot, null);
        if (rewardRow && reward) {
          try {
            await activateRateEntitlement(next, reward, at, row.previous_multiplier === null ? null : Number(row.previous_multiplier));
          } catch (error) {
            db.prepare("UPDATE sub2api_raid_rate_entitlements SET error_message = ?, updated_at = ? WHERE id = ?")
              .run(error.message || "排队倍率激活失败", at, next.id);
          }
        }
      } else {
        const currentMultiplier = await getUserGroupRate({
          connectionId: row.connection_id,
          userId: row.sub2api_user_id,
          groupId: row.group_id
        });
        if (currentMultiplier === null || Math.abs(Number(currentMultiplier) - Number(row.multiplier)) < 1e-9) {
          await applyRateEntitlement({
            connectionId: row.connection_id,
            userId: row.sub2api_user_id,
            groupId: row.group_id,
            multiplier: row.previous_multiplier === null ? null : Number(row.previous_multiplier),
            rewardId: row.reward_id,
            idempotencyKey: `${row.reward_id}:rate:clear:${at}`,
            notes: `KaWang Boss Raid 限时倍率到期：${row.reward_id}`
          }).catch((error) => console.error(`[sub2api-raid-rate:${row.id}]`, error));
        }
      }
    }
    return ended;
  }

  function settleBoss(campaign, boss) {
    if (boss.status !== "settling" || Number(boss.stable_sync_count) < 2) return null;
    const ranking = getRanking(boss.id);
    const effective = ranking.filter((item) => item.effective);
    const mvpSlots = getRaidMvpSlots(effective.length);
    const settlementId = id("raid-settlement");
    const createdAt = now();
    const totalDamage = db.prepare(`
      SELECT COALESCE(SUM(damage), 0) AS total FROM sub2api_raid_damage_assignments WHERE boss_id = ?
    `).get(boss.id).total;
    const settlement = {
      id: settlementId,
      campaign_id: campaign.id,
      boss_id: boss.id
    };
    const nextBoss = db.prepare(`
      SELECT * FROM sub2api_raid_bosses WHERE campaign_id = ? AND sequence > ? ORDER BY sequence ASC LIMIT 1
    `).get(campaign.id, boss.sequence);
    db.transaction(() => {
      db.prepare(`
        INSERT INTO sub2api_raid_settlements (
          id, campaign_id, boss_id, defeated_at, defeat_usage_id, total_damage,
          effective_raider_count, mvp_slots, ranking_snapshot, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        settlementId, campaign.id, boss.id, boss.provisional_defeated_at,
        boss.provisional_defeat_usage_id, totalDamage, effective.length, mvpSlots,
        JSON.stringify(ranking), createdAt
      );
      db.prepare(`
        UPDATE sub2api_raid_bosses
        SET status = 'defeated', defeated_at = ?, remaining_health = 0, updated_at = ? WHERE id = ?
      `).run(boss.provisional_defeated_at, createdAt, boss.id);
      const clearReward = parseJson(boss.clear_reward, null);
      for (const raider of effective) {
        createReward(settlement, boss, raider.userId, "clear", null, clearReward);
      }
      const mvpRewards = parseJson(boss.mvp_rewards, []);
      effective.slice(0, mvpSlots).forEach((raider, index) => {
        createReward(settlement, boss, raider.userId, "mvp", index + 1, mvpRewards[index]);
      });
      if (nextBoss) {
        db.prepare(`
          UPDATE sub2api_raid_bosses SET status = 'active', started_at = ?, updated_at = ? WHERE id = ?
        `).run(createdAt, createdAt, nextBoss.id);
        db.prepare(`
          UPDATE sub2api_raid_campaigns SET current_boss_id = ?, updated_at = ? WHERE id = ?
        `).run(nextBoss.id, createdAt, campaign.id);
      } else {
        db.prepare(`
          UPDATE sub2api_raid_campaigns
          SET status = 'cleared', current_boss_id = NULL, ended_at = ?, updated_at = ? WHERE id = ?
        `).run(createdAt, createdAt, campaign.id);
      }
    })();
    return settlementId;
  }

  async function deliverReward(rewardId) {
    let row = db.prepare("SELECT * FROM sub2api_raid_rewards WHERE id = ?").get(rewardId);
    if (!row || !["pending", "delivery_failed"].includes(row.status)) return row;
    const reward = parseJson(row.reward_snapshot, null);
    let response = null;
    try {
      if (reward.type === "balance") {
        response = await creditBalance({
          connectionId: getCampaign(row.campaign_id).connection_id,
          userId: row.sub2api_user_id,
          amount: Number(reward.amount),
          rewardId: row.id,
          idempotencyKey: `${row.id}:reward`,
          notes: `KaWang Boss Raid 奖励：${reward.name} / ${row.id}`
        });
      } else if (reward.type === "shake_card") {
        const campaign = getCampaign(row.campaign_id);
        const target = db.prepare(`
          SELECT * FROM sub2api_shake_campaigns
          WHERE id = ? AND connection_id = ? AND status <> 'ended'
        `).get(reward.shakeCampaignId, campaign.connection_id);
        if (!target) throw new Error("绑定的摇摇乐活动已失效");
        const existing = Number(db.prepare(`
          SELECT COUNT(*) AS count FROM sub2api_shake_cards
          WHERE source = 'boss_raid' AND source_record_id = ?
        `).get(row.id).count);
        const quantity = Number(reward.quantity);
        const grantedAt = now();
        const insert = db.prepare(`
          INSERT INTO sub2api_shake_cards (
            id, campaign_id, connection_id, sub2api_user_id, source, card_tier,
            source_record_id, status, granted_at
          ) VALUES (?, ?, ?, ?, 'boss_raid', ?, ?, 'available', ?)
        `);
        db.transaction(() => {
          for (let index = existing; index < quantity; index += 1) {
            insert.run(
              id("shake-card"), target.id, target.connection_id, row.sub2api_user_id,
              reward.cardTier || "low", row.id, grantedAt
            );
          }
        })();
        response = { campaignId: target.id, cardsGranted: Math.max(0, quantity - existing) };
      } else if (reward.type === "subscription") {
        response = await grantSubscription({
          connectionId: getCampaign(row.campaign_id).connection_id,
          userId: row.sub2api_user_id,
          groupId: Number(reward.subscriptionGroupId),
          validityDays: Number(reward.validityDays),
          rewardId: row.id,
          idempotencyKey: `${row.id}:subscription`,
          notes: `KaWang Boss Raid 订阅套餐：${reward.name} / ${row.id}`
        });
      } else if (reward.type === "rate_multiplier") {
        const entitlement = await createRateEntitlement(row, reward);
        response = {
          groupId: Number(entitlement.group_id),
          multiplier: Number(entitlement.multiplier),
          status: entitlement.status,
          expiresAt: entitlement.expires_at || null,
          usageCap: Number(entitlement.usage_cap)
        };
      }
      const deliveredAt = now();
      db.prepare(`
        UPDATE sub2api_raid_rewards
        SET status = 'delivered', delivery_response = ?, error_message = NULL,
            delivered_at = ?, updated_at = ? WHERE id = ?
      `).run(JSON.stringify(response), deliveredAt, deliveredAt, row.id);
    } catch (error) {
      db.prepare(`
        UPDATE sub2api_raid_rewards SET status = 'delivery_failed', error_message = ?, updated_at = ? WHERE id = ?
      `).run(error.message || "奖励发放失败", now(), row.id);
    }
    row = db.prepare("SELECT * FROM sub2api_raid_rewards WHERE id = ?").get(row.id);
    return row;
  }

  async function deliverPendingRewards(campaignId = null) {
    const conditions = ["status = 'pending'", "fulfillment_mode = 'auto'"];
    const params = [];
    if (campaignId) {
      conditions.push("campaign_id = ?");
      params.push(campaignId);
    }
    const rows = db.prepare(`
      SELECT id FROM sub2api_raid_rewards WHERE ${conditions.join(" AND ")} ORDER BY created_at ASC LIMIT 200
    `).all(...params);
    for (const row of rows) await deliverReward(row.id);
    return rows.length;
  }

  async function syncUsage(connectionId) {
    if (syncingConnections.has(connectionId)) {
      const error = new Error("该连接的 Boss 用量同步正在执行中");
      error.statusCode = 409;
      throw error;
    }
    syncingConnections.add(connectionId);
    try {
      return await syncUsageUnlocked(connectionId);
    } finally {
      syncingConnections.delete(connectionId);
    }
  }

  async function syncUsageUnlocked(connectionId) {
    const connection = db.prepare("SELECT id FROM sub2api_connections WHERE id = ? AND status = 'active'").get(connectionId);
    if (!connection) {
      const error = new Error("Sub2api 连接不存在或未启用");
      error.statusCode = 404;
      throw error;
    }
    const campaign = db.prepare(`
      SELECT * FROM sub2api_raid_campaigns
      WHERE connection_id = ? AND status IN ('active', 'settling') ORDER BY start_at DESC LIMIT 1
    `).get(connectionId);
    if (!campaign) {
      const error = new Error("当前连接没有进行中的 Boss 活动");
      error.statusCode = 409;
      throw error;
    }
    const sync = db.prepare("SELECT * FROM sub2api_raid_usage_sync WHERE connection_id = ?").get(connectionId);
    let page = 1;
    let pages = 1;
    let imported = 0;
    let highestCursor = String(sync?.cursor || "");
    const scanStartAt = campaign.status === "settling" || !sync?.last_synced_at
      ? campaign.start_at
      : new Date(Math.max(Date.parse(campaign.start_at), Date.parse(sync.last_synced_at) - ACTIVE_SYNC_LOOKBACK_MS)).toISOString();
    const startDate = shanghaiDate(scanStartAt);
    const endDate = shanghaiDate(new Date(Date.parse(campaign.end_at) - 1));
    let reachedBoundary = false;
    try {
      do {
        const response = await listUsagePage({
          connectionId,
          page,
          pageSize: 100,
          sortBy: "created_at",
          sortOrder: "desc",
          startDate,
          endDate,
          timezone: "Asia/Shanghai"
        });
        pages = Math.max(1, Number(response?.pages || 1));
        for (const item of Array.isArray(response?.items) ? response.items : []) {
          const remoteId = String(item?.id ?? "").trim();
          const userId = String(item?.user_id ?? "").trim();
          if (!remoteId || !userId) continue;
          const actualCost = Number(item.actual_cost);
          const occurredAt = String(item.created_at || "");
          if (!occurredAt || !Number.isFinite(actualCost)) continue;
          if (occurredAt < scanStartAt) {
            reachedBoundary = true;
            continue;
          }
          if (!highestCursor || compareStableIds(remoteId, highestCursor) > 0) highestCursor = remoteId;
          const groupId = Number(item.group_id);
          const subscriptionGroupId = Number.isInteger(groupId) && groupId > 0 ? groupId : null;
          const result = db.prepare(`
            INSERT OR IGNORE INTO sub2api_raid_usage_records (
              id, connection_id, remote_usage_id, sub2api_user_id, subscription_group_id,
              actual_cost, occurred_at, imported_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            id("raid-usage"), connectionId, remoteId, userId, subscriptionGroupId,
            actualCost, occurredAt, now()
          );
          imported += result.changes;
        }
        page += 1;
      } while (page <= pages && !reachedBoundary);

      let bossesSettled = 0;
      let replay = rebuildCurrentBoss(getCampaign(campaign.id));
      if (replay.defeated && replay.stableSyncCount >= 2) {
        const activeCampaign = getCampaign(campaign.id);
        const boss = getBoss(activeCampaign.current_boss_id);
        if (settleBoss(activeCampaign, boss)) bossesSettled += 1;
        const nextCampaign = getCampaign(campaign.id);
        if (["active", "settling"].includes(nextCampaign.status)) replay = rebuildCurrentBoss(nextCampaign);
      }
      const syncedAt = now();
      db.prepare(`
        INSERT INTO sub2api_raid_usage_sync (connection_id, cursor, last_synced_at, last_error, updated_at)
        VALUES (?, ?, ?, NULL, ?)
        ON CONFLICT(connection_id) DO UPDATE SET cursor = excluded.cursor,
          last_synced_at = excluded.last_synced_at, last_error = NULL, updated_at = excluded.updated_at
      `).run(connectionId, highestCursor || null, syncedAt, syncedAt);
      await deliverPendingRewards(campaign.id);
      return {
        imported,
        cursor: highestCursor,
        bossesSettled,
        pendingSettlement: Boolean(replay.defeated),
        stableSyncCount: Number(replay.stableSyncCount || 0)
      };
    } catch (error) {
      const failedAt = now();
      db.prepare(`
        INSERT INTO sub2api_raid_usage_sync (connection_id, cursor, last_error, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(connection_id) DO UPDATE SET last_error = excluded.last_error, updated_at = excluded.updated_at
      `).run(connectionId, highestCursor || null, error.message || "用量同步失败", failedAt);
      throw error;
    }
  }

  function serializeReward(row) {
    return {
      id: row.id,
      campaignId: row.campaign_id,
      bossId: row.boss_id,
      settlementId: row.settlement_id,
      userId: row.sub2api_user_id,
      scope: row.reward_scope,
      originalRank: row.original_rank === null ? null : Number(row.original_rank),
      finalRank: row.final_rank === null ? null : Number(row.final_rank),
      reward: parseJson(row.reward_snapshot, null),
      fulfillmentMode: row.fulfillment_mode,
      status: row.status,
      cost: Number(row.cost),
      errorMessage: row.error_message || "",
      dispositionReason: row.disposition_reason || "",
      dispositionBy: row.disposition_by || "",
      createdAt: row.created_at,
      deliveredAt: row.delivered_at || null
    };
  }

  function buildBossHistory(campaign, boss, userId = "", { admin = false, includeActive = false } = {}) {
    const settlement = db.prepare("SELECT * FROM sub2api_raid_settlements WHERE boss_id = ?").get(boss.id);
    const finalized = Boolean(settlement) || ["ended", "aborted"].includes(boss.status);
    if (!finalized && !includeActive) return null;

    const ranking = settlement ? parseJson(settlement.ranking_snapshot, []) : getRanking(boss.id);
    const enrollments = new Map(db.prepare(`
      SELECT sub2api_user_id, email, username, masked_name
      FROM sub2api_raid_enrollments WHERE campaign_id = ?
    `).all(campaign.id).map((row) => [row.sub2api_user_id, row]));
    const publicRanking = ranking.slice(0, 10).map((item) => ({
      ...item,
      userId: item.userId === userId ? item.userId : undefined
    }));
    const adminRanking = ranking.map((item) => {
      const enrollment = enrollments.get(item.userId);
      return {
        ...item,
        identity: {
          userId: item.userId,
          username: enrollment?.username || "",
          email: enrollment?.email || "",
          maskedName: enrollment?.masked_name || item.maskedName
        }
      };
    });
    const rewardRows = settlement
      ? db.prepare("SELECT * FROM sub2api_raid_rewards WHERE settlement_id = ? ORDER BY reward_scope, final_rank, created_at").all(settlement.id)
      : [];
    const finalWinners = rewardRows
      .filter((row) => row.reward_scope === "mvp" && row.status !== "disqualified")
      .map((row) => {
        const enrollment = enrollments.get(row.sub2api_user_id);
        return {
          rank: Number(row.final_rank),
          maskedName: enrollment?.masked_name || maskIdentity({ userId: row.sub2api_user_id }),
          userId: row.sub2api_user_id === userId || admin ? row.sub2api_user_id : undefined,
          status: row.status,
          reward: parseJson(row.reward_snapshot, null)
        };
      });
    const own = ranking.find((item) => item.userId === userId) || null;

    return {
      settlementId: settlement?.id || null,
      boss: serializeBoss(boss),
      finalized,
      defeatedAt: settlement?.defeated_at || boss.defeated_at || null,
      totalDamage: Number(settlement?.total_damage ?? serializeBoss(boss).totalDamage),
      effectiveRaiderCount: Number(settlement?.effective_raider_count ?? ranking.filter((item) => item.effective).length),
      mvpSlots: Number(settlement?.mvp_slots ?? getRaidMvpSlots(ranking.filter((item) => item.effective).length)),
      ranking: admin ? adminRanking : publicRanking,
      own,
      finalWinners,
      ...(admin ? {
        rewards: rewardRows.map(serializeReward),
        disqualifications: settlement ? db.prepare(`
          SELECT * FROM sub2api_raid_disqualifications
          WHERE settlement_id = ? ORDER BY created_at ASC
        `).all(settlement.id).map((row) => ({
          userId: row.sub2api_user_id,
          originalRank: Number(row.original_rank),
          reason: row.reason,
          evidence: row.evidence || "",
          replacementUserId: row.replacement_user_id || null,
          createdBy: row.created_by,
          createdAt: row.created_at
        })) : []
      } : {})
    };
  }

  function buildCampaignHistory(campaign, userId = "", options = {}) {
    const bosses = db.prepare(`
      SELECT * FROM sub2api_raid_bosses WHERE campaign_id = ? ORDER BY sequence ASC
    `).all(campaign.id);
    return bosses.map((boss) => buildBossHistory(campaign, boss, userId, options)).filter(Boolean);
  }

  function listPublicHistory(identity) {
    const campaigns = db.prepare(`
      SELECT * FROM sub2api_raid_campaigns
      WHERE connection_id = ? AND status <> 'draft' AND start_at <= ?
      ORDER BY start_at DESC LIMIT 12
    `).all(identity.connectionId, now());
    return campaigns.map((campaign) => ({
      campaign: {
        id: campaign.id,
        name: campaign.name,
        month: campaign.month,
        status: campaign.status
      },
      bosses: buildCampaignHistory(campaign, String(identity.userId))
    })).filter((item) => item.bosses.length);
  }

  function getPublicLeaderboard(identity, bossId) {
    const boss = db.prepare(`
      SELECT b.* FROM sub2api_raid_bosses b
      INNER JOIN sub2api_raid_campaigns c ON c.id = b.campaign_id
      WHERE b.id = ? AND c.connection_id = ? AND c.status <> 'draft' AND c.start_at <= ?
    `).get(bossId, identity.connectionId, now());
    if (!boss || boss.status === "locked") {
      throw Object.assign(new Error("Boss 排行榜不存在或尚未开放"), { statusCode: 404 });
    }
    const campaign = getCampaign(boss.campaign_id);
    return {
      campaign: { id: campaign.id, name: campaign.name, month: campaign.month, status: campaign.status },
      ...buildBossHistory(campaign, boss, String(identity.userId), { includeActive: true })
    };
  }

  function buildBootstrap(identity) {
    const campaign = findVisibleCampaign(identity.connectionId);
    if (!campaign) return { campaign: null, enrollment: null, currentBoss: null, ranking: [], battleLog: [], rewards: [], history: [], sync: null };
    const userId = String(identity.userId);
    const enrollment = db.prepare(`
      SELECT * FROM sub2api_raid_enrollments WHERE campaign_id = ? AND sub2api_user_id = ?
    `).get(campaign.id, userId);
    const currentBoss = campaign.current_boss_id ? getBoss(campaign.current_boss_id) : null;
    const ranking = currentBoss ? getRanking(currentBoss.id) : [];
    const effectiveRaiders = ranking.filter((item) => item.effective).length;
    const own = ranking.find((item) => item.userId === userId) || null;
    const battleLog = currentBoss ? db.prepare(`
      SELECT d.*, e.masked_name FROM sub2api_raid_damage_assignments d
      LEFT JOIN sub2api_raid_enrollments e
        ON e.campaign_id = d.campaign_id AND e.sub2api_user_id = d.sub2api_user_id
      WHERE d.boss_id = ? ORDER BY d.occurred_at DESC, d.remote_usage_id DESC LIMIT 20
    `).all(currentBoss.id).map((row) => ({
      id: row.id,
      maskedName: row.masked_name || maskIdentity({ userId: row.sub2api_user_id }),
      actualCost: Number(row.actual_cost),
      bonusDamage: Number(row.bonus_damage),
      damage: Number(row.damage),
      multiplier: Number(row.multiplier),
      occurredAt: row.occurred_at,
      own: row.sub2api_user_id === userId
    })) : [];
    const rewards = db.prepare(`
      SELECT * FROM sub2api_raid_rewards WHERE campaign_id = ? AND sub2api_user_id = ? ORDER BY created_at DESC
    `).all(campaign.id, userId).map(serializeReward);
    const sync = db.prepare("SELECT * FROM sub2api_raid_usage_sync WHERE connection_id = ?").get(identity.connectionId);
    return {
      campaign: serializeCampaign(campaign),
      enrollment: enrollment ? { enrolledAt: enrollment.enrolled_at, maskedName: enrollment.masked_name } : null,
      currentBoss: serializeBoss(currentBoss),
      effectiveRaiderCount: effectiveRaiders,
      mvpSlots: getRaidMvpSlots(effectiveRaiders),
      nextMvpSlotAt: effectiveRaiders >= 30 ? null : (Math.floor(effectiveRaiders / 10) + 1) * 10,
      ranking: ranking.slice(0, 10).map((item) => ({ ...item, userId: item.userId === userId ? item.userId : undefined })),
      own,
      battleLog,
      rewards,
      history: buildCampaignHistory(campaign, userId),
      sync: sync ? {
        lastSyncedAt: sync.last_synced_at || null,
        error: sync.last_error || ""
      } : null
    };
  }

  function listCampaigns(query = {}) {
    const connectionId = String(query.connectionId || "").trim();
    const rows = connectionId
      ? db.prepare("SELECT * FROM sub2api_raid_campaigns WHERE connection_id = ? ORDER BY start_at DESC").all(connectionId)
      : db.prepare("SELECT * FROM sub2api_raid_campaigns ORDER BY start_at DESC").all();
    return rows.map((row) => {
      const rewards = db.prepare(`
        SELECT status, COUNT(*) AS count FROM sub2api_raid_rewards WHERE campaign_id = ? GROUP BY status
      `).all(row.id);
      const sync = db.prepare("SELECT * FROM sub2api_raid_usage_sync WHERE connection_id = ?").get(row.connection_id);
      return {
        ...serializeCampaign(row, { includeExcluded: true }),
        rewardCounts: Object.fromEntries(rewards.map((item) => [item.status, Number(item.count)])),
        sync: sync ? { cursor: sync.cursor || "", lastSyncedAt: sync.last_synced_at || null, error: sync.last_error || "" } : null
      };
    });
  }

  function abortCampaign(campaignId, input, actor) {
    const parsed = abortSchema.safeParse(input);
    if (!parsed.success) {
      const error = new Error("中止活动必须填写原因");
      error.statusCode = 400;
      throw error;
    }
    const campaign = getCampaign(campaignId);
    if (!campaign || !["scheduled", "active", "settling"].includes(campaign.status)) {
      const error = new Error("当前活动不能中止");
      error.statusCode = 409;
      throw error;
    }
    const endedAt = now();
    db.transaction(() => {
      db.prepare(`
        UPDATE sub2api_raid_campaigns
        SET status = 'aborted', abort_reason = ?, ended_at = ?, updated_at = ? WHERE id = ?
      `).run(parsed.data.reason, endedAt, endedAt, campaign.id);
      if (campaign.current_boss_id) {
        db.prepare(`
          UPDATE sub2api_raid_bosses SET status = 'aborted', updated_at = ?
          WHERE id = ? AND status IN ('active', 'settling')
        `).run(endedAt, campaign.current_boss_id);
      }
    })();
    createAuditLog({
      action: "sub2api.raid.campaign.abort",
      actor,
      resourceType: "sub2api_raid_campaign",
      resourceId: campaign.id,
      detail: { reason: parsed.data.reason }
    });
    return getCampaign(campaign.id);
  }

  async function dispositionReward(rewardId, input, actor) {
    const parsed = dispositionSchema.safeParse(input);
    if (!parsed.success) {
      const error = new Error("奖励处置参数无效");
      error.statusCode = 400;
      throw error;
    }
    let reward = db.prepare("SELECT * FROM sub2api_raid_rewards WHERE id = ?").get(rewardId);
    if (!reward) {
      const error = new Error("奖励记录不存在");
      error.statusCode = 404;
      throw error;
    }
    const updatedAt = now();
    if (parsed.data.action === "approve") {
      if (reward.status !== "awaiting_review") throw Object.assign(new Error("只有待审核奖励可以通过"), { statusCode: 409 });
      db.prepare(`
        UPDATE sub2api_raid_rewards SET status = 'pending', disposition_reason = ?,
          disposition_by = ?, updated_at = ? WHERE id = ?
      `).run(parsed.data.reason, actor, updatedAt, reward.id);
      reward = await deliverReward(reward.id);
    } else if (parsed.data.action === "retry") {
      if (reward.status !== "delivery_failed") throw Object.assign(new Error("只有发放失败奖励可以重试"), { statusCode: 409 });
      reward = await deliverReward(reward.id);
    } else {
      const allowed = parsed.data.action === "confirm"
        ? ["delivery_failed"]
        : ["awaiting_review", "pending", "delivery_failed"];
      if (!allowed.includes(reward.status)) {
        throw Object.assign(new Error("当前奖励状态不能执行此处置"), { statusCode: 409 });
      }
      const status = parsed.data.action === "confirm" ? "delivered" : "voided";
      db.prepare(`
        UPDATE sub2api_raid_rewards SET status = ?, disposition_reason = ?, disposition_by = ?,
          delivered_at = CASE WHEN ? = 'delivered' THEN ? ELSE delivered_at END, updated_at = ? WHERE id = ?
      `).run(status, parsed.data.reason, actor, status, updatedAt, updatedAt, reward.id);
      reward = db.prepare("SELECT * FROM sub2api_raid_rewards WHERE id = ?").get(reward.id);
    }
    createAuditLog({
      action: `sub2api.raid.reward.${parsed.data.action}`,
      actor,
      resourceType: "sub2api_raid_reward",
      resourceId: reward.id,
      detail: { reason: parsed.data.reason, status: reward.status }
    });
    return reward;
  }

  function disqualifyWinner(settlementId, input, actor) {
    const parsed = disqualifySchema.safeParse(input);
    if (!parsed.success) throw Object.assign(new Error("取消资格参数无效"), { statusCode: 400 });
    const settlement = db.prepare("SELECT * FROM sub2api_raid_settlements WHERE id = ?").get(settlementId);
    if (!settlement) throw Object.assign(new Error("结算快照不存在"), { statusCode: 404 });
    const originalReward = db.prepare(`
      SELECT * FROM sub2api_raid_rewards
      WHERE settlement_id = ? AND sub2api_user_id = ? AND reward_scope = 'mvp'
    `).get(settlement.id, parsed.data.userId);
    if (!originalReward) throw Object.assign(new Error("该用户不是本次 MVP 获奖者"), { statusCode: 404 });
    if (originalReward.status === "delivered") throw Object.assign(new Error("已发放奖励不能直接取消资格"), { statusCode: 409 });
    const ranking = parseJson(settlement.ranking_snapshot, []);
    const awarded = new Set(db.prepare(`
      SELECT sub2api_user_id FROM sub2api_raid_rewards
      WHERE settlement_id = ? AND reward_scope = 'mvp' AND status <> 'disqualified'
    `).all(settlement.id).map((row) => row.sub2api_user_id));
    const disqualified = new Set(db.prepare(`
      SELECT sub2api_user_id FROM sub2api_raid_disqualifications WHERE settlement_id = ?
    `).all(settlement.id).map((row) => row.sub2api_user_id));
    awarded.delete(parsed.data.userId);
    disqualified.add(parsed.data.userId);
    const replacement = ranking.find((item) => item.effective
      && !awarded.has(item.userId) && !disqualified.has(item.userId));
    const createdAt = now();
    let replacementRewardId = null;
    db.transaction(() => {
      db.prepare(`
        UPDATE sub2api_raid_rewards SET status = 'disqualified', disposition_reason = ?,
          disposition_by = ?, updated_at = ? WHERE id = ?
      `).run(parsed.data.reason, actor, createdAt, originalReward.id);
      if (replacement) {
        const reward = parseJson(originalReward.reward_snapshot, null);
        replacementRewardId = id("raid-reward");
        db.prepare(`
          INSERT INTO sub2api_raid_rewards (
            id, campaign_id, boss_id, settlement_id, sub2api_user_id, reward_scope,
            original_rank, final_rank, reward_snapshot, fulfillment_mode, status,
            cost, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, 'mvp', ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          replacementRewardId, originalReward.campaign_id, originalReward.boss_id, settlement.id,
          replacement.userId, replacement.rank, originalReward.final_rank, originalReward.reward_snapshot,
          originalReward.fulfillment_mode,
          originalReward.fulfillment_mode === "auto" ? "pending" : "awaiting_review",
          originalReward.cost, createdAt, createdAt
        );
      }
      db.prepare(`
        INSERT INTO sub2api_raid_disqualifications (
          id, campaign_id, boss_id, settlement_id, sub2api_user_id, original_rank,
          reason, evidence, replacement_user_id, created_by, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id("raid-disqualification"), settlement.campaign_id, settlement.boss_id, settlement.id,
        parsed.data.userId, originalReward.original_rank, parsed.data.reason, parsed.data.evidence || null,
        replacement?.userId || null, actor, createdAt
      );
    })();
    createAuditLog({
      action: "sub2api.raid.winner.disqualify",
      actor,
      resourceType: "sub2api_raid_settlement",
      resourceId: settlement.id,
      detail: { userId: parsed.data.userId, replacementUserId: replacement?.userId || null, reason: parsed.data.reason }
    });
    return { replacement, replacementRewardId };
  }

  async function runMaintenance() {
    const at = now();
    const scheduled = db.prepare(`
      SELECT * FROM sub2api_raid_campaigns WHERE status = 'scheduled' AND start_at <= ? AND end_at > ?
    `).all(at, at);
    for (const campaign of scheduled) {
      db.transaction(() => {
        db.prepare("UPDATE sub2api_raid_campaigns SET status = 'active', updated_at = ? WHERE id = ?")
          .run(at, campaign.id);
        db.prepare(`
          UPDATE sub2api_raid_bosses SET status = 'active', started_at = ?, updated_at = ?
          WHERE id = ? AND status = 'locked'
        `).run(at, at, campaign.current_boss_id);
      })();
    }
    const due = db.prepare(`
      SELECT * FROM sub2api_raid_campaigns WHERE status = 'active' AND end_at <= ?
    `).all(at);
    for (const campaign of due) {
      db.prepare("UPDATE sub2api_raid_campaigns SET status = 'settling', updated_at = ? WHERE id = ?")
        .run(at, campaign.id);
    }
    const syncTargets = db.prepare(`
      SELECT DISTINCT connection_id FROM sub2api_raid_campaigns WHERE status IN ('active', 'settling')
    `).all();
    let synced = 0;
    const syncFailures = new Set();
    for (const target of syncTargets) {
      try {
        await syncUsage(target.connection_id);
        synced += 1;
      } catch (error) {
        syncFailures.add(target.connection_id);
        if (error.statusCode !== 409) {
          console.error(`[sub2api-raid-sync:${target.connection_id}]`, error);
        }
      }
    }
    await maintainRateEntitlements(at);
    const expired = db.prepare(`
      SELECT * FROM sub2api_raid_campaigns WHERE status = 'settling' AND settlement_end_at <= ?
    `).all(at);
    let ended = 0;
    for (const campaign of expired) {
      if (syncFailures.has(campaign.connection_id)) continue;
      const bossCount = Number(db.prepare(`
        SELECT COUNT(*) AS count FROM sub2api_raid_bosses WHERE campaign_id = ?
      `).get(campaign.id).count);
      for (let attempt = 0; attempt < bossCount * 2; attempt += 1) {
        const latest = getCampaign(campaign.id);
        const boss = latest?.current_boss_id ? getBoss(latest.current_boss_id) : null;
        if (latest?.status !== "settling" || boss?.status !== "settling") break;
        try {
          await syncUsage(campaign.connection_id);
          synced += 1;
        } catch (error) {
          syncFailures.add(campaign.connection_id);
          if (error.statusCode !== 409) console.error(`[sub2api-raid-final-sync:${campaign.connection_id}]`, error);
          break;
        }
      }
      const endingCampaign = getCampaign(campaign.id);
      if (syncFailures.has(campaign.connection_id) || endingCampaign?.status !== "settling") continue;
      db.transaction(() => {
        db.prepare(`
          UPDATE sub2api_raid_campaigns SET status = 'ended', ended_at = ?, updated_at = ? WHERE id = ?
        `).run(at, at, campaign.id);
        if (endingCampaign.current_boss_id) {
          db.prepare(`
            UPDATE sub2api_raid_bosses SET status = 'ended', updated_at = ?
            WHERE id = ? AND status IN ('active', 'settling')
          `).run(at, endingCampaign.current_boss_id);
        }
      })();
      ended += 1;
    }
    await deliverPendingRewards();
    return { activated: scheduled.length, settling: due.length, ended, synced };
  }

  app.post("/api/admin/sub2api/raid/campaigns", { preHandler: requireAdmin }, async (request, reply) => {
    try {
      return reply.code(201).send({ campaign: serializeCampaign(createCampaign(parseBody(request), request.admin?.username || "admin"), { includeExcluded: true }) });
    } catch (error) {
      return reply.code(error.statusCode || 400).send({ message: error.message });
    }
  });

  app.get("/api/admin/sub2api/raid/campaigns", { preHandler: requireAdmin }, async (request) => ({ items: listCampaigns(request.query) }));

  app.get("/api/admin/sub2api/raid/campaigns/:id/history", { preHandler: requireAdmin }, async (request, reply) => {
    const campaign = getCampaign(request.params.id);
    if (!campaign) return reply.code(404).send({ message: "Boss 活动不存在" });
    return {
      campaign: serializeCampaign(campaign, { includeExcluded: true }),
      bosses: buildCampaignHistory(campaign, "", { admin: true })
    };
  });

  app.post("/api/admin/sub2api/raid/campaigns/:id/config", { preHandler: requireAdmin }, async (request, reply) => {
    try {
      return { campaign: serializeCampaign(updateDraftCampaign(request.params.id, parseBody(request), request.admin?.username || "admin"), { includeExcluded: true }) };
    } catch (error) {
      return reply.code(error.statusCode || 400).send({ message: error.message });
    }
  });

  app.post("/api/admin/sub2api/raid/campaigns/:id/publish", { preHandler: requireAdmin }, async (request, reply) => {
    try {
      return { campaign: serializeCampaign(publishCampaign(request.params.id, request.admin?.username || "admin"), { includeExcluded: true }) };
    } catch (error) {
      return reply.code(error.statusCode || 400).send({ message: error.message });
    }
  });

  app.post("/api/admin/sub2api/raid/campaigns/:id/abort", { preHandler: requireAdmin }, async (request, reply) => {
    try {
      return { campaign: serializeCampaign(abortCampaign(request.params.id, parseBody(request), request.admin?.username || "admin"), { includeExcluded: true }) };
    } catch (error) {
      return reply.code(error.statusCode || 400).send({ message: error.message });
    }
  });

  app.post("/api/admin/sub2api/raid/connections/:id/sync-usage", { preHandler: requireAdmin }, async (request, reply) => {
    try {
      return await syncUsage(request.params.id);
    } catch (error) {
      return reply.code(error.statusCode || 502).send({ message: error.message || "Boss 用量同步失败" });
    }
  });

  app.get("/api/admin/sub2api/raid/rewards", { preHandler: requireAdmin }, async (request) => {
    const status = String(request.query?.status || "").trim();
    const rows = status
      ? db.prepare("SELECT * FROM sub2api_raid_rewards WHERE status = ? ORDER BY created_at DESC LIMIT 500").all(status)
      : db.prepare("SELECT * FROM sub2api_raid_rewards ORDER BY created_at DESC LIMIT 500").all();
    return { items: rows.map(serializeReward) };
  });

  app.post("/api/admin/sub2api/raid/rewards/:id/disposition", { preHandler: requireAdmin }, async (request, reply) => {
    try {
      return { reward: serializeReward(await dispositionReward(request.params.id, parseBody(request), request.admin?.username || "admin")) };
    } catch (error) {
      return reply.code(error.statusCode || 400).send({ message: error.message });
    }
  });

  app.post("/api/admin/sub2api/raid/settlements/:id/disqualify", { preHandler: requireAdmin }, async (request, reply) => {
    try {
      return disqualifyWinner(request.params.id, parseBody(request), request.admin?.username || "admin");
    } catch (error) {
      return reply.code(error.statusCode || 400).send({ message: error.message });
    }
  });

  app.get("/api/public/sub2api/raid/bootstrap", { preHandler: requireSession }, async (request) => buildBootstrap(request.sub2apiRaid));

  app.get("/api/public/sub2api/raid/leaderboard", { preHandler: requireSession }, async (request, reply) => {
    try {
      return getPublicLeaderboard(request.sub2apiRaid, String(request.query?.bossId || ""));
    } catch (error) {
      return reply.code(error.statusCode || 400).send({ message: error.message });
    }
  });

  app.get("/api/public/sub2api/raid/history", { preHandler: requireSession }, async (request) => ({
    items: listPublicHistory(request.sub2apiRaid)
  }));

  app.post("/api/public/sub2api/raid/enroll", { preHandler: requireSession }, async (request, reply) => {
    try {
      await enroll(request.sub2apiRaid);
      return reply.code(201).send(buildBootstrap(request.sub2apiRaid));
    } catch (error) {
      return reply.code(error.statusCode || 400).send({ message: error.message });
    }
  });

  return {
    buildBootstrap,
    createCampaign,
    updateDraftCampaign,
    publishCampaign,
    enroll,
    syncUsage,
    deliverPendingRewards,
    runMaintenance,
    getRanking,
    listPublicHistory
  };
}
