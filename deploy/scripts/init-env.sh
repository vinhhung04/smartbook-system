#!/usr/bin/env bash
# Create the production .env from .env.production.example with freshly generated secrets.
# Never overwrites an existing .env (that would orphan the database password). Secrets are
# written straight to the file (mode 600) and never printed.
set -Eeuo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

target="$APP_DIR/.env"
[[ -e "$target" ]] && die "$target already exists - edit it instead"
[[ -f "$APP_DIR/.env.production.example" ]] || die ".env.production.example missing"

umask 077
# hex only: these end up inside postgresql:// and amqp:// URLs
gen() { openssl rand -hex "${1:-32}"; }

sed \
  -e "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$(gen 24)/" \
  -e "s/^ANALYTICS_DB_PASSWORD=.*/ANALYTICS_DB_PASSWORD=$(gen 24)/" \
  -e "s/^RABBITMQ_PASSWORD=.*/RABBITMQ_PASSWORD=$(gen 24)/" \
  -e "s/^JWT_SECRET=.*/JWT_SECRET=$(gen 48)/" \
  -e "s/^INTERNAL_SERVICE_KEY=.*/INTERNAL_SERVICE_KEY=$(gen 32)/" \
  "$APP_DIR/.env.production.example" >"$target"
chmod 600 "$target"
log "created $target - now fill in OPENROUTER_API_KEY (and SMTP/VNPay if used)"
