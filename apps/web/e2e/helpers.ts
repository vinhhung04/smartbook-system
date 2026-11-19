import { expect, type Page } from '@playwright/test';

export const DEMO_PASSWORD = process.env.DEMO_PASSWORD || '123456';

/**
 * Staff/admin login (internal app). Demo account seeded by `pnpm demo:seed`.
 * Post-login landing page is role-dependent (see getHomePathForUser in lib/rbac.ts —
 * e.g. ADMIN lands on /users, not /), so this only asserts we left /login.
 */
export async function loginStaff(page: Page, username = 'hung') {
  await page.goto('/login');
  await page.getByPlaceholder('Nhập email hoặc tên đăng nhập').fill(username);
  await page.getByPlaceholder('Nhập mật khẩu').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await expect(page).not.toHaveURL(/\/login$/, { timeout: 15_000 });
  // Wide screens show the sidebar toggle; phones show the topbar menu button instead.
  await expect(page.getByRole('button', { name: 'Toggle sidebar' }).or(page.getByRole('button', { name: 'Mở menu' })).first()).toBeVisible({ timeout: 15_000 });
}

/** Customer portal login (`/customer`). Demo account seeded by `pnpm demo:seed`. */
export async function loginCustomer(page: Page, username = 'customer01') {
  await page.goto('/customer/login');
  await page.getByPlaceholder('Nhập email hoặc tên đăng nhập').fill(username);
  await page.getByPlaceholder('Nhập mật khẩu').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await expect(page).toHaveURL('/customer', { timeout: 15_000 });
}

/**
 * Finish the staff "Xác nhận trả sách" dialog (ADR-001 shelf-based return):
 * every copy keeps condition "Tốt" and goes back on the branch's first shelf
 * compartment, then confirm and wait for the success toast.
 */
export async function confirmShelfReturn(page: Page) {
  const dialog = page.getByRole('alertdialog', { name: 'Xác nhận trả sách' });
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  const shelfSelects = dialog.locator('select[aria-label^="Vị trí trả về "]:not([aria-label="Vị trí trả về cho tất cả"])');
  await expect(shelfSelects.first()).toBeVisible();
  for (const select of await shelfSelects.all()) {
    // Branch locations also include a RECEIVING dock; a returned copy goes on a shelf.
    const shelf = select.locator('option', { hasText: 'SHELF' }).first();
    await expect(shelf).toBeAttached({ timeout: 10_000 });
    await select.selectOption((await shelf.getAttribute('value'))!);
  }
  // Confirm is refused until the deposit/fine preview has loaded.
  await expect(dialog.getByText(/Hoàn cọc/).first()).toBeVisible({ timeout: 10_000 });
  await dialog.getByTestId('confirm-dialog-action').click();
  await expect(page.locator('[data-sonner-toast]').filter({ hasText: 'Đã trả sách thành công' })).toBeVisible({ timeout: 10_000 });
  await expect(dialog).toBeHidden();
}
