-- CreateEnum
CREATE TYPE "OutboundReferenceType" AS ENUM ('TRANSFER_TO_STORE', 'WAREHOUSE_TRANSFER', 'RETURN_TO_SUPPLIER', 'SALES_ORDER', 'INTERNAL_REQUEST', 'ISSUE_REQUEST', 'RESERVATION', 'LOAN_REQUEST', 'MAINTENANCE', 'INVENTORY_ADJUSTMENT', 'DAMAGED_RETURN', 'PROMOTION', 'OTHER');

-- CreateTable
CREATE TABLE "authors" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "full_name" VARCHAR(150) NOT NULL,
    "sort_name" VARCHAR(150),
    "biography" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "authors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "book_authors" (
    "book_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "author_order" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "book_authors_pkey" PRIMARY KEY ("book_id","author_id")
);

-- CreateTable
CREATE TABLE "book_categories" (
    "book_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,

    CONSTRAINT "book_categories_pkey" PRIMARY KEY ("book_id","category_id")
);

-- CreateTable
CREATE TABLE "book_images" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "book_id" UUID,
    "variant_id" UUID,
    "image_url" TEXT NOT NULL,
    "image_type" VARCHAR(20) NOT NULL DEFAULT 'COVER',
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "book_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "book_variants" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "book_id" UUID NOT NULL,
    "sku" VARCHAR(50) NOT NULL,
    "isbn13" VARCHAR(20),
    "isbn10" VARCHAR(20),
    "internal_barcode" VARCHAR(50),
    "cover_type" VARCHAR(20) NOT NULL DEFAULT 'PAPERBACK',
    "language_code" VARCHAR(10) NOT NULL DEFAULT 'vi',
    "publish_year" INTEGER,
    "condition_grade" VARCHAR(20) NOT NULL DEFAULT 'NEW',
    "unit_cost" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "list_price" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "replacement_cost" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "is_borrowable" BOOLEAN NOT NULL DEFAULT true,
    "is_sellable" BOOLEAN NOT NULL DEFAULT false,
    "is_track_by_unit" BOOLEAN NOT NULL DEFAULT false,
    "cover_image_url" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "book_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "books" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "book_code" VARCHAR(30),
    "title" VARCHAR(255) NOT NULL,
    "subtitle" VARCHAR(255),
    "description" TEXT,
    "publisher_id" UUID,
    "edition" VARCHAR(50),
    "published_date" DATE,
    "page_count" INTEGER,
    "country_of_origin" VARCHAR(100),
    "default_language" VARCHAR(10),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "books_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(120) NOT NULL,
    "slug" VARCHAR(150) NOT NULL,
    "parent_id" UUID,
    "description" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goods_receipt_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "goods_receipt_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "location_id" UUID,
    "quantity" INTEGER NOT NULL,
    "actual_quantity" INTEGER,
    "unit_cost" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "condition_grade" VARCHAR(20) NOT NULL DEFAULT 'NEW',
    "note" TEXT,

    CONSTRAINT "goods_receipt_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goods_receipts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "receipt_number" VARCHAR(40) NOT NULL,
    "purchase_order_id" UUID,
    "warehouse_id" UUID NOT NULL,
    "source_type" VARCHAR(20) NOT NULL DEFAULT 'PURCHASE_ORDER',
    "source_reference_id" UUID,
    "supplier_delivery_invoice_id" UUID,
    "status" VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    "received_by_user_id" UUID,
    "putaway_assignee_user_id" UUID,
    "received_at" TIMESTAMPTZ(6),
    "cancelled_at" TIMESTAMPTZ(6),
    "cancelled_by_user_id" UUID,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "goods_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_inbox" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "source_service" VARCHAR(50) NOT NULL,
    "event_id" UUID NOT NULL,
    "event_type" VARCHAR(100) NOT NULL,
    "payload" JSONB NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'RECEIVED',
    "error_message" TEXT,
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(6),

    CONSTRAINT "integration_inbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_outbox" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "aggregate_type" VARCHAR(100) NOT NULL,
    "aggregate_id" UUID,
    "event_type" VARCHAR(100) NOT NULL,
    "payload" JSONB NOT NULL,
    "headers" JSONB NOT NULL DEFAULT '{}',
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMPTZ(6),

    CONSTRAINT "integration_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_audit_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "actor_user_id" UUID,
    "action_name" VARCHAR(100) NOT NULL,
    "entity_type" VARCHAR(50) NOT NULL,
    "entity_id" UUID,
    "before_data" JSONB,
    "after_data" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_units" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "variant_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "home_location_id" UUID,
    "current_location_id" UUID,
    "unit_barcode" VARCHAR(100) NOT NULL,
    "acquisition_reference" TEXT,
    "acquisition_cost" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "condition_grade" VARCHAR(20) NOT NULL DEFAULT 'NEW',
    "status" VARCHAR(20) NOT NULL DEFAULT 'AVAILABLE',
    "last_seen_at" TIMESTAMPTZ(6),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "locations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "warehouse_id" UUID NOT NULL,
    "parent_location_id" UUID,
    "location_code" VARCHAR(60) NOT NULL,
    "location_type" VARCHAR(20) NOT NULL DEFAULT 'BIN',
    "zone" VARCHAR(50),
    "aisle" VARCHAR(50),
    "shelf" VARCHAR(50),
    "bin" VARCHAR(50),
    "barcode" VARCHAR(100),
    "capacity_qty" INTEGER,
    "available" INTEGER NOT NULL DEFAULT 0,
    "is_pickable" BOOLEAN NOT NULL DEFAULT true,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbound_order_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "outbound_order_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "source_location_id" UUID,
    "quantity" INTEGER NOT NULL,
    "processed_qty" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,

    CONSTRAINT "outbound_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbound_orders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "outbound_number" VARCHAR(40) NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "outbound_type" VARCHAR(30) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    "requested_by_user_id" UUID NOT NULL,
    "approved_by_user_id" UUID,
    "processed_by_user_id" UUID,
    "outbound_assigned_user_id" UUID,
    "outbound_assigned_at" TIMESTAMPTZ(6),
    "outbound_assigned_by_user_id" UUID,
    "reference_type" "OutboundReferenceType" NOT NULL DEFAULT 'OTHER',
    "external_reference" TEXT,
    "requested_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),
    "note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbound_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbound_reference_sequences" (
    "reference_type" "OutboundReferenceType" NOT NULL,
    "last_number" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbound_reference_sequences_pkey" PRIMARY KEY ("reference_type")
);

