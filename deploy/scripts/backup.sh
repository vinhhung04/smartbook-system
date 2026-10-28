#!/usr/bin/env bash
# Back up SmartBook's data: every service database (pg_dump custom format), the Postgres
# roles, and the packing-evidence uploads volume. Run daily by cron and before each deploy.
#
#   backup.sh [--label <name>] [--db-only]
#
# Output: backups/<UTC timestamp>-<label>/ with a SHA256SUMS file. Retention: daily
# backups are kept BACKUP_KEEP_DAYS days (default 14), pre-deploy ones the newest 5.
# If BACKUP_RCLONE_REMOTE is set in .env and rclone is installed, the folder is also
# copied off the server (e.g. BACKUP_RCLONE_REMOTE=gdrive:smartbook-backups).
set -Eeuo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

label="daily"
db_only=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --label) label="${2:?}"; shift 2 ;;
    --db-only) db_only=1; shift ;;
    *) die "unknown option $1" ;;
  esac
done
[[ "$label" =~ ^[A-Za-z0-9._-]+$ ]] || die "bad label: $label"

umask 077
cd "$APP_DIR"
pg_user="$(env_value POSTGRES_USER)"
[[ -n "$pg_user" ]] || die "POSTGRES_USER missing from .env"

dest="$BACKUP_DIR/$(date -u +%Y%m%dT%H%M%SZ)-$label"
mkdir -p "$dest"
log "backup -> $dest"

dc exec -T db pg_dumpall -U "$pg_user" --globals-only >"$dest/globals.sql"
for db in auth_db inventory_db borrow_db ai_db; do
  dc exec -T db pg_dump -U "$pg_user" -Fc "$db" >"$dest/$db.dump"
  # a dump that pg_restore cannot list is not a backup
  dc exec -T db pg_restore --list <"$dest/$db.dump" >/dev/null
done

if [[ "$db_only" -eq 0 ]]; then
  if [[ -n "$(dc ps --status running -q inventory-service 2>/dev/null)" ]]; then
    dc exec -T inventory-service tar -czf - -C /app/evidence/packing . >"$dest/packing_evidence.tar.gz"
  else
    log "WARNING: inventory-service not running, packing evidence not backed up"
  fi
fi

(cd "$dest" && sha256sum -- * >SHA256SUMS)
log "backup complete ($(du -sh "$dest" | cut -f1))"

# --- retention ---------------------------------------------------------------------
keep_days="$(env_value BACKUP_KEEP_DAYS)"
keep_days="${keep_days:-14}"
find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -name '*-daily' -mtime +"$keep_days" -exec rm -rf {} +
ls -1d "$BACKUP_DIR"/*-predeploy-* 2>/dev/null | sort -r | tail -n +6 | xargs -r rm -rf

# --- optional off-server copy --------------------------------------------------------
remote="$(env_value BACKUP_RCLONE_REMOTE)"
if [[ -n "$remote" ]]; then
  if command -v rclone >/dev/null; then
    rclone copy "$dest" "$remote/$(basename "$dest")" && log "copied to $remote"
  else
    log "WARNING: BACKUP_RCLONE_REMOTE is set but rclone is not installed"
  fi
fi

[[ "$label" == "daily" ]] && date -u +%s >"$STATE_DIR/last_daily_backup"
exit 0
