// Rules for changing a user's warehouse scope (user_warehouse_scopes) and
// primary warehouse. Pure functions - the controller loads the rows inside a
// transaction and applies the plan - so every rule is unit-testable.
//
// - Only the existing access levels: READ, READ_ONLY (read) and WRITE,
//   OPERATOR, FULL (read + write), see @smartbook/shared/warehouse-scope.
// - Nobody changes their own scope; a superuser's scope is changed by a
//   superuser only.
// - An admin (superuser or auth.users.write) replaces the whole set.
//   A warehouse manager only touches warehouses where they hold WRITE-level
//   scope themselves, only for WAREHOUSE_STAFF accounts, never grants a level
//   above their own there, and leaves every other row as it is.
// - primary_warehouse_id is a preference, never a grant: it must be one of the
//   user's scoped warehouses. Revoking the current primary without saying what
//   the new primary is (another warehouse or null) is a 409.

const ACCESS_LEVELS = ['READ', 'READ_ONLY', 'WRITE', 'OPERATOR', 'FULL'];
const LEVEL_RANK = { READ: 1, READ_ONLY: 1, WRITE: 2, OPERATOR: 2, FULL: 3 };
const MANAGE_RANK = 2; // WRITE-level scope is needed to manage a warehouse's staff
const INTERNAL_ROLES = ['ADMIN', 'WAREHOUSE_MANAGER', 'WAREHOUSE_STAFF', 'LIBRARIAN'];
const MANAGER_ASSIGNABLE_ROLES = ['WAREHOUSE_STAFF'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class AssignmentError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'AssignmentError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const LEGACY_ROLE_MAP = { MANAGER: 'WAREHOUSE_MANAGER', STAFF: 'WAREHOUSE_STAFF', WAREHOUSE_OPERATOR: 'WAREHOUSE_STAFF', CUSTOMER_SERVICE: 'LIBRARIAN' };

function normalizeRoleCodes(roles) {
  return (Array.isArray(roles) ? roles : []).map((r) => {
    const code = String(r || '').toUpperCase();
    return LEGACY_ROLE_MAP[code] || code;
  });
}

/** Who is asking: { id, isSuperuser, isAdmin, isManager } from the verified JWT. */
function describeActor(auth = {}) {
  const roles = normalizeRoleCodes(auth.roles);
  const permissions = Array.isArray(auth.permissions) ? auth.permissions : [];
  const isSuperuser = auth.is_superuser === true;
  const isAdmin = isSuperuser || permissions.includes('auth.users.write');
  return { id: String(auth.sub || auth.id || ''), isSuperuser, isAdmin, isManager: !isAdmin && roles.includes('WAREHOUSE_MANAGER') };
}

function isUuid(value) {
  return UUID_RE.test(String(value || ''));
}

/** Validates the request body's scope list; returns [{ warehouse_id, access_level }]. */
function normalizeScopeInput(scopes) {
  if (!Array.isArray(scopes)) {
    throw new AssignmentError(400, 'INVALID_SCOPES', 'scopes phải là một danh sách');
  }
  const seen = new Set();
  return scopes.map((entry) => {
    const warehouseId = String(entry?.warehouse_id || '').trim().toLowerCase();
    const level = String(entry?.access_level || '').trim().toUpperCase();
    if (!isUuid(warehouseId)) throw new AssignmentError(400, 'INVALID_WAREHOUSE_ID', 'warehouse_id không hợp lệ');
    if (!ACCESS_LEVELS.includes(level)) {
      throw new AssignmentError(400, 'INVALID_ACCESS_LEVEL', `access_level phải là một trong: ${ACCESS_LEVELS.join(', ')}`);
    }
    if (seen.has(warehouseId)) throw new AssignmentError(400, 'DUPLICATE_WAREHOUSE', 'Một kho chỉ được phân công một lần', { warehouse_id: warehouseId });
    seen.add(warehouseId);
    return { warehouse_id: warehouseId, access_level: level };
  });
}

/** undefined = keep, null = clear, otherwise a lower-cased uuid. */
function normalizePrimaryInput(value) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const id = String(value).trim().toLowerCase();
  if (!isUuid(id)) throw new AssignmentError(400, 'INVALID_WAREHOUSE_ID', 'primary_warehouse_id không hợp lệ');
  return id;
}

