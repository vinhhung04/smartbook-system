DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OutboundReferenceType') THEN
    CREATE TYPE "OutboundReferenceType" AS ENUM (
      'TRANSFER_TO_STORE',
      'WAREHOUSE_TRANSFER',
      'RETURN_TO_SUPPLIER',
      'SALES_ORDER',
      'INTERNAL_REQUEST',
      'ISSUE_REQUEST',
      'RESERVATION',
      'LOAN_REQUEST',
      'MAINTENANCE',
      'INVENTORY_ADJUSTMENT',
      'DAMAGED_RETURN',
      'PROMOTION',
      'OTHER'
    );
  END IF;
END $$;

ALTER TABLE "outbound_orders"
  ADD COLUMN IF NOT EXISTS "reference_type" "OutboundReferenceType" NOT NULL DEFAULT 'OTHER';

CREATE TABLE IF NOT EXISTS "outbound_reference_sequences" (
  "reference_type" "OutboundReferenceType" PRIMARY KEY,
  "next_number" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW()
);
