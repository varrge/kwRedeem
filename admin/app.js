const API_BASE = (globalThis.KAWANG_CONFIG?.apiUrl || "http://127.0.0.1:4300").replace(/\/+$/, "");
const TOKEN_KEY = "kawang_admin_token";
const REFRESH_INTERVAL_MS = 5000;
const UPDATE_POLL_INTERVAL_MS = 3000;

const refs = {
  loginCard: document.querySelector("#login-card"),
  adminShell: document.querySelector("#admin-shell"),
  loginForm: document.querySelector("#login-form"),
  loginResult: document.querySelector("#login-result"),
  refreshBtn: document.querySelector("#refresh-btn"),
  logoutBtn: document.querySelector("#logout-btn"),
  sessionStatus: document.querySelector("#session-status"),
  stats: document.querySelector("#stats"),
  dashboardLogs: document.querySelector("#dashboard-logs"),
  siteResult: document.querySelector("#site-result"),
  siteList: document.querySelector("#site-list"),
  healthCheckAllBtn: document.querySelector("#health-check-all-btn"),
  singleCdkeyForm: document.querySelector("#single-cdkey-form"),
  singleCdkeyResult: document.querySelector("#single-cdkey-result"),
  batchForm: document.querySelector("#batch-form"),
  batchResult: document.querySelector("#batch-result"),
  batchList: document.querySelector("#batch-list"),
  cdkeyList: document.querySelector("#cdkey-list"),
  cdkeyAction: document.querySelector("#cdkey-action"),
  cdkeyActionBtn: document.querySelector("#cdkey-action-btn"),
  cdkeyExportPublicBtn: document.querySelector("#cdkey-export-public-btn"),
  cdkeyExportSourceBtn: document.querySelector("#cdkey-export-source-btn"),
  cdkeyExportExcelBtn: document.querySelector("#cdkey-export-excel-btn"),
  orderList: document.querySelector("#order-list"),
  jobList: document.querySelector("#job-list"),
  retryJobsBtn: document.querySelector("#retry-jobs-btn"),
  logList: document.querySelector("#log-list"),
  systemVersionCards: document.querySelector("#system-version-cards"),
  checkUpdateBtn: document.querySelector("#check-update-btn"),
  startUpdateBtn: document.querySelector("#start-update-btn"),
  systemUpdateHint: document.querySelector("#system-update-hint"),
  systemUpdateLog: document.querySelector("#system-update-log"),
  batchSite: document.querySelector("#batch-site"),
  batchImportType: document.querySelector("#batch-import-type"),
  singleSite: document.querySelector("#single-site"),
  singleEmailToken: document.querySelector("#single-email-token"),
  subCardTypeForm: document.querySelector("#sub-card-type-form"),
  subCtName: document.querySelector("#sub-ct-name"),
  subCtTotal: document.querySelector("#sub-ct-total"),
  subCtEditId: document.querySelector("#sub-ct-edit-id"),
  subCtSubmitBtn: document.querySelector("#sub-ct-submit-btn"),
  subCtCancelBtn: document.querySelector("#sub-ct-cancel-btn"),
  subCtResult: document.querySelector("#sub-ct-result"),
  subCardTypeList: document.querySelector("#sub-card-type-list"),
  subRequestList: document.querySelector("#sub-request-list"),
  notifySettingsForm: document.querySelector("#notify-settings-form"),
  notifyGlobalWebhook: document.querySelector("#notify-global-webhook"),
  notifySettingsResult: document.querySelector("#notify-settings-result"),
  notifyTestGlobalWebhook: document.querySelector("#notify-test-global-webhook"),
  notifyMonitorForm: document.querySelector("#notify-monitor-form"),
  notifyFormTitle: document.querySelector("#notify-form-title"),
  notifyFormCancel: document.querySelector("#notify-form-cancel"),
  notifyEditId: document.querySelector("#notify-edit-id"),
  notifyName: document.querySelector("#notify-name"),
  notifyMonitorType: document.querySelector("#notify-monitor-type"),
  notifyEnabled: document.querySelector("#notify-enabled"),
  notifyMethod: document.querySelector("#notify-method"),
  notifyInterval: document.querySelector("#notify-interval"),
  notifyUrl: document.querySelector("#notify-url"),
  notifyBrowserFields: document.querySelector("#notify-browser-fields"),
  notifyBrowserPageUrl: document.querySelector("#notify-browser-page-url"),
  notifyBrowserReadySelector: document.querySelector("#notify-browser-ready-selector"),
  notifyBrowserWaitMs: document.querySelector("#notify-browser-wait-ms"),
  notifyHeaders: document.querySelector("#notify-headers"),
  notifyBody: document.querySelector("#notify-body"),
  notifyWatchFields: document.querySelector("#notify-watch-fields"),
  notifyMatchMode: document.querySelector("#notify-match-mode"),
  notifyRulesList: document.querySelector("#notify-rules-list"),
  notifyAddRule: document.querySelector("#notify-add-rule"),
  notifyWebhookOverride: document.querySelector("#notify-webhook-override"),
  notifyTitle: document.querySelector("#notify-title"),
  notifyTimeout: document.querySelector("#notify-timeout"),
  notifyCooldown: document.querySelector("#notify-cooldown"),
  notifySubmitBtn: document.querySelector("#notify-submit-btn"),
  notifyTestRunBtn: document.querySelector("#notify-test-run-btn"),
  notifyFormResult: document.querySelector("#notify-form-result"),
  notifyRefreshBtn: document.querySelector("#notify-refresh-btn"),
  notifyMonitorList: document.querySelector("#notify-monitor-list"),
  notifyEventList: document.querySelector("#notify-event-list"),
  // SMS panel refs
  smsBatchForm: document.querySelector("#sms-batch-form"),
  smsBatchResult: document.querySelector("#sms-batch-result"),
  smsSingleForm: document.querySelector("#sms-single-form"),
  smsSingleResult: document.querySelector("#sms-single-result"),
  smsList: document.querySelector("#sms-list"),
  smsCopyKeysBtn: document.querySelector("#sms-copy-keys-btn"),
  smsCopyInfoBtn: document.querySelector("#sms-copy-info-btn"),
  smsExportExcelBtn: document.querySelector("#sms-export-excel-btn"),
  smsAction: document.querySelector("#sms-action"),
  smsActionBtn: document.querySelector("#sms-action-btn"),
  // Quota system refs
  quotaStats: document.querySelector("#quota-stats"),
  quotaImportForm: document.querySelector("#quota-import-form"),
  quotaImportCodes: document.querySelector("#quota-import-codes"),
  quotaImportResult: document.querySelector("#quota-import-result"),
  quotaImportDetailCard: document.querySelector("#quota-import-detail-card"),
  quotaImportDetail: document.querySelector("#quota-import-detail"),
  quotaSettingsForm: document.querySelector("#quota-settings-form"),
  quotaLowStockThreshold: document.querySelector("#quota-low-stock-threshold"),
  quotaSettingsResult: document.querySelector("#quota-settings-result"),
  quotaSubCardForm: document.querySelector("#quota-sub-card-form"),
  quotaSubCardQuota: document.querySelector("#quota-sub-card-quota"),
  quotaSubCardCount: document.querySelector("#quota-sub-card-count"),
  quotaSubCardResult: document.querySelector("#quota-sub-card-result"),
  quotaSubCardList: document.querySelector("#quota-sub-card-list"),
  quotaSubCardRefreshBtn: document.querySelector("#quota-sub-card-refresh-btn"),
  quotaSubCardDetailCard: document.querySelector("#quota-sub-card-detail-card"),
  quotaSubCardDetail: document.querySelector("#quota-sub-card-detail"),
  quotaSubCardHistory: document.querySelector("#quota-sub-card-history"),
  quotaSubCardDetailClose: document.querySelector("#quota-sub-card-detail-close"),

  navItems: document.querySelectorAll(".nav-item"),
  tabPanels: document.querySelectorAll(".tab-panel")
};

let autoRefreshTimer = null;
let updatePollTimer = null;
let currentTab = "dashboard";

function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

function setHint(element, message) {
  if (element) element.textContent = message;
}

function setStatusMessage(element, message, type = "info") {
  if (!element) return;
  element.textContent = message || "";
  element.classList.remove("status-message", "status-message-info", "status-message-success", "status-message-error");
  if (!message) return;
  element.classList.add("status-message", `status-message-${type}`);
}

function setButtonBusy(button, busy, busyText) {
  if (!button) return;
  if (!button.dataset.idleText) {
    button.dataset.idleText = button.textContent;
  }
  button.disabled = busy;
  button.classList.toggle("is-busy", busy);
  button.textContent = busy ? busyText : button.dataset.idleText;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function maskToken(value) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return "-";
  if (normalized.length <= 12) return normalized;
  return `${normalized.slice(0, 6)}...${normalized.slice(-4)}`;
}

function renderStatus(value) {
  return `<span class="table-badge status-${String(value || "").toLowerCase()}">${value || "-"}</span>`;
}

function setAuthState(isLoggedIn, username = "") {
  refs.loginCard.classList.toggle("hidden", isLoggedIn);
  refs.adminShell.classList.toggle("hidden", !isLoggedIn);
  refs.sessionStatus.textContent = isLoggedIn ? username : "未登录";
}

