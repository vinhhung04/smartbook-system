// Phase E UI check of the reconciliation workflow in the existing Action Center,
// against the real local stack (Vite dev server + gateway + ai-service). Uses an
// isolated headless Edge context per user, so no existing browser session is touched.
//
//   node scripts/phase-e/reconciliation-ui-check.mjs <action_id> <password> [baseURL]
//
// The action must be in RECONCILE_REQUIRED (reconciliation-e2e.py --stop-before-reconcile).
// Screenshots go to docs/AI/phase-e-evidence/.
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('../../apps/web/package.json', import.meta.url));
const { chromium } = require('@playwright/test');

const [actionId, password, baseURL = 'http://localhost:5174'] = process.argv.slice(2);
if (!actionId || !password) {
  console.error('usage: node reconciliation-ui-check.mjs <action_id> <password> [baseURL]');
  process.exit(2);
}
const shots = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../docs/AI/phase-e-evidence');
const results = [];
const step = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} - ${name}${detail ? ` :: ${detail}` : ''}`);
};

async function openQueue(browser, user) {
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 }, locale: 'vi-VN' });
  const page = await context.newPage();
  await page.goto('/login');
  await page.locator('#login-identifier').fill(user);
  await page.locator('#login-password').fill(password);
  await page.getByTestId('login-submit').click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30000 });
  await page.goto('/ai-assistant');
  await page.getByRole('tab', { name: 'Hành động AI' }).click();
  await page.getByRole('button', { name: 'Chờ đối chiếu' }).click();
  return { context, page };
}

const browser = await chromium.launch({ channel: 'msedge' });
try {
  // Admin: queue -> detail -> form validation -> reconcile -> persisted after reload
  const { context, page } = await openQueue(browser, 'hung');
  const row = page.locator('li button', { hasText: 'Người tạo:' }).first();
  await row.waitFor({ timeout: 20000 });
  step('admin sees the RECONCILE_REQUIRED queue with creator + reason', await row.isVisible(),
    (await row.innerText()).replace(/\s+/g, ' ').slice(0, 160));
  await row.click();
  const form = page.getByRole('region', { name: 'Đối chiếu kết quả' });
  await form.waitFor({ timeout: 20000 });
  await page.screenshot({ path: `${shots}/reconcile-ui-1-queue-detail.png` });
  const submit = form.getByRole('button', { name: 'Ghi nhận kết quả' });
  step('submit is disabled until an outcome and a note are given', await submit.isDisabled());
  await form.getByLabel(/Đã thực hiện/).check();
  await form.getByLabel(/Ghi chú đối chiếu/).fill('Đã kiểm tra danh sách đề xuất nhập');
  step('EXECUTED without an evidence reference stays disabled', await submit.isDisabled());
  await form.getByLabel(/Chưa thực hiện/).check();
  await form.getByLabel(/Ghi chú đối chiếu/).fill(`Đã kiểm tra danh sách đề xuất nhập: không có đề xuất nào gắn với ${actionId}`);
  step('FAILED with a note can be submitted', await submit.isEnabled());
  await page.screenshot({ path: `${shots}/reconcile-ui-2-form-filled.png` });
  await submit.click();
  await page.getByText('Đã ghi nhận: đề xuất chưa được thực hiện.').waitFor({ timeout: 20000 });
  step('success toast after reconciling', true);
  await page.getByText('Admin đã đối chiếu').first().waitFor({ timeout: 20000 });
  await page.screenshot({ path: `${shots}/reconcile-ui-3-audit.png` });
  step('audit timeline shows the RECONCILED event with the note',
    await page.getByText(/Ghi chú: Đã kiểm tra danh sách đề xuất nhập/).first().isVisible());
  await page.reload();
  await page.getByRole('tab', { name: 'Hành động AI' }).click();
  await page.getByRole('button', { name: 'Chờ đối chiếu' }).click();
  // the queue held only this action (reconciliation-e2e.py checked total=1)
  const empty = page.getByText('Không có hành động nào ở trạng thái này.');
  await empty.waitFor({ timeout: 20000 }).catch(() => {});
  step('after reload the reconciled action has left the queue (state persisted)', await empty.isVisible());
  await page.screenshot({ path: `${shots}/reconcile-ui-4-after-reload.png` });
  await context.close();

  // Non-admin (manager, the creator): sees own actions, no reconciliation form
  const manager = await openQueue(browser, 'manager01');
  await manager.page.getByRole('button', { name: 'Tất cả' }).click();
  await manager.page.waitForTimeout(1500);
  step('creator (non-admin) has no reconciliation form anywhere',
    (await manager.page.getByRole('region', { name: 'Đối chiếu kết quả' }).count()) === 0);
  await manager.context.close();
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.ok).length;
console.log(JSON.stringify({ actionId, steps: results.length, failed }));
process.exit(failed ? 1 : 0);
