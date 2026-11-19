# SB-07 — Approved physical-count cutoff and location freeze

Implemented the policy the user approved in this conversation on 2026-11-17. This supersedes the earlier NEEDS BUSINESS DECISION classification for SB-07; the original audit evidence remains a historical record. No commit/push or data reset.

## Behavior

- Creating a DRAFT reserves the selected location scope without freezing stock. Assigning it for the first time, or explicitly starting/restarting counting, locks those locations and refreshes the baseline from current committed stock. Reassignment while IN_PROGRESS preserves entered counts. Web explains this timing; location_ids supports a small counting area.
- A location has at most one open audit, including the interval after count confirmation while approval is pending. Transaction advisory locks serialize creation/recount; a partial unique index enforces active session uniqueness.
- Database BEFORE INSERT/UPDATE/DELETE trigger on stock_balances blocks quantitative changes while counting. This covers picking, outbound, putaway, borrow/reserve/return integration, supplier receiving/return, adjustments and direct persistence writers without relying on each controller remembering a check. Non-quantity metadata updates remain allowed.
- Each line stores a frozen on-hand/borrowed baseline. expected_qty now represents physical copies at the location: on_hand_qty minus off-site borrowed_qty. Reserved/damaged copies physically held at the location are counted, but shortages cannot consume protected reservation/borrowed/damaged balances.
- Autosaving a count does not end counting. Staff explicitly confirm all counts at one location, or submit the whole audit. The server records counted_at for every line in that location and unfreezes it only when all its lines have counts. Later count edits require explicit recount.
- After count confirmation, ordinary stock movements resume. Approval applies counted_qty minus expected_qty once, under row locks and the existing atomic audit claim. It preserves all post-count movements: frozen10, counted8, then outbound2 produces final6. It does not replace live stock with8. RECEIVING/STAGING/QUARANTINE count adjustments never create available stock.
- Approval cannot reduce available stock below zero or consume stock protected by active holds. Manager must resolve the protected holds/disposition first, then retry or recount.
- Approval writes adjustment movements, stock-change outbox and approval audit atomically. Concurrent approval applies the discrepancy once. Cancellation releases the location sessions atomically without changing business stock.
- Reassigning a terminal/submitted audit cannot reopen it and bypass cutoff/approval semantics.

## API and consumer compatibility

Existing create, assign, PATCH line count, submit, approve and cancel routes retain payloads/success shapes. Fresh audits work with existing mobile assign→count→submit requests; payloads remain unchanged. Added optional line fields: counted_at, baseline_on_hand_qty, baseline_borrowed_qty.

Added warehouse-WRITE/task-progress guarded routes:

- `PATCH /api/stock-audits/:id/locations/:locationId/confirm-count`: confirm one completed location, open stock transactions there, leave audit open.
- `PATCH /api/stock-audits/:id/recount`: explicitly refresh frozen baseline and clear unapproved count inputs. Existing line IDs are preserved; newly-present variants are added. No historical adjustments or stock rows are deleted.

Errors use409 with a machine-readable code, including STOCK_AUDIT_LOCATION_FROZEN, STOCK_AUDIT_LOCATION_BUSY, STOCK_AUDIT_RECOUNT_REQUIRED, STOCK_AUDIT_HELD_STOCK_CONFLICT and STOCK_AUDIT_LOCATION_COUNTED.

Many legacy writers catch Prisma errors and answer generic500. A small request-local AsyncLocalStorage middleware plus Prisma error observer normalizes the known database freeze marker to409 across those existing catches. It preserves other errors and successful responses. The PostgreSQL test executes a real HTTP request through this normalizer and actual Prisma mutation, proving freeze produces409 without weakening the database guard.

Minimal web changes add count-policy guidance, location-confirm buttons, a reasoned confirmation before explicit recount, disabled already-confirmed count inputs and a legacy recount notice. Existing page layout and UI system remain. Managers can use web recount for old mobile audit tasks; mobile payload shapes remain valid.

## Migration and historical data

`20261117090000_stock_audit_count_cutoff/migration.sql` adds nullable cutoff/baseline columns and new stock_audit_location_sessions control/history table. A partial unique index covers location_id while released_at IS NULL. Session history is retained after release. Additive migration `20261117160000_stock_audit_start_count` makes session.started_at nullable (a reserved DRAFT), removes its default, and only freezes sessions whose counting actually started. Already-started sessions retain their timestamps. New draft lines have provisional expected_qty and NULL baseline; first start establishes the authoritative baseline.

