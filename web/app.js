const API_BASE = (globalThis.KAWANG_CONFIG?.apiUrl || "http://127.0.0.1:4300").replace(/\/+$/, "");

const verifyForm = document.querySelector("#verify-form");
const verifyResult = document.querySelector("#verify-result");
const redeemForm = document.querySelector("#redeem-form");
const redeemSubmit = document.querySelector("#redeem-submit");
const redeemResult = document.querySelector("#redeem-result");
const lookupForm = document.querySelector("#lookup-form");
const orderResult = document.querySelector("#order-result");
const publicKeyInput = document.querySelector("#public-key");
const orderNoInput = document.querySelector("#order-no");
const statusContainer = document.querySelector("#status-container");

let verifiedKey = null;
let redeemStatusTimer = null;

const LIVE_STATUS_POLL_MS = 3000;
const STATUS_LABELS = {
  active: "可用",
  locked: "锁定中",
  used: "已使用",
  disabled: "已禁用",
  void: "已作废",
  pending: "排队中",
  processing: "处理中",
  succeeded: "已成功",
  failed: "失败",
  cancelled: "已取消",
  unknown: "未知"
};

// --- Navigation Logic ---

function switchView(target) {
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
    const s = parseInt(dot.dataset.step);
    dot.classList.toggle("active", s === step);
  });
}

document.querySelectorAll(".nav-btn").forEach((btn) => {
  btn.addEventListener("click", () => switchView(btn.dataset.target));
});

document.querySelector("#back-to-step-1").addEventListener("click", () => goToStep(1));
document.querySelector("#start-over").addEventListener("click", () => {
  verifiedKey = null;
  publicKeyInput.value = "";
  document.querySelector("#session-payload").value = "";
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

function stopRedeemStatusPolling() {
  if (redeemStatusTimer) {
    window.clearInterval(redeemStatusTimer);
    redeemStatusTimer = null;
  }
}

function shouldKeepPolling(order = {}) {
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
    "缺少account字段",
    "缺少 account 字段",
    "missing account",
    "account field is required",
    "token expired",
    "token invalid",
    "invalid token",
    "expired token"
  ].some((keyword) => String(message ?? "").toLowerCase().includes(keyword));
}

function getApiMessage(job = {}) {
  const response = job.lastResponse || {};
  const json = response.json || {};
  return json.msg
    || json.message
    || json.data?.msg
    || json.data?.message
    || "";
}

function renderVerifyResult(payload) {
  const title = payload.canRedeem ? "验证成功，正在跳转..." : "卡密验证完成";
  return `
    <div class="result-card">
      <div class="result-title">${title}</div>
      ${renderStatusBadge(payload.status)}
      <div class="result-grid">
        <div class="result-item">
          <span>商品</span>
          <strong>${escapeHtml(payload.productTitle)}</strong>
        </div>
        <div class="result-item">
          <span>激活通道</span>
          <strong>${escapeHtml(payload.endpointName)}</strong>
        </div>
        <div class="result-item">
          <span>当前状态</span>
          <strong>${renderStatusText(payload.status)}</strong>
        </div>
        <div class="result-item">
          <span>可兑换</span>
          <strong>${payload.canRedeem ? "是" : "否"}</strong>
        </div>
      </div>
    </div>
  `;
}

function renderRedeemSuccess(payload) {
  const liveStatus = payload.job?.status || payload.status || "processing";
  const apiMessage = getApiMessage(payload.job || {});
  const sessionFixNeeded = isSessionFixNeededMessage(apiMessage) || isSessionFixNeededMessage(payload.errorMessage);
  const statusHint = {
    pending: "任务已进入队列，等待系统处理。",
    processing: "任务正在处理中，状态会自动刷新。",
    succeeded: "任务已完成，无需手动刷新。",
    failed: sessionFixNeeded
      ? "Session 内容有误或已失效，请修正后重新提交。当前卡密会自动释放，可重新发起兑换。"
      : "任务处理失败，请根据错误信息或稍后重试。",
    cancelled: "任务已取消。"
  }[String(liveStatus).toLowerCase()] || "任务状态会自动刷新。";

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
      ${payload.errorMessage ? `<div class="result-item result-item-wide"><span>错误信息</span><strong>${escapeHtml(payload.errorMessage)}</strong></div>` : ""}
    </div>
  `;
}

function renderOrderResult(payload) {
  const job = payload.job || {};
  const apiMessage = getApiMessage(job);
  const title = payload.lookupType === "publicKey" ? "卡密关联订单" : "订单追踪结果";
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
          <span>重试次数</span>
          <strong>${escapeHtml(job.attemptCount ?? 0)}</strong>
        </div>
        <div class="result-item">
          <span>用户邮箱</span>
          <strong>${escapeHtml(payload.sessionPreview?.email || "-")}</strong>
        </div>
        <div class="result-item">
          <span>覆盖提交</span>
          <strong>${payload.abandonRemainingTime ? "是" : "否"}</strong>
        </div>
        ${payload.cdkeyStatus ? `
          <div class="result-item">
            <span>卡密状态</span>
            <strong>${renderStatusText(payload.cdkeyStatus)}</strong>
          </div>
        ` : ""}
      </div>
      ${apiMessage ? `<div class="result-item result-item-wide"><span>接口返回消息</span><strong>${escapeHtml(apiMessage)}</strong></div>` : ""}
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
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      "Content-Type": "application/json"
    },
    ...options
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

  try {
    const payload = await request("/api/public/cdkeys/verify", {
      method: "POST",
      body: JSON.stringify({
        publicKey: publicKeyInput.value.trim()
      })
    });

    verifiedKey = payload.canRedeem ? payload.publicKey : null;
    redeemSubmit.disabled = !payload.canRedeem;
    setRichState(verifyResult, renderVerifyResult(payload), payload.canRedeem ? "success" : "error");
    
    if (payload.canRedeem) {
      setTimeout(() => {
        goToStep(2);
      }, 1500);
    }
  } catch (error) {
    verifiedKey = null;
    redeemSubmit.disabled = true;
    setState(verifyResult, error.message, "error");
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
    const abandonRemainingTime = shouldConfirmOverwrite(sessionData);
    if (abandonRemainingTime) {
      const confirmed = window.confirm("检测到当前 Session 账号可能已开通 Plus。确认后将按覆盖提交流程继续，是否继续提交？");
      if (!confirmed) {
        return;
      }
    }

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
