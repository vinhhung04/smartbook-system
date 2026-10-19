const redis = require('./redis');
const { createRevocationChecker } = require('@smartbook/shared/token-revocation');

// The checker authenticateToken uses (middlewares/auth.middleware.js). It lives
// here so revocations written by this service are remembered by it at once.
const revocationChecker = createRevocationChecker({ get: (key) => redis.getStrict(key), warn: (msg) => console.warn(msg) });

// Bounds how long the cutoff key lives in Redis: any token that could still be affected
// will have expired on its own well before this, since JWT_EXPIRES_IN defaults to 2h.
const REVOCATION_CUTOFF_TTL_SECONDS = 7 * 24 * 60 * 60;
const RETRY_EVERY_MS = 5000;

// Phase 5: a revocation written while Redis is unreachable used to be lost
// silently (the wrapper's set() returns false), so a logged-out token or the
// tokens of a just-locked account worked again once Redis was back. Writes that
// fail are kept here and retried until they land or the tokens they target have
// expired. In-process only: a restart of auth-service during the outage loses
// the queue (documented in docs/ANALYSIS/SECURITY_COMPLETION.md); while Redis is
// down every service refuses writes for unverifiable tokens anyway.
const pending = new Map(); // key -> { value, ttlSeconds, until }
let timer = null;

async function flush() {
  for (const [key, entry] of pending) {
    const left = Math.floor((entry.until - Date.now()) / 1000);
    if (left <= 0) { pending.delete(key); continue; }
    try {
      await redis.setStrict(key, entry.value, Math.min(entry.ttlSeconds, left));
      pending.delete(key);
      console.warn(`[revocation] queued revocation written: ${key.split(':').slice(0, 2).join(':')}`);
    } catch (_err) {
      return; // still down: try again later
    }
  }
  if (pending.size === 0 && timer) { clearInterval(timer); timer = null; }
}

function queue(key, value, ttlSeconds) {
  const existing = pending.get(key);
  // a cutoff only moves forward
  const keep = existing && key.startsWith('user:tokens-valid-after:') && Number(existing.value) > Number(value);
  if (!keep) pending.set(key, { value, ttlSeconds, until: Date.now() + ttlSeconds * 1000 });
  if (!timer) {
    timer = setInterval(() => { flush().catch(() => {}); }, RETRY_EVERY_MS);
    timer.unref?.();
  }
}

/** @returns {Promise<boolean>} true when written now, false when queued for retry */
async function writeRevocation(key, value, ttlSeconds) {
  revocationChecker.noteRevocation(key, value);
  try {
    await redis.setStrict(key, value, ttlSeconds);
    return true;
  } catch (err) {
    console.error(`[revocation] Redis unavailable, revocation queued for retry: ${err.message}`);
    queue(key, value, ttlSeconds);
    return false;
  }
}

// Invalidates every JWT issued for this user before now, in every service that checks
// this key (see each service's authenticateToken) — not just the token used to trigger
// the change. Used on self-service password change and on admin status changes away
// from ACTIVE (lock/deactivate).
async function revokeUserTokensIssuedBefore(userId) {
  if (!userId) return true;
  const nowSeconds = Math.floor(Date.now() / 1000);
  return writeRevocation(`user:tokens-valid-after:${userId}`, String(nowSeconds), REVOCATION_CUTOFF_TTL_SECONDS);
}

async function blacklistToken(jti, expiresInSeconds) {
  if (!jti || !(expiresInSeconds > 0)) return true;
  return writeRevocation(`blacklist:token:${jti}`, '1', expiresInSeconds);
}

module.exports = { revokeUserTokensIssuedBefore, blacklistToken, revocationChecker, _pending: pending, _flush: flush };
