#!/usr/bin/env bash
# Load the SmartBook demo dataset into production - the same steps as `pnpm demo:seed`
# in development: auth (roles + demo accounts), inventory, catalog enrichment, borrow,
# then closing loans of titles the enrichment removed.
#
#   seed-demo.sh --i-understand-demo-passwords
#
# The demo accounts all share the password 123456: change them (or lock the ones you do
# not need) right after seeding on a public site. The prisma seeds are upserts, so a
# re-run does not duplicate data, but it does reset demo rows it owns.
set -Eeuo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

[[ "${1:-}" == "--i-understand-demo-passwords" ]] || die "refusing without --i-understand-demo-passwords"
cd "$APP_DIR"
[[ -f "$RELEASE_ENV" ]] || die "deploy a release first"
for f in scripts/seed-catalog-enrichment.mjs scripts/close-removed-title-loans.mjs data; do
  [[ -e "$f" ]] || die "$f missing (it ships with the deploy bundle)"
done

"$APP_DIR/deploy/scripts/backup.sh" --label "preseed" --db-only

# The two .mjs helpers drive `docker compose exec db psql` and need Node >= 20.11; run them
# in a throwaway docker-cli container pointed at this project instead of installing Node.
node_helper() {
  docker run --rm -i \
    -v /var/run/docker.sock:/var/run/docker.sock \
    -v "$APP_DIR:$APP_DIR" -w "$APP_DIR" \
    -e COMPOSE_PROJECT_NAME=smartbook \
    -e COMPOSE_FILE="$APP_DIR/compose.prod.yml" \
    -e COMPOSE_ENV_FILES="$APP_DIR/.env,$RELEASE_ENV" \
    docker:27-cli sh -c 'apk add --no-cache --quiet nodejs >/dev/null && node "$0"' "$1"
}

log "auth: roles, permissions, demo accounts"
dc run --rm --no-deps -T auth-service npx prisma db seed
log "inventory: warehouses, catalog, stock"
dc run --rm --no-deps -T inventory-service npx prisma db seed
log "inventory: catalog enrichment"
node_helper scripts/seed-catalog-enrichment.mjs
log "borrow: customers, loans, reservations"
dc run --rm --no-deps -T borrow-service npx prisma db seed
log "borrow: close loans of removed titles"
node_helper scripts/close-removed-title-loans.mjs
log "demo data loaded - the AI catalog index syncs from inventory within CATALOG_SYNC_INTERVAL_SECONDS"
