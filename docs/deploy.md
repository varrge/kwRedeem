# KaWang 部署说明

## 环境要求

- Linux 服务器
- Node.js 20+
- npm 10+
- Nginx

当前默认使用本地 SQLite 数据库文件，适合单机部署和快速验证。若后续并发上升，可替换为独立数据库并扩展任务队列。

## 首次部署

```bash
cd other/KaWang
cp config/.env.example .env
```

修改 `.env` 中至少这些值：

```env
PORT=4300
APP_URL=https://your-web-domain.example.com
ADMIN_URL=https://your-admin-domain.example.com
API_URL=https://your-api-domain.example.com
JWT_SECRET=replace-with-a-strong-random-secret
ADMIN_USERNAME=admin
ADMIN_PASSWORD=change-this-password
```

然后执行：

```bash
bash scripts/bootstrap.sh
node scripts/check.js
```

## 启动方式

### API

```bash
bash scripts/start-api.sh
```

### Worker

```bash
bash scripts/start-worker.sh
```

### Web / Admin

开发或单机验证可直接执行：

```bash
bash scripts/start-web.sh
bash scripts/start-admin.sh
```

正式环境建议让 Nginx 直接托管 `web/` 和 `admin/` 静态目录。

## 首次进入后台后的初始化顺序

1. 打开 `http://127.0.0.1:4174`
2. 使用 `.env` 中的 `ADMIN_USERNAME` / `ADMIN_PASSWORD` 登录
3. 进入 `网站管理`，新增目标网站的两个外部接口：
   - 验证卡密 API
   - 提交 Session API
4. 进入 `卡密管理`，选择网站后再导入原始卡密并设置混淆前缀
5. 让用户在前台使用混淆后的 `publicKey` 发起验证和兑换

如果只是本地验证流程，`npm run db:init` 已经自动写入一个默认演示网站，直接导卡即可测试。

## pm2 示例

```bash
pm2 start api/src/server.js --name kawang-api
pm2 start worker/src/worker.js --name kawang-worker
```

## Nginx 参考

### 前台

```nginx
server {
  listen 80;
  server_name your-web-domain.example.com;

  root /path/to/other/KaWang/web;
  index index.html;

  location / {
    try_files $uri $uri/ /index.html;
  }
}
```

### 后台

```nginx
server {
  listen 80;
  server_name your-admin-domain.example.com;

  root /path/to/other/KaWang/admin;
  index index.html;

  location / {
    try_files $uri $uri/ /index.html;
  }
}
```

### API

```nginx
server {
  listen 80;
  server_name your-api-domain.example.com;

  location / {
    proxy_pass http://127.0.0.1:4300;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

## 回滚与排障

- 检查 API：`curl http://127.0.0.1:4300/healthz`
- 检查后台页签：`curl http://127.0.0.1:4174`
- 检查网站配置：登录后台后确认“网站管理”能看到默认 `Demo Website` 或你自己新增的网站
- 检查数据库：确认 `data/kawang.db` 是否已生成
- 检查 worker：确认 `activation_jobs` 的 `updated_at` 在变化
- 检查前后台跨域：确认 `.env` 中的 `APP_URL`、`ADMIN_URL` 与实际域名一致
