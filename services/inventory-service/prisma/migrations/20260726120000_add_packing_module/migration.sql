-- CreateTable: packing_tasks (packing execution layer, sits between Picking and Outbound)
CREATE TABLE "packing_tasks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "task_number" VARCHAR(40) NOT NULL,
    "root_order_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "assigned_packer_id" UUID,
    "assigned_at" TIMESTAMPTZ(6),
    "assigned_by_user_id" UUID,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "scan_invoice_code" VARCHAR(100),
    "started_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "packing_tasks_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "packing_tasks_status_check" CHECK (status IN ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'))
);

-- CreateTable: packing_task_items (expected vs scanned quantity per line, snapshotted from outbound_order_items.processed_qty)
CREATE TABLE "packing_task_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "packing_task_id" UUID NOT NULL,
    "outbound_order_item_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "expected_qty" INTEGER NOT NULL,
    "scanned_qty" INTEGER NOT NULL DEFAULT 0,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "packing_task_items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "packing_task_items_status_check" CHECK (status IN ('PENDING', 'VERIFIED', 'MISMATCH')),
    CONSTRAINT "packing_task_items_qty_check" CHECK (expected_qty >= 0 AND scanned_qty >= 0)
);

-- CreateTable: packing_scan_events (per-scan audit trail for "Scan Service")
CREATE TABLE "packing_scan_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "packing_task_id" UUID NOT NULL,
    "packing_task_item_id" UUID,
    "scanned_code" VARCHAR(150) NOT NULL,
    "scan_result" VARCHAR(20) NOT NULL,
    "scanned_by_user_id" UUID NOT NULL,
    "scanned_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "packing_scan_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "packing_scan_events_result_check" CHECK (scan_result IN ('MATCH', 'MISMATCH', 'UNKNOWN'))
);

-- CreateTable: packing_camera_evidence (integration point for camera photo/video capture; no AI processing)
CREATE TABLE "packing_camera_evidence" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "packing_task_id" UUID NOT NULL,
    "evidence_type" VARCHAR(20) NOT NULL,
    "storage_ref" TEXT NOT NULL,
    "captured_by_user_id" UUID NOT NULL,
    "captured_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,

    CONSTRAINT "packing_camera_evidence_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "packing_camera_evidence_type_check" CHECK (evidence_type IN ('PHOTO', 'VIDEO', 'LIVE_SNAPSHOT'))
);

-- CreateIndex
CREATE UNIQUE INDEX "packing_tasks_task_number_key" ON "packing_tasks"("task_number");
CREATE INDEX "idx_packing_tasks_root_order" ON "packing_tasks"("root_order_id");
CREATE INDEX "idx_packing_tasks_status_wh" ON "packing_tasks"("status", "warehouse_id");
CREATE INDEX "idx_pkti_task" ON "packing_task_items"("packing_task_id");
CREATE INDEX "idx_pkti_ooi" ON "packing_task_items"("outbound_order_item_id");
CREATE INDEX "idx_pkse_task" ON "packing_scan_events"("packing_task_id");
CREATE INDEX "idx_pkce_task" ON "packing_camera_evidence"("packing_task_id");

-- AddForeignKey
ALTER TABLE "packing_tasks" ADD CONSTRAINT "packing_tasks_root_order_id_fkey" FOREIGN KEY ("root_order_id") REFERENCES "outbound_orders"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "packing_tasks" ADD CONSTRAINT "packing_tasks_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "packing_task_items" ADD CONSTRAINT "packing_task_items_packing_task_id_fkey" FOREIGN KEY ("packing_task_id") REFERENCES "packing_tasks"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "packing_task_items" ADD CONSTRAINT "packing_task_items_outbound_order_item_id_fkey" FOREIGN KEY ("outbound_order_item_id") REFERENCES "outbound_order_items"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "packing_task_items" ADD CONSTRAINT "packing_task_items_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "book_variants"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "packing_scan_events" ADD CONSTRAINT "packing_scan_events_packing_task_id_fkey" FOREIGN KEY ("packing_task_id") REFERENCES "packing_tasks"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "packing_camera_evidence" ADD CONSTRAINT "packing_camera_evidence_packing_task_id_fkey" FOREIGN KEY ("packing_task_id") REFERENCES "packing_tasks"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
