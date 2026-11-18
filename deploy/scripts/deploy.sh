#!/usr/bin/env bash
# Explicit backup -> owner migration -> compatible runtime rollout. No schema
# rollback or unverified automatic image fallback; failures retain maintenance.
set -Eeuo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
registry_user=''
if [[ "${1:-}" == --registry-login ]]; then registry_user="${2:?user required}"; shift 2; fi
TAG="${1:?release SHA required}"
[[ "$TAG" =~ ^[0-9a-f]{40}$ ]] || die "full commit SHA required"
cd "$APP_DIR"
[[ -f .env ]] || die "production environment missing"
mkdir -p "$STATE_DIR" "$BACKUP_DIR"
exec 9>"$STATE_DIR/deploy.lock"
flock -n 9 || die "another release operation is running"
PREV_TAG="$(current_tag)"
manifest="$STATE_DIR/images/$TAG.env"
[[ -f "$manifest" ]] || die "exact-SHA image digest manifest is required"
declare -A images=()
while IFS='=' read -r key value; do
  [[ "$key" =~ ^[A-Z_]+_IMAGE$ && "$value" =~ ^ghcr\.io/[a-z0-9_./-]+@sha256:[a-f0-9]{64}$ ]] || die "invalid image digest manifest"
  [[ -z "${images[$key]:-}" ]] || die "duplicate image manifest key"
  images[$key]="$value"
done <"$manifest"
for service in "${IMAGE_SERVICES[@]}"; do
  key="${service^^}_IMAGE"; key="${key//-/_}"
  [[ "${images[$key]:-}" == ghcr.io/vinhhung04/smartbook-"$service"@sha256:* ]] || die "missing/wrong service image digest"
done
[[ ${#images[@]} -eq ${#IMAGE_SERVICES[@]} ]] || die "unexpected image manifest entries"
if [[ -n "$registry_user" ]]; then
  export DOCKER_CONFIG="$(mktemp -d)"
  trap 'docker logout ghcr.io >/dev/null 2>&1 || true' EXIT
  docker login ghcr.io -u "$registry_user" --password-stdin >/dev/null
fi
IMAGE_TAG="$TAG" dc pull --quiet "${IMAGE_SERVICES[@]}"
for reference in "${images[@]}"; do
  docker image inspect "$reference" --format '{{json .RepoDigests}}' | grep -Fq "$reference" || die "pulled image digest differs from verified artifact"
done
if [[ -n "$registry_user" ]]; then docker logout ghcr.io >/dev/null; unset DOCKER_CONFIG; trap - EXIT; fi
running=()
while IFS= read -r service; do
  for app in "${APP_SERVICES[@]}"; do [[ "$service" != "$app" ]] || running+=("$service"); done
done < <(dc ps --status running --services)
[[ ${#running[@]} -eq 0 ]] || dc stop --timeout 45 "${running[@]}"
# Old writers are stopped before taking independent database snapshots/files.
if [[ -n "$(dc ps --status running -q db)" ]]; then
  "$APP_DIR/deploy/scripts/backup.sh" --label "predeploy-${TAG:0:12}"
fi
IMAGE_TAG="$TAG" dc up -d --wait --wait-timeout 180 db redis rabbitmq
# Owner identities/DDL are never present in application runtime environments.
dc exec -T db bash /docker-entrypoint-initdb.d/04-runtime-roles.sh
for service in auth inventory borrow ai; do
  IMAGE_TAG="$TAG" dc run --rm --no-deps -T "migrate-$service"
done
# Include current and future tables (e.g. AI quota leases), with no runtime DDL.
dc exec -T db bash /docker-entrypoint-initdb.d/04-runtime-roles.sh
IMAGE_TAG="$TAG" bash "$APP_DIR/deploy/scripts/prepare-volumes.sh"
rollout() { IMAGE_TAG="$1" dc up -d --wait --wait-timeout 600 "${APP_SERVICES[@]}" prometheus grafana caddy; }
smoke() {
  curl -fsS --max-time 10 --resolve api.smartbook.io.vn:443:127.0.0.1 https://api.smartbook.io.vn/ready >/dev/null \
    && curl -fsS --max-time 10 --resolve smartbook.io.vn:443:127.0.0.1 https://smartbook.io.vn/ >/dev/null
}
if rollout "$TAG" && smoke; then
  printf 'IMAGE_TAG=%s\n' "$TAG" >"$RELEASE_ENV.tmp"
  mv "$RELEASE_ENV.tmp" "$RELEASE_ENV"
  printf '%s %s deployed\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$TAG" >>"$RELEASES_LOG"
  log "release healthy"
else
  # Do not leave a partially healthy new fleet accepting writes.
  IMAGE_TAG="$TAG" dc stop --timeout 45 "${APP_SERVICES[@]}" || true
  printf '%s %s failed\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$TAG" >>"$RELEASES_LOG"
  log "release failed; applications stopped, DB preserved; reviewed forward-fix required"
  # An operator may install evidence after testing this exact old/new pair on QA.
  evidence="$STATE_DIR/compatibility/$TAG-${PREV_TAG:-none}.json"
  if [[ -n "$PREV_TAG" && "$PREV_TAG" != "$TAG" && -f "$evidence" ]] \
    && jq -e --arg from "$TAG" --arg to "$PREV_TAG" '.from==$from and .to==$to and .schema_and_business_compatible==true and (.qa_evidence_sha256|test("^[0-9a-f]{64}$"))' "$evidence" >/dev/null; then
    if rollout "$PREV_TAG" && smoke; then log "QA-reviewed image fallback healthy; schema retained"; else dc stop --timeout 45 "${APP_SERVICES[@]}" || true; fi
  fi
  exit 1
fi
