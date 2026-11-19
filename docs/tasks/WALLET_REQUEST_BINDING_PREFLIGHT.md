# Wallet request binding and lookup index preflight

Migration `20261118030000_wallet_request_lookup` adds a nonunique lookup index on `account_ledger.idempotency_key`. No table/column/constraint is removed, no history is rewritten, and the original unique `(customer_id,idempotency_key)` constraint remains. The fingerprint/version is written into metadata of new ledger rows in the same existing money transaction. There is no data backfill or fabricated historical fingerprint.

New CREDIT/DEBIT keys are advisory-locked before account locks, bind operation/customer/actor/amount/reference/note/business metadata, and reject a changed customer. Old rows still replay under their original customer/key namespace, reconstructing the request from immutable ledger fields; a changed payload is409. Key strings and response field meanings are unchanged. Historical keys legitimately shared across customers remain replayable for their existing original rows. New cross-customer reuse is rejected after a key has been newly bound. HOLD/RELEASE/CAPTURE resource keys and deposit policy are unchanged.

Lock impact: normal CREATE INDEX scans the ledger and briefly blocks writers while building. lock_timeout5s/statement_timeout30s make a busy/large-table rehearsal fail instead of waiting indefinitely. Before a production migration inspect relation size and long transactions and rehearse its duration on a representative restored copy; use a coordinated writer maintenance window. No production execution is authorized. Old binaries ignore new metadata and do not enforce the new identity rules; do not restart old financial writers after enabling new writers. Regenerate Prisma Client.

Verification SQL:

```sql
SELECT count(*), sum(amount) FROM account_ledger;
SELECT indexname,indexdef FROM pg_indexes WHERE tablename='account_ledger';
SELECT i.indisvalid,i.indisready FROM pg_index i
JOIN pg_class c ON c.oid=i.indexrelid WHERE c.relname='idx_account_ledger_request_key';
```

Run same-key concurrency, changed payload/customer/actor, legacy reconstruction, cross-operation and lost-response tests on the independent audit database. Forward-fix retains index, immutable ledger rows and fingerprints. No dropping, deleting, resetting or automatic money correction. Local execution scope only verified audit PostgreSQL `127.0.0.1:25432/borrow_audit`.
