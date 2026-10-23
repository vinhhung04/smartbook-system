/**
 * Token revocation for analytics-service (Copilot 3.2 audit, Phase 5).
 *
 * Same Redis keys as auth-service and every other service's authenticateToken:
 * `blacklist:token:<jti>` (logout) and `user:tokens-valid-after:<sub>`
 * (password change, account locked/deactivated, role change). Before 3.2,
 * analytics only verified the JWT signature, so a logged-out or locked
 * account kept reading /analytics/* through the gateway until the token
 * expired.
 *
 * Phase 5: an unreachable Redis is UNKNOWN, not "not revoked"
 * (@smartbook/shared/token-revocation): a revocation seen before the outage
 * is kept, a VALID answer is reused for at most 60 s, then reads continue and
 * writes get 503. The store's get() must throw when Redis cannot answer.
 */
const { createClient } = require('redis');
const { createRevocationChecker } = require('@smartbook/shared/token-revocation');

let checker = null;

function defaultStore() {
  const client = createClient({
    url: process.env.REDIS_URL || 'redis://redis:6379',
    // never give up reconnecting; fail fast while disconnected
    socket: { reconnectStrategy: (retries) => Math.min(retries * 100, 3000) },
    disableOfflineQueue: true,
  });
  client.on('error', (err) => console.warn('[Redis] Error:', err.message));
  client.connect().catch((err) => console.warn('[Redis] Connection failed, revocation checks report UNKNOWN:', err.message));
  return {
    async get(key) {
      if (!client.isReady) throw new Error('Redis is not connected');
      return client.get(key);
    },
  };
}

/** Tests swap the store ({ get(key) } that throws when "Redis" is down). */
function setRevocationStore(next) {
  checker = createRevocationChecker({ get: (key) => next.get(key), warn: (msg) => console.warn(msg) });
}

/** { state: 'REVOKED' | 'VALID' | 'UNKNOWN', stale } */
async function checkTokenRevocation(payload) {
  if (!checker) setRevocationStore(defaultStore());
  return checker.check(payload);
}

// Connect at start-up rather than on the first request.
if (process.env.NODE_ENV !== 'test' && !process.env.NODE_TEST_CONTEXT) setRevocationStore(defaultStore());

module.exports = { checkTokenRevocation, setRevocationStore };
