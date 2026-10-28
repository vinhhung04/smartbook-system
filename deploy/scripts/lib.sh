#!/usr/bin/env bash
# Shared helpers for the SmartBook production scripts. Sourced, not executed.

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
STATE_DIR="$APP_DIR/state"
BACKUP_DIR="$APP_DIR/backups"
RELEASE_ENV="$STATE_DIR/release.env"
RELEASES_LOG="$STATE_DIR/releases.log"

# Application images built by CI, one per service in compose.prod.yml. Infrastructure
# images (db, redis, rabbitmq, caddy) are deliberately absent: a deploy never pulls
# them, so it never restarts the database just because upstream re-tagged pg15.
APP_SERVICES=(inventory-service auth-service borrow-service analytics-service ai-service api-gateway web)

log() { printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
die() { log "ERROR: $*" >&2; exit 1; }

dc() {
  local env_args=(--env-file "$APP_DIR/.env")
  [[ -f "$RELEASE_ENV" ]] && env_args+=(--env-file "$RELEASE_ENV")
  docker compose --project-directory "$APP_DIR" -f "$APP_DIR/compose.prod.yml" "${env_args[@]}" "$@"
}

current_tag() {
  [[ -f "$RELEASE_ENV" ]] && sed -n 's/^IMAGE_TAG=//p' "$RELEASE_ENV" | head -n1
  return 0
}

env_value() {
  sed -n "s/^$1=//p" "$APP_DIR/.env" | head -n1
}
