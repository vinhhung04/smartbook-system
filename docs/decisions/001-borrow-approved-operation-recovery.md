# ADR-001: Recover Borrow operations from durable approved plans

Status: accepted for implementation; production release remains subject to the remediation release gates.

Date: 2026-11-18 (Asia/Saigon).

## Context

Borrow and Inventory commit independently. A timeout does not prove a remote mutation failed. Previously, a process could die after Inventory reserve/consume/return or after local cancellation without any durable recovery instructions. Reconstructing a loan later with new IDs, prices, dates or item conditions breaks Inventory replay identity and can repeat or misallocate money.

## Decision

Reuse Borrow `integration_outbox` with `event_type=BORROW_OPERATION`, rather than introduce XA or a second job system. Persist a versioned, normalized request and its authorized plan before any remote mutation. The plan records the original actor identity/capabilities, warehouse/resource IDs, original key, stable loan/reservation numbers and dates, stable loan-item IDs, and applicable financial/return snapshots. No bearer/JWT is saved.

The six operation kinds are `CREATE_RESERVATION`, `DIRECT_LOAN`, `CONVERT_RESERVATION`, `CANCEL_RESERVATION`, `EXPIRE_RESERVATION` and `RETURN_LOAN`. Public calls still pass their normal role/scope checks. Only the worker's private process-local Symbol can request completion using a previously authorized plan. HTTP body/headers cannot enable this mode. Inventory receives fresh, authenticated Borrow service credentials and the persisted original actor where the internal contract permits delegation.

Returns preserve the existing single **batch cutoff after all Inventory acknowledgements**, rather than introduce a per-item physical-time policy or freeze the cutoff at request approval. The first acknowledged completion time and its current pricing/coverage context are persisted outside the local settlement transaction. A commit failure reuses that context. If no completion context survived an earlier unknown attempt, replay is automatic only when each item's existing `daysOverdue` result and pricing remain unchanged. Changed accrual boundaries, exact due dates, newly priced periods, or coverage beyond a persisted cutoff require manual review; no financial history is repriced. Legacy incomplete return requests lacking this evidence are also manual. Completed legacy response/audit replay is retained.

Return preview and settlement use the same overdue-rate resolver as the sweep and payment refresh. SB02 explicitly retained the sweep's existing treatment of expired memberships still marked ACTIVE while excluding future start dates (`docs/reports/SMARTBOOK_24_BORROW_EVIDENCE.md`, SB02). Previously a sweep before return recorded15000, but return before sweep recorded0 permanently for the same expired ACTIVE card and three overdue days. The regression demonstrates both orderings on PostgreSQL. Only the overdue rate is shared: checkout eligibility still rejects the expired card, and damage/loss pricing keeps its existing rules. This removes background-job ordering from the accrued obligation rather than introduces a new membership admission policy.

| Durable state | Meaning |
|---|---|
| PROCESSING / PREPARED | The plan exists and is leased; no remote attempt is recorded yet |
| PROCESSING / REMOTE_STARTED | A remote call might have committed; its response can be lost |
| PENDING | A transient/unknown outcome can be retried using the same plan and remote keys |
| MANUAL_REVIEW or FAILED | Business/state/funds conflict or exhausted retries; no automatic/new public claim |
| PUBLISHED / COMPLETED | Local business completion and the operation completion committed together |
| PUBLISHED / ABORTED | A definitive refusal was finalized; no background creation of a later loan |
| RESOLVED | Operator acknowledgement with evidence; this is not a stock/money repair |

Claims use compare-and-set on status and `lease_until`. Marking a remote attempt, completion and deferral also check the owner's lease; an old worker cannot overwrite a newer claim. A return can contain100 bounded remote calls, so its operation lease matches the30-minute return-request lease. The worker reclaims expired leases and applies bounded retry/backoff. It does not automatically reclaim manual/operator-resolved records.

Cancellation and expiry commit their terminal local state with a release intent before calling Inventory. A lost release response never restores ACTIVE locally. Public replay or the worker repeats the same release key. Conversion/cancellation/expiry share the local reservation-state lock; an unresolved conversion with a remote attempt blocks release until reconciled.

Direct/create reserve409 is finalized only when this is demonstrably the first attempt, no reservation was accepted, and the stored plan has no earlier `remote_started` marker. A later409 after an unknown attempt requires manual review. This prevents both silently creating a loan after a definitive refusal and falsely discarding a possibly committed earlier mutation. Known local reservation-validation failure can enqueue a separate release and finalize its create intent atomically. Unknown local commit failures retain the original create plan.

Remote/account child keys retain successful legacy short-key formats. Keys exceeding the Inventory100-character/account120-character storage limits are deterministically hashed; the raw client key remains in the approved operation. Invalid non-string notes are rejected before stock mutation. A request retry does not regenerate financial/item identity or reapply fresh availability/membership admission to a possibly committed operation. Return pricing/cutoff evidence is verified as described above. Current transaction guards still prevent invalid local state, overspending and duplicate item settlement; unresolved conflicts require review rather than a guessed refund or return.

## Alternatives considered

- Best-effort catch logging or inserting compensation only after failure: rejected because process/DB failure can erase all instructions.
- Blindly invert consume/return after timeout: rejected because the remote or local transaction may have committed, and financial/physical outcomes cannot be guessed.
- Persist raw user JWT for retries: rejected because credentials expire and should not live in an outbox.
- XA/distributed transactions or a new queue platform: unnecessary for this scope; the existing outbox, remote idempotency and explicit saga states provide a reviewable recovery boundary.

## Consequences and operating limits

- Existing malformed/untracked legacy data is not automatically converted into an approved plan. The read-only Borrow/Inventory reconciliation tool pages terminal local reservations, retained plans and Inventory candidates. It detects remote holds/consumes/returns missing their local counterpart, including operator-acknowledged records, and never guesses a correction.
- Manual resolution needs the original operation, remote movement evidence and financial/stock verification. Queue acknowledgement alone cannot make a physical discrepancy disappear. No automatic wallet credit, fine waiver or provider refund is introduced.
- Deploy the additive outbox lease/backoff migration and matching Prisma Client before this code. Coordinate all financial/stock writers; an old image that ignores these semantics is not a safe fallback after new operations begin.
- An in-progress duplicate can receive409 and must retry the same key. Known terminal conflicts stay manual; a new key is not a recovery procedure.
- The QA regression uses a real PostgreSQL and an actual SIGKILL of a Borrow subprocess at a **mocked Inventory response boundary**. It proves intent persistence, local rollback and restart recovery, not a live Inventory commit. Separate Inventory idempotency tests and deployed cross-service scenarios remain necessary. Real provider/VPS failure drills are not claimed.

## Verification references

`services/borrow-service/test/borrow-operation-durability.db.test.js` covers all six operations, stable replay IDs/numbers/keys, durable-write fail-closed behavior, local-completion rollback, actual subprocess death, lease ownership, manual states, invalid input, long keys and first-refusal versus earlier-unknown outcome.

Implementation entry points: `src/services/borrow-operation.service.js`, loan/reservation controllers, the reconciliation worker, and `scripts/reconcile-operations.js` / `scripts/reconcile-inventory-state.js`. Follow the final remediation report for exact runtime logs and release limitations; passing one focused test suite is not a production GO decision.
