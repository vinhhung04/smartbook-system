CREATE TABLE transfer_discrepancies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), transfer_order_id uuid NOT NULL UNIQUE REFERENCES transfer_orders(id),
  goods_receipt_id uuid NOT NULL REFERENCES goods_receipts(id), from_warehouse_id uuid NOT NULL REFERENCES warehouses(id),
  to_warehouse_id uuid NOT NULL REFERENCES warehouses(id), status varchar(20) NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','RESOLVED')),
  created_by_user_id uuid, resolved_by_user_id uuid, created_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz
);
CREATE INDEX idx_transfer_discrepancies_destination_status ON transfer_discrepancies(to_warehouse_id,status);
CREATE TABLE transfer_discrepancy_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), discrepancy_id uuid NOT NULL REFERENCES transfer_discrepancies(id),
  transfer_order_item_id uuid NOT NULL UNIQUE REFERENCES transfer_order_items(id), variant_id uuid NOT NULL REFERENCES book_variants(id),
  shipped_qty integer NOT NULL, delivered_qty integer NOT NULL, accepted_qty integer NOT NULL,
  damaged_qty integer NOT NULL, rejected_qty integer NOT NULL, missing_qty integer NOT NULL,
  remaining_damaged_qty integer NOT NULL, remaining_rejected_qty integer NOT NULL, remaining_missing_qty integer NOT NULL,
  CHECK(LEAST(shipped_qty,delivered_qty,accepted_qty,damaged_qty,rejected_qty,missing_qty,remaining_damaged_qty,remaining_rejected_qty,remaining_missing_qty)>=0),
  CHECK(delivered_qty=accepted_qty+damaged_qty+rejected_qty),
  CHECK(remaining_damaged_qty<=damaged_qty AND remaining_rejected_qty<=rejected_qty AND remaining_missing_qty<=missing_qty)
);
CREATE INDEX idx_transfer_discrepancy_items_case ON transfer_discrepancy_items(discrepancy_id);
CREATE TABLE transfer_discrepancy_resolutions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), discrepancy_id uuid NOT NULL REFERENCES transfer_discrepancies(id),
  discrepancy_item_id uuid NOT NULL REFERENCES transfer_discrepancy_items(id), bucket varchar(20) NOT NULL CHECK(bucket IN ('MISSING','DAMAGED','REJECTED')),
  action varchar(30) NOT NULL CHECK(action IN ('FOUND','REDELIVERED','RETURN_TO_SOURCE','WRITE_OFF')), quantity integer NOT NULL CHECK(quantity>0),
  reason text NOT NULL, evidence_reference text NOT NULL, idempotency_key varchar(100) NOT NULL UNIQUE,
  redelivery_transfer_id uuid REFERENCES transfer_orders(id), actor_user_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_transfer_resolution_case ON transfer_discrepancy_resolutions(discrepancy_id);
CREATE INDEX idx_transfer_resolution_replacement ON transfer_discrepancy_resolutions(redelivery_transfer_id);
