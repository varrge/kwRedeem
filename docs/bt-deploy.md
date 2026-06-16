# KaWang 宝塔部署流程

本文档适用于把 `KaWang` 部署到宝塔面板环境。推荐结构是：前台和后台由 Nginx 托管静态文件，API 和 Worker 使用 PM2 常驻运行。

## 1. 环境准备

在宝塔面板安装：

- Nginx
- PM2 管理器
- Node.js 20+
- Git，可选

服务器里确认版本：

```bash
node -v
npm -v
```

要求：

```text
node >= 20
npm >= 10
```

## 2. 上传项目

建议部署目录：

```bash
/www/wwwroot/KaWang
```

下面命令默认使用这个目录。如果你的目录是小写或其他名字，例如 `/www/wwwroot/kawang`，后续所有命令都要替换成你的真实路径。Linux 路径区分大小写。

如果从当前仓库上传，只需要上传：

```bash
other/KaWang
```

上传后目录大致如下：

```text
/www/wwwroot/KaWang
├── admin
├── api
├── config
├── data
├── docs
├── scripts
├── shared
├── web
├── worker
├── package.json
```

## 3. 配置环境变量

进入项目目录：

```bash
cd /www/wwwroot/KaWang
cp config/.env.example .env
```

先确定 3 个真实线上地址。示例：

```text
前台：https://key.vsakura.top
后台：https://adminkey.vsakura.top
API：https://api.vsakura.top
```

编辑 `.env`：

```env
NODE_ENV=production
PORT=4300

APP_URL=https://key.vsakura.top
ADMIN_URL=https://adminkey.vsakura.top
API_URL=https://api.vsakura.top

DATABASE_PATH=./data/kawang.db
WORKER_POLL_MS=5000

JWT_SECRET=replace-with-a-long-random-secret
ADMIN_USERNAME=admin
ADMIN_PASSWORD=replace-with-a-strong-password

DEFAULT_REQUEST_TIMEOUT_MS=15000
```

必须改掉这些默认值：

- `APP_URL`：前台站点域名，必须带 `https://`，不要多写结尾 `/`
- `ADMIN_URL`：后台站点域名，必须和浏览器访问后台的地址完全一致
- `API_URL`：API 站点域名，必须和前后台代码里的 API 地址一致
- `JWT_SECRET`：生产环境随机长字符串
- `ADMIN_PASSWORD`：后台管理员强密码

建议使用 3 个子域名：

```text
https://www.xxx.com      前台
https://admin.xxx.com    后台
https://api.xxx.com      API
```

保存后先确认程序实际读到的值：

```bash
node -e "import('./shared/src/env.js').then(({env}) => console.log({appUrl: env.appUrl, adminUrl: env.adminUrl, apiUrl: env.apiUrl, adminUser: env.adminUsername, adminPassLen: env.adminPassword.length}))"
```

如果这里仍然显示 `127.0.0.1` 或 `change-this-password`，说明 `.env` 没有改对，先不要继续部署。

## 4. 安装依赖并初始化数据库

```bash
cd /www/wwwroot/KaWang
npm install
npm run db:init
npm run check
```

成功后会生成：

```text
data/kawang.db
```

## 5. 使用 PM2 启动服务

在项目目录执行：

```bash
cd /www/wwwroot/KaWang

pm2 start api/src/server.js --name kawang-api
pm2 start worker/src/worker.js --name kawang-worker

pm2 save
pm2 startup
```

如果后续修改了 `.env`，必须使用 `--update-env` 重启，普通重启可能继续使用旧环境：

```bash
pm2 restart kawang-api --update-env
pm2 restart kawang-worker --update-env
```

检查进程：

```bash
pm2 list
```

检查日志：

```bash
pm2 logs kawang-api
pm2 logs kawang-worker
```

检查 API：

```bash
curl http://127.0.0.1:4300/healthz
```

正常会返回：

```json
{"ok":true,"now":"..."}
```

## 6. 宝塔创建站点

### 前台站点

宝塔添加网站：

```text
域名：www.xxx.com
根目录：/www/wwwroot/KaWang/web
```

Nginx 配置确保包含：

```nginx
location / {
    try_files $uri $uri/ /index.html;
}
```

宝塔默认配置里通常已经有一个 `location / { ... }`。不要再新增第二个 `location /`，否则会报：

```text
duplicate location "/" ...
```

正确做法是只保留一个 `location /`，把里面内容改成上面的 `try_files`。

### 后台站点

宝塔添加网站：

```text
域名：admin.xxx.com
根目录：/www/wwwroot/KaWang/admin
```

Nginx 配置：

```nginx
location / {
    try_files $uri $uri/ /index.html;
}
```

同样只允许保留一个 `location /`。

### API 站点

宝塔添加网站：

```text
域名：api.xxx.com
根目录：/www/wwwroot/KaWang
```

修改这个站点的 Nginx 配置，把请求反代到本机 `4300`：

