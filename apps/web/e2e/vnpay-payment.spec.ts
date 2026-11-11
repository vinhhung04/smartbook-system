import { expect, test, type Browser, type Page } from '@playwright/test';
import { DEMO_PASSWORD } from './helpers';

// VNPay flows end to end on the running stack, with the local VNPay simulator standing
// in for the VNPay page (scripts/vnpay-simulator.mjs; see docs/SERVICES/BORROW_SERVICE.md).
// Needs: borrow-service with VNPAY_* pointing at the simulator, the simulator running,
// and VNPAY_SIMULATOR=1. Uses the demo reader customer01 and adds to their wallet.

test.skip(!process.env.VNPAY_SIMULATOR, 'set VNPAY_SIMULATOR=1 with the VNPay simulator running');

const GATEWAY = process.env.GATEWAY_URL || 'http://localhost:3000';
const vnd = (text: string) => Number(text.replace(/\D/g, '')) || 0;

let page: Page;
let token = '';
let returnUrlOfPaidTopup = '';

async function loginReader(browser: Browser) {
  const context = await browser.newContext();
  const p = await context.newPage();
  await p.goto('/customer/login');
  await p.getByPlaceholder('Nhập email hoặc tên đăng nhập').fill('customer01');
  await p.getByPlaceholder('Nhập mật khẩu').fill(DEMO_PASSWORD);
  await p.getByRole('button', { name: 'Đăng nhập' }).click();
  await expect(p).toHaveURL('/customer', { timeout: 15_000 });
  return p;
}

async function walletBalance() {
  const res = await page.request.get(`${GATEWAY}/my/account`, { headers: { Authorization: `Bearer ${token}` } });
  expect(res.ok()).toBeTruthy();
  return Number((await res.json()).data.available_balance);
}

async function startTopup(amount: string) {
  await page.goto('/customer/fines');
  await page.getByLabel('Số tiền nạp vào ví (VND)').selectOption(amount);
  await page.getByRole('button', { name: 'Nạp qua VNPay' }).click();
  await page.waitForURL(/\/paymentv2\/vpcpay\.html/);
  await expect(page.getByText('TRÌNH GIẢ LẬP VNPay')).toBeVisible();
  await expect(page.locator('#sig')).toHaveText('Hợp lệ');
  await expect(page.locator('#amount')).toHaveAttribute('data-vnd', amount);
}

