#!/usr/bin/env bash
set -euo pipefail
umask 077
SOURCE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)"
PORT='' LOGIN_USER='' LOGIN_PASS='' PASS_FILE='' ADDRESS=''
USER_SET=0 PASS_SET=0 ACTIVATE=1 MOVE_SET=0 FULL_OPTIONS=0 CREDENTIALS_ONLY=0
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
# shellcheck source=deployment/linux/dashboard.sh
source "$SOURCE/deployment/linux/dashboard.sh"
# shellcheck source=deployment/linux/service.sh
source "$SOURCE/deployment/linux/service.sh"
usage() {
 cat <<'HELP'
Usage: sudo bash install.sh [--user NAME] [--pass PASSWORD | --pass-file PATH]
Ubuntu/Debian with systemd. Copy and edit config.example.json as config.json first.
Installs or repairs JIBAS WhatsApp Gateway, with MOVE enabled by default.
Stop the old JIBAS SMS consumer before cutover; existing jbssms is required.
  --port NUMBER          Override the HTTPS port from config.json (default 3000)
  --user NAME            Dashboard username; a new password is generated if not supplied
  --pass PASSWORD        Set/replace the dashboard password
  --pass-file PATH       Read dashboard password from a private file
  --credentials-only    Rotate login without restarting or changing the DB
  --address IP_OR_DNS   Certificate/display address (otherwise detect local IP)
  --no-activate-move    Set up JIBAS with MOVE paused for staging
  --help                Show help without installing
On first install without login options, admin gets a generated password.
Repair without login options preserves current dashboard credentials.
Help does not require root. Uninstall: sudo bash uninstall.sh
HELP
}

while (($#)); do
 case "$1" in
  --help|-h) usage; exit 0 ;;
  --port|--user|--pass|--pass-file|--address)
   [[ $# -ge 2 && $2 != --* && -n $2 ]] || die "Missing value for $1"
   case "$1" in
    --port) PORT=$2; FULL_OPTIONS=1 ;;
    --user) LOGIN_USER=$2; USER_SET=1 ;;
    --pass|--pass-file)
     ((PASS_SET == 0)) || die 'Supply only one dashboard password option'
     PASS_SET=1
     if [[ $1 == --pass ]]; then LOGIN_PASS=$2
     else [[ -f $2 ]] || die 'Dashboard password file not found'; PASS_FILE=$(readlink -f -- "$2"); fi
     ;;
    --address) ADDRESS=$2; FULL_OPTIONS=1 ;;
   esac
   shift 2 ;;
  --no-activate-move|--activate-move)
   ((MOVE_SET == 0)) || die 'Choose only one MOVE activation option'
   if [[ $1 == --activate-move ]]; then ACTIVATE=1; else ACTIVATE=0; fi
   MOVE_SET=1; FULL_OPTIONS=1; shift ;;
  --with-bridge) FULL_OPTIONS=1; shift ;; # JIBAS is always included.
  --credentials-only) CREDENTIALS_ONLY=1; shift ;;
  *) die "Unknown option: $1 (see --help)" ;;
 esac
done
[[ ${EUID} -eq 0 ]] || die 'Run installer with sudo'
select_layout
for file in "$TARGET/config.json" "$TARGET/dashboard-auth.json" "$TARGET/sessions" "$STATE/dashboard.htpasswd" \
 "$STATE/dashboard.crt" "$STATE/dashboard.key" "$STATE/tls-address" "$CACHE"; do
 [[ ! -L $file ]] || die "Path instalasi tidak boleh berupa symlink: $file"
done
if ((USER_SET)); then [[ $LOGIN_USER =~ ^[a-zA-Z0-9_.-]{1,64}$ ]] || die 'Username dashboard tidak valid'; fi
if ((CREDENTIALS_ONLY)); then
 ((FULL_OPTIONS == 0 && (USER_SET || PASS_SET))) || die '--credentials-only accepts --user, --pass, or --pass-file'
 [[ -x $NODE && -f $TARGET/dashboard-auth.json ]] || die 'Run a normal install/repair once to migrate to the login page'
 dashboard_credentials
 exit 0
