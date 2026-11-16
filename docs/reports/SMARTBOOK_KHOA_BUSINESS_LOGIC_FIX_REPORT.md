# SmartBook — Controlled Business Logic Audit, Reproduction, Fix & Full Playwright Regression

**Branch:** `khoa` · **Base commit:** `7d75d80` (`fix(borrow,inventory): membership item-count limits, renewal/fine races, transfer receiving gaps`)
**Scope:** STT1, STT2, STT3, STT5, STT7, STT8 from an external prior audit (not in-repo). STT4 and STT6 explicitly out of scope — not touched.
**Status:** Code changes **not committed/pushed** — awaiting explicit permission per standing instruction.

---

## A. Verification table (audit items vs. live code)

| STT | Claim | Verdict | Evidence |
|---|---|---|---|
| STT1 | `GET /transfer-receiving/:id/lines` had no warehouse-scope check | **CONFIRMED** | Route only had `authorizeTaskRead`, no `requireRecordWarehouse`. Fixed. |
| STT2 | `POST /receiving-putaway/transfer` missing WRITE-scope check | **ALREADY FIXED** | Live test: `staff01` (write scope only at WH-HCM-01) got `403 WAREHOUSE_ACCESS_DENIED` posting a transfer destined for WH-HN-01. No code touched. |
| STT3 | `POST /transfer-receiving/:id/confirm` missing WRITE-scope check | **ALREADY FIXED** | Live test: `curator01` (manager role, READ-only at WH-HCM-01, no scope at WH-HN-01) got `403` confirming a transfer into WH-HN-01; order stayed `IN_TRANSIT`. No code touched. |
| STT5 | Multi-book `returnLoan`: an earlier item's already-succeeded remote stock return is lost (no local update, no reconciliation) if a later item's remote call fails | **CONFIRMED** | Fixed. |
| STT7 | `getIncomingQtyByVariant` (reorder suggestions) counts PO lines closed via "Close Remaining Quantity" as still incoming | **CONFIRMED** | Fixed. The audit's separate claim that reorder suggestions wrongly mix warehouses was **NOT REPRODUCED** — the endpoint is intentionally system-wide by design; `priorityWarehouseId` only biases budget allocation, confirmed by reading `getReorderSuggestions`. |
| STT8 | (a) `assignGoodsReceipt` doesn't validate the assignee is actually assignable at that warehouse; (b) `getGoodsReceiptById` lets the assignee read before its own warehouse-READ check | **CONFIRMED (both)** | Fixed. |

## B. Fixes applied

1. **STT1** — `services/inventory-service/src/routes/transfer-receiving.routes.js`: added `readsDestination = requireRecordWarehouse(transferDestinationWarehouse, { access: 'read' })` to `GET /:id/lines`, matching the pattern already used on `/confirm` and `/assign`.

2. **STT5** — `services/borrow-service/src/controllers/loan.controller.js` (`returnLoan`): track each item's id in `returnedLoanItemIds` **as its own remote call succeeds**, inside the per-item loop, instead of only after the whole loop finishes. On any later failure, `queueReconciliation({ eventType: 'LOAN_RETURN_UNRESOLVED', ... })` now always fires for every item that actually succeeded remotely before the failure, regardless of whether the triggering error is a 409 business conflict or a 500. Previously the 409 branch returned before the reconciliation queue was ever reached, and `returnedLoanItemIds` was only populated after the loop (so on a mid-loop failure it was always empty).

3. **STT7** — `services/analytics-service/src/controllers/analytics.controller.js` (`getIncomingQtyByVariant`): added `AND poi.closure_status != 'CLOSED_WITH_REMAINING'` to the incoming-quantity SQL, so a PO line whose remainder was explicitly closed (via the separate "Close Remaining Quantity" feature) no longer counts as still arriving, even though the parent PO's own status can legitimately stay in an "incoming" bucket.

