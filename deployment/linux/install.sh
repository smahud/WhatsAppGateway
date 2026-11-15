#!/usr/bin/env bash
set -euo pipefail
# Reviewed local installer; no curl|bash, OS package installation or firewall changes.
[[ ${EUID} -eq 0 ]] || { echo 'Run with sudo.' >&2; exit 1; }
[[ "$(pwd -P)" == /opt/wagw ]] || { echo 'Place project in /opt/wagw and cd there first.' >&2; exit 1; }
[[ $# -eq 0 || ($# -eq 1 && $1 == --activate-move) ]] || { echo 'Usage: install.sh [--activate-move]' >&2; exit 1; }
for cmd in node npm systemctl useradd install runuser; do command -v "$cmd" >/dev/null || { echo "Missing prerequisite: $cmd" >&2; exit 1; }; done
[[ -x /usr/bin/node ]] || { echo 'systemd units require /usr/bin/node; do not use an nvm-only runtime.' >&2; exit 1; }
[[ -f config.json && ! -L config.json && ! -L sessions ]] || { echo 'Create regular config.json from config.example.json first; no symlink for config/sessions.' >&2; exit 1; }
/usr/bin/node -e 'const [major,minor]=process.versions.node.split(".").map(Number);if((major!==22&&major!==24)||(major===22&&minor<14))throw Error("Use Node.js 22.14+ or 24 LTS")'
if systemctl is-active --quiet wagw-gateway || systemctl is-active --quiet wagw-bridge; then
 echo 'Services are active. Use the documented maintenance/upgrade procedure; installer will not stop live queues.' >&2; exit 1
fi
getent passwd wagw >/dev/null || useradd --system --home-dir /opt/wagw --shell /usr/sbin/nologin wagw
npm ci --omit=dev --omit=optional --no-audit --no-fund
node deployment/deploy.js
node deployment/doctor.js
# Code remains root-owned and read-only to service user. Only config/session are writable.
chown -R root:wagw /opt/wagw
chmod -R o-rwx /opt/wagw
chmod 750 /opt/wagw
install -d -m 700 -o wagw -g wagw /opt/wagw/sessions
chown -R wagw:wagw /opt/wagw/sessions
chown wagw:wagw /opt/wagw/config.json
chmod 600 /opt/wagw/config.json
runuser -u wagw -- /usr/bin/node deployment/doctor.js
if [[ ${1:-} == --activate-move ]]; then
 # This flag is the operator's explicit cutover instruction: stop SMS consumer first.
 runuser -u wagw -- /usr/bin/node deployment/activate.js
fi
install -m 644 deployment/linux/wagw-gateway.service /etc/systemd/system/wagw-gateway.service
install -m 644 deployment/linux/wagw-bridge.service /etc/systemd/system/wagw-bridge.service
systemctl daemon-reload
systemctl enable --now wagw-gateway wagw-bridge
echo 'Services started; scan QR through an SSH tunnel to 127.0.0.1:3000.'
echo 'Check: systemctl status wagw-gateway wagw-bridge; journalctl -u wagw-gateway -n 50'
