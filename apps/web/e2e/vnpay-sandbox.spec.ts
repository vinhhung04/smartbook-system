import fs from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { DEMO_PASSWORD } from './helpers';

// Wallet top-up through the REAL VNPay sandbox (pay.vnpaytest.vn merchant), with the
// test cards VNPay publishes at https://sandbox.vnpayment.vn/apis/vnpay-demo/.
// Needs VNPAY_* in .env set to sandbox credentials and VNPAY_SANDBOX=1.
// Accepts VNPay's sandbox terms dialog on each run (approved by the project owner).
// Adds 50 000 VND to the demo reader customer01 per successful run, and pays
// customer01's open fine by card if there is one (skipped otherwise).

test.skip(!process.env.VNPAY_SANDBOX, 'set VNPAY_SANDBOX=1 with sandbox credentials in .env');
test.setTimeout(120_000);

const GATEWAY = process.env.GATEWAY_URL || 'http://localhost:3000';
// Playwright empties test-results on every run; VNPAY_EVIDENCE_DIR keeps screenshots elsewhere.
const SHOTS = process.env.VNPAY_EVIDENCE_DIR || 'test-results/vnpay-sandbox';
const CARD = { success: '9704198526191432198', insufficient: '9704195798459170488' };

let page: Page;
let token = '';

