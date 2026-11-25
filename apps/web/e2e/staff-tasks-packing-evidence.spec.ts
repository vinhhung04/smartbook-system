import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { loginStaff } from './helpers';

// Regression for the 2026-11-25 fixes:
//  - staff tasks: an unreachable inventory-service shows the real reason + a working retry
//  - packing: a fully scanned order completes (video uploaded first), returns to the queue,
//    and a manager can replay the stored recording from "Đơn đã đóng gói".
// Chromium's fake camera stands in for the packing-station webcam.

const repoRoot = resolve(import.meta.dirname, '../../..');
const dbUser = process.env.DB_USER || /^DB_USER=(.*)$/m.exec(readFileSync(resolve(repoRoot, '.env'), 'utf8'))?.[1]?.trim();
const sql = (query: string) => execFileSync('docker', ['compose', 'exec', '-T', 'db', 'psql', '-U', dbUser!, '-d', 'inventory_db', '-v', 'ON_ERROR_STOP=1', '-At', '-c', query], { cwd: repoRoot, encoding: 'utf8' }).trim();

test.use({
  permissions: ['camera'],
  launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] },
});

test('staff task list: unreachable service shows the reason, retry loads the list', async ({ page }) => {
  await loginStaff(page, 'hung');
  // the gateway's answer when inventory-service is down
  const down = (route: import('@playwright/test').Route) => route.fulfill({ status: 504, contentType: 'text/plain', body: 'Error occurred while trying to proxy' });
  await page.route(/\/api\/staff-tasks(\?|$)/, down);
  await page.goto('/staff-tasks');
  await expect(page.getByText('Không tải được danh sách task.')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Dịch vụ kho không phản hồi. Kiểm tra dịch vụ đang chạy rồi bấm Thử lại.')).toBeVisible();
  // the header must not claim there are no tasks while loading failed
  await expect(page.getByText(/^Chưa có task/)).toHaveCount(0);

  await page.unroute(/\/api\/staff-tasks(\?|$)/, down);
  await page.getByRole('button', { name: 'Thử lại' }).click();
  await expect(page.getByText('Không tải được danh sách task.')).toBeHidden({ timeout: 15_000 });
  await expect(page.getByText(/\d+ task/).first()).toBeVisible();
});

/** Types into the always-visible scan field like a keyboard-wedge scanner (code + Enter). */
async function scan(page: Page, fieldId: string, code: string) {
  const field = page.locator(`#${fieldId}`);
  await expect(field).toBeEnabled();
  await field.fill(code);
  await field.press('Enter');
  // emptied at once, so the next scan can never be prefixed with this code
  await expect(field).toHaveValue('');
}

test('packing scan fields: always visible, focused, emptied after each scan; camera dialog starts empty', async ({ page }) => {
  await loginStaff(page, 'hung');
  await page.goto('/packing');
  const invoiceField = page.locator('#packing-invoice-scan');
  await expect(invoiceField).toBeVisible();
  await expect(invoiceField).toBeFocused();
  await scan(page, 'packing-invoice-scan', 'KHONG-CO-DON-NAY');
  await expect(page.locator('[data-sonner-toast]').filter({ hasText: /Không tìm thấy/ })).toBeVisible();

  // the camera dialog's manual field used to keep the previous code (scanner then typed it twice)
  await page.getByRole('button', { name: 'Quét bằng camera' }).click();
  const manual = page.locator('#barcode-manual-input');
  await manual.fill('MA-CU-123');
  await manual.press('Enter');
  await expect(manual).toBeHidden();
  await page.getByRole('button', { name: 'Quét bằng camera' }).click();
  await expect(page.locator('#barcode-manual-input')).toHaveValue('');
});

test('packing: scan all books, complete, back to the queue, manager replays the video', async ({ page }) => {
  test.setTimeout(180_000);
  // smallest ready root order not packed yet (a half-packed one is resumed); repick child orders ship with their root
  const row = sql(`
    SELECT o.outbound_number, o.id
    FROM outbound_orders o
    JOIN outbound_order_items i ON i.outbound_order_id = o.id
    WHERE o.status IN ('READY_FOR_OUTBOUND','READY_TO_SHIP')
      AND NOT EXISTS (SELECT 1 FROM packing_tasks p WHERE p.root_order_id = o.id AND p.status = 'COMPLETED')
      AND (o.note IS NULL OR o.note NOT LIKE '%root_task_id=%')
      -- never an order created today: it may be one a person is testing by hand right now
      AND o.created_at < now() - interval '1 day'
    GROUP BY o.id, o.outbound_number
    HAVING SUM(i.processed_qty) BETWEEN 1 AND 8
    ORDER BY SUM(i.processed_qty), o.created_at
    LIMIT 1`);
  test.skip(!row, 'no small order ready for packing in this database');
  const [outboundNumber, orderId] = row.split('|');

  await loginStaff(page, 'hung');
  await page.goto('/packing');
  await scan(page, 'packing-invoice-scan', outboundNumber);
  await expect(page.getByText(`Đã tải đơn ${outboundNumber}`)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Quay lại danh sách' })).toBeVisible({ timeout: 15_000 });

  const items = sql(`
    SELECT v.sku, pi.expected_qty - pi.scanned_qty FROM packing_task_items pi
    JOIN packing_tasks p ON p.id = pi.packing_task_id
    JOIN book_variants v ON v.id = pi.variant_id
    WHERE p.root_order_id = '${orderId}' AND p.status IN ('PENDING','IN_PROGRESS')`).split('\n').filter(Boolean);
  expect(items.length).toBeGreaterThan(0);
  for (const line of items) {
    const [sku, qty] = line.split('|');
    for (let i = 0; i < Number(qty); i += 1) {
      // identical scans within 1.5 s are collapsed on purpose (scanner + camera double reads)
      await page.waitForTimeout(1_700);
      await scan(page, 'packing-book-scan', sku);
      await expect(page.locator('[data-sonner-toast]').filter({ hasText: 'Đúng sách' }).last()).toBeVisible({ timeout: 10_000 });
    }
  }

  // skip the post-scan grace period (or, for an order already fully scanned before, just complete):
  // stops recording, uploads the video, then completes
  await page.getByRole('button', { name: /^Hoàn tất (ngay|đóng gói)/ }).click();
  await expect(page.locator('[data-sonner-toast]').filter({ hasText: 'Đã lưu video đóng gói' })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[data-sonner-toast]').filter({ hasText: `Đã hoàn tất đóng gói đơn ${outboundNumber}` })).toBeVisible({ timeout: 15_000 });
  // back on the queue without a reload, and the order is listed as packed
  await expect(page.getByText('Đơn đang chờ đóng gói')).toBeVisible();
  const packed = page.locator('li', { hasText: outboundNumber }).filter({ has: page.getByRole('button', { name: 'Xem bằng chứng đóng gói' }) });
  await expect(packed).toBeVisible({ timeout: 15_000 });

  expect(sql(`SELECT status FROM packing_tasks WHERE root_order_id='${orderId}' ORDER BY created_at DESC LIMIT 1`)).toBe('COMPLETED');
  expect(Number(sql(`SELECT COUNT(*) FROM inventory_audit_logs l JOIN packing_tasks p ON p.id::text = l.entity_id::text WHERE p.root_order_id='${orderId}' AND l.action_name='PACKING_TASK_COMPLETED'`))).toBe(1);

  await packed.getByRole('button', { name: 'Xem bằng chứng đóng gói' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText(`Bằng chứng đóng gói #${outboundNumber}`)).toBeVisible();
  const video = dialog.locator('video');
  await expect(video).toBeVisible({ timeout: 20_000 });
  await expect.poll(async () => video.evaluate((v: HTMLVideoElement) => (Number.isFinite(v.duration) ? v.duration : 0)), { timeout: 20_000 }).toBeGreaterThan(0);
});

test('packing evidence: a staff member who did not pack the order cannot open its video', async ({ request }) => {
  const evidence = sql(`
    SELECT e.packing_task_id || '|' || e.id FROM packing_camera_evidence e
    JOIN packing_tasks p ON p.id = e.packing_task_id
    WHERE e.evidence_type='VIDEO' AND p.assigned_packer_id IS NOT NULL
    ORDER BY e.captured_at DESC LIMIT 1`);
  test.skip(!evidence, 'no stored packing video yet');
  const [taskId, evidenceId] = evidence.split('|');
  const login = await request.post('http://localhost:3000/auth/login', { data: { identifier: 'staff02', password: process.env.DEMO_PASSWORD || '123456' } });
  const { token } = await login.json();
  const res = await request.get(`http://localhost:3000/api/packing/tasks/${taskId}/evidence/${evidenceId}/video`, { headers: { Authorization: `Bearer ${token}` } });
  expect([403, 404]).toContain(res.status());
  const anonymous = await request.get(`http://localhost:3000/api/packing/tasks/${taskId}/evidence/${evidenceId}/video`);
  expect(anonymous.status()).toBe(401);
});
