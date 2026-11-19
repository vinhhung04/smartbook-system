#!/usr/bin/env bash
# Only independent, empty targets. Never cleans or replaces DB/files/volumes.
set -Eeuo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
src="${1:?usage: restore.sh backup-directory --isolated-empty-target}"
[[ "${2:-}" == --isolated-empty-target ]] || die "production overwrite disabled; independent empty target required"
[[ "${SMARTBOOK_RECOVERY_ISOLATED:-}" == 1 && "${SMARTBOOK_RECOVERY_PROJECT:-}" =~ ^smartbook-recovery-[a-f0-9]{8}$ ]] || die "independent recovery identity required"
[[ -f "$src/SHA256SUMS" && -f "$src/manifest.json" ]] || die "complete recovery manifest required"
src="$(cd "$src" && pwd)"
(cd "$src" && sha256sum -c --quiet SHA256SUMS) || die "checksum verification failed"
jq -e '.format==2 and .encrypted==true and .boundary=="writers-stopped"' "$src/manifest.json" >/dev/null || die "unsupported recovery manifest"
[[ -n "${SMARTBOOK_RECOVERY_COMPOSE:-}" && -f "$SMARTBOOK_RECOVERY_COMPOSE" ]] || die "independent Compose file required"
[[ "$(cd "$(dirname "$SMARTBOOK_RECOVERY_COMPOSE")" && pwd)/$(basename "$SMARTBOOK_RECOVERY_COMPOSE")" != "$APP_DIR/compose.prod.yml" ]] || die "production Compose forbidden"
rc() { docker compose -p "$SMARTBOOK_RECOVERY_PROJECT" -f "$SMARTBOOK_RECOVERY_COMPOSE" "$@"; }
container="$(rc ps -q db)"
[[ -n "$container" ]] || die "recovery database not running"
actual="$(docker inspect "$container" --format '{{index .Config.Labels "com.docker.compose.project"}}')"
[[ "$actual" == "$SMARTBOOK_RECOVERY_PROJECT" ]] || die "container identity mismatch"
# A project label alone does not prove storage isolation. Refuse external/bind
# data storage, unexpected PGDATA, or volumes owned by another Compose project.
config="$(rc config --format json)"
printf '%s' "$config" | jq -e '.services.db.environment.PGDATA // "/var/lib/postgresql/data" | .=="/var/lib/postgresql/data"' >/dev/null || die "unexpected recovery PGDATA"
for service in db recovery-files; do
  printf '%s' "$config" | jq -e --arg service "$service" '[.services[$service].volumes[] | select(.type!="volume" and (.type!="bind" or .read_only!=true or (.target|startswith("/docker-entrypoint-initdb.d/")|not)))] | length==0' >/dev/null || die "unexpected writable/bind recovery storage"
  while IFS= read -r source; do
    name="$(printf '%s' "$config" | jq -r --arg source "$source" '.volumes[$source] | if .external==true or ((.driver_opts//{})|length)>0 or ((.driver//"local")!="local") then "EXTERNAL" else .name end')"
    [[ -n "$name" && "$name" != null && "$name" != EXTERNAL ]] || die "external recovery volume forbidden"
    # Missing volumes may be created by this exact recovery project below;
    # existing volumes must already belong to it.
    if docker volume inspect "$name" >/dev/null 2>&1; then
      owner="$(docker volume inspect "$name" --format '{{index .Labels "com.docker.compose.project"}}')"
      [[ "$owner" == "$SMARTBOOK_RECOVERY_PROJECT" ]] || die "recovery volume owner mismatch"
    fi
  done < <(printf '%s' "$config" | jq -r --arg service "$service" '.services[$service].volumes[] | select(.type=="volume") | .source')
done
# A retained container can disagree with its current Compose definition.
# Validate its actual environment and mounted storage before touching any DB.
runtime="$(docker inspect "$container")"
printf '%s' "$runtime" | jq -e '.[0].Config.Env | map(select(startswith("PGDATA="))) | all(.=="PGDATA=/var/lib/postgresql/data")' >/dev/null || die "unexpected actual recovery PGDATA"
printf '%s' "$runtime" | jq -e --argjson config "$config" '
  .[0].Mounts | all(
    . as $mount |
    if .Type=="volume" then
      any($config.services.db.volumes[]; .type=="volume" and .target==$mount.Destination and $config.volumes[.source].name==$mount.Name)
    elif .Type=="bind" then
      .RW==false and (.Destination|startswith("/docker-entrypoint-initdb.d/"))
    else false end
  ) and any(.[]; .Type=="volume" and .Destination=="/var/lib/postgresql/data")
' >/dev/null || die "actual recovery storage mismatch"
user="${SMARTBOOK_RECOVERY_DB_USER:?recovery bootstrap user required}"
# Validate every target before the first write.
for database in auth_db inventory_db borrow_db ai_db; do
  [[ -f "$src/$database.dump.gpg" ]] || die "missing database artifact"
  # --list reads the archive TOC and may stop before a large body is consumed.
  # Drain the rest inside the receiver so GPG can finish its integrity check;
  # preserve a failed TOC check instead of hiding it behind the final drain.
  gpg --batch --decrypt "$src/$database.dump.gpg" | rc exec -T db sh -c 'result=0; pg_restore --list >/dev/null || result=$?; cat >/dev/null; exit "$result"' || die "invalid encrypted database artifact"
  count="$(rc exec -T db psql -U "$user" -d "$database" -Atqc "SELECT (SELECT count(*) FROM pg_namespace WHERE nspname NOT IN ('public','pg_catalog','information_schema') AND nspname !~ '^pg_') + (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public') + (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public') + (SELECT count(*) FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public')")"
  [[ "$count" == 0 ]] || die "recovery database not empty"
done
for kind in packing procurement; do
  [[ -f "$src/${kind}_evidence.tar.gz.gpg" ]] || die "missing encrypted file artifact"
  gpg --batch --decrypt "$src/${kind}_evidence.tar.gz.gpg" | tar -tzf - | awk '/(^\/|(^|\/)\.\.(\/|$))/ {exit 1}' || die "unsafe archive path"
  gpg --batch --decrypt "$src/${kind}_evidence.tar.gz.gpg" | tar -tvzf - | awk 'substr($0,1,1)!="-" && substr($0,1,1)!="d" {exit 1}' || die "archive links/special files forbidden"
done
rc run --rm --no-deps -T --entrypoint sh recovery-files -c 'test -z "$(ls -A /recovery/packing)" && test -z "$(ls -A /recovery/procurement)"' || die "recovery files not empty"
for database in auth_db inventory_db borrow_db ai_db; do
  gpg --batch --decrypt "$src/$database.dump.gpg" | rc exec -T db pg_restore -U "$user" -d "$database" --no-owner --no-acl --exit-on-error --single-transaction
done
for kind in packing procurement; do
  gpg --batch --decrypt "$src/${kind}_evidence.tar.gz.gpg" | rc run --rm --no-deps -T --entrypoint tar recovery-files -xzf - -C "/recovery/$kind"
done
log "Independent restore completed; business/file checks required. Encrypted config/roles require reviewed recovery, never auto-apply."
