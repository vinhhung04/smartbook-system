#!/usr/bin/env bash
# One-time alignment of auth_db.user_warehouse_scopes with the real warehouse
# ids of an EXISTING inventory database.
#
# Why: the auth seed scopes demo users with fixed warehouse ids
# (00000000-...-0002 = WH-HCM-01, ...-0003 = WH-HN-01, ...-0004 = BR-HCM-01).
# Databases seeded before inventory-service created warehouses with those same
# ids have random warehouse ids, so every scope row pointed nowhere. That was
# invisible while the scope check failed open; it is fail-closed now, so the
# rows must point at the real warehouses (matched by warehouse code).
#
# Idempotent; only rewrites rows still carrying a placeholder id, and brings the
# demo manager (manager01) from READ to FULL like the current seed.
#
# Usage: bash scripts/reconcile-warehouse-scopes.sh   (stack running via docker compose)
set -euo pipefail

DB_CONTAINER="${DB_CONTAINER:-smartbook-system-db-1}"
DB_USER="${DB_USER:-$(docker exec "$DB_CONTAINER" printenv POSTGRES_USER)}"
INVENTORY_DB="${INVENTORY_DB:-inventory_db}"
AUTH_DB="${AUTH_DB:-auth_db}"

psql_in() {
  docker exec -i "$DB_CONTAINER" psql -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$1" -tA -c "$2"
}

declare -A PLACEHOLDER=(
  [WH-HCM-01]=00000000-0000-0000-0000-000000000002
  [WH-HN-01]=00000000-0000-0000-0000-000000000003
  [BR-HCM-01]=00000000-0000-0000-0000-000000000004
)

for code in "${!PLACEHOLDER[@]}"; do
  real_id="$(psql_in "$INVENTORY_DB" "SELECT id FROM warehouses WHERE code = '$code'")"
  placeholder="${PLACEHOLDER[$code]}"
  if [[ -z "$real_id" ]]; then
    echo "skip $code: no such warehouse in $INVENTORY_DB" >&2
    continue
  fi
  if [[ "$real_id" == "$placeholder" ]]; then
    echo "$code: already uses the seeded id"
    continue
  fi
  updated="$(psql_in "$AUTH_DB" "WITH moved AS (
      UPDATE user_warehouse_scopes s SET warehouse_id = '$real_id'
      WHERE s.warehouse_id = '$placeholder'
        AND NOT EXISTS (SELECT 1 FROM user_warehouse_scopes t WHERE t.user_id = s.user_id AND t.warehouse_id = '$real_id')
      RETURNING 1) SELECT count(*) FROM moved")"
  echo "$code: $updated scope row(s) $placeholder -> $real_id"
done

promoted="$(psql_in "$AUTH_DB" "WITH up AS (
    UPDATE user_warehouse_scopes s SET access_level = 'FULL'
    FROM users u WHERE u.id = s.user_id AND u.username = 'manager01' AND s.access_level = 'READ'
    RETURNING 1) SELECT count(*) FROM up")"
echo "manager01: $promoted READ row(s) -> FULL"
