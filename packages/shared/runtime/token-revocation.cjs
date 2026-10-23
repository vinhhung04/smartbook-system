// Token revocation check shared by every Node service's authenticateToken
// (Phase 5 security completion).
//
// Keys (written by auth-service): `blacklist:token:<jti>` on logout and
// `user:tokens-valid-after:<sub>` on password change / lock / role change.
//
// Before this module each service read them through a Redis wrapper that
// returned null on ANY error, so "Redis is down" read as "not revoked": a
// logged-out token was accepted by every service, writes included, and after
// an outage longer than the client's reconnect budget the checks stayed off
// until the service restarted. Here the answer has three states:
//
//   REVOKED  - the key says so (or a cached revocation says so)
//   VALID    - Redis answered and nothing revokes the token
//   UNKNOWN  - Redis did not answer in time and no recent answer is cached
//
// Bounded fallback while Redis is unreachable:
//   - a revocation once seen is kept (a logout never un-happens; a cutoff only
//     ever moves forward, so an older cutoff still revokes what it revoked);
//   - a VALID answer is reused for at most `staleOkMs` (default 60 s);
//   - after that the state is UNKNOWN. revocationGuard then refuses writes
//     (503) and lets reads through (or refuses everything with
//     REVOCATION_UNKNOWN_POLICY=deny-all).

const REVOKED = 'REVOKED';
const VALID = 'VALID';
const UNKNOWN = 'UNKNOWN';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`revocation lookup timed out after ${ms} ms`)), ms);
      timer.unref?.();
    }),
  ]).finally(() => clearTimeout(timer));
}

/**
 * @param {object} options
 * @param {(key: string) => Promise<string|null>} options.get - MUST throw when Redis cannot answer
 * @param {number} [options.timeoutMs=300]
 * @param {number} [options.staleOkMs=60000] - how long a VALID answer may be reused while Redis is down
 * @param {number} [options.maxEntries=10000]
 * @param {() => number} [options.now]
 * @param {(msg: string) => void} [options.warn]
 */
function createRevocationChecker({ get, timeoutMs = 300, staleOkMs = 60000, maxEntries = 10000, now = Date.now, warn } = {}) {
  const cache = new Map(); // key -> { value, at }
  let lastWarn = 0;
  const note = (msg) => {
    if (!warn) return;
    const t = now();
    if (t - lastWarn > 10000) { lastWarn = t; warn(msg); }
  };
  const remember = (key, value) => {
    cache.delete(key);
    cache.set(key, { value, at: now() });
    if (cache.size > maxEntries) cache.delete(cache.keys().next().value);
  };

  async function lookup(key) {
    try {
      const value = await withTimeout(Promise.resolve().then(() => get(key)), timeoutMs);
      remember(key, value ?? null);
      return { ok: true, value: value ?? null };
    } catch (err) {
      note(`[revocation] Redis unavailable (${err.message}); using bounded fallback`);
      const hit = cache.get(key);
      if (hit && (hit.value !== null || now() - hit.at <= staleOkMs)) return { ok: true, value: hit.value, stale: true };
      return { ok: false, cachedValue: hit ? hit.value : undefined };
    }
  }

  async function check(payload) {
    let unknown = false;
    let stale = false;
    if (payload?.jti) {
      const r = await lookup(`blacklist:token:${payload.jti}`);
      if (r.ok && r.value !== null) return { state: REVOKED, stale: Boolean(r.stale) };
      if (!r.ok) unknown = true;
      stale = stale || Boolean(r.stale);
    }
    if (payload?.sub && payload?.iat) {
      const r = await lookup(`user:tokens-valid-after:${payload.sub}`);
      const cutoff = r.ok ? r.value : r.cachedValue;
      if (cutoff !== null && cutoff !== undefined && payload.iat < Number(cutoff)) return { state: REVOKED, stale: !r.ok || Boolean(r.stale) };
      if (!r.ok) unknown = true;
      stale = stale || Boolean(r.stale);
    }
    return { state: unknown ? UNKNOWN : VALID, stale };
  }

  // A revocation this process wrote itself (auth-service logout / cutoff) is
  // known first-hand: keep it even if Redis goes away before anyone reads it.
  function noteRevocation(key, value) {
    remember(key, value);
  }

  return { check, noteRevocation, _cache: cache };
}

/**
 * Applies the policy for a check result. Returns true when it already answered
 * the request (caller must stop), false when the request may continue.
 */
function revocationGuard(req, res, result, { mode = process.env.REVOCATION_UNKNOWN_POLICY || 'deny-writes', allowWhenUnknown = false } = {}) {
  if (result.state === REVOKED) {
    res.status(401).json({ message: 'Token has been revoked' });
    return true;
  }
  if (result.state === UNKNOWN) {
    res.setHeader?.('X-Token-Revocation-Check', 'unverified');
    // allowWhenUnknown: a request that only gives access up (logout) must not be refused
    if (!allowWhenUnknown && (mode === 'deny-all' || !SAFE_METHODS.has(String(req.method || 'GET').toUpperCase()))) {
      res.status(503).json({
        message: 'Chưa xác minh được trạng thái phiên đăng nhập (dịch vụ phiên tạm thời không sẵn sàng). '
          + 'Thao tác thay đổi dữ liệu tạm thời bị từ chối, vui lòng thử lại sau.',
        code: 'REVOCATION_UNVERIFIED',
      });
      return true;
    }
  }
  return false;
}

module.exports = { REVOKED, VALID, UNKNOWN, SAFE_METHODS, createRevocationChecker, revocationGuard };
