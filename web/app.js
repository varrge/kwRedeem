const API_BASE = (globalThis.KAWANG_CONFIG?.apiUrl || "http://127.0.0.1:4300").replace(/\/+$/, "");

const verifyForm = document.querySelector("#verify-form");
const verifyResult = document.querySelector("#verify-result");
const wizardContainer = document.querySelector("#wizard-container");
const redeemForm = document.querySelector("#redeem-form");
const redeemSubmit = document.querySelector("#redeem-submit");
const redeemResult = document.querySelector("#redeem-result");
const lookupForm = document.querySelector("#lookup-form");
const orderResult = document.querySelector("#order-result");
const publicKeyInput = document.querySelector("#public-key");
const orderNoInput = document.querySelector("#order-no");
const statusContainer = document.querySelector("#status-container");
const supportAccessPanel = document.querySelector("#support-access-panel");
const supportAccessForm = document.querySelector("#support-access-form");
const supportPublicKeyInput = document.querySelector("#support-public-key");
const supportAccessResetBtn = document.querySelector("#support-access-reset");
const supportAccessResult = document.querySelector("#support-access-result");
const supportPanel = document.querySelector("#support-panel");
const supportAuthResult = document.querySelector("#support-auth-result");
const supportAccountResult = document.querySelector("#support-account-result");
const refreshAccountBtn = document.querySelector("#refresh-account-btn");
const fetchOtpBtn = document.querySelector("#fetch-otp-btn");
const supportLogoutBtn = document.querySelector("#support-logout-btn");
const supportOtpResult = document.querySelector("#support-otp-result");
const supportExportPanel = document.querySelector("#support-export-panel");
const supportExportJson = document.querySelector("#support-export-json");
const fetchSupportExportBtn = document.querySelector("#fetch-support-export-btn");
const copySupportExportBtn = document.querySelector("#copy-support-export-btn");
const supportExportResult = document.querySelector("#support-export-result");
const supportExportFormatButtons = Array.from(document.querySelectorAll(".support-export-format-btn"));
const supportNavBanner = document.querySelector("#support-nav-banner");
const stepTwoTitle = document.querySelector("#step-2-title");
const stepTwoDesc = document.querySelector("#step-2-desc");

let verifiedKey = null;
let verifiedSiteSlug = null;
let redeemStatusTimer = null;
let supportSessionId = null;
let supportCookie = null;
let supportAuthEmail = null;
let supportNavMode = false;
let supportAccountSnapshot = null;
let supportOtpSnapshot = [];
let supportExportFormat = "cpa";
let supportExportRawData = "";

const LIVE_STATUS_POLL_MS = 2000;
const SUPPORT_SITE_SLUG = "meimei_site";
const STATUS_LABELS = {
  active: "可用",
  locked: "锁定中",
  used: "已使用",
  disabled: "已禁用",
  void: "已作废",
  unavailable: "不可兑换",
  pending: "排队中",
  processing: "处理中",
  succeeded: "已成功",
  completed: "已成功",
  failed: "失败",
  cancelled: "已取消",
  unknown: "未知"
};

// --- Navigation Logic ---

function setVisibleSection(target) {
  document.querySelectorAll(".view-section").forEach((section) => {
    section.classList.toggle("hidden", section.id !== `${target}-container`);
  });
}

function setActiveNav(target) {
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.target === target);
  });
}

function updateViewHash(target) {
  if (!["wizard", "query", "faq", "support"].includes(target)) return;
  const nextHash = `#${target}`;
  if (window.location.hash !== nextHash) {
    window.history.replaceState(null, "", nextHash);
  }
}

function shouldShowSupportPanel(siteSlug = verifiedSiteSlug) {
  return supportNavMode || (isSupportSiteSlug(siteSlug) && Boolean(supportSessionId || supportCookie || supportAuthEmail));
}

function setSupportNavMode(enabled) {
  supportNavMode = enabled;
  wizardContainer.classList.toggle("support-nav-mode", enabled);
  supportNavBanner.classList.toggle("hidden", !enabled);
  supportAccessPanel.classList.toggle("hidden", !enabled);
  stepTwoTitle.textContent = enabled ? "接码验证中心" : "提交信息与前台验证";
  stepTwoDesc.textContent = enabled
    ? "输入接码卡密后，系统会优先自动认证并展示当前邮箱、账号信息与最近验证码邮件。"
    : "如当前站点支持临时 token，可先完成前台验证并查看邮箱 / 验证码；如需继续走老的激活链路，仍可提交 Session JSON。";
  if (enabled && verifiedKey && !supportPublicKeyInput.value.trim()) {
    supportPublicKeyInput.value = verifiedKey;
  }
}

function syncSupportVisibility(siteSlug = verifiedSiteSlug) {
  supportPanel.classList.toggle("hidden", !shouldShowSupportPanel(siteSlug));
}

function openSupportView() {
  setSupportNavMode(true);
  setVisibleSection("wizard");
  setActiveNav("support");
  updateViewHash("support");
  goToStep(2);
  if (!supportPublicKeyInput.value.trim() && verifiedKey) {
    supportPublicKeyInput.value = verifiedKey;
    setState(supportAccessResult, "已填入当前已验证卡密，可直接点击按钮尝试自动接码。");
  }
  syncSupportVisibility();
}

function switchView(target) {
  if (target === "support") {
    openSupportView();
    return;
  }

  setSupportNavMode(false);
  setVisibleSection(target);
  setActiveNav(target);
  updateViewHash(target);
  syncSupportVisibility();
}

function goToStep(step) {
  document.querySelectorAll(".wizard-pane").forEach((pane) => {
    pane.classList.toggle("active", pane.id === `step-${step}`);
  });
  document.querySelectorAll(".step-dot").forEach((dot) => {
    const s = parseInt(dot.dataset.step);
    dot.classList.toggle("active", s === step);
  });
}

