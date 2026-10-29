// Registration verification and staff second factor through the auth controller:
// who gets a JWT / refresh token, and when. Prisma, Redis, SMTP and Borrow Service
// are faked; the OTP rules are the real ones (lib/email-otp.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const crypto = require('node:crypto');

const { createMemoryOtpStore } = require('./support/memory-otp-store');

// ---- fakes ---------------------------------------------------------------------

const users = new Map(); // id -> row
const userRoles = new Map(); // id -> ['CUSTOMER'] ...
const redisData = new Map();
const mailbox = [];
let smtp = { configured: true, failing: false };

const lower = (v) => String(v || '').toLowerCase();
const byIdentifier = (identifier) => [...users.values()].filter((u) => !u.deleted_at && (lower(u.username) === lower(identifier) || lower(u.email) === lower(identifier)));

const fakePrisma = {
  user: {
    findUnique: async ({ where }) => (users.has(where.id) ? { ...users.get(where.id) } : null),
    update: async ({ where, data }) => {
      const row = users.get(where.id);
      for (const [key, value] of Object.entries(data)) {
        row[key] = value && typeof value === 'object' && 'increment' in value ? row[key] + value.increment : value;
      }
      return { ...row };
    },
    create: async ({ data }) => {
      const row = { id: crypto.randomUUID(), is_superuser: false, failed_login_attempts: 0, email_verified_at: null, email_otp_2fa_enabled: false, deleted_at: null, created_at: new Date(), password_hash: '', ...data };
      users.set(row.id, row);
      userRoles.set(row.id, ['CUSTOMER']);
      return { ...row };
    },
    delete: async ({ where }) => { users.delete(where.id); },
  },
  role: { upsert: async () => ({}) },
  $executeRawUnsafe: async () => 0,
  $transaction: async (fn) => fn(fakePrisma),
  $queryRawUnsafe: async (sql, ...params) => {
    if (/SELECT id\s+FROM users\s+WHERE lower\(username/.test(sql)) return byIdentifier(params[0]).concat(byIdentifier(params[1]));
    if (/SELECT \*\s+FROM users/.test(sql)) return byIdentifier(params[0]).map((u) => ({ ...u }));
    if (/SELECT DISTINCT r\.code/.test(sql)) return (userRoles.get(params[0]) || []).map((code) => ({ code }));
    if (/SELECT DISTINCT p\.code/.test(sql)) return [];
    if (/UPDATE users\s+SET email_verified_at/.test(sql)) {
      const row = users.get(params[0]);
      if (!row || row.deleted_at || lower(row.email) !== lower(params[1])) return [];
      row.email_verified_at = row.email_verified_at || params[2];
      if (row.status === 'PENDING_VERIFICATION') row.status = 'ACTIVE';
      return [{ id: row.id }];
    }
    throw new Error(`unexpected SQL in test: ${sql.slice(0, 80)}`);
  },
};

const otpStore = createMemoryOtpStore({ tx: fakePrisma });
const fakeRedis = {
  getStrict: async (key) => (redisData.has(key) ? redisData.get(key) : null),
  setStrict: async (key, value) => { redisData.set(key, value); },
  getDelStrict: async (key) => { const v = redisData.has(key) ? redisData.get(key) : null; redisData.delete(key); return v; },
  delStrict: async (key) => { redisData.delete(key); },
  get: async (key) => redisData.get(key) ?? null,
  set: async (key, value) => { redisData.set(key, value); return true; },
};
const fakeMail = {
  isEmailConfigured: () => smtp.configured,
  deliverEmail: async (to, template, data) => {
    if (smtp.failing) throw new Error('SMTP rejected');
    mailbox.push({ to, template, ...data });
  },
  sendEmail: async () => true,
};

const realLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === '../lib/prisma') return fakePrisma;
  if (request === '../lib/email-sender') return fakeMail;
  if (request === '../lib/email-otp-store') return { createPrismaOtpStore: () => otpStore };
  if (request === '../lib/redis' || (request === './redis' && parent?.filename?.endsWith('token-revocation.js'))) return fakeRedis;
  return realLoad.call(this, request, parent, isMain);
};
process.env.JWT_SECRET = 'test-secret';
process.env.INTERNAL_SERVICE_KEY = 'internal';
global.fetch = async () => ({ ok: true, text: async () => '' }); // Borrow Service provisioning
const bcrypt = require('bcryptjs');
const controller = require('../src/controllers/auth.controller');

