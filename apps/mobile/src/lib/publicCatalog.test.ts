import { describePickup, pickBestBranch, toCustomerCatalogBook, type PublicCatalogBook } from './publicCatalog';

const branchA = { warehouse_id: 'wh-a', warehouse_name: 'Chi nhánh Quận 1', available_quantity: 2 };
const branchB = { warehouse_id: 'wh-b', warehouse_name: 'Chi nhánh Quận 3', available_quantity: 5 };

describe('pickBestBranch', () => {
  it('picks the branch with the most copies', () => {
    expect(pickBestBranch([branchA, branchB])).toBe(branchB);
  });

  it('keeps the first branch on a tie', () => {
    const tie = { ...branchB, warehouse_id: 'wh-c', available_quantity: 2 };
    expect(pickBestBranch([branchA, tie])).toBe(branchA);
  });

  it('ignores branches without stock and returns null when none have any', () => {
    expect(pickBestBranch([{ ...branchA, available_quantity: 0 }])).toBeNull();
    expect(pickBestBranch([])).toBeNull();
    expect(pickBestBranch(undefined)).toBeNull();
  });
});

describe('toCustomerCatalogBook', () => {
  const base: PublicCatalogBook = {
    id: 'book-1',
    title: 'Dế Mèn Phiêu Lưu Ký',
    author: 'Nam Cao',
    available_quantity: 7,
    variant_id: 'variant-1',
    reservable: true,
    pickup_branches: [branchA, branchB],
  };

  it('reserves at the best branch, never at an internal warehouse, and reports branch stock only', () => {
    const book = toCustomerCatalogBook(base);
    expect(book.default_warehouse_id).toBe('wh-b');
    expect(book.default_location_id).toBeNull();
    expect(book.available_quantity).toBe(7);
    expect(book.reservable).toBe(true);
    expect(book.locations.map((l) => l.warehouse_id)).toEqual(['wh-a', 'wh-b']);
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

describe('describePickup', () => {
  it('names the chosen branch and counts the other branches that also have stock', () => {
    const book = toCustomerCatalogBook({ id: 'b', title: 'T', available_quantity: 7, reservable: true, variant_id: 'v', pickup_branches: [branchA, branchB] });
    expect(describePickup(book)).toBe('Chi nhánh Quận 3 (+1 chi nhánh khác)');
  });

  it('names a single branch plainly and shows a dash when there is none', () => {
    const one = toCustomerCatalogBook({ id: 'b', title: 'T', available_quantity: 2, reservable: true, variant_id: 'v', pickup_branches: [branchA] });
    expect(describePickup(one)).toBe('Chi nhánh Quận 1');
    expect(describePickup(toCustomerCatalogBook({ id: 'b', title: 'T', available_quantity: 0 }))).toBe('—');
  });
});
