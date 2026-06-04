#!/usr/bin/env bash
set -u

APP="sborum-bot"
CONFIG="/etc/${APP}/${APP}.env"

echo "===== ${APP}: diagnostics ====="
echo
echo "--- Date and uptime ---"
date
uptime
echo
echo "--- Node.js ---"
node --version 2>&1 || true
echo
echo "--- Service status ---"
systemctl status "${APP}" --no-pager 2>&1 || true
echo
echo "--- Last 100 log lines ---"
journalctl -u "${APP}" -n 100 --no-pager 2>&1 || true
echo
echo "--- Configuration with token hidden ---"
if [[ -f "${CONFIG}" ]]; then
  sed -E 's/^(BOT_TOKEN=).*/\1***hidden***/' "${CONFIG}"
else
  echo "Missing config: ${CONFIG}"
fi
echo
echo "--- Backup timer ---"
systemctl status "${APP}-backup.timer" --no-pager 2>&1 || true
