// Captures SmartBook UI screenshots for the thesis from the local dev stack.
// Web: Vite dev server (current source) on 5174 -> gateway on 3000 (demo data).
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const repo = 'C:/Users/hungx/Desktop/Work/Work/KLTN/smartbook-system';
const require = createRequire(path.join(repo, 'apps/web/package.json'));
const { chromium } = require('@playwright/test');

const WEB = 'http://localhost:5174';
const API = 'http://localhost:3000';
const OUT = process.argv[2];
const SCRATCH = process.argv[3];
const only = process.argv.slice(4);
fs.mkdirSync(OUT, { recursive: true });
const PASSWORD = '123456'; // demo seed password (auth-service/prisma/seed.js), local dev only
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function login(username) {
  const r = await fetch(`${API}/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identifier: username, password: PASSWORD }),
  });
  const body = await r.json();
  if (!body.token) throw new Error(`login ${username}: ${r.status} ${JSON.stringify(body).slice(0, 200)}`);
  return body;
}

const browser = await chromium.launch({ channel: 'msedge' });
async function ctx(session, { width = 1440, height = 900, dark = false } = {}) {
  const c = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1.5, locale: 'vi-VN', colorScheme: dark ? 'dark' : 'light' });
  if (session) {
    await c.addInitScript(([t, u]) => {
      localStorage.setItem('token', t);
      localStorage.setItem('auth_user', u);
    }, [session.token, JSON.stringify({ ...session.user, email: `${session.user.username}@smartbook.local` })]);
  }
  return c;
}
async function settle(page, ms = 1500) {
  try { await page.waitForLoadState('networkidle', { timeout: 20000 }); } catch {}
  await page.waitForTimeout(ms);
  await page.evaluate(() => { const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) { if (/hungxh2004@gmail\.com/.test(n.nodeValue)) n.nodeValue = n.nodeValue.replace(/hungxh2004@gmail\.com/g, 'admin@smartbook.local'); } }).catch(() => {});
}
async function shot(page, name, { full = false } = {}) {
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file, fullPage: full });
  log('saved', name);
}
const want = (k) => only.length === 0 || only.includes(k);

const sessions = {};
async function sess(u) { if (!sessions[u]) sessions[u] = await login(u); return sessions[u]; }

try {
  // ---- public, no login
  if (want('public')) {
    const c = await ctx(null);
    const p = await c.newPage();
    await p.goto(`${WEB}/`); await settle(p, 3500);
    await shot(p, 'web-public-home');
    const books = await (await fetch(`${API}/public/catalog/books?limit=1`)).json();
    await p.goto(`${WEB}/books/${books.data[0].id}`); await settle(p, 2500);
    await shot(p, 'web-public-book-detail');
    await p.goto(`${WEB}/login`); await settle(p, 1500);
    await shot(p, 'web-staff-login');
    await p.goto(`${WEB}/customer/register`); await settle(p, 1500);
    // OTP step: stub only the register response (real SMTP must not be used for a screenshot)
    await p.route('**/auth/register', (route) => route.fulfill({
      status: 201, contentType: 'application/json',
      body: JSON.stringify({
        status: 'VERIFICATION_REQUIRED', message: 'Register successful. Verify your email address to activate the account.',
        email_delivery: 'SENT',
        challenge: { id: '6f2c1f0e-1d7a-4c55-9a0b-2f0d8f3f9a11', purpose: 'EMAIL_VERIFICATION', masked_email: 'b***c@example.test', code_length: 6,
          expires_at: new Date(Date.now() + 5 * 60000).toISOString(), resend_available_at: new Date(Date.now() + 60000).toISOString(), attempts_remaining: 5 },
      }),
    }));
    await p.getByLabel('Họ tên').fill('Nguyễn Văn Bạn Đọc');
    await p.getByLabel('Email').fill('bandoc@example.test');
    await p.getByLabel('Tên đăng nhập').fill('bandoc_demo');
    await p.getByLabel('Mật khẩu', { exact: true }).fill('Demo@12345');
    await p.getByLabel('Xác nhận mật khẩu').fill('Demo@12345');
    await p.getByRole('checkbox').first().check();
    await shot(p, 'web-customer-register');
    await p.getByRole('button', { name: /Đăng ký|Tạo tài khoản/ }).first().click();
    await settle(p, 1500);
    await shot(p, 'web-customer-register-otp');
    await c.close();
  }

  // ---- admin
  if (want('admin')) {
    const s = await sess('hung');
    const c = await ctx(s);
    const p = await c.newPage();
    await p.goto(`${WEB}/dashboard`); await settle(p, 4000);
    await shot(p, 'web-admin-dashboard');
    await p.goto(`${WEB}/reorder-suggestions`); await settle(p, 4000);
    await shot(p, 'web-reorder-suggestions');
    await p.goto(`${WEB}/staff-tasks`); await settle(p, 3000);
    await shot(p, 'web-staff-tasks');
    await p.goto(`${WEB}/admin/monitor`); await settle(p, 3000);
    await shot(p, 'web-admin-monitor');
    await p.goto(`${WEB}/roles`); await settle(p, 2500);
    await shot(p, 'web-admin-roles');
    await c.close();
  }

  // ---- AI assistant (live: gateway -> ai-service -> analytics + OpenRouter)
  if (want('assistant')) {
    const s = await sess('hung');
    const c = await ctx(s, { height: 1000 });
    const p = await c.newPage();
    await p.goto(`${WEB}/ai-assistant`); await settle(p, 2500);
    await shot(p, 'web-ai-assistant-empty');
    await p.getByLabel('Câu hỏi cho trợ lý AI').fill('Vẽ biểu đồ xu hướng lượt mượn 6 tháng gần đây và cho biết tháng nào cao nhất');
    await p.keyboard.press('Enter');
    try { await p.locator('.recharts-surface').first().waitFor({ timeout: 120000 }); } catch (e) { log('no chart', e.message); }
    await p.waitForTimeout(8000);
    await shot(p, 'web-ai-assistant-chart');
    await shot(p, 'web-ai-assistant-chart-full', { full: true });
    await c.close();
  }

  // ---- AI import (live OCR on self-made test images)
  if (want('aiimport')) {
    const s = await sess('manager01');
    const c = await ctx(s, { height: 1000 });
    const p = await c.newPage();
    await p.goto(`${WEB}/ai-import`); await settle(p, 3000);
    await shot(p, 'web-ai-import-empty');
    await p.getByLabel('Chọn ảnh bìa trước').setInputFiles(path.join(SCRATCH, 'ocr_imgs/test-front-cover.png'));
    const cp = p.getByLabel(/Chọn ảnh trang (thông tin|bản quyền|xuất bản)/);
    if (await cp.count()) await cp.first().setInputFiles(path.join(SCRATCH, 'ocr_imgs/test-copyright-page.png'));
    else log('no copyright input label found');
    await p.waitForTimeout(1500);
    await p.getByRole('button', { name: 'Quét và trích xuất bằng AI' }).click();
    try { await p.getByRole('region', { name: 'Kết quả AI OCR' }).waitFor({ timeout: 150000 }); } catch (e) { log('ocr wait', e.message); }
    await p.waitForTimeout(5000);
    await shot(p, 'web-ai-import-ocr');
    await shot(p, 'web-ai-import-ocr-full', { full: true });
    await c.close();
  }

  // ---- warehouse staff self-service
  if (want('staff')) {
    const s = await sess('staff01');
    const c = await ctx(s);
    const p = await c.newPage();
    await p.goto(`${WEB}/my-warehouse-tasks`); await settle(p, 3000);
    await shot(p, 'web-my-warehouse-tasks');
    await p.goto(`${WEB}/my-purchase-requests`); await settle(p, 2500);
    await shot(p, 'web-my-purchase-requests');
    await p.goto(`${WEB}/my-exception-reports`); await settle(p, 2500);
    await shot(p, 'web-my-exception-reports');
    await c.close();
  }

  // ---- customer portal
  if (want('customer')) {
    const s = await sess('customer01');
    const c = await ctx(s);
    const p = await c.newPage();
    await p.goto(`${WEB}/customer`); await settle(p, 3000);
    await shot(p, 'web-customer-portal');
    await c.close();
  }
} finally {
  await browser.close();
}


// ---- extra pages redesigned since demo4
if (want('extra')) {
  const pages = [
    ['librarian01', [['web-borrow-overview', '/borrow'], ['web-borrow-reservations', '/borrow/reservations']]],
    ['manager01', [['web-purchase-orders', '/purchase-orders'], ['web-recommendations-staff', '/recommendations']]],
    ['staff01', [['web-putaway', '/putaway'], ['web-packing', '/packing']]],
    ['customer01', [['web-customer-recommendations', '/customer/recommendations'], ['web-customer-scan-cover', '/customer/scan-cover']]],
  ];
  const b2 = await chromium.launch({ channel: 'msedge' });
  try {
    for (const [u, list] of pages) {
      const s = await login(u);
      const c = await b2.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5, locale: 'vi-VN' });
      await c.addInitScript(([t, us]) => { localStorage.setItem('token', t); localStorage.setItem('auth_user', us); }, [s.token, JSON.stringify({ ...s.user, email: `${s.user.username}@smartbook.local` })]);
      const p = await c.newPage();
      for (const [name, route] of list) {
        await p.goto(`${WEB}${route}`);
        try { await p.waitForLoadState('networkidle', { timeout: 20000 }); } catch {}
        await p.waitForTimeout(3000);
        await p.screenshot({ path: path.join(OUT, `${name}.png`) });
        log('saved', name);
      }
      await c.close();
    }
  } finally { await b2.close(); }
}
