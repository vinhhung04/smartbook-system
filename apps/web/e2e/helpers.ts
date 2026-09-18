import { expect, type Page } from '@playwright/test';

export const DEMO_PASSWORD = '123456';

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
  await expect(page.getByRole('button', { name: 'Toggle sidebar' })).toBeVisible({ timeout: 15_000 });
}

/** Customer portal login (`/customer`). Demo account seeded by `pnpm demo:seed`. */
export async function loginCustomer(page: Page, username = 'customer01') {
  await page.goto('/customer/login');
  await page.getByPlaceholder('Nhập email hoặc tên đăng nhập').fill(username);
  await page.getByPlaceholder('Nhập mật khẩu').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await expect(page).toHaveURL('/customer', { timeout: 15_000 });
}
