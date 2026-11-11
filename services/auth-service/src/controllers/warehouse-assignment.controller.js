const defaultPrisma = require('../lib/prisma');
const { createWarehouseDirectory, WarehouseDirectoryUnavailableError } = require('../lib/warehouse-directory');
const {
  AssignmentError,
  describeActor,
  normalizeScopeInput,
  normalizePrimaryInput,
  assertCanManageTarget,
  planScopeUpdate,
  visibleRowsFor,
  managedWarehouses,
  isUuid,
} = require('../lib/warehouse-assignment');

const WRITE_LEVELS = ['WRITE', 'OPERATOR', 'FULL'];

/** For reads, auth.users.read is enough to see every user's scope (admin view). */
function describeReader(auth) {
  const actor = describeActor(auth);
  const canReadUsers = Array.isArray(auth?.permissions) && auth.permissions.includes('auth.users.read');
  return canReadUsers && !actor.isAdmin ? { ...actor, isAdmin: true, isManager: false } : actor;
}

function sendError(res, error, label) {
  if (error instanceof AssignmentError) {
    return res.status(error.status).json({ message: error.message, code: error.code, ...(error.details ? { details: error.details } : {}) });
  }
  if (error instanceof WarehouseDirectoryUnavailableError) {
    return res.status(503).json({ message: error.message, code: error.code });
  }
  console.error(`${label} error:`, error);
  return res.status(500).json({ message: 'Internal server error' });
}

/**
 * GET  /iam/users/:id/warehouse-scopes
 * PUT  /iam/users/:id/warehouse-scopes   { scopes: [{ warehouse_id, access_level }], primary_warehouse_id? }
 * GET  /iam/warehouses/:warehouseId/staff[?assignable=1]
 *
 * Admins (superuser / auth.users.write) manage everyone; a WAREHOUSE_MANAGER
 * manages WAREHOUSE_STAFF in the warehouses where they hold WRITE-level scope
 * (rules in lib/warehouse-assignment.js). The caller's own scope is read from
 * the database in the same transaction, never from the token.
 */
