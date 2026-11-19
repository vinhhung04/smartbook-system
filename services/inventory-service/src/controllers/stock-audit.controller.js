const { parseId, toInt, normalizeText, normalizeOptionalUserId } = require('../utils/validation');
const { buildStockBalanceFilter, createAuditWithLines } = require('../services/stock-audit-creation.service');
const { claimSubmittedAuditForApproval } = require('../services/stock-audit-approval.service');
const { StockAuditCountError, countAdjustment, lockAuditLocations, confirmCountLocations, startAuditCount } = require('../services/stock-audit-count.service');
const {
  requireWarehouseReadAccess,
  requireWarehouseWriteAccess,
  requireAssignableUser,
  scopedWarehouseWhere,
  scopeErrorStatus,
} = require('../utils/warehouse-scope.utils');

// Phase 5: an audit's warehouse is read from the stored audit (never from the
// request) and must be inside the caller's scope - read to see it, write to
// assign / count / submit / cancel, and re-read without cache to approve
// (approval posts stock adjustments to that warehouse).

const { prisma } = require('../lib/prisma');

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
    isbn10: line.book_variants?.isbn10 || null,
    barcode: line.book_variants?.internal_barcode || null,
    title: line.book_variants?.books?.title || null,
    expected_qty: line.expected_qty,
    counted_qty: line.counted_qty,
    variance_qty: line.variance_qty,
    adjustment_posted: line.adjustment_posted,
    counted_at: line.counted_at || null,
    baseline_on_hand_qty: line.baseline_on_hand_qty,
    baseline_borrowed_qty: line.baseline_borrowed_qty,
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
      ...(await scopedWarehouseWhere(req.user, 'warehouse_id', warehouseId)),
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
    return res.status(scopeErrorStatus(error)).json({ message: scopeErrorStatus(error) === 503 ? error.message : 'Internal server error' });
  }
}

async function getStockAuditById(req, res) {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ message: 'Mã phiếu kiểm kê không hợp lệ' });

  try {
    const audit = await prisma.stock_audits.findUnique({
      where: { id },
      include: {
        warehouses: { select: { code: true, name: true } },
        stock_audit_lines: {
          include: {
            locations: { select: { location_code: true } },
            book_variants: { select: { sku: true, isbn13: true, isbn10: true, internal_barcode: true, books: { select: { title: true } } } },
          },
        },
      },
    });

    if (!audit) return res.status(404).json({ message: 'Không tìm thấy phiếu kiểm kê' });
    if (!(await requireWarehouseReadAccess(req, res, audit.warehouse_id))) return undefined;

    const manager = isManager(req);
    const userId = req.user?.id || req.user?.sub;
    if (!manager && audit.assigned_to_user_id !== userId) {
      return res.status(403).json({ message: 'Bạn không có quyền thực hiện thao tác này' });
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
    return res.status(400).json({ message: 'Thiếu warehouse_id' });
  }

  try {
    if (!(await requireWarehouseWriteAccess(req, res, warehouseId))) return undefined;
    const balances = await prisma.stock_balances.findMany({
      where: buildStockBalanceFilter(warehouseId, locationIds),
      select: { variant_id: true, location_id: true, on_hand_qty: true },
    });

    if (balances.length === 0) {
      return res.status(400).json({ message: 'Không có tồn kho nào trong phạm vi đã chọn để kiểm kê' });
    }

    const auditNumber = createAuditNumber(Date.now());
    const result = await prisma.$transaction(async tx => {
      const locations = [...new Set(balances.map(b => b.location_id))];
      await lockAuditLocations(tx, locations);
      const overlapping = await tx.stock_audit_lines.findFirst({ where: {
        location_id: { in: locations }, stock_audits: { status: { in: ['DRAFT', 'IN_PROGRESS', 'SUBMITTED'] } },
      } });
      if (overlapping) throw new StockAuditCountError('STOCK_AUDIT_LOCATION_BUSY', 'Vị trí đã có phiên kiểm kê chưa kết thúc');
      const fresh = await tx.stock_balances.findMany({ where: { warehouse_id: warehouseId, location_id: { in: locations } }, select: { variant_id: true, location_id: true, on_hand_qty: true, borrowed_qty: true } });
      const audit = await createAuditWithLines(tx, { auditNumber, warehouseId, note, userId, balances: fresh });
      await tx.stock_audit_location_sessions.createMany({ data: locations.map(location_id => ({ stock_audit_id: audit.id, location_id })) });
      return audit;
    });

    return res.status(201).json({ data: { id: result.id, audit_number: result.audit_number } });
  } catch (error) {
    console.error('createStockAudit error:', error);
    if (error instanceof StockAuditCountError) return res.status(error.statusCode).json({ message: error.message, code: error.code });
    return res.status(500).json({ message: 'Internal server error' });
  }
}

