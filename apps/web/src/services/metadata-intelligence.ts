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
  decisions: Array<{ field: string; status: 'PENDING' | 'ACCEPTED' | 'REJECTED' }>;
}

export interface DuplicateReview {
  id: string;
  classification: 'EXACT_DUPLICATE' | 'SAME_EDITION' | 'SAME_WORK_DIFFERENT_EDITION' | 'POSSIBLE_DUPLICATE' | 'NEW_TITLE';
  similarityScore: number;
  explanation: string[];
  candidates: Array<{ bookId: string; variantIds: string[]; title: string; classification: string; score: number; explanation: string[] }>;
}

export const metadataIntelligenceService = {
  createReconciliationDraft: async (lookup: LookupBookByIsbnResponse, aiSuggestions: PostIsbnAiSuggestions): Promise<ReconciliationDraft> => {
    const response = await inventoryAPI.post('/api/metadata-reconciliations', { isbn: lookup.isbn, lookup, aiSuggestions });
    return response.data.data;
  },
  decideField: async (draftId: string, field: string, status: 'ACCEPTED' | 'REJECTED'): Promise<void> => {
    await inventoryAPI.patch(`/api/metadata-reconciliations/${draftId}/fields/${encodeURIComponent(field)}`, { status });
  },
  applyReconciliationDraft: async (draftId: string, bookId: string): Promise<void> => {
    await inventoryAPI.post(`/api/metadata-reconciliations/${draftId}/apply`, { bookId });
  },
  checkDuplicate: async (normalizedMetadata: Record<string, unknown>): Promise<DuplicateReview> => {
    const response = await inventoryAPI.post('/api/duplicate-intelligence/check', { normalizedMetadata });
    return response.data.data;
  },
  decideDuplicate: async (reviewId: string, action: string, extra: Record<string, unknown> = {}): Promise<void> => {
    await inventoryAPI.patch(`/api/duplicate-intelligence/reviews/${reviewId}`, { action, ...extra });
  },
};