fi
command -v apt-get >/dev/null || die 'Supported OS: Ubuntu/Debian with apt-get'
[[ -d /run/systemd/system ]] || die 'systemd must be running (not a bare container)'
command -v python3 >/dev/null && command -v ss >/dev/null || die 'Port check requires python3 and iproute2 (standard Ubuntu/Debian system tools)'
assert_owned_installation
CONFIG_SOURCE="$SOURCE/config.json"
if [[ ! -f $CONFIG_SOURCE ]]; then CONFIG_SOURCE="$TARGET/config.json"; fi
[[ -f $CONFIG_SOURCE && ! -L $CONFIG_SOURCE ]] || die 'Copy config.example.json to config.json and fill the JIBAS database settings'
ports=$(python3 "$SOURCE/deployment/linux/config-ports.py" "$CONFIG_SOURCE") || die 'Cannot read dashboard port'
read -r CONFIG_PORT BACKEND <<< "$ports"
if [[ -f $TARGET/config.json && $CONFIG_SOURCE != "$TARGET/config.json" ]]; then
 installed_ports=$(python3 "$SOURCE/deployment/linux/config-ports.py" "$TARGET/config.json") || die 'Cannot read installed backend port'
 read -r _ BACKEND <<< "$installed_ports"
fi
PORT=${PORT:-$CONFIG_PORT}
[[ $PORT =~ ^[0-9]{1,5}$ ]] || die 'Port must be numeric'
PORT=$((10#$PORT))
((PORT >= 1 && PORT <= 65535)) || die 'Port outside 1..65535'
probe_public_port "$PORT"
for ((attempt=0; attempt<100 && BACKEND<=65535; attempt++)); do
 backend_listeners=$(ss -H -ltnp "sport = :$BACKEND")
 if ((BACKEND != PORT)) && { [[ -z $backend_listeners ]] || listeners_belong_to "$backend_listeners" "$(gateway_pids)"; }; then break; fi
 BACKEND=$((BACKEND+1))
done
((attempt < 100 && BACKEND <= 65535 && BACKEND != PORT)) || die 'No private backend port is available'

NGINX_WAS_INSTALLED=0
command -v nginx >/dev/null && NGINX_WAS_INSTALLED=1
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl tar xz-utils nginx openssl iproute2 passwd
if ((NGINX_WAS_INSTALLED == 0)) && [[ -L /etc/nginx/sites-enabled/default ]] && [[ $(readlink /etc/nginx/sites-enabled/default) == /etc/nginx/sites-available/default ]]; then
 unlink /etc/nginx/sites-enabled/default
 if systemctl is-active --quiet nginx; then nginx -t; systemctl reload nginx; fi
fi
WORK="$(mktemp -d /tmp/jibas-wg-install.XXXXXX)"
STAGE=''
NGINX_STAGED=0
cleanup() {
 if ((NGINX_STAGED)); then
  if [[ -f $WORK/previous-nginx.conf ]]; then cp -p "$WORK/previous-nginx.conf" "$NGINX_CONF"; else rm -f -- "$NGINX_CONF"; fi
  if [[ -f $WORK/legacy-nginx.conf ]]; then mv -- "$WORK/legacy-nginx.conf" "$LEGACY_NGINX_CONF"; fi
  if systemctl is-active --quiet nginx && nginx -t; then systemctl reload nginx || true; fi
 fi
 case "$WORK" in /tmp/jibas-wg-install.*) rm -rf -- "$WORK" ;; esac
 case "${STAGE:-}" in /opt/.jibas-wg-install.*) rm -rf -- "$STAGE" ;; esac
}
trap cleanup EXIT
install -d -m 755 "$RUNTIME"
if [[ ! -x $NODE ]] || ! "$NODE" -e 'const [m,n]=process.versions.node.split(".").map(Number);process.exit((m===22&&n>=14)||m===24?0:1)'; then
 case "$(uname -m)" in x86_64) ARCH=x64 ;; aarch64|arm64) ARCH=arm64 ;; *) die 'Supported CPU: x86_64 or arm64' ;; esac
 curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 --connect-timeout 15 --max-time 120 https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt -o "$WORK/SHASUMS256.txt"
 ARCHIVE="$(awk -v arch="$ARCH" '$2 ~ "^node-v22\\.[0-9]+\\.[0-9]+-linux-" arch "\\.tar\\.xz$" {print $2; exit}' "$WORK/SHASUMS256.txt")"
 [[ -n $ARCHIVE ]] || die 'Cannot select official Node.js archive'
 curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 --connect-timeout 15 --max-time 120 "https://nodejs.org/dist/latest-v22.x/$ARCHIVE" -o "$WORK/$ARCHIVE"
 (cd "$WORK"; awk -v file="$ARCHIVE" '$2 == file' SHASUMS256.txt | sha256sum --check -)
 tar --no-same-owner -xJf "$WORK/$ARCHIVE" -C "$RUNTIME"
 [[ ! -e $RUNTIME/node || -L $RUNTIME/node ]] || die 'Runtime node path is not a managed symlink'
 ln -sfn "$RUNTIME/${ARCHIVE%.tar.xz}" "$RUNTIME/node"
