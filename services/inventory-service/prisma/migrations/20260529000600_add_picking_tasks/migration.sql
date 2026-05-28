-- CreateTable: picking_task_sequences (sequence counter for PK-NNNN / RPK-NNNN)
CREATE TABLE "picking_task_sequences" (
    "sequence_type" VARCHAR(20) NOT NULL,
    "last_number" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "picking_task_sequences_pkey" PRIMARY KEY ("sequence_type")
);

INSERT INTO "picking_task_sequences" ("sequence_type") VALUES ('PICK'), ('REPICK');

-- CreateTable: picking_tasks (execution layer for pick/repick)
CREATE TABLE "picking_tasks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "task_number" VARCHAR(40) NOT NULL,
    "root_order_id" UUID NOT NULL,
    "parent_id" UUID,
    "picking_type" VARCHAR(10) NOT NULL DEFAULT 'PICK',
    "warehouse_id" UUID NOT NULL,
    "assigned_picker_id" UUID,
    "assigned_at" TIMESTAMPTZ(6),
    "assigned_by_user_id" UUID,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "started_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "picking_tasks_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "picking_tasks_picking_type_check" CHECK (picking_type IN ('PICK', 'REPICK')),
    CONSTRAINT "picking_tasks_status_check" CHECK (status IN ('PENDING', 'PICKING', 'COMPLETED', 'CANCELLED', 'SHORT_PICK'))
);

-- CreateTable: picking_task_items (line items per picking execution)
CREATE TABLE "picking_task_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "picking_task_id" UUID NOT NULL,
    "outbound_order_item_id" UUID,
    "variant_id" UUID NOT NULL,
    "source_location_id" UUID,
    "requested_qty" INTEGER NOT NULL,
    "picked_qty" INTEGER NOT NULL DEFAULT 0,
    "short_qty" INTEGER NOT NULL DEFAULT 0,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "picking_task_items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "picking_task_items_status_check" CHECK (status IN ('PENDING', 'PICKED', 'SHORT_PICK', 'SKIPPED')),
    CONSTRAINT "picking_task_items_qty_check" CHECK (picked_qty >= 0 AND short_qty >= 0)
);

-- CreateIndex
CREATE UNIQUE INDEX "picking_tasks_task_number_key" ON "picking_tasks"("task_number");
CREATE INDEX "idx_picking_tasks_root_order" ON "picking_tasks"("root_order_id");
CREATE INDEX "idx_picking_tasks_status_wh" ON "picking_tasks"("status", "warehouse_id");
CREATE INDEX "idx_picking_tasks_parent" ON "picking_tasks"("parent_id");
CREATE INDEX "idx_pti_task" ON "picking_task_items"("picking_task_id");
CREATE INDEX "idx_pti_ooi" ON "picking_task_items"("outbound_order_item_id");

-- AddForeignKey
ALTER TABLE "picking_tasks" ADD CONSTRAINT "picking_tasks_root_order_id_fkey" FOREIGN KEY ("root_order_id") REFERENCES "outbound_orders"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "picking_tasks" ADD CONSTRAINT "picking_tasks_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- Self-referential FK for REPICK → parent PICK chain
ALTER TABLE "picking_tasks" ADD CONSTRAINT "picking_tasks_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "picking_tasks"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE "picking_task_items" ADD CONSTRAINT "picking_task_items_picking_task_id_fkey" FOREIGN KEY ("picking_task_id") REFERENCES "picking_tasks"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "picking_task_items" ADD CONSTRAINT "picking_task_items_outbound_order_item_id_fkey" FOREIGN KEY ("outbound_order_item_id") REFERENCES "outbound_order_items"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE "picking_task_items" ADD CONSTRAINT "picking_task_items_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "book_variants"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "picking_task_items" ADD CONSTRAINT "picking_task_items_source_location_id_fkey" FOREIGN KEY ("source_location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