-- CreateTable
CREATE TABLE "picking_task_sequences" (
    "sequence_type" VARCHAR(20) NOT NULL,
    "last_number" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "picking_task_sequences_pkey" PRIMARY KEY ("sequence_type")
);

-- CreateTable
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

    CONSTRAINT "picking_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
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

    CONSTRAINT "picking_task_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
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

    CONSTRAINT "packing_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
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

    CONSTRAINT "packing_task_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "packing_scan_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "packing_task_id" UUID NOT NULL,
    "packing_task_item_id" UUID,
    "scanned_code" VARCHAR(150) NOT NULL,
    "scan_result" VARCHAR(20) NOT NULL,
    "scanned_by_user_id" UUID NOT NULL,
    "scanned_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "packing_scan_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "packing_camera_evidence" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "packing_task_id" UUID NOT NULL,
    "evidence_type" VARCHAR(20) NOT NULL,
    "storage_ref" TEXT NOT NULL,
    "captured_by_user_id" UUID NOT NULL,
    "captured_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,

    CONSTRAINT "packing_camera_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "publishers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(30),
    "name" VARCHAR(150) NOT NULL,
    "phone" VARCHAR(30),
    "email" VARCHAR(150),
    "website" TEXT,
    "address" TEXT,
    "country" VARCHAR(100),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "publishers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "purchase_order_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "ordered_qty" INTEGER NOT NULL,
    "received_qty" INTEGER NOT NULL DEFAULT 0,
    "unit_cost" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "note" TEXT,

    CONSTRAINT "purchase_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_orders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "po_number" VARCHAR(40) NOT NULL,
    "supplier_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "status" VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
    "ordered_by_user_id" UUID NOT NULL,
    "approved_by_user_id" UUID,
    "order_date" DATE NOT NULL DEFAULT CURRENT_DATE,
    "expected_date" DATE,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_alerts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "warehouse_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "alert_type" VARCHAR(20) NOT NULL,
    "alert_level" VARCHAR(20) NOT NULL,
    "threshold_value" DECIMAL(12,2),
    "current_value" DECIMAL(12,2),
    "status" VARCHAR(20) NOT NULL DEFAULT 'OPEN',
    "first_triggered_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledged_by_user_id" UUID,
    "acknowledged_at" TIMESTAMPTZ(6),
    "resolved_at" TIMESTAMPTZ(6),
    "payload" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "stock_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_audit_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "stock_audit_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "expected_qty" INTEGER NOT NULL DEFAULT 0,
    "counted_qty" INTEGER,
    "variance_qty" INTEGER,
    "adjustment_posted" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,

    CONSTRAINT "stock_audit_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_audits" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "audit_number" VARCHAR(40) NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    "created_by_user_id" UUID NOT NULL,
    "reviewed_by_user_id" UUID,
    "started_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_audits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_balances" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "warehouse_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "on_hand_qty" INTEGER NOT NULL DEFAULT 0,
    "available_qty" INTEGER NOT NULL DEFAULT 0,
    "reserved_qty" INTEGER NOT NULL DEFAULT 0,
    "borrowed_qty" INTEGER NOT NULL DEFAULT 0,
    "damaged_qty" INTEGER NOT NULL DEFAULT 0,
    "in_transit_qty" INTEGER NOT NULL DEFAULT 0,
    "safety_stock_qty" INTEGER NOT NULL DEFAULT 0,
    "reorder_point" INTEGER NOT NULL DEFAULT 0,
    "status" VARCHAR(20) NOT NULL DEFAULT 'AVAILABLE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "last_movement_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_balances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "movement_number" VARCHAR(40) NOT NULL,
    "movement_type" VARCHAR(20) NOT NULL,
    "movement_status" VARCHAR(20) NOT NULL DEFAULT 'POSTED',
    "warehouse_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "inventory_unit_id" UUID,
    "from_location_id" UUID,
    "to_location_id" UUID,
    "quantity" INTEGER NOT NULL,
    "unit_cost" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "reason_code" TEXT,
    "source_service" VARCHAR(30) NOT NULL,
    "reference_type" VARCHAR(50),
    "reference_id" UUID,
    "correlation_id" UUID,
    "idempotency_key" VARCHAR(100),
    "created_by_user_id" UUID,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "reverted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_reservations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "reservation_code" VARCHAR(40) NOT NULL,
    "variant_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "location_id" UUID,
    "customer_id" UUID,
    "source_service" VARCHAR(20) NOT NULL,
    "source_reference_id" UUID,
    "quantity" INTEGER NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_variants" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "supplier_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "supplier_sku" VARCHAR(50),
    "lead_time_days" INTEGER,
    "default_cost" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "min_order_qty" INTEGER NOT NULL DEFAULT 1,
    "is_preferred" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suppliers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(30),
    "name" VARCHAR(150) NOT NULL,
    "contact_name" VARCHAR(150),
    "phone" VARCHAR(30),
    "email" VARCHAR(150),
    "address" TEXT,
    "tax_code" VARCHAR(50),
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_order_dispatches" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "purchase_order_id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "dispatch_number" VARCHAR(40) NOT NULL,
    "channel" VARCHAR(20) NOT NULL DEFAULT 'MOCK',
    "status" VARCHAR(20) NOT NULL DEFAULT 'SENT',
    "sent_to_email" VARCHAR(150),
    "sent_at" TIMESTAMPTZ(6),
    "acknowledged_at" TIMESTAMPTZ(6),
    "payload" JSONB NOT NULL DEFAULT '{}',
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_order_dispatches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_delivery_invoices" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "purchase_order_id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "invoice_number" VARCHAR(80) NOT NULL,
    "delivery_number" VARCHAR(80),
    "invoice_date" DATE,
    "expected_delivery_date" DATE,
    "status" VARCHAR(30) NOT NULL DEFAULT 'SUBMITTED',
    "supplier_note" TEXT,
    "uploaded_file_name" TEXT,
    "uploaded_file_type" VARCHAR(50),
    "raw_payload" JSONB NOT NULL DEFAULT '{}',
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_delivery_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_delivery_invoice_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "invoice_id" UUID NOT NULL,
    "purchase_order_item_id" UUID,
    "variant_id" UUID NOT NULL,
    "invoiced_qty" INTEGER NOT NULL,
    "delivered_qty" INTEGER,
    "accepted_qty" INTEGER NOT NULL DEFAULT 0,
    "unit_cost" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_delivery_invoice_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_shortage_reports" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "purchase_order_id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "goods_receipt_id" UUID,
    "invoice_id" UUID,
    "status" VARCHAR(30) NOT NULL DEFAULT 'OPEN',
    "reason" TEXT,
    "created_by_user_id" UUID NOT NULL,
    "sent_at" TIMESTAMPTZ(6),
    "resolved_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_shortage_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_shortage_report_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "shortage_report_id" UUID NOT NULL,
    "purchase_order_item_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "ordered_qty" INTEGER NOT NULL,
    "received_qty" INTEGER NOT NULL,
    "shortage_qty" INTEGER NOT NULL,
    "note" TEXT,

    CONSTRAINT "supplier_shortage_report_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transfer_order_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "transfer_order_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "from_location_id" UUID,
    "to_location_id" UUID,
    "quantity" INTEGER NOT NULL,
    "shipped_qty" INTEGER NOT NULL DEFAULT 0,
    "received_qty" INTEGER NOT NULL DEFAULT 0,
    "unit_cost" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "note" TEXT,

    CONSTRAINT "transfer_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transfer_orders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "transfer_number" VARCHAR(40) NOT NULL,
    "from_warehouse_id" UUID NOT NULL,
    "to_warehouse_id" UUID NOT NULL,
    "status" VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
    "requested_by_user_id" UUID NOT NULL,
    "approved_by_user_id" UUID,
    "shipped_by_user_id" UUID,
    "received_by_user_id" UUID,
    "outbound_assigned_user_id" UUID,
    "outbound_assigned_at" TIMESTAMPTZ(6),
    "outbound_assigned_by_user_id" UUID,
    "requested_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "shipped_at" TIMESTAMPTZ(6),
    "received_at" TIMESTAMPTZ(6),
    "note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transfer_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warehouse_settings" (
    "warehouse_id" UUID NOT NULL,
    "reservation_hold_hours" INTEGER NOT NULL DEFAULT 24,
    "allow_negative_stock" BOOLEAN NOT NULL DEFAULT false,
    "default_low_stock_threshold" INTEGER NOT NULL DEFAULT 5,
    "enable_cycle_count" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "warehouse_settings_pkey" PRIMARY KEY ("warehouse_id")
);

