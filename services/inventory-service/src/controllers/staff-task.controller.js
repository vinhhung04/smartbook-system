const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const VALID_TASK_TYPES = ['GENERAL', 'CHECK_SHELF', 'STOCK_CHECK', 'LOW_STOCK_REVIEW', 'EXCEPTION_FOLLOW_UP', 'REORDER_REVIEW', 'RESERVATION_FOLLOW_UP', 'INVENTORY_AUDIT', 'OTHER'];
const VALID_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];
const VALID_STATUSES = ['OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED'];

function isManagerOrAdmin(user = {}) {
  if (user.is_superuser) return true;
  const roles = Array.isArray(user.roles) ? user.roles.map((r) => String(r).toUpperCase()) : [];
  return roles.includes('MANAGER') || roles.includes('ADMIN');
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
    if (warehouse_id) where.warehouse_id = warehouse_id;
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

    return res.json({ data: tasks, total, page: Number(page), limit: Number(limit) });
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

    return res.json({ data: tasks });
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

  try {
    if (warehouse_id) {
      const warehouse = await prisma.warehouses.findUnique({ where: { id: warehouse_id } });
      if (!warehouse) {
        return res.status(400).json({ message: 'warehouse_id is invalid' });
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
        related_entity_type: related_entity_type || null,
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

    return res.status(201).json({ message: 'Staff task created successfully', data: task });
  } catch (error) {
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

    if (!canManage && !['IN_PROGRESS', 'DONE'].includes(normalizedStatus)) {
      return res.status(403).json({ message: 'Staff chỉ có thể đổi status sang IN_PROGRESS hoặc DONE' });
    }

    const updateData = { status: normalizedStatus, updated_at: new Date() };
    if (normalizedStatus === 'DONE') {
      updateData.completed_at = new Date();
    }

    const updated = await prisma.staff_tasks.update({ where: { id }, data: updateData });

    return res.json({ data: updated });
  } catch (error) {
    if (error?.code === 'P2025') {
      return res.status(404).json({ message: 'Staff task not found' });
    }
    console.error(error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  listStaffTasks,
  getMyStaffTasks,
  createStaffTask,
  updateStaffTask,
  updateStaffTaskStatus,
};