document.querySelectorAll(".nav-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const target = btn.dataset.target;
    if (target === "stock") {
      window.location.href = "./stock.html";
      return;
    }
    if (target === "subscription") {
      window.location.href = "./subscription.html";
      return;
    }
    if (target) {
      switchView(target);
    }
  });
});

document.querySelector("#back-to-step-1").addEventListener("click", () => goToStep(1));
document.querySelector("#start-over").addEventListener("click", () => {
  verifiedKey = null;
  verifiedSiteSlug = null;
  publicKeyInput.value = "";
  document.querySelector("#session-payload").value = "";
  resetSupportState({ clearToken: true, clearOtp: true });
  setState(verifyResult, "请输入卡密并点击验证。");
  setState(redeemResult, "等待提交任务...");
  redeemSubmit.disabled = true;
  stopRedeemStatusPolling();
  goToStep(1);
});

// --- Existing Logic ---

function setState(element, message, type = "muted") {
  element.className = `result ${type}`;
  element.textContent = message;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function setRichState(element, html, type = "muted") {
  element.className = `result ${type}`;
  element.innerHTML = html;
}

function getStatusLabel(status) {
  const normalized = String(status ?? "").trim().toLowerCase() || "unknown";
  return STATUS_LABELS[normalized] || String(status ?? "未知");
}

function renderStatusBadge(status) {
  const normalized = String(status ?? "").trim().toLowerCase() || "unknown";
  return `<span class="status-badge ${escapeHtml(normalized)}">${escapeHtml(getStatusLabel(normalized))}</span>`;
}

function renderStatusText(status) {
  return escapeHtml(getStatusLabel(status));
}

function getStockLevelLabel(level) {
  const normalized = String(level ?? "").trim().toLowerCase();
  return {
    high: "库存充足",
    low: "库存偏少",
    none: "库存为空"
  }[normalized] || "-";
}

function getVerifyBadgeStatus(payload) {
  if (payload.canRedeem) {
    return payload.status;
  }

  if (payload.remoteAvailable === false) {
    return "unavailable";
  }

  return payload.status || "unknown";
}

function stopRedeemStatusPolling() {
  if (redeemStatusTimer) {
    window.clearInterval(redeemStatusTimer);
    redeemStatusTimer = null;
  }
}

function shouldKeepPolling(order = {}) {
  const live = String(order.liveTaskStatus || "").toLowerCase();
  if (live === "completed" || live === "failed") return false;
  const orderStatus = String(order.status || "").toLowerCase();
  const jobStatus = String(order.job?.status || "").toLowerCase();
  return ["pending", "processing"].includes(orderStatus) || ["pending", "processing"].includes(jobStatus);
}

function parseSessionPayloadInput(rawValue) {
  try {
    const parsed = JSON.parse(rawValue);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("session JSON 必须是对象");
    }
    return parsed;
  } catch (error) {
    throw new Error(error.message === "session JSON 必须是对象" ? error.message : "Session JSON 格式不正确");
  }
}

// 站点级 session 预检：与后端 validateSessionForSite 对齐，保证用户在提交前就能看到明确报错。
function validateSessionForSiteSlug(siteSlug, sessionData) {
  const slug = String(siteSlug || "").toLowerCase();
  const accessToken = typeof sessionData?.accessToken === "string" ? sessionData.accessToken.trim() : "";
  const email = typeof sessionData?.user?.email === "string" ? sessionData.user.email.trim() : "";

  if (slug === "666") {
    if (!accessToken) {
      throw new Error("666 站需要完整的 ChatGPT Session JSON：缺少 accessToken 字段，请重新到 chatgpt.com/api/auth/session 复制完整内容。");
    }
    if (!email) {
      throw new Error("666 站需要完整的 ChatGPT Session JSON：缺少 user.email 字段，请重新到 chatgpt.com/api/auth/session 复制完整内容。");
    }
  }
}

function extractPlanType(sessionData = {}) {
  const candidates = [
    sessionData.planType,
    sessionData.user?.planType,
    sessionData.account?.planType
  ];
  return candidates.find((value) => typeof value === "string" && value.trim()) || "";
}

function shouldConfirmOverwrite(sessionData) {
  return extractPlanType(sessionData).toLowerCase().includes("plus");
}

function isSessionFixNeededMessage(message) {
  return [
    "token已失效",
    "token无效",
    "token 已失效",
    "token 无效",
    "token内容格式错误",
    "token 内容格式错误",
    "session格式错误",
    "session 格式错误",
    "session 无效",
    "session无效",
    "缺少account字段",
    "缺少 account 字段",
    "字段缺失",
    "missing account",
    "account field is required",
    "token expired",
    "token invalid",
    "invalid token",
    "expired token",
    "invalid_session",
    "invalid session",
    "session_invalid"
  ].some((keyword) => String(message ?? "").toLowerCase().includes(keyword));
}

function getApiMessage(job = {}) {
  const response = job.lastResponse || {};
  const json = response.json || {};
  const code = json.code || json.data?.code;
  const message = json.error_msg
    || json.error
    || json.result
    || json.msg
    || json.message
    || json.data?.error_msg
    || json.data?.error
    || json.data?.msg
    || json.data?.message
    || "";
  if (code && message) return `${code}: ${message}`;
  if (message) return message;
  if (code) return String(code);
  return "";
}

function isSupportSiteSlug(siteSlug) {
  return String(siteSlug || "").trim().toLowerCase() === SUPPORT_SITE_SLUG;
}