function res() {
  return {
    statusCode: 200, body: null, headers: {},
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    setHeader(k, v) { this.headers[k] = v; },
  };
}
async function call(handler, body, extra = {}) {
  const r = res();
  await handler({ body, ...extra }, r);
  return r;
}
const lastCode = () => mailbox[mailbox.length - 1].code;
const PASSWORD = 'Secret123';
let passwordHash;

async function seedUser({ username, roles = ['WAREHOUSE_STAFF'], ...rest }) {
  passwordHash = passwordHash || await bcrypt.hash(PASSWORD, 4);
  const row = {
    id: crypto.randomUUID(), username, email: `${username}@smartbook.test`, full_name: username, password_hash: passwordHash,
    status: 'ACTIVE', is_superuser: false, failed_login_attempts: 0, email_verified_at: null, email_otp_2fa_enabled: false,
    deleted_at: null, created_at: new Date(), ...rest,
  };
  users.set(row.id, row);
  userRoles.set(row.id, roles);
  return row;
}

test.beforeEach(() => {
  smtp = { configured: true, failing: false };
  delete process.env.STAFF_EMAIL_OTP_MODE;
  delete process.env.REGISTRATION_EMAIL_VERIFICATION;
});

// ---- Phase 1: registration -----------------------------------------------------

test('register creates a pending account and returns a challenge, never a token', async () => {
  const r = await call(controller.register, { username: 'reader1', email: 'Reader1@Example.com', password: PASSWORD, full_name: 'Reader One' });
  assert.equal(r.statusCode, 201, JSON.stringify(r.body));
  assert.equal(r.body.status, 'VERIFICATION_REQUIRED');
  assert.equal(r.body.email_delivery, 'SENT');
  assert.equal(r.body.token, undefined);
  assert.equal(r.body.user, undefined, 'no user record or id in the response');
  assert.equal(r.body.challenge.masked_email, 'r*****1@example.com');
  assert.ok(!JSON.stringify(r.body).includes('reader1@example.com'));

  const created = byIdentifier('reader1')[0];
  assert.equal(created.status, 'PENDING_VERIFICATION');
  assert.equal(mailbox.at(-1).to, 'reader1@example.com');
  assert.equal(mailbox.at(-1).purpose, 'EMAIL_VERIFICATION');
});

test('a pending account cannot log in; the right password yields a new challenge only', async () => {
  const wrong = await call(controller.login, { identifier: 'reader1', password: 'nope', client: 'mobile' });
  assert.equal(wrong.statusCode, 401, 'wrong password looks like any other');

  const r = await call(controller.login, { identifier: 'reader1', password: PASSWORD, client: 'mobile' });
  assert.equal(r.statusCode, 202);
  assert.equal(r.body.status, 'EMAIL_VERIFICATION_REQUIRED');
  assert.equal(r.body.token, undefined);
  assert.equal(r.body.refresh_token, undefined);
  assert.ok(r.body.challenge.id);
});

test('verifying the email activates the account; then the normal login works', async () => {
  const login1 = await call(controller.login, { identifier: 'reader1', password: PASSWORD });
  const challengeId = login1.body.challenge.id;
  const verified = await call(controller.verifyEmailOtp, { challenge_id: challengeId, code: lastCode() });
  assert.equal(verified.statusCode, 200, JSON.stringify(verified.body));
  assert.equal(verified.body.status, 'VERIFIED');
  assert.equal(verified.body.token, undefined, 'verification itself issues no session');

  const user = byIdentifier('reader1')[0];
  assert.equal(user.status, 'ACTIVE');
  assert.ok(user.email_verified_at);

  const reuse = await call(controller.verifyEmailOtp, { challenge_id: challengeId, code: lastCode() });
  assert.equal(reuse.statusCode, 410);
  assert.equal(reuse.body.code, 'OTP_CHALLENGE_INVALID');

  const login2 = await call(controller.login, { identifier: 'reader1', password: PASSWORD });
  assert.equal(login2.statusCode, 200);
  assert.equal(login2.body.status, 'AUTHENTICATED');
  assert.ok(login2.body.token);
  assert.deepEqual(login2.body.user.roles, ['CUSTOMER']);
});