function createWarehouseAssignmentController({ prisma = defaultPrisma, directory = createWarehouseDirectory() } = {}) {
  async function loadTarget(db, userId, { lock = false } = {}) {
    const rows = await db.$queryRawUnsafe(
      `SELECT id::text AS id, username, full_name, email, status, is_superuser,
              primary_warehouse_id::text AS primary_warehouse_id, deleted_at
         FROM users WHERE id = $1::uuid ${lock ? 'FOR UPDATE' : ''}`,
      userId,
    );
    const user = rows[0];
    if (!user) return null;
    const roles = await db.$queryRawUnsafe(
      `SELECT r.code FROM user_roles ur JOIN roles r ON r.id = ur.role_id
        WHERE ur.user_id = $1::uuid AND (ur.expires_at IS NULL OR ur.expires_at > NOW())
        ORDER BY r.code`,
      userId,
    );
    return { ...user, deleted: Boolean(user.deleted_at), roles: roles.map((r) => r.code) };
  }

  async function loadScopes(db, userId) {
    return db.$queryRawUnsafe(
      `SELECT warehouse_id::text AS warehouse_id, access_level, assigned_by_user_id::text AS assigned_by_user_id, created_at
         FROM user_warehouse_scopes WHERE user_id = $1::uuid ORDER BY created_at ASC`,
      userId,
    );
  }

  async function actorScopes(db, actor) {
    if (actor.isAdmin || !actor.id) return [];
    return loadScopes(db, actor.id);
  }

  async function withWarehouseInfo(rows) {
    let directoryRows = null;
    try {
      directoryRows = await directory.lookup(rows.map((r) => r.warehouse_id));
    } catch (_error) {
      directoryRows = null; // names are a convenience on reads; ids stay authoritative
    }
    return rows.map((r) => {
      const w = directoryRows?.get(String(r.warehouse_id).toLowerCase()) || null;
      return { ...r, warehouse: w ? { code: w.code, name: w.name, is_active: w.is_active } : null };
    });
  }

  async function getUserWarehouseScopes(req, res) {
    const userId = String(req.params.id || '').trim().toLowerCase();
    if (!isUuid(userId)) return res.status(400).json({ message: 'User id must be a UUID', code: 'INVALID_USER_ID' });
    const actor = describeReader(req.auth);
    const writer = describeActor(req.auth);
    try {
      const target = await loadTarget(prisma, userId);
      assertCanManageTarget(actor, target, { allowSelf: true });
      const [rows, ownScopes] = await Promise.all([loadScopes(prisma, userId), actorScopes(prisma, actor)]);
      const visible = visibleRowsFor(actor, ownScopes, rows);
      const manageable = actor.isAdmin ? null : [...managedWarehouses(ownScopes).keys()];
      return res.json({
        data: {
          user: {
            id: target.id,
            username: target.username,
            full_name: target.full_name,
            status: target.status,
            roles: target.roles,
            primary_warehouse_id: target.primary_warehouse_id,
          },
          scopes: await withWarehouseInfo(visible),
          hidden_scope_count: rows.length - visible.length,
          can_edit: (writer.isAdmin || writer.isManager) && writer.id !== target.id,
          manageable_warehouse_ids: manageable,
        },
      });
    } catch (error) {
      return sendError(res, error, 'getUserWarehouseScopes');
    }
  }

  async function replaceUserWarehouseScopes(req, res) {
    const userId = String(req.params.id || '').trim().toLowerCase();
    if (!isUuid(userId)) return res.status(400).json({ message: 'User id must be a UUID', code: 'INVALID_USER_ID' });
    const actor = describeActor(req.auth);
    try {
      const requested = normalizeScopeInput(req.body?.scopes);
      const requestedPrimary = normalizePrimaryInput(req.body?.primary_warehouse_id);
      // existence is checked against inventory-service before any row changes
      const warehouses = await directory.lookup([...requested.map((r) => r.warehouse_id), requestedPrimary].filter(Boolean));

      const result = await prisma.$transaction(async (tx) => {
        // row lock: two admins saving the same user apply one after the other
        const target = await loadTarget(tx, userId, { lock: true });
        const current = await loadScopes(tx, userId);
        const plan = planScopeUpdate({
          actor,
          actorScopes: await actorScopes(tx, actor),
          target,
          current,
          requested,
          requestedPrimary,
          warehouses,
        });

        if (plan.removed.length) {
          await tx.$executeRawUnsafe(
            `DELETE FROM user_warehouse_scopes WHERE user_id = $1::uuid AND warehouse_id = ANY($2::uuid[])`,
            userId,
            plan.removed.map((r) => r.warehouse_id),
          );
        }
        for (const row of [...plan.added, ...plan.changed.map((c) => ({ warehouse_id: c.warehouse_id, access_level: c.to }))]) {
          await tx.$executeRawUnsafe(
            `INSERT INTO user_warehouse_scopes (user_id, warehouse_id, access_level, assigned_by_user_id)
             VALUES ($1::uuid, $2::uuid, $3, $4::uuid)
             ON CONFLICT (user_id, warehouse_id)
             DO UPDATE SET access_level = EXCLUDED.access_level, assigned_by_user_id = EXCLUDED.assigned_by_user_id`,
            userId,
            row.warehouse_id,
            row.access_level,
            actor.id || null,
          );
        }
        if (plan.primary_changed) {
          await tx.$executeRawUnsafe(
            `UPDATE users SET primary_warehouse_id = $2::uuid, updated_at = NOW() WHERE id = $1::uuid`,
            userId,
            plan.primary_warehouse_id,
          );
        }
        const changedAnything = plan.added.length || plan.removed.length || plan.changed.length || plan.primary_changed;
        if (changedAnything) {
          await tx.$executeRawUnsafe(
            `INSERT INTO auth_audit_logs (actor_user_id, action_name, entity_type, entity_id, detail, ip_address, user_agent)
             VALUES ($1::uuid, 'USER_WAREHOUSE_SCOPES_UPDATED', 'USER', $2::uuid, $3::jsonb, $4, $5)`,
            actor.id || null,
            userId,
            JSON.stringify({
              added: plan.added,
              removed: plan.removed,
              changed: plan.changed,
              primary_before: target.primary_warehouse_id,
              primary_after: plan.primary_warehouse_id,
              actor_mode: actor.isAdmin ? 'ADMIN' : 'WAREHOUSE_MANAGER',
            }),
            req.ip || null,
            req.headers['user-agent'] || null,
          );
        }
        return { plan, changed: Boolean(changedAnything) };
      });

      // Scopes are not in the JWT: every service reads them from here per
      // request (cached up to 30 s). Drop inventory's cached copy now.
      if (result.changed) await directory.notifyScopeChanged(userId);

      const rows = await loadScopes(prisma, userId);
      const ownScopes = await actorScopes(prisma, actor);
      const visible = visibleRowsFor(actor, ownScopes, rows);
      return res.json({
        message: result.changed ? 'Đã cập nhật phân công kho' : 'Không có thay đổi',
        data: {
          user_id: userId,
          primary_warehouse_id: result.plan.primary_warehouse_id,
          scopes: await withWarehouseInfo(visible),
          hidden_scope_count: rows.length - visible.length,
          added: result.plan.added,
          removed: result.plan.removed,
          changed: result.plan.changed,
        },
      });
    } catch (error) {
      return sendError(res, error, 'replaceUserWarehouseScopes');
    }
  }

  async function listStaffOfWarehouse(req, res) {
    const warehouseId = String(req.params.warehouseId || '').trim().toLowerCase();
    if (!isUuid(warehouseId)) return res.status(400).json({ message: 'warehouse id must be a UUID', code: 'INVALID_WAREHOUSE_ID' });
    const actor = describeReader(req.auth);
    const assignableOnly = ['1', 'true'].includes(String(req.query.assignable || '').toLowerCase());
    try {
      if (!actor.isAdmin && !actor.isManager) throw new AssignmentError(403, 'FORBIDDEN', 'Forbidden');
      if (!actor.isAdmin) {
        const own = await actorScopes(prisma, actor);
        if (!own.some((r) => String(r.warehouse_id).toLowerCase() === warehouseId)) {
          throw new AssignmentError(403, 'WAREHOUSE_ACCESS_DENIED', 'Bạn không có quyền ở kho này');
        }
      }
      const filters = assignableOnly
        ? `AND u.status = 'ACTIVE'
           AND s.access_level = ANY($2::text[])
           AND EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id
                        WHERE ur.user_id = u.id AND r.code = 'WAREHOUSE_STAFF'
                          AND (ur.expires_at IS NULL OR ur.expires_at > NOW()))`
        : '';
      const rows = await prisma.$queryRawUnsafe(
        `SELECT u.id::text AS id, u.username, u.full_name, u.email, u.status,
                (u.primary_warehouse_id = s.warehouse_id) AS is_primary,
                s.access_level, s.created_at AS assigned_at,
                COALESCE((SELECT json_agg(r.code ORDER BY r.code) FROM user_roles ur JOIN roles r ON r.id = ur.role_id
                           WHERE ur.user_id = u.id AND (ur.expires_at IS NULL OR ur.expires_at > NOW())), '[]'::json) AS roles
           FROM user_warehouse_scopes s
           JOIN users u ON u.id = s.user_id
          WHERE s.warehouse_id = $1::uuid AND u.deleted_at IS NULL ${filters}
          ORDER BY u.full_name ASC, u.username ASC`,
        ...(assignableOnly ? [warehouseId, WRITE_LEVELS] : [warehouseId]),
      );
      return res.json({ data: rows.map((r) => ({ ...r, is_primary: r.is_primary === true })) });
    } catch (error) {
      return sendError(res, error, 'listStaffOfWarehouse');
    }
  }

  /** Only callers that can assign at all reach the handlers (role or permission). */
  function authorizeAssignmentManager(req, res, next) {
    const actor = req.method === 'GET' ? describeReader(req.auth) : describeActor(req.auth);
    if (actor.isAdmin || actor.isManager) return next();
    return res.status(403).json({ message: 'Forbidden' });
  }

  return { getUserWarehouseScopes, replaceUserWarehouseScopes, listStaffOfWarehouse, authorizeAssignmentManager };
}

module.exports = { createWarehouseAssignmentController };
