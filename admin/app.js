const API_BASE = (globalThis.KAWANG_CONFIG?.apiUrl || "http://127.0.0.1:4300").replace(/\/+$/, "");
const TOKEN_KEY = "kawang_admin_token";
const REFRESH_INTERVAL_MS = 5000;
const UPDATE_POLL_INTERVAL_MS = 3000;

const SITE_PRESETS = {
  oaifire: {
    name: "OAIFire",
    slug: "oaifire",
    verifyApiUrl: "https://oaifire.win/api/verify-cdk",
    submitApiUrl: "",
    verifyHttpMethod: "POST",
    submitHttpMethod: "POST",
    authType: "oaifire_sign",
    authConfig: "ChatGPT#Plus@2026!",
    verifyHeadersTemplate: "{}",
    verifyBodyTemplate: '{"uniqueCode":"{{sourceKey}}"}',
    submitHeadersTemplate: "{}",
    submitBodyTemplate: '{"card":"{{sourceKey}}","session":{{sessionRaw}}}',
    abandonSubmitBodyTemplate: '{"card":"{{sourceKey}}","session":{{sessionRaw}}}',
    verifySuccessRule: '{"kind":"json_path_equals","path":"status","value":"true"}',
    verifyFailureRule: '{"kind":"json_path_equals","path":"status","value":"false"}',
    submitSuccessRule: '{"kind":"json_path_equals","path":"success","value":"true"}',
    submitFailureRule: '{"kind":"json_path_equals","path":"success","value":"false"}',
    timeoutSeconds: 15,
    maxRetries: 3,
    status: "disabled"
  },
  redeemgpt: {
    name: "RedeemGPT",
    slug: "redeemgpt",
    verifyApiUrl: "https://redeemgpt.com/api/check",
    submitApiUrl: "",
    verifyHttpMethod: "POST",
    submitHttpMethod: "POST",
    authType: "",
    authConfig: "",
    verifyHeadersTemplate: "{}",
    verifyBodyTemplate: '{"cdkey":"{{sourceKey}}"}',
    submitHeadersTemplate: "{}",
    submitBodyTemplate: '{"card":"{{sourceKey}}","session":{{sessionRaw}}}',
    abandonSubmitBodyTemplate: '{"card":"{{sourceKey}}","session":{{sessionRaw}}}',
    verifySuccessRule: '{"kind":"json_path_equals","path":"success","value":"true"}',
    verifyFailureRule: '{"kind":"json_path_equals","path":"success","value":"false"}',
    submitSuccessRule: '{"kind":"json_path_equals","path":"success","value":"true"}',
    submitFailureRule: '{"kind":"json_path_equals","path":"success","value":"false"}',
    timeoutSeconds: 15,
    maxRetries: 3,
    status: "disabled"
  },
  niuniuai: {
    name: "NiuniuAI",
    slug: "niuniuai",
    verifyApiUrl: "https://niuniuai.online/api/redeem/verify",
    submitApiUrl: "",
    verifyHttpMethod: "POST",
    submitHttpMethod: "POST",
    authType: "",
    authConfig: "",
    verifyHeadersTemplate: "{}",
    verifyBodyTemplate: '{"cardCode":"{{sourceKey}}"}',
    submitHeadersTemplate: "{}",
    submitBodyTemplate: '{"card":"{{sourceKey}}","session":{{sessionRaw}}}',
    abandonSubmitBodyTemplate: '{"card":"{{sourceKey}}","session":{{sessionRaw}}}',
    verifySuccessRule: '{"kind":"json_path_equals","path":"data.exists","value":"true"}',
    verifyFailureRule: '{"kind":"json_path_equals","path":"data.exists","value":"false"}',
    submitSuccessRule: '{"kind":"json_path_equals","path":"success","value":"true"}',
    submitFailureRule: '{"kind":"json_path_equals","path":"success","value":"false"}',
    timeoutSeconds: 15,
    maxRetries: 3,
    status: "disabled"
  }
};

