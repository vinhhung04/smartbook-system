-- Invoice-first purchasing flow (POs created from now on):
--   PO lines are typed snapshots that may not exist in the catalog yet (linked to a variant at
--   receiving) -> supplier proposes qty + price -> SmartBook approves -> supplier invoices at the
--   approved price -> SmartBook approves the invoice -> delivery notes against that invoice.
-- Additive only: existing rows keep procurement_flow = 'LEGACY' and behave as before.

ALTER TABLE purchase_orders
  ADD COLUMN procurement_flow VARCHAR(20) NOT NULL DEFAULT 'LEGACY';

-- Snapshot of what SmartBook ordered, never rewritten by later catalog edits.
ALTER TABLE purchase_order_items
  ALTER COLUMN variant_id DROP NOT NULL,
  ADD COLUMN requested_qty INTEGER,
  ADD COLUMN item_title VARCHAR(300),
  ADD COLUMN item_code VARCHAR(80),
  ADD COLUMN item_author VARCHAR(200),
  ADD COLUMN item_publish_year INTEGER,
  ADD CONSTRAINT purchase_order_items_requested_qty_check CHECK (requested_qty IS NULL OR requested_qty > 0),
  -- a line is either a catalog variant or a typed book (title + code)
  ADD CONSTRAINT purchase_order_items_identity_check CHECK (variant_id IS NOT NULL OR (item_title IS NOT NULL AND item_code IS NOT NULL));

-- Invoice / delivery lines of a not-yet-linked PO line carry no variant until receiving links it.
ALTER TABLE supplier_delivery_invoice_items ALTER COLUMN variant_id DROP NOT NULL;
ALTER TABLE procurement_document_lines ALTER COLUMN variant_id DROP NOT NULL;

-- SmartBook approval of a supplier invoice (NULL for legacy documents and non-invoice types).
ALTER TABLE procurement_documents
  ADD COLUMN approval_status VARCHAR(20),
  ADD COLUMN approval_note TEXT,
  ADD COLUMN approval_by_user_id UUID,
  ADD COLUMN approval_at TIMESTAMPTZ(6);

-- A delivery note of the new flow ships against one approved invoice.
ALTER TABLE supplier_delivery_invoices
  ADD COLUMN invoice_document_id UUID REFERENCES procurement_documents(id) ON UPDATE NO ACTION,
  ADD COLUMN tracking_number VARCHAR(80);

CREATE INDEX idx_supplier_delivery_invoices_invoice_document ON supplier_delivery_invoices(invoice_document_id);
CREATE INDEX idx_procurement_documents_approval ON procurement_documents(purchase_order_id, approval_status);
