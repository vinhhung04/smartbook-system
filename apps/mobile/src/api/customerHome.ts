import { AI_TIMEOUT_MS, apiFetch } from './client';
import { toCustomerCatalogBook, type PublicCatalogBook } from '../lib/publicCatalog';
import type { CustomerCatalogBook } from '../types/customerCatalog';

export type CatalogCategory = { name: string; slug: string; book_count: number; available_count: number };

export type CatalogHome = {
  stats: { total_titles: number; available_titles: number; category_count: number };
  signals_available: boolean;
  available_now: CustomerCatalogBook[];
  trending: CustomerCatalogBook[];
  most_borrowed: CustomerCatalogBook[];
  top_rated: CustomerCatalogBook[];
  new_arrivals: CustomerCatalogBook[];
  categories: CatalogCategory[];
};

type RawHome = Omit<CatalogHome, 'available_now' | 'trending' | 'most_borrowed' | 'top_rated' | 'new_arrivals'> &
  Record<'available_now' | 'trending' | 'most_borrowed' | 'top_rated' | 'new_arrivals', PublicCatalogBook[]>;

/** The website's home sections (inventory-service public-catalog buildHome): real loan/rating signals, no client ranking. */
export async function getCatalogHome(): Promise<CatalogHome> {
  const raw = await apiFetch<RawHome>('/public/catalog/home', { skipAuth: true });
  const map = (books: PublicCatalogBook[] | undefined) => (books ?? []).map(toCustomerCatalogBook);
  return {
    stats: raw.stats,
    signals_available: Boolean(raw.signals_available),
    available_now: map(raw.available_now),
    trending: map(raw.trending),
    most_borrowed: map(raw.most_borrowed),
    top_rated: map(raw.top_rated),
    new_arrivals: map(raw.new_arrivals),
    categories: raw.categories ?? [],
  };
}

export type Recommendation = {
  book_id: string;
  title: string;
  author: string | null;
  category: string | null;
  reason: string | null;
  tier?: 'STRONG' | 'GOOD' | 'EXPLORE';
};

export type RecommendationResult = {
  recommendations: Recommendation[];
  /** False when the reader has no history yet: the list is library-wide, not personal. */
  personalized: boolean;
};

/**
 * ai-service POST /recommendations: ranked in code from the caller's own loans,
 * wishlist and ratings (read server-side with the caller's token); the LLM only
 * words each reason. Nothing is ranked on the phone.
 */
export async function getRecommendations(limit = 8): Promise<RecommendationResult> {
  const result = await apiFetch<{ recommendations?: Recommendation[]; personalized?: boolean }>('/ai/recommendations', {
    method: 'POST',
    body: { limit },
    timeoutMs: AI_TIMEOUT_MS,
  });
  return { recommendations: result.recommendations ?? [], personalized: Boolean(result.personalized) };
}

/** Catalog rows (cover, availability) for a set of book ids, in one request. */
export async function getCatalogBooksByIds(ids: string[]): Promise<CustomerCatalogBook[]> {
  if (ids.length === 0) return [];
  const query = new URLSearchParams({ ids: ids.join(','), pageSize: String(ids.length) });
  const result = await apiFetch<{ data: PublicCatalogBook[] }>(`/public/catalog/books?${query.toString()}`, { skipAuth: true });
  return result.data.map(toCustomerCatalogBook);
}