function switchTab(tabName) {
  currentTab = tabName;
  refs.navItems.forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === tabName);
  });
  refs.tabPanels.forEach((panel) => {
    panel.classList.toggle("hidden", panel.dataset.panel !== tabName);
  });
  if (tabName === "sms" && getToken()) {
    refreshSmsEntries().catch(() => {});
  }
  if (tabName === "quota" && getToken()) {
    refreshQuotaDashboard().catch(() => {});
    refreshQuotaSubCards().catch(() => {});
    loadQuotaSettings().catch(() => {});
  }
}

function startAutoRefresh() {
  stopAutoRefresh();
  autoRefreshTimer = window.setInterval(() => {
    refreshDashboard().catch(() => {});
    if (currentTab === "logs") refreshLogs().catch(() => {});
  }, REFRESH_INTERVAL_MS);
}

function stopAutoRefresh() {
  if (autoRefreshTimer) {
    window.clearInterval(autoRefreshTimer);
    autoRefreshTimer = null;
  }
}

function startUpdatePolling() {
  stopUpdatePolling();
  updatePollTimer = window.setInterval(() => {
    refreshSystemUpdateStatus().catch(() => {});
  }, UPDATE_POLL_INTERVAL_MS);
}

function stopUpdatePolling() {
  if (updatePollTimer) {
    window.clearInterval(updatePollTimer);
    updatePollTimer = null;
  }
}

async function api(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };
  const token = getToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) {
      clearToken();
      stopAutoRefresh();
      setAuthState(false);
    }
    throw new Error(payload.message || "请求失败");
  }
  return payload;
}

function renderTable(container, columns, rows, emptyText = "暂无数据") {
  if (!rows.length) {
    container.innerHTML = `<p class="hint centered mt-24">${emptyText}</p>`;
    return;
  }

  const head = columns.map((item) => `<th>${item.label}</th>`).join("");
  const body = rows.map((row) => `
    <tr>
      ${columns.map((column) => `<td>${column.render(row)}</td>`).join("")}
    </tr>
  `).join("");

  container.innerHTML = `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function populateSiteSelects(items) {
  const currentBatch = refs.batchSite.value;
  const currentSingle = refs.singleSite.value;
  const options = [`<option value="">选择网站</option>`].concat(
    items.map((item) => `<option value="${item.id}">${item.name}${item.status === "active" ? "" : "（已禁用）"}</option>`)
  );
  refs.batchSite.innerHTML = options.join("");
  refs.singleSite.innerHTML = options.join("");

  const supportSite = items.find((item) => item.slug === "meimei_site");
  refs.batchSite.value = currentBatch || supportSite?.id || "";
  refs.singleSite.value = currentSingle || supportSite?.id || "";
}

async function refreshDashboard() {
  const payload = await api("/api/admin/dashboard");
  const labels = {
    websites: "网站数量",
    cdkeys: "卡密总量",
    inProgressJobs: "进行中任务",
    failedJobs: "失败任务",
    succeededJobs: "成功任务"
  };

  refs.stats.innerHTML = Object.entries(payload.counts).map(([label, value]) => `
    <article class="stat">
      <span>${labels[label] || label}</span>
      <strong>${value}</strong>
    </article>
  `).join("");

  renderTable(refs.dashboardLogs, [
    { label: "时间", render: (item) => item.created_at },
    { label: "动作", render: (item) => `<code>${item.action}</code>` },
    { label: "资源", render: (item) => `${item.resource_type}${item.resource_id ? ` / ${item.resource_id}` : ""}` },
    { label: "执行人", render: (item) => item.actor }
  ], payload.recentLogs || [], "暂无最近日志");
}

function renderHealthDot(result, key) {
  if (!result) return `<span class="health-dot health-unknown" title="未检测"></span>`;
  const data = typeof result === "string" ? JSON.parse(result) : result;
  const entry = data[key];
  if (!entry || entry.skipped) return `<span class="health-dot health-unknown" title="未配置"></span>`;
  if (entry.ok) return `<span class="health-dot health-ok" title="可达 ${entry.latencyMs}ms"></span>`;
  return `<span class="health-dot health-fail" title="不可达${entry.error ? ` (${entry.error})` : ""}"></span>`;
}

async function toggleSiteStatus(siteId, currentStatus) {
  const newStatus = currentStatus === "active" ? "disabled" : "active";
  try {
    await api(`/api/admin/sites/${siteId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status: newStatus })
    });
    await refreshSites();
  } catch (error) {
    setHint(refs.siteResult, error.message);
  }
}

async function healthCheckSite(siteId) {
  try {
    setHint(refs.siteResult, "正在检测...");
    await api(`/api/admin/sites/${siteId}/health-check`, {
      method: "POST",
      body: JSON.stringify({})
    });
    await refreshSites();
    setHint(refs.siteResult, "检测完成。");
  } catch (error) {
    setHint(refs.siteResult, error.message);
  }
}

async function healthCheckAll() {
  const payload = await api("/api/admin/sites");
  const items = payload.items || [];
  setHint(refs.siteResult, `正在逐个检测 ${items.length} 个站点...`);
  for (const site of items) {
    try {
      await api(`/api/admin/sites/${site.id}/health-check`, {
        method: "POST",
        body: JSON.stringify({})
      });
    } catch (_) {}
  }
  await refreshSites();
  setHint(refs.siteResult, "全部检测完成。");
}

async function refreshSites() {
  const payload = await api("/api/admin/sites");
  populateSiteSelects(payload.items);
  renderTable(refs.siteList, [
    { label: "网站名", render: (item) => `<strong>${escapeHtml(item.name)}</strong><br/><code style="font-size:10px;opacity:0.6">${escapeHtml(item.slug)}</code>` },
    { label: "接口地址", render: (item) => `
      <div class="health-group">
        <div>${renderHealthDot(item.last_health_result, "verify")} 验证: <code style="font-size:11px">${escapeHtml(item.verify_api_url || "-")}</code></div>
        <div>${renderHealthDot(item.last_health_result, "submit")} 提交: <code style="font-size:11px">${escapeHtml(item.submit_api_url || "-")}</code></div>
      </div>
    ` },
    { label: "Cookie", render: (item) => `
      <span style="font-size:12px;color:var(--muted)">${item.request_cookies ? "已配置" : "未配置"}</span>
      <button class="ghost-btn small" style="padding:4px 8px;font-size:11px;margin-left:4px" type="button" onclick="editSiteCookies('${escapeHtml(item.id)}', ${escapeHtml(JSON.stringify(item.request_cookies || ''))})">编辑</button>
    ` },
    { label: "状态", render: (item) => renderStatus(item.status) },
    { label: "最后检测", render: (item) => `<span style="font-size:12px;color:var(--muted)">${item.last_health_check || "-"}</span>` },
    { label: "操作", render: (item) => `
      <button class="primary-btn small" type="button" onclick="toggleSiteStatus('${escapeHtml(item.id)}', '${escapeHtml(item.status)}')">
        ${item.status === "active" ? "禁用" : "启用"}
      </button>
      <button class="ghost-btn small" style="padding: 6px 12px; font-size:13px" type="button" onclick="healthCheckSite('${escapeHtml(item.id)}')">测活</button>
    ` }
  ], payload.items, "暂无网站数据");
}

async function editSiteCookies(siteId, currentCookies) {
  const value = window.prompt(
    "输入该站点的请求 Cookie（如 cf_clearance=xxx），留空则清除：",
    currentCookies || ""
  );
  if (value === null) return;
  try {
    await api(`/api/admin/sites/${siteId}/cookies`, {
      method: "PATCH",
      body: JSON.stringify({ requestCookies: value })
    });
    setHint(refs.siteResult, value ? "Cookie 已保存" : "Cookie 已清除");
    await refreshSites();
  } catch (error) {
    setHint(refs.siteResult, error.message);
  }
}

window.editSiteCookies = editSiteCookies;

// Global exposure for onclick handlers
window.toggleSiteStatus = toggleSiteStatus;
window.healthCheckSite = healthCheckSite;

async function updateCdkeyEmailToken(id, currentValue) {
  const value = window.prompt(
    "输入该卡密关联的 email_token，留空可清除绑定：",
    currentValue || ""
  );
  if (value === null) return;
  try {
    await api(`/api/admin/cdkeys/${id}/email-token`, {
      method: "PATCH",
      body: JSON.stringify({ emailToken: value })
    });
    await refreshCdkeys();
  } catch (error) {
    alert(error.message);
  }
}

window.updateCdkeyEmailToken = updateCdkeyEmailToken;

async function refreshBatches() {
  const payload = await api("/api/admin/batches");
  renderTable(refs.batchList, [
    { label: "批次", render: (item) => item.name },
    { label: "网站", render: (item) => item.site_name || "-" },
    { label: "前缀", render: (item) => `<code>${item.prefix}</code>` },
    { label: "数量", render: (item) => item.imported_count },
    { label: "创建人", render: (item) => item.created_by }
  ], payload.items, "暂无批次数据");
}

async function refreshCdkeys() {
  const payload = await api("/api/admin/cdkeys");
  renderTable(refs.cdkeyList, [
    { label: "", render: (item) => `<input type="checkbox" class="cdkey-check" value="${item.id}" />` },
    { label: "卡密", render: (item) => `<code>${item.public_key}</code>` },
    { label: "类型", render: (item) => item.support_only ? `<span class="table-badge status-pending">接码专用</span>` : `<span class="table-badge status-active">普通</span>` },
    { label: "原始卡密", render: (item) => item.source_key ? `<code style="opacity:0.5">${escapeHtml(item.source_key)}</code>` : "-" },
    { label: "网站", render: (item) => item.site_name || "-" },
    { label: "前缀", render: (item) => item.prefix },
    { label: "接码Token", render: (item) => `
      <div style="display:grid;gap:6px;">
        <span style="font-size:12px;color:var(--muted)">${item.has_email_token ? `<code>${escapeHtml(maskToken(item.email_token))}</code>` : "未绑定"}</span>
        <button class="ghost-btn small" type="button" onclick='updateCdkeyEmailToken(${JSON.stringify(item.id)}, decodeURIComponent(${JSON.stringify(encodeURIComponent(item.email_token || ""))}))'>
          ${item.has_email_token ? "编辑接码 Token" : "绑定接码 Token"}
        </button>
      </div>
    ` },
    { label: "状态", render: (item) => renderStatus(item.status) }
  ], payload.items);
}

