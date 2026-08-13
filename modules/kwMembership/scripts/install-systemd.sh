#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
INSTALL_DIR="${KWMEMBERSHIP_INSTALL_DIR:-/opt/kwmembership}"
RUN_USER="${KWMEMBERSHIP_USER:-${SUDO_USER:-}}"
ENV_FILE="/etc/kwmembership.env"
SOURCE_ENV_FILE="${KWMEMBERSHIP_SOURCE_ENV_FILE:-$ROOT_DIR/.env}"
DEPLOY_HELPER="/usr/local/sbin/kawang-membership-deploy"
SUDOERS_FILE="/etc/sudoers.d/kawang-membership-update"

if [ "$(id -u)" -ne 0 ]; then
  echo "run this installer as root"
  exit 1
fi
if [ -z "$RUN_USER" ] || ! id "$RUN_USER" >/dev/null 2>&1; then
  echo "set KWMEMBERSHIP_USER to the same Unix user that runs kwRedeem"
  exit 1
fi
RUN_GROUP="$(id -gn "$RUN_USER")"
for command_name in awk go install mktemp rsync runuser sed sudo systemctl visudo; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "$command_name is required"
    exit 1
  fi
done
if [ -f "$SOURCE_ENV_FILE" ]; then
  install -m 0640 -o root -g "$RUN_GROUP" "$SOURCE_ENV_FILE" "$ENV_FILE"
elif [ ! -f "$ENV_FILE" ]; then
  echo "missing $SOURCE_ENV_FILE and $ENV_FILE"
  exit 1
fi
PYTHON_BIN="$(command -v python3 || true)"
if [ -z "$PYTHON_BIN" ]; then
  echo "Python 3 is required for the serial payment executor"
  exit 1
fi
VENV_DIR="${KWMEMBERSHIP_VENV_DIR:-$INSTALL_DIR/.venv}"
if [ ! -x "$VENV_DIR/bin/python" ]; then
  mkdir -p "$INSTALL_DIR"
  chown "$RUN_USER:$RUN_GROUP" "$INSTALL_DIR"
  runuser -u "$RUN_USER" -- "$PYTHON_BIN" -m venv "$VENV_DIR"
fi
PYTHON_BIN="$VENV_DIR/bin/python"
CHECKOUT_EXECUTOR="$(sed -n 's/^[[:space:]]*KWMEMBERSHIP_CHECKOUT_EXECUTOR[[:space:]]*=[[:space:]]*//p' "$ENV_FILE" | tail -n 1 | tr -d '\"' | tr -d "'")"
CHECKOUT_EXECUTOR="${CHECKOUT_EXECUTOR:-python}"

KAWANG_ROOT="$(cd "$ROOT_DIR/../.." && pwd)"
if [ ! -f "$KAWANG_ROOT/.env" ] || [ ! -f "$KAWANG_ROOT/package.json" ]; then
  echo "KAWANG_PROJECT_ROOT is not a configured kwRedeem checkout: $KAWANG_ROOT"
  exit 1
