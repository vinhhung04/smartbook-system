# SmartBook borrow audit evidence: SB-01–SB-06 and SB-19–SB-23

Audit date: 2026-11-17 (Asia/Saigon). Baseline: branch `hungg`, `c7b5fa42d4bb79aeb6fc0f44170e81df23410ce5`, fetched and equal to origin/hungg at audit start. Original descriptions SB-01–SB-06 were recovered by the parent agent in `SMARTBOOK_24_ORIGINAL_SOURCE.md`; the initial missing-source finding is superseded.

## Environment and verification boundaries

A new disposable PostgreSQL 15 / pgvector container `smartbook-audit-borrow-6a880256` was created, bound only to `127.0.0.1:25432`. New database `borrow_audit` has all six existing borrow migrations applied. citext and pgcrypto were installed before migration. No existing database was reset or deleted. Test fixtures are unique and retained. Inventory audit uses separate databases in the same container.

`business-logic-audit.db.test.js` executes the actual borrow controllers, services and Prisma transactions on PostgreSQL. Only Inventory Service HTTP calls are replaced at the external boundary, so these tests prove Borrow DB locking/state/money/outbox behavior, not actual Inventory Service stock mutations. The parent/inventory evidence covers those separately. Socket notification gateway calls log unavailable-service warnings in this isolated DB test; notification records are still written to PostgreSQL. No UI or API payload redesign was performed.

At first, generating the two services' default Prisma clients concurrently overwrote their shared pnpm generated client. Intermediate green attempts failed with `customers undefined`. This was an environment/client-generation problem, not hidden as a product pass. A separate generated borrower client and temporary preload under `.git` isolated early DB tests. The final complete suite uses the normal `pnpm --filter borrow-service test` pretest generation, after coordination with the inventory agent.

## Audit classification

| ID | Original issue | Result | Production fix | Verification |
|---|---|---|---|---|
| SB-01 | Direct borrowing ignores reserved quantities | CONFIRMED BUG | Yes | Real PG direct 3 borrowed + 2 reserved / limit5 rejects new1; preflight and membership-locked recheck both include reserved quantities |
| SB-02 | Future membership starts too early | CONFIRMED BUG | Yes | Real PG current and future premium memberships: current plan selected; scheduled fine uses15000 rather than300000; expired-but-ACTIVE sweep rate preserved |
| SB-03 | Paid overdue fine no longer accrues | NEEDS BUSINESS DECISION | No | Existing explicit freeze contract and PG evidence conflict with original audit's proposed ongoing-accrual policy |
| SB-04 | Same loan item can be returned again under a new key | CONFIRMED BUG | Yes, Borrow side | PG repeated explicit item request returns409 before second external call; sibling remains borrowed. Inventory-side guard/test is in inventory evidence |
| SB-05 | AccountError after consume omits recovery | CONFIRMED BUG | Yes | Direct wallet race returns409 with durable consumed-stock outbox; conversion validates deposit before consuming remotely |
| SB-06 | Concurrent conversion creates two loans | CONFIRMED BUG | Yes, shared with SB-23 | Baseline controller on real PG produces2 loans; fixed concurrent same-key conversion yields201+200, one loan/item set, one consume |
| SB-19 | Sweep overwrites a returned item from stale scan | CONFIRMED BUG | Yes | Failing unit reproduction + real PG Promise.all scan/return barrier regression |
| SB-20 | One batch-return request has one shared condition | NEEDS BUSINESS DECISION | No | Real PG existing per-item calls independently preserve GOOD/DAMAGED/LOST, notes and fines. Same-request mixed-condition batch is absent, but existing intentional single-item workflow covers mixed loans |
| SB-21 | Final normal return loses prior LOST aggregate | CONFIRMED BUG | Yes | PG lost-first/final-normal regression plus concurrent distinct-item returns |
| SB-23 | Cancellation races conversion | CONFIRMED BUG | Yes | PG Promise.all both orderings; deposit conservation; duplicate conversion; ambiguous remote failure; slow-success; membership cap |