test.describe.serial('VNPay through the simulator', () => {
  test.beforeAll(async ({ browser }) => {
    page = await loginReader(browser);
    token = (await page.evaluate(() => localStorage.getItem('token'))) || '';
  });

  test('top-up: the wallet is credited after VNPay confirms', async () => {
    const before = await walletBalance();
    await startTopup('50000');
    await page.screenshot({ path: 'test-results/vnpay-1-simulator-page.png' });
    await page.locator('#pay').click();

    await page.waitForURL(/\/webhooks\/vnpay\/return/);
    returnUrlOfPaidTopup = page.url();
    await expect(page.getByRole('heading', { name: 'Thanh toán thành công' })).toBeVisible();
    await expect(page.getByText('Tiền đã được nạp vào ví của bạn.')).toBeVisible();
    await page.screenshot({ path: 'test-results/vnpay-2-return-success.png' });

    await page.getByRole('link', { name: 'Quay lại SmartBook' }).click();
    await page.waitForURL(/\/customer\/fines/);
    await expect(page.getByText('Thanh toán thành công!')).toBeVisible();
    expect(await walletBalance()).toBe(before + 50000);
    await expect(page.getByText('Nạp tiền vào ví').first()).toBeVisible();
    await page.screenshot({ path: 'test-results/vnpay-3-wallet-credited.png', fullPage: true });
  });

  test('replaying the same return URL does not credit twice', async () => {
    const before = await walletBalance();
    const res = await page.request.get(returnUrlOfPaidTopup);
    expect(res.ok()).toBeTruthy();
    expect(await res.text()).toContain('Thanh toán thành công');
    expect(await walletBalance()).toBe(before);
  });

  test('cancelled top-up: nothing is credited', async () => {
    const before = await walletBalance();
    await startTopup('20000');
    await page.locator('#cancel').click();
    await page.waitForURL(/\/webhooks\/vnpay\/return/);
    await expect(page.getByRole('heading', { name: 'Thanh toán không thành công' })).toBeVisible();
    expect(await walletBalance()).toBe(before);
  });

  test('only the five fixed top-up amounts are offered and accepted', async ({ browser }) => {
    await page.goto('/customer/fines');
    const picker = page.getByLabel('Số tiền nạp vào ví (VND)');
    await expect(picker).toBeVisible();
    const options = await picker.locator('option').evaluateAll(
      (nodes) => nodes.map((node) => (node as HTMLOptionElement).value).filter(Boolean),
    );
    expect(options).toEqual(['10000', '20000', '50000', '100000', '200000']);

    const online = await page.request.post(`${GATEWAY}/my/account/topups/vnpay/create`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { amount: 15000 },
    });
    expect(online.status()).toBe(400);
    expect((await online.json()).code).toBe('INVALID_TOPUP_AMOUNT');

    // The counter top-up (staff) follows the same rule.
    const staffPage = await (await browser.newContext()).newPage();
    await staffPage.goto('/login');
    await staffPage.getByPlaceholder('Nhập email hoặc tên đăng nhập').fill('librarian01');
    await staffPage.getByPlaceholder('Nhập mật khẩu').fill(DEMO_PASSWORD);
    await staffPage.getByRole('button', { name: 'Đăng nhập' }).click();
    await staffPage.waitForURL((url) => !url.pathname.endsWith('/login'), { timeout: 15_000 });
    const staffToken = await staffPage.evaluate(() => localStorage.getItem('token'));
    const me = await page.request.get(`${GATEWAY}/my/account`, { headers: { Authorization: `Bearer ${token}` } });
    const customerId = (await me.json()).data.customer_id;
    const counter = await staffPage.request.post(`${GATEWAY}/borrow/customers/${customerId}/account/topups`, {
      headers: { Authorization: `Bearer ${staffToken}`, 'Idempotency-Key': `audit-${Date.now()}` },
      data: { amount: 123456, method: 'CASH' },
    });
    expect(counter.status()).toBe(400);
    expect((await counter.json()).code).toBe('INVALID_TOPUP_AMOUNT');
  });

  test('a forged return URL is rejected', async () => {
    const res = await page.request.get(`${GATEWAY}/webhooks/vnpay/return?vnp_TxnRef=TUFORGED&vnp_Amount=100&vnp_ResponseCode=00&vnp_SecureHash=deadbeef`);
    expect(res.status()).toBe(400);
    expect(await res.text()).toContain('Chữ ký không hợp lệ');
  });

  test('a fine is paid online when the reader has one', async () => {
    await page.goto('/customer/fines');
    const payButton = page.getByRole('button', { name: 'Thanh toán online qua VNPay' }).first();
    test.skip(!(await payButton.isVisible().catch(() => false)), 'customer01 has no open fine to pay');
    const owed = vnd(await page.getByText('Tiền phạt còn lại', { exact: true }).locator('xpath=..').innerText());
    await payButton.click();
    await page.waitForURL(/\/paymentv2\/vpcpay\.html/);
    await expect(page.locator('#sig')).toHaveText('Hợp lệ');
    await page.locator('#pay').click();
    await page.waitForURL(/\/webhooks\/vnpay\/return/);
    await expect(page.getByRole('heading', { name: 'Thanh toán thành công' })).toBeVisible();
    await page.getByRole('link', { name: 'Quay lại SmartBook' }).click();
    await page.waitForURL(/\/customer\/fines/);
    await expect.poll(async () => vnd(await page.getByText('Tiền phạt còn lại', { exact: true }).locator('xpath=..').innerText())).toBeLessThan(owed);
  });
});
