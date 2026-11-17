import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { test, expect } from '@playwright/test';
import { loginStaff } from './helpers';

test('source staff ships a transfer and destination staff counts it; stock changes once at both sites', async ({ page }) => {
  if (process.env.SMARTBOOK_TEST_ISOLATED !== '1') throw new Error('Run with pnpm test:stack e2e against the disposable stack');
  // Setup crosses the real request/approval/picking/shipping APIs, with separate
  // staff accounts; only destination counting is driven by the browser here.
  const fixture = JSON.parse(execFileSync(process.execPath, [resolve(import.meta.dirname, '../../../scripts/warehouse-transfer-lifecycle-integration.mjs')], {
    cwd: resolve(import.meta.dirname, '../../..'), env: { ...process.env, QA_TRANSFER_UI_HANDOFF: '1' }, encoding: 'utf8',
  }).trim());
  const sql = (query: string) => execFileSync('docker', ['compose', 'exec', '-T', 'db', 'psql', '-U', process.env.DB_USER!, '-d', 'inventory_db', '-v', 'ON_ERROR_STOP=1', '-At', '-c', query], { cwd: resolve(import.meta.dirname, '../../..'), encoding: 'utf8' }).trim();
  const stock = (warehouse: string) => Number(sql(`SELECT COALESCE(SUM(on_hand_qty),0) FROM stock_balances WHERE warehouse_id='${warehouse}' AND variant_id='${fixture.variant}'`));
  expect(stock(fixture.source)).toBe(fixture.beforeSource - 2);
  expect(stock(fixture.destination)).toBe(fixture.beforeDestination);
  await loginStaff(page, 'warehouse01');
  await page.goto('/transfer-receiving');
  const row = page.getByRole('row').filter({ hasText: fixture.number });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'Đã nhận hàng' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('spinbutton', { name: /Số thực nhận/ })).toHaveValue('2');
  await dialog.getByRole('button', { name: 'Xác nhận theo số đã kiểm đếm' }).click();
  await expect(dialog).toBeHidden();
  expect(sql(`SELECT status FROM transfer_orders WHERE id='${fixture.id}'`)).toBe('RECEIVED');
  expect(stock(fixture.source)).toBe(fixture.beforeSource - 2);
  expect(stock(fixture.destination)).toBe(fixture.beforeDestination + 2);
  expect(stock(fixture.source) + stock(fixture.destination)).toBe(fixture.beforeSource + fixture.beforeDestination);
});
