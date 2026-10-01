import axios from 'axios';

const gatewayBaseURL = import.meta.env.VITE_GATEWAY_BASE_URL || 'http://localhost:3000';

// Anonymous client: the public catalog never needs (or sends) the reader's token,
// so a stale or revoked token can't turn a browse into a 401.
const publicAPI = axios.create({ baseURL: `${gatewayBaseURL}/public`, timeout: 15_000 });

export interface PickupBranch {
  warehouse_id: string;
  warehouse_name: string;
  available_quantity: number;
}

export interface PublicBookSignals {
  /** Loans in the last borrow window (365 days by default). */
  borrow_count: number;
  /** Loans + reservations + wishlist adds in the recent window (90 days by default). */
  recent_activity: number;
  rating_avg: number;
  rating_count: number;
}

export interface PublicBook {
  id: string;
  title: string;
  subtitle: string | null;
  author: string | null;
  authors: string[];
  category: string | null;
  category_slug: string | null;
  categories: Array<{ name: string; slug: string }>;
  publisher: string | null;
  isbn: string | null;
  language: string | null;
  publish_year: number | null;
  cover_image_url: string | null;
  available_quantity: number;
  availability_status: 'AVAILABLE' | 'INCOMING' | 'UNAVAILABLE';
  reservable: boolean;
  variant_id: string | null;
  pickup_branches: PickupBranch[];
  created_at: string;
  signals: PublicBookSignals | null;
}

export interface PublicBookDetail extends PublicBook {
  description: string | null;
  summary_vi: string | null;
  page_count: number | null;
  published_date: string | null;
  edition: string | null;
  related: PublicBook[];
}

export interface PublicCategory {
  name: string;
  slug: string;
  book_count: number;
  available_count: number;
  covers: string[];
}

export interface FacetValue<T = string> {
  value: T;
  count: number;
}

export interface CatalogFacets {
  categories: Array<{ name: string; slug: string; count: number }>;
  authors: FacetValue[];
  publishers: FacetValue[];
  languages: FacetValue[];
  years: FacetValue<number>[];
}

export type CatalogSort = 'relevance' | 'popular' | 'newest' | 'rating' | 'title';

export interface CatalogQuery {
  q?: string;
  category?: string;
  author?: string;
  publisher?: string;
  language?: string;
  year?: string;
  availability?: 'available' | '';
  sort?: CatalogSort | '';
  page?: number;
  pageSize?: number;
}

export interface CatalogPage {
  data: PublicBook[];
  meta: { page: number; pageSize: number; total: number; totalPages: number; sort: CatalogSort };
  facets: CatalogFacets;
  signals_available: boolean;
}

export interface PublicHome {
  generated_at: string;
  stats: { total_titles: number; available_titles: number; category_count: number };
  signals_available: boolean;
  windows: { borrow_days: number; recent_days: number } | null;
  /** Reservable today (copies on a shelf), most borrowed first. */
  available_now: PublicBook[];
  trending: PublicBook[];
  most_borrowed: PublicBook[];
  top_rated: PublicBook[];
  new_arrivals: PublicBook[];
  categories: PublicCategory[];
}

export interface PublicReview {
  id: string;
  rating: number;
  comment: string | null;
  created_at: string;
  reviewer_name: string;
}

export interface PublicReviewPage {
  data: PublicReview[];
  stats: { averageRating: number; totalReviews: number; distribution: Record<1 | 2 | 3 | 4 | 5, number> };
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}

export interface DiscoverResult {
  query: string;
  status: 'CONFIDENT_MATCH' | 'UNCERTAIN' | 'NO_EVIDENCE';
  semantic_used: boolean;
  cached: boolean;
  /** Every book here was re-read from the public catalog — none are generated. */
  results: Array<{ book: PublicBook; matched: Array<'semantic' | 'keyword'> }>;
}

function compact(query: CatalogQuery) {
  return Object.fromEntries(Object.entries(query).filter(([, value]) => value !== '' && value !== undefined && value !== null));
}

export const publicCatalogService = {
  async getHome(): Promise<PublicHome> {
    return (await publicAPI.get('/catalog/home')).data;
  },
  async getBooks(query: CatalogQuery, signal?: AbortSignal): Promise<CatalogPage> {
    return (await publicAPI.get('/catalog/books', { params: compact(query), signal })).data;
  },
  async getBook(id: string): Promise<PublicBookDetail> {
    return (await publicAPI.get(`/catalog/books/${encodeURIComponent(id)}`)).data;
  },
  async getCategories(): Promise<PublicCategory[]> {
    return (await publicAPI.get('/catalog/categories')).data?.data ?? [];
  },
  async discover(q: string, signal?: AbortSignal): Promise<DiscoverResult> {
    return (await publicAPI.get('/discover', { params: { q }, signal, timeout: 20_000 })).data;
  },
  async getReviews(bookId: string, page = 1): Promise<PublicReviewPage> {
    return (await publicAPI.get(`/reviews/book/${encodeURIComponent(bookId)}`, { params: { page, pageSize: 10 } })).data;
  },
};
