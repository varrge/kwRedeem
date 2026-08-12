import { z } from "zod";

const SOURCES = ["subscription_purchase", "balance_consumption"];
const PRIZE_TYPES = ["balance", "extra_draw", "empty"];
const RARITIES = ["common", "rare", "epic", "legendary"];

const eligibilityRulesSchema = z.array(z.object({
  source: z.enum(SOURCES),
  threshold: z.number().finite().positive()
})).min(1);

const prizesSchema = z.array(z.object({
  name: z.string().trim().min(1).max(100),
  type: z.enum(PRIZE_TYPES),
  amount: z.number().finite().nonnegative().optional(),
  weight: z.number().finite().positive(),
  rarity: z.enum(RARITIES),
  displayText: z.string().trim().max(200).optional().default(""),
  icon: z.string().trim().max(500).optional().default(""),
  sortOrder: z.number().int().optional().default(0)
})).min(1);

function validateConfig(value, context) {
  if (new Set(value.eligibilityRules.map((rule) => rule.source)).size !== value.eligibilityRules.length) {
    context.addIssue({ code: "custom", path: ["eligibilityRules"], message: "同一消费来源只能配置一条规则" });
  }
  value.prizes.forEach((prize, index) => {
    if (prize.type === "balance" && !(Number(prize.amount) > 0)) {
      context.addIssue({ code: "custom", path: ["prizes", index, "amount"], message: "余额奖品金额必须大于 0" });
    }
  });
}

const campaignSchema = z.object({
  connectionId: z.string().trim().min(1),
  name: z.string().trim().min(1).max(100),
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
  eligibilityRules: eligibilityRulesSchema,
  prizes: prizesSchema
}).superRefine((value, context) => {
  if (Date.parse(value.endAt) <= Date.parse(value.startAt)) {
    context.addIssue({ code: "custom", path: ["endAt"], message: "结束时间必须晚于开始时间" });
  }
  validateConfig(value, context);
});

const configSchema = z.object({
  eligibilityRules: eligibilityRulesSchema,
  prizes: prizesSchema
}).superRefine(validateConfig);

const drawSchema = z.object({
  requestId: z.string().trim().min(8).max(100)
});

const manualGrantSchema = z.object({
  campaignId: z.string().trim().min(1),
  userId: z.union([z.string(), z.number()]).transform((value) => String(value).trim()).pipe(z.string().min(1)),
  email: z.string().trim().email().optional().default(""),
  quantity: z.number().int().min(1).max(100),
  reason: z.string().trim().min(2).max(500)
});

const dispositionSchema = z.object({
  action: z.enum(["retry", "confirm", "void"]),
  reason: z.string().trim().min(2).max(500)
});

const endCampaignSchema = z.object({
  reason: z.string().trim().min(2).max(500)
});

function roundAmount(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100_000_000) / 100_000_000;
}

function parseBody(request) {
  return request?.body && typeof request.body === "object" ? request.body : {};
}

