#!/usr/bin/env bash
# Actual independent restore, retaining target data. No scratch DBs on production.
set -Eeuo pipefail
exec "$(dirname "${BASH_SOURCE[0]}")/restore.sh" "${1:?backup directory required}" --isolated-empty-target
