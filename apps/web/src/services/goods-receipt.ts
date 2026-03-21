import { inventoryAPI } from './http-clients';

export interface GoodsReceipt {
  id: string;
  receipt_number: string;
  warehouse_id: string;
  warehouse_name?: string;
  warehouse_code?: string;
  item_count: number;
  total_amount: number;
  status: 'DRAFT' | 'POSTED' | 'CANCELLED';
  created_at: string;
  received_at?: string;
  note?: string;
  received_by_user_id?: string;
}

export interface GoodsReceiptItem {
  variant_id: string;
  location_id?: string | null;
  quantity: number;
  unit_cost: number;
  is_new_book?: boolean;
}

export interface GoodsReceiptCreateRequest {
  warehouse_id: string;
  items: GoodsReceiptItem[];
  note?: string;
}

export const goodsReceiptService = {
  getAll: async (params?: any) => {
    const response = await inventoryAPI.get('/api/goods-receipts', { params });
    return response.data;
  },

  getById: async (id: string) => {
    const response = await inventoryAPI.get(`/api/goods-receipts/${id}`);
    return response.data;
  },

  create: async (data: GoodsReceiptCreateRequest) => {
    const response = await inventoryAPI.post('/api/goods-receipts', data);
    return response.data;
  },

  updateStatus: async (id: string, status: string) => {
    const response = await inventoryAPI.patch(`/api/goods-receipts/${id}`, { status });
    return response.data;
  },
};
