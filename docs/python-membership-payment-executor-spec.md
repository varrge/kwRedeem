# Python 会员付款执行器实施规格

Status: Implemented contract with live rollout still default-off. See [ADR-0020](./adr/0020-use-python-as-the-membership-payment-executor.md). It replaces only the production checkout-execution mechanism selected by [ADR-0006](./adr/0006-go-headless-membership-checkout.md); the existing [membership fulfillment specification](./chatgpt-membership-fulfillment-implementation-spec.md) remains the shared safety contract and legacy extension reference where it does not conflict with ADR-0020 or this document.

## 1. 目标与边界

本规格定义玩家提交 `CDK + ChatGPT Session` 后的会员履约工作流，以及由现有 Go 会员 Worker 编排、Python 执行器完成银行卡结账的边界。

首个版本覆盖 Plus、x5、x20，真实付款默认关闭，只允许 fixture、模拟 Provider 和无扣款浏览器验证。生产 Canary 必须另行由管理员逐单授权。

当前实现状态：Go 私有 bridge、SQLite 串行命令队列、五分钟硬截止、一次性材料领取、页面事实校验、动作 Permit、Python Playwright 适配器和 fixture/合同测试已经落地。`KWMEMBERSHIP_PYTHON_EXECUTOR_MODE=preflight` 可使用真实浏览器验证付款页，同时从进程边界拒绝 payment 命令；默认仍为 `fixture`，`KWMEMBERSHIP_LIVE_PAYMENT_ENABLED` 默认仍为 `false`，真实 Plus、x5、x20 Canary 尚未执行。

系统只有一个工作流所有者：现有 `kwMembership` Go Worker。它继续拥有：

- 订单发现、CDK 锁定和客户状态投影；
- 起始订阅门禁、账号排他锁和目标档位快照；
- 卡片选择、预留、开卡、充值和卡台交易同步；
- 串行付款队列、阶段 Attempt、租约和动作 Permit；
- 付款后双证据对账、取消续费和最终完成判定；
- 重试、人工介入、Session 恢复及审计。

Python 只执行一笔已经由 Go 授权的付款阶段。它不得直接领取原始兑换订单、直接写 SQLite、决定重试、释放 CDK、选择会员档位、选择支付卡、移动资金或把订单标记为完成。

参考项目 `abaiautoplus/application/gopay_pay_chatgpt.py` 仅提供“协议生成链接 + 浏览器完成必要页面步骤 + 协议结果回报”的分层思路。本项目不引入 GoPay/Midtrans，也不复制其 AGPL-3.0 源码；银行卡付款适配器必须独立实现。

## 2. 权威成功流程

```text
玩家提交 CDK + Session
-> 创建订单并锁定 CDK，快照目标档位
-> 权威查询订阅
-> 若 auto-renew=true，取消自动续费
-> 再次权威查询
-> 仅当 plan=free 且 auto-renew=false 时通过起始订阅门禁
-> 完成库存、价格、卡片、资金和无扣款页面前置检查
-> 将付款阶段放入全局串行队列
-> Python 领取一个五分钟独占租约
-> Python 在全新浏览器进程中注入 Session Cookie 并核验账号
-> Python 按 Go 固定的合同调用官方 checkout API 并校验付款链接
-> Python 获取一次性卡资料和账单地址，校验页面并填表
-> 每个可能产生授权的控件点击前，由 Go 持久化并激活单次 Permit
-> Python 点击后只回报脱敏结果
-> Go 查询订阅和卡台交易，完成阶段双证据确认
-> Plus 订单进入最终续费保护
-> x5/x20 订单在确认 Plus 后创建全新的升级阶段任务
-> 确认最终目标档位及对应卡台交易
-> 如 auto-renew=true，取消自动续费
-> 再次权威查询目标档位正确且 auto-renew=false
-> 对客户投影开通成功；pending 授权继续后台结算对账
```

浏览器的成功页、Python 的 `success=true`、checkout API 的成功响应或取消续费接口的成功响应，都不能单独完成订单。

## 3. 档位阶段

### 3.1 Plus

```text
plus checkout
-> 目标会员 Plus + 唯一匹配卡台授权
-> 最终取消续费
-> 权威复查 Plus + auto-renew=false
-> COMPLETED
```