/** Warehouses the actor may manage: id -> their rank there (WRITE level and up). */
function managedWarehouses(actorScopes) {
  const managed = new Map();
  for (const row of actorScopes || []) {
    const rank = LEVEL_RANK[String(row.access_level || '').toUpperCase()] || 0;
    if (rank >= MANAGE_RANK) managed.set(String(row.warehouse_id).toLowerCase(), rank);
  }
  return managed;
}

/**
 * Who may be targeted at all. Throws AssignmentError.
 * target: { id, is_superuser, deleted, roles: [codes] }
 */
function assertCanManageTarget(actor, target, { allowSelf = false } = {}) {
  if (!actor.isAdmin && !actor.isManager) throw new AssignmentError(403, 'FORBIDDEN', 'Bạn không có quyền phân công kho');
  if (!target || target.deleted) throw new AssignmentError(404, 'USER_NOT_FOUND', 'Không tìm thấy người dùng');
  if (!allowSelf && actor.id && actor.id === target.id) {
    throw new AssignmentError(403, 'SELF_ASSIGNMENT_FORBIDDEN', 'Không thể tự thay đổi phạm vi kho của chính mình');
  }
  if (target.is_superuser && !actor.isSuperuser) {
    throw new AssignmentError(403, 'TARGET_PROTECTED', 'Chỉ superuser mới thay đổi được tài khoản superuser');
  }
  if (actor.isManager) {
    const roles = normalizeRoleCodes(target.roles);
    const onlyStaff = roles.length > 0 && roles.every((r) => MANAGER_ASSIGNABLE_ROLES.includes(r));
    if (!onlyStaff || target.is_superuser) {
      throw new AssignmentError(403, 'TARGET_NOT_STAFF', 'Quản lý kho chỉ phân công được tài khoản nhân viên kho');
    }
  }
}

/**
 * Computes the new scope set and primary warehouse. Throws AssignmentError.
 * - actor: describeActor(...) plus actorScopes (manager only, read fresh from the DB)
 * - target: { id, is_superuser, deleted, roles, primary_warehouse_id }
 * - current: the target's rows [{ warehouse_id, access_level }]
 * - requested: normalizeScopeInput(...) result
 * - requestedPrimary: normalizePrimaryInput(...) result
 * - warehouses: Map id -> { is_active } for every requested / primary id that exists
 */
