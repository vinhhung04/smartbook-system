-- This dev database's _prisma_migrations history recorded
-- 20260728170000_add_packing_evidence_ai_verification as applied, but the
-- columns it should have added are missing from the live table (schema drift,
-- likely from a raw SQL seed/restore run after that migration). Re-add them
-- idempotently so this environment matches prisma/schema.prisma; a no-op on
-- any environment where the original migration already applied correctly.
ALTER TABLE "packing_camera_evidence"
  ADD COLUMN IF NOT EXISTS "ai_verification_result" JSONB,
  ADD COLUMN IF NOT EXISTS "ai_verification_status" VARCHAR(20);
