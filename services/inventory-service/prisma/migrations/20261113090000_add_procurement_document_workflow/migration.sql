-- Procurement document workflow (supplier <-> warehouse shared documents).
-- Purely additive: new nullable/defaulted columns and new tables only. No existing column,
-- table, constraint or row is dropped or rewritten, so code and data from before this
-- migration keep working unchanged. Rollback SQL is in
-- PROCUREMENT_DOCUMENT_WORKFLOW_IMPLEMENTATION_REPORT.md (section 15).

-- AlterTable
ALTER TABLE "goods_receipt_items" ADD COLUMN     "damaged_qty" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "delivered_qty" INTEGER,
ADD COLUMN     "rejected_qty" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "goods_receipts" ADD COLUMN     "idempotency_key" VARCHAR(100);

-- AlterTable
ALTER TABLE "purchase_orders" ADD COLUMN     "supplier_response_status" VARCHAR(30);

-- AlterTable
ALTER TABLE "supplier_delivery_invoices" ADD COLUMN     "carrier_name" VARCHAR(150),
ADD COLUMN     "deliverer_name" VARCHAR(150);

-- AlterTable
ALTER TABLE "supplier_shortage_reports" ADD COLUMN     "discrepancy_type" VARCHAR(30) NOT NULL DEFAULT 'SHORTAGE',
ADD COLUMN     "resolution_action" VARCHAR(30),
ADD COLUMN     "resolution_note" TEXT,
ADD COLUMN     "supplier_proposed_action" VARCHAR(30),
ADD COLUMN     "supplier_response_note" TEXT;

-- AlterTable
ALTER TABLE "supplier_shortage_report_items" ADD COLUMN     "discrepancy_type" VARCHAR(30) NOT NULL DEFAULT 'SHORTAGE';

-- CreateTable
CREATE TABLE "purchase_order_supplier_responses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "purchase_order_id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "decision" VARCHAR(30) NOT NULL,
    "reason" TEXT,
    "proposed_delivery_date" DATE,
    "lines" JSONB NOT NULL DEFAULT '[]',
    "has_variance" BOOLEAN NOT NULL DEFAULT false,
    "review_status" VARCHAR(20) NOT NULL DEFAULT 'NOT_REQUIRED',
    "review_note" TEXT,
    "reviewed_by_user_id" UUID,
    "reviewed_at" TIMESTAMPTZ(6),
    "responded_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_order_supplier_responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "procurement_documents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "document_number" VARCHAR(60) NOT NULL,
    "document_type" VARCHAR(40) NOT NULL,
    "issuer_party" VARCHAR(20) NOT NULL,
    "external_number" VARCHAR(80),
    "invoice_series" VARCHAR(30),
    "status" VARCHAR(40) NOT NULL DEFAULT 'DRAFT',
    "purchase_order_id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "supplier_delivery_invoice_id" UUID,
    "goods_receipt_id" UUID,
    "shortage_report_id" UUID,
    "supersedes_document_id" UUID,
    "issue_date" DATE,
    "subtotal_amount" DECIMAL(14,2),
    "tax_rate" DECIMAL(5,2),
    "tax_amount" DECIMAL(14,2),
    "total_amount" DECIMAL(14,2),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "internal_note" TEXT,
    "cancel_reason" TEXT,
    "created_by_user_id" UUID,
    "issued_at" TIMESTAMPTZ(6),
    "cancelled_at" TIMESTAMPTZ(6),
    "cancelled_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "procurement_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "procurement_document_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "document_id" UUID NOT NULL,
    "purchase_order_item_id" UUID,
    "variant_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "line_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "note" TEXT,

    CONSTRAINT "procurement_document_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "procurement_document_files" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "document_id" UUID NOT NULL,
    "version_no" INTEGER NOT NULL,
    "storage_ref" VARCHAR(255) NOT NULL,
    "original_name" VARCHAR(255) NOT NULL,
    "mime_type" VARCHAR(100) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "uploaded_by_user_id" UUID,
    "uploaded_by_party" VARCHAR(20) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "procurement_document_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "procurement_document_shares" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "document_id" UUID NOT NULL,
    "channel" VARCHAR(20) NOT NULL,
    "recipient_party" VARCHAR(20) NOT NULL,
    "recipient_email" VARCHAR(150),
    "status" VARCHAR(20) NOT NULL,
    "message_id" VARCHAR(255),
    "error_message" TEXT,
    "shared_by_user_id" UUID,
    "shared_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "delivered_at" TIMESTAMPTZ(6),
    "acknowledged_at" TIMESTAMPTZ(6),
    "acknowledged_by_user_id" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "procurement_document_shares_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "procurement_reconciliations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "purchase_order_id" UUID NOT NULL,
    "result_status" VARCHAR(30) NOT NULL,
    "exception_approved" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "snapshot" JSONB NOT NULL DEFAULT '{}',
    "completed_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "procurement_reconciliations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_po_supplier_responses_po" ON "purchase_order_supplier_responses"("purchase_order_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "procurement_documents_document_number_key" ON "procurement_documents"("document_number");

