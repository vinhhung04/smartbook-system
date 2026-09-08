import { test, expect } from '@playwright/test';
import { loginStaff, loginCustomer } from './helpers';

/**
 * The core library golden path, driven entirely through the UI (mirrors
 * scripts/reservation-pickup-loan-return-integration.mjs at the API layer):
 *
 *   customer reserves a book -> staff confirms -> staff marks READY_FOR_PICKUP
 *   (pickup code issued) -> staff converts the pickup code to a loan
 *   -> staff returns the loan.
 *
 * Runs as two browser contexts (customer + staff) in one test so state flows
 * naturally between them without re-deriving IDs through the API.
 */
test('customer reserves a book, staff hands it out via pickup code, then returns it', async ({ browser }) => {
  const customerContext = await browser.newContext();
  const staffContext = await browser.newContext();
  const customerPage = await customerContext.newPage();
  const staffPage = await staffContext.newPage();

  try {
    // 1. Customer: find any reservable book on the catalog and reserve it.
    await loginCustomer(customerPage);
    await customerPage.goto('/customer/books');

    const bookCard = customerPage
      .locator('article')
      .filter({ has: customerPage.getByRole('button', { name: 'Đặt trước', exact: true }) })
      .first();
    await expect(bookCard).toBeVisible({ timeout: 15_000 });
    const bookTitle = (await bookCard.locator('h3').innerText()).trim();
    await bookCard.getByRole('button', { name: 'Đặt trước', exact: true }).click();

    // Reserve modal: single available warehouse auto-selects, otherwise pick the first option.
    const reserveDialog = customerPage.getByRole('dialog', { name: 'Chọn cửa hàng đặt trước' });
    await expect(reserveDialog).toBeVisible();
    const warehouseOptions = reserveDialog.locator('button').filter({ hasText: 'cuốn sẵn sàng' });
    if (await warehouseOptions.count() > 0) {
      await warehouseOptions.first().click();
    }
    await reserveDialog.getByRole('button', { name: 'Xác nhận đặt trước' }).click();
    await expect(reserveDialog).toBeHidden({ timeout: 10_000 });

    // 2. Customer: capture the reservation number to find the same row on the staff side.
    await customerPage.goto('/customer/reservations');
    const reservationRow = customerPage.locator('text=/^RSV-/').first();
    await expect(reservationRow).toBeVisible({ timeout: 15_000 });
    const reservationNumber = (await reservationRow.innerText()).trim();
    expect(reservationNumber).toMatch(/^RSV-/);

    // 3. Staff: confirm the reservation, then mark it ready for pickup.
    await loginStaff(staffPage);
    await staffPage.goto('/borrow/reservations');
    await staffPage.getByPlaceholder('Tìm đặt trước...').fill(reservationNumber);

    const staffRow = staffPage.getByRole('row').filter({ hasText: reservationNumber });
    await expect(staffRow).toBeVisible({ timeout: 15_000 });
    await staffRow.getByRole('button', { name: 'Xác nhận' }).click();
    await expect(staffRow.getByRole('button', { name: 'Sẵn sàng' })).toBeVisible({ timeout: 10_000 });
    await staffRow.getByRole('button', { name: 'Sẵn sàng' }).click();

    const pickupCodeCell = staffRow.locator('p.font-mono');
    await expect(pickupCodeCell).toHaveText(/^PU-[A-Z0-9]{4}-[A-Z0-9]{4}$/, { timeout: 10_000 });
    const pickupCode = (await pickupCodeCell.innerText()).trim();

    // 4. Staff: hand the book out at the pickup counter using the code (not the reservation id).
    await staffPage.getByPlaceholder('PU-ABCD-1234 hoặc SMARTBOOK:PICKUP:...').fill(pickupCode);
    await staffPage.getByRole('button', { name: 'Chuyển thành phiếu mượn' }).click();

    const loanToast = staffPage.getByText(/Đã tạo phiếu mượn LOAN-\S+ từ mã nhận sách/);
    await expect(loanToast).toBeVisible({ timeout: 10_000 });
    const loanNumberMatch = (await loanToast.innerText()).match(/LOAN-\S+/);
    expect(loanNumberMatch).not.toBeNull();
    const loanNumber = loanNumberMatch![0];

    // 5. Staff: return the loan and confirm it settles as RETURNED.
    await staffPage.goto('/borrow/loans');
    await staffPage.getByPlaceholder('Tìm phiếu mượn...').fill(loanNumber);

    const loanRow = staffPage.getByRole('row').filter({ hasText: loanNumber });
    await expect(loanRow).toBeVisible({ timeout: 15_000 });
    await loanRow.getByRole('button', { name: 'Trả sách' }).click();
    await staffPage.getByRole('alertdialog').getByRole('button', { name: 'Xác nhận' }).click();

    await expect(staffPage.getByText('Đã trả sách thành công')).toBeVisible({ timeout: 10_000 });
    await expect(loanRow.getByText('RETURNED', { exact: false })).toBeVisible({ timeout: 10_000 });

    test.info().annotations.push({ type: 'flow', description: `Book "${bookTitle}" — ${reservationNumber} -> ${loanNumber}` });
  } finally {
    await customerContext.close();
    await staffContext.close();
  }
});
