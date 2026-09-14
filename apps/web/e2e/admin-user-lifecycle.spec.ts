import { test, expect } from '@playwright/test';
import { loginAs, logout } from './helpers/auth';

// Golden flow #3: admin creates a user, assigns a role, then locks the
// account. A locked account is rejected by the backend at login itself
// (403 "User is not active", services/auth-service/src/controllers/
// auth.controller.js:417-419) before any session/route is reached -- there
// is no route-guard "forbidden" page involved in this particular flow (that
// page is for an authenticated-but-under-permissioned user visiting a route
// they can't access, a different scenario).
test('admin creates, assigns a role to, and locks a user', async ({ page }) => {
  const username = `e2e-user-${Date.now()}`;
  const password = 'Password123!';

  await loginAs(page, { identifier: 'hung', password: '123456' });
  await page.goto('/users');

  await page.getByTestId('create-user-button').click();
  await page.getByTestId('new-user-username').fill(username);
  await page.getByTestId('new-user-full-name').fill('E2E Test User');
  await page.getByTestId('new-user-email').fill(`${username}@smartbook.local`);
  await page.getByTestId('new-user-password').fill(password);

  // Assign a role before submitting.
  await page.locator('[data-testid^="new-user-role-"]').first().check();

  await page.getByTestId('create-user-submit').click();
  await expect(page.getByText('Đã tạo người dùng mới')).toBeVisible();

  // Lock the user just created.
  const userRow = page.locator('tr', { hasText: username });
  await userRow.getByTestId('toggle-lock-user-button').click();
  await expect(page.getByText('Đã khóa người dùng')).toBeVisible();

  await logout(page);

  // Assertion cuối: logging in as the locked user is rejected at the login
  // form itself -- no session is created, no route is reached.
  await page.goto('/login');
  await page.locator('#login-identifier').fill(username);
  await page.locator('#login-password').fill(password);
  await page.getByTestId('login-submit').click();
  await expect(page.getByText('User is not active')).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
});