Old counts deliberately keep counted_at and baseline NULL. They are not retroactively interpreted from creation timestamps. Approval returns409 without modifying stock/status; an explicit recount must establish a real frozen baseline. Existing legacy open audits also block overlapping new audit creation until they are cancelled/recounted/closed. This is intentional rather than silently applying ambiguous counts.

The migration deployed successfully to the isolated inventory_audit_verified PostgreSQL database together with the separate SB12 migration. No existing rows/database were reset. Matching test client is generated separately under ignored `.git/count-policy-client`; shared pnpm Prisma client is not generated concurrently.

Deploy backend migration/service before the updated web bundle. Rollback must first cancel or finish open count sessions through the supported business flow; do not simply remove the guard while a physical count is in progress. Old application approval logic must not approve new confirmed-delta audits, so application downgrade requires operational coordination.

## Files

- Inventory Prisma schema, new migration above.
- `src/services/stock-audit-count.service.js` (new), `stock-audit-creation.service.js`.
- `src/controllers/stock-audit.controller.js`, `src/routes/stock-audit.routes.js`.
- `src/middlewares/stock-audit-freeze.middleware.js` (new); wiring in `src/lib/prisma.js`, `src/index.js`.
- Web `src/services/stock-audit.ts`, `src/components/pages/stock-audits.tsx`.
- New `test/stock-audit-cutoff.test.js`, `test/stock-audit-cutoff.db.test.js`, web `e2e/stock-audit-cutoff.spec.ts`.
- Existing creation unit fixture checks provisional draft quantities; the new PostgreSQL draft scenario verifies movement before start and baseline refresh on start. Existing receipt-lifecycle audit's old SB07 observation now asserts409/recount rather than the superseded ambiguous approval behavior.

## Verification actually run

| Suite | Result | Tests | Pass | Fail | Skip |
|---|---|---:|---:|---:|---:|
| Initial cutoff TDD (helper absent) | RED |1|0|1|0|
| Cutoff + existing creation units | PASS |9|9|0|0|
| New actual PostgreSQL cutoff suite | PASS |6|6|0|0|
| Complete inventory suite, all current policy tests, files sequential | PASS |418|418|0|0|

PostgreSQL6 counts include a parent and5 separate behavioral scenarios: concurrent overlapping creation + HTTP409 INSERT/UPDATE/DELETE freeze + cancel unlock; postcount movement + concurrent approval; off-site borrowed exclusion; legacy409→recount; all-variant location confirmation and edits rejected after cutoff. The complete418 already include these counts; do not add them twice.

Full command: `pnpm --filter inventory-service exec node --test --test-concurrency=1 test/*.test.js` with INVENTORY_AUDIT_TEST_DATABASE_URL pointing to the migrated disposable database and INVENTORY_AUDIT_PRISMA_CLIENT pointing to the isolated client. Logs: `test-results/stock-audit-policy-full-sequential.log`, `stock-audit-cutoff-db.log`. File-level serialization avoids unrelated fixture SSI conflicts; tests themselves still issue real Promise.all concurrency.

Intermediate failures are not hidden: four fake Prisma clients exposed a nonfunction $use property, corrected by checking typeof before middleware registration; a transfer-discrepancy fixture under parallel files received the existing legitimate Serializable CONCURRENCY_CONFLICT409 and its owner added bounded retry for exactly that code. The final sequential full suite passes. Web `pnpm --filter web exec tsc --noEmit` passed after fixing an initial ConfirmDialog prop spelling (confirmLabel). `git diff --check` passed.

The new browser test is prepared for the parent's rebuilt QA stack and is **not claimed as run in this subtask**. It performs actual UI count/confirm/submit/approve with its own fixture, simulates the intervening stock outbound in the disposable DB, asserts final6, and cancels any unfinished fixture through the business API to release a failed test's freeze. Parent records its final runtime result.

Final continuation: the draft-freeze reproduction failed against the immediate-freeze implementation, then the combined focused suite passed16/16 with no skips after the start-count migration. Final full-suite and browser results are recorded in SMARTBOOK_APPROVED_POLICIES_IMPLEMENTATION_REPORT.md.