function stringifySupportValue(value) {
  if (value === null || value === undefined || value === "") {
    return "-";
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

function buildSupportAuthHeaders() {
  const headers = {};
  if (supportSessionId) {
    headers["X-Support-Session-Id"] = supportSessionId;
  }
  if (supportCookie) {
    headers["X-Support-Cookie"] = supportCookie;
  }
  return headers;
}

function normalizeSupportExportText(value) {
  if (typeof value === "string") {
    return value;
  }
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "object") {
    return JSON.stringify(value, null, 2);
  }
  return String(value);
}

function setActiveSupportExportFormat(format) {
  supportExportFormat = format;
  supportExportFormatButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.format === format);
  });
}

function hideSupportExport() {
  supportAccountSnapshot = null;
  supportOtpSnapshot = [];
  supportExportRawData = "";
  supportExportJson.value = "";
  supportExportPanel.classList.add("hidden");
  setActiveSupportExportFormat("cpa");
  setState(supportExportResult, "验证成功后可选择格式并获取导出内容。");
}

function showSupportExportPanel() {
  if (!supportAccountSnapshot) {
    hideSupportExport();
    return;
  }

  supportExportPanel.classList.remove("hidden");
  if (!supportExportRawData.trim()) {
    supportExportJson.value = "";
    setState(supportExportResult, "已可使用真实导出接口，请选择格式并获取导出内容。");
  }
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  supportExportJson.focus();
  supportExportJson.select();
  supportExportJson.setSelectionRange(0, supportExportJson.value.length);
  if (!document.execCommand("copy")) {
    throw new Error("复制失败，请手动选择 JSON 内容复制。");
  }
}

async function fetchSupportExport(format = supportExportFormat, { silent = false } = {}) {
  if (!supportAccountSnapshot) {
    hideSupportExport();
    throw new Error("当前还没有可导出的账号信息。");
  }

  setActiveSupportExportFormat(format);
  showSupportExportPanel();
  if (!silent) {
    setState(supportExportResult, `正在获取 ${format.toUpperCase()} 导出内容...`);
  }

  const payload = await request("/api/public/support/export", {
    method: "POST",
    headers: buildSupportAuthHeaders(),
    body: JSON.stringify({ format })
  });

  if (payload.supportCookie) {
    supportCookie = payload.supportCookie;
  }

  supportExportRawData = normalizeSupportExportText(payload.data);
  supportExportJson.value = supportExportRawData;
  setState(supportExportResult, `${String(payload.format || format).toUpperCase()} 导出内容已更新。`, "success");
  return payload;
}

function applySupportAuthSession(payload, title = "前台验证成功") {
  supportSessionId = payload.sessionId || null;
  supportCookie = payload.supportCookie || null;
  supportAuthEmail = payload.email || null;
  syncSupportVisibility();
  refreshAccountBtn.disabled = false;
  fetchOtpBtn.disabled = false;
  supportLogoutBtn.disabled = false;
  setRichState(supportAuthResult, renderSupportAuthResult({ ...payload, title }), "success");
}

function resetSupportState({ clearToken = false, clearOtp = false } = {}) {
  supportSessionId = null;
  supportCookie = null;
  supportAuthEmail = null;
  hideSupportExport();
  syncSupportVisibility();
  refreshAccountBtn.disabled = true;
  fetchOtpBtn.disabled = true;
  supportLogoutBtn.disabled = true;
  setState(
    supportAuthResult,
    supportNavMode
      ? "等待接码卡密自动认证。"
      : isSupportSiteSlug(verifiedSiteSlug)
        ? "卡密验证成功后，系统会自动加载接码信息。"
        : "当前卡密未启用接码功能。"
  );
  setState(supportAccountResult, "验证成功后会在这里展示邮箱和账号信息。");
  if (clearOtp) {
    setState(supportOtpResult, "暂未获取验证码邮件。");
  }
}

function syncSupportPanel(siteSlug) {
  syncSupportVisibility(siteSlug);
  if (shouldShowSupportPanel(siteSlug)) {
    resetSupportState();
  }
}

function renderSupportAuthResult(payload = {}) {
  return `
    <div class="result-card">
      <div class="result-title">${escapeHtml(payload.title || "自动认证成功")}</div>
      <span class="status-badge active">已认证</span>
      <div class="support-summary-grid">
        <div class="result-item">
          <span>邮箱</span>
          <strong>${escapeHtml(payload.email || supportAuthEmail || "-")}</strong>
        </div>
      </div>
    </div>
  `;
}

function formatWarranty(value) {
  if (value === null || value === undefined || value === "") {
    return "-";
  }

  if (typeof value === "object") {
    const type = String(value.type ?? "").trim().toLowerCase();
    if (type === "first_login") {
      return "质保首登";
    }
  }

  return stringifySupportValue(value);
}

function renderSupportAccessResult(payload = {}) {
  const autoStatus = payload.autoAuthorized
    ? "已自动认证"
    : payload.hasBoundEmailToken
      ? "已尝试自动认证"
      : "未绑定接码 Token";
  return `
    <div class="result-card">
      <div class="result-title">接码卡密验证完成</div>
      <span class="status-badge active">可进入</span>
      <div class="result-grid compact-grid">
        <div class="result-item">
          <span>卡密</span>
          <strong>${escapeHtml(payload.publicKey || "-")}</strong>
        </div>
        <div class="result-item">
          <span>网站</span>
          <strong>${escapeHtml(payload.siteName || "-")}</strong>
        </div>
        <div class="result-item">
          <span>自动接码</span>
          <strong>${escapeHtml(autoStatus)}</strong>
        </div>
        <div class="result-item">
          <span>卡密状态</span>
          <strong>${escapeHtml(renderStatusText(payload.status || "unknown"))}</strong>
        </div>
        <div class="result-item result-item-wide">
          <span>说明</span>
          <strong>${escapeHtml(payload.message || "卡密已验证，可继续接码操作。")}</strong>
        </div>
      </div>
    </div>
  `;
}

