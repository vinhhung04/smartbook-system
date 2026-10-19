'use strict';

// Warehouse scope - which warehouses a staff user may read and write.
//
// Single source of truth: auth_db.user_warehouse_scopes, read through
// auth-service's internal endpoint GET /internal/users/:id/warehouse-scopes
// (x-internal-service-key). Services never open another service's database.
//
// Fail-closed by design:
// - superuser (verified JWT claim)          -> every warehouse
// - scope rows                               -> exactly those warehouses
// - no scope rows / inactive or unknown user -> no warehouse
// - auth-service unreachable / misconfigured -> WarehouseScopeUnavailableError
//   (callers answer 503) - never "all warehouses".
//
// Access levels: READ, READ_ONLY read; WRITE, OPERATOR, FULL read and write.
// Results are cached per user for `ttlMs` (default 30 s): a revoked scope stops
// working within that window.

const READ_LEVELS = new Set(['READ', 'READ_ONLY', 'WRITE', 'OPERATOR', 'FULL']);
const WRITE_LEVELS = new Set(['WRITE', 'OPERATOR', 'FULL']);

class WarehouseScopeUnavailableError extends Error {
  constructor(message = 'Không xác minh được phạm vi kho của tài khoản lúc này') {
    super(message);
    this.name = 'WarehouseScopeUnavailableError';
    this.statusCode = 503;
    this.code = 'WAREHOUSE_SCOPE_UNAVAILABLE';
    this.expose = true;
  }
}

const NO_ACCESS = Object.freeze({ all: false, read: new Set(), write: new Set() });
const ALL_ACCESS = Object.freeze({ all: true, read: null, write: null });

function scopeFromRows(body) {
  if (!body || body.status !== 'ACTIVE' || body.deleted) return NO_ACCESS;
  if (body.is_superuser === true) return ALL_ACCESS;
  const read = new Set();
  const write = new Set();
  for (const row of Array.isArray(body.scopes) ? body.scopes : []) {
    const level = String(row?.access_level || '').toUpperCase();
    const id = String(row?.warehouse_id || '');
    if (!id) continue;
    if (READ_LEVELS.has(level)) read.add(id);
    if (WRITE_LEVELS.has(level)) write.add(id);
  }
  return { all: false, read, write };
}

function createWarehouseScopeResolver(options = {}) {
  const authUrl = String(options.authUrl ?? process.env.AUTH_SERVICE_INTERNAL_URL ?? process.env.AUTH_SERVICE_URL ?? 'http://auth-service:3002')
    .replace(/\/+$/, '');
  const internalKey = String(options.internalKey ?? process.env.INTERNAL_SERVICE_KEY ?? '').trim();
  const ttlMs = Number(options.ttlMs ?? 30_000);
  const timeoutMs = Number(options.timeoutMs ?? 3_000);
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const cache = new Map();

  async function load(userId) {
    if (!internalKey || !authUrl || typeof fetchImpl !== 'function') {
      throw new WarehouseScopeUnavailableError('Thiếu cấu hình xác minh phạm vi kho (AUTH_SERVICE_URL / INTERNAL_SERVICE_KEY)');
    }
    let response;
    try {
      response = await fetchImpl(`${authUrl}/internal/users/${encodeURIComponent(userId)}/warehouse-scopes`, {
        headers: { 'x-internal-service-key': internalKey },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (_error) {
      throw new WarehouseScopeUnavailableError();
    }
    if (response.status === 404) return NO_ACCESS;
    if (!response.ok) throw new WarehouseScopeUnavailableError();
    let body;
    try {
      body = await response.json();
    } catch (_error) {
      throw new WarehouseScopeUnavailableError();
    }
    return scopeFromRows(body?.data ?? body);
  }

  /** {all, read: Set|null, write: Set|null} for a req.user (verified JWT payload).
   * `fresh`: skip the cache - for confirmation steps (approve, convert, post),
   * so access removed since the request was created is honoured at once. */
  async function resolve(user, { fresh = false } = {}) {
    if (user?.is_superuser === true) return ALL_ACCESS;
    const userId = String(user?.id || user?.sub || '');
    if (!userId) return NO_ACCESS;
    const hit = cache.get(userId);
    if (!fresh && hit && Date.now() - hit.at < ttlMs) return hit.value;
    const value = await load(userId);
    cache.set(userId, { at: Date.now(), value });
    return value;
  }

  async function canRead(user, warehouseId, options) {
    const scope = await resolve(user, options);
    return scope.all || scope.read.has(String(warehouseId || ''));
  }

  async function canWrite(user, warehouseId, options) {
    const scope = await resolve(user, options);
    return scope.all || scope.write.has(String(warehouseId || ''));
  }

  return {
    resolve,
    canRead,
    canWrite,
    clearCache: (userId) => (userId ? cache.delete(String(userId)) : cache.clear()),
  };
}

module.exports = {
  READ_LEVELS,
  WRITE_LEVELS,
  WarehouseScopeUnavailableError,
  createWarehouseScopeResolver,
  scopeFromRows,
};
