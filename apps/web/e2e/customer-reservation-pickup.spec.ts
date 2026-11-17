import { DEMO_PASSWORD } from './helpers';
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { loginAs, loginAsCustomer, logout } from './helpers/auth';

// Golden flow #1: customer reserves a book -> staff confirms -> marks ready
// -> converts pickup code to a loan -> returns the loan.
//
// State independence: a run that failed half-way leaves customer01 with a live
// reservation or an open loan, which made the next run fail on "one live
// reservation per book" / the membership loan limit. The test first settles
// whatever customer01 still has open, through the same APIs staff use, and
// then follows ONLY the reservation and loan it created itself (ids captured
// from the API responses) — never "the first row mentioning customer01".

const GATEWAY = process.env.GATEWAY_URL || 'http://localhost:3000';
const CUSTOMER = { identifier: 'customer01', password: DEMO_PASSWORD };
const LIBRARIAN = { identifier: 'librarian01', password: DEMO_PASSWORD };
// auth/inventory seeds give librarian01 OPERATOR access only at BR-HCM-01.
const PICKUP_BRANCH_ID = '00000000-0000-0000-0000-000000000004';
const PICKUP_BRANCH_NAME = 'Chi Nhanh District 1';

async function apiToken(request: APIRequestContext, identifier: string, password: string) {
  const response = await request.post(`${GATEWAY}/auth/login`, { data: { identifier, password } });
  expect(response.ok(), `login ${identifier}`).toBeTruthy();
  const body = await response.json();
  return String(body.token || body.data?.token);
}

const idempotency = (prefix: string) => ({ 'Idempotency-Key': `e2e-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` });

/** Cancel customer01's live reservations and return their open loans. */
async function settleOpenCustomerState(request: APIRequestContext) {
  const customer = { Authorization: `Bearer ${await apiToken(request, CUSTOMER.identifier, CUSTOMER.password)}` };
  // Other tests can leave records at other branches; cross-branch fixture cleanup
  // needs the seeded admin, while the actual UI flow still uses librarian01.
  const staff = { Authorization: `Bearer ${await apiToken(request, 'hung', LIBRARIAN.password)}` };

  const reservations = (await (await request.get(`${GATEWAY}/my/reservations`, { headers: customer, params: { pageSize: '100' } })).json()).data ?? [];
  for (const reservation of reservations) {
    if (!['PENDING', 'CONFIRMED', 'READY_FOR_PICKUP'].includes(reservation.status)) continue;
    const res = await request.patch(`${GATEWAY}/borrow/reservations/${reservation.id}/cancel`, { headers: { ...staff, ...idempotency('cancel') } });
    expect(res.ok(), `cancel leftover ${reservation.reservation_number}`).toBeTruthy();
  }

  const loans = (await (await request.get(`${GATEWAY}/my/loans`, { headers: customer, params: { pageSize: '100' } })).json()).data ?? [];
  for (const loan of loans) {
    if (!['BORROWED', 'OVERDUE', 'RESERVED'].includes(loan.status)) continue;
    const res = await request.post(`${GATEWAY}/borrow/loans/${loan.id}/return`, { headers: { ...staff, ...idempotency('return') }, data: {} });
    expect(res.ok(), `return leftover ${loan.loan_number}`).toBeTruthy();
  }
}

function toast(page: Page, text: string | RegExp) {
  return page.locator('[data-sonner-toast]').filter({ hasText: text });
}

let restorePlan: { id: string; deposit: number; token: string } | null = null;
test.beforeEach(async ({ request }) => {
  await settleOpenCustomerState(request);
  const reader = await apiToken(request, CUSTOMER.identifier, CUSTOMER.password);
  const membershipResponse = await request.get(`${GATEWAY}/my/membership`, { headers: { Authorization: `Bearer ${reader}` } });
  expect(membershipResponse.ok()).toBeTruthy();
  const membership = (await membershipResponse.json()).data;
  const admin = await apiToken(request, 'hung', DEMO_PASSWORD);
  restorePlan = { id: membership.plan_id, deposit: Number(membership.limits.deposit_per_item), token: admin };
  const configured = await request.patch(`${GATEWAY}/borrow/membership-plans/${membership.plan_id}`, {
    headers: { Authorization: `Bearer ${admin}` }, data: { deposit_per_item: 30000 },
  });
  expect(configured.ok()).toBeTruthy();
  const funded = await request.post(`${GATEWAY}/borrow/customers/${membership.customer_id}/account/topups`, {
    headers: { Authorization: `Bearer ${admin}`, ...idempotency('deposit-fixture') },
    data: { amount: 200000, method: 'CASH', note: 'Disposable E2E deposit fixture' },
  });
  expect(funded.ok()).toBeTruthy();
});
test.afterEach(async ({ request }) => {
  if (!restorePlan) return;
  const restored = await request.patch(`${GATEWAY}/borrow/membership-plans/${restorePlan.id}`, {
    headers: { Authorization: `Bearer ${restorePlan.token}` }, data: { deposit_per_item: restorePlan.deposit },
  });
  expect(restored.ok()).toBeTruthy();
  restorePlan = null;
});

