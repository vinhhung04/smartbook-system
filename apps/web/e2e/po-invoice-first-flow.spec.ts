import { randomBytes, randomInt } from 'node:crypto';
import { test, expect, type Page } from '@playwright/test';
import { DEMO_PASSWORD, loginStaff } from './helpers';
import { loginAs } from './helpers/auth';

// Invoice-first purchasing through both UIs (2026-11-25):
// SmartBook orders a typed book not in the catalog + a catalog suggestion, no price ->
// supplier accepts part with prices -> SmartBook approves -> supplier invoices at the approved
// price -> SmartBook approves the invoice -> supplier ships a first batch -> SmartBook links the
// new book to the catalog and receives -> both sides see "Giao thành công x/y, còn thiếu z".

const API = (process.env.GATEWAY_URL || 'http://localhost:3000').replace(/\/$/, '');
// a catalog book every seed has (prisma/seed.js BK-EXT-001)
const catalogBook = 'Dế Mèn Phiêu Lưu Ký';

function randomIsbn13() {
  const core = `978${Array.from({ length: 9 }, () => randomInt(10)).join('')}`;
  const sum = [...core].reduce((total, digit, index) => total + Number(digit) * (index % 2 ? 3 : 1), 0);
  return `${core}${(10 - (sum % 10)) % 10}`;
}
const tag = randomBytes(3).toString('hex').toUpperCase();
const newBook = `Sách mới E2E ${tag}`;

async function confirm(page: Page) {
  await page.getByTestId('confirm-dialog-action').click();
  await expect(page.getByTestId('confirm-dialog-action')).toBeHidden();
}

async function openSupplierOrder(page: Page, poNumber: string, tab: string) {
  await page.goto('/supplier');
  await page.getByRole('button', { name: new RegExp(poNumber) }).first().click();
  // the step tracker can carry a button with the same name as a tab
  await page.getByRole('navigation', { name: 'Mục của đơn' }).getByRole('button', { name: tab, exact: true }).click();
}

