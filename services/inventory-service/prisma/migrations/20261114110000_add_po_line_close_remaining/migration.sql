-- Close Remaining Quantity (P1.2).
-- Purely additive: new nullable/defaulted columns on purchase_order_items only. No existing
-- column, table, constraint or row is dropped, renamed or rewritten, so code and data from
-- before this migration keep working unchanged. Rollback:
--   ALTER TABLE "purchase_order_items"
--     DROP COLUMN "closure_status", DROP COLUMN "closed_reason", DROP COLUMN "closed_evidence_reference",
--     DROP COLUMN "closed_by_user_id", DROP COLUMN "closed_at", DROP COLUMN "reopened_reason",
--     DROP COLUMN "reopened_by_user_id", DROP COLUMN "reopened_at";

-- AlterTable
ALTER TABLE "purchase_order_items"
  ADD COLUMN "closure_status" VARCHAR(30) NOT NULL DEFAULT 'OPEN',
  ADD COLUMN "closed_reason" TEXT,
  ADD COLUMN "closed_evidence_reference" TEXT,
  ADD COLUMN "closed_by_user_id" UUID,
  ADD COLUMN "closed_at" TIMESTAMPTZ(6),
  ADD COLUMN "reopened_reason" TEXT,
  ADD COLUMN "reopened_by_user_id" UUID,
  ADD COLUMN "reopened_at" TIMESTAMPTZ(6);
