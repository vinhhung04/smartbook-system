const express = require('express');
const { isValidInternalKey } = require('../services/internal-catalog.service');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_MOVEMENTS = 100;
const reservationFields = { id: true, source_reference_id: true, status: true, quantity: true,
  warehouse_id: true, variant_id: true, location_id: true };

// Service-only evidence for the Borrow reconciler. No repair, cancellation or
// stock mutation is performed here; the caller decides whether a repair is safe.
function createInternalBorrowReconciliationRouter({ prisma, internalKey = () => process.env.INTERNAL_SERVICE_KEY } = {}) {
  const router = express.Router();
  router.use((req, res, next) => {
    if (!isValidInternalKey(req.headers['x-internal-service-key'], internalKey())) {
      return res.status(403).json({ message: 'Bạn không có quyền thực hiện thao tác này' });
    }
    return next();
  });

  // Cursor discovery includes old remote holds for which Borrow never managed
  // to commit a reservation or intent. It cannot be discovered from local IDs.
  router.get('/borrow-reconciliation/candidates', async (req, res) => {
    const after = req.query.after;
    if (after !== undefined && (typeof after !== 'string' || !UUID_RE.test(after))) {
      return res.status(400).json({ message: 'after must be a UUID' });
    }
    const limit = Math.max(1, Math.min(100, Number.parseInt(req.query.limit, 10) || 25));
    try {
      const rows = await prisma.$transaction(async tx => {
        await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
        return tx.stock_reservations.findMany({
          where: { source_service: 'BORROW', status: { in: ['ACTIVE', 'CONSUMED'] }, ...(after ? { id: { gt: after.toLowerCase() } } : {}) },
          orderBy: { id: 'asc' }, take: limit + 1, select: reservationFields,
        });
      }, { isolationLevel: 'RepeatableRead' });
      const data = rows.slice(0, limit);
      return res.json({ data, next_cursor: rows.length > limit ? data.at(-1).id : null });
    } catch (_error) { return res.status(503).json({ message: 'Could not read reconciliation candidates' }); }
  });

  router.get('/borrow-reconciliation', async (req, res) => {
    const reservationId = req.query.external_reservation_id;
    const loanId = req.query.external_loan_id;
    if (typeof reservationId !== 'string' || !UUID_RE.test(reservationId) ||
        (loanId !== undefined && (typeof loanId !== 'string' || !UUID_RE.test(loanId)))) {
      return res.status(400).json({ message: 'external_reservation_id và external_loan_id phải là UUID hợp lệ' });
    }
    try {
      const data = await prisma.$transaction(async tx => {
        await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
        const where = { source_service: 'BORROW', source_reference_id: reservationId.toLowerCase() };
        // Never hide a leaked active hold behind a newer terminal history row.
        const reservation = await tx.stock_reservations.findFirst({ where: { ...where, status: 'ACTIVE' },
          select: reservationFields, orderBy: [{ updated_at: 'desc' }, { id: 'asc' }] }) ||
          await tx.stock_reservations.findFirst({ where, select: reservationFields, orderBy: [{ updated_at: 'desc' }, { id: 'asc' }] });
        const consumeRows = await tx.$queryRawUnsafe(`
          SELECT id, reference_id, quantity, variant_id, warehouse_id,
                 LEFT(metadata->>'loan_number', 80) AS loan_number
          FROM stock_movements
          WHERE source_service = 'BORROW_SERVICE' AND reference_type = 'LOAN_TRANSACTION'
            AND movement_type = 'BORROW' AND movement_status = 'POSTED' AND reverted = false
            AND (LOWER(metadata->>'reservation_id') = $1 OR ($2::uuid IS NOT NULL AND reference_id = $2::uuid))
          ORDER BY created_at, id LIMIT 101`, reservationId.toLowerCase(), loanId?.toLowerCase() || null);
        const consumes = consumeRows.slice(0, MAX_MOVEMENTS);
        const loanIds = [...new Set([...consumes.map(row => row.reference_id), ...(loanId ? [loanId.toLowerCase()] : [])])];
        const returnRows = loanIds.length ? await tx.$queryRawUnsafe(`
          SELECT id, reference_id, quantity, variant_id, warehouse_id, idempotency_key,
                 LEFT(metadata->>'loan_item_id', 36) AS loan_item_id,
                 LEFT(metadata->>'item_condition_on_return', 30) AS item_condition_on_return,
                 COALESCE(metadata->>'mark_lost' = 'true', false) AS mark_lost
          FROM stock_movements
          WHERE source_service = 'BORROW_SERVICE' AND reference_type = 'LOAN_TRANSACTION'
            AND movement_type IN ('RETURN', 'ADJUSTMENT') AND movement_status = 'POSTED' AND reverted = false
            AND reference_id = ANY($1::uuid[])
          ORDER BY created_at, id LIMIT 101`, loanIds) : [];
        return { reservation, consume_movements: consumes, return_movements: returnRows.slice(0, MAX_MOVEMENTS),
          truncated: consumeRows.length > MAX_MOVEMENTS || returnRows.length > MAX_MOVEMENTS };
      }, { isolationLevel: 'RepeatableRead' });
      return res.json({ data });
    } catch (_error) {
      return res.status(503).json({ message: 'Could not read Borrow reconciliation evidence' });
    }
  });
  return router;
}

module.exports = { createInternalBorrowReconciliationRouter };
