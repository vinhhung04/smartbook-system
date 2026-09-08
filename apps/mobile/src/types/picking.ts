export type PickingTaskType = 'outbound' | 'transfer';

export type PickingTaskListItem = {
  task_type: PickingTaskType;
  task_id: string;
  order_number: string;
  order_type: string;
  task_class: 'PICK' | 'REPICK';
  repick_sequence: number | null;
  status: string;
  source_warehouse_code: string | null;
  source_warehouse_name: string | null;
  target_warehouse_code: string | null;
  target_warehouse_name: string | null;
  line_count: number;
  total_quantity: number;
  remaining_quantity: number;
  assigned_picker_user_id: string | null;
  requested_at: string;
};

export type AvailableTask = {
  id: string;
  type: 'PICKING' | 'OUTBOUND' | 'TRANSFER_RECEIVING';
  task_type: PickingTaskType;
  title: string;
  status: string;
  is_repick?: boolean;
  parent_order_number?: string | null;
  warehouse: string | null;
  warehouse_id: string | null;
  created_at: string;
  claimable: boolean;
  claim_endpoint: string;
};

export type PickingLine = {
  line_id: string;
  variant_id: string;
  source_location_id: string | null;
  source_location_code: string | null;
  source_location_barcode: string | null;
  sku: string | null;
  isbn13: string | null;
  isbn10: string | null;
  barcode: string | null;
  book_title: string;
  requested_qty: number;
  picked_qty: number;
  remaining_qty: number;
};

export type VariantMatch = {
  variant_id: string;
  sku: string | null;
  isbn13: string | null;
  isbn10: string | null;
  internal_barcode: string | null;
  matched_by: string;
  book_title: string;
};

export type LookupBarcodeResult = {
  ambiguous: boolean;
  selected: VariantMatch | null;
  matches: VariantMatch[];
};

export type PickingTaskDetail = {
  task_type: PickingTaskType;
  task_id: string;
  order_number: string;
  status: string;
  task_class: 'PICK' | 'REPICK';
  repick_sequence: number | null;
  parent_order_number: string | null;
  source_warehouse_code: string | null;
  source_warehouse_name: string | null;
  target_warehouse_code: string | null;
  target_warehouse_name: string | null;
  assigned_picker_user_id: string | null;
  lines: PickingLine[];
  current_line: PickingLine | null;
  remaining_line_count: number;
  remaining_quantity: number;
};

export type PresenceResult = {
  message: string;
  data: {
    location_id: string;
    location_code: string;
    location_type: string;
  };
};

export type ConfirmLineResult = {
  message: string;
  data: {
    task_type: PickingTaskType;
    task_id: string;
    line_id: string;
    confirmed_quantity: number;
    line_remaining_quantity: number;
    task_completed: boolean;
  };
};

export type DeclareShortageResult = {
  message: string;
  data: {
    task_type: string;
    task_id: string | null;
    order_number: string | null;
    reused_existing?: boolean;
  } | null;
};