function renderSupportAccountResult(payload = {}) {
  return `
    <div class="result-card">
      <div class="result-title">账号信息</div>
      <div class="support-summary-grid">
        <div class="result-item">
          <span>邮箱</span>
          <strong>${escapeHtml(stringifySupportValue(payload.email || supportAuthEmail))}</strong>
        </div>
        <div class="result-item">
          <span>当前邮箱</span>
          <strong>${escapeHtml(stringifySupportValue(payload.currentEmail))}</strong>
        </div>
        <div class="result-item">
          <span>套餐类型</span>
          <strong>${escapeHtml(stringifySupportValue(payload.planType))}</strong>
        </div>
        <div class="result-item">
          <span>质保</span>
          <strong>${escapeHtml(formatWarranty(payload.warranty))}</strong>
        </div>
        <div class="result-item result-item-wide">
          <span>补偿 / 更换</span>
          <strong>${escapeHtml(stringifySupportValue(payload.replacements))}</strong>
        </div>
      </div>
    </div>
  `;
}

function extractOtpCode(item = {}) {
  const candidates = [
    item.code,
    item.otp,
    item.verification_code
  ].map((value) => String(value ?? "").trim()).filter(Boolean);

  const textCandidates = [
    item.subject,
    item.title,
    item.preview,
    item.snippet,
    item.body,
    item.content,
    item.text
  ];

  for (const value of textCandidates) {
    const match = String(value ?? "").match(/\b\d{4,8}\b/);
    if (match) {
      candidates.push(match[0]);
      break;
    }
  }

  return candidates[0] || "";
}

function extractOtpTimestamp(item = {}) {
  return [
    item.time_str,
    item.timeStr,
    item.received_at,
    item.receivedAt,
    item.created_at,
    item.createdAt,
    item.sent_at,
    item.sentAt,
    item.date,
    item.time
  ].find((value) => String(value ?? "").trim()) || "";
}

function extractOtpPreview(item = {}) {
  return [
    item.preview,
    item.snippet,
    item.body,
    item.content,
    item.text
  ].find((value) => String(value ?? "").trim()) || "";
}

function extractOtpTitle(item = {}, index = 0) {
  return [
    item.subject,
    item.title,
    item.email,
    item.to,
    item.from
  ].find((value) => String(value ?? "").trim()) || `验证码邮件 ${index + 1}`;
}

function renderSupportOtpList(otps = []) {
  if (!Array.isArray(otps) || !otps.length) {
    return `
      <div class="result-card">
        <div class="result-title">验证码邮件</div>
        <div class="result-item result-item-wide">
          <span>状态</span>
          <strong>当前没有可展示的验证码邮件。</strong>
        </div>
      </div>
    `;
  }

  const itemsHtml = otps.map((item, index) => {
    const title = extractOtpTitle(item, index);
    const code = extractOtpCode(item);
    const time = extractOtpTimestamp(item);
    const preview = extractOtpPreview(item);
    const meta = [
      item.email ? `邮箱：${item.email}` : "",
      item.current_email ? `当前邮箱：${item.current_email}` : "",
      item.from ? `发件人：${item.from}` : ""
    ].filter(Boolean);

    return `
      <article class="otp-card ${index === 0 ? "latest" : ""}">
        <div class="otp-head">
          <div class="otp-title">
            <strong>${escapeHtml(title)}</strong>
            <span class="otp-time">${escapeHtml(time || "时间未知")}</span>
          </div>
          ${index === 0 ? '<span class="otp-latest-badge">最新</span>' : ""}
        </div>
        ${code ? `<div class="otp-code">${escapeHtml(code)}</div>` : ""}
        <p class="otp-preview">${escapeHtml(preview || "该邮件未提供可展示的正文摘要。")}</p>
        ${meta.length ? `<div class="otp-meta">${meta.map((value) => `<span>${escapeHtml(value)}</span>`).join("")}</div>` : ""}
      </article>
    `;
  }).join("");

  return `
    <div class="result-card">
      <div class="result-title">最近验证码邮件</div>
      <div class="otp-list">${itemsHtml}</div>
    </div>
  `;
}

async function loadSupportAccount() {
  setState(supportAccountResult, "正在获取账号信息...");
  const payload = await request("/api/public/support/account", {
    headers: buildSupportAuthHeaders()
  });
  if (payload.supportCookie) {
    supportCookie = payload.supportCookie;
  }
  supportAccountSnapshot = payload;
  setRichState(supportAccountResult, renderSupportAccountResult(payload), "success");
  showSupportExportPanel();
  return payload;
}

async function loadSupportOtps() {
  setState(supportOtpResult, "正在获取验证码邮件...");
  const payload = await request("/api/public/support/otp", {
    headers: buildSupportAuthHeaders()
  });
  if (payload.supportCookie) {
    supportCookie = payload.supportCookie;
  }
  supportOtpSnapshot = Array.isArray(payload.otps) ? payload.otps : [];
  setRichState(supportOtpResult, renderSupportOtpList(payload.otps), "success");
  showSupportExportPanel();
  return payload;
}

async function logoutSupportAccount() {
  const payload = await request("/api/public/support/logout", {
    method: "POST",
    headers: buildSupportAuthHeaders()
  });
  if (payload.supportCookie) {
    supportCookie = payload.supportCookie;
  }
  return payload;
}

