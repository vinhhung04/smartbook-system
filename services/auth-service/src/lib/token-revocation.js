const redis = require('./redis');

// Bounds how long the cutoff key lives in Redis: any token that could still be affected
// will have expired on its own well before this, since JWT_EXPIRES_IN defaults to 2h.
const REVOCATION_CUTOFF_TTL_SECONDS = 7 * 24 * 60 * 60;

// Invalidates every JWT issued for this user before now, in every service that checks
// this key (see each service's authenticateToken) — not just the token used to trigger
// the change. Used on self-service password change and on admin status changes away
// from ACTIVE (lock/deactivate).
async function revokeUserTokensIssuedBefore(userId) {
  if (!userId) return;
  const nowSeconds = Math.floor(Date.now() / 1000);
  await redis.set(`user:tokens-valid-after:${userId}`, String(nowSeconds), REVOCATION_CUTOFF_TTL_SECONDS);
}

module.exports = { revokeUserTokensIssuedBefore };