const refs = {
  loginCard: document.querySelector("#login-card"),
  adminShell: document.querySelector("#admin-shell"),
  loginForm: document.querySelector("#login-form"),
  loginResult: document.querySelector("#login-result"),
  refreshBtn: document.querySelector("#refresh-btn"),
  logoutBtn: document.querySelector("#logout-btn"),
  sessionStatus: document.querySelector("#session-status"),
  sessionDesc: document.querySelector("#session-desc"),
  stats: document.querySelector("#stats"),
  dashboardLogs: document.querySelector("#dashboard-logs"),
  siteForm: document.querySelector("#site-form"),
  siteResult: document.querySelector("#site-result"),
  siteList: document.querySelector("#site-list"),
  sitePreset: document.querySelector("#site-preset"),
  siteStatus: document.querySelector("#site-status"),
  siteName: document.querySelector("#site-name"),
  siteSlug: document.querySelector("#site-slug"),
  siteVerifyApiUrl: document.querySelector("#site-verify-api-url"),
  siteSubmitApiUrl: document.querySelector("#site-submit-api-url"),
  siteVerifyHttpMethod: document.querySelector("#site-verify-http-method"),
  siteSubmitHttpMethod: document.querySelector("#site-submit-http-method"),
  siteAuthConfig: document.querySelector("#site-auth-config"),
  siteAuthTypes: document.querySelectorAll("input[name='site-auth-type']"),
  siteVerifyHeadersTemplate: document.querySelector("#site-verify-headers-template"),
  siteVerifyBodyTemplate: document.querySelector("#site-verify-body-template"),
  siteSubmitHeadersTemplate: document.querySelector("#site-submit-headers-template"),
  siteSubmitBodyTemplate: document.querySelector("#site-submit-body-template"),
  siteAbandonSubmitBodyTemplate: document.querySelector("#site-abandon-submit-body-template"),
  siteVerifySuccessRule: document.querySelector("#site-verify-success-rule"),
  siteVerifyFailureRule: document.querySelector("#site-verify-failure-rule"),
  siteSubmitSuccessRule: document.querySelector("#site-submit-success-rule"),
  siteSubmitFailureRule: document.querySelector("#site-submit-failure-rule"),
  siteTimeoutSeconds: document.querySelector("#site-timeout-seconds"),
  siteMaxRetries: document.querySelector("#site-max-retries"),
  singleCdkeyForm: document.querySelector("#single-cdkey-form"),
  singleCdkeyResult: document.querySelector("#single-cdkey-result"),
  batchForm: document.querySelector("#batch-form"),
  batchResult: document.querySelector("#batch-result"),
  batchList: document.querySelector("#batch-list"),
  cdkeyList: document.querySelector("#cdkey-list"),
  cdkeyAction: document.querySelector("#cdkey-action"),
  cdkeyActionBtn: document.querySelector("#cdkey-action-btn"),
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
  singleSite: document.querySelector("#single-site"),
  navTabs: document.querySelectorAll(".nav-tab"),
  tabPanels: document.querySelectorAll(".tab-panel")
};

let autoRefreshTimer = null;
let updatePollTimer = null;
let currentTab = "dashboard";
let currentEditingSiteId = null;

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

function renderStatus(value) {
  return `<span class="table-badge status-${String(value || "").toLowerCase()}">${value || "-"}</span>`;
}

function getSelectedSiteAuthType() {
  return Array.from(refs.siteAuthTypes).find((item) => item.checked)?.value || "";
}

function updateSiteAuthConfigHint() {
  const authType = getSelectedSiteAuthType();
  const hints = {
    "": "无额外请求头时可留空",
    bearer: "请输入 Bearer Token 原文，不要加 Bearer 前缀",
    header_json: '请输入 JSON，例如 {"X-Api-Key":"your-key"}',
    oaifire_sign: "请输入签名盐值；如留空则默认使用 OAIFire 当前盐值"
  };
  refs.siteAuthConfig.placeholder = hints[authType] || "根据请求头类型填写对应配置";
}

function setSelectedSiteAuthType(value) {
  refs.siteAuthTypes.forEach((item) => {
    item.checked = item.value === value;
  });
  if (!Array.from(refs.siteAuthTypes).some((item) => item.checked)) {
    refs.siteAuthTypes[0].checked = true;
  }
  updateSiteAuthConfigHint();
}

