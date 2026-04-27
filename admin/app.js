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
  subCardTypeForm: document.querySelector("#sub-card-type-form"),
  subCtName: document.querySelector("#sub-ct-name"),
  subCtTotal: document.querySelector("#sub-ct-total"),
  subCtEditId: document.querySelector("#sub-ct-edit-id"),
  subCtSubmitBtn: document.querySelector("#sub-ct-submit-btn"),
  subCtCancelBtn: document.querySelector("#sub-ct-cancel-btn"),
  subCtResult: document.querySelector("#sub-ct-result"),
  subCardTypeList: document.querySelector("#sub-card-type-list"),
  subRequestList: document.querySelector("#sub-request-list"),
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

// Global exposure for onclick handlers
window.toggleSiteStatus = toggleSiteStatus;
window.healthCheckSite = healthCheckSite;

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
    { label: "原始卡密", render: (item) => item.source_key ? `<code style="opacity:0.5">${escapeHtml(item.source_key)}</code>` : "-" },
    { label: "网站", render: (item) => item.site_name || "-" },
    { label: "前缀", render: (item) => item.prefix },
    { label: "状态", render: (item) => renderStatus(item.status) }
  ], payload.items);
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
    refreshSystemVersion(),
    refreshSubscriptions()
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
        note: ""
      })
    });
    refs.singleCdkeyForm.reset();
    setHint(refs.singleCdkeyResult, `成功: ${payload.publicKey}`);
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
        note: ""
      })
    });
    refs.batchForm.reset();
    setHint(refs.batchResult, `成功导入 ${payload.importedCount} 条`);
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
