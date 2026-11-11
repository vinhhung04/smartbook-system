// Email OTP against a running dev stack (docker compose up; pnpm demo:seed): real
// gateway, auth-service, Postgres and Mailpit (the dev mail catcher that receives the
// codes — nothing ever logs them).
//
//   node scripts/email-otp-integration.mjs           registration verification
//   node scripts/email-otp-integration.mjs --staff   also the staff second factor; needs
//                                                    auth-service started with
//                                                    STAFF_EMAIL_OTP_MODE=optional
//
// Creates accounts named otp_it_<time>_*; the staff one is set INACTIVE at the end.
import assert from 'node:assert/strict';

const GATEWAY = (process.env.GATEWAY_URL || 'http://localhost:3000').replace(/\/$/, '');
const MAILPIT = (process.env.MAILPIT_URL || 'http://localhost:8025').replace(/\/$/, '');
const PASSWORD = process.env.DEMO_PASSWORD || '123456';
const WITH_STAFF = process.argv.includes('--staff');
const RUN = `otp_it_${Date.now().toString(36)}`;
const results = [];

async function api(path, { token, body, method = body ? 'POST' : 'GET' } = {}) {
  const res = await fetch(`${GATEWAY}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, body: json, headers: res.headers };
}

/** The newest code mailed to `to` (polls Mailpit briefly). */
async function codeFor(to, { after = 0 } = {}) {
  for (let i = 0; i < 20; i += 1) {
    const search = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`).then((r) => r.json());
    const latest = (search.messages || []).find((m) => Date.parse(m.Created) >= after);
    if (latest) {
      const message = await fetch(`${MAILPIT}/api/v1/message/${latest.ID}`).then((r) => r.json());
      assert.equal(message.Subject, '[SmartBook] Mã xác thực của bạn');
      const match = /Mã xác thực: (\d{6})/.exec(message.Text || '');
      assert.ok(match, 'code in the plain-text part');
      return match[1];
    }
    await new Promise((r) => { setTimeout(r, 250); });
  }
  throw new Error(`no email for ${to} in Mailpit`);
}

