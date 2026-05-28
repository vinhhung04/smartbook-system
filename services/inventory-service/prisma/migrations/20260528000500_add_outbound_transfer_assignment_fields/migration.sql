-- outbound_orders: tach rieng nhan vien phu trach outbound khoi processed_by_user_id (la nguoi pick)
ALTER TABLE outbound_orders
  ADD COLUMN outbound_assigned_user_id UUID,
  ADD COLUMN outbound_assigned_at TIMESTAMPTZ,
  ADD COLUMN outbound_assigned_by_user_id UUID;

-- transfer_orders: tach rieng nhan vien phu trach outbound khoi shipped_by_user_id (la nguoi pick)
ALTER TABLE transfer_orders
  ADD COLUMN outbound_assigned_user_id UUID,
  ADD COLUMN outbound_assigned_at TIMESTAMPTZ,
  ADD COLUMN outbound_assigned_by_user_id UUID;

-- transfer_orders.received_by_user_id da co san, dung cho transfer receiving assignment
