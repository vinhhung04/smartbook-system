import { DEMO_PASSWORD } from './helpers';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { test, expect } from '@playwright/test';
import { loginAs, logout } from './helpers/auth';

// Golden flow #2: warehouse staff requests stock -> manager approves the
// request, converts it to a PO, submits/approves/sends the PO -> supplier
// (anonymous portal, no login) confirms and submits an invoice -> manager
// assigns the delivery for counting -> staff counts it -> manager approves
// the goods receipt (stock increases) -> staff puts the stock away on a shelf.
test('purchase request through approval, supplier confirmation, receiving, and putaway', async ({ page, browser }) => {
  // The PR -> PO conversion needs a title that exists in the catalog (variant search), so reuse a seeded book.
  const bookTitle = 'Dế Mèn Phiêu Lưu Ký';

  // 1. Staff creates a purchase request.
  await loginAs(page, { identifier: 'staff01', password: DEMO_PASSWORD });
  await page.goto('/my-purchase-requests');
  await page.getByRole('button', { name: 'Tạo yêu cầu' }).first().click();
  await page.getByTestId('new-pr-warehouse-select').click();
  // WH-HCM-01 is the seeded warehouse with shelf compartments, so the putaway step at the end has somewhere to go.
  await page.getByRole('option', { name: /WH-HCM-01/ }).click();
  await page.getByTestId('new-pr-book-title').fill(bookTitle);
  await page.getByTestId('new-pr-quantity').fill('5');
  await page.getByRole('radio', { name: 'Tồn kho thấp' }).click();
  await page.getByTestId('new-pr-submit').click();
  await expect(page.getByText(/Đã (gửi|tạo) yêu cầu/)).toBeVisible();

  await logout(page);

  // 2. Manager approves the request, converts it to a PO, and drives the PO
  // through submit -> approve -> send to supplier.
  await loginAs(page, { identifier: 'manager01', password: DEMO_PASSWORD });
  await page.goto('/purchase-requests');
  // Earlier runs leave approved PRs for the same title; pick the newest still-pending one and pin it by its number.
  const pendingRow = page.locator('tr', { hasText: bookTitle }).filter({ has: page.getByTestId('approve-purchase-request-button') }).first();
  const requestNumber = (await pendingRow.innerText()).match(/PR-\d+-\d+/)![0];
  const requestRow = page.locator('tr', { hasText: requestNumber });
  await requestRow.getByTestId('approve-purchase-request-button').click();
  await page.getByTestId('confirm-dialog-action').click();

  await requestRow.getByTestId('convert-request-to-po-button').click();
  await page.getByTestId('convert-po-variant-search').fill(bookTitle);
  await page.getByRole('button', { name: new RegExp(bookTitle) }).first().click();
  await page.getByTestId('convert-po-supplier-select').selectOption({ index: 1 });
  await page.getByTestId('create-po-from-request-button').click();

  // The PR page only toasts the new PO number (it no longer links to it), so open it from the PO list.
  const poNumber = (await page.getByText(/Đã chuyển thành PO: PO-\S+/).innerText()).match(/PO-\S+/)![0];
  await page.goto('/purchase-orders');
  await page.getByRole('link', { name: poNumber }).first().click();

  await page.getByTestId('submit-po-button').click();
  await page.getByTestId('confirm-dialog-action').click();
  await page.getByTestId('approve-po-button').click();
  await page.getByTestId('confirm-dialog-action').click();
  await page.getByTestId('send-to-supplier-button').click();
  await page.getByTestId('confirm-dialog-action').click();

  const portalHref = await page.getByTestId('supplier-portal-link').getAttribute('href');
  expect(portalHref).toBeTruthy();
  if (process.env.SMARTBOOK_TEST_ISOLATED !== '1') throw new Error('Run procurement E2E in the disposable QA stack');
  const poId = new URL(page.url()).pathname.split('/').at(-1)!;
  expect(poId).toMatch(/^[0-9a-f-]{36}$/i);
  const sql = (query: string) => execFileSync('docker', ['compose', 'exec', '-T', 'db', 'psql', '-U', process.env.DB_USER!, '-d', 'inventory_db', '-v', 'ON_ERROR_STOP=1', '-At', '-c', query], { cwd: resolve(import.meta.dirname, '../../..'), encoding: 'utf8' }).trim();
  const variant = sql(`SELECT variant_id FROM purchase_order_items WHERE purchase_order_id='${poId}'`);
  expect(variant).toMatch(/^[0-9a-f-]{36}$/i);
  const onHand = () => Number(sql(`SELECT COALESCE(SUM(on_hand_qty),0) FROM stock_balances WHERE variant_id='${variant}'`));
  const available = () => Number(sql(`SELECT COALESCE(SUM(available_qty),0) FROM stock_balances WHERE variant_id='${variant}'`));
  const stockBeforeReceipt = onHand();

  // 3. Supplier confirms and submits an invoice, in a browser context with
  // no session at all -- the portal is reached only via the token in the URL.
  const supplierContext = await browser.newContext();
  const supplierPage = await supplierContext.newPage();
  await supplierPage.goto(portalHref!);
  await supplierPage.getByTestId('supplier-confirm-order-button').click();
  await supplierPage.getByTestId('confirm-dialog-action').click();
  await supplierPage.getByRole('button', { name: 'Hóa đơn giao hàng' }).click();
  await supplierPage.getByTestId('supplier-portal-autofill').click();
  await supplierPage.getByTestId('supplier-portal-submit').click();
  await supplierPage.getByTestId('confirm-dialog-action').click();
  await expect(supplierPage.getByText(/INV-/)).toBeVisible();
  await supplierContext.close();

  // 4. Manager assigns the submitted delivery to a warehouse staff member for counting.
  await page.goto('/supplier-deliveries');
  await page.getByRole('link', { name: /^INV-/ }).first().click();
  await page.getByTestId('goods-receipt-assign-staff-select').click();
  // Assign to staff01 (Le Van Minh) -- step 5 logs in as that user, so the first option won't do.
  await page.getByRole('option', { name: /Le Van Minh/ }).click();
  await page.getByTestId('goods-receipt-submit').click();
  await expect(page.getByText(/Đã tạo phiếu/)).toBeVisible();
  // The toast fires before the app navigates to the new receipt (a lazy route), so wait
  // for its /orders/<id> page -- that is the link the staff task queue shows in step 5.
  await page.waitForURL(/\/orders\/[0-9a-f-]{36}$/);
  const receiptUrl = page.url();

  await logout(page);

  // 5. Staff counts the received stock.
  await loginAs(page, { identifier: 'staff01', password: DEMO_PASSWORD });
  await page.goto('/my-warehouse-tasks');
  // The queue is paged (10, oldest first) and may hold older receipts on a
  // database that is not fresh: narrow to receiving tasks, then open this receipt's task.
  await page.getByRole('combobox', { name: 'Lọc theo loại công việc' }).click();
  await page.getByRole('option', { name: /^Tiếp nhận hàng/ }).click();
  const receiptPath = new URL(receiptUrl).pathname;
  await page.locator(`a[href="${receiptPath}"]`, { hasText: 'Ghi nhận' }).click();
  await page.getByTestId('save-received-count-button').first().click();
  await expect(page.getByText(/chờ manager duyệt/)).toBeVisible();

  await logout(page);

  // 6. Manager approves the goods receipt -- stock increases -- then hands off to putaway.
  await loginAs(page, { identifier: 'manager01', password: DEMO_PASSWORD });
  await page.goto(receiptUrl.replace(/^https?:\/\/[^/]+/, ''));
  await page.getByTestId('approve-goods-receipt-button').click();
  // The badge shows the Vietnamese label; the raw POSTED code is no longer printed on the page.
  await expect(page.getByTestId('goods-receipt-status')).toHaveText(/Đã duyệt/);
  expect(onHand()).toBe(stockBeforeReceipt + 5);
  const availableBeforePutaway = available();

  await page.getByTestId('go-to-putaway-link').click();
  // The header opens warehouse-wide putaway. Use this receipt's book row so
  // older receiving backlog cannot select a different title or quantity.
  await page.getByRole('row').filter({ hasText: bookTitle }).getByTestId('start-putaway-button').click();

  await page.getByTestId('putaway-reason-input').fill('E2E test putaway');
  await page.getByTestId('putaway-confirm-button').click();

  // Final assertion: the shelf-transfer mutation actually happened. The success
  // toast is only shown after the transfer API call returns.
  await expect(page.getByText(/Đã chuyển \d+ quyển lên kệ/)).toBeVisible();
  expect(onHand()).toBe(stockBeforeReceipt + 5);
  expect(available()).toBeGreaterThan(availableBeforePutaway);
});