function applySitePreset(presetKey) {
  const preset = SITE_PRESETS[presetKey];
  if (!preset) return;

  currentEditingSiteId = null;
  refs.siteName.value = preset.name;
  refs.siteSlug.value = preset.slug;
  refs.siteVerifyApiUrl.value = preset.verifyApiUrl;
  refs.siteSubmitApiUrl.value = preset.submitApiUrl;
  refs.siteVerifyHttpMethod.value = preset.verifyHttpMethod;
  refs.siteSubmitHttpMethod.value = preset.submitHttpMethod;
  refs.siteAuthConfig.value = preset.authConfig;
  refs.siteVerifyHeadersTemplate.value = preset.verifyHeadersTemplate;
  refs.siteVerifyBodyTemplate.value = preset.verifyBodyTemplate;
  refs.siteSubmitHeadersTemplate.value = preset.submitHeadersTemplate;
  refs.siteSubmitBodyTemplate.value = preset.submitBodyTemplate;
  refs.siteAbandonSubmitBodyTemplate.value = preset.abandonSubmitBodyTemplate || preset.submitBodyTemplate;
  refs.siteVerifySuccessRule.value = preset.verifySuccessRule;
  refs.siteVerifyFailureRule.value = preset.verifyFailureRule;
  refs.siteSubmitSuccessRule.value = preset.submitSuccessRule;
  refs.siteSubmitFailureRule.value = preset.submitFailureRule;
  refs.siteTimeoutSeconds.value = preset.timeoutSeconds;
  refs.siteMaxRetries.value = preset.maxRetries;
  refs.siteStatus.value = preset.status;
  setSelectedSiteAuthType(preset.authType);
  setHint(refs.siteResult, `已载入预设：${preset.name}。如需完整跑通，请补充提交 Session API 后再启用。`);
}

function resetSiteForm() {
  currentEditingSiteId = null;
  refs.siteForm.reset();
  refs.sitePreset.value = "";
  refs.siteVerifyHttpMethod.value = "POST";
  refs.siteSubmitHttpMethod.value = "POST";
  refs.siteStatus.value = "active";
  refs.siteTimeoutSeconds.value = 15;
  refs.siteMaxRetries.value = 3;
  refs.siteVerifyHeadersTemplate.value = "{}";
  refs.siteVerifyBodyTemplate.value = '{"card":"{{sourceKey}}"}';
  refs.siteSubmitHeadersTemplate.value = "{}";
  refs.siteSubmitBodyTemplate.value = '{"card":"{{sourceKey}}","session":{{sessionRaw}}}';
  refs.siteAbandonSubmitBodyTemplate.value = '{"card":"{{sourceKey}}","session":{{sessionRaw}}}';
  refs.siteVerifySuccessRule.value = '{"kind":"json_path_equals","path":"success","value":"true"}';
  refs.siteVerifyFailureRule.value = "";
  refs.siteSubmitSuccessRule.value = '{"kind":"json_path_equals","path":"success","value":"true"}';
  refs.siteSubmitFailureRule.value = "";
  setSelectedSiteAuthType("");
}

function editSite(site) {
  currentEditingSiteId = site.id;
  refs.sitePreset.value = "";
  refs.siteName.value = site.name || "";
  refs.siteSlug.value = site.slug || "";
  refs.siteVerifyApiUrl.value = site.verify_api_url || "";
  refs.siteSubmitApiUrl.value = site.submit_api_url || "";
  refs.siteVerifyHttpMethod.value = site.verify_http_method || "POST";
  refs.siteSubmitHttpMethod.value = site.submit_http_method || "POST";
  refs.siteAuthConfig.value = site.auth_config || "";
  refs.siteVerifyHeadersTemplate.value = site.verify_headers_template || "{}";
  refs.siteVerifyBodyTemplate.value = site.verify_body_template || '{"card":"{{sourceKey}}"}';
  refs.siteSubmitHeadersTemplate.value = site.submit_headers_template || "{}";
  refs.siteSubmitBodyTemplate.value = site.submit_body_template || '{"card":"{{sourceKey}}","session":{{sessionRaw}}}';
  refs.siteAbandonSubmitBodyTemplate.value = site.abandon_submit_body_template || site.submit_body_template || "";
  refs.siteVerifySuccessRule.value = site.verify_success_rule || "";
  refs.siteVerifyFailureRule.value = site.verify_failure_rule || "";
  refs.siteSubmitSuccessRule.value = site.submit_success_rule || "";
  refs.siteSubmitFailureRule.value = site.submit_failure_rule || "";
  refs.siteTimeoutSeconds.value = site.timeout_seconds || 15;
  refs.siteMaxRetries.value = site.max_retries || 3;
  refs.siteStatus.value = site.status || "active";
  setSelectedSiteAuthType(site.auth_type || "");
  switchTab("sites");
  refs.siteName.focus();
  setHint(refs.siteResult, `正在编辑网站：${site.name || site.slug}`);
}

