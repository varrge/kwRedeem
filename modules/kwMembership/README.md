# kwMembership

kwRedeem 内部的会员自动化 Module。源码位于 `modules/kwMembership`，与 Node 主项目由同一个 Git commit 管理；运行时仍由独立的 Go Worker 和 Python Executor 直接读写 kwRedeem 的 SQLite/WAL 数据库，不创建第二套会员数据库。

Go worker 负责：

- 自动发现会员订单、校验 Session，并幂等创建履约；
- 会员资格检查、账号串行锁、库存同步与卡片选择；
- 为每个付款阶段签发不可变命令、材料领取和危险动作 Permit，并通过本机协议交给 Python 执行器；
- 资金准备、付款状态推进、未知结果对账与续费保护；
- 将状态、错误码、版本、心跳和 Tick 直接写回 kwRedeem 数据库。

kwRedeem 的 Node API 保留客户入口、Session 恢复、后台展示、配置和 Webhook。Go 是唯一工作流所有者；Python 只串行执行 Go 已授权的浏览器步骤，不能写业务状态或决定重试。当前默认仅启用无扣款 fixture，真实付款保持关闭。

## 本地运行教程

先初始化 kwRedeem 数据库，并确认它自己的 `.env` 已配置 `DATABASE_PATH` 和非默认 `JWT_SECRET`：

```bash
cd /Users/varrge/workspace/kwRedeem
npm install
npm run db:init
```

只有使用 `legacy-go` 诊断模式时才需要 Go 直接发现 Chrome。默认 Python fixture 不启动付款浏览器；live 模式由 Python Playwright 启动独立浏览器：

```bash
google-chrome --version || chromium --version
```

然后构建 Go worker：

```bash
cd /Users/varrge/workspace/kwRedeem/modules/kwMembership
cp .env.example .env
# 默认 KAWANG_PROJECT_ROOT=../..，指向当前 kwRedeem 根目录
bash scripts/build.sh
bash scripts/check.sh
bash scripts/start-worker.sh
KWMEMBERSHIP_EXECUTOR_SECRET=<与 .env 相同的随机密钥> python3 -m python_executor
```

`scripts/check.sh` 会确认它打开的是 kwRedeem 数据库且共享表完整；只有 `legacy-go` 模式会启动一次 `about:blank` Chrome 自检。检查不会获取订单或执行付款。

启动 kwRedeem API 后，进入“会员履约 → 实施状态”，应看到：

```text
运行主体：go
状态：运行中
最近心跳：持续更新
最近 Tick：持续更新
```

## 数据与密钥

kwMembership 的 `.env` 只需要指向 kwRedeem：

```dotenv
KAWANG_PROJECT_ROOT=../..
KWMEMBERSHIP_CHECKOUT_EXECUTOR=python
KWMEMBERSHIP_EXECUTOR_LISTEN=127.0.0.1:4312
KWMEMBERSHIP_EXECUTOR_SECRET=<至少 32 位的独立随机密钥>
KWMEMBERSHIP_PYTHON_EXECUTOR_MODE=fixture
KWMEMBERSHIP_LIVE_PAYMENT_ENABLED=false
# 可选：只代理 EfunCard Open API，不影响其他上游请求
KWMEMBERSHIP_EFUNCARD_PROXY_URL=http://127.0.0.1:7890
```

Go 会从该目录的 `.env` 读取：

- `DATABASE_PATH`：同一个 `data/kawang.db`；
- `JWT_SECRET`：解密 kwRedeem 已保存的 Session、Provider 凭据和资金意图；
- `MAINTENANCE_PATH`、`WORKER_POLL_MS`、`DEFAULT_REQUEST_TIMEOUT_MS`、`API_URL`。

Go/Python 私有协议只监听回环 IP，并使用独立 Bearer 密钥。命令表不保存 Session、Cookie、PAN、CVV、付款链接或原始页面内容。

`npm run db:init` 会在共享数据库中持久化首次启用 Go Intake 的时间水位线。每条由 Go Intake 创建或在升级后由管理员明确单笔补建的履约，还会记录 `automation_enrolled_at`。所有 Go、Python 和兼容 Node 执行队列都只领取已纳入自动化的履约；升级前已经存在的记录一律保持未纳入，不会在部署或重启时批量回放。

## 生产部署

主仓库源码与隔离的运行目录例如：

```text
/var/local/1panel/apps/openresty/openresty/www/sites/key/index
/opt/kwmembership
```

在 kwMembership 的 `.env` 使用绝对路径：

```dotenv
KAWANG_PROJECT_ROOT=/var/local/1panel/apps/openresty/openresty/www/sites/key/index
KWMEMBERSHIP_CHECKOUT_EXECUTOR=python
KWMEMBERSHIP_EXECUTOR_LISTEN=127.0.0.1:4312
KWMEMBERSHIP_EXECUTOR_SECRET=<至少 32 位的独立随机密钥>
```

使用与 kwRedeem 相同的 Unix 用户进行一次 root 安装，以保证两边可以安全访问同一个 SQLite/WAL 文件，并为后台更新安装固定的受限部署助手：

