// Email OTP rules (lib/email-otp.js) against an in-memory store with a fake clock
// and a fake mailbox: generation, hashing, expiry, attempts, resend, concurrency.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const { createEmailOtpService, OtpError, PURPOSES, maskEmail, resolveOtpSecret } = require('../src/lib/email-otp');
const { createMemoryOtpStore } = require('./support/memory-otp-store');

const USER = { id: '22222222-2222-4222-8222-222222222222', email: 'reader@example.com', full_name: 'Reader' };
const { EMAIL_VERIFICATION, LOGIN_2FA } = PURPOSES;

function setup({ failDelivery = false, policy } = {}) {
  let clock = Date.parse('2026-10-29T08:00:00Z');
  const sent = [];
  const store = createMemoryOtpStore();
  const service = createEmailOtpService({
    store,
    secret: Buffer.from('k'.repeat(48)),
    now: () => clock,
    policy,
    deliver: async (to, data) => {
      if (failDelivery) throw new Error('SMTP 550 rejected');
      sent.push({ to, ...data });
    },
  });
  return {
    store,
    service,
    sent,
    lastCode: () => sent[sent.length - 1].code,
    advance: (ms) => { clock += ms; },
  };
}

const rejectsWith = (code) => (err) => err instanceof OtpError && err.code === code;

test('issues a 6-digit code by email and stores only an HMAC of it', async () => {
  const { service, store, sent, lastCode } = setup();
  const { challenge } = await service.issue({ user: USER, purpose: EMAIL_VERIFICATION });
  assert.match(lastCode(), /^\d{6}$/);
  assert.equal(sent[0].to, USER.email);
  assert.equal(challenge.masked_email, 'r****r@example.com');
  assert.equal(challenge.code_length, 6);
  assert.equal(challenge.attempts_remaining, 5);
  assert.equal(challenge.user_id, undefined, 'no user id in the public view');

  const row = store.rows.get(challenge.id);
  assert.notEqual(row.code_hash, lastCode());
  assert.match(row.code_hash, /^[0-9a-f]{64}$/);
  assert.ok(!JSON.stringify([...store.rows.values()]).includes(`"${lastCode()}"`));
  // Not a plain SHA-256 of the code (that could be reversed offline).
  assert.notEqual(row.code_hash, crypto.createHash('sha256').update(lastCode()).digest('hex'));
});

test('the hash is bound to purpose and challenge', async () => {
  const { service } = setup();
  const a = service.hashCode(EMAIL_VERIFICATION, 'id-1', '123456');
  assert.notEqual(a, service.hashCode(LOGIN_2FA, 'id-1', '123456'));
  assert.notEqual(a, service.hashCode(EMAIL_VERIFICATION, 'id-2', '123456'));
});

test('correct code verifies once; the same code cannot be reused', async () => {
  const { service, lastCode } = setup();
  const { challenge } = await service.issue({ user: USER, purpose: EMAIL_VERIFICATION });
  let applied = 0;
  const consumed = await service.verify({ challengeId: challenge.id, purpose: EMAIL_VERIFICATION, code: lastCode(), apply: async () => { applied += 1; } });
  assert.equal(consumed.user_id, USER.id);
  assert.equal(applied, 1);
  await assert.rejects(
    service.verify({ challengeId: challenge.id, purpose: EMAIL_VERIFICATION, code: lastCode() }),
    rejectsWith('OTP_CHALLENGE_INVALID'),
  );
});

test('a code is refused for the other purpose', async () => {
  const { service, lastCode } = setup();
  const { challenge } = await service.issue({ user: USER, purpose: LOGIN_2FA });
  await assert.rejects(service.verify({ challengeId: challenge.id, purpose: EMAIL_VERIFICATION, code: lastCode() }), rejectsWith('OTP_CHALLENGE_INVALID'));
});

test('incorrect code reports attempts left; the fifth failure exhausts the challenge', async () => {
  const { service, lastCode } = setup();
  const { challenge } = await service.issue({ user: USER, purpose: EMAIL_VERIFICATION });
  const wrong = lastCode() === '000000' ? '111111' : '000000';
  for (let left = 4; left >= 1; left -= 1) {
    await assert.rejects(
      service.verify({ challengeId: challenge.id, purpose: EMAIL_VERIFICATION, code: wrong }),
      (err) => err.code === 'OTP_INVALID' && err.extra.attempts_remaining === left && err.status === 400,
    );
  }
  await assert.rejects(service.verify({ challengeId: challenge.id, purpose: EMAIL_VERIFICATION, code: wrong }), rejectsWith('OTP_TOO_MANY_ATTEMPTS'));
  // Even the right code no longer works.
  await assert.rejects(service.verify({ challengeId: challenge.id, purpose: EMAIL_VERIFICATION, code: lastCode() }), rejectsWith('OTP_TOO_MANY_ATTEMPTS'));
});