4. **STT8a** — `services/inventory-service/src/controllers/goods-receipt.controller.js` (`assignGoodsReceipt`): added `requireAssignableUser(res, receivedByUserId, existing.warehouse_id)` check after the existing `canWriteWarehouse` check, so a receipt can only be assigned to a user who is actually assignable (has operational scope) at that warehouse.

5. **STT8b** — same file (`getGoodsReceiptById`): restructured so the assignee-bypass (`receipt.received_by_user_id === req.user?.id`) no longer skips the warehouse-READ check entirely — it now only skips the stricter "must be able to see all receiving tasks" gate, while `requireWarehouseReadAccess` always runs.

## C. Database changes

None. All 5 fixes are application-logic only (no migrations).

## D. Test results

| Suite | Result |
|---|---|
| inventory-service unit tests | 333/333 pass |
| borrow-service unit tests | 156/156 pass |
| analytics-service unit tests | 158/158 pass (3 skipped, pre-existing) |
| STT1/2/3 live warehouse-scope audit (`scripts/warehouse-scope-stt123-audit.mjs`) | 3/3 confirmed-blocked (STT1 403 read, STT2 403 write, STT3 403 write) |
| STT5 live reconciliation audit (`scripts/return-loan-partial-failure-audit.mjs`) | Confirmed: successful item queued to `integration_outbox` as `LOAN_RETURN_UNRESOLVED` on partial failure |
| Full Playwright E2E regression (`apps/web`, `pnpm test:e2e`, 87 tests) | See Section E — 85/87 effectively pass; 2 stable failures, both **out of STT1-8 scope and pre-existing/environmental** (Section F) |

## E. Playwright regression — root-cause path

The first full run (87 tests) returned **27 failed**. Diagnosis, in order:

1. Every visible failure shared one symptom: `loginStaff`/`loginCustomer` helpers timing out on `/login` or `/customer/login` — the page never navigated away after submit.
2. Manual login (`POST /auth/login`) reproduced it directly: `429 RATE_LIMITED`. Root cause: `AUTH_LOGIN_RATE_LIMIT_MAX` (default 10/15min) was exhausted by the many real-account logins this session ran for STT1/2/3/8 live verification, immediately before Playwright started.
3. Raised `AUTH_LOGIN_RATE_LIMIT_MAX=1000` and reran: failures dropped to **20**. Still failing with the identical symptom — the UI itself showed "Bạn đã thử đăng nhập quá nhiều lần" (429), even though auth-service's own limiter was confirmed fresh.
4. Found a **second, separate** limiter: the API gateway's own *global* rate limiter (`GATEWAY_RATE_LIMIT_MAX`, default 600 req/15min, applies to every endpoint, not just login) — confirmed exhausted (`RateLimit-Remaining: 0`) via a direct request.
5. Raised `GATEWAY_RATE_LIMIT_MAX=50000` alongside the auth limit, reran: failures dropped to **3**.
6. Of those 3, one (`customer-reservation-pickup.spec.ts`) failed in its own setup/cleanup code trying to return a stale leftover loan (`LOAN-220244-OM4W57`) for `customer01` — traced to a loan created by my own earlier STT1/2/3 manual testing, sitting at warehouse **WH-HCM-01**, which `librarian01` (the test's cleanup actor, scoped only to branch BR-HCM-01) correctly has no write access to. The `403 WAREHOUSE_ACCESS_DENIED` was correct enforcement, not a bug. Returned it (and 8 other leftover `BORROWED` loans for the same test customer, all traceable to this session's manual testing) using a full-access account. Rerunning the full suite dropped this failure.
7. Both rate limits were restored to their defaults (`AUTH_LOGIN_RATE_LIMIT_MAX=10`, `GATEWAY_RATE_LIMIT_MAX=600`) once the clean run and leftover-data cleanup were done.

