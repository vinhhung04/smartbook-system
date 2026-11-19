-- Existing submitted counts intentionally keep counted_at=NULL: they require a
-- fresh physical count rather than inferring a cutoff from creation timestamps.
ALTER TABLE stock_audit_lines
  ADD COLUMN counted_at timestamptz,
  ADD COLUMN baseline_on_hand_qty integer,
  ADD COLUMN baseline_borrowed_qty integer;

CREATE TABLE stock_audit_location_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_audit_id uuid NOT NULL REFERENCES stock_audits(id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES locations(id),
  started_at timestamptz NOT NULL DEFAULT now(),
  counting_completed_at timestamptz,
  released_at timestamptz
);
CREATE UNIQUE INDEX uq_stock_audit_location_active ON stock_audit_location_sessions(location_id) WHERE released_at IS NULL;
CREATE INDEX idx_stock_audit_location_audit ON stock_audit_location_sessions(stock_audit_id);

CREATE FUNCTION enforce_stock_audit_location_freeze() RETURNS trigger LANGUAGE plpgsql AS $$
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
    IF EXISTS (SELECT 1 FROM stock_audit_location_sessions s WHERE s.location_id=target_location AND s.released_at IS NULL AND s.counting_completed_at IS NULL) THEN
      RAISE EXCEPTION 'STOCK_AUDIT_LOCATION_FROZEN:%', target_location USING ERRCODE='P0001';
    END IF;
  END LOOP;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER stock_balance_audit_freeze BEFORE INSERT OR UPDATE OR DELETE ON stock_balances
  FOR EACH ROW EXECUTE FUNCTION enforce_stock_audit_location_freeze();
