import { apiFetch } from './client';
import { toCustomerCatalogBook, type PublicCatalogBook } from '../lib/publicCatalog';
import type { CatalogPage } from '../lib/catalogPagination';
import type { CustomerCatalogBook, CustomerCatalogSearchParams } from '../types/customerCatalog';

// Readers see the public catalog (gateway /public/catalog → inventory-service public-catalog.service),
// the same source as the website: stock is counted at pickup branches only and each book lists the
// branches that hold it. The legacy /catalog/books also sums the internal warehouse, which readers
// cannot collect from, so it made the same book read "17" here and "5" on the web.
// Screens load the catalog one page at a time (see lib/catalogPagination.ts),
// so a library of any size is reachable without fetching it all up front.
export const CATALOG_PAGE_SIZE = 24;

type PublicCatalogPage = {
  data: PublicCatalogBook[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
};

function buildQuery(params: CustomerCatalogSearchParams, page: number): string {
  const query = new URLSearchParams({ page: String(page), pageSize: String(CATALOG_PAGE_SIZE) });
  if (params.search) query.set('q', params.search);
  if (params.category) query.set('category', params.category);
  if (params.author) query.set('author', params.author);
  if (params.publisher) query.set('publisher', params.publisher);
  if (params.availability === 'available') query.set('availability', 'available');
  return `?${query.toString()}`;
}

/** One page of the public catalog, with the API's own paging metadata. */
export async function getCatalogPage(params: CustomerCatalogSearchParams, page: number): Promise<CatalogPage> {
  const result = await apiFetch<PublicCatalogPage>(`/public/catalog/books${buildQuery(params, page)}`);
  return {
    items: result.data.map(toCustomerCatalogBook),
    page: result.meta.page,
    totalPages: result.meta.totalPages,
    total: result.meta.total,
  };
}

export async function getCatalogBookById(id: string): Promise<CustomerCatalogBook> {
  const book = await apiFetch<PublicCatalogBook>(`/public/catalog/books/${id}`);
  return toCustomerCatalogBook(book);
}