### 3.2 x5 / x20

```text
plus checkout
-> Plus + 唯一匹配卡台授权
-> 销毁第一阶段浏览器
-> Go 持久化 PLUS_CONFIRMED
-> 新 Attempt / 新 Permit / 新 Python 浏览器
-> 套餐管理页升级至 x5 或 x20
-> 最终档位 + 唯一匹配卡台授权
-> 最终取消续费
-> 权威复查目标档位 + auto-renew=false
-> COMPLETED
```

中间 Plus 阶段不得取消续费。若最终升级未完成，进入部分履约处理，不能向客户报告 x5/x20 成功，也不能重复购买 Plus。

## 4. 起始订阅门禁

起始门禁必须发生在建立付款浏览器 Session、预留支付卡或任何资金动作之前。

允许进入付款准备的唯一状态是一次新的权威订阅观察同时满足：

```text
account_type == free
auto_renew == false
is_overdue == false
is_delinquent == false
```

缺字段、未知枚举、超时、限流和非成功响应都不是 `free`。

若初次查询 `auto_renew=true`，Go 调用取消续费能力后必须重新查询；取消接口本身不是成功证据。若续费已关闭但会员尚未变为 `free`，原订单停在无卡、无资金的等待状态并定时复查。

临时上游故障保留原订单和 CDK，按退避策略重试；自动重试耗尽后转人工，不释放 CDK。只有明确证明 Session 无效或身份不匹配时，才进入 Session 失败规则。

## 5. Session 失败与恢复

### 5.1 资金暴露前

资金暴露前明确证明 Session 无效时，必须在一个事务中：

1. 将当前 Membership Fulfillment 终止为 `CANCELLED`，保存规范化错误码；
2. 将原 Redeem Order 标记失败并保留审计历史；
3. 清除 CDK 的 `locked_at` 和 `locked_by_order_id`，恢复为 `active`；
4. 终止未领取的队列任务和未激活 Permit；
5. 不保留可恢复的浏览器、Session 或账号上下文。

玩家随后回到普通兑换入口，再次提交 `CDK + 新 Session`，系统创建全新的 Order 和 Fulfillment。

### 5.2 资金暴露后

资金暴露后 Session 失效时，CDK 和原订单保持锁定。新增公开恢复入口：

```http
POST /api/public/orders/{orderNo}/membership-session
Content-Type: application/json

{
  "publicKey": "<original CDK>",
  "sessionPayload": "<new Session>"
}
```

服务端必须执行速率限制并验证：

- 订单存在且允许补 Session；
- CDK 与订单完全匹配且仍由该订单锁定；
- 新 Session 的稳定账号 ID或规范化邮箱与原账号锁一致；
- 新 Session 当前有效。

成功后只替换加密 Session、递增 Session revision 并记录不含敏感值的审计事件。目标档位、卡片、资金 Intent、阶段、Permit 和既有付款证据不可修改。Go 必须先重新查询会员和卡台交易；只有证明会员未变化、无有效扣款且无 pending 授权时，才能创建新的付款 Attempt。

## 6. 资金暴露边界

以下任一事件最先发生时，持久化 `money_boundary_at`，且此字段不可清空：

- 为订单持久化具体支付卡预留；
- 提交开卡或充值请求，包括响应超时或未知；
- 向 Python 发放完整卡号、有效期或 CVV；
- 激活可能产生授权的 progression 或 submit Permit；
- 卡台同步到与该订单阶段相关的任意交易，包括 `pending`、`complete` 或 `declined`。

跨界后禁止自动释放 CDK或创建替代订单。即使后来证明没有扣款，也只能在原订单内创建新的 Attempt。

## 7. 串行付款队列

全系统任意时刻最多一个 Python 付款执行租约。订阅查询、卡台只读同步和对账可并行，但不能创建第二个活动付款浏览器。

队列优先级从高到低：

1. 已跨资金边界且经证据允许恢复的原订单；
2. 已确认 Plus 的 x5/x20 最终升级阶段；
3. 普通新付款阶段，按 `payment_ready_at` FIFO。

同优先级按进入可付款状态的时间排序。管理员插队必须重新验证身份、填写原因并记录原顺序、新顺序和操作者；插队本身不签发付款 Permit。

