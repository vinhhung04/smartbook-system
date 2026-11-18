const { prisma } = require('../lib/prisma');
const crypto = require('node:crypto');
const { createNotificationRecord } = require('../lib/notifications');
const { writeAuditLog } = require('../lib/audit');
const { normalizeMoney, recomputeCustomerFineBalance, lockFineAccrual, refreshFineAccrual } = require('../services/fine.service');
const { parseStatusFilter, searchTerm, countByStatus } = require('../lib/list-query');

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || '').trim());
}

function parsePagination(query) {
  const page = Math.max(1, Number.parseInt(String(query.page || '1'), 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(String(query.pageSize || '20'), 10) || 20));
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

function summarizeFine(fine) {
  const paidAmount = (fine.fine_payments || []).reduce((sum, row) => sum + normalizeMoney(row.amount), 0);
  const remainingBalance = Math.max(0, normalizeMoney(fine.amount) - normalizeMoney(fine.waived_amount) - paidAmount);
  return {
    ...fine,
    summary: {
      paid_amount: normalizeMoney(paidAmount),
      remaining_balance: normalizeMoney(remainingBalance),
    },
  };
}

// Money totals over ALL fines (not just one page). `outstanding` uses the same formula as the
// analytics dashboard's unpaid_fine_amount so both screens show one number.
async function fineMoneySummary() {
  const [row] = await prisma.$queryRaw`
    WITH payments AS (
      SELECT fine_id, COALESCE(SUM(amount), 0) AS paid_amount
      FROM fine_payments
      GROUP BY fine_id
    ),
    balances AS (
      SELECT
        f.status,
        COALESCE(p.paid_amount, 0) AS paid_amount,
        GREATEST(f.amount - COALESCE(f.waived_amount, 0) - COALESCE(p.paid_amount, 0), 0) AS remaining
      FROM fines f
      LEFT JOIN payments p ON p.fine_id = f.id
    )
    SELECT
      COALESCE(SUM(remaining), 0) AS outstanding,
      COALESCE(SUM(paid_amount), 0) AS collected,
      -- By status, so it matches the "Chưa thu xong" tab count.
      COUNT(*) FILTER (WHERE status IN ('UNPAID', 'PARTIALLY_PAID')) AS open_count
    FROM balances
  `;
  return {
    outstanding: normalizeMoney(row?.outstanding),
    collected: normalizeMoney(row?.collected),
    open_count: Number(row?.open_count || 0),
  };
}

async function listFines(req, res) {
  const pagination = parsePagination(req.query);
  const status = parseStatusFilter(req.query?.status);
  const customerId = String(req.query?.customer_id || '').trim();
  const fineType = String(req.query?.fine_type || '').trim().toUpperCase();
  const q = searchTerm(req.query);

  // Everything except the status condition; per-status counts are taken over this.
  const whereWithoutStatus = {
    ...(customerId ? { customer_id: customerId } : {}),
    ...(fineType ? { fine_type: fineType } : {}),
    ...(q
      ? {
        OR: [
          { customers: { full_name: { contains: q, mode: 'insensitive' } } },
          { customers: { customer_code: { contains: q, mode: 'insensitive' } } },
          { loan_items: { loan_transactions: { loan_number: { contains: q, mode: 'insensitive' } } } },
          ...(isUuid(q) ? [{ id: q }] : []),
        ],
      }
      : {}),
  };
  const where = status ? { ...whereWithoutStatus, status } : whereWithoutStatus;

  try {
    const [items, total, statusCounts, summary] = await Promise.all([
      prisma.fines.findMany({
        where,
        orderBy: [{ issued_at: 'desc' }],
        skip: pagination.skip,
        take: pagination.take,
        include: {
          customers: {
            select: {
              id: true,
              customer_code: true,
              full_name: true,
              status: true,
            },
          },
          loan_items: {
            select: {
              id: true,
              loan_id: true,
              status: true,
              item_barcode: true,
              loan_transactions: { select: { loan_number: true } },
            },
          },
          fine_payments: {
            orderBy: [{ paid_at: 'desc' }],
          },
        },
      }),
      prisma.fines.count({ where }),
      countByStatus(prisma.fines, whereWithoutStatus),
      req.query?.summary ? fineMoneySummary() : undefined,
    ]);

    return res.json({
      data: items.map(summarizeFine),
      meta: {
        page: pagination.page,
        pageSize: pagination.pageSize,
        total,
        totalPages: Math.ceil(total / pagination.pageSize) || 1,
        status_counts: statusCounts,
        ...(summary ? { summary } : {}),
      },
    });
  } catch (error) {
    console.error('listFines error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

async function getFineById(req, res) {
  const fineId = String(req.params.id || '').trim();
  if (!isUuid(fineId)) {
    return res.status(400).json({ message: 'Mã khoản phạt không hợp lệ' });
  }

  try {
    const fine = await prisma.fines.findUnique({
      where: { id: fineId },
      include: {
        customers: {
          select: {
            id: true,
            customer_code: true,
            full_name: true,
            status: true,
            total_fine_balance: true,
          },
        },
        loan_items: { include: { overdue_fine_episode: true } },
        fine_payments: {
          orderBy: [{ paid_at: 'desc' }],
        },
      },
    });

    if (!fine) {
      return res.status(404).json({ message: 'Không tìm thấy khoản phạt' });
    }

    return res.json({ data: summarizeFine(fine) });
  } catch (error) {
    console.error('getFineById error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

async function recordFinePayment(req, res) {
  const fineId = String(req.params.id || '').trim();
  const actorUserId = req.user?.id || null;

  if (!isUuid(fineId)) {
    return res.status(400).json({ message: 'Mã khoản phạt không hợp lệ' });
  }

  const paymentMethod = String(req.body?.payment_method || 'CASH').trim().toUpperCase();
  const allowedMethods = new Set(['CASH', 'CARD', 'TRANSFER', 'EWALLET']);
  if (!allowedMethods.has(paymentMethod)) {
    return res.status(400).json({ message: 'payment_method phải là một trong CASH, CARD, TRANSFER, EWALLET' });
  }

  const requestedAmount = Number(req.body?.amount);
  if (!Number.isFinite(requestedAmount) || requestedAmount <= 0) {
    return res.status(400).json({ message: 'amount phải là số dương' });
  }

  const reference = req.body?.transaction_reference ? String(req.body.transaction_reference).trim().slice(0, 255) || null : null;
  const note = req.body?.note ? String(req.body.note).slice(0, 1000) : null;
  const headerKey = String(req.headers?.['idempotency-key'] || req.headers?.['x-idempotency-key'] || '').trim();
  // Older counter clients supplied bank/card identity but no request header.
  // Keep that identity scoped; a reference is never globally unique across fines.
  const key = headerKey || (reference ? `legacy-fine:${crypto.createHash('sha256').update(JSON.stringify([actorUserId, fineId.toLowerCase(), paymentMethod, reference])).digest('hex')}` : null);
  if (!key || key.length > 255) return res.status(400).json({ message: 'Cần Idempotency-Key tối đa 255 ký tự khi ghi nhận thanh toán phạt', code: 'IDEMPOTENCY_KEY_REQUIRED' });
  const amount = normalizeMoney(requestedAmount);
  if (amount <= 0) return res.status(400).json({ message: 'amount phải lớn hơn 0 sau làm tròn' });
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify({ actor: actorUserId, fine: fineId.toLowerCase(), amount, paymentMethod, reference, note })).digest('hex');

  try {
    const result = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`fine-payment-key:${key}`}, 0))`;
      const previous = await tx.fine_payment_requests.findUnique({ where: { idempotency_key: key } });
      if (previous) {
        if (previous.fingerprint !== fingerprint || previous.fine_id !== fineId.toLowerCase()) return { code: 409, payload: { message: 'Idempotency-Key đã được dùng cho giao dịch khác', code: 'IDEMPOTENCY_CONFLICT' } };
        return previous.response;
      }
      await lockFineAccrual(tx, fineId);
      // Row-lock the fine so a concurrent VNPay confirmation or deposit settlement
      // cannot pay against the same remaining balance.
      await tx.$executeRaw`SELECT id FROM fines WHERE id = ${fineId}::uuid FOR UPDATE`;
      let fine = await tx.fines.findUnique({
        where: { id: fineId },
        include: { fine_payments: true },
      });

      if (!fine) {
        return { code: 404, payload: { message: 'Không tìm thấy khoản phạt' } };
      }

      // Pre-upgrade payments have no durable request-result row. A reference-
      // only retry matching that history cannot safely allocate another partial
      // payment or fabricate an original response. Scope this to the same fine
      // and method: a bank reference is not globally unique across obligations.
      if (!headerKey && reference && fine.fine_payments.some(payment =>
        payment.transaction_reference === reference && payment.payment_method === paymentMethod)) {
        return { code: 409, payload: {
          message: 'Đã có thanh toán cùng tham chiếu; cần đối soát yêu cầu cũ trước khi ghi nhận thêm tiền.',
          code: 'LEGACY_PAYMENT_REVIEW_REQUIRED',
        } };
      }

      await refreshFineAccrual(tx, fine);
      fine = await tx.fines.findUnique({ where: { id: fineId }, include: { fine_payments: true } });

      if (fine.status === 'PAID' || fine.status === 'WAIVED') {
        return { code: 409, payload: { message: `Không thể thanh toán khoản phạt ở trạng thái ${fine.status}` } };
      }

      const paidSoFar = fine.fine_payments.reduce((sum, item) => sum + normalizeMoney(item.amount), 0);
      const remaining = Math.max(0, normalizeMoney(fine.amount) - normalizeMoney(fine.waived_amount) - paidSoFar);

      if (amount > remaining + 0.0001) {
        return {
          code: 409,
          payload: {
            message: 'amount vượt số tiền phạt còn lại',
            detail: { remaining_balance: normalizeMoney(remaining) },
          },
        };
      }

      const payment = await tx.fine_payments.create({
        data: {
          fine_id: fine.id,
          payment_method: paymentMethod,
          amount,
          transaction_reference: reference,
          paid_by_user_id: actorUserId,
          note,
        },
      });

      const stillRemaining = Math.max(0, remaining - amount);
      const nextStatus = stillRemaining <= 0 ? 'PAID' : 'PARTIALLY_PAID';

      const updatedFine = await tx.fines.update({
        where: { id: fine.id },
        data: {
          status: nextStatus,
          paid_at: stillRemaining <= 0 ? new Date() : null,
        },
      });

      const totalFineBalance = await recomputeCustomerFineBalance(tx, fine.customer_id);

      await createNotificationRecord(tx, {
        customer_id: fine.customer_id,
        channel: 'IN_APP',
        template_code: 'FINE_PAYMENT_RECORDED',
        subject: 'Nhân viên đã ghi nhận thanh toán tiền phạt',
        body: `Khoản thanh toán ${Number(amount).toLocaleString('vi-VN')}đ đã được áp dụng cho khoản phạt ${fine.id}.`,
        reference_type: 'FINE',
        reference_id: fine.id,
        metadata: {
          fine_id: fine.id,
          payment_id: payment.id,
          amount,
          remaining_balance: normalizeMoney(stillRemaining),
          payment_method: paymentMethod,
          paid_by_user_id: actorUserId,
        },
        status: 'SENT',
      });

      await writeAuditLog(tx, {
        actor_user_id: actorUserId,
        action_name: 'STAFF_PAY_FINE',
        entity_type: 'FINE',
        entity_id: fine.id,
        before_data: {
          status: fine.status,
          remaining_balance: normalizeMoney(remaining),
        },
        after_data: {
          status: updatedFine.status,
          remaining_balance: normalizeMoney(stillRemaining),
          total_fine_balance: totalFineBalance,
          payment_id: payment.id,
          amount,
          payment_method: paymentMethod,
        },
      });

      const response = {
        code: 200,
        payload: {
          message: stillRemaining <= 0 ? 'Fine paid successfully' : 'Fine payment recorded',
          data: {
            fine_id: updatedFine.id,
            payment_id: payment.id,
            paid_amount: amount,
            remaining_balance: normalizeMoney(stillRemaining),
            status: updatedFine.status,
            total_fine_balance: totalFineBalance,
          },
        },
      };
      await tx.fine_payment_requests.create({ data: { idempotency_key: key, fingerprint, fine_id: fine.id, response } });
      return response;
    });

    return res.status(result.code).json(result.payload);
  } catch (error) {
    console.error('recordFinePayment error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

async function waiveFine(req, res) {
  const fineId = String(req.params.id || '').trim();
  const actorUserId = req.user?.id || null;

  if (!isUuid(fineId)) {
    return res.status(400).json({ message: 'Mã khoản phạt không hợp lệ' });
  }

  const waiveFuture = req.body?.waive_future === true;
  const waiverReason = String(req.body?.note || '').trim().slice(0, 1000);
  if (req.body?.waive_future != null && typeof req.body.waive_future !== 'boolean') {
    return res.status(400).json({ message: 'waive_future phải là boolean' });
  }
  if (waiveFuture && (typeof req.body?.note !== 'string' || !waiverReason)) return res.status(400).json({ message: 'Cần lý do khi miễn phạt cả thời gian tiếp theo' });
  if (waiveFuture && !isUuid(actorUserId)) return res.status(400).json({ message: 'Thiếu người phê duyệt miễn toàn bộ kỳ quá hạn' });
  if (waiveFuture && !(req.user?.is_superuser || req.user?.permissions?.includes('borrow.fines.manage'))) {
    return res.status(403).json({ message: 'Cần quyền quản lý tiền phạt để miễn toàn bộ kỳ quá hạn' });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      await lockFineAccrual(tx, fineId);
      // Same row lock as recordFinePayment: a concurrent payment must not be able to commit
      // against the remaining balance this waiver is about to compute from.
      await tx.$executeRaw`SELECT id FROM fines WHERE id = ${fineId}::uuid FOR UPDATE`;
      let fine = await tx.fines.findUnique({
        where: { id: fineId },
        include: { fine_payments: true },
      });

      if (!fine) {
        return { code: 404, payload: { message: 'Không tìm thấy khoản phạt' } };
      }

      if (waiveFuture && (fine.fine_type !== 'OVERDUE' || !fine.loan_item_id)) {
        return { code: 400, payload: { message: 'Chỉ khoản phạt quá hạn gắn với sách mượn được miễn kỳ tiếp theo' } };
      }
      await refreshFineAccrual(tx, fine);
      fine = await tx.fines.findUnique({ where: { id: fineId }, include: { fine_payments: true } });

      if (fine.status === 'PAID') {
        return { code: 409, payload: { message: 'Không thể miễn giảm khoản phạt đã thanh toán đủ' } };
      }

      const paidSoFar = fine.fine_payments.reduce((sum, item) => sum + normalizeMoney(item.amount), 0);
      const remaining = Math.max(0, normalizeMoney(fine.amount) - normalizeMoney(fine.waived_amount) - paidSoFar);
      if (remaining <= 0) {
        return { code: 409, payload: { message: 'Khoản phạt đã được thanh toán đủ' } };
      }

      const requestedWaive = req.body?.amount == null ? remaining : Number(req.body.amount);
      if (!Number.isFinite(requestedWaive) || requestedWaive <= 0) {
        return { code: 400, payload: { message: 'amount phải là số dương' } };
      }

      const waiveAmount = normalizeMoney(requestedWaive);
      if (waiveAmount > remaining + 0.0001) {
        return {
          code: 409,
          payload: {
            message: 'amount vượt số tiền phạt còn lại',
            detail: { remaining_balance: normalizeMoney(remaining) },
          },
        };
      }

      const newWaivedAmount = normalizeMoney(normalizeMoney(fine.waived_amount) + waiveAmount);
      const newRemaining = Math.max(0, normalizeMoney(fine.amount) - newWaivedAmount - paidSoFar);
      const nextStatus = newRemaining <= 0
        ? 'WAIVED'
        : (paidSoFar > 0 ? 'PARTIALLY_PAID' : 'UNPAID');

      const updatedFine = await tx.fines.update({
        where: { id: fine.id },
        data: {
          waived_amount: newWaivedAmount,
          waived_by_user_id: actorUserId,
          status: nextStatus,
          note: req.body?.note ? String(req.body.note).slice(0, 1000) : fine.note,
        },
      });

      if (waiveFuture) {
        await tx.overdue_fine_episodes.upsert({
          where: { loan_item_id: fine.loan_item_id },
          create: { loan_item_id: fine.loan_item_id, waived_future: true, waived_at: new Date(), waived_by_user_id: actorUserId, waiver_reason: waiverReason },
          update: { waived_future: true, waived_at: new Date(), waived_by_user_id: actorUserId, waiver_reason: waiverReason },
        });
      }

      const totalFineBalance = await recomputeCustomerFineBalance(tx, fine.customer_id);

      await createNotificationRecord(tx, {
        customer_id: fine.customer_id,
        channel: 'IN_APP',
        template_code: 'FINE_WAIVED',
        subject: 'Khoản phạt được điều chỉnh',
        body: `Khoản phạt ${fine.id} đã được giảm ${Number(waiveAmount).toLocaleString('vi-VN')}đ.${waiveFuture ? ' Đã miễn phạt quá hạn cho thời gian tiếp theo của cuốn sách này.' : ''}`,
        reference_type: 'FINE',
        reference_id: fine.id,
        metadata: {
          fine_id: fine.id,
          waived_amount_delta: waiveAmount,
          waived_amount_total: newWaivedAmount,
          remaining_balance: normalizeMoney(newRemaining),
          waived_by_user_id: actorUserId,
          waive_future: waiveFuture,
        },
        status: 'SENT',
      });

      await writeAuditLog(tx, {
        actor_user_id: actorUserId,
        action_name: 'WAIVE_FINE',
        entity_type: 'FINE',
        entity_id: fine.id,
        before_data: {
          status: fine.status,
          waived_amount: normalizeMoney(fine.waived_amount),
          remaining_balance: normalizeMoney(remaining),
        },
        after_data: {
          status: updatedFine.status,
          waived_amount: newWaivedAmount,
          remaining_balance: normalizeMoney(newRemaining),
          total_fine_balance: totalFineBalance,
          waive_future: waiveFuture,
        },
      });

      return {
        code: 200,
        payload: {
          message: nextStatus === 'WAIVED' ? 'Fine waived successfully' : 'Fine adjusted successfully',
          data: {
            fine_id: updatedFine.id,
            waived_amount: newWaivedAmount,
            remaining_balance: normalizeMoney(newRemaining),
            status: updatedFine.status,
            total_fine_balance: totalFineBalance,
          },
        },
      };
    });

    return res.status(result.code).json(result.payload);
  } catch (error) {
    console.error('waiveFine error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

module.exports = {
  listFines,
  getFineById,
  recordFinePayment,
  waiveFine,
};