fi
export PATH="$RUNTIME/node/bin:/usr/sbin:/usr/bin:/sbin:/bin"
dashboard_credentials --check
getent group "$SERVICE_USER" >/dev/null || groupadd --system "$SERVICE_USER"
getent passwd "$SERVICE_USER" >/dev/null || useradd --system --gid "$SERVICE_USER" --home-dir "$TARGET" --shell /usr/sbin/nologin "$SERVICE_USER"
[[ $(id -u "$SERVICE_USER") != 0 && $(id -gn "$SERVICE_USER") == "$SERVICE_USER" ]] || die "Invalid service account: $SERVICE_USER"
install -d -m 750 -o root -g "$SERVICE_USER" "$TARGET"
install -d -m 750 -o root -g www-data "$STATE"
install -d -m 700 -o "$SERVICE_USER" -g "$SERVICE_USER" "$CACHE"
STAGE="$(mktemp -d /opt/.jibas-wg-install.XXXXXX)"
tar -C "$SOURCE" --exclude='*.log' --exclude='*.pid' --exclude='*.bak' --exclude='last-test.json' \
 --exclude='config.json' --exclude='dashboard-auth.json' --exclude='github.pat.*' --exclude='*.htpasswd' \
 --exclude='*.pass' --exclude='*.sqlite*' --exclude='*.db*' --exclude='*.key' --exclude='*.pem' --exclude='.env*' -cf - \
 install.sh uninstall.sh gateway.js wabot.js package.json package-lock.json config.example.json README.md CONTRACT.md .gitignore .gitattributes public deployment 'create tables' | tar -C "$STAGE" -xf -
install -m 600 "$CONFIG_SOURCE" "$STAGE/config.json"
JIBAS_WG_BACKEND_PORT="$BACKEND" JIBAS_WG_PUBLIC_PORT="$PORT" JIBAS_WG_INSTALLED_CONFIG="$TARGET/config.json" \
 "$NODE" "$STAGE/deployment/linux/configure.js"
chown -R "$SERVICE_USER:$SERVICE_USER" "$STAGE"
runuser -u "$SERVICE_USER" -- env PATH="$PATH" npm_config_cache="$CACHE" npm --prefix "$STAGE" ci --omit=dev --omit=optional --no-audit --no-fund --prefer-offline
DB_FLAGS=()
if ((ACTIVATE == 0)); then DB_FLAGS+=(--no-activate-move); fi
runuser -u "$SERVICE_USER" -- "$NODE" "$STAGE/deployment/deploy.js" --check "${DB_FLAGS[@]}"