test('register refuses up front when no mail server is configured', async () => {
  smtp.configured = false;
  const before = users.size;
  const r = await call(controller.register, { username: 'reader2', email: 'reader2@example.com', password: PASSWORD, full_name: 'Reader Two' });
  assert.equal(r.statusCode, 503);
  assert.equal(r.body.code, 'EMAIL_DELIVERY_UNAVAILABLE');
  assert.equal(users.size, before);
});

test('SMTP rejecting the code: account stays pending, client can resend at once', async () => {
  smtp.failing = true;
  const r = await call(controller.register, { username: 'reader3', email: 'reader3@example.com', password: PASSWORD, full_name: 'Reader Three' });
  assert.equal(r.statusCode, 201);
  assert.equal(r.body.email_delivery, 'FAILED');
  assert.equal(byIdentifier('reader3')[0].status, 'PENDING_VERIFICATION');

  smtp.failing = false;
  const resent = await call(controller.resendEmailOtp, { challenge_id: r.body.challenge.id });
  assert.equal(resent.statusCode, 200, JSON.stringify(resent.body));
  const ok = await call(controller.verifyEmailOtp, { challenge_id: r.body.challenge.id, code: lastCode() });
  assert.equal(ok.statusCode, 200);
});

test('resend during the cooldown answers 429 with Retry-After', async () => {
  const r = await call(controller.register, { username: 'reader4', email: 'reader4@example.com', password: PASSWORD, full_name: 'Reader Four' });
  const again = await call(controller.resendEmailOtp, { challenge_id: r.body.challenge.id });
  assert.equal(again.statusCode, 429);
  assert.equal(again.body.code, 'OTP_RESEND_COOLDOWN');
  assert.ok(Number(again.headers['Retry-After']) > 0);
});

test('wrong codes: 400 with attempts left, then 429 after five', async () => {
  const login = await call(controller.login, { identifier: 'reader4', password: PASSWORD });
  const id = login.body.challenge.id;
  const wrong = lastCode() === '000000' ? '000001' : '000000';
  for (let i = 0; i < 4; i += 1) {
    const r = await call(controller.verifyEmailOtp, { challenge_id: id, code: wrong });
    assert.equal(r.statusCode, 400);
    assert.equal(r.body.code, 'OTP_INVALID');
  }
  const last = await call(controller.verifyEmailOtp, { challenge_id: id, code: wrong });
  assert.equal(last.statusCode, 429);
  assert.equal(last.body.code, 'OTP_TOO_MANY_ATTEMPTS');
  assert.equal(byIdentifier('reader4')[0].status, 'PENDING_VERIFICATION');
});

test('existing (legacy) accounts without a verified email keep logging in', async () => {
  await seedUser({ username: 'legacy_reader', roles: ['CUSTOMER'] });
  const r = await call(controller.login, { identifier: 'legacy_reader', password: PASSWORD });
  assert.equal(r.statusCode, 200);
  assert.ok(r.body.token);
});

test('REGISTRATION_EMAIL_VERIFICATION=off restores the old immediate activation', async () => {
  process.env.REGISTRATION_EMAIL_VERIFICATION = 'off';
  const r = await call(controller.register, { username: 'reader5', email: 'reader5@example.com', password: PASSWORD, full_name: 'Reader Five' });
  assert.equal(r.statusCode, 201);
  assert.equal(r.body.status, 'REGISTERED');
  assert.equal(byIdentifier('reader5')[0].status, 'ACTIVE');
});

test('changing the email through /auth/me drops the verification', async () => {
  const u = await seedUser({ username: 'verified_reader', roles: ['CUSTOMER'], email_verified_at: new Date() });
  const r = await call(controller.updateMe, { email: 'new-address@example.com' }, { auth: { sub: u.id } });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(users.get(u.id).email, 'new-address@example.com');
  assert.equal(users.get(u.id).email_verified_at, null);

  const same = await seedUser({ username: 'same_reader', roles: ['CUSTOMER'], email_verified_at: new Date() });
  await call(controller.updateMe, { email: same.email.toUpperCase() }, { auth: { sub: same.id } });
  assert.ok(users.get(same.id).email_verified_at, 'same address (case only): still verified');
});