每个租约从领取开始最多五分钟，人工挑战时间也包含在这五分钟内。租约到期必须关闭浏览器、清理临时目录并释放队列。心跳只能证明执行器存活，不能延长五分钟硬截止时间。

建议新增表：

```text
membership_checkout_commands
- id
- fulfillment_id
- stage_key
- attempt_no
- priority_class        # recovery | upgrade | normal
- adapter_version
- state                 # queued | leased | action_required | reported | expired | cancelled
- lease_epoch
- lease_token_sha256
- leased_by
- leased_at
- heartbeat_at
- lease_expires_at
- hard_deadline_at
- available_at
- outcome_code
- sanitized_diagnostic
- created_at / updated_at / ended_at
```

表内禁止存储 Session、Cookie、PAN、CVV、付款链接、原始 DOM、截图或 Provider 原始响应。

## 8. Go 与 Python 的本机 HTTP 合同

Go Worker 新增仅监听 `127.0.0.1` 的私有 HTTP 服务。Python 使用独立随机 Bearer credential；服务不得绑定公网地址，不记录请求体，所有响应带 `Cache-Control: no-store`。

建议路由：

```text
POST /internal/v1/executions/lease
POST /internal/v1/executions/{id}/heartbeat
POST /internal/v1/executions/{id}/material
POST /internal/v1/executions/{id}/page-facts
POST /internal/v1/executions/{id}/actions/prepare
POST /internal/v1/executions/{id}/actions/{permitId}/activate
POST /internal/v1/executions/{id}/actions/{permitId}/result
POST /internal/v1/executions/{id}/handoff
GET  /internal/v1/executions/{id}/command
POST /internal/v1/executions/{id}/result
```

每个请求同时绑定：execution ID、fulfillment ID、stage、attempt、lease epoch、adapter version。任何不一致、过期、重复或状态 revision 变化都返回冲突并停止执行。

### 8.1 领取

`lease` 只返回脱敏任务事实：execution ID、阶段、目标档位、合同版本、五分钟截止时间和后续一次性资源地址；无任务时返回 `204`。

### 8.2 一次性材料

`material` 仅在 Go 重新验证以下条件后允许读取一次：

- 当前全局租约仍属于该 Python 实例；
- fulfillment、stage、attempt 和 state revision 未变化；
- 卡片预留有效且与阶段一致；
- Payment Gate、Canary 或 Automatic Scope 当前仍授权；
- 价格合同和 adapter version 匹配；
- 当前阶段不存在已激活或未知结果的 submit Permit。

响应仅在内存中提供：订单 Session、目标账号身份、完整卡资料、新账单地址和不可修改的 checkout 合同。领取即标记 `claimed_at`；相同 nonce 再次读取必须失败。

### 8.3 页面事实

Python 回报规范化事实，不回报 DOM 文本：

```json
{
  "stateId": "PAYMENT_FINAL_READY",
  "origin": "https://pay.openai.com",
  "routeTemplate": "/pay/{id}",
  "plan": "plus",
  "country": "PH",
  "currency": "PHP",
  "displayedAmount": 1150,
  "fields": {"cardNumber": true, "expiry": true, "cvv": true},
  "controls": {"submit": "reviewed-control-id"},
  "structuralHash": "..."
}
```

Go 校验计划、地区、币种、价格范围、允许域名/路径和版本化页面合同后，才允许继续。

### 8.4 动作 Permit

每个可能产生授权的 progression 或 submit 控件使用独立单次 Permit：

1. `actions/prepare` 在事务中快照该卡当前授权 ID并创建 Permit；
2. Python 即将点击前调用 `activate`；
3. Go 在事务中将 Permit 设为 activated，并先把 fulfillment 推进到保守的对账状态；
4. Python 收到成功响应后只允许点击绑定的 control ID一次；
5. Python 调用 `result` 回报 `clicked`、`not_clicked` 或 `unknown`；
6. 激活后断连、超时或无法确认点击结果一律视为未知付款结果。

Python 不能自行创建、延长或复用 Permit。

## 9. Python 执行器

建议建立独立同级目录或项目，不把 Python 付款代码写进 `sub2api/`。入口脚本只运行串行领取循环，例如：

