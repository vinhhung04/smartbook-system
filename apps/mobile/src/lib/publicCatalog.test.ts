import {
  buildReservationPayload,
  describeReservationError,
  initialPickupBranchId,
  selectablePickupBranches,
  toCustomerCatalogBook,
  type PublicCatalogBook,
} from './publicCatalog';

const branchA = { warehouse_id: 'wh-a', warehouse_name: 'Chi nhánh Quận 1', available_quantity: 2 };
const branchB = { warehouse_id: 'wh-b', warehouse_name: 'Chi nhánh Quận 3', available_quantity: 5 };
const library = { warehouse_id: 'wh-lib', warehouse_name: 'Thư viện Trung tâm', available_quantity: 1 };

const base: PublicCatalogBook = {
  id: 'book-1',
  title: 'Dế Mèn Phiêu Lưu Ký',
  author: 'Tô Hoài',
  available_quantity: 8,
  variant_id: 'variant-1',
  reservable: true,
  pickup_branches: [branchA, branchB, library],
};

describe('toCustomerCatalogBook', () => {
  it('lists every public pickup branch with its stock and no longer pre-picks the one with the most copies', () => {
    const book = toCustomerCatalogBook(base);
    expect(book.locations.map((l) => [l.warehouse_id, l.available_quantity])).toEqual([['wh-a', 2], ['wh-b', 5], ['wh-lib', 1]]);
    expect(book.default_warehouse_id).toBeNull();
    expect(book.default_location_id).toBeNull();
    expect(book.available_quantity).toBe(8);
    expect(book.reservable).toBe(true);
  });

  it('pre-selects the only branch when there is exactly one', () => {
    expect(toCustomerCatalogBook({ ...base, pickup_branches: [library] }).default_warehouse_id).toBe('wh-lib');
  });

  it('is not reservable when no branch has a copy, even if the API says reservable', () => {
    const book = toCustomerCatalogBook({ ...base, available_quantity: 0, pickup_branches: [] });
    expect(book.default_warehouse_id).toBeNull();
    expect(book.reservable).toBe(false);
  });

  it('fills optional fields with null so screens can render them uniformly', () => {
    const book = toCustomerCatalogBook({ id: 'b', title: 'T', available_quantity: 0 });
    expect(book.author).toBeNull();
    expect(book.cover_image_url).toBeNull();
    expect(book.variant_id).toBeNull();
    expect(book.locations).toEqual([]);
  });
});

describe('branch selection', () => {
  it('only offers branches that still hold a copy', () => {
    const book = toCustomerCatalogBook({ ...base, pickup_branches: [branchA, { ...branchB, available_quantity: 0 }] });
    expect(selectablePickupBranches(book).map((b) => b.warehouse_id)).toEqual(['wh-a']);
    // one branch left with stock → chosen for the reader
    expect(initialPickupBranchId(book)).toBe('wh-a');
  });

  it('asks the reader to choose when several branches have stock', () => {
    expect(initialPickupBranchId(toCustomerCatalogBook(base))).toBeNull();
  });

  it('never offers a location the public catalog did not return (e.g. an internal warehouse)', () => {
    const book = toCustomerCatalogBook(base);
    expect(buildReservationPayload(book, 'wh-internal-central')).toBeNull();
  });
});

describe('buildReservationPayload', () => {
  it('sends the branch the reader chose — not the one with the most copies', () => {
    const book = toCustomerCatalogBook(base);
    expect(buildReservationPayload(book, 'wh-a')).toEqual({ variant_id: 'variant-1', warehouse_id: 'wh-a', quantity: 1 });
    expect(buildReservationPayload(book, 'wh-lib')).toEqual({ variant_id: 'variant-1', warehouse_id: 'wh-lib', quantity: 1 });
  });

  it('carries no channel/role/customer fields — the backend decides those', () => {
    const payload = buildReservationPayload(toCustomerCatalogBook(base), 'wh-b')!;
    expect(Object.keys(payload).sort()).toEqual(['quantity', 'variant_id', 'warehouse_id']);
  });

  it('refuses no selection, a branch without stock, or a book that is not reservable', () => {
    const book = toCustomerCatalogBook({ ...base, pickup_branches: [branchA, { ...branchB, available_quantity: 0 }] });
    expect(buildReservationPayload(book, null)).toBeNull();
    expect(buildReservationPayload(book, 'wh-b')).toBeNull();
    expect(buildReservationPayload({ ...book, reservable: false }, 'wh-a')).toBeNull();
    expect(buildReservationPayload({ ...book, variant_id: null }, 'wh-a')).toBeNull();
  });
});

describe('describeReservationError', () => {
  it('turns a 409 stock change into a Vietnamese message and asks for a refresh', () => {
    for (const message of ['Insufficient available stock', 'Insufficient available stock to reserve', 'Selected warehouse is not a valid pickup location']) {
      const result = describeReservationError(409, message);
      expect(result.refresh).toBe(true);
      expect(result.message).toMatch(/vui lòng chọn lại/);
    }
  });

  it('translates membership limits and keeps messages the backend already wrote in Vietnamese', () => {
    expect(describeReservationError(409, 'Customer exceeded max active loans limit by membership plan')).toEqual({
      message: 'Bạn đã đạt số sách tối đa theo gói thẻ (tính cả sách đang mượn và đang đặt trước).',
      refresh: false,
    });
    expect(describeReservationError(409, 'Khách đã có một đặt chỗ đang hoạt động cho cuốn sách này').message)
      .toBe('Khách đã có một đặt chỗ đang hoạt động cho cuốn sách này');
  });

  it('never shows raw English server errors', () => {
    expect(describeReservationError(500, 'Internal server error').message).toBe('Không đặt trước được. Vui lòng thử lại sau.');
    expect(describeReservationError(400, 'variant_id is required').message).toBe('Không đặt trước được. Vui lòng thử lại sau.');
  });
});
