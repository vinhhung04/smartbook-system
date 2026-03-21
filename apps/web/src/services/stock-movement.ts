import { inventoryAPI } from './http-clients';

export interface StockMovement {
  id: string;
  movement_number: string;
  created_at: string;
  movement_type: string;
  type: 'inbound' | 'outbound' | 'transfer';
  quantity: number;
  delta: number;
  unit_cost: number;
  warehouse_id: string;
  warehouse_name: string | null;
  warehouse_code: string | null;
  from_location_id: string | null;
  to_location_id: string | null;
  from_location_code: string | null;
  to_location_code: string | null;
  transfer_note: string | null;
  variant_id: string;
  sku: string | null;
  barcode: string | null;
  book_id: string | null;
  book_title: string;
  created_by_user_id: string;
  reference_type: string | null;
  reference_id: string | null;
}

export const stockMovementService = {
  getAll: async (params?: Record<string, unknown>) => {
    const response = await inventoryAPI.get('/api/stock-movements', { params });
    return (response.data || []) as StockMovement[];
  },
};
