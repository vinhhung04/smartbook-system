import fs from 'node:fs';
import { test, type Browser, type Locator, type Page } from '@playwright/test';
import { DEMO_PASSWORD } from './helpers';

// Audit, not a regression test: visits every screen (staff, reader, supplier), opens the
// forms that hold number fields, and for each editable number field checks what a person
// sees when the field shows 0 and they type "75" — "75" is right, "075" is the
// leading-zero bug, losing focus between keys is the focus-jump bug. Nothing is saved:
// forms are closed with Escape and every field is put back to its original value.
// Run with NUMBER_INPUT_AUDIT=1; results go to test-results/number-input-audit.json.

test.skip(!process.env.NUMBER_INPUT_AUDIT, 'set NUMBER_INPUT_AUDIT=1 to run the number input audit');
test.setTimeout(20 * 60_000);

type Verdict = 'OK' | 'LEADING_ZERO' | 'FOCUS_LOST' | 'CLAMPED' | 'OTHER';
interface Finding { role: string; screen: string; field: string; original: string; afterTyping: string; verdict: Verdict }

const findings: Finding[] = [];
const unreachable: string[] = [];

const STAFF_ROUTES = [
  '/dashboard', '/account', '/my-warehouse-tasks', '/my-purchase-requests', '/my-exception-reports',
  '/purchase-requests', '/exception-reports', '/staff-tasks', '/catalog', '/inventory', '/orders', '/orders/new',
  '/purchase-orders', '/purchase-orders/new', '/supplier-deliveries', '/receiving-check', '/putaway',
  '/receiving-putaway', '/receiving-smart', '/picking', '/packing', '/order-requests', '/movements', '/stock-audits',
  '/outbound', '/transfer-receiving', '/warehouses', '/shelves', '/ai-import', '/recommendations',
  '/reorder-suggestions', '/borrow', '/borrow/customers', '/borrow/reservations', '/borrow/loans', '/borrow/fines',
  '/reports', '/ai-assistant', '/audit-trail', '/admin/monitor', '/membership-plans', '/suppliers', '/users', '/roles',
];
// Detail pages: [list page, link prefix].
const STAFF_DETAILS: Array<[string, string]> = [
  ['/catalog', '/book/'], ['/orders', '/orders/'], ['/purchase-orders', '/purchase-orders/'],
  ['/supplier-deliveries', '/supplier-deliveries/'], ['/putaway', '/putaway/'], ['/stock-audits', '/stock-audits/'],
  ['/borrow/loans', '/borrow/loans/'],
];
const CUSTOMER_ROUTES = [
  '/customer', '/customer/profile', '/customer/membership', '/customer/reservations', '/customer/loans',
  '/customer/fines', '/customer/notifications', '/customer/reading-analytics', '/customer/recommendations',
  '/customer/wishlist', '/customer/support',
];

// Forms that only open on a click. Each opener only opens a form; nothing is submitted.
const OPENERS: Record<string, Array<{ name: string; open: (page: Page) => Promise<void> }>> = {
  '/membership-plans': [{ name: 'Gói mới', open: (p) => p.getByRole('button', { name: 'Gói mới' }).first().click() }],
  '/borrow/loans': [{ name: 'Mượn trực tiếp', open: (p) => p.getByRole('button', { name: 'Mượn trực tiếp' }).first().click() }],
  '/borrow/customers': [{ name: 'Ví & nạp tiền', open: (p) => p.locator('button[title="Ví & nạp tiền"]').first().click() }],
  '/borrow/fines': [
    { name: 'Thanh toán', open: (p) => p.getByRole('button', { name: 'Thanh toán' }).and(p.locator(':enabled')).first().click() },
    { name: 'Miễn giảm', open: (p) => p.locator('button[title="Miễn giảm"]:enabled').first().click() },
  ],
  '/my-purchase-requests': [{ name: 'Tạo yêu cầu', open: (p) => p.getByRole('button', { name: 'Tạo yêu cầu' }).first().click() }],
  '/my-exception-reports': [{ name: 'Báo cáo sự cố', open: (p) => p.getByRole('button', { name: 'Báo cáo sự cố' }).first().click() }],
  '/book/': [{ name: 'Chỉnh sửa', open: (p) => p.getByRole('button', { name: 'Chỉnh sửa' }).first().click() }],
};

async function settle(page: Page) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1800);
}

async function fieldName(input: Locator) {
  return input.evaluate((el: HTMLInputElement) => {
    const label = el.id ? document.querySelector(`label[for="${el.id}"]`) : null;
    const wrapping = el.closest('label');
    const prev = el.parentElement?.querySelector('label');
    const text = (label?.textContent || wrapping?.textContent || prev?.textContent || el.placeholder || el.name || el.id || '').trim();
    return text.replace(/\s+/g, ' ').slice(0, 60) || '(không nhãn)';
  });
}

