const crypto = require('crypto');

// Email one-time codes for registration verification and the optional staff second
// factor. Storage is injected (lib/email-otp-store.js in production, an in-memory
// store in tests) so the rules below are tested without a database.
//
// - The code is 6 digits from crypto.randomInt. Only HMAC-SHA256(secret, purpose |
//   challenge id | code) is stored: a bare SHA-256 of a 6-digit code could be reversed
//   offline in a second, the HMAC cannot without the secret. Binding the purpose and
//   the challenge id means a hash is useless for any other challenge or purpose.
// - Every guess first reserves an attempt with a conditional UPDATE (attempts <
//   max_attempts), so parallel requests cannot get more than MAX_ATTEMPTS guesses.
// - A correct guess consumes the challenge with another conditional UPDATE (not yet
//   consumed, code_hash unchanged) inside the transaction that applies its effect, so
//   exactly one of several concurrent correct requests wins.
// - A resend replaces the code on the same challenge (the old code stops working at
//   once); issuing a new challenge invalidates the user's older ones for that purpose.

const PURPOSES = Object.freeze({
  EMAIL_VERIFICATION: 'EMAIL_VERIFICATION',
  LOGIN_2FA: 'LOGIN_2FA',
});

const DEFAULT_POLICY = Object.freeze({
  codeLength: 6,
  ttlMs: 5 * 60 * 1000,
  maxAttempts: 5,
  resendCooldownMs: 60 * 1000,
  // a challenge can be resent this many times, for this long; after that the flow
  // starts again from the password (login) so one password check is not stretched out
  maxSendsPerChallenge: 5,
  challengeLifetimeMs: 30 * 60 * 1000,
  // across all challenges of one account, so logging in again does not reset it
  maxSendsPerUserPerHour: 10,
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class OtpError extends Error {
  constructor(code, status, message, extra = {}) {
    super(message);
    this.code = code;
    this.status = status;
    this.extra = extra;
  }
}

/** "nguyenvana@gmail.com" -> "n********a@gmail.com". Never the full address. */
function maskEmail(email) {
  const [local = '', domain = ''] = String(email || '').split('@');
  if (!domain) return '***';
  if (local.length <= 2) return `${local.slice(0, 1)}*@${domain}`;
  return `${local[0]}${'*'.repeat(Math.min(local.length - 2, 8))}${local[local.length - 1]}@${domain}`;
}

/**
 * The HMAC key. OTP_HMAC_SECRET (32+ chars) is required in production. Elsewhere a
 * key is derived from JWT_SECRET with HKDF under its own label, so a dev stack without
 * the new variable still works and the derived key is useless as a JWT key.
 */
function resolveOtpSecret(env = process.env) {
  const dedicated = String(env.OTP_HMAC_SECRET || '');
  if (dedicated.length >= 32) return Buffer.from(dedicated, 'utf8');
  if (env.NODE_ENV === 'production') {
    throw new Error('OTP_HMAC_SECRET must be set (at least 32 characters) in production');
  }
  if (!env.JWT_SECRET) throw new Error('OTP_HMAC_SECRET or JWT_SECRET must be set');
  return Buffer.from(crypto.hkdfSync('sha256', env.JWT_SECRET, 'smartbook', 'email-otp-v1', 32));
}

function createEmailOtpService({ store, deliver, secret, lookupUser = null, now = () => Date.now(), policy = {} }) {
  const p = { ...DEFAULT_POLICY, ...policy };

  function hashCode(purpose, challengeId, code) {
    return crypto.createHmac('sha256', secret).update(`smartbook-otp:v1|${purpose}|${challengeId}|${code}`).digest('hex');
  }

  function sameHash(a, b) {
    const left = Buffer.from(String(a), 'hex');
    const right = Buffer.from(String(b), 'hex');
    return left.length === 32 && right.length === 32 && crypto.timingSafeEqual(left, right);
  }

  function newCode() {
    return String(crypto.randomInt(0, 10 ** p.codeLength)).padStart(p.codeLength, '0');
  }

  /** What a client is shown: never the user id, the code or the full address. */
  function publicView(challenge) {
    const resendAt = new Date(new Date(challenge.last_sent_at).getTime() + p.resendCooldownMs);
    return {
      id: challenge.id,
      purpose: challenge.purpose,
      masked_email: maskEmail(challenge.email),
      code_length: p.codeLength,
      expires_at: new Date(challenge.expires_at).toISOString(),
      resend_available_at: resendAt.toISOString(),
      attempts_remaining: Math.max(0, p.maxAttempts - Number(challenge.attempts || 0)),
    };
  }

  async function checkUserBudget(userId) {
    const sent = await store.countRecentSends(userId, new Date(now() - 60 * 60 * 1000));
    if (sent >= p.maxSendsPerUserPerHour) {
      throw new OtpError('OTP_SEND_LIMIT', 429, 'Too many codes requested for this account. Try again later.', { retry_after_seconds: 3600 });
    }
  }

  async function send(challenge, code, user) {
    try {
      await deliver(challenge.email, { code, purpose: challenge.purpose, full_name: user?.full_name, ttl_minutes: Math.round(p.ttlMs / 60000) });
    } catch (_error) {
      // The code never reached anyone: let the client ask again straight away.
      const allowResendAt = new Date(now() - p.resendCooldownMs);
      await store.markSendFailed(challenge.id, allowResendAt);
      throw new OtpError('EMAIL_DELIVERY_UNAVAILABLE', 503, 'The verification email could not be sent. Try again shortly.', {
        challenge: publicView({ ...challenge, last_sent_at: allowResendAt }),
      });
    }
  }

  function isOpen(challenge) {
    return challenge && !challenge.consumed_at && !challenge.invalidated_at;
  }

  /**
   * Starts a challenge for `user` and emails the code. A challenge sent less than the
   * cooldown ago (same purpose and address, still valid) is returned as is instead,
   * so pressing "log in" twice does not send two codes.
   */
  async function issue({ user, purpose }) {
    if (!PURPOSES[purpose]) throw new Error(`Unknown OTP purpose: ${purpose}`);
    const current = await store.findLatestOpen(user.id, purpose);
    const t = now();
    if (
      isOpen(current)
      && current.email === user.email
      && new Date(current.expires_at).getTime() > t
      && new Date(current.last_sent_at).getTime() + p.resendCooldownMs > t
    ) {
      return { challenge: publicView(current), reused: true };
    }

    await checkUserBudget(user.id);
    const code = newCode();
    const id = crypto.randomUUID();
    const challenge = await store.createChallenge({
      id,
      user_id: user.id,
      purpose,
      email: user.email,
      code_hash: hashCode(purpose, id, code),
      expires_at: new Date(t + p.ttlMs),
      last_sent_at: new Date(t),
      created_at: new Date(t),
    });
    await send(challenge, code, user);
    return { challenge: publicView(challenge), reused: false };
  }

  async function loadOpen(challengeId, purpose) {
    if (!UUID_RE.test(String(challengeId || ''))) return null;
    const challenge = await store.findById(challengeId);
    if (!challenge || challenge.purpose !== purpose) return null;
    return challenge;
  }

  function invalidChallenge() {
    return new OtpError('OTP_CHALLENGE_INVALID', 410, 'This verification session is no longer valid. Start again.');
  }

  /** Throws the error a closed challenge deserves; returns when it can still be guessed. */
  function assertGuessable(challenge) {
    if (!isOpen(challenge)) throw invalidChallenge();
    if (new Date(challenge.expires_at).getTime() <= now()) {
      throw new OtpError('OTP_EXPIRED', 410, 'The code has expired. Request a new one.', { challenge: publicView(challenge) });
    }
    if (Number(challenge.attempts) >= p.maxAttempts) {
      throw new OtpError('OTP_TOO_MANY_ATTEMPTS', 429, 'Too many incorrect codes. Request a new one.', { challenge: publicView(challenge) });
    }
  }

  async function resend({ challengeId, purpose }) {
    const challenge = await loadOpen(challengeId, purpose);
    if (!isOpen(challenge)) throw invalidChallenge();
    const user = lookupUser ? await lookupUser(challenge.user_id) : null;
    if (lookupUser && (!user || user.deleted_at)) throw invalidChallenge();
    const t = now();
    if (new Date(challenge.created_at).getTime() + p.challengeLifetimeMs <= t || challenge.send_count >= p.maxSendsPerChallenge) {
      throw invalidChallenge();
    }
    const waitMs = new Date(challenge.last_sent_at).getTime() + p.resendCooldownMs - t;
    if (waitMs > 0) {
      throw new OtpError('OTP_RESEND_COOLDOWN', 429, 'Wait before requesting another code.', {
        retry_after_seconds: Math.ceil(waitMs / 1000),
        challenge: publicView(challenge),
      });
    }
    await checkUserBudget(challenge.user_id);

    const code = newCode();
    const updated = await store.replaceCode(challenge.id, {
      code_hash: hashCode(purpose, challenge.id, code),
      expires_at: new Date(t + p.ttlMs),
      last_sent_at: new Date(t),
    }, challenge.send_count);
    // Another resend for this challenge won the race: its code is the live one.
    if (!updated) {
      throw new OtpError('OTP_RESEND_COOLDOWN', 429, 'Wait before requesting another code.', { retry_after_seconds: Math.ceil(p.resendCooldownMs / 1000) });
    }
    await send(updated, code, user);
    return { challenge: publicView(updated) };
  }

  /**
   * Checks `code` against the challenge. On success the challenge is consumed and
   * `apply(tx, challenge)` runs in the same transaction (it may throw to undo both).
   * Returns the consumed challenge.
   */
  async function verify({ challengeId, purpose, code, apply }) {
    const normalized = String(code ?? '').trim();
    if (!new RegExp(`^\\d{${p.codeLength}}$`).test(normalized)) {
      // A typo in the format is not a guess: no attempt is used.
      throw new OtpError('OTP_FORMAT', 400, `The code must be ${p.codeLength} digits.`);
    }
    const challenge = await loadOpen(challengeId, purpose);
    assertGuessable(challenge);

    const reserved = await store.reserveAttempt(challenge.id, p.maxAttempts, new Date(now()));
    if (!reserved) {
      // Lost a race (consumed, expired or out of attempts meanwhile): say which.
      assertGuessable(await store.findById(challenge.id));
      throw invalidChallenge();
    }

    if (!sameHash(hashCode(purpose, challenge.id, normalized), reserved.code_hash)) {
      const remaining = Math.max(0, p.maxAttempts - reserved.attempts);
      if (remaining === 0) {
        throw new OtpError('OTP_TOO_MANY_ATTEMPTS', 429, 'Too many incorrect codes. Request a new one.', { challenge: publicView(reserved) });
      }
      throw new OtpError('OTP_INVALID', 400, 'The code is incorrect.', { attempts_remaining: remaining, challenge: publicView(reserved) });
    }

    const consumed = await store.consume(challenge.id, reserved.code_hash, new Date(now()), apply);
    if (!consumed) throw invalidChallenge();
    return consumed;
  }

  return { issue, resend, verify, publicView, hashCode, policy: p };
}

module.exports = { createEmailOtpService, OtpError, PURPOSES, DEFAULT_POLICY, maskEmail, resolveOtpSecret };
