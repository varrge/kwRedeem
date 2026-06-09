const PENDING_PATTERNS = [
  /暂无短信/i,
  /尚未收到/i,
  /未收到/i,
  /没有短信/i,
  /等待短信/i,
  /无短信/i,
  /链接到期/i,
  /到期时间/i,
  /续费请/i
];

const VERIFICATION_KEYWORD_PATTERN =
  /验证码|驗證碼|验证代码|驗證代碼|校验码|校驗碼|认证码|認證碼|动态码|動態碼|verification\s*code|verify\s*code|security\s*code|login\s*code|passcode|one[-\s]?time|otp|code/i;

function normalizeSmsText(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function collectDigitCandidates(text) {
  const candidates = [];
  const regex = /(^|[^\d])(\d{4,8})(?!\d)/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const leading = match[1] || "";
    const value = match[2];
    const index = match.index + leading.length;
    candidates.push({ value, index });
  }
  return candidates;
}

function isLikelyPendingSmsText(text) {
  return PENDING_PATTERNS.some((pattern) => pattern.test(text));
}

function isShortCodeOnlyText(text, candidates) {
  return candidates.length === 1 && text.length <= 32;
}

export function extractSmsVerificationCode(value) {
  const text = normalizeSmsText(value);
  if (!text) return null;

  const candidates = collectDigitCandidates(text);
  if (candidates.length === 0) return null;

  const pendingText = isLikelyPendingSmsText(text);
  const keywordCandidates = candidates.filter((candidate) => {
    const start = Math.max(0, candidate.index - 64);
    const end = Math.min(text.length, candidate.index + candidate.value.length + 64);
    return VERIFICATION_KEYWORD_PATTERN.test(text.slice(start, end));
  });

  if (keywordCandidates.length > 0) {
    return (keywordCandidates.find((candidate) => candidate.value.length === 6) || keywordCandidates[0]).value;
  }

  if (pendingText) return null;

  if (isShortCodeOnlyText(text, candidates)) {
    return candidates[0].value;
  }

  return null;
}

