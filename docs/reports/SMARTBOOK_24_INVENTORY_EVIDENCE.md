# SmartBook SB-04, SB-08–SB-11, SB-16/SB-17, SB-22–SB-24 — inventory evidence

Baseline: branch `hungg`, HEAD `c7b5fa42d4bb79aeb6fc0f44170e81df23410ce5`, initially identical to fetched `origin/hungg`. Existing untracked `apps/web/public/__tmp_enrich.json` preserved. No commit or push.

## Classification and reproduction

| ID | Original hypothesis | Verdict | Severity | Actor / path | Reproduction and evidence |
|---|---|---|---|---|---|
| SB-16 | GRN silently omits Delivery Note lines | CONFIRMED BUG, FIXED | High | Warehouse writer, `supplier-delivery.controller.js:createGoodsReceiptFromInvoice`; posting `procurement-receipt.service.js:settleSupplierReceiptQuantities` | Note contains two variants; send only the first. Before: HTTP 201 creates one GRN row; legacy incomplete GRN settlement returns normally and cannot record the second line's shortage. Expected: require an explicit count for every note line. Failing regressions observed both HTTP 201 instead of 400 and missing expected settlement rejection. After: incomplete payload HTTP400; complete payload with second line `delivered_qty:0` HTTP201; settlement returns the zero line with missing quantity10 and PostgreSQL discrepancy row `SHORTAGE:10`. |
| SB-17 | Simultaneous supplier invoice duplicate | ALREADY FIXED | High if absent | Supplier creates formal invoice using `procurement-document.service.js:createDocument`, lines277/334/435 | Current migration `20261113090000_add_procurement_document_workflow/migration.sql:225` creates the actual partial unique index. PostgreSQL test inspects `pg_indexes`, synchronizes two real service duplicate prechecks, runs `Promise.allSettled` with invoice numbers differing only in case: exactly one creation, one `DocumentError.statusCode=409` from P2002. Other supplier and series succeed; CANCELLED predecessor does not block a new live invoice. No production code changed for this issue. |
| SB-22 | Idempotency key falsely acknowledges another object/payload | CONFIRMED BUG, FIXED | High | Integration actors authorized by `borrow-integration.routes.js`, release/consume/return controller functions | First successful request with K; reuse K with another reservation/loan/item/warehouse/variant/quantity/condition/location or operation. Before: each mismatch returned200; 17 separate assertions failed. After:409, no stock/outbox/movement mutation; identical retries200 with one movement. Real PostgreSQL `Promise.all` verifies each of release, consume and return changes stock once. |
| SB-23 | Concurrent reservation cancellation and conversion compete for the same hold | CONFIRMED BUG, FIXED (inventory component; Borrow side documented separately) | Critical | Integration release/consume, including reconciliation callers | With reserved_qty2 belonging to two separate ACTIVE holds, concurrent release and consume of the first hold both succeeded200/201 and spent the second hold's quantity. Actual PostgreSQL RED log preserved in `test-results/inventory-24-audit-db-sb23-red.log`. After: conditional ACTIVE claim on the reservation row precedes balance updates inside the same inventory transaction; exactly one success and one409, one movement, reserved_qty1 remains and unrelated hold stays ACTIVE. Cancellation of an already CONSUMED hold returns409. |
| SB-24 | GRN replay bypasses warehouse WRITE permission | CONFIRMED BUG, FIXED | High | Manager A writes actual PO warehouse; manager B has no WRITE there | Before: B replays A's key and receives200 plus GRN data. Regression failed200!=403. After:403 with no data. Both initial replay and P2002 recovery verify stored receipt warehouse, invoice identity, actual invoice/PO warehouse, requested warehouse and PO identity. Parallel key collision for another delivery returns409; permission revoked between creation and collision recovery returns403. PostgreSQL verifies actual stored document and current actor. |

## Changes and exact locations

