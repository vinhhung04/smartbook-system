import { inventoryAPI } from './http-clients';

export type SuggestionMode = 'RECEIVING' | 'PUTAWAY' | 'RELOCATION' | 'AI_IMPORT';
export type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW';

export interface StorageSuggestion {
  rank: number;
  locationId: string;
  locationCode: string;
  zone: string | null;
  aisle: string | null;
  shelf: string | null;
  bin: string | null;
  score: number;
  confidence: ConfidenceLevel;
  availableCapacity: number;
  currentOnHand: number;
  reasons: string[];
  warnings: string[];
}

export interface SuggestionResponse {
  success: boolean;
  warehouseId?: string;
  variantId?: string;
  bookId?: string;
  bookTitle?: string;
  quantity?: number;
  mode?: string;
  suggestions: StorageSuggestion[];
  fallback: boolean;
  message?: string;
  error?: string;
}

export interface StorageContext {
  success: boolean;
  error?: string;
  book?: {
    id: string;
    variantId: string;
    title: string;
    categories: string[];
    variantInfo: {
      isbn13: string | null;
      coverType: string;
      languageCode: string;
      publishYear: number | null;
    };
  };
  existingStock?: {
    sameVariant: Array<{
      locationId: string;
      locationCode: string;
      onHandQty: number;
    }>;
    sameBook: Array<{
      locationId: string;
      locationCode: string;
      onHandQty: number;
    }>;
  };
  availableLocations?: Array<{
    id: string;
    code: string;
    zone: string | null;
    shelf: string | null;
    bin: string | null;
    capacity: number | null;
  }>;
  warehouseId?: string;
}

export interface ApplySuggestionRequest {
  warehouse_id: string;
  variant_id: string;
  location_id: string;
  quantity: number;
}

export interface ApplySuggestionResponse {
  success: boolean;
  error?: string;
  validated?: boolean;
  data?: {
    warehouseId: string;
    variantId: string;
    locationId: string;
    quantity: number;
    availableCapacity: number | null;
  };
}

export interface GetSuggestionsRequest {
  warehouse_id: string;
  book_id?: string;
  variant_id?: string;
  quantity?: number;
  mode?: SuggestionMode;
}

export const storageSuggestionService = {
  getSuggestions: async (params: GetSuggestionsRequest): Promise<SuggestionResponse> => {
    const response = await inventoryAPI.post('/api/storage-suggestions', params);
    return response.data as SuggestionResponse;
  },

  getContext: async (params: {
    warehouse_id: string;
    variant_id?: string;
    book_id?: string;
  }): Promise<StorageContext> => {
    const response = await inventoryAPI.get('/api/storage-suggestions/context', { params });
    return response.data as StorageContext;
  },

  applySuggestion: async (params: ApplySuggestionRequest): Promise<ApplySuggestionResponse> => {
    const response = await inventoryAPI.post('/api/storage-suggestions/apply', params);
    return response.data as ApplySuggestionResponse;
  },
};
