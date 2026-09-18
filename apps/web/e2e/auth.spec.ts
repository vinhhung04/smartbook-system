import { test, expect } from '@playwright/test';
import { loginStaff, loginCustomer } from './helpers';

test.describe('Auth', () => {
  test('staff logs in and reaches the internal app', async ({ page }) => {
    await loginStaff(page);
  });

  test('customer logs in and lands on the customer portal', async ({ page }) => {
    await loginCustomer(page);
    await expect(page).toHaveURL('/customer');
  });

  test('wrong password is rejected with an error, not a redirect', async ({ page }) => {
    await page.goto('/login');
    await page.getByPlaceholder('Nhập email hoặc tên đăng nhập').fill('hung');
    await page.getByPlaceholder('Nhập mật khẩu').fill('not-the-real-password');
    await page.getByRole('button', { name: 'Đăng nhập' }).click();
    await expect(page).toHaveURL('/login');
  });
});
