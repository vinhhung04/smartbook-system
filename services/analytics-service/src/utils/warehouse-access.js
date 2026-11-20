// Permission-aware warehouse access for AI inventory rebalancing.
// Pure functions, no DB/HTTP (same convention as warehouse-stock.js).
//
// Input is the scope from @smartbook/shared/warehouse-scope ({all, read, write})
// and the ACTIVE warehouses from inventory_db. Output says, per warehouse,
// whether the analysis may read it and whether an action there is something the
// user can execute now or only propose. The rules mirror what inventory-service
// enforces on the write, so nothing is offered that the target would refuse:
//   POST /api/order-requests/transfer  WAREHOUSE_MANAGER|ADMIN + inventory.operation.decide,
//                                      WRITE on the source, READ on the destination
//   POST /api/purchase-requests        inventory.purchase.request, WRITE on the warehouse
// A warehouse id named by a client is a claim to check, never a grant.

const TRANSFER_ROLES = ['WAREHOUSE_MANAGER', 'ADMIN'];
const TRANSFER_PERMISSION = 'inventory.operation.decide';
const PURCHASE_PERMISSION = 'inventory.purchase.request';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function httpError(statusCode, code, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  error.expose = true;
  return error;
}

/** Active warehouses the user may read, each with READ or WRITE access. */
function accessibleWarehouses(activeWarehouses, scope) {
  const out = [];
  for (const w of activeWarehouses || []) {
    const id = String(w.id || w.warehouse_id || '');
    if (!id) continue;
    const write = scope.all || scope.write.has(id);
    if (!write && !scope.all && !scope.read.has(id)) continue;
    out.push({ warehouse_id: id, code: w.code || null, name: w.name || null, access: write ? 'WRITE' : 'READ' });
  }
  return out;
}

/** What the user's role/permissions allow, independent of any warehouse. */
function actionCapabilities(user) {
  if (user?.is_superuser === true) return { can_create_transfer: true, can_request_purchase: true };
  const roles = new Set((user?.roles || []).map((r) => String(r).toUpperCase()));
  const perms = new Set(user?.permissions || []);
  return {
    can_create_transfer: TRANSFER_ROLES.some((r) => roles.has(r)) && perms.has(TRANSFER_PERMISSION),
    can_request_purchase: perms.has(PURCHASE_PERMISSION),
  };
}

/**
 * Validates warehouse ids the client (or the AI) asked for. Every id must be a
 * UUID of an active warehouse the user may read. Out of scope and unknown ids
 * get the same 403, so the answer does not reveal which warehouses exist;
 * a warehouse inside the scope that is inactive gets 409.
 */
function checkRequestedWarehouses(ids, accessible, scope, allWarehouseIds = null) {
  const byId = new Map(accessible.map((w) => [w.warehouse_id, w]));
  for (const raw of ids || []) {
    const id = String(raw || '').trim();
    if (!UUID_RE.test(id)) throw httpError(400, 'INVALID_WAREHOUSE_ID', 'Mã kho phải là UUID');
    if (byId.has(id)) continue;
    const readable = scope.all ? (allWarehouseIds ? allWarehouseIds.has(id) : false) : scope.read.has(id);
    if (readable) throw httpError(409, 'WAREHOUSE_INACTIVE', 'Kho này đang ngừng hoạt động');
    throw httpError(403, 'WAREHOUSE_ACCESS_DENIED', 'Bạn không có quyền xem kho này');
  }
}

/**
 * EXECUTABLE: the user can create this transfer request now (it still needs the
 * usual approval, picking, shipping and receiving steps).
 * COLLABORATIVE: a sound move the user cannot create - the source warehouse's
 * manager (or someone with the permission) has to.
 * null: either end is outside what the user may read; never proposed.
 */
function transferPermission(sourceId, destinationId, accessible, capabilities) {
  const byId = new Map(accessible.map((w) => [w.warehouse_id, w]));
  const source = byId.get(String(sourceId));
  const destination = byId.get(String(destinationId));
  if (!source || !destination || source.warehouse_id === destination.warehouse_id) return null;
  if (source.access !== 'WRITE') return { status: 'COLLABORATIVE', reason: 'NO_WRITE_ON_SOURCE' };
  if (!capabilities.can_create_transfer) return { status: 'COLLABORATIVE', reason: 'NO_TRANSFER_PERMISSION' };
  return { status: 'EXECUTABLE', reason: null };
}

/** EXECUTABLE or PROPOSAL_ONLY for a purchase request in one warehouse; null if unreadable. */
function purchasePermission(warehouseId, accessible, capabilities) {
  const warehouse = accessible.find((w) => w.warehouse_id === String(warehouseId));
  if (!warehouse) return null;
  if (warehouse.access !== 'WRITE') return { status: 'PROPOSAL_ONLY', reason: 'NO_WRITE_ON_WAREHOUSE' };
  if (!capabilities.can_request_purchase) return { status: 'PROPOSAL_ONLY', reason: 'NO_PURCHASE_PERMISSION' };
  return { status: 'EXECUTABLE', reason: null };
}

module.exports = {
  accessibleWarehouses,
  actionCapabilities,
  checkRequestedWarehouses,
  transferPermission,
  purchasePermission,
};
