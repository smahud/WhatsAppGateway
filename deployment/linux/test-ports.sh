#!/usr/bin/env bash
set -euo pipefail
here="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
# shellcheck source=deployment/linux/service.sh
source "$here/service.sh"
work="$(mktemp -d)"
trap 'rm -f -- "$work/jibas-wg.conf" "$work/legacy.conf"; rmdir -- "$work"' EXIT
NGINX_CONF="$work/jibas-wg.conf"
LEGACY_NGINX_CONF="$work/legacy.conf"
printf '%s\n' "$NGINX_MARKER" > "$NGINX_CONF"
LISTENERS=''
EXTRA=''
ss() { printf '%s' "$LISTENERS"; }
gateway_pids() { printf '42\n43\n'; }
systemctl() { printf '56\n'; }
nginx() {
 printf '# configuration file %s:\nserver { listen 3000 ssl; }\n%s' "$NGINX_CONF" "$EXTRA"
}
[[ $(probe_public_port 3000) == *tersedia* ]]
LISTENERS='LISTEN localhost:3000 users:(("node",pid=42,fd=3))'
[[ $(probe_public_port 3000) == *'milik JIBAS WG'* ]]
LISTENERS='LISTEN localhost:3000 users:(("node",pid=44,fd=3))'
if out=$(probe_public_port 3000 2>&1); then exit 1; fi
[[ $out == *'dipakai aplikasi lain'* ]]
LISTENERS='LISTEN 0.0.0.0:3000 users:(("nginx",pid=56,fd=3))'
[[ $(probe_public_port 3000) == *'milik JIBAS WG'* ]]
EXTRA=$'# configuration file /etc/nginx/other.conf:\nserver { listen\n [::]:3000 ssl; }\n'
if out=$(probe_public_port 3000 2>&1); then exit 1; fi
[[ $out == *'dipakai aplikasi lain'* ]]
echo 'PASS: Linux free/owned/foreign port decisions, including a shared Nginx socket.'
