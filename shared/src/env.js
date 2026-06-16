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
  apiFootballKey: process.env.API_FOOTBALL_KEY ?? "",
  apiFootballBaseUrl: process.env.API_FOOTBALL_BASE_URL ?? "https://v3.football.api-sports.io",
  apiFootballWorldCupLeagueId: Number(process.env.API_FOOTBALL_WORLDCUP_LEAGUE_ID ?? 1),
  apiFootballWorldCupSeason: Number(process.env.API_FOOTBALL_WORLDCUP_SEASON ?? 2026),
  apiFootballTimezone: process.env.API_FOOTBALL_TIMEZONE ?? "Asia/Shanghai",
  apiFootballDailySoftLimit: Number(process.env.API_FOOTBALL_DAILY_SOFT_LIMIT ?? 80),
  apiFootballDailyHardLimit: Number(process.env.API_FOOTBALL_DAILY_HARD_LIMIT ?? 100),
  apiFootballSyncIntervalMs: Number(process.env.API_FOOTBALL_SYNC_INTERVAL_MS ?? 60000),
  jwtSecret: process.env.JWT_SECRET ?? "replace-with-a-long-random-string",
  adminUsername: process.env.ADMIN_USERNAME ?? "admin",
  adminPassword: process.env.ADMIN_PASSWORD ?? "change-this-password",
  requestTimeoutMs: Number(process.env.DEFAULT_REQUEST_TIMEOUT_MS ?? 15000),
  internalSecret: process.env.INTERNAL_SECRET ?? "",
  workerInternalPort: Number(process.env.WORKER_INTERNAL_PORT ?? 4301)
};

export function resolveProjectPath(...parts) {
  return path.join(projectRoot, ...parts);
}
