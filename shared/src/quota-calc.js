import crypto from "node:crypto";

/**
 * 获取系统总额度：所有 active 状态原始卡密的 remaining 之和
 * @param {import('better-sqlite3').Database} db
 * @returns {number}
 */
export function getTotalQuota(db) {
  const row = db.prepare(`
    SELECT COALESCE(SUM(remaining), 0) AS total
    FROM quota_source_cards
    WHERE status = 'active'
  `).get();
  return row.total;
}

/**
 * 获取已分配额度：所有 active 状态子卡密的剩余额度之和（total_quota - used_quota）
 * @param {import('better-sqlite3').Database} db
 * @returns {number}
 */
export function getAllocatedQuota(db) {
  const row = db.prepare(`
    SELECT COALESCE(SUM(total_quota - used_quota), 0) AS allocated
    FROM quota_sub_cards
    WHERE status = 'active'
  `).get();
  return row.allocated;
}

/**
 * 获取可分配额度：总额度 - 已分配额度
 * @param {import('better-sqlite3').Database} db
 * @returns {number}
 */
export function getAvailableQuota(db) {
  return getTotalQuota(db) - getAllocatedQuota(db);
}

const CARD_CODE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const CARD_CODE_LENGTH = 16;

/**
 * 生成 16 位大写字母+数字随机码 [A-Z0-9]
 * @returns {string}
 */
export function generateSubCardCode() {
  let code = "";
  for (let i = 0; i < CARD_CODE_LENGTH; i++) {
    code += CARD_CODE_CHARS[crypto.randomInt(CARD_CODE_CHARS.length)];
  }
  return code;
}

/**
 * 生成唯一子卡密编码，确保在 quota_sub_cards 表中不存在重复
 * @param {import('better-sqlite3').Database} db
 * @returns {string}
 */
export function getUniqueSubCardCode(db) {
  const stmt = db.prepare("SELECT 1 FROM quota_sub_cards WHERE card_code = ?");
  let code;
  do {
    code = generateSubCardCode();
  } while (stmt.get(code) !== undefined);
  return code;
}

/**
 * 生成提取历史导出文本内容
 * @param {string} cardCode - 卡密编码
 * @param {Array<{created_at: string, amount: number}>} history - 提取历史记录数组
 * @returns {string} .txt 文件内容
 */
export function generateExportText(cardCode, history) {
  let content = `卡密编码: ${cardCode}\n提取记录:\n`;
  for (const record of history) {
    content += `---\n时间: ${record.created_at}\n提取数量: ${record.amount}\n`;
    const accounts = record.accounts ? (typeof record.accounts === 'string' ? JSON.parse(record.accounts) : record.accounts) : [];
    if (accounts.length) {
      content += `账号:\n${accounts.join("\n")}\n`;
    }
  }
  return content;
}