```bash
sudo \
  KWMEMBERSHIP_USER=<kwRedeem运行用户> \
  KWMEMBERSHIP_SOURCE_ENV_FILE=/path/to/prepared-membership.env \
  bash scripts/install-systemd.sh
```

如果旧独立目录已有 `.env`，`KWMEMBERSHIP_SOURCE_ENV_FILE` 可直接指向 `/opt/kwmembership/.env`。安装器会将它以受限权限写入 `/etc/kwmembership.env`，创建 `kwmembership-worker.service`、串行消费者 `kwmembership-python-executor.service`、独立 Python venv，以及 root 所有的 `/usr/local/sbin/kawang-membership-deploy`。

后续更新统一从 kwRedeem 后台“系统更新”执行。命令行等价入口是：

```bash
cd /var/local/1panel/apps/openresty/openresty/www/sites/key/index
bash scripts/update.sh
```

```text
https://apikey.vsakura.top/api/webhooks/spacexcard/card-transactions
```

付款 Gate 默认关闭。新适配器版本为 `python-session-card-checkout-v1`。Go 先检查订阅；发现自动续费时取消并重新查询，只有明确的 `free + auto-renew=false` 才继续。之后 Go 选择卡片、写资金边界、签发命令和 Permit；Python 通过本机协议一次领取 Session 和卡材料并返回结构化事实。`fixture` 使用假页面完成无扣款合同测试；`preflight` 使用真实 Playwright 浏览器打开并验证付款页，但遇到 payment 命令会以 `PREFLIGHT_PAYMENT_DISABLED` 失败关闭，而且不需要启用 `KWMEMBERSHIP_LIVE_PAYMENT_ENABLED`；`live` 适配器才允许受控真实付款，仍需要显式设置 live 模式和上线 Gate，且不会绕过 Go 的付款 Gate、Permit 或未知结果对账。

Live 执行器依赖 Playwright。只在专用执行器主机安装依赖，不要在开发机打开真实付款：

```bash
python3 -m pip install -r python_executor/requirements.txt
python3 -m playwright install chromium
```

### 私有虚拟显示与安全验证

生产服务器使用 Xvfb 是因为 ChatGPT 对同一份有效 Session 接受普通 Chrome、但拒绝严格 headless Chrome。这个模式仍然是无人值守自动化：正常流程不需要管理员打开窗口，也不需要账号密码。Xvfb、x11vnc 和 noVNC 必须只监听服务器本机，不能把 5900/6080 端口暴露到公网。

```dotenv
KWMEMBERSHIP_VISIBLE_BROWSER=true
KWMEMBERSHIP_HUMAN_CHALLENGE_TIMEOUT_MS=300000
```

远端 Chrome 代理需要认证时，使用 `KWMEMBERSHIP_CHROME_PROXY_USERNAME` 和
`KWMEMBERSHIP_CHROME_PROXY_PASSWORD` 分开配置；真实凭据只写入服务器的
`/etc/kwmembership.env`，不要提交到仓库或拼进代理 URL。

```bash
ssh -L 6080:127.0.0.1:6080 root@服务器地址
# 本机浏览器打开：
# http://127.0.0.1:6080/vnc.html?autoconnect=true&resize=scale
```

只有 Go 明确认出安全验证页并写入 `CHECKOUT_CHALLENGE_WAIT` 时，管理员才可通过 SSH 隧道访问 noVNC 完成验证。Go 只在重新识别到受支持的结账结构后继续；它不会自动绕过验证，也不会因虚拟显示模式削弱付款 Gate、页面许可或对账边界。

## 自动流程

```text
订单 Session
→ Go 校验账号与库存
→ Go 取消已有自动续费并重新确认 free + auto-renew=false
→ Go 获取卡资料与账单地址，写入串行任务
→ Python 一次领取 Session 和卡材料并校验 Plus / PH / PHP 页面合同
→ 每次可能产生授权的点击前写入 Permit 并快照卡交易
→ 提交后只进入对账，不会因超时盲目重提
→ 确认会员与卡交易后取消自动续费并写回后台
```

每次执行和人工挑战共用固定五分钟硬截止，heartbeat 不能延长。遇到 CAPTCHA、3DS、短信或银行验证时会创建人工介入状态，不尝试绕过安全验证。

### 实验性免托管密码登录预检

只有经管理员明确选中的单笔履约可以进入 `CHECKOUT_LOGIN_READY`。Go 会打开一个全新的可视化无痕窗口并写入 `CHECKOUT_LOGIN_WAIT`；管理员通过上面的 SSH + noVNC 通道直接登录 ChatGPT，并手动进入 Plus 结账页。账号密码、MFA、Passkey 和浏览器 Cookie 不进入 kwRedeem、kwMembership 或普通日志。

Go 只在浏览器内读取当前登录邮箱并与订单身份进行内存比对，然后执行既有的 Plus / PH / PHP / 价格区间和结账结构预检。成功后停在 `CHECKOUT_LOGIN_PREFLIGHT_PASSED`，不会进入 `FUNDING_READY`，不会读取卡资料、准备资金或授权支付。窗口关闭后登录上下文即销毁；该实验结果不能用于生产付款或 Canary 资格。
