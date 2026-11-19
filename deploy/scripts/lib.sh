#!/usr/bin/env bash
# Shared helpers for the SmartBook production scripts. Sourced, not executed.

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
STATE_DIR="$APP_DIR/state"
BACKUP_DIR="$APP_DIR/backups"
RELEASE_ENV="$STATE_DIR/release.env"
RELEASES_LOG="$STATE_DIR/releases.log"

# Only application writers are quiesced for a consistent recovery capture.
APP_SERVICES=(inventory-service auth-service borrow-service analytics-service ai-service api-gateway web)
# Caddy and monitoring-service are versioned release artifacts, but never
# application writers. Other infrastructure remains outside release pulls.
IMAGE_SERVICES=("${APP_SERVICES[@]}" caddy monitoring-service)
# Started after a healthy rollout and never part of the release gate (deploy.sh).
MONITORING_SERVICES=(monitoring-service prometheus grafana node-exporter cadvisor postgres-exporter redis-exporter)

log() { printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
die() { log "ERROR: $*" >&2; exit 1; }

dc() {
  local env_args=(--env-file "$APP_DIR/.env")
  [[ -f "$RELEASE_ENV" ]] && env_args+=(--env-file "$RELEASE_ENV")
  local tag="${IMAGE_TAG:-$(current_tag)}"
  [[ ! -f "$STATE_DIR/images/$tag.env" ]] || env_args+=(--env-file "$STATE_DIR/images/$tag.env")
  docker compose --project-directory "$APP_DIR" -f "$APP_DIR/compose.prod.yml" "${env_args[@]}" "$@"
}

current_tag() {
  [[ -f "$RELEASE_ENV" ]] && sed -n 's/^IMAGE_TAG=//p' "$RELEASE_ENV" | head -n1
  return 0
}

env_value() {
  sed -n "s/^$1=//p" "$APP_DIR/.env" | head -n1
}
