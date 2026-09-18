import type { Page } from '@playwright/test';

export async function loginAs(page: Page, { identifier, password }: { identifier: string; password: string }) {
  await page.goto('/login');
  await page.locator('#login-identifier').fill(identifier);
  await page.locator('#login-password').fill(password);
  await page.getByTestId('login-submit').click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));
}

export async function loginAsCustomer(page: Page, { identifier, password }: { identifier: string; password: string }) {
  await page.goto('/customer/login');
  await page.locator('#identifier').fill(identifier);
  await page.locator('#password').fill(password);
  await page.getByTestId('customer-login-submit').click();
  await page.waitForURL((url) => !url.pathname.startsWith('/customer/login'));
}

export async function logout(page: Page) {
  await page.evaluate(() => {
    localStorage.removeItem('token');
    localStorage.removeItem('auth_user');
  });
}
