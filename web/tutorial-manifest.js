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
      name: "CodexG",
      kind: "AI 编程 GUI",
      mode: "CC Switch 本地路由 + 托管 CLI",
      status: "user-confirmed",
      note: "通过 CC Switch 选择供应商并接管本地 CLI，客户端只连接 CC Switch 提供的本地端点。"
    },
    {
      name: "CCGUI",
      kind: "AI 编程 GUI",
      mode: "CC Switch 本地路由 + 托管 CLI",
      status: "user-confirmed",
      note: "通过 CC Switch 的本地路由使用 Sub2api，不必把同一份 Key 重复粘贴到多个运行层。"
    },
    {
      name: "CC Switch（路由层）",
      kind: "桌面供应商管理 / 本地路由",
      mode: "配合 CCGUI / CodexG",
      status: "candidate",
      note: "CC Switch 保存 Sub2api Key 并提供本地端点，客户端通过它选择供应商、切换模型和发送请求。"
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
