// Mirrors apps/web/src/services/customer-catalog.ts CustomerCatalogBook exactly —
// GET /catalog/books and GET /catalog/books/:id return this shape as-is (no wrapper).
// Kept separate from types/catalog.ts, which is the warehouse-staff lookup shape
// (BookSummary/BarcodeResolveResult) used by src/api/catalog.ts.
export type CustomerCatalogLocation = {
  warehouse_id: string;
  warehouse_name: string;
  location_id: string | null;
  available_quantity: number;
};

export type CustomerCatalogBook = {
  id: string;
  title: string;
  subtitle: string | null;
  description: string | null;
  author: string | null;
  category: string | null;
  publisher: string | null;
  isbn: string | null;
  language: string | null;
  publish_year: number | null;
  summary_vi: string | null;
  cover_image_url: string | null;
  quantity: number;
  available_quantity: number;
  variant_id: string | null;
  default_warehouse_id: string | null;
  default_location_id: string | null;
  reservable: boolean;
  is_incomplete: boolean;
  locations: CustomerCatalogLocation[];
};

export type CatalogAvailabilityFilter = 'available' | 'unavailable' | '';

export type CustomerCatalogSearchParams = {
  search?: string;
  category?: string;
  author?: string;
  publisher?: string;
  availability?: CatalogAvailabilityFilter;
};