export function createSub2ApiShakeService({
  app,
  db,
  requireAdmin,
  requireSession,
  createAuditLog = () => {},
  now = () => new Date().toISOString(),
  id = (prefix) => `${prefix}-${crypto.randomUUID()}`,
  random = Math.random,
  creditBalance = async () => { throw new Error("Sub2api 余额奖励适配器未配置"); },
  listUsagePage = async () => { throw new Error("Sub2api 用量同步适配器未配置"); }
}) {
  function getCampaign(campaignId) {
    return db.prepare("SELECT * FROM sub2api_shake_campaigns WHERE id = ?").get(campaignId);
  }

  function serializeCampaign(row) {
    return row ? {
      id: row.id,
      connectionId: row.connection_id,
      name: row.name,
      status: row.status,
      startAt: row.start_at,
      endAt: row.end_at,
      activeConfigVersionId: row.active_config_version_id || null
    } : null;
  }

  function serializePrize(row, totalWeight = 0) {
    return {
      id: row.id,
      name: row.name,
      type: row.type,
      amount: row.amount === null ? null : Number(row.amount),
      weight: Number(row.weight),
      probability: totalWeight > 0
        ? roundAmount((Number(row.weight) / totalWeight) * 100)
        : 0,
      rarity: row.rarity,
      displayText: row.display_text || "",
      icon: row.icon || "",
      sortOrder: Number(row.sort_order)
    };
  }

  function listCampaigns(query = {}) {
    const conditions = [];
    const params = [];
    const connectionId = String(query.connectionId || "").trim();
    if (connectionId) {
      conditions.push("connection_id = ?");
      params.push(connectionId);
    }
    const status = String(query.status || "").trim();
    if (status) {
      conditions.push("status = ?");
      params.push(status);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    return db.prepare(`
      SELECT * FROM sub2api_shake_campaigns ${where}
      ORDER BY created_at DESC
    `).all(...params).map((campaign) => {
      const version = db.prepare(`
        SELECT version FROM sub2api_shake_config_versions WHERE id = ?
      `).get(campaign.active_config_version_id);
      const rules = db.prepare(`
        SELECT source, threshold FROM sub2api_shake_eligibility_rules
        WHERE config_version_id = ? ORDER BY rowid ASC
      `).all(campaign.active_config_version_id);
      const prizes = db.prepare(`
        SELECT * FROM sub2api_shake_prizes
        WHERE config_version_id = ? AND status = 'active'
        ORDER BY sort_order ASC, created_at ASC
      `).all(campaign.active_config_version_id);
      const totalWeight = prizes.reduce((sum, prize) => sum + Number(prize.weight), 0);
      const cardRows = db.prepare(`
        SELECT status, COUNT(*) AS count FROM sub2api_shake_cards
        WHERE campaign_id = ? GROUP BY status
      `).all(campaign.id);
      const cardTotals = { available: 0, reserved: 0, consumed: 0, expired: 0 };
      for (const row of cardRows) {
        if (Object.hasOwn(cardTotals, row.status)) cardTotals[row.status] = Number(row.count);
      }
      return {
        ...serializeCampaign(campaign),
        configVersion: Number(version?.version || 0),
        eligibilityRules: rules.map((rule) => ({
          source: rule.source,
          threshold: Number(rule.threshold)
        })),
        prizes: prizes.map((prize) => serializePrize(prize, totalWeight)),
        cardTotals
      };
    });
  }

  function findActiveCampaign(connectionId, at = now()) {
    return db.prepare(`
      SELECT * FROM sub2api_shake_campaigns
      WHERE connection_id = ? AND status = 'active' AND start_at <= ? AND end_at > ?
      ORDER BY start_at DESC
      LIMIT 1
    `).get(connectionId, at, at);
  }

  function createCampaign(input, actor) {
    const parsed = campaignSchema.safeParse(input);
    if (!parsed.success) {
      const error = new Error(parsed.error.issues[0]?.message || "活动配置无效");
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

    const campaignId = id("shake-campaign");
    const configVersionId = id("shake-config");
    const createdAt = now();
    db.transaction(() => {
      db.prepare(`
        INSERT INTO sub2api_shake_campaigns (
          id, connection_id, name, status, start_at, end_at, active_config_version_id,
          created_by, created_at, updated_at
        ) VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?)
      `).run(campaignId, data.connectionId, data.name, data.startAt, data.endAt, configVersionId, actor, createdAt, createdAt);
      db.prepare(`
        INSERT INTO sub2api_shake_config_versions (id, campaign_id, version, created_by, created_at)
        VALUES (?, ?, 1, ?, ?)
      `).run(configVersionId, campaignId, actor, createdAt);
      const insertRule = db.prepare(`
        INSERT INTO sub2api_shake_eligibility_rules (id, config_version_id, source, threshold, created_at)
        VALUES (?, ?, ?, ?, ?)
      `);
      for (const rule of data.eligibilityRules) {
        insertRule.run(id("shake-rule"), configVersionId, rule.source, rule.threshold, createdAt);
      }
      const insertPrize = db.prepare(`
        INSERT INTO sub2api_shake_prizes (
          id, config_version_id, name, type, amount, weight, rarity,
          display_text, icon, sort_order, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)
      `);
      for (const prize of data.prizes) {
        insertPrize.run(
          id("shake-prize"), configVersionId, prize.name, prize.type,
          prize.type === "balance" ? prize.amount : null,
          prize.weight, prize.rarity, prize.displayText || null, prize.icon || null,
          prize.sortOrder, createdAt
        );
      }
    })();
    return getCampaign(campaignId);
  }

  function activateCampaign(campaignId, actor) {
    const campaign = getCampaign(campaignId);
    if (!campaign) {
      const error = new Error("摇摇乐活动不存在");
      error.statusCode = 404;
      throw error;
    }
    if (campaign.status !== "draft" && campaign.status !== "scheduled") {
      const error = new Error("只有草稿或待开始活动可以启用");
      error.statusCode = 409;
      throw error;
    }
    const conflict = db.prepare(`
      SELECT id FROM sub2api_shake_campaigns
      WHERE connection_id = ? AND status IN ('active', 'scheduled') AND id <> ?
        AND start_at < ? AND end_at > ?
      LIMIT 1
    `).get(campaign.connection_id, campaign.id, campaign.end_at, campaign.start_at);
    if (conflict) {
      const error = new Error("该 Sub2api 连接已有进行中的摇摇乐活动");
      error.statusCode = 409;
      throw error;
    }
    const updatedAt = now();
    const status = campaign.start_at > updatedAt ? "scheduled" : "active";
    db.prepare("UPDATE sub2api_shake_campaigns SET status = ?, updated_at = ? WHERE id = ?")
      .run(status, updatedAt, campaign.id);
    createAuditLog({
      action: "sub2api.shake.campaign.activate",
      actor,
      resourceType: "sub2api_shake_campaign",
      resourceId: campaign.id,
      detail: { connectionId: campaign.connection_id, status }
    });
    return getCampaign(campaign.id);
  }

  function createConfigVersion(campaignId, input, actor) {
    const parsed = configSchema.safeParse(input);
    if (!parsed.success) {
      const error = new Error(parsed.error.issues[0]?.message || "活动配置无效");
      error.statusCode = 400;
      throw error;
    }
    const campaign = getCampaign(campaignId);
    if (!campaign) {
      const error = new Error("摇摇乐活动不存在");
      error.statusCode = 404;
      throw error;
    }
    if (campaign.status === "ended") {
      const error = new Error("已结束活动不能修改配置");
      error.statusCode = 409;
      throw error;
    }
    const current = db.prepare(`
      SELECT MAX(version) AS version FROM sub2api_shake_config_versions WHERE campaign_id = ?
    `).get(campaign.id);
    const version = Number(current?.version || 0) + 1;
    const configVersionId = id("shake-config");
    const createdAt = now();
    db.transaction(() => {
      db.prepare(`
        INSERT INTO sub2api_shake_config_versions (id, campaign_id, version, created_by, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(configVersionId, campaign.id, version, actor, createdAt);
      const insertRule = db.prepare(`
        INSERT INTO sub2api_shake_eligibility_rules (id, config_version_id, source, threshold, created_at)
        VALUES (?, ?, ?, ?, ?)
      `);
      for (const rule of parsed.data.eligibilityRules) {
        insertRule.run(id("shake-rule"), configVersionId, rule.source, rule.threshold, createdAt);
      }
      const insertPrize = db.prepare(`
        INSERT INTO sub2api_shake_prizes (
          id, config_version_id, name, type, amount, weight, rarity,
          display_text, icon, sort_order, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)
      `);
      for (const prize of parsed.data.prizes) {
        insertPrize.run(
          id("shake-prize"), configVersionId, prize.name, prize.type,
          prize.type === "balance" ? prize.amount : null,
          prize.weight, prize.rarity, prize.displayText || null, prize.icon || null,
          prize.sortOrder, createdAt
        );
      }
      db.prepare(`
        UPDATE sub2api_shake_campaigns
        SET active_config_version_id = ?, updated_at = ?
        WHERE id = ?
      `).run(configVersionId, createdAt, campaign.id);
    })();
    createAuditLog({
      action: "sub2api.shake.config.create",
      actor,
      resourceType: "sub2api_shake_config_version",
      resourceId: configVersionId,
      detail: { campaignId: campaign.id, version }
    });
    return { id: configVersionId, version };
  }

  function endCampaign(campaignId, input, actor) {
    const parsed = endCampaignSchema.safeParse(input);
    if (!parsed.success) {
      const error = new Error(parsed.error.issues[0]?.message || "请填写结束原因");
      error.statusCode = 400;
      throw error;
    }
    const campaign = getCampaign(campaignId);
    if (!campaign) {
      const error = new Error("摇摇乐活动不存在");
      error.statusCode = 404;
      throw error;
    }
    if (campaign.status === "ended") {
      const error = new Error("活动已经结束");
      error.statusCode = 409;
      throw error;
    }
    const endedAt = now();
    let expiredCards = 0;
    db.transaction(() => {
      expiredCards = db.prepare(`
        UPDATE sub2api_shake_cards
        SET status = 'expired', expired_at = ?
        WHERE campaign_id = ? AND status = 'available'
      `).run(endedAt, campaign.id).changes;
      db.prepare(`
        UPDATE sub2api_shake_campaigns
        SET status = 'ended', ended_at = ?, updated_at = ?
        WHERE id = ?
      `).run(endedAt, endedAt, campaign.id);
    })();
    createAuditLog({
      action: "sub2api.shake.campaign.end",
      actor,
      resourceType: "sub2api_shake_campaign",
      resourceId: campaign.id,
      detail: { reason: parsed.data.reason, expiredCards }
    });
    return { campaign: getCampaign(campaign.id), expiredCards };
  }

  const recordConsumption = db.transaction((input) => {
    const source = String(input.source || "");
    if (!SOURCES.includes(source)) throw new Error("摇摇卡消费来源无效");
    const amount = Number(input.amount);
    if (!Number.isFinite(amount) || amount <= 0) throw new Error("消费金额必须大于 0");
    const occurredAt = input.occurredAt || now();
    const existing = db.prepare(`
      SELECT cards_granted FROM sub2api_shake_consumptions
      WHERE connection_id = ? AND source = ? AND source_id = ?
    `).get(input.connectionId, source, input.sourceId);
    if (existing) return { cardsGranted: 0, duplicate: true };

    const campaign = findActiveCampaign(input.connectionId, occurredAt);
    if (!campaign) return { cardsGranted: 0, accepted: false };
    const rule = db.prepare(`
      SELECT * FROM sub2api_shake_eligibility_rules
      WHERE config_version_id = ? AND source = ?
    `).get(campaign.active_config_version_id, source);
    if (!rule) return { cardsGranted: 0, accepted: false };

    const userId = String(input.userId);
    const progress = db.prepare(`
      SELECT * FROM sub2api_shake_progress
      WHERE campaign_id = ? AND sub2api_user_id = ? AND source = ?
    `).get(campaign.id, userId, source);
    const accumulated = roundAmount(Number(progress?.amount || 0) + amount);
    const cardsGranted = Math.floor((accumulated + 1e-9) / Number(rule.threshold));
    const remainder = roundAmount(accumulated - (cardsGranted * Number(rule.threshold)));
    const consumptionId = id("shake-consumption");
    const createdAt = now();
    db.prepare(`
      INSERT INTO sub2api_shake_consumptions (
        id, connection_id, campaign_id, config_version_id, rule_id,
        sub2api_user_id, email, source, source_id, amount, cards_granted,
        occurred_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      consumptionId, input.connectionId, campaign.id, campaign.active_config_version_id,
      rule.id, userId, input.email || null, source, input.sourceId, amount,
      cardsGranted, occurredAt, createdAt
    );
    if (progress) {
      db.prepare(`
        UPDATE sub2api_shake_progress
        SET amount = ?, cards_earned = cards_earned + ?, updated_at = ?
        WHERE id = ?
      `).run(remainder, cardsGranted, createdAt, progress.id);
    } else {
      db.prepare(`
        INSERT INTO sub2api_shake_progress (
          id, campaign_id, sub2api_user_id, source, amount, cards_earned, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(id("shake-progress"), campaign.id, userId, source, remainder, cardsGranted, createdAt);
    }
    const insertCard = db.prepare(`
      INSERT INTO sub2api_shake_cards (
        id, campaign_id, connection_id, sub2api_user_id, source,
        source_record_id, status, granted_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'available', ?)
    `);
    for (let index = 0; index < cardsGranted; index += 1) {
      insertCard.run(id("shake-card"), campaign.id, input.connectionId, userId, source, consumptionId, createdAt);
    }
    return { cardsGranted, duplicate: false };
  });

  function buildBootstrap(identity) {
    const campaign = findActiveCampaign(identity.connectionId);
    if (!campaign) return { campaign: null, availableCards: 0, progress: [], prizes: [], draws: [] };
    const availableCards = Number(db.prepare(`
      SELECT COUNT(*) AS count FROM sub2api_shake_cards
      WHERE campaign_id = ? AND sub2api_user_id = ? AND status = 'available'
    `).get(campaign.id, String(identity.userId)).count);
    const rules = db.prepare(`
      SELECT * FROM sub2api_shake_eligibility_rules
      WHERE config_version_id = ? ORDER BY rowid ASC
    `).all(campaign.active_config_version_id);
    const progressRows = db.prepare(`
      SELECT * FROM sub2api_shake_progress WHERE campaign_id = ? AND sub2api_user_id = ?
    `).all(campaign.id, String(identity.userId));
    const prizes = db.prepare(`
      SELECT * FROM sub2api_shake_prizes
      WHERE config_version_id = ? AND status = 'active'
      ORDER BY sort_order ASC, created_at ASC
    `).all(campaign.active_config_version_id);
    const totalWeight = prizes.reduce((sum, prize) => sum + Number(prize.weight), 0);
    const draws = db.prepare(`
      SELECT * FROM sub2api_shake_draws
      WHERE campaign_id = ? AND sub2api_user_id = ?
      ORDER BY created_at DESC LIMIT 50
    `).all(campaign.id, String(identity.userId));
    const progressBySource = new Map(progressRows.map((row) => [row.source, row]));
    return {
      campaign: serializeCampaign(campaign),
      availableCards,
      progress: rules.map((rule) => {
        const progress = progressBySource.get(rule.source);
        const amount = Number(progress?.amount || 0);
        return {
          source: rule.source,
          threshold: Number(rule.threshold),
          amount,
          remaining: roundAmount(Math.max(0, Number(rule.threshold) - amount)),
          cardsEarned: Number(progress?.cards_earned || 0)
        };
      }),
      prizes: prizes.map((prize) => serializePrize(prize, totalWeight)),
      draws: draws.map(serializeDraw)
    };
  }

  function serializeDraw(row) {
    return row ? {
      id: row.id,
      requestId: row.request_id,
      campaignId: row.campaign_id,
      connectionId: row.connection_id,
      userId: row.sub2api_user_id,
      email: row.email || "",
      status: row.status,
      prize: {
        id: row.prize_id,
        name: row.prize_name,
        type: row.prize_type,
        amount: row.prize_amount === null ? null : Number(row.prize_amount),
        rarity: row.prize_rarity
      },
      errorMessage: row.error_message || "",
      dispositionReason: row.disposition_reason || "",
      dispositionBy: row.disposition_by || "",
      createdAt: row.created_at,
      deliveredAt: row.delivered_at || null
    } : null;
  }

  function selectPrize(prizes) {
    const totalWeight = prizes.reduce((sum, prize) => sum + Number(prize.weight), 0);
    let cursor = Math.min(Math.max(Number(random()), 0), 0.999999999999) * totalWeight;
    for (const prize of prizes) {
      cursor -= Number(prize.weight);
      if (cursor < 0) return prize;
    }
    return prizes.at(-1);
  }

  function reserveDraw(identity, requestId) {
    const duplicate = db.prepare(`
      SELECT * FROM sub2api_shake_draws
      WHERE connection_id = ? AND sub2api_user_id = ? AND request_id = ?
    `).get(identity.connectionId, String(identity.userId), requestId);
    if (duplicate) return { row: duplicate, duplicate: true };

    const campaign = findActiveCampaign(identity.connectionId);
    if (!campaign) {
      const error = new Error("当前没有进行中的摇摇乐活动");
      error.statusCode = 404;
      throw error;
    }
    const card = db.prepare(`
      SELECT * FROM sub2api_shake_cards
      WHERE campaign_id = ? AND sub2api_user_id = ? AND status = 'available'
      ORDER BY granted_at ASC, rowid ASC
      LIMIT 1
    `).get(campaign.id, String(identity.userId));
    if (!card) {
      const error = new Error("没有可用摇摇卡");
      error.statusCode = 409;
      throw error;
    }
    const prizes = db.prepare(`
      SELECT * FROM sub2api_shake_prizes
      WHERE config_version_id = ? AND status = 'active'
      ORDER BY sort_order ASC, created_at ASC
    `).all(campaign.active_config_version_id);
    if (!prizes.length) {
      const error = new Error("当前活动没有可用奖品");
      error.statusCode = 409;
      throw error;
    }
    const prize = selectPrize(prizes);
    const drawId = id("shake-draw");
    const createdAt = now();
    db.prepare(`
      UPDATE sub2api_shake_cards
      SET status = 'reserved', reserved_at = ?
      WHERE id = ? AND status = 'available'
    `).run(createdAt, card.id);
    db.prepare(`
      INSERT INTO sub2api_shake_draws (
        id, request_id, campaign_id, connection_id, config_version_id, card_id,
        sub2api_user_id, email, prize_id, prize_name, prize_type, prize_amount,
        prize_rarity, prize_pool_snapshot, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'selected', ?, ?)
    `).run(
      drawId, requestId, campaign.id, identity.connectionId, campaign.active_config_version_id,
      card.id, String(identity.userId), identity.email || null, prize.id, prize.name, prize.type,
      prize.amount, prize.rarity, JSON.stringify(prizes.map((item) => ({
        id: item.id,
        name: item.name,
        type: item.type,
        amount: item.amount === null ? null : Number(item.amount),
        weight: Number(item.weight),
        rarity: item.rarity
      }))), createdAt, createdAt
    );
    return {
      row: db.prepare("SELECT * FROM sub2api_shake_draws WHERE id = ?").get(drawId),
      campaign,
      duplicate: false
    };
  }

  const reserveDrawTransaction = db.transaction(reserveDraw);

  async function deliverDraw(row, campaign) {
    let rewardResponse = null;
    if (row.prize_type === "balance") {
      rewardResponse = await creditBalance({
        connectionId: row.connection_id,
        userId: row.sub2api_user_id,
        amount: Number(row.prize_amount),
        drawId: row.id,
        idempotencyKey: `${row.id}:reward`,
        notes: `KaWang 摇摇乐奖励：${campaign.name} / ${row.prize_name} / ${row.id}`
      });
    }
    const deliveredAt = now();
    db.transaction(() => {
      if (row.prize_type === "extra_draw") {
        const existingExtraCard = db.prepare(`
          SELECT id FROM sub2api_shake_cards
          WHERE source = 'extra_draw' AND source_record_id = ?
        `).get(row.id);
        if (!existingExtraCard) {
          db.prepare(`
            INSERT INTO sub2api_shake_cards (
              id, campaign_id, connection_id, sub2api_user_id, source,
              source_record_id, status, granted_at
            ) VALUES (?, ?, ?, ?, 'extra_draw', ?, 'available', ?)
          `).run(id("shake-card"), row.campaign_id, row.connection_id, row.sub2api_user_id, row.id, deliveredAt);
        }
      }
      db.prepare(`
        UPDATE sub2api_shake_draws
        SET status = 'delivered', reward_response = ?, error_message = NULL,
            delivered_at = ?, updated_at = ?
        WHERE id = ?
      `).run(rewardResponse ? JSON.stringify(rewardResponse) : null, deliveredAt, deliveredAt, row.id);
      db.prepare(`
        UPDATE sub2api_shake_cards
        SET status = 'consumed', consumed_at = ?
        WHERE id = ?
      `).run(deliveredAt, row.card_id);
    })();
    return db.prepare("SELECT * FROM sub2api_shake_draws WHERE id = ?").get(row.id);
  }

  function failDrawDelivery(row, error) {
    const updatedAt = now();
    db.prepare(`
      UPDATE sub2api_shake_draws
      SET status = 'delivery_failed', error_message = ?, updated_at = ?
      WHERE id = ?
    `).run(error.message || "奖励发放失败", updatedAt, row.id);
    return db.prepare("SELECT * FROM sub2api_shake_draws WHERE id = ?").get(row.id);
  }

  function countAvailableCards(campaignId, userId) {
    return Number(db.prepare(`
      SELECT COUNT(*) AS count FROM sub2api_shake_cards
      WHERE campaign_id = ? AND sub2api_user_id = ? AND status = 'available'
    `).get(campaignId, String(userId)).count);
  }

  async function syncUsage(connectionId) {
    const connection = db.prepare(`
      SELECT id FROM sub2api_connections WHERE id = ? AND status = 'active'
    `).get(connectionId);
    if (!connection) {
      const error = new Error("Sub2api 连接不存在或未启用");
      error.statusCode = 404;
      throw error;
    }
    const campaign = findActiveCampaign(connectionId);
    if (!campaign) {
      const error = new Error("当前连接没有进行中的摇摇乐活动");
      error.statusCode = 409;
      throw error;
    }
    const sync = db.prepare("SELECT * FROM sub2api_shake_usage_sync WHERE connection_id = ?").get(connectionId);
    let page = 1;
    let pages = 1;
    let imported = 0;
    let cardsGranted = 0;
    const startingCursor = sync?.cursor ? String(sync.cursor) : "";
    let highestCursor = startingCursor;
    let reachedCursor = false;
    do {
      const response = await listUsagePage({
        connectionId,
        page,
        pageSize: 100,
        sortBy: "created_at",
        sortOrder: "desc",
        cursor: sync?.cursor || ""
      });
      pages = Math.max(1, Number(response?.pages || 1));
      for (const item of Array.isArray(response?.items) ? response.items : []) {
        const remoteId = String(item?.id ?? "").trim();
        const userId = String(item?.user_id ?? "").trim();
        if (!remoteId || !userId) continue;
        if (startingCursor && BigInt(remoteId) <= BigInt(startingCursor)) {
          reachedCursor = true;
          continue;
        }
        if (!highestCursor || BigInt(remoteId) > BigInt(highestCursor)) highestCursor = remoteId;
        const seen = db.prepare(`
          SELECT id FROM sub2api_shake_usage_records
          WHERE connection_id = ? AND remote_usage_id = ?
        `).get(connectionId, remoteId);
        if (seen) continue;
        const actualCost = Number(item.actual_cost);
        const occurredAt = item.created_at || now();
        db.prepare(`
          INSERT INTO sub2api_shake_usage_records (
            id, connection_id, remote_usage_id, sub2api_user_id,
            actual_cost, occurred_at, imported_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(id("shake-usage"), connectionId, remoteId, userId, Number.isFinite(actualCost) ? actualCost : 0, occurredAt, now());
        if (Number.isFinite(actualCost) && actualCost > 0 && occurredAt >= campaign.start_at) {
          const result = recordConsumption({
            connectionId,
            userId,
            source: "balance_consumption",
            sourceId: `usage:${remoteId}`,
            amount: actualCost,
            occurredAt
          });
          imported += 1;
          cardsGranted += result.cardsGranted;
        }
      }
      page += 1;
    } while (page <= pages && !reachedCursor);
    const updatedAt = now();
    db.prepare(`
      INSERT INTO sub2api_shake_usage_sync (
        connection_id, cursor, last_synced_at, last_error, updated_at
      ) VALUES (?, ?, ?, NULL, ?)
      ON CONFLICT(connection_id) DO UPDATE SET
        cursor = excluded.cursor,
        last_synced_at = excluded.last_synced_at,
        last_error = NULL,
        updated_at = excluded.updated_at
    `).run(connectionId, highestCursor || null, updatedAt, updatedAt);
    return { imported, cardsGranted, cursor: highestCursor || "" };
  }

  async function runMaintenance() {
    const at = now();
    let campaignsActivated = 0;
    let campaignsEnded = 0;
    let cardsExpired = 0;
    db.transaction(() => {
      const ending = db.prepare(`
        SELECT id FROM sub2api_shake_campaigns
        WHERE status IN ('active', 'scheduled') AND end_at <= ?
      `).all(at);
      for (const campaign of ending) {
        cardsExpired += db.prepare(`
          UPDATE sub2api_shake_cards SET status = 'expired', expired_at = ?
          WHERE campaign_id = ? AND status = 'available'
        `).run(at, campaign.id).changes;
        db.prepare(`
          UPDATE sub2api_shake_campaigns
          SET status = 'ended', ended_at = ?, updated_at = ? WHERE id = ?
        `).run(at, at, campaign.id);
        campaignsEnded += 1;
      }
      campaignsActivated = db.prepare(`
        UPDATE sub2api_shake_campaigns
        SET status = 'active', updated_at = ?
        WHERE status = 'scheduled' AND start_at <= ? AND end_at > ?
      `).run(at, at, at).changes;
    })();

    const connections = db.prepare(`
      SELECT DISTINCT c.connection_id
      FROM sub2api_shake_campaigns c
      JOIN sub2api_shake_eligibility_rules r
        ON r.config_version_id = c.active_config_version_id
      WHERE c.status = 'active' AND c.start_at <= ? AND c.end_at > ?
        AND r.source = 'balance_consumption'
    `).all(at, at);
    let connectionsSynced = 0;
    let cardsGranted = 0;
    let syncErrors = 0;
    for (const connection of connections) {
      try {
        const result = await syncUsage(connection.connection_id);
        connectionsSynced += 1;
        cardsGranted += result.cardsGranted;
      } catch {
        syncErrors += 1;
      }
    }
    return {
      campaignsActivated,
      campaignsEnded,
      cardsExpired,
      connectionsSynced,
      cardsGranted,
      syncErrors
    };
  }

  function grantCards(input, actor) {
    const parsed = manualGrantSchema.safeParse(input);
    if (!parsed.success) {
      const error = new Error(parsed.error.issues[0]?.message || "补发参数无效");
      error.statusCode = 400;
      throw error;
    }
    const campaign = getCampaign(parsed.data.campaignId);
    if (!campaign) {
      const error = new Error("摇摇乐活动不存在");
      error.statusCode = 404;
      throw error;
    }
    if (campaign.status === "ended") {
      const error = new Error("已结束活动不能补发摇摇卡");
      error.statusCode = 409;
      throw error;
    }
    const grantId = id("shake-grant");
    const createdAt = now();
    db.transaction(() => {
      db.prepare(`
        INSERT INTO sub2api_shake_manual_grants (
          id, campaign_id, connection_id, sub2api_user_id, email,
          quantity, reason, granted_by, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        grantId, campaign.id, campaign.connection_id, parsed.data.userId,
        parsed.data.email || null, parsed.data.quantity, parsed.data.reason, actor, createdAt
      );
      const insertCard = db.prepare(`
        INSERT INTO sub2api_shake_cards (
          id, campaign_id, connection_id, sub2api_user_id, source,
          source_record_id, status, granted_at
        ) VALUES (?, ?, ?, ?, 'manual_grant', ?, 'available', ?)
      `);
      for (let index = 0; index < parsed.data.quantity; index += 1) {
        insertCard.run(
          id("shake-card"), campaign.id, campaign.connection_id,
          parsed.data.userId, grantId, createdAt
        );
      }
    })();
    createAuditLog({
      action: "sub2api.shake.cards.grant",
      actor,
      resourceType: "sub2api_shake_manual_grant",
      resourceId: grantId,
      detail: {
        campaignId: campaign.id,
        connectionId: campaign.connection_id,
        userId: parsed.data.userId,
        quantity: parsed.data.quantity,
        reason: parsed.data.reason
      }
    });
    return { id: grantId, granted: parsed.data.quantity };
  }

  function listDraws(query = {}) {
    const conditions = [];
    const params = [];
    const status = String(query.status || "").trim();
    if (status) {
      conditions.push("status = ?");
      params.push(status);
    }
    const campaignId = String(query.campaignId || "").trim();
    if (campaignId) {
      conditions.push("campaign_id = ?");
      params.push(campaignId);
    }
    const userId = String(query.userId || "").trim();
    if (userId) {
      conditions.push("sub2api_user_id = ?");
      params.push(userId);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    return db.prepare(`
      SELECT * FROM sub2api_shake_draws ${where}
      ORDER BY created_at DESC LIMIT 500
    `).all(...params).map(serializeDraw);
  }

  async function dispositionDraw(drawId, input, actor) {
    const parsed = dispositionSchema.safeParse(input);
    if (!parsed.success) {
      const error = new Error(parsed.error.issues[0]?.message || "奖励处置参数无效");
      error.statusCode = 400;
      throw error;
    }
    let row = db.prepare("SELECT * FROM sub2api_shake_draws WHERE id = ?").get(drawId);
    if (!row) {
      const error = new Error("抽奖记录不存在");
      error.statusCode = 404;
      throw error;
    }
    const allowed = parsed.data.action === "retry"
      ? ["delivery_failed", "selected"].includes(row.status)
      : row.status === "delivery_failed";
    if (!allowed) {
      const error = new Error("当前奖励状态不允许此操作");
      error.statusCode = 409;
      throw error;
    }
    if (parsed.data.action === "retry") {
      const campaign = getCampaign(row.campaign_id);
      try {
        row = await deliverDraw(row, campaign);
      } catch (error) {
        row = failDrawDelivery(row, error);
      }
    } else {
      const updatedAt = now();
      const nextStatus = parsed.data.action === "confirm" ? "delivered" : "voided";
      db.transaction(() => {
        db.prepare(`
          UPDATE sub2api_shake_draws
          SET status = ?, disposition_reason = ?, disposition_by = ?,
              delivered_at = CASE WHEN ? = 'delivered' THEN ? ELSE delivered_at END,
              updated_at = ?
          WHERE id = ?
        `).run(nextStatus, parsed.data.reason, actor, nextStatus, updatedAt, updatedAt, row.id);
        db.prepare(`
          UPDATE sub2api_shake_cards
          SET status = 'consumed', consumed_at = COALESCE(consumed_at, ?)
          WHERE id = ?
        `).run(updatedAt, row.card_id);
      })();
      row = db.prepare("SELECT * FROM sub2api_shake_draws WHERE id = ?").get(row.id);
    }
    createAuditLog({
      action: `sub2api.shake.reward.${parsed.data.action}`,
      actor,
      resourceType: "sub2api_shake_draw",
      resourceId: row.id,
      detail: { reason: parsed.data.reason, status: row.status }
    });
    return row;
  }

  app.post("/api/admin/sub2api/shake/campaigns", { preHandler: requireAdmin }, async (request, reply) => {
    try {
      const campaign = createCampaign(parseBody(request), request.admin?.username || "admin");
      return reply.code(201).send({ campaign: serializeCampaign(campaign) });
    } catch (error) {
      return reply.code(error.statusCode || 400).send({ message: error.message });
    }
  });

  app.get("/api/admin/sub2api/shake/campaigns", { preHandler: requireAdmin }, async (request) => ({
    items: listCampaigns(request.query)
  }));

  app.post("/api/admin/sub2api/shake/campaigns/:id/activate", { preHandler: requireAdmin }, async (request, reply) => {
    try {
      const campaign = activateCampaign(request.params.id, request.admin?.username || "admin");
      return { campaign: serializeCampaign(campaign) };
    } catch (error) {
      return reply.code(error.statusCode || 400).send({ message: error.message });
    }
  });

  app.post("/api/admin/sub2api/shake/campaigns/:id/config", { preHandler: requireAdmin }, async (request, reply) => {
    try {
      return reply.code(201).send(createConfigVersion(
        request.params.id,
        parseBody(request),
        request.admin?.username || "admin"
      ));
    } catch (error) {
      return reply.code(error.statusCode || 400).send({ message: error.message });
    }
  });

  app.post("/api/admin/sub2api/shake/campaigns/:id/end", { preHandler: requireAdmin }, async (request, reply) => {
    try {
      const result = endCampaign(
        request.params.id,
        parseBody(request),
        request.admin?.username || "admin"
      );
      return {
        campaign: serializeCampaign(result.campaign),
        expiredCards: result.expiredCards
      };
    } catch (error) {
      return reply.code(error.statusCode || 400).send({ message: error.message || "结束活动失败" });
    }
  });

  app.get("/api/public/sub2api/shake/bootstrap", { preHandler: requireSession }, async (request) => (
    buildBootstrap(request.sub2apiShake)
  ));

  app.post("/api/public/sub2api/shake/draws", { preHandler: requireSession }, async (request, reply) => {
    const parsed = drawSchema.safeParse(parseBody(request));
    if (!parsed.success) return reply.code(400).send({ message: "抽奖请求 ID 无效" });
    try {
      const reserved = reserveDrawTransaction(request.sub2apiShake, parsed.data.requestId);
      const campaign = reserved.campaign || getCampaign(reserved.row.campaign_id);
      let draw = reserved.row;
      if (draw.status !== "delivered") {
        try {
          draw = await deliverDraw(draw, campaign);
        } catch (error) {
          draw = failDrawDelivery(draw, error);
        }
      }
      const statusCode = draw.status === "delivery_failed"
        ? 202
        : (reserved.duplicate ? 200 : 201);
      return reply.code(statusCode).send({
        draw: serializeDraw(draw),
        availableCards: countAvailableCards(draw.campaign_id, draw.sub2api_user_id)
      });
    } catch (error) {
      return reply.code(error.statusCode || 502).send({ message: error.message || "抽奖失败" });
    }
  });

  app.post("/api/admin/sub2api/shake/connections/:id/sync-usage", { preHandler: requireAdmin }, async (request, reply) => {
    try {
      return await syncUsage(request.params.id);
    } catch (error) {
      return reply.code(error.statusCode || 502).send({ message: error.message || "用量同步失败" });
    }
  });

  app.post("/api/admin/sub2api/shake/cards/grant", { preHandler: requireAdmin }, async (request, reply) => {
    try {
      return reply.code(201).send(grantCards(parseBody(request), request.admin?.username || "admin"));
    } catch (error) {
      return reply.code(error.statusCode || 400).send({ message: error.message || "补发失败" });
    }
  });

  app.get("/api/admin/sub2api/shake/draws", { preHandler: requireAdmin }, async (request) => ({
    items: listDraws(request.query)
  }));

  app.post("/api/admin/sub2api/shake/draws/:id/disposition", { preHandler: requireAdmin }, async (request, reply) => {
    try {
      const draw = await dispositionDraw(
        request.params.id,
        parseBody(request),
        request.admin?.username || "admin"
      );
      return { draw: serializeDraw(draw) };
    } catch (error) {
      return reply.code(error.statusCode || 400).send({ message: error.message || "奖励处置失败" });
    }
  });

  return { recordConsumption, buildBootstrap, runMaintenance };
}
