#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"
}

if ! command -v git >/dev/null 2>&1; then
  log "缺少 git，无法在线更新。"
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  log "缺少 npm，无法安装依赖。"
  exit 1
fi

if ! command -v pm2 >/dev/null 2>&1; then
  log "缺少 pm2，无法重启线上服务。"
  exit 1
fi

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  log "当前目录不是 Git 仓库，无法使用在线更新。"
  exit 1
fi

CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [ "$CURRENT_BRANCH" = "HEAD" ]; then
  log "当前处于 detached HEAD 状态，请切换到可跟踪远端的分支后再更新。"
  exit 1
fi

UPSTREAM="$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null || true)"
if [ -z "$UPSTREAM" ]; then
  log "当前分支没有配置 upstream，无法判断远端更新。"
  exit 1
fi

BACKUP_DIR="${KAWANG_BACKUP_DIR:-/www/backup}"
if ! mkdir -p "$BACKUP_DIR" 2>/dev/null; then
  BACKUP_DIR="$ROOT_DIR/backups"
  mkdir -p "$BACKUP_DIR"
fi

STAMP="$(date '+%Y%m%d-%H%M%S')"
log "开始在线更新，分支：$CURRENT_BRANCH，远端：$UPSTREAM"

if [ -f "data/kawang.db" ]; then
  cp "data/kawang.db" "$BACKUP_DIR/kawang-$STAMP.db"
  log "已备份数据库：$BACKUP_DIR/kawang-$STAMP.db"
fi

for suffix in "-wal" "-shm"; do
  if [ -f "data/kawang.db$suffix" ]; then
    cp "data/kawang.db$suffix" "$BACKUP_DIR/kawang-$STAMP.db$suffix"
    log "已备份数据库附属文件：$BACKUP_DIR/kawang-$STAMP.db$suffix"
  fi
done

log "拉取远端信息..."
git fetch --prune

LOCAL_COMMIT="$(git rev-parse HEAD)"
REMOTE_COMMIT="$(git rev-parse "$UPSTREAM")"
if [ "$LOCAL_COMMIT" = "$REMOTE_COMMIT" ]; then
  log "当前已是最新版本：$LOCAL_COMMIT"
else
  if ! git diff --quiet || ! git diff --cached --quiet; then
    STASH_MESSAGE="kawang-online-update-$STAMP"
    log "检测到本地代码改动，更新前自动暂存到 Git stash：$STASH_MESSAGE"
    git status --short
    git stash push -m "$STASH_MESSAGE"
    log "本地改动已暂存。更新完成后如需查看：git stash list；如需恢复：git stash pop"
  fi

  log "更新代码：$LOCAL_COMMIT -> $REMOTE_COMMIT"
  git pull --ff-only
fi

log "安装依赖..."
npm install

log "初始化或迁移数据库..."
npm run db:init

log "生成前后台运行时配置..."
npm run config:runtime

log "重启 Worker..."
pm2 restart kawang-worker

log "重启 API..."
pm2 restart kawang-api

log "在线更新完成。"