async function assignStockAudit(req, res) {
  const id = parseId(req.params.id);
  const assignedToUserId = normalizeOptionalUserId(req.body?.assigned_to_user_id);

  if (!id || !assignedToUserId) {
    return res.status(400).json({ message: 'Cần có đủ mã phiếu kiểm kê và assigned_to_user_id' });
  }

  try {
    const existing = await prisma.stock_audits.findUnique({ where: { id }, select: { warehouse_id: true } });
    if (!existing) return res.status(404).json({ message: 'Không tìm thấy phiếu kiểm kê' });
    if (!(await requireWarehouseWriteAccess(req, res, existing.warehouse_id))) return undefined;
    if (!(await requireAssignableUser(res, assignedToUserId, existing.warehouse_id))) return undefined;

    const updated = await prisma.$transaction(async tx => {
      await tx.$queryRawUnsafe('SELECT id FROM stock_audits WHERE id = $1::uuid FOR UPDATE', id);
      const current = await tx.stock_audits.findUnique({ where: { id } });
      if (!current || !['DRAFT', 'IN_PROGRESS'].includes(current.status)) throw new StockAuditCountError('STOCK_AUDIT_NOT_ASSIGNABLE', 'Chỉ có thể giao việc khi phiếu đang đếm');
      if (current.status === 'DRAFT') await startAuditCount(tx, id, current.warehouse_id);
      return tx.stock_audits.update({ where: { id }, data: {
        assigned_to_user_id: assignedToUserId, assigned_at: new Date(),
        assigned_by_user_id: req.user?.id || req.user?.sub || null,
        status: 'IN_PROGRESS', updated_at: new Date(),
      } });
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
    if (error instanceof StockAuditCountError) return res.status(error.statusCode).json({ message: error.message, code: error.code });
    return res.status(500).json({ message: 'Internal server error' });
  }
}

async function submitLineCount(req, res) {
  const id = parseId(req.params.id);
  const lineId = parseId(req.params.lineId);
  const countedQty = toInt(req.body?.counted_qty);

  if (!id || !lineId || countedQty === null || countedQty < 0) {
    return res.status(400).json({ message: 'Thiếu counted_qty (>= 0)' });
  }

  try {
    const audit = await prisma.stock_audits.findUnique({ where: { id } });
    if (!audit) return res.status(404).json({ message: 'Không tìm thấy phiếu kiểm kê' });
    if (!canEditLines(req, audit)) return res.status(403).json({ message: 'Bạn không có quyền thực hiện thao tác này' });
    if (!(await requireWarehouseWriteAccess(req, res, audit.warehouse_id))) return undefined;
    if (!['DRAFT', 'IN_PROGRESS'].includes(audit.status)) {
      return res.status(400).json({ message: 'Phiếu kiểm kê không còn ở trạng thái có thể nhập số lượng' });
    }

    const line = await prisma.stock_audit_lines.findFirst({ where: { id: lineId, stock_audit_id: id } });
    if (!line) return res.status(404).json({ message: 'Không tìm thấy dòng kiểm kê' });

    const updated = await prisma.$transaction(async tx => {
      await tx.$queryRawUnsafe('SELECT id FROM stock_audits WHERE id = $1::uuid FOR UPDATE', id);
      const current = await tx.stock_audits.findUnique({ where: { id } });
      if (!['DRAFT', 'IN_PROGRESS'].includes(current.status)) throw new StockAuditCountError('STOCK_AUDIT_NOT_COUNTABLE', 'Phiếu đã được nộp; không thể sửa số đếm');
      const session = await tx.stock_audit_location_sessions.findFirst({ where: { stock_audit_id: id, location_id: line.location_id, released_at: null } });
      if (!session?.started_at) throw new StockAuditCountError('STOCK_AUDIT_RECOUNT_REQUIRED', 'Phiếu cũ cần bắt đầu đếm lại trước khi nhập số đếm');
      if (session.counting_completed_at) throw new StockAuditCountError('STOCK_AUDIT_LOCATION_COUNTED', 'Vị trí đã chốt số đếm; chọn đếm lại để thay đổi');
      return tx.stock_audit_lines.update({
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
    });

    return res.json({ data: lineSummary(updated) });
  } catch (error) {
    console.error('submitLineCount error:', error);
    if (error instanceof StockAuditCountError) return res.status(error.statusCode).json({ message: error.message, code: error.code });
    return res.status(500).json({ message: 'Internal server error' });
  }
}

async function submitStockAudit(req, res) {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ message: 'Mã phiếu kiểm kê không hợp lệ' });

  try {
    const audit = await prisma.stock_audits.findUnique({
      where: { id },
      include: { stock_audit_lines: { select: { counted_qty: true, location_id: true } } },
    });
    if (!audit) return res.status(404).json({ message: 'Không tìm thấy phiếu kiểm kê' });
    if (!canEditLines(req, audit)) return res.status(403).json({ message: 'Bạn không có quyền thực hiện thao tác này' });
    if (!(await requireWarehouseWriteAccess(req, res, audit.warehouse_id))) return undefined;
    if (!['DRAFT', 'IN_PROGRESS'].includes(audit.status)) {
      return res.status(400).json({ message: 'Phiếu kiểm kê đã được nộp trước đó' });
    }

    const uncounted = audit.stock_audit_lines.filter((l) => l.counted_qty === null).length;
    if (uncounted > 0) {
      return res.status(400).json({ message: `Còn ${uncounted} mục chưa nhập số lượng đếm được` });
    }

    const updated = await prisma.$transaction(async tx => {
      await tx.$queryRawUnsafe('SELECT id FROM stock_audits WHERE id = $1::uuid FOR UPDATE', id);
      const current = await tx.stock_audits.findUnique({ where: { id } });
      if (!['DRAFT', 'IN_PROGRESS'].includes(current.status)) throw new StockAuditCountError('STOCK_AUDIT_NOT_COUNTABLE', 'Phiếu đã được nộp trước đó');
      await confirmCountLocations(tx, id, audit.stock_audit_lines.map(line => line.location_id));
      return tx.stock_audits.update({ where: { id }, data: { status: 'SUBMITTED', updated_at: new Date() } });
    });

    return res.json({ data: { id: updated.id, status: updated.status } });
  } catch (error) {
    console.error('submitStockAudit error:', error);
    if (error instanceof StockAuditCountError) return res.status(error.statusCode).json({ message: error.message, code: error.code });
    return res.status(500).json({ message: 'Internal server error' });
  }
}

async function approveStockAudit(req, res) {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ message: 'Mã phiếu kiểm kê không hợp lệ' });
  const reviewerId = req.user?.id || req.user?.sub || null;

  try {
    const preCheck = await prisma.stock_audits.findUnique({ where: { id } });
    if (!preCheck) return res.status(404).json({ message: 'Không tìm thấy phiếu kiểm kê' });
    if (!(await requireWarehouseWriteAccess(req, res, preCheck.warehouse_id, { fresh: true }))) return undefined;
    if (!['SUBMITTED', 'COMPLETED'].includes(preCheck.status)) {
      return res.status(400).json({ message: 'Chỉ có thể duyệt phiếu kiểm kê đã được nộp' });
    }

    const result = await prisma.$transaction(async (tx) => {
      // Claiming first (atomic CAS on status) is what prevents two concurrent
      // approvals from both passing the pre-check and both applying the stock
      // delta below — linesToAdjust must also be (re-)read inside the
      // transaction, after the claim, not from data fetched before it.
      const claimed = await claimSubmittedAuditForApproval(tx, id, reviewerId);
      if (!claimed) {
        const current = await tx.stock_audits.findUnique({ where: { id } });
        if (current?.status === 'COMPLETED') {
          return { idempotent: true, data: current };
        }
        return { conflict: true };
      }

      const audit = await tx.stock_audits.findUnique({ where: { id } });
      const allLines = await tx.stock_audit_lines.findMany({ where: { stock_audit_id: id } });
      const baseTimestamp = Date.now();
      const candidateLines = allLines.filter(
        (l) => l.counted_qty !== null && !l.adjustment_posted,
      );
      if (allLines.some(line => !line.counted_at || line.counted_qty === null)) throw new StockAuditCountError('STOCK_AUDIT_RECOUNT_REQUIRED', 'Phiếu cũ chưa có mốc kiểm đếm; cần đếm lại trước khi duyệt');

      let adjustmentsPosted = 0;
      for (const [index, line] of candidateLines.entries()) {
        // One open audit owns this location through approval. Apply its confirmed
        // physical discrepancy, preserving all transactions after counted_at.
        await tx.$queryRawUnsafe('SELECT id FROM stock_balances WHERE variant_id = $1::uuid AND location_id = $2::uuid FOR UPDATE', line.variant_id, line.location_id);
        const current = await tx.stock_balances.findFirst({
          where: { variant_id: line.variant_id, location_id: line.location_id },
        });
        const location = await tx.locations.findUnique({ where: { id: line.location_id }, select: { location_type: true } });
        const { delta: liveDelta, availableDelta } = countAdjustment(line, current, location?.location_type);

        if (liveDelta !== 0) {
          await tx.stock_balances.updateMany({
            where: { variant_id: line.variant_id, location_id: line.location_id },
            data: {
              on_hand_qty: { increment: liveDelta },
              available_qty: { increment: availableDelta },
              version: { increment: 1 },
              last_movement_at: new Date(),
            },
          });

          await tx.stock_movements.create({
            data: {
              movement_number: createMovementNumber(baseTimestamp, index),
              movement_type: 'ADJUSTMENT',
              movement_status: 'POSTED',
              warehouse_id: audit.warehouse_id,
              variant_id: line.variant_id,
              to_location_id: liveDelta > 0 ? line.location_id : null,
              from_location_id: liveDelta < 0 ? line.location_id : null,
              quantity: Math.abs(liveDelta),
              reason_code: 'CYCLE_COUNT',
              source_service: 'inventory-service',
              reference_type: 'stock_audit',
              reference_id: line.id,
              created_by_user_id: reviewerId,
            },
          });

          await tx.integration_outbox.create({
            data: {
              aggregate_type: 'STOCK_BALANCE',
              aggregate_id: line.variant_id,
              event_type: 'inventory.stock.changed',
              payload: {
                variant_id: line.variant_id,
                location_id: line.location_id,
                warehouse_id: audit.warehouse_id,
                delta_qty: liveDelta,
                reason_code: 'STOCK_AUDIT_ADJUSTMENT',
                source_reference_type: 'STOCK_AUDIT',
                source_reference_id: id,
              },
            },
          });

          adjustmentsPosted += 1;
        }

        await tx.stock_audit_lines.update({
          where: { id: line.id },
          data: { adjustment_posted: true, variance_qty: liveDelta },
        });
      }

      await tx.stock_audit_location_sessions.updateMany({ where: { stock_audit_id: id, released_at: null }, data: { released_at: new Date() } });

      await tx.inventory_audit_logs.create({ data: {
        actor_user_id: reviewerId, action_name: 'STOCK_AUDIT_APPROVED', entity_type: 'STOCK_AUDIT', entity_id: audit.id,
        after_data: { audit_number: audit.audit_number, adjustments_posted: adjustmentsPosted },
      } });

      return { data: audit, adjustments_posted: adjustmentsPosted };
    });

    if (result.conflict) {
      return res.status(400).json({ message: 'Chỉ có thể duyệt phiếu kiểm kê đã được nộp' });
    }

    if (result.idempotent) {
      return res.json({
        data: { id: result.data.id, status: result.data.status, adjustments_posted: 0 },
        idempotent: true,
      });
    }

    return res.json({
      data: { id: result.data.id, status: 'COMPLETED', adjustments_posted: result.adjustments_posted },
    });
  } catch (error) {
    console.error('approveStockAudit error:', error);
    if (error instanceof StockAuditCountError) return res.status(error.statusCode).json({ message: error.message, code: error.code });
    return res.status(500).json({ message: 'Internal server error' });
  }
}

