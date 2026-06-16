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
  smsSiteForm: document.querySelector("#sms-site-form"),
  smsSiteName: document.querySelector("#sms-site-name"),
  smsSiteSlug: document.querySelector("#sms-site-slug"),
  smsSiteInventorySource: document.querySelector("#sms-site-inventory-source"),
  smsSiteApiKey: document.querySelector("#sms-site-api-key"),
  smsSiteAppId: document.querySelector("#sms-site-app-id"),
  smsSiteCardType: document.querySelector("#sms-site-card-type"),
  smsSiteExpiry: document.querySelector("#sms-site-expiry"),
  smsSiteNote: document.querySelector("#sms-site-note"),
  smsSiteResult: document.querySelector("#sms-site-result"),
  smsSiteList: document.querySelector("#sms-site-list"),
  smsCardForm: document.querySelector("#sms-card-form"),
  smsCardSite: document.querySelector("#sms-card-site"),
  smsCardPrefix: document.querySelector("#sms-card-prefix"),
  smsCardCount: document.querySelector("#sms-card-count"),
  smsCardNote: document.querySelector("#sms-card-note"),
  smsCardResult: document.querySelector("#sms-card-result"),
  smsCardList: document.querySelector("#sms-card-list"),
  smsCardAction: document.querySelector("#sms-card-action"),
  smsCardActionBtn: document.querySelector("#sms-card-action-btn"),
  smsOrderList: document.querySelector("#sms-order-list"),
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
  quotaApiKeyForm: document.querySelector("#quota-api-key-form"),
  quotaApiKeyInput: document.querySelector("#quota-api-key-input"),
  quotaApiKeyResult: document.querySelector("#quota-api-key-result"),
  quotaImportForm: document.querySelector("#quota-import-form"),
  quotaImportCodes: document.querySelector("#quota-import-codes"),
  quotaImportResult: document.querySelector("#quota-import-result"),
  quotaImportDetailCard: document.querySelector("#quota-import-detail-card"),
  quotaImportDetail: document.querySelector("#quota-import-detail"),
  quotaSourceCardList: document.querySelector("#quota-source-card-list"),
  quotaSourceCardsRefreshBtn: document.querySelector("#quota-source-cards-refresh-btn"),
  quotaSourceCardsExportBtn: document.querySelector("#quota-source-cards-export-btn"),
  quotaSourceCardsExportAllBtn: document.querySelector("#quota-source-cards-export-all-btn"),
  quotaSourceCardsMergeBtn: document.querySelector("#quota-source-cards-merge-btn"),
  quotaSourceCardsMergeResult: document.querySelector("#quota-source-cards-merge-result"),
  quotaSettingsForm: document.querySelector("#quota-settings-form"),
  quotaLowStockThreshold: document.querySelector("#quota-low-stock-threshold"),
  quotaSettingsResult: document.querySelector("#quota-settings-result"),
  quotaSubCardForm: document.querySelector("#quota-sub-card-form"),
  quotaSubCardQuota: document.querySelector("#quota-sub-card-quota"),
  quotaSubCardCount: document.querySelector("#quota-sub-card-count"),
  quotaSubCardResult: document.querySelector("#quota-sub-card-result"),
  quotaSubCardList: document.querySelector("#quota-sub-card-list"),
  quotaSubCardStatus: document.querySelector("#quota-sub-card-status"),
  quotaSubCardPageSize: document.querySelector("#quota-sub-card-page-size"),
  quotaSubCardPagination: document.querySelector("#quota-sub-card-pagination"),
  quotaSubCardRefreshBtn: document.querySelector("#quota-sub-card-refresh-btn"),
  quotaSubCardCopyBtn: document.querySelector("#quota-sub-card-copy-btn"),
  quotaSubCardExportBtn: document.querySelector("#quota-sub-card-export-btn"),
  quotaSubCardDetailCard: document.querySelector("#quota-sub-card-detail-card"),
  quotaSubCardDetail: document.querySelector("#quota-sub-card-detail"),
  quotaSubCardHistory: document.querySelector("#quota-sub-card-history"),
  quotaSubCardDetailClose: document.querySelector("#quota-sub-card-detail-close"),
  sub2apiConnectionForm: document.querySelector("#sub2api-connection-form"),
  sub2apiConnectionFormTitle: document.querySelector("#sub2api-connection-form-title"),
  sub2apiConnectionEditId: document.querySelector("#sub2api-connection-edit-id"),
  sub2apiConnectionName: document.querySelector("#sub2api-connection-name"),
  sub2apiConnectionBaseUrl: document.querySelector("#sub2api-connection-base-url"),
  sub2apiConnectionAdminToken: document.querySelector("#sub2api-connection-admin-token"),
  sub2apiConnectionStatus: document.querySelector("#sub2api-connection-status"),
  sub2apiConnectionSubmitBtn: document.querySelector("#sub2api-connection-submit-btn"),
  sub2apiConnectionCancelBtn: document.querySelector("#sub2api-connection-cancel-btn"),
  sub2apiConnectionRefreshBtn: document.querySelector("#sub2api-connection-refresh-btn"),
  sub2apiConnectionResult: document.querySelector("#sub2api-connection-result"),
  sub2apiConnectionList: document.querySelector("#sub2api-connection-list"),
  sub2apiInviteConnectionFilter: document.querySelector("#sub2api-invite-connection-filter"),
  sub2apiInviteUserFilter: document.querySelector("#sub2api-invite-user-filter"),
  sub2apiInviteStatusFilter: document.querySelector("#sub2api-invite-status-filter"),
  sub2apiInviteRefreshBtn: document.querySelector("#sub2api-invite-refresh-btn"),
  sub2apiInviteCopyBtn: document.querySelector("#sub2api-invite-copy-btn"),
  sub2apiInviteExportBtn: document.querySelector("#sub2api-invite-export-btn"),
  sub2apiInviteList: document.querySelector("#sub2api-invite-list"),
  sub2apiInviteResult: document.querySelector("#sub2api-invite-result"),
  sub2apiPlanForm: document.querySelector("#sub2api-plan-form"),
  sub2apiPlanFormTitle: document.querySelector("#sub2api-plan-form-title"),
  sub2apiPlanEditId: document.querySelector("#sub2api-plan-edit-id"),
  sub2apiPlanConnection: document.querySelector("#sub2api-plan-connection"),
  sub2apiPlanName: document.querySelector("#sub2api-plan-name"),
  sub2apiPlanPrice: document.querySelector("#sub2api-plan-price"),
  sub2apiPlanValidityDays: document.querySelector("#sub2api-plan-validity-days"),
  sub2apiPlanSubscriptionGroupId: document.querySelector("#sub2api-plan-subscription-group-id"),
  sub2apiPlanSourceDedicatedGroupId: document.querySelector("#sub2api-plan-source-dedicated-group-id"),
  sub2apiPlanDedicatedGroupId: document.querySelector("#sub2api-plan-dedicated-group-id"),
  sub2apiPlanSortOrder: document.querySelector("#sub2api-plan-sort-order"),
  sub2apiPlanStatus: document.querySelector("#sub2api-plan-status"),
  sub2apiPlanDescription: document.querySelector("#sub2api-plan-description"),
  sub2apiPlanSubmitBtn: document.querySelector("#sub2api-plan-submit-btn"),
  sub2apiPlanCancelBtn: document.querySelector("#sub2api-plan-cancel-btn"),
  sub2apiPlanRefreshBtn: document.querySelector("#sub2api-plan-refresh-btn"),
  sub2apiPlanResult: document.querySelector("#sub2api-plan-result"),
  sub2apiPlanList: document.querySelector("#sub2api-plan-list"),
  sub2apiOrderConnectionFilter: document.querySelector("#sub2api-order-connection-filter"),
  sub2apiOrderUserFilter: document.querySelector("#sub2api-order-user-filter"),
  sub2apiOrderStatusFilter: document.querySelector("#sub2api-order-status-filter"),
  sub2apiOrderRefreshBtn: document.querySelector("#sub2api-order-refresh-btn"),
  sub2apiOrderList: document.querySelector("#sub2api-order-list"),
  sub2apiOrderResult: document.querySelector("#sub2api-order-result"),

  navItems: document.querySelectorAll(".nav-item"),
  tabPanels: document.querySelectorAll(".tab-panel")
};