function setAuthState(isLoggedIn, username = "") {
  refs.loginCard.classList.toggle("hidden", isLoggedIn);
  refs.adminShell.classList.toggle("hidden", !isLoggedIn);
  refs.refreshBtn.classList.toggle("hidden", !isLoggedIn);
  refs.logoutBtn.classList.toggle("hidden", !isLoggedIn);
  refs.sessionStatus.textContent = isLoggedIn ? `已登录：${username}` : "未登录";
  refs.sessionDesc.textContent = isLoggedIn
    ? "后台页签已解锁，可按网站、卡密、任务和日志维度进行统一管理。"
    : "请先使用管理员账号登录，登录成功后才会加载仪表盘和后台页签。";
}

function switchTab(tabName) {
  currentTab = tabName;
  refs.navTabs.forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === tabName);
  });
  refs.tabPanels.forEach((panel) => {
    panel.classList.toggle("hidden", panel.dataset.panel !== tabName);
  });
}

function startAutoRefresh() {
  stopAutoRefresh();
  autoRefreshTimer = window.setInterval(() => {
    refreshDashboard().catch(() => {});
    refreshLogs().catch(() => {});
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
    container.innerHTML = `<p class="hint">${emptyText}</p>`;
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
  const activeItems = items.filter((item) => item.status === "active");
  const options = [`<option value="">选择网站</option>`].concat(
    activeItems.map((item) => `<option value="${item.id}">${item.name}</option>`)
  );
  refs.batchSite.innerHTML = options.join("");
  refs.singleSite.innerHTML = options.join("");
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

async function refreshSites() {
  const payload = await api("/api/admin/sites");
  populateSiteSelects(payload.items);
  renderTable(refs.siteList, [
    { label: "操作", render: (item) => `<button class="table-action edit-site-btn" type="button" data-site-id="${escapeHtml(item.id)}">编辑</button>` },
    { label: "网站名", render: (item) => item.name },
    { label: "标识", render: (item) => `<code>${item.slug}</code>` },
    { label: "验证 API", render: (item) => item.verify_api_url || "-" },
    { label: "提交 API", render: (item) => item.submit_api_url || "-" },
    { label: "请求头类型", render: (item) => item.auth_type || "-" },
    { label: "验证模板", render: (item) => item.verify_body_template ? `<code>${item.verify_body_template}</code>` : "-" },
    { label: "状态", render: (item) => renderStatus(item.status) }
  ], payload.items, "暂无网站配置");
  refs.siteList.querySelectorAll(".edit-site-btn").forEach((button) => {
    button.addEventListener("click", () => {
      const site = payload.items.find((item) => item.id === button.dataset.siteId);
      if (site) editSite(site);
    });
  });
}

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
    { label: "网站", render: (item) => item.site_name || "-" },
    { label: "前缀", render: (item) => item.prefix },
    { label: "批次", render: (item) => item.batch_name || "-" },
    { label: "状态", render: (item) => renderStatus(item.status) },
    { label: "锁定时间", render: (item) => item.locked_at || "-" }
  ], payload.items);
}

async function refreshOrders() {
  const payload = await api("/api/admin/orders");
  renderTable(refs.orderList, [
    { label: "订单号", render: (item) => `<code>${item.order_no}</code>` },
    { label: "卡密", render: (item) => `<code>${item.public_key}</code>` },
    { label: "网站", render: (item) => item.site_name || "-" },
    { label: "状态", render: (item) => renderStatus(item.status) },
    { label: "错误", render: (item) => item.error_message || "-" }
  ], payload.items);
}

async function refreshJobs() {
  const payload = await api("/api/admin/jobs");
  renderTable(refs.jobList, [
    { label: "", render: (item) => `<input type="checkbox" class="job-check" value="${item.id}" />` },
    { label: "任务 ID", render: (item) => `<code>${item.id}</code>` },
    { label: "订单号", render: (item) => `<code>${item.order_no}</code>` },
    { label: "网站", render: (item) => item.site_name || "-" },
    { label: "状态", render: (item) => renderStatus(item.status) },
    { label: "尝试", render: (item) => `${item.attempt_count}/${item.max_attempts}` },
    { label: "错误", render: (item) => item.last_error || "-" }
  ], payload.items);
}

