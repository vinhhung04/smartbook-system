import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { test, expect } from '@playwright/test';
import { loginStaff } from './helpers';

test('manager receives usable stock, isolates damaged copies and approves each transfer discrepancy', async ({ page }) => {
  test.setTimeout(120000);
  if (process.env.SMARTBOOK_TEST_ISOLATED !== '1') throw new Error('Run in the disposable QA stack');
  const sql = (query: string) => execFileSync('docker', ['compose', 'exec', '-T', 'db', 'psql', '-U', process.env.DB_USER!, '-d', 'inventory_db', '-v', 'ON_ERROR_STOP=1', '-At', '-c', query], { cwd: resolve(import.meta.dirname, '../../..'), encoding: 'utf8' }).trim();
  // An already dispatched shipment is the fixture boundary. The browser drives
  // physical receiving and every manager decision against actual services/DB.
  const fixture = JSON.parse(sql(`WITH b AS (INSERT INTO books(title) VALUES ('Discrepancy UI fixture') RETURNING id),
    v AS (INSERT INTO book_variants(book_id,sku) SELECT id,'TD-UI-'||gen_random_uuid()::text FROM b RETURNING id),
    t AS (INSERT INTO transfer_orders(transfer_number,from_warehouse_id,to_warehouse_id,requested_by_user_id,status)
      SELECT 'TD-'||substr(gen_random_uuid()::text,1,30),s.id,d.id,gen_random_uuid(),'IN_TRANSIT'
      FROM warehouses s,warehouses d WHERE s.code='WH-HCM-01' AND d.code='BR-HCM-01' RETURNING *),
    i AS (INSERT INTO transfer_order_items(transfer_order_id,variant_id,quantity,shipped_qty)
      SELECT t.id,v.id,10,10 FROM t,v)
    SELECT json_build_object('id',t.id,'number',t.transfer_number,'source',t.from_warehouse_id,'destination',t.to_warehouse_id,'variant',v.id) FROM t,v`));
  expect(fixture.id).toMatch(/^[0-9a-f-]{36}$/i);
  await loginStaff(page);
  await page.goto('/transfer-receiving');
  await page.getByRole('combobox', { name: 'Kho đích', exact: true }).click();
  await page.getByRole('option', { name: /BR-HCM-01/ }).click();
  const row = page.getByRole('row').filter({ hasText: fixture.number });
  await row.getByRole('button', { name: 'Đã nhận hàng' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('spinbutton', { name: /Số thực nhận/ }).fill('9');
  await dialog.getByRole('spinbutton', { name: /Số hỏng/ }).fill('1');
  await dialog.getByRole('spinbutton', { name: /Số từ chối/ }).fill('1');
  await dialog.getByRole('button', { name: 'Xác nhận theo số đã kiểm đếm' }).click();
  await expect(dialog).toBeHidden();
  const panel = page.getByTestId('transfer-discrepancies');
  await panel.getByRole('listitem').filter({ hasText: fixture.number }).getByRole('button', { name: 'Xem và xử lý' }).click();
  await expect(panel.getByText(/xuất 10, đến 9, đạt 7/)).toBeVisible();
  async function approve(reason: string) {
    await panel.getByLabel('Lý do phê duyệt', { exact: true }).fill(reason);
    await panel.getByLabel('Tham chiếu bằng chứng', { exact: true }).fill(`UI-${fixture.id}`);
    await panel.getByRole('button', { name: 'Phê duyệt xử lý số lượng này' }).click();
    await page.getByRole('alertdialog').getByTestId('confirm-dialog-action').click();
    await expect(panel.getByLabel('Lý do phê duyệt', { exact: true })).toHaveCount(0);
  }
  await approve('Tìm thấy một cuốn của chuyến gốc trong xe giao hàng');
  await panel.getByRole('button', { name: 'Xử lý phần còn lại' }).click();
  await approve('Duyệt loại bỏ một cuốn hỏng theo biên bản');
  await panel.getByRole('button', { name: 'Xử lý phần còn lại' }).click();
  await panel.getByRole('combobox', { name: 'Phương án', exact: true }).selectOption('RETURN_TO_SOURCE');
  await approve('Đã kiểm chứng cuốn bị từ chối hoàn về kho nguồn');
  await expect(panel.getByRole('heading', { name: /Đã xử lý xong/ })).toBeVisible();
  expect(sql(`SELECT status FROM transfer_discrepancies WHERE transfer_order_id='${fixture.id}'`)).toBe('RESOLVED');
  expect(Number(sql(`SELECT SUM(on_hand_qty) FROM stock_balances WHERE variant_id='${fixture.variant}' AND warehouse_id='${fixture.destination}'`))).toBe(8);
  expect(Number(sql(`SELECT SUM(available_qty) FROM stock_balances WHERE variant_id='${fixture.variant}'`))).toBe(0);
  expect(Number(sql(`SELECT SUM(on_hand_qty) FROM stock_balances WHERE variant_id='${fixture.variant}' AND warehouse_id='${fixture.source}'`))).toBe(1);
});
