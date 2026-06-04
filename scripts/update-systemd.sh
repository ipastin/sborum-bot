#!/usr/bin/env bash
set -euo pipefail

APP="sborum-bot"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ "${EUID}" -ne 0 ]]; then
  echo "ERROR: run as root:"
  echo "  sudo bash scripts/update-systemd.sh"
  exit 1
fi

if [[ ! -d "/opt/${APP}" ]]; then
  echo "ERROR: ${APP} is not installed."
  exit 1
fi

echo "==> Validating new source files"
node --check "${ROOT}/src/index.js"
node --check "${ROOT}/src/schedule.js"
node --check "${ROOT}/src/events.js"
node --check "${ROOT}/src/store.js"

echo "==> Backing up state"
"/opt/${APP}/scripts/backup-state.sh" || true

echo "==> Copying application files"
install -o root -g root -m 0644 "${ROOT}"/src/*.js "/opt/${APP}/src/"
install -o root -g root -m 0755 "${ROOT}/scripts/backup-state.sh" "/opt/${APP}/scripts/backup-state.sh"
install -o root -g root -m 0755 "${ROOT}/scripts/diagnose-systemd.sh" "/opt/${APP}/scripts/diagnose-systemd.sh"

echo "==> Restarting ${APP}"
systemctl restart "${APP}"
systemctl status "${APP}" --no-pager

echo
echo "Update completed."