if [[ -z $ADDRESS && -f $STATE/tls-address ]]; then ADDRESS=$(<"$STATE/tls-address"); fi
if [[ -z $ADDRESS ]]; then ADDRESS="$(ip -4 -o addr show scope global | awk 'NR==1 {split($4,a,"/");print a[1]}')"; ADDRESS=${ADDRESS:-localhost}; fi
JIBAS_WG_ADDRESS="$ADDRESS" "$NODE" -e 'const a=process.env.JIBAS_WG_ADDRESS;if(!require("net").isIP(a)&&!/^([a-zA-Z0-9][a-zA-Z0-9-]*\.)*[a-zA-Z0-9][a-zA-Z0-9-]*$/.test(a))throw Error("Invalid --address")'
NGINX_FLAGS=()
if [[ -s /proc/net/if_inet6 ]]; then NGINX_FLAGS+=(--ipv6); elif [[ $ADDRESS == *:* ]]; then die 'IPv6 is not available on this host'; fi
if ((LEGACY_LAYOUT)); then NGINX_FLAGS+=(--legacy-state); fi
RENEW=0
[[ -f $STATE/dashboard.crt && -f $STATE/dashboard.key && -f $STATE/tls-address ]] || RENEW=1
if [[ -f $STATE/tls-address && $(<"$STATE/tls-address") != "$ADDRESS" ]]; then RENEW=1; fi
if ((RENEW == 0)) && ! openssl x509 -checkend 604800 -noout -in "$STATE/dashboard.crt" >/dev/null; then RENEW=1; fi
if ((RENEW)); then
 SAN="DNS:$ADDRESS"; if JIBAS_WG_ADDRESS="$ADDRESS" "$NODE" -e 'process.exit(require("net").isIP(process.env.JIBAS_WG_ADDRESS)?0:1)'; then SAN="IP:$ADDRESS"; fi
 openssl req -x509 -newkey rsa:3072 -sha256 -days 365 -nodes -subj '/CN=JIBAS WhatsApp Gateway' -addext "subjectAltName=$SAN" -keyout "$WORK/dashboard.key" -out "$WORK/dashboard.crt" 2>/dev/null
 install -m 600 "$WORK/dashboard.key" "$STATE/dashboard.key"
 install -m 644 "$WORK/dashboard.crt" "$STATE/dashboard.crt"
 printf '%s\n' "$ADDRESS" > "$STATE/tls-address"
fi
assert_owned_installation
probe_public_port "$PORT"
runuser -u "$SERVICE_USER" -- "$NODE" "$STAGE/deployment/linux/render-nginx.js" "$PORT" "$BACKEND" "${NGINX_FLAGS[@]}" > "$WORK/jibas-wg.conf"
if [[ -f $NGINX_CONF ]]; then cp -p "$NGINX_CONF" "$WORK/previous-nginx.conf"; fi
NGINX_STAGED=1
if [[ -f $LEGACY_NGINX_CONF ]]; then mv -- "$LEGACY_NGINX_CONF" "$WORK/legacy-nginx.conf"; fi
install -m 644 "$WORK/jibas-wg.conf" "$NGINX_CONF"
nginx -t || die 'Nginx config invalid; restoring previous dashboard configuration.'
for unit in "$BRIDGE" "$LEGACY_BRIDGE" "$GATEWAY" "$LEGACY_GATEWAY"; do
 if [[ -f $UNIT_DIR/$unit ]]; then
  printf 'Restart terkontrol JIBAS WG: %s\n' "$unit"
  systemctl stop "$unit"
 fi
done
runuser -u "$SERVICE_USER" -- "$NODE" "$STAGE/deployment/deploy.js" "${DB_FLAGS[@]}"
if [[ -f $TARGET/config.json ]]; then install -m 600 "$TARGET/config.json" "$STATE/config.$(date +%Y%m%d-%H%M%S).bak"; fi
if [[ -d $TARGET/node_modules ]]; then
 PREVIOUS="$(mktemp -d "$RUNTIME/dependencies.previous.XXXXXX")"
 mv -- "$TARGET/node_modules" "$PREVIOUS/node_modules"
