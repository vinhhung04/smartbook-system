-- Add assignment fields to warehouse_exception_reports
ALTER TABLE "warehouse_exception_reports"
  ADD COLUMN IF NOT EXISTS "assigned_to_user_id" UUID,
  ADD COLUMN IF NOT EXISTS "assigned_at" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "assigned_by_user_id" UUID;

CREATE INDEX IF NOT EXISTS "idx_warehouse_exception_reports_assigned"
  ON "warehouse_exception_reports" ("assigned_to_user_id");

-- Create staff_tasks table
CREATE TABLE IF NOT EXISTS "staff_tasks" (
  "id"                  UUID NOT NULL DEFAULT gen_random_uuid(),
  "title"               VARCHAR(255) NOT NULL,
  "description"         TEXT,
  "task_type"           VARCHAR(30) NOT NULL DEFAULT 'GENERAL',
  "priority"            VARCHAR(20) NOT NULL DEFAULT 'MEDIUM',
  "status"              VARCHAR(20) NOT NULL DEFAULT 'OPEN',
  "assignee_user_id"    UUID NOT NULL,
  "assigned_by_user_id" UUID NOT NULL,
  "warehouse_id"        UUID,
  "related_entity_type" VARCHAR(50),
  "related_entity_id"   UUID,
  "due_date"            TIMESTAMPTZ,
  "completed_at"        TIMESTAMPTZ,
  "created_at"          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "staff_tasks_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "staff_tasks_warehouse_id_fkey"
    FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON UPDATE NO ACTION
);

CREATE INDEX IF NOT EXISTS "idx_staff_tasks_assignee"
  ON "staff_tasks" ("assignee_user_id");

CREATE INDEX IF NOT EXISTS "idx_staff_tasks_status"
  ON "staff_tasks" ("status", "created_at");
