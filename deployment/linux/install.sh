#!/usr/bin/env bash
set -euo pipefail
umask 077
SOURCE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)"
TARGET=/opt/wagw
STATE=/etc/wagw
PORT=3000 PORT_SET=0 LOGIN_USER='' LOGIN_PASS='' PASS_SET=0 ADDRESS=''
DB_HOST=127.0.0.1 DB_PORT=3306 DB_USER=wagw_app DB_PASS_FILE='' ACTIVATE=1
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
usage() {
 cat <<'HELP'
Usage: sudo bash install.sh --port 3000 --user admin --pass somepassword
Ubuntu/Debian with systemd; existing JIBAS DB required.
  --port NUMBER          Public HTTPS port (default 3000)
  --user NAME            Dashboard username (admin; preserved on reinstall)
  --pass PASSWORD        Dashboard password (otherwise generated/preserved)
  --pass-file PATH       Dashboard password file instead of CLI
  --address IP_OR_DNS    Certificate/display address (otherwise detect local IP)
  --db-host HOST         First-install DB host (default 127.0.0.1)
  --db-port NUMBER       First-install DB port (default 3306)
  --db-user NAME         First-install DB user (default wagw_app)
  --db-password-file P   First-install DB password; otherwise prompt securely
  --no-activate-move     Install paused for staging
  --activate-move        Enable move (default); STOP old SMS consumer first
  --help                Show help without installing
Existing config.json, sessions and dashboard password are preserved.
HELP
}
while (($#)); do
 case "$1" in
  --help|-h) usage; exit 0 ;;
  --port|--user|--pass|--pass-file|--address|--db-host|--db-port|--db-user|--db-password-file)
   (($# >= 2)) || die "Missing value for $1"
   case "$1" in
    --port) PORT=$2; PORT_SET=1 ;; --user) LOGIN_USER=$2 ;; --pass) LOGIN_PASS=$2; PASS_SET=1 ;;
    --pass-file) [[ -f $2 ]] || die 'Dashboard password file not found'; LOGIN_PASS=$(<"$2"); PASS_SET=1 ;;
    --address) ADDRESS=$2 ;; --db-host) DB_HOST=$2 ;; --db-port) DB_PORT=$2 ;;
    --db-user) DB_USER=$2 ;; --db-password-file) [[ -f $2 ]] || die 'DB password file not found'; DB_PASS_FILE="$(readlink -f -- "$2")" ;;
   esac
   shift 2 ;;
  --no-activate-move) ACTIVATE=0; shift ;;
  --activate-move) ACTIVATE=1; shift ;;
  *) die "Unknown option: $1 (see --help)" ;;
 esac
