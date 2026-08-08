-- Same schema-drift class as 20260809010000: prisma/schema.prisma declares these
-- columns (present since the initial migration) but they were missing from this
-- environment's live table. Re-add idempotently; a no-op where already present.
ALTER TABLE "stock_audits"
  ADD COLUMN IF NOT EXISTS "assigned_to_user_id" UUID,
  ADD COLUMN IF NOT EXISTS "assigned_at" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "assigned_by_user_id" UUID;
