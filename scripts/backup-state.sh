#!/usr/bin/env bash
set -euo pipefail

APP="sborum-bot"
STATE_FILE="/var/lib/${APP}/state.json"
BACKUP_DIR="/var/backups/${APP}"
STAMP="$(date -u +%Y-%m-%dT%H-%M-%SZ)"

mkdir -p "${BACKUP_DIR}"

if [[ ! -f "${STATE_FILE}" ]]; then
  echo "No state file yet: ${STATE_FILE}"
  exit 0
fi

cp --preserve=mode,timestamps \
  "${STATE_FILE}" \
  "${BACKUP_DIR}/state-${STAMP}.json"

chmod 0600 "${BACKUP_DIR}/state-${STAMP}.json"

find "${BACKUP_DIR}" \
  -type f \
  -name 'state-*.json' \
  -mtime +14 \
  -delete

echo "Backup created: ${BACKUP_DIR}/state-${STAMP}.json"
