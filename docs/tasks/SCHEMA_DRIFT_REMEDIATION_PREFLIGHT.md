# PRA15 schema alignment and alias index migration

Read-only Prisma diff against fully migrated independent Borrow/Inventory databases reproduced drift: default referential actions, omitted custom FK relations, one omitted work-group index declaration, and two model-declared alias lookup indexes absent from migration history. Generated drift SQL was **never executed**: it proposed dropping valid existing FKs/indexes.

The fix makes datamodel relations explicitly match authoritative deployed SQL (`NO ACTION` or existing `CASCADE`), adds missing inverse relation declarations, and declares the already existing `books_work_group_id_idx`. No FK, trigger, partial index or existing-table data is changed. Borrow needs no SQL for this alignment; its read-only diff is empty after the datamodel correction. Prisma Client regeneration is required.

Migration `20261118040000_alias_lookup_indexes` adds only two nonunique indexes on `(normalized_alias,status)` for author/publisher alias lookup. Existing unique indexes begin with author/publisher ID and do not support this cross-author/publisher lookup prefix. Metadata matching reads normalized aliases by status. No table/column/constraint drop, data rewrite or backfill is needed. Existing clients remain compatible.

Lock impact: normal CREATE INDEX scans these two alias tables and blocks writers during each build. lock_timeout5s and statement_timeout30s bound the rehearsal. Before production execution inspect sizes/long transactions and rehearse duration on a representative restored copy; schedule the coordinated maintenance window if necessary. No production execution is authorized here.

Read-only verification:

```sql
SELECT indexname,indexdef FROM pg_indexes WHERE tablename IN ('author_aliases','publisher_aliases');
SELECT conrelid::regclass,conname,pg_get_constraintdef(oid) FROM pg_constraint
WHERE connamespace='public'::regnamespace ORDER BY conrelid,conname;
SELECT indexrelid::regclass,pg_get_indexdef(indexrelid) FROM pg_index
WHERE indpred IS NOT NULL AND indrelid IN (SELECT oid FROM pg_class WHERE relnamespace='public'::regnamespace);
SELECT tgrelid::regclass,tgname,pg_get_triggerdef(oid) FROM pg_trigger WHERE NOT tgisinternal;
```

Verify complete read-only Prisma diff is empty after migration; independently assert custom SQL-only objects (partial unique indexes/checks/triggers) still exist and behave correctly, because Prisma cannot model all of them. Re-run receipt/transfer/cutoff and financial concurrency regressions using regenerated clients. Future CI must compare migrated scratch schemas to datamodel and check custom object invariants, not run db push.

Forward-fix retains indexes and authoritative FK/trigger semantics. No downgrade drops or history deletion. Local execution is only separately verified loopback audit container `127.0.0.1:25432/inventory_audit_verified`; derive its credential from the verified audit setup without printing it.

Local rehearsal completed: both alias indexes applied and registered; the sorted definitions of every public constraint, noninternal trigger and partial index were byte-identical before/after (SHA256 `c7fef610320eec4420fe322e7fa46f9168351defdd954cfe601621205109e3f8`). Borrow and Inventory read-only Prisma diff both exited0 with empty migrations. New mandatory schema-drift database tests passed on Node20/PostgreSQL and additionally checked retained financial receipt protections, audit freeze, active-location partial uniqueness and twelve transfer/session FKs. Auth's unchanged three-migration chain was applied only to a new empty `auth_audit`; its read-only diff and new mandatory database test also passed. These are independent local rehearsals, not production drift inspection.