- `services/inventory-service/src/controllers/supplier-delivery.controller.js:244`: full Delivery Note coverage at draft creation (line345). `replayCreatedReceipt` (line416) is shared by normal replay and unique collision recovery; both await authorization inside error handling.
- `services/inventory-service/src/services/procurement-receipt.service.js:150`: settlement rejects omitted delivery lines with `INCOMPLETE_DELIVERY_COUNT` before any quantity update (lines158–160).
- `services/inventory-service/src/controllers/borrow-integration.controller.js:48`: normalized business identity helper; replay assertion at line60; unique-key / stock-guard collision recovery at line84. Release line445, consume line570 and return line694 validate before replay and store `metadata.borrow_request` alongside all existing metadata. Transaction rollback is retained. Concurrent loser looks up the committed winning movement after rollback and validates it before returning replay success.
- SB23 inventory: release/consume atomically claim `stock_reservations` with `updateMany({where:{id,status:'ACTIVE'}})` before mutating the stock balance. Failed claims abort the transaction; same-key valid concurrent retries replay the committed winner, distinct operation/key conflicts return409. No transaction spans services.
- `apps/web/src/components/pages/supplier-deliveries.tsx:464` and `goods-receipt.tsx:292`: preserve explicit zero counts instead of filtering them out. Existing all-zero validation remains. No interface redesign.
- New `services/inventory-service/test/borrow-idempotency-binding.test.js`: individual mutation/identity cases, cross-operation reuse, pre-upgrade movements and legacy lost-return retry.
- New `services/inventory-service/test/audit-24.db.test.js`: opt-in actual PostgreSQL verification for the four issues with separate subtests.
- Extended `services/inventory-service/test/supplier-delivery-receipt.test.js:99` and `procurement-receipt.test.js:111` with reproductions and collision authorization cases.

No schema change, migration, new endpoint or enum. Current request/response shapes remain supported; incomplete receiving requests must now state every count explicitly, including zero. Several delivery batches and GRNs per PO remain supported; existing one-GRN-per-delivery rule remains intact.

## Validation

| Run | Tests | Pass | Fail | Skip | Evidence |
|---|---:|---:|---:|---:|---|
| Initial SB16/SB24 RED reproduction | 27 | 24 | 3 | 0 | Observed incomplete creation201, missing settlement rejection, unauthorized replay200 |
| Initial SB22 RED reproduction | 20 | 3 | 17 | 0 | Each mismatched replay returned200 |
| Legacy lost-return review regression before adjustment | 21 | 20 | 1 | 0 | Pre-upgrade lost movement `to_location_id:null` rejected original explicit ignored location; corrected using persisted lost semantics |
| SB23 inventory PostgreSQL RED reproduction | 9 | 7 | 2 | 0 | One failing subtest plus failing parent count; both release200/consume201 observed |
| Final PostgreSQL focused run | 9 | 9 | 0 | 0 | `test-results/inventory-24-audit-db.log` |
| Complete inventory suite before final SB23 inventory change, including opt-in DB run | 380 | 380 | 0 | 0 | Final post-SB23 results recorded below |

The complete suite includes the PostgreSQL test counts; do not add the focused counts again. Initial command: `pnpm --filter inventory-service test` with `INVENTORY_AUDIT_TEST_DATABASE_URL` set to the disposable database. Final command uses the same test script body, `pnpm --filter inventory-service exec node --test test/*.test.js`, with an isolated generated client supplied through `INVENTORY_AUDIT_PRISMA_CLIENT`, avoiding shared pnpm Prisma generation collisions with simultaneous Borrow-service verification. Focused command: `pnpm --filter inventory-service exec node --test test/audit-24.db.test.js`. Without the database variable, the explicit DB opt-in test is skipped rather than falsely passing. `git diff --check` passed.

PostgreSQL used a dedicated Docker container bound only to loopback25432 and database `inventory_audit_verified`. All14 checked-in inventory migrations were applied. An earlier fresh database `inventory_audit` migration attempt failed because `pg_trgm` was not initialized; it was preserved, and the separate verified database was initialized with `pg_trgm`/`pgcrypto` before migration. Early DB test fixture setup failures (missing `expires_at`, repeated supplier fixture names) were corrected using complete fields and unique random fixture names; no production/database rows were deleted or reset to make tests pass. Credentials remain in ignored `.git/borrow-audit-env.json`, never in this report.

## Compatibility and remaining limits

- Existing incomplete DRAFT GRNs cannot silently post after the fix. Operators must cancel and recreate them with all counts represented; no historical row is rewritten automatically. Already posted historical documents are unchanged and may require a separate data audit.
- Old movements lack a complete request fingerprint. Replay uses available persisted references and metadata; ignored location on legacy LOST returns cannot be reconstructed and therefore does not block legitimate retry. New movements bind the explicit request identity.
- PostgreSQL tests execute real services/controllers, constraints and transactions, with external warehouse permission resolution supplied at its boundary. These focused tests do not replace the full deployed multi-service/browser workflow regression owned by the main audit.
- Unit collision tests deliberately interleave `Promise.all` through the fake persistence boundary to exercise both P2002 response branches. Actual stock mutation and invoice uniqueness concurrency are additionally verified on real PostgreSQL.
- The original first fifteen descriptions were later recovered from the connected ChatGPT chat and preserved in `SMARTBOOK_24_ORIGINAL_SOURCE.md`. Findings added below supersede the initial limited scope; Borrow and analytics evidence remain separate.