```text
python -m membership_payment_executor
```

每个任务必须：

1. 创建全新临时 `user-data-dir`；
2. 启动全新可视 Chrome/Chromium 进程并使用服务器私有 Xvfb；
3. 将 Session token 本地分片为 allowlist ChatGPT Cookie；
4. 验证浏览器账号与 Go 给出的期望身份一致；
5. 在同一 Session 和网络出口中调用官方 checkout API；
6. 只接受 allowlist 中的 ChatGPT/OpenAI hosted checkout URL；
7. 校验页面合同后按页面实际顺序填写一次性卡资料；首屏只有卡号、有效期和 CVC 时只填卡并等待账单字段出现；
8. 每次危险点击前调用 Permit 接口；
9. 回报脱敏结果；
10. 在 `finally` 中关闭浏览器并删除临时目录。

执行器日志只允许 execution ID、阶段、结构状态、耗时和规范化错误码。禁止记录：

- CDK 全值、Session、Cookie、access token；
- PAN、有效期、CVV、完整账单身份；
- cashier/checkout URL、页面正文、DOM、截图；
- 私有 HTTP credential或 Provider 原始响应。

## 10. 官方付款链接

Python 在浏览器 Session 建立并核验身份后，按 Go 固定的合同调用官方 checkout API。首阶段参数继续使用已经验证的固定合同：

```text
billing_details.country = PH
billing_details.currency = PHP
checkout_ui_mode = hosted
entry_point = all_plans_pricing_modal
```

Python 不得从任务内容接收任意 URL、选择其他国家/币种或修改目标套餐。响应解析必须是严格的版本化结构解析，只允许受支持的 hosted URL 或 `openai_llc/{oaics_*,cs_*}` 路由；未知包装、未知 processor、未知域名或路径立即停止。

`PAYMENT_CARD_ENTRY_READY` 只表示卡片输入控件、静态提交控件和套餐/币种/金额合同已识别，但账单字段尚未出现。无扣款预检可在此结束；真实付款任务只可填写卡片并等待结构变化。该状态不得申请 progression 或 submit Permit，只有重新识别为完整的付款 progression/final 状态后才能进入动作流程。

## 11. 失败、重试和挑战

### 11.1 自动重试

只有同时证明以下三项时允许自动重试同一阶段：

- 最终付款控件未激活；
- 权威订阅未变化；
- 卡台无新有效交易且无 pending 授权。

最多三次，使用退避时间并创建新的 Attempt、租约、浏览器和材料 Grant。不得重新开卡或充值，不得更换订单。

### 11.2 禁止自动重试

以下情况直接进入对账或人工处理：

- submit/progression Permit 已激活但结果不清楚；
- 点击、页面跳转、浏览器、进程或租约丢失；
- 卡台出现任何新授权；
- 明确 `declined`；
- 会员变化与卡台交易不一致；
- 页面结构或 checkout API 合同变化。

明确拒付也不能自动换卡或重付。管理员之后若基于证据批准继续，只能在原订单创建新的 Attempt。

### 11.3 验证挑战

付款前 Cloudflare/CAPTCHA 可进入私有 noVNC 人工处理。处理后 Python 必须重新识别允许页面，不能因为人工确认直接继续。

付款提交后的 3DS、短信或银行验证同样最多占用五分钟。人工完成后 Python 不能再次点击付款，只能结束动作阶段并让 Go 查询订阅及卡台交易。

五分钟到期或页面上下文丢失时关闭浏览器并释放队列。是否允许重试完全由证据决定；未知结果绝不重建页面重付。

## 12. 双证据与对账

每个付款阶段都需要：

1. ChatGPT 权威查询确认该阶段预期会员；
2. 预提交卡台授权快照之后，恰好出现一笔金额/币种/商户匹配且非 declined 的新授权。

`pending` 授权加正确会员可作为临时付款确认：系统立即执行最终续费保护并可向客户投影成功，但后台继续追踪结算。后续 reversal、decline 或 refund 转人工异常，不自动补付。

付款后立即对账，并在约 5 分钟、1 小时和 24 小时继续检查。24 小时仍没有双证据时转人工；整个窗口内不自动重付。

## 13. 客户与后台界面

客户仅看到：

