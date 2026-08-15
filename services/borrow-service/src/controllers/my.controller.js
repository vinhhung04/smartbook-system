const { prisma } = require('../lib/prisma');
const { ensureCurrentCustomer } = require('./customer.controller');
const { resolveActiveMembership } = require('../services/membership.service');
const { createReservation, cancelReservation } = require('./reservation.controller');
const { createNotificationRecord } = require('../lib/notifications');
const { writeAuditLog } = require('../lib/audit');
const { AccountError, getCustomerAccountSnapshot, creditAccount, listAccountLedger } = require('../services/account.service');
const { recomputeCustomerFineBalance } = require('../services/fine.service');

function parsePagination(query) {
  const page = Math.max(1, Number.parseInt(String(query.page || '1'), 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(String(query.pageSize || '20'), 10) || 20));
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

function parseUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || '').trim());
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function getMyReservations(req, res) {
  try {
    const customer = await ensureCurrentCustomer(req);
    if (!customer) {
      return res.status(404).json({ message: 'Customer profile not found' });
    }

    const pagination = parsePagination(req.query);
    const status = String(req.query?.status || '').trim();

    const where = {
      customer_id: customer.id,
      ...(status ? { status } : {}),
    };

    const [items, total] = await Promise.all([
      prisma.loan_reservations.findMany({
        where,
        orderBy: [{ reserved_at: 'desc' }],
        skip: pagination.skip,
        take: pagination.take,
      }),
      prisma.loan_reservations.count({ where }),
    ]);

    return res.json({
      data: items,
      meta: {
        page: pagination.page,
        pageSize: pagination.pageSize,
        total,
        totalPages: Math.ceil(total / pagination.pageSize) || 1,
      },
    });
  } catch (error) {
    console.error('getMyReservations error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

async function createMyReservation(req, res) {
  try {
    const customer = await ensureCurrentCustomer(req);
    if (!customer) {
      return res.status(404).json({ message: 'Customer profile not found' });
    }

    req.body = {
      ...req.body,
      customer_id: customer.id,
      source_channel: req.body?.source_channel || 'WEB',
    };

    return createReservation(req, res);
  } catch (error) {
    console.error('createMyReservation error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

async function cancelMyReservation(req, res) {
  try {
    const customer = await ensureCurrentCustomer(req);
    if (!customer) {
      return res.status(404).json({ message: 'Customer profile not found' });
    }

    const reservationId = String(req.params.id || '').trim();
    if (!parseUuid(reservationId)) {
      return res.status(400).json({ message: 'Invalid reservation id' });
    }

    const reservation = await prisma.loan_reservations.findUnique({ where: { id: reservationId } });
    if (!reservation || reservation.customer_id !== customer.id) {
      return res.status(404).json({ message: 'Reservation not found' });
    }

    return cancelReservation(req, res);
  } catch (error) {
    console.error('cancelMyReservation error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

async function getMyLoans(req, res) {
  try {
    const customer = await ensureCurrentCustomer(req);
    if (!customer) {
      return res.status(404).json({ message: 'Customer profile not found' });
    }

    const pagination = parsePagination(req.query);
    const status = String(req.query?.status || '').trim();

    const where = {
      customer_id: customer.id,
      ...(status ? { status } : {}),
    };

    const [items, total] = await Promise.all([
      prisma.loan_transactions.findMany({
        where,
        orderBy: [{ borrow_date: 'desc' }],
        skip: pagination.skip,
        take: pagination.take,
        include: { loan_items: true },
      }),
      prisma.loan_transactions.count({ where }),
    ]);

    return res.json({
      data: items,
      meta: {
        page: pagination.page,
        pageSize: pagination.pageSize,
        total,
        totalPages: Math.ceil(total / pagination.pageSize) || 1,
      },
    });
  } catch (error) {
    console.error('getMyLoans error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

async function getMyLoanById(req, res) {
  try {
    const customer = await ensureCurrentCustomer(req);
    if (!customer) {
      return res.status(404).json({ message: 'Customer profile not found' });
    }

    const loanId = String(req.params.id || '').trim();
    if (!parseUuid(loanId)) {
      return res.status(400).json({ message: 'Invalid loan id' });
    }

    const loan = await prisma.loan_transactions.findUnique({
      where: { id: loanId },
      include: { loan_items: true },
    });

    if (!loan || loan.customer_id !== customer.id) {
      return res.status(404).json({ message: 'Loan not found' });
    }

    return res.json({ data: loan });
  } catch (error) {
    console.error('getMyLoanById error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

async function requestMyLoanRenewal(req, res) {
  try {
    const customer = await ensureCurrentCustomer(req);
    if (!customer) {
      return res.status(404).json({ message: 'Customer profile not found' });
    }

    const loanId = String(req.params.id || '').trim();
    if (!parseUuid(loanId)) {
      return res.status(400).json({ message: 'Invalid loan id' });
    }

    const loan = await prisma.loan_transactions.findUnique({ where: { id: loanId } });
    if (!loan || loan.customer_id !== customer.id) {
      return res.status(404).json({ message: 'Loan not found' });
    }

    if (!['BORROWED', 'OVERDUE'].includes(loan.status)) {
      return res.status(409).json({ message: `Cannot request renewal from status ${loan.status}` });
    }

    const membershipInfo = await resolveActiveMembership(prisma, customer.id);
    if (!membershipInfo) {
      return res.status(409).json({ message: 'Customer does not have active membership' });
    }

    const existingRequests = await prisma.customer_notifications.count({
      where: {
        customer_id: customer.id,
        template_code: 'LOAN_RENEWAL_REQUEST',
        reference_id: loan.id,
      },
    });

    if (existingRequests >= membershipInfo.limits.max_renewal_count) {
      return res.status(409).json({
        message: 'Renewal request limit exceeded by membership plan',
        detail: {
          max_renewal_count: membershipInfo.limits.max_renewal_count,
          existing_request_count: existingRequests,
        },
      });
    }

    const extensionDays = Math.max(1, Math.floor(Number(membershipInfo.limits.max_loan_days || 14) / 2));

    await prisma.$transaction(async (tx) => {
      await createNotificationRecord(tx, {
        customer_id: customer.id,
        channel: 'IN_APP',
        template_code: 'LOAN_RENEWAL_REQUEST',
        subject: 'Renewal request submitted',
        body: `Renewal request for loan ${loan.loan_number} has been submitted.`,
        reference_type: 'LOAN_TRANSACTION',
        reference_id: loan.id,
        metadata: {
          requested_extension_days: extensionDays,
          max_renewal_count: membershipInfo.limits.max_renewal_count,
        },
      });

      await writeAuditLog(tx, {
        actor_user_id: req.user?.id || null,
        action_name: 'REQUEST_LOAN_RENEWAL',
        entity_type: 'LOAN_TRANSACTION',
        entity_id: loan.id,
        before_data: { status: loan.status, due_date: loan.due_date },
        after_data: { requested_extension_days: extensionDays },
      });
    });

    return res.status(201).json({
      message: 'Renewal request submitted',
      data: {
        loan_id: loan.id,
        loan_number: loan.loan_number,
        requested_extension_days: extensionDays,
        request_status: 'PENDING_REVIEW',
      },
    });
  } catch (error) {
    console.error('requestMyLoanRenewal error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

async function getMyFines(req, res) {
  try {
    const customer = await ensureCurrentCustomer(req);
    if (!customer) {
      return res.status(404).json({ message: 'Customer profile not found' });
    }

    const fines = await prisma.fines.findMany({
      where: { customer_id: customer.id },
      orderBy: [{ issued_at: 'desc' }],
      include: {
        fine_payments: {
          orderBy: [{ paid_at: 'desc' }],
        },
      },
    });

    const finePayments = fines.flatMap((fine) => fine.fine_payments);

    return res.json({
      data: {
        customer_id: customer.id,
        total_fine_balance: toNumber(customer.total_fine_balance),
        fines,
        fine_payments: finePayments,
      },
    });
  } catch (error) {
    console.error('getMyFines error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

async function getMyAccount(req, res) {
  try {
    const customer = await ensureCurrentCustomer(req);
    if (!customer) {
      return res.status(404).json({ message: 'Customer profile not found' });
    }

    const snapshot = await prisma.$transaction((tx) => getCustomerAccountSnapshot(tx, customer.id));

    return res.json({
      data: {
        customer_id: customer.id,
        account_id: snapshot.account.id,
        currency_code: snapshot.account.currency_code,
        status: snapshot.account.status,
        available_balance: snapshot.availableBalance,
        held_balance: snapshot.heldBalance,
        min_wallet_balance_required: snapshot.minWalletBalanceRequired,
        auto_debit_borrow_fee: snapshot.settings.auto_debit_borrow_fee,
        auto_debit_fines: snapshot.settings.auto_debit_fines,
      },
    });
  } catch (error) {
    console.error('getMyAccount error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

async function payMyFine(req, res) {
  try {
    const customer = await ensureCurrentCustomer(req);
    if (!customer) {
      return res.status(404).json({ message: 'Customer profile not found' });
    }

    const fineId = String(req.body?.fine_id || '').trim();
    if (!parseUuid(fineId)) {
      return res.status(400).json({ message: 'fine_id must be a valid uuid' });
    }

    const paymentMethod = String(req.body?.payment_method || 'EWALLET').trim().toUpperCase();
    const allowedMethods = new Set(['CASH', 'CARD', 'TRANSFER', 'EWALLET']);
    if (!allowedMethods.has(paymentMethod)) {
      return res.status(400).json({ message: 'payment_method must be one of CASH, CARD, TRANSFER, EWALLET' });
    }

    const result = await prisma.$transaction(async (tx) => {
      const fine = await tx.fines.findUnique({
        where: { id: fineId },
        include: { fine_payments: true },
      });

      if (!fine || fine.customer_id !== customer.id) {
        return { code: 404, payload: { message: 'Fine not found' } };
      }

      if (fine.status === 'PAID' || fine.status === 'WAIVED') {
        return { code: 409, payload: { message: `Cannot pay fine with status ${fine.status}` } };
      }

      const paidSoFar = fine.fine_payments.reduce((sum, item) => sum + toNumber(item.amount), 0);
      const remaining = Math.max(0, toNumber(fine.amount) - toNumber(fine.waived_amount) - paidSoFar);
      if (remaining <= 0) {
        return { code: 409, payload: { message: 'Fine is already fully settled' } };
      }

      const requestedAmount = req.body?.amount == null ? remaining : Number(req.body.amount);
      if (!Number.isFinite(requestedAmount) || requestedAmount <= 0) {
        return { code: 400, payload: { message: 'amount must be a positive number' } };
      }

      const amount = Number(requestedAmount.toFixed(2));
      if (amount - remaining > 0.0001) {
        return {
          code: 409,
          payload: {
            message: 'amount exceeds remaining fine balance',
            detail: { remaining },
          },
        };
      }

      const payment = await tx.fine_payments.create({
        data: {
          fine_id: fine.id,
          payment_method: paymentMethod,
          amount,
          transaction_reference: req.body?.transaction_reference ? String(req.body.transaction_reference).slice(0, 255) : null,
          paid_by_user_id: req.user?.id || null,
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

      await recomputeCustomerFineBalance(tx, customer.id);

      await createNotificationRecord(tx, {
        customer_id: customer.id,
        channel: 'IN_APP',
        template_code: 'FINE_PAYMENT_RECORDED',
        subject: 'Fine payment recorded',
        body: `Payment ${amount.toFixed(2)} has been applied to fine ${fine.id}.`,
        reference_type: 'FINE',
        reference_id: fine.id,
        metadata: {
          fine_id: fine.id,
          payment_id: payment.id,
          amount,
          remaining_balance: Number(stillRemaining.toFixed(2)),
          payment_method: paymentMethod,
        },
      });

      await writeAuditLog(tx, {
        actor_user_id: req.user?.id || null,
        action_name: 'PAY_FINE',
        entity_type: 'FINE',
        entity_id: fine.id,
        before_data: {
          status: fine.status,
          remaining_balance: Number(remaining.toFixed(2)),
        },
        after_data: {
          status: updatedFine.status,
          remaining_balance: Number(stillRemaining.toFixed(2)),
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
            remaining_balance: Number(stillRemaining.toFixed(2)),
            status: updatedFine.status,
          },
        },
      };
    });

    return res.status(result.code).json(result.payload);
  } catch (error) {
    console.error('payMyFine error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

async function getMyMomoPaymentStatus(req, res) {
  try {
    const customer = await ensureCurrentCustomer(req);
    if (!customer) {
      return res.status(404).json({ message: 'Customer profile not found' });
    }

    const orderId = String(req.params.orderId || '').trim();
    if (!orderId || orderId.length > 255) {
      return res.status(400).json({ message: 'orderId is required and must not exceed 255 characters' });
    }

    const payment = await prisma.fine_payments.findFirst({
      where: {
        transaction_reference: orderId,
        payment_method: 'EWALLET',
        fines: { customer_id: customer.id },
      },
      orderBy: { paid_at: 'desc' },
    });

    if (!payment) {
      return res.json({
        data: {
          status: 'PENDING',
          message: 'Payment has not been recorded yet',
        },
      });
    }

    return res.json({
      data: {
        status: 'PAID',
        amount: toNumber(payment.amount),
        message: 'Payment recorded',
      },
    });
  } catch (error) {
    console.error('getMyMomoPaymentStatus error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

async function topupMyAccount(req, res) {
  try {
    const customer = await ensureCurrentCustomer(req);
    if (!customer) {
      return res.status(404).json({ message: 'Customer profile not found' });
    }

    const amount = Number(req.body?.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ message: 'amount must be a positive number' });
    }

    const idempotencyKey = String(req.headers['idempotency-key'] || req.headers['x-idempotency-key'] || '').trim();
    if (!idempotencyKey) {
      return res.status(400).json({ message: 'Idempotency-Key header is required for topup' });
    }

    const result = await prisma.$transaction((tx) => creditAccount(tx, {
      customerId: customer.id,
      actorUserId: req.user?.id || null,
      amount,
      idempotencyKey: `my-topup:${idempotencyKey}`,
      referenceType: 'CUSTOMER_TOPUP',
      note: req.body?.note ? String(req.body.note).slice(0, 1000) : 'Customer self top-up',
      metadata: {
        source: 'MY_ACCOUNT_TOPUP',
      },
    }));

    return res.status(result.idempotent ? 200 : 201).json({
      message: result.idempotent ? 'Top-up already processed' : 'Top-up processed successfully',
      data: {
        ledger_entry_id: result.entry.id,
        credited_amount: result.creditedAmount,
        available_balance: result.newBalance,
      },
    });
  } catch (error) {
    if (error instanceof AccountError) {
      return res.status(409).json({ message: error.message, detail: error.detail || undefined });
    }
    console.error('topupMyAccount error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

async function getMyAccountLedger(req, res) {
  try {
    const customer = await ensureCurrentCustomer(req);
    if (!customer) {
      return res.status(404).json({ message: 'Customer profile not found' });
    }

    const ledger = await prisma.$transaction((tx) => listAccountLedger(tx, customer.id, req.query || {}));
    return res.json(ledger);
  } catch (error) {
    console.error('getMyAccountLedger error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

async function getMyNotifications(req, res) {
  try {
    const customer = await ensureCurrentCustomer(req);
    if (!customer) {
      return res.status(404).json({ message: 'Customer profile not found' });
    }

    const pagination = parsePagination(req.query);
    const [items, total] = await Promise.all([
      prisma.customer_notifications.findMany({
        where: { customer_id: customer.id },
        orderBy: [{ scheduled_at: 'desc' }],
        skip: pagination.skip,
        take: pagination.take,
      }),
      prisma.customer_notifications.count({ where: { customer_id: customer.id } }),
    ]);

    return res.json({
      data: items,
      meta: {
        page: pagination.page,
        pageSize: pagination.pageSize,
        total,
        totalPages: Math.ceil(total / pagination.pageSize) || 1,
      },
    });
  } catch (error) {
    console.error('getMyNotifications error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

module.exports = {
  getMyReservations,
  createMyReservation,
  cancelMyReservation,
  getMyLoans,
  getMyLoanById,
  requestMyLoanRenewal,
  getMyAccount,
  topupMyAccount,
  getMyAccountLedger,
  getMyFines,
  payMyFine,
  getMyMomoPaymentStatus,
  getMyNotifications,
};
