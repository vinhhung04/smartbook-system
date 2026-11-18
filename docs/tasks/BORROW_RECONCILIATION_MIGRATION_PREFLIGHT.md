# Borrow reconciliation retry metadata preflight

Migration `20261118020000_reconciliation_retry_metadata` adds `next_attempt_at`, `lease_until`, `last_error_code` and an automatic-queue selection index to Borrow `integration_outbox`. No records are deleted or reclassified; existing records are immediately eligible by their original event type/status. PostgreSQL's constant transaction-time default avoids a row-by-row application backfill. Existing terminal records retain their original meaning.

The ALTER TABLE takes a brief exclusive lock; index creation scans this outbox only. Rehearse with lock_timeout=5s and statement_timeout=30s. Before production execution inspect table size, long transactions and index duration, then schedule the coordinated worker maintenance window. Production execution is not authorized here.

Application compatibility: additive columns remain readable by old versions, but old workers lack leases/filtering and must be stopped before enabling the new worker. Regenerate Prisma Client. Verify row/status counts unchanged, constraints/defaults/index in pg_catalog, and concurrent worker/lease-expiry/backoff tests against real PostgreSQL. Never run destructive reset or delete unresolved records.

Forward recovery: keep additive columns and original payloads; stop workers for investigation, use audited requeue or explicit evidence-based manual resolution. Do not roll old workers back into service. Database restore is a separate disaster-recovery operation.

Local execution scope is only independently verified loopback audit PostgreSQL `127.0.0.1:25432/borrow_audit`; no production migration or external mutation.

Read-only verification SQL (run against the explicitly verified database before/after):

```sql
SELECT status, count(*) FROM integration_outbox GROUP BY status ORDER BY status;
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'integration_outbox'
  AND column_name IN ('next_attempt_at', 'lease_until', 'last_error_code');
SELECT indexname, indexdef FROM pg_indexes
WHERE schemaname = 'public' AND tablename = 'integration_outbox';
SELECT count(*) AS missing_due_timestamp FROM integration_outbox WHERE next_attempt_at IS NULL;
```

Audit rehearsal execution: row/status counts before and after were identical (108 PENDING, 5 PUBLISHED at this checkpoint), no missing due timestamp, and the new migration was registered only after its transaction committed. Subsequent additive test fixtures change queue counts and are not migration backfill.
