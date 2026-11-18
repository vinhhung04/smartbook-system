import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { loginStaff } from './helpers';

test('SB03 manager explicitly waives future accrual with a required reason', async ({ page }) => {
  test.skip(process.env.SMARTBOOK_TEST_ISOLATED !== '1', 'requires disposable QA database');
  const tag = randomUUID();
  const customerName = `Fine policy ${tag}`;
  const sql = (query: string) => execFileSync('docker', ['compose', 'exec', '-T', 'db', 'psql', '-U', process.env.DB_USER!, '-d', 'borrow_db', '-v', 'ON_ERROR_STOP=1', '-At', '-c', query],
    { cwd: resolve(import.meta.dirname, '../../..'), encoding: 'utf8' }).trim();
  const fineId = sql(`WITH c AS (
    INSERT INTO customers(customer_code,full_name) VALUES ('POL-${tag.slice(0, 12)}','${customerName}') RETURNING id
  ), l AS (
    INSERT INTO loan_transactions(loan_number,customer_id,warehouse_id,handled_by_user_id,due_date,total_items)
    SELECT 'POL-${tag}',id,gen_random_uuid(),gen_random_uuid(),date_trunc('day',now()) - interval '10 days',1 FROM c RETURNING id,customer_id,due_date
  ), i AS (
    INSERT INTO loan_items(loan_id,variant_id,due_date) SELECT id,gen_random_uuid(),due_date FROM l RETURNING id,due_date
  ), e AS (
    INSERT INTO overdue_fine_episodes(loan_item_id,due_date) SELECT id,due_date FROM i
  ) INSERT INTO fines(customer_id,loan_item_id,fine_type,amount,accrual_from_days,accrual_through_days,accrual_daily_rate,accrual_due_date)
    SELECT l.customer_id,i.id,'OVERDUE',50000,0,10,5000,i.due_date FROM l CROSS JOIN i RETURNING id`).split('\n')[0];
  expect(fineId).toMatch(/^[0-9a-f-]{36}$/);
  await loginStaff(page);
  await page.goto('/borrow/fines');
  await page.getByPlaceholder('Tìm theo tên, mã khách hoặc mã phiếu mượn...').fill(customerName);
  await page.getByRole('button', { name: `Miễn giảm khoản phạt của ${customerName}` }).click();
  const dialog = page.getByRole('dialog', { name: 'Miễn giảm tiền phạt' });
  await dialog.getByRole('checkbox', { name: 'Miễn cả tiền phạt quá hạn phát sinh trong thời gian tiếp theo của cuốn sách này' }).check();
  await dialog.getByRole('button', { name: 'Xác nhận miễn giảm' }).click();
  await expect(page.getByText('Nhập lý do miễn phạt cả thời gian tiếp theo')).toBeVisible();
  await dialog.getByLabel('Lý do (bắt buộc)').fill('Manager approved exceptional future waiver');
  const saved = page.waitForResponse(r => r.url().includes(`/borrow/fines/${fineId}/waive`) && r.request().method() === 'PATCH');
  await dialog.getByRole('button', { name: 'Xác nhận miễn giảm' }).click();
  expect((await saved).status()).toBe(200);
  await expect(dialog).toBeHidden();
  const state = sql(`SELECT f.status || ':' || e.waived_future::text FROM fines f JOIN overdue_fine_episodes e ON e.loan_item_id=f.loan_item_id WHERE f.id='${fineId}'`);
  expect(state).toBe('WAIVED:true');
});