-- CreateIndex
CREATE INDEX "idx_procurement_documents_po_type" ON "procurement_documents"("purchase_order_id", "document_type");

-- CreateIndex
CREATE INDEX "idx_procurement_documents_supplier_number" ON "procurement_documents"("supplier_id", "document_type", "external_number");

-- CreateIndex
CREATE INDEX "idx_procurement_document_lines_doc" ON "procurement_document_lines"("document_id");

-- CreateIndex
CREATE UNIQUE INDEX "procurement_document_files_document_id_version_no_key" ON "procurement_document_files"("document_id", "version_no");

-- CreateIndex
CREATE INDEX "idx_procurement_document_shares_doc" ON "procurement_document_shares"("document_id", "recipient_party");

-- CreateIndex
CREATE INDEX "idx_procurement_reconciliations_po" ON "procurement_reconciliations"("purchase_order_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "goods_receipts_idempotency_key_key" ON "goods_receipts"("idempotency_key");

-- CreateIndex
CREATE INDEX "idx_goods_receipts_delivery_status" ON "goods_receipts"("supplier_delivery_invoice_id", "status");

-- AddForeignKey
ALTER TABLE "purchase_order_supplier_responses" ADD CONSTRAINT "purchase_order_supplier_responses_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "purchase_order_supplier_responses" ADD CONSTRAINT "purchase_order_supplier_responses_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "procurement_documents" ADD CONSTRAINT "procurement_documents_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "procurement_documents" ADD CONSTRAINT "procurement_documents_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "procurement_documents" ADD CONSTRAINT "procurement_documents_supplier_delivery_invoice_id_fkey" FOREIGN KEY ("supplier_delivery_invoice_id") REFERENCES "supplier_delivery_invoices"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "procurement_documents" ADD CONSTRAINT "procurement_documents_goods_receipt_id_fkey" FOREIGN KEY ("goods_receipt_id") REFERENCES "goods_receipts"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "procurement_documents" ADD CONSTRAINT "procurement_documents_shortage_report_id_fkey" FOREIGN KEY ("shortage_report_id") REFERENCES "supplier_shortage_reports"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "procurement_documents" ADD CONSTRAINT "procurement_documents_supersedes_document_id_fkey" FOREIGN KEY ("supersedes_document_id") REFERENCES "procurement_documents"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "procurement_document_lines" ADD CONSTRAINT "procurement_document_lines_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "procurement_documents"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "procurement_document_lines" ADD CONSTRAINT "procurement_document_lines_purchase_order_item_id_fkey" FOREIGN KEY ("purchase_order_item_id") REFERENCES "purchase_order_items"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "procurement_document_lines" ADD CONSTRAINT "procurement_document_lines_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "book_variants"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "procurement_document_files" ADD CONSTRAINT "procurement_document_files_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "procurement_documents"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "procurement_document_shares" ADD CONSTRAINT "procurement_document_shares_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "procurement_documents"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "procurement_reconciliations" ADD CONSTRAINT "procurement_reconciliations_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE NO ACTION;


-- Duplicate supplier invoice guard: the same supplier cannot have two live (non-cancelled)
-- invoices with the same series + number. Cancelled invoices keep their number for history.
CREATE UNIQUE INDEX "uq_procurement_documents_live_invoice_number"
  ON "procurement_documents" ("supplier_id", (COALESCE("invoice_series", '')), (LOWER("external_number")))
  WHERE "document_type" IN ('VAT_INVOICE', 'SALES_INVOICE', 'PROFORMA_INVOICE')
    AND "external_number" IS NOT NULL
    AND "status" <> 'CANCELLED';
