#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

echo "当前项目以前后台静态文件 + Node API/Worker 为主，无额外前端打包步骤。"
echo "如需上线，请先执行 scripts/check.sh 并确认 nginx 指向 web/ 与 admin/ 目录。"
