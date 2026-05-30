-- Allow DRAFT goods_receipts to be created without an assigned receiver.
-- Receiver is assigned when destination staff claims the transfer receiving task.
ALTER TABLE goods_receipts ALTER COLUMN received_by_user_id DROP NOT NULL;
