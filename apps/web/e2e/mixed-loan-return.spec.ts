import { expect, test } from '@playwright/test';
import { loginStaff, DEMO_PASSWORD } from './helpers';
import { createCustomerFixture } from '../../../scripts/testing/customer-fixture.mjs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

test('staff returns three copies with separate GOOD, DAMAGED and LOST outcomes', async ({ page, request }) => {
  test.skip(process.env.SMARTBOOK_TEST_ISOLATED !== '1', 'requires isolated QA fixtures');
  const gateway = process.env.GATEWAY_URL || 'http://localhost:13000';
  const auth = await request.post(`${gateway}/auth/login`, { data: { identifier: 'hung', password: DEMO_PASSWORD } });
  expect(auth.ok()).toBeTruthy();
  const token = (await auth.json()).token;
  const headers = { Authorization: `Bearer ${token}` };
  const fixture = await createCustomerFixture({ baseUrl: gateway, password: DEMO_PASSWORD, adminToken: token });
  // The demo default plan has no deposit. Give only this new reader a dedicated
  // plan so this scenario proves per-copy deposit settlement as well as stock.
  expect(fixture.customerId).toMatch(/^[0-9a-f-]{36}$/i);
  const tag = crypto.randomUUID().slice(0, 8);
  const sql = `WITH p AS (INSERT INTO membership_plans(code,name,deposit_per_item,max_active_loans,fine_per_day)
    VALUES ('MIX-${tag}','Mixed return fixture',30000,3,0) RETURNING id)
    INSERT INTO customer_memberships(customer_id,plan_id,card_number,start_date)
    SELECT '${fixture.customerId}',id,'MIX-${tag}',CURRENT_DATE FROM p`;
  execFileSync('docker', ['compose','exec','-T','db','psql','-U',process.env.DB_USER!,'-d','borrow_db','-v','ON_ERROR_STOP=1','-c',sql],
    { cwd: resolve(import.meta.dirname, '../../..'), stdio: 'pipe' });
  const inventorySql = `WITH w AS (SELECT id FROM warehouses WHERE code='WH-HCM-01'),
    b AS (INSERT INTO books(title) VALUES ('Mixed return fixture ${tag}') RETURNING id),
    v AS (INSERT INTO book_variants(book_id,sku) SELECT id,'MIX-${tag}' FROM b RETURNING id),
    l AS (INSERT INTO locations(warehouse_id,location_code,location_type,is_pickable) SELECT id,'MIX-${tag}','COMPARTMENT',true FROM w RETURNING id,warehouse_id),
    s AS (INSERT INTO stock_balances(warehouse_id,location_id,variant_id,on_hand_qty,available_qty) SELECT l.warehouse_id,l.id,v.id,3,3 FROM l,v)
    SELECT json_build_object('variant_id',v.id,'default_warehouse_id',l.warehouse_id,'location_id',l.id) FROM v,l`;
  const book = JSON.parse(execFileSync('docker', ['compose','exec','-T','db','psql','-U',process.env.DB_USER!,'-d','inventory_db','-v','ON_ERROR_STOP=1','-At','-c',inventorySql],
    { cwd: resolve(import.meta.dirname, '../../..'), encoding: 'utf8' }).trim());
  const created = await request.post(`${gateway}/borrow/loans/direct`, { headers: { ...headers, 'Idempotency-Key': crypto.randomUUID() },
    data: { customer_id: fixture.customerId, variant_id: book.variant_id, warehouse_id: book.default_warehouse_id, quantity: 3, source_channel: 'COUNTER',
      picks: [{ location_id: book.location_id, quantity: 3 }] } });
  expect(created.status(), await created.text()).toBe(201);
  const loan = (await created.json()).data;
  const detail = await (await request.get(`${gateway}/borrow/loans/${loan.id}`, { headers })).json();
  const items = detail.data.loan_items;
  expect(items).toHaveLength(3);
  await loginStaff(page);
  await page.goto(`/borrow/loans/${loan.id}`);
  await page.getByTestId('return-loan-button').click();
  for (const [index, item] of items.entries()) {
    await page.getByLabel(`Tình trạng trả ${item.id}`, { exact: true }).selectOption(['GOOD', 'DAMAGED', 'LOST'][index]);
    await page.getByLabel(`Ghi chú trả ${item.id}`, { exact: true }).fill(`copy ${index}`);
    if (index) await page.getByLabel(`Lý do xử lý ${item.id}`, { exact: true }).fill('Đã kiểm tra tình trạng cuốn sách');
    // GOOD and DAMAGED copies go back on a shelf; the lost one has none.
    if (index < 2) await page.getByLabel(`Vị trí trả về ${item.id}`, { exact: true }).selectOption(book.location_id);
  }
  await expect(page.getByText('Đang tính tiền cọc và tiền phạt…')).toBeHidden({ timeout: 15000 });
  const returned = page.waitForResponse(response => response.url().endsWith(`/borrow/loans/${loan.id}/return`) && response.request().method() === 'POST');
  await page.getByTestId('confirm-dialog-action').click();
  const response = await returned;
  expect(response.status(), await response.text()).toBe(200);
  const result = (await response.json()).data;
  expect(result.item_results.map((row: { status: string }) => row.status).sort()).toEqual(['LOST', 'RETURNED', 'RETURNED']);
  expect(result.status).toBe('LOST');
  expect(result.deposit_settlements).toHaveLength(3);
  const stored = (await (await request.get(`${gateway}/borrow/loans/${loan.id}`, { headers })).json()).data;
  for (const [index, item] of items.entries()) {
    const saved = stored.loan_items.find((row: { id: string }) => row.id === item.id);
    expect(saved.notes).toBe(`copy ${index}`);
    expect(saved.item_condition_on_return).toBe(['GOOD', 'DAMAGED', 'LOST'][index]);
    expect(Number(saved.loan_item_deposits.refunded_amount)).toBe(index === 0 ? 30000 : 0);
  }
});
