const API_BASE = (globalThis.KAWANG_CONFIG?.apiUrl || "http://127.0.0.1:4300").replace(/\/+$/, "");

// --- DOM References ---

const verifyForm = document.querySelector("#verify-form");
const verifyResult = document.querySelector("#verify-result");
const redeemForm = document.querySelector("#redeem-form");
const redeemSubmit = document.querySelector("#redeem-submit");
const redeemResult = document.querySelector("#redeem-result");
const lookupForm = document.querySelector("#lookup-form");
const orderResult = document.querySelector("#order-result");
const publicKeyInput = document.querySelector("#public-key");
const orderNoInput = document.querySelector("#order-no");
const smsForm = document.querySelector("#sms-form");
const smsKeyInput = document.querySelector("#sms-key");
const smsVerifyBtn = document.querySelector("#sms-verify-btn");
const smsSubmit = document.querySelector("#sms-submit");
const smsResult = document.querySelector("#sms-result");
const statusContainer = document.querySelector("#status-container");
const confirmModal = document.querySelector("#confirm-modal");
const confirmEmailEl = document.querySelector("#confirm-email");
const confirmCdkeyEl = document.querySelector("#confirm-cdkey");
const confirmAbandonEl = document.querySelector("#confirm-abandon");
const confirmOkBtn = document.querySelector("#confirm-ok");
const confirmCancelBtn = document.querySelector("#confirm-cancel");
const smsConfirmModal = document.querySelector("#sms-confirm-modal");
const smsConfirmOkBtn = document.querySelector("#sms-confirm-ok");
const smsConfirmCancelBtn = document.querySelector("#sms-confirm-cancel");

// --- State ---

let verifiedKey = null;
let verifiedSiteSlug = null;
let redeemStatusTimer = null;
let pendingRedeemData = null;
let verifiedSmsCard = null;
let currentSmsOrderNo = null;
let smsSubmitCooldownTimer = null;
let pendingSmsConfirmResolve = null;

// --- Constants ---

const LIVE_STATUS_POLL_MS = 2000;
const SMS_LEGACY_RETRY_SECONDS = 60;

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

// --- Utilities ---

function setState(element, message, type = "muted") {
  element.className = `result ${type}`;
  element.textContent = message;
}

function setRichState(element, html, type = "muted") {
  element.className = `result ${type}`;
  element.innerHTML = html;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
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
  return { high: "库存充足", low: "库存偏少", none: "库存为空" }[normalized] || "-";
}

// --- API ---

async function request(path, options = {}) {
  const { headers = {}, ...restOptions } = options;

  const response = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...headers },
    ...restOptions
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.message || "请求失败");
  }
  return payload;
}

// --- Navigation ---

function switchView(target) {
  // 切换页签时清理 SMS 轮询
  stopSmsPolling();
  document.querySelectorAll(".view-section").forEach((section) => {
    section.classList.toggle("hidden", section.id !== `${target}-container`);
  });
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.target === target);
  });
}

function goToStep(step) {
  document.querySelectorAll(".wizard-pane").forEach((pane) => {
    pane.classList.toggle("active", pane.id === `step-${step}`);
  });
  document.querySelectorAll(".step-dot").forEach((dot) => {
    dot.classList.toggle("active", parseInt(dot.dataset.step) === step);
  });
}

document.querySelectorAll(".nav-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const target = btn.dataset.target;
    if (target === "stock") { window.location.href = "./stock.html"; return; }
    if (target === "subscription") { window.location.href = "./subscription.html"; return; }
    if (target === "quota") { window.location.href = "./quota.html"; return; }
    if (target) switchView(target);
  });
});

document.querySelector("#back-to-step-1").addEventListener("click", () => goToStep(1));

document.querySelector("#start-over").addEventListener("click", () => {
  verifiedKey = null;
  verifiedSiteSlug = null;
  publicKeyInput.value = "";
  document.querySelector("#session-payload").value = "";
  setState(verifyResult, "请输入卡密并点击验证。");
  setState(redeemResult, "等待提交任务...");
  redeemSubmit.disabled = true;
  stopRedeemStatusPolling();
  goToStep(1);
});

// --- Polling ---

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

