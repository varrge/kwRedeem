window.TUTORIAL_MANIFEST = Object.freeze({
  tracks: [
    {
      id: "api-calling",
      label: "API 调用",
      title: "5 分钟完成第一次 API 调用",
      description: "从创建 Key、配置 Base URL，到发出第一条 OpenAI 兼容请求。",
      href: "#api-quickstart",
      duration: "约 5 分钟",
      status: "首发"
    },
    {
      id: "subscription-purchase",
      label: "订阅购买",
      title: "看懂套餐，再安全购买",
      description: "理解价格、有效期和额度，然后进入登录后的订阅中心完成扣款。",
      href: "#subscription-guide",
      duration: "约 3 分钟",
      status: "首发"
    }
  ],
  clients: [
    {
      name: "Codeg",
      kind: "AI 编程 GUI",
      mode: "直接 API + 托管 CLI",
      status: "user-confirmed",
      note: "可直接配置 OpenAI 兼容服务，也可调用本机 Claude Code、Codex 或 Gemini CLI。"
    },
    {
      name: "CCGUI",
      kind: "AI 编程 GUI",
      mode: "直接 API + 托管 CLI",
      status: "user-confirmed",
      note: "适合把 Claude Code、Codex CLI、Gemini CLI 和 OpenCode 放在一个桌面工作区。"
    },
    {
      name: "Cherry Studio",
      kind: "桌面聊天客户端",
      mode: "直接 OpenAI 兼容 API",
      status: "candidate",
      note: "使用自定义服务商填写 API 地址、Key 和模型；正式发布前记录版本并复测 Base URL 拼接规则。"
    }
  ]
});