async function shot(name: string) {
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

async function walletBalance() {
  const res = await page.request.get(`${GATEWAY}/my/account`, { headers: { Authorization: `Bearer ${token}` } });
  return Number((await res.json()).data.available_balance);
}

/** From the wallet page to VNPay's NCB card form. */
async function openNcbCardForm(amount: string, label: string) {
  await page.goto('/customer/fines');
  await page.getByLabel('Số tiền nạp vào ví (VND)').selectOption(amount);
  await page.getByRole('button', { name: 'Nạp qua VNPay' }).click();
  await chooseNcbOnVnpay(label);
}

/** On VNPay's payment-method page: domestic card -> NCB -> card form. */
async function chooseNcbOnVnpay(label: string) {
  await page.waitForURL(/sandbox\.vnpayment\.vn\/paymentv2\/Transaction\/PaymentMethod/, { timeout: 30_000 });
  await expect(page.getByText('Chọn phương thức thanh toán (Test)')).toBeVisible();
  await shot(`${label}-1-payment-method`);
  await page.getByText('Thẻ nội địa và tài khoản ngân hàng').click();
  await page.locator('#NCB').click();
  await expect(page.locator('#card_number_mask')).toBeVisible({ timeout: 20_000 });
}

/** "Hủy thanh toán" -> VNPay's "Xác nhận hủy" dialog -> back to our return URL. */
async function cancelOnVnpay() {
  await page.getByText('Hủy thanh toán', { exact: true }).first().click();
  await page.getByText('Xác nhận hủy', { exact: true }).click();
  await page.waitForURL(/\/webhooks\/vnpay\/return/, { timeout: 45_000 });
}

async function fillCardAndAcceptTerms(cardNumber: string, label: string) {
  await page.locator('#card_number_mask').pressSequentially(cardNumber, { delay: 15 });
  await page.locator('#cardHolder').fill('NGUYEN VAN A');
  await page.locator('#cardDate').pressSequentially('0715', { delay: 15 });
  await shot(`${label}-2-card-form`);
  await page.locator('#btnContinue').click();
  await page.getByText('Đồng ý & Tiếp tục').click();
}

test.describe.serial('VNPay sandbox (real)', () => {
  test.beforeAll(async ({ browser }) => {
    page = await (await browser.newContext({ viewport: { width: 1280, height: 860 } })).newPage();
    await page.goto('/customer/login');
    await page.getByPlaceholder('Nhập email hoặc tên đăng nhập').fill('customer01');
    await page.getByPlaceholder('Nhập mật khẩu').fill(DEMO_PASSWORD);
    await page.getByRole('button', { name: 'Đăng nhập' }).click();
    await expect(page).toHaveURL('/customer', { timeout: 15_000 });
    token = (await page.evaluate(() => localStorage.getItem('token'))) || '';
  });

  test('successful card payment credits the wallet once', async () => {
    const before = await walletBalance();
    await openNcbCardForm('50000', 'success');
    await fillCardAndAcceptTerms(CARD.success, 'success');

    await expect(page.locator('#otpvalue')).toBeVisible({ timeout: 20_000 });
    await page.locator('#otpvalue').fill('123456');
    await shot('success-3-otp');
    await page.locator('#btnConfirm').click();

    await page.waitForURL(/\/webhooks\/vnpay\/return/, { timeout: 45_000 });
    const returnUrl = page.url();
    await expect(page.getByRole('heading', { name: 'Thanh toán thành công' })).toBeVisible();
    await shot('success-4-return');
    expect(await walletBalance()).toBe(before + 50000);

    // The same signed return URL again must not credit a second time.
    const replay = await page.request.get(returnUrl);
    expect(await replay.text()).toContain('Thanh toán thành công');
    expect(await walletBalance()).toBe(before + 50000);

    await page.getByRole('link', { name: 'Quay lại SmartBook' }).click();
    await page.waitForURL(/\/customer\/fines/);
    await expect(page.getByText('Nạp tiền vào ví').first()).toBeVisible();
    await shot('success-5-wallet');
  });

  test('a card without enough balance credits nothing', async () => {
    const before = await walletBalance();
    await openNcbCardForm('20000', 'insufficient');
    await fillCardAndAcceptTerms(CARD.insufficient, 'insufficient');
    await page.waitForTimeout(3000);
    if (await page.locator('#otpvalue').isVisible().catch(() => false)) {
      await page.locator('#otpvalue').fill('123456');
      await page.locator('#btnConfirm').click();
      await page.waitForTimeout(3000);
    }
    await shot('insufficient-3-vnpay-result');
    if (!/\/webhooks\/vnpay\/return/.test(page.url())) {
      // VNPay keeps the reader on its page with an error; they cancel from there.
      await expect(page.getByText('Tài khoản của khách hàng không đủ số dư')).toBeVisible();
      await cancelOnVnpay();
    }
    await expect(page.getByRole('heading', { name: 'Thanh toán không thành công' })).toBeVisible();
    await shot('insufficient-4-return');
    expect(await walletBalance()).toBe(before);
  });

  test('cancelling on VNPay credits nothing', async () => {
    const before = await walletBalance();
    await openNcbCardForm('10000', 'cancel');
    await cancelOnVnpay();
    await expect(page.getByRole('heading', { name: 'Thanh toán không thành công' })).toBeVisible();
    await shot('cancel-2-return');
    expect(await walletBalance()).toBe(before);
  });

  test('a fine is paid by card through VNPay when the reader has one', async () => {
    const fineBalance = async () => {
      const res = await page.request.get(`${GATEWAY}/my/fines`, { headers: { Authorization: `Bearer ${token}` } });
      return Number((await res.json()).data.total_fine_balance);
    };
    await page.goto('/customer/fines');
    const payButton = page.getByRole('button', { name: 'Thanh toán online qua VNPay' }).first();
    await payButton.waitFor({ timeout: 10_000 }).catch(() => {});
    test.skip(!(await payButton.isVisible()), 'customer01 has no open fine to pay');
    const owed = await fineBalance();
    const walletBefore = await walletBalance();

    await payButton.click();
    await chooseNcbOnVnpay('fine');
    await fillCardAndAcceptTerms(CARD.success, 'fine');
    await expect(page.locator('#otpvalue')).toBeVisible({ timeout: 20_000 });
    await page.locator('#otpvalue').fill('123456');
    await page.locator('#btnConfirm').click();

    await page.waitForURL(/\/webhooks\/vnpay\/return/, { timeout: 45_000 });
    await expect(page.getByRole('heading', { name: 'Thanh toán thành công' })).toBeVisible();
    await shot('fine-4-return');
    expect(await fineBalance()).toBeLessThan(owed);
    // Paid by card: the wallet is not touched.
    expect(await walletBalance()).toBe(walletBefore);
  });
});