- 排队处理中；
- 正在检查账号；
- 正在开通会员；
- 等待重新提交 Session；
- 等待人工处理；
- 开通成功；
- 开通失败。

后台增加：

- 串行队列位置、优先级、等待时间和当前五分钟截止时间；
- execution、stage、attempt、adapter version、lease epoch；
- 脱敏页面事实、错误码、重试次数和对账检查点；
- Session 恢复、挑战介入、人工插队和批准记录；
- Payment Gate、无扣款验证、Plus/x5/x20 Canary及自动范围。

任何界面都不得显示完整卡资料、Session、Cookie、付款链接或原始响应。

## 14. 现有实现必须修改的行为

实施时必须显式处理以下差异：

- 现有 Go 内部 `ChromeExecutor` 改为调用串行 Python 执行队列；Go 仍实现 `checkout.Executor` 业务边界。
- 起始资格从“free 或部分 delinquent 可重购”收紧为仅 `free + auto-renew=false`。
- `money_boundary_at` 必须最早在具体卡片预留时设置，而非等到充值或 submit。
- 明确的资金边界前 Session 无效自动取消旧单并恢复 CDK；跨界后新增原单 Session 恢复入口。
- `browser_fulfillment_lease` 继续作为全局单例租约，但 owner 改为 Python execution，而非 Go 内部 Chrome。
- 材料 Grant 的 installation binding 改为 Python executor identity，保留 nonce、epoch、stage、attempt和 adapter version 绑定。
- 新 adapter version 不得复用 `go-session-api-checkout-v2` 或 `checkout-v1` 的验证、Canary 或自动范围。
- 客户成功投影仍只来自 Renewal-Safe Completion，不能来自 Python 结果。

建议新 adapter version：

```text
python-session-card-checkout-v1
```

## 15. 验收测试

### 15.1 单元测试

- 起始门禁只接受 `free + auto-renew=false`；
- 取消响应后未复查不能继续；
- 资金边界的五类触发均不可逆；
- 队列优先级、FIFO 和人工插队审计；
- 五分钟硬截止不可通过 heartbeat 延长；
- Permit绑定、单次激活、重复请求和 revision 冲突；
- 双证据、pending 临时确认和 24 小时检查点；
- Session 前后边界的不同恢复规则。

### 15.2 Go/Python 合同测试

- 无任务返回 `204`；
- 同时两个 lease 请求最多一个成功；
- 过期/错误 epoch、stage、attempt、adapter或 token 全部拒绝；
- 材料 nonce 只能读取一次且响应 `no-store`；
- 日志捕获器中不出现任何敏感测试值；
- Permit 激活后连接断开进入未知结果；
- Python 结果不能直接写 `COMPLETED`。

### 15.3 浏览器 fixture

- Session Cookie 分片和身份匹配；
- hosted/custom checkout URL allowlist；
- Plus、x5、x20 页面结构与金额合同；
- 多步表单 progression 与 submit 分离；
- 卡片字段先于账单字段出现时只填卡、等待账单字段，且中间状态不能获得 Permit；
- Cloudflare/CAPTCHA、3DS/SMS/bank challenge；
- 超时、崩溃、页面丢失和临时目录清理；
- 两个阶段不复用浏览器或 Cookie Store。

### 15.4 端到端模拟

- Plus 完整成功；
- x5/x20 两阶段完整成功；
- 起始续费取消后等待 `free`；
- 资金边界前 Session 失效并释放 CDK；
- 跨界后同账号 Session 恢复；
- transient、declined、pending、unknown、refund和 reversal；
- 三次预提交失败后转人工；
- 24 小时证据窗口使用可控时钟验证，不实际等待。

测试不得调用真实开卡、充值或付款接口。

## 16. 上线 Gate

1. 新 adapter 默认禁用真实付款；
2. 完成全部单元、合同、fixture 和模拟端到端测试；
3. 完成不取卡、不扣款的官方链接和页面验证；
4. 管理员逐单批准 Plus Canary，并完成双证据、续费保护和最终结算；
5. 之后依次完成 x5、x20 Canary；
6. 三个档位的资格分别记录，互不继承；
7. 管理员另行启用新的串行自动范围。

部署、服务启动或旧 adapter 已通过验证，都不能自动开启真实付款。
