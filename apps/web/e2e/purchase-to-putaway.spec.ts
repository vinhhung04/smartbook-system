import { DEMO_PASSWORD } from './helpers';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { test, expect } from '@playwright/test';
import { loginAs, logout } from './helpers/auth';

// Golden flow #2: warehouse staff requests stock -> manager approves the
// request, converts it to a PO, submits/approves/sends the PO -> supplier (account
// portal) accepts with a price -> manager approves the proposal -> supplier invoices ->
// manager approves the invoice -> supplier ships against it -> manager assigns the
// delivery for counting -> staff counts it -> manager approves the goods receipt
// (stock increases) -> staff puts the stock away on a shelf.
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
  // the supplier behind the supplier-sv account answers in step 3
  const supplierSelect = page.getByTestId('convert-po-supplier-select');
  const supplierValue = await supplierSelect.locator('option', { hasText: /Sach Viet|Sách Việt/i }).first().getAttribute('value');
  await supplierSelect.selectOption(supplierValue!);
  await page.getByTestId('create-po-from-request-button').click();

  // The PR page only toasts the new PO number (it no longer links to it), so open it from the PO list.
  const poToast = await page.getByText(/Đã chuyển thành PO: PO-\S+/).innerText();
  // the manager already approved the request: the converted PO starts approved, ready to send
  expect(poToast).toContain('đã duyệt, sẵn sàng gửi NCC');
  const poNumber = poToast.match(/PO-\S+/)![0];
  await page.goto('/purchase-orders');
  await page.getByRole('link', { name: poNumber }).first().click();

  await expect(page.getByText('Đã duyệt').first()).toBeVisible();
  await expect(page.getByTestId('submit-po-button')).toHaveCount(0);
  await expect(page.getByTestId('approve-po-button')).toHaveCount(0);
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

  // 3. Invoice-first: the supplier quotes a price and SmartBook approves it, the supplier
  // invoices at that price and SmartBook approves the invoice, then the supplier ships.
  const poPath = new URL(page.url()).pathname;
  const supplierContext = await browser.newContext();
  const supplierPage = await supplierContext.newPage();
  // the emailed link is read-only for these orders
  await supplierPage.goto(portalHref!);
  await expect(supplierPage.getByRole('button', { name: 'Đăng nhập tài khoản nhà cung cấp' })).toBeVisible();
  await expect(supplierPage.getByTestId('supplier-confirm-order-button')).toHaveCount(0);

  await loginAs(supplierPage, { identifier: 'supplier-sv', password: DEMO_PASSWORD });
  const openOrder = async (tab: string) => {
    await supplierPage.goto('/supplier');
    await supplierPage.getByRole('button', { name: new RegExp(poNumber) }).first().click();
    await supplierPage.getByRole('navigation', { name: 'Mục của đơn' }).getByRole('button', { name: tab, exact: true }).click();
  };
  await openOrder('Phản hồi đơn');
  await supplierPage.getByRole('button', { name: 'Chấp nhận tất cả' }).click();
  await supplierPage.getByLabel(`Đơn giá — ${bookTitle}`).fill('45000');
  await supplierPage.getByRole('button', { name: 'Gửi đề xuất cho SmartBook duyệt' }).click();
  await expect(supplierPage.getByText('Đã gửi đề xuất — chờ SmartBook duyệt')).toBeVisible();

  await page.goto(poPath);
  await page.getByRole('button', { name: 'Duyệt đề xuất' }).click();
  await page.getByTestId('confirm-dialog-action').click();
  await expect(page.getByText('Đã duyệt thay đổi của nhà cung cấp')).toBeVisible();

  await openOrder('Chứng từ');
  await supplierPage.getByRole('button', { name: 'Lập hóa đơn' }).click();
  await supplierPage.getByLabel('Số hóa đơn').fill(`HD-${poNumber}`);
  await supplierPage.getByRole('button', { name: 'Gửi hóa đơn cho SmartBook' }).click();
  await expect(supplierPage.getByText('Đã gửi hóa đơn — chờ SmartBook duyệt')).toBeVisible();

  await page.goto(poPath);
  await page.getByRole('button', { name: 'Duyệt hóa đơn' }).click();
  await expect(page.getByText('Đã duyệt hóa đơn — nhà cung cấp có thể lập phiếu giao')).toBeVisible();

  await openOrder('Lập phiếu giao');
  await supplierPage.getByRole('button', { name: 'Gửi phiếu giao hàng' }).click();
  await expect(supplierPage.getByText('Đã gửi phiếu giao hàng — SmartBook sẽ xác nhận khi nhận hàng')).toBeVisible();
  await supplierContext.close();

  // 4. Manager creates the receipt without a counter ("Chưa giao"); staff claim it in step 5.
  await page.goto('/supplier-deliveries');
  await page.getByRole('link', { name: new RegExp(`^PG-${poNumber}`) }).first().click();
  await page.getByTestId('goods-receipt-assign-staff-select').click();
  await page.getByRole('option', { name: /^Chưa giao/ }).click();
  await expect(page.getByTestId('goods-receipt-submit')).toContainText('chưa giao việc');
  await page.getByTestId('goods-receipt-submit').click();
  await expect(page.getByText(/Đã tạo phiếu/)).toBeVisible();
  // The toast fires before the app navigates to the new receipt (a lazy route), so wait
  // for its /orders/<id> page -- that is the link the staff task queue shows in step 5.
  await page.waitForURL(/\/orders\/[0-9a-f-]{36}$/);
  const receiptUrl = page.url();
  const managerToken = await page.evaluate(() => localStorage.getItem('token'));
  const receiptId = receiptUrl.split('/').at(-1)!;
  const receipt = await (await page.request.get(`${process.env.GATEWAY_URL || 'http://localhost:3000'}/api/goods-receipts/${receiptId}`, { headers: { Authorization: `Bearer ${managerToken}` } })).json();
  const receiptNumber = (receipt.data?.receipt_number || receipt.receipt_number) as string;
  expect(receiptNumber).toBeTruthy();

  await logout(page);

  // 5. Staff counts the received stock.
  await loginAs(page, { identifier: 'staff01', password: DEMO_PASSWORD });
  await page.goto('/my-warehouse-tasks');
  // the unassigned receipt is offered to warehouse staff; staff01 takes it
  await page.getByRole('tab', { name: /Có thể nhận/ }).click();
  await page.getByRole('button', { name: `Nhận task ${receiptNumber}` }).click();
  await expect(page.getByText(`Đã nhận ${receiptNumber}`)).toBeVisible();
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
