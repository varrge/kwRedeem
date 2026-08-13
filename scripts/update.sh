#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

MEMBERSHIP_SOURCE_DIR="$ROOT_DIR/modules/kwMembership"
MEMBERSHIP_ENV_FILE="/etc/kwmembership.env"
MEMBERSHIP_DEPLOY_HELPER="/usr/local/sbin/kawang-membership-deploy"
UPDATE_ID="update-$(date '+%Y%m%d-%H%M%S')-$$"
UPDATE_COMPLETED=0
MAINTENANCE_ENTERED=0
POST_RELEASE_VERIFY=0
UPDATE_RUNTIME="$ROOT_DIR/scripts/update-runtime.js"

run_update_runtime() {
  node "$UPDATE_RUNTIME" "$@"
}

cleanup_update_runtime() {
  if [ "$UPDATE_RUNTIME" != "$ROOT_DIR/scripts/update-runtime.js" ]; then
    rm -f "$UPDATE_RUNTIME"
  fi
}

finish_update() {
  local exit_code=$?
  trap - EXIT
  set +e
  if [ "$UPDATE_COMPLETED" -ne 1 ] && [ "$exit_code" -eq 0 ]; then
    exit_code=1
  fi
  if [ "$UPDATE_COMPLETED" -ne 1 ]; then
    if [ "$POST_RELEASE_VERIFY" -eq 1 ] && [ "$MAINTENANCE_ENTERED" -eq 0 ]; then
      if run_update_runtime enter-maintenance "$UPDATE_ID"; then
        MAINTENANCE_ENTERED=1
        pm2 stop kawang-worker >/dev/null 2>&1 || true
      fi
    fi
    if [ "$MAINTENANCE_ENTERED" -eq 1 ]; then
      run_update_runtime state failed "在线更新失败（退出码 $exit_code）；维护模式保持启用，请检查更新日志"
      log "在线更新失败，维护模式保持启用。排障后重新执行更新或由管理员确认后解除。"
    else
      run_update_runtime state failed "在线更新失败（退出码 $exit_code）；尚未进入维护模式"
      log "在线更新失败，未进入维护模式。"
    fi
  fi
  cleanup_update_runtime
  exit "$exit_code"
}

trap finish_update EXIT

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

NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
if [ "$NODE_MAJOR" -lt 20 ]; then
  log "当前 Node.js 版本是 $(node -v)，本项目要求 Node.js 20+。请升级后再执行 npm install。"
  exit 1
fi

if ! command -v pm2 >/dev/null 2>&1; then
  log "缺少 pm2，无法重启线上服务。"
  exit 1
fi

mkdir -p "$ROOT_DIR/tmp"
UPDATE_RUNTIME="$ROOT_DIR/tmp/update-runtime-$UPDATE_ID.js"
cp "$ROOT_DIR/scripts/update-runtime.js" "$UPDATE_RUNTIME"

bash scripts/ensure-git.sh

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
if ! mkdir -p "$BACKUP_DIR" 2>/dev/null || [ ! -w "$BACKUP_DIR" ]; then
  BACKUP_DIR="$ROOT_DIR/backups"
  mkdir -p "$BACKUP_DIR"
fi

STAMP="$(date '+%Y%m%d-%H%M%S')"
log "开始在线更新，分支：$CURRENT_BRANCH，远端：$UPSTREAM"
run_update_runtime state running

MEMBERSHIP_INSTALLED=0
if [ -x "$MEMBERSHIP_DEPLOY_HELPER" ] && [ -f "$MEMBERSHIP_ENV_FILE" ]; then
  if ! systemctl cat kwmembership-worker.service >/dev/null 2>&1 \
      || ! systemctl cat kwmembership-python-executor.service >/dev/null 2>&1; then
    log "kwMembership systemd 单元缺失，请先重新执行首次安装器。"
    exit 1
  fi
  if ! sudo -n -l "$MEMBERSHIP_DEPLOY_HELPER" >/dev/null 2>&1; then
    log "当前运行用户没有执行固定 kwMembership 部署助手的权限，请重新执行首次安装器。"
    exit 1
  fi
  MEMBERSHIP_INSTALLED=1
elif [ -x "$MEMBERSHIP_DEPLOY_HELPER" ] || [ -f "$MEMBERSHIP_ENV_FILE" ]; then
  log "kwMembership 安装不完整：部署助手和环境文件必须同时存在。"
  exit 1
else
  log "kwMembership Module 尚未首次安装；本次更新源码，但跳过 systemd 部署。"
