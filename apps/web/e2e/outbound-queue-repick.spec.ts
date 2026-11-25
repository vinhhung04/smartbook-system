import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect } from '@playwright/test';
import { DEMO_PASSWORD, loginStaff } from './helpers';

// Regression for the 2026-11-25 outbound fixes:
//  - /outbound opens on "Tất cả kho" (it used to pick the first warehouse and look empty)
//  - the queue lists packed root orders (external_reference NULL was dropped by SQL NOT LIKE)
//  - REPICK orders and unpacked orders are never offered as "Xác nhận xuất", in the queue or in my tasks.
// Fixture orders are inserted straight into WH-HCM-01 and removed afterwards.

const repoRoot = resolve(import.meta.dirname, '../../..');
const dbUser = process.env.DB_USER || /^DB_USER=(.*)$/m.exec(readFileSync(resolve(repoRoot, '.env'), 'utf8'))?.[1]?.trim();
const sql = (query: string) => execFileSync('docker', ['compose', 'exec', '-T', 'db', 'psql', '-U', dbUser!, '-d', 'inventory_db', '-v', 'ON_ERROR_STOP=1', '-At', '-c', query], { cwd: repoRoot, encoding: 'utf8' }).trim();
const GATEWAY = (process.env.GATEWAY_URL || 'http://localhost:3000').replace(/\/$/, '');

test('outbound queue shows every warehouse and only packed root orders; my tasks match', async ({ page, request }) => {
  const login = await request.post(`${GATEWAY}/auth/login`, { data: { identifier: 'hung', password: DEMO_PASSWORD } });
  expect(login.ok()).toBeTruthy();
  const { token, user } = await login.json();
  const tag = `E2EOQ${Date.now().toString(36).toUpperCase()}`;
  const wh = sql(`SELECT id FROM warehouses WHERE code='WH-HCM-01'`);
  const variant = sql(`SELECT variant_id FROM stock_balances WHERE warehouse_id='${wh}' LIMIT 1`);
  const order = (suffix: string, extra: { ref?: string; note?: string }, qty: number, picked: number, packed: boolean) => {
    const id = sql(`INSERT INTO outbound_orders (outbound_number, warehouse_id, outbound_type, status, requested_by_user_id, processed_by_user_id, external_reference, note)
      VALUES ('${tag}-${suffix}', '${wh}', 'MANUAL', 'READY_TO_SHIP', '${user.id}', '${user.id}', ${extra.ref ? `'${extra.ref}'` : 'NULL'}, ${extra.note ? `'${extra.note}'` : 'NULL'}) RETURNING id`).split('\n')[0];
    sql(`INSERT INTO outbound_order_items (outbound_order_id, variant_id, quantity, processed_qty) VALUES ('${id}', '${variant}', ${qty}, ${picked})`);
    if (packed) sql(`INSERT INTO packing_tasks (task_number, root_order_id, warehouse_id, status, completed_at) VALUES ('PK-${tag}-${suffix}', '${id}', '${wh}', 'COMPLETED', now())`);
    return id;
  };

  try {
    const root = order('ROOT', {}, 2, 1, true);
    const child = order('REPICK', { ref: `REPICK:${tag}-ROOT`, note: `[REPICK_META] root_task_type=outbound;root_task_id=${root};parent_task_type=outbound;parent_task_id=${root};repick_sequence=1;repick_reason=SHORT_PICK` }, 1, 1, true);
    const unpacked = order('UNPACKED', {}, 1, 1, false);

    // API: my tasks offer the root for outbound confirmation, never the REPICK child or the unpacked order
    const mine = await request.get(`${GATEWAY}/api/my-warehouse-tasks`, { headers: { Authorization: `Bearer ${token}` } });
    expect(mine.ok()).toBeTruthy();
    const taskIds = ((await mine.json()).data as Array<{ id: string; type: string }>).map((t) => `${t.type}:${t.id}`);
    expect(taskIds).toContain(`OUTBOUND:${root}`);
    expect(taskIds.filter((t) => t.endsWith(child) || t.endsWith(unpacked))).toEqual([]);

    // UI: the queue opens on every warehouse and lists only the packed root, with the repick counted in
    await loginStaff(page, 'hung');
    await page.goto('/outbound');
    await expect(page.getByRole('button', { name: 'Tất cả kho' })).toHaveAttribute('aria-pressed', 'true');
    await page.getByPlaceholder('Mã đơn, mã kho hoặc loại đơn').fill(tag);
    const queue = page.getByRole('region', { name: 'Hàng đợi xuất kho' }).or(page.locator('section[aria-labelledby="outbound-queue-title"]')).first();
    await expect(queue.getByText(`${tag}-ROOT`)).toBeVisible({ timeout: 15_000 });
    await expect(queue.getByText(`${tag}-REPICK`)).toHaveCount(0);
    await expect(queue.getByText(`${tag}-UNPACKED`)).toHaveCount(0);
    await expect(queue.getByRole('row').filter({ hasText: `${tag}-ROOT` })).toContainText(/2\s*\/\s*2\s*cuốn/);
  } finally {
    sql(`DELETE FROM packing_tasks WHERE task_number LIKE 'PK-${tag}-%'`);
    sql(`DELETE FROM outbound_order_items WHERE outbound_order_id IN (SELECT id FROM outbound_orders WHERE outbound_number LIKE '${tag}-%')`);
    sql(`DELETE FROM outbound_orders WHERE outbound_number LIKE '${tag}-%'`);
  }
});
