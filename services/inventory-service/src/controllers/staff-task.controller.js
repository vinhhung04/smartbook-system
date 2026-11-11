const { PrismaClient } = require('@prisma/client');
const { pushEvents, pushToRooms } = require('../lib/socket-emitter');

const {
  canReadWarehouse,
  canWriteWarehouse,
  requireWarehouseWriteAccess,
  requireAssignableUser,
  scopedWarehouseWhere,
  readableWarehouseFilter,
  scopeErrorStatus,
} = require('../utils/warehouse-scope.utils');

const prisma = new PrismaClient();

// Phase 5 warehouse scope: a task's warehouse comes from the stored task; a
// manager sees and changes only tasks of warehouses in their scope (tasks
// without a warehouse: only the ones they assigned or were assigned), the
// assignee must have access to the task's warehouse, and a linked record must
// belong to a warehouse the creator can read.
const ENTITY_WAREHOUSE = {
  EXCEPTION_REPORT: (id) => prisma.warehouse_exception_reports.findUnique({ where: { id }, select: { warehouse_id: true } }),
  PURCHASE_REQUEST: (id) => prisma.purchase_requests.findUnique({ where: { id }, select: { warehouse_id: true } }),
  OUTBOUND_ORDER: (id) => prisma.outbound_orders.findUnique({ where: { id }, select: { warehouse_id: true } }),
  TRANSFER_ORDER: (id) => prisma.transfer_orders.findUnique({ where: { id }, select: { from_warehouse_id: true } })
    .then((r) => (r ? { warehouse_id: r.from_warehouse_id } : null)),
};

async function managerTaskWhere(user, userId, requestedWarehouseId) {
  const readable = await readableWarehouseFilter(user);
  if (readable === null) return requestedWarehouseId ? { warehouse_id: requestedWarehouseId } : {};
  if (requestedWarehouseId) return scopedWarehouseWhere(user, 'warehouse_id', requestedWarehouseId);
  return {
    OR: [
      { warehouse_id: { in: readable } },
      { warehouse_id: null, OR: [{ assigned_by_user_id: userId }, { assignee_user_id: userId }] },
    ],
  };
}

/** Manager change of a stored task: write scope on its warehouse, or own warehouse-less task. */
async function requireTaskManageAccess(req, res, task, userId) {
  if (req.user?.is_superuser) return true;
  if (!task.warehouse_id) {
    if (task.assigned_by_user_id === userId || task.assignee_user_id === userId) return true;
    res.status(403).json({ message: 'You do not have access to this task', code: 'WAREHOUSE_ACCESS_DENIED' });
    return false;
  }
  return requireWarehouseWriteAccess(req, res, task.warehouse_id);
}

/** The assignee works the task: WRITE scope on its warehouse (READ only sees it). */
async function requireAssigneeCanWork(req, res, task) {
  if (!task.warehouse_id) return true; // legacy task without a warehouse
  return requireWarehouseWriteAccess(req, res, task.warehouse_id);
}

const OPEN_STATUSES = ['OPEN', 'IN_PROGRESS'];
// Staff move their own task forward only; a closed task stays closed.
const STAFF_TRANSITIONS = { OPEN: ['IN_PROGRESS', 'DONE'], IN_PROGRESS: ['DONE'] };

function closedTaskResponse(res) {
  return res.status(409).json({ message: 'Task đã hoàn thành hoặc đã hủy', code: 'TASK_CLOSED' });
}

function concurrentUpdateResponse(res) {
  return res.status(409).json({ message: 'Task vừa được người khác cập nhật, hãy tải lại', code: 'TASK_CONCURRENT_UPDATE' });
}

const VALID_TASK_TYPES =['GENERAL', 'CHECK_SHELF', 'STOCK_CHECK', 'LOW_STOCK_REVIEW', 'EXCEPTION_FOLLOW_UP', 'REORDER_REVIEW', 'RESERVATION_FOLLOW_UP', 'INVENTORY_AUDIT', 'OTHER'];
const VALID_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];
const VALID_STATUSES = ['OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED'];
const VALID_ENTITY_TYPES = ['EXCEPTION_REPORT', 'PURCHASE_REQUEST', 'OUTBOUND_ORDER', 'TRANSFER_ORDER'];

