#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_DIR="$ROOT_DIR/check-cx"
ENV_FILE="$APP_DIR/.env.production"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"
}

run_or_explain() {
  set +e
  "$@"
  local code=$?
  set -e
  if [ "$code" -eq 137 ]; then
    log "命令被系统杀死（137），通常是服务器内存不足。可加 2G swap 后重试，或在更大内存机器上构建。"
  fi
  return "$code"
}

ensure_build_memory() {
  if command -v free >/dev/null 2>&1; then
    free -h | sed 's/^/[memory] /'
  fi
}

if ! command -v git >/dev/null 2>&1; then
  log "缺少 git，无法初始化 check-cx 子模块。"
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  log "缺少 node，无法部署 check-cx。"
  exit 1
fi

NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
if [ "$NODE_MAJOR" -lt 20 ]; then
  log "当前 Node.js 版本是 $(node -v)，check-cx 要求 Node.js 20+。"
  exit 1
fi

if ! command -v pm2 >/dev/null 2>&1; then
  log "缺少 pm2，无法启动 check-cx。"
  exit 1
fi

cd "$ROOT_DIR"
log "初始化 check-cx 子模块..."
git submodule update --init --recursive check-cx

if [ ! -d "$APP_DIR" ]; then
  log "check-cx 子模块目录不存在：$APP_DIR"
  exit 1
fi

if [ -f "$ENV_FILE" ]; then
  log "加载环境变量：$ENV_FILE"
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

if [ -z "${SUPABASE_URL:-}" ] || [ -z "${SUPABASE_PUBLISHABLE_OR_ANON_KEY:-}" ] || [ -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ]; then
  log "缺少 Supabase 环境变量。请在 check-cx/.env.production 配置 SUPABASE_URL、SUPABASE_PUBLISHABLE_OR_ANON_KEY、SUPABASE_SERVICE_ROLE_KEY。"
  exit 1
fi

export NODE_ENV=production
export HOSTNAME="${HOSTNAME:-0.0.0.0}"
export PORT="${CHECK_CX_PORT:-${PORT:-3001}}"
export CHECK_NODE_ID="${CHECK_NODE_ID:-kwredeem-check-cx-1}"
export CHECK_POLL_INTERVAL_SECONDS="${CHECK_POLL_INTERVAL_SECONDS:-60}"
export CHECK_CONCURRENCY="${CHECK_CONCURRENCY:-5}"
export HISTORY_RETENTION_DAYS="${HISTORY_RETENTION_DAYS:-30}"
export OFFICIAL_STATUS_CHECK_INTERVAL_SECONDS="${OFFICIAL_STATUS_CHECK_INTERVAL_SECONDS:-300}"
export NEXT_TELEMETRY_DISABLED=1
export NEXT_DISABLE_STANDALONE="${NEXT_DISABLE_STANDALONE:-1}"
export NODE_OPTIONS="${CHECK_CX_NODE_OPTIONS:-${NODE_OPTIONS:---max-old-space-size=768}}"

cd "$APP_DIR"
ensure_build_memory
log "准备 pnpm..."
corepack enable
corepack prepare pnpm@10.10.0 --activate

log "安装 check-cx 依赖..."
run_or_explain pnpm install --frozen-lockfile --child-concurrency=1

log "构建 check-cx... NODE_OPTIONS=$NODE_OPTIONS NEXT_DISABLE_STANDALONE=$NEXT_DISABLE_STANDALONE"
run_or_explain pnpm build

log "重启 PM2 服务 check-cx，端口：$PORT"
pm2 delete check-cx >/dev/null 2>&1 || true
pm2 start pnpm --name check-cx --cwd "$APP_DIR" -- start
pm2 save

log "check-cx 部署完成。"
