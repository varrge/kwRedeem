/**
 * 解析 SMS 批量导入内容
 * 纯函数，从导入内容字符串中解析出有效条目和跳过的行
 *
 * @param {string} content - 导入内容，每行一条记录
 * @returns {{ validEntries: Array<{phone: string, smsUrl: string}>, skippedLines: Array<{line: number, reason: string}> }}
 */
export function parseSmsImportContent(content) {
  const allLines = content.split(/\r?\n/);

  const skippedLines = [];
  const validEntries = [];
  const seenPhones = new Set();

  for (let i = 0; i < allLines.length; i++) {
    const raw = allLines[i];
    const trimmed = raw.trim();

    // 忽略空行
    if (!trimmed) continue;

    const lineNum = i + 1;

    // 按 ---- 分隔符拆分
    const separatorIndex = trimmed.indexOf("----");
    if (separatorIndex === -1) {
      skippedLines.push({ line: lineNum, reason: "缺少分隔符 ----" });
      continue;
    }

    const phone = trimmed.slice(0, separatorIndex).trim();
    const smsUrl = trimmed.slice(separatorIndex + 4).trim();

    if (!phone) {
      skippedLines.push({ line: lineNum, reason: "手机号为空" });
      continue;
    }

    if (!smsUrl) {
      skippedLines.push({ line: lineNum, reason: "接码网址为空" });
      continue;
    }

    // 本次导入范围内按 phone 去重
    if (seenPhones.has(phone)) {
      skippedLines.push({ line: lineNum, reason: "手机号重复" });
      continue;
    }

    seenPhones.add(phone);
    validEntries.push({ phone, smsUrl });
  }

  return { validEntries, skippedLines };
}
