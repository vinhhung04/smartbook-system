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

export interface TransferReceivingLine {
  transfer_order_item_id: string;
  variant_id: string;
  title: string | null;
  sku: string | null;
  isbn13: string | null;
  shipped_qty: number;
}

export interface TransferReceivingLineCount {
  transfer_order_item_id: string;
  delivered_qty: number;
  damaged_qty?: number;
  rejected_qty?: number;
}

export interface TransferDiscrepancyItem {
  id: string; variant_id: string; title?: string; sku?: string;
  shipped_qty: number; delivered_qty: number; accepted_qty: number;
  remaining_missing_qty: number; remaining_damaged_qty: number; remaining_rejected_qty: number;
}
export interface TransferDiscrepancy {
  id: string; transfer_order_id: string; transfer_number?: string; status: 'OPEN' | 'RESOLVED';
  items: TransferDiscrepancyItem[];
  resolutions?: { id: string; action: string; bucket: string; quantity: number; reason: string; evidence_reference: string; created_at: string }[];
}
export interface TransferResolution {
  discrepancy_item_id: string; bucket: 'MISSING' | 'DAMAGED' | 'REJECTED';
  action: 'FOUND' | 'REDELIVERED' | 'RETURN_TO_SOURCE' | 'WRITE_OFF'; quantity: number;
  reason: string; evidence_reference: string; redelivery_transfer_id?: string;
}
export const transferDiscrepancyService = {
  async list(warehouseId?: string, status = 'OPEN') {
    const response = await inventoryAPI.get('/api/transfer-receiving/discrepancies', { params: { warehouse_id: warehouseId, status } });
    return response.data as { data: TransferDiscrepancy[] };
  },
  async get(transferId: string) {
    const response = await inventoryAPI.get(`/api/transfer-receiving/${transferId}/discrepancies`);
    return response.data as { data: TransferDiscrepancy };
  },
  async resolve(transferId: string, body: TransferResolution, key: string) {
    const response = await inventoryAPI.post(`/api/transfer-receiving/${transferId}/discrepancies/resolve`, body, { headers: { 'Idempotency-Key': key } });
    return response.data as { data: TransferDiscrepancy; idempotent: boolean };
  },
};

export const transferReceivingService = {
  getQueue: async (warehouseId?: string) => {
    const response = await inventoryAPI.get('/api/transfer-receiving', {
      params: warehouseId ? { warehouse_id: warehouseId } : undefined,
    });
    return response.data as { data: TransferReceivingItem[] };
  },

  getLines: async (transferId: string) => {
    const response = await inventoryAPI.get(`/api/transfer-receiving/${transferId}/lines`);
    return response.data as { data: { transfer_id: string; transfer_number: string; status: string; items: TransferReceivingLine[] } };
  },

  assignReceiving: async (transferId: string, staffId: string) => {
    const response = await inventoryAPI.patch(`/api/transfer-receiving/${transferId}/assign`, {
      received_by_user_id: staffId,
    });
    return response.data as { message: string };
  },

  // Omit `items` to accept everything shipped in full (the explicit "received in
  // full" quick action); pass counted lines when what arrived differs.
  confirmReceiving: async (transferId: string, items?: TransferReceivingLineCount[]) => {
    const response = await inventoryAPI.post(`/api/transfer-receiving/${transferId}/confirm`, items ? { items } : undefined);
    return response.data as ConfirmTransferReceivingResult;
  },
};