async function handleSupportCdkeyAccess(publicKey) {
  setState(supportAccessResult, "正在验证卡密并尝试自动接码...");
  resetSupportState({ clearOtp: true });
  syncSupportVisibility();

  const payload = await request("/api/public/support/cdkey-auth", {
    method: "POST",
    body: JSON.stringify({ publicKey })
  });

  verifiedKey = payload.publicKey || publicKey;
  verifiedSiteSlug = payload.siteSlug || null;
  supportPublicKeyInput.value = payload.publicKey || publicKey;

  setRichState(supportAccessResult, renderSupportAccessResult(payload), "success");

  if (payload.autoAuthorized) {
    applySupportAuthSession(payload, "已根据接码卡密自动认证");
    if (payload.account) {
      supportAccountSnapshot = payload.account;
      setRichState(supportAccountResult, renderSupportAccountResult(payload.account), "success");
    } else if (payload.accountError) {
      setState(supportAccountResult, payload.accountError, "error");
    }
    if (payload.otp) {
      supportOtpSnapshot = Array.isArray(payload.otp.otps) ? payload.otp.otps : [];
      setRichState(supportOtpResult, renderSupportOtpList(payload.otp.otps), "success");
    } else if (payload.otpError) {
      setState(supportOtpResult, payload.otpError, "error");
    }
    if (payload.account) {
      showSupportExportPanel();
      try {
        await fetchSupportExport(supportExportFormat, { silent: true });
      } catch (error) {
        setState(supportExportResult, error.message, "error");
      }
    }
    return payload;
  }

  setState(supportAuthResult, payload.message || "该接码卡密暂时无法完成自动认证。", "error");
  if (payload.authError) {
    setState(supportOtpResult, `自动认证失败：${payload.authError}`, "error");
  }
  return payload;
}

function renderVerifyResult(payload) {
  const title = payload.canRedeem ? "验证成功，正在跳转..." : "卡密验证完成";
  const badgeStatus = getVerifyBadgeStatus(payload);
  const verifyMessage = payload.canRedeem
    ? "远端校验通过"
    : (payload.remoteError || "远端校验未通过");
  return `
    <div class="result-card">
      <div class="result-title">${title}</div>
      ${renderStatusBadge(badgeStatus)}
      <div class="result-grid">
        <div class="result-item">
          <span>商品</span>
          <strong>${escapeHtml(payload.productTitle)}</strong>
        </div>
        <div class="result-item">
          <span>网站</span>
          <strong>${escapeHtml(payload.siteName || payload.endpointName)}</strong>
        </div>
        <div class="result-item">
          <span>本地状态</span>
          <strong>${renderStatusText(payload.status)}</strong>
        </div>
        <div class="result-item">
          <span>远端校验</span>
          <strong>${escapeHtml(verifyMessage)}</strong>
        </div>
        <div class="result-item">
          <span>可兑换</span>
          <strong>${payload.canRedeem ? "是" : "否"}</strong>
        </div>
        <div class="result-item">
          <span>库存等级</span>
          <strong>${escapeHtml(getStockLevelLabel(payload.stockLevel))}</strong>
        </div>
      </div>
    </div>
  `;
}

function renderRedeemSuccess(payload) {
  const hasLiveTask = Boolean(payload.liveTaskStatus);
  const liveStatus = hasLiveTask
    ? (payload.liveTaskStatus === "completed" ? "succeeded" : payload.liveTaskStatus)
    : (payload.job?.status || payload.status || "processing");
  const apiMessage = getApiMessage(payload.job || {});
  const sessionFixNeeded = isSessionFixNeededMessage(apiMessage) || isSessionFixNeededMessage(payload.errorMessage);
  const liveStage = String(payload.liveStage || "").trim();
  const liveProgress = Number.isFinite(Number(payload.liveProgress)) ? Number(payload.liveProgress) : null;
  const liveErrorMessage = String(payload.liveErrorMessage || "").trim();

  let statusHint;
  if (hasLiveTask) {
    statusHint = liveErrorMessage || payload.liveMessage || "任务状态会自动刷新。";
  } else {
    statusHint = {
      pending: "任务已进入队列，等待系统处理。",
      processing: "任务正在处理中，状态会自动刷新。",
      succeeded: "任务已完成，无需手动刷新。",
      failed: sessionFixNeeded
        ? "Session 内容有误或已失效，请修正后重新提交。当前卡密会自动释放，可重新发起兑换。"
        : "任务处理失败，请根据错误信息或稍后重试。",
      cancelled: "任务已取消。"
    }[String(liveStatus).toLowerCase()] || "任务状态会自动刷新。";
  }

  const queueHtml = hasLiveTask && payload.queuePosition != null
    ? `<div class="result-item"><span>排队位置</span><strong>第 ${escapeHtml(payload.queuePosition)} 位</strong></div>`
    : "";
  const progressHtml = hasLiveTask && liveProgress != null
    ? `<div class="result-item"><span>处理进度</span><strong>${escapeHtml(liveProgress)}%</strong></div>`
    : "";
  const stageHtml = hasLiveTask && liveStage
    ? `<div class="result-item result-item-wide"><span>当前阶段</span><strong>${escapeHtml(liveStage)}</strong></div>`
    : "";

  return `
    <div class="result-card">
      <div class="result-title">任务已提交</div>
      ${renderStatusBadge(liveStatus)}
      <div class="result-grid">
        <div class="result-item">
          <span>订单号</span>
          <strong>${escapeHtml(payload.orderNo)}</strong>
        </div>
        <div class="result-item">
          <span>实时任务状态</span>
          <strong>${renderStatusText(liveStatus)}</strong>
        </div>
        ${queueHtml}
        ${progressHtml}
        ${stageHtml}
        <div class="result-item result-item-wide">
          <span>处理说明</span>
          <strong>${statusHint}</strong>
        </div>
        <div class="result-item">
          <span>重试次数</span>
          <strong>${escapeHtml(payload.job?.attemptCount ?? 0)}</strong>
        </div>
      </div>
      ${apiMessage ? `<div class="result-item result-item-wide"><span>接口返回消息</span><strong>${escapeHtml(apiMessage)}</strong></div>` : ""}
      ${hasLiveTask && liveErrorMessage ? `<div class="result-item result-item-wide"><span>远端失败原因</span><strong>${escapeHtml(liveErrorMessage)}</strong></div>` : ""}
      ${!hasLiveTask && payload.errorMessage ? `<div class="result-item result-item-wide"><span>错误信息</span><strong>${escapeHtml(payload.errorMessage)}</strong></div>` : ""}
    </div>
  `;
}

