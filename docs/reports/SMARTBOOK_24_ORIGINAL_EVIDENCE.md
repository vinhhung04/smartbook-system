# Original-source recovery and inventory lifecycle audit

Audit date: 2026-11-17 (Asia/Saigon). Baseline: `hungg`, `c7b5fa42d4bb79aeb6fc0f44170e81df23410ce5`.

## Provenance recovered

The original business findings SB-01–SB-15 were recovered from connected chat **Rà soát lỗi nghiệp vụ**, ID `6afb4f80-d8fc-83ee-b292-0ab6caf3c4dd`, assistant message `10ee8c14-0311-4d98-89ae-1d7d169259bf`. Full original text is preserved in `SMARTBOOK_24_ORIGINAL_SOURCE.md`. Its original static audit used `khoa` / `908bc956`; that report is hypothesis evidence, not proof of current behavior.

The initial filesystem/Git search did not find that external source. Its earlier missing-source BLOCKED classifications are **superseded**. Historical September SB-01–SB-11 roadmap commits are a separate identifier taxonomy and were correctly not substituted for these business findings. Other agents record SB-01–SB-06 and SB-08–SB-11 in their evidence files and the final consolidated report.

## Scoped findings

| ID | Original description | Current classification | Severity | Changed | Verification |
|---|---|---|---|---|---|
| SB-07 | Stock audit absorbs movements after physical count; alleged locking absent | NEEDS BUSINESS DECISION | High | No | Real PostgreSQL controller evidence verifies current 10 expected / 8 counted / 8 live is approved as 8, not 6 under a postcount outbound interpretation; schema has no count-time cutoff |
| SB-12 | Transfer damage, rejection and shortages lack a complete discrepancy workflow | NEEDS BUSINESS DECISION | High | No | Read receiving outcome, stock posting, transfer confirmation and existing transfer-count tests; accepted/delivered/damaged/rejected persist, while disposition workflow and responsibility rules are absent |
| SB-13 | Supplier return cannot execute after receipt stock was put away | CONFIRMED BUG | High | Yes | Unit RED: null original location rejects despite traced shelf stock; GREEN + PostgreSQL verifies receipt-linked shelf return, prior-return caps, and rollback without consuming unrelated replenishment |
| SB-14 | Cancelling a putaway GRN only reverses original inbound | CONFIRMED BUG | High | Yes | Unit RED: receiving becomes -10 while shelf remains 10; GREEN + PostgreSQL verifies simultaneous cancellation, both movement reversals and insufficient-stock rollback |
| SB-15 | PO remainder closure ignores delivery declared but not received | CONFIRMED BUG | High | Yes | Unit RED: closure returns 200 with pending delivery; GREEN + PostgreSQL returns 409 until delivery is processed |

## SB-07: count-time business decision

Files/functions: `stock-audit.controller.js::submitLineCount`, `approveStockAudit`; `stock-audit-creation.service.js::createAuditWithLines`; schema `stock_audit_lines`, `stock_audits`.

Actor: warehouse WRITE-scoped counting staff and approving manager. Creation records `expected_qty` from then-current stock. Count submission stores `counted_qty` and `variance_qty = counted - expected`. Approval currently uses `counted - liveOnHand`, atomically increments stock, and marks the line adjusted. The comment explicitly attempts to avoid applying an overlapping audit twice; the stock read currently has no FOR UPDATE.

Reproduction: expected 10, physical count 8, live balance 8 after a later two-copy outbound. Approval leaves 8 and records delta 0. Under the source report's assumed count cutoff, the correct result is 6. The same persisted line/balance also represents stock moved **before** physical counting, where 8 is correct. There is no per-line `counted_at`, inventory version, or frozen-count marker to distinguish them. Applying stored variance universally would double-apply an overlapping adjustment and could mis-handle pre-count stock movements.