## Per-issue evidence and implementation

### SB-01 — direct borrowing and active reservations

Actor: authorized warehouse writer. `loan.controller.js:createDirectLoan`, lines250–258 and340–342. Reproduction: five-item plan, three borrowed items, a live confirmed reservation for two copies, request one additional direct item. Baseline returns201; desired409, no new loan. The reservation creation path already counts borrowed plus reserved books and uses the same membership lock; this establishes the existing shared-cap rule. The fix reuses `countActiveReservedItems` for both initial validation and transaction recheck. Expired/terminal reservations follow the existing helper semantics. Test `business-logic-audit.db.test.js:237`.

### SB-02 — effective membership start

`membership.service.js:resolveActiveMembership`, line13, now requires start_date<=today; status, expiry, overrides and plan checks retain their existing rules. The sweep has its own legacy ACTIVE lookup: `fine.service.js:268` now adds only start_date<=job UTC day. It deliberately retains the old treatment of an expired membership still marked ACTIVE; it does not import unrelated expiry policy into scheduled fine calculation. Baseline current + future-premium records select the future plan, and sweep accrues300000 instead of15000 for three days. Tests `business-logic-audit.db.test.js:245` and314 prove current-rate selection and preservation of expired-but-ACTIVE sweep behavior.

### SB-03 — decision required before changing settled fines

`fine.service.js:upsertFine`, line66, and `recomputeCustomerFineBalance`, line103, explicitly preserve PAID/WAIVED rows. `test/fine-upsert.test.js:52` explicitly tests that a higher cumulative amount must never rebill a settled fine (one fine per item/type). The original static audit expects new post-payment accrual; current code/tests deliberately freeze the settled episode. PG evidence at `business-logic-audit.db.test.js:280` proves amount50000 remains50000 when submitted cumulative amount100000, including settled status preservation.

Required decisions: (1) does payment settle only charges-to-date or the entire ongoing overdue episode, (2) does waiver cover amount-to-date or the full episode, (3) should later accrual reopen the same fine or create period-specific additional charges, and how are existing payments/deposit settlements attributed? Changing this without policy can rebill previously settled debt or alter waiver meaning. No production fine-settlement logic or existing freeze tests were changed.

### SB-04 — repeated explicit item return

`loan.controller.js:returnLoan`, line1284. Before: explicitly selected item only checked membership in the loan. A two-item active loan permits returning itemA again under a fresh key while itemB remains out; baseline returns200 and calls Inventory again. After: explicit targets must also be BORROWED/OVERDUE, as already required by return-all. Test `business-logic-audit.db.test.js:257` asserts409, unchanged external-call count, and sibling still BORROWED. Inventory's independent per-item guard is necessary for concurrent stale borrower snapshots and is handled by the inventory owner.

### SB-05 — money failures and consumed inventory

`loan.controller.js:createDirectLoan`, lines455–466: durable `DIRECT_LOAN_CONSUME_UNRESOLVED` is now queued before handling AccountError, so409 cannot silently bypass recovery. Reproduction uses actual account credit and a competing hold of30000 in the inventory boundary callback, after successful preflight but before actual loan deposit hold; baseline409 leaves0 outbox records, fixed409 leaves1. No unsuccessful loan/items are committed. Test `business-logic-audit.db.test.js:267`.

Conversion shares the SB-23 sequencing fix: debit and deposit validation occur before the remote consume, under the same local transaction. Test at291 inserts a real competing wallet hold between preflight snapshot and conversion transaction; the conversion returns409, no consume occurs, no loan is created, reservation remains CONFIRMED. This proves both source flows separately.

### SB-06 — duplicate conversion

`loan.controller.js:convertReservationToLoan`, lines990–1002. The same reservation-state lock and re-read that fix cancellation also serialize duplicate conversions. A conversion already committed while waiting is replayed from `source_reservation_id`; it does not create a new loan or debit/hold again. Test `business-logic-audit.db.test.js:131` asserts exactly one loan before status/identity checks,201+200 responses, identical loan IDs, one external consume and one conversion audit record.

