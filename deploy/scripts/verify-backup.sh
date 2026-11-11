#!/usr/bin/env bash
# Prove a backup can be restored, without touching production data: each database dump
# is restored into a throwaway database, its table count compared with the live one,
# and the throwaway database dropped again.
#
#   verify-backup.sh [backup-dir]     (default: newest backup)
set -Eeuo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

src="${1:-$(find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d | sort | tail -n1)}"
src="${src%/}"
[[ -n "$src" && -f "$src/SHA256SUMS" ]] || die "no backup to verify"
(cd "$src" && sha256sum -c --quiet SHA256SUMS) || die "checksum mismatch in $src"
log "verifying $src"

cd "$APP_DIR"
pg_user="$(env_value POSTGRES_USER)"
psql_q() { dc exec -T db psql -U "$pg_user" -d "$1" -Atqc "$2"; }
count_sql="select count(*) from information_schema.tables where table_schema='public'"

failed=0
for db in auth_db inventory_db borrow_db ai_db; do
  scratch="restore_check_${db}"
  psql_q postgres "drop database if exists $scratch" >/dev/null
  psql_q postgres "create database $scratch" >/dev/null
  if dc exec -T db pg_restore -U "$pg_user" -d "$scratch" --no-owner --exit-on-error <"$src/$db.dump"; then
    restored="$(psql_q "$scratch" "$count_sql")"
    live="$(psql_q "$db" "$count_sql")"
    log "$db: restored $restored tables (live: $live)"
    [[ "$restored" -gt 0 && "$restored" -eq "$live" ]] || failed=1
  else
    log "$db: pg_restore FAILED"
    failed=1
  fi
  psql_q postgres "drop database if exists $scratch" >/dev/null
done

if [[ -f "$src/packing_evidence.tar.gz" ]]; then
  tar -tzf "$src/packing_evidence.tar.gz" >/dev/null && log "packing_evidence.tar.gz: archive OK" || failed=1
fi

[[ "$failed" -eq 0 ]] && log "backup verified" || die "backup verification failed"
