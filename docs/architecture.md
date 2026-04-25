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
- `{{publicKey}}`
- `{{orderNo}}`
- `{{sessionRaw}}`
- `{{session.user.email}}`
- `{{siteName}}`
- `{{siteSlug}}`

验证与提交阶段都可用 `success_rule` / `failure_rule` 基于 HTTP 状态、响应文本或 JSON Path 做成功判断。

## 安全说明

- 原始卡密使用 AES-256-GCM 加密后落库
- 用户提交的 session 也会加密存储
- 前台只展示混淆后的 `publicKey`
- 后台操作会写入 `admin_audit_logs`