let autoRefreshTimer = null;
let updatePollTimer = null;
let currentTab = "dashboard";
const quotaSubCardState = {
  page: 1,
  pageSize: Number(refs.quotaSubCardPageSize?.value || 50),
  status: refs.quotaSubCardStatus?.value || "",
  total: 0
};
let sub2apiConnectionsCache = [];
let sub2apiInvitesCache = [];
let sub2apiPlansCache = [];
let sub2apiOrdersCache = [];

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
    refreshSmsConsole().catch(() => {});
  }
  if (tabName === "quota" && getToken()) {
    refreshQuotaDashboard().catch(() => {});
    refreshQuotaSubCards().catch(() => {});
    refreshQuotaSourceCards().catch(() => {});
    loadQuotaSettings().catch(() => {});
  }
  if (tabName === "sub2api" && getToken()) {
    refreshSub2ApiConsole().catch(() => {});
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

async function refreshSmsSites() {
  const payload = await api("/api/admin/sms/sites");
  const items = payload.items || [];
  if (refs.smsCardSite) {
    refs.smsCardSite.innerHTML = items.length
      ? items.map((item) => `<option value="${item.id}">${escapeHtml(item.name)} (${escapeHtml(item.slug)})</option>`).join("")
      : `<option value="">暂无站点</option>`;
  }
  renderTable(refs.smsSiteList, [
    { label: "站点", render: (item) => `<strong>${escapeHtml(item.name)}</strong><br/><code>${escapeHtml(item.slug)}</code>` },
    { label: "资源来源", render: (item) => `${escapeHtml(item.inventorySource)}${item.smsProvider ? `<br/><code>${escapeHtml(item.smsProvider)} app:${escapeHtml(item.smsAppId || "-")} type:${escapeHtml(item.smsCardType || "-")} expiry:${escapeHtml(item.smsExpiry ?? "-")}</code>` : ""}` },
    { label: "卡密数", render: (item) => item.cardCount },
    { label: "状态", render: (item) => renderStatus(item.status) },
    { label: "备注", render: (item) => escapeHtml(item.note || "-") },
    { label: "操作", render: (item) => `<button class="ghost-btn small" type="button" onclick="configNexSmsSite('${escapeHtml(item.id)}')">配置</button>` }
  ], items, "暂无接码站点");
}

async function configNexSmsSite(id) {
  const apiKey = window.prompt("NexSMS API Key（留空则保留原密钥）：") || "";
  const appId = window.prompt("NexSMS appId：");
  if (!appId) return;
  const cardType = Number(window.prompt("type（1首卡/2重启/3续费）：", "1") || 1);
  const expiry = Number(window.prompt("expiry（0随机，1-6按文档）：", "0") || 0);
  try {
    await api(`/api/admin/sms/sites/${encodeURIComponent(id)}/nexsms`, {
      method: "PATCH",
      body: JSON.stringify({ apiKey: apiKey.trim(), appId: appId.trim(), cardType, expiry })
    });
    setHint(refs.smsSiteResult, "NexSMS 配置已保存");
    await refreshSmsConsole();
  } catch (error) {
    setHint(refs.smsSiteResult, error.message);
  }
}

window.configNexSmsSite = configNexSmsSite;
async function refreshSmsCards() {
  const payload = await api("/api/admin/sms/cards");
  renderTable(refs.smsCardList, [
    { label: "", render: (item) => `<input type="checkbox" class="sms-card-check" value="${item.id}" />` },
    { label: "卡密", render: (item) => `<code>${escapeHtml(item.cardKey)}</code>` },
    { label: "站点", render: (item) => escapeHtml(item.siteName) },
    { label: "前缀", render: (item) => `<code>${escapeHtml(item.prefix)}</code>` },
    { label: "状态", render: (item) => renderStatus(item.status) },
    { label: "当前订单", render: (item) => item.currentOrderId ? `<code>${escapeHtml(item.currentOrderId)}</code>` : "-" },
    { label: "创建时间", render: (item) => `<span style="font-size:12px">${escapeHtml(item.createdAt)}</span>` }
  ], payload.items || [], "暂无接码卡密");
}

async function refreshSmsOrders() {
  const payload = await api("/api/admin/sms/orders");
  renderTable(refs.smsOrderList, [
    { label: "订单号", render: (item) => `<code>${escapeHtml(item.orderNo)}</code>` },
    { label: "卡密", render: (item) => `<code>${escapeHtml(item.cardKey)}</code>` },
    { label: "站点", render: (item) => escapeHtml(item.siteName) },
    { label: "手机号", render: (item) => escapeHtml(item.phone || "-") },
    { label: "验证码", render: (item) => escapeHtml(item.verificationCode || "-") },
    { label: "状态", render: (item) => renderStatus(item.status) },
    { label: "退款时间", render: (item) => escapeHtml(item.refundedAt || "-") }
  ], payload.items || [], "暂无接码订单");
}

async function refreshSmsEntries() {
  const payload = await api("/api/admin/sms/entries");
  renderTable(refs.smsList, [
    { label: "", render: (item) => `<input type="checkbox" class="sms-check" value="${item.id}" data-public-key="${escapeHtml(item.publicKey)}" data-phone="${escapeHtml(item.phone)}" data-sms-url="${escapeHtml(item.smsUrl)}" />` },
    { label: "库存卡密", render: (item) => `<code>${escapeHtml(item.publicKey)}</code>` },
    { label: "手机号", render: (item) => escapeHtml(item.phone) },
    { label: "接码网址", render: (item) => `<a href="${escapeHtml(item.smsUrl)}" target="_blank" style="word-break:break-all">${escapeHtml(item.smsUrl)}</a>` },
    { label: "前缀", render: (item) => `<code>${escapeHtml(item.prefix)}</code>` },
    { label: "批次名称", render: (item) => escapeHtml(item.batchName || "-") },
    { label: "状态", render: (item) => renderStatus(item.status) },
    { label: "创建时间", render: (item) => `<span style="font-size:12px">${escapeHtml(item.createdAt)}</span>` }
  ], payload.items || [], "暂无静态库存记录");
}

async function refreshSmsConsole() {
  await Promise.all([
    refreshSmsSites(),
    refreshSmsCards(),
    refreshSmsOrders(),
    refreshSmsEntries()
  ]);
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
    await api(`/api/admin/notifications/monitors/${id}`, { method: "DELETE", body: JSON.stringify({}) });
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
  } else {
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

  // Bug B fix: when the response carries mergeResult (alias: `merge`), append a
  // "合并后的卡密" section. When it is null/undefined, the DOM above is left
  // byte-identical to the original implementation (preservation 3.9).
  const mergeResult = result.mergeResult ?? result.merge ?? null;
  if (mergeResult == null) return;

  let mergedHtml;
  if (mergeResult.success === true) {
    const newCode = String(mergeResult.newCode ?? "");
    const masked = newCode.length > 8
      ? `${newCode.slice(0, 4)}...${newCode.slice(-4)}`
      : (newCode || "-");
    const mergedCardId = String(mergeResult.mergedCardId ?? "");
    const totalRemaining = mergeResult.totalRemaining ?? 0;
    mergedHtml = `
    <div class="quota-merged-section" style="margin-top:16px;border-top:1px solid var(--border);padding-top:16px;">
      <h4 style="margin:0 0 8px 0;">合并后的卡密</h4>
      <p><span class="table-badge status-active">合并成功</span></p>
      <p>新卡密：<code title="${escapeHtml(newCode)}">${escapeHtml(masked)}</code></p>
      <p>总剩余额度：${escapeHtml(String(totalRemaining))}</p>
      <p>当前额度：<span class="merged-quota">-</span> / 剩余：<span class="merged-remaining">-</span> / 状态：<span class="merged-used">-</span></p>
      <button class="primary-btn small" type="button" data-merged-card-id="${escapeHtml(mergedCardId)}">刷新额度</button>
    </div>
  `;
  } else {
    const errorMsg = mergeResult.error || "未知错误";
    mergedHtml = `
    <div class="quota-merged-section" style="margin-top:16px;border-top:1px solid var(--border);padding-top:16px;">
      <h4 style="margin:0 0 8px 0;">合并后的卡密</h4>
      <p>合并失败：${escapeHtml(errorMsg)}</p>
    </div>
  `;
  }

  refs.quotaImportDetail.insertAdjacentHTML("beforeend", mergedHtml);

  // Wire refresh button click. The handler is introduced by Task 3.4
  // (handleMergedCardRefresh); guard so this renderer remains usable on its own.
  if (mergeResult.success === true && typeof handleMergedCardRefresh === "function") {
    const button = refs.quotaImportDetail.querySelector("[data-merged-card-id]");
    if (button) button.addEventListener("click", handleMergedCardRefresh);
  }
}

// Bug C fix: 通过 admin 后端代理接口刷新合并卡密的最新 quota / remaining / used。
// 浏览器只命中 /api/admin/quota/cards/verify，外部域名由后端代理屏蔽
// (preservation §2 — admin 浏览器代码不得包含外部主机字面量)。
async function handleMergedCardRefresh(event) {
  const button = event.currentTarget;
  if (!button) return;

  const cardId = button.dataset.mergedCardId;
  if (!cardId) return;

  const section = button.closest(".quota-merged-section") || refs.quotaImportDetail;

  // Clean up any previous error message before the new attempt.
  if (section) {
    const existingError = section.querySelector(".merged-refresh-error");
    if (existingError) existingError.remove();
  }

  setButtonBusy(button, true, "刷新中...");
  try {
    const payload = await api("/api/admin/quota/cards/verify", {
      method: "POST",
      body: JSON.stringify({ cardId })
    });

    if (section) {
      const quotaEl = section.querySelector(".merged-quota");
      const remainingEl = section.querySelector(".merged-remaining");
      const usedEl = section.querySelector(".merged-used");
      if (quotaEl) quotaEl.textContent = payload.quota ?? "-";
      if (remainingEl) remainingEl.textContent = payload.remaining ?? "-";
      if (usedEl) usedEl.textContent = payload.used ? "已使用" : "未使用";
    }
  } catch (error) {
    if (section) {
      const errorEl = document.createElement("p");
      errorEl.className = "merged-refresh-error hint";
      errorEl.style.color = "var(--danger, #b00020)";
      errorEl.style.marginTop = "8px";
      errorEl.textContent = `刷新失败：${error.message || "未知错误"}`;
      button.insertAdjacentElement("afterend", errorEl);
    }
  } finally {
    setButtonBusy(button, false);
  }
}

// Expose for inline onclick-style discovery and so renderQuotaImportResults'
// `typeof handleMergedCardRefresh === "function"` guard always succeeds.
window.handleMergedCardRefresh = handleMergedCardRefresh;

// ── Quota Source-Card Manual Merge ──
// 用于补救历史导入未自动合并的情况：列出 active 源卡密，选 >=2 张调用
// /api/admin/quota/cards/merge，复用 renderQuotaImportResults 展示合并结果
// （包含掩码 newCode、totalRemaining、刷新额度按钮）。

function syncQuotaSourceCardsMergeButton() {
  if (!refs.quotaSourceCardList || !refs.quotaSourceCardsMergeBtn) return;
  const checked = refs.quotaSourceCardList.querySelectorAll(
    "input[type=checkbox][data-source-card-id]:checked"
  );
  refs.quotaSourceCardsMergeBtn.disabled = checked.length < 2;
}

async function refreshQuotaSourceCards() {
  if (!refs.quotaSourceCardList) return;
  try {
    const payload = await api("/api/admin/quota/cards?status=active&pageSize=100");
    const items = payload.cards || payload.items || [];
    if (!items.length) {
      refs.quotaSourceCardList.innerHTML = `<p class="hint centered">暂无 active 源卡密</p>`;
    } else {
      renderTable(refs.quotaSourceCardList, [
        { label: "", render: (item) => `<input type="checkbox" class="quota-source-card-check" value="${escapeHtml(item.id)}" />` },
        { label: "API Key", render: (item) => `<code>${escapeHtml(item.sourceKey || item.id)}</code>` },
        { label: "总余额", render: (item) => item.quota ?? 0 },
        { label: "剩余额度", render: (item) => item.remaining ?? 0 },
        {
          label: "保存时间",
          render: (item) => `<span style="font-size:12px">${escapeHtml(item.createdAt || "-")}</span>`,
        },
        { label: "状态", render: (item) => renderStatus(item.status) },
        {
          label: "操作",
          render: (item) => `<button class="ghost-btn small" type="button" onclick="editQuotaSourceCard('${escapeHtml(item.id)}')">修改</button> <button class="ghost-btn small" type="button" onclick="deleteQuotaSourceCard('${escapeHtml(item.id)}')">删除</button>`,
        },
      ], items, "暂无 active API 密钥");
    }
  } catch (error) {
    refs.quotaSourceCardList.innerHTML = `<p class="hint centered">加载失败：${escapeHtml(error.message)}</p>`;
  }
  syncQuotaSourceCardsMergeButton();
}

async function handleQuotaSourceCardsMerge() {
  if (!refs.quotaSourceCardList || !refs.quotaSourceCardsMergeBtn) return;
  const cardIds = Array.from(
    refs.quotaSourceCardList.querySelectorAll("input[type=checkbox][data-source-card-id]:checked")
  ).map((cb) => cb.dataset.sourceCardId);
  if (cardIds.length < 2) {
    setHint(refs.quotaSourceCardsMergeResult, "至少选择 2 张卡密");
    return;
  }
  if (!window.confirm(`确认合并 ${cardIds.length} 张 active 卡密？原卡密会被标记为 used，新建一张合并卡密。`)) {
    return;
  }
  setButtonBusy(refs.quotaSourceCardsMergeBtn, true, "合并中...");
  setHint(refs.quotaSourceCardsMergeResult, "");
  try {
    const payload = await api("/api/admin/quota/cards/merge", {
      method: "POST",
      body: JSON.stringify({ cardIds }),
    });
    // 复用导入流程的渲染（自带掩码 newCode / totalRemaining / 刷新额度按钮），
    // payload 形如 { success, mergedCardId, newCode, totalRemaining }，
    // 包装为 renderQuotaImportResults 期望的 { mergeResult, ... } 形状。
    renderQuotaImportResults({
      successCount: cardIds.length,
      failedCount: 0,
      failures: [],
      mergeResult: payload,
    });
    setHint(refs.quotaSourceCardsMergeResult, "合并成功");
    await refreshQuotaSourceCards();
    await refreshQuotaDashboard();
  } catch (error) {
    setHint(refs.quotaSourceCardsMergeResult, `合并失败：${error.message}`);
  } finally {
    setButtonBusy(refs.quotaSourceCardsMergeBtn, false);
  }
}

// ── Quota Sub-Card Management ──

function getSelectedQuotaSourceCardIds() {
  return getCheckedValues(".quota-source-card-check");
}

function downloadTextFile(filename, text) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function exportQuotaSourceCards(exportAll = false) {
  const ids = exportAll ? [] : getSelectedQuotaSourceCardIds();
  if (!exportAll && !ids.length) {
    setHint(refs.quotaSourceCardsMergeResult, "请先选择要导出的 API 密钥");
    return;
  }
  try {
    const payload = await api("/api/admin/quota/cards/export", {
      method: "POST",
      body: JSON.stringify(exportAll ? { all: true } : { ids })
    });
    const keys = (payload.items || []).map((item) => item.apiKey).filter(Boolean);
    downloadTextFile(`quota-api-keys-${new Date().toISOString().slice(0, 10)}.txt`, keys.join("\n"));
    setHint(refs.quotaSourceCardsMergeResult, `已导出 ${keys.length} 个 API 密钥`);
  } catch (error) {
    setHint(refs.quotaSourceCardsMergeResult, `导出失败：${error.message}`);
  }
}

async function editQuotaSourceCard(id) {
  const apiKey = window.prompt("请输入新的 API 密钥：");
  if (apiKey === null) return;
  const trimmed = apiKey.trim();
  if (!trimmed) {
    setHint(refs.quotaSourceCardsMergeResult, "API 密钥不能为空");
    return;
  }
  try {
    await api(`/api/admin/quota/cards/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ apiKey: trimmed })
    });
    setHint(refs.quotaSourceCardsMergeResult, "API 密钥已修改");
    await refreshQuotaSourceCards();
    await refreshQuotaDashboard();
  } catch (error) {
    setHint(refs.quotaSourceCardsMergeResult, `修改失败：${error.message}`);
  }
}

async function deleteQuotaSourceCard(id) {
  if (!window.confirm("确认删除这个 API 密钥？删除后将不再作为提号源。")) return;
  try {
    await api(`/api/admin/quota/cards/${encodeURIComponent(id)}`, { method: "DELETE", body: JSON.stringify({}) });
    setHint(refs.quotaSourceCardsMergeResult, "API 密钥已删除");
    await refreshQuotaSourceCards();
    await refreshQuotaDashboard();
  } catch (error) {
    setHint(refs.quotaSourceCardsMergeResult, `删除失败：${error.message}`);
  }
}

window.editQuotaSourceCard = editQuotaSourceCard;
window.deleteQuotaSourceCard = deleteQuotaSourceCard;

function renderQuotaSubCardPagination() {
  if (!refs.quotaSubCardPagination) return;
  const total = quotaSubCardState.total;
  const pageSize = Math.max(1, quotaSubCardState.pageSize);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, quotaSubCardState.page), totalPages);
  const start = total ? (page - 1) * pageSize + 1 : 0;
  const end = Math.min(total, page * pageSize);

  refs.quotaSubCardPagination.innerHTML = `
    <div class="pagination-summary">显示 ${start}-${end} / ${total} 张子卡密</div>
    <div class="pagination-actions">
      <button class="ghost-btn small" type="button" data-quota-sub-page="1" ${page <= 1 ? "disabled" : ""}>首页</button>
      <button class="ghost-btn small" type="button" data-quota-sub-page="${page - 1}" ${page <= 1 ? "disabled" : ""}>上一页</button>
      <span class="pagination-page">第 ${page} / ${totalPages} 页</span>
      <button class="ghost-btn small" type="button" data-quota-sub-page="${page + 1}" ${page >= totalPages ? "disabled" : ""}>下一页</button>
      <button class="ghost-btn small" type="button" data-quota-sub-page="${totalPages}" ${page >= totalPages ? "disabled" : ""}>末页</button>
    </div>
  `;
}

async function refreshQuotaSubCards(page = quotaSubCardState.page) {
  if (!refs.quotaSubCardList) return;
  try {
    quotaSubCardState.page = Math.max(1, Math.floor(Number(page) || 1));
    const params = new URLSearchParams({
      page: String(quotaSubCardState.page),
      pageSize: String(quotaSubCardState.pageSize)
    });
    if (quotaSubCardState.status) {
      params.set("status", quotaSubCardState.status);
    }

    const payload = await api(`/api/admin/quota/sub-cards?${params.toString()}`);
    const items = payload.subCards || [];
    const total = Number(payload.total ?? items.length);
    const responsePageSize = Number(payload.pageSize ?? quotaSubCardState.pageSize);
    const responsePage = Number(payload.page ?? quotaSubCardState.page);
    const totalPages = Math.max(1, Math.ceil(total / Math.max(1, responsePageSize)));
    const normalizedPage = Math.min(Math.max(1, responsePage), totalPages);

    quotaSubCardState.total = total;
    quotaSubCardState.pageSize = responsePageSize;
    quotaSubCardState.page = normalizedPage;

    if (total > 0 && responsePage !== normalizedPage) {
      await refreshQuotaSubCards(normalizedPage);
      return;
    }

    renderTable(refs.quotaSubCardList, [
      { label: "", render: (item) => `<input type="checkbox" class="quota-sub-check" value="${escapeHtml(item.id)}" data-code="${escapeHtml(item.cardCode)}" data-total="${item.totalQuota ?? 0}" data-used="${item.usedQuota ?? 0}" data-status="${escapeHtml(item.status)}" />` },
      { label: "编码", render: (item) => `<code>${escapeHtml(item.cardCode)}</code>` },
      { label: "总额度", render: (item) => item.totalQuota ?? 0 },
      { label: "已用额度", render: (item) => item.usedQuota ?? 0 },
      { label: "剩余", render: (item) => {
        const total = item.totalQuota ?? 0;
        const used = item.usedQuota ?? 0;
        return total - used;
      }},
      { label: "状态", render: (item) => renderStatus(item.status) },
      { label: "操作", render: (item) => `
        <button class="primary-btn small" type="button" onclick="viewQuotaSubCardDetail('${escapeHtml(item.id)}')">详情</button>
        ${item.status === "active" ? `<button class="ghost-btn small" style="padding:6px 12px;font-size:12px;color:var(--error)" type="button" onclick="cancelQuotaSubCard('${escapeHtml(item.id)}')">取消</button>` : ""}
        ${item.status === "locked" ? `<button class="ghost-btn small" style="padding:6px 12px;font-size:12px" type="button" onclick="unlockQuotaSubCard('${escapeHtml(item.id)}')">恢复</button>` : ""}
      ` }
    ], items, "暂无子卡密");
    renderQuotaSubCardPagination();
  } catch (error) {
    refs.quotaSubCardList.innerHTML = `<p class="hint centered">加载失败：${escapeHtml(error.message)}</p>`;
    if (refs.quotaSubCardPagination) refs.quotaSubCardPagination.innerHTML = "";
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
      { label: "账号数量", render: (item) => item.account_count ?? item.accountCount ?? 0 },
      { label: "提取内容", render: (item) => {
        const accounts = item.accounts || [];
        if (!accounts.length) return `<span style="color:var(--muted)">-</span>`;
        return `<code style="font-size:11px;word-break:break-all;white-space:pre-wrap">${escapeHtml(accounts.join("\n"))}</code>`;
      }}
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

async function unlockQuotaSubCard(id) {
  if (!window.confirm("确认恢复该 locked 子卡密为 active？")) return;
  try {
    await api(`/api/admin/quota/sub-cards/${id}/unlock`, { method: "POST", body: JSON.stringify({}) });
    setHint(refs.quotaSubCardResult, "子卡密已恢复为 active");
    await refreshQuotaSubCards();
  } catch (error) {
    setHint(refs.quotaSubCardResult, `恢复失败：${error.message}`);
  }
}

window.viewQuotaSubCardDetail = viewQuotaSubCardDetail;
window.cancelQuotaSubCard = cancelQuotaSubCard;
window.unlockQuotaSubCard = unlockQuotaSubCard;

function resetSub2ApiConnectionForm() {
  if (!refs.sub2apiConnectionForm) return;
  refs.sub2apiConnectionForm.reset();
  refs.sub2apiConnectionEditId.value = "";
  refs.sub2apiConnectionStatus.value = "active";
  refs.sub2apiConnectionFormTitle.textContent = "添加远程连接";
  refs.sub2apiConnectionSubmitBtn.textContent = "保存连接";
  refs.sub2apiConnectionCancelBtn.classList.add("hidden");
  refs.sub2apiConnectionAdminToken.placeholder = "创建时必填；编辑时留空则保持不变";
}

function populateSub2ApiConnectionFilter() {
  if (!refs.sub2apiInviteConnectionFilter) return;
  const current = refs.sub2apiInviteConnectionFilter.value;
  refs.sub2apiInviteConnectionFilter.innerHTML = [`<option value="">全部连接</option>`]
    .concat(sub2apiConnectionsCache.map((item) => `
      <option value="${escapeHtml(item.id)}">${escapeHtml(item.name)} (${escapeHtml(item.status)})</option>
    `))
    .join("");
  if (sub2apiConnectionsCache.some((item) => item.id === current)) {
    refs.sub2apiInviteConnectionFilter.value = current;
  }

  if (refs.sub2apiOrderConnectionFilter) {
    const currentOrder = refs.sub2apiOrderConnectionFilter.value;
    refs.sub2apiOrderConnectionFilter.innerHTML = [`<option value="">全部连接</option>`]
      .concat(sub2apiConnectionsCache.map((item) => `
        <option value="${escapeHtml(item.id)}">${escapeHtml(item.name)} (${escapeHtml(item.status)})</option>
      `))
      .join("");
    if (sub2apiConnectionsCache.some((item) => item.id === currentOrder)) {
      refs.sub2apiOrderConnectionFilter.value = currentOrder;
    }
  }

  if (refs.sub2apiPlanConnection) {
    const currentPlan = refs.sub2apiPlanConnection.value;
    refs.sub2apiPlanConnection.innerHTML = [`<option value="">选择连接</option>`]
      .concat(sub2apiConnectionsCache.map((item) => `
        <option value="${escapeHtml(item.id)}">${escapeHtml(item.name)} (${escapeHtml(item.status)})</option>
      `))
      .join("");
    if (sub2apiConnectionsCache.some((item) => item.id === currentPlan)) {
      refs.sub2apiPlanConnection.value = currentPlan;
    } else if (!refs.sub2apiPlanConnection.value && sub2apiConnectionsCache.length) {
      refs.sub2apiPlanConnection.value = sub2apiConnectionsCache[0].id;
    }
  }
}

async function refreshSub2ApiConnections() {
  if (!refs.sub2apiConnectionList) return;
  const payload = await api("/api/admin/sub2api/connections");
  sub2apiConnectionsCache = payload.items || [];
  populateSub2ApiConnectionFilter();

  renderTable(refs.sub2apiConnectionList, [
    {
      label: "连接",
      render: (item) => `<strong>${escapeHtml(item.name)}</strong><br/><code>${escapeHtml(item.id)}</code>`
    },
    {
      label: "Base URL",
      render: (item) => `<code style="font-size:12px;word-break:break-all">${escapeHtml(item.baseUrl)}</code>`
    },
    {
      label: "Admin Token",
      render: (item) => item.hasAdminToken ? "已保存" : "未配置"
    },
    {
      label: "状态",
      render: (item) => renderStatus(item.status)
    },
    {
      label: "最近测试",
      render: (item) => `
        <div style="font-size:12px;line-height:1.5">
          <div>${escapeHtml(item.lastTestAt || "未测试")}</div>
          <div style="color:${item.lastTestStatus === "failed" ? "var(--error)" : "var(--muted)"}">${escapeHtml(item.lastTestStatus || "-")}${item.lastTestError ? ` · ${escapeHtml(item.lastTestError)}` : ""}</div>
        </div>
      `
    },
    {
      label: "操作",
      render: (item) => `
        <button class="primary-btn small" type="button" onclick="editSub2ApiConnection('${escapeHtml(item.id)}')">编辑</button>
        <button class="ghost-btn small" type="button" onclick="testSub2ApiConnection('${escapeHtml(item.id)}')">测试</button>
        <button class="ghost-btn small" type="button" style="color:var(--error)" onclick="deleteSub2ApiConnection('${escapeHtml(item.id)}')">删除</button>
      `
    }
  ], sub2apiConnectionsCache, "暂无 Sub2api 连接");
}

function editSub2ApiConnection(id) {
  const item = sub2apiConnectionsCache.find((entry) => entry.id === id);
  if (!item || !refs.sub2apiConnectionForm) return;
  refs.sub2apiConnectionEditId.value = item.id;
  refs.sub2apiConnectionName.value = item.name || "";
  refs.sub2apiConnectionBaseUrl.value = item.baseUrl || "";
  refs.sub2apiConnectionAdminToken.value = "";
  refs.sub2apiConnectionAdminToken.placeholder = "留空则保持原 Admin Token";
  refs.sub2apiConnectionStatus.value = item.status || "active";
  refs.sub2apiConnectionFormTitle.textContent = `编辑连接：${item.name}`;
  refs.sub2apiConnectionSubmitBtn.textContent = "保存修改";
  refs.sub2apiConnectionCancelBtn.classList.remove("hidden");
  refs.sub2apiConnectionForm.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function testSub2ApiConnection(id) {
  try {
    setHint(refs.sub2apiConnectionResult, "正在测试连接...");
    await api(`/api/admin/sub2api/connections/${encodeURIComponent(id)}/test`, {
      method: "POST",
      body: JSON.stringify({})
    });
    setHint(refs.sub2apiConnectionResult, "测试成功");
    await refreshSub2ApiConnections();
  } catch (error) {
    setHint(refs.sub2apiConnectionResult, `测试失败：${error.message}`);
    await refreshSub2ApiConnections().catch(() => {});
  }
}

async function deleteSub2ApiConnection(id) {
  if (!window.confirm("确认删除该 Sub2api 连接？历史邀请码记录会保留。")) return;
  try {
    await api(`/api/admin/sub2api/connections/${encodeURIComponent(id)}`, {
      method: "DELETE",
      body: JSON.stringify({})
    });
    if (refs.sub2apiConnectionEditId?.value === id) resetSub2ApiConnectionForm();
    setHint(refs.sub2apiConnectionResult, "连接已删除");
    await refreshSub2ApiConsole();
  } catch (error) {
    setHint(refs.sub2apiConnectionResult, `删除失败：${error.message}`);
  }
}

async function saveSub2ApiConnection() {
  const id = refs.sub2apiConnectionEditId?.value || "";
  const payload = {
    name: refs.sub2apiConnectionName.value.trim(),
    baseUrl: refs.sub2apiConnectionBaseUrl.value.trim(),
    status: refs.sub2apiConnectionStatus.value
  };
  const adminToken = refs.sub2apiConnectionAdminToken.value.trim();
  if (adminToken) payload.adminToken = adminToken;
  if (!id && !adminToken) {
    setHint(refs.sub2apiConnectionResult, "新建连接必须填写 Admin Token");
    return;
  }

  try {
    setHint(refs.sub2apiConnectionResult, "正在保存...");
    await api(id ? `/api/admin/sub2api/connections/${encodeURIComponent(id)}` : "/api/admin/sub2api/connections", {
      method: id ? "PATCH" : "POST",
      body: JSON.stringify(payload)
    });
    setHint(refs.sub2apiConnectionResult, "连接已保存");
    resetSub2ApiConnectionForm();
    await refreshSub2ApiConsole();
  } catch (error) {
    setHint(refs.sub2apiConnectionResult, `保存失败：${error.message}`);
  }
}

function getSelectedSub2ApiInviteCodes() {
  const checked = Array.from(document.querySelectorAll(".sub2api-invite-check:checked"));
  const source = checked.length
    ? checked
    : Array.from(document.querySelectorAll(".sub2api-invite-check"));
  return source
    .map((item) => item.dataset.inviteCode || "")
    .filter(Boolean);
}

async function refreshSub2ApiInvites() {
  if (!refs.sub2apiInviteList) return;
  const params = new URLSearchParams();
  if (refs.sub2apiInviteConnectionFilter?.value) params.set("connectionId", refs.sub2apiInviteConnectionFilter.value);
  if (refs.sub2apiInviteUserFilter?.value.trim()) params.set("userId", refs.sub2apiInviteUserFilter.value.trim());
  if (refs.sub2apiInviteStatusFilter?.value) params.set("status", refs.sub2apiInviteStatusFilter.value);
  params.set("pageSize", "100");

  const payload = await api(`/api/admin/sub2api/invites?${params.toString()}`);
  sub2apiInvitesCache = payload.items || [];
  renderTable(refs.sub2apiInviteList, [
    {
      label: "",
      render: (item) => `<input type="checkbox" class="sub2api-invite-check" value="${escapeHtml(item.id)}" data-invite-code="${escapeHtml(item.inviteCode || "")}" />`
    },
    {
      label: "邀请码",
      render: (item) => item.inviteCode ? `<code>${escapeHtml(item.inviteCode)}</code>` : "-"
    },
    {
      label: "连接",
      render: (item) => `${escapeHtml(item.connectionName || "-")}<br/><code style="font-size:11px">${escapeHtml(item.connectionId)}</code>`
    },
    {
      label: "账号",
      render: (item) => `
        <div style="font-size:12px;line-height:1.5">
          <div><code>${escapeHtml(item.userId)}</code></div>
          <div>${escapeHtml(item.email || item.username || "-")}</div>
        </div>
      `
    },
    {
      label: "状态",
      render: (item) => renderStatus(item.status)
    },
    {
      label: "远端 ID",
      render: (item) => item.remoteInviteId ? `<code>${escapeHtml(item.remoteInviteId)}</code>` : "-"
    },
    {
      label: "时间",
      render: (item) => `<span style="font-size:12px">${escapeHtml(item.createdAt || "-")}</span>`
    },
    {
      label: "错误",
      render: (item) => item.errorMessage ? `<span style="color:var(--error)" title="${escapeHtml(item.errorMessage)}">${escapeHtml(item.errorMessage.slice(0, 36))}</span>` : "-"
    }
  ], sub2apiInvitesCache, "暂无邀请码记录");
  setHint(refs.sub2apiInviteResult, `共 ${payload.total ?? sub2apiInvitesCache.length} 条记录，当前显示 ${sub2apiInvitesCache.length} 条`);
}

function resetSub2ApiPlanForm() {
  if (!refs.sub2apiPlanForm) return;
  refs.sub2apiPlanForm.reset();
  refs.sub2apiPlanEditId.value = "";
  refs.sub2apiPlanValidityDays.value = "30";
  refs.sub2apiPlanSortOrder.value = "0";
  refs.sub2apiPlanStatus.value = "active";
  refs.sub2apiPlanFormTitle.textContent = "添加订阅套餐";
  refs.sub2apiPlanSubmitBtn.textContent = "保存套餐";
  refs.sub2apiPlanCancelBtn.classList.add("hidden");
  populateSub2ApiConnectionFilter();
}

async function refreshSub2ApiPlans() {
  if (!refs.sub2apiPlanList) return;
  const payload = await api("/api/admin/sub2api/subscription-plans");
  sub2apiPlansCache = payload.items || [];
  renderTable(refs.sub2apiPlanList, [
    {
      label: "套餐",
      render: (item) => `<strong>${escapeHtml(item.name)}</strong><br/><span class="hint">${escapeHtml(item.description || "-")}</span>`
    },
    {
      label: "连接",
      render: (item) => `${escapeHtml(item.connectionName || "-")}<br/><code style="font-size:11px">${escapeHtml(item.connectionId)}</code>`
    },
    {
      label: "金额/天数",
      render: (item) => `<strong>${Number(item.price).toFixed(4)}</strong><br/><span class="hint">${escapeHtml(item.validityDays)} 天</span>`
    },
    {
      label: "分组",
      render: (item) => `
        <div style="font-size:12px;line-height:1.5">
          <div>订阅：<code>${escapeHtml(item.subscriptionGroupId)}</code></div>
          <div>原专属：${item.sourceDedicatedGroupId ? `<code>${escapeHtml(item.sourceDedicatedGroupId)}</code>` : "-"}</div>
          <div>新专属：${item.dedicatedGroupId ? `<code>${escapeHtml(item.dedicatedGroupId)}</code>` : "-"}</div>
        </div>
      `
    },
    {
      label: "状态",
      render: (item) => `${renderStatus(item.status)}<br/><span class="hint">排序 ${escapeHtml(item.sortOrder)}</span>`
    },
    {
      label: "操作",
      render: (item) => `
        <button class="primary-btn small" type="button" onclick="editSub2ApiPlan('${escapeHtml(item.id)}')">编辑</button>
        <button class="ghost-btn small" type="button" style="color:var(--error)" onclick="deleteSub2ApiPlan('${escapeHtml(item.id)}')">删除</button>
      `
    }
  ], sub2apiPlansCache, "暂无订阅套餐");
}

function editSub2ApiPlan(id) {
  const item = sub2apiPlansCache.find((entry) => entry.id === id);
  if (!item || !refs.sub2apiPlanForm) return;
  refs.sub2apiPlanEditId.value = item.id;
  refs.sub2apiPlanConnection.value = item.connectionId || "";
  refs.sub2apiPlanName.value = item.name || "";
  refs.sub2apiPlanPrice.value = item.price || "";
  refs.sub2apiPlanValidityDays.value = item.validityDays || 30;
  refs.sub2apiPlanSubscriptionGroupId.value = item.subscriptionGroupId || "";
  refs.sub2apiPlanSourceDedicatedGroupId.value = item.sourceDedicatedGroupId || "";
  refs.sub2apiPlanDedicatedGroupId.value = item.dedicatedGroupId || "";
  refs.sub2apiPlanSortOrder.value = item.sortOrder || 0;
  refs.sub2apiPlanStatus.value = item.status || "active";
  refs.sub2apiPlanDescription.value = item.description || "";
  refs.sub2apiPlanFormTitle.textContent = `编辑套餐：${item.name}`;
  refs.sub2apiPlanSubmitBtn.textContent = "保存修改";
  refs.sub2apiPlanCancelBtn.classList.remove("hidden");
  refs.sub2apiPlanForm.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function saveSub2ApiPlan() {
  const id = refs.sub2apiPlanEditId?.value || "";
  const payload = {
    connectionId: refs.sub2apiPlanConnection.value,
    name: refs.sub2apiPlanName.value.trim(),
    description: refs.sub2apiPlanDescription.value.trim(),
    price: Number(refs.sub2apiPlanPrice.value),
    validityDays: Number(refs.sub2apiPlanValidityDays.value),
    subscriptionGroupId: Number(refs.sub2apiPlanSubscriptionGroupId.value),
    sourceDedicatedGroupId: refs.sub2apiPlanSourceDedicatedGroupId.value ? Number(refs.sub2apiPlanSourceDedicatedGroupId.value) : null,
    dedicatedGroupId: refs.sub2apiPlanDedicatedGroupId.value ? Number(refs.sub2apiPlanDedicatedGroupId.value) : null,
    sortOrder: Number(refs.sub2apiPlanSortOrder.value || 0),
    status: refs.sub2apiPlanStatus.value
  };
  try {
    setHint(refs.sub2apiPlanResult, "正在保存...");
    await api(id ? `/api/admin/sub2api/subscription-plans/${encodeURIComponent(id)}` : "/api/admin/sub2api/subscription-plans", {
      method: id ? "PATCH" : "POST",
      body: JSON.stringify(payload)
    });
    setHint(refs.sub2apiPlanResult, "套餐已保存");
    resetSub2ApiPlanForm();
    await refreshSub2ApiPlans();
  } catch (error) {
    setHint(refs.sub2apiPlanResult, `保存失败：${error.message}`);
  }
}

async function deleteSub2ApiPlan(id) {
  if (!window.confirm("确认删除该订阅套餐？历史订单会保留。")) return;
  try {
    await api(`/api/admin/sub2api/subscription-plans/${encodeURIComponent(id)}`, {
      method: "DELETE",
      body: JSON.stringify({})
    });
    if (refs.sub2apiPlanEditId?.value === id) resetSub2ApiPlanForm();
    setHint(refs.sub2apiPlanResult, "套餐已删除");
    await refreshSub2ApiPlans();
  } catch (error) {
    setHint(refs.sub2apiPlanResult, `删除失败：${error.message}`);
  }
}

async function refreshSub2ApiOrders() {
  if (!refs.sub2apiOrderList) return;
  const params = new URLSearchParams();
  if (refs.sub2apiOrderConnectionFilter?.value) params.set("connectionId", refs.sub2apiOrderConnectionFilter.value);
  if (refs.sub2apiOrderUserFilter?.value.trim()) params.set("userId", refs.sub2apiOrderUserFilter.value.trim());
  if (refs.sub2apiOrderStatusFilter?.value) params.set("status", refs.sub2apiOrderStatusFilter.value);
  params.set("pageSize", "100");
  const payload = await api(`/api/admin/sub2api/subscription-orders?${params.toString()}`);
  sub2apiOrdersCache = payload.items || [];
  renderTable(refs.sub2apiOrderList, [
    {
      label: "订单",
      render: (item) => `<code>${escapeHtml(item.id)}</code><br/><span class="hint">${escapeHtml(item.planName || item.planId)}</span>`
    },
    {
      label: "用户",
      render: (item) => `<code>${escapeHtml(item.userId)}</code><br/><span class="hint">${escapeHtml(item.email || item.username || "-")}</span>`
    },
    {
      label: "金额/天数",
      render: (item) => `<strong>${Number(item.price).toFixed(4)}</strong><br/><span class="hint">${escapeHtml(item.validityDays)} 天</span>`
    },
    {
      label: "分组",
      render: (item) => `订阅 <code>${escapeHtml(item.subscriptionGroupId)}</code><br/>原专属 ${item.sourceDedicatedGroupId ? `<code>${escapeHtml(item.sourceDedicatedGroupId)}</code>` : "-"}<br/>新专属 ${item.dedicatedGroupId ? `<code>${escapeHtml(item.dedicatedGroupId)}</code>` : "-"}`
    },
    {
      label: "状态",
      render: (item) => renderStatus(item.status)
    },
    {
      label: "时间",
      render: (item) => `<span style="font-size:12px">${escapeHtml(item.createdAt || "-")}</span>`
    },
    {
      label: "错误",
      render: (item) => item.errorMessage ? `<span style="color:var(--error)" title="${escapeHtml(item.errorMessage)}">${escapeHtml(item.errorMessage.slice(0, 42))}</span>` : "-"
    }
  ], sub2apiOrdersCache, "暂无订阅订单");
  setHint(refs.sub2apiOrderResult, `共 ${payload.total ?? sub2apiOrdersCache.length} 条记录，当前显示 ${sub2apiOrdersCache.length} 条`);
}

async function refreshSub2ApiConsole() {
  await refreshSub2ApiConnections().catch((error) => {
    if (refs.sub2apiConnectionList) refs.sub2apiConnectionList.innerHTML = `<p class="hint centered">加载连接失败：${escapeHtml(error.message)}</p>`;
  });
  await refreshSub2ApiPlans().catch((error) => {
    if (refs.sub2apiPlanList) refs.sub2apiPlanList.innerHTML = `<p class="hint centered">加载订阅套餐失败：${escapeHtml(error.message)}</p>`;
  });
  await refreshSub2ApiOrders().catch((error) => {
    if (refs.sub2apiOrderList) refs.sub2apiOrderList.innerHTML = `<p class="hint centered">加载订阅订单失败：${escapeHtml(error.message)}</p>`;
  });
  await refreshSub2ApiInvites().catch((error) => {
    if (refs.sub2apiInviteList) refs.sub2apiInviteList.innerHTML = `<p class="hint centered">加载邀请码失败：${escapeHtml(error.message)}</p>`;
  });
}

function exportSub2ApiInvitesCsv() {
  if (!sub2apiInvitesCache.length) {
    setHint(refs.sub2apiInviteResult, "无数据可导出");
    return;
  }
  const headers = ["连接", "连接ID", "用户ID", "邮箱", "用户名", "邀请码", "远端ID", "状态", "创建时间", "过期时间", "错误"];
  const escapeCsv = (value) => `"${String(value ?? "").replaceAll("\"", "\"\"")}"`;
  const lines = [
    headers.map(escapeCsv).join(","),
    ...sub2apiInvitesCache.map((item) => [
      item.connectionName,
      item.connectionId,
      item.userId,
      item.email,
      item.username,
      item.inviteCode,
      item.remoteInviteId,
      item.status,
      item.createdAt,
      item.expiresAt,
      item.errorMessage
    ].map(escapeCsv).join(","))
  ];
  const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `sub2api-invites-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
  setHint(refs.sub2apiInviteResult, `已导出 ${sub2apiInvitesCache.length} 条记录`);
}

window.editSub2ApiConnection = editSub2ApiConnection;
window.testSub2ApiConnection = testSub2ApiConnection;
window.deleteSub2ApiConnection = deleteSub2ApiConnection;
window.editSub2ApiPlan = editSub2ApiPlan;
window.deleteSub2ApiPlan = deleteSub2ApiPlan;

if (refs.sub2apiConnectionForm) {
  refs.sub2apiConnectionForm.addEventListener("submit", (event) => {
    event.preventDefault();
    saveSub2ApiConnection().catch(() => {});
  });
}

if (refs.sub2apiConnectionCancelBtn) {
  refs.sub2apiConnectionCancelBtn.addEventListener("click", () => {
    resetSub2ApiConnectionForm();
    setHint(refs.sub2apiConnectionResult, "");
  });
}

if (refs.sub2apiConnectionRefreshBtn) {
  refs.sub2apiConnectionRefreshBtn.addEventListener("click", () => {
    refreshSub2ApiConsole().catch(() => {});
  });
}

if (refs.sub2apiInviteRefreshBtn) {
  refs.sub2apiInviteRefreshBtn.addEventListener("click", () => {
    refreshSub2ApiInvites().catch((error) => setHint(refs.sub2apiInviteResult, `查询失败：${error.message}`));
  });
}

if (refs.sub2apiInviteCopyBtn) {
  refs.sub2apiInviteCopyBtn.addEventListener("click", async () => {
    const codes = getSelectedSub2ApiInviteCodes();
    if (!codes.length) {
      setHint(refs.sub2apiInviteResult, "暂无可复制的邀请码");
      return;
    }
    try {
      await navigator.clipboard.writeText(codes.join("\n"));
      setHint(refs.sub2apiInviteResult, `已复制 ${codes.length} 个邀请码`);
    } catch {
      setHint(refs.sub2apiInviteResult, "复制失败：剪贴板写入被拒绝");
    }
  });
}

if (refs.sub2apiInviteExportBtn) {
  refs.sub2apiInviteExportBtn.addEventListener("click", exportSub2ApiInvitesCsv);
}

if (refs.sub2apiPlanForm) {
  refs.sub2apiPlanForm.addEventListener("submit", (event) => {
    event.preventDefault();
    saveSub2ApiPlan().catch(() => {});
  });
}

if (refs.sub2apiPlanCancelBtn) {
  refs.sub2apiPlanCancelBtn.addEventListener("click", () => {
    resetSub2ApiPlanForm();
    setHint(refs.sub2apiPlanResult, "");
  });
}

if (refs.sub2apiPlanRefreshBtn) {
  refs.sub2apiPlanRefreshBtn.addEventListener("click", () => {
    refreshSub2ApiPlans().catch((error) => setHint(refs.sub2apiPlanResult, `刷新失败：${error.message}`));
  });
}

if (refs.sub2apiOrderRefreshBtn) {
  refs.sub2apiOrderRefreshBtn.addEventListener("click", () => {
    refreshSub2ApiOrders().catch((error) => setHint(refs.sub2apiOrderResult, `查询失败：${error.message}`));
  });
}

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
    refreshQuotaSubCards(),
    refreshSub2ApiConsole()
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

refs.smsSiteForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await api("/api/admin/sms/sites", {
      method: "POST",
      body: JSON.stringify({
        name: refs.smsSiteName.value.trim(),
        slug: refs.smsSiteSlug.value.trim(),
        inventorySource: refs.smsSiteInventorySource.value,
        apiKey: refs.smsSiteApiKey.value.trim(),
        appId: refs.smsSiteAppId.value.trim(),
        cardType: Number(refs.smsSiteCardType.value || 1),
        expiry: Number(refs.smsSiteExpiry.value || 0),
        note: refs.smsSiteNote.value.trim()
      })
    });
    refs.smsSiteForm.reset();
    setHint(refs.smsSiteResult, "接码站点已创建");
    await refreshSmsConsole();
  } catch (error) {
    setHint(refs.smsSiteResult, error.message);
  }
});

refs.smsCardForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const payload = await api("/api/admin/sms/cards", {
      method: "POST",
      body: JSON.stringify({
        siteId: refs.smsCardSite.value,
        prefix: refs.smsCardPrefix.value.trim(),
        count: Number(refs.smsCardCount.value || 1),
        note: refs.smsCardNote.value.trim()
      })
    });
    refs.smsCardForm.reset();
    setHint(refs.smsCardResult, `已生成 ${payload.cards.length} 张接码卡密`);
    await refreshSmsConsole();
  } catch (error) {
    setHint(refs.smsCardResult, error.message);
  }
});

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
    setHint(refs.smsBatchResult, `成功导入 ${payload.importedCount} 条静态库存记录`);
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
    setHint(refs.smsSingleResult, `已添加库存卡密: ${payload.publicKey}`);
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

async function updateSmsCardStatus() {
  const ids = Array.from(document.querySelectorAll(".sms-card-check"))
    .filter((cb) => cb.checked)
    .map((cb) => cb.value);
  if (!ids.length) {
    setHint(refs.smsCardResult, "请先选择接码卡密");
    return;
  }
  try {
    const payload = await api("/api/admin/sms/cards/status", {
      method: "PATCH",
      body: JSON.stringify({ ids, status: refs.smsCardAction.value })
    });
    setHint(refs.smsCardResult, `已更新 ${payload.updatedCount} 张接码卡密`);
    await refreshSmsCards();
  } catch (error) {
    setHint(refs.smsCardResult, error.message);
  }
}

refs.smsActionBtn.addEventListener("click", () => {
  updateSmsStatus();
});

refs.smsCardActionBtn?.addEventListener("click", () => {
  updateSmsCardStatus();
});

// ── Quota Import Form ──
if (refs.quotaApiKeyForm) {
  refs.quotaApiKeyForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const apiKey = refs.quotaApiKeyInput?.value.trim() || "";
    if (!apiKey) {
      setHint(refs.quotaApiKeyResult, "请输入 API 密钥");
      return;
    }
    try {
      setHint(refs.quotaApiKeyResult, "正在验证并保存...");
      const payload = await api("/api/admin/quota/cards/import", {
        method: "POST",
        body: JSON.stringify({ cards: [apiKey] })
      });
      if ((payload.successCount ?? 0) < 1) {
        const reason = payload.failures?.[0]?.reason || "API 密钥验证失败";
        setHint(refs.quotaApiKeyResult, `保存失败：${reason}`);
        renderQuotaImportResults(payload);
        return;
      }
      setHint(refs.quotaApiKeyResult, "API 密钥已保存");
      refs.quotaApiKeyInput.value = "";
      renderQuotaImportResults(payload);
      await refreshQuotaDashboard();
      await refreshQuotaSourceCards();
    } catch (error) {
      setHint(refs.quotaApiKeyResult, `保存失败：${error.message}`);
    }
  });
}

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
      await refreshQuotaSubCards(1);
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

if (refs.quotaSubCardStatus) {
  refs.quotaSubCardStatus.addEventListener("change", () => {
    quotaSubCardState.status = refs.quotaSubCardStatus.value;
    refreshQuotaSubCards(1).catch((error) => {
      if (refs.quotaSubCardList) {
        refs.quotaSubCardList.innerHTML = `<p class="hint centered">加载失败：${escapeHtml(error.message)}</p>`;
      }
    });
  });
}

if (refs.quotaSubCardPageSize) {
  refs.quotaSubCardPageSize.addEventListener("change", () => {
    quotaSubCardState.pageSize = Number(refs.quotaSubCardPageSize.value || 50);
    refreshQuotaSubCards(1).catch((error) => {
      if (refs.quotaSubCardList) {
        refs.quotaSubCardList.innerHTML = `<p class="hint centered">加载失败：${escapeHtml(error.message)}</p>`;
      }
    });
  });
}

if (refs.quotaSubCardPagination) {
  refs.quotaSubCardPagination.addEventListener("click", (event) => {
    const button = event.target.closest("[data-quota-sub-page]");
    if (!button || button.disabled) return;
    refreshQuotaSubCards(Number(button.dataset.quotaSubPage)).catch((error) => {
      if (refs.quotaSubCardList) {
        refs.quotaSubCardList.innerHTML = `<p class="hint centered">加载失败：${escapeHtml(error.message)}</p>`;
      }
    });
  });
}

// ── Quota Sub-Card Batch Actions ──
function getSelectedSubCards() {
  const checks = document.querySelectorAll(".quota-sub-check:checked");
  return Array.from(checks).map(el => ({
    id: el.value,
    code: el.dataset.code,
    total: Number(el.dataset.total),
    used: Number(el.dataset.used),
    status: el.dataset.status
  }));
}

if (refs.quotaSubCardCopyBtn) {
  refs.quotaSubCardCopyBtn.addEventListener("click", () => {
    let selected = getSelectedSubCards();
    if (!selected.length) {
      // If none selected, copy all visible
      const allChecks = document.querySelectorAll(".quota-sub-check");
      selected = Array.from(allChecks).map(el => ({
        id: el.value,
        code: el.dataset.code,
        total: Number(el.dataset.total),
        used: Number(el.dataset.used),
        status: el.dataset.status
      }));
    }
    if (!selected.length) return;
    const text = selected.map(s => s.code).join("\n");
    navigator.clipboard.writeText(text).then(() => {
      setStatusMessage(refs.quotaSubCardResult, `已复制 ${selected.length} 张卡密编码`, "success");
    }).catch(() => {
      // Fallback
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setStatusMessage(refs.quotaSubCardResult, `已复制 ${selected.length} 张卡密编码`, "success");
    });
  });
}

if (refs.quotaSubCardExportBtn) {
  refs.quotaSubCardExportBtn.addEventListener("click", () => {
    let selected = getSelectedSubCards();
    if (!selected.length) {
      const allChecks = document.querySelectorAll(".quota-sub-check");
      selected = Array.from(allChecks).map(el => ({
        id: el.value,
        code: el.dataset.code,
        total: Number(el.dataset.total),
        used: Number(el.dataset.used),
        status: el.dataset.status
      }));
    }
    if (!selected.length) return;
    const lines = ["编码,总额度,已用额度,剩余,状态"];
    for (const s of selected) {
      lines.push(`${s.code},${s.total},${s.used},${s.total - s.used},${s.status}`);
    }
    const csv = lines.join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `quota-sub-cards-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setStatusMessage(refs.quotaSubCardResult, `已导出 ${selected.length} 张子卡密`, "success");
  });
}

