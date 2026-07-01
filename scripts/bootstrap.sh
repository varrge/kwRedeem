#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

if ! command -v node >/dev/null 2>&1; then
  echo "缺少 node，请先安装 Node.js 20+"
  exit 1
fi

NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "当前 Node.js 版本是 $(node -v)，本项目要求 Node.js 20+。请升级后再执行 npm install。"
  exit 1
fi

if [ ! -f ".env" ]; then
  cp "config/.env.example" ".env"
  echo "已生成 .env，请按需修改后继续。"
fi

npm install
npm run db:init

echo "KaWang 初始化完成。"
