const crypto = require('crypto');

// Opaque refresh tokens for the mobile app, kept in Redis (AOF-persisted in
// docker-compose) so no table is needed. Only a SHA-256 of the token is stored.
//
//   refresh:token:<hash>   -> { user_id, family_id, issued_at }   (the live token)
//   refresh:used:<hash>    -> family_id                            (rotated-away tokens)
//   refresh:family:<id>    -> <hash of the family's live token>
//
// Rotation: every refresh consumes the presented token (GETDEL, atomic) and issues
// a new one in the same family. Presenting a token that was already rotated away
// means it leaked (or two clients share it): the whole family is revoked.
// A token is also refused when it predates the user's revocation cutoff
// (user:tokens-valid-after:<id>), which password change, lock/deactivate and
// role changes already write — so those end mobile sessions too.

const DEFAULT_TTL_SECONDS = 30 * 24 * 60 * 60;

class RefreshTokenError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function ttlSeconds() {
  const configured = Number(process.env.REFRESH_TOKEN_TTL_SECONDS);
  return Number.isFinite(configured) && configured >= 3600 ? Math.floor(configured) : DEFAULT_TTL_SECONDS;
}

/**
 * @param store { get(key), set(key, value, ttlSeconds), getDel(key), del(key) } — every
 *   method must throw when Redis cannot answer (never treat "down" as "no such key").
 */
function createRefreshTokenService(store, { now = () => Date.now() } = {}) {
  async function issue(userId, familyId = crypto.randomUUID()) {
    const token = crypto.randomBytes(32).toString('base64url');
    const hash = hashToken(token);
    const ttl = ttlSeconds();
    const issuedAt = Math.floor(now() / 1000);
    await store.set(`refresh:token:${hash}`, JSON.stringify({ user_id: userId, family_id: familyId, issued_at: issuedAt }), ttl);
    await store.set(`refresh:family:${familyId}`, hash, ttl);
    return { token, familyId, expiresAt: new Date((issuedAt + ttl) * 1000).toISOString() };
  }

  async function revokeFamily(familyId) {
    if (!familyId) return;
    const liveHash = await store.get(`refresh:family:${familyId}`);
    if (liveHash) await store.del(`refresh:token:${liveHash}`);
    await store.del(`refresh:family:${familyId}`);
  }

  /** Consumes `token`; returns its record. Throws RefreshTokenError when it cannot be used. */
  async function consume(token) {
    if (typeof token !== 'string' || token.length < 20 || token.length > 200) {
      throw new RefreshTokenError('INVALID', 'Invalid refresh token');
    }
    const hash = hashToken(token);
    const raw = await store.getDel(`refresh:token:${hash}`);
    if (!raw) {
      const reusedFamily = await store.get(`refresh:used:${hash}`);
      if (reusedFamily) {
        await revokeFamily(reusedFamily);
        throw new RefreshTokenError('REUSED', 'Refresh token reuse detected');
      }
      throw new RefreshTokenError('INVALID', 'Invalid refresh token');
    }
    const record = JSON.parse(raw);
    const liveHash = await store.get(`refresh:family:${record.family_id}`);
    if (liveHash !== hash) {
      // The family was revoked (logout elsewhere) or moved on without this token.
      throw new RefreshTokenError('INVALID', 'Invalid refresh token');
    }
    await store.set(`refresh:used:${hash}`, record.family_id, ttlSeconds());
    return record;
  }

  /** Revokes the family a token belongs to (logout). Unknown tokens are ignored. */
  async function revoke(token) {
    if (typeof token !== 'string' || !token) return;
    const raw = await store.get(`refresh:token:${hashToken(token)}`);
    if (!raw) return;
    await revokeFamily(JSON.parse(raw).family_id);
  }

  return { issue, consume, revoke, revokeFamily };
}

module.exports = { createRefreshTokenService, RefreshTokenError, hashToken };