async function refreshLogs() {
  const payload = await api("/api/admin/logs");
  renderTable(refs.logList, [
    { label: "时间", render: (item) => item.created_at },
    { label: "动作", render: (item) => `<code>${item.action}</code>` },
    { label: "资源", render: (item) => `${item.resource_type}${item.resource_id ? ` / ${item.resource_id}` : ""}` },
    { label: "执行人", render: (item) => item.actor },
    { label: "详情", render: (item) => item.detail ? `<pre>${JSON.stringify(item.detail, null, 2)}</pre>` : "-" }
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
    ["当前分支", payload.branch || state.branch || "-"],
    ["本地版本", shortCommit(payload.localCommit || state.localCommit)],
    ["远端版本", shortCommit(payload.remoteCommit || state.remoteCommit)],
    ["本地改动", hasLocalChanges ? `${localChanges.length || ""} 个` : "无"],
    ["更新状态", state.status || "idle"],
    ["是否有更新", payload.hasUpdate || state.hasUpdate ? "有更新" : "暂无更新"],
    ["运行环境", payload.nodeEnv || "-"]
  ];

  refs.systemVersionCards.innerHTML = cards.map(([label, value]) => `
    <article class="stat">
      <span>${label}</span>
      <strong>${value}</strong>
    </article>
  `).join("");

  refs.systemUpdateHint.textContent = state.error
    ? `更新异常：${state.error}`
    : hasLocalChanges
      ? `检测到本地改动，在线更新会先自动暂存到 Git stash：${localChanges.slice(0, 3).join("，")}${localChanges.length > 3 ? "..." : ""}`
    : `最后状态：${state.status || "idle"}${state.endedAt ? `，结束时间：${state.endedAt}` : ""}`;
  refs.systemUpdateLog.textContent = payload.log || "暂无更新日志。";
  refs.checkUpdateBtn.disabled = isBusy;
  refs.startUpdateBtn.disabled = isBusy;

  if (isBusy && !updatePollTimer) {
    startUpdatePolling();
  }
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

function getCheckedValues(selector) {
  return Array.from(document.querySelectorAll(selector))
    .filter((element) => element.checked)
    .map((element) => element.value);
}

async function refreshAll() {
  if (!getToken()) return;
  await Promise.all([
    refreshDashboard(),
    refreshSites(),
    refreshBatches(),
    refreshCdkeys(),
    refreshOrders(),
    refreshJobs(),
    refreshLogs(),
    refreshSystemVersion()
  ]);
}

refs.navTabs.forEach((button) => {
  button.addEventListener("click", () => {
    switchTab(button.dataset.tab);
  });
});

refs.siteAuthTypes.forEach((item) => {
  item.addEventListener("change", updateSiteAuthConfigHint);
});

refs.sitePreset.addEventListener("change", (event) => {
  applySitePreset(event.target.value);
});

refs.checkUpdateBtn.addEventListener("click", async () => {
  refs.systemUpdateHint.textContent = "正在检查远端更新...";
  try {
    const payload = await api("/api/admin/system/check-update", {
      method: "POST",
      body: JSON.stringify({})
    });
    renderSystemInfo(payload);
  } catch (error) {
    refs.systemUpdateHint.textContent = error.message;
  }
});

refs.startUpdateBtn.addEventListener("click", async () => {
  const confirmed = window.confirm("确认开始在线更新？系统会备份数据库、拉取代码并重启 PM2 服务。");
  if (!confirmed) return;

  refs.systemUpdateHint.textContent = "正在启动在线更新任务...";
  try {
    const payload = await api("/api/admin/system/update", {
      method: "POST",
      body: JSON.stringify({})
    });
    renderSystemInfo(payload);
    startUpdatePolling();
  } catch (error) {
    refs.systemUpdateHint.textContent = error.message;
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
    setHint(refs.loginResult, `登录成功，当前用户：${payload.username}`);
    setAuthState(true, payload.username);
    switchTab(currentTab);
    startAutoRefresh();
    await refreshAll();
  } catch (error) {
    setHint(refs.loginResult, error.message);
  }
});

refs.siteForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const wasEditing = Boolean(currentEditingSiteId);
    await api("/api/admin/sites", {
      method: "POST",
      body: JSON.stringify({
        id: currentEditingSiteId || undefined,
        name: document.querySelector("#site-name").value.trim(),
        slug: document.querySelector("#site-slug").value.trim(),
        verifyApiUrl: document.querySelector("#site-verify-api-url").value.trim(),
        submitApiUrl: document.querySelector("#site-submit-api-url").value.trim(),
        verifyHttpMethod: document.querySelector("#site-verify-http-method").value,
        submitHttpMethod: document.querySelector("#site-submit-http-method").value,
        authType: getSelectedSiteAuthType(),
        authConfig: document.querySelector("#site-auth-config").value.trim(),
        verifyHeadersTemplate: refs.siteVerifyHeadersTemplate.value.trim() || "{}",
        verifyBodyTemplate: refs.siteVerifyBodyTemplate.value.trim() || '{"card":"{{sourceKey}}"}',
        submitHeadersTemplate: refs.siteSubmitHeadersTemplate.value.trim() || "{}",
        submitBodyTemplate: refs.siteSubmitBodyTemplate.value.trim() || '{"card":"{{sourceKey}}","session":{{sessionRaw}}}',
        abandonSubmitBodyTemplate: refs.siteAbandonSubmitBodyTemplate.value.trim(),
        verifySuccessRule: refs.siteVerifySuccessRule.value.trim() || '{"kind":"json_path_equals","path":"success","value":"true"}',
        verifyFailureRule: refs.siteVerifyFailureRule.value.trim(),
        submitSuccessRule: refs.siteSubmitSuccessRule.value.trim() || '{"kind":"json_path_equals","path":"success","value":"true"}',
        submitFailureRule: refs.siteSubmitFailureRule.value.trim(),
        timeoutSeconds: Number(refs.siteTimeoutSeconds.value || 15),
        maxRetries: Number(refs.siteMaxRetries.value || 3),
        status: refs.siteStatus.value
      })
    });
    resetSiteForm();
    setHint(refs.siteResult, wasEditing ? "网站更新成功。" : "网站保存成功。");
    await refreshAll();
  } catch (error) {
    setHint(refs.siteResult, error.message);
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
        note: document.querySelector("#single-note").value.trim()
      })
    });
    refs.singleCdkeyForm.reset();
    setHint(refs.singleCdkeyResult, `卡密创建成功，混淆卡密：${payload.publicKey}`);
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
        rawKeys: document.querySelector("#batch-raw-keys").value,
        note: document.querySelector("#batch-note").value.trim()
      })
    });
    refs.batchForm.reset();
    setHint(refs.batchResult, `导入成功，批次 ID：${payload.batchId}，导入数量：${payload.importedCount}`);
    await refreshAll();
  } catch (error) {
    setHint(refs.batchResult, error.message);
  }
});

