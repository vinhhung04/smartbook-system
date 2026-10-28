#!/usr/bin/env bash
# Restore SmartBook data from a backup folder made by backup.sh.
#
#   restore.sh <backup-dir> <database|packing_evidence|all> --yes-overwrite-production
#
# DESTRUCTIVE: replaces the current contents of the chosen database(s). The services
# that write to them are stopped during the restore and started again afterwards.
# To check a backup without touching production use verify-backup.sh instead.
set -Eeuo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

src="${1:?usage: restore.sh <backup-dir> <auth_db|inventory_db|borrow_db|ai_db|packing_evidence|all> --yes-overwrite-production}"
target="${2:?missing target}"
[[ "${3:-}" == "--yes-overwrite-production" ]] || die "refusing without --yes-overwrite-production"
[[ -d "$src" ]] || src="$BACKUP_DIR/$src"
[[ -f "$src/SHA256SUMS" ]] || die "$src is not a backup folder"
(cd "$src" && sha256sum -c --quiet SHA256SUMS) || die "checksum mismatch in $src"

cd "$APP_DIR"
pg_user="$(env_value POSTGRES_USER)"

case "$target" in
  all) targets=(auth_db inventory_db borrow_db ai_db packing_evidence) ;;
  auth_db|inventory_db|borrow_db|ai_db|packing_evidence) targets=("$target") ;;
  *) die "unknown target $target" ;;
esac

log "safety backup of the current state first"
"$APP_DIR/deploy/scripts/backup.sh" --label "prerestore"

app_running=()
for svc in "${APP_SERVICES[@]}"; do
  [[ "$svc" == "web" ]] && continue
  [[ -n "$(dc ps --status running -q "$svc" 2>/dev/null)" ]] && app_running+=("$svc")
done

restore_evidence() {
  [[ -f "$src/packing_evidence.tar.gz" ]] || die "no packing_evidence.tar.gz in $src"
  dc exec -T inventory-service sh -c 'find /app/evidence/packing -mindepth 1 -delete && tar -xzf - -C /app/evidence/packing' <"$src/packing_evidence.tar.gz"
  log "packing evidence restored"
}

if [[ " ${targets[*]} " == *" packing_evidence "* ]]; then
  restore_evidence
fi

db_targets=()
for t in "${targets[@]}"; do [[ "$t" != packing_evidence ]] && db_targets+=("$t"); done
if [[ ${#db_targets[@]} -gt 0 ]]; then
  log "stopping application services: ${app_running[*]:-none}"
  [[ ${#app_running[@]} -gt 0 ]] && dc stop "${app_running[@]}"
  for db in "${db_targets[@]}"; do
    [[ -f "$src/$db.dump" ]] || die "no $db.dump in $src"
    log "restoring $db"
    dc exec -T db pg_restore -U "$pg_user" -d "$db" --clean --if-exists --no-owner --role="$pg_user" --single-transaction <"$src/$db.dump"
  done
  log "starting application services again"
  [[ ${#app_running[@]} -gt 0 ]] && dc up -d --wait --wait-timeout 600 "${app_running[@]}"
fi
log "restore finished"
