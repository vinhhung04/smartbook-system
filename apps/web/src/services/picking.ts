import { inventoryAPI } from './http-clients';

export type PickingTaskType = 'outbound' | 'transfer';

export interface PickingTaskSummary {
  task_type: PickingTaskType;
  task_id: string;
  order_number: string;
  order_type: string;
  task_class?: 'PICK' | 'REPICK';
  repick_sequence?: number | null;
  repick_reason?: string | null;
  root_task_type?: PickingTaskType | null;
  root_task_id?: string | null;
  parent_task_type?: PickingTaskType | null;
  parent_task_id?: string | null;
  source_warehouse_id: string;
  source_warehouse_code: string | null;
  source_warehouse_name: string | null;
  target_warehouse_id: string | null;
  target_warehouse_code: string | null;
  target_warehouse_name: string | null;
  status: string;
  line_count: number;
  total_quantity: number;
  remaining_quantity: number;
  assigned_picker_user_id: string | null;
  requested_at: string;
  approved_at: string;
}

export interface PickingTaskLine {
  line_id: string;
  variant_id: string;
  source_location_id: string | null;
  source_location_code: string | null;
  source_location_barcode: string | null;
  source_location_type: string | null;
  target_location_id?: string | null;
  target_location_code?: string | null;
  sku: string | null;
  isbn13: string | null;
  isbn10: string | null;
  barcode: string | null;
  book_title: string;
  requested_qty: number;
  picked_qty: number;
  short_picked_qty?: number;
  remaining_qty: number;
  repick_line?: {
    original_line_id: string | null;
    source_task_type: PickingTaskType | null;
    source_task_id: string | null;
    missing_qty: number;
  } | null;
  note: string | null;
}

export interface PickingTaskDetail {
  task_type: PickingTaskType;
  task_id: string;
  order_number: string;
  order_type: string;
  task_class?: 'PICK' | 'REPICK';
  repick_sequence?: number | null;
  repick_reason?: string | null;
  root_task_type?: PickingTaskType | null;
  root_task_id?: string | null;
  root_order_number?: string | null;
  parent_task_type?: PickingTaskType | null;
  parent_task_id?: string | null;
  parent_order_number?: string | null;
  status: string;
  source_warehouse_id: string;
  source_warehouse_code: string | null;
  source_warehouse_name: string | null;
  target_warehouse_id: string | null;
  target_warehouse_code: string | null;
  target_warehouse_name: string | null;
  assigned_picker_user_id: string | null;
  requested_at: string;
  completed_at?: string | null;
  lines: PickingTaskLine[];
  current_line: PickingTaskLine | null;
  remaining_line_count: number;
  remaining_quantity: number;
}

export interface PickingVariantLookupMatch {
  variant_id: string;
  sku: string | null;
  isbn13: string | null;
  isbn10: string | null;
  internal_barcode: string | null;
  matched_by: string;
  match_priority: number;
  book_id: string | null;
  book_title: string;
}

export const pickingService = {
  getTasks: async (warehouseId?: string) => {
    const response = await inventoryAPI.get('/api/picking/tasks', {
      params: warehouseId ? { warehouse_id: warehouseId } : undefined,
    });
    return response.data as { data: PickingTaskSummary[] };
  },

  claimTask: async (taskType: PickingTaskType, taskId: string, pickerUserId?: string) => {
    const response = await inventoryAPI.post(`/api/picking/tasks/${taskType}/${taskId}/claim`, {
      picker_user_id: pickerUserId || null,
    });
    return response.data as {
      task_type: PickingTaskType;
      task_id: string;
      assigned_picker_user_id: string | null;
      status: string;
    };
  },

  getTaskDetail: async (taskType: PickingTaskType, taskId: string, currentLocationInput?: string) => {
    const response = await inventoryAPI.get(`/api/picking/tasks/${taskType}/${taskId}`, {
      params: currentLocationInput ? { current_location_input: currentLocationInput } : undefined,
    });
    return response.data as PickingTaskDetail;
  },

  confirmPresence: async (taskType: PickingTaskType, taskId: string, currentLocationInput: string) => {
    const response = await inventoryAPI.post(`/api/picking/tasks/${taskType}/${taskId}/presence`, {
      current_location_input: currentLocationInput,
    });

    return response.data as {
      message: string;
      data: {
        location_id: string;
        location_code: string;
        location_type: string;
      };
    };
  },

  lookupVariantByBarcode: async (barcode: string) => {
    const response = await inventoryAPI.get('/api/picking/lookup/variant-by-barcode', {
      params: { barcode },
    });

    return response.data as {
      ambiguous: boolean;
      selected: PickingVariantLookupMatch | null;
      matches: PickingVariantLookupMatch[];
    };
  },

  confirmLine: async (taskType: PickingTaskType, taskId: string, lineId: string, payload: {
    quantity: number;
    scanned_location_input: string;
    scanned_product_barcode?: string | null;
    scanned_variant_id?: string | null;
  }) => {
    const response = await inventoryAPI.post(`/api/picking/tasks/${taskType}/${taskId}/lines/${lineId}/confirm`, payload);

    return response.data as {
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
  },
};