async function check(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  ok   ${name}`);
  } catch (error) {
    results.push({ name, ok: false });
    console.log(`  FAIL ${name}\n       ${error.message}`);
  }
}

const other = (code) => (code === '000000' ? '000001' : '000000');

async function registration() {
  const email = `${RUN}_reader@example.com`;
  const username = `${RUN}_reader`;
  let challenge;
  let code;

  await check('register returns a challenge, no session, masked address', async () => {
    const r = await api('/auth/register', { body: { username, email, password: PASSWORD, full_name: 'OTP Integration Reader' } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.status, 'VERIFICATION_REQUIRED');
    assert.equal(r.body.email_delivery, 'SENT');
    assert.equal(r.body.token, undefined);
    assert.ok(!JSON.stringify(r.body).includes(email));
    challenge = r.body.challenge;
    code = await codeFor(email);
  });

  await check('pending account: login answers 202 with the same live challenge, never a token', async () => {
    const r = await api('/auth/login', { body: { identifier: username, password: PASSWORD, client: 'mobile' } });
    assert.equal(r.status, 202, JSON.stringify(r.body));
    assert.equal(r.body.status, 'EMAIL_VERIFICATION_REQUIRED');
    assert.equal(r.body.challenge.id, challenge.id, 'within the cooldown no second code is sent');
    assert.equal(r.body.token, undefined);
    assert.equal(r.body.refresh_token, undefined);
  });

  await check('resend inside the cooldown is refused with Retry-After', async () => {
    const r = await api('/auth/email-otp/resend', { body: { challenge_id: challenge.id } });
    assert.equal(r.status, 429);
    assert.equal(r.body.code, 'OTP_RESEND_COOLDOWN');
    assert.ok(Number(r.headers.get('retry-after')) > 0);
  });

  await check('wrong code: 400 with attempts left', async () => {
    const r = await api('/auth/email-otp/verify', { body: { challenge_id: challenge.id, code: other(code) } });
    assert.equal(r.status, 400);
    assert.equal(r.body.code, 'OTP_INVALID');
    assert.equal(r.body.attempts_remaining, 4);
  });

  await check('six concurrent correct submissions: exactly one succeeds', async () => {
    const all = await Promise.all(Array.from({ length: 6 }, () => api('/auth/email-otp/verify', { body: { challenge_id: challenge.id, code } })));
    const statuses = all.map((r) => r.status).sort();
    assert.equal(statuses.filter((s) => s === 200).length, 1, statuses.join(','));
    assert.ok(statuses.filter((s) => s !== 200).every((s) => s === 410 || s === 429), statuses.join(','));
  });

  await check('the code cannot be reused', async () => {
    const r = await api('/auth/email-otp/verify', { body: { challenge_id: challenge.id, code } });
    assert.equal(r.status, 410);
    assert.equal(r.body.code, 'OTP_CHALLENGE_INVALID');
  });

  await check('verified account logs in through the normal flow as a CUSTOMER', async () => {
    const r = await api('/auth/login', { body: { identifier: username, password: PASSWORD } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.ok(r.body.token);
    assert.deepEqual(r.body.user.roles, ['CUSTOMER']);
    assert.ok(r.body.user.email_verified_at);
    const me = await api('/auth/me', { token: r.body.token });
    assert.equal(me.body.user.status, 'ACTIVE');
  });

  await check('unknown challenge ids and the old link endpoint give nothing away', async () => {
    const r = await api('/auth/email-otp/verify', { body: { challenge_id: '00000000-0000-4000-8000-000000000000', code: '123456' } });
    assert.equal(r.status, 410);
    const legacy = await api('/auth/verify-email', { body: { token: 'x' } });
    assert.equal(legacy.status, 404);
  });
}

async function staffSecondFactor() {
  const admin = await api('/auth/login', { body: { identifier: 'hung', password: PASSWORD } });
  assert.equal(admin.status, 200, 'admin login');
  const adminToken = admin.body.token;
  const email = `${RUN}_staff@example.com`;
  const username = `${RUN}_staff`;
  let userId;

  await check('admin cannot enable email OTP for an unverified address', async () => {
    const created = await api('/iam/users', { token: adminToken, body: { username, email, full_name: 'OTP Staff', password: PASSWORD, role_codes: ['WAREHOUSE_STAFF'] } });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    userId = created.body.data.id;
    const r = await api(`/iam/users/${userId}`, { token: adminToken, method: 'PATCH', body: { email_otp_2fa_enabled: true } });
    assert.equal(r.status, 400);
    assert.equal(r.body.code, 'EMAIL_NOT_VERIFIED');
  });

  await check('staff confirms the address while signed in, then admin enables the factor', async () => {
    const login = await api('/auth/login', { body: { identifier: username, password: PASSWORD } });
    assert.equal(login.status, 200);
    const since = Date.now() - 1000;
    const started = await api('/auth/resend-verification', { token: login.body.token, body: {} });
    assert.equal(started.body.status, 'OTP_SENT', JSON.stringify(started.body));
    const verified = await api('/auth/email-otp/verify', { body: { challenge_id: started.body.challenge.id, code: await codeFor(email, { after: since }) } });
    assert.equal(verified.status, 200, JSON.stringify(verified.body));
    // the revocation cutoff has 1 s resolution (iat < cutoff): leave the login's second
    await new Promise((r) => { setTimeout(r, 1100); });
    const enabled = await api(`/iam/users/${userId}`, { token: adminToken, method: 'PATCH', body: { email_otp_2fa_enabled: true } });
    assert.equal(enabled.status, 200, JSON.stringify(enabled.body));
    assert.equal(enabled.body.data.email_otp_2fa_enabled, true);
    // enabling ends sessions opened without it
    const me = await api('/auth/me', { token: login.body.token });
    assert.equal(me.status, 401);
  });

  await check('password alone: 202 OTP_REQUIRED, no token; the code completes it (mobile gets a refresh token)', async () => {
    const since = Date.now() - 1000;
    const step1 = await api('/auth/login', { body: { identifier: username, password: PASSWORD, client: 'mobile' } });
    assert.equal(step1.status, 202, JSON.stringify(step1.body));
    assert.equal(step1.body.status, 'OTP_REQUIRED');
    assert.equal(step1.body.token, undefined);
    const code = await codeFor(email, { after: since });
    const wrong = await api('/auth/login/verify-otp', { body: { challenge_id: step1.body.challenge.id, code: other(code), client: 'mobile' } });
    assert.equal(wrong.status, 400);
    const step2 = await api('/auth/login/verify-otp', { body: { challenge_id: step1.body.challenge.id, code, client: 'mobile' } });
    assert.equal(step2.status, 200, JSON.stringify(step2.body));
    assert.ok(step2.body.token && step2.body.refresh_token);
    assert.deepEqual(step2.body.user.roles, ['WAREHOUSE_STAFF']);
    const renewed = await api('/auth/refresh', { body: { refresh_token: step2.body.refresh_token } });
    assert.equal(renewed.status, 200, JSON.stringify(renewed.body));
  });

  await api(`/iam/users/${userId}`, { token: adminToken, method: 'PATCH', body: { status: 'INACTIVE' } });
}

console.log(`Email OTP integration (${GATEWAY}, mail via ${MAILPIT})`);
await registration();
if (WITH_STAFF) await staffSecondFactor();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
