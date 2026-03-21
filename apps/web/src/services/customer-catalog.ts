import { gatewayAPI } from './http-clients';

export interface CustomerCatalogBook {
  id: string;
  title: string;
  subtitle?: string | null;
  description?: string | null;
  author?: string;
  category?: string;
  publisher?: string;
  isbn?: string;
  cover_image_url?: string | null;
  quantity: number;
  variant_id?: string | null;
  default_warehouse_id?: string | null;
  default_location_id?: string | null;
  reservable?: boolean;
  is_incomplete?: boolean;
  locations?: Array<{
    warehouse_name: string;
    location_code: string;
    quantity: number;
  }>;
}

export interface CustomerCatalogQuery {
  search?: string;
  category?: string;
  author?: string;
  publisher?: string;
  availability?: 'available' | 'unavailable' | '';
}

export const customerCatalogService = {
  async getBooks(query?: CustomerCatalogQuery): Promise<CustomerCatalogBook[]> {
    const response = await gatewayAPI.get('/catalog/books', { params: query });
    return Array.isArray(response.data) ? (response.data as CustomerCatalogBook[]) : [];
  },

  async getBookById(id: string): Promise<CustomerCatalogBook> {
    const response = await gatewayAPI.get(`/catalog/books/${id}`);
    return (response.data?.data || response.data) as CustomerCatalogBook;
  },
};