-- CreateTable
CREATE TABLE "warehouses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(30) NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "warehouse_type" VARCHAR(20) NOT NULL DEFAULT 'WAREHOUSE',
    "address_line1" TEXT,
    "address_line2" TEXT,
    "ward" VARCHAR(120),
    "district" VARCHAR(120),
    "province" VARCHAR(120),
    "country" VARCHAR(120) NOT NULL DEFAULT 'Vietnam',
    "manager_user_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "warehouses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "smart_receiving_drafts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "warehouse_id" UUID NOT NULL,
    "supplier_name" TEXT,
    "invoice_number" TEXT,
    "invoice_date" DATE,
    "raw_extraction" JSONB NOT NULL DEFAULT '{}',
    "source_file_name" TEXT,
    "source_file_type" VARCHAR(20),
    "status" VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "goods_receipt_id" UUID,

    CONSTRAINT "smart_receiving_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "smart_receiving_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "smart_receiving_draft_id" UUID NOT NULL,
    "extracted_title" TEXT,
    "extracted_isbn" TEXT,
    "extracted_quantity" INTEGER NOT NULL,
    "extracted_unit_price" DECIMAL(12,2) DEFAULT 0,
    "matched_variant_id" UUID,
    "match_strategy" VARCHAR(30),
    "match_confidence" DOUBLE PRECISION,
    "match_status" VARCHAR(30) NOT NULL DEFAULT 'UNMATCHED',
    "corrected_variant_id" UUID,
    "corrected_quantity" INTEGER,
    "is_user_corrected" BOOLEAN NOT NULL DEFAULT false,
    "goods_receipt_item_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "smart_receiving_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
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