test('signed-in legacy account verifies its email with a code', async () => {
  const u = await seedUser({ username: 'legacy_staff' });
  const started = await call(controller.resendVerification, {}, { auth: { sub: u.id } });
  assert.equal(started.body.status, 'OTP_SENT');
  const ok = await call(controller.verifyEmailOtp, { challenge_id: started.body.challenge.id, code: lastCode() });
  assert.equal(ok.statusCode, 200);
  assert.ok(users.get(u.id).email_verified_at);
  assert.equal(users.get(u.id).status, 'ACTIVE');
  const again = await call(controller.resendVerification, {}, { auth: { sub: u.id } });
  assert.equal(again.body.status, 'ALREADY_VERIFIED');
});

test('a code sent to an old address does not verify the new one', async () => {
  const u = await seedUser({ username: 'mover', roles: ['CUSTOMER'] });
  const started = await call(controller.resendVerification, {}, { auth: { sub: u.id } });
  users.get(u.id).email = 'moved@example.com';
  const r = await call(controller.verifyEmailOtp, { challenge_id: started.body.challenge.id, code: lastCode() });
  assert.equal(r.statusCode, 410);
  assert.equal(users.get(u.id).email_verified_at, null);
});

// ---- Phase 2: staff second factor ------------------------------------------------

test('default mode (off): a flagged staff account logs in exactly as before', async () => {
  await seedUser({ username: 'flagged_off', email_otp_2fa_enabled: true, email_verified_at: new Date() });
  const r = await call(controller.login, { identifier: 'flagged_off', password: PASSWORD });
  assert.equal(r.statusCode, 200);
  assert.ok(r.body.token);
});

test('optional mode: flagged staff get a challenge and no token; the code completes the login', async () => {
  process.env.STAFF_EMAIL_OTP_MODE = 'optional';
  await seedUser({ username: 'flagged', email_otp_2fa_enabled: true, email_verified_at: new Date() });
  await seedUser({ username: 'unflagged' });

  const plain = await call(controller.login, { identifier: 'unflagged', password: PASSWORD });
  assert.equal(plain.statusCode, 200);

  const step1 = await call(controller.login, { identifier: 'flagged', password: PASSWORD, client: 'mobile' });
  assert.equal(step1.statusCode, 202);
  assert.equal(step1.body.status, 'OTP_REQUIRED');
  assert.equal(step1.body.token, undefined);
  assert.equal(step1.body.refresh_token, undefined);
  assert.equal(mailbox.at(-1).purpose, 'LOGIN_2FA');

  // The challenge id is not a credential.
  const asRefresh = await call(controller.refresh, { refresh_token: step1.body.challenge.id });
  assert.equal(asRefresh.statusCode, 401);

  const step2 = await call(controller.verifyLoginOtp, { challenge_id: step1.body.challenge.id, code: lastCode(), client: 'mobile' });
  assert.equal(step2.statusCode, 200, JSON.stringify(step2.body));
  assert.ok(step2.body.token);
  assert.ok(step2.body.refresh_token, 'mobile gets its refresh token only now');
  assert.deepEqual(step2.body.user.roles, ['WAREHOUSE_STAFF']);

  // and the refresh token keeps working (the family carries the completed factor)
  const renewed = await call(controller.refresh, { refresh_token: step2.body.refresh_token });
  assert.equal(renewed.statusCode, 200, JSON.stringify(renewed.body));

});

test('web completion of a 2FA login gets the access token only (no refresh token)', async () => {
  process.env.STAFF_EMAIL_OTP_MODE = 'optional';
  await seedUser({ username: 'flagged_web', email_otp_2fa_enabled: true, email_verified_at: new Date() });
  const step1 = await call(controller.login, { identifier: 'flagged_web', password: PASSWORD });
  const step2 = await call(controller.verifyLoginOtp, { challenge_id: step1.body.challenge.id, code: lastCode() });
  assert.equal(step2.statusCode, 200);
  assert.ok(step2.body.token);
  assert.equal(step2.body.refresh_token, undefined);
});

test('a login code cannot be used on the email-verification endpoint and vice versa', async () => {
  process.env.STAFF_EMAIL_OTP_MODE = 'optional';
  const step1 = await call(controller.login, { identifier: 'flagged', password: PASSWORD });
  const cross = await call(controller.verifyEmailOtp, { challenge_id: step1.body.challenge.id, code: lastCode() });
  assert.equal(cross.statusCode, 410);
});