// ── Quota Source-Card Refresh + Merge Buttons ──
const _verifiedZeroCardIds = new Set();

if (refs.quotaSourceCardsRefreshBtn) {
  refs.quotaSourceCardsRefreshBtn.addEventListener("click", async () => {
    refs.quotaSourceCardsRefreshBtn.disabled = true;
    refs.quotaSourceCardsRefreshBtn.textContent = "同步中...";
    try {
      const payload = await api("/api/admin/quota/cards?status=active&pageSize=100");
      const items = payload.cards || payload.items || [];
      for (const item of items) {
        if (_verifiedZeroCardIds.has(item.id)) continue;
        try {
          const result = await api("/api/admin/quota/cards/verify", {
            method: "POST",
            body: JSON.stringify({ cardId: item.id }),
          });
          if (result.ok && result.remaining === 0) {
            _verifiedZeroCardIds.add(item.id);
          }
        } catch {
          // Ignore individual verify failures
        }
      }
      await refreshQuotaSourceCards();
    } catch {
      await refreshQuotaSourceCards().catch(() => {});
    } finally {
      refs.quotaSourceCardsRefreshBtn.disabled = false;
      refs.quotaSourceCardsRefreshBtn.textContent = "刷新";
    }
  });
}
if (refs.quotaSourceCardsExportBtn) {
  refs.quotaSourceCardsExportBtn.addEventListener("click", () => {
    exportQuotaSourceCards(false).catch(() => {});
  });
}
if (refs.quotaSourceCardsExportAllBtn) {
  refs.quotaSourceCardsExportAllBtn.addEventListener("click", () => {
    exportQuotaSourceCards(true).catch(() => {});
  });
}
if (refs.quotaSourceCardsMergeBtn) {
  refs.quotaSourceCardsMergeBtn.addEventListener("click", () => {
    handleQuotaSourceCardsMerge().catch(() => {});
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

// ── 5sim Panel Functions ──
let fivesimSitesCache = [];

function formatBalance(value) {
  const num = Number(value);
  if (isNaN(num)) return "- RUB";
  return num.toFixed(2) + " RUB";
}

function maskPhone(phone) {
  const str = String(phone || "");
  if (str.length <= 4) return "*".repeat(str.length);
  return "*".repeat(str.length - 4) + str.slice(-4);
}

function maskApiKeyDisplay(val) {
  if (!val || val.length <= 12) return val || "";
  return val.slice(0, 6) + "..." + val.slice(-4);
}

function renderFivesimStatus(status) {
  const colors = {
    waiting: "yellow",
    code_received: "blue",
    completed: "green",
    cancelled: "grey",
    error: "red"
  };
  const color = colors[status] || "grey";
  return `<span class="table-badge status-${color}">${escapeHtml(status || "-")}</span>`;
}

function populateFivesimSiteSelect(sites) {
  fivesimSitesCache = sites || [];
  if (!refs.fivesimSiteSelect) return;

  if (!fivesimSitesCache.length) {
    refs.fivesimSiteSelect.innerHTML = `<option value="">暂无站点</option>`;
    if (refs.fivesimBalanceBtn) refs.fivesimBalanceBtn.disabled = true;
    return;
  }

  if (refs.fivesimBalanceBtn) refs.fivesimBalanceBtn.disabled = false;

  const options = fivesimSitesCache.map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`);
  refs.fivesimSiteSelect.innerHTML = options.join("");

  // Default to first site with sms_provider
  const defaultSite = fivesimSitesCache.find((s) => s.sms_provider) || fivesimSitesCache[0];
  if (defaultSite) {
    refs.fivesimSiteSelect.value = defaultSite.id;
    loadFivesimSiteConfig(defaultSite);
  }
}

function loadFivesimSiteConfig(site) {
  if (!refs.fivesimConfigForm || !site) return;
  const el = (id) => document.querySelector(id);
  el("#fivesim-sms-provider").value = site.sms_provider || "";
  el("#fivesim-sms-api-key").value = "";
  el("#fivesim-sms-api-key").placeholder = maskApiKeyDisplay(site.sms_api_key) || "API Key（已加密存储）";
  el("#fivesim-sms-country").value = site.sms_country || "";
  el("#fivesim-sms-service").value = site.sms_service || "";
  el("#fivesim-sms-operator").value = site.sms_operator || "";
  el("#fivesim-sms-poll-interval").value = site.sms_poll_interval_ms || "";
  el("#fivesim-sms-poll-timeout").value = site.sms_poll_timeout_ms || "";
  el("#fivesim-sms-phone-tpl").value = site.sms_submit_phone_template || "";
  el("#fivesim-sms-code-tpl").value = site.sms_submit_code_template || "";
}

async function queryFivesimBalance() {
  const siteId = refs.fivesimSiteSelect?.value;
  if (!siteId) return;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  setButtonBusy(refs.fivesimBalanceBtn, true, "查询中...");
  setStatusMessage(refs.fivesimBalanceResult, "");

  try {
    const payload = await api(`/api/admin/5sim/balance?siteId=${siteId}`, { signal: controller.signal });
    if (refs.fivesimBalanceDisplay) {
      refs.fivesimBalanceDisplay.innerHTML = `<article class="stat"><span>余额</span><strong>${formatBalance(payload.balance)}</strong></article>`;
    }
  } catch (error) {
    setStatusMessage(refs.fivesimBalanceResult, error.message, "error");
  } finally {
    clearTimeout(timeout);
    setButtonBusy(refs.fivesimBalanceBtn, false);
  }
}

// ── 5sim Panel Event Wiring ──
if (refs.fivesimBalanceBtn) {
  refs.fivesimBalanceBtn.addEventListener("click", () => {
    queryFivesimBalance().catch(() => {});
  });
}

if (refs.fivesimSiteSelect) {
  refs.fivesimSiteSelect.addEventListener("change", () => {
    const siteId = refs.fivesimSiteSelect.value;
    const site = fivesimSitesCache.find((s) => s.id === siteId);
    if (site) loadFivesimSiteConfig(site);
  });
}

async function saveFivesimConfig() {
  const siteId = refs.fivesimSiteSelect?.value;
  if (!siteId) return;

  const fields = {};
  const provider = document.querySelector("#fivesim-sms-provider").value.trim();
  const apiKey = document.querySelector("#fivesim-sms-api-key").value.trim();
  const country = document.querySelector("#fivesim-sms-country").value.trim();
  const service = document.querySelector("#fivesim-sms-service").value.trim();
  const operator = document.querySelector("#fivesim-sms-operator").value.trim();
  const pollInterval = document.querySelector("#fivesim-sms-poll-interval").value.trim();
  const pollTimeout = document.querySelector("#fivesim-sms-poll-timeout").value.trim();
  const phoneTpl = document.querySelector("#fivesim-sms-phone-tpl").value.trim();
  const codeTpl = document.querySelector("#fivesim-sms-code-tpl").value.trim();

  if (provider) fields.sms_provider = provider;
  if (apiKey) fields.sms_api_key = apiKey;
  if (country) fields.sms_country = country;
  if (service) fields.sms_service = service;
  if (operator) fields.sms_operator = operator;
  if (pollInterval) fields.sms_poll_interval_ms = parseInt(pollInterval, 10);
  if (pollTimeout) fields.sms_poll_timeout_ms = parseInt(pollTimeout, 10);
  if (phoneTpl) fields.sms_submit_phone_template = phoneTpl;
  if (codeTpl) fields.sms_submit_code_template = codeTpl;

  if (Object.keys(fields).length === 0) {
    setStatusMessage(refs.fivesimConfigResult, "请至少填写一个字段", "error");
    return;
  }

  try {
    await api(`/api/admin/sites/${siteId}/sms-config`, {
      method: "PATCH",
      body: JSON.stringify(fields)
    });
    setStatusMessage(refs.fivesimConfigResult, "配置已保存", "success");
  } catch (error) {
    setStatusMessage(refs.fivesimConfigResult, error.message, "error");
  }
}

if (refs.fivesimConfigForm) {
  refs.fivesimConfigForm.addEventListener("submit", (event) => {
    event.preventDefault();
    saveFivesimConfig().catch(() => {});
  });
}

async function refreshFivesimJobs() {
  if (!refs.fivesimJobList) return;
  setButtonBusy(refs.fivesimJobsRefreshBtn, true, "刷新中...");
  setStatusMessage(refs.fivesimJobsResult, "");

  try {
    const payload = await api("/api/admin/5sim/jobs");
    renderTable(refs.fivesimJobList, [
      { label: "订单号", render: (item) => escapeHtml(item.order_no || "-") },
      { label: "站点", render: (item) => escapeHtml(item.site_name || "-") },
      { label: "5sim 状态", render: (item) => renderFivesimStatus(item.fivesimStatus) },
      { label: "手机号", render: (item) => escapeHtml(maskPhone(item.fivesimPhone)) },
      { label: "验证码", render: (item) => escapeHtml(item.fivesimCode || "-") },
      { label: "轮询次数", render: (item) => item.fivesimPollCount ?? "-" },
      { label: "更新时间", render: (item) => escapeHtml(item.updated_at || "-") }
    ], payload.items || [], "暂无 5sim 任务");
  } catch (error) {
    setStatusMessage(refs.fivesimJobsResult, error.message, "error");
  } finally {
    setButtonBusy(refs.fivesimJobsRefreshBtn, false);
  }
}

if (refs.fivesimJobsRefreshBtn) {
  refs.fivesimJobsRefreshBtn.addEventListener("click", () => {
    refreshFivesimJobs().catch(() => {});
  });
}

async function refreshFivesimTab() {
  try {
    const payload = await api("/api/admin/sites");
    populateFivesimSiteSelect(payload.items || []);
  } catch (_) {
    // silently ignore
  }
  refreshFivesimJobs().catch(() => {});
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
