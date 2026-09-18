import { test, expect } from '@playwright/test';
import { loginAs, loginAsCustomer, logout } from './helpers/auth';

// Golden flow #1: customer reserves a book -> staff confirms -> marks ready
// -> converts pickup code to a loan -> returns the loan.
test('customer reservation through pickup and return', async ({ page }) => {
  await loginAsCustomer(page, { identifier: 'customer01', password: '123456' });

  await page.goto('/customer/books');
  const reserveButton = page.locator('[data-testid="reserve-book-button"]:not([disabled])').first();
  await reserveButton.waitFor();
  await reserveButton.click();

  await page.getByTestId('confirm-reserve-button').click();
  await expect(page.getByText('Đặt trước thành công!')).toBeVisible();

  await logout(page);
  await loginAs(page, { identifier: 'librarian01', password: '123456' });

  await page.goto('/borrow/reservations');
  // The row shows the borrow-service customer's username ("customer01"),
  // not the auth-service account's full_name -- the two are provisioned
  // separately and can differ.
  const row = page.locator('tr', { hasText: 'customer01' }).first();
  await row.getByTestId('confirm-reservation-button').click();
  await expect(page.getByText('Đã xác nhận đặt trước')).toBeVisible();

  await row.getByTestId('mark-ready-button').click();
  await expect(page.getByText('Đặt trước sẵn sàng lấy sách')).toBeVisible();

  const rowText = await row.innerText();
  const pickupCode = rowText.match(/PU-[A-Z0-9-]+/)?.[0];
  expect(pickupCode).toBeTruthy();

  await page.getByTestId('pickup-code-input').fill(pickupCode!);
  await page.getByTestId('convert-pickup-submit').click();
  await expect(page.getByText(/Đã tạo phiếu mượn/)).toBeVisible();

  await page.goto('/borrow/loans');
  await page.locator('tr', { hasText: 'customer01' }).first().click();

  await page.getByTestId('return-loan-button').click();
  await page.getByTestId('confirm-dialog-action').click();
  await expect(page.getByText('Đã trả sách thành công')).toBeVisible();

  await expect(page.getByTestId('loan-status-badge')).toContainText('RETURNED');
});
