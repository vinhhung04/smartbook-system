#!/usr/bin/env bash
# Explicit bootstrap/owner operation. Safe on first init and existing schemas;
# never run by an application identity. Passwords read by psql, never echoed.
set -Eeuo pipefail
: "${POSTGRES_USER:?bootstrap owner required}"
for service in auth inventory borrow ai; do
  variable="${service^^}_DB_PASSWORD"
  [[ -n "${!variable:-}" ]] || { echo "Missing runtime password variable: $variable" >&2; exit 1; }
  database="${service}_db"
  role="${service}_runtime"
  psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$database" -v role="$role" -v database="$database" -v owner="$POSTGRES_USER" <<SQL
\getenv runtime_password $variable
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
SQL
done
# Reader retains only read privileges on the two reporting sources.
for database in inventory_db borrow_db; do
  psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$database" -v reader="${ANALYTICS_DB_USER:-analytics_reader}" -v database="$database" -v owner="$POSTGRES_USER" <<'SQL'
GRANT CONNECT ON DATABASE :"database" TO :"reader";
GRANT USAGE ON SCHEMA public TO :"reader";
GRANT SELECT ON ALL TABLES IN SCHEMA public TO :"reader";
ALTER DEFAULT PRIVILEGES FOR ROLE :"owner" IN SCHEMA public GRANT SELECT ON TABLES TO :"reader";
SQL
done
