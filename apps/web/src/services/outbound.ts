import { inventoryAPI } from './http-clients';

export type OutboundTaskType = 'outbound' | 'transfer';

export interface OutboundQueueItem {
  task_type: OutboundTaskType;
  task_id: string;
  order_number: string;
  status: string;
  source_warehouse_id: string;
  source_warehouse_code: string | null;
  source_warehouse_name: string | null;
  target_warehouse_id: string | null;
  target_warehouse_code: string | null;
  target_warehouse_name: string | null;
  outbound_assigned_user_id: string | null;
  total_quantity: number;
  ready_quantity: number;
}

export interface OutboundDetailLine {
  line_id: string;
  variant_id: string;
  quantity: number;
  ready_qty: number;
  sku: string | null;
  isbn13: string | null;
  isbn10: string | null;
  barcode: string | null;
  book_title: string;
}

export interface OutboundOrderDetail {
  task_type: OutboundTaskType;
  task_id: string;
  order_number: string;
  status: string;
  source_warehouse_id: string;
  source_warehouse_code: string | null;
  source_warehouse_name: string | null;
  target_warehouse_id?: string | null;
  target_warehouse_code?: string | null;
  target_warehouse_name?: string | null;
  outbound_assigned_user_id: string | null;
  lines: OutboundDetailLine[];
}

export interface ConfirmOutboundResult {
  message: string;
  data: {
    task_type: OutboundTaskType;
    task_id: string;
    status: string;
    destination_receipt_id?: string;
    destination_receipt_number?: string;
  };
}

export const outboundService = {
  getQueue: async (warehouseId?: string) => {
    const response = await inventoryAPI.get('/api/outbound/orders', {
      params: warehouseId ? { warehouse_id: warehouseId } : undefined,
    });

    return response.data as { data: OutboundQueueItem[] };
  },

  getOrderDetail: async (taskType: OutboundTaskType, taskId: string) => {
    const response = await inventoryAPI.get(`/api/outbound/orders/${taskType}/${taskId}`);
    return response.data as OutboundOrderDetail;
  },

  assignOutboundTask: async (taskType: OutboundTaskType, taskId: string, staffId: string) => {
    const response = await inventoryAPI.patch(`/api/outbound/orders/${taskType}/${taskId}/assign`, {
      outbound_assigned_user_id: staffId,
    });
    return response.data as { message: string };
  },

  confirmOutbound: async (taskType: OutboundTaskType, taskId: string, scanCode?: string | null) => {
    const response = await inventoryAPI.post(`/api/outbound/orders/${taskType}/${taskId}/confirm`, {
      scan_code: scanCode || null,
    });

    return response.data as ConfirmOutboundResult;
  },
};
