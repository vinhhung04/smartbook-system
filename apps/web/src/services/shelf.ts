import { inventoryAPI } from './api.ts';

export interface ShelfOverviewItem {
  id: string;
  code: string;
  zone: string | null;
  shelf: string | null;
  warehouse: {
    id: string;
    code: string;
    name: string;
  };
  compartmentCount: number;
  occupiedQty: number;
  capacityQty: number | null;
  availableQty: number | null;
  utilizationPct: number | null;
  locationAvailable: number;
}

export interface CompartmentBookItem {
  variantId: string;
  sku: string;
  isbn13: string | null;
  title: string;
  bookCode: string | null;
  onHandQty: number;
  inboundAt: string | null;
}

export interface ShelfCompartmentItem {
  id: string;
  code: string;
  occupiedQty: number;
  capacityQty: number | null;
  availableQty: number | null;
  locationAvailable: number;
  utilizationPct: number | null;
  books: CompartmentBookItem[];
}

export interface ShelfDetailResponse {
  shelf: {
    id: string;
    code: string;
    zone: string | null;
    shelf: string | null;
    warehouse: {
      id: string;
      code: string;
      name: string;
    };
    locationAvailable: number;
    occupiedQty: number;
    capacityQty: number | null;
    availableQty: number | null;
    utilizationPct: number | null;
    compartmentCount: number;
  };
  compartments: ShelfCompartmentItem[];
}

export const shelfService = {
  getOverview: async (params?: { warehouseId?: string; query?: string }) => {
    const response = await inventoryAPI.get('/api/shelves', { params });
    return (response.data?.shelves || []) as ShelfOverviewItem[];
  },

  getById: async (id: string) => {
    const response = await inventoryAPI.get(`/api/shelves/${id}`);
    return response.data as ShelfDetailResponse;
  },
};