For RED evidence, the controller source was read with `git show c7b5fa4:.../loan.controller.js` into a temporary Module loader under `.git`, without overwriting working files. The actual PostgreSQL test with original controller creates2 loans instead of1 (`borrow-sb06-baseline-red.log`). Boundary stand-in deliberately accepts the shared key as the original inventory replay did; this is Borrow-side proof, complemented by the separate SB-22/SB-23 inventory tests.

### SB-19 — stale overdue scan

`fine.service.js:runOverdueSweep`, lines277–290. Baseline unit reproduction scans BORROWED, then commits RETURNED before transaction processing: sweep writes OVERDUE and would fine it. Fixed transaction locks the actual loan_item row with FOR UPDATE, reads current status/return_date/due_date, and skips returned/lost/renewed/future-due lines. Parent update is conditional on current status BORROWED; it cannot overwrite a closed transaction based on the old parent snapshot. Fine calculation, notification, audit and processed count only run for an eligible current item. Unit `overdue-sweep.test.js:98`; real PG `business-logic-audit.db.test.js:58` uses Promise.all with a scan barrier and actual return controller, verifies item+loan remain RETURNED, processed0, no overdue-mark audit.

### SB-20 — intentional single-item operations, batch decision unresolved

Current API `returnLoan` accepts loan_item_id and independent condition/mark_lost/notes/settlement_reason. `apps/web/src/components/pages/borrow-loan-detail.tsx:58` documents itemId empty as all active books; lines110–132 send the selected ID, condition and reason. The damage/lost selector is at377–385. Deposit/Fine services already operate by loan_item_id. PG test `business-logic-audit.db.test.js:191` returns three copies separately as GOOD, DAMAGED and LOST, verifies separate stored conditions/statuses/notes, a DAMAGE fine only on damaged copy and a LOST fine only on lost copy. Existing deposit DB tests independently prove per-item allocation.

One HTTP call containing mixed item conditions is unsupported. The original request explicitly requires distinguishing an intentional limitation from a bug. A new batch payload/UI and partial-failure/retry semantics need a business decision; per-copy processing already exists and works. No new API/UI was invented.

### SB-21 — preserve LOST aggregate at closure

`loan.controller.js:returnLoan`, lines1377–1380,1413–1416. Baseline: two items, itemA LOST, final itemB normal return => loan RETURNED despite A remaining LOST. Fixed: once no active lines remain, count all LOST lines; close LOST if any, otherwise RETURNED. No new status or enum. Closure notification accurately reports lost books instead of claiming all returned. Tests at47 and159 cover sequential and concurrent mixed returns.

The concurrent distinct-item return test already passed before adding any new return-level lock: `applyReturnFines` always recomputes/writes the same customer balance before aggregate counts, serializing those return transactions. No unnecessary loan lock was added. This PASS is recorded in `borrow-sb21-concurrency-verification.log`, not claimed as a separate confirmed race.

### SB-23 — local state serialization and bounded remote work

Cancellation `reservation.controller.js:498`; conversion `loan.controller.js:990` share a transaction-scoped advisory lock on reservation-state:ID. Conversion re-reads terminal status/expiry before writing or consuming; cancellation obtains the same lock before status decisions. Conversion performs monetary validation, loan/items/deposit/audit/notification DB writes, then consumes remotely before local commit. Cancellation that loses the race returns409 without release/audit/notification; winning cancellation prevents consume/loan creation. Inventory is still a separate transaction: no distributed atomicity is claimed. Attempted remote failure or later local failure queues `RESERVATION_CONSUME_UNRESOLVED`; only a dedicated local state-conflict marker bypasses recovery. A returned remote status409 is deliberately not mistaken for this marker.

Conversion and cancellation use30s local transaction deadlines; the conversion opts into a10s HTTP AbortSignal deadline in `inventory-integration.service.js:112–115`. The optional timeoutMs argument does not alter API request payloads or callers that omit it. The initial moved-call implementation exposed Prisma's default5s deadline: a5.3s successful consume returned502/P2028 and required manual recovery. This was reproduced and corrected before completion. Test at210 requires5.3s success201 with one loan and no unresolved outbox. Timeout unit tests prove an unresponsive boundary aborts and legacy calls omit signal.