**Net result: the 27 failures were not a regression from any of the 4 STT1-8 fixes.** All were either shared-environment rate-limit exhaustion (caused by this session's own extensive live testing) or stale test data this session's own scripts had left behind.

## F. Remaining issues — OUT OF SCOPE, not fixed (Section VIII stop-and-report)

Two failures reproduce **stably**, including in isolation, after all rate limits were cleared and leftover test data cleaned up. Both sit in code **entirely untouched by STT1/STT5/STT7/STT8**, and are outside the approved 6-item scope:

1. **`e2e/ai-import-ocr.spec.ts:308`** ("the page shows either the OCR card or a clear availability notice, never nothing") — root cause: the **`ai-service` container is not running** in this dev environment (`docker compose ps ai-service` returns nothing; `GET /ai/capabilities` returns `503 AI_UNAVAILABLE`). The test expects the frontend to show a graceful "AI OCR unavailable" notice when the service is down, but neither the upload field nor the notice appeared — this may indicate a minor pre-existing frontend edge case in how the capabilities-check failure is handled, but the proximate cause (ai-service down) is an environment gap, not a code regression from this round.

2. **`e2e/purchase-to-putaway.spec.ts:9`** (full PO→receiving→putaway flow) — fails on the final assertion after "Xác nhận chuyển lên kệ" (confirm shelf transfer). The receiving-area bucket for the test's book/warehouse combination held **828 copies** pending putaway (confirmed via the Playwright error-context screenshot) — far beyond what this one test run creates (it only submits a quantity-5 purchase request) — indicating a long-accumulated backlog from repeated historical runs of this same test against a shared, never-fully-reset dev database. The putaway auto-allocation suggestion only populated 1 shelf line (qty 1) by the time the test clicked confirm, and the expected success toast never appeared within the 5s timeout. Putaway/shelf-transfer code was not touched by any of the 4 fixes in this round.

**Per the master prompt's explicit stop-and-wait rule, neither was patched.** Both require a decision: whether to start `ai-service` and/or investigate the frontend's capabilities-failure handling (item 1), and whether to reset/trim the accumulated putaway backlog and/or investigate the putaway auto-allocation UI (item 2) — as separate, out-of-scope work.

## G. Actor/regression spot-check

Re-ran during this round, all still correct (no regressions from the 4 fixes):
- `curator01` (WAREHOUSE_MANAGER role, READ-only at WH-HCM-01, zero scope elsewhere): correctly blocked (403) from both reading transfer-receiving lines and confirming transfers at WH-HN-01 — proves "manager role ≠ write scope" still holds.
- `staff01` (OPERATOR, write-only at WH-HCM-01): correctly blocked (403) from posting a receiving-putaway transfer destined for WH-HN-01.
- `hung`/`manager01` (FULL at all warehouses): unaffected, used for cleanup and spot-checks throughout.

## H. Files changed

- `services/inventory-service/src/routes/transfer-receiving.routes.js` (STT1)
- `services/borrow-service/src/controllers/loan.controller.js` (STT5)
- `services/analytics-service/src/controllers/analytics.controller.js` (STT7)
- `services/inventory-service/src/controllers/goods-receipt.controller.js` (STT8a, STT8b)
- `scripts/warehouse-scope-stt123-audit.mjs` (new, STT1/2/3 live audit script)
- `scripts/return-loan-partial-failure-audit.mjs` (new, STT5 live audit script)

## I. Final conclusion

**PARTIALLY COMPLETED — NEEDS DECISION.**

All 6 approved items (STT1, STT2, STT3, STT5, STT7, STT8) are resolved: 4 confirmed-and-fixed, 2 confirmed-already-fixed (no code change needed). All touched services' unit tests pass, all live warehouse-scope/reconciliation audits pass. The mandatory full Playwright regression was run to completion; after removing environmental noise (two separate exhausted rate limiters, and this session's own leftover test data — none caused by the 4 fixes), **85 of 87 tests pass**. The remaining 2 failures are stable, reproduce in isolation, sit in code outside the approved scope, and are traced to pre-existing environment/data conditions (ai-service not running; a large accumulated putaway backlog) rather than regressions from this round's changes — documented in Section F per the stop-and-wait rule, awaiting your decision rather than patched.

No commit or push has been made for this round's changes.
