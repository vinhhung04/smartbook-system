# SB-18 — Incoming quantity under SHORTAGE_REPORTED

Audit baseline: `hungg`, `c7b5fa42d4bb79aeb6fc0f44170e81df23410ce5`, 2026-11-17.

Classification: **CONFIRMED BUG**, fixed, severity Medium.

The original hypothesis is the SB-18 description in the supplied master prompt. No original SB-01–SB-15 descriptions are inferred from this finding.

## End-to-end evidence

- `services/inventory-service/src/controllers/goods-receipt.controller.js`, `calculatePoStatus` (line 39), `updatePurchaseOrderStatusFromTotals` (line 79): one open shortage report sets the **whole PO** to SHORTAGE_REPORTED when received quantities are incomplete. It does not close its other lines.
- `services/inventory-service/src/services/procurement-receipt.service.js`, `recordSupplierReceiptOutcome`: a per-delivery discrepancy creates a report; later receipts can resolve it. Delivered, accepted, shortage and ordered quantities remain separate.
- `services/inventory-service/src/controllers/supplier-portal.controller.js`, `createPortalInvoice`: explicitly permits SHORTAGE_REPORTED and redelivery against open reports, bounded by the outstanding discrepancy. It refuses explicitly closed lines.
- `services/inventory-service/src/services/purchase-order-line-closure.service.js`, `buildCloseRemaining`: when the outstanding quantity will never arrive, a manager must explicitly close that **line** with a reason. SHORTAGE_REPORTED itself is a closable, still active state.
- `services/analytics-service/src/controllers/analytics.controller.js`, `getIncomingQtyByVariant` (line 853): previously omitted all SHORTAGE_REPORTED POs. Its existing closure filter already correctly excludes CLOSED_WITH_REMAINING lines.

Actors: warehouse receiving staff record counts, supplier submits redelivery, manager explicitly closes a line, authorized analytics readers view aggregated suggestions. The fix changes no permission, API, warehouse aggregation, stored quantity, budget algorithm or write transaction.

## Reproduction and regression

`services/analytics-service/test/reorder-incoming-shortage.db.test.js` calls the real analytics controller and executes its actual incoming SQL against PostgreSQL TEMP tables in a rolled-back transaction. Other read models use fixtures; this is a SQL/controller regression, not a full deployed procurement scenario.

Fixture: SHORTAGE_REPORTED PO with open line ordered=10, received=4; closed remainder=10; CANCELLED and DRAFT POs each with 50 open. Reorder point=20, no available stock.

Before fix: incoming=0, assertion **0 !== 6** (1 test failed, 0 skipped). Expected incoming=6, inventory position=6, required funded cap=14; closed/cancelled/draft quantities must stay excluded.

After fix: include SHORTAGE_REPORTED among incoming PO states while preserving the existing per-line closure filter. Actual incoming=6, position=6, cap=14.

Verification: `pnpm --filter analytics-service test` with `ANALYTICS_TEST_PG_URL` pointing to the isolated audit PostgreSQL: **162 tests, 162 pass, 0 fail, 0 skip**. This includes the new SB-18 regression and the three existing PostgreSQL timezone tests. Log: `test-results/analytics-audit.log` (ignored local artifact).

No migration or API contract change. Updated the existing budget test's old expected status list because that expectation encoded the confirmed defect.