async function refreshSmsEntries() {
  const payload = await api("/api/admin/sms/entries");
  renderTable(refs.smsList, [
    { label: "", render: (item) => `<input type="checkbox" class="sms-check" value="${item.id}" data-public-key="${escapeHtml(item.publicKey)}" data-phone="${escapeHtml(item.phone)}" data-sms-url="${escapeHtml(item.smsUrl)}" />` },
    { label: "卡密", render: (item) => `<code>${escapeHtml(item.publicKey)}</code>` },
    { label: "手机号", render: (item) => escapeHtml(item.phone) },
    { label: "接码网址", render: (item) => `<a href="${escapeHtml(item.smsUrl)}" target="_blank" style="word-break:break-all">${escapeHtml(item.smsUrl)}</a>` },
    { label: "前缀", render: (item) => `<code>${escapeHtml(item.prefix)}</code>` },
    { label: "批次名称", render: (item) => escapeHtml(item.batchName || "-") },
    { label: "状态", render: (item) => renderStatus(item.status) },
    { label: "创建时间", render: (item) => `<span style="font-size:12px">${escapeHtml(item.createdAt)}</span>` }
  ], payload.items || [], "暂无接码记录");
}

async function refreshOrders() {
  const payload = await api("/api/admin/orders");
  renderTable(refs.orderList, [
    { label: "订单号", render: (item) => `<code>${item.order_no}</code>` },
    { label: "卡密", render: (item) => `<code>${item.public_key}</code>` },
    { label: "网站", render: (item) => item.site_name || "-" },
    { label: "状态", render: (item) => renderStatus(item.status) },
    { label: "错误", render: (item) => `<span title="${escapeHtml(item.error_message || "")}">${item.error_message ? (item.error_message.slice(0, 20) + "...") : "-"}</span>` }
  ], payload.items);
}

async function refreshJobs() {
  const payload = await api("/api/admin/jobs");
  renderTable(refs.jobList, [
    { label: "", render: (item) => `<input type="checkbox" class="job-check" value="${item.id}" />` },
    { label: "订单号", render: (item) => `<code>${item.order_no}</code>` },
    { label: "网站", render: (item) => item.site_name || "-" },
    { label: "状态", render: (item) => renderStatus(item.status) },
    { label: "尝试", render: (item) => `${item.attempt_count}/${item.max_attempts}` },
    { label: "最后错误", render: (item) => `<span style="font-size:12px;color:var(--error)" title="${escapeHtml(item.last_error || "")}">${item.last_error ? (item.last_error.slice(0, 30) + "...") : "-"}</span>` }
  ], payload.items);
}

async function refreshLogs() {
  const payload = await api("/api/admin/logs");
  renderTable(refs.logList, [
    { label: "时间", render: (item) => item.created_at },
    { label: "动作", render: (item) => `<code>${item.action}</code>` },
    { label: "资源", render: (item) => `${item.resource_type}${item.resource_id ? ` / ${item.resource_id}` : ""}` },
    { label: "执行人", render: (item) => item.actor },
    { label: "详情", render: (item) => item.detail ? `<pre style="font-size:11px">${JSON.stringify(item.detail, null, 2)}</pre>` : "-" }
  ], payload.items);
}

function shortCommit(value) {
  return value ? String(value).slice(0, 8) : "-";
}

function renderSystemInfo(payload) {
  const state = payload.updateState || {};
  const isBusy = ["running", "checking"].includes(state.status);
  const localChanges = payload.localChanges || state.localChanges || [];
  const hasLocalChanges = payload.hasLocalChanges || state.hasLocalChanges || localChanges.length > 0;
  const cards = [
    ["分支", payload.branch || state.branch || "-"],
    ["本地版本", shortCommit(payload.localCommit || state.localCommit)],
    ["远端版本", shortCommit(payload.remoteCommit || state.remoteCommit)],
    ["更新状态", state.status || "idle"],
    ["是否有更新", payload.hasUpdate || state.hasUpdate ? "有更新" : "无"]
  ];

  refs.systemVersionCards.innerHTML = cards.map(([label, value]) => `
    <article class="stat">
      <span>${label}</span>
      <strong>${value}</strong>
    </article>
  `).join("");

  setHint(refs.systemUpdateHint, state.error
    ? `异常: ${state.error}`
    : hasLocalChanges
      ? `检测到本地改动，更新会暂存。`
    : `最后状态: ${state.status || "idle"}`);
    
  refs.systemUpdateLog.textContent = payload.log || "暂无日志";
  refs.checkUpdateBtn.disabled = isBusy;
  refs.startUpdateBtn.disabled = isBusy;

  if (isBusy && !updatePollTimer) startUpdatePolling();
}

async function refreshSystemVersion() {
  const payload = await api("/api/admin/system/version");
  renderSystemInfo(payload);
}

async function refreshSystemUpdateStatus() {
  const payload = await api("/api/admin/system/update-status");
  renderSystemInfo({
    updateState: payload.updateState,
    log: payload.log,
    nodeEnv: ""
  });

  if (!["running", "checking"].includes(payload.updateState?.status)) {
    stopUpdatePolling();
    await refreshSystemVersion();
  }
}

const stabilityLabels = { stable: "稳定", bumpy: "颠簸", danger: "危险" };

function renderStability(value) {
  const label = stabilityLabels[value] || value;
  return `<span class="table-badge stability-${value}">${label}</span>`;
}

async function refreshSubscriptionCardTypes() {
  const payload = await api("/api/admin/subscriptions/card-types");
  renderTable(refs.subCardTypeList, [
    { label: "名称", render: (item) => `<strong>${escapeHtml(item.name)}</strong>` },
    { label: "总订阅量", render: (item) => item.totalSubscriptions },
    { label: "总掉订阅", render: (item) => item.totalDrops },
    { label: "今日掉订阅", render: (item) => item.todayDrops },
    { label: "稳定性", render: (item) => renderStability(item.stability) },
    { label: "可见", render: (item) => item.visible ? renderStatus("active") : renderStatus("disabled") },
    { label: "操作", render: (item) => `
      <button class="primary-btn small" type="button" onclick="editSubCardType('${escapeHtml(item.id)}', '${escapeHtml(item.name)}', ${item.totalSubscriptions})">编辑</button>
      <button class="ghost-btn small" style="padding:6px 12px;font-size:13px" type="button" onclick="toggleSubCardTypeVisibility('${escapeHtml(item.id)}')">${item.visible ? "隐藏" : "显示"}</button>
    ` }
  ], payload.items, "暂无卡种数据");
}

async function refreshSubscriptionRequests() {
  const payload = await api("/api/admin/subscriptions/requests");
  renderTable(refs.subRequestList, [
    { label: "订单号/QQ", render: (item) => `<code>${escapeHtml(item.identifier)}</code>` },
    { label: "卡种", render: (item) => escapeHtml(item.card_type_name || "-") },
    { label: "类型", render: (item) => escapeHtml(item.drop_type) },
    { label: "状态", render: (item) => renderStatus(item.status) },
    { label: "提交时间", render: (item) => `<span style="font-size:12px">${item.created_at}</span>` },
    { label: "操作", render: (item) => item.status === "pending" ? `
      <button class="primary-btn small" type="button" onclick="reviewSubRequest('${escapeHtml(item.id)}', 'approve')">批准</button>
      <button class="ghost-btn small" style="padding:6px 12px;font-size:13px" type="button" onclick="reviewSubRequest('${escapeHtml(item.id)}', 'reject')">否决</button>
    ` : `<span style="font-size:12px;color:var(--muted)">${item.reviewed_by ? `${item.reviewed_by}` : "-"}</span>` }
  ], payload.items, "暂无订阅申请");
}

async function refreshSubscriptions() {
  await Promise.all([
    refreshSubscriptionCardTypes(),
    refreshSubscriptionRequests()
  ]);
}

async function editSubCardType(id, name, totalSubscriptions) {
  refs.subCtEditId.value = id;
  refs.subCtName.value = name;
  refs.subCtTotal.value = totalSubscriptions;
  refs.subCtSubmitBtn.textContent = "保存修改";
  refs.subCtCancelBtn.classList.remove("hidden");
  refs.subCtName.focus();
}

async function toggleSubCardTypeVisibility(id) {
  try {
    await api(`/api/admin/subscriptions/card-types/${id}/visibility`, { method: "PATCH" });
    await refreshSubscriptions();
  } catch (error) {
    setHint(refs.subCtResult, error.message);
  }
}

async function reviewSubRequest(id, action) {
  const label = action === "approve" ? "批准" : "否决";
  if (!window.confirm(`确认${label}该订阅申请？`)) return;
  try {
    await api(`/api/admin/subscriptions/requests/${id}/review`, {
      method: "POST",
      body: JSON.stringify({ action })
    });
    await refreshSubscriptions();
  } catch (error) {
    alert(error.message);
  }
}

