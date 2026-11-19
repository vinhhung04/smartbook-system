# Borrow reconciliation operations

The retry queue selects supported event types **before** its limit. Unknown legacy events and unapplied provider receipts remain separate manual cases. Automatic work is claimed with a database compare-and-set lease, retried with exponential delay (30 seconds to one hour), and becomes FAILED after ten attempts. Expired PROCESSING claims are recovered on the next sweep. Approved Borrow operation plans have a 30-minute lease to cover bounded multi-item returns; simple releases have a two-minute lease. A dead process can therefore require waiting for that lease before automatic recovery.

`reconciliation_automatic_pending_total`, `reconciliation_manual_pending_total`, `reconciliation_failed_total`, `reconciliation_oldest_automatic_seconds` and `reconciliation_oldest_manual_seconds` report the complete unresolved queues, independently of batch size. Age continues increasing between sweeps; `reconciliation_last_success_unixtime` identifies stale observations. No sample is emitted before the first successful database query. The deployment must scrape Borrow telemetry and alert on age/failure/freshness signals; code alone does not prove production delivery.

Run from `services/borrow-service` with an explicit, verified `DATABASE_URL`:

```
node scripts/reconcile-operations.js list
node scripts/reconcile-operations.js requeue RECORD_UUID OPERATOR_UUID "reason" "incident/evidence reference"
node scripts/reconcile-operations.js resolve RECORD_UUID OPERATOR_UUID "verified outcome" "incident/evidence reference"
```

Listing exposes IDs/status/timing only, at most 100 records plus complete counts. Mutations require database operator access; the operator UUID must identify the person performing the review. Requeue is restricted to supported handlers. Resolution is an explicit operator acknowledgement after checking local records, Inventory state and (for payment cases) provider evidence. It does not refund, credit, alter loan/stock state, or delete the original payload. Those business actions need their existing authorized workflows and independent evidence. Operator identity, reason, evidence and before/after status are audited atomically. Terminal or currently claimed records cannot be changed by this tool.

If an intent or compensation queue insert fails, the request fails: it must never report that work was queued. Diagnose database availability and replay the original operation key after recovery. Do not guess a new key or delete the unresolved record.

## Read-only Borrow–Inventory custody detector

With explicit `DATABASE_URL`, `INVENTORY_SERVICE_URL` and `INTERNAL_SERVICE_KEY`, run:

```
node scripts/reconcile-inventory-state.js
node scripts/reconcile-inventory-state.js '{"reservations":"UUID_CURSOR","operations":"done","inventory":"UUID_CURSOR"}' 10
```

Copy the complete returned `next_cursor` object into the next call, preserving every `done` stream until `complete:true`. Each page visits local terminal reservations, durable operation/history records, and Inventory ACTIVE/CONSUMED hold candidates. Remote candidate discovery also finds legacy orphan holds with no Borrow reservation or intent. UUID cursors progress independently; an unavailable remote stream retains its cursor and reports an error rather than falsely declaring completion. New concurrent rows behind an existing cursor require a subsequent full audit. Exit0 means no mismatch in that page; it does not mean all pages were scanned. Exit1 means evidence unavailable; exit2 means observed mismatch.

The detector reports leaked holds after CANCELLED/EXPIRED/conversion, missing local loans after remote consume, mismatched consume quantities, and remote returns whose local items remain uncompleted. Truncated evidence is explicitly unresolved. It also inspects operator-resolved operations: acknowledgement does not prove physical custody was repaired. Output contains IDs/status/codes, not customer identity or credentials.

The local transaction is repeatable-read/read-only and Inventory evidence endpoints are read-only and protected by the internal service key. This is not an atomic distributed snapshot; legitimate in-flight work may produce a temporary mismatch. Recheck after its lease or approved recovery completes and inspect actual ledger/movement evidence before any manual action. The detector never updates stock, loan, wallet, outbox or payment history. No scheduled automatic repair is implied.
