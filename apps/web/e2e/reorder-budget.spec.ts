import { expect, test } from '@playwright/test';
import { loginStaff } from './helpers';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

// Budget allocation on /reorder-suggestions against the real stack: the page sends
// budgetVnd, the analytics service allocates, and every row's default quantity is
// exactly its funded_qty (0 stays empty - never the plain suggestion). If anything is
// funded, the first funded line goes to the draft purchase-order form with that
// quantity. Nothing is saved: the test stops on the draft form.

type Item = { variant_id: string; title: string; funded_qty: number; unit_cost: number; budget_plan: { cap_qty: number } };

test('a budget sets each line to its funded quantity and carries it to the draft purchase order', async ({ page }) => {
  if (process.env.SMARTBOOK_TEST_ISOLATED === '1') {
    // Add this run's demand rather than editing stock or cancelling earlier POs.
    const sql = `WITH b AS (INSERT INTO books(title) VALUES ('Audit budget demand ' || gen_random_uuid()::text) RETURNING id),
      v AS (INSERT INTO book_variants(book_id,sku,unit_cost)
        SELECT id, 'AUD-BUDGET-' || gen_random_uuid()::text, 10000 FROM b RETURNING id),
      loc AS (SELECT l.id,l.warehouse_id FROM locations l JOIN warehouses w ON w.id=l.warehouse_id WHERE w.code='WH-HCM-01' LIMIT 1)
      INSERT INTO stock_balances(variant_id,location_id,warehouse_id,on_hand_qty,available_qty,reorder_point)
      SELECT v.id,loc.id,loc.warehouse_id,0,0,5 FROM v CROSS JOIN loc`;
    execFileSync('docker', ['compose', 'exec', '-T', 'db', 'psql', '-U', process.env.DB_USER!, '-d', 'inventory_db', '-v', 'ON_ERROR_STOP=1', '-c', sql],
      { cwd: resolve(import.meta.dirname, '../../..'), stdio: 'pipe' });
  }
  await loginStaff(page, 'manager01');
  const initial = page.waitForResponse((r) => r.url().includes('/analytics/reorder-suggestions'));
  await page.goto('/reorder-suggestions');
  await initial;

  const input = page.locator('#budget-input');
  await input.fill('5000000');
  const allocated = page.waitForResponse((r) => r.url().includes('/analytics/reorder-suggestions') && r.url().includes('budgetVnd=5000000'));
  await input.press('Enter');
  const { data } = await (await allocated).json();

  expect(data.budget).not.toBeNull();
  expect(data.budget.funded_cost).toBeLessThanOrEqual(5_000_000);
  const items: Item[] = data.items;
  // every funded line is in the list the page received
  expect(items.filter((i) => i.funded_qty > 0).length).toBe(data.budget.funded_lines);
  for (const i of items) {
    expect(i.funded_qty).toBeLessThanOrEqual(i.budget_plan.cap_qty);
    if (!(i.unit_cost > 0)) expect(i.funded_qty).toBe(0);
  }

  await expect(page.getByText(/Đang áp dụng 5\.000\.000/)).toBeVisible();
  for (const i of items) {
    // Different variants can share a title; the hint associates this input with
    // the exact variant returned by analytics.
    await expect(page.locator(`[aria-describedby="reorder-qty-hint-${i.variant_id}"]`)).toHaveValue(i.funded_qty > 0 ? String(i.funded_qty) : '');
  }

  const funded = items.find((i) => i.funded_qty > 0);
  test.skip(!funded, 'the current data funds no line at this budget');
  await page.getByRole('row').filter({ has: page.locator(`[aria-describedby="reorder-qty-hint-${funded!.variant_id}"]`) }).getByRole('checkbox').check();
  await page.getByRole('region', { name: 'Lựa chọn để tạo đơn đặt hàng' }).getByRole('button', { name: 'Tạo đơn đặt hàng' }).click();
  await expect(page).toHaveURL(/\/purchase-orders\/new/);
  const lines = await page.evaluate(() => window.history.state?.usr?.prefill?.lines);
  expect(lines).toEqual([expect.objectContaining({ variant_id: funded!.variant_id, ordered_qty: funded!.funded_qty })]);
});