function renderOrderResult(payload) {
  const job = payload.job || {};
  const apiMessage = getApiMessage(job);
  const title = payload.lookupType === "publicKey" ? "卡密关联订单" : "订单追踪结果";
  const liveProgress = Number.isFinite(Number(payload.liveProgress)) ? Number(payload.liveProgress) : null;
  return `
    <div class="result-card compact-card">
      <div class="result-title">${title}</div>
      ${renderStatusBadge(payload.status)}
      <div class="result-grid compact-grid">
        ${payload.lookupType === "publicKey" ? `
          <div class="result-item">
            <span>查询卡密</span>
            <strong>${escapeHtml(payload.queryValue || payload.publicKey)}</strong>
          </div>
        ` : ""}
        <div class="result-item">
          <span>订单号</span>
          <strong>${escapeHtml(payload.orderNo)}</strong>
        </div>
        <div class="result-item">
          <span>卡密</span>
          <strong>${escapeHtml(payload.publicKey)}</strong>
        </div>
        <div class="result-item">
          <span>商品</span>
          <strong>${escapeHtml(payload.productTitle)}</strong>
        </div>
        <div class="result-item">
          <span>任务状态</span>
          <strong>${job.status ? renderStatusText(job.status) : "-"}</strong>
        </div>
        <div class="result-item">
          <span>远端状态</span>
          <strong>${payload.liveTaskStatus ? renderStatusText(payload.liveTaskStatus) : "-"}</strong>
        </div>
        <div class="result-item">
          <span>重试次数</span>
          <strong>${escapeHtml(job.attemptCount ?? 0)}</strong>
        </div>
        <div class="result-item">
          <span>处理进度</span>
          <strong>${liveProgress != null ? `${escapeHtml(liveProgress)}%` : "-"}</strong>
        </div>
        <div class="result-item">
          <span>用户邮箱</span>
          <strong>${escapeHtml(payload.sessionPreview?.email || "-")}</strong>
        </div>
        <div class="result-item">
          <span>覆盖提交</span>
          <strong>${payload.abandonRemainingTime ? "是" : "否"}</strong>
        </div>
        <div class="result-item result-item-wide">
          <span>当前阶段</span>
          <strong>${escapeHtml(payload.liveStage || payload.liveMessage || "-")}</strong>
        </div>
        ${payload.cdkeyStatus ? `
          <div class="result-item">
            <span>卡密状态</span>
            <strong>${renderStatusText(payload.cdkeyStatus)}</strong>
          </div>
        ` : ""}
      </div>
      ${apiMessage ? `<div class="result-item result-item-wide"><span>接口返回消息</span><strong>${escapeHtml(apiMessage)}</strong></div>` : ""}
      ${payload.liveErrorMessage ? `<div class="result-item result-item-wide"><span>远端失败原因</span><strong>${escapeHtml(payload.liveErrorMessage)}</strong></div>` : ""}
      ${payload.errorMessage ? `<div class="result-item"><span>错误信息</span><strong>${escapeHtml(payload.errorMessage)}</strong></div>` : ""}
    </div>
  `;
}

function renderCdkeyResult(payload) {
  return `
    <div class="result-card compact-card">
      <div class="result-title">卡密查询结果</div>
      ${renderStatusBadge(payload.status)}
      <div class="result-grid compact-grid">
        <div class="result-item">
          <span>卡密</span>
          <strong>${escapeHtml(payload.publicKey)}</strong>
        </div>
        <div class="result-item">
          <span>当前状态</span>
          <strong>${renderStatusText(payload.status)}</strong>
        </div>
        <div class="result-item">
          <span>商品</span>
          <strong>${escapeHtml(payload.productTitle)}</strong>
        </div>
        <div class="result-item">
          <span>网站</span>
          <strong>${escapeHtml(payload.siteName || "-")}</strong>
        </div>
        <div class="result-item">
          <span>最近订单号</span>
          <strong>${escapeHtml(payload.latestOrderNo || "暂无")}</strong>
        </div>
        <div class="result-item">
          <span>当前可兑换</span>
          <strong>${payload.canRedeem ? "是" : "否"}</strong>
        </div>
      </div>
      <div class="result-item result-item-wide">
        <span>说明</span>
        <strong>该卡密当前没有可展示的订单记录，可继续使用卡密状态判断处理进度。</strong>
      </div>
    </div>
  `;
}

function parseLookupIdentifiers(rawValue) {
  return Array.from(new Set(
    String(rawValue ?? "")
      .split(/[\s,]+/)
      .map((item) => item.trim())
      .filter(Boolean)
  ));
}

