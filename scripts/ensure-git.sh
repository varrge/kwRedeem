#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"
}

REMOTE_URL="${KAWANG_GIT_REMOTE_URL:-https://github.com/varrge/kwRedeem.git}"
BRANCH="${KAWANG_GIT_BRANCH:-main}"

if ! command -v git >/dev/null 2>&1; then
  log "缺少 git，已跳过 Git 环境初始化；后台在线更新将不可用。"
  exit 0
fi

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  log "当前目录不是 Git 仓库，正在初始化 Git 环境..."
  git init
fi

if git remote get-url origin >/dev/null 2>&1; then
  git remote set-url origin "$REMOTE_URL"
else
  git remote add origin "$REMOTE_URL"
fi

git fetch origin "$BRANCH" --prune
git symbolic-ref HEAD "refs/heads/$BRANCH"
git reset --hard "origin/$BRANCH" >/dev/null
git branch --set-upstream-to="origin/$BRANCH" "$BRANCH" >/dev/null 2>&1 || true

log "Git 环境已就绪：$BRANCH -> origin/$BRANCH"
