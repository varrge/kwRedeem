const API_BASE = (globalThis.KAWANG_CONFIG?.apiUrl || "http://127.0.0.1:4300").replace(/\/+$/, "");
const API_BASE_CONFIGURED = Boolean(globalThis.KAWANG_CONFIG?.apiUrl);

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
const smsCodeSubmit = document.querySelector("#sms-code-submit");
const smsResult = document.querySelector("#sms-result");
const statusContainer = document.querySelector("#status-container");
const confirmModal = document.querySelector("#confirm-modal");
const confirmEmailEl = document.querySelector("#confirm-email");
const confirmCdkeyEl = document.querySelector("#confirm-cdkey");
const confirmAbandonEl = document.querySelector("#confirm-abandon");
const confirmOkBtn = document.querySelector("#confirm-ok");
const confirmCancelBtn = document.querySelector("#confirm-cancel");
const smsConfirmModal = document.querySelector("#sms-confirm-modal");
const smsConfirmTitle = document.querySelector("#sms-confirm-title");
const smsConfirmDesc = document.querySelector("#sms-confirm-desc");
const smsConfirmOkBtn = document.querySelector("#sms-confirm-ok");
const smsConfirmCancelBtn = document.querySelector("#sms-confirm-cancel");

// --- State ---

let verifiedKey = null;
let verifiedSiteSlug = null;
let verifiedProcessingMode = null;
let redeemStatusTimer = null;
let pendingRedeemData = null;
let verifiedSmsCard = null;
let currentSmsOrderNo = null;
let currentSmsOrder = null;
let pendingSmsConfirmResolve = null;

// --- Constants ---

const LIVE_STATUS_POLL_MS = 2000;
const SMS_POLL_INTERVAL_MS = 3000;

const STATUS_LABELS = {
  active: "可用",
  locked: "锁定中",
  used: "已使用",
  disabled: "已禁用",
  void: "已作废",
  unavailable: "不可兑换",
  pending: "排队中",
  submitting: "正在提交",
  queued: "排队中",
  running: "开通中",
  review: "等待支付对账",
  failed_resolution: "等待人工处理",
  refund_pending: "退款锁定中",
  issuance_uncertain: "发码结果待核对",
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

  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      headers: { "Content-Type": "application/json", ...headers },
      ...restOptions
    });
  } catch (error) {
    const configHint = API_BASE_CONFIGURED
      ? "请确认该 API 地址可从当前浏览器访问，并且 HTTPS/反代/CORS 配置正确。"
      : "未读取到 runtime-config.js，当前退回默认本机 API 地址；线上请在 .env 配置 API_URL 后执行 npm run config:runtime。";
    throw new Error(`无法连接 API：${API_BASE}。${configHint} 原始错误：${error.message || "Failed to fetch"}`);
  }

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
  verifiedProcessingMode = null;
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
  if (order.pollingDisabled) return false;
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

function hasSessionLoginEvidence(sessionData) {
  const candidates = [
    sessionData?.accessToken,
    sessionData?.access_token,
    sessionData?.authToken,
    sessionData?.auth_token,
    sessionData?.idToken,
    sessionData?.id_token,
    sessionData?.sessionToken,
    sessionData?.session_token,
    sessionData?.token,
    sessionData?.email,
    sessionData?.userId,
    sessionData?.user_id,
    sessionData?.accountId,
    sessionData?.account_id,
    sessionData?.user?.id,
    sessionData?.user?.email,
    sessionData?.user?.name,
    sessionData?.account?.id,
    sessionData?.account?.email
  ];
  const cookieObject = sessionData?.cookies && typeof sessionData.cookies === "object" && !Array.isArray(sessionData.cookies)
    ? sessionData.cookies
    : {};
  const cookieCandidates = [
    sessionData?.["__Secure-next-auth.session-token"],
    sessionData?.["next-auth.session-token"],
    cookieObject["__Secure-next-auth.session-token"],
    cookieObject["next-auth.session-token"],
    sessionData?.cookie,
    typeof sessionData?.cookies === "string" ? sessionData.cookies : "",
    ...(Array.isArray(sessionData?.cookies) ? sessionData.cookies.map((item) => item?.value) : []),
    ...Object.entries(sessionData || {})
      .filter(([key]) => /^(__Secure-)?next-auth\.session-token\.\d+$/.test(key))
      .map(([, value]) => value)
  ];
  return [...candidates, ...cookieCandidates].some((value) => typeof value === "string" && value.trim());
}

