const { prisma } = require('../lib/prisma');
const { createNotificationRecord } = require('../lib/notifications');
const { writeAuditLog } = require('../lib/audit');
const { normalizeMoney, recomputeCustomerFineBalance } = require('../services/fine.service');

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

async function listFines(req, res) {
  const pagination = parsePagination(req.query);
  const status = String(req.query?.status || '').trim().toUpperCase();
  const customerId = String(req.query?.customer_id || '').trim();
  const fineType = String(req.query?.fine_type || '').trim().toUpperCase();

  const where = {
    ...(status ? { status } : {}),
    ...(customerId ? { customer_id: customerId } : {}),
    ...(fineType ? { fine_type: fineType } : {}),
  };

  try {
    const [items, total] = await Promise.all([
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
            },
          },
          fine_payments: {
            orderBy: [{ paid_at: 'desc' }],
          },
        },
      }),
      prisma.fines.count({ where }),
    ]);

    return res.json({
      data: items.map(summarizeFine),
      meta: {
        page: pagination.page,
        pageSize: pagination.pageSize,
        total,
        totalPages: Math.ceil(total / pagination.pageSize) || 1,
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
    return res.status(400).json({ message: 'Invalid fine id' });
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
        loan_items: true,
        fine_payments: {
          orderBy: [{ paid_at: 'desc' }],
        },
      },
    });

    if (!fine) {
      return res.status(404).json({ message: 'Fine not found' });
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
    return res.status(400).json({ message: 'Invalid fine id' });
  }

  const paymentMethod = String(req.body?.payment_method || 'CASH').trim().toUpperCase();
  const allowedMethods = new Set(['CASH', 'CARD', 'TRANSFER', 'EWALLET']);
  if (!allowedMethods.has(paymentMethod)) {
    return res.status(400).json({ message: 'payment_method must be one of CASH, CARD, TRANSFER, EWALLET' });
  }

  const requestedAmount = Number(req.body?.amount);
  if (!Number.isFinite(requestedAmount) || requestedAmount <= 0) {
    return res.status(400).json({ message: 'amount must be a positive number' });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const fine = await tx.fines.findUnique({
        where: { id: fineId },
        include: { fine_payments: true },
      });

      if (!fine) {
        return { code: 404, payload: { message: 'Fine not found' } };
      }

      if (fine.status === 'PAID' || fine.status === 'WAIVED') {
        return { code: 409, payload: { message: `Cannot pay fine with status ${fine.status}` } };
      }

      const paidSoFar = fine.fine_payments.reduce((sum, item) => sum + normalizeMoney(item.amount), 0);
      const remaining = Math.max(0, normalizeMoney(fine.amount) - normalizeMoney(fine.waived_amount) - paidSoFar);
      const amount = normalizeMoney(requestedAmount);

      if (amount > remaining + 0.0001) {
        return {
          code: 409,
          payload: {
            message: 'amount exceeds remaining fine balance',
            detail: { remaining_balance: normalizeMoney(remaining) },
          },
        };
      }

      const payment = await tx.fine_payments.create({
        data: {
          fine_id: fine.id,
          payment_method: paymentMethod,
          amount,
          transaction_reference: req.body?.transaction_reference ? String(req.body.transaction_reference).slice(0, 255) : null,
          paid_by_user_id: actorUserId,
          note: req.body?.note ? String(req.body.note).slice(0, 1000) : null,
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

      return {
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
    return res.status(400).json({ message: 'Invalid fine id' });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const fine = await tx.fines.findUnique({
        where: { id: fineId },
        include: { fine_payments: true },
      });

      if (!fine) {
        return { code: 404, payload: { message: 'Fine not found' } };
      }

      if (fine.status === 'PAID') {
        return { code: 409, payload: { message: 'Cannot waive a fully paid fine' } };
      }

      const paidSoFar = fine.fine_payments.reduce((sum, item) => sum + normalizeMoney(item.amount), 0);
      const remaining = Math.max(0, normalizeMoney(fine.amount) - normalizeMoney(fine.waived_amount) - paidSoFar);
      if (remaining <= 0) {
        return { code: 409, payload: { message: 'Fine is already fully settled' } };
      }

      const requestedWaive = req.body?.amount == null ? remaining : Number(req.body.amount);
      if (!Number.isFinite(requestedWaive) || requestedWaive <= 0) {
        return { code: 400, payload: { message: 'amount must be a positive number' } };
      }

      const waiveAmount = normalizeMoney(requestedWaive);
      if (waiveAmount > remaining + 0.0001) {
        return {
          code: 409,
          payload: {
            message: 'amount exceeds remaining fine balance',
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

      const totalFineBalance = await recomputeCustomerFineBalance(tx, fine.customer_id);

      await createNotificationRecord(tx, {
        customer_id: fine.customer_id,
        channel: 'IN_APP',
        template_code: 'FINE_WAIVED',
        subject: 'Khoản phạt được điều chỉnh',
        body: `Khoản phạt ${fine.id} đã được giảm ${Number(waiveAmount).toLocaleString('vi-VN')}đ.`,
        reference_type: 'FINE',
        reference_id: fine.id,
        metadata: {
          fine_id: fine.id,
          waived_amount_delta: waiveAmount,
          waived_amount_total: newWaivedAmount,
          remaining_balance: normalizeMoney(newRemaining),
          waived_by_user_id: actorUserId,
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
