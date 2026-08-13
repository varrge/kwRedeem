import fs from "node:fs";
import { env, resolveProjectPath } from "../shared/src/env.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

try {
  assert(env.port > 0, "PORT 配置无效");
  assert(env.jwtSecret && env.jwtSecret.length >= 12, "JWT_SECRET 太短");
  assert(env.adminUsername, "ADMIN_USERNAME 未配置");
  assert(env.adminPassword, "ADMIN_PASSWORD 未配置");

  const dbDir = resolveProjectPath(env.databasePath);
  const parentDir = dbDir.includes("/") ? dbDir.slice(0, dbDir.lastIndexOf("/")) : dbDir;
  assert(fs.existsSync(resolveProjectPath("web", "index.html")), "缺少 web/index.html");
  assert(fs.existsSync(resolveProjectPath("admin", "index.html")), "缺少 admin/index.html");
  assert(fs.existsSync(resolveProjectPath("api", "src", "server.js")), "缺少 API 服务入口");
  assert(fs.existsSync(resolveProjectPath("worker", "src", "worker.js")), "缺少 Worker 服务入口");
  assert(fs.existsSync(resolveProjectPath("modules", "kwMembership", "go.mod")), "缺少 kwMembership Go Module");
  assert(fs.existsSync(resolveProjectPath("modules", "kwMembership", "python_executor", "__main__.py")), "缺少 kwMembership Python Executor");
  assert(fs.existsSync(parentDir), "数据库目录不存在，请先执行 npm run db:init");

  console.log("KaWang 检查通过。");
} catch (error) {
  console.error(`检查失败: ${error.message}`);
  process.exit(1);
}
