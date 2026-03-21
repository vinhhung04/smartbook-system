import { inventoryAPI } from './http-clients';

export interface Book {
  id: string;
  barcode?: string;
  title: string;
  author: string;
  isbn: string;
  quantity: number;
  price: number;
  category: string;
  createdAt: string;
}

export interface BookCreateRequest {
  title: string;
  author: string;
  isbn: string;
  price: number;
  category: string;
}

export type BookUpdateRequest = Record<string, unknown>;

export interface IncompleteBookRequest {
  barcode: string;
  title: string;
  price: number;
  cover_image_url?: string;
  language?: string;
  publish_year?: number;
}

export interface BarcodeLookupResponse {
  variant_id: string;
  barcode: string;
  title: string;
  unit_cost: number;
  list_price: number;
  is_incomplete: boolean;
  book_id: string;
}

export const bookService = {
  getAll: async (params?: any) => {
    const response = await inventoryAPI.get('/api/books', { params });
    return response.data;
  },

  getById: async (id: string) => {
    const response = await inventoryAPI.get(`/api/books/${id}`);
    return response.data;
  },

  create: async (data: BookCreateRequest) => {
    const response = await inventoryAPI.post('/api/books', data);
    return response.data;
  },

  update: async (id: string, data: BookUpdateRequest) => {
    const response = await inventoryAPI.patch(`/api/books/${id}`, data);
    return response.data;
  },

  delete: async (id: string) => {
    await inventoryAPI.delete(`/api/books/${id}`);
  },

  findByBarcode: async (barcode: string): Promise<BarcodeLookupResponse> => {
    const safeBarcode = encodeURIComponent(String(barcode || '').trim());
    const response = await inventoryAPI.get(`/api/books/barcode/${safeBarcode}`);
    return response.data;
  },

  createIncomplete: async (data: IncompleteBookRequest) => {
    const response = await inventoryAPI.post('/api/books/incomplete', data);
    return response.data;
  },
};
