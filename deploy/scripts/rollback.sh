#!/usr/bin/env bash
# Put a previous release back (application images only - the database is not touched).
#
#   rollback.sh            # the release deployed before the current one
#   rollback.sh <sha>      # a specific earlier release (its images must still be on the server)
#
# Releases are listed in state/releases.log. If the newer release ran a database
# migration, make sure the older code still works with that schema first.
set -Eeuo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

cur="$(current_tag)"
target="${1:-}"
if [[ -z "$target" ]]; then
  target="$(awk '$3=="deployed"{print $2}' "$RELEASES_LOG" | tac | awk -v cur="$cur" '$0!=cur && !seen[$0]++' | head -n1)"
  [[ -n "$target" ]] || die "no earlier release in $RELEASES_LOG"
fi

for svc in "${APP_SERVICES[@]}"; do
  docker image inspect "$(IMAGE_TAG="$target" dc config --images "$svc")" >/dev/null 2>&1 \
    || die "image for $svc:$target is not on this server (re-run the GitHub workflow for that commit instead)"
done

log "rolling back $cur -> $target"
exec "$APP_DIR/deploy/scripts/deploy.sh" "$target"
