-- Add new outbound status values: PARTIAL_PICKED, REPICKING, READY_TO_SHIP
-- These support tracking the full pick/repick execution chain on the outbound document.

DO $$
BEGIN
  -- Drop existing status check constraint if it exists (it was varchar-based, varies by DB)
  ALTER TABLE outbound_orders
    DROP CONSTRAINT IF EXISTS outbound_orders_status_check;

  -- Re-add with expanded set of allowed values
  ALTER TABLE outbound_orders
    ADD CONSTRAINT outbound_orders_status_check CHECK (
      status IN (
        'DRAFT',
        'PENDING_APPROVAL',
        'APPROVED',
        'PICKING',
        'PARTIAL_PICKED',
        'REPICKING',
        'READY_FOR_OUTBOUND',
        'READY_TO_SHIP',
        'COMPLETED',
        'CANCELLED'
      )
    );
END $$;
