#!/usr/bin/env bash
# Lightweight monitoring, run every 5 minutes by cron: container health, public endpoints,
# disk, memory, Postgres size, TLS certificate expiry and backup freshness. Problems go to
# syslog (`journalctl -t smartbook-health`) and, when ALERT_WEBHOOK_URL is set in .env, to
# that webhook as {"text": "..."} (Discord/Slack-compatible). Exit code 1 = something is wrong.
#
#   healthcheck.sh [--verbose]
set -Eeuo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

verbose=0; [[ "${1:-}" == "--verbose" ]] && verbose=1
problems=()
info() { [[ $verbose -eq 1 ]] && log "$*"; return 0; }

cd "$APP_DIR"

# containers
while IFS=$'\t' read -r svc state health; do
  [[ -z "$svc" ]] && continue
  if [[ "$state" != "running" || ( -n "$health" && "$health" != "healthy" ) ]]; then
    problems+=("container $svc is $state${health:+/$health}")
  fi
  info "container $svc: $state${health:+/$health}"
done < <(dc ps -a --format '{{.Service}}\t{{.State}}\t{{.Health}}' 2>/dev/null)

# public endpoints through Caddy
for url in https://smartbook.io.vn/ https://api.smartbook.io.vn/ready; do
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$url" || echo 000)"
  [[ "$code" == "200" ]] || problems+=("$url answered $code")
  info "$url -> $code"
done

# disk and memory
disk="$(df --output=pcent / | tail -1 | tr -dc '0-9')"
[[ "$disk" -lt 85 ]] || problems+=("root disk ${disk}% full")
mem="$(free | awk '/^Mem:/{printf "%d", ($2-$7)*100/$2}')"
[[ "$mem" -lt 92 ]] || problems+=("memory ${mem}% used")
info "disk ${disk}%, memory ${mem}%"

# database size
pg_user="$(env_value POSTGRES_USER)"
dbsize="$(dc exec -T db psql -U "$pg_user" -d postgres -Atqc \
  "select pg_size_pretty(sum(pg_database_size(datname))) from pg_database" 2>/dev/null || echo '?')"
info "postgres total size: $dbsize"

# TLS certificates
for host in smartbook.io.vn api.smartbook.io.vn www.smartbook.io.vn; do
  end="$(echo | openssl s_client -servername "$host" -connect "$host:443" 2>/dev/null \
    | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)"
  if [[ -z "$end" ]]; then problems+=("no TLS certificate readable for $host"); continue; fi
  days=$(( ($(date -d "$end" +%s) - $(date +%s)) / 86400 ))
  [[ "$days" -ge 14 ]] || problems+=("TLS certificate for $host expires in $days days")
  info "cert $host: $days days left"
done

# backups
if [[ -f "$STATE_DIR/last_daily_backup" ]]; then
  age_h=$(( ($(date +%s) - $(cat "$STATE_DIR/last_daily_backup")) / 3600 ))
  [[ "$age_h" -le 26 ]] || problems+=("last daily backup is ${age_h}h old")
  info "last daily backup ${age_h}h ago"
else
  problems+=("no daily backup has run yet")
fi

if [[ ${#problems[@]} -eq 0 ]]; then
  info "all checks passed"
  exit 0
fi

msg="SmartBook (smartbook): $(IFS='; '; echo "${problems[*]}")"
logger -t smartbook-health -p user.warning "$msg"
[[ $verbose -eq 1 ]] && log "$msg"
webhook="$(env_value ALERT_WEBHOOK_URL)"
if [[ -n "$webhook" ]]; then
  # alert once per distinct problem set per hour
  stamp="$STATE_DIR/last_alert"
  sig="$(printf '%s' "$msg" | sha256sum | cut -c1-16)"
  if [[ ! -f "$stamp" || "$(cut -d' ' -f1 "$stamp")" != "$sig" || $(( $(date +%s) - $(cut -d' ' -f2 "$stamp") )) -gt 3600 ]]; then
    curl -fsS --max-time 10 -H 'Content-Type: application/json' \
      -d "$(jq -n --arg t "$msg" '{text: $t, content: $t}')" "$webhook" >/dev/null || true
    echo "$sig $(date +%s)" >"$stamp"
  fi
fi
exit 1