done
[[ ${EUID} -eq 0 ]] || die 'Run installer with sudo'
if ((PORT_SET == 0)) && [[ -f $STATE/public-port ]]; then PORT=$(<"$STATE/public-port"); fi
[[ $PORT =~ ^[0-9]{1,5}$ && $DB_PORT =~ ^[0-9]{1,5}$ ]] || die 'Ports must be numeric'
PORT=$((10#$PORT)); DB_PORT=$((10#$DB_PORT))
((PORT >= 1 && PORT <= 65535 && DB_PORT >= 1 && DB_PORT <= 65535)) || die 'Port outside 1..65535'
[[ -z $LOGIN_USER || $LOGIN_USER =~ ^[a-zA-Z0-9_.-]{1,64}$ ]] || die 'Invalid dashboard username'
if ((PASS_SET)); then [[ -n $LOGIN_PASS && $LOGIN_PASS != *$'\n'* && $LOGIN_PASS != *$'\r'* ]] || die 'Password must be nonempty and single-line'; fi
[[ ${EUID} -eq 0 ]] || die 'Run installer with sudo'
command -v apt-get >/dev/null || die 'Supported OS: Ubuntu/Debian with apt-get'
[[ -d /run/systemd/system ]] || die 'systemd must be running (not a bare container)'
[[ ! -L $TARGET && ! -L $STATE ]] || die 'Install/state path must not be a symlink'
for unit in wagw-gateway wagw-bridge; do
 if systemctl is-active --quiet "$unit"; then die "Stop $unit during maintenance before reinstalling; live queues are never stopped automatically"; fi
done
NGINX_WAS_INSTALLED=0
command -v nginx >/dev/null && NGINX_WAS_INSTALLED=1
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl tar xz-utils nginx apache2-utils openssl iproute2 passwd
if ((NGINX_WAS_INSTALLED == 0)) && [[ -L /etc/nginx/sites-enabled/default ]] && [[ $(readlink /etc/nginx/sites-enabled/default) == /etc/nginx/sites-available/default ]]; then unlink /etc/nginx/sites-enabled/default; fi
if ss -H -ltn "sport = :$PORT" | grep -q .; then
 if [[ ! -f /etc/nginx/conf.d/wagw.conf ]] || ! grep -q '^# WAGW MANAGED DASHBOARD' /etc/nginx/conf.d/wagw.conf || ! grep -q "listen $PORT ssl;" /etc/nginx/conf.d/wagw.conf; then die "Port $PORT is already used; select another --port"; fi
fi
WORK="$(mktemp -d /tmp/wagw-install.XXXXXX)"
cleanup() { case "${WORK:-}" in /tmp/wagw-install.*) rm -rf -- "$WORK" ;; esac; }
trap cleanup EXIT
install -d -m 755 /opt/wagw-runtime
NODE=/opt/wagw-runtime/node/bin/node
if [[ ! -x $NODE ]] || ! "$NODE" -e 'const [m,n]=process.versions.node.split(".").map(Number);process.exit((m===22&&n>=14)||m===24?0:1)'; then
 case "$(uname -m)" in x86_64) ARCH=x64 ;; aarch64|arm64) ARCH=arm64 ;; *) die 'Supported CPU: x86_64 or arm64' ;; esac
 curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt -o "$WORK/SHASUMS256.txt"
 ARCHIVE="$(awk -v arch="$ARCH" '$2 ~ "^node-v22\\.[0-9]+\\.[0-9]+-linux-" arch "\\.tar\\.xz$" {print $2; exit}' "$WORK/SHASUMS256.txt")"
 [[ -n $ARCHIVE ]] || die 'Cannot select official Node.js archive'
 curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 "https://nodejs.org/dist/latest-v22.x/$ARCHIVE" -o "$WORK/$ARCHIVE"
 (cd "$WORK"; awk -v file="$ARCHIVE" '$2 == file' SHASUMS256.txt | sha256sum --check -)
 tar -xJf "$WORK/$ARCHIVE" -C /opt/wagw-runtime
 [[ ! -e /opt/wagw-runtime/node || -L /opt/wagw-runtime/node ]] || die 'Runtime node path is not a managed symlink'
 ln -sfn "/opt/wagw-runtime/${ARCHIVE%.tar.xz}" /opt/wagw-runtime/node
fi
export PATH="/opt/wagw-runtime/node/bin:/usr/sbin:/usr/bin:/sbin:/bin"
getent group wagw >/dev/null || groupadd --system wagw
getent passwd wagw >/dev/null || useradd --system --gid wagw --home-dir "$TARGET" --shell /usr/sbin/nologin wagw
install -d -m 750 -o root -g wagw "$TARGET"
if [[ $SOURCE != "$TARGET" ]]; then
 tar -C "$SOURCE" --exclude='*.log' --exclude='*.pid' --exclude='*.bak' --exclude='last-test.json' --exclude='config.json' -cf - \
  install.sh wabot.js webhook.php package.json package-lock.json config.example.json README.md CONTRACT.md .gitignore .gitattributes public deployment 'create tables' | tar -C "$TARGET" -xf -
 if [[ ! -e $TARGET/config.json && -f $SOURCE/config.json && ! -L $SOURCE/config.json ]]; then install -m 600 "$SOURCE/config.json" "$TARGET/config.json"; fi
