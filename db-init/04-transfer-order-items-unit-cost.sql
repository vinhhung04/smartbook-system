-- Align transfer_order_items with Prisma schema (unit_cost). Safe for existing DBs.
ALTER TABLE transfer_order_items
ADD COLUMN IF NOT EXISTS unit_cost NUMERIC(12, 2) NOT NULL DEFAULT 0;
