# Independent Auth migration verification

Create only the previously absent `auth_audit` database inside independently verified loopback audit PostgreSQL container `smartbook-audit-borrow-6a880256`, host127.0.0.1:25432. Apply Auth's three existing baseline migrations to that empty database. No production connection, no reset/drop/clean, no user or role data is copied or deleted. Existing Auth migration files remain unchanged.

Purpose: verify Prisma matches the DDL obtained from the authoritative migration chain, alongside Borrow and Inventory. Locks/index builds affect only new empty Auth audit relations. No application backfill or compatibility change. Verification: current_database, applied migration count, read-only Prisma diff and mandatory `schema-drift.db.test.js`. Keep the empty audit schema for later tests; forward-fix through new migrations if drift is found. This is test setup, not a new production migration.
