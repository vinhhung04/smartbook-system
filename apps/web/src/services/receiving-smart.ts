import { inventoryAPI } from './http-clients';

// ────────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────────

export interface ExtractedLineItem {
  title: string;
  isbn?: string | null;
  quantity: number;
  unit_price: number;
}

export interface MatchResult {
  index: number;
  title: string;
  isbn: string;
  quantity: number;
  unit_price: number;
  matched_variant_id: string | null;
  match_strategy: string | null;
  match_confidence: number;
  match_status: 'MATCHED' | 'LOW_CONFIDENCE' | 'UNMATCHED' | 'MANUAL_CORRECTED';
  matched_variant?: {
    id: string;
    sku: string;
    isbn13: string | null;
    isbn10: string | null;
    book_title: string;
  };
}

export interface MatchResponse {
  success: boolean;
  results: MatchResult[];
  summary: {
    total: number;
    matched: number;
    low_confidence: number;
    unmatched: number;
  };
}

export interface SmartReceivingDraft {
  id: string;
  warehouse_id: string;
  supplier_name: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  raw_extraction: Record<string, any>;
  source_file_name: string | null;
  source_file_type: string | null;
  status: 'DRAFT' | 'CONVERTED' | 'CANCELLED';
  created_by_user_id: string;
  created_at: string;
  updated_at: string;
  goods_receipt_id: string | null;
  smart_receiving_items: SmartReceivingItem[];
  warehouses?: {
    id: string;
    code: string;
    name: string;
  };
}

export interface SmartReceivingItem {
  id: string;
  smart_receiving_draft_id: string;
  extracted_title: string | null;
  extracted_isbn: string | null;
  extracted_quantity: number;
  extracted_unit_price: number;
  matched_variant_id: string | null;
  match_strategy: string | null;
  match_confidence: number | null;
  match_status: string;
  corrected_variant_id: string | null;
  corrected_quantity: number | null;
  is_user_corrected: boolean;
  goods_receipt_item_id: string | null;
  book_variants?: {
    id: string;
    sku: string;
    isbn13: string | null;
    isbn10: string | null;
    books?: {
      id: string;
      title: string;
    };
  };
}

export interface CreateDraftRequest {
  warehouse_id: string;
  supplier_name?: string;
  invoice_number?: string;
  invoice_date?: string;
  raw_extraction?: Record<string, any>;
  source_file_name?: string;
  source_file_type?: string;
  items: Array<{
    title?: string;
    isbn?: string;
    quantity: number;
    unit_price: number;
    matched_variant_id?: string | null;
    match_strategy?: string | null;
    match_confidence?: number | null;
    match_status?: string;
  }>;
  user_id: string;
}

export interface CreateDraftResponse {
  success: boolean;
  draft_id: string;
  status: string;
  items_count: number;
  draft?: SmartReceivingDraft;
}

export interface UpdateDraftRequest {
  items: Array<{
    id: string;
    corrected_variant_id?: string | null;
    corrected_quantity?: number | null;
    is_user_corrected?: boolean;
    match_status?: string;
  }>;
}

export interface ConvertDraftResponse {
  success: boolean;
  message: string;
  goods_receipt_id: string;
  receipt_number: string;
  items_count: number;
}

export interface ListDraftsResponse {
  success: boolean;
  drafts: SmartReceivingDraft[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
}

// ────────────────────────────────────────────────────────────────────────────────
// Service
// ────────────────────────────────────────────────────────────────────────────────

export const receivingSmartService = {
  /**
   * Match extracted items against catalog
   */
  matchItems: async (
    items: ExtractedLineItem[],
    warehouse_id?: string,
  ): Promise<MatchResponse> => {
    const response = await inventoryAPI.post('/receiving-smart/match', {
      items,
      warehouse_id,
    });
    return response.data;
  },

  /**
   * Create a smart receiving draft
   */
  createDraft: async (payload: CreateDraftRequest): Promise<CreateDraftResponse> => {
    const response = await inventoryAPI.post('/receiving-smart/drafts', payload);
    return response.data;
  },

  /**
   * Get draft details
   */
  getDraft: async (draftId: string): Promise<{ success: boolean; draft: SmartReceivingDraft }> => {
    const response = await inventoryAPI.get(`/receiving-smart/drafts/${draftId}`);
    return response.data;
  },

  /**
   * List all drafts
   */
  listDrafts: async (params?: {
    warehouse_id?: string;
    status?: string;
    page?: number;
    limit?: number;
  }): Promise<ListDraftsResponse> => {
    const response = await inventoryAPI.get('/receiving-smart/drafts', { params });
    return response.data;
  },

  /**
   * Update draft items (user corrections)
   */
  updateDraft: async (
    draftId: string,
    payload: UpdateDraftRequest,
  ): Promise<{ success: boolean; draft: SmartReceivingDraft }> => {
    const response = await inventoryAPI.put(`/receiving-smart/drafts/${draftId}`, payload);
    return response.data;
  },

  /**
   * Convert draft to goods receipt
   */
  convertDraft: async (
    draftId: string,
    user_id: string,
  ): Promise<ConvertDraftResponse> => {
    const response = await inventoryAPI.post(`/receiving-smart/drafts/${draftId}/convert`, {
      user_id,
    });
    return response.data;
  },

  /**
   * Cancel a draft
   */
  cancelDraft: async (draftId: string): Promise<{ success: boolean; message: string }> => {
    const response = await inventoryAPI.delete(`/receiving-smart/drafts/${draftId}`);
    return response.data;
  },
};
