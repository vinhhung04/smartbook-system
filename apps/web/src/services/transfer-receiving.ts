import { inventoryAPI } from './http-clients';

export interface TransferReceivingItem {
  id: string;
  transfer_number: string;
  status: string;
  from_warehouse_id: string;
  from_warehouse_code: string | null;
  from_warehouse_name: string | null;
  to_warehouse_id: string;
  to_warehouse_code: string | null;
  to_warehouse_name: string | null;
  received_by_user_id: string | null;
  shipped_at: string | null;
  total_quantity: number;
}

export interface ConfirmTransferReceivingResult {
  message: string;
  data: {
    transfer_id: string;
    status: string;
    goods_receipt_id: string;
    goods_receipt_number: string;
  };
}

export const transferReceivingService = {
  getQueue: async (warehouseId?: string) => {
    const response = await inventoryAPI.get('/api/transfer-receiving', {
      params: warehouseId ? { warehouse_id: warehouseId } : undefined,
    });
    return response.data as { data: TransferReceivingItem[] };
  },

  assignReceiving: async (transferId: string, staffId: string) => {
    const response = await inventoryAPI.patch(`/api/transfer-receiving/${transferId}/assign`, {
      received_by_user_id: staffId,
    });
    return response.data as { message: string };
  },

  confirmReceiving: async (transferId: string) => {
    const response = await inventoryAPI.post(`/api/transfer-receiving/${transferId}/confirm`);
    return response.data as ConfirmTransferReceivingResult;
  },
};
