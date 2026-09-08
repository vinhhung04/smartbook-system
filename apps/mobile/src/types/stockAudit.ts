export type StockAuditLine = {
  id: string;
  variant_id: string;
  location_id: string;
  location_code: string | null;
  sku: string | null;
  isbn13: string | null;
  title: string | null;
  expected_qty: number;
  counted_qty: number | null;
  variance_qty: number | null;
};

export type StockAuditSummary = {
  id: string;
  audit_number: string;
  status: string;
  warehouse_code: string | null;
  warehouse_name: string | null;
  line_count: number;
  variance_count: number;
};

export type StockAuditDetail = StockAuditSummary & {
  items: StockAuditLine[];
};
