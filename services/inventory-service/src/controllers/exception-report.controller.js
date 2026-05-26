const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

function generateReportNumber() {
  const now = new Date();
  const prefix = 'EXC';
  const date = now.toISOString().slice(0, 10).replace(/-/g, '');
  const ms = String(now.getTime()).slice(-6);
  return `${prefix}-${date}-${ms}`;
}

const VALID_TASK_TYPES = ['RECEIVING', 'PUTAWAY', 'PICKING', 'OUTBOUND'];
const VALID_EXCEPTION_TYPES = ['SHORT', 'OVERAGE', 'DAMAGED', 'WRONG_ITEM', 'WRONG_QTY', 'OTHER'];

async function createExceptionReport(req, res) {
  const userId = req.user?.id || req.user?.sub;
  if (!userId) {
    return res.status(401).json({ message: 'Invalid current user context' });
  }

  const {
    warehouse_id,
    task_type,
    task_id,
    goods_receipt_id,
    exception_type,
    book_variant_id,
    expected_qty,
    actual_qty,
    note,
    evidence_notes,
  } = req.body;

  if (!warehouse_id) return res.status(400).json({ message: 'warehouse_id is required' });
  if (!task_type || !VALID_TASK_TYPES.includes(task_type)) {
    return res.status(400).json({ message: `task_type must be one of: ${VALID_TASK_TYPES.join(', ')}` });
  }
  if (!task_id) return res.status(400).json({ message: 'task_id is required' });
  if (!exception_type || !VALID_EXCEPTION_TYPES.includes(exception_type)) {
    return res.status(400).json({ message: `exception_type must be one of: ${VALID_EXCEPTION_TYPES.join(', ')}` });
  }
  if (!note || !note.trim()) return res.status(400).json({ message: 'note is required' });

  const userRoles = (req.user?.roles || []).map((r) => String(r).toUpperCase());
  const isManager = req.user?.is_superuser || userRoles.some((r) => ['MANAGER', 'ADMIN'].includes(r));

  try {
    const warehouse = await prisma.warehouses.findUnique({ where: { id: warehouse_id } });
    if (!warehouse) return res.status(404).json({ message: 'Warehouse not found' });

    // Validate that task_id belongs to a real task assigned to this user
    if (task_type === 'RECEIVING' || task_type === 'PUTAWAY') {
      const gr = await prisma.goods_receipts.findUnique({
        where: { id: task_id },
        select: { id: true, warehouse_id: true, received_by_user_id: true },
      });
      if (!gr) return res.status(404).json({ message: 'Task not found: goods receipt does not exist' });
      if (gr.warehouse_id !== warehouse_id) return res.status(400).json({ message: 'Warehouse does not match the task' });
      if (!isManager && gr.received_by_user_id !== userId) {
        return res.status(403).json({ message: 'Task not assigned to you' });
      }
    } else if (task_type === 'PICKING' || task_type === 'OUTBOUND') {
      const oo = await prisma.outbound_orders.findUnique({
        where: { id: task_id },
        select: { id: true, warehouse_id: true, processed_by_user_id: true },
      });
      if (oo) {
        if (oo.warehouse_id !== warehouse_id) return res.status(400).json({ message: 'Warehouse does not match the task' });
        if (!isManager && oo.processed_by_user_id !== userId) {
          return res.status(403).json({ message: 'Task not assigned to you' });
        }
      } else {
        const to = await prisma.transfer_orders.findUnique({
          where: { id: task_id },
          select: { id: true, from_warehouse_id: true, shipped_by_user_id: true },
        });
        if (!to) return res.status(404).json({ message: 'Task not found: no outbound or transfer order with this ID' });
        if (to.from_warehouse_id !== warehouse_id) return res.status(400).json({ message: 'Warehouse does not match the task' });
        if (!isManager && to.shipped_by_user_id !== userId) {
          return res.status(403).json({ message: 'Task not assigned to you' });
        }
      }
    }

    if (book_variant_id) {
      const variant = await prisma.book_variants.findUnique({ where: { id: book_variant_id } });
      if (!variant) return res.status(404).json({ message: 'Book variant not found' });
    }

    if (goods_receipt_id) {
      const receipt = await prisma.goods_receipts.findUnique({ where: { id: goods_receipt_id } });
      if (!receipt) return res.status(404).json({ message: 'Goods receipt not found' });
    }

    const report = await prisma.warehouse_exception_reports.create({
      data: {
        report_number: generateReportNumber(),
        created_by_user_id: userId,
        warehouse_id,
        task_type,
        task_id,
        goods_receipt_id: goods_receipt_id || null,
        exception_type,
        book_variant_id: book_variant_id || null,
        expected_qty: expected_qty !== undefined ? Number(expected_qty) : null,
        actual_qty: actual_qty !== undefined ? Number(actual_qty) : null,
        note: note.trim(),
        evidence_notes: evidence_notes || null,
        status: 'OPEN',
      },
    });

    try {
      await prisma.inventory_audit_logs.create({
        data: {
          action_name: 'WAREHOUSE_EXCEPTION_REPORTED',
          actor_user_id: userId,
          entity_type: 'WAREHOUSE_EXCEPTION_REPORT',
          entity_id: report.id,
          after_data: { report_number: report.report_number, task_type, exception_type, warehouse_id },
        },
      });
    } catch (_) { /* audit log is non-critical */ }

    return res.status(201).json({ data: report });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function getMyExceptionReports(req, res) {
  const userId = req.user?.id || req.user?.sub;
  if (!userId) {
    return res.status(401).json({ message: 'Invalid current user context' });
  }

  try {
    const reports = await prisma.warehouse_exception_reports.findMany({
      where: { created_by_user_id: userId },
      include: {
        warehouses: { select: { id: true, code: true, name: true } },
        book_variants: {
          select: {
            id: true, sku: true, isbn13: true,
            books: { select: { id: true, title: true } },
          },
        },
      },
      orderBy: { created_at: 'desc' },
      take: 50,
    });

    return res.json({ data: reports });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function getAllExceptionReports(req, res) {
  const { status, warehouse_id, task_type, exception_type, page = 1, limit = 50 } = req.query;
  const where = {};
  if (status) where.status = status;
  if (warehouse_id) where.warehouse_id = warehouse_id;
  if (task_type) where.task_type = task_type;
  if (exception_type) where.exception_type = exception_type;

  try {
    const [reports, total] = await Promise.all([
      prisma.warehouse_exception_reports.findMany({
        where,
        include: {
          warehouses: { select: { id: true, code: true, name: true } },
          book_variants: {
            select: {
              id: true, sku: true, isbn13: true,
              books: { select: { id: true, title: true } },
            },
          },
        },
        orderBy: { created_at: 'desc' },
        skip: (Number(page) - 1) * Number(limit),
        take: Number(limit),
      }),
      prisma.warehouse_exception_reports.count({ where }),
    ]);

    return res.json({ data: reports, total, page: Number(page), limit: Number(limit) });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function getExceptionReportById(req, res) {
  const userId = req.user?.id || req.user?.sub;
  const userRoles = Array.isArray(req.user?.roles) ? req.user.roles.map((r) => String(r).toUpperCase()) : [];
  const isManager = userRoles.includes('MANAGER') || userRoles.includes('ADMIN') || req.user?.is_superuser;

  try {
    const report = await prisma.warehouse_exception_reports.findUnique({
      where: { id: req.params.id },
      include: {
        warehouses: { select: { id: true, code: true, name: true } },
        book_variants: {
          select: {
            id: true, sku: true, isbn13: true,
            books: { select: { id: true, title: true } },
          },
        },
      },
    });

    if (!report) return res.status(404).json({ message: 'Exception report not found' });

    if (!isManager && report.created_by_user_id !== userId) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    return res.json({ data: report });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function resolveExceptionReport(req, res) {
  const userId = req.user?.id || req.user?.sub;
  const { resolution_notes } = req.body;

  try {
    const report = await prisma.warehouse_exception_reports.findUnique({ where: { id: req.params.id } });
    if (!report) return res.status(404).json({ message: 'Exception report not found' });
    if (report.status === 'RESOLVED') {
      return res.status(400).json({ message: 'Report is already resolved' });
    }

    const updated = await prisma.warehouse_exception_reports.update({
      where: { id: req.params.id },
      data: {
        status: 'RESOLVED',
        resolved_by_user_id: userId,
        resolved_at: new Date(),
        resolution_notes: resolution_notes || null,
        updated_at: new Date(),
      },
    });

    return res.json({ data: updated });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  createExceptionReport,
  getMyExceptionReports,
  getAllExceptionReports,
  getExceptionReportById,
  resolveExceptionReport,
};
