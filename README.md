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