test('customer reservation through pickup and return', async ({ page, request }) => {
  const headers = { Authorization: `Bearer ${await apiToken(request, CUSTOMER.identifier, CUSTOMER.password)}` };
  const account = async () => {
    const response = await request.get(`${GATEWAY}/my/account`, { headers });
    expect(response.ok()).toBeTruthy();
    return (await response.json()).data;
  };
  const beforeWallet = await account();
  await loginAsCustomer(page, CUSTOMER);

  await page.goto(`/books?branch=${PICKUP_BRANCH_ID}&availability=available`);
  const reserveButton = page.locator('[data-testid="reserve-book-button"]:not([disabled])').first();
  await reserveButton.waitFor();
  await reserveButton.click();

  // Choose the branch this librarian can operate, even if another branch has
  // more copies and appears first in the modal.
  const dialog = page.getByRole('dialog', { name: 'Chọn chi nhánh đặt trước' });
  await expect(dialog).toBeVisible();
  const branchOptions = dialog.locator('button').filter({ hasText: 'cuốn sẵn sàng' });
  if (await branchOptions.count() > 1) {
    await branchOptions.filter({ hasText: PICKUP_BRANCH_NAME }).click();
  } else {
    await expect(dialog.getByText(PICKUP_BRANCH_NAME, { exact: true })).toBeVisible();
  }

  const createdResponse = page.waitForResponse((r) => r.request().method() === 'POST' && /\/my\/reservations$/.test(new URL(r.url()).pathname));
  await page.getByTestId('confirm-reserve-button').click();
  const created = await (await createdResponse).json();
  const reservationNumber: string = created.data.reservation_number;
  expect(created.data.warehouse_id).toBe(PICKUP_BRANCH_ID);
  expect(reservationNumber).toMatch(/^RSV-/);
  await expect(toast(page, 'Đặt trước thành công!')).toBeVisible();

  await logout(page);
  await loginAs(page, LIBRARIAN);

  await page.goto('/borrow/reservations');
  await page.getByPlaceholder('Tìm đặt trước...').fill(reservationNumber);
  const row = page.getByRole('row').filter({ hasText: reservationNumber });
  await expect(row).toHaveCount(1, { timeout: 15_000 });

  await row.getByTestId('confirm-reservation-button').click();
  await expect(toast(page, 'Đã xác nhận đặt trước')).toBeVisible();

  await row.getByTestId('mark-ready-button').click();
  await expect(toast(page, 'Đặt trước sẵn sàng lấy sách')).toBeVisible();

  const pickupCodeCell = row.locator('p.font-mono');
  await expect(pickupCodeCell).toHaveText(/^PU-[A-Z0-9]{4}-[A-Z0-9]{4}$/, { timeout: 10_000 });
  const pickupCode = (await pickupCodeCell.innerText()).trim();

  const convertResponse = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().includes('/borrow/reservations/pickup/convert-to-loan'));
  await page.getByTestId('pickup-code-input').fill(pickupCode);
  await page.getByTestId('convert-pickup-submit').click();
  const convertedResponse = await convertResponse;
  expect(convertedResponse.ok(), await convertedResponse.text()).toBeTruthy();
  const loan = (await convertedResponse.json()).data;
  expect(loan.loan_number).toMatch(/^LOAN-/);
  await expect(toast(page, `Đã tạo phiếu mượn ${loan.loan_number}`)).toBeVisible();
  const heldWallet = await account();
  const deposit = Number(loan.deposit_total || 0);
  expect(deposit).toBe(30000);
  expect(Number(heldWallet.held_balance)).toBe(Number(beforeWallet.held_balance) + deposit);
  expect(Number(heldWallet.available_balance)).toBe(Number(beforeWallet.available_balance) - deposit - Number(loan.borrow_fee_amount || 0));

  // Open exactly the loan this test created.
  await page.goto(`/borrow/loans/${loan.id}`);
  await page.getByTestId('return-loan-button').click();
  await page.getByTestId('confirm-dialog-action').click();
  await expect(toast(page, 'Đã trả sách thành công')).toBeVisible();

  await expect(page.getByTestId('loan-status-badge')).toContainText('Đã trả');
  const afterWallet = await account();
  expect(Number(afterWallet.held_balance)).toBe(Number(beforeWallet.held_balance));
  expect(Number(afterWallet.available_balance)).toBe(Number(heldWallet.available_balance) + deposit);
  const persistedResponse = await request.get(`${GATEWAY}/my/loans/${loan.id}`, { headers });
  expect(persistedResponse.ok()).toBeTruthy();
  expect((await persistedResponse.json()).data.status).toBe('RETURNED');
});
