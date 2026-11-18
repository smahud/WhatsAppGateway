#!/usr/bin/env bash
set -euo pipefail
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
if [[ ${1:-} == --help || ${1:-} == -h ]]; then
 printf '%s\n' 'sudo bash uninstall.sh — melepas layanan JIBAS WG; DB, sesi, login, dan konfigurasi tetap ada.'
 exit 0
fi
(($# == 0)) || die 'Use bash uninstall.sh --help'
[[ $EUID -eq 0 ]] || die 'Run uninstall with sudo'
SOURCE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)"
# shellcheck source=deployment/linux/service.sh
source "$SOURCE/deployment/linux/service.sh"
select_layout
assert_owned_installation
for unit in "$BRIDGE" "$LEGACY_BRIDGE" "$GATEWAY" "$LEGACY_GATEWAY"; do
 file="$UNIT_DIR/$unit"
 if [[ -f $file ]]; then
  systemctl disable --now "$unit"
  rm -f -- "$file"
 fi
done
systemctl daemon-reload
if [[ -f $NGINX_CONF || -f $LEGACY_NGINX_CONF ]]; then
 backup=$(mktemp -d /etc/nginx/conf.d/.jibas-wg-uninstall.XXXXXX)
 for conf in "$NGINX_CONF" "$LEGACY_NGINX_CONF"; do
  if [[ -f $conf ]]; then mv -- "$conf" "$backup/"; fi
 done
 if nginx -t && { ! systemctl is-active --quiet nginx || systemctl reload nginx; }; then
  rm -f -- "$backup/${NGINX_CONF##*/}" "$backup/${LEGACY_NGINX_CONF##*/}"
  rmdir -- "$backup"
 else
  for conf in "$NGINX_CONF" "$LEGACY_NGINX_CONF"; do
   if [[ -f $backup/${conf##*/} ]]; then mv -- "$backup/${conf##*/}" "$conf"; fi
  done
  rmdir -- "$backup"
  die 'Nginx reload failed; JIBAS WG configuration restored'
 fi
fi
printf '%s\n' 'JIBAS WG dilepas. DB, config.json, login, sesi, dan trigger JIBAS tidak dihapus.'
