#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
KAWANG_ROOT="$(cd "$ROOT_DIR/../.." && pwd)"

echo "kwMembership 由 kwRedeem 的统一更新器管理。"
exec bash "$KAWANG_ROOT/scripts/update.sh"
