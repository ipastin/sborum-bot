#!/usr/bin/env bash
set -euo pipefail

APP="sborum-bot"

if [[ "${EUID}" -ne 0 ]]; then
  echo "ERROR: run as root:"
  echo "  sudo bash scripts/uninstall-systemd.sh"
  exit 1
fi

systemctl disable --now "${APP}.service" 2>/dev/null || true
systemctl disable --now "${APP}-backup.timer" 2>/dev/null || true

rm -f "/etc/systemd/system/${APP}.service"
rm -f "/etc/systemd/system/${APP}-backup.service"
rm -f "/etc/systemd/system/${APP}-backup.timer"
rm -rf "/opt/${APP}"

systemctl daemon-reload

echo "${APP} service removed."
echo "Configuration, state and backups were intentionally preserved:"
echo "  /etc/${APP}"
echo "  /var/lib/${APP}"
echo "  /var/backups/${APP}"
echo
echo "kebab-quorum-bot was not modified."
