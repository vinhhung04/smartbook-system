const { PrismaClient } = require('@prisma/client');
const { pushEvents, pushToRooms } = require('../lib/socket-emitter');

const {
  canReadWarehouse,
  requireWarehouseWriteAccess,
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

const VALID_TASK_TYPES = ['GENERAL', 'CHECK_SHELF', 'STOCK_CHECK', 'LOW_STOCK_REVIEW', 'EXCEPTION_FOLLOW_UP', 'REORDER_REVIEW', 'RESERVATION_FOLLOW_UP', 'INVENTORY_AUDIT', 'OTHER'];
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
    return res.json({ data: enriched, total, page: Number(page), limit: Number(limit) });
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
    if (warehouse_id) {
      const warehouse = await prisma.warehouses.findUnique({ where: { id: warehouse_id } });
      if (!warehouse) {
        return res.status(400).json({ message: 'warehouse_id is invalid' });
      }
      // the body warehouse_id was write-checked by enforceRequestedWarehouseScope;
      // the person doing the task must be able to see that warehouse too
      if (!(await canReadWarehouse({ id: String(assignee_user_id).trim() }, warehouse_id))) {
        return res.status(400).json({ message: 'Người được giao không có quyền ở kho này', code: 'ASSIGNEE_OUT_OF_SCOPE' });
      }
    }
    if (normalizedEntityType && related_entity_id) {
      const entity = await ENTITY_WAREHOUSE[normalizedEntityType](String(related_entity_id));
      if (!entity) return res.status(400).json({ message: 'related_entity_id is invalid' });
      if (entity.warehouse_id && !(await canReadWarehouse(req.user, entity.warehouse_id))) {
        return res.status(403).json({ message: 'You do not have read access to this warehouse', code: 'WAREHOUSE_ACCESS_DENIED' });
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
        warehouse_id: warehouse_id || null,
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
          after_data: { title: task.title, task_type: task.task_type, assignee_user_id: task.assignee_user_id },
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
    if (canManage && req.body.assignee_user_id !== undefined && (req.body.warehouse_id ?? task.warehouse_id)
        && !(await canReadWarehouse({ id: String(req.body.assignee_user_id).trim() }, req.body.warehouse_id ?? task.warehouse_id))) {
      return res.status(400).json({ message: 'Người được giao không có quyền ở kho này', code: 'ASSIGNEE_OUT_OF_SCOPE' });
    }

    const updateData = { updated_at: new Date() };

    if (canManage) {
      const { title, description, task_type, priority, assignee_user_id, warehouse_id, due_date } = req.body;
      if (title !== undefined) updateData.title = String(title).trim();
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
      if (assignee_user_id !== undefined) updateData.assignee_user_id = String(assignee_user_id).trim();
      if (warehouse_id !== undefined) updateData.warehouse_id = warehouse_id || null;
      if (due_date !== undefined) updateData.due_date = due_date ? new Date(due_date) : null;
    }

    if (req.body.status !== undefined) {
      const s = String(req.body.status).toUpperCase();
      if (!VALID_STATUSES.includes(s)) {
        return res.status(400).json({ message: `status must be one of: ${VALID_STATUSES.join(', ')}` });
      }
      if (!canManage && !['IN_PROGRESS', 'DONE'].includes(s)) {
        return res.status(403).json({ message: 'Staff chỉ có thể đổi status sang IN_PROGRESS hoặc DONE' });
      }
      updateData.status = s;
      if (s === 'DONE') {
        updateData.completed_at = new Date();
      }
    }

    const updated = await prisma.staff_tasks.update({
      where: { id },
      data: updateData,
      include: {
        warehouses: { select: { id: true, code: true, name: true } },
      },
    });

    return res.json({ data: updated });
  } catch (error) {
    if (error?.code === 'P2025') {
      return res.status(404).json({ message: 'Staff task not found' });
    }
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

    if (!canManage && task.assignee_user_id !== userId) {
      return res.status(403).json({ message: 'Task không được giao cho bạn' });
    }
    // a manager changing someone else's task needs scope on its warehouse
    if (canManage && task.assignee_user_id !== userId && !(await requireTaskManageAccess(req, res, task, userId))) return undefined;

    if (!canManage && !['IN_PROGRESS', 'DONE'].includes(normalizedStatus)) {
      return res.status(403).json({ message: 'Staff chỉ có thể đổi status sang IN_PROGRESS hoặc DONE' });
    }

    const updateData = { status: normalizedStatus, updated_at: new Date() };
    if (normalizedStatus === 'DONE') {
      updateData.completed_at = new Date();
    }

    const updated = await prisma.staff_tasks.update({ where: { id }, data: updateData });

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
    console.error(error);
    return res.status(500).json({ error: 'Internal server error' });
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
};