async function cancelStockAudit(req, res) {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ message: 'Mã phiếu kiểm kê không hợp lệ' });

  try {
    const audit = await prisma.stock_audits.findUnique({ where: { id } });
    if (!audit) return res.status(404).json({ message: 'Không tìm thấy phiếu kiểm kê' });
    if (!(await requireWarehouseWriteAccess(req, res, audit.warehouse_id))) return undefined;
    if (['COMPLETED', 'CANCELLED'].includes(audit.status)) {
      return res.status(400).json({ message: 'Phiếu kiểm kê đã kết thúc, không thể hủy' });
    }

    const updated = await prisma.$transaction(async tx => {
      await tx.$queryRawUnsafe('SELECT id FROM stock_audits WHERE id = $1::uuid FOR UPDATE', id);
      const current = await tx.stock_audits.findUnique({ where: { id } });
      if (['COMPLETED', 'CANCELLED'].includes(current.status)) throw new StockAuditCountError('STOCK_AUDIT_TERMINAL', 'Phiếu kiểm kê đã kết thúc');
      await lockAuditLocations(tx, (await tx.stock_audit_location_sessions.findMany({ where: { stock_audit_id: id, released_at: null } })).map(s => s.location_id));
      await tx.stock_audit_location_sessions.updateMany({ where: { stock_audit_id: id, released_at: null }, data: { released_at: new Date() } });
      return tx.stock_audits.update({ where: { id }, data: { status: 'CANCELLED', updated_at: new Date() } });
    });

    return res.json({ data: { id: updated.id, status: updated.status } });
  } catch (error) {
    console.error('cancelStockAudit error:', error);
    if (error instanceof StockAuditCountError) return res.status(error.statusCode).json({ message: error.message, code: error.code });
    return res.status(500).json({ message: 'Internal server error' });
  }
}

