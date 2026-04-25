import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..", "..");

dotenv.config({ path: path.join(projectRoot, ".env") });
dotenv.config({ path: path.join(projectRoot, "config", ".env.example") });

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 4300),
  appUrl: process.env.APP_URL ?? "http://127.0.0.1:4173",
  adminUrl: process.env.ADMIN_URL ?? "http://127.0.0.1:4174",
  apiUrl: process.env.API_URL ?? "http://127.0.0.1:4300",
  databasePath: process.env.DATABASE_PATH ?? "./data/kawang.db",
  workerPollMs: Number(process.env.WORKER_POLL_MS ?? 5000),
  jwtSecret: process.env.JWT_SECRET ?? "replace-with-a-long-random-string",
  adminUsername: process.env.ADMIN_USERNAME ?? "admin",
  adminPassword: process.env.ADMIN_PASSWORD ?? "change-this-password",
  requestTimeoutMs: Number(process.env.DEFAULT_REQUEST_TIMEOUT_MS ?? 15000)
};

export function resolveProjectPath(...parts) {
  return path.join(projectRoot, ...parts);
}