window.editSubCardType = editSubCardType;
window.toggleSubCardTypeVisibility = toggleSubCardTypeVisibility;
window.reviewSubRequest = reviewSubRequest;

// ── Notification Monitors ──

const NOTIFY_INTERVAL_OPTIONS = [
  { value: 1, label: "1 秒" },
  { value: 2, label: "2 秒" },
  { value: 5, label: "5 秒" },
  { value: 10, label: "10 秒" },
  { value: 15, label: "15 秒" },
  { value: 30, label: "30 秒" },
  { value: 60, label: "1 分钟" },
  { value: 120, label: "2 分钟" },
  { value: 300, label: "5 分钟" },
  { value: 600, label: "10 分钟" },
  { value: 900, label: "15 分钟" },
  { value: 1800, label: "30 分钟" },
  { value: 3600, label: "1 小时" }
];

const NOTIFY_OPERATORS = [
  { value: "equals", label: "等于 (equals)" },
  { value: "not_equals", label: "不等于 (not_equals)" },
  { value: "contains", label: "包含 (contains)" },
  { value: "not_contains", label: "不包含 (not_contains)" },
  { value: "gt", label: "大于 (>)" },
  { value: "gte", label: "大于等于 (>=)" },
  { value: "lt", label: "小于 (<)" },
  { value: "lte", label: "小于等于 (<=)" },
  { value: "exists", label: "字段存在" },
  { value: "not_exists", label: "字段不存在" }
];

const NOTIFY_OPERATORS_NO_VALUE = new Set(["exists", "not_exists"]);
const NOTIFY_EVENT_LABELS = {
  matched: "命中",
  not_matched: "未命中",
  fetch_error: "请求异常",
  send_error: "通知失败",
  send_ok: "通知成功",
  test: "测试执行"
};

let notifyMonitorsCache = [];

function syncNotifyModeUi() {
  const isBrowser = refs.notifyMonitorType?.value === "browser";
  refs.notifyBrowserFields?.classList.toggle("hidden", !isBrowser);
}

function populateNotifyIntervalOptions() {
  if (!refs.notifyInterval || refs.notifyInterval.dataset.populated === "1") return;
  refs.notifyInterval.innerHTML = NOTIFY_INTERVAL_OPTIONS
    .map((option) => `<option value="${option.value}">${option.label}</option>`)
    .join("");
  refs.notifyInterval.value = "60";
  refs.notifyInterval.dataset.populated = "1";
}

function setNotifyIntervalValue(seconds) {
  populateNotifyIntervalOptions();
  const target = String(seconds);
  const exists = NOTIFY_INTERVAL_OPTIONS.some((option) => String(option.value) === target);
  if (exists) {
    refs.notifyInterval.value = target;
    return;
  }
  if (!refs.notifyInterval.querySelector(`option[data-custom="1"]`)) {
    const customOption = document.createElement("option");
    customOption.value = target;
    customOption.textContent = `${seconds} 秒（自定义）`;
    customOption.dataset.custom = "1";
    refs.notifyInterval.appendChild(customOption);
  } else {
    const customOption = refs.notifyInterval.querySelector(`option[data-custom="1"]`);
    customOption.value = target;
    customOption.textContent = `${seconds} 秒（自定义）`;
  }
  refs.notifyInterval.value = target;
}

function buildRuleRow(rule = { fieldPath: "", operator: "equals", expectedValue: "" }) {
  const row = document.createElement("div");
  row.className = "notify-rule-row";

  const pathInput = document.createElement("input");
  pathInput.type = "text";
  pathInput.className = "notify-rule-path";
  pathInput.placeholder = "字段路径，如 data.count";
  pathInput.value = rule.fieldPath || "";

  const operatorSelect = document.createElement("select");
  operatorSelect.className = "notify-rule-operator";
  operatorSelect.innerHTML = NOTIFY_OPERATORS
    .map((operator) => `<option value="${operator.value}">${operator.label}</option>`)
    .join("");
  operatorSelect.value = rule.operator || "equals";

  const valueInput = document.createElement("input");
  valueInput.type = "text";
  valueInput.className = "notify-rule-value";
  valueInput.placeholder = "期望值";
  valueInput.value = rule.expectedValue ?? "";

  function syncValueState() {
    const noValue = NOTIFY_OPERATORS_NO_VALUE.has(operatorSelect.value);
    valueInput.disabled = noValue;
    if (noValue) {
      valueInput.value = "";
      valueInput.placeholder = "（不需要期望值）";
    } else {
      valueInput.placeholder = "期望值";
    }
  }
  operatorSelect.addEventListener("change", syncValueState);
  syncValueState();

  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "ghost-btn small";
  removeBtn.innerHTML = "🗑️";
  removeBtn.title = "移除规则";
  removeBtn.addEventListener("click", () => {
    row.remove();
    ensureRuleEmptyHint();
  });

  row.append(pathInput, operatorSelect, valueInput, removeBtn);
  return row;
}

function ensureRuleEmptyHint() {
  if (!refs.notifyRulesList) return;
  const rows = refs.notifyRulesList.querySelectorAll(".notify-rule-row");
  const hint = refs.notifyRulesList.querySelector(".notify-empty-rule");
  if (rows.length === 0) {
    if (!hint) {
      const placeholder = document.createElement("div");
      placeholder.className = "notify-empty-rule";
      placeholder.textContent = "暂无规则。命中规则为空时该监听不会触发通知。";
      refs.notifyRulesList.appendChild(placeholder);
    }
  } else if (hint) {
    hint.remove();
  }
}

function addRuleRow(rule) {
  populateNotifyIntervalOptions();
  if (!refs.notifyRulesList) return;
  const row = buildRuleRow(rule);
  refs.notifyRulesList.appendChild(row);
  ensureRuleEmptyHint();
}

function collectRules() {
  if (!refs.notifyRulesList) return { matchMode: "all", items: [] };
  const rows = Array.from(refs.notifyRulesList.querySelectorAll(".notify-rule-row"));
  const items = rows
    .map((row) => {
      const fieldPath = row.querySelector(".notify-rule-path")?.value.trim() || "";
      const operator = row.querySelector(".notify-rule-operator")?.value || "equals";
      const noValue = NOTIFY_OPERATORS_NO_VALUE.has(operator);
      const expectedValueRaw = row.querySelector(".notify-rule-value")?.value ?? "";
      const expectedValue = noValue ? "" : expectedValueRaw;
      return { fieldPath, operator, expectedValue };
    })
    .filter((item) => item.fieldPath);
  return { matchMode: refs.notifyMatchMode?.value || "all", items };
}

function resetNotifyForm() {
  if (!refs.notifyMonitorForm) return;
  refs.notifyMonitorForm.reset();
  refs.notifyEditId.value = "";
  refs.notifyMonitorType.value = "http";
  refs.notifyEnabled.value = "1";
  refs.notifyMethod.value = "GET";
  refs.notifyBrowserPageUrl.value = "";
  refs.notifyBrowserReadySelector.value = "";
  refs.notifyBrowserWaitMs.value = "10000";
  refs.notifyTimeout.value = "15";
  refs.notifyCooldown.value = "0";
  refs.notifyMatchMode.value = "all";
  refs.notifyRulesList.innerHTML = "";
  ensureRuleEmptyHint();
  setNotifyIntervalValue(60);
  refs.notifyFormTitle.textContent = "添加监听";
  refs.notifySubmitBtn.textContent = "添加监听";
  refs.notifyTestRunBtn.classList.add("hidden");
  refs.notifyFormCancel.classList.add("hidden");
  setStatusMessage(refs.notifyFormResult, "");
  syncNotifyModeUi();
}

function fillNotifyForm(monitor) {
  populateNotifyIntervalOptions();
  refs.notifyEditId.value = monitor.id;
  refs.notifyName.value = monitor.name || "";
  refs.notifyMonitorType.value = monitor.monitorType || "http";
  refs.notifyEnabled.value = monitor.enabled ? "1" : "0";
  refs.notifyMethod.value = monitor.httpMethod || "GET";
  refs.notifyUrl.value = monitor.requestUrl || "";
  refs.notifyBrowserPageUrl.value = monitor.browserPageUrl || "";
  refs.notifyBrowserReadySelector.value = monitor.browserReadySelector || "";
  refs.notifyBrowserWaitMs.value = monitor.browserWaitMs || 10000;
  refs.notifyHeaders.value = monitor.headersJson || "";
  refs.notifyBody.value = monitor.bodyJson || "";
  refs.notifyWatchFields.value = (monitor.watchFields || []).join(", ");
  refs.notifyWebhookOverride.value = monitor.feishuWebhookOverride || "";
  refs.notifyTitle.value = monitor.notifyTitle || "";
  refs.notifyTimeout.value = monitor.timeoutSeconds || 15;
  refs.notifyCooldown.value = monitor.cooldownSeconds || 0;
  refs.notifyMatchMode.value = monitor.rules?.matchMode || "all";
  refs.notifyRulesList.innerHTML = "";
  (monitor.rules?.items || []).forEach((rule) => addRuleRow(rule));
  ensureRuleEmptyHint();
  setNotifyIntervalValue(monitor.intervalSeconds || 60);
  refs.notifyFormTitle.textContent = `编辑监听：${monitor.name}`;
  refs.notifySubmitBtn.textContent = "保存修改";
  refs.notifyTestRunBtn.classList.remove("hidden");
  refs.notifyFormCancel.classList.remove("hidden");
  setStatusMessage(refs.notifyFormResult, "");
  syncNotifyModeUi();
  refs.notifyName.focus();
}