fi
DATABASE_PATH="$(sed -n 's/^[[:space:]]*DATABASE_PATH[[:space:]]*=[[:space:]]*//p' "$KAWANG_ROOT/.env" | tail -n 1 | tr -d '\"' | tr -d "'")"
DATABASE_PATH="${DATABASE_PATH:-./data/kawang.db}"
if [[ "$DATABASE_PATH" != /* ]]; then
  DATABASE_PATH="$KAWANG_ROOT/${DATABASE_PATH#./}"
fi
KAWANG_DATA_DIR="${KAWANG_DATA_DIR:-$(dirname "$DATABASE_PATH")}"
if [[ "$KAWANG_DATA_DIR" != /* ]]; then
  KAWANG_DATA_DIR="$KAWANG_ROOT/${KAWANG_DATA_DIR#./}"
fi
KAWANG_DATA_DIR="$(cd "$KAWANG_DATA_DIR" && pwd)"

# The managed file is read from /etc at runtime, so relative values from the
# source checkout must become stable absolute paths before systemd uses them.
ENV_TMP="$(mktemp "${ENV_FILE}.XXXXXX")"
trap 'rm -f "$ENV_TMP"' EXIT
awk -v kawang_root="$KAWANG_ROOT" '
  /^[[:space:]]*(export[[:space:]]+)?KAWANG_PROJECT_ROOT[[:space:]]*=/ {
    print "KAWANG_PROJECT_ROOT=" kawang_root
    found = 1
    next
  }
  { print }
  END {
    if (!found) print "KAWANG_PROJECT_ROOT=" kawang_root
  }
' "$ENV_FILE" > "$ENV_TMP"
install -m 0640 -o root -g "$RUN_GROUP" "$ENV_TMP" "$ENV_FILE"
rm -f "$ENV_TMP"
trap - EXIT

mkdir -p "$INSTALL_DIR"
mkdir -p "$ROOT_DIR/bin"
chown "$RUN_USER:$RUN_GROUP" "$ROOT_DIR/bin"
runuser -u "$RUN_USER" -- env \
  KWMEMBERSHIP_PROJECT_ROOT="$ROOT_DIR" \
  KWMEMBERSHIP_ENV_FILE="$ENV_FILE" \
  KAWANG_PROJECT_ROOT="$KAWANG_ROOT" \
  KWMEMBERSHIP_VERSION="$(git -C "$KAWANG_ROOT" rev-parse HEAD 2>/dev/null || printf 'dev')" \
  bash "$ROOT_DIR/scripts/build.sh"
runuser -u "$RUN_USER" -- env \
  KWMEMBERSHIP_PROJECT_ROOT="$ROOT_DIR" \
  KWMEMBERSHIP_ENV_FILE="$ENV_FILE" \
  KAWANG_PROJECT_ROOT="$KAWANG_ROOT" \
  bash "$ROOT_DIR/scripts/check.sh"

sed \
  -e "s|@@INSTALL_DIR@@|$INSTALL_DIR|g" \
  -e "s|@@RUN_USER@@|$RUN_USER|g" \
  -e "s|@@RUN_GROUP@@|$RUN_GROUP|g" \
  -e "s|@@ENV_FILE@@|$ENV_FILE|g" \
  -e "s|@@KAWANG_DATA_DIR@@|$KAWANG_DATA_DIR|g" \
  "$ROOT_DIR/systemd/kwmembership-worker.service" > /etc/systemd/system/kwmembership-worker.service
sed \
  -e "s|@@INSTALL_DIR@@|$INSTALL_DIR|g" \
  -e "s|@@RUN_USER@@|$RUN_USER|g" \
  -e "s|@@RUN_GROUP@@|$RUN_GROUP|g" \
  -e "s|@@ENV_FILE@@|$ENV_FILE|g" \
  -e "s|@@KAWANG_DATA_DIR@@|$KAWANG_DATA_DIR|g" \
  -e "s|@@PYTHON_BIN@@|$PYTHON_BIN|g" \
  "$ROOT_DIR/systemd/kwmembership-python-executor.service" > /etc/systemd/system/kwmembership-python-executor.service

sed \
  -e "s|@@SOURCE_DIR@@|$ROOT_DIR|g" \
  -e "s|@@INSTALL_DIR@@|$INSTALL_DIR|g" \
  -e "s|@@RUN_USER@@|$RUN_USER|g" \
  -e "s|@@RUN_GROUP@@|$RUN_GROUP|g" \
  -e "s|@@ENV_FILE@@|$ENV_FILE|g" \
  -e "s|@@PYTHON_BIN@@|$PYTHON_BIN|g" \
  "$ROOT_DIR/deploy/kawang-membership-deploy" > "$DEPLOY_HELPER"
chown root:root "$DEPLOY_HELPER"
chmod 0755 "$DEPLOY_HELPER"

printf '%s ALL=(root) NOPASSWD: %s\n' "$RUN_USER" "$DEPLOY_HELPER" > "$SUDOERS_FILE"
chown root:root "$SUDOERS_FILE"
chmod 0440 "$SUDOERS_FILE"
if command -v visudo >/dev/null 2>&1; then
  visudo -cf "$SUDOERS_FILE"
fi

systemctl daemon-reload
systemctl disable --now kwmembership-api.service >/dev/null 2>&1 || true
rm -f /etc/systemd/system/kwmembership-api.service
"$DEPLOY_HELPER"
systemctl enable kwmembership-worker.service
if [ "$CHECKOUT_EXECUTOR" = "python" ]; then systemctl enable kwmembership-python-executor.service; fi
systemctl --no-pager --full status kwmembership-worker.service
if systemctl is-enabled --quiet kwmembership-python-executor.service; then
  systemctl --no-pager --full status kwmembership-python-executor.service
fi