-- CreateTable
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
    "assigned_to_user_id" UUID,
    "assigned_at" TIMESTAMPTZ(6),
    "assigned_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "warehouse_exception_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_tasks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "title" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "task_type" VARCHAR(30) NOT NULL DEFAULT 'GENERAL',
    "priority" VARCHAR(20) NOT NULL DEFAULT 'MEDIUM',
    "status" VARCHAR(20) NOT NULL DEFAULT 'OPEN',
    "assignee_user_id" UUID NOT NULL,
    "assigned_by_user_id" UUID NOT NULL,
    "warehouse_id" UUID,
    "related_entity_type" VARCHAR(50),
    "related_entity_id" UUID,
    "due_date" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "authors_full_name_key" ON "authors"("full_name");

-- CreateIndex
CREATE INDEX "idx_authors_full_name_trgm" ON "authors" USING GIN ("full_name" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "book_variants_sku_key" ON "book_variants"("sku");

-- CreateIndex
CREATE UNIQUE INDEX "book_variants_isbn13_key" ON "book_variants"("isbn13");

-- CreateIndex
CREATE UNIQUE INDEX "book_variants_isbn10_key" ON "book_variants"("isbn10");

-- CreateIndex
CREATE UNIQUE INDEX "book_variants_internal_barcode_key" ON "book_variants"("internal_barcode");

-- CreateIndex
CREATE INDEX "idx_book_variants_book_id" ON "book_variants"("book_id");

-- CreateIndex
CREATE INDEX "idx_book_variants_isbn13" ON "book_variants"("isbn13");

-- CreateIndex
CREATE UNIQUE INDEX "books_book_code_key" ON "books"("book_code");

-- CreateIndex
CREATE INDEX "idx_books_title_trgm" ON "books" USING GIN ("title" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "categories_slug_key" ON "categories"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "categories_parent_id_name_key" ON "categories"("parent_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "goods_receipts_receipt_number_key" ON "goods_receipts"("receipt_number");

-- CreateIndex
CREATE INDEX "idx_goods_receipts_status" ON "goods_receipts"("status", "received_at");

-- CreateIndex
CREATE INDEX "idx_inventory_inbox_status" ON "integration_inbox"("status", "received_at");

-- CreateIndex
CREATE UNIQUE INDEX "integration_inbox_source_service_event_id_key" ON "integration_inbox"("source_service", "event_id");

-- CreateIndex
CREATE INDEX "idx_inventory_outbox_status" ON "integration_outbox"("status", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_units_unit_barcode_key" ON "inventory_units"("unit_barcode");

-- CreateIndex
CREATE INDEX "idx_inventory_units_current_location_id" ON "inventory_units"("current_location_id");

-- CreateIndex
CREATE INDEX "idx_inventory_units_variant_status" ON "inventory_units"("variant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "locations_barcode_key" ON "locations"("barcode");

-- CreateIndex
CREATE INDEX "idx_locations_warehouse_id" ON "locations"("warehouse_id");

-- CreateIndex
CREATE UNIQUE INDEX "locations_warehouse_id_location_code_key" ON "locations"("warehouse_id", "location_code");

-- CreateIndex
CREATE UNIQUE INDEX "locations_warehouse_id_zone_aisle_shelf_bin_key" ON "locations"("warehouse_id", "zone", "aisle", "shelf", "bin");

-- CreateIndex
CREATE UNIQUE INDEX "outbound_orders_outbound_number_key" ON "outbound_orders"("outbound_number");

-- CreateIndex
CREATE INDEX "idx_outbound_orders_status" ON "outbound_orders"("status", "requested_at");

-- CreateIndex
CREATE UNIQUE INDEX "picking_tasks_task_number_key" ON "picking_tasks"("task_number");

-- CreateIndex
CREATE INDEX "idx_picking_tasks_root_order" ON "picking_tasks"("root_order_id");

-- CreateIndex
CREATE INDEX "idx_picking_tasks_status_wh" ON "picking_tasks"("status", "warehouse_id");

-- CreateIndex
CREATE INDEX "idx_picking_tasks_parent" ON "picking_tasks"("parent_id");

-- CreateIndex
CREATE INDEX "idx_pti_task" ON "picking_task_items"("picking_task_id");

-- CreateIndex
CREATE INDEX "idx_pti_ooi" ON "picking_task_items"("outbound_order_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "packing_tasks_task_number_key" ON "packing_tasks"("task_number");

-- CreateIndex
CREATE INDEX "idx_packing_tasks_root_order" ON "packing_tasks"("root_order_id");

-- CreateIndex
CREATE INDEX "idx_packing_tasks_status_wh" ON "packing_tasks"("status", "warehouse_id");

-- CreateIndex
CREATE INDEX "idx_pkti_task" ON "packing_task_items"("packing_task_id");

-- CreateIndex
CREATE INDEX "idx_pkti_ooi" ON "packing_task_items"("outbound_order_item_id");

-- CreateIndex
CREATE INDEX "idx_pkse_task" ON "packing_scan_events"("packing_task_id");

-- CreateIndex
CREATE INDEX "idx_pkce_task" ON "packing_camera_evidence"("packing_task_id");

-- CreateIndex
CREATE UNIQUE INDEX "publishers_code_key" ON "publishers"("code");

-- CreateIndex
CREATE UNIQUE INDEX "publishers_name_key" ON "publishers"("name");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_order_items_purchase_order_id_variant_id_key" ON "purchase_order_items"("purchase_order_id", "variant_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_po_number_key" ON "purchase_orders"("po_number");

-- CreateIndex
CREATE INDEX "idx_purchase_orders_status" ON "purchase_orders"("status", "order_date");

-- CreateIndex
CREATE INDEX "idx_stock_alerts_status" ON "stock_alerts"("status", "alert_type");

-- CreateIndex
CREATE UNIQUE INDEX "stock_audit_lines_stock_audit_id_variant_id_location_id_key" ON "stock_audit_lines"("stock_audit_id", "variant_id", "location_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_audits_audit_number_key" ON "stock_audits"("audit_number");

-- CreateIndex
CREATE INDEX "idx_stock_audits_status" ON "stock_audits"("status", "created_at");

-- CreateIndex
CREATE INDEX "idx_stock_balances_variant_location" ON "stock_balances"("variant_id", "location_id");

-- CreateIndex
CREATE INDEX "idx_stock_balances_warehouse_status" ON "stock_balances"("warehouse_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "stock_balances_variant_id_location_id_key" ON "stock_balances"("variant_id", "location_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_movements_movement_number_key" ON "stock_movements"("movement_number");

-- CreateIndex
CREATE UNIQUE INDEX "stock_movements_idempotency_key_key" ON "stock_movements"("idempotency_key");

-- CreateIndex
CREATE INDEX "idx_stock_movements_reference" ON "stock_movements"("reference_type", "reference_id");

-- CreateIndex
CREATE INDEX "idx_stock_movements_variant_created_at" ON "stock_movements"("variant_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "stock_reservations_reservation_code_key" ON "stock_reservations"("reservation_code");

-- CreateIndex
CREATE INDEX "idx_stock_reservations_status_expires" ON "stock_reservations"("status", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_variants_supplier_id_variant_id_key" ON "supplier_variants"("supplier_id", "variant_id");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_code_key" ON "suppliers"("code");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_name_key" ON "suppliers"("name");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_order_dispatches_dispatch_number_key" ON "supplier_order_dispatches"("dispatch_number");

-- CreateIndex
CREATE INDEX "idx_supplier_dispatch_po_status" ON "supplier_order_dispatches"("purchase_order_id", "status");

-- CreateIndex
CREATE INDEX "idx_supplier_invoices_po_status" ON "supplier_delivery_invoices"("purchase_order_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_delivery_invoices_supplier_id_invoice_number_key" ON "supplier_delivery_invoices"("supplier_id", "invoice_number");

-- CreateIndex
CREATE INDEX "idx_supplier_invoice_items_invoice" ON "supplier_delivery_invoice_items"("invoice_id");

-- CreateIndex
CREATE INDEX "idx_supplier_shortages_po_status" ON "supplier_shortage_reports"("purchase_order_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "transfer_orders_transfer_number_key" ON "transfer_orders"("transfer_number");

-- CreateIndex
CREATE INDEX "idx_transfer_orders_status" ON "transfer_orders"("status", "requested_at");

-- CreateIndex
CREATE UNIQUE INDEX "warehouses_code_key" ON "warehouses"("code");

-- CreateIndex
CREATE INDEX "idx_smart_receiving_drafts_status" ON "smart_receiving_drafts"("status", "created_at");

-- CreateIndex
CREATE INDEX "idx_smart_receiving_items_draft_id" ON "smart_receiving_items"("smart_receiving_draft_id");

-- CreateIndex
CREATE INDEX "idx_smart_receiving_items_status" ON "smart_receiving_items"("match_status");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_requests_request_number_key" ON "purchase_requests"("request_number");

-- CreateIndex
CREATE INDEX "idx_purchase_requests_user" ON "purchase_requests"("created_by_user_id");

-- CreateIndex
CREATE INDEX "idx_purchase_requests_status" ON "purchase_requests"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "warehouse_exception_reports_report_number_key" ON "warehouse_exception_reports"("report_number");

-- CreateIndex
CREATE INDEX "idx_warehouse_exception_reports_user" ON "warehouse_exception_reports"("created_by_user_id");

-- CreateIndex
CREATE INDEX "idx_warehouse_exception_reports_assigned" ON "warehouse_exception_reports"("assigned_to_user_id");

-- CreateIndex
CREATE INDEX "idx_warehouse_exception_reports_status" ON "warehouse_exception_reports"("status", "created_at");

-- CreateIndex
CREATE INDEX "idx_staff_tasks_assignee" ON "staff_tasks"("assignee_user_id");

-- CreateIndex
CREATE INDEX "idx_staff_tasks_status" ON "staff_tasks"("status", "created_at");

-- AddForeignKey
ALTER TABLE "book_authors" ADD CONSTRAINT "book_authors_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "authors"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "book_authors" ADD CONSTRAINT "book_authors_book_id_fkey" FOREIGN KEY ("book_id") REFERENCES "books"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "book_categories" ADD CONSTRAINT "book_categories_book_id_fkey" FOREIGN KEY ("book_id") REFERENCES "books"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "book_categories" ADD CONSTRAINT "book_categories_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "book_images" ADD CONSTRAINT "book_images_book_id_fkey" FOREIGN KEY ("book_id") REFERENCES "books"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "book_images" ADD CONSTRAINT "book_images_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "book_variants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "book_variants" ADD CONSTRAINT "book_variants_book_id_fkey" FOREIGN KEY ("book_id") REFERENCES "books"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "books" ADD CONSTRAINT "books_publisher_id_fkey" FOREIGN KEY ("publisher_id") REFERENCES "publishers"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "goods_receipt_items" ADD CONSTRAINT "goods_receipt_items_goods_receipt_id_fkey" FOREIGN KEY ("goods_receipt_id") REFERENCES "goods_receipts"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "goods_receipt_items" ADD CONSTRAINT "goods_receipt_items_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "goods_receipt_items" ADD CONSTRAINT "goods_receipt_items_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "book_variants"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_supplier_delivery_invoice_id_fkey" FOREIGN KEY ("supplier_delivery_invoice_id") REFERENCES "supplier_delivery_invoices"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "inventory_units" ADD CONSTRAINT "inventory_units_current_location_id_fkey" FOREIGN KEY ("current_location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "inventory_units" ADD CONSTRAINT "inventory_units_home_location_id_fkey" FOREIGN KEY ("home_location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "inventory_units" ADD CONSTRAINT "inventory_units_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "book_variants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "inventory_units" ADD CONSTRAINT "inventory_units_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "locations" ADD CONSTRAINT "locations_parent_location_id_fkey" FOREIGN KEY ("parent_location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "locations" ADD CONSTRAINT "locations_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "outbound_order_items" ADD CONSTRAINT "outbound_order_items_outbound_order_id_fkey" FOREIGN KEY ("outbound_order_id") REFERENCES "outbound_orders"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "outbound_order_items" ADD CONSTRAINT "outbound_order_items_source_location_id_fkey" FOREIGN KEY ("source_location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "outbound_order_items" ADD CONSTRAINT "outbound_order_items_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "book_variants"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "outbound_orders" ADD CONSTRAINT "outbound_orders_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "picking_tasks" ADD CONSTRAINT "picking_tasks_root_order_id_fkey" FOREIGN KEY ("root_order_id") REFERENCES "outbound_orders"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "picking_tasks" ADD CONSTRAINT "picking_tasks_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "picking_tasks" ADD CONSTRAINT "picking_tasks_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "picking_tasks"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "picking_task_items" ADD CONSTRAINT "picking_task_items_picking_task_id_fkey" FOREIGN KEY ("picking_task_id") REFERENCES "picking_tasks"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "picking_task_items" ADD CONSTRAINT "picking_task_items_outbound_order_item_id_fkey" FOREIGN KEY ("outbound_order_item_id") REFERENCES "outbound_order_items"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "picking_task_items" ADD CONSTRAINT "picking_task_items_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "book_variants"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "picking_task_items" ADD CONSTRAINT "picking_task_items_source_location_id_fkey" FOREIGN KEY ("source_location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "packing_tasks" ADD CONSTRAINT "packing_tasks_root_order_id_fkey" FOREIGN KEY ("root_order_id") REFERENCES "outbound_orders"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "packing_tasks" ADD CONSTRAINT "packing_tasks_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "packing_task_items" ADD CONSTRAINT "packing_task_items_packing_task_id_fkey" FOREIGN KEY ("packing_task_id") REFERENCES "packing_tasks"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "packing_task_items" ADD CONSTRAINT "packing_task_items_outbound_order_item_id_fkey" FOREIGN KEY ("outbound_order_item_id") REFERENCES "outbound_order_items"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "packing_task_items" ADD CONSTRAINT "packing_task_items_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "book_variants"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "packing_scan_events" ADD CONSTRAINT "packing_scan_events_packing_task_id_fkey" FOREIGN KEY ("packing_task_id") REFERENCES "packing_tasks"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "packing_camera_evidence" ADD CONSTRAINT "packing_camera_evidence_packing_task_id_fkey" FOREIGN KEY ("packing_task_id") REFERENCES "packing_tasks"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "book_variants"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "stock_alerts" ADD CONSTRAINT "stock_alerts_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "book_variants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "stock_alerts" ADD CONSTRAINT "stock_alerts_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "stock_audit_lines" ADD CONSTRAINT "stock_audit_lines_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "stock_audit_lines" ADD CONSTRAINT "stock_audit_lines_stock_audit_id_fkey" FOREIGN KEY ("stock_audit_id") REFERENCES "stock_audits"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "stock_audit_lines" ADD CONSTRAINT "stock_audit_lines_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "book_variants"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "stock_audits" ADD CONSTRAINT "stock_audits_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "book_variants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_from_location_id_fkey" FOREIGN KEY ("from_location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_inventory_unit_id_fkey" FOREIGN KEY ("inventory_unit_id") REFERENCES "inventory_units"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_to_location_id_fkey" FOREIGN KEY ("to_location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "book_variants"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "book_variants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "supplier_variants" ADD CONSTRAINT "supplier_variants_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "supplier_variants" ADD CONSTRAINT "supplier_variants_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "book_variants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "supplier_order_dispatches" ADD CONSTRAINT "supplier_order_dispatches_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "supplier_order_dispatches" ADD CONSTRAINT "supplier_order_dispatches_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "supplier_delivery_invoices" ADD CONSTRAINT "supplier_delivery_invoices_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "supplier_delivery_invoices" ADD CONSTRAINT "supplier_delivery_invoices_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "supplier_delivery_invoice_items" ADD CONSTRAINT "supplier_delivery_invoice_items_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "supplier_delivery_invoices"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "supplier_delivery_invoice_items" ADD CONSTRAINT "supplier_delivery_invoice_items_purchase_order_item_id_fkey" FOREIGN KEY ("purchase_order_item_id") REFERENCES "purchase_order_items"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "supplier_delivery_invoice_items" ADD CONSTRAINT "supplier_delivery_invoice_items_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "book_variants"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "supplier_shortage_reports" ADD CONSTRAINT "supplier_shortage_reports_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "supplier_shortage_reports" ADD CONSTRAINT "supplier_shortage_reports_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "supplier_shortage_reports" ADD CONSTRAINT "supplier_shortage_reports_goods_receipt_id_fkey" FOREIGN KEY ("goods_receipt_id") REFERENCES "goods_receipts"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "supplier_shortage_reports" ADD CONSTRAINT "supplier_shortage_reports_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "supplier_delivery_invoices"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "supplier_shortage_report_items" ADD CONSTRAINT "supplier_shortage_report_items_shortage_report_id_fkey" FOREIGN KEY ("shortage_report_id") REFERENCES "supplier_shortage_reports"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "supplier_shortage_report_items" ADD CONSTRAINT "supplier_shortage_report_items_purchase_order_item_id_fkey" FOREIGN KEY ("purchase_order_item_id") REFERENCES "purchase_order_items"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "supplier_shortage_report_items" ADD CONSTRAINT "supplier_shortage_report_items_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "book_variants"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "transfer_order_items" ADD CONSTRAINT "transfer_order_items_from_location_id_fkey" FOREIGN KEY ("from_location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "transfer_order_items" ADD CONSTRAINT "transfer_order_items_to_location_id_fkey" FOREIGN KEY ("to_location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "transfer_order_items" ADD CONSTRAINT "transfer_order_items_transfer_order_id_fkey" FOREIGN KEY ("transfer_order_id") REFERENCES "transfer_orders"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "transfer_order_items" ADD CONSTRAINT "transfer_order_items_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "book_variants"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "transfer_orders" ADD CONSTRAINT "transfer_orders_from_warehouse_id_fkey" FOREIGN KEY ("from_warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "transfer_orders" ADD CONSTRAINT "transfer_orders_to_warehouse_id_fkey" FOREIGN KEY ("to_warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "warehouse_settings" ADD CONSTRAINT "warehouse_settings_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "smart_receiving_drafts" ADD CONSTRAINT "smart_receiving_drafts_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "smart_receiving_drafts" ADD CONSTRAINT "smart_receiving_drafts_goods_receipt_id_fkey" FOREIGN KEY ("goods_receipt_id") REFERENCES "goods_receipts"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "smart_receiving_items" ADD CONSTRAINT "smart_receiving_items_smart_receiving_draft_id_fkey" FOREIGN KEY ("smart_receiving_draft_id") REFERENCES "smart_receiving_drafts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "smart_receiving_items" ADD CONSTRAINT "smart_receiving_items_matched_variant_id_fkey" FOREIGN KEY ("matched_variant_id") REFERENCES "book_variants"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "smart_receiving_items" ADD CONSTRAINT "smart_receiving_items_corrected_variant_id_fkey" FOREIGN KEY ("corrected_variant_id") REFERENCES "book_variants"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "smart_receiving_items" ADD CONSTRAINT "smart_receiving_items_goods_receipt_item_id_fkey" FOREIGN KEY ("goods_receipt_item_id") REFERENCES "goods_receipt_items"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_book_variant_id_fkey" FOREIGN KEY ("book_variant_id") REFERENCES "book_variants"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "warehouse_exception_reports" ADD CONSTRAINT "warehouse_exception_reports_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "warehouse_exception_reports" ADD CONSTRAINT "warehouse_exception_reports_goods_receipt_id_fkey" FOREIGN KEY ("goods_receipt_id") REFERENCES "goods_receipts"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "warehouse_exception_reports" ADD CONSTRAINT "warehouse_exception_reports_book_variant_id_fkey" FOREIGN KEY ("book_variant_id") REFERENCES "book_variants"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "staff_tasks" ADD CONSTRAINT "staff_tasks_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

