#!/bin/bash
# Creates a read-only Postgres role for analytics-service and grants it SELECT-only
# access to inventory_db and borrow_db. analytics-service aggregates data owned by
# those two services for reporting; it must never be able to write to them.
set -e

: "${ANALYTICS_DB_USER:=analytics_reader}"
: "${ANALYTICS_DB_PASSWORD:?ANALYTICS_DB_PASSWORD must be set to create the analytics read-only role}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "${POSTGRES_DB:-postgres}" <<-EOSQL
    DO \$\$
    BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${ANALYTICS_DB_USER}') THEN
        CREATE ROLE ${ANALYTICS_DB_USER} LOGIN PASSWORD '${ANALYTICS_DB_PASSWORD}';
      ELSE
        ALTER ROLE ${ANALYTICS_DB_USER} WITH LOGIN PASSWORD '${ANALYTICS_DB_PASSWORD}';
      END IF;
    END
    \$\$;
EOSQL

for DB in inventory_db borrow_db; do
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$DB" <<-EOSQL
      GRANT CONNECT ON DATABASE ${DB} TO ${ANALYTICS_DB_USER};
      GRANT USAGE ON SCHEMA public TO ${ANALYTICS_DB_USER};
      GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${ANALYTICS_DB_USER};
      ALTER DEFAULT PRIVILEGES FOR ROLE "${POSTGRES_USER}" IN SCHEMA public GRANT SELECT ON TABLES TO ${ANALYTICS_DB_USER};
EOSQL
done
