#!/usr/bin/env bash
# Ephemeral CI test only. Requires nginx, apache2-utils, openssl and installed Node deps.
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo 'Run as root on a disposable Linux CI runner'; exit 1; }
[[ ! -e /etc/jibas-wg && ! -L /etc/jibas-wg ]] || { echo 'Refusing to touch existing /etc/jibas-wg'; exit 1; }
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)"
WORK="$(mktemp -d /tmp/jibas-wg-nginx-test.XXXXXX)"
BACKEND_PID=''
cleanup(){
 if [[ -f $WORK/nginx.pid ]]; then nginx -c "$WORK/nginx.conf" -p "$WORK/" -s quit || true; fi
 if [[ -n $BACKEND_PID ]]; then kill "$BACKEND_PID" 2>/dev/null || true; fi
 if [[ -f /etc/jibas-wg/.ci-fixture && $(</etc/jibas-wg/.ci-fixture) == "$WORK" ]]; then
  rm -f /etc/jibas-wg/dashboard.crt /etc/jibas-wg/dashboard.key /etc/jibas-wg/.ci-fixture
  rmdir /etc/jibas-wg
 fi
 case "$WORK" in /tmp/jibas-wg-nginx-test.*) rm -rf -- "$WORK" ;; esac
}
trap cleanup EXIT
install -d -m 750 -o root -g www-data /etc/jibas-wg
printf '%s\n' "$WORK" > /etc/jibas-wg/.ci-fixture
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj '/CN=127.0.0.1' -keyout /etc/jibas-wg/dashboard.key -out /etc/jibas-wg/dashboard.crt 2>/dev/null
printf '%s\n' ci-fixture-password | htpasswd -i -B -c "$WORK/old.htpasswd" admin >/dev/null
JIBAS_WG_AUTH_FILE="$WORK/dashboard-auth.json" JIBAS_WG_LEGACY_HTPASSWD="$WORK/old.htpasswd" node "$ROOT/deployment/dashboard-credentials.js"
(
 cd "$ROOT"
 JIBAS_WG_TEST_WORK="$WORK" node -e 'const {dashboardAuth}=require("./deployment/dashboard-auth"),fs=require("node:fs"),express=require("express"),app=express(),dir=process.env.JIBAS_WG_TEST_WORK;app.use(dashboardAuth({file:dir+"/dashboard-auth.json",https:true}));app.all("/{*path}",(req,res)=>res.send("fixture-ok"));const s=app.listen(0,"127.0.0.1",()=>fs.writeFileSync(dir+"/backend-port",String(s.address().port)))'
) &
BACKEND_PID=$!
for ((i=0;i<50;i++)); do [[ -f $WORK/backend-port ]] && break; sleep 0.1; done
BACKEND=$(<"$WORK/backend-port")
PORT="$(node -e 'const s=require("net").createServer();s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')"
node "$ROOT/deployment/linux/render-nginx.js" "$PORT" "$BACKEND" > "$WORK/server.conf"
printf 'user www-data;\npid %s/nginx.pid;\nerror_log %s/error.log;\nevents {}\nhttp { access_log off; include %s/server.conf; }\n' "$WORK" "$WORK" "$WORK" > "$WORK/nginx.conf"
nginx -t -c "$WORK/nginx.conf" -p "$WORK/"
nginx -c "$WORK/nginx.conf" -p "$WORK/"
URL="https://127.0.0.1:$PORT"
status() { curl -ksS -o /dev/null -w '%{http_code}' "$@"; }
[[ $(curl -ksS -o /dev/null -w '%{redirect_url}' "$URL/") == "$URL/login" ]]
[[ $(curl -ksS "$URL/login") == *'Masuk ke JIBAS WhatsApp Gateway'* ]]
[[ $(status "$URL/api/status") == 401 ]]
[[ $(status -d 'username=admin&password=wrong' "$URL/login") == 401 ]]
[[ $(status -d 'username=admin&password=ci-fixture-password' -H "Origin: $URL" -c "$WORK/cookies" "$URL/login") == 303 ]]
[[ $(curl -ksS -b "$WORK/cookies" "$URL/") == fixture-ok ]]
[[ $(status -b "$WORK/cookies" -H 'Origin: https://untrusted.invalid' -X POST "$URL/api/config") == 403 ]]
[[ $(status -b "$WORK/cookies" "$URL/api/apply-update") == 403 ]]
[[ $(status "$URL/healthz") == 404 ]]
[[ $(curl -sS -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/") == 301 ]]
JIBAS_WG_AUTH_FILE="$WORK/dashboard-auth.json" JIBAS_WG_LOGIN_USER=operator JIBAS_WG_LOGIN_PASSWORD=ci-rotated-password node "$ROOT/deployment/dashboard-credentials.js"
[[ $(status -b "$WORK/cookies" "$URL/") == 303 ]]
[[ $(status -d 'username=operator&password=ci-rotated-password' -c "$WORK/cookies" "$URL/login") == 303 ]]
[[ $(curl -ksS -b "$WORK/cookies" "$URL/") == fixture-ok ]]
echo 'PASS: Nginx HTTPS login page, cookie auth, migrated bcrypt, live credential rotation and cross-origin rejection.'
