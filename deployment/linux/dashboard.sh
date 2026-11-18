#!/usr/bin/env bash
# Shared by the full installer and credential rotation.
dashboard_credentials() (
 if ((USER_SET)); then export JIBAS_WG_LOGIN_USER="$LOGIN_USER"; else unset JIBAS_WG_LOGIN_USER; fi
 if ((PASS_SET)) && [[ -z $PASS_FILE ]]; then export JIBAS_WG_LOGIN_PASSWORD="$LOGIN_PASS"; else unset JIBAS_WG_LOGIN_PASSWORD; fi
 export JIBAS_WG_LOGIN_PASS_FILE="$PASS_FILE" JIBAS_WG_LOGIN_REQUIRED="$CREDENTIALS_ONLY"
 export JIBAS_WG_AUTH_FILE="$TARGET/dashboard-auth.json" JIBAS_WG_LEGACY_HTPASSWD="$STATE/dashboard.htpasswd"
 if [[ ${1:-} != --check ]]; then
  JIBAS_WG_AUTH_GID="$(getent group "$SERVICE_USER" | cut -d: -f3)"
  [[ $JIBAS_WG_AUTH_GID =~ ^[0-9]+$ ]] || die "Group $SERVICE_USER not found"
  export JIBAS_WG_AUTH_GID
 fi
 "$NODE" "$SOURCE/deployment/dashboard-credentials.js" "$@"
)