function formatLastStatus(value) {
  const map = {
    notified: "已通知",
    matched: "已命中",
    matched_cooldown: "命中(冷却)",
    matched_no_webhook: "命中(无Webhook)",
    no_match: "未命中",
    http_error: "HTTP 异常",
    error: "请求异常",
    send_error: "通知失败"
  };
  return map[value] || value || "-";
}

async function refreshNotificationSettings() {
  if (!refs.notifyGlobalWebhook) return;
  const payload = await api("/api/admin/notifications/settings");
  refs.notifyGlobalWebhook.value = payload.globalFeishuWebhook || "";
}

async function refreshNotificationMonitors() {
  if (!refs.notifyMonitorList) return;
  const payload = await api("/api/admin/notifications/monitors");
  notifyMonitorsCache = payload.items || [];

  renderTable(refs.notifyMonitorList, [
    {
      label: "名称",
      render: (item) => `<strong>${escapeHtml(item.name)}</strong><br/><span style="font-size:11px;color:var(--muted)">${item.monitorType === "browser" ? "浏览器模式" : "HTTP 直连"}${item.notifyTitle ? ` · ${escapeHtml(item.notifyTitle)}` : ""}</span>`
    },
    {
      label: "接口",
      render: (item) => `<code style="font-size:11px">${escapeHtml(item.httpMethod)} ${escapeHtml(item.requestUrl)}</code>`
    },
    {
      label: "周期",
      render: (item) => `${item.intervalSeconds} 秒`
    },
    {
      label: "规则",
      render: (item) => `${item.rules?.items?.length || 0} 条 (${item.rules?.matchMode === "any" ? "任一命中" : "全部命中"})`
    },
    {
      label: "Webhook",
      render: (item) => item.feishuWebhookOverride ? "覆盖" : "全局"
    },
    {
      label: "状态",
      render: (item) => item.enabled ? renderStatus("active") : renderStatus("disabled")
    },
    {
      label: "最近执行",
      render: (item) => `
        <div style="font-size:11px;line-height:1.4">
          <div>${item.lastRunAt ? escapeHtml(item.lastRunAt) : "未执行"}</div>
          <div style="color:var(--muted)">${escapeHtml(formatLastStatus(item.lastStatus))}${item.lastError ? ` · ${escapeHtml(item.lastError.slice(0, 40))}` : ""}</div>
        </div>
      `
    },
    {
      label: "操作",
      render: (item) => `
        <button class="primary-btn small" type="button" onclick="editNotifyMonitor('${escapeHtml(item.id)}')">编辑</button>
        <button class="ghost-btn small" style="padding:6px 12px;font-size:12px" type="button" onclick="toggleNotifyMonitor('${escapeHtml(item.id)}', ${item.enabled ? 0 : 1})">${item.enabled ? "停用" : "启用"}</button>
        <button class="ghost-btn small" style="padding:6px 12px;font-size:12px" type="button" onclick="testNotifyMonitor('${escapeHtml(item.id)}')">测试</button>
        <button class="ghost-btn small" style="padding:6px 12px;font-size:12px;color:var(--error)" type="button" onclick="deleteNotifyMonitor('${escapeHtml(item.id)}')">删除</button>
      `
    }
  ], notifyMonitorsCache, "暂无监听项");
}

async function refreshNotificationEvents() {
  if (!refs.notifyEventList) return;
  const payload = await api("/api/admin/notifications/events?limit=80");
  renderTable(refs.notifyEventList, [
    { label: "时间", render: (item) => `<span style="font-size:12px">${escapeHtml(item.createdAt)}</span>` },
    { label: "监听", render: (item) => escapeHtml(item.monitorName || "-") },
    {
      label: "类型",
      render: (item) => {
        const label = NOTIFY_EVENT_LABELS[item.eventType] || item.eventType;
        const cls = item.eventType === "matched" || item.eventType === "send_ok"
          ? "status-succeeded"
          : item.eventType === "fetch_error" || item.eventType === "send_error"
            ? "status-failed"
            : item.eventType === "test"
              ? "status-pending"
              : "status-disabled";
        return `<span class="table-badge ${cls}">${escapeHtml(label)}</span>`;
      }
    },
    {
      label: "摘要",
      render: (item) => `<span class="event-summary" title="${escapeHtml(item.summary || "")}">${escapeHtml(item.summary || "-")}</span>`
    }
  ], payload.items || [], "暂无通知事件");
}

async function refreshNotifications() {
  await Promise.all([
    refreshNotificationSettings().catch(() => {}),
    refreshNotificationMonitors().catch(() => {}),
    refreshNotificationEvents().catch(() => {})
  ]);
}

function editNotifyMonitor(id) {
  const monitor = notifyMonitorsCache.find((item) => item.id === id);
  if (!monitor) return;
  fillNotifyForm(monitor);
  refs.notifyMonitorForm.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function toggleNotifyMonitor(id, nextEnabled) {
  try {
    await api(`/api/admin/notifications/monitors/${id}/status`, {
      method: "PATCH",
      body: JSON.stringify({ enabled: !!nextEnabled })
    });
    await refreshNotifications();
  } catch (error) {
    alert(error.message);
  }
}

async function deleteNotifyMonitor(id) {
  if (!window.confirm("确认删除该监听项？删除后历史事件仍会保留。")) return;
  try {
    await api(`/api/admin/notifications/monitors/${id}`, { method: "DELETE" });
    if (refs.notifyEditId.value === id) resetNotifyForm();
    await refreshNotifications();
  } catch (error) {
    alert(error.message);
  }
}

async function testNotifyMonitor(id) {
  try {
    setStatusMessage(refs.notifyFormResult, "正在测试执行监听，请稍候...", "info");
    setButtonBusy(refs.notifyTestRunBtn, true, "测试中...");
    const result = await api(`/api/admin/notifications/monitors/${id}/test-run`, {
      method: "POST",
      body: JSON.stringify({})
    });
    const matched = result.ruleResult?.matched;
    const status = result.response?.status;
    const summary = matched ? "命中规则" : "未命中规则";
    setStatusMessage(refs.notifyFormResult, `测试完成（HTTP ${status}）：${summary}`, matched ? "success" : "info");
    await refreshNotificationEvents().catch(() => {});
  } catch (error) {
    setStatusMessage(refs.notifyFormResult, `测试失败：${error.message}`, "error");
  } finally {
    setButtonBusy(refs.notifyTestRunBtn, false);
  }
}

window.editNotifyMonitor = editNotifyMonitor;
window.toggleNotifyMonitor = toggleNotifyMonitor;
window.deleteNotifyMonitor = deleteNotifyMonitor;
window.testNotifyMonitor = testNotifyMonitor;

function getCheckedValues(selector) {
  return Array.from(document.querySelectorAll(selector))
    .filter((element) => element.checked)
    .map((element) => element.value);
}

function getSelectedCdkeyIds() {
  return getCheckedValues(".cdkey-check");
}

function formatKeysForClipboard(keys) {
  return keys.map((key) => String(key).trimEnd()).join("\n");
}

async function exportPublicKeys() {
  const ids = getSelectedCdkeyIds();
  if (!ids.length) {
    alert("请先选择卡密");
    return;
  }

  const rows = Array.from(document.querySelectorAll(".cdkey-check"))
    .filter((checkbox) => checkbox.checked)
    .map((checkbox) => {
      const row = checkbox.closest("tr");
      const codeEl = row?.querySelector("td:nth-child(2) code");
      return codeEl ? codeEl.textContent : "";
    })
    .filter(Boolean);

  const text = formatKeysForClipboard(rows);
  try {
    await navigator.clipboard.writeText(text);
    alert(`已复制 ${rows.length} 条公开卡密`);
  } catch (_) {
    alert("导出失败：剪贴板写入被拒绝");
  }
}

async function exportSourceKeys() {
  const ids = getSelectedCdkeyIds();
  if (!ids.length) {
    alert("请先选择卡密");
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const payload = await api("/api/admin/cdkeys/export-source-keys", {
      method: "POST",
      body: JSON.stringify({ ids }),
      signal: controller.signal
    });
    clearTimeout(timeout);

    const keys = (payload.items || []).map((item) => item.sourceKey);
    const text = formatKeysForClipboard(keys);
    await navigator.clipboard.writeText(text);
    alert(`已复制 ${keys.length} 条原始卡密`);
  } catch (error) {
    clearTimeout(timeout);
    if (error.name === "AbortError") {
      alert("导出失败：请求超时");
    } else {
      alert(`导出失败：${error.message}`);
    }
  }
}

function generateExcelFilename() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `cdkeys_export_${stamp}.xlsx`;
}

async function exportCdkeysExcel() {
  const params = new URLSearchParams();
  const statusEl = document.querySelector("#cdkey-filter-status");
  const siteEl = document.querySelector("#cdkey-filter-site");
  const batchEl = document.querySelector("#cdkey-filter-batch");
  const keywordEl = document.querySelector("#cdkey-filter-keyword");

  if (statusEl && statusEl.value) params.set("status", statusEl.value);
  if (siteEl && siteEl.value) params.set("siteId", siteEl.value);
  if (batchEl && batchEl.value) params.set("batchId", batchEl.value);
  if (keywordEl && keywordEl.value.trim()) params.set("q", keywordEl.value.trim());

  const qs = params.toString();
  const url = "/api/admin/cdkeys/export-excel" + (qs ? "?" + qs : "");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const payload = await api(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!payload.items || !payload.items.length) {
      alert("无数据可导出");
      return;
    }

    const rows = payload.items.map((item) => ({
      "公开卡密": item.public_key || "",
      "原始卡密": item.source_key || "",
      "前缀": item.prefix || "",
      "状态": item.status || "",
      "网站": item.site_name || "",
      "批次": item.batch_name || "",
      "接码Token": item.email_token || "",
      "创建时间": item.created_at || ""
    }));

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "卡密数据");
    XLSX.writeFile(wb, generateExcelFilename());
  } catch (error) {
    clearTimeout(timeout);
    if (error.name === "AbortError") {
      alert("导出失败：请求超时");
    } else {
      alert(`导出失败：${error.message}`);
    }
  }
}

