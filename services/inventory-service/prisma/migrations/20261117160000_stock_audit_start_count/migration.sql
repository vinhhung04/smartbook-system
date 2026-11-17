ALTER TABLE stock_audit_location_sessions ALTER COLUMN started_at DROP NOT NULL, ALTER COLUMN started_at DROP DEFAULT;

CREATE OR REPLACE FUNCTION enforce_stock_audit_location_freeze() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_location uuid;
BEGIN
  IF TG_OP = 'UPDATE' AND ROW(OLD.on_hand_qty,OLD.available_qty,OLD.reserved_qty,OLD.borrowed_qty,OLD.damaged_qty,OLD.in_transit_qty,OLD.location_id)
    IS NOT DISTINCT FROM ROW(NEW.on_hand_qty,NEW.available_qty,NEW.reserved_qty,NEW.borrowed_qty,NEW.damaged_qty,NEW.in_transit_qty,NEW.location_id) THEN
    RETURN NEW;
  END IF;
  -- Use the same lock as count-session creation. The count transaction reads
  -- committed balances after acquiring it, without waiting on balance row locks.
  FOR target_location IN SELECT DISTINCT x FROM unnest(ARRAY[
    CASE WHEN TG_OP <> 'INSERT' THEN OLD.location_id END,
    CASE WHEN TG_OP <> 'DELETE' THEN NEW.location_id END
  ]) x WHERE x IS NOT NULL ORDER BY x LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('stock-audit-location:' || target_location::text,0));
    IF EXISTS (SELECT 1 FROM stock_audit_location_sessions s WHERE s.location_id=target_location AND s.released_at IS NULL AND s.started_at IS NOT NULL AND s.counting_completed_at IS NULL) THEN
      RAISE EXCEPTION 'STOCK_AUDIT_LOCATION_FROZEN:%', target_location USING ERRCODE='P0001';
    END IF;
  END LOOP;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