fi
install -m 600 -o "$SERVICE_USER" -g "$SERVICE_USER" "$STAGE/config.json" "$TARGET/config.json"
if [[ $SOURCE == "$TARGET" ]]; then
 mv -- "$STAGE/node_modules" "$TARGET/node_modules"
else
 (cd "$STAGE"; tar --anchored --exclude='./config.json' -cf - .) | tar -C "$TARGET" -xf -
fi
chown -R "root:$SERVICE_USER" "$TARGET"; chmod -R o-rwx "$TARGET"; chmod 750 "$TARGET"
install -d -m 700 -o "$SERVICE_USER" -g "$SERVICE_USER" "$TARGET/sessions"
chown -R "$SERVICE_USER:$SERVICE_USER" "$TARGET/sessions"
chown "$SERVICE_USER:$SERVICE_USER" "$TARGET/config.json"; chmod 600 "$TARGET/config.json"
dashboard_credentials
unset LOGIN_PASS
chown "root:$SERVICE_USER" "$TARGET/dashboard-auth.json"; chmod 640 "$TARGET/dashboard-auth.json"
runuser -u "$SERVICE_USER" -- "$NODE" "$TARGET/deployment/doctor.js"
for unit in "$LEGACY_BRIDGE" "$LEGACY_GATEWAY"; do
 if [[ -f $UNIT_DIR/$unit ]]; then systemctl disable "$unit"; fi
done
for unit in "$GATEWAY" "$BRIDGE"; do
 unit_source="$TARGET/deployment/linux/$unit"
 if ((LEGACY_LAYOUT)); then
  sed -e 's@/opt/jibas-wg@/opt/wagw@g' -e 's/^User=jibas-wg$/User=wagw/' -e 's/^Group=jibas-wg$/Group=wagw/' "$unit_source" > "$WORK/$unit"
  unit_source="$WORK/$unit"
 fi
 install -m 644 "$unit_source" "$UNIT_DIR/$unit"
done
systemctl daemon-reload
systemctl enable --now "$GATEWAY" "$BRIDGE" nginx
systemctl reload nginx
READY=0
for ((attempt=0; attempt<30; attempt++)); do
 if curl -fsS --max-time 3 "http://127.0.0.1:$BACKEND/healthz" >/dev/null 2>&1; then READY=1; break; fi
 sleep 2
done
((READY)) || die 'Backend not ready. Check journalctl -u jibas-wg-gateway -u jibas-wg-bridge'
[[ $(curl -ksS --max-time 5 -o /dev/null -w '%{redirect_url}' "https://127.0.0.1:$PORT/") == "https://127.0.0.1:$PORT/login" ]] \
 || die 'Expected redirect to /login; check nginx'
NGINX_STAGED=0
for unit in "$LEGACY_BRIDGE" "$LEGACY_GATEWAY"; do
 if [[ -f $UNIT_DIR/$unit ]]; then rm -f -- "$UNIT_DIR/$unit"; fi
done
systemctl daemon-reload
if command -v ufw >/dev/null && ufw status | grep -q '^Status: active'; then ufw allow "$PORT/tcp" comment 'JIBAS WG HTTPS dashboard'; fi
URL_ADDRESS=$ADDRESS
if [[ $URL_ADDRESS == *:* ]]; then URL_ADDRESS="[$URL_ADDRESS]"; fi
printf '\nHalaman login: https://%s:%s/login\n' "$URL_ADDRESS" "$PORT"
printf 'TLS SHA256 fingerprint: '; openssl x509 -in "$STATE/dashboard.crt" -noout -fingerprint -sha256
printf 'JIBAS outbox MOVE activation: %s. Verifikasi sertifikat, login, lalu scan QR jika perlu.\n' "$ACTIVATE"
