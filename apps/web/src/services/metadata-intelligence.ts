import { inventoryAPI } from './http-clients';
import type { LookupBookByIsbnResponse, PostIsbnAiSuggestions } from './ai';

export type AuthorityStatus = 'AUTO_MATCH' | 'REVIEW_REQUIRED' | 'NEW_ENTITY';

export interface NormalizationSuggestion {
  rawValue: string;
  normalizedValue: string;
  matchedEntity: { id: string; name: string } | null;
  confidence: number;
  sources: string[];
  reason: string;
  status: AuthorityStatus;
  provenance: 'EXTERNAL' | 'RULE' | 'AI' | 'STAFF_APPROVED';
}

export interface ReconciliationDraft {
  id: string;
  normalized_metadata: Record<string, unknown>;
  qualityWarnings: string[];
  authorityMatches: Record<string, unknown>;
  normalizationSuggestions: {
    authorNormalization: NormalizationSuggestion[];
    publisherNormalization: NormalizationSuggestion;
    categoryNormalization: NormalizationSuggestion[];
  };
  decisions: Array<{ field: string; status: 'PENDING' | 'ACCEPTED' | 'REJECTED'; value?: unknown }>;
}

export interface DuplicateReview {
  id: string;
  classification: 'EXACT_DUPLICATE' | 'SAME_EDITION' | 'SAME_WORK_DIFFERENT_EDITION' | 'POSSIBLE_DUPLICATE' | 'NEW_TITLE';
  similarityScore: number;
  explanation: string[];
  candidates: Array<{ bookId: string; variantIds: string[]; title: string; classification: string; score: number; explanation: string[] }>;
}

export interface DuplicateDecisionResult {
  review: DuplicateReview & { decision?: string | null; selected_book_id?: string | null; selected_variant_id?: string | null };
  book: { id: string } | null;
  variant: { id: string; book_id: string } | null;
}

export interface FinalMetadata {
  title?: string;
  subtitle?: string | null;
  description?: string | null;
  summaryVi?: string | null;
  language?: string;
  isbn13?: string;
  isbn10?: string;
  internalBarcode?: string | null;
  publishYear?: number;
  pageCount?: number | null;
  coverImageUrl?: string | null;
  keywords?: string[];
}

export const metadataIntelligenceService = {
  createReconciliationDraft: async (lookup: LookupBookByIsbnResponse, aiSuggestions: PostIsbnAiSuggestions): Promise<ReconciliationDraft> => {
    const response = await inventoryAPI.post('/api/metadata-reconciliations', { isbn: lookup.isbn, lookup, aiSuggestions });
    return response.data.data;
  },
  decideField: async (draftId: string, field: string, status: 'ACCEPTED' | 'REJECTED', value?: unknown): Promise<ReconciliationDraft['decisions'][number]> => {
    const response = await inventoryAPI.patch(`/api/metadata-reconciliations/${draftId}/fields/${encodeURIComponent(field)}`, { status, ...(value !== undefined ? { value } : {}) });
    return response.data.data;
  },
  applyReconciliationDraft: async (draftId: string, input: { bookId?: string; variantId?: string; createEntities?: Record<string, boolean>; finalMetadata: FinalMetadata; duplicateReviewId?: string }): Promise<{ book: { id: string }; variantId: string | null }> => {
    const response = await inventoryAPI.post(`/api/metadata-reconciliations/${draftId}/apply`, input);
    return response.data.data;
  },
  checkDuplicate: async (normalizedMetadata: Record<string, unknown>): Promise<DuplicateReview> => {
    const response = await inventoryAPI.post('/api/duplicate-intelligence/check', { normalizedMetadata });
    return response.data.data;
  },
  decideDuplicate: async (reviewId: string, action: string, extra: Record<string, unknown> = {}): Promise<DuplicateDecisionResult> => {
    const response = await inventoryAPI.patch(`/api/duplicate-intelligence/reviews/${reviewId}`, { action, ...extra });
    return response.data.data;
  },
};