test('required mode applies to staff but not to customers', async () => {
  process.env.STAFF_EMAIL_OTP_MODE = 'required';
  const staff = await call(controller.login, { identifier: 'unflagged', password: PASSWORD });
  assert.equal(staff.statusCode, 202);
  const customer = await call(controller.login, { identifier: 'legacy_reader', password: PASSWORD });
  assert.equal(customer.statusCode, 200);
  assert.ok(customer.body.token);
});

test('mail down during staff login: 503, no token (fails closed, no bypass)', async () => {
  process.env.STAFF_EMAIL_OTP_MODE = 'required';
  smtp.failing = true;
  await seedUser({ username: 'staff_mail_down' });
  const r = await call(controller.login, { identifier: 'staff_mail_down', password: PASSWORD });
  assert.equal(r.statusCode, 503);
  assert.equal(r.body.code, 'EMAIL_DELIVERY_UNAVAILABLE');
  assert.equal(r.body.token, undefined);
});

test('account locked between the two steps: the code no longer signs in', async () => {
  process.env.STAFF_EMAIL_OTP_MODE = 'optional';
  const u = await seedUser({ username: 'to_lock', email_otp_2fa_enabled: true, email_verified_at: new Date() });
  const step1 = await call(controller.login, { identifier: 'to_lock', password: PASSWORD });
  users.get(u.id).status = 'LOCKED';
  const step2 = await call(controller.verifyLoginOtp, { challenge_id: step1.body.challenge.id, code: lastCode() });
  assert.equal(step2.statusCode, 403);
  assert.equal(step2.body.token, undefined);
});

test('password changed (revocation cutoff) after the password step: challenge refused', async () => {
  process.env.STAFF_EMAIL_OTP_MODE = 'optional';
  const u = await seedUser({ username: 'pw_changed', email_otp_2fa_enabled: true, email_verified_at: new Date() });
  const step1 = await call(controller.login, { identifier: 'pw_changed', password: PASSWORD });
  redisData.set(`user:tokens-valid-after:${u.id}`, String(Math.floor(Date.now() / 1000) + 5));
  const step2 = await call(controller.verifyLoginOtp, { challenge_id: step1.body.challenge.id, code: lastCode() });
  assert.equal(step2.statusCode, 410);
  assert.equal(step2.body.token, undefined);
  redisData.delete(`user:tokens-valid-after:${u.id}`);
});

test('refresh tokens from before 2FA was required are refused (no bypass through /auth/refresh)', async () => {
  const u = await seedUser({ username: 'old_session' });
  const before = await call(controller.login, { identifier: 'old_session', password: PASSWORD, client: 'mobile' });
  assert.ok(before.body.refresh_token);

  process.env.STAFF_EMAIL_OTP_MODE = 'required';
  const r = await call(controller.refresh, { refresh_token: before.body.refresh_token });
  assert.equal(r.statusCode, 401);
  assert.equal(r.body.code, 'REFRESH_TOKEN_REVOKED');
  assert.equal(users.get(u.id).status, 'ACTIVE');
});

test('a 2FA account cannot redirect its codes by changing its own email', async () => {
  process.env.STAFF_EMAIL_OTP_MODE = 'optional';
  const u = await seedUser({ username: 'mfa_email', email_otp_2fa_enabled: true, email_verified_at: new Date() });
  const r = await call(controller.updateMe, { email: 'attacker@example.com' }, { auth: { sub: u.id } });
  assert.equal(r.statusCode, 403);
  assert.equal(r.body.code, 'EMAIL_CHANGE_REQUIRES_ADMIN');
  assert.equal(users.get(u.id).email, 'mfa_email@smartbook.test');
});

test('the code is never in a response or a log line', async () => {
  process.env.STAFF_EMAIL_OTP_MODE = 'optional';
  const logged = [];
  const originals = { log: console.log, warn: console.warn, error: console.error };
  for (const k of Object.keys(originals)) console[k] = (...args) => logged.push(args.join(' '));
  try {
    await seedUser({ username: 'no_leak', email_otp_2fa_enabled: true, email_verified_at: new Date() });
    const step1 = await call(controller.login, { identifier: 'no_leak', password: PASSWORD });
    const code = lastCode();
    const bad = await call(controller.verifyLoginOtp, { challenge_id: step1.body.challenge.id, code: code === '123456' ? '654321' : '123456' });
    for (const body of [step1.body, bad.body]) assert.ok(!JSON.stringify(body).includes(code));
    assert.ok(!logged.some((line) => line.includes(code)));
  } finally {
    Object.assign(console, originals);
  }
});
