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

## 会员自动化 Module

`modules/kwMembership` 与 Node 主项目由同一个 Git commit 管理。后台“系统更新”会统一构建 Go Worker、迁移共享 SQLite、部署 Python Executor，并在版本和心跳检查通过后解除维护模式。

生产服务器首次启用时，需要由 root 安装一次 systemd、独立环境文件和受限部署权限。已有旧环境文件时执行：

```bash
cd /var/local/1panel/apps/openresty/openresty/www/sites/key/index
sudo \
  KWMEMBERSHIP_USER=<运行 kwRedeem 的 Unix 用户> \
  KWMEMBERSHIP_SOURCE_ENV_FILE=/opt/kwmembership/.env \
  bash modules/kwMembership/scripts/install-systemd.sh
```

主仓库可以位于任意绝对路径；安装器会从当前 `modules/kwMembership` 自动识别 kwRedeem 根目录。本服务器的主仓库是 `/var/local/1panel/apps/openresty/openresty/www/sites/key/index`，而 `/opt/kwmembership` 只是 systemd 使用的隔离运行副本。

全新安装时，先基于 `modules/kwMembership/.env.example` 创建仅 root 和运行用户可读的临时环境文件，再通过 `KWMEMBERSHIP_SOURCE_ENV_FILE` 传给安装器。安装完成后密钥保存在 `/etc/kwmembership.env`；后续无需 root 登录，后台“在线更新”只获准调用固定的 `/usr/local/sbin/kawang-membership-deploy`。

Go 和 Python 仍分别运行在 `kwmembership-worker.service` 与 `kwmembership-python-executor.service`，不进入 PM2。付款 Gate 和 `KWMEMBERSHIP_LIVE_PAYMENT_ENABLED` 不会被系统更新自动开启。
