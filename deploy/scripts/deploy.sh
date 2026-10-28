#!/usr/bin/env bash
# Deploy one release of SmartBook (images tagged with a commit SHA) and roll back to the
# previous release if it does not come up healthy.
#
#   deploy.sh [--registry-login <github-user>] <image-tag>
#
# --registry-login reads a GHCR token (the CI job's short-lived GITHUB_TOKEN) from stdin
# and keeps it in a throwaway DOCKER_CONFIG that is deleted after the pull, so no registry
# credential is ever stored on the server.
#
# Safe to re-run with the same tag. Never touches volumes; db/redis/rabbitmq/caddy are only
# recreated when their own definition in compose.prod.yml changes.
set -Eeuo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

registry_user=""
if [[ "${1:-}" == "--registry-login" ]]; then
  registry_user="${2:?--registry-login needs a user name}"
  shift 2
fi
TAG="${1:?usage: deploy.sh [--registry-login <user>] <image-tag>}"
[[ "$TAG" =~ ^[0-9a-f]{7,40}$ ]] || die "image tag must be a commit SHA, got: $TAG"

cd "$APP_DIR"
[[ -f .env ]] || die "$APP_DIR/.env is missing (deploy/scripts/init-env.sh creates it)"
mkdir -p "$STATE_DIR" "$BACKUP_DIR"

exec 9>"$STATE_DIR/deploy.lock"
flock -n 9 || die "another deploy is running"

PREV_TAG="$(current_tag)"
log "deploying $TAG (current: ${PREV_TAG:-none})"

# --- pull the new application images -------------------------------------------------
if [[ -n "$registry_user" ]]; then
  DOCKER_CONFIG="$(mktemp -d)"
  export DOCKER_CONFIG
  trap 'rm -rf "$DOCKER_CONFIG"' EXIT
  docker login ghcr.io -u "$registry_user" --password-stdin >/dev/null
fi
IMAGE_TAG="$TAG" dc pull --quiet "${APP_SERVICES[@]}"
if [[ -n "$registry_user" ]]; then
  docker logout ghcr.io >/dev/null 2>&1 || true
  rm -rf "$DOCKER_CONFIG"
  unset DOCKER_CONFIG
  trap - EXIT
fi

# --- safety copy of the databases before migrations run --------------------------------
if [[ -n "$(dc ps --status running -q db 2>/dev/null)" ]]; then
  "$APP_DIR/deploy/scripts/backup.sh" --label "predeploy-${TAG:0:12}" --db-only
fi

# --- roll out ------------------------------------------------------------------------
rollout() {
  IMAGE_TAG="$1" dc up -d --remove-orphans --wait --wait-timeout 600
}

smoke() {
  local i
  for i in $(seq 1 30); do
    if curl -fsS --max-time 10 --resolve api.smartbook.io.vn:443:127.0.0.1 \
         https://api.smartbook.io.vn/ready >/dev/null \
       && curl -fsS --max-time 10 --resolve smartbook.io.vn:443:127.0.0.1 \
         https://smartbook.io.vn/ >/dev/null; then
      return 0
    fi
    sleep 5
  done
  return 1
}

if rollout "$TAG" && smoke; then
  printf 'IMAGE_TAG=%s\n' "$TAG" >"$RELEASE_ENV.tmp"
  mv "$RELEASE_ENV.tmp" "$RELEASE_ENV"
  printf '%s %s deployed\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$TAG" >>"$RELEASES_LOG"
  log "release $TAG is live"
else
  log "release $TAG failed its health checks"
  dc ps || true
  dc logs --no-color --tail=80 "${APP_SERVICES[@]}" || true
  printf '%s %s failed\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$TAG" >>"$RELEASES_LOG"
  if [[ -n "$PREV_TAG" && "$PREV_TAG" != "$TAG" ]]; then
    log "rolling back to $PREV_TAG (application images only; database schema is left as is)"
    if rollout "$PREV_TAG" && smoke; then
      printf '%s %s rolled-back-to\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$PREV_TAG" >>"$RELEASES_LOG"
      log "rollback to $PREV_TAG succeeded"
    else
      log "rollback to $PREV_TAG ALSO failed - manual intervention needed"
    fi
  fi
  exit 1
fi

# --- keep the images of the last 3 releases (rollback targets), drop older ones --------
mapfile -t keep < <(awk '$3=="deployed"{print $2}' "$RELEASES_LOG" | tac | awk '!seen[$0]++' | head -n 3)
docker image ls --format '{{.Repository}}:{{.Tag}}' \
  | grep -E '^ghcr\.io/[^/]+/smartbook-[a-z-]+:[0-9a-f]{7,40}$' \
  | while read -r ref; do
      tag="${ref##*:}"
      printf '%s\n' "${keep[@]}" | grep -qx "$tag" || docker image rm "$ref" >/dev/null 2>&1 || true
    done
docker image prune -f >/dev/null 2>&1 || true

dc ps --format 'table {{.Service}}\t{{.Image}}\t{{.Status}}'