// ── Quota System ──

async function refreshQuotaDashboard() {
  if (!refs.quotaStats) return;
  try {
    const payload = await api("/api/admin/quota/dashboard");
    const cards = [
      ["总额度", payload.totalQuota ?? 0],
      ["可分配额度", payload.availableQuota ?? 0],
      ["已分配额度", payload.allocatedQuota ?? 0],
      ["活跃子卡密数", payload.activeSubCards ?? 0]
    ];
    refs.quotaStats.innerHTML = cards.map(([label, value]) => `
      <article class="stat">
        <span>${label}</span>
        <strong>${value}</strong>
      </article>
    `).join("");
  } catch (error) {
    refs.quotaStats.innerHTML = `<p class="hint centered">加载失败：${escapeHtml(error.message)}</p>`;
  }
}

function renderQuotaImportResults(result) {
  if (!refs.quotaImportDetailCard || !refs.quotaImportDetail) return;
  refs.quotaImportDetailCard.classList.remove("hidden");

  const summaryHtml = `
    <div style="margin-bottom:16px;">
      <span class="table-badge status-active">成功 ${result.successCount ?? 0}</span>
      <span class="table-badge status-failed" style="margin-left:8px">失败 ${result.failedCount ?? 0}</span>
    </div>
  `;

  if (!result.failures || result.failures.length === 0) {
    refs.quotaImportDetail.innerHTML = summaryHtml + `<p class="hint centered">全部导入成功</p>`;
    return;
  }

  const failRows = result.failures.map((f) => `
    <tr>
      <td><code>${escapeHtml(f.code || f.cardCode || "-")}</code></td>
      <td>${escapeHtml(f.reason || f.error || "未知原因")}</td>
    </tr>
  `).join("");

  refs.quotaImportDetail.innerHTML = summaryHtml + `
    <table>
      <thead><tr><th>卡密</th><th>失败原因</th></tr></thead>
      <tbody>${failRows}</tbody>
    </table>
  `;
}

// ── Quota Sub-Card Management ──

async function refreshQuotaSubCards() {
  if (!refs.quotaSubCardList) return;
  try {
    const payload = await api("/api/admin/quota/sub-cards");
    const items = payload.items || [];
    renderTable(refs.quotaSubCardList, [
      { label: "编码", render: (item) => `<code>${escapeHtml(item.card_code || item.cardCode)}</code>` },
      { label: "总额度", render: (item) => item.total_quota ?? item.totalQuota ?? 0 },
      { label: "已用额度", render: (item) => item.used_quota ?? item.usedQuota ?? 0 },
      { label: "剩余", render: (item) => {
        const total = item.total_quota ?? item.totalQuota ?? 0;
        const used = item.used_quota ?? item.usedQuota ?? 0;
        return total - used;
      }},
      { label: "状态", render: (item) => renderStatus(item.status) },
      { label: "操作", render: (item) => `
        <button class="primary-btn small" type="button" onclick="viewQuotaSubCardDetail('${escapeHtml(item.id)}')">详情</button>
        ${item.status === "active" ? `<button class="ghost-btn small" style="padding:6px 12px;font-size:12px;color:var(--error)" type="button" onclick="cancelQuotaSubCard('${escapeHtml(item.id)}')">取消</button>` : ""}
      ` }
    ], items, "暂无子卡密");
  } catch (error) {
    refs.quotaSubCardList.innerHTML = `<p class="hint centered">加载失败：${escapeHtml(error.message)}</p>`;
  }
}

async function viewQuotaSubCardDetail(id) {
  if (!refs.quotaSubCardDetailCard || !refs.quotaSubCardDetail || !refs.quotaSubCardHistory) return;
  refs.quotaSubCardDetailCard.classList.remove("hidden");

  try {
    const detail = await api(`/api/admin/quota/sub-cards/${id}`);
    const total = detail.total_quota ?? detail.totalQuota ?? 0;
    const used = detail.used_quota ?? detail.usedQuota ?? 0;
    const remaining = total - used;

    refs.quotaSubCardDetail.innerHTML = `
      <table>
        <thead><tr><th>编码</th><th>总额度</th><th>已用额度</th><th>剩余额度</th><th>状态</th><th>创建时间</th></tr></thead>
        <tbody>
          <tr>
            <td><code>${escapeHtml(detail.card_code || detail.cardCode)}</code></td>
            <td>${total}</td>
            <td>${used}</td>
            <td>${remaining}</td>
            <td>${renderStatus(detail.status)}</td>
            <td><span style="font-size:12px">${escapeHtml(detail.created_at || detail.createdAt || "-")}</span></td>
          </tr>
        </tbody>
      </table>
    `;
  } catch (error) {
    refs.quotaSubCardDetail.innerHTML = `<p class="hint centered">加载详情失败：${escapeHtml(error.message)}</p>`;
  }

  try {
    const historyPayload = await api(`/api/admin/quota/sub-cards/${id}/history`);
    const history = historyPayload.history || historyPayload.items || [];
    renderTable(refs.quotaSubCardHistory, [
      { label: "提取时间", render: (item) => `<span style="font-size:12px">${escapeHtml(item.created_at || item.createdAt || item.claimedAt || "-")}</span>` },
      { label: "提取数量", render: (item) => item.amount ?? item.chargedQuota ?? 0 },
      { label: "账号数量", render: (item) => item.account_count ?? item.accountCount ?? 0 }
    ], history, "暂无提取记录");
  } catch (error) {
    refs.quotaSubCardHistory.innerHTML = `<p class="hint centered">加载历史失败：${escapeHtml(error.message)}</p>`;
  }

  refs.quotaSubCardDetailCard.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function cancelQuotaSubCard(id) {
  if (!window.confirm("确认取消该子卡密？取消后剩余额度将归还到可分配额度池中。")) return;
  try {
    await api(`/api/admin/quota/sub-cards/${id}/cancel`, { method: "POST", body: JSON.stringify({}) });
    await refreshQuotaSubCards();
    await refreshQuotaDashboard();
  } catch (error) {
    alert(`取消失败：${error.message}`);
  }
}

window.viewQuotaSubCardDetail = viewQuotaSubCardDetail;
window.cancelQuotaSubCard = cancelQuotaSubCard;

async function refreshAll() {
  if (!getToken()) return;
  await Promise.all([
    refreshDashboard(),
    refreshSites(),
    refreshBatches(),
    refreshCdkeys(),
    refreshSmsEntries(),
    refreshOrders(),
    refreshJobs(),
    refreshLogs(),
    refreshSystemVersion(),
    refreshSubscriptions(),
    refreshNotifications(),
    refreshQuotaDashboard(),
    refreshQuotaSubCards()
  ]);
}

refs.navItems.forEach((button) => {
  button.addEventListener("click", () => {
    switchTab(button.dataset.tab);
  });
});

refs.healthCheckAllBtn.addEventListener("click", () => {
  healthCheckAll().catch((error) => setHint(refs.siteResult, error.message));
});

refs.checkUpdateBtn.addEventListener("click", async () => {
  setHint(refs.systemUpdateHint, "正在检查...");
  try {
    const payload = await api("/api/admin/system/check-update", {
      method: "POST",
      body: JSON.stringify({})
    });
    renderSystemInfo(payload);
  } catch (error) {
    setHint(refs.systemUpdateHint, error.message);
  }
});

refs.startUpdateBtn.addEventListener("click", async () => {
  if (!window.confirm("确认开始在线更新？")) return;
  setHint(refs.systemUpdateHint, "启动中...");
  try {
    const payload = await api("/api/admin/system/update", {
      method: "POST",
      body: JSON.stringify({})
    });
    renderSystemInfo(payload);
    startUpdatePolling();
  } catch (error) {
    setHint(refs.systemUpdateHint, error.message);
  }
});

refs.loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const payload = await api("/api/admin/auth/login", {
      method: "POST",
      body: JSON.stringify({
        username: document.querySelector("#username").value.trim(),
        password: document.querySelector("#password").value
      })
    });
    setToken(payload.token);
    setAuthState(true, payload.username);
    switchTab(currentTab);
    startAutoRefresh();
    await refreshAll();
  } catch (error) {
    setHint(refs.loginResult, error.message);
  }
});

refs.singleCdkeyForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const payload = await api("/api/admin/cdkeys/create", {
      method: "POST",
      body: JSON.stringify({
        sourceKey: document.querySelector("#single-source-key").value.trim(),
        siteId: refs.singleSite.value,
        prefix: document.querySelector("#single-prefix").value.trim(),
        note: "",
        emailToken: refs.singleEmailToken.value.trim()
      })
    });
    refs.singleCdkeyForm.reset();
    refs.singleSite.value = "site_preset_meimei_site";
    setHint(
      refs.singleCdkeyResult,
      payload.mode === "support"
        ? `已生成接码卡密: ${payload.publicKey}`
        : `已添加普通卡密: ${payload.publicKey}`
    );
    await refreshAll();
  } catch (error) {
    setHint(refs.singleCdkeyResult, error.message);
  }
});

