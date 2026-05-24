CREATE TABLE IF NOT EXISTS "outbound_reference_sequences" (
  "reference_type" "OutboundReferenceType" PRIMARY KEY,
  "last_number" INTEGER NOT NULL DEFAULT 0,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);