async function refreshRedeemStatus(orderNo) {
  const payload = await request(`/api/public/orders/${encodeURIComponent(orderNo)}`);
  statusContainer.innerHTML = renderRedeemSuccess(payload);
  if (!shouldKeepPolling(payload)) stopRedeemStatusPolling();
  return payload;
}

function startRedeemStatusPolling(orderNo) {
  stopRedeemStatusPolling();
  redeemStatusTimer = window.setInterval(() => {
    refreshRedeemStatus(orderNo).catch(() => {});
  }, LIVE_STATUS_POLL_MS);
}

// --- Session Validation ---

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
  return [sessionData.planType, sessionData.user?.planType, sessionData.account?.planType]
    .find((v) => typeof v === "string" && v.trim()) || "";
}

function shouldConfirmOverwrite(sessionData) {
  return extractPlanType(sessionData).toLowerCase().includes("plus");
}

function extractEmail(sessionData = {}) {
  return sessionData.user?.email || sessionData.email || sessionData.account?.email || sessionData.user?.name || "";
}

function isSessionFixNeededMessage(message) {
  const keywords = [
    "token已失效", "token无效", "token 已失效", "token 无效",
    "token内容格式错误", "token 内容格式错误",
    "session格式错误", "session 格式错误", "session 无效", "session无效",
    "缺少account字段", "缺少 account 字段", "字段缺失",
    "missing account", "account field is required",
    "token expired", "token invalid", "invalid token", "expired token",
    "invalid_session", "invalid session", "session_invalid",
    "session信息或账号异常", "复制全部内容重新提交"
  ];
  const lower = String(message ?? "").toLowerCase();
  return keywords.some((kw) => lower.includes(kw));
}

function getApiMessage(job = {}) {
  const json = job.lastResponse?.json || {};
  const code = json.code || json.data?.code;
  const message = json.error_msg || json.error || json.result || json.msg || json.message
    || json.data?.error_msg || json.data?.error || json.data?.msg || json.data?.message || "";
  if (code && message) return `${code}: ${message}`;
  return message || (code ? String(code) : "");
}

// --- Render Functions ---

