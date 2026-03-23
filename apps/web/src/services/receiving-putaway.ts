import { inventoryAPI } from './http-clients';

export interface ReceivingLocation {
  id: string;
  location_code: string;
  location_type: string;
  barcode: string | null;
}

export interface ReceivingItem {
  variant_id: string;
  sku: string | null;
  isbn13: string | null;
  isbn10: string | null;
  barcode: string | null;
  book_title: string;
  on_hand_qty: number;
  available_qty: number;
}

export interface PutawayCandidate {
  id: string;
  location_code: string;
  zone_id: string;
  zone_code: string;
  shelf_id: string;
  shelf_code: string;
  current_on_hand: number;
  max_capacity: number;
  remaining_capacity: number;
  mixed_sku_count: number;
  priority_group: number;
}

export interface VariantLookupMatch {
  variant_id: string;
  sku: string | null;
  isbn13: string | null;
  isbn10: string | null;
  internal_barcode: string | null;
  book_id: string | null;
  book_title: string;
  matched_by: string;
  match_priority: number;
}

export interface TransferAllocationLine {
  target_location_id: string;
  quantity: number;
  reason: string;
  scanned_location_barcode?: string | null;
  scanned_product_barcode?: string | null;
}

export const receivingPutawayService = {
  getReceivings: async (warehouseId: string) => {
    const response = await inventoryAPI.get(`/api/receiving-putaway/warehouses/${warehouseId}/receivings`);
    return response.data as { warehouse_id: string; receivings: ReceivingLocation[] };
  },

  getReceivingItems: async (receivingId: string) => {
    const response = await inventoryAPI.get(`/api/receiving-putaway/receivings/${receivingId}/items`);
    return response.data as { warehouse_id: string; receiving: ReceivingLocation; items: ReceivingItem[] };
  },

  getCandidates: async (receivingId: string, variantId: string) => {
    const response = await inventoryAPI.get(`/api/receiving-putaway/receivings/${receivingId}/candidates`, {
      params: { variant_id: variantId },
    });
    return response.data as {
      warehouse_id: string;
      source_receiving_location_id: string;
      variant_id: string;
      preferred_shelf_id: string | null;
      preferred_zone_id: string | null;
      candidates: PutawayCandidate[];
    };
  },

  lookupLocationByBarcode: async (warehouseId: string, barcode: string) => {
    const response = await inventoryAPI.get('/api/receiving-putaway/lookup/location-by-barcode', {
      params: {
        warehouse_id: warehouseId,
        barcode,
      },
    });
    return response.data as { id: string; location_code: string; location_type: string };
  },

  lookupVariantByIsbn13: async (isbn13: string) => {
    const response = await inventoryAPI.get('/api/receiving-putaway/lookup/variant-by-barcode', {
      params: { isbn13 },
    });
    return response.data as {
      ambiguous: boolean;
      selected: VariantLookupMatch | null;
      matches: VariantLookupMatch[];
    };
  },

  lookupVariantByBarcode: async (barcode: string) => {
    return receivingPutawayService.lookupVariantByIsbn13(barcode);
  },

  transfer: async (payload: {
    warehouse_id: string;
    source_receiving_location_id: string;
    variant_id: string;
    allocations: TransferAllocationLine[];
  }) => {
    const response = await inventoryAPI.post('/api/receiving-putaway/transfer', payload);
    return response.data as {
      message: string;
      data: {
        success: boolean;
        moved_quantity: number;
        allocation_count: number;
      };
    };
  },

  getOccupiedCompartments: async (warehouseId: string) => {
    const response = await inventoryAPI.get(`/api/receiving-putaway/warehouses/${warehouseId}/compartments/occupied`);
    return response.data as {
      compartments: Array<{
        id: string;
        location_code: string;
        on_hand_qty: number;
      }>;
    };
  },

  getCompartmentItems: async (compartmentId: string) => {
    const response = await inventoryAPI.get(`/api/receiving-putaway/compartments/${compartmentId}/items`);
    return response.data as {
      warehouse_id: string;
      compartment: { id: string; location_code: string };
      items: ReceivingItem[];
    };
  },

  reverse: async (payload: {
    warehouse_id: string;
    source_compartment_location_id: string;
    target_receiving_location_id: string;
    variant_id: string;
    quantity: number;
    reason: string;
  }) => {
    const response = await inventoryAPI.post('/api/receiving-putaway/reverse', payload);
    return response.data as {
      message: string;
      data: {
        success: boolean;
        moved_quantity: number;
      };
    };
  },
};
