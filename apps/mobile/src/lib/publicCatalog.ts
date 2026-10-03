import type { CustomerCatalogBook, CustomerCatalogLocation } from '../types/customerCatalog';

// Shape of GET /public/catalog/books[/:id] (inventory-service public-catalog.service.js) — only the
// fields the mobile customer screens use. The public catalog counts stock at reader pickup
// branches only (BRANCH/LIBRARY), unlike the legacy /catalog/books which also sums the internal
// warehouse, so web and mobile now show the same availability.
export type PublicPickupBranch = {
  warehouse_id: string;
  warehouse_name: string;
  available_quantity: number;
};

export type PublicCatalogBook = {
  id: string;
  title: string;
  subtitle?: string | null;
  description?: string | null;
  summary_vi?: string | null;
  author?: string | null;
  category?: string | null;
  publisher?: string | null;
  isbn?: string | null;
  language?: string | null;
  publish_year?: number | null;
  cover_image_url?: string | null;
  available_quantity: number;
  variant_id?: string | null;
  reservable?: boolean;
  pickup_branches?: PublicPickupBranch[];
};

// The branch holding the most copies; the first one wins a tie so the choice is stable.
export function pickBestBranch(branches: PublicPickupBranch[] | undefined | null): PublicPickupBranch | null {
  let best: PublicPickupBranch | null = null;
  for (const branch of branches ?? []) {
    if (branch.available_quantity > 0 && (!best || branch.available_quantity > best.available_quantity)) {
      best = branch;
    }
  }
  return best;
}

export function toCustomerCatalogBook(book: PublicCatalogBook): CustomerCatalogBook {
  const branches = book.pickup_branches ?? [];
  const best = pickBestBranch(branches);
  const locations: CustomerCatalogLocation[] = branches.map((branch) => ({
    warehouse_id: branch.warehouse_id,
    warehouse_name: branch.warehouse_name,
    location_id: null,
    available_quantity: branch.available_quantity,
  }));

  return {
    id: book.id,
    title: book.title,
    subtitle: book.subtitle ?? null,
    description: book.description ?? null,
    author: book.author ?? null,
    category: book.category ?? null,
    publisher: book.publisher ?? null,
    isbn: book.isbn ?? null,
    language: book.language ?? null,
    publish_year: book.publish_year ?? null,
    summary_vi: book.summary_vi ?? null,
    cover_image_url: book.cover_image_url ?? null,
    quantity: book.available_quantity,
    available_quantity: book.available_quantity,
    variant_id: book.variant_id ?? null,
    default_warehouse_id: best?.warehouse_id ?? null,
    default_location_id: null,
    reservable: Boolean(book.reservable && best),
    is_incomplete: false,
    locations,
  };
}

export function describePickup(book: Pick<CustomerCatalogBook, 'default_warehouse_id' | 'locations'>): string {
  const best = book.locations.find((location) => location.warehouse_id === book.default_warehouse_id);
  if (!best) return '—';
  const others = book.locations.filter((location) => location.available_quantity > 0 && location.warehouse_id !== best.warehouse_id).length;
  return others > 0 ? `${best.warehouse_name} (+${others} chi nhánh khác)` : best.warehouse_name;
}