test('a malformed code is refused without using an attempt', async () => {
  const { service, store } = setup();
  const { challenge } = await service.issue({ user: USER, purpose: EMAIL_VERIFICATION });
  for (const code of ['12345', '1234567', 'abcdef', '', null]) {
    await assert.rejects(service.verify({ challengeId: challenge.id, purpose: EMAIL_VERIFICATION, code }), rejectsWith('OTP_FORMAT'));
  }
  assert.equal(store.rows.get(challenge.id).attempts, 0);
});

test('unknown or malformed challenge ids get the same answer', async () => {
  const { service } = setup();
  await assert.rejects(service.verify({ challengeId: crypto.randomUUID(), purpose: EMAIL_VERIFICATION, code: '123456' }), rejectsWith('OTP_CHALLENGE_INVALID'));
  await assert.rejects(service.verify({ challengeId: "x' OR 1=1 --", purpose: EMAIL_VERIFICATION, code: '123456' }), rejectsWith('OTP_CHALLENGE_INVALID'));
});

test('the code expires after 5 minutes', async () => {
  const { service, lastCode, advance } = setup();
  const { challenge } = await service.issue({ user: USER, purpose: EMAIL_VERIFICATION });
  advance(5 * 60 * 1000);
  await assert.rejects(
    service.verify({ challengeId: challenge.id, purpose: EMAIL_VERIFICATION, code: lastCode() }),
    (err) => err.code === 'OTP_EXPIRED' && err.status === 410,
  );
});

test('resend waits 60 s, then replaces the code; the old code stops working', async () => {
  const { service, lastCode, advance, sent } = setup();
  const { challenge } = await service.issue({ user: USER, purpose: EMAIL_VERIFICATION });
  const first = lastCode();

  await assert.rejects(
    service.resend({ challengeId: challenge.id, purpose: EMAIL_VERIFICATION }),
    (err) => err.code === 'OTP_RESEND_COOLDOWN' && err.extra.retry_after_seconds === 60,
  );
  advance(59_000);
  await assert.rejects(service.resend({ challengeId: challenge.id, purpose: EMAIL_VERIFICATION }), (err) => err.extra.retry_after_seconds === 1);
  advance(1_000);
  const { challenge: again } = await service.resend({ challengeId: challenge.id, purpose: EMAIL_VERIFICATION });
  assert.equal(again.id, challenge.id);
  assert.equal(sent.length, 2);
  const second = lastCode();

  if (first !== second) {
    await assert.rejects(service.verify({ challengeId: challenge.id, purpose: EMAIL_VERIFICATION, code: first }), rejectsWith('OTP_INVALID'));
  }
  await service.verify({ challengeId: challenge.id, purpose: EMAIL_VERIFICATION, code: second });
});

test('resend after expiry gives a fresh 5 minutes and a fresh attempt budget', async () => {
  const { service, lastCode, advance } = setup();
  const { challenge } = await service.issue({ user: USER, purpose: EMAIL_VERIFICATION });
  await assert.rejects(service.verify({ challengeId: challenge.id, purpose: EMAIL_VERIFICATION, code: lastCode() === '999999' ? '000000' : '999999' }));
  advance(6 * 60 * 1000);
  const { challenge: renewed } = await service.resend({ challengeId: challenge.id, purpose: EMAIL_VERIFICATION });
  assert.equal(renewed.attempts_remaining, 5);
  await service.verify({ challengeId: challenge.id, purpose: EMAIL_VERIFICATION, code: lastCode() });
});

test('a new challenge invalidates the older one for the same purpose', async () => {
  const { service, lastCode, advance } = setup();
  const { challenge: old } = await service.issue({ user: USER, purpose: LOGIN_2FA });
  const oldCode = lastCode();
  advance(61_000);
  const { challenge: fresh, reused } = await service.issue({ user: USER, purpose: LOGIN_2FA });
  assert.equal(reused, false);
  assert.notEqual(fresh.id, old.id);
  await assert.rejects(service.verify({ challengeId: old.id, purpose: LOGIN_2FA, code: oldCode }), rejectsWith('OTP_CHALLENGE_INVALID'));
  await service.verify({ challengeId: fresh.id, purpose: LOGIN_2FA, code: lastCode() });
});

test('issuing again within the cooldown returns the live challenge without another email', async () => {
  const { service, sent } = setup();
  const first = await service.issue({ user: USER, purpose: LOGIN_2FA });
  const second = await service.issue({ user: USER, purpose: LOGIN_2FA });
  assert.equal(second.reused, true);
  assert.equal(second.challenge.id, first.challenge.id);
  assert.equal(sent.length, 1);
});

