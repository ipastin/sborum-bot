#!/usr/bin/env bash
set -euo pipefail

APP="sborum-bot"
APP_USER="sborum-bot"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ "${EUID}" -ne 0 ]]; then
  echo "ERROR: run as root:"
  echo "  sudo bash scripts/install-systemd.sh"
  exit 1
fi

if ! command -v apt-get >/dev/null 2>&1; then
  echo "ERROR: automatic installer currently supports Debian and Ubuntu."
  exit 1
fi

echo "==> Installing required packages"
apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs ca-certificates

node -e 'if (Number(process.versions.node.split(".")[0]) < 18) process.exit(1)' || {
  echo "ERROR: Node.js 18 or newer is required. Installed: $(node --version)"
  exit 1
}

echo "==> Creating isolated Linux user"
getent group "${APP_USER}" >/dev/null || groupadd --system "${APP_USER}"
id -u "${APP_USER}" >/dev/null 2>&1 || useradd \
  --system \
  --gid "${APP_USER}" \
  --home-dir "/var/lib/${APP}" \
  --shell /usr/sbin/nologin \
  "${APP_USER}"

echo "==> Creating application directories"
install -d -o root -g root -m 0755 "/opt/${APP}" "/opt/${APP}/src" "/opt/${APP}/scripts"
install -d -o root -g "${APP_USER}" -m 0750 "/etc/${APP}"
install -d -o "${APP_USER}" -g "${APP_USER}" -m 0700 "/var/lib/${APP}" "/var/backups/${APP}"

echo "==> Copying application files"
install -o root -g root -m 0644 "${ROOT}"/src/*.js "/opt/${APP}/src/"
install -o root -g root -m 0755 "${ROOT}/scripts/backup-state.sh" "/opt/${APP}/scripts/backup-state.sh"
install -o root -g root -m 0755 "${ROOT}/scripts/diagnose-systemd.sh" "/opt/${APP}/scripts/diagnose-systemd.sh"

if [[ ! -f "/etc/${APP}/${APP}.env" ]]; then
  install -o root -g "${APP_USER}" -m 0640 \
    "${ROOT}/.env.vps.example" \
    "/etc/${APP}/${APP}.env"
else
  echo "==> Keeping existing configuration: /etc/${APP}/${APP}.env"
fi

echo "==> Installing systemd units"
install -o root -g root -m 0644 \
  "${ROOT}/systemd/${APP}.service" \
  "/etc/systemd/system/${APP}.service"
install -o root -g root -m 0644 \
  "${ROOT}/systemd/${APP}-backup.service" \
  "/etc/systemd/system/${APP}-backup.service"
install -o root -g root -m 0644 \
  "${ROOT}/systemd/${APP}-backup.timer" \
  "/etc/systemd/system/${APP}-backup.timer"

systemctl daemon-reload
systemctl enable --now "${APP}-backup.timer"

echo
echo "Installation files are ready."
echo
echo "NEXT:"
echo "  nano /etc/${APP}/${APP}.env"
echo "  systemctl enable --now ${APP}"
echo "  systemctl status ${APP} --no-pager"
echo
echo "This installer does not modify kebab-quorum-bot."
