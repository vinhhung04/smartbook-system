import { inventoryAPI } from './api.ts';

export interface PutawayReceiptSummary {
  id: string;
  receipt_number: string;
  warehouse_id: string;
  warehouse_code: string | null;
  warehouse_name: string | null;
  status: string;
  approved_by_user_id: string | null;
  received_at: string | null;
  created_at: string;
  line_count: number;
  allocated_line_count?: number;
  total_quantity: number;
  putaway_quantity: number;
  remaining_quantity: number;
}

export interface PutawayReceiptItem {
  id: string;
  variant_id: string;
  sku: string | null;
  isbn13: string | null;
  isbn10: string | null;
  barcode: string | null;
  book_id: string | null;
  book_title: string;
  quantity: number;
  putaway_quantity: number;
  remaining_quantity: number;
  is_allocated: boolean;
  unit_cost: number;
  location_id: string | null;
  location_code: string | null;
  location_type: string | null;
}

export interface PutawayReceiptDetail {
  id: string;
  receipt_number: string;
  warehouse_id: string;
  warehouse_code: string | null;
  warehouse_name: string | null;
  status: string;
  approved_by_user_id: string | null;
  received_at: string | null;
  created_at: string;
  note: string | null;
  total_quantity: number;
  putaway_quantity: number;
  remaining_quantity: number;
  items: PutawayReceiptItem[];
}

export interface PutawayZone {
  id: string;
  location_code: string;
  location_name: string;
}

export interface PutawayShelf {
  id: string;
  location_code: string;
  location_name: string;
  zone_id: string;
  zone_code: string;
}

export interface PutawayCompartment {
  id: string;
  location_code: string;
  location_name: string;
  shelf_id: string;
  shelf_code: string;
  zone_id: string;
}

export interface PutawayLocationResponse {
  warehouse_id: string;
  zones: PutawayZone[];
  shelves: PutawayShelf[];
  compartments: PutawayCompartment[];
}

export interface PutawayAllocationItem {
  item_id: string;
  zone_id: string;
  shelf_id: string;
  compartment_id: string;
  putaway_quantity: number;
}

export interface ConfirmPutawayPayload {
  allocations: PutawayAllocationItem[];
}

export const putawayService = {
  getReadyReceipts: async () => {
    const response = await inventoryAPI.get('/api/putaway/receipts');
    return response.data as PutawayReceiptSummary[];
  },

  getReceiptDetail: async (receiptId: string) => {
    const response = await inventoryAPI.get(`/api/putaway/receipts/${receiptId}`);
    return response.data as PutawayReceiptDetail;
  },

  getPutawayLocations: async (receiptId: string) => {
    const response = await inventoryAPI.get(`/api/putaway/receipts/${receiptId}/locations`);
    return response.data as PutawayLocationResponse;
  },

  confirmPutaway: async (receiptId: string, payload: ConfirmPutawayPayload) => {
    const response = await inventoryAPI.post(`/api/putaway/receipts/${receiptId}/confirm`, payload);
    return response.data;
  },
};
