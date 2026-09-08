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

export type ReceivingLocation = {
  id: string;
  location_code: string;
  location_type: string;
  barcode: string | null;
};

export type ReceivingItem = {
  variant_id: string;
  sku: string | null;
  isbn13: string | null;
  isbn10: string | null;
  barcode: string | null;
  book_title: string;
  on_hand_qty: number;
  available_qty: number;
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

export type VariantMatch = {
  variant_id: string;
  sku: string | null;
  isbn13: string | null;
  isbn10: string | null;
  internal_barcode: string | null;
  book_id: string | null;
  book_title: string;
};

export type VariantLookupResult = {
  ambiguous: boolean;
  selected: VariantMatch | null;
  matches: VariantMatch[];
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
