import { test, expect, type APIRequestContext } from '@playwright/test';
import { DEMO_PASSWORD, loginCustomer, loginStaff } from './helpers';

/**
 * Public discovery website: anonymous visitors browse, search and open books;
 * login is only asked for when they act (reserve, wishlist, review), and they
 * come back to the same book afterwards.
 */
const GATEWAY = process.env.GATEWAY_URL || 'http://localhost:3000';

async function findReservableBook(request: APIRequestContext) {
  const response = await request.get(`${GATEWAY}/public/catalog/books`, { params: { availability: 'available', pageSize: '48' } });
  expect(response.status()).toBe(200);
  const body = await response.json();
  const book = body.data.find((item: { reservable: boolean }) => item.reservable);
  expect(book, 'seeded catalog needs at least one reservable book (pnpm demo:seed)').toBeTruthy();
  return book as { id: string; title: string };
}

interface BranchSummary {
  id: string;
  name: string;
  stats: { title_count: number; available_title_count: number; available_copies: number };
}

/** A branch with something reservable on its shelves (demo data from pnpm demo:seed). */
async function findStockedBranch(request: APIRequestContext) {
  const response = await request.get(`${GATEWAY}/public/catalog/branches`);
  expect(response.status()).toBe(200);
  const branches = (await response.json()).data as BranchSummary[];
  const branch = branches.find((item) => item.stats.available_title_count > 0);
  expect(branch, 'seeded data needs a branch with a reservable book (pnpm demo:seed)').toBeTruthy();
  return branch as BranchSummary;
}

