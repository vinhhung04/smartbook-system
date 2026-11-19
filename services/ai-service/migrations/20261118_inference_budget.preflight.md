AI inference admission migration

Target: the AI database, as its schema owner. In this task it is applied only to
the separate ai_audit database in the verified independent audit container.

The migration creates one new table and three indexes. It neither scans nor
rewrites existing AI tables, requires no backfill, and stores no token, prompt,
photo, email or raw user ID. principal_hash is an HMAC with the same stable secret
on every worker. Existing applications ignore this additive table.

CREATE TABLE takes a lock only on the new relation; index creation touches only
that relation. Admission serializes short transactions using one PostgreSQL
transaction advisory lock, counts indexed time windows, then records a lease.
Inference runs after commit, without holding a database lock. Attempts consume
their hourly/daily quota even after errors. Completion releases concurrency;
crashed requests expire after a lease longer than the enforced request deadline.

Deploy this SQL through the explicit deployment migrator before new workers.
The runtime needs SELECT, INSERT and UPDATE on ai_inference_leases, schema USAGE,
and its existing connection privileges. It needs no ownership or CREATE privilege.
There is no application startup DDL or fallback to an in-memory admission policy.
An unavailable table/database fails paid requests with 503 before inference.

Verification SQL (read-only):

```sql
SELECT to_regclass('public.ai_inference_leases');
SELECT indexname FROM pg_indexes WHERE tablename = 'ai_inference_leases';
SELECT feature, count(*) FROM ai_inference_leases GROUP BY feature;
SELECT count(*) FROM ai_inference_leases
 WHERE completed_at IS NULL AND expires_at > CURRENT_TIMESTAMP;
```

Validate per-principal and global quotas plus simultaneous independent processes
on the isolated PostgreSQL target. Validate that provider failure still consumes
an attempt and that a timeout cannot outlive its lease. The budgets cap admitted
requests; provider token/deadline limits bound work per request. They are not a
currency accounting ledger.

Forward fix: retain the additive table and admitted history; repair grants,
configuration or application logic through the owner deployment path. Do not
drop/reset the table or refund failed attempts automatically. Keep the previous
application's behavior in mind before any rollback: its paid endpoints lack this
boundary, so reverting binaries requires disabling external paid access first.