async function probe(page: Page, role: string, screen: string) {
  const inputs = page.locator('input[type="number"]:visible');
  const count = await inputs.count();
  for (let i = 0; i < count; i += 1) {
    const input = inputs.nth(i);
    if (!(await input.isEditable().catch(() => false))) continue;
    const field = await fieldName(input);
    const original = await input.inputValue();
    try {
      await input.click({ timeout: 3000 });
      await page.keyboard.press('Control+A');
      await page.keyboard.press('0');
      if ((await input.inputValue()) !== '0') {
        findings.push({ role, screen, field, original, afterTyping: await input.inputValue(), verdict: 'CLAMPED' });
      } else {
        await page.keyboard.press('End');
        let focusKept = true;
        for (const key of '75') {
          await page.keyboard.press(key);
          focusKept = focusKept && (await input.evaluate((el) => el === document.activeElement));
        }
        const afterTyping = await input.inputValue();
        const verdict: Verdict = !focusKept ? 'FOCUS_LOST' : afterTyping === '75' ? 'OK' : afterTyping === '075' ? 'LEADING_ZERO' : 'OTHER';
        findings.push({ role, screen, field, original, afterTyping, verdict });
      }
      // Put the original value back.
      if (await input.isVisible()) {
        await input.click({ timeout: 3000 });
        await page.keyboard.press('Control+A');
        if (original) await page.keyboard.type(original); else await page.keyboard.press('Backspace');
      }
    } catch (error) {
      unreachable.push(`${role} ${screen} › ${field}: ${(error as Error).message.split('\n')[0]}`);
    }
  }
}

async function visit(page: Page, role: string, route: string, openersKey = route) {
  try {
    await page.goto(route);
    await settle(page);
  } catch (error) {
    unreachable.push(`${role} ${route}: ${(error as Error).message.split('\n')[0]}`);
    return;
  }
  await probe(page, role, route);
  for (const opener of OPENERS[openersKey] || []) {
    try {
      await opener.open(page);
      await page.waitForTimeout(1200);
      await probe(page, role, `${route} › [${opener.name}]`);
    } catch (error) {
      unreachable.push(`${role} ${route} › [${opener.name}]: ${(error as Error).message.split('\n')[0]}`);
    }
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(500);
    await page.goto(route).catch(() => {});
    await settle(page);
  }
}

async function loginPage(browser: Browser, path: string, identifier: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(path);
  await page.getByPlaceholder('Nhập email hoặc tên đăng nhập').fill(identifier);
  await page.getByPlaceholder('Nhập mật khẩu').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await page.waitForURL((url) => !url.pathname.endsWith('/login'), { timeout: 20_000 });
  await settle(page);
  return page;
}

test('number input audit across the system', async ({ browser }) => {
  // Staff: the superuser sees every internal screen.
  const staff = await loginPage(browser, '/login', 'hung');
  for (const route of STAFF_ROUTES) await visit(staff, 'staff', route);
  for (const [list, prefix] of STAFF_DETAILS) {
    await staff.goto(list).catch(() => {});
    await settle(staff);
    const href = await staff.locator(`a[href^="${prefix}"]`).first().getAttribute('href', { timeout: 3000 }).catch(() => null);
    if (!href) { unreachable.push(`staff ${prefix}:id — no link found on ${list}`); continue; }
    await visit(staff, 'staff', href, prefix === '/book/' ? '/book/' : href);
  }

  const reader = await loginPage(browser, '/customer/login', 'customer01');
  for (const route of CUSTOMER_ROUTES) await visit(reader, 'reader', route);
  await reader.goto('/customer/loans');
  await settle(reader);
  const loanHref = await reader.locator('a[href^="/customer/loans/"]').first().getAttribute('href', { timeout: 3000 }).catch(() => null);
  if (loanHref) await visit(reader, 'reader', loanHref);

  const supplier = await loginPage(browser, '/login', 'supplier-sv');
  await visit(supplier, 'supplier', '/supplier');

  fs.mkdirSync('test-results', { recursive: true });
  fs.writeFileSync('test-results/number-input-audit.json', JSON.stringify({ findings, unreachable }, null, 2));
  console.log('\nNUMBER INPUT AUDIT');
  console.table(findings.map(({ role, screen, field, original, afterTyping, verdict }) => ({ verdict, role, screen, field, original, afterTyping })));
  console.log(`unreachable (${unreachable.length}):\n${unreachable.join('\n')}`);
});
