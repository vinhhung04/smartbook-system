import { apiFetch } from './client';
import type { CustomerCatalogBook, CustomerCatalogSearchParams } from '../types/customerCatalog';

function buildQuery(params: CustomerCatalogSearchParams): string {
  const query = new URLSearchParams();
  if (params.search) query.set('search', params.search);
  if (params.category) query.set('category', params.category);
  if (params.author) query.set('author', params.author);
  if (params.publisher) query.set('publisher', params.publisher);
  if (params.availability) query.set('availability', params.availability);
  const qs = query.toString();
  return qs ? `?${qs}` : '';
}

// Gateway rewrites /catalog to inventory-service's GET /api/books — same endpoint
// apps/web/src/services/customer-catalog.ts uses. Response is a raw array, not {data: []}.
export function getCatalogBooks(params: CustomerCatalogSearchParams = {}) {
  return apiFetch<CustomerCatalogBook[]>(`/catalog/books${buildQuery(params)}`);
}

export function getCatalogBookById(id: string) {
  return apiFetch<CustomerCatalogBook>(`/catalog/books/${id}`);
}
