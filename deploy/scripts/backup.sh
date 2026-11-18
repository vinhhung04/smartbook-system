#!/usr/bin/env bash
# Full encrypted recovery set; --quiesce drains/stops applications for capture.
# No automatic retention deletion. Independent restore is a separate proof.
set -Eeuo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
label=daily; quiesce=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --label) label="${2:?missing label}"; shift 2 ;;
    --quiesce) quiesce=1; shift ;;
    *) die "usage: backup.sh [--label name] [--quiesce]; partial backups are not recovery sets" ;;
  esac
done
[[ "$label" =~ ^[A-Za-z0-9._-]+$ ]] || die "invalid backup label"
umask 077
cd "$APP_DIR"
mkdir -p "$STATE_DIR" "$BACKUP_DIR"
exec 8>"$STATE_DIR/backup.lock"
flock -n 8 || die "another backup is running"
recipient="$(env_value BACKUP_ENCRYPTION_RECIPIENT)"
[[ -n "$recipient" ]] || die "BACKUP_ENCRYPTION_RECIPIENT required; private key stays off VPS"
command -v gpg >/dev/null || die "gpg is required"
remote="$(env_value BACKUP_RCLONE_REMOTE)"
required="$(env_value BACKUP_OFFSITE_REQUIRED)"; required="${required:-true}"
[[ "$required" != true || -n "$remote" ]] || die "required offsite destination missing"
if [[ -n "$remote" ]]; then command -v rclone >/dev/null || die "rclone required for offsite destination"; fi
running=()
while IFS= read -r service; do
  for app in "${APP_SERVICES[@]}"; do [[ "$service" != "$app" ]] || running+=("$service"); done
done < <(dc ps --status running --services)
if [[ ${#running[@]} -gt 0 ]]; then
  [[ "$quiesce" -eq 1 ]] || die "writers must be drained/stopped, or use --quiesce"
  dc stop --timeout 45 "${running[@]}"
  resume() {
    local status=$?
    trap - EXIT
    if ! dc start --wait --wait-timeout 120 "${running[@]}" >/dev/null; then
      log "ERROR: restart after backup failed; operator action required"
      status=1
    fi
    exit "$status"
  }
  trap resume EXIT
fi
for service in $(dc ps --status running --services); do
  for app in "${APP_SERVICES[@]}"; do [[ "$service" != "$app" ]] || die "writer still running at capture boundary"; done
done
pg_user="$(env_value POSTGRES_USER)"
[[ -n "$pg_user" ]] || die "POSTGRES_USER missing"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
dest="$BACKUP_DIR/$stamp-$label"
mkdir "$dest"
encrypt() { gpg --batch --yes --trust-model always --recipient "$recipient" --output "$1" --encrypt; }
dc exec -T db pg_dumpall -U "$pg_user" --globals-only | encrypt "$dest/globals.sql.gpg"
for database in auth_db inventory_db borrow_db ai_db; do
  dc exec -T db pg_dump -U "$pg_user" -Fc "$database" | encrypt "$dest/$database.dump.gpg"
done
# Incident history (optional, outside the writer-stopped boundary: monitoring-service
# keeps running). pg_dump is still a consistent snapshot of that one database.
# Not restored automatically by restore.sh - see docs/MONITORING.md.
optional_databases='[]'
if [[ "$(dc exec -T db psql -X -U "$pg_user" -d postgres -Atqc "SELECT 1 FROM pg_database WHERE datname='monitoring_db'")" == 1 ]]; then
  dc exec -T db pg_dump -U "$pg_user" -Fc monitoring_db | encrypt "$dest/monitoring_db.dump.gpg"
  optional_databases='["monitoring_db"]'
fi
for kind in packing procurement; do
  dc run --rm --no-deps -T --entrypoint tar backup-files -czf - -C "/recovery/$kind" . | encrypt "$dest/${kind}_evidence.tar.gz.gpg"
done
config=(compose.prod.yml deploy/Caddyfile deploy/scripts .env)
[[ ! -f "$RELEASE_ENV" ]] || config+=(state/release.env)
tar -czf - "${config[@]}" | encrypt "$dest/configuration.tar.gz.gpg"
tag="$(current_tag)"
printf '{"format":2,"boundary":"writers-stopped","created_at":"%s","release":"%s","encrypted":true,"databases":["auth_db","inventory_db","borrow_db","ai_db"],"optional_databases":%s,"files":["packing_evidence.tar.gz.gpg","procurement_evidence.tar.gz.gpg","configuration.tar.gz.gpg"],"restore_verified":false}\n' "$stamp" "${tag:-none}" "$optional_databases" >"$dest/manifest.json"
(cd "$dest" && sha256sum -- *.gpg manifest.json >SHA256SUMS)
(cd "$dest" && sha256sum -c --quiet SHA256SUMS) || die "local checksum verification failed"
date -u +%s >"$STATE_DIR/last_local_backup"
if [[ -n "$remote" ]]; then
  rclone copy "$dest" "$remote/$(basename "$dest")" || die "offsite copy failed; local set retained"
  rclone check --download "$dest" "$remote/$(basename "$dest")" || die "offsite verification failed; freshness unchanged"
  date -u +%s >"$STATE_DIR/last_offsite_backup"
fi
log "Encrypted capture/checksum complete: $(basename "$dest"); independent restore verification still required"
