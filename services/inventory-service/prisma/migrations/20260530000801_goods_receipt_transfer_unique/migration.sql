-- Prevent duplicate DRAFT/POSTED goods_receipts for the same transfer order at the same warehouse.
-- Applied on top of the FOR UPDATE lock in confirmOutbound for belt-and-suspenders protection.
CREATE UNIQUE INDEX IF NOT EXISTS idx_goods_receipts_transfer_unique
ON goods_receipts (source_reference_id, warehouse_id)
WHERE source_type = 'TRANSFER';