test.describe('Anonymous discovery', () => {
  test('homepage → catalog → search → book detail → reserve asks for login', async ({ page, request }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'Khám phá cuốn sách tiếp theo của bạn.' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Đăng nhập' }).first()).toBeVisible();

    await page.getByRole('link', { name: /Khám phá toàn bộ \d+ đầu sách/ }).click();
    await expect(page).toHaveURL(/\/books$/);
    const firstCard = page.locator('article').first();
    await expect(firstCard).toBeVisible({ timeout: 15_000 });

    // Search with a word from a real title; the query lives in the URL.
    const title = (await firstCard.locator('h3').innerText()).trim();
    const word = title.split(/\s+/).find((part) => part.length >= 3) || title;
    await page.getByRole('searchbox', { name: 'Tìm trong danh mục' }).fill(word);
    await expect(page).toHaveURL(/[?&]q=/);
    await expect(page.locator('article').first()).toBeVisible();
    await page.reload();
    await expect(page.getByRole('searchbox', { name: 'Tìm trong danh mục' })).toHaveValue(word);

    // Book detail is public too.
    const book = await findReservableBook(request);
    await page.goto(`/books/${book.id}`);
    await expect(page.getByRole('heading', { level: 1, name: book.title })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Đánh giá của bạn đọc' })).toBeVisible();

    await page.getByTestId('reserve-book-button').click();
    await expect(page).toHaveURL(`/customer/login?returnUrl=${encodeURIComponent(`/books/${book.id}?reserve=1`)}`);
  });

  test('after login the reader returns to the same book and the reservation step reopens', async ({ page, request }) => {
    const book = await findReservableBook(request);
    await page.goto(`/books/${book.id}`);
    await page.getByTestId('reserve-book-button').click();
    await expect(page).toHaveURL(/\/customer\/login\?returnUrl=/);

    await page.getByPlaceholder('Nhập email hoặc tên đăng nhập').fill('customer01');
    await page.getByPlaceholder('Nhập mật khẩu').fill(DEMO_PASSWORD);
    await page.getByRole('button', { name: 'Đăng nhập' }).click();

    await expect(page).toHaveURL(`/books/${book.id}`, { timeout: 15_000 });
    const dialog = page.getByRole('dialog', { name: 'Chọn cửa hàng đặt trước' });
    await expect(dialog).toBeVisible();
    // Don't actually reserve: this test must not drain demo stock.
    await dialog.getByRole('button', { name: 'Hủy' }).click();
    await expect(dialog).toBeHidden();
  });

  test('typeahead suggests real books and Enter opens the highlighted one', async ({ page, request }) => {
    const book = await findReservableBook(request);
    await page.goto('/');
    const search = page.getByRole('combobox', { name: 'Tìm sách' }).first();
    await search.fill(book.title.slice(0, 8));
    // Wait for the book itself, not the always-present "Xem tất cả kết quả" option.
    const option = page.getByRole('option').filter({ hasText: book.title }).first();
    await expect(option).toBeVisible({ timeout: 10_000 });
    await search.press('ArrowDown');
    await expect(page.getByRole('option', { selected: true })).toContainText(book.title);
    await search.press('Enter');
    await expect(page).toHaveURL(`/books/${book.id}`);
  });

  test('a borrowed-out book offers an availability alert that asks for login', async ({ page, request }) => {
    const response = await request.get(`${GATEWAY}/public/catalog/books`, { params: { pageSize: '48' } });
    const unavailable = (await response.json()).data.find((item: { reservable: boolean }) => !item.reservable);
    test.skip(!unavailable, 'every book is currently reservable');
    await page.goto(`/books/${unavailable.id}`);
    await page.getByRole('button', { name: 'Báo khi có sách' }).first().click();
    await expect(page).toHaveURL(`/customer/login?returnUrl=${encodeURIComponent(`/books/${unavailable.id}`)}`);
  });

  test('account pages still require login and keep the return path', async ({ page }) => {
    await page.goto('/customer/loans');
    await expect(page).toHaveURL(`/customer/login?returnUrl=${encodeURIComponent('/customer/loans')}`);

    await page.goto('/my/wishlist');
    await expect(page).toHaveURL(`/customer/login?returnUrl=${encodeURIComponent('/customer/wishlist')}`);

    await page.goto('/inventory');
    await expect(page).toHaveURL(`/login?returnUrl=${encodeURIComponent('/inventory')}`);
  });
});

test.describe('Branches (anonymous)', () => {
  test('header → branches → branch → its books → book detail, never asked to log in', async ({ page, request }) => {
    const branch = await findStockedBranch(request);
    await page.goto('/');
    await page.getByRole('navigation', { name: 'Điều hướng chính' }).getByRole('link', { name: 'Chi nhánh' }).click();
    await expect(page).toHaveURL('/branches');
    await expect(page.getByRole('heading', { level: 1, name: 'Tìm chi nhánh SmartBook gần bạn' })).toBeVisible();

    await page.getByRole('link', { name: `Xem chi tiết ${branch.name}` }).click();
    await expect(page).toHaveURL(`/branches/${branch.id}`);
    await expect(page.getByRole('heading', { level: 1, name: branch.name })).toBeVisible();
    await expect(page.getByText('Đang hoạt động').first()).toBeVisible();

    await page.getByRole('link', { name: 'Khám phá sách tại chi nhánh này' }).click();
    await expect(page).toHaveURL(`/books?branch=${branch.id}&availability=available`);
    await expect(page.getByRole('heading', { level: 1, name: `Sách tại ${branch.name}` })).toBeVisible();
    await expect(page.getByRole('switch', { name: 'Có sẵn tại chi nhánh' })).toHaveAttribute('aria-checked', 'true');

    // Other catalog state combines with the branch and lives in the URL.
    await page.getByRole('combobox', { name: 'Sắp xếp' }).selectOption('title');
    await expect(page).toHaveURL(new RegExp(`branch=${branch.id}`));
    await expect(page).toHaveURL(/sort=title/);
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: `Sách tại ${branch.name}` })).toBeVisible();

    const card = page.locator('article').first();
    await expect(card).toBeVisible({ timeout: 15_000 });
    const title = (await card.locator('h3').innerText()).trim();
    await card.locator('h3 a').click();
    await expect(page).toHaveURL(/\/books\/[0-9a-f-]{36}$/);
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
    // Reservable at this branch, so the book page offers it for pickup and links back.
    const pickup = page.getByRole('list', { name: 'Chi nhánh còn sách' }).getByRole('link', { name: branch.name });
    await expect(pickup).toBeVisible();
    await pickup.click();
    await expect(page).toHaveURL(`/branches/${branch.id}`);
  });

  test('an unknown branch is a clear empty state, not the whole catalog or a crash', async ({ page }) => {
    await page.goto('/books?branch=00000000-0000-4000-8000-000000000000');
    await expect(page.getByText('Không tìm thấy chi nhánh này')).toBeVisible();
    await page.goto('/branches/00000000-0000-4000-8000-000000000000');
    await expect(page.getByText('Không tìm thấy chi nhánh', { exact: true })).toBeVisible();
  });
});

test.describe('Membership', () => {
  test('anonymous: real plans, and "Tạo tài khoản" registers then returns to the card', async ({ page, request }) => {
    const plans = (await (await request.get(`${GATEWAY}/public/membership/plans`)).json()).data as Array<{ name: string }>;
    await page.goto('/membership');
    await expect(page.getByRole('heading', { level: 1, name: 'Đọc nhiều hơn với tài khoản SmartBook' })).toBeVisible();
    for (const plan of plans) {
      await expect(page.getByRole('heading', { level: 3, name: plan.name })).toBeVisible();
    }
    await page.getByRole('link', { name: 'Tạo tài khoản', exact: true }).first().click();
    await expect(page).toHaveURL(`/customer/register?returnUrl=${encodeURIComponent('/customer/membership')}`);
  });

  test('customer: the call to action opens their own card', async ({ page }) => {
    await loginCustomer(page);
    await page.goto('/membership');
    await expect(page.getByRole('link', { name: 'Tạo tài khoản', exact: true })).toHaveCount(0);
    await page.getByRole('link', { name: 'Xem thẻ bạn đọc của tôi' }).first().click();
    await expect(page).toHaveURL('/customer/membership');
  });
});