fi
cd "$TARGET"
[[ ! -L config.json && ! -L sessions ]] || die 'Config/sessions must not be symlinks'
BACKEND=39000
if [[ -f config.json ]]; then BACKEND="$("$NODE" -e 'const c=require(process.cwd()+"/config.json");console.log(c.public_port?c.port:39000)')"; fi
[[ $BACKEND =~ ^[0-9]{1,5}$ ]] || die 'Invalid saved backend port'
BACKEND=$((10#$BACKEND))
for ((attempt=0; attempt<100; attempt++)); do
 if ((BACKEND != PORT)) && ! ss -H -ltn "sport = :$BACKEND" | grep -q .; then break; fi
 BACKEND=$((BACKEND+1))
done
((BACKEND <= 65535 && BACKEND != PORT)) || die 'No free internal backend port'
if ss -H -ltn "sport = :$BACKEND" | grep -q .; then die 'No free internal backend port'; fi
install -d -m 750 -o root -g www-data "$STATE"
if [[ -f config.json ]]; then cp -p config.json "$STATE/config.$(date +%Y%m%d-%H%M%S).bak"; chmod 600 "$STATE"/config.*.bak; fi
if [[ ! -f config.json ]]; then
 if [[ -n $DB_PASS_FILE ]]; then [[ -f $DB_PASS_FILE ]] || die 'DB password file not found'; DB_PASSWORD=$(<"$DB_PASS_FILE");
 elif [[ -r /dev/tty ]]; then
  read -r -p "JIBAS DB host [$DB_HOST]: " value </dev/tty; DB_HOST=${value:-$DB_HOST}
  read -r -p "JIBAS DB port [$DB_PORT]: " value </dev/tty; DB_PORT=${value:-$DB_PORT}
  read -r -p "JIBAS DB user [$DB_USER]: " value </dev/tty; DB_USER=${value:-$DB_USER}
  read -r -s -p 'JIBAS DB password: ' DB_PASSWORD </dev/tty; printf '\n'
 else die 'Prepare config.json or supply --db-password-file for unattended install'; fi
else DB_PASSWORD=''; fi
WG_DB_HOST="$DB_HOST" WG_DB_PORT="$DB_PORT" WG_DB_USER="$DB_USER" WG_DB_PASSWORD="$DB_PASSWORD" WG_BACKEND_PORT="$BACKEND" WG_PUBLIC_PORT="$PORT" "$NODE" deployment/linux/configure.js
unset DB_PASSWORD
chown -R wagw:wagw "$TARGET"
install -d -m 700 -o wagw -g wagw /var/cache/wagw-npm
runuser -u wagw -- env PATH="$PATH" npm_config_cache=/var/cache/wagw-npm npm ci --omit=dev --omit=optional --no-audit --no-fund
"$NODE" deployment/deploy.js
"$NODE" deployment/doctor.js
if [[ -z $LOGIN_USER ]]; then if [[ -f $STATE/dashboard-user ]]; then LOGIN_USER=$(<"$STATE/dashboard-user"); else LOGIN_USER=admin; fi; fi
[[ $LOGIN_USER =~ ^[a-zA-Z0-9_.-]{1,64}$ ]] || die 'Invalid saved dashboard username'
GENERATED=0
if ((PASS_SET == 0)) && [[ ! -f $STATE/dashboard.htpasswd ]]; then LOGIN_PASS="$(openssl rand -base64 24)"; PASS_SET=1; GENERATED=1; fi
if ((PASS_SET == 0)) && [[ -f $STATE/dashboard-user && $(<"$STATE/dashboard-user") != "$LOGIN_USER" ]]; then die 'Changing username requires --pass or --pass-file'; fi
if ((PASS_SET)); then
 printf '%s\n' "$LOGIN_PASS" | htpasswd -i -B -c "$WORK/dashboard.htpasswd" "$LOGIN_USER" >/dev/null
 install -m 640 -o root -g www-data "$WORK/dashboard.htpasswd" "$STATE/dashboard.htpasswd"
 printf '%s\n' "$LOGIN_USER" > "$STATE/dashboard-user"
fi
if [[ -z $ADDRESS ]]; then ADDRESS="$(ip -4 -o addr show scope global | awk '{split($4,a,"/");print a[1];exit}')"; ADDRESS=${ADDRESS:-localhost}; fi
WG_ADDRESS="$ADDRESS" "$NODE" -e 'const a=process.env.WG_ADDRESS;if(!require("net").isIP(a)&&!/^([a-zA-Z0-9][a-zA-Z0-9-]*\.)*[a-zA-Z0-9][a-zA-Z0-9-]*$/.test(a))throw Error("Invalid --address")'
RENEW=0
[[ -f $STATE/dashboard.crt && -f $STATE/dashboard.key && -f $STATE/tls-address ]] || RENEW=1
if [[ -f $STATE/tls-address && $(<"$STATE/tls-address") != "$ADDRESS" ]]; then RENEW=1; fi
if ((RENEW == 0)) && ! openssl x509 -checkend 604800 -noout -in "$STATE/dashboard.crt" >/dev/null; then RENEW=1; fi
if ((RENEW)); then
 SAN="DNS:$ADDRESS"; if WG_ADDRESS="$ADDRESS" "$NODE" -e 'process.exit(require("net").isIP(process.env.WG_ADDRESS)?0:1)'; then SAN="IP:$ADDRESS"; fi
 openssl req -x509 -newkey rsa:3072 -sha256 -days 365 -nodes -subj '/CN=WAGW Dashboard' -addext "subjectAltName=$SAN" -keyout "$WORK/dashboard.key" -out "$WORK/dashboard.crt" 2>/dev/null
 install -m 600 "$WORK/dashboard.key" "$STATE/dashboard.key"
 install -m 644 "$WORK/dashboard.crt" "$STATE/dashboard.crt"
 printf '%s\n' "$ADDRESS" > "$STATE/tls-address"
fi
if [[ -f /etc/nginx/conf.d/wagw.conf ]] && ! grep -q '^# WAGW MANAGED DASHBOARD' /etc/nginx/conf.d/wagw.conf; then die 'Refusing to replace unmanaged nginx wagw.conf'; fi
HAD_CONF=0
if [[ -f /etc/nginx/conf.d/wagw.conf ]]; then cp -p /etc/nginx/conf.d/wagw.conf "$WORK/old-wagw.conf"; HAD_CONF=1; fi
"$NODE" deployment/linux/render-nginx.js "$PORT" "$BACKEND" > "$WORK/wagw.conf"
install -m 644 "$WORK/wagw.conf" /etc/nginx/conf.d/wagw.conf
if ! nginx -t; then
 if ((HAD_CONF)); then cp -p "$WORK/old-wagw.conf" /etc/nginx/conf.d/wagw.conf; else unlink /etc/nginx/conf.d/wagw.conf; fi
 die 'nginx test failed; previous WAGW config restored'
fi
chown -R root:wagw "$TARGET"; chmod -R o-rwx "$TARGET"; chmod 750 "$TARGET"
install -d -m 700 -o wagw -g wagw "$TARGET/sessions"
chown -R wagw:wagw "$TARGET/sessions"
chown wagw:wagw "$TARGET/config.json"; chmod 600 "$TARGET/config.json"
runuser -u wagw -- "$NODE" deployment/doctor.js
if ((ACTIVATE)); then runuser -u wagw -- "$NODE" deployment/activate.js;
else runuser -u wagw -- "$NODE" deployment/linux/pause.js; fi
install -m 644 deployment/linux/wagw-gateway.service /etc/systemd/system/wagw-gateway.service
install -m 644 deployment/linux/wagw-bridge.service /etc/systemd/system/wagw-bridge.service
systemctl daemon-reload
systemctl enable --now wagw-gateway wagw-bridge nginx
systemctl reload nginx
printf '%s\n' "$PORT" > "$STATE/public-port"
if command -v ufw >/dev/null && ufw status | grep -q '^Status: active'; then ufw allow "$PORT/tcp" comment 'WAGW HTTPS dashboard'; fi
READY=0
for ((attempt=0; attempt<30; attempt++)); do
 if curl -fsS --max-time 3 "http://127.0.0.1:$BACKEND/api/status" 2>/dev/null | "$NODE" -e 'let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>{try{process.exit(JSON.parse(s).dbConnected?0:1)}catch{process.exit(1)}})'; then READY=1; break; fi
 sleep 2
done
((READY)) || die 'Backend not ready. Check journalctl -u wagw-gateway -u wagw-bridge'
[[ $(curl -ksS --max-time 5 -o /dev/null -w '%{http_code}' "https://127.0.0.1:$PORT/") == 401 ]] || die 'Expected login protection (401); check nginx'
printf '\nDashboard: https://%s:%s\nLogin: %s\n' "$ADDRESS" "$PORT" "$LOGIN_USER"
if ((GENERATED)); then printf 'Generated password (shown once): %s\n' "$LOGIN_PASS"; fi
printf 'TLS SHA256 fingerprint: '; openssl x509 -in "$STATE/dashboard.crt" -noout -fingerprint -sha256
printf 'Use the configured password, verify the self-signed certificate, then scan QR.\n'
printf 'Allow TCP %s in the VPS provider firewall if needed.\n' "$PORT"
printf 'Outbox MOVE activation: %s. Inbox stays disabled.\n' "$ACTIVATE"
unset LOGIN_PASS
