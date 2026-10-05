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

## 会员自动化

会员付款由本项目的 Node Worker 执行后台“会员自动化”配置的协议任务。自动化站点与付款卡台分别配置；SpaceX Card / EfunCard 凭据继续用于选卡和充值。

旧版 Go / Python 浏览器付款已退役。旧版管理接口不再允许新增履约、开启付款或补单；历史订单、卡片和交易证据保留，后台提供只读履约历史。

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

## 旧版会员安装的升级兼容

已有 `kwmembership-worker.service` / `kwmembership-python-executor.service` 安装通过统一更新器迁移为兼容进程。Go 仅维护版本和心跳，Python 仅等待退出信号，均不领取任务、打开浏览器或付款。这保留了旧版在线更新器的部署与心跳检查契约，也沿用已有固定部署助手的 sudo 权限。首次安装和独立启动入口已关闭，新部署只需 Node API 与 Worker。

更新会先关闭旧版付款 Gate。部署前若发现 `queued`、`leased` 或 `action_required` 的旧结账命令，检查会中止更新并保留维护模式及现有进程，防止中断在途付款；需核对并处理旧命令的真实结果后重试。历史订单和资金证据不会自动清除或重试。

旧 systemd 单元及 `/etc/kwmembership.env` 保留用于升级兼容与历史核对；更新不会要求新的任意 `systemctl` sudo 权限，也不会自动卸载这些文件。