function isManagerOrAdmin(user = {}) {
  if (user.is_superuser) return true;
  const roles = Array.isArray(user.roles) ? user.roles.map((r) => String(r).toUpperCase()) : [];
  return roles.includes('WAREHOUSE_MANAGER') || roles.includes('ADMIN');
}

async function listStaffTasks(req, res) {
  const userId = req.user?.id || req.user?.sub;
  if (!userId) {
    return res.status(401).json({ message: 'Invalid current user context' });
  }

  const canManage = isManagerOrAdmin(req.user);
  const { status, assignee_user_id, warehouse_id, page = 1, limit = 50 } = req.query;

  const where = {};

  if (canManage) {
    if (status) where.status = status;
    if (assignee_user_id) where.assignee_user_id = assignee_user_id;
    try {
      Object.assign(where, await managerTaskWhere(req.user, userId, warehouse_id || null));
    } catch (error) {
      return res.status(scopeErrorStatus(error)).json({ message: error.message });
    }
  } else {
    where.assignee_user_id = userId;
    if (status) where.status = status;
  }

  try {
    const [tasks, total] = await Promise.all([
      prisma.staff_tasks.findMany({
        where,
        include: {
          warehouses: { select: { id: true, code: true, name: true } },
        },
        orderBy: { created_at: 'desc' },
        skip: (Number(page) - 1) * Number(limit),
        take: Number(limit),
      }),
      prisma.staff_tasks.count({ where }),
    ]);

    const enriched = await enrichTasksWithEntityInfo(tasks);
    const flagged = canManage ? await flagAssigneesWhoCannotWork(enriched) : enriched;
    return res.json({ data: flagged, total, page: Number(page), limit: Number(limit) });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function getMyStaffTasks(req, res) {
  const userId = req.user?.id || req.user?.sub;
  if (!userId) {
    return res.status(401).json({ message: 'Invalid current user context' });
  }

  const { status } = req.query;
  const where = { assignee_user_id: userId };
  if (status) where.status = status;

  try {
    const tasks = await prisma.staff_tasks.findMany({
      where,
      include: {
        warehouses: { select: { id: true, code: true, name: true } },
      },
      orderBy: { created_at: 'desc' },
      take: 50,
    });

    const enriched = await enrichTasksWithEntityInfo(tasks);
    return res.json({ data: enriched });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function createStaffTask(req, res) {
  const userId = req.user?.id || req.user?.sub;
  if (!userId) {
    return res.status(401).json({ message: 'Invalid current user context' });
  }

  const {
    title,
    description,
    task_type,
    priority,
    assignee_user_id,
    warehouse_id,
    related_entity_type,
    related_entity_id,
    due_date,
  } = req.body;

  if (!title || !String(title).trim()) {
    return res.status(400).json({ message: 'title is required' });
  }

  if (!assignee_user_id) {
    return res.status(400).json({ message: 'assignee_user_id is required' });
  }

  // a task belongs to one warehouse: the assignee and any linked record are checked against it
  if (!warehouse_id) {
    return res.status(400).json({ message: 'Chọn kho cho task trước khi giao', code: 'WAREHOUSE_REQUIRED' });
  }

  const normalizedType = task_type ? String(task_type).toUpperCase() : 'GENERAL';
  if (!VALID_TASK_TYPES.includes(normalizedType)) {
    return res.status(400).json({ message: `task_type must be one of: ${VALID_TASK_TYPES.join(', ')}` });
  }

  const normalizedPriority = priority ? String(priority).toUpperCase() : 'MEDIUM';
  if (!VALID_PRIORITIES.includes(normalizedPriority)) {
    return res.status(400).json({ message: `priority must be one of: ${VALID_PRIORITIES.join(', ')}` });
  }

  let normalizedEntityType = null;
  if (related_entity_type) {
    normalizedEntityType = String(related_entity_type).toUpperCase();
    if (!VALID_ENTITY_TYPES.includes(normalizedEntityType)) {
      return res.status(400).json({ message: `related_entity_type must be one of: ${VALID_ENTITY_TYPES.join(', ')}` });
    }
  }

  try {
    const warehouse = await prisma.warehouses.findUnique({ where: { id: warehouse_id }, select: { id: true, is_active: true } });
    if (!warehouse || !warehouse.is_active) {
      return res.status(400).json({ message: 'warehouse_id is invalid' });
    }
    // the body warehouse_id was write-checked by enforceRequestedWarehouseScope;
    // the person doing the task must be active warehouse staff with WRITE there
    if (!(await requireAssignableUser(res, String(assignee_user_id).trim(), warehouse_id))) return undefined;
    if (normalizedEntityType && related_entity_id) {
      const entity = await ENTITY_WAREHOUSE[normalizedEntityType](String(related_entity_id));
      if (!entity) return res.status(400).json({ message: 'related_entity_id is invalid' });
      if (entity.warehouse_id && !(await canReadWarehouse(req.user, entity.warehouse_id))) {
        return res.status(403).json({ message: 'You do not have read access to this warehouse', code: 'WAREHOUSE_ACCESS_DENIED' });
      }
      if (entity.warehouse_id && entity.warehouse_id !== warehouse_id) {
        return res.status(400).json({ message: 'Đối tượng liên kết thuộc kho khác với kho của task', code: 'ENTITY_WAREHOUSE_MISMATCH' });
      }
    }

    const task = await prisma.staff_tasks.create({
      data: {
        title: String(title).trim(),
        description: description ? String(description).trim() : null,
        task_type: normalizedType,
        priority: normalizedPriority,
        status: 'OPEN',
        assignee_user_id: String(assignee_user_id).trim(),
        assigned_by_user_id: userId,
        warehouse_id,
        related_entity_type: normalizedEntityType,
        related_entity_id: related_entity_id || null,
        due_date: due_date ? new Date(due_date) : null,
      },
      include: {
        warehouses: { select: { id: true, code: true, name: true } },
      },
    });

    try {
      await prisma.inventory_audit_logs.create({
        data: {
          action_name: 'STAFF_TASK_CREATED',
          actor_user_id: userId,
          entity_type: 'STAFF_TASK',
          entity_id: task.id,
          after_data: { title: task.title, task_type: task.task_type, assignee_user_id: task.assignee_user_id, warehouse_id: task.warehouse_id },
        },
      });
    } catch (_) { /* audit log is non-critical */ }

    const assigneeId = task.assignee_user_id;
    setImmediate(() => void pushEvents([
      { room: 'warehouse_manager', event: 'warehouse_task:assigned', data: { id: task.id, title: task.title, assignee_user_id: assigneeId, status: task.status } },
      { room: 'warehouse_staff',   event: 'warehouse_task:assigned', data: { id: task.id, title: task.title, assignee_user_id: assigneeId, status: task.status } },
      { room: `user:${assigneeId}`, event: 'warehouse_task:assigned', data: { id: task.id, title: task.title, assignee_user_id: assigneeId, status: task.status } },
    ]));

    return res.status(201).json({ message: 'Staff task created successfully', data: task });
  } catch (error) {
    if (scopeErrorStatus(error) === 503) return res.status(503).json({ message: error.message });
    console.error(error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function updateStaffTask(req, res) {
  const userId = req.user?.id || req.user?.sub;
  if (!userId) {
    return res.status(401).json({ message: 'Invalid current user context' });
  }

  const { id } = req.params;
  const canManage = isManagerOrAdmin(req.user);

  try {
    const task = await prisma.staff_tasks.findUnique({ where: { id } });
    if (!task) {
      return res.status(404).json({ message: 'Staff task not found' });
    }

    if (!canManage && task.assignee_user_id !== userId) {
      return res.status(403).json({ message: 'Bạn không có quyền cập nhật task này' });
    }
    if (canManage && !(await requireTaskManageAccess(req, res, task, userId))) return undefined;
    // the assignee acting on the task: a staff member transferred out or
    // locked keeps seeing it but can no longer work it
    if (!canManage && !(await requireAssigneeCanWork(req, res, task))) return undefined;

    const updateData = { updated_at: new Date() };
    let reassigned = false;

    if (canManage) {
      const { title, description, task_type, priority, assignee_user_id, warehouse_id, due_date } = req.body;
      if (title !== undefined) {
        if (!String(title).trim()) return res.status(400).json({ message: 'title is required' });
        updateData.title = String(title).trim();
      }
      if (description !== undefined) updateData.description = description ? String(description).trim() : null;
      if (task_type !== undefined) {
        const t = String(task_type).toUpperCase();
        if (!VALID_TASK_TYPES.includes(t)) {
          return res.status(400).json({ message: `task_type must be one of: ${VALID_TASK_TYPES.join(', ')}` });
        }
        updateData.task_type = t;
      }
      if (priority !== undefined) {
        const p = String(priority).toUpperCase();
        if (!VALID_PRIORITIES.includes(p)) {
          return res.status(400).json({ message: `priority must be one of: ${VALID_PRIORITIES.join(', ')}` });
        }
        updateData.priority = p;
      }
      if (due_date !== undefined) updateData.due_date = due_date ? new Date(due_date) : null;

      // Reassignment / moving the task to another warehouse: only while the
      // task is open, and the (new) assignee must be able to work in the
      // (new) warehouse. The new warehouse's write scope was checked by
      // enforceRequestedWarehouseScope (body warehouse_id).
      const nextAssignee = assignee_user_id !== undefined ? String(assignee_user_id || '').trim() : task.assignee_user_id;
      const nextWarehouse = warehouse_id !== undefined ? (warehouse_id || null) : task.warehouse_id;
      if (assignee_user_id !== undefined && !nextAssignee) {
        return res.status(400).json({ message: 'assignee_user_id is required' });
      }
      if (warehouse_id !== undefined && !nextWarehouse && task.warehouse_id) {
        return res.status(400).json({ message: 'Task phải thuộc một kho', code: 'WAREHOUSE_REQUIRED' });
      }
      const assigneeChanged = nextAssignee !== task.assignee_user_id;
      const warehouseChanged = nextWarehouse !== task.warehouse_id;
      if (assigneeChanged || warehouseChanged) {
        if (!OPEN_STATUSES.includes(task.status)) return closedTaskResponse(res);
        if (warehouseChanged) {
          const warehouse = await prisma.warehouses.findUnique({ where: { id: nextWarehouse }, select: { is_active: true } });
          if (!warehouse || !warehouse.is_active) return res.status(400).json({ message: 'warehouse_id is invalid' });
        }
        if (!(await requireAssignableUser(res, nextAssignee, nextWarehouse))) return undefined;
        updateData.assignee_user_id = nextAssignee;
        updateData.warehouse_id = nextWarehouse;
        // a reassigned task starts over for the new person
        if (assigneeChanged && task.status === 'IN_PROGRESS') updateData.status = 'OPEN';
        reassigned = assigneeChanged;
      }
    }

    if (req.body.status !== undefined) {
      const s = String(req.body.status).toUpperCase();
      if (!VALID_STATUSES.includes(s)) {
        return res.status(400).json({ message: `status must be one of: ${VALID_STATUSES.join(', ')}` });
      }
      if (!canManage) {
        if (!['IN_PROGRESS', 'DONE'].includes(s)) {
          return res.status(403).json({ message: 'Staff chỉ có thể đổi status sang IN_PROGRESS hoặc DONE' });
        }
        if (!(STAFF_TRANSITIONS[task.status] || []).includes(s)) return closedTaskResponse(res);
      }
      updateData.status = s;
      if (s === 'DONE') {
        updateData.completed_at = new Date();
      }
    }

    // conditional write: a concurrent change (another manager reassigning,
    // the staff member completing) since we read the task wins, this one is
    // refused. Not keyed on updated_at: timestamptz keeps microseconds, a JS
    // Date only milliseconds.
    const { count } = await prisma.staff_tasks.updateMany({
      where: { id, status: task.status, assignee_user_id: task.assignee_user_id, warehouse_id: task.warehouse_id },
      data: updateData,
    });
    if (count === 0) return concurrentUpdateResponse(res);

    const updated = await prisma.staff_tasks.findUnique({
      where: { id },
      include: {
        warehouses: { select: { id: true, code: true, name: true } },
      },
    });

    if (reassigned) {
      try {
        await prisma.inventory_audit_logs.create({
          data: {
            action_name: 'STAFF_TASK_REASSIGNED',
            actor_user_id: userId,
            entity_type: 'STAFF_TASK',
            entity_id: id,
            before_data: { assignee_user_id: task.assignee_user_id, warehouse_id: task.warehouse_id, status: task.status },
            after_data: { assignee_user_id: updated.assignee_user_id, warehouse_id: updated.warehouse_id, status: updated.status },
          },
        });
      } catch (_) { /* audit log is non-critical */ }
      const payload = { id: updated.id, title: updated.title, assignee_user_id: updated.assignee_user_id, status: updated.status };
      setImmediate(() => void pushEvents([
        { room: `user:${updated.assignee_user_id}`, event: 'warehouse_task:assigned', data: payload },
        { room: `user:${task.assignee_user_id}`, event: 'warehouse_task:status_changed', data: payload },
      ]));
    }

    return res.json({ data: updated });
  } catch (error) {
    if (error?.code === 'P2025') {
      return res.status(404).json({ message: 'Staff task not found' });
    }
    if (scopeErrorStatus(error) === 503) return res.status(503).json({ message: error.message });
    console.error(error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function updateStaffTaskStatus(req, res) {
  const userId = req.user?.id || req.user?.sub;
  if (!userId) {
    return res.status(401).json({ message: 'Invalid current user context' });
  }

  const { id } = req.params;
  const { status } = req.body;
  const canManage = isManagerOrAdmin(req.user);

  if (!status) {
    return res.status(400).json({ message: 'status is required' });
  }

  const normalizedStatus = String(status).toUpperCase();
  if (!VALID_STATUSES.includes(normalizedStatus)) {
    return res.status(400).json({ message: `status must be one of: ${VALID_STATUSES.join(', ')}` });
  }

  try {
    const task = await prisma.staff_tasks.findUnique({ where: { id } });
    if (!task) {
      return res.status(404).json({ message: 'Staff task not found' });
    }

    const isAssignee = task.assignee_user_id === userId;
    if (!canManage && !isAssignee) {
      return res.status(403).json({ message: 'Task không được giao cho bạn' });
    }
    // a manager changing someone else's task needs scope on its warehouse
    if (canManage && !isAssignee && !(await requireTaskManageAccess(req, res, task, userId))) return undefined;
    // the assignee works the task: WRITE scope on its warehouse, checked now
    // (a staff member transferred out or locked can no longer progress it)
    if (isAssignee && !(await requireAssigneeCanWork(req, res, task))) return undefined;

    if (!canManage && !['IN_PROGRESS', 'DONE'].includes(normalizedStatus)) {
      return res.status(403).json({ message: 'Staff chỉ có thể đổi status sang IN_PROGRESS hoặc DONE' });
    }
    if (!canManage && !(STAFF_TRANSITIONS[task.status] || []).includes(normalizedStatus)) {
      return closedTaskResponse(res);
    }

    const updateData = { status: normalizedStatus, updated_at: new Date() };
    if (normalizedStatus === 'DONE') {
      updateData.completed_at = new Date();
    }

    // only moves the task from the status we read: two people finishing or
    // a manager cancelling at the same moment cannot both win
    const { count } = await prisma.staff_tasks.updateMany({ where: { id, status: task.status }, data: updateData });
    if (count === 0) return concurrentUpdateResponse(res);
    const updated = await prisma.staff_tasks.findUnique({ where: { id } });

    setImmediate(() => void pushToRooms(['admin', 'warehouse_manager'], 'warehouse_task:status_changed', {
      id: updated.id,
      status: updated.status,
      assignee_user_id: updated.assignee_user_id,
    }));

    return res.json({ data: updated });
  } catch (error) {
    if (error?.code === 'P2025') {
      return res.status(404).json({ message: 'Staff task not found' });
    }
    if (scopeErrorStatus(error) === 503) return res.status(503).json({ message: error.message });
    console.error(error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * `assignee_can_work` on open tasks: false when the assignee lost WRITE scope
 * on the task's warehouse or is no longer active (transferred / locked) - the
 * manager should reassign it. null when it could not be checked (auth-service
 * unreachable) or the task has no warehouse; closed tasks are not flagged.
 */
async function flagAssigneesWhoCannotWork(tasks) {
  const verdicts = new Map();
  for (const task of tasks) {
    if (!OPEN_STATUSES.includes(task.status) || !task.warehouse_id) continue;
    const key = `${task.assignee_user_id}:${task.warehouse_id}`;
    if (!verdicts.has(key)) {
      verdicts.set(key, canWriteWarehouse({ id: task.assignee_user_id }, task.warehouse_id).catch(() => null));
    }
  }
  const resolved = new Map();
  for (const [key, promise] of verdicts) resolved.set(key, await promise);
  return tasks.map((task) => {
    const key = `${task.assignee_user_id}:${task.warehouse_id}`;
    return { ...task, assignee_can_work: resolved.has(key) ? resolved.get(key) : null };
  });
}

/**
 * GET /api/staff-tasks/open-summary?assignee_user_id= (manager)
 * Open / in-progress tasks of one person per warehouse, limited to the
 * caller's readable warehouses - shown before revoking a warehouse or
 * locking the account, so the open work can be reassigned.
 */
async function getOpenTaskSummary(req, res) {
  const userId = req.user?.id || req.user?.sub;
  const assigneeId = String(req.query.assignee_user_id || '').trim();
  if (!assigneeId) return res.status(400).json({ message: 'assignee_user_id is required' });
  try {
    const where = {
      assignee_user_id: assigneeId,
      status: { in: OPEN_STATUSES },
      ...(await managerTaskWhere(req.user, userId, null)),
    };
    const rows = await prisma.staff_tasks.groupBy({
      by: ['warehouse_id', 'status'],
      where,
      _count: { _all: true },
    });
    const byWarehouse = new Map();
    for (const row of rows) {
      const key = row.warehouse_id || null;
      const entry = byWarehouse.get(key) || { warehouse_id: key, open: 0, in_progress: 0 };
      if (row.status === 'OPEN') entry.open += row._count._all;
      if (row.status === 'IN_PROGRESS') entry.in_progress += row._count._all;
      byWarehouse.set(key, entry);
    }
    return res.json({ data: [...byWarehouse.values()] });
  } catch (error) {
    if (scopeErrorStatus(error) === 503) return res.status(503).json({ message: error.message });
    console.error(error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

/**
 * GET /api/staff-tasks/workload?warehouse_id= (manager)
 * Per-assignee counts straight from staff_tasks in the caller's scope: each
 * task is counted once, in its current status. `overdue` is the subset of
 * open + in-progress tasks past due_date (not added to the totals again);
 * `done_last_7_days` uses completed_at. No score is derived.
 */
async function getStaffWorkload(req, res) {
  const userId = req.user?.id || req.user?.sub;
  const warehouseId = req.query.warehouse_id ? String(req.query.warehouse_id) : null;
  try {
    const scope = await managerTaskWhere(req.user, userId, warehouseId);
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const [byStatus, overdue, doneRecently] = await Promise.all([
      prisma.staff_tasks.groupBy({
        by: ['assignee_user_id', 'status'],
        where: { ...scope, status: { in: OPEN_STATUSES } },
        _count: { _all: true },
      }),
      prisma.staff_tasks.groupBy({
        by: ['assignee_user_id'],
        where: { ...scope, status: { in: OPEN_STATUSES }, due_date: { lt: now } },
        _count: { _all: true },
      }),
      prisma.staff_tasks.groupBy({
        by: ['assignee_user_id'],
        where: { ...scope, status: 'DONE', completed_at: { gte: weekAgo } },
        _count: { _all: true },
      }),
    ]);
    const rows = new Map();
    const row = (id) => {
      if (!rows.has(id)) rows.set(id, { assignee_user_id: id, open: 0, in_progress: 0, overdue: 0, done_last_7_days: 0 });
      return rows.get(id);
    };
    for (const r of byStatus) {
      if (r.status === 'OPEN') row(r.assignee_user_id).open = r._count._all;
      if (r.status === 'IN_PROGRESS') row(r.assignee_user_id).in_progress = r._count._all;
    }
    for (const r of overdue) row(r.assignee_user_id).overdue = r._count._all;
    for (const r of doneRecently) row(r.assignee_user_id).done_last_7_days = r._count._all;
    return res.json({ data: [...rows.values()], warehouse_id: warehouseId, generated_at: now.toISOString() });
  } catch (error) {
    if (scopeErrorStatus(error) === 503) return res.status(503).json({ message: error.message });
    console.error(error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

async function enrichTasksWithEntityInfo(tasks) {
  const groups = { EXCEPTION_REPORT: [], PURCHASE_REQUEST: [], OUTBOUND_ORDER: [], TRANSFER_ORDER: [] };
  for (const task of tasks) {
    if (task.related_entity_type && task.related_entity_id && groups[task.related_entity_type]) {
      groups[task.related_entity_type].push(task.related_entity_id);
    }
  }

  const hasAny = Object.values(groups).some((g) => g.length > 0);
  if (!hasAny) return tasks;

  const [exReports, purchaseReqs, outboundOrders, transferOrders] = await Promise.all([
    groups.EXCEPTION_REPORT.length > 0
      ? prisma.warehouse_exception_reports.findMany({
          where: { id: { in: groups.EXCEPTION_REPORT } },
          select: {
            id: true, report_number: true, status: true,
            exception_type: true, task_type: true, note: true,
            warehouses: { select: { code: true } },
          },
        })
      : [],
    groups.PURCHASE_REQUEST.length > 0
      ? prisma.purchase_requests.findMany({
          where: { id: { in: groups.PURCHASE_REQUEST } },
          select: {
            id: true, request_number: true, status: true,
            reason: true, quantity_requested: true,
            warehouses: { select: { code: true } },
          },
        })
      : [],
    groups.OUTBOUND_ORDER.length > 0
      ? prisma.outbound_orders.findMany({
          where: { id: { in: groups.OUTBOUND_ORDER } },
          select: {
            id: true, outbound_number: true, status: true, outbound_type: true,
            warehouses: { select: { code: true } },
          },
        })
      : [],
    groups.TRANSFER_ORDER.length > 0
      ? prisma.transfer_orders.findMany({
          where: { id: { in: groups.TRANSFER_ORDER } },
          select: {
            id: true, transfer_number: true, status: true,
            warehouses_transfer_orders_from_warehouse_idTowarehouses: { select: { code: true } },
            warehouses_transfer_orders_to_warehouse_idTowarehouses: { select: { code: true } },
          },
        })
      : [],
  ]);

  const entityMap = {
    EXCEPTION_REPORT: Object.fromEntries(exReports.map((e) => [e.id, {
      ref_number: e.report_number,
      status: e.status,
      details: [e.exception_type, e.task_type, e.warehouses?.code, e.note]
        .filter(Boolean).join(' · '),
    }])),
    PURCHASE_REQUEST: Object.fromEntries(purchaseReqs.map((e) => [e.id, {
      ref_number: e.request_number,
      status: e.status,
      details: [`SL: ${e.quantity_requested}`, e.warehouses?.code, e.reason]
        .filter(Boolean).join(' · '),
    }])),
    OUTBOUND_ORDER: Object.fromEntries(outboundOrders.map((e) => [e.id, {
      ref_number: e.outbound_number,
      status: e.status,
      details: [e.outbound_type, e.warehouses?.code].filter(Boolean).join(' · '),
    }])),
    TRANSFER_ORDER: Object.fromEntries(transferOrders.map((e) => [e.id, {
      ref_number: e.transfer_number,
      status: e.status,
      details: [
        e.warehouses_transfer_orders_from_warehouse_idTowarehouses?.code,
        '→',
        e.warehouses_transfer_orders_to_warehouse_idTowarehouses?.code,
      ].filter(Boolean).join(' '),
    }])),
  };

  return tasks.map((task) => {
    if (!task.related_entity_type || !task.related_entity_id) return task;
    const info = entityMap[task.related_entity_type]?.[task.related_entity_id];
    return { ...task, related_entity_display: info || null };
  });
}

async function getEntityOptions(req, res) {
  const { type, warehouse_id } = req.query;
  if (!type || !VALID_ENTITY_TYPES.includes(String(type).toUpperCase())) {
    return res.status(400).json({ message: `type must be one of: ${VALID_ENTITY_TYPES.join(', ')}` });
  }
  const entityType = String(type).toUpperCase();
  const wh = warehouse_id || null;
  const LIMIT = 30;

  try {
    let options = [];
    if (entityType === 'EXCEPTION_REPORT') {
      const rows = await prisma.warehouse_exception_reports.findMany({
        where: { status: { in: ['OPEN', 'ACKNOWLEDGED'] }, ...(await scopedWarehouseWhere(req.user, 'warehouse_id', wh)) },
        select: { id: true, report_number: true, status: true, exception_type: true, task_type: true, note: true },
        orderBy: { created_at: 'desc' }, take: LIMIT,
      });
      options = rows.map((r) => ({
        id: r.id,
        ref_number: r.report_number,
        status: r.status,
        label: `${r.report_number} — ${r.exception_type} / ${r.task_type}${r.note ? ' · ' + String(r.note).slice(0, 40) : ''}`,
      }));
    } else if (entityType === 'PURCHASE_REQUEST') {
      const rows = await prisma.purchase_requests.findMany({
        where: { status: 'PENDING', ...(await scopedWarehouseWhere(req.user, 'warehouse_id', wh)) },
        select: { id: true, request_number: true, status: true, reason: true, quantity_requested: true },
        orderBy: { created_at: 'desc' }, take: LIMIT,
      });
      options = rows.map((r) => ({
        id: r.id,
        ref_number: r.request_number,
        status: r.status,
        label: `${r.request_number} — SL:${r.quantity_requested}${r.reason ? ' · ' + String(r.reason).slice(0, 40) : ''}`,
      }));
    } else if (entityType === 'OUTBOUND_ORDER') {
      const rows = await prisma.outbound_orders.findMany({
        where: { status: { in: ['APPROVED', 'PICKING', 'READY_FOR_OUTBOUND'] }, ...(await scopedWarehouseWhere(req.user, 'warehouse_id', wh)) },
        select: { id: true, outbound_number: true, status: true, outbound_type: true },
        orderBy: { requested_at: 'desc' }, take: LIMIT,
      });
      options = rows.map((r) => ({
        id: r.id,
        ref_number: r.outbound_number,
        status: r.status,
        label: `${r.outbound_number} — ${r.status} / ${r.outbound_type}`,
      }));
    } else if (entityType === 'TRANSFER_ORDER') {
      const rows = await prisma.transfer_orders.findMany({
        where: { status: { in: ['APPROVED', 'PICKING', 'IN_TRANSIT'] }, ...(await scopedWarehouseWhere(req.user, 'from_warehouse_id', wh)) },
        select: { id: true, transfer_number: true, status: true },
        orderBy: { requested_at: 'desc' }, take: LIMIT,
      });
      options = rows.map((r) => ({
        id: r.id,
        ref_number: r.transfer_number,
        status: r.status,
        label: `${r.transfer_number} — ${r.status}`,
      }));
    }
    return res.json({ data: options });
  } catch (error) {
    if (scopeErrorStatus(error) === 503) return res.status(503).json({ message: error.message });
    console.error(error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

module.exports = {
  listStaffTasks,
  getMyStaffTasks,
  createStaffTask,
  updateStaffTask,
  updateStaffTaskStatus,
  getEntityOptions,
  getOpenTaskSummary,
  getStaffWorkload,
};
