import type { CreateReservationPayload } from '../types/borrow';
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

/** Branches a reader may pick the book up at: the public pickup branches the catalog returned
 *  (BRANCH/LIBRARY only — internal warehouses are never in pickup_branches) that still hold a copy. */
export function selectablePickupBranches(book: Pick<CustomerCatalogBook, 'locations'>): CustomerCatalogLocation[] {
  return book.locations.filter((location) => location.available_quantity > 0);
}

/** A lone branch is chosen for the reader; with several the reader has to pick one. */
export function initialPickupBranchId(book: Pick<CustomerCatalogBook, 'locations'>): string | null {
  const branches = selectablePickupBranches(book);
  return branches.length === 1 ? branches[0].warehouse_id : null;
}

/** The POST /my/reservations body for the chosen branch, or null when that branch can't be used.
 *  UX only — borrow-service still forces reservation_channel=CUSTOMER and inventory re-checks
 *  that the warehouse is a public pickup branch with stock. */
export function buildReservationPayload(
  book: Pick<CustomerCatalogBook, 'reservable' | 'variant_id' | 'locations'>,
  branchId: string | null,
): CreateReservationPayload | null {
  if (!book.reservable || !book.variant_id || !branchId) return null;
  if (!selectablePickupBranches(book).some((branch) => branch.warehouse_id === branchId)) return null;
  return { variant_id: book.variant_id, warehouse_id: branchId, quantity: 1 };
}

export function toCustomerCatalogBook(book: PublicCatalogBook): CustomerCatalogBook {
  const branches = book.pickup_branches ?? [];
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
    default_warehouse_id: initialPickupBranchId({ locations }),
    default_location_id: null,
    reservable: Boolean(book.reservable && selectablePickupBranches({ locations }).length > 0),
    is_incomplete: false,
    locations,
  };
}

const STOCK_CHANGED_MESSAGES = [
  'Insufficient available stock',
  'Insufficient available stock to reserve',
  'Selected warehouse is not a valid pickup location',
  'Reservation stock changed concurrently; retry',
];

const RESERVATION_ERROR_MESSAGES: Record<string, string> = {
  'Customer exceeded max active loans limit by membership plan':
    'Bạn đã đạt số sách tối đa theo gói thẻ (tính cả sách đang mượn và đang đặt trước).',
  'Customer does not have active membership': 'Thẻ bạn đọc của bạn chưa có hiệu lực hoặc đã hết hạn.',
  'Customer is not eligible: status must be ACTIVE': 'Tài khoản bạn đọc đang bị tạm khóa, vui lòng liên hệ thư viện.',
  'Variant is not borrowable': 'Ấn bản này hiện không cho mượn.',
};

/** Vietnamese text for a failed reservation. `refresh` means stock changed under the reader
 *  (409 from inventory): reload the book so the branch list shows what is left. */
export function describeReservationError(status: number, message: string): { message: string; refresh: boolean } {
  if (status === 409 && STOCK_CHANGED_MESSAGES.includes(message)) {
    return {
      message: 'Chi nhánh bạn chọn vừa hết sách có thể đặt. Danh sách chi nhánh đã được cập nhật, vui lòng chọn lại.',
      refresh: true,
    };
  }
  if (RESERVATION_ERROR_MESSAGES[message]) return { message: RESERVATION_ERROR_MESSAGES[message], refresh: false };
  // borrow-service already answers some cases in Vietnamese (duplicate reservation, unpaid fines).
  if (status > 0 && status < 500 && /[À-ỹ]/.test(message)) return { message, refresh: false };
  if (status === 0) return { message, refresh: false };
  return { message: 'Không đặt trước được. Vui lòng thử lại sau.', refresh: false };
}