```nginx
location / {
    proxy_pass http://127.0.0.1:4300;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

API 站点也只能保留一个 `location /`。如果宝塔原配置里已经有 `location /`，就把原来的内容替换成上面的反向代理配置，不要额外粘贴一份。

保存 Nginx 配置前，注意 `proxy_pass` 端口必须和 `.env` 里的 `PORT` 一致。本文默认都是 `4300`。

## 7. 配置 HTTPS

在宝塔里分别给以下站点申请 SSL：

```text
www.xxx.com
admin.xxx.com
api.xxx.com
```

建议开启：

- 强制 HTTPS
- HTTP/2

申请完成后，确认 `.env` 中全部使用 `https`：

```env
APP_URL=https://www.xxx.com
ADMIN_URL=https://admin.xxx.com
API_URL=https://api.xxx.com
```

改完 `.env` 后重启服务：

```bash
pm2 restart kawang-api --update-env
pm2 restart kawang-worker --update-env
```

## 8. 确认前后台 API 地址

前台和后台会通过 `runtime-config.js` 读取 `.env` 里的 `API_URL`，不要再手动修改 `web/app.js` 或 `admin/app.js`。

需要确认 `.env` 中已经配置真实 API 域名：

```env
API_URL=https://api.xxx.com
```

如果是宝塔/Nginx 直接托管 `web/` 和 `admin/` 静态目录，改完 `.env` 后需要重新生成运行时配置：

```bash
cd /www/wwwroot/KaWang
npm run config:runtime
```

浏览器中可直接访问以下地址确认返回值：

```text
https://www.xxx.com/runtime-config.js
https://admin.xxx.com/runtime-config.js
```

内容应包含你的 API 域名，例如：

```js
window.KAWANG_CONFIG = Object.freeze({"apiUrl":"https://api.xxx.com"});
```

如果页面仍然请求旧地址，先确认 `runtime-config.js` 已重新生成，再强制刷新页面或清浏览器缓存后重试。

### Sub2api 单独服务器时的嵌入页配置

如果 Sub2api 域名不在 KaWang 服务器上，例如：

```text
key.vsakura.top      KaWang 前台
adminkey.vsakura.top KaWang 后台
api.vsakura.top      KaWang API
sub.vsakura.top      另一台服务器上的 Sub2api
```

`sub.vsakura.top` 下的 `_kwredeem` 嵌入页仍然要读取同路径的 `runtime-config.js`。确认这个地址能访问：

```text
https://sub.vsakura.top/_kwredeem/runtime-config.js
```

内容必须指向 KaWang API：

```js
window.KAWANG_CONFIG = Object.freeze({"apiUrl":"https://api.vsakura.top"});
```

如果这里缺失，`sub2api-worldcup.html`、`sub2api-subscriptions.html`、`sub2api-invites.html` 会把 API 请求发到当前 Sub2api 域名，导致保存/下注/购买等请求失败。

## 9. 宝塔防火墙

放行：

```text
80
443
```

正式环境不建议对公网开放 `4300`。`4300` 只给 Nginx 本机反代使用即可。

## 10. 首次后台初始化

打开：

```text
https://admin.xxx.com
```

使用 `.env` 里的账号密码登录。

登录前建议先在服务器验证一次 API、CORS 和账号密码：

```bash
curl -i -X POST https://api.xxx.com/api/admin/auth/login \
  -H "Origin: https://admin.xxx.com" \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"你的后台密码"}'
```

正常结果应该是：

```text
HTTP/2 200
access-control-allow-origin: https://admin.xxx.com
```

并返回 `token`。如果返回 `401`，说明 `.env` 中 `ADMIN_USERNAME` 或 `ADMIN_PASSWORD` 和你输入的不一致。如果浏览器报 CORS，重点检查 `.env` 中的 `ADMIN_URL` 是否和后台真实域名完全一致，然后执行：

```bash
pm2 restart kawang-api --update-env
```

初始化顺序：

1. 进入 `网站管理`
2. 选择预设站点，或者手动配置目标网站
3. 补完整 `提交 Session API`
4. 确认请求体模板、请求头类型、成功失败规则
5. 把站点状态从 `disabled` 改成 `active`
6. 进入 `卡密管理`
7. 选择 active 网站导入原始卡密
8. 到前台测试验证和兑换流程

## 11. 在线更新功能

后台已经提供 `系统更新` 页签，可以检查 Git 远端版本并触发固定更新脚本。

### 前提条件

在线更新要求服务器上的项目目录必须是 Git 仓库，并且当前分支配置了 upstream。

如果你使用手动上传覆盖方式部署，后台在线更新不可用；建议改成 Git 部署：

```bash
cd /www/wwwroot
git clone 你的仓库地址 KaWang
cd /www/wwwroot/KaWang
```

PM2 进程名称必须固定为：

```text
kawang-api
kawang-worker
```

也就是启动时必须使用：

```bash
pm2 start api/src/server.js --name kawang-api
pm2 start worker/src/worker.js --name kawang-worker
```

### 脚本权限

确认更新脚本可执行：

```bash
cd /www/wwwroot/KaWang
chmod +x scripts/update.sh
```

后台点击 `在线更新` 时，API 会执行固定脚本：

```bash
bash scripts/update.sh
```

脚本会依次执行：

1. 检查 Git 仓库和 upstream
2. 备份 `data/kawang.db`
3. 备份 `data/kawang.db-wal` 和 `data/kawang.db-shm`
4. `git fetch --prune`
5. 如果存在本地代码改动，自动暂存到 Git stash
6. `git pull --ff-only`
7. `npm install`
8. `npm run db:init`
9. `npm run config:runtime`
10. `pm2 restart kawang-worker`
11. `pm2 restart kawang-api`

如果线上曾手动修改过 `web/app.js`、`admin/app.js` 等已纳入 Git 的文件，在线更新会先执行 `git stash push` 保存这些本地改动，再继续拉取远端代码，避免出现 `Your local changes would be overwritten by merge` 后中止。更新日志会记录 stash 名称，后续可用 `git stash list` 查看。

### 备份目录

默认会优先备份到：

```text
/www/backup
```

如果当前用户没有权限写入 `/www/backup`，会自动退回项目内：

```text
/www/wwwroot/KaWang/backups
```

也可以在 PM2 环境变量里指定：

```bash
KAWANG_BACKUP_DIR=/www/backup
```

### 使用流程

1. 打开 `https://admin.xxx.com`
2. 登录后台
3. 进入 `系统更新`
4. 点击 `检查更新`
5. 如果显示有更新，点击 `在线更新`
6. 等待更新日志显示完成
7. 刷新后台和前台页面确认功能正常

