import { inventoryAPI } from './http-clients';

export type RequestTaskType = 'outbound' | 'transfer';
export type RequestViewType = 'my' | 'approval';

export interface OrderRequestVariant {
  variant_id: string;
  sku: string | null;
  barcode: string | null;
  isbn13: string | null;
  isbn10: string | null;
  title: string;
}

export interface OrderRequestSummary {
  task_type: RequestTaskType;
  task_id: string;
  order_number: string;
  status: string;
  order_type: string;
  source_warehouse_id: string;
  source_warehouse_code: string | null;
  source_warehouse_name: string | null;
  target_warehouse_id: string | null;
  target_warehouse_code: string | null;
  target_warehouse_name: string | null;
  requested_by_user_id: string | null;
  approved_by_user_id: string | null;
  assigned_picker_user_id: string | null;
  line_count: number;
  total_quantity: number;
  requested_at: string;
  updated_at: string;
  note: string | null;
  external_reference: string | null;
}

export interface OutboundRequestLineInput {
  isbn13: string;
  source_location_id?: string | null;
  quantity: number;
  note?: string | null;
}

export interface TransferRequestLineInput {
  isbn13: string;
  from_location_id?: string | null;
  to_location_id?: string | null;
  quantity: number;
  note?: string | null;
}

export const orderRequestService = {
  searchVariants: async (query: string, limit = 8) => {
    const response = await inventoryAPI.get('/api/order-requests/variants/search', {
      params: { q: query, limit },
    });

    return response.data as { data: OrderRequestVariant[] };
  },

  listRequests: async (view: RequestViewType, warehouseId?: string) => {
    const response = await inventoryAPI.get('/api/order-requests', {
      params: {
        view,
        ...(warehouseId ? { warehouse_id: warehouseId } : {}),
      },
    });

    return response.data as { data: OrderRequestSummary[] };
  },

  createOutboundRequest: async (payload: {
    warehouse_id: string;
    outbound_type?: 'SALE' | 'DISPOSAL' | 'RETURN_TO_SUPPLIER' | 'MANUAL';
    external_reference?: string | null;
    note?: string | null;
    lines: OutboundRequestLineInput[];
  }) => {
    const response = await inventoryAPI.post('/api/order-requests/outbound', payload);
    return response.data as {
      message: string;
      data: {
        task_type: RequestTaskType;
        task_id: string;
        order_number: string;
        status: string;
      };
    };
  },

  createTransferRequest: async (payload: {
    from_warehouse_id: string;
    to_warehouse_id: string;
    note?: string | null;
    lines: TransferRequestLineInput[];
  }) => {
    const response = await inventoryAPI.post('/api/order-requests/transfer', payload);
    return response.data as {
      message: string;
      data: {
        task_type: RequestTaskType;
        task_id: string;
        order_number: string;
        status: string;
      };
    };
  },

  approveRequest: async (taskType: RequestTaskType, taskId: string, note?: string) => {
    const response = await inventoryAPI.post(`/api/order-requests/${taskType}/${taskId}/approve`, {
      note: note || null,
    });

    return response.data as {
      message: string;
      data: {
        task_type: RequestTaskType;
        task_id: string;
        status: string;
      };
    };
  },

  rejectRequest: async (taskType: RequestTaskType, taskId: string, note?: string) => {
    const response = await inventoryAPI.post(`/api/order-requests/${taskType}/${taskId}/reject`, {
      note: note || null,
    });

    return response.data as {
      message: string;
      data: {
        task_type: RequestTaskType;
        task_id: string;
        status: string;
      };
    };
  },
};
