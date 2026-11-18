#!/usr/bin/env bash
# Run only in the disposable Ubuntu CI VM, with its dedicated MariaDB container.
set -euo pipefail
umask 077
[[ $EUID -eq 0 && ${GITHUB_ACTIONS:-} == true && -n ${JIBAS_WG_CI_DB_PASSWORD:-} ]] || {
 echo 'This test requires a disposable GitHub Actions runner and fixture MariaDB.' >&2; exit 1;
}
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)"
for file in /opt/{jibas-wg,jibas-wg-runtime,wagw,wagw-runtime} /etc/{jibas-wg,wagw} \
 /etc/nginx/conf.d/{jibas-wg,wagw}.conf /etc/systemd/system/{jibas-wg,wagw}-{gateway,bridge}.service; do
 if [[ -e $file || -L $file ]]; then echo "Refusing to use existing state: $file" >&2; exit 1; fi
done
WORK="$(mktemp -d /tmp/jibas-wg-systemd-test.XXXXXX)"
SOURCE="$WORK/source"
FOREIGN_PID=''
fail_cleanup() {
 local status=$?
 if [[ -n $FOREIGN_PID ]]; then kill "$FOREIGN_PID" 2>/dev/null || true; fi
 if ((status)); then journalctl -u jibas-wg-gateway -u jibas-wg-bridge -n 60 --no-pager >&2 || true; fi
 if [[ -f /etc/systemd/system/jibas-wg-gateway.service ]]; then bash "$SOURCE/uninstall.sh" || true; fi
 case "$WORK" in /tmp/jibas-wg-systemd-test.*) rm -rf -- "$WORK" ;; esac
}
trap fail_cleanup EXIT
mkdir -- "$SOURCE"
git -c safe.directory="$ROOT" -C "$ROOT" archive HEAD | tar -C "$SOURCE" -xf -
node - "$ROOT" "$SOURCE" <<'NODE'
const [root, source] = process.argv.slice(2);
const mysql = require(root + '/node_modules/mysql2/promise');
const fs = require('node:fs');
(async () => {
  const config = {db_type:'mysql',host:'127.0.0.1',db_port:33316,user:'root',
    password:process.env.JIBAS_WG_CI_DB_PASSWORD,database:'jibas_wg',port:3000,delay:1};
  const db = await mysql.createConnection({host:config.host,port:config.db_port,user:config.user,
    password:config.password,multipleStatements:true});
  try {
    const [rows] = await db.query("SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME IN ('jbssms','jibas_wg','wagw')");
    if (rows.length) throw Error('Expected an empty MariaDB container');
    await db.query(fs.readFileSync(root+'/deployment/fixture-schema.sql','utf8'));
  } finally { await db.end(); }
  fs.writeFileSync(source + '/config.json', JSON.stringify(config), {mode:0o600});
})().catch(err=>{console.error(err.message);process.exitCode=1;});
NODE
node -e 'const s=require("node:net").createServer();s.listen(0,"127.0.0.1",()=>require("node:fs").writeFileSync(process.argv[1],String(s.address().port)))' "$WORK/public-port" &
FOREIGN_PID=$!
for ((i=0;i<50;i++)); do [[ -s $WORK/public-port ]] && break; sleep 0.1; done
PORT=$(<"$WORK/public-port")
if bash "$SOURCE/install.sh" --port "$PORT" > "$WORK/port.log" 2>&1; then
 echo 'Expected pre-bootstrap listener rejection' >&2; exit 1
fi
grep -q 'dipakai aplikasi lain' "$WORK/port.log"
[[ ! -e /opt/jibas-wg-runtime ]]
kill "$FOREIGN_PID"; wait "$FOREIGN_PID" || true; FOREIGN_PID=''
printf '%s\n' 'local-ci-dashboard-password' > "$WORK/login.pass"
bash "$SOURCE/install.sh" --port "$PORT" --address 127.0.0.1 --pass-file "$WORK/login.pass"
URL="https://127.0.0.1:$PORT"
verify_login() {
 [[ $(curl -ksS --max-time 5 -o /dev/null -w '%{redirect_url}' "$URL/") == "$URL/login" ]]
 [[ $(curl -ksS --max-time 5 -o /dev/null -w '%{http_code}' -d 'username=admin&password=local-ci-dashboard-password' \
   -H "Origin: $URL" -c "$WORK/cookies" "$URL/login") == 303 ]]
 local html
 html=$(curl -kfsS --max-time 5 -b "$WORK/cookies" "$URL/")
 [[ $html == *'<title>JIBAS WhatsApp Gateway'* ]]
}
verify_login
systemctl is-enabled --quiet jibas-wg-gateway.service
systemctl is-enabled --quiet jibas-wg-bridge.service
before=$(systemctl show -p MainPID --value jibas-wg-gateway.service)
printf 'Keep this fixture\n' > /opt/jibas-wg/sessions/fixture.keep
bash "$SOURCE/install.sh" --port "$PORT"
[[ $(systemctl show -p MainPID --value jibas-wg-gateway.service) != "$before" ]]
[[ -f /opt/jibas-wg/sessions/fixture.keep ]]
verify_login
systemctl restart jibas-wg-gateway.service
backend=$(node -p 'JSON.parse(require("node:fs").readFileSync("/opt/jibas-wg/config.json")).backend_port')
ready=0
for ((i=0;i<30;i++)); do
 if curl -fsS --max-time 3 "http://127.0.0.1:$backend/healthz" >/dev/null; then ready=1; break; fi
 sleep 2
done
((ready))
bash "$SOURCE/uninstall.sh"
[[ -f /opt/jibas-wg/config.json && -f /opt/jibas-wg/dashboard-auth.json && -f /opt/jibas-wg/sessions/fixture.keep ]]
[[ ! -e /etc/systemd/system/jibas-wg-gateway.service && ! -e /etc/systemd/system/jibas-wg-bridge.service &&
   ! -e /etc/nginx/conf.d/jibas-wg.conf ]]
[[ -z $(ss -H -ltn "sport = :$PORT") ]]
/opt/jibas-wg-runtime/node/bin/node /opt/jibas-wg/deployment/test-bridge.js
/opt/jibas-wg-runtime/node/bin/node /opt/jibas-wg/deployment/test-jibas-e2e.js
echo 'PASS: Ubuntu systemd/HTTPS install, owned-port repair, restart, uninstall and JIBAS transaction and delivery fixtures.'