function planScopeUpdate({ actor, actorScopes = [], target, current = [], requested, requestedPrimary, warehouses = new Map() }) {
  assertCanManageTarget(actor, target);
  const roles = normalizeRoleCodes(target.roles);
  if (requested.length && !roles.some((r) => INTERNAL_ROLES.includes(r)) && !target.is_superuser) {
    throw new AssignmentError(400, 'TARGET_NOT_INTERNAL', 'Chỉ tài khoản nội bộ mới được phân công kho');
  }

  const currentById = new Map(current.map((r) => [String(r.warehouse_id).toLowerCase(), String(r.access_level).toUpperCase()]));

  // existence: every requested warehouse must exist; a NEW grant must be active
  for (const row of requested) {
    const warehouse = warehouses.get(row.warehouse_id);
    if (!warehouse) throw new AssignmentError(404, 'WAREHOUSE_NOT_FOUND', 'Kho không tồn tại', { warehouse_id: row.warehouse_id });
    const unchanged = currentById.get(row.warehouse_id) === row.access_level;
    if (!warehouse.is_active && !unchanged) {
      throw new AssignmentError(400, 'WAREHOUSE_INACTIVE', 'Không thể phân công vào kho đã ngừng hoạt động', { warehouse_id: row.warehouse_id });
    }
  }

  let finalRows;
  let managed = null;
  if (actor.isAdmin) {
    finalRows = requested;
  } else {
    managed = managedWarehouses(actorScopes);
    for (const row of requested) {
      const rank = managed.get(row.warehouse_id);
      if (!rank) {
        throw new AssignmentError(403, 'WAREHOUSE_OUT_OF_MANAGER_SCOPE', 'Bạn không quản lý kho này', { warehouse_id: row.warehouse_id });
      }
      const currentLevel = currentById.get(row.warehouse_id);
      if (LEVEL_RANK[row.access_level] > rank && currentLevel !== row.access_level) {
        throw new AssignmentError(403, 'ACCESS_LEVEL_ESCALATION', 'Không thể cấp mức quyền cao hơn quyền của bạn ở kho này', { warehouse_id: row.warehouse_id });
      }
    }
    // a grant above the manager's own level in a managed warehouse stays as it is
    const requestedById = new Map(requested.map((r) => [r.warehouse_id, r.access_level]));
    for (const [warehouseId, level] of currentById) {
      const rank = managed.get(warehouseId);
      if (rank && LEVEL_RANK[level] > rank && requestedById.get(warehouseId) !== level) {
        throw new AssignmentError(403, 'ACCESS_LEVEL_ESCALATION', 'Không thể thay đổi mức quyền cao hơn quyền của bạn ở kho này', { warehouse_id: warehouseId });
      }
    }
    // rows in warehouses the manager does not manage are kept untouched
    finalRows = [
      ...current
        .filter((r) => !managed.has(String(r.warehouse_id).toLowerCase()))
        .map((r) => ({ warehouse_id: String(r.warehouse_id).toLowerCase(), access_level: String(r.access_level).toUpperCase() })),
      ...requested,
    ];
  }

  const finalIds = new Set(finalRows.map((r) => r.warehouse_id));
  const currentPrimary = target.primary_warehouse_id ? String(target.primary_warehouse_id).toLowerCase() : null;
  const nextPrimary = requestedPrimary === undefined ? currentPrimary : requestedPrimary;
  if (nextPrimary && !finalIds.has(nextPrimary)) {
    if (requestedPrimary === undefined) {
      throw new AssignmentError(409, 'PRIMARY_WAREHOUSE_REVOKED', 'Kho chính đang bị thu hồi: chọn kho chính mới hoặc bỏ kho chính', { primary_warehouse_id: nextPrimary });
    }
    throw new AssignmentError(400, 'PRIMARY_NOT_IN_SCOPE', 'Kho chính phải là một trong các kho được phân công');
  }
  if (managed && nextPrimary !== currentPrimary) {
    for (const id of [currentPrimary, nextPrimary]) {
      if (id && !managed.has(id)) {
        throw new AssignmentError(403, 'WAREHOUSE_OUT_OF_MANAGER_SCOPE', 'Bạn không quản lý kho chính này', { warehouse_id: id });
      }
    }
  }

  const finalById = new Map(finalRows.map((r) => [r.warehouse_id, r.access_level]));
  const added = finalRows.filter((r) => !currentById.has(r.warehouse_id));
  const removed = [...currentById].filter(([id]) => !finalById.has(id)).map(([warehouse_id, access_level]) => ({ warehouse_id, access_level }));
  const changed = finalRows
    .filter((r) => currentById.has(r.warehouse_id) && currentById.get(r.warehouse_id) !== r.access_level)
    .map((r) => ({ warehouse_id: r.warehouse_id, from: currentById.get(r.warehouse_id), to: r.access_level }));

  return {
    scopes: finalRows,
    primary_warehouse_id: nextPrimary,
    primary_changed: nextPrimary !== currentPrimary,
    added,
    removed,
    changed,
  };
}

/** Rows a manager may see of another user: only their own managed/readable warehouses. */
function visibleRowsFor(actor, actorScopes, rows) {
  if (actor.isAdmin) return rows;
  const readable = new Set((actorScopes || []).map((r) => String(r.warehouse_id).toLowerCase()));
  return rows.filter((r) => readable.has(String(r.warehouse_id).toLowerCase()));
}

module.exports = {
  ACCESS_LEVELS,
  LEVEL_RANK,
  AssignmentError,
  describeActor,
  normalizeScopeInput,
  normalizePrimaryInput,
  managedWarehouses,
  assertCanManageTarget,
  planScopeUpdate,
  visibleRowsFor,
  normalizeRoleCodes,
  isUuid,
};
