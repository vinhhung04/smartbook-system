import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { loginStaff } from './helpers';

test('PRA05: a counter payment retry after a lost committed response records money once', async ({ page }) => {
  if (process.env.SMARTBOOK_TEST_ISOLATED !== '1') throw new Error('Requires the independently verified QA stack');
  const tag = randomUUID();
  const customerName = `Payment retry ${tag}`;
  const sql = (query: string) => execFileSync('docker', ['compose', 'exec', '-T', 'db', 'psql', '-U', process.env.DB_USER!, '-d', 'borrow_db', '-v', 'ON_ERROR_STOP=1', '-At', '-c', query],
    { cwd: resolve(import.meta.dirname, '../../..'), encoding: 'utf8' }).trim();
  const fineId = sql(`WITH c AS (
    INSERT INTO customers(customer_code,full_name,total_fine_balance)
    VALUES ('PAY-${tag.slice(0, 12)}','${customerName}',100000) RETURNING id
  ) INSERT INTO fines(customer_id,fine_type,amount)
    SELECT id,'DAMAGE',100000 FROM c RETURNING id`).split('\n')[0];
  expect(fineId).toMatch(/^[0-9a-f-]{36}$/i);
  const keys: (string | undefined)[] = [];
  await page.route(`**/borrow/fines/${fineId}/payments`, async route => {
    keys.push(route.request().headers()['idempotency-key']);
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    if (keys.length === 1) {
      // The actual backend committed; only its response is replaced at the
      // browser boundary. The second click must replay that same operation.
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Controlled lost response after commit' }) });
    } else {
      await route.fulfill({ response });
    }
  });
  await loginStaff(page);
  await page.goto('/borrow/fines');
  await page.getByPlaceholder('Tìm theo tên, mã khách hoặc mã phiếu mượn...').fill(customerName);
  await page.getByRole('row').filter({ hasText: customerName }).getByRole('button', { name: 'Thanh toán', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Thanh toán tiền phạt' });
  await dialog.getByLabel('Số tiền thanh toán, VND').fill('20000');
  const lostResponse = page.waitForResponse(response =>
    response.url().endsWith(`/borrow/fines/${fineId}/payments`) && response.request().method() === 'POST',
  { timeout: 30_000 });
  await dialog.getByRole('button', { name: 'Xác nhận thanh toán' }).click();
  expect((await lostResponse).status()).toBe(503);
  await expect(page.getByText('Controlled lost response after commit')).toBeVisible();
  expect(sql(`SELECT count(*) FROM fine_payments WHERE fine_id='${fineId}'`)).toBe('1');
  await dialog.getByRole('button', { name: 'Xác nhận thanh toán' }).click();
  await expect(dialog).toBeHidden();
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBeTruthy();
  expect(keys[1]).toBe(keys[0]);
  expect(sql(`SELECT count(*) || ':' || sum(amount)::text FROM fine_payments WHERE fine_id='${fineId}'`)).toBe('1:20000.00');
  expect(sql(`SELECT c.total_fine_balance::text FROM customers c JOIN fines f ON f.customer_id=c.id WHERE f.id='${fineId}'`)).toBe('80000.00');
});