test('invoice-first PO: proposal, invoice approval, partial delivery, catalog link at receiving', async ({ page, browser }) => {
  test.setTimeout(240_000);

  // ── SmartBook creates the PO ───────────────────────────────────────────────
  await loginStaff(page, 'hung');
  // a catalog book whose code the receiving step must refuse, the same on any database
  const takenIsbn = randomIsbn13();
  const takenTitle = `Sách có sẵn E2E ${tag}`;
  const hungToken = await page.evaluate(() => localStorage.getItem('token'));
  const taken = await page.request.post(`${API}/api/books/incomplete`, { headers: { Authorization: `Bearer ${hungToken}` }, data: { isbn13: takenIsbn, title: takenTitle, price: 0 } });
  expect(taken.status()).toBe(201);
  await page.goto('/purchase-orders/new');
  await page.getByRole('combobox', { name: 'Nhà cung cấp' }).click();
  await page.getByRole('option', { name: /Sach Viet|Sách Việt/i }).first().click();
  await page.getByRole('combobox', { name: 'Kho nhận hàng' }).click();
  // WH-HCM-01 has warehouse staff who may count receipts there
  await page.getByRole('option', { name: /WH-HCM-01/ }).click();

  await page.getByRole('textbox', { name: 'Tên sách' }).first().fill(newBook);
  await page.getByRole('textbox', { name: 'Mã sách (ISBN, EAN, mã nhà cung cấp)' }).first().fill(`NCC-${tag}`);
  await page.getByRole('textbox', { name: 'Tác giả' }).first().fill('Tác giả E2E');
  await page.getByRole('spinbutton', { name: 'Năm xuất bản / tái bản' }).first().fill('2024');
  await page.getByRole('spinbutton', { name: 'Số lượng, cuốn' }).first().fill('8');
  // no unit price on the new form
  await expect(page.getByText('Đơn giá, VND')).toHaveCount(0);

  await page.getByRole('button', { name: 'Thêm dòng' }).click();
  await page.getByRole('button', { name: /Bấm để chọn dòng này/ }).last().click();
  await page.getByRole('textbox', { name: 'Tìm sách trong danh mục để điền cho dòng đang chọn' }).fill(catalogBook);
  await page.getByRole('button', { name: 'Gợi ý từ danh mục' }).click();
  await page.getByRole('button', { name: new RegExp(catalogBook) }).first().click();
  await expect(page.getByText(/Liên kết danh mục/)).toBeVisible();
  await page.getByRole('spinbutton', { name: 'Số lượng, cuốn' }).last().fill('10');

  await page.getByRole('button', { name: 'Lưu đơn mua hàng' }).click();
  await page.waitForURL(/\/purchase-orders\/[0-9a-f-]{36}$/);
  const poUrl = new URL(page.url()).pathname;
  const poId = poUrl.split('/').at(-1)!;
  const poNumber = (await page.getByText(/^PO-\d+-\w+$/).first().innerText()).trim();
  await expect(page.getByText('Chưa có trong danh mục — liên kết khi nhập kho')).toBeVisible();
  await expect(page.getByText('Chờ báo giá').first()).toBeVisible();

  // The manager may approve, so submitting approves the order straight away.
  await page.getByTestId('submit-po-button').click();
  await confirm(page);
  await page.getByTestId('send-to-supplier-button').click();
  await confirm(page);

  // ── Supplier proposes: 6 of 8 new books, all 10 catalog books, with prices ────
  const supplierContext = await browser.newContext();
  const supplier = await supplierContext.newPage();
  await loginAs(supplier, { identifier: 'supplier-sv', password: DEMO_PASSWORD });
  await openSupplierOrder(supplier, poNumber, 'Phản hồi đơn');
  await expect(supplier.getByRole('button', { name: 'Chấp nhận một phần / đổi giá' })).toHaveCount(0);
  await supplier.getByRole('button', { name: 'Chấp nhận một phần' }).click();
  await supplier.getByLabel(`Số lượng chấp nhận — ${newBook}`).fill('6');
  await expect(supplier.getByText('Không chấp nhận 2')).toBeVisible();
  await supplier.getByLabel(`Đơn giá — ${newBook}`).fill('30000');
  await supplier.getByLabel(`Đơn giá — ${catalogBook}`).fill('50000');
  await supplier.getByPlaceholder('Ví dụ: chỉ còn 7 cuốn trong kho').fill('Chỉ còn 6 cuốn sách mới');
  await supplier.getByRole('button', { name: 'Gửi đề xuất cho SmartBook duyệt' }).click();
  await expect(supplier.getByText('Đã gửi đề xuất — chờ SmartBook duyệt')).toBeVisible();

  // ── SmartBook approves the proposal ─────────────────────────────────────────
  await page.goto(poUrl);
  await expect(page.getByText('Đề xuất số lượng và đơn giá của nhà cung cấp chờ duyệt')).toBeVisible();
  await expect(page.getByText('8 → 6 (không chấp nhận 2)')).toBeVisible();
  await page.getByRole('button', { name: 'Duyệt đề xuất' }).click();
  await confirm(page);
  await expect(page.getByText(/Yêu cầu 8 · nhà cung cấp chấp nhận 6 · không chấp nhận 2/)).toBeVisible({ timeout: 15_000 });

  // ── Supplier invoices at the approved prices ───────────────────────────────
  // opening the order lands on the next step: the invoice form, already open
  await supplier.goto('/supplier');
  await supplier.getByRole('button', { name: new RegExp(poNumber) }).first().click();
  await expect(supplier.getByText('SmartBook đã duyệt đề xuất — bước tiếp theo: lập hóa đơn')).toBeVisible();
  await supplier.getByLabel('Số hóa đơn').fill(`HD-${tag}`);
  await expect(supplier.getByText('Tổng 680.000 ₫')).toBeVisible(); // 6 x 30.000 + 10 x 50.000
  await supplier.getByRole('button', { name: 'Gửi hóa đơn cho SmartBook' }).click();
  await expect(supplier.getByText('Đã gửi hóa đơn — chờ SmartBook duyệt')).toBeVisible();
  await supplier.reload();
  await supplier.getByRole('button', { name: new RegExp(poNumber) }).first().click();
  await expect(supplier.getByText('Hóa đơn đang chờ SmartBook duyệt').first()).toBeVisible();
  // no delivery note before SmartBook approves the invoice
  await supplier.getByRole('navigation', { name: 'Mục của đơn' }).getByRole('button', { name: 'Lập phiếu giao', exact: true }).click();
  await expect(supplier.getByText(/Hóa đơn của bạn đang chờ SmartBook duyệt/)).toBeVisible();

  // ── SmartBook approves the invoice ──────────────────────────────────────────
  await page.goto(poUrl);
  await page.getByRole('button', { name: 'Duyệt hóa đơn' }).click();
  await expect(page.getByText('Đã duyệt hóa đơn — nhà cung cấp có thể lập phiếu giao')).toBeVisible();

  // ── Supplier ships a first batch: 4 catalog books + 2 new books ───────────────
  await supplier.goto('/supplier');
  await supplier.getByRole('button', { name: new RegExp(poNumber) }).first().click();
  await expect(supplier.getByText('Hóa đơn đã được duyệt — lập phiếu giao hàng (giao được nhiều đợt)')).toBeVisible();
  // the order opens on the delivery tab now
  await supplier.getByLabel(`Số lượng giao đợt này, ${catalogBook}`).fill('4');
  await supplier.getByLabel(`Số lượng giao đợt này, ${newBook}`).fill('2');
  await supplier.getByLabel('Đơn vị vận chuyển').fill('GHN');
  await supplier.getByRole('button', { name: 'Gửi phiếu giao hàng' }).click();
  await expect(supplier.getByText('Đã gửi phiếu giao hàng — SmartBook sẽ xác nhận khi nhận hàng')).toBeVisible();
  await supplier.getByRole('navigation', { name: 'Mục của đơn' }).getByRole('button', { name: 'Chứng từ', exact: true }).click();
  // shipped is not delivered: nothing counts until SmartBook receives it
  await expect(supplier.getByText('đang vận chuyển 6 · còn thiếu 16 quyển')).toBeVisible();

  // ── SmartBook links the new book and receives the batch ────────────────────
  const token = await page.evaluate(() => localStorage.getItem('token'));
  const progress = await (await page.request.get(`${API}/api/purchase-orders/${poId}/invoice-fulfillment`, { headers: { Authorization: `Bearer ${token}` } })).json();
  const deliveryId = progress.data[0].deliveries[0].id as string;
  await page.goto(`/supplier-deliveries/${deliveryId}`);
  await expect(page.getByText('Có sách chưa có trong danh mục. Liên kết trước khi nhập kho:')).toBeVisible();
  await expect(page.getByTestId('goods-receipt-submit')).toBeDisabled();
  await page.getByRole('button', { name: 'Liên kết sách' }).click();
  const dialog = page.getByRole('dialog');
  // the code field starts with the free-text code typed on the PO
  const codeField = dialog.getByRole('textbox', { name: 'Mã vạch in trên sách' });
  await expect(codeField).toHaveValue(`NCC-${tag}`);
  await dialog.getByRole('spinbutton', { name: 'Giá bán, VND' }).fill('99000');
  // a code that already belongs to another catalog book is refused, with that book offered
  await codeField.fill(takenIsbn);
  await dialog.getByRole('button', { name: 'Tạo và liên kết' }).click();
  await expect(dialog.getByText(`Mã này đã thuộc sách "${takenTitle}"`, { exact: false })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Liên kết sách này' })).toBeVisible();
  // a book without a standard barcode: the free-text code becomes its internal code
  await codeField.fill(`NCC-${tag}`);
  await dialog.getByRole('button', { name: 'Tạo và liên kết' }).click();
  await expect(page.getByText(`Đã tạo "${newBook}" trong danh mục (mã NCC-${tag}) và liên kết`)).toBeVisible();

  await page.getByTestId('goods-receipt-assign-staff-select').click();
  await page.getByRole('option', { name: /Le Van Minh/ }).click();
  await page.getByTestId('goods-receipt-submit').click();
  await page.waitForURL(/\/orders\/[0-9a-f-]{36}$/);
  const receiptId = new URL(page.url()).pathname.split('/').at(-1)!;
  // counting + manager approval are covered by purchase-to-putaway.spec.ts; post directly here
  const posted = await page.request.patch(`${API}/api/goods-receipts/${receiptId}`, { headers: { Authorization: `Bearer ${token}` }, data: { status: 'POSTED' } });
  expect(posted.ok()).toBeTruthy();

  await page.goto(poUrl);
  await expect(page.getByText('Giao thành công 6/16 · còn thiếu 10 quyển')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(newBook).first()).toBeVisible(); // the ordered title stays after linking

  await openSupplierOrder(supplier, poNumber, 'Chứng từ');
  await expect(supplier.getByText('Giao thành công 6/16 · còn thiếu 10 quyển')).toBeVisible();
  await supplierContext.close();
});
