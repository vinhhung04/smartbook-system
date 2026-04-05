import { inventoryAPI } from './http-clients';

export interface Supplier {
  id: string;
  code: string | null;
  name: string;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  tax_code: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  _count?: { purchase_orders: number; supplier_variants: number };
}

export const supplierService = {
  getAll: async (): Promise<Supplier[]> => {
    const response = await inventoryAPI.get('/api/suppliers');
    return response.data as Supplier[];
  },

  create: async (data: Partial<Supplier>): Promise<Supplier> => {
    const response = await inventoryAPI.post('/api/suppliers', data);
    return response.data as Supplier;
  },

  update: async (id: string, data: Partial<Supplier>): Promise<Supplier> => {
    const response = await inventoryAPI.patch(`/api/suppliers/${id}`, data);
    return response.data as Supplier;
  },

  delete: async (id: string): Promise<void> => {
    await inventoryAPI.delete(`/api/suppliers/${id}`);
  },
};
