#!/usr/bin/env bash
set -euo pipefail
wg_source="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
exec bash "$wg_source/deployment/linux/install.sh" "$@"
