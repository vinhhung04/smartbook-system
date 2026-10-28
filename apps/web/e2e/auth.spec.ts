import { test, expect } from '@playwright/test';
import { DEMO_PASSWORD, loginStaff, loginCustomer } from './helpers';

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
    // One message for any 401, so the page never says whether the account exists.
    await expect(page.getByText('Tên đăng nhập hoặc mật khẩu không đúng.')).toBeVisible();
    await expect(page.getByPlaceholder('Nhập mật khẩu')).toBeFocused();
  });

  test('empty fields are flagged next to each field, without a request', async ({ page }) => {
    await page.goto('/login');
    await page.getByTestId('login-submit').click();
    const identifier = page.getByPlaceholder('Nhập email hoặc tên đăng nhập');
    await expect(identifier).toHaveAttribute('aria-invalid', 'true');
    await expect(identifier).toBeFocused();
    await expect(page.locator('#login-password-error')).toBeVisible();
    await identifier.fill('hung');
    await expect(page.locator('#login-identifier-error')).toHaveCount(0);
  });

  test('a staff account is refused on the reader portal and its session cleared', async ({ page }) => {
    await page.goto('/customer/login');
    await page.getByPlaceholder('Nhập email hoặc tên đăng nhập').fill('hung');
    await page.getByPlaceholder('Nhập mật khẩu').fill(DEMO_PASSWORD);
    await page.getByTestId('customer-login-submit').click();
    await expect(page.getByText(/không phải tài khoản bạn đọc/)).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveURL(/\/customer\/login/);
    expect(await page.evaluate(() => Object.keys(localStorage).some((key) => /token/i.test(key)))).toBe(false);
  });

  test('reader returns to the book after login and only the identifier is remembered', async ({ page }) => {
    const back = '/books?availability=available';
    await page.goto(`/customer/login?returnUrl=${encodeURIComponent(back)}`);
    await page.getByPlaceholder('Nhập email hoặc tên đăng nhập').fill('customer01');
    await page.getByPlaceholder('Nhập mật khẩu').fill(DEMO_PASSWORD);
    await page.getByLabel('Ghi nhớ tài khoản').check();
    await page.getByTestId('customer-login-submit').click();
    await expect(page).toHaveURL(back, { timeout: 15_000 });

    const stored = await page.evaluate(() => JSON.stringify(localStorage));
    expect(stored).not.toContain(DEMO_PASSWORD);
    // Drop the session but keep the remembered identifier, then come back.
    await page.evaluate(() => {
      for (const key of Object.keys(localStorage)) if (!/remember|saved-identifier/.test(key)) localStorage.removeItem(key);
    });
    await page.goto('/customer/login');
    await expect(page.getByPlaceholder('Nhập email hoặc tên đăng nhập')).toHaveValue('customer01');
  });
});