fi

log "进入维护模式并停止 Node Worker 接收新任务..."
run_update_runtime enter-maintenance "$UPDATE_ID"
MAINTENANCE_ENTERED=1
pm2 stop kawang-worker >/dev/null 2>&1 || true

if [ "$MEMBERSHIP_INSTALLED" -eq 1 ]; then
  log "等待 kwMembership Worker 完成在途 Tick 并进入 standby..."
  run_update_runtime wait-membership-standby
fi

run_update_runtime backup-database "$BACKUP_DIR/kawang-$STAMP.db"
log "已创建并校验 SQLite 备份：$BACKUP_DIR/kawang-$STAMP.db"

log "拉取远端信息..."
git fetch --prune

LOCAL_COMMIT="$(git rev-parse HEAD)"
REMOTE_COMMIT="$(git rev-parse "$UPSTREAM")"
if [ -n "$(git status --porcelain)" ]; then
  STASH_MESSAGE="kawang-online-update-$STAMP"
  log "检测到本地代码改动，更新前自动暂存到 Git stash：$STASH_MESSAGE"
  git status --short
  git stash push --include-untracked -m "$STASH_MESSAGE"
  log "本地改动已暂存。更新完成后如需查看：git stash list；如需恢复：git stash pop"
fi

if [ "$LOCAL_COMMIT" = "$REMOTE_COMMIT" ]; then
  log "当前已是最新版本：$LOCAL_COMMIT"
else
  log "更新代码：$LOCAL_COMMIT -> $REMOTE_COMMIT"
  git pull --ff-only
fi

log "安装依赖..."
npm install

if [ ! -f "$MEMBERSHIP_SOURCE_DIR/go.mod" ] || [ ! -f "$MEMBERSHIP_SOURCE_DIR/python_executor/__main__.py" ]; then
  log "缺少 modules/kwMembership 完整源码，无法执行统一更新。"
  exit 1
fi

if [ "$MEMBERSHIP_INSTALLED" -eq 1 ]; then
  log "构建并检查 kwMembership Module..."
  KWMEMBERSHIP_PROJECT_ROOT="$MEMBERSHIP_SOURCE_DIR" \
  KWMEMBERSHIP_ENV_FILE="$MEMBERSHIP_ENV_FILE" \
  KAWANG_PROJECT_ROOT="$ROOT_DIR" \
  KWMEMBERSHIP_VERSION="$(git rev-parse HEAD)" \
    bash "$MEMBERSHIP_SOURCE_DIR/scripts/build.sh"
fi

log "初始化或迁移数据库..."
npm run db:init

if [ "$MEMBERSHIP_INSTALLED" -eq 1 ]; then
  log "检查迁移后的 kwMembership 共享数据库契约..."
  KWMEMBERSHIP_PROJECT_ROOT="$MEMBERSHIP_SOURCE_DIR" \
  KWMEMBERSHIP_ENV_FILE="$MEMBERSHIP_ENV_FILE" \
  KAWANG_PROJECT_ROOT="$ROOT_DIR" \
    bash "$MEMBERSHIP_SOURCE_DIR/scripts/check.sh"
fi

log "生成前后台运行时配置..."
npm run config:runtime

if [ "$MEMBERSHIP_INSTALLED" -eq 1 ]; then
  log "部署并重启 kwMembership systemd 进程..."
  sudo -n "$MEMBERSHIP_DEPLOY_HELPER"
fi

log "重启服务（PM2）..."
pm2 delete kawang-membership-worker >/dev/null 2>&1 || true
pm2 startOrGracefulReload ecosystem.config.cjs --update-env

if [ "$MEMBERSHIP_INSTALLED" -eq 1 ]; then
  log "验证 kwMembership 已部署版本和 standby 心跳..."
  run_update_runtime wait-membership-deployed "$(git rev-parse HEAD)"
fi

log "退出维护模式..."
run_update_runtime leave-maintenance "$UPDATE_ID"
MAINTENANCE_ENTERED=0
if [ "$MEMBERSHIP_INSTALLED" -eq 1 ]; then
  POST_RELEASE_VERIFY=1
  log "验证 kwMembership 已恢复 active..."
  run_update_runtime wait-membership-active "$(git rev-parse HEAD)"
  POST_RELEASE_VERIFY=0
fi
run_update_runtime state succeeded
UPDATE_COMPLETED=1
cleanup_update_runtime
trap - EXIT
log "在线更新完成。"
