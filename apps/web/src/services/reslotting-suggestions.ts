import { inventoryAPI } from './http-clients';

export interface ReslottingSuggestionItem {
  variant_id: string;
  title: string;
  current_location_id: string;
  current_location_code: string;
  suggested_location_id: string;
  suggested_location_code: string;
  turnover_count: number;
  accessibility_rank: number;
  turnover_rank: number;
  reason: string;
}

export interface ReslottingSuggestionsData {
  warehouse_id: string;
  generated_at: string;
  total_placements_evaluated: number;
  items: ReslottingSuggestionItem[];
}

export const reslottingSuggestionsService = {
  getSuggestions: async (warehouseId: string, limit = 20): Promise<ReslottingSuggestionsData> => {
    const response = await inventoryAPI.get('/api/reslotting-suggestions', {
      params: { warehouse_id: warehouseId, limit },
    });
    return response.data.data as ReslottingSuggestionsData;
  },
};