Decision required: establish a physical-count cutoff or freeze policy, whether count submission is the authoritative timestamp, treatment of overlapping audits and unsubmitted/legacy counts, and whether stock held for reservations/loans can be reduced. A durable per-line cutoff/version or controlled recount is needed before choosing adjustment semantics. No unverified arithmetic replacement was made. The PostgreSQL evidence test deliberately asserts **current incorrect-under-postcount-assumption behavior**; its passing result is not a fix claim.

## SB-12: transfer discrepancy business decision

Files/functions: `transfer-receiving.controller.js::computeTransferLineOutcome`, `getTransferReceivingLines`, `confirmTransferReceiving`; `goods-receipt.controller.js::postTransferReceiptToReceiving`; `outbound.controller.js::confirmOutbound`.

The existing convention explicitly posts only accepted copies. `delivered`, `damaged`, `rejected` are persisted in GRN lines, and received_qty represents accepted inventory. Transfer completion and existing audit records retain evidence, but there is no dedicated discrepancy case state machine assigning responsibility or deciding whether a rejected/damaged copy remains physically at the destination, returns to origin, or becomes an insurance/loss case.

Decision required: locations/custody and availability of damaged/rejected copies, who owns missing copies in transit, who approves adjustments, resolution/return/redelivery lifecycle, and how repick shipments clear discrepancies. The original example is internally inconsistent: 100 shipped / 90 delivered / 5 damaged implies 10 missing and 85 accepted, not 5 missing. No automatic damaged stock/loss or new workflow was invented.

## SB-13: return stock follows receipt provenance

Files: `supplier-return.service.js::executeReturnStock`; `supplier-return.controller.js::executeSupplierReturn` (loads receipt ID and accepted quantity with line location).

Before: only `goods_receipt_items.location_id` was usable; normally null for RECEIVING_HOLD receipts. Putaway already writes `RECEIVING_SHELF_PUTAWAY` with `reference_id = goods receipt ID` and per-target quantities, so location provenance exists in durable movements.

After: lock the GRN item; derive eligible destination allocations from its receipt-linked, non-reverted PUTAWAY movements and any original direct allocation. Subtract previous SUPPLIER_RETURN movements tied to the same GRN item. Lock and read each eligible stock balance, consume only its traced allocation and current available quantity, and preserve existing OUTBOUND movement/audit metadata. If insufficient, throw 409 so the enclosing controller transaction rolls back all partial allocations. Unrelated stock replenishment cannot increase this GRN's return allowance. Old putaways without a receipt reference cannot be attributed safely and remain blocked rather than guessing warehouse stock.

Input: receipt accepts 10 with null location; receipt-stamped putaway sends 10 to shelf; return 6. Before: 409 missing location. After: shelf on_hand/available drops 10→4, OUTBOUND references supplier return and exact GRN line. Replenishing shelf by unrelated 10 then asking this receipt to return another 5 fails and rolls back; only 4 remain allocated to this receipt.

## SB-14: cancel reverses traced putaway before inbound

Files: new `receipt-putaway-reversal.service.js::reverseReceiptPutaway`; `goods-receipt.controller.js::cancelStockMovements`; `receiving-putaway.controller.js::transferReceivingToShelf`.

Before: cancel finds only GOODS_RECEIPT movements. With receiving=0 and shelf=10, reversing original inbound decrements receiving to -10 (or fails a database constraint) and leaves shelf=10.

After: receipt-linked PUTAWAY movements are reversed first under stock-row locks. Sufficient **available** shelf stock is mandatory. Destination on_hand/available decrements, original RECEIVING_HOLD on_hand restores, movements retain history with reverted=true, and stock-change outbox events record both sides. Then original inbound reverses with locked on_hand/available guards. Already reserved/borrowed/consumed stock produces 409 and rolls back status and all reversals. No old movement is deleted. Receipt-scoped putaway takes the same goods_receipts row lock before checking POSTED, serializing with cancellation's receipt status write; its existing Serializable transaction also prevents a stale POSTED snapshot from authorizing a post-cancellation putaway.

