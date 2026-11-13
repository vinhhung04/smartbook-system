import { expect, test } from '@playwright/test';
import { loginStaff } from './helpers';

// Budget allocation on /reorder-suggestions against the real stack: the page sends
// budgetVnd, the analytics service allocates, and every row's default quantity is
// exactly its funded_qty (0 stays empty - never the plain suggestion). If anything is
// funded, the first funded line goes to the draft purchase-order form with that
// quantity. Nothing is saved: the test stops on the draft form.

type Item = { variant_id: string; title: string; funded_qty: number; unit_cost: number; budget_plan: { cap_qty: number } };

test('a budget sets each line to its funded quantity and carries it to the draft purchase order', async ({ page }) => {
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
    await expect(page.getByLabel(`Số lượng nhập cho ${i.title}`).first()).toHaveValue(i.funded_qty > 0 ? String(i.funded_qty) : '');
  }

  const funded = items.find((i) => i.funded_qty > 0);
  test.skip(!funded, 'the current data funds no line at this budget');
  await page.getByLabel(`Chọn ${funded!.title}`).first().check();
  await page.getByRole('region', { name: 'Lựa chọn để tạo đơn đặt hàng' }).getByRole('button', { name: 'Tạo đơn đặt hàng' }).click();
  await expect(page).toHaveURL(/\/purchase-orders\/new/);
  const lines = await page.evaluate(() => window.history.state?.usr?.prefill?.lines);
  expect(lines).toEqual([expect.objectContaining({ variant_id: funded!.variant_id, ordered_qty: funded!.funded_qty })]);
});
