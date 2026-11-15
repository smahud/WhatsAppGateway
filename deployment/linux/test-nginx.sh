#!/usr/bin/env bash
# Ephemeral CI test only. Refuses any machine with an existing WAGW state folder.
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo 'Run as root on a disposable Linux CI runner'; exit 1; }
[[ ! -e /etc/wagw && ! -L /etc/wagw ]] || { echo 'Refusing to touch existing /etc/wagw'; exit 1; }
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)"
WORK="$(mktemp -d /tmp/wagw-nginx-test.XXXXXX)"
BACKEND_PID=''
cleanup(){
 if [[ -f $WORK/nginx.pid ]]; then nginx -c "$WORK/nginx.conf" -p "$WORK/" -s quit || true; fi
 if [[ -n $BACKEND_PID ]]; then kill "$BACKEND_PID" 2>/dev/null || true; fi
 if [[ -f /etc/wagw/.ci-fixture && $(</etc/wagw/.ci-fixture) == "$WORK" ]]; then
  rm -f /etc/wagw/dashboard.crt /etc/wagw/dashboard.key /etc/wagw/dashboard.htpasswd /etc/wagw/.ci-fixture
  rmdir /etc/wagw
 fi
 case "$WORK" in /tmp/wagw-nginx-test.*) rm -rf -- "$WORK" ;; esac
}
trap cleanup EXIT
install -d -m 750 -o root -g www-data /etc/wagw
printf '%s\n' "$WORK" > /etc/wagw/.ci-fixture
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj '/CN=127.0.0.1' -keyout /etc/wagw/dashboard.key -out /etc/wagw/dashboard.crt 2>/dev/null
printf '%s\n' ci-fixture-password | htpasswd -i -B -c /etc/wagw/dashboard.htpasswd admin >/dev/null
chown root:www-data /etc/wagw/dashboard.htpasswd; chmod 640 /etc/wagw/dashboard.htpasswd
WG_PORT_FILE="$WORK/backend-port" node -e 'const fs=require("fs"),s=require("http").createServer((q,r)=>{r.end("fixture-ok")});s.listen(0,"127.0.0.1",()=>fs.writeFileSync(process.env.WG_PORT_FILE,String(s.address().port)))' &
BACKEND_PID=$!
for ((i=0;i<50;i++)); do [[ -f $WORK/backend-port ]] && break; sleep 0.1; done
BACKEND=$(<"$WORK/backend-port")
PORT="$(node -e 'const s=require("net").createServer();s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')"
node "$ROOT/deployment/linux/render-nginx.js" "$PORT" "$BACKEND" > "$WORK/server.conf"
printf 'user www-data;\npid %s/nginx.pid;\nerror_log %s/error.log;\nevents {}\nhttp { access_log off; include %s/server.conf; }\n' "$WORK" "$WORK" "$WORK" > "$WORK/nginx.conf"
nginx -t -c "$WORK/nginx.conf" -p "$WORK/"
nginx -c "$WORK/nginx.conf" -p "$WORK/"
URL="https://127.0.0.1:$PORT"
[[ $(curl -ksS -o /dev/null -w '%{http_code}' "$URL/") == 401 ]]
[[ $(curl -ksS -u admin:wrong -o /dev/null -w '%{http_code}' "$URL/") == 401 ]]
[[ $(curl -ksS -u admin:ci-fixture-password "$URL/") == fixture-ok ]]
[[ $(curl -ksS -u admin:ci-fixture-password -H 'Origin: https://untrusted.invalid' -X POST -o /dev/null -w '%{http_code}' "$URL/api/config") == 403 ]]
[[ $(curl -ksS -u admin:ci-fixture-password -H "Origin: $URL" -X POST "$URL/api/config") == fixture-ok ]]
[[ $(curl -ksS -u admin:ci-fixture-password -o /dev/null -w '%{http_code}' "$URL/api/apply-update") == 403 ]]
[[ $(curl -sS -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/") == 301 ]]
echo 'PASS: real Nginx HTTPS, login, wrong password, authenticated proxy, CSRF rejection and HTTP redirect.'