PostgreSQL concurrency test uses Promise.all for two cancellations and proves only two original movements become reverted, balances are zero, and both requests receive valid cancellation outcomes. A separate test sets available=9/borrowed=1 and confirms cancellation remains POSTED, no movement becomes reverted, and 409 is returned.

Final review reproduced duplicate PO reversal: received20 includes this GRN10 plus another10; concurrent cancellations left received0 instead of10 although stock reverted once. `updateGoodsReceipt` now locks the receipt before reading status on cancellation. Only the first can enter the POSTED reversal path. The added PostgreSQL regression asserts received10 and exactly one PURCHASE_ORDER_RECEIPT_CANCELLED audit. RED log `audit-grn-po-cancel-red.log` records `0 !== 10`; final complete inventory suite398/398 passes. Cancellation and receipt-scoped putaway now share the same receipt lock.

## SB-15: block closure while declared delivery remains pending

File/function: `purchase-order-line-closure.controller.js::closeRemainingLine`.

The warehouse WRITE check and PO item FOR UPDATE remain unchanged. Before changing closure_status, find delivery lines associated with that PO item and refuse any delivery not yet RECEIVED, SHORTAGE_REPORTED (processed discrepancy), or CANCELLED. Thus a partially received/damaged delivery can still close its remaining commitment after processing, while an in-flight SUBMITTED delivery cannot be stranded by closure. API shape, reason/evidence/audit records remain unchanged. SB-09 creation is coordinated to acquire the same PO item lock and re-read closure before inserting a delivery note; no cross-service transaction is assumed.

Input: ordered 100, received 50, pending delivery 50. Before: 200 and CLOSED_WITH_REMAINING. After: 409, line OPEN, no closure audit log. Mark delivery SHORTAGE_REPORTED after processing; closure then returns 200. Formal financial invoices alone do not establish an unreceived physical shipment, so no speculative financial-document closure rule was added.

## Verification ledger

- Unit RED runs recorded actual failures before code fixes for each SB-13, SB-14 and SB-15. Initial fake-harness deficiencies (missing raw query/compound key support) were corrected before counting behavioral reproductions.
- Focused unit suites supplier-return, GRN cancellation and PO closure: 22 passed, 0 failed, 0 skipped before later outbox/fixture additions; final full inventory results are consolidated by the parent.
- `receipt-lifecycle-audit.db.test.js`: 6 passed (one parent + five subtests), 0 failed, 0 skipped against migrated isolated `inventory_audit_verified` PostgreSQL. Includes SB-07 observation and four fix/regression scenarios. Fixture initially omitted required source_service; this setup failure was corrected before the successful run, not hidden.
- Intermediate full inventory run: 378 total, 372 pass, 4 fail, 2 skip. Three failures were new receipt-lock calls missing in the existing putaway fake; fixed by providing the raw-lock stub. One was another concurrently edited SB-22 fake and was reported to its owning agent. Final rerun is recorded by the parent; these intermediate failures are not a PASS claim.

No schema migration, enum, route, payload or UI redesign was introduced. No production/demo data was reset or deleted, and no commit or push was made.

Final entry points: `supplier-return.service.js:101::executeReturnStock`, `supplier-return.controller.js:360::executeSupplierReturn`, `receipt-putaway-reversal.service.js:5::reverseReceiptPutaway`, `goods-receipt.controller.js:1274::updateGoodsReceipt` (lock1296), `receiving-putaway.controller.js:709::transferReceivingToShelf`, `purchase-order-line-closure.controller.js:35::closeRemainingLine`. Final lifecycle PostgreSQL count7 (parent+6), all pass; complete inventory398/398, no fail/skip. The lifecycle repeat's unique supplier-name setup failure was corrected with UUID fixture names without deleting data; earlier six-test count predates the additional PO-reversal test.