test('concurrent correct submissions: exactly one wins', async () => {
  const { service, lastCode } = setup();
  const { challenge } = await service.issue({ user: USER, purpose: EMAIL_VERIFICATION });
  const code = lastCode();
  let applied = 0;
  const results = await Promise.allSettled(Array.from({ length: 8 }, () => service.verify({
    challengeId: challenge.id, purpose: EMAIL_VERIFICATION, code, apply: async () => { applied += 1; },
  })));
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(applied, 1);
});

test('concurrent wrong guesses cannot exceed 5 attempts', async () => {
  const { service, store, lastCode } = setup();
  const { challenge } = await service.issue({ user: USER, purpose: EMAIL_VERIFICATION });
  const real = Number(lastCode());
  const guesses = Array.from({ length: 20 }, (_, i) => String((real + i + 1) % 1_000_000).padStart(6, '0'));
  const results = await Promise.allSettled(guesses.map((code) => service.verify({ challengeId: challenge.id, purpose: EMAIL_VERIFICATION, code })));
  assert.ok(results.every((r) => r.status === 'rejected'));
  assert.equal(store.rows.get(challenge.id).attempts, 5);
});

test('if applying the result fails, the challenge is not consumed', async () => {
  const { service, lastCode } = setup();
  const { challenge } = await service.issue({ user: USER, purpose: EMAIL_VERIFICATION });
  await assert.rejects(service.verify({
    challengeId: challenge.id, purpose: EMAIL_VERIFICATION, code: lastCode(), apply: async () => { throw new Error('db down'); },
  }), /db down/);
  await service.verify({ challengeId: challenge.id, purpose: EMAIL_VERIFICATION, code: lastCode() });
});

test('SMTP failure is reported, never as sent, and the resend is open at once', async () => {
  const { service } = setup({ failDelivery: true });
  const err = await service.issue({ user: USER, purpose: EMAIL_VERIFICATION }).catch((e) => e);
  assert.equal(err.code, 'EMAIL_DELIVERY_UNAVAILABLE');
  assert.equal(err.status, 503);
  assert.ok(err.extra.challenge.id);
  assert.ok(Date.parse(err.extra.challenge.resend_available_at) <= Date.parse('2026-10-29T08:00:00Z'));
});

test('per-challenge and per-account send limits', async () => {
  const { service, advance } = setup();
  const { challenge } = await service.issue({ user: USER, purpose: EMAIL_VERIFICATION });
  for (let i = 0; i < 4; i += 1) {
    advance(61_000);
    await service.resend({ challengeId: challenge.id, purpose: EMAIL_VERIFICATION });
  }
  advance(61_000);
  // five sends on this challenge: start again
  await assert.rejects(service.resend({ challengeId: challenge.id, purpose: EMAIL_VERIFICATION }), rejectsWith('OTP_CHALLENGE_INVALID'));

  // a new challenge each time does not escape the hourly account budget (10)
  for (let i = 0; i < 5; i += 1) {
    advance(61_000);
    await service.issue({ user: USER, purpose: LOGIN_2FA });
  }
  advance(61_000);
  await assert.rejects(service.issue({ user: USER, purpose: LOGIN_2FA }), (err) => err.code === 'OTP_SEND_LIMIT' && err.status === 429);
});

test('resend is refused once the challenge is 30 minutes old', async () => {
  const { service, advance } = setup();
  const { challenge } = await service.issue({ user: USER, purpose: LOGIN_2FA });
  advance(30 * 60 * 1000);
  await assert.rejects(service.resend({ challengeId: challenge.id, purpose: LOGIN_2FA }), rejectsWith('OTP_CHALLENGE_INVALID'));
});

test('maskEmail never shows the whole local part', () => {
  assert.equal(maskEmail('ab@x.vn'), 'a*@x.vn');
  assert.equal(maskEmail('nguyenvanaaaaaaaaa@gmail.com'), 'n********a@gmail.com');
  assert.equal(maskEmail('broken'), '***');
});

test('OTP secret: required in production, derived (not equal to JWT_SECRET) elsewhere', () => {
  assert.throws(() => resolveOtpSecret({ NODE_ENV: 'production', JWT_SECRET: 'j'.repeat(64) }), /OTP_HMAC_SECRET/);
  assert.throws(() => resolveOtpSecret({ NODE_ENV: 'production', OTP_HMAC_SECRET: 'short' }), /OTP_HMAC_SECRET/);
  assert.equal(resolveOtpSecret({ NODE_ENV: 'production', OTP_HMAC_SECRET: 's'.repeat(32) }).toString(), 's'.repeat(32));
  const derived = resolveOtpSecret({ JWT_SECRET: 'jwt-secret' });
  assert.equal(derived.length, 32);
  assert.notEqual(derived.toString('hex'), Buffer.from('jwt-secret').toString('hex'));
});
