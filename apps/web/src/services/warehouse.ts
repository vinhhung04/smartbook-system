import { inventoryAPI } from './api.ts';

export interface Warehouse {
  id: string;
  code: string;
  name: string;
  warehouse_type?: string;
  address_line1?: string | null;
  is_active?: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface WarehouseCreateRequest {
  code: string;
  name: string;
  warehouse_type?: string;
  address_line1?: string;
  is_active?: boolean;
}

export interface LocationNode {
  id: string;
  warehouse_id: string;
  parent_location_id: string | null;
  location_code: string;
  code: string;
  name: string;
  location_type: string;
  description: string | null;
  sort_order: number;
  is_active: boolean;
  barcode?: string | null;
  capacity_qty?: number | null;
  children?: LocationNode[];
}

export interface LocationPayload {
  warehouse_id: string;
  parent_location_id?: string | null;
  code: string;
  name?: string;
  location_type: string;
  description?: string;
  sort_order?: number;
  is_active?: boolean;
  barcode?: string;
  capacity_qty?: number | null;
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

  getLocationTree: async (warehouseId: string) => {
    const response = await inventoryAPI.get(`/api/locations/tree/${warehouseId}`);
    return response.data as {
      warehouse: Pick<Warehouse, 'id' | 'code' | 'name'>;
      locations: LocationNode[];
      tree: LocationNode[];
    };
  },

  getLocationById: async (id: string) => {
    const response = await inventoryAPI.get(`/api/locations/${id}`);
    return response.data as LocationNode;
  },

  createLocation: async (data: LocationPayload) => {
    const response = await inventoryAPI.post('/api/locations', data);
    return response.data as LocationNode;
  },

  updateLocation: async (id: string, data: Partial<LocationPayload>) => {
    const response = await inventoryAPI.put(`/api/locations/${id}`, data);
    return response.data as LocationNode;
  },

  deleteLocation: async (id: string) => {
    await inventoryAPI.delete(`/api/locations/${id}`);
  },
};
