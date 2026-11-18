#!/usr/bin/env bash
# Test boundary only. Nothing in this file calls Docker, a provider, a database,
# rm, find -exec, or xargs with a command. Every generated artifact is retained.
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
STATE_DIR="$APP_DIR/state"
BACKUP_DIR="$APP_DIR/backups"
RELEASE_ENV="$STATE_DIR/release.env"
RELEASES_LOG="$STATE_DIR/releases.log"
APP_SERVICES=(inventory-service auth-service borrow-service analytics-service ai-service api-gateway web)
IMAGE_SERVICES=("${APP_SERVICES[@]}" caddy)
: > "$APP_DIR/calls.log"
trace() { printf '%s\n' "$*" >> "$APP_DIR/calls.log"; }
log() { printf '%s\n' "$*"; }
die() { printf '%s\n' "$*" >&2; exit 1; }
current_tag() { printf '%s\n' 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'; }
env_value() {
  case "$1" in
    POSTGRES_USER) printf '%s\n' 'audit_user' ;;
    BACKUP_KEEP_DAYS) printf '%s\n' '14' ;;
    BACKUP_ENCRYPTION_RECIPIENT) printf '%s\n' 'SANDBOX-PUBLIC-RECIPIENT' ;;
    BACKUP_RCLONE_REMOTE) printf '%s\n' 'audit:backups' ;;
    ALERT_WEBHOOK_URL) printf '%s\n' 'https://audit.invalid/never-contacted' ;;
    *) printf '\n' ;;
  esac
}
dc() {
  trace "DC IMAGE_TAG=${IMAGE_TAG:-unset} $*"
  case "$*" in
    'ps --status running --services')
      if [[ "$OPS_TEST_SCENARIO" == backup-restart-failure && ! -f "$STATE_DIR/writers-stopped" ]]; then echo borrow-service; else echo db; fi ;;
    'ps -aq') return 0 ;;
    'ps --status running -q db') return 0 ;;
    'ps --status running -q inventory-service') printf '%s\n' 'sandbox-inventory' ;;
    'ps -a --format '*) printf 'inventory-service\trunning\tunhealthy\n' ;;
    'exec -T db pg_dumpall '*) printf '%s\n' '-- opaque fake globals; not a real dump' ;;
    'exec -T db pg_dump '*) printf '%s\n' 'opaque fake dump; not a restore proof' ;;
    'exec -T db pg_restore --list') cat >/dev/null ;;
    'exec -T db psql '*) printf '%s\n' '1 MB' ;;
    'exec -T rabbitmq rabbitmqctl list_queues '*) printf '%s\n' '[]' ;;
    'exec -T inventory-service tar '*) printf '%s\n' 'opaque fake archive; not a restore proof' ;;
    'run --rm --no-deps -T --entrypoint tar backup-files '*) printf '%s\n' 'opaque fake archive; not a restore proof' ;;
    'exec -T caddy cat /etc/caddy/Caddyfile') cat "$APP_DIR/deploy/Caddyfile" ;;
    'pull --quiet '*) return 0 ;;
    'up -d --wait --wait-timeout 180 db redis rabbitmq') return 0 ;;
    'exec -T db bash /docker-entrypoint-initdb.d/04-runtime-roles.sh') return 0 ;;
    'run --rm --no-deps -T migrate-'*) return 0 ;;
    'run --rm --no-deps -T prepare-volumes') return 0 ;;
    'stop --timeout 45 '*) printf stopped >"$STATE_DIR/writers-stopped"; return 0 ;;
    'start --wait --wait-timeout 120 '*) [[ "$OPS_TEST_SCENARIO" != backup-restart-failure ]] ;;
    'up -d '*) return 1 ;;
    'logs '*) return 0 ;;
    'ps') return 0 ;;
    *) trace "UNEXPECTED dc $*"; return 97 ;;
  esac
}
gpg() {
  # Tests verify shell flow only; this opaque marker is not real encryption.
  local output=''
  while [[ $# -gt 0 ]]; do
    if [[ "$1" == --output ]]; then output="$2"; shift 2; else shift; fi
  done
  [[ -n "$output" ]] || return 97
  cat >"$output"
}
rclone() {
  trace "RCLONE $*"
  case "$OPS_TEST_SCENARIO:$1" in
    offsite-copy-failure:copy) return 23 ;;
    offsite-verify-failure:check) return 24 ;;
    *:copy|*:check) return 0 ;;
    *) trace "UNEXPECTED rclone $*"; return 97 ;;
  esac
}
curl() {
  trace "CURL $*"
  if [[ "$*" == *'%{http_code}'* ]]; then printf '200'; return 0; fi
  [[ "$OPS_TEST_SCENARIO" != alert-delivery-failure ]]
}
logger() { trace "LOGGER $*"; }
jq() { printf '%s\n' '{"text":"sandbox alert"}'; }
df() { printf 'Use%%\n1%%\n'; }
free() { printf 'Mem: 100 1 0 0 0 99\n'; }
openssl() {
  trace "OPENSSL $1"
  if [[ "$1" == x509 ]]; then printf '%s\n' 'notAfter=Dec 31 23:59:59 2030 GMT'; else cat >/dev/null; fi
}
flock() { trace "FLOCK $*"; return 0; }
sleep() { trace "SLEEP_STUB $*"; }
# Retention enumeration/deletion never runs, even on sandbox artifacts.
find() { trace "RETENTION_ENUMERATION_STUB $*"; }
xargs() { trace "RETENTION_EXECUTION_STUB $*"; cat >/dev/null; }
rm() { trace "DELETION_DENIED rm $*"; return 97; }
docker() {
  trace "DOCKER $*"
  if [[ "$1 $2" == 'image inspect' ]]; then printf '["%s"]\n' "$3"; return 0; fi
  trace "UNEXPECTED docker $*"; return 97;
}
