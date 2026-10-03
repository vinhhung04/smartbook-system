import { apiFetch } from './client';
import { toCustomerCatalogBook, type PublicCatalogBook } from '../lib/publicCatalog';
import type { CustomerCatalogBook, CustomerCatalogSearchParams } from '../types/customerCatalog';

// Readers see the public catalog (gateway /public/catalog → inventory-service public-catalog.service),
// the same source as the website: stock is counted at pickup branches only and each book lists the
// branches that hold it. The legacy /catalog/books also sums the internal warehouse, which readers
// cannot collect from, so it made the same book read "17" here and "5" on the web.
const PAGE_SIZE = 48; // the endpoint's maximum
const MAX_PAGES = 5;

type PublicCatalogPage = {
  data: PublicCatalogBook[];
  meta: { totalPages: number };
};

function buildQuery(params: CustomerCatalogSearchParams, page: number): string {
  const query = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
  if (params.search) query.set('q', params.search);
  if (params.category) query.set('category', params.category);
  if (params.author) query.set('author', params.author);
  if (params.publisher) query.set('publisher', params.publisher);
  if (params.availability === 'available') query.set('availability', 'available');
  return `?${query.toString()}`;
}

export async function getCatalogBooks(params: CustomerCatalogSearchParams = {}): Promise<CustomerCatalogBook[]> {
  const books: CustomerCatalogBook[] = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const result = await apiFetch<PublicCatalogPage>(`/public/catalog/books${buildQuery(params, page)}`);
    books.push(...result.data.map(toCustomerCatalogBook));
    if (page >= result.meta.totalPages) break;
  }
  return books;
}

export async function getCatalogBookById(id: string): Promise<CustomerCatalogBook> {
  const book = await apiFetch<PublicCatalogBook>(`/public/catalog/books/${id}`);
  return toCustomerCatalogBook(book);
}
