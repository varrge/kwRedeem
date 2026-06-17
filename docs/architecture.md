# KaWang 架构说明

## 核心流程

1. 后台导入原始卡密，系统为每条卡密生成带前缀的 `publicKey`
2. 每条卡密绑定一个 `site`，该网站持有“验证卡密 API”和“提交 session API”配置
3. 用户在前台输入 `publicKey` 做卡密校验，前台始终只请求 KaWang 自己的 API
4. KaWang API 先在本地校验卡密状态，再按 `site.verify_api_url` 转发验证请求
5. 用户提交 session JSON，API 做格式校验后创建订单与激活任务
6. Worker 按卡密绑定的 `site.submit_api_url` 异步请求外部激活接口
5. 成功则核销卡密，失败则进入自动重试或后台人工重试

## 数据模型

- `sites`：网站配置，包含验证 API、提交 API、模板、认证与重试参数
- `products`：兼容层占位商品，用于承接历史结构和前台展示
- `activation_endpoints`：兼容层提交通道，内部由 `site` 同步维护
- `cdkey_batches`：导入批次
- `cdkeys`：卡密主体，保存原始卡密密文、公开卡密与 `site_id`
- `redeem_orders`：用户兑换订单，保存 `site_id`
- `activation_jobs`：异步任务队列，保存 `site_id`
- `admin_audit_logs`：后台审计日志

## 后台信息架构

- `仪表盘`：查看网站数、卡密数、进行中任务和最近日志
- `网站管理`：新增或更新目标网站 API 配置
- `卡密管理`：按网站批量导卡、单张补卡、卡密批量状态操作
- `任务中心`：查看订单和任务状态，重试失败任务
- `日志`：轮询查看后台操作与任务审计
- `通知监听`：自定义 API 轮询监听 + 飞书 Webhook 通知（见下文）

## Sub2api 集成边界

- `sub.vsakura.top` 是远程官方 Sub2api 服务。
- `api.vsakura.top` 是本项目 API 服务，负责保存并使用远程 Sub2api admin key。
- 本仓库内的 `sub2api/` 仅作为官方项目参考，不作为本项目功能改动目标；除非明确要求，不修改该目录。
- 本项目需要对接 Sub2api 时，应在 `api/`、`shared/`、`web/` 或 `admin/` 内实现系统逻辑，再由本项目 API 使用 admin key 调用远程官方 Sub2api。
- 邀请码/兑换码生成应走远程官方 admin 接口，例如 redeem-code generate 的 invitation 类型；不要改成本地用户 token 或 `/api/v1/user/aff` 流程。
- 官方返回的邀请码字段可能是 `data[].code` 或被成功/幂等响应包装后嵌套返回，解析逻辑不能只认 `inviteCode`。

## 世界杯系统集成

- 世界杯竞猜系统内嵌在本项目中，不写入本地 `sub2api/`。
- 竞猜扣余额应由本项目 API 业务层发起，按已配置的远程 Sub2api admin-key 集成路径处理。
- 排查“提交竞猜但额度没扣”时，优先检查 `api.vsakura.top` 的部署代码、运行日志、远程 Sub2api 调用结果与事务状态；本地修改需要部署/重启后才会影响线上。
- 世界杯比赛列表需要提供筛选能力，并使用可滚动列表承载较多比赛。

## 状态流转

### 卡密

- `active`：可正常兑换
- `locked`：已创建订单，等待激活结果
- `used`：激活成功，已核销
- `disabled`：后台禁用
- `void`：后台作废

### 任务

- `pending`：待执行或待重试
- `processing`：被 worker 锁定并处理
- `succeeded`：执行成功
- `failed`：执行失败且已达到最大重试次数

## 网站模板变量

`site.verify_*` 与 `site.submit_*` 都支持模板渲染。常用变量：

- `{{sourceKey}}`
- `{{normalizedSourceKey}}`
- `{{publicKey}}`
- `{{orderNo}}`
- `{{sessionRaw}}`
- `{{sessionString}}`
- `{{session.user.email}}`
- `{{siteName}}`
- `{{siteSlug}}`

其中 `{{sessionRaw}}` 会插入 session 的原始 JSON 片段，适合远端字段本身就是对象；`{{sessionString}}` 会插入带转义的 JSON 字符串，适合远端字段类型是 `String` 但内容仍需承载 session JSON。

验证与提交阶段都可用 `success_rule` / `failure_rule` 基于 HTTP 状态、响应文本或 JSON Path 做成功判断。

## 通知监听系统

- 数据模型：
  - `notification_settings`：单行 `id='default'`，保存全局飞书 Webhook
  - `notification_monitors`：每条监听项，含请求配置、轮询间隔（1-3600 秒）、监听字段、触发规则、Webhook 覆盖、冷却时间、运行状态
  - `notification_events`：监听执行/匹配/发送事件流水
- 流程：管理员在后台「通知监听」配置 API 监听项与触发规则；Worker 每秒检查 `next_run_at` 到期的监听项，按 `enabled + 锁` 抢占并执行，命中规则后通过飞书 Webhook 发送 Markdown 卡片，并把执行结果写入 `notification_events`。
- 触发规则：每条规则形如 `{ fieldPath, operator, expectedValue }`，运算符支持 `equals / not_equals / contains / not_contains / gt / gte / lt / lte / exists / not_exists`，多条规则之间可选 `all`（全部命中）或 `any`（任一命中）。
- 飞书 Webhook：默认使用 `notification_settings.global_feishu_webhook`，监听项可单独覆盖；消息格式为 `interactive` 卡片 + `markdown` 元素，包含监听名称、接口、命中规则与监听字段当前值。

## 安全说明

- 原始卡密使用 AES-256-GCM 加密后落库
- 用户提交的 session 也会加密存储
- 前台只展示混淆后的 `publicKey`
- 后台操作会写入 `admin_audit_logs`