### 安全建议

- 后台域名不要公开给普通用户
- 管理员密码必须使用强密码
- 不要把 `4300` 暴露到公网
- 不要允许前端传入任意 shell 命令
- 不要在生产环境频繁点击在线更新
- 更新前确认 Git 远端代码已经在本地测试过

当前实现只允许后台触发固定脚本，不接受任意命令参数。

### 更新失败排障

先在后台 `系统更新` 页签查看更新日志。

再检查 PM2 日志：

```bash
pm2 logs kawang-api
pm2 logs kawang-worker
```

检查 API 是否还在线：

```bash
curl http://127.0.0.1:4300/healthz
```

如果 Git 拉取失败，检查：

```bash
cd /www/wwwroot/KaWang
git status
git branch -vv
git remote -v
git stash list
```

如果 `npm install` 失败，检查 Node 版本：

```bash
node -v
npm -v
```

### 手动恢复

如果更新后业务异常，可以先回滚代码：

```bash
cd /www/wwwroot/KaWang
git log --oneline -5
git reset --hard 上一个commit
npm install
npm run db:init
pm2 restart kawang-worker
pm2 restart kawang-api
```

如果数据库也需要恢复，先停止服务：

```bash
pm2 stop kawang-worker
pm2 stop kawang-api
```

还原备份：

```bash
cp /www/backup/kawang-备份时间.db /www/wwwroot/KaWang/data/kawang.db
```

再启动服务：

```bash
pm2 start kawang-api
pm2 start kawang-worker
```

如果备份在项目内，则路径类似：

```text
/www/wwwroot/KaWang/backups/kawang-备份时间.db
```

## 12. 常用维护命令

查看进程：

```bash
pm2 list
```

重启服务：

```bash
pm2 restart kawang-api
pm2 restart kawang-worker
```

查看日志：

```bash
pm2 logs kawang-api
pm2 logs kawang-worker
```

备份数据库：

```bash
mkdir -p /www/backup
cp /www/wwwroot/KaWang/data/kawang.db /www/backup/kawang-$(date +%F).db
```

更新代码后：

```bash
cd /www/wwwroot/KaWang
npm install
npm run db:init
pm2 restart kawang-api
pm2 restart kawang-worker
```

## 13. 推荐上线结构

```text
https://www.xxx.com      -> /www/wwwroot/KaWang/web
https://admin.xxx.com    -> /www/wwwroot/KaWang/admin
https://api.xxx.com      -> 127.0.0.1:4300

PM2:
  kawang-api             -> api/src/server.js
  kawang-worker          -> worker/src/worker.js

SQLite:
  /www/wwwroot/KaWang/data/kawang.db
```

## 14. 排障检查

API 健康检查：

```bash
curl http://127.0.0.1:4300/healthz
```

前台静态文件：

```bash
curl https://www.xxx.com
```

后台静态文件：

```bash
curl https://admin.xxx.com
```

API 外网反代：

```bash
curl https://api.xxx.com/healthz
```

如果前后台页面能打开，但接口不通，重点检查：

- `https://www.xxx.com/runtime-config.js` 和 `https://admin.xxx.com/runtime-config.js` 是否返回正确的 `API_URL`
- `.env` 中 `APP_URL`、`ADMIN_URL`、`API_URL` 是否为真实 HTTPS 域名
- 宝塔 API 站点是否正确反代到 `127.0.0.1:4300`
- PM2 中 `kawang-api` 是否在线
- 宝塔防火墙是否放行 `80` 和 `443`