function renderBatchLookupItem(item) {
  const job = item.job || {};
  const apiMessage = getApiMessage(job);
  const headLabel = item.lookupKind === "cdkey"
    ? escapeHtml(item.publicKey)
    : escapeHtml(item.orderNo);

  const queryHint = item.lookupType === "publicKey"
    ? `
        <div class="result-item">
          <span>查询卡密</span>
          <strong>${escapeHtml(item.queryValue || item.publicKey)}</strong>
        </div>
      `
    : "";

  if (item.lookupKind === "cdkey") {
    return `
      <article class="batch-order-card">
        <div class="batch-order-head">
          <strong>${headLabel}</strong>
          ${renderStatusBadge(item.status)}
        </div>
        <div class="result-grid compact-grid">
          ${queryHint}
          <div class="result-item">
            <span>商品</span>
            <strong>${escapeHtml(item.productTitle)}</strong>
          </div>
          <div class="result-item">
            <span>网站</span>
            <strong>${escapeHtml(item.siteName || "-")}</strong>
          </div>
          <div class="result-item">
            <span>最近订单号</span>
            <strong>${escapeHtml(item.latestOrderNo || "暂无")}</strong>
          </div>
          <div class="result-item">
            <span>当前可兑换</span>
            <strong>${item.canRedeem ? "是" : "否"}</strong>
          </div>
        </div>
      </article>
    `;
  }

  return `
    <article class="batch-order-card">
      <div class="batch-order-head">
        <strong>${headLabel}</strong>
        ${renderStatusBadge(item.status)}
      </div>
      <div class="result-grid compact-grid">
        ${queryHint}
        <div class="result-item">
          <span>订单号</span>
          <strong>${escapeHtml(item.orderNo)}</strong>
        </div>
        <div class="result-item">
          <span>卡密</span>
          <strong>${escapeHtml(item.publicKey)}</strong>
        </div>
        <div class="result-item">
          <span>商品</span>
          <strong>${escapeHtml(item.productTitle)}</strong>
        </div>
        <div class="result-item">
          <span>任务状态</span>
          <strong>${job.status ? renderStatusText(job.status) : "-"}</strong>
        </div>
        <div class="result-item">
          <span>重试次数</span>
          <strong>${escapeHtml(job.attemptCount ?? 0)}</strong>
        </div>
        <div class="result-item">
          <span>覆盖提交</span>
          <strong>${item.abandonRemainingTime ? "是" : "否"}</strong>
        </div>
      </div>
      ${apiMessage ? `<div class="result-item result-item-wide"><span>接口返回消息</span><strong>${escapeHtml(apiMessage)}</strong></div>` : ""}
      ${item.errorMessage ? `<div class="result-item result-item-wide"><span>错误信息</span><strong>${escapeHtml(item.errorMessage)}</strong></div>` : ""}
    </article>
  `;
}

function renderBatchLookupResults(payload) {
  const resultType = payload.items.some((item) => item.lookupKind === "order")
    && payload.items.some((item) => item.lookupKind === "cdkey")
    ? "混合"
    : payload.items.some((item) => item.lookupKind === "cdkey")
      ? "卡密"
      : "订单";
  const summary = `
    <div class="result-card">
      <div class="result-title">批量查询结果</div>
      <div class="result-grid result-grid-summary">
        <div class="result-item">
          <span>查询总数</span>
          <strong>${escapeHtml(payload.total)}</strong>
        </div>
        <div class="result-item">
          <span>命中结果</span>
          <strong>${escapeHtml(payload.found)}</strong>
        </div>
        <div class="result-item">
          <span>未找到</span>
          <strong>${escapeHtml(payload.missing)}</strong>
        </div>
        <div class="result-item">
          <span>结果类型</span>
          <strong>${resultType}</strong>
        </div>
      </div>
    </div>
  `;

  const itemsHtml = payload.items.map(renderBatchLookupItem).join("");

  const missingHtml = payload.missingIdentifiers?.length
    ? `
      <div class="result-card">
        <div class="result-title">未找到的订单号 / 卡密</div>
        <div class="missing-list">
          ${payload.missingIdentifiers.map((item) => `<code>${escapeHtml(item)}</code>`).join("")}
        </div>
      </div>
    `
    : "";

  return `
    <div class="batch-results">
      ${summary}
      ${itemsHtml}
      ${missingHtml}
    </div>
  `;
}

async function refreshRedeemStatus(orderNo) {
  const payload = await request(`/api/public/orders/${encodeURIComponent(orderNo)}`);
  statusContainer.innerHTML = renderRedeemSuccess(payload);
  if (!shouldKeepPolling(payload)) {
    stopRedeemStatusPolling();
  }
  return payload;
}

function startRedeemStatusPolling(orderNo) {
  stopRedeemStatusPolling();
  redeemStatusTimer = window.setInterval(() => {
    refreshRedeemStatus(orderNo).catch(() => {});
  }, LIVE_STATUS_POLL_MS);
}

async function request(path, options = {}) {
  const {
    headers = {},
    ...restOptions
  } = options;

  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...headers
    },
    ...restOptions
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.message || "请求失败");
  }
  return payload;
}

verifyForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setState(verifyResult, "正在验证卡密...");
  resetSupportState({ clearOtp: true });
  supportPanel.classList.add("hidden");

  try {
    const payload = await request("/api/public/cdkeys/verify", {
      method: "POST",
      body: JSON.stringify({
        publicKey: publicKeyInput.value.trim()
      })
    });

    verifiedKey = payload.canRedeem ? payload.publicKey : null;
    verifiedSiteSlug = payload.canRedeem ? (payload.siteSlug || null) : null;
    redeemSubmit.disabled = !payload.canRedeem;
    syncSupportPanel(verifiedSiteSlug);
    setRichState(verifyResult, renderVerifyResult(payload), payload.canRedeem ? "success" : "error");
    
    if (payload.canRedeem) {
      setTimeout(() => {
        goToStep(2);
      }, 1500);
    }
  } catch (error) {
    verifiedKey = null;
    verifiedSiteSlug = null;
    redeemSubmit.disabled = true;
    resetSupportState({ clearOtp: true });
    supportPanel.classList.add("hidden");
    setState(verifyResult, error.message, "error");
  }
});

supportAccessResetBtn.addEventListener("click", () => {
  supportPublicKeyInput.value = "";
  resetSupportState({ clearOtp: true });
  setState(supportAccessResult, "请输入卡密后开始接码验证。");
});

supportAccessForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const publicKey = supportPublicKeyInput.value.trim();
  if (!publicKey) {
    setState(supportAccessResult, "请输入卡密。", "error");
    return;
  }

  try {
    await handleSupportCdkeyAccess(publicKey);
  } catch (error) {
    verifiedKey = null;
    verifiedSiteSlug = null;
    resetSupportState({ clearOtp: true });
    setState(supportAccessResult, error.message, "error");
  }
});

refreshAccountBtn.addEventListener("click", async () => {
  try {
    await loadSupportAccount();
  } catch (error) {
    setState(supportAccountResult, error.message, "error");
  }
});

