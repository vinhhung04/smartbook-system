import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { test, expect } from '@playwright/test';
import { loginStaff, DEMO_PASSWORD } from './helpers';

test('counted stock preserves later outbound when a manager approves the audit', async ({ page }) => {
  test.skip(process.env.SMARTBOOK_TEST_ISOLATED !== '1', 'requires disposable QA database');
  const tag = randomUUID().slice(0, 8);
  const title = `Count cutoff ${tag}`;
  const sql = (query: string) => execFileSync('docker', ['compose', 'exec', '-T', 'db', 'psql', '-U', process.env.DB_USER!, '-d', 'inventory_db', '-v', 'ON_ERROR_STOP=1', '-At', '-c', query], { cwd: resolve(import.meta.dirname, '../../..'), encoding: 'utf8' }).trim();
  const ids = sql(`WITH w AS (SELECT id FROM warehouses WHERE code='WH-HCM-01'),
    l AS (INSERT INTO locations(warehouse_id,location_code,location_type) SELECT id,'CNT-${tag}','BIN' FROM w RETURNING id,warehouse_id),
    b AS (INSERT INTO books(title) VALUES ('${title}') RETURNING id),
    v AS (INSERT INTO book_variants(book_id,sku) SELECT id,'CNT-${tag}' FROM b RETURNING id),
    s AS (INSERT INTO stock_balances(warehouse_id,location_id,variant_id,on_hand_qty,available_qty) SELECT l.warehouse_id,l.id,v.id,10,10 FROM l,v)
    SELECT l.warehouse_id,l.id,v.id FROM l,v`).split('|');
  expect(ids).toHaveLength(3);
  const gateway = process.env.GATEWAY_URL || 'http://localhost:13000';
  const login = await fetch(`${gateway}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'hung', password: DEMO_PASSWORD }) }).then(r => r.json());
  const created = await fetch(`${gateway}/api/stock-audits`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${login.token}` }, body: JSON.stringify({ warehouse_id: ids[0], location_ids: [ids[1]] }) });
  expect(created.status).toBe(201);
  const audit = (await created.json()).data;
  try {
    const staff = await fetch(`${gateway}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'staff01', password: DEMO_PASSWORD }) }).then(r => r.json());
    const assigned = await fetch(`${gateway}/api/stock-audits/${audit.id}/assign`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${login.token}` },
      body: JSON.stringify({ assigned_to_user_id: staff.user.id }),
    });
    expect(assigned.status).toBe(200);
    await loginStaff(page);
    await page.goto(`/stock-audits/${audit.id}`);
    await expect(page.getByText('Chỉ đếm sách thực sự có tại vị trí', { exact: false })).toBeVisible();
    const inputs = page.getByRole('spinbutton', { name: `Số đếm được, ${title}` });
    const input = inputs.filter({ visible: true });
    await input.fill('8');
    await input.blur();
    const confirm = page.getByRole('button', { name: `Chốt số đếm CNT-${tag}` });
    await expect(confirm).toBeEnabled();
    await confirm.click();
    await expect(page.getByRole('button', { name: `Đã chốt CNT-${tag}` })).toBeDisabled();
    sql(`UPDATE stock_balances SET on_hand_qty=on_hand_qty-2, available_qty=available_qty-2 WHERE variant_id='${ids[2]}' AND location_id='${ids[1]}'`);
    await page.getByRole('button', { name: 'Nộp phiếu kiểm kê' }).click();
    await expect(page.getByRole('button', { name: 'Duyệt và điều chỉnh tồn kho' })).toBeVisible();
    // Move off the action bar so Sonner resumes its auto-dismiss timer.
    await page.mouse.move(0, 0);
    await expect(page.locator('[data-sonner-toast][data-visible="true"]')).toHaveCount(0, { timeout: 15000 });
    await page.getByRole('button', { name: 'Duyệt và điều chỉnh tồn kho' }).click();
    await expect(page.getByText('Đã duyệt phiếu, điều chỉnh 1 mục tồn kho')).toBeVisible();
    expect(Number(sql(`SELECT on_hand_qty FROM stock_balances WHERE variant_id='${ids[2]}' AND location_id='${ids[1]}'`))).toBe(6);
  } finally {
    // Business cancellation releases a failed test's count freeze; preserve rows.
    await fetch(`${gateway}/api/stock-audits/${audit.id}/cancel`, { method: 'PATCH', headers: { Authorization: `Bearer ${login.token}` } });
  }
});