function renderVerifyResult(payload) {
  const title = payload.canRedeem ? "验证成功，正在跳转..." : "卡密验证完成";
  const badgeStatus = payload.canRedeem ? payload.status : (payload.remoteAvailable === false ? "unavailable" : (payload.status || "unknown"));
  const verifyMessage = payload.canRedeem ? "远端校验通过" : (payload.remoteError || "远端校验未通过");

  return `
    <div class="result-card">
      <div class="result-title">${title}</div>
      ${renderStatusBadge(badgeStatus)}
      <div class="result-grid">
        <div class="result-item"><span>商品</span><strong>${escapeHtml(payload.productTitle)}</strong></div>
        <div class="result-item"><span>网站</span><strong>${escapeHtml(payload.siteName || payload.endpointName)}</strong></div>
        <div class="result-item"><span>本地状态</span><strong>${renderStatusText(payload.status)}</strong></div>
        <div class="result-item"><span>远端校验</span><strong>${escapeHtml(verifyMessage)}</strong></div>
        <div class="result-item"><span>可兑换</span><strong>${payload.canRedeem ? "是" : "否"}</strong></div>
        <div class="result-item"><span>库存等级</span><strong>${escapeHtml(getStockLevelLabel(payload.stockLevel))}</strong></div>
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
    ? `<div class="result-item"><span>排队位置</span><strong>第 ${escapeHtml(payload.queuePosition)} 位</strong></div>` : "";
  const progressHtml = hasLiveTask && liveProgress != null
    ? `<div class="result-item"><span>处理进度</span><strong>${escapeHtml(liveProgress)}%</strong></div>` : "";
  const stageHtml = hasLiveTask && liveStage
    ? `<div class="result-item result-item-wide"><span>当前阶段</span><strong>${escapeHtml(liveStage)}</strong></div>` : "";

  return `
    <div class="result-card">
      <div class="result-title">任务已提交</div>
      ${renderStatusBadge(liveStatus)}
      <div class="result-grid">
        <div class="result-item"><span>订单号</span><strong>${escapeHtml(payload.orderNo)}</strong></div>
        <div class="result-item"><span>实时任务状态</span><strong>${renderStatusText(liveStatus)}</strong></div>
        ${queueHtml}
        ${progressHtml}
        ${stageHtml}
        <div class="result-item result-item-wide"><span>处理说明</span><strong>${statusHint}</strong></div>
        <div class="result-item"><span>重试次数</span><strong>${escapeHtml(payload.job?.attemptCount ?? 0)}</strong></div>
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
        ${payload.lookupType === "publicKey" ? `<div class="result-item"><span>查询卡密</span><strong>${escapeHtml(payload.queryValue || payload.publicKey)}</strong></div>` : ""}
        <div class="result-item"><span>订单号</span><strong>${escapeHtml(payload.orderNo)}</strong></div>
        <div class="result-item"><span>卡密</span><strong>${escapeHtml(payload.publicKey)}</strong></div>
        <div class="result-item"><span>商品</span><strong>${escapeHtml(payload.productTitle)}</strong></div>
        <div class="result-item"><span>任务状态</span><strong>${job.status ? renderStatusText(job.status) : "-"}</strong></div>
        <div class="result-item"><span>远端状态</span><strong>${payload.liveTaskStatus ? renderStatusText(payload.liveTaskStatus) : "-"}</strong></div>
        <div class="result-item"><span>重试次数</span><strong>${escapeHtml(job.attemptCount ?? 0)}</strong></div>
        <div class="result-item"><span>处理进度</span><strong>${liveProgress != null ? `${escapeHtml(liveProgress)}%` : "-"}</strong></div>
        <div class="result-item"><span>用户邮箱</span><strong>${escapeHtml(payload.sessionPreview?.email || "-")}</strong></div>
        <div class="result-item"><span>覆盖提交</span><strong>${payload.abandonRemainingTime ? "是" : "否"}</strong></div>
        <div class="result-item result-item-wide"><span>当前阶段</span><strong>${escapeHtml(payload.liveStage || payload.liveMessage || "-")}</strong></div>
        ${payload.cdkeyStatus ? `<div class="result-item"><span>卡密状态</span><strong>${renderStatusText(payload.cdkeyStatus)}</strong></div>` : ""}
      </div>
      ${apiMessage ? `<div class="result-item result-item-wide"><span>接口返回消息</span><strong>${escapeHtml(apiMessage)}</strong></div>` : ""}
      ${payload.liveErrorMessage ? `<div class="result-item result-item-wide"><span>远端失败原因</span><strong>${escapeHtml(payload.liveErrorMessage)}</strong></div>` : ""}
      ${payload.errorMessage ? `<div class="result-item result-item-wide"><span>错误信息</span><strong>${escapeHtml(payload.errorMessage)}</strong></div>` : ""}
    </div>
  `;
}

function renderCdkeyResult(payload) {
  return `
    <div class="result-card compact-card">
      <div class="result-title">卡密查询结果</div>
      ${renderStatusBadge(payload.status)}
      <div class="result-grid compact-grid">
        <div class="result-item"><span>卡密</span><strong>${escapeHtml(payload.publicKey)}</strong></div>
        <div class="result-item"><span>当前状态</span><strong>${renderStatusText(payload.status)}</strong></div>
        <div class="result-item"><span>商品</span><strong>${escapeHtml(payload.productTitle)}</strong></div>
        <div class="result-item"><span>网站</span><strong>${escapeHtml(payload.siteName || "-")}</strong></div>
        <div class="result-item"><span>最近订单号</span><strong>${escapeHtml(payload.latestOrderNo || "暂无")}</strong></div>
        <div class="result-item"><span>当前可兑换</span><strong>${payload.canRedeem ? "是" : "否"}</strong></div>
      </div>
      <div class="result-item result-item-wide">
        <span>说明</span>
        <strong>该卡密当前没有可展示的订单记录，可继续使用卡密状态判断处理进度。</strong>
      </div>
    </div>
  `;
}

// --- Batch Lookup ---

function parseLookupIdentifiers(rawValue) {
  return Array.from(new Set(
    String(rawValue ?? "").split(/[\s,]+/).map((s) => s.trim()).filter(Boolean)
  ));
}

function renderBatchLookupItem(item) {
  const job = item.job || {};
  const apiMessage = getApiMessage(job);
  const headLabel = item.lookupKind === "cdkey" ? escapeHtml(item.publicKey) : escapeHtml(item.orderNo);
  const queryHint = item.lookupType === "publicKey"
    ? `<div class="result-item"><span>查询卡密</span><strong>${escapeHtml(item.queryValue || item.publicKey)}</strong></div>`
    : "";

  if (item.lookupKind === "cdkey") {
    return `
      <article class="batch-order-card">
        <div class="batch-order-head"><strong>${headLabel}</strong>${renderStatusBadge(item.status)}</div>
        <div class="result-grid compact-grid">
          ${queryHint}
          <div class="result-item"><span>商品</span><strong>${escapeHtml(item.productTitle)}</strong></div>
          <div class="result-item"><span>网站</span><strong>${escapeHtml(item.siteName || "-")}</strong></div>
          <div class="result-item"><span>最近订单号</span><strong>${escapeHtml(item.latestOrderNo || "暂无")}</strong></div>
          <div class="result-item"><span>当前可兑换</span><strong>${item.canRedeem ? "是" : "否"}</strong></div>
        </div>
      </article>
    `;
  }

  return `
    <article class="batch-order-card">
      <div class="batch-order-head"><strong>${headLabel}</strong>${renderStatusBadge(item.status)}</div>
      <div class="result-grid compact-grid">
        ${queryHint}
        <div class="result-item"><span>订单号</span><strong>${escapeHtml(item.orderNo)}</strong></div>
        <div class="result-item"><span>卡密</span><strong>${escapeHtml(item.publicKey)}</strong></div>
        <div class="result-item"><span>商品</span><strong>${escapeHtml(item.productTitle)}</strong></div>
        <div class="result-item"><span>任务状态</span><strong>${job.status ? renderStatusText(job.status) : "-"}</strong></div>
        <div class="result-item"><span>重试次数</span><strong>${escapeHtml(job.attemptCount ?? 0)}</strong></div>
        <div class="result-item"><span>覆盖提交</span><strong>${item.abandonRemainingTime ? "是" : "否"}</strong></div>
      </div>
      ${apiMessage ? `<div class="result-item result-item-wide"><span>接口返回消息</span><strong>${escapeHtml(apiMessage)}</strong></div>` : ""}
      ${item.errorMessage ? `<div class="result-item result-item-wide"><span>错误信息</span><strong>${escapeHtml(item.errorMessage)}</strong></div>` : ""}
    </article>
  `;
}

function renderBatchLookupResults(payload) {
  const resultType = payload.items.some((i) => i.lookupKind === "order") && payload.items.some((i) => i.lookupKind === "cdkey")
    ? "混合"
    : payload.items.some((i) => i.lookupKind === "cdkey") ? "卡密" : "订单";

  const summary = `
    <div class="result-card">
      <div class="result-title">批量查询结果</div>
      <div class="result-grid result-grid-summary">
        <div class="result-item"><span>查询总数</span><strong>${escapeHtml(payload.total)}</strong></div>
        <div class="result-item"><span>命中结果</span><strong>${escapeHtml(payload.found)}</strong></div>
        <div class="result-item"><span>未找到</span><strong>${escapeHtml(payload.missing)}</strong></div>
        <div class="result-item"><span>结果类型</span><strong>${resultType}</strong></div>
      </div>
    </div>
  `;

  const itemsHtml = payload.items.map(renderBatchLookupItem).join("");

  const missingHtml = payload.missingIdentifiers?.length
    ? `<div class="result-card"><div class="result-title">未找到的订单号 / 卡密</div><div class="missing-list">${payload.missingIdentifiers.map((id) => `<code>${escapeHtml(id)}</code>`).join("")}</div></div>`
    : "";

  return `<div class="batch-results">${summary}${itemsHtml}${missingHtml}</div>`;
}

// --- Confirm Modal ---

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

function showSmsConfirmModal() {
  smsConfirmModal.classList.remove("hidden");
  return new Promise((resolve) => {
    pendingSmsConfirmResolve = resolve;
  });
}

function resolveSmsConfirmModal(confirmed) {
  smsConfirmModal.classList.add("hidden");
  if (!pendingSmsConfirmResolve) return;

  const resolve = pendingSmsConfirmResolve;
  pendingSmsConfirmResolve = null;
  resolve(confirmed);
}

async function executeRedeem(sessionPayload, abandonRemainingTime) {
  stopRedeemStatusPolling();
  setState(redeemResult, "正在提交兑换任务...");
  const payload = await request("/api/public/redeem", {
    method: "POST",
    body: JSON.stringify({ publicKey: verifiedKey, sessionPayload, abandonRemainingTime })
  });

  orderNoInput.value = payload.orderNo;
  goToStep(3);
  await refreshRedeemStatus(payload.orderNo);
  startRedeemStatusPolling(payload.orderNo);
}

// --- Event Handlers ---

verifyForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setState(verifyResult, "正在验证卡密...");

  try {
    const payload = await request("/api/public/cdkeys/verify", {
      method: "POST",
      body: JSON.stringify({ publicKey: publicKeyInput.value.trim() })
    });

    verifiedKey = payload.canRedeem ? payload.publicKey : null;
    verifiedSiteSlug = payload.canRedeem ? (payload.siteSlug || null) : null;
    redeemSubmit.disabled = !payload.canRedeem;
    setRichState(verifyResult, renderVerifyResult(payload), payload.canRedeem ? "success" : "error");

    if (payload.canRedeem) {
      setTimeout(() => goToStep(2), 1500);
    }
  } catch (error) {
    verifiedKey = null;
    verifiedSiteSlug = null;
    redeemSubmit.disabled = true;
    setState(verifyResult, error.message, "error");
  }
});

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

confirmCancelBtn.addEventListener("click", hideConfirmModal);

confirmModal.addEventListener("click", (event) => {
  if (event.target === confirmModal) hideConfirmModal();
});

smsConfirmOkBtn.addEventListener("click", () => resolveSmsConfirmModal(true));
smsConfirmCancelBtn.addEventListener("click", () => resolveSmsConfirmModal(false));

smsConfirmModal.addEventListener("click", (event) => {
  if (event.target === smsConfirmModal) resolveSmsConfirmModal(false);
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
      setRichState(orderResult, item.lookupKind === "cdkey" ? renderCdkeyResult(item) : renderOrderResult(item), "success");
      return;
    }

    setRichState(orderResult, renderBatchLookupResults(payload), "success");
  } catch (error) {
    setState(orderResult, error.message, "error");
  }
});

// --- SMS Query ---

let smsPollingInterval = null;

function stopSmsPolling() {
  if (smsPollingInterval) {
    clearInterval(smsPollingInterval);
    smsPollingInterval = null;
  }
}

function stopSmsSubmitCooldown() {
  if (smsSubmitCooldownTimer) {
    clearInterval(smsSubmitCooldownTimer);
    smsSubmitCooldownTimer = null;
  }
  smsSubmit.textContent = "获取号码";
}

function startSmsSubmitCooldown(seconds = SMS_LEGACY_RETRY_SECONDS) {
  stopSmsSubmitCooldown();
  let remaining = seconds;
  smsSubmit.disabled = true;
  smsSubmit.textContent = `${remaining}s 后可再次获取`;

  smsSubmitCooldownTimer = setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) {
      stopSmsSubmitCooldown();
      smsSubmit.disabled = false;
      return;
    }
    smsSubmit.textContent = `${remaining}s 后可再次获取`;
  }, 1000);
}

function startSmsPolling(orderNo) {
  stopSmsPolling();
  smsPollingInterval = setInterval(async () => {
    try {
      const payload = await request(`/api/public/sms/orders/${encodeURIComponent(orderNo)}`);
      setRichState(smsResult, renderSmsOrderResult(payload), payload.verificationStatus === "ready" ? "success" : "muted");
      if (["ready", "timeout"].includes(payload.verificationStatus) || ["ready", "refunded", "failed", "cancelled"].includes(String(payload.status || "").toLowerCase())) {
        stopSmsPolling();
        smsSubmit.disabled = false;
        currentSmsOrderNo = payload.orderNo || null;
      }
    } catch (error) {
      // 轮询请求失败时不中断，下一周期继续
    }
  }, 5000);
}

function startSmsLegacyPolling(cardKey) {
  stopSmsPolling();
  smsPollingInterval = setInterval(async () => {
    try {
      const payload = await request(`/api/public/sms/query?key=${encodeURIComponent(cardKey)}`);
      setRichState(smsResult, renderSmsOrderResult(payload), payload.verificationStatus === "ready" ? "success" : "muted");
      if (["ready", "timeout"].includes(payload.verificationStatus)) {
        stopSmsPolling();
        smsSubmit.disabled = false;
      }
    } catch (error) {
      stopSmsPolling();
      smsSubmit.disabled = false;
      setState(smsResult, error.message || "请求失败，请检查网络连接", "error");
    }
  }, 5000);
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    stopSmsPolling();
  }
});

function renderVerificationStatus(payload) {
  switch (payload.verificationStatus) {
    case "ready":
      return escapeHtml(payload.verificationCode);
    case "pending":
      return "暂无收到验证码";
    case "timeout":
      return "获取验证码超时，请重试";
    case "busy":
      return "系统繁忙，请稍后重试";
    default:
      return "暂无收到验证码";
  }
}

function renderSmsOrderResult(payload) {
  const phoneHtml = `<div class="result-item"><span>手机号</span><strong>${escapeHtml(payload.phone || "-")}</strong></div>`;
  const verificationHtml = `<div class="result-item"><span>验证码</span><strong id="sms-verification-display">${renderVerificationStatus(payload)}</strong></div>`;
  const siteHtml = `<div class="result-item"><span>接码站点</span><strong>${escapeHtml(payload.siteName || verifiedSmsCard?.site?.name || "-")}</strong></div>`;
  const orderHtml = `<div class="result-item"><span>订单号</span><strong>${escapeHtml(payload.orderNo || currentSmsOrderNo || "-")}</strong></div>`;
  return `<div class="result-card"><div class="result-grid">${siteHtml}${orderHtml}${phoneHtml}${verificationHtml}</div></div>`;
}

smsForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  stopSmsPolling();
  stopSmsSubmitCooldown();

  const key = smsKeyInput.value.trim();
  if (!key) {
    setState(smsResult, "请输入接码卡密", "error");
    return;
  }

  smsVerifyBtn.disabled = true;
  smsSubmit.disabled = true;
  setState(smsResult, "正在验证接码卡密...");

  try {
    const payload = await request("/api/public/sms/cards/verify", {
      method: "POST",
      body: JSON.stringify({ cardKey: key })
    });
    verifiedSmsCard = payload;
    currentSmsOrderNo = payload.latestOrder?.orderNo || null;
    smsSubmit.disabled = false;
    setRichState(smsResult, `<div class="result-card"><div class="result-grid"><div class="result-item"><span>接码站点</span><strong>${escapeHtml(payload.site?.name || "-")}</strong></div><div class="result-item"><span>卡密状态</span><strong>${renderStatusText(payload.status)}</strong></div></div></div>`, "success");
    if (payload.latestOrder) {
      setRichState(smsResult, renderSmsOrderResult(payload.latestOrder), payload.latestOrder.verificationStatus === "ready" ? "success" : "muted");
      if (payload.latestOrder.verificationStatus === "pending") {
        startSmsPolling(payload.latestOrder.orderNo);
      }
    }
  } catch (error) {
    verifiedSmsCard = null;
    currentSmsOrderNo = null;
    setState(smsResult, error.message || "请求失败，请检查网络连接", "error");
  } finally {
    smsVerifyBtn.disabled = false;
  }
});

smsSubmit.addEventListener("click", async () => {
  if (!verifiedSmsCard?.cardKey) {
    setState(smsResult, "请先验证接码卡密", "error");
    return;
  }

  const confirmed = await showSmsConfirmModal();
  if (!confirmed) return;

  smsSubmit.disabled = true;
  setState(smsResult, "正在分配手机号并创建接码订单...");

  try {
    if (verifiedSmsCard.legacyStaticEntry) {
      const payload = await request(`/api/public/sms/query?key=${encodeURIComponent(verifiedSmsCard.cardKey)}`);
      currentSmsOrderNo = null;
      setRichState(smsResult, renderSmsOrderResult(payload), payload.verificationStatus === "ready" ? "success" : "muted");
      startSmsSubmitCooldown();
      return;
    }

    const payload = await request("/api/public/sms/orders", {
      method: "POST",
      body: JSON.stringify({ cardKey: verifiedSmsCard.cardKey })
    });
    currentSmsOrderNo = payload.orderNo;
    setRichState(smsResult, renderSmsOrderResult(payload), "success");
    if (payload.verificationStatus === "pending") {
      startSmsPolling(payload.orderNo);
    } else {
      smsSubmit.disabled = false;
    }
  } catch (error) {
    smsSubmit.disabled = false;
    setState(smsResult, error.message || "请求失败，请检查网络连接", "error");
  }
});
