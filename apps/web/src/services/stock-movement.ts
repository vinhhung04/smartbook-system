import { inventoryAPI } from './api.ts';

export interface StockMovement {
  id: string;
  bookId: string;
  warehouseId: string;
  type: 'IN' | 'OUT' | 'TRANSFER' | 'ADJUSTMENT';
  quantity: number;
  reference: string;
  notes: string;
  createdAt: string;
  createdBy: string;
}

export interface StockMovementRequest {
  bookId: string;
  warehouseId: string;
  type: 'IN' | 'OUT' | 'TRANSFER' | 'ADJUSTMENT';
  quantity: number;
  reference: string;
  notes?: string;
}

export const stockMovementService = {
  getAll: async (params?: any) => {
    const response = await inventoryAPI.get('/api/stock-movements', { params });
    return response.data;
  },

  getById: async (id: string) => {
    const response = await inventoryAPI.get(`/api/stock-movements/${id}`);
    return response.data;
  },

  create: async (data: StockMovementRequest) => {
    const response = await inventoryAPI.post('/api/stock-movements', data);
    return response.data;
  },

  getByWarehouse: async (warehouseId: string) => {
    const response = await inventoryAPI.get(`/api/stock-movements/warehouse/${warehouseId}`);
    return response.data;
  },
};
