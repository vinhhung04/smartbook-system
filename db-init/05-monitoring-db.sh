#!/usr/bin/env bash
# monitoring_db and its runtime role (monitoring-service, postgres-exporter).
# Explicit bootstrap/owner operation, idempotent: runs on first init (sourced by
# the postgres entrypoint, so no `exit` and no shell-option changes here) and from
# deploy/scripts/deploy.sh on existing clusters. Skipped entirely when
# MONITORING_DB_PASSWORD is unset, so an older .env keeps deploying unchanged.
# Passwords are read by psql (\getenv), never echoed.
if [[ -z "${MONITORING_DB_PASSWORD:-}" ]]; then
  echo "MONITORING_DB_PASSWORD not set: monitoring_db not provisioned" >&2
else
  psql -X -v ON_ERROR_STOP=1 -U "${POSTGRES_USER:?bootstrap owner required}" -d postgres <<'SQL'
SELECT 'CREATE DATABASE monitoring_db' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'monitoring_db')\gexec
SQL
  psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d monitoring_db -v role=monitoring_runtime -v database=monitoring_db -v owner="$POSTGRES_USER" <<'SQL'
\getenv runtime_password MONITORING_DB_PASSWORD
SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT PASSWORD %L', :'role', :'runtime_password')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname=:'role') \gexec
SELECT format('ALTER ROLE %I NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT PASSWORD %L', :'role', :'runtime_password') \gexec
REVOKE CONNECT ON DATABASE :"database" FROM PUBLIC;
REVOKE TEMPORARY ON DATABASE :"database" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"database" TO :"role";
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO :"role";
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO :"role";
SELECT format('REVOKE ALL ON TABLE public._prisma_migrations FROM %I', :'role')
WHERE to_regclass('public._prisma_migrations') IS NOT NULL \gexec
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO :"role";
ALTER DEFAULT PRIVILEGES FOR ROLE :"owner" IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO :"role";
ALTER DEFAULT PRIVILEGES FOR ROLE :"owner" IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO :"role";
-- postgres-exporter gets its own role: pg_monitor only works through INHERIT,
-- which the runtime role deliberately does not have. Cluster statistics
-- (pg_stat_*, settings) and CONNECT to monitoring_db; no table privileges.
SELECT format('CREATE ROLE monitoring_exporter LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD %L', :'runtime_password')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname='monitoring_exporter') \gexec
SELECT format('ALTER ROLE monitoring_exporter LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD %L', :'runtime_password') \gexec
GRANT CONNECT ON DATABASE :"database" TO monitoring_exporter;
GRANT pg_monitor TO monitoring_exporter;
SQL
fi