## Recovered SB-04 and SB-08–SB-11

All five are **CONFIRMED BUG**, severity High; separate PostgreSQL tests in `test/audit-24.db.test.js` verify each scenario against actual controllers, transactions, movements and stock balances. Warehouse permission resolution alone is supplied at its external boundary. No enum, schema or request shape changed.

| ID | Actor / file / function | Root cause and input | Before fix | After fix / regression |
|---|---|---|---|---|
| SB-04 | Borrow integration, `borrow-integration.controller.js:697::returnBorrowedLoan` | Aggregate borrowed stock cannot establish whether a specific item already returned. Two different keys return the same item while a sibling of the same variant remains borrowed. | Both can mutate stock, spending the sibling's borrowed quantity. | Advisory lock by normalized loan_item_id; inspect persisted RETURN/ADJUSTMENT metadata before mutation. Concurrent distinct keys gives201/409; borrowed1 remains; LOST and case-variant retries under new keys also409. Valid same-key replay still200. Callers without loan_item_id keep their existing contract. |
| SB-08 | Warehouse writer, `supplier-delivery.controller.js:250::createGoodsReceiptFromInvoice` | Two transactions read no GRN for one note; independent keys do not serialize the shipment. Note5/PO10. | Two GRNs for one physical shipment. | Delivery Note FOR UPDATE before reading existing GRN; Promise.all distinct keys gives201/409, one live GRN. Multiple notes/GRNs per PO remain supported. |
| SB-09 | Warehouse writer, `supplier-delivery.controller.js:150::createSupplierDelivery` | Only ordered-received checked; pending notes omitted. Concurrent80+80/PO100. | Two201; declared total160. | Lock PO lines in stable order, re-read closure and quantities, reuse assertInvoiceQtyWithinRemaining. One201/one400, total80. Shares PO-line lock with SB-15 closure. |
| SB-10 | Outbound staff, `outbound.controller.js:813::confirmOutbound` | Repick total by variant added to each duplicate line. Root shipped2+3, repick2. | Outbound9 rather than7. | `repick-quantities.service.js:3::addRepickQuantities` distributes repick once in stable line order. Both outbound paths and GRN draft use it. PostgreSQL movements7, source9→2, draft7. |
| SB-11 | Destination staff, `transfer-receiving.controller.js:100/167/273`, queue/lines/confirm | Root shipped5 ignores two child-repick copies. | Display/received count5 or excess validation for real7. | `repick-quantities.service.js:25::getTransferShippedLines` includes non-cancelled root-linked children using shared distribution. Explicit counts and legacy no-draft receive-in-full tests each prove destination stock7 and received_qty7. |

RED logs: `inventory-24-audit-original-red.log`, `inventory-24-audit-repick-red.log` (under ignored `test-results`). The historical infrastructure taxonomy was not used to infer these findings.

The old contract test expected success releasing an already CONSUMED reservation under a new key. That conflicts with SB-23's one-terminal-operation invariant and is now409. Existing reserve→release→same-key replay schema assertions remain; no valid retry test was removed.

## Final consolidated verification

After all inventory/lifecycle changes and the additional SB-14 PO-cancellation race fix: **398 tests, 398 pass, 0 fail, 0 skip**, log `test-results/inventory-24-audit-final.log`. Command: `pnpm --filter inventory-service exec node --test test/*.test.js`, with `INVENTORY_AUDIT_TEST_DATABASE_URL` and isolated `INVENTORY_AUDIT_PRISMA_CLIENT` enabled.

Includes15 counts from audit-24.db.test.js (parent+14 subtests),7 from receipt-lifecycle-audit.db.test.js (parent+6 subtests), and all existing unit tests; do not add focused counts again. Earlier380/381 results preceded recovered findings. An intermediate repeat failed because a lifecycle fixture reused a unique supplier name; it now uses a fresh UUID name. Existing data/fixtures were retained, and the failure was not treated as product proof.
