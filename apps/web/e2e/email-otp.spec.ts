import { test, expect, type Page } from '@playwright/test';
import { DEMO_PASSWORD } from './helpers';

/**
 * Email OTP through the browser. Codes are read from Mailpit (the dev mail catcher in
 * docker-compose.yml, http://localhost:8025) — auth-service never logs them.
 * The staff second-factor test needs auth-service started with
 * STAFF_EMAIL_OTP_MODE=optional and runs only when E2E_STAFF_OTP=1.
 */
const GATEWAY = (process.env.GATEWAY_URL || 'http://localhost:3000').replace(/\/$/, '');
const MAILPIT = (process.env.MAILPIT_URL || 'http://localhost:8025').replace(/\/$/, '');
const CODE_FIELD = 'Mã xác thực (6 chữ số)';

async function codeFor(to: string, after: number): Promise<string> {
  for (let i = 0; i < 40; i += 1) {
    const search = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`).then((r) => r.json());
    const latest = (search.messages || []).find((m: { Created: string }) => Date.parse(m.Created) >= after);
    if (latest) {
      const message = await fetch(`${MAILPIT}/api/v1/message/${latest.ID}`).then((r) => r.json());
      const match = /Mã xác thực: (\d{6})/.exec(message.Text || '');
      if (match) return match[1];
    }
    await new Promise((r) => { setTimeout(r, 250); });
  }
  throw new Error(`no code mailed to ${to}`);
}

const storageHas = (page: Page, needle: string) => page.evaluate((n) => JSON.stringify({ ...localStorage, ...sessionStorage }).includes(n), needle);
const hasSession = (page: Page) => page.evaluate(() => Boolean(localStorage.getItem('token')));

test.describe('Email OTP', () => {
  test('a new reader verifies their email with a code and lands back on the book', async ({ page }) => {
    const run = `e2e_otp_${Date.now().toString(36)}`;
    const email = `${run}@example.com`;
    const back = '/books?availability=available';
    const since = Date.now() - 1000;

    await page.goto(`/customer/register?returnUrl=${encodeURIComponent(back)}`);
    await page.getByLabel('Họ tên').fill('Bạn Đọc OTP');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Tên đăng nhập').fill(run);
    await page.getByLabel('Mật khẩu', { exact: true }).fill(DEMO_PASSWORD);
    await page.getByLabel('Xác nhận mật khẩu').fill(DEMO_PASSWORD);
    await page.locator('#register-agree').check();
    await page.getByRole('button', { name: 'Tạo tài khoản' }).click();

    await expect(page.getByRole('heading', { name: 'Xác thực email của bạn' })).toBeVisible({ timeout: 15_000 });
    // masked address only, and no session before the code
    await expect(page.getByText(email)).toHaveCount(0);
    await expect(page.getByText(/e\*+\d?@example\.com|e\*+[a-z0-9]@example\.com/)).toBeVisible();
    expect(await hasSession(page)).toBe(false);

    const input = page.getByLabel(CODE_FIELD);
    await expect(input).toBeFocused();
    await expect(input).toHaveAttribute('inputmode', 'numeric');
    await expect(input).toHaveAttribute('autocomplete', 'one-time-code');
    await expect(page.getByRole('button', { name: /Gửi lại mã sau/ })).toHaveAttribute('aria-disabled', 'true');

    const code = await codeFor(email, since);
    await input.pressSequentially(code === '000000' ? '000001' : '000000');
    await expect(page.getByText('Mã không đúng. Bạn còn 4 lần thử.')).toBeVisible();
    await expect(input).toHaveValue('');
    expect(await hasSession(page)).toBe(false);

    // pasted with a space, as some mail apps copy it; completes on its own
    await input.fill(`${code.slice(0, 3)} ${code.slice(3)}`);
    await expect(page).toHaveURL(back, { timeout: 15_000 });
    expect(await hasSession(page)).toBe(true);
    expect(await storageHas(page, code)).toBe(false);
  });

  test('an unverified reader who logs in gets the code step, and can go back', async ({ page }) => {
    const run = `e2e_otp_${Date.now().toString(36)}b`;
    const res = await fetch(`${GATEWAY}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: run, email: `${run}@example.com`, password: DEMO_PASSWORD, full_name: 'Bạn Đọc Chờ' }),
    });
    expect(res.status).toBe(201);

    await page.goto('/customer/login');
    await page.getByPlaceholder('Nhập email hoặc tên đăng nhập').fill(run);
    await page.getByPlaceholder('Nhập mật khẩu').fill(DEMO_PASSWORD);
    await page.getByTestId('customer-login-submit').click();
    await expect(page.getByRole('heading', { name: 'Xác thực email của bạn' })).toBeVisible({ timeout: 15_000 });
    expect(await hasSession(page)).toBe(false);

    await page.getByRole('button', { name: 'Quay lại đăng nhập' }).click();
    await expect(page.getByPlaceholder('Nhập mật khẩu')).toHaveValue('');
    await expect(page.getByPlaceholder('Nhập mật khẩu')).toBeFocused();
  });

  test('the old staff sign-up page now leads to reader registration', async ({ page }) => {
    await page.goto('/register');
    await expect(page).toHaveURL(/\/customer\/register$/);
  });

  test('staff with email sign-in codes get no session until the code', async ({ page }) => {
    test.skip(process.env.E2E_STAFF_OTP !== '1', 'needs auth-service with STAFF_EMAIL_OTP_MODE=optional (E2E_STAFF_OTP=1)');
    const run = `e2e_otp_${Date.now().toString(36)}s`;
    const email = `${run}@example.com`;
    const post = (path: string, body: unknown, token?: string, method = 'POST') => fetch(`${GATEWAY}${path}`, {
      method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body),
    }).then(async (r) => ({ status: r.status, body: await r.json() }));

    const admin = await post('/auth/login', { identifier: 'hung', password: DEMO_PASSWORD });
    const created = await post('/iam/users', { username: run, email, full_name: 'Nhân Viên OTP', password: DEMO_PASSWORD, role_codes: ['WAREHOUSE_STAFF'] }, admin.body.token);
    const userId = created.body.data.id;
    const own = await post('/auth/login', { identifier: run, password: DEMO_PASSWORD });
    let since = Date.now() - 1000;
    const started = await post('/auth/resend-verification', {}, own.body.token);
    await post('/auth/email-otp/verify', { challenge_id: started.body.challenge.id, code: await codeFor(email, since) });
    expect((await post(`/iam/users/${userId}`, { email_otp_2fa_enabled: true }, admin.body.token, 'PATCH')).status).toBe(200);

    since = Date.now() - 1000;
    await page.goto('/login');
    await page.getByPlaceholder('Nhập email hoặc tên đăng nhập').fill(run);
    await page.getByPlaceholder('Nhập mật khẩu').fill(DEMO_PASSWORD);
    await page.getByTestId('login-submit').click();
    await expect(page.getByRole('heading', { name: 'Nhập mã đăng nhập' })).toBeVisible({ timeout: 15_000 });
    expect(await hasSession(page)).toBe(false);

    await page.getByLabel(CODE_FIELD).fill(await codeFor(email, since));
    await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });
    expect(await hasSession(page)).toBe(true);

    await post(`/iam/users/${userId}`, { status: 'INACTIVE' }, admin.body.token, 'PATCH');
  });
});
