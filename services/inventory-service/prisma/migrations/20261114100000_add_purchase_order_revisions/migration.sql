-- Purchase Order Revision (P1.1).
-- Purely additive: one new table, no existing column, table, constraint or row is dropped,
-- renamed or rewritten, so code and data from before this migration keep working unchanged.
-- Rollback: DROP TABLE "purchase_order_revisions";

-- CreateTable
CREATE TABLE "purchase_order_revisions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "purchase_order_id" UUID NOT NULL,
    "revision_number" INTEGER NOT NULL,
    "status" VARCHAR(40) NOT NULL DEFAULT 'PENDING_APPROVAL',
    "reason" TEXT NOT NULL,
    "requires_supplier_reconfirmation" BOOLEAN NOT NULL DEFAULT true,
    "before_snapshot" JSONB NOT NULL,
    "after_snapshot" JSONB NOT NULL,
    "requested_by_user_id" UUID NOT NULL,
    "approved_by_user_id" UUID,
    "rejected_reason" TEXT,
    "supplier_decision_user_id" UUID,
    "effective_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_order_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "purchase_order_revisions_purchase_order_id_revision_number_key" ON "purchase_order_revisions"("purchase_order_id", "revision_number");

-- CreateIndex
CREATE INDEX "idx_po_revisions_po_status" ON "purchase_order_revisions"("purchase_order_id", "status");

-- AddForeignKey
ALTER TABLE "purchase_order_revisions" ADD CONSTRAINT "purchase_order_revisions_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