refs.batchForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const payload = await api("/api/admin/batches/import", {
      method: "POST",
      body: JSON.stringify({
        name: document.querySelector("#batch-name").value.trim(),
        prefix: document.querySelector("#batch-prefix").value.trim(),
        siteId: refs.batchSite.value,
        importType: refs.batchImportType.value,
        rawKeys: document.querySelector("#batch-raw-keys").value,
        note: ""
      })
    });
    refs.batchForm.reset();
    refs.batchSite.value = "site_preset_meimei_site";
    refs.batchImportType.value = "support";
    setHint(
      refs.batchResult,
      `成功导入 ${payload.importedCount} 条（接码专用 ${payload.supportOnlyCount || 0} / 普通 ${payload.normalCount || 0}）`
    );
    await refreshAll();
  } catch (error) {
    setHint(refs.batchResult, error.message);
  }
});

refs.cdkeyActionBtn.addEventListener("click", async () => {
  const ids = getCheckedValues(".cdkey-check");
  if (!ids.length) return alert("请先勾选卡密");
  try {
    await api("/api/admin/cdkeys/bulk-action", {
      method: "POST",
      body: JSON.stringify({ ids, action: refs.cdkeyAction.value })
    });
    await refreshAll();
  } catch (error) {
    alert(error.message);
  }
});

refs.cdkeyExportPublicBtn.addEventListener("click", () => {
  exportPublicKeys();
});

refs.cdkeyExportSourceBtn.addEventListener("click", () => {
  exportSourceKeys();
});

refs.cdkeyExportExcelBtn.addEventListener("click", () => {
  exportCdkeysExcel();
});

refs.retryJobsBtn.addEventListener("click", async () => {
  const ids = getCheckedValues(".job-check");
  if (!ids.length) return alert("请先勾选任务");
  try {
    await api("/api/admin/jobs/retry", {
      method: "POST",
      body: JSON.stringify({ ids })
    });
    await refreshAll();
  } catch (error) {
    alert(error.message);
  }
});

refs.subCardTypeForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const editId = refs.subCtEditId.value;
  const body = {
    name: refs.subCtName.value.trim(),
    totalSubscriptions: parseInt(refs.subCtTotal.value, 10) || 0
  };
  if (editId) body.id = editId;

  try {
    await api("/api/admin/subscriptions/card-types", {
      method: "POST",
      body: JSON.stringify(body)
    });
    refs.subCardTypeForm.reset();
    refs.subCtEditId.value = "";
    refs.subCtSubmitBtn.textContent = "添加卡种";
    refs.subCtCancelBtn.classList.add("hidden");
    setHint(refs.subCtResult, editId ? "卡种已更新" : "卡种已添加");
    await refreshSubscriptions();
  } catch (error) {
    setHint(refs.subCtResult, error.message);
  }
});

refs.subCtCancelBtn.addEventListener("click", () => {
  refs.subCardTypeForm.reset();
  refs.subCtEditId.value = "";
  refs.subCtSubmitBtn.textContent = "添加卡种";
  refs.subCtCancelBtn.classList.add("hidden");
  setHint(refs.subCtResult, "");
});

if (refs.notifyMonitorForm) {
  populateNotifyIntervalOptions();
  ensureRuleEmptyHint();
  syncNotifyModeUi();

  refs.notifyAddRule?.addEventListener("click", () => addRuleRow());
  refs.notifyMonitorType?.addEventListener("change", syncNotifyModeUi);

  refs.notifySettingsForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const payload = await api("/api/admin/notifications/settings", {
        method: "PATCH",
        body: JSON.stringify({ globalFeishuWebhook: refs.notifyGlobalWebhook.value.trim() })
      });
      setStatusMessage(
        refs.notifySettingsResult,
        payload.globalFeishuWebhook ? "已保存全局 Webhook" : "已清空全局 Webhook",
        "success"
      );
    } catch (error) {
      setStatusMessage(refs.notifySettingsResult, `保存失败：${error.message}`, "error");
    }
  });

  refs.notifyTestGlobalWebhook?.addEventListener("click", async () => {
    const webhookUrl = refs.notifyGlobalWebhook.value.trim();
    if (!webhookUrl) {
      setStatusMessage(refs.notifySettingsResult, "请先填写飞书 Webhook 地址", "error");
      return;
    }
    try {
      setStatusMessage(refs.notifySettingsResult, "正在发送飞书测试消息，请稍候...", "info");
      setButtonBusy(refs.notifyTestGlobalWebhook, true, "发送中...");
      const payload = await api("/api/admin/notifications/test-feishu", {
        method: "POST",
        body: JSON.stringify({ webhookUrl })
      });
      setStatusMessage(
        refs.notifySettingsResult,
        payload.ok
          ? "飞书测试消息已发送，请到群里查收。"
          : `飞书返回失败：${payload.text || payload.status}`,
        payload.ok ? "success" : "error"
      );
    } catch (error) {
      setStatusMessage(refs.notifySettingsResult, `发送失败：${error.message}`, "error");
    } finally {
      setButtonBusy(refs.notifyTestGlobalWebhook, false);
    }
  });

  refs.notifyFormCancel?.addEventListener("click", () => {
    resetNotifyForm();
  });

  refs.notifyRefreshBtn?.addEventListener("click", () => {
    refreshNotifications().catch((error) => setHint(refs.notifyFormResult, error.message));
  });

  refs.notifyTestRunBtn?.addEventListener("click", async () => {
    const id = refs.notifyEditId.value;
    if (!id) {
      setStatusMessage(refs.notifyFormResult, "请先保存监听后再测试", "error");
      return;
    }
    await testNotifyMonitor(id);
  });

  refs.notifyMonitorForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const editId = refs.notifyEditId.value;
    const rules = collectRules();
    const watchFieldsRaw = refs.notifyWatchFields.value || "";
    const watchFields = watchFieldsRaw
      .split(/[\n,;\s]+/)
      .map((value) => value.trim())
      .filter(Boolean);
    const intervalSeconds = Number(refs.notifyInterval.value);

    if (!Number.isFinite(intervalSeconds) || intervalSeconds < 1 || intervalSeconds > 3600) {
      setStatusMessage(refs.notifyFormResult, "轮询间隔必须在 1-3600 秒之间", "error");
      return;
    }

    const headersValue = refs.notifyHeaders.value.trim();
    if (headersValue) {
      try {
        const parsed = JSON.parse(headersValue);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new Error("Headers 必须是 JSON 对象");
        }
      } catch (error) {
        setStatusMessage(refs.notifyFormResult, `Headers 不是合法 JSON：${error.message}`, "error");
        return;
      }
    }
    const bodyValue = refs.notifyBody.value.trim();
    if (bodyValue) {
      try {
        JSON.parse(bodyValue);
      } catch (error) {
        setStatusMessage(refs.notifyFormResult, `Body 不是合法 JSON：${error.message}`, "error");
        return;
      }
    }

    const payload = {
      name: refs.notifyName.value.trim(),
      monitorType: refs.notifyMonitorType.value,
      enabled: refs.notifyEnabled.value === "1",
      requestUrl: refs.notifyUrl.value.trim(),
      httpMethod: refs.notifyMethod.value,
      browserPageUrl: refs.notifyBrowserPageUrl.value.trim(),
      browserReadySelector: refs.notifyBrowserReadySelector.value.trim(),
      browserWaitMs: Math.max(1000, Math.min(60000, Number(refs.notifyBrowserWaitMs.value) || 10000)),
      headersJson: headersValue,
      bodyJson: bodyValue,
      intervalSeconds,
      timeoutSeconds: Math.max(1, Math.min(120, Number(refs.notifyTimeout.value) || 15)),
      watchFields,
      rules,
      feishuWebhookOverride: refs.notifyWebhookOverride.value.trim(),
      notifyTitle: refs.notifyTitle.value.trim(),
      cooldownSeconds: Math.max(0, Math.min(86400, Number(refs.notifyCooldown.value) || 0))
    };
    if (editId) payload.id = editId;

    if (payload.monitorType === "browser" && !payload.browserPageUrl) {
      setStatusMessage(refs.notifyFormResult, "浏览器模式必须填写页面 URL", "error");
      return;
    }

    try {
      const result = await api("/api/admin/notifications/monitors", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      resetNotifyForm();
      await refreshNotifications();
      setStatusMessage(refs.notifyFormResult, editId ? "监听已更新" : `监听已创建：${result.id}`, "success");
    } catch (error) {
      setStatusMessage(refs.notifyFormResult, `保存失败：${error.message}`, "error");
    }
  });
}

// ── SMS Batch Import Form ──
refs.smsBatchForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const payload = await api("/api/admin/sms/import", {
      method: "POST",
      body: JSON.stringify({
        batchName: document.querySelector("#sms-batch-name").value.trim(),
        prefix: document.querySelector("#sms-batch-prefix").value.trim(),
        content: document.querySelector("#sms-batch-content").value
      })
    });
    refs.smsBatchForm.reset();
    setHint(refs.smsBatchResult, `成功导入 ${payload.importedCount} 条接码记录`);
    setTimeout(() => {
      if (refs.smsBatchResult.textContent.startsWith("成功导入")) {
        setHint(refs.smsBatchResult, "");
      }
    }, 5000);
    await refreshSmsEntries();
  } catch (error) {
    setHint(refs.smsBatchResult, error.message);
  }
});

