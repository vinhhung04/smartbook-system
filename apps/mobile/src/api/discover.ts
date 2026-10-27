import { AI_TIMEOUT_MS, apiFetch } from './client';
import { toCustomerCatalogBook, type PublicCatalogBook } from '../lib/publicCatalog';
import type { CustomerCatalogBook } from '../types/customerCatalog';

export type DiscoverStatus = 'CONFIDENT_MATCH' | 'UNCERTAIN' | 'NO_EVIDENCE';

export type DiscoverResult = {
  status: DiscoverStatus;
  results: { book: CustomerCatalogBook; matched: ('semantic' | 'keyword')[] }[];
};

/**
 * ai-service GET /public/discover — natural-language book discovery for readers.
 * Retrieval only (pgvector + full-text), no LLM text, and every hit is re-read from
 * the public catalog, so the answer can only ever be books that exist and that the
 * public may see. It reaches no account data, no staff tools and takes no actions —
 * the reason the mobile assistant uses it instead of the staff/admin /ai/chat.
 */
export async function discoverBooks(query: string, signal?: AbortSignal): Promise<DiscoverResult> {
  const result = await apiFetch<{ status: DiscoverStatus; results: { book: PublicCatalogBook; matched?: ('semantic' | 'keyword')[] }[] }>(
    `/public/discover?q=${encodeURIComponent(query)}`,
    { skipAuth: true, timeoutMs: AI_TIMEOUT_MS, signal },
  );
  return {
    status: result.status,
    results: (result.results ?? []).map((row) => ({ book: toCustomerCatalogBook(row.book), matched: row.matched ?? [] })),
  };
}