fetchOtpBtn.addEventListener("click", async () => {
  try {
    await loadSupportOtps();
  } catch (error) {
    setState(supportOtpResult, error.message, "error");
  }
});

supportLogoutBtn.addEventListener("click", async () => {
  try {
    supportLogoutBtn.disabled = true;
    await logoutSupportAccount();
    resetSupportState({ clearOtp: true });
    setState(supportAuthResult, "已退出当前接码会话，请重新验证接码卡密。", "success");
  } catch (error) {
    supportLogoutBtn.disabled = false;
    setState(supportAuthResult, error.message, "error");
  }
});

copySupportExportBtn.addEventListener("click", async () => {
  try {
    const payload = await fetchSupportExport(supportExportFormat, { silent: true });
    const exportText = normalizeSupportExportText(payload.data).trim();
    if (!exportText) {
      setState(supportExportResult, "当前格式没有可复制的导出内容。", "error");
      return;
    }
    await copyText(exportText);
    setState(supportExportResult, `${String(payload.format || supportExportFormat).toUpperCase()} 导出内容已复制。`, "success");
  } catch (error) {
    setState(supportExportResult, error.message, "error");
  }
});

fetchSupportExportBtn.addEventListener("click", async () => {
  try {
    await fetchSupportExport(supportExportFormat);
  } catch (error) {
    setState(supportExportResult, error.message, "error");
  }
});

supportExportFormatButtons.forEach((button) => {
  button.addEventListener("click", async () => {
    try {
      await fetchSupportExport(button.dataset.format || "cpa");
    } catch (error) {
      setState(supportExportResult, error.message, "error");
    }
  });
});

// --- Confirm Modal ---

const confirmModal = document.querySelector("#confirm-modal");
const confirmEmailEl = document.querySelector("#confirm-email");
const confirmCdkeyEl = document.querySelector("#confirm-cdkey");
const confirmAbandonEl = document.querySelector("#confirm-abandon");
const confirmOkBtn = document.querySelector("#confirm-ok");
const confirmCancelBtn = document.querySelector("#confirm-cancel");

let pendingRedeemData = null;

function extractEmail(sessionData = {}) {
  return sessionData.user?.email
    || sessionData.email
    || sessionData.account?.email
    || sessionData.user?.name
    || "";
}

function showConfirmModal(email, publicKey, abandonRemainingTime) {
  confirmEmailEl.textContent = email || "未检测到邮箱";
  confirmCdkeyEl.textContent = publicKey || "-";
  confirmAbandonEl.textContent = abandonRemainingTime ? "开启（将覆盖旧会员）" : "关闭（仅续费）";
  confirmModal.classList.remove("hidden");
}

function hideConfirmModal() {
  confirmModal.classList.add("hidden");
  pendingRedeemData = null;
}

async function executeRedeem(sessionPayload, abandonRemainingTime) {
  stopRedeemStatusPolling();
  setState(redeemResult, "正在提交兑换任务...");
  const payload = await request("/api/public/redeem", {
    method: "POST",
    body: JSON.stringify({
      publicKey: verifiedKey,
      sessionPayload,
      abandonRemainingTime
    })
  });

  orderNoInput.value = payload.orderNo;
  goToStep(3);
  await refreshRedeemStatus(payload.orderNo);
  startRedeemStatusPolling(payload.orderNo);
}

confirmOkBtn.addEventListener("click", async () => {
  if (!pendingRedeemData) return;
  const { sessionPayload, abandonRemainingTime } = pendingRedeemData;
  hideConfirmModal();
  try {
    await executeRedeem(sessionPayload, abandonRemainingTime);
  } catch (error) {
    setState(redeemResult, error.message, "error");
  }
});

confirmCancelBtn.addEventListener("click", () => {
  hideConfirmModal();
});

confirmModal.addEventListener("click", (event) => {
  if (event.target === confirmModal) {
    hideConfirmModal();
  }
});

redeemForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!verifiedKey) {
    setState(redeemResult, "请先验证卡密。", "error");
    return;
  }

  try {
    const sessionPayload = document.querySelector("#session-payload").value.trim();
    const sessionData = parseSessionPayloadInput(sessionPayload);
    validateSessionForSiteSlug(verifiedSiteSlug, sessionData);
    const abandonRemainingTime = shouldConfirmOverwrite(sessionData);
    const email = extractEmail(sessionData);

    pendingRedeemData = { sessionPayload, abandonRemainingTime };
    showConfirmModal(email, verifiedKey, abandonRemainingTime);
  } catch (error) {
    setState(redeemResult, error.message, "error");
  }
});

lookupForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setState(orderResult, "正在查询订单 / 卡密...");

  try {
    const identifiers = parseLookupIdentifiers(orderNoInput.value);
    if (!identifiers.length) {
      setState(orderResult, "请先输入至少一个订单号或卡密。", "error");
      return;
    }

    const payload = await request("/api/public/lookups/batch", {
      method: "POST",
      body: JSON.stringify({ identifiers })
    });

    if (payload.total === 1) {
      if (!payload.found) {
        setState(orderResult, `未找到对应的订单或卡密：${identifiers[0]}`, "error");
        return;
      }

      const item = payload.items[0];
      setRichState(
        orderResult,
        item.lookupKind === "cdkey" ? renderCdkeyResult(item) : renderOrderResult(item),
        "success"
      );
      return;
    }

    setRichState(orderResult, renderBatchLookupResults(payload), "success");
  } catch (error) {
    setState(orderResult, error.message, "error");
  }
});

const initialViewTarget = String(window.location.hash || "").replace(/^#/, "").trim().toLowerCase();
if (["query", "faq", "support"].includes(initialViewTarget)) {
  switchView(initialViewTarget);
} else {
  updateViewHash("wizard");
}
