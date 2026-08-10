(function initializeTutorialSite() {
  const params = new URLSearchParams(window.location.search);
  const connectionId = params.get("connectionId")
    || params.get("connection_id")
    || params.get("connection")
    || "";
  const apiBaseUrl = (params.get("apiBaseUrl") || "https://sub.vsakura.top/v1").replace(/\/+$/, "");
  // Account-gated actions must stay on the same origin as the Sub2api embed.
  // Do not let a query parameter turn a public tutorial link into an open redirect.
  const sub2apiOrigin = window.location.origin;
  const pageId = document.body.dataset.tutorialPage || "";

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function withPublicContext(href) {
    // Build from the current path without inheriting arbitrary query params.
    // Only the two documented public-context values may travel between pages.
    const base = new URL(window.location.pathname, window.location.origin);
    const url = new URL(href, base);
    const allowedParams = new URLSearchParams();
    if (connectionId) allowedParams.set("connectionId", connectionId);
    if (params.get("apiBaseUrl")) allowedParams.set("apiBaseUrl", apiBaseUrl);
    url.search = allowedParams.toString();
    return `${url.pathname}${url.search}${url.hash}`;
  }

  function hasSub2ApiSession() {
    try {
      return Boolean(
        window.localStorage.getItem("auth_token")
        || window.localStorage.getItem("access_token")
        || window.localStorage.getItem("token")
      );
    } catch {
      return false;
    }
  }

  function getAccountHref(destination) {
    if (hasSub2ApiSession()) return destination;
    const loginUrl = new URL("/login", sub2apiOrigin);
    loginUrl.searchParams.set("redirect", destination);
    return loginUrl.href;
  }

  const header = document.querySelector("[data-tutorial-header]");
  if (header) {
    const navItems = [
      { id: "home", label: "Sub2api 首页", href: "/home" },
      { id: "center", label: "教程中心", href: "./tutorial-center.html" }
    ];
    header.className = "tutorial-header";
    header.innerHTML = `
      <a class="tutorial-brand" href="${escapeHtml(withPublicContext("/home"))}">
        <span class="tutorial-brand-mark">S2</span>
        <span class="tutorial-brand-copy"><strong>Sub2api</strong><small>学习与接入中心</small></span>
      </a>
      <nav class="tutorial-nav" aria-label="教程导航">
        ${navItems.map((item) => `
          <a href="${escapeHtml(withPublicContext(item.href))}"${pageId === item.id ? ' aria-current="page"' : ""}>${escapeHtml(item.label)}</a>
        `).join("")}
        <a class="tutorial-nav-action" data-subscription-link href="${escapeHtml(getAccountHref("/purchase"))}">购买订阅</a>
      </nav>
    `;
  }

  document.querySelectorAll("[data-public-link]").forEach((link) => {
    const href = link.getAttribute("href");
    if (href) link.setAttribute("href", withPublicContext(href));
  });

  document.querySelectorAll("[data-subscription-link]").forEach((link) => {
    link.setAttribute("href", getAccountHref("/purchase"));
    link.title = hasSub2ApiSession() ? "购买订阅" : "登录 Sub2api 后购买订阅";
  });

  document.querySelectorAll("[data-my-subscriptions-link]").forEach((link) => {
    link.setAttribute("href", getAccountHref("/subscriptions"));
    link.title = hasSub2ApiSession() ? "查看我的套餐" : "登录 Sub2api 后查看我的套餐";
  });

  document.querySelectorAll("[data-api-base]").forEach((node) => {
    node.textContent = apiBaseUrl;
  });

  const manifest = window.TUTORIAL_MANIFEST || { tracks: [], clients: [] };
  const catalog = document.querySelector("[data-tutorial-catalog]");
  if (catalog) {
    catalog.innerHTML = manifest.tracks.map((track, index) => `
      <article class="tutorial-card">
        <div class="tutorial-card-icon" aria-hidden="true">${index === 0 ? "⌁" : "◇"}</div>
        <div>
          <span class="tutorial-pill accent">${escapeHtml(track.label)}</span>
          <h3 style="margin-top: 12px;">${escapeHtml(track.title)}</h3>
        </div>
        <p>${escapeHtml(track.description)}</p>
        <div class="tutorial-meta">
          <span class="tutorial-pill">${escapeHtml(track.duration)}</span>
          <span class="tutorial-pill">公开阅读</span>
        </div>
        <div class="tutorial-actions">
          <a class="tutorial-button small secondary" data-public-link href="${escapeHtml(track.href)}">打开教程</a>
        </div>
      </article>
    `).join("");
    catalog.querySelectorAll("[data-public-link]").forEach((link) => {
      link.setAttribute("href", withPublicContext(link.getAttribute("href")));
    });
  }

  const clientRows = document.querySelector("[data-client-catalog]");
  if (clientRows) {
    clientRows.innerHTML = manifest.clients.map((client) => {
      const userConfirmed = client.status === "user-confirmed";
      return `
        <tr>
          <td><strong>${escapeHtml(client.name)}</strong></td>
          <td>${escapeHtml(client.kind)}</td>
          <td>${escapeHtml(client.mode)}</td>
          <td><span class="tutorial-status ${userConfirmed ? "verified" : "community"}">${userConfirmed ? "用户确认兼容" : "待版本复测"}</span></td>
          <td>${escapeHtml(client.note)}</td>
        </tr>
      `;
    }).join("");
  }

  document.querySelectorAll("pre.tutorial-code").forEach((block) => {
    const code = block.querySelector("code");
    if (!code) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "tutorial-button small secondary tutorial-code-copy";
    button.textContent = "复制";
    button.addEventListener("click", async () => {
      const value = code.textContent.trim();
      try {
        await navigator.clipboard.writeText(value);
        button.textContent = "已复制";
      } catch {
        const textarea = document.createElement("textarea");
        textarea.value = value;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.append(textarea);
        textarea.select();
        document.execCommand("copy");
        textarea.remove();
        button.textContent = "已复制";
      }
      window.setTimeout(() => { button.textContent = "复制"; }, 1200);
    });
    block.append(button);
  });
})();
