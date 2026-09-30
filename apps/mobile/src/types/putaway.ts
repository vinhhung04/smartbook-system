export type PutawayReceiptSummary = {
  id: string;
  receipt_number: string;
  warehouse_id: string;
  warehouse_code: string | null;
  warehouse_name: string | null;
  status: string;
  putaway_assignee_user_id: string | null;
  line_count: number;
  total_quantity: number;
  putaway_quantity: number;
  remaining_quantity: number;
};

export type PutawayReceiptItem = {
  id: string;
  variant_id: string;
  sku: string | null;
  isbn13: string | null;
  isbn10: string | null;
  barcode: string | null;
  book_title: string;
  quantity: number;
  putaway_quantity: number;
  remaining_quantity: number;
  location_id: string | null;
  location_code: string | null;
};

export type PutawayReceiptDetail = {
  id: string;
  receipt_number: string;
  warehouse_id: string;
  warehouse_code: string | null;
  warehouse_name: string | null;
  status: string;
  total_quantity: number;
  putaway_quantity: number;
  remaining_quantity: number;
  items: PutawayReceiptItem[];
};

export type CompartmentCandidate = {
  id: string;
  location_code: string;
  zone_code: string;
  shelf_code: string;
  current_on_hand: number;
  max_capacity: number;
  remaining_capacity: number;
  mixed_sku_count: number;
  priority_group: number;
};

export type LocationLookupResult = {
  id: string;
  location_code: string;
  location_type: string;
  barcode: string | null;
};

export type TransferResult = {
  message: string;
  data: {
    success: boolean;
    moved_quantity: number;
    allocation_count: number;
  };
};