// ── SMS Single Add Form ──
refs.smsSingleForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const payload = await api("/api/admin/sms/entries", {
      method: "POST",
      body: JSON.stringify({
        phone: document.querySelector("#sms-single-phone").value.trim(),
        smsUrl: document.querySelector("#sms-single-url").value.trim(),
        prefix: document.querySelector("#sms-single-prefix").value.trim()
      })
    });
    refs.smsSingleForm.reset();
    setHint(refs.smsSingleResult, `已生成卡密: ${payload.publicKey}`);
    await refreshSmsEntries();
  } catch (error) {
    setHint(refs.smsSingleResult, error.message);
  }
});

// ── SMS Copy Public Keys ──
async function copySmsPublicKeys() {
  const checkboxes = Array.from(document.querySelectorAll(".sms-check")).filter((cb) => cb.checked);
  if (!checkboxes.length) {
    setHint(refs.smsBatchResult, "请先选择记录");
    return;
  }
  const keys = checkboxes.map((cb) => cb.dataset.publicKey);
  const text = keys.map((k) => String(k).trimEnd()).join("\n");
  try {
    await navigator.clipboard.writeText(text);
    setHint(refs.smsBatchResult, `已复制 ${keys.length} 条卡密`);
    setTimeout(() => {
      if (refs.smsBatchResult.textContent.startsWith("已复制")) {
        setHint(refs.smsBatchResult, "");
      }
    }, 3000);
  } catch (_) {
    setHint(refs.smsBatchResult, "复制失败：剪贴板写入被拒绝");
  }
}

refs.smsCopyKeysBtn.addEventListener("click", () => {
  copySmsPublicKeys();
});

// ── SMS Copy Info ──
async function copySmsInfo() {
  const checkboxes = Array.from(document.querySelectorAll(".sms-check")).filter((cb) => cb.checked);
  if (!checkboxes.length) {
    setHint(refs.smsBatchResult, "请先选择记录");
    return;
  }
  const lines = checkboxes.map((cb) => {
    const phone = cb.dataset.phone || "";
    const smsUrl = cb.dataset.smsUrl || "";
    return `${phone}----${smsUrl}`;
  });
  const text = lines.join("\n");
  try {
    await navigator.clipboard.writeText(text);
    setHint(refs.smsBatchResult, `已复制 ${lines.length} 条接码信息`);
    setTimeout(() => {
      if (refs.smsBatchResult.textContent.startsWith("已复制")) {
        setHint(refs.smsBatchResult, "");
      }
    }, 3000);
  } catch (_) {
    setHint(refs.smsBatchResult, "复制失败：剪贴板写入被拒绝");
  }
}

refs.smsCopyInfoBtn.addEventListener("click", () => {
  copySmsInfo();
});

// ── SMS Export Excel ──
function generateSmsExcelFilename() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `sms_export_${stamp}.xlsx`;
}

async function exportSmsExcel() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  setButtonBusy(refs.smsExportExcelBtn, true, "导出中...");
  try {
    const payload = await api("/api/admin/sms/export", { signal: controller.signal });
    clearTimeout(timeout);

    if (!payload.items || !payload.items.length) {
      setHint(refs.smsBatchResult, "无数据可导出");
      return;
    }

    const rows = payload.items.map((item) => ({
      "卡密": item.publicKey || "",
      "手机号": item.phone || "",
      "接码网址": item.smsUrl || "",
      "前缀": item.prefix || "",
      "批次": item.batchName || "",
      "状态": item.status || "",
      "创建时间": item.createdAt || ""
    }));

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "接码数据");
    XLSX.writeFile(wb, generateSmsExcelFilename());
  } catch (error) {
    clearTimeout(timeout);
    if (error.name === "AbortError") {
      setHint(refs.smsBatchResult, "导出失败：请求超时");
    } else {
      setHint(refs.smsBatchResult, `导出失败：${error.message}`);
    }
  } finally {
    setButtonBusy(refs.smsExportExcelBtn, false);
  }
}

refs.smsExportExcelBtn.addEventListener("click", () => {
  exportSmsExcel();
});

// ── SMS Batch Status Update ──
async function updateSmsStatus() {
  const checkboxes = Array.from(document.querySelectorAll(".sms-check")).filter((cb) => cb.checked);
  if (!checkboxes.length) {
    setHint(refs.smsBatchResult, "请先选择记录");
    return;
  }
  const ids = checkboxes.map((cb) => cb.value);
  const status = refs.smsAction.value;
  try {
    const payload = await api("/api/admin/sms/entries/status", {
      method: "PATCH",
      body: JSON.stringify({ ids, status })
    });
    setHint(refs.smsBatchResult, `已更新 ${payload.updatedCount} 条记录`);
    await refreshSmsEntries();
  } catch (error) {
    setHint(refs.smsBatchResult, error.message);
  }
}

refs.smsActionBtn.addEventListener("click", () => {
  updateSmsStatus();
});

// ── Quota Import Form ──
if (refs.quotaImportForm) {
  refs.quotaImportForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const raw = refs.quotaImportCodes.value.trim();
    if (!raw) {
      setHint(refs.quotaImportResult, "请输入至少一张卡密");
      return;
    }
    const codes = raw.split(/\n+/).map((line) => line.trim()).filter(Boolean);
    if (codes.length === 0) {
      setHint(refs.quotaImportResult, "请输入至少一张卡密");
      return;
    }
    if (codes.length > 100) {
      setHint(refs.quotaImportResult, "单次最多导入 100 张卡密");
      return;
    }
    try {
      setHint(refs.quotaImportResult, "正在导入，请稍候...");
      const payload = await api("/api/admin/quota/cards/import", {
        method: "POST",
        body: JSON.stringify({ cards: codes })
      });
      setHint(refs.quotaImportResult, `导入完成：成功 ${payload.successCount ?? 0}，失败 ${payload.failedCount ?? 0}`);
      renderQuotaImportResults(payload);
      refs.quotaImportCodes.value = "";
      await refreshQuotaDashboard();
    } catch (error) {
      setHint(refs.quotaImportResult, `导入失败：${error.message}`);
    }
  });
}

// ── Quota Settings Form ──
async function loadQuotaSettings() {
  if (!refs.quotaLowStockThreshold) return;
  try {
    const payload = await api("/api/admin/quota/settings");
    refs.quotaLowStockThreshold.value = payload.lowStockThreshold ?? 5;
  } catch (_) {
    // silently ignore load errors
  }
}

if (refs.quotaSettingsForm) {
  refs.quotaSettingsForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const value = parseInt(refs.quotaLowStockThreshold.value, 10);
    if (!Number.isInteger(value) || value < 1) {
      setHint(refs.quotaSettingsResult, "低库存阈值必须为正整数（>= 1）");
      return;
    }
    try {
      await api("/api/admin/quota/settings", {
        method: "PATCH",
        body: JSON.stringify({ low_stock_threshold: value })
      });
      setHint(refs.quotaSettingsResult, "设置已保存");
    } catch (error) {
      setHint(refs.quotaSettingsResult, `保存失败：${error.message}`);
    }
  });
}

// ── Quota Sub-Card Create Form ──
if (refs.quotaSubCardForm) {
  refs.quotaSubCardForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const quota = parseInt(refs.quotaSubCardQuota.value, 10);
    const count = parseInt(refs.quotaSubCardCount.value, 10);
    if (!quota || quota < 1 || quota > 999999) {
      setHint(refs.quotaSubCardResult, "额度必须为 1 ~ 999999 的正整数");
      return;
    }
    if (!count || count < 1 || count > 100) {
      setHint(refs.quotaSubCardResult, "数量必须为 1 ~ 100 的正整数");
      return;
    }
    try {
      setHint(refs.quotaSubCardResult, "正在创建，请稍候...");
      const payload = await api("/api/admin/quota/sub-cards", {
        method: "POST",
        body: JSON.stringify({ quota, count })
      });
      setHint(refs.quotaSubCardResult, `成功创建 ${payload.createdCount ?? count} 张子卡密`);
      refs.quotaSubCardForm.reset();
      await refreshQuotaSubCards();
      await refreshQuotaDashboard();
    } catch (error) {
      setHint(refs.quotaSubCardResult, `创建失败：${error.message}`);
    }
  });
}

// ── Quota Sub-Card Refresh Button ──
if (refs.quotaSubCardRefreshBtn) {
  refs.quotaSubCardRefreshBtn.addEventListener("click", () => {
    refreshQuotaSubCards().catch((error) => {
      if (refs.quotaSubCardList) {
        refs.quotaSubCardList.innerHTML = `<p class="hint centered">刷新失败：${escapeHtml(error.message)}</p>`;
      }
    });
  });
}

// ── Quota Sub-Card Detail Close Button ──
if (refs.quotaSubCardDetailClose) {
  refs.quotaSubCardDetailClose.addEventListener("click", () => {
    if (refs.quotaSubCardDetailCard) {
      refs.quotaSubCardDetailCard.classList.add("hidden");
    }
  });
}

refs.refreshBtn.addEventListener("click", () => {
  refreshAll().catch((error) => alert(error.message));
});

refs.logoutBtn.addEventListener("click", () => {
  clearToken();
  stopAutoRefresh();
  stopUpdatePolling();
  setAuthState(false);
});

switchTab(currentTab);

if (getToken()) {
  setAuthState(true, "admin");
  startAutoRefresh();
  refreshAll().catch(() => {
    clearToken();
    setAuthState(false);
  });
} else {
  setAuthState(false);
}
