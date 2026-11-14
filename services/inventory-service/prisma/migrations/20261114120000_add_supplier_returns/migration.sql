-- Supplier Return / Return to Supplier (P1.3).
-- Purely additive: two new tables only. No existing column, table, constraint or row is dropped,
-- renamed or rewritten, so code and data from before this migration keep working unchanged.
-- Rollback: DROP TABLE "supplier_return_items"; DROP TABLE "supplier_returns";

-- CreateTable
CREATE TABLE "supplier_returns" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "return_number" VARCHAR(40) NOT NULL,
    "purchase_order_id" UUID NOT NULL,
    "goods_receipt_id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "status" VARCHAR(40) NOT NULL DEFAULT 'PENDING_APPROVAL',
    "reason" TEXT NOT NULL,
    "evidence_reference" TEXT,
    "requires_supplier_confirmation" BOOLEAN NOT NULL DEFAULT true,
    "requested_by_user_id" UUID NOT NULL,
    "approved_by_user_id" UUID,
    "rejected_reason" TEXT,
    "supplier_decision_user_id" UUID,
    "executed_by_user_id" UUID,
    "executed_at" TIMESTAMPTZ(6),
    "resolution_outcome" VARCHAR(30),
    "resolution_note" TEXT,
    "resolved_by_user_id" UUID,
    "resolved_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_return_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "supplier_return_id" UUID NOT NULL,
    "goods_receipt_item_id" UUID NOT NULL,
    "purchase_order_item_id" UUID,
    "variant_id" UUID NOT NULL,
    "return_qty" INTEGER NOT NULL,
    "unit_cost" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "note" TEXT,

    CONSTRAINT "supplier_return_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "supplier_returns_return_number_key" ON "supplier_returns"("return_number");

-- CreateIndex
CREATE INDEX "idx_supplier_returns_grn_status" ON "supplier_returns"("goods_receipt_id", "status");

-- CreateIndex
CREATE INDEX "idx_supplier_returns_po" ON "supplier_returns"("purchase_order_id");

-- CreateIndex
CREATE INDEX "idx_supplier_return_items_grn_item" ON "supplier_return_items"("goods_receipt_item_id");

-- AddForeignKey
ALTER TABLE "supplier_returns" ADD CONSTRAINT "supplier_returns_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "supplier_returns" ADD CONSTRAINT "supplier_returns_goods_receipt_id_fkey" FOREIGN KEY ("goods_receipt_id") REFERENCES "goods_receipts"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "supplier_returns" ADD CONSTRAINT "supplier_returns_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "supplier_returns" ADD CONSTRAINT "supplier_returns_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "supplier_return_items" ADD CONSTRAINT "supplier_return_items_supplier_return_id_fkey" FOREIGN KEY ("supplier_return_id") REFERENCES "supplier_returns"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "supplier_return_items" ADD CONSTRAINT "supplier_return_items_goods_receipt_item_id_fkey" FOREIGN KEY ("goods_receipt_item_id") REFERENCES "goods_receipt_items"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "supplier_return_items" ADD CONSTRAINT "supplier_return_items_purchase_order_item_id_fkey" FOREIGN KEY ("purchase_order_item_id") REFERENCES "purchase_order_items"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