refs.cdkeyActionBtn.addEventListener("click", async () => {
  const ids = getCheckedValues(".cdkey-check");
  if (!ids.length) {
    alert("请先勾选卡密");
    return;
  }

  try {
    await api("/api/admin/cdkeys/bulk-action", {
      method: "POST",
      body: JSON.stringify({
        ids,
        action: refs.cdkeyAction.value
      })
    });
    await refreshAll();
  } catch (error) {
    alert(error.message);
  }
});

refs.retryJobsBtn.addEventListener("click", async () => {
  const ids = getCheckedValues(".job-check");
  if (!ids.length) {
    alert("请先勾选任务");
    return;
  }

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

refs.refreshBtn.addEventListener("click", () => {
  refreshAll().catch((error) => {
    alert(error.message);
  });
});

refs.logoutBtn.addEventListener("click", () => {
  clearToken();
  stopAutoRefresh();
  stopUpdatePolling();
  setAuthState(false);
  setHint(refs.loginResult, "已退出登录。");
});

switchTab(currentTab);
updateSiteAuthConfigHint();
resetSiteForm();

if (getToken()) {
  setAuthState(true, "admin");
  startAutoRefresh();
  refreshAll().catch((error) => {
    setHint(refs.loginResult, error.message);
    stopAutoRefresh();
    setAuthState(false);
  });
} else {
  setAuthState(false);
}
