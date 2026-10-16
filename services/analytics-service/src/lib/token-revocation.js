/**
 * Token revocation for analytics-service (Copilot 3.2 audit).
 *
 * Same Redis keys as auth-service and every other service's authenticateToken:
 * `blacklist:token:<jti>` (logout) and `user:tokens-valid-after:<sub>`
 * (password change, account locked/deactivated, role change). Before this,
 * analytics only verified the JWT signature, so a logged-out or locked
 * account kept reading /analytics/* through the gateway until the token
 * expired.
 *
 * Like the other services' Redis wrappers, an unreachable Redis means "cannot
 * tell" and the request continues (documented residual risk); a reachable
 * Redis that holds the key always refuses the token.
 */
const { createClient } = require('redis');

let store = null;
const CONNECT_WAIT_MS = 2000;

function defaultStore() {
  const client = createClient({
    url: process.env.REDIS_URL || 'redis://redis:6379',
    socket: { reconnectStrategy: (retries) => (retries > 10 ? new Error('Max retries reached') : Math.min(retries * 100, 3000)) },
  });
  let connected = false;
  client.on('error', (err) => console.warn('[Redis] Error:', err.message));
  client.on('ready', () => { connected = true; });
  client.on('end', () => { connected = false; });
  // The first requests after start-up must not slip through while the
  // connection is still being made: they wait for it (bounded).
  const ready = client.connect().then(() => { connected = true; })
    .catch((err) => console.warn('[Redis] Connection failed, revocation checks skipped:', err.message));
  return {
    async get(key) {
      if (!connected) await Promise.race([ready, new Promise((resolve) => { setTimeout(resolve, CONNECT_WAIT_MS).unref?.(); })]);
      if (!connected) return null;
      try {
        return await client.get(key);
      } catch (err) {
        console.warn('[Redis] Get error:', err.message);
        return null;
      }
    },
  };
}

/** Tests swap the store. */
function setRevocationStore(next) {
  store = next;
}

async function isTokenRevoked(payload) {
  if (!store) store = defaultStore();
  if (payload?.jti && (await store.get(`blacklist:token:${payload.jti}`)) !== null) return true;
  if (payload?.sub && payload?.iat) {
    const validAfter = await store.get(`user:tokens-valid-after:${payload.sub}`);
    if (validAfter !== null && payload.iat < Number(validAfter)) return true;
  }
  return false;
}

// Connect at start-up rather than on the first request.
if (process.env.NODE_ENV !== 'test' && !process.env.NODE_TEST_CONTEXT) store = defaultStore();

module.exports = { isTokenRevoked, setRevocationStore };
