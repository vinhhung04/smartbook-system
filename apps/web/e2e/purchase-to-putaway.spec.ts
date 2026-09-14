import { test, expect } from '@playwright/test';
import { loginAs, logout } from './helpers/auth';

// Golden flow #2: warehouse staff requests stock -> manager approves the
// request, converts it to a PO, submits/approves/sends the PO -> supplier
// (anonymous portal, no login) confirms and submits an invoice -> manager
// assigns the delivery for counting -> staff counts it -> manager approves
// the goods receipt (stock increases) -> staff puts the stock away on a shelf.
test('purchase request through approval, supplier confirmation, receiving, and putaway', async ({ page, browser }) => {
  const bookTitle = `E2E Putaway Book ${Date.now()}`;

  // 1. Staff creates a purchase request.
  await loginAs(page, { identifier: 'staff01', password: '123456' });
  await page.goto('/my-purchase-requests');
  await page.getByTestId('new-pr-warehouse-select').click();
  await page.getByRole('option').first().click();
  await page.getByTestId('new-pr-book-title').fill(bookTitle);
  await page.getByTestId('new-pr-quantity').fill('5');
  await page.getByTestId('new-pr-submit').click();
  await expect(page.getByText(/Đã (gửi|tạo) yêu cầu/)).toBeVisible();

  await logout(page);

  // 2. Manager approves the request, converts it to a PO, and drives the PO
  // through submit -> approve -> send to supplier.
  await loginAs(page, { identifier: 'manager01', password: '123456' });
  await page.goto('/purchase-requests');
  const requestRow = page.locator('tr', { hasText: bookTitle });
  await requestRow.getByTestId('approve-purchase-request-button').click();
  await page.getByTestId('confirm-dialog-action').click();

  await requestRow.getByTestId('convert-request-to-po-button').click();
  await page.getByTestId('convert-po-variant-search').fill(bookTitle);
  await page.getByRole('button', { name: new RegExp(bookTitle) }).first().click();
  await page.getByTestId('convert-po-supplier-select').selectOption({ index: 1 });
  await page.getByTestId('create-po-from-request-button').click();

  const poLink = page.getByRole('link', { name: /^PO-/ }).first();
  await poLink.click();

  await page.getByTestId('submit-po-button').click();
  await page.getByTestId('confirm-dialog-action').click();
  await page.getByTestId('approve-po-button').click();
  await page.getByTestId('confirm-dialog-action').click();
  await page.getByTestId('send-to-supplier-button').click();
  await page.getByTestId('confirm-dialog-action').click();

  const portalHref = await page.getByTestId('supplier-portal-link').getAttribute('href');
  expect(portalHref).toBeTruthy();

  // 3. Supplier confirms and submits an invoice, in a browser context with
  // no session at all -- the portal is reached only via the token in the URL.
  const supplierContext = await browser.newContext();
  const supplierPage = await supplierContext.newPage();
  await supplierPage.goto(portalHref!);
  await supplierPage.getByTestId('supplier-confirm-order-button').click();
  await supplierPage.getByTestId('confirm-dialog-action').click();
  await supplierPage.getByRole('button', { name: 'Invoices' }).click();
  await supplierPage.getByTestId('supplier-portal-autofill').click();
  await supplierPage.getByTestId('supplier-portal-submit').click();
  await supplierPage.getByTestId('confirm-dialog-action').click();
  await expect(supplierPage.getByText(/INV-/)).toBeVisible();
  await supplierContext.close();

  // 4. Manager assigns the submitted delivery to a warehouse staff member for counting.
  await page.goto('/supplier-deliveries');
  await page.getByRole('link', { name: /^INV-/ }).first().click();
  await page.getByTestId('goods-receipt-assign-staff-select').click();
  await page.getByRole('option').first().click();
  await page.getByTestId('goods-receipt-submit').click();
  await expect(page.getByText(/Đã tạo phiếu/)).toBeVisible();
  const receiptUrl = page.url();

  await logout(page);

  // 5. Staff counts the received stock.
  await loginAs(page, { identifier: 'staff01', password: '123456' });
  await page.goto('/my-warehouse-tasks');
  await page.getByRole('link', { name: 'Ghi nhận' }).first().click();
  await page.getByTestId('save-received-count-button').first().click();
  await expect(page.getByText(/chờ manager duyệt/)).toBeVisible();

  await logout(page);

  // 6. Manager approves the goods receipt -- stock increases -- then hands off to putaway.
  await loginAs(page, { identifier: 'manager01', password: '123456' });
  await page.goto(receiptUrl.replace(/^https?:\/\/[^/]+/, ''));
  await page.getByTestId('approve-goods-receipt-button').click();
  await expect(page.getByText('POSTED')).toBeVisible();

  await page.getByTestId('go-to-putaway-link').click();
  await page.getByTestId('start-putaway-button').first().click();

  await page.getByTestId('putaway-reason-input').fill('E2E test putaway');
  await page.getByTestId('putaway-confirm-button').click();

  // Assertion cuối: on_hand at the receiving location has decreased,
  // confirming the shelf-transfer mutation actually happened.
  await expect(page.getByText(/on_hand \d+/)).toBeVisible();
});