async function recountStockAudit(req, res) {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ message: 'Mã phiếu kiểm kê không hợp lệ' });
  try {
    const audit = await prisma.stock_audits.findUnique({ where: { id }, include: { stock_audit_lines: true } });
    if (!audit) return res.status(404).json({ message: 'Không tìm thấy phiếu kiểm kê' });
    if (!canEditLines(req, audit)) return res.status(403).json({ message: 'Bạn không có quyền đếm lại phiếu này' });
    if (!(await requireWarehouseWriteAccess(req, res, audit.warehouse_id))) return undefined;
    const updated = await prisma.$transaction(async tx => {
      await tx.$queryRawUnsafe('SELECT id FROM stock_audits WHERE id = $1::uuid FOR UPDATE', id);
      const current = await tx.stock_audits.findUnique({ where: { id } });
      if (!['DRAFT', 'IN_PROGRESS', 'SUBMITTED'].includes(current.status)) throw new StockAuditCountError('STOCK_AUDIT_TERMINAL', 'Phiếu đã kết thúc, không thể đếm lại');
      await startAuditCount(tx, id, current.warehouse_id);
      await tx.inventory_audit_logs.create({ data: { actor_user_id: req.user?.id || req.user?.sub, action_name: 'STOCK_AUDIT_RECOUNT_STARTED', entity_type: 'STOCK_AUDIT', entity_id: id } });
      return tx.stock_audits.update({ where: { id }, data: { status: 'IN_PROGRESS', updated_at: new Date() } });
    });
    return res.json({ data: { id: updated.id, status: updated.status } });
  } catch (error) {
    if (error instanceof StockAuditCountError) return res.status(error.statusCode).json({ message: error.message, code: error.code });
    console.error('recountStockAudit error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

async function confirmLocationCount(req, res) {
  const id = parseId(req.params.id);
  const locationId = parseId(req.params.locationId);
  if (!id || !locationId) return res.status(400).json({ message: 'Mã phiếu hoặc vị trí không hợp lệ' });
  try {
    const audit = await prisma.stock_audits.findUnique({ where: { id } });
    if (!audit) return res.status(404).json({ message: 'Không tìm thấy phiếu kiểm kê' });
    if (!canEditLines(req, audit)) return res.status(403).json({ message: 'Bạn không có quyền chốt số đếm' });
    if (!(await requireWarehouseWriteAccess(req, res, audit.warehouse_id))) return undefined;
    await prisma.$transaction(async tx => {
      await tx.$queryRawUnsafe('SELECT id FROM stock_audits WHERE id = $1::uuid FOR UPDATE', id);
      const current = await tx.stock_audits.findUnique({ where: { id } });
      if (!['DRAFT', 'IN_PROGRESS'].includes(current.status)) throw new StockAuditCountError('STOCK_AUDIT_NOT_COUNTABLE', 'Phiếu đã được nộp hoặc kết thúc');
      await confirmCountLocations(tx, id, [locationId]);
    });
    return res.json({ data: { id, location_id: locationId, counting_completed: true } });
  } catch (error) {
    if (error instanceof StockAuditCountError) return res.status(error.statusCode).json({ message: error.message, code: error.code });
    console.error('confirmLocationCount error:', error);
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
  recountStockAudit,
  confirmLocationCount,
};
