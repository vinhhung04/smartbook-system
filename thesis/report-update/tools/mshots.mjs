// Mobile (Expo web build of apps/mobile) screenshots at phone width, against the local gateway.
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
const repo = 'C:/Users/hungx/Desktop/Work/Work/KLTN/smartbook-system';
const require = createRequire(path.join(repo, 'apps/web/package.json'));
const { chromium } = require('@playwright/test');
const OUT = process.argv[2];
fs.mkdirSync(OUT, { recursive: true });
const URL = 'http://localhost:8081';
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const browser = await chromium.launch({ channel: 'msedge' });

async function run(user, shots) {
  const c = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'vi-VN' });
  const p = await c.newPage();
  await p.goto(`${URL}/login`, { timeout: 180000 });
  await p.getByPlaceholder('Nhập tài khoản').waitFor({ timeout: 180000 });
  await p.screenshot({ path: path.join(OUT, 'mobile-login.png') });
  await p.getByPlaceholder('Nhập tài khoản').fill(user);
  await p.getByPlaceholder('Nhập mật khẩu').fill('123456'); // demo seed password, local only
  await p.getByText('Đăng nhập', { exact: true }).last().click();
  await p.waitForTimeout(6000);
  for (const [name, route] of shots) {
    if (route) { await p.goto(`${URL}${route}`); }
    await p.waitForTimeout(5000);
    await p.evaluate(() => { for (const el of document.querySelectorAll('div')) { if (el.childElementCount < 8 && /Received `false` for a non-boolean/.test(el.textContent || '')) { let n = el; while (n && getComputedStyle(n).position !== 'fixed' && n.parentElement) n = n.parentElement; (n || el).style.display = 'none'; } } });
    if (!route) { await p.mouse.click(308, 808); await p.waitForTimeout(800); }
    await p.screenshot({ path: path.join(OUT, `${name}.png`) });
    log('saved', name, p.url());
  }
  await c.close();
}
try {
  await run('customer01', [['mobile-customer-home', null], ['mobile-customer-my-books', '/customer/my-books'], ['mobile-customer-wallet', '/customer/wallet']]);
  await run('staff01', [['mobile-staff-home', null], ['mobile-staff-tasks', '/tasks'], ['mobile-staff-picking', '/picking']]);
} finally { await browser.close(); }