function validateSessionForSiteSlug(siteSlug, sessionData) {
  if (!hasSessionLoginEvidence(sessionData)) {
    throw new Error("未检测到登录信息，请先登录 ChatGPT，再复制完整的 Session JSON。");
  }
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
  const remoteMessage = payload.remoteMessage || payload.remoteError || "";
  const verifyMessage = payload.canRedeem ? (remoteMessage || "远端校验通过") : (remoteMessage || "远端校验未通过");

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
        ${payload.processingMode === "spacex_cdk" ? `<div class="result-item"><span>激活方式</span><strong>自动化激活</strong></div>` : ""}
        ${payload.spacexPlan ? `<div class="result-item"><span>会员套餐</span><strong>${escapeHtml({ plus: "Plus", pro_5x: "Pro x5", pro_20x: "Pro x20" }[payload.spacexPlan] || payload.spacexPlan)}</strong></div>` : ""}
        <div class="result-item"><span>库存等级</span><strong>${escapeHtml(getStockLevelLabel(payload.stockLevel))}</strong></div>
      </div>
    </div>
  `;
}

function renderRedeemSuccess(payload) {
  const spacexActivation = payload.spaceXCdkActivation || null;
  const manualProcessing = payload.processingMode === "manual" || payload.pollingDisabled;
  const hasLiveTask = Boolean(payload.liveTaskStatus);
  const liveStatus = spacexActivation
    ? (spacexActivation.state === "completed" ? "succeeded" : (spacexActivation.state === "failed_resolution" ? "failed" : "processing"))
    : (hasLiveTask
    ? (payload.liveTaskStatus === "completed" ? "succeeded" : payload.liveTaskStatus)
    : (payload.job?.status || payload.status || "processing"));
  const apiMessage = getApiMessage(payload.job || {});
  const sessionFixNeeded = isSessionFixNeededMessage(apiMessage) || isSessionFixNeededMessage(payload.errorMessage);
  const liveStage = String(payload.liveStage || "").trim();
  const liveProgress = Number.isFinite(Number(payload.liveProgress)) ? Number(payload.liveProgress) : null;
  const liveErrorMessage = String(payload.liveErrorMessage || "").trim();

  let statusHint;
  if (spacexActivation) {
    statusHint = spacexActivation.message || spacexActivation.stateText || "会员状态正在同步。";
  } else if (manualProcessing) {
    statusHint = "任务已提交成功，管理员将根据 session 手动处理。无需停留本页面轮询，后续请用卡密或订单号查看任务进度。";
  } else if (hasLiveTask) {
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
        ${manualProcessing ? `<div class="result-item"><span>处理方式</span><strong>人工处理${payload.manualType ? ` / ${escapeHtml(payload.manualType)}` : ""}</strong></div>` : ""}
        ${spacexActivation ? `<div class="result-item"><span>处理方式</span><strong>自动化激活</strong></div>` : ""}
        ${spacexActivation?.accountMasked ? `<div class="result-item"><span>绑定账号</span><strong>${escapeHtml(spacexActivation.accountMasked)}</strong></div>` : ""}
        ${spacexActivation?.state ? `<div class="result-item"><span>激活状态</span><strong>${renderStatusText(spacexActivation.state)}</strong></div>` : ""}
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
  const spacexActivation = payload.spaceXCdkActivation || null;

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
        ${spacexActivation ? `<div class="result-item"><span>自动化激活状态</span><strong>${renderStatusText(spacexActivation.state)}</strong></div>` : ""}
        ${spacexActivation?.accountMasked ? `<div class="result-item"><span>绑定账号</span><strong>${escapeHtml(spacexActivation.accountMasked)}</strong></div>` : ""}
        <div class="result-item"><span>覆盖提交</span><strong>${payload.abandonRemainingTime ? "是" : "否"}</strong></div>
        <div class="result-item result-item-wide"><span>当前阶段</span><strong>${escapeHtml(payload.liveStage || payload.liveMessage || "-")}</strong></div>
        ${spacexActivation?.message ? `<div class="result-item result-item-wide"><span>自动化处理说明</span><strong>${escapeHtml(spacexActivation.message)}</strong></div>` : ""}
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
  const order = await refreshRedeemStatus(payload.orderNo);
  if (!payload.pollingDisabled && !order.pollingDisabled) {
    startRedeemStatusPolling(payload.orderNo);
  }
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
    verifiedProcessingMode = payload.canRedeem ? (payload.processingMode || null) : null;
    redeemSubmit.disabled = !payload.canRedeem;
    setRichState(verifyResult, renderVerifyResult(payload), payload.canRedeem ? "success" : "error");

    if (payload.canRedeem) {
      setTimeout(() => goToStep(2), 1500);
    }
  } catch (error) {
    verifiedKey = null;
    verifiedSiteSlug = null;
    verifiedProcessingMode = null;
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
    const abandonRemainingTime = verifiedProcessingMode === "spacex_cdk" ? false : shouldConfirmOverwrite(sessionData);
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
let smsPollingTimeout = null;
let smsPollingToken = 0;

function stopSmsPolling() {
  smsPollingToken += 1;
  if (smsPollingInterval) {
    clearInterval(smsPollingInterval);
    smsPollingInterval = null;
  }
  if (smsPollingTimeout) {
    clearTimeout(smsPollingTimeout);
    smsPollingTimeout = null;
  }
}

function startSmsPolling(orderNo) {
  stopSmsPolling();
  const token = smsPollingToken;
  let stopped = false;

  const pollOnce = async () => {
    if (token !== smsPollingToken) return;
    try {
      const payload = await request(`/api/public/sms/orders/${encodeURIComponent(orderNo)}`);
      if (token !== smsPollingToken) return;
      currentSmsOrder = payload;
      updateSmsActionButtons(payload);
      setRichState(smsResult, renderSmsOrderResult(payload), payload.verificationStatus === "ready" ? "success" : "muted");
      if (["ready", "timeout"].includes(payload.verificationStatus) || ["ready", "refunded", "failed", "cancelled"].includes(String(payload.status || "").toLowerCase())) {
        stopped = true;
        stopSmsPolling();
        currentSmsOrderNo = payload.orderNo || null;
      }
    } catch (error) {
      // 轮询请求失败时不中断，下一周期继续
    } finally {
      if (!stopped && token === smsPollingToken) {
        smsPollingTimeout = setTimeout(pollOnce, SMS_POLL_INTERVAL_MS);
      }
    }
  };

  pollOnce();
}

function startSmsLegacyPolling(cardKey) {
  stopSmsPolling();
  const token = smsPollingToken;
  let stopped = false;

  const pollOnce = async () => {
    if (token !== smsPollingToken) return;
    try {
      const payload = await request(`/api/public/sms/query?key=${encodeURIComponent(cardKey)}`);
      if (token !== smsPollingToken) return;
      currentSmsOrder = { ...payload, legacyStaticEntry: true };
      setRichState(smsResult, renderSmsOrderResult(payload), payload.verificationStatus === "ready" ? "success" : "muted");
      if (["ready", "timeout"].includes(payload.verificationStatus)) {
        stopped = true;
        stopSmsPolling();
        smsCodeSubmit.disabled = true;
      }
    } catch (error) {
      stopped = true;
      stopSmsPolling();
      smsCodeSubmit.disabled = false;
      setState(smsResult, error.message || "请求失败，请检查网络连接", "error");
    } finally {
      if (!stopped && token === smsPollingToken) {
        smsPollingTimeout = setTimeout(pollOnce, SMS_POLL_INTERVAL_MS);
      }
    }
  };

  pollOnce();
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    stopSmsPolling();
  }
});

function renderVerificationStatus(payload) {
  if (payload.purchaseStatus === "preview") {
    return payload.previewKind === "phone"
      ? "尚未购买，请确认号码可用后点击获取验证码"
      : "尚未购买，请确认号段可用后点击获取验证码";
  }
  if (payload.purchaseStatus === "purchasing") {
    return "正在购买号码，请稍候";
  }
  if (payload.status === "number_reserved") {
    return "号码已保留，点击获取验证码后开始接收";
  }
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

function formatSmsPreviewExpiry(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString("zh-CN", { hour12: false }) : String(value);
}

function renderSmsOrderResult(payload) {
  const phoneLabel = payload.phone ? "手机号" : "号码预览";
  const phoneHtml = `<div class="result-item"><span>${phoneLabel}</span><strong>${escapeHtml(payload.phone || payload.phonePreview || "-")}</strong></div>`;
  const expiryHtml = payload.previewExpiresAt
    ? `<div class="result-item"><span>号码到期时间</span><strong>${escapeHtml(formatSmsPreviewExpiry(payload.previewExpiresAt))}</strong></div>`
    : "";
  const verificationHtml = `<div class="result-item"><span>验证码</span><strong id="sms-verification-display">${renderVerificationStatus(payload)}</strong></div>`;
  const siteHtml = `<div class="result-item"><span>接码站点</span><strong>${escapeHtml(payload.siteName || verifiedSmsCard?.site?.name || "-")}</strong></div>`;
  const orderHtml = `<div class="result-item"><span>订单号</span><strong>${escapeHtml(payload.orderNo || currentSmsOrderNo || "-")}</strong></div>`;
  return `<div class="result-card"><div class="result-grid">${siteHtml}${orderHtml}${phoneHtml}${expiryHtml}${verificationHtml}</div></div>`;
}

function isDynamicSmsProvider(card = verifiedSmsCard) {
  const source = String(card?.inventorySource || card?.site?.inventorySource || "").toLowerCase();
  const provider = String(card?.smsProvider || card?.site?.smsProvider || "").toLowerCase();
  return ["nexsms", "383api"].includes(source) || ["nexsms", "383api"].includes(provider);
}

function resetSmsActionButtons() {
  smsSubmit.disabled = true;
  smsSubmit.textContent = "获取号码";
  smsCodeSubmit.disabled = true;
  smsCodeSubmit.classList.add("hidden");
  smsCodeSubmit.textContent = "获取验证码";
}

function updateSmsActionButtons(payload) {
  currentSmsOrder = payload || null;
  if (!payload) {
    smsSubmit.disabled = false;
    smsCodeSubmit.disabled = true;
    smsCodeSubmit.classList.add("hidden");
    return;
  }

  const canStartVerification = payload.purchaseStatus === "preview" || payload.status === "number_reserved";
  const canRefresh = payload.canRefreshNumber || payload.canRefreshPrefix;
  const refreshTarget = payload.previewKind === "phone" ? "号码" : "号段";
  smsSubmit.disabled = !canRefresh;
  smsSubmit.textContent = canRefresh ? `换一个${refreshTarget}` : "获取号码";
  smsCodeSubmit.classList.remove("hidden");
  smsCodeSubmit.disabled = !canStartVerification;
  smsCodeSubmit.textContent = payload.purchaseStatus === "purchasing" ? "正在购买..." : "获取验证码";
}

smsForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  stopSmsPolling();

  const key = smsKeyInput.value.trim();
  if (!key) {
    setState(smsResult, "请输入接码卡密", "error");
    return;
  }

  smsVerifyBtn.disabled = true;
  resetSmsActionButtons();
  setState(smsResult, "正在验证接码卡密...");

  try {
    const payload = await request("/api/public/sms/cards/verify", {
      method: "POST",
      body: JSON.stringify({ cardKey: key })
    });
    verifiedSmsCard = payload;
    currentSmsOrderNo = payload.latestOrder?.orderNo || null;
    currentSmsOrder = payload.latestOrder || null;
    updateSmsActionButtons(payload.latestOrder || null);
    setRichState(smsResult, `<div class="result-card"><div class="result-grid"><div class="result-item"><span>接码站点</span><strong>${escapeHtml(payload.site?.name || "-")}</strong></div><div class="result-item"><span>卡密状态</span><strong>${renderStatusText(payload.status)}</strong></div></div></div>`, "success");
    if (payload.latestOrder) {
      setRichState(smsResult, renderSmsOrderResult(payload.latestOrder), payload.latestOrder.verificationStatus === "ready" ? "success" : "muted");
      if (
        payload.latestOrder.verificationStatus === "pending" &&
        ["purchased", "purchasing"].includes(payload.latestOrder.purchaseStatus)
      ) {
        startSmsPolling(payload.latestOrder.orderNo);
      }
    }
  } catch (error) {
    verifiedSmsCard = null;
    currentSmsOrderNo = null;
    currentSmsOrder = null;
    resetSmsActionButtons();
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

  smsSubmit.disabled = true;
  smsCodeSubmit.disabled = true;
  const refreshingNumber = currentSmsOrder?.canRefreshNumber === true || currentSmsOrder?.canRefreshPrefix === true;
  const refreshTarget = currentSmsOrder?.previewKind === "phone" ? "号码" : "号段";
  setState(
    smsResult,
    isDynamicSmsProvider()
      ? (refreshingNumber ? `正在更换可用${refreshTarget}，不会产生购买费用...` : "正在查询可用号码，不会产生购买费用...")
      : "正在分配手机号..."
  );

  try {
    if (verifiedSmsCard.legacyStaticEntry) {
      const payload = await request(`/api/public/sms/query?key=${encodeURIComponent(verifiedSmsCard.cardKey)}`);
      currentSmsOrderNo = null;
      currentSmsOrder = {
        ...payload,
        legacyStaticEntry: true,
        status: payload.verificationStatus === "ready" ? "ready" : "number_reserved"
      };
      setRichState(smsResult, renderSmsOrderResult(payload), payload.verificationStatus === "ready" ? "success" : "muted");
      updateSmsActionButtons(currentSmsOrder);
      return;
    }

    const payload = await request("/api/public/sms/orders", {
      method: "POST",
      body: JSON.stringify({
        cardKey: verifiedSmsCard.cardKey,
        refreshNumber: refreshingNumber,
        refreshPrefix: currentSmsOrder?.canRefreshPrefix === true
      })
    });
    currentSmsOrderNo = payload.orderNo;
    currentSmsOrder = payload;
    setRichState(smsResult, renderSmsOrderResult(payload), "success");
    updateSmsActionButtons(payload);
  } catch (error) {
    updateSmsActionButtons(currentSmsOrder);
    setState(smsResult, error.message || "请求失败，请检查网络连接", "error");
  }
});

smsCodeSubmit.addEventListener("click", async () => {
  if (!verifiedSmsCard?.cardKey || !currentSmsOrder) {
    setState(smsResult, "请先获取号码", "error");
    return;
  }

  const dynamic = isDynamicSmsProvider();
  const previewIsPhone = currentSmsOrder.previewKind === "phone";
  smsConfirmTitle.textContent = dynamic
    ? (previewIsPhone ? "确认使用这个号码？" : "确认使用这个号段？")
    : "确定已经发送了验证码？";
  smsConfirmDesc.textContent = dynamic
    ? (previewIsPhone
        ? "确认后系统才会购买这个完整号码，并立即开始等待验证码。"
        : "确认后系统才会购买该号段的真实号码。购买完成后，请使用返回的完整号码在目标平台发送验证码。")
    : "请先在目标平台点击发送验证码，确认后将开始获取验证码。";
  const confirmed = await showSmsConfirmModal();
  if (!confirmed) return;

  smsSubmit.disabled = true;
  smsCodeSubmit.disabled = true;
  smsCodeSubmit.textContent = dynamic ? "正在购买..." : "正在获取...";
  setState(smsResult, dynamic
    ? (previewIsPhone ? "正在购买已确认的号码..." : "正在购买已确认的号段...")
    : "正在获取验证码...");

  try {
    if (verifiedSmsCard.legacyStaticEntry) {
      setRichState(smsResult, renderSmsOrderResult(currentSmsOrder), "muted");
      startSmsLegacyPolling(verifiedSmsCard.cardKey);
      return;
    }

    const payload = await request(`/api/public/sms/orders/${encodeURIComponent(currentSmsOrderNo)}/verification`, {
      method: "POST",
      body: JSON.stringify({ cardKey: verifiedSmsCard.cardKey })
    });
    currentSmsOrder = payload;
    setRichState(smsResult, renderSmsOrderResult(payload), "success");
    updateSmsActionButtons(payload);
    if (payload.verificationStatus === "pending") {
      startSmsPolling(payload.orderNo);
    }
  } catch (error) {
    updateSmsActionButtons(currentSmsOrder);
    setState(smsResult, error.message || "请求失败，请检查网络连接", "error");
  }
});
