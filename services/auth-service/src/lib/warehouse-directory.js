// Warehouses live in inventory_db. auth-service never reads that database: it
// asks inventory-service's internal contract (x-internal-service-key, not
// exposed through the gateway) whether the warehouse ids it is about to put
// into user_warehouse_scopes exist, and tells it to drop a user's cached
// scope after a change.
//
// Fail-closed: when inventory-service cannot answer, an assignment is refused
// (WarehouseDirectoryUnavailableError -> 503) instead of storing ids nobody
// checked.

class WarehouseDirectoryUnavailableError extends Error {
  constructor(message = 'Không xác minh được danh sách kho lúc này, thử lại sau') {
    super(message);
    this.name = 'WarehouseDirectoryUnavailableError';
    this.statusCode = 503;
    this.code = 'WAREHOUSE_DIRECTORY_UNAVAILABLE';
  }
}

function createWarehouseDirectory(options = {}) {
  const baseUrl = String(options.inventoryUrl ?? process.env.INVENTORY_SERVICE_URL ?? 'http://inventory-service:3001').replace(/\/+$/, '');
  const internalKey = String(options.internalKey ?? process.env.INTERNAL_SERVICE_KEY ?? '').trim();
  const timeoutMs = Number(options.timeoutMs ?? 3_000);
  const fetchImpl = options.fetchImpl || globalThis.fetch;

  /** Map id -> { id, code, name, is_active } for the ids that exist. */
  async function lookup(ids) {
    const unique = [...new Set((ids || []).filter(Boolean).map(String))];
    if (!unique.length) return new Map();
    if (!internalKey || typeof fetchImpl !== 'function') throw new WarehouseDirectoryUnavailableError();
    let response;
    try {
      response = await fetchImpl(`${baseUrl}/internal/warehouses?ids=${encodeURIComponent(unique.join(','))}`, {
        headers: { 'x-internal-service-key': internalKey },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (_error) {
      throw new WarehouseDirectoryUnavailableError();
    }
    if (!response.ok) throw new WarehouseDirectoryUnavailableError();
    let body;
    try {
      body = await response.json();
    } catch (_error) {
      throw new WarehouseDirectoryUnavailableError();
    }
    const rows = Array.isArray(body?.data) ? body.data : [];
    return new Map(rows.map((w) => [String(w.id), { id: String(w.id), code: w.code, name: w.name, is_active: w.is_active !== false }]));
  }

  /** Best effort: the scope cache there expires on its own within 30 s anyway. */
  async function notifyScopeChanged(userId) {
    if (!internalKey || typeof fetchImpl !== 'function') return false;
    try {
      const response = await fetchImpl(`${baseUrl}/internal/warehouse-scopes/invalidate`, {
        method: 'POST',
        headers: { 'x-internal-service-key': internalKey, 'content-type': 'application/json' },
        body: JSON.stringify({ user_id: userId }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      return response.ok;
    } catch (_error) {
      return false;
    }
  }

  return { lookup, notifyScopeChanged };
}

module.exports = { createWarehouseDirectory, WarehouseDirectoryUnavailableError };
