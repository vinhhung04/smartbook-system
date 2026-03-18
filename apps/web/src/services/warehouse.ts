import { inventoryAPI } from './api.ts';

export interface Warehouse {
  id: string;
  name: string;
  location: string;
  capacity: number;
  currentStock: number;
  createdAt: string;
}

export interface WarehouseCreateRequest {
  name: string;
  location: string;
  capacity: number;
}

export const warehouseService = {
  getAll: async (params?: any) => {
    const response = await inventoryAPI.get('/api/warehouses', { params });
    return response.data;
  },

  getById: async (id: string) => {
    const response = await inventoryAPI.get(`/api/warehouses/${id}`);
    return response.data;
  },

  create: async (data: WarehouseCreateRequest) => {
    const response = await inventoryAPI.post('/api/warehouses', data);
    return response.data;
  },

  update: async (id: string, data: Partial<WarehouseCreateRequest>) => {
    const response = await inventoryAPI.put(`/api/warehouses/${id}`, data);
    return response.data;
  },

  delete: async (id: string) => {
    await inventoryAPI.delete(`/api/warehouses/${id}`);
  },

  getLocations: async (id: string) => {
    const response = await inventoryAPI.get(`/api/warehouses/${id}/locations`);
    return response.data?.locations || [];
  },
};