PG scenarios: conversion-first, cancellation-first, duplicate conversion replay, actual30000 deposit conservation (available70000/held30000 from100000), ambiguous remote error with transaction rollback and durable outbox, slow-success, and two competing distinct reservations reaching a membership cap before remote consume. Raw RED/GREEN logs are retained under test-results.

## Changed files owned by this subtask

- services/borrow-service/src/controllers/loan.controller.js
- services/borrow-service/src/controllers/reservation.controller.js
- services/borrow-service/src/services/fine.service.js
- services/borrow-service/src/services/membership.service.js
- services/borrow-service/src/services/inventory-integration.service.js
- services/borrow-service/test/overdue-sweep.test.js
- services/borrow-service/test/business-logic-audit.db.test.js (new)
- services/borrow-service/test/inventory-consume-timeout.test.js (new)

No schema/migration change. No commit/push. No unrelated local file overwritten. Optional integration timeout argument is internal and backward compatible; existing frontend/mobile payloads remain valid.

## Test commands and logs

Final command (secret is loaded only from ignored local config): set DATABASE_URL, BORROW_TEST_DATABASE_URL and DEPOSIT_TEST_DATABASE_URL to isolated borrow_audit, then `pnpm --filter borrow-service test`.

| Run | Tests | Pass | Fail | Skip | Evidence |
|---|---:|---:|---:|---:|---|
| Initial borrow suite without DB environment |183|180|0|3|borrow-audit-baseline.log; skips explicitly DB unavailable |
| Initial SB21/SB19/SB23 PostgreSQL RED |3|1|2|0|borrow-audit-db-red.log; SB19 already corrected when this DB run occurred |
| SB06 original-controller PostgreSQL RED |1|0|1|0|borrow-sb06-baseline-red.log;2 loans vs1 |
| SB01/02/04/05 original findings RED + SB03 contract evidence |5|1|4|0|borrow-original-red.log |
| SB01/02/04/05 + cap guard GREEN, intermediate |6|6|0|0|borrow-original-green.log |
| SB02 sweep future-rate RED |1|0|1|0|borrow-sb02-sweep-red.log;300000 vs15000 |
| SB23 slow-consume RED |1|0|1|0|borrow-sb23-slow-red.log;502 vs201 |
| SB23 membership cap RED |1|0|1|0|borrow-sb23-cap-red.log;500 vs409 |
| Concurrent distinct-item return verification |1|1|0|0|borrow-sb21-concurrency-verification.log; not a confirmed separate race |

| Final complete borrower suite with PostgreSQL |239|239|0|0|borrow-audit-full-green.log; normal pnpm pretest generation |

Final complete suite passed after the final code changes. The existing deposit, VNPay top-up and reservation idempotency PostgreSQL suites are enabled, not skipped. `git diff --check -- services/borrow-service` also passed.

## Remaining limitations and decisions

SB-03 and SB-20 require explicit business decisions as described above. Automatic recovery of unresolved consume/return events remains manual by the existing reconciliation job design; this audit retains those durable records and does not pretend the two databases commit atomically. Outbox persistence itself remains best effort if Borrow DB is unavailable, an existing limitation.

Direct borrowing still consumes before its local transaction; failures including AccountError are now queued rather than silently lost. An extended uncertain network outage can still require manual reconciliation. Optional10s timeout only applies to conversion, preserving other callers' current timing behavior.

An existing possible deadlock between distinct-item return and overdue sweep transactions uses different customer/parent lock orders (return: item/customer/parent; sweep: item/parent/customer). No new parent-before-item ordering was introduced. PostgreSQL can abort one participant; broader lock-order redesign was not performed as an unproven extra issue. Parent cross-service integration results and inventory-side SB04/SB23 work must be read with this evidence before declaring end-to-end completion.
