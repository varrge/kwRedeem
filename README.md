# KaWang

KaWang 是一个独立的卡密兑换项目，覆盖以下能力：

- 卡密导入、混淆与自定义前缀
- 前台卡密校验与 session 提交
- 按网站配置验证 API / 提交 API
- 激活任务重试与后台批量处理
- 非 Docker 的标准部署方式

## 目录

- `web/`：用户前台静态站点
- `admin/`：后台静态站点
- `api/`：Fastify API 服务
- `worker/`：异步任务执行器
- `shared/`：共享常量、模板与数据库工具
- `scripts/`：部署与检查脚本
- `config/`：环境变量模板
- `docs/`：部署与业务说明

## 快速开始

```bash
cd other/KaWang
cp config/.env.example .env
npm install
npm run config:runtime
npm run db:init
npm run start:api
```

另开终端启动：

```bash
npm run start:worker
npm run serve:web
npm run serve:admin
```

默认地址：

- Web: `http://127.0.0.1:4173`
- Admin: `http://127.0.0.1:4174`
- API: `http://127.0.0.1:4300`

## 独立会员自动化模块

会员自动化代码位于独立的同级项目 `../kwMembership`，但它直接使用本项目的 `DATABASE_PATH` 和 `JWT_SECRET`。只有 Go worker 会发现会员订单、校验 Session，并推进履约、库存、资金、自动结账与对账状态；kwRedeem 的 Node worker 不再运行会员自动化。

Go 在本地把订单 Session 生成 ChatGPT Cookie，在服务器私有 Xvfb 中验证身份、查询官方订阅状态，并通过官方 checkout API 创建受白名单约束的 Plus 结账入口；只有卡片与交易资料来自 SpaceXCard OpenAPI。会员流程不需要浏览器扩展、GPT Token、账号密码、旧的 `/#pricing` 套餐按钮或人工打开浏览器。kwRedeem 后台和 Webhook 直接读写同一数据库，因此没有第二套会员库、任务分发或状态回调。后台“会员履约 → 实施状态”显示 Go owner、版本、心跳、最近 Tick 和脱敏错误码。构建、启动和 systemd 部署见 `../kwMembership/README.md`。

## 后台结构

当前后台登录后提供 5 个核心页签：

- `仪表盘`：网站数量、卡密总量、任务状态统计、最近 5 条日志
- `网站管理`：维护外部网站的验证卡密 API 与提交 Session API
- `卡密管理`：单次添加、批量导入、前缀混淆、批量启停/作废
- `任务中心`：订单与异步激活任务，支持失败任务重试
- `日志`：自动轮询刷新审计日志

## 默认演示数据

首次执行 `npm run db:init` 后会生成一套演示网站：

- `site_demo`
- 验证 API: `/api/mock/verify`
- 提交 API: `/api/mock/activate`

可以直接用它验证整条流程，也可以在后台新增自己的网站配置后再导入卡密。

更多细节见 `docs/deploy.md` 与 `docs/architecture.md`。
