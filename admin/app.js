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
  sessionDesc: document.querySelector("#session-desc"),
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
  navTabs: document.querySelectorAll(".nav-tab"),
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
    { label: "网站名", render: (item) => `<strong>${escapeHtml(item.name)}</strong><br/><code>${escapeHtml(item.slug)}</code>` },
    { label: "验证 API", render: (item) => item.verify_api_url ? `<span class="url-cell">${escapeHtml(item.verify_api_url)}</span>` : "-" },
    { label: "提交 API", render: (item) => item.submit_api_url ? `<span class="url-cell">${escapeHtml(item.submit_api_url)}</span>` : "-" },
    { label: "状态", render: (item) => renderStatus(item.status) },
    { label: "健康检查", render: (item) => {
      const result = item.last_health_result;
      return `<span class="health-group">${renderHealthDot(result, "verify")} 验证 ${renderHealthDot(result, "submit")} 提交</span>`;
    }},
    { label: "最后检测", render: (item) => item.last_health_check || "-" },
    { label: "操作", render: (item) => `
      <button class="table-action toggle-site-btn" type="button" data-site-id="${escapeHtml(item.id)}" data-status="${escapeHtml(item.status)}">
        ${item.status === "active" ? "禁用" : "启用"}
      </button>
      <button class="table-action health-check-btn" type="button" data-site-id="${escapeHtml(item.id)}">测活</button>
    ` }
  ], payload.items, "暂无网站数据");

  refs.siteList.querySelectorAll(".toggle-site-btn").forEach((button) => {
    button.addEventListener("click", () => {
      toggleSiteStatus(button.dataset.siteId, button.dataset.status);
    });
  });
  refs.siteList.querySelectorAll(".health-check-btn").forEach((button) => {
    button.addEventListener("click", () => {
      healthCheckSite(button.dataset.siteId);
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
    { label: "原始卡密", render: (item) => item.source_key ? `<code>${escapeHtml(item.source_key)}</code>` : "-" },
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

refs.healthCheckAllBtn.addEventListener("click", () => {
  healthCheckAll().catch((error) => {
    setHint(refs.siteResult, error.message);
  });
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
