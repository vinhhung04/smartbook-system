import type { Recommendation } from '../api/customerHome';
import type { CustomerCatalogBook } from '../types/customerCatalog';

export type RecommendedBook = { book: CustomerCatalogBook; reason: string | null };

/**
 * Joins the AI ranking with live catalog rows, keeping the AI's order. A recommended id
 * the public catalog no longer lists (unpublished, no pickup branch) is dropped rather
 * than shown as a card that opens a "not found" page.
 */
export function buildRecommendationShelf(recommendations: Recommendation[], books: CustomerCatalogBook[]): RecommendedBook[] {
  const byId = new Map(books.map((book) => [book.id, book]));
  const seen = new Set<string>();
  const shelf: RecommendedBook[] = [];
  for (const recommendation of recommendations) {
    const book = byId.get(recommendation.book_id);
    if (!book || seen.has(book.id)) continue;
    seen.add(book.id);
    shelf.push({ book, reason: recommendation.reason?.trim() || null });
  }
  return shelf;
}
