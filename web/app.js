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

let verifiedKey = null;

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

function renderStatusBadge(status) {
  const safeStatus = escapeHtml(status || "unknown");
  return `<span class="status-badge ${safeStatus.toLowerCase()}">${safeStatus}</span>`;
}

function getAbandonRemainingTime() {
  return document.querySelector("input[name='abandon-remaining-time']:checked")?.value === "true";
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
  return `
    <div class="result-card">
      <div class="result-title">卡密验证完成</div>
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
          <strong>${escapeHtml(payload.status)}</strong>
        </div>
        <div class="result-item">
          <span>可兑换</span>
          <strong>${payload.canRedeem ? "是" : "否"}</strong>
        </div>
      </div>
    </div>
  `;
}

function renderRedeemSuccess(orderNo) {
  return `
    <div class="result-card">
      <div class="result-title">任务已提交</div>
      ${renderStatusBadge("processing")}
      <div class="result-grid">
        <div class="result-item">
          <span>订单号</span>
          <strong>${escapeHtml(orderNo)}</strong>
        </div>
        <div class="result-item">
          <span>下一步</span>
          <strong>可立即在下方查询执行进度</strong>
        </div>
      </div>
    </div>
  `;
}

function renderOrderResult(payload) {
  const job = payload.job || {};
  const apiMessage = getApiMessage(job);
  const title = payload.lookupType === "publicKey" ? "卡密关联订单" : "订单追踪结果";
  return `
    <div class="result-card">
      <div class="result-title">${title}</div>
      ${renderStatusBadge(payload.status)}
      <div class="result-grid">
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
          <strong>${escapeHtml(job.status || "-")}</strong>
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
          <span>放弃剩余会员时间</span>
          <strong>${payload.abandonRemainingTime ? "是" : "否"}</strong>
        </div>
        ${payload.cdkeyStatus ? `
          <div class="result-item">
            <span>卡密状态</span>
            <strong>${escapeHtml(payload.cdkeyStatus)}</strong>
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
    <div class="result-card">
      <div class="result-title">卡密查询结果</div>
      ${renderStatusBadge(payload.status)}
      <div class="result-grid">
        <div class="result-item">
          <span>卡密</span>
          <strong>${escapeHtml(payload.publicKey)}</strong>
        </div>
        <div class="result-item">
          <span>当前状态</span>
          <strong>${escapeHtml(payload.status)}</strong>
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
        <div class="result-grid">
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
      <div class="result-grid">
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
          <strong>${escapeHtml(job.status || "-")}</strong>
        </div>
        <div class="result-item">
          <span>重试次数</span>
          <strong>${escapeHtml(job.attemptCount ?? 0)}</strong>
        </div>
        <div class="result-item">
          <span>放弃剩余会员时间</span>
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
      setState(redeemResult, "卡密验证通过，可以提交 session。");
    }
  } catch (error) {
    verifiedKey = null;
    redeemSubmit.disabled = true;
    setState(verifyResult, error.message, "error");
    setState(redeemResult, "卡密未通过验证，无法继续提交。", "error");
  }
});

redeemForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!verifiedKey) {
    setState(redeemResult, "请先验证卡密。", "error");
    return;
  }

  setState(redeemResult, "正在提交兑换任务...");

  try {
    const sessionPayload = document.querySelector("#session-payload").value.trim();
    const abandonRemainingTime = getAbandonRemainingTime();
    const payload = await request("/api/public/redeem", {
      method: "POST",
      body: JSON.stringify({
        publicKey: verifiedKey,
        sessionPayload,
        abandonRemainingTime
      })
    });

    orderNoInput.value = payload.orderNo;
    setRichState(redeemResult, renderRedeemSuccess(payload.orderNo), "success");
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
