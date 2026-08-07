const { PrismaClient } = require('@prisma/client');
const { parseId, toInt, normalizeText, normalizeOptionalUserId } = require('../utils/validation');

const prisma = new PrismaClient();

function createAuditNumber(baseTimestamp) {
  const suffix = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `AUD-${baseTimestamp}-${suffix}`;
}

function createMovementNumber(baseTimestamp, index) {
  return `MV-AUD-${baseTimestamp}-${index}`;
}

function isManager(req) {
  const roles = Array.isArray(req.user?.roles) ? req.user.roles.map((r) => String(r).toUpperCase()) : [];
  return Boolean(req.user?.is_superuser) || roles.includes('ADMIN') || roles.includes('WAREHOUSE_MANAGER');
}

function canEditLines(req, audit) {
  const userId = req.user?.id || req.user?.sub;
  return isManager(req) || audit.assigned_to_user_id === userId;
}

function lineSummary(line) {
  return {
    id: line.id,
    variant_id: line.variant_id,
    location_id: line.location_id,
    location_code: line.locations?.location_code || null,
    sku: line.book_variants?.sku || null,
    isbn13: line.book_variants?.isbn13 || null,
    title: line.book_variants?.books?.title || null,
    expected_qty: line.expected_qty,
    counted_qty: line.counted_qty,
    variance_qty: line.variance_qty,
    adjustment_posted: line.adjustment_posted,
    note: line.note,
  };
}

function auditSummary(audit, includeLines = false) {
  const base = {
    id: audit.id,
    audit_number: audit.audit_number,
    status: audit.status,
    warehouse_id: audit.warehouse_id,
    warehouse_code: audit.warehouses?.code || null,
    warehouse_name: audit.warehouses?.name || null,
    created_by_user_id: audit.created_by_user_id,
    assigned_to_user_id: audit.assigned_to_user_id,
    assigned_at: audit.assigned_at,
    reviewed_by_user_id: audit.reviewed_by_user_id,
    started_at: audit.started_at,
    completed_at: audit.completed_at,
    note: audit.note,
    created_at: audit.created_at,
    updated_at: audit.updated_at,
    line_count: audit.stock_audit_lines?.length ?? undefined,
    variance_count: audit.stock_audit_lines?.filter((l) => l.variance_qty).length ?? undefined,
  };
  if (includeLines) {
    base.items = (audit.stock_audit_lines || []).map(lineSummary);
  }
  return base;
}

