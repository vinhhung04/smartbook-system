-- CreateTable: purchase_requests
-- Staff submit purchase/replenishment requests for manager review.
-- Staff cannot create POs directly; manager converts approved requests to PO.
CREATE TABLE "purchase_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "request_number" VARCHAR(40) NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "book_variant_id" UUID,
    "book_title_hint" VARCHAR(255),
    "quantity_requested" INTEGER NOT NULL,
    "reason" VARCHAR(30) NOT NULL DEFAULT 'OTHER',
    "note" TEXT,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "approved_by_user_id" UUID,
    "rejected_by_user_id" UUID,
    "approved_at" TIMESTAMPTZ(6),
    "rejected_at" TIMESTAMPTZ(6),
    "rejection_reason" TEXT,
    "purchase_order_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable: warehouse_exception_reports
-- Reports created by warehouse staff for shortage, overage, or damage.
-- Manager reviews and resolves; stock is NOT adjusted automatically.
CREATE TABLE "warehouse_exception_reports" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "report_number" VARCHAR(40) NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "task_type" VARCHAR(20) NOT NULL,
    "task_id" UUID NOT NULL,
    "goods_receipt_id" UUID,
    "exception_type" VARCHAR(30) NOT NULL,
    "book_variant_id" UUID,
    "expected_qty" INTEGER,
    "actual_qty" INTEGER,
    "note" TEXT NOT NULL,
    "evidence_notes" TEXT,
    "status" VARCHAR(20) NOT NULL DEFAULT 'OPEN',
    "resolved_by_user_id" UUID,
    "resolved_at" TIMESTAMPTZ(6),
    "resolution_notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "warehouse_exception_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "purchase_requests_request_number_key" ON "purchase_requests"("request_number");

CREATE INDEX "idx_purchase_requests_user" ON "purchase_requests"("created_by_user_id");

CREATE INDEX "idx_purchase_requests_status" ON "purchase_requests"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "warehouse_exception_reports_report_number_key" ON "warehouse_exception_reports"("report_number");

CREATE INDEX "idx_warehouse_exception_reports_user" ON "warehouse_exception_reports"("created_by_user_id");

CREATE INDEX "idx_warehouse_exception_reports_status" ON "warehouse_exception_reports"("status", "created_at");

-- AddForeignKey
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_book_variant_id_fkey" FOREIGN KEY ("book_variant_id") REFERENCES "book_variants"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "warehouse_exception_reports" ADD CONSTRAINT "warehouse_exception_reports_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "warehouse_exception_reports" ADD CONSTRAINT "warehouse_exception_reports_goods_receipt_id_fkey" FOREIGN KEY ("goods_receipt_id") REFERENCES "goods_receipts"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "warehouse_exception_reports" ADD CONSTRAINT "warehouse_exception_reports_book_variant_id_fkey" FOREIGN KEY ("book_variant_id") REFERENCES "book_variants"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