test.describe('Public API security', () => {
  test('anonymous reads are allowed and never carry internal fields', async ({ request }) => {
    const list = await request.get(`${GATEWAY}/public/catalog/books`, { params: { pageSize: '48' } });
    expect(list.status()).toBe(200);
    const listText = await list.text();
    for (const field of ['unit_cost', 'list_price', 'location_code', '"sku"', 'internal_barcode']) {
      expect(listText).not.toContain(field);
    }

    const book = (await list.json()).data[0];
    const detail = await request.get(`${GATEWAY}/public/catalog/books/${book.id}`);
    expect(detail.status()).toBe(200);
    const detailText = await detail.text();
    for (const field of ['unit_cost', 'list_price', 'location_code', '"sku"', 'internal_barcode', 'metadata']) {
      expect(detailText).not.toContain(field);
    }

    const search = await request.get(`${GATEWAY}/public/catalog/books`, { params: { q: book.title.slice(0, 6) } });
    expect(search.status()).toBe(200);

    expect((await request.get(`${GATEWAY}/public/catalog/home`)).status()).toBe(200);
    expect((await request.get(`${GATEWAY}/public/catalog/categories`)).status()).toBe(200);

    const branches = await request.get(`${GATEWAY}/public/catalog/branches`);
    expect(branches.status()).toBe(200);
    const branchesText = await branches.text();
    for (const field of ['"code"', 'warehouse_type', 'manager_user_id', 'location_code', 'on_hand_qty', 'reserved_qty']) {
      expect(branchesText).not.toContain(field);
    }
    const branchList = JSON.parse(branchesText).data as BranchSummary[];
    if (branchList.length) {
      const branchDetail = await request.get(`${GATEWAY}/public/catalog/branches/${branchList[0].id}`);
      expect(branchDetail.status()).toBe(200);
      const branchDetailText = await branchDetail.text();
      for (const field of ['"code"', 'warehouse_type', 'manager_user_id', 'location_code', 'unit_cost', '"sku"']) {
        expect(branchDetailText).not.toContain(field);
      }
      const filtered = await request.get(`${GATEWAY}/public/catalog/books`, { params: { branch: branchList[0].id } });
      expect((await filtered.json()).branch).toEqual({ id: branchList[0].id, name: branchList[0].name });
    }
    expect((await request.get(`${GATEWAY}/public/catalog/branches/not-a-uuid`)).status()).toBe(404);
    const badBranch = await request.get(`${GATEWAY}/public/catalog/books`, { params: { branch: 'not-a-uuid' } });
    expect(badBranch.status()).toBe(200);
    expect((await badBranch.json()).meta.total).toBe(0);

    const plans = await request.get(`${GATEWAY}/public/membership/plans`);
    expect(plans.status()).toBe(200);
    const plansText = await plans.text();
    for (const field of ['"code"', 'created_at', 'updated_at', '"_count"', 'customer_memberships', 'card_number']) {
      expect(plansText).not.toContain(field);
    }

    const reviews = await request.get(`${GATEWAY}/public/reviews/book/${book.id}`);
    expect(reviews.status()).toBe(200);
    const reviewsText = await reviews.text();
    expect(reviewsText).not.toContain('customer_code');
    expect(reviewsText).not.toContain('customer_id');
  });

  test('anonymous writes are rejected', async ({ request }) => {
    const reserve = await request.post(`${GATEWAY}/my/reservations`, { data: { variant_id: 'x', warehouse_id: 'y' } });
    expect([401, 403]).toContain(reserve.status());
    const wishlist = await request.post(`${GATEWAY}/my/wishlists`, { data: { book_id: 'x' } });
    expect([401, 403]).toContain(wishlist.status());
    const review = await request.post(`${GATEWAY}/my/reviews`, { data: { book_id: 'x', rating: 5 } });
    expect([401, 403]).toContain(review.status());
    expect([401, 403]).toContain((await request.get(`${GATEWAY}/my/loans`)).status());

    // /public is read-only at the gateway, whatever the path.
    expect((await request.post(`${GATEWAY}/public/catalog/books`, { data: {} })).status()).toBe(405);
    expect((await request.delete(`${GATEWAY}/public/reviews/book/x`)).status()).toBe(405);
    expect((await request.post(`${GATEWAY}/public/membership/plans`, { data: { name: 'x' } })).status()).toBe(405);
    expect((await request.put(`${GATEWAY}/public/membership/plans`, { data: {} })).status()).toBe(405);
    expect((await request.delete(`${GATEWAY}/public/catalog/branches/x`)).status()).toBe(405);
    // The authenticated catalog (cost, shelf locations) is still behind a token.
    expect([401, 403]).toContain((await request.get(`${GATEWAY}/catalog/books`)).status());
  });
});

test.describe('Signed-in users', () => {
  test('customer sees account navigation on the public site', async ({ page }) => {
    await loginCustomer(page);
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'Sách của tôi' }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Đăng nhập', exact: true })).toHaveCount(0);
  });

  test('staff keep the internal app and get a way back to it from the public site', async ({ page }) => {
    await loginStaff(page);
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'Trang quản lý' }).first()).toBeVisible();
    await page.getByRole('link', { name: 'Trang quản lý' }).first().click();
    await expect(page.getByRole('button', { name: 'Toggle sidebar' })).toBeVisible({ timeout: 15_000 });
  });
});