async function getStockAudits(req, res) {
  try {
    const manager = isManager(req);
    const userId = req.user?.id || req.user?.sub;
    const status = normalizeText(req.query.status);
    const warehouseId = parseId(req.query.warehouse_id);

    const where = {
      ...(status ? { status } : {}),
      ...(warehouseId ? { warehouse_id: warehouseId } : {}),
      ...(manager ? {} : { assigned_to_user_id: userId }),
    };

    const audits = await prisma.stock_audits.findMany({
      where,
      include: {
        warehouses: { select: { code: true, name: true } },
        stock_audit_lines: { select: { id: true, counted_qty: true, variance_qty: true } },
      },
      orderBy: { created_at: 'desc' },
      take: 100,
    });

    return res.json({ data: audits.map((a) => auditSummary(a)) });
  } catch (error) {
    console.error('getStockAudits error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

async function getStockAuditById(req, res) {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ message: 'Invalid stock audit id' });

  try {
    const audit = await prisma.stock_audits.findUnique({
      where: { id },
      include: {
        warehouses: { select: { code: true, name: true } },
        stock_audit_lines: {
          include: {
            locations: { select: { location_code: true } },
            book_variants: { select: { sku: true, isbn13: true, books: { select: { title: true } } } },
          },
        },
      },
    });

    if (!audit) return res.status(404).json({ message: 'Stock audit not found' });

    const manager = isManager(req);
    const userId = req.user?.id || req.user?.sub;
    if (!manager && audit.assigned_to_user_id !== userId) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    return res.json({ data: auditSummary(audit, true) });
  } catch (error) {
    console.error('getStockAuditById error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

async function createStockAudit(req, res) {
  const warehouseId = parseId(req.body?.warehouse_id);
  const locationIds = Array.isArray(req.body?.location_ids)
    ? req.body.location_ids.map(parseId).filter(Boolean)
    : [];
  const note = normalizeText(req.body?.note);
  const userId = req.user?.id || req.user?.sub;

  if (!warehouseId) {
    return res.status(400).json({ message: 'warehouse_id is required' });
  }

  try {
    const balances = await prisma.stock_balances.findMany({
      where: {
        warehouse_id: warehouseId,
        ...(locationIds.length ? { location_id: { in: locationIds } } : {}),
      },
      select: { variant_id: true, location_id: true, on_hand_qty: true },
    });

    if (balances.length === 0) {
      return res.status(400).json({ message: 'Không có tồn kho nào trong phạm vi đã chọn để kiểm kê' });
    }

    const baseTimestamp = Date.now();
    const result = await prisma.$transaction(async (tx) => {
      const audit = await tx.stock_audits.create({
        data: {
          audit_number: createAuditNumber(baseTimestamp),
          warehouse_id: warehouseId,
          status: 'DRAFT',
          created_by_user_id: userId,
          started_at: new Date(),
          note,
        },
      });

      await tx.stock_audit_lines.createMany({
        data: balances.map((b) => ({
          stock_audit_id: audit.id,
          variant_id: b.variant_id,
          location_id: b.location_id,
          expected_qty: b.on_hand_qty,
        })),
      });

      return audit;
    });

    return res.status(201).json({ data: { id: result.id, audit_number: result.audit_number } });
  } catch (error) {
    console.error('createStockAudit error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

async function assignStockAudit(req, res) {
  const id = parseId(req.params.id);
  const assignedToUserId = normalizeOptionalUserId(req.body?.assigned_to_user_id);

  if (!id || !assignedToUserId) {
    return res.status(400).json({ message: 'stock audit id and assigned_to_user_id are required' });
  }

  try {
    const updated = await prisma.stock_audits.update({
      where: { id },
      data: {
        assigned_to_user_id: assignedToUserId,
        assigned_at: new Date(),
        assigned_by_user_id: req.user?.id || req.user?.sub || null,
        status: 'IN_PROGRESS',
        updated_at: new Date(),
      },
    });

    await prisma.inventory_audit_logs.create({
      data: {
        actor_user_id: req.user?.id || req.user?.sub || null,
        action_name: 'STOCK_AUDIT_ASSIGNED',
        entity_type: 'STOCK_AUDIT',
        entity_id: updated.id,
        after_data: { audit_number: updated.audit_number, assigned_to_user_id: assignedToUserId },
      },
    });

    return res.json({
      data: { id: updated.id, status: updated.status, assigned_to_user_id: updated.assigned_to_user_id },
    });
  } catch (error) {
    console.error('assignStockAudit error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

async function submitLineCount(req, res) {
  const id = parseId(req.params.id);
  const lineId = parseId(req.params.lineId);
  const countedQty = toInt(req.body?.counted_qty);

  if (!id || !lineId || countedQty === null || countedQty < 0) {
    return res.status(400).json({ message: 'counted_qty (>= 0) is required' });
  }

  try {
    const audit = await prisma.stock_audits.findUnique({ where: { id } });
    if (!audit) return res.status(404).json({ message: 'Stock audit not found' });
    if (!canEditLines(req, audit)) return res.status(403).json({ message: 'Forbidden' });
    if (!['DRAFT', 'IN_PROGRESS'].includes(audit.status)) {
      return res.status(400).json({ message: 'Phiếu kiểm kê không còn ở trạng thái có thể nhập số lượng' });
    }

    const line = await prisma.stock_audit_lines.findFirst({ where: { id: lineId, stock_audit_id: id } });
    if (!line) return res.status(404).json({ message: 'Stock audit line not found' });

    const updated = await prisma.stock_audit_lines.update({
      where: { id: lineId },
      data: {
        counted_qty: countedQty,
        variance_qty: countedQty - line.expected_qty,
      },
      include: {
        locations: { select: { location_code: true } },
        book_variants: { select: { sku: true, isbn13: true, books: { select: { title: true } } } },
      },
    });

    return res.json({ data: lineSummary(updated) });
  } catch (error) {
    console.error('submitLineCount error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

async function submitStockAudit(req, res) {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ message: 'Invalid stock audit id' });

  try {
    const audit = await prisma.stock_audits.findUnique({
      where: { id },
      include: { stock_audit_lines: { select: { counted_qty: true } } },
    });
    if (!audit) return res.status(404).json({ message: 'Stock audit not found' });
    if (!canEditLines(req, audit)) return res.status(403).json({ message: 'Forbidden' });
    if (!['DRAFT', 'IN_PROGRESS'].includes(audit.status)) {
      return res.status(400).json({ message: 'Phiếu kiểm kê đã được nộp trước đó' });
    }

    const uncounted = audit.stock_audit_lines.filter((l) => l.counted_qty === null).length;
    if (uncounted > 0) {
      return res.status(400).json({ message: `Còn ${uncounted} mục chưa nhập số lượng đếm được` });
    }

    const updated = await prisma.stock_audits.update({
      where: { id },
      data: { status: 'SUBMITTED', updated_at: new Date() },
    });

    return res.json({ data: { id: updated.id, status: updated.status } });
  } catch (error) {
    console.error('submitStockAudit error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

async function approveStockAudit(req, res) {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ message: 'Invalid stock audit id' });

  try {
    const audit = await prisma.stock_audits.findUnique({
      where: { id },
      include: { stock_audit_lines: true },
    });
    if (!audit) return res.status(404).json({ message: 'Stock audit not found' });
    if (audit.status !== 'SUBMITTED') {
      return res.status(400).json({ message: 'Chỉ có thể duyệt phiếu kiểm kê đã được nộp' });
    }

    const reviewerId = req.user?.id || req.user?.sub || null;
    const baseTimestamp = Date.now();
    const linesToAdjust = audit.stock_audit_lines.filter(
      (l) => l.variance_qty !== null && l.variance_qty !== 0 && !l.adjustment_posted,
    );

    const result = await prisma.$transaction(async (tx) => {
      for (const [index, line] of linesToAdjust.entries()) {
        await tx.stock_balances.updateMany({
          where: { variant_id: line.variant_id, location_id: line.location_id },
          data: {
            on_hand_qty: { increment: line.variance_qty },
            available_qty: { increment: line.variance_qty },
          },
        });

        await tx.stock_movements.create({
          data: {
            movement_number: createMovementNumber(baseTimestamp, index),
            movement_type: 'ADJUSTMENT',
            movement_status: 'POSTED',
            warehouse_id: audit.warehouse_id,
            variant_id: line.variant_id,
            to_location_id: line.variance_qty > 0 ? line.location_id : null,
            from_location_id: line.variance_qty < 0 ? line.location_id : null,
            quantity: Math.abs(line.variance_qty),
            reason_code: 'CYCLE_COUNT',
            source_service: 'inventory-service',
            reference_type: 'stock_audit',
            reference_id: line.id,
            created_by_user_id: reviewerId,
          },
        });

        await tx.stock_audit_lines.update({
          where: { id: line.id },
          data: { adjustment_posted: true },
        });
      }

      return tx.stock_audits.update({
        where: { id },
        data: {
          status: 'COMPLETED',
          reviewed_by_user_id: reviewerId,
          completed_at: new Date(),
          updated_at: new Date(),
        },
      });
    });

    await prisma.inventory_audit_logs.create({
      data: {
        actor_user_id: reviewerId,
        action_name: 'STOCK_AUDIT_APPROVED',
        entity_type: 'STOCK_AUDIT',
        entity_id: result.id,
        after_data: { audit_number: result.audit_number, adjustments_posted: linesToAdjust.length },
      },
    });

    return res.json({ data: { id: result.id, status: result.status, adjustments_posted: linesToAdjust.length } });
  } catch (error) {
    console.error('approveStockAudit error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

async function cancelStockAudit(req, res) {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ message: 'Invalid stock audit id' });

  try {
    const audit = await prisma.stock_audits.findUnique({ where: { id } });
    if (!audit) return res.status(404).json({ message: 'Stock audit not found' });
    if (['COMPLETED', 'CANCELLED'].includes(audit.status)) {
      return res.status(400).json({ message: 'Phiếu kiểm kê đã kết thúc, không thể hủy' });
    }

    const updated = await prisma.stock_audits.update({
      where: { id },
      data: { status: 'CANCELLED', updated_at: new Date() },
    });

    return res.json({ data: { id: updated.id, status: updated.status } });
  } catch (error) {
    console.error('cancelStockAudit error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

module.exports = {
  getStockAudits,
  getStockAuditById,
  createStockAudit,
  assignStockAudit,
  submitLineCount,
  submitStockAudit,
  approveStockAudit,
  cancelStockAudit,
};
