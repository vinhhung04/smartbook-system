const crypto = require('crypto');
const { deterministicUuid } = require('@smartbook/shared/runtime');
const { prisma } = require('../lib/prisma');
const { writeAuditLog } = require('../lib/audit');
const { createNotificationRecord } = require('../lib/notifications');
const { resolveActiveMembership } = require('../services/membership.service');
const {
  checkAvailability,
  reserveStock,
  consumeReservation,
  returnBorrowedStock,
} = require('../services/inventory-integration.service');
const { AccountError, debitBorrowFee, getCustomerAccountSnapshot, toMoney } = require('../services/account.service');
const { queueReconciliation } = require('../services/reconciliation.service');
const { applyReturnFines, recomputeCustomerFineBalance, runOverdueSweep } = require('../services/fine.service');
const {
  getDepositPerItem,
  settlementNeedsReason,
  holdLoanItemDeposits,
  settleLoanItemDeposits,
  previewReturnSettlement,
} = require('../services/deposit.service');
const { normalizePickupCode } = require('../utils/pickup-code');
const { parseStatusFilter, searchTerm, countByStatus } = require('../lib/list-query');

const CONVERTIBLE_RESERVATION_STATUSES = ['CONFIRMED', 'READY_FOR_PICKUP'];
const ACTIVE_LOAN_STATUSES = ['BORROWED', 'OVERDUE', 'RESERVED'];

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ''));
}

function parseId(value) {
  const id = String(value || '').trim();
  return id || null;
}

function parseIdempotencyKey(req) {
  const header = req.headers['idempotency-key'] || req.headers['x-idempotency-key'];
  const value = String(header || '').trim();
  return value || null;
}

function parsePickupCodeFromBody(body) {
  return normalizePickupCode(body?.pickup_code || body?.pickupCode || body?.code || body?.qr_code);
}

function parsePagination(query) {
  const page = Math.max(1, Number.parseInt(String(query.page || '1'), 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(String(query.pageSize || '20'), 10) || 20));
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

function createLoanNumber() {
  const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
  const epoch = Date.now().toString().slice(-6);
  return `LOAN-${epoch}-${suffix}`;
}

function getBorrowFeePerItem() {
  const configured = Number(process.env.BORROW_FEE_PER_ITEM || 0);
  if (!Number.isFinite(configured) || configured < 0) {
    return 0;
  }
  return Number(configured.toFixed(2));
}

/**
 * Checked before any stock is touched: can the wallet cover the borrow fee and
 * every book's deposit? Returns the 409 body when it cannot, else null. The hold
 * itself re-checks under the account row lock inside the loan transaction.
 */
async function checkDepositFunds(customerId, quantity, membershipLimits, borrowFeeAmount) {
  const depositPerItem = getDepositPerItem(membershipLimits);
  if (depositPerItem.lte(0)) return null;

  const depositTotal = depositPerItem.mul(quantity);
  const snapshot = await prisma.$transaction((tx) => getCustomerAccountSnapshot(tx, customerId));
  const spendable = toMoney(snapshot.account.available_balance).sub(toMoney(borrowFeeAmount || 0));
  if (spendable.gte(depositTotal)) return null;

  return {
    message: 'Insufficient wallet balance for book deposit',
    code: 'INSUFFICIENT_DEPOSIT_FUNDS',
    detail: {
      available_balance: toMoney(snapshot.account.available_balance).toNumber(),
      borrow_fee_amount: Number(borrowFeeAmount || 0),
      deposit_per_item: depositPerItem.toNumber(),
      deposit_total: depositTotal.toNumber(),
      shortfall: depositTotal.sub(spendable).toNumber(),
    },
  };
}

function summarizeDeposits(deposits) {
  const total = deposits.reduce((sum, row) => sum.add(toMoney(row.amount)), toMoney(0));
  return { deposit_count: deposits.length, deposit_total: total.toNumber() };
}

async function listLoans(req, res) {
  const { customer_id } = req.query;
  const pagination = parsePagination(req.query);
  const q = searchTerm(req.query);
  const status = parseStatusFilter(req.query.status);

  // Everything except the status condition; per-status counts are taken over this.
  const whereWithoutStatus = {
    ...(typeof customer_id === 'string' && customer_id ? { customer_id } : {}),
    ...(q
      ? {
        OR: [
          { loan_number: { contains: q, mode: 'insensitive' } },
          { customers: { full_name: { contains: q, mode: 'insensitive' } } },
          { customers: { customer_code: { contains: q, mode: 'insensitive' } } },
          // customer_id is a UUID column: comparing it with a name made Postgres throw (500).
          ...(isUuid(q) ? [{ customer_id: q }] : []),
        ],
      }
      : {}),
  };
  const where = status ? { ...whereWithoutStatus, status } : whereWithoutStatus;
  const orderBy = req.query.sort === 'due_date' ? [{ due_date: 'asc' }] : [{ borrow_date: 'desc' }];

  try {
    const [items, total, statusCounts] = await Promise.all([
      prisma.loan_transactions.findMany({
        where,
        orderBy,
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
          loan_items: true,
        },
      }),
      prisma.loan_transactions.count({ where }),
      countByStatus(prisma.loan_transactions, whereWithoutStatus),
    ]);

    return res.json({
      data: items,
      meta: {
        page: pagination.page,
        pageSize: pagination.pageSize,
        total,
        totalPages: Math.ceil(total / pagination.pageSize) || 1,
        status_counts: statusCounts,
      },
    });
  } catch (error) {
    console.error('Error while listing loans:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

async function createDirectLoan(req, res) {
  const {
    customer_id,
    variant_id,
    warehouse_id,
    pickup_location_id,
    quantity,
    source_channel,
    notes,
  } = req.body || {};
  const actorUserId = req.user?.id || null;
  const authHeader = req.headers.authorization;
  const idempotencyKey = parseIdempotencyKey(req);

  if (!customer_id || !variant_id || !warehouse_id) {
    return res.status(400).json({ message: 'Cần có đủ customer_id, variant_id và warehouse_id' });
  }

  if (!idempotencyKey) {
    return res.status(400).json({ message: 'Cần header Idempotency-Key khi tạo phiếu mượn trực tiếp' });
  }

  if (![customer_id, variant_id, warehouse_id].every(isUuid)) {
    return res.status(400).json({ message: 'customer_id, variant_id và warehouse_id phải là UUID hợp lệ' });
  }

  if (pickup_location_id && !isUuid(pickup_location_id)) {
    return res.status(400).json({ message: 'pickup_location_id phải là UUID hợp lệ (nếu có)' });
  }

  const normalizedQuantity = Number.parseInt(String(quantity || '1'), 10);
  if (!Number.isInteger(normalizedQuantity) || normalizedQuantity <= 0) {
    return res.status(400).json({ message: 'quantity phải là số nguyên dương' });
  }

  const normalizedSource = String(source_channel || 'COUNTER').trim().toUpperCase();
  if (!['WEB', 'MOBILE', 'COUNTER', 'ADMIN'].includes(normalizedSource)) {
    return res.status(400).json({ message: 'source_channel không hợp lệ' });
  }

  const reservationId = deterministicUuid(`direct-loan:reservation:${idempotencyKey}`);
  const loanId = deterministicUuid(`direct-loan:loan:${idempotencyKey}`);

  try {
    const existingLoan = await prisma.loan_transactions.findUnique({ where: { id: loanId } });
    if (existingLoan) {
      return res.json({ data: existingLoan, idempotent: true });
    }

    const customer = await prisma.customers.findUnique({ where: { id: customer_id } });
    if (!customer || customer.status !== 'ACTIVE') {
      return res.status(409).json({ message: 'Bạn đọc không đủ điều kiện mượn trực tiếp' });
    }

    if (Number(customer.total_fine_balance) > 0) {
      return res.status(409).json({
        message: 'Khách còn tiền phạt chưa thanh toán',
        detail: { total_fine_balance: Number(customer.total_fine_balance) },
      });
    }

    const membershipInfo = await resolveActiveMembership(prisma, customer_id);
    if (!membershipInfo) {
      return res.status(409).json({ message: 'Bạn đọc chưa có thẻ thành viên còn hiệu lực' });
    }

    const activeLoanCount = await prisma.loan_transactions.count({
      where: {
        customer_id,
        status: { in: ACTIVE_LOAN_STATUSES },
      },
    });

    if (activeLoanCount + normalizedQuantity > membershipInfo.limits.max_active_loans) {
      return res.status(409).json({
        message: 'Bạn đọc đã đạt số sách mượn tối đa theo gói thành viên',
        detail: {
          max_active_loans: membershipInfo.limits.max_active_loans,
          active_loan_count: activeLoanCount,
        },
      });
    }

    await checkAvailability({
      variant_id,
      warehouse_id,
      quantity: normalizedQuantity,
      authHeader,
      requestId: req.requestId,
    });

    const reservationNumber = `DLR-${reservationId.slice(0, 8).toUpperCase()}`;
    const loanNumber = createLoanNumber();
    const borrowDate = new Date();
    const dueDate = new Date(borrowDate.getTime() + membershipInfo.limits.max_loan_days * 24 * 60 * 60 * 1000);
    const borrowFeeAmount = Number((normalizedQuantity * getBorrowFeePerItem()).toFixed(2));

    if (borrowFeeAmount > 0) {
      const accountSnapshot = await prisma.$transaction((tx) => getCustomerAccountSnapshot(tx, customer_id));
      const projectedBalance = Number((accountSnapshot.availableBalance - borrowFeeAmount).toFixed(2));

      if (accountSnapshot.settings.auto_debit_borrow_fee !== true) {
        return res.status(409).json({
          message: 'Chưa bật tự động trừ phí mượn từ ví',
          detail: { borrow_fee_amount: borrowFeeAmount },
        });
      }

      if (projectedBalance < accountSnapshot.minWalletBalanceRequired) {
        return res.status(409).json({
          message: 'Số dư ví không đủ để tự động trừ phí',
          detail: {
            available_balance: accountSnapshot.availableBalance,
            required_amount: borrowFeeAmount,
            min_wallet_balance_required: accountSnapshot.minWalletBalanceRequired,
          },
        });
      }
    }

    const depositShortfall = await checkDepositFunds(customer_id, normalizedQuantity, membershipInfo.limits, borrowFeeAmount);
    if (depositShortfall) {
      return res.status(409).json(depositShortfall);
    }

    await reserveStock({
      reservation_id: reservationId,
      reservation_number: reservationNumber,
      customer_id,
      variant_id,
      warehouse_id,
      quantity: normalizedQuantity,
      expires_at: dueDate.toISOString(),
      created_by_user_id: actorUserId,
      idempotency_key: `direct-reserve:${idempotencyKey}`,
      authHeader,
      requestId: req.requestId,
    });

    await consumeReservation({
      reservation_id: reservationId,
      loan_id: loanId,
      loan_number: loanNumber,
      warehouse_id,
      idempotency_key: `direct-consume:${idempotencyKey}`,
      handled_by_user_id: actorUserId,
      authHeader,
      requestId: req.requestId,
    });

    try {
      const created = await prisma.$transaction(async (tx) => {
        // Re-check the membership limit atomically, serialized per customer: the count at line
        // ~190 ran outside any lock, so two concurrent requests could both pass it and both
        // reach here. If this trips, it falls through to the same catch below that already
        // handles "inventory consumed but DB transaction failed" by queuing reconciliation.
        // $executeRaw (not $queryRaw): pg_advisory_xact_lock returns void, which Prisma's
        // $queryRaw cannot deserialize (P2010 "Failed to deserialize column of type 'void'").
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`membership-limit:${customer_id}`}, 0))`;
        const recheckLoanCount = await tx.loan_transactions.count({
          where: { customer_id, status: { in: ACTIVE_LOAN_STATUSES } },
        });
        if (recheckLoanCount + normalizedQuantity > membershipInfo.limits.max_active_loans) {
          throw new Error('MEMBERSHIP_LIMIT_EXCEEDED_ON_RECHECK');
        }

        let debitResult = null;
        if (borrowFeeAmount > 0) {
          debitResult = await debitBorrowFee(tx, {
            customerId: customer_id,
            actorUserId,
            amount: borrowFeeAmount,
            idempotencyKey: `direct-loan:${idempotencyKey}`,
            referenceType: 'LOAN_TRANSACTION',
            referenceId: loanId,
            note: `Auto debit borrow fee for direct loan ${loanNumber}`,
            metadata: {
              loan_id: loanId,
              loan_number: loanNumber,
            },
          });
        }

        await tx.loan_reservations.create({
          data: {
            id: reservationId,
            reservation_number: reservationNumber,
            customer_id,
            variant_id,
            warehouse_id,
            pickup_location_id: pickup_location_id || null,
            quantity: normalizedQuantity,
            source_channel: normalizedSource,
            status: 'CONVERTED_TO_LOAN',
            reserved_at: borrowDate,
            expires_at: dueDate,
            notes: notes || 'Auto-generated by direct loan flow',
            created_by_user_id: actorUserId,
          },
        });

        const loan = await tx.loan_transactions.create({
          data: {
            id: loanId,
            loan_number: loanNumber,
            customer_id,
            warehouse_id,
            handled_by_user_id: actorUserId || null,
            source_reservation_id: reservationId,
            borrow_date: borrowDate,
            due_date: dueDate,
            status: 'BORROWED',
            total_items: normalizedQuantity,
            notes: notes || null,
          },
        });

        const loanItems = Array.from({ length: normalizedQuantity }).map((_, index) => ({
          id: crypto.randomUUID(),
          loan_id: loan.id,
          variant_id,
          inventory_unit_id: null,
          item_barcode: `${loan.loan_number}-ITEM-${index + 1}`,
          due_date: dueDate,
          status: 'BORROWED',
          item_condition_on_checkout: 'GOOD',
        }));

        await tx.loan_items.createMany({ data: loanItems });

        const deposits = await holdLoanItemDeposits(tx, {
          customerId: customer_id,
          loanId: loan.id,
          loanNumber: loan.loan_number,
          items: loanItems,
          amountPerItem: getDepositPerItem(membershipInfo.limits),
          actorUserId,
        });
        const depositSummary = summarizeDeposits(deposits);

        await writeAuditLog(tx, {
          actor_user_id: actorUserId,
          action_name: 'CREATE_DIRECT_LOAN',
          entity_type: 'LOAN_TRANSACTION',
          entity_id: loan.id,
          after_data: {
            source_channel: normalizedSource,
            quantity: normalizedQuantity,
            borrow_fee_amount: borrowFeeAmount,
            ...depositSummary,
            idempotency_key: idempotencyKey,
          },
        });

        await createNotificationRecord(tx, {
          customer_id,
          channel: 'IN_APP',
          template_code: 'LOAN_CREATED',
          subject: 'Đã tạo phiếu mượn',
          body: depositSummary.deposit_total > 0
            ? `Phiếu mượn ${loan.loan_number} đã được tạo. Tiền cọc ${depositSummary.deposit_total.toLocaleString('vi-VN')}đ đang được giữ trong ví.`
            : `Phiếu mượn ${loan.loan_number} đã được tạo.`,
          reference_type: 'LOAN_TRANSACTION',
          reference_id: loan.id,
        });

        return {
          ...loan,
          borrow_fee_amount: borrowFeeAmount,
          borrow_fee_ledger_entry_id: debitResult?.entry?.id || null,
          borrow_fee_remaining_wallet_balance: debitResult?.remainingBalance ?? null,
          ...depositSummary,
        };
      });

      return res.status(201).json({ data: created });
    } catch (error) {
      if (error instanceof AccountError) {
        return res.status(409).json({ message: error.message, detail: error.detail || undefined });
      }
      // Inventory already moved reserved_qty -> borrowed_qty for this stock.
      // Not auto-reversed here: the correct undo (returnBorrowedStock) needs
      // loan_item/inventory_unit ids that only exist once loan_items rows are
      // created — which is exactly the step that just failed. Queuing instead
      // of guessing keeps a human in the loop for the one case this repo
      // can't safely self-heal, rather than risking a wrong stock adjustment.
      console.error('Direct loan DB transaction failed after inventory consume:', error);
      await queueReconciliation({
        aggregateId: loanId,
        eventType: 'DIRECT_LOAN_CONSUME_UNRESOLVED',
        payload: { loan_id: loanId, reservation_id: reservationId, customer_id, variant_id, warehouse_id, quantity: normalizedQuantity },
      });
      return res.status(502).json({
        message: 'Direct loan creation failed after inventory consume. Queued for manual reconciliation.',
      });
    }
  } catch (error) {
    if (error?.status === 409) {
      return res.status(409).json({ message: error.message });
    }
    console.error('Error while creating direct loan:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

async function listRenewalRequests(req, res) {
  const pagination = parsePagination(req.query);
  const status = String(req.query?.status || 'PENDING').trim().toUpperCase();

  try {
    const where = {
      template_code: 'LOAN_RENEWAL_REQUEST',
      ...(status === 'PENDING' ? { status: 'PENDING' } : {}),
    };

    const [items, total] = await Promise.all([
      prisma.customer_notifications.findMany({
        where,
        orderBy: [{ scheduled_at: 'desc' }],
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
        },
      }),
      prisma.customer_notifications.count({ where }),
    ]);

    const loanIds = items
      .map((item) => item.reference_id)
      .filter((value) => isUuid(value));

    const loans = loanIds.length > 0
      ? await prisma.loan_transactions.findMany({
        where: { id: { in: loanIds } },
        include: { loan_items: true },
      })
      : [];

    const loanMap = new Map(loans.map((loan) => [loan.id, loan]));

    const mapped = items.map((item) => ({
      request_id: item.id,
      status: item.status,
      requested_at: item.scheduled_at,
      reviewed_at: item.sent_at,
      review_decision: item.metadata?.review_decision || null,
      loan: loanMap.get(item.reference_id) || null,
      customer: item.customers,
      requested_extension_days: Number(item.metadata?.requested_extension_days || 0) || null,
      metadata: item.metadata || {},
    }));

    const filtered = status === 'REVIEWED'
      ? mapped.filter((item) => Boolean(item.review_decision))
      : mapped;

    return res.json({
      data: filtered,
      meta: {
        page: pagination.page,
        pageSize: pagination.pageSize,
        total: status === 'REVIEWED' ? filtered.length : total,
        totalPages: Math.ceil((status === 'REVIEWED' ? filtered.length : total) / pagination.pageSize) || 1,
      },
    });
  } catch (error) {
    console.error('Error while listing renewal requests:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

async function reviewLoanRenewal(req, res) {
  const loanId = parseId(req.params.id);
  const actorUserId = req.user?.id || null;
  const decision = String(req.body?.decision || '').trim().toUpperCase();
  const reason = String(req.body?.reason || '').trim() || null;

  if (!loanId || !isUuid(loanId)) {
    return res.status(400).json({ message: 'Mã phiếu mượn không hợp lệ' });
  }

  if (!['APPROVE', 'REJECT'].includes(decision)) {
    return res.status(400).json({ message: 'decision phải là APPROVE hoặc REJECT' });
  }

  try {
    const loan = await prisma.loan_transactions.findUnique({
      where: { id: loanId },
      include: { loan_items: true },
    });

    if (!loan) {
      return res.status(404).json({ message: 'Không tìm thấy phiếu mượn' });
    }

    const pendingRequest = await prisma.customer_notifications.findFirst({
      where: {
        template_code: 'LOAN_RENEWAL_REQUEST',
        reference_id: loanId,
        status: 'PENDING',
      },
      orderBy: [{ scheduled_at: 'desc' }],
    });

    if (!pendingRequest) {
      return res.status(409).json({ message: 'Phiếu mượn này không có yêu cầu gia hạn đang chờ duyệt' });
    }

    if (decision === 'APPROVE' && !['BORROWED', 'OVERDUE'].includes(loan.status)) {
      return res.status(409).json({ message: `Không thể duyệt gia hạn cho phiếu mượn ở trạng thái ${loan.status}` });
    }

    const membershipInfo = await resolveActiveMembership(prisma, loan.customer_id);
    if (!membershipInfo) {
      return res.status(409).json({ message: 'Bạn đọc chưa có thẻ thành viên còn hiệu lực' });
    }

    const requestedDays = Number(req.body?.extension_days || pendingRequest.metadata?.requested_extension_days || 0);
    const extensionDays = Number.isFinite(requestedDays) && requestedDays > 0
      ? Math.floor(requestedDays)
      : Math.max(1, Math.floor(Number(membershipInfo.limits.max_loan_days || 14) / 2));

    const renewableItems = loan.loan_items.filter((item) => item.status === 'BORROWED' || item.status === 'OVERDUE');
    if (decision === 'APPROVE' && renewableItems.length === 0) {
      return res.status(409).json({ message: 'Không có sách đang mượn để gia hạn' });
    }

    const result = await prisma.$transaction(async (tx) => {
      let newDueDate = loan.due_date;
      const renewalRows = [];

      if (decision === 'APPROVE') {
        const renewalCountMap = new Map();
        for (const item of renewableItems) {
          const existingCount = await tx.loan_renewals.count({ where: { loan_item_id: item.id } });
          if (existingCount >= membershipInfo.limits.max_renewal_count) {
            return {
              code: 409,
              payload: {
                message: 'Có sách đã vượt số lần gia hạn cho phép',
                detail: {
                  loan_item_id: item.id,
                  max_renewal_count: membershipInfo.limits.max_renewal_count,
                  existing_count: existingCount,
                },
              },
            };
          }
          renewalCountMap.set(item.id, existingCount + 1);
        }

        for (const item of renewableItems) {
          const oldDueDate = new Date(item.due_date);
          const updatedDueDate = new Date(oldDueDate.getTime() + extensionDays * 24 * 60 * 60 * 1000);
          if (updatedDueDate.getTime() > new Date(newDueDate).getTime()) {
            newDueDate = updatedDueDate;
          }

          await tx.loan_items.update({
            where: { id: item.id },
            data: { due_date: updatedDueDate },
          });

          const renewal = await tx.loan_renewals.create({
            data: {
              loan_item_id: item.id,
              renewed_by_user_id: actorUserId,
              old_due_date: oldDueDate,
              new_due_date: updatedDueDate,
              renewal_count: renewalCountMap.get(item.id),
              reason,
            },
          });
          renewalRows.push(renewal);
        }

        await tx.loan_transactions.update({
          where: { id: loan.id },
          data: { due_date: newDueDate },
        });
      }

      await tx.customer_notifications.update({
        where: { id: pendingRequest.id },
        data: {
          status: 'SENT',
          sent_at: new Date(),
          metadata: {
            ...(pendingRequest.metadata || {}),
            review_decision: decision,
            reviewed_by_user_id: actorUserId,
            reviewed_reason: reason,
            approved_extension_days: decision === 'APPROVE' ? extensionDays : null,
          },
        },
      });

      await createNotificationRecord(tx, {
        customer_id: loan.customer_id,
        channel: 'IN_APP',
        template_code: 'LOAN_RENEWAL_REVIEWED',
        subject: decision === 'APPROVE' ? 'Gia hạn được duyệt' : 'Gia hạn bị từ chối',
        body: decision === 'APPROVE'
          ? `Yêu cầu gia hạn phiếu mượn ${loan.loan_number} đã được duyệt thêm ${extensionDays} ngày.`
          : `Yêu cầu gia hạn phiếu mượn ${loan.loan_number} đã bị từ chối.`,
        reference_type: 'LOAN_TRANSACTION',
        reference_id: loan.id,
        metadata: {
          decision,
          extension_days: decision === 'APPROVE' ? extensionDays : null,
          reason,
        },
        status: 'SENT',
      });

      await writeAuditLog(tx, {
        actor_user_id: actorUserId,
        action_name: decision === 'APPROVE' ? 'APPROVE_LOAN_RENEWAL' : 'REJECT_LOAN_RENEWAL',
        entity_type: 'LOAN_TRANSACTION',
        entity_id: loan.id,
        before_data: {
          due_date: loan.due_date,
          request_id: pendingRequest.id,
        },
        after_data: {
          decision,
          extension_days: decision === 'APPROVE' ? extensionDays : null,
          loan_due_date: decision === 'APPROVE' ? newDueDate : loan.due_date,
          renewal_records: renewalRows.map((row) => row.id),
        },
      });

      return {
        code: 200,
        payload: {
          message: decision === 'APPROVE' ? 'Renewal approved successfully' : 'Renewal rejected successfully',
          data: {
            loan_id: loan.id,
            request_id: pendingRequest.id,
            decision,
            extension_days: decision === 'APPROVE' ? extensionDays : null,
            due_date: decision === 'APPROVE' ? newDueDate : loan.due_date,
          },
        },
      };
    });

    return res.status(result.code).json(result.payload);
  } catch (error) {
    console.error('Error while reviewing loan renewal:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

async function getLoanById(req, res) {
  const id = parseId(req.params.id);
  if (!id || !isUuid(id)) {
    return res.status(400).json({ message: 'Mã phiếu mượn không hợp lệ' });
  }

  try {
    const loan = await prisma.loan_transactions.findUnique({
      where: { id },
      include: {
        customers: {
          select: {
            id: true,
            customer_code: true,
            full_name: true,
            email: true,
            phone: true,
            status: true,
          },
        },
        loan_items: { include: { loan_item_deposits: true } },
      },
    });

    if (!loan) {
      return res.status(404).json({ message: 'Không tìm thấy phiếu mượn' });
    }

    return res.json({ data: loan });
  } catch (error) {
    console.error('Error while loading loan:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

// GET /borrow/loans/:id/return-preview?loan_item_id=&item_condition_on_return=&mark_lost=
// What a return with these inputs would charge and refund, per book, before staff
// confirm it. Writes nothing; uses the same fine policy as the return itself.
async function previewLoanReturn(req, res) {
  const loanId = parseId(req.params.id);
  const loanItemId = parseId(req.query.loan_item_id);
  const markLost = String(req.query.mark_lost || '').toLowerCase() === 'true';
  const condition = markLost ? 'LOST' : String(req.query.item_condition_on_return || 'GOOD').trim().toUpperCase();

  if (!loanId || !isUuid(loanId)) {
    return res.status(400).json({ message: 'Mã phiếu mượn không hợp lệ' });
  }
  if (loanItemId && !isUuid(loanItemId)) {
    return res.status(400).json({ message: 'loan_item_id phải là UUID hợp lệ (nếu có)' });
  }
  if (markLost && !loanItemId) {
    return res.status(400).json({ message: 'mark_lost cần loan_item_id để xử lý từng cuốn' });
  }

  try {
    const loan = await prisma.loan_transactions.findUnique({ where: { id: loanId }, include: { loan_items: true } });
    if (!loan) {
      return res.status(404).json({ message: 'Không tìm thấy phiếu mượn' });
    }

    const targets = loanItemId
      ? loan.loan_items.filter((item) => item.id === loanItemId && (item.status === 'BORROWED' || item.status === 'OVERDUE'))
      : loan.loan_items.filter((item) => item.status === 'BORROWED' || item.status === 'OVERDUE');
    if (targets.length === 0) {
      return res.status(409).json({ message: 'Không có sách đang mượn để trả' });
    }

    const membershipInfo = await resolveActiveMembership(prisma, loan.customer_id);
    const preview = await previewReturnSettlement(prisma, {
      items: targets,
      returnedAt: new Date(),
      membershipLimits: membershipInfo?.limits,
      markLost,
      itemConditionOnReturn: condition,
    });

    return res.json({ data: { loan_id: loan.id, item_condition_on_return: condition, mark_lost: markLost, ...preview } });
  } catch (error) {
    console.error('Error while previewing loan return:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

async function convertReservationToLoan(req, res) {
  const reservationId = parseId(req.params.id);
  const actorUserId = req.user?.id || null;
  const authHeader = req.headers.authorization;
  const idempotencyKey = parseIdempotencyKey(req);

  if (!reservationId || !isUuid(reservationId)) {
    return res.status(400).json({ message: 'Mã đặt trước không hợp lệ' });
  }

  if (!idempotencyKey) {
    return res.status(400).json({ message: 'Cần header Idempotency-Key khi chuyển thành phiếu mượn' });
  }

  try {
    const reservation = await prisma.loan_reservations.findUnique({ where: { id: reservationId } });
    if (!reservation) {
      return res.status(404).json({ message: 'Không tìm thấy đặt trước' });
    }

    if (reservation.status === 'CONVERTED_TO_LOAN') {
      const existingLoan = await prisma.loan_transactions.findFirst({ where: { source_reservation_id: reservationId } });
      if (!existingLoan) {
        return res.status(409).json({ message: 'Đặt trước đã được chuyển nhưng không tìm thấy phiếu mượn' });
      }
      return res.json({ data: existingLoan, idempotent: true });
    }

    if (!CONVERTIBLE_RESERVATION_STATUSES.includes(reservation.status)) {
      return res.status(409).json({
        message: reservation.status === 'PENDING'
          ? 'Reservation must be confirmed by staff before conversion'
          : `Reservation is not convertible from status ${reservation.status}`,
      });
    }

    if (reservation.status === 'READY_FOR_PICKUP') {
      if (!reservation.pickup_code) {
        return res.status(409).json({ message: 'Đặt trước này chưa được cấp mã nhận sách' });
      }

      if (!req.pickupCodeVerified) {
        return res.status(409).json({ message: 'Cần mã nhận sách để chuyển đặt trước đã sẵn sàng thành phiếu mượn' });
      }

      if (reservation.pickup_code_used_at) {
        return res.status(409).json({ message: 'Mã nhận sách đã được sử dụng' });
      }

      if (normalizePickupCode(req.pickupCode) !== reservation.pickup_code) {
        return res.status(409).json({ message: 'Mã nhận sách không khớp với đặt trước này' });
      }

      if (reservation.pickup_code_expires_at && new Date(reservation.pickup_code_expires_at).getTime() <= Date.now()) {
        return res.status(409).json({ message: 'Mã nhận sách đã hết hạn' });
      }
    }

    if (new Date(reservation.expires_at).getTime() <= Date.now()) {
      return res.status(409).json({ message: 'Đặt trước đã hết hạn, không thể chuyển thành phiếu mượn' });
    }

    const customer = await prisma.customers.findUnique({ where: { id: reservation.customer_id } });
    if (!customer || customer.status !== 'ACTIVE') {
      return res.status(409).json({ message: 'Bạn đọc không đủ điều kiện chuyển đặt trước thành phiếu mượn' });
    }

    if (Number(customer.total_fine_balance) > 0) {
      return res.status(409).json({
        message: 'Khách còn tiền phạt chưa thanh toán',
        detail: { total_fine_balance: Number(customer.total_fine_balance) },
      });
    }

    const membershipInfo = await resolveActiveMembership(prisma, reservation.customer_id);
    if (!membershipInfo) {
      return res.status(409).json({ message: 'Bạn đọc chưa có thẻ thành viên còn hiệu lực' });
    }

    const activeLoanCount = await prisma.loan_transactions.count({
      where: {
        customer_id: reservation.customer_id,
        status: { in: ACTIVE_LOAN_STATUSES },
      },
    });

    if (activeLoanCount + reservation.quantity > membershipInfo.limits.max_active_loans) {
      return res.status(409).json({
        message: 'Bạn đọc đã đạt số sách mượn tối đa theo gói thành viên',
        detail: {
          max_active_loans: membershipInfo.limits.max_active_loans,
          active_loan_count: activeLoanCount,
        },
      });
    }

    const loanId = crypto.randomUUID();
    const loanNumber = createLoanNumber();
    const borrowFeeAmount = Number((reservation.quantity * getBorrowFeePerItem()).toFixed(2));

    if (borrowFeeAmount > 0) {
      const accountSnapshot = await prisma.$transaction((tx) => getCustomerAccountSnapshot(tx, reservation.customer_id));
      const projectedBalance = Number((accountSnapshot.availableBalance - borrowFeeAmount).toFixed(2));

      if (accountSnapshot.settings.auto_debit_borrow_fee !== true) {
        return res.status(409).json({
          message: 'Chưa bật tự động trừ phí mượn từ ví',
          detail: {
            borrow_fee_amount: borrowFeeAmount,
          },
        });
      }

      if (projectedBalance < accountSnapshot.minWalletBalanceRequired) {
        return res.status(409).json({
          message: 'Số dư ví không đủ để tự động trừ phí',
          detail: {
            available_balance: accountSnapshot.availableBalance,
            required_amount: borrowFeeAmount,
            min_wallet_balance_required: accountSnapshot.minWalletBalanceRequired,
          },
        });
      }
    }

    const depositShortfall = await checkDepositFunds(reservation.customer_id, reservation.quantity, membershipInfo.limits, borrowFeeAmount);
    if (depositShortfall) {
      return res.status(409).json(depositShortfall);
    }

    await consumeReservation({
      reservation_id: reservationId,
      loan_id: loanId,
      loan_number: loanNumber,
      warehouse_id: reservation.warehouse_id,
      idempotency_key: idempotencyKey,
      handled_by_user_id: actorUserId,
      authHeader,
      requestId: req.requestId,
    });

    const borrowDate = new Date();
    const dueDate = new Date(borrowDate.getTime() + membershipInfo.limits.max_loan_days * 24 * 60 * 60 * 1000);

    try {
      const created = await prisma.$transaction(async (tx) => {
        // Re-check the membership limit atomically, serialized per customer: the count at line
        // ~764 ran outside any lock, so two concurrent conversions could both pass it and both
        // reach here. If this trips, it falls through to the same catch below that already
        // handles "inventory consumed but DB transaction failed" by queuing reconciliation.
        // $executeRaw (not $queryRaw): pg_advisory_xact_lock returns void, which Prisma's
        // $queryRaw cannot deserialize (P2010 "Failed to deserialize column of type 'void'").
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`membership-limit:${reservation.customer_id}`}, 0))`;
        const recheckLoanCount = await tx.loan_transactions.count({
          where: { customer_id: reservation.customer_id, status: { in: ACTIVE_LOAN_STATUSES } },
        });
        if (recheckLoanCount + reservation.quantity > membershipInfo.limits.max_active_loans) {
          throw new Error('MEMBERSHIP_LIMIT_EXCEEDED_ON_RECHECK');
        }

        let debitResult = null;
        if (borrowFeeAmount > 0) {
          debitResult = await debitBorrowFee(tx, {
            customerId: reservation.customer_id,
            actorUserId,
            amount: borrowFeeAmount,
            idempotencyKey: `loan-convert:${idempotencyKey}`,
            referenceType: 'LOAN_TRANSACTION',
            referenceId: loanId,
            note: `Auto debit borrow fee for reservation ${reservation.reservation_number}`,
            metadata: {
              reservation_id: reservation.id,
              reservation_number: reservation.reservation_number,
              loan_id: loanId,
              loan_number: loanNumber,
            },
          });
        }

        const loan = await tx.loan_transactions.create({
          data: {
            id: loanId,
            loan_number: loanNumber,
            customer_id: reservation.customer_id,
            warehouse_id: reservation.warehouse_id,
            handled_by_user_id: actorUserId || reservation.created_by_user_id,
            source_reservation_id: reservation.id,
            borrow_date: borrowDate,
            due_date: dueDate,
            status: 'BORROWED',
            total_items: reservation.quantity,
          },
        });

        const loanItems = Array.from({ length: reservation.quantity }).map((_, index) => ({
          id: crypto.randomUUID(),
          loan_id: loan.id,
          variant_id: reservation.variant_id,
          inventory_unit_id: reservation.inventory_unit_id,
          item_barcode: reservation.inventory_unit_id || `${loan.loan_number}-ITEM-${index + 1}`,
          due_date: dueDate,
          status: 'BORROWED',
          item_condition_on_checkout: 'GOOD',
        }));

        await tx.loan_items.createMany({ data: loanItems });

        const deposits = await holdLoanItemDeposits(tx, {
          customerId: reservation.customer_id,
          loanId: loan.id,
          loanNumber: loan.loan_number,
          items: loanItems,
          amountPerItem: getDepositPerItem(membershipInfo.limits),
          actorUserId,
        });
        const depositSummary = summarizeDeposits(deposits);

        await tx.loan_reservations.update({
          where: { id: reservation.id },
          data: {
            status: 'CONVERTED_TO_LOAN',
            ...(req.pickupCodeVerified ? { pickup_code_used_at: new Date() } : {}),
            updated_at: new Date(),
          },
        });

        await writeAuditLog(tx, {
          actor_user_id: actorUserId,
          action_name: 'CONVERT_RESERVATION_TO_LOAN',
          entity_type: 'LOAN_TRANSACTION',
          entity_id: loan.id,
          before_data: reservation,
          after_data: {
            ...loan,
            source_reservation_id: reservation.id,
            idempotency_key: idempotencyKey,
            borrow_fee_amount: borrowFeeAmount,
            borrow_fee_ledger_entry_id: debitResult?.entry?.id || null,
            ...depositSummary,
          },
        });

        const depositSentence = depositSummary.deposit_total > 0
          ? ` Tiền cọc ${depositSummary.deposit_total.toLocaleString('vi-VN')}đ đang được giữ trong ví.`
          : '';
        await createNotificationRecord(tx, {
          customer_id: reservation.customer_id,
          channel: 'IN_APP',
          template_code: 'LOAN_CREATED',
          subject: 'Đã tạo phiếu mượn',
          body: (borrowFeeAmount > 0
            ? `Đặt trước ${reservation.reservation_number} đã chuyển thành phiếu mượn ${loan.loan_number}. Phí mượn ${borrowFeeAmount.toLocaleString('vi-VN')}đ đã được trừ tự động.`
            : `Đặt trước ${reservation.reservation_number} đã chuyển thành phiếu mượn ${loan.loan_number}.`) + depositSentence,
          reference_type: 'LOAN_TRANSACTION',
          reference_id: loan.id,
          metadata: {
            borrow_fee_amount: borrowFeeAmount,
            borrow_fee_ledger_entry_id: debitResult?.entry?.id || null,
            ...depositSummary,
          },
        });

        return {
          ...loan,
          borrow_fee_amount: borrowFeeAmount,
          borrow_fee_ledger_entry_id: debitResult?.entry?.id || null,
          borrow_fee_remaining_wallet_balance: debitResult?.remainingBalance ?? null,
          ...depositSummary,
        };
      });

      return res.status(201).json({ data: created });
    } catch (error) {
      if (error instanceof AccountError) {
        if (error.code === 'INSUFFICIENT_FUNDS') {
          return res.status(409).json({
            message: 'Số dư ví không đủ để tự động trừ phí',
            detail: error.detail,
          });
        }

        return res.status(409).json({
          message: error.message,
          detail: error.detail || undefined,
        });
      }

      // Same shape as createDirectLoan's catch below: not auto-reversed
      // because the correct undo needs loan_item ids that only exist once
      // loan_items rows are created — the step that just failed.
      console.error('Borrow DB transaction failed after inventory consume:', error);
      await queueReconciliation({
        aggregateId: loanId,
        eventType: 'RESERVATION_CONSUME_UNRESOLVED',
        payload: {
          loan_id: loanId,
          reservation_id: reservationId,
          customer_id: reservation.customer_id,
          variant_id: reservation.variant_id,
          warehouse_id: reservation.warehouse_id,
          quantity: reservation.quantity,
        },
      });
      return res.status(502).json({
        message: 'Loan creation failed after inventory consume. Queued for manual reconciliation.',
      });
    }
  } catch (error) {
    if (error?.status === 409) {
      return res.status(409).json({ message: error.message });
    }

    console.error('Error while converting reservation to loan:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

async function convertReservationPickupCodeToLoan(req, res) {
  const pickupCode = parsePickupCodeFromBody(req.body || {});

  if (!pickupCode) {
    return res.status(400).json({ message: 'Thiếu pickup_code' });
  }

  try {
    const reservation = await prisma.loan_reservations.findUnique({
      where: { pickup_code: pickupCode },
      select: { id: true },
    });

    if (!reservation) {
      return res.status(404).json({ message: 'Không tìm thấy mã nhận sách' });
    }

    req.params.id = reservation.id;
    req.pickupCodeVerified = true;
    req.pickupCode = pickupCode;

    return convertReservationToLoan(req, res);
  } catch (error) {
    console.error('Error while converting reservation by pickup code:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

async function returnLoan(req, res) {
  const loanId = parseId(req.params.id);
  const actorUserId = req.user?.id || null;
  const authHeader = req.headers.authorization;
  const idempotencyKey = parseIdempotencyKey(req);
  const {
    loan_item_id,
    returned_to_location_id,
    item_condition_on_return,
    notes,
    mark_lost,
    settlement_reason,
  } = req.body || {};
  const markLost = mark_lost === true;
  const normalizedReturnCondition = markLost
    ? 'LOST'
    : String(item_condition_on_return || 'GOOD').trim().toUpperCase();
  const settlementReason = String(settlement_reason || notes || '').trim();

  if (!loanId || !isUuid(loanId)) {
    return res.status(400).json({ message: 'Mã phiếu mượn không hợp lệ' });
  }

  if (!idempotencyKey) {
    return res.status(400).json({ message: 'Cần header Idempotency-Key khi trả sách' });
  }

  if (loan_item_id && !isUuid(loan_item_id)) {
    return res.status(400).json({ message: 'loan_item_id phải là UUID hợp lệ (nếu có)' });
  }

  if (returned_to_location_id && !isUuid(returned_to_location_id)) {
    return res.status(400).json({ message: 'returned_to_location_id phải là UUID hợp lệ (nếu có)' });
  }

  if (markLost && !loan_item_id) {
    return res.status(400).json({ message: 'mark_lost cần loan_item_id để xử lý từng cuốn' });
  }

  // Populated only once the returnBorrowedStock loop below has actually
  // succeeded, so the catch block below can tell "nothing changed remotely
  // yet" apart from "remote already changed, local persistence failed" —
  // declared outside try/catch since a const inside try isn't visible in catch.
  let returnedLoanItemIds = [];

  try {
    const loan = await prisma.loan_transactions.findUnique({
      where: { id: loanId },
      include: { loan_items: true },
    });

    if (!loan) {
      return res.status(404).json({ message: 'Không tìm thấy phiếu mượn' });
    }

    if (!ACTIVE_LOAN_STATUSES.includes(loan.status)) {
      return res.status(409).json({ message: `Không thể trả sách khi phiếu mượn ở trạng thái ${loan.status}` });
    }

    const targets = loan_item_id
      ? loan.loan_items.filter((item) => item.id === loan_item_id)
      : loan.loan_items.filter((item) => item.status === 'BORROWED' || item.status === 'OVERDUE');

    if (targets.length === 0) {
      return res.status(409).json({ message: 'Không có sách đang mượn để trả' });
    }

    // A deposit is only used to pay for damage or loss on an explicit, explained
    // staff decision. Checked before any stock moves.
    if (settlementNeedsReason({ markLost, itemConditionOnReturn: normalizedReturnCondition }) && !settlementReason) {
      const heldDepositCount = await prisma.loan_item_deposits.count({
        where: { loan_item_id: { in: targets.map((item) => item.id) }, status: 'HELD' },
      });
      if (heldDepositCount > 0) {
        return res.status(400).json({
          message: 'Cần settlement_reason khi dùng tiền cọc để xử lý sách hỏng hoặc mất',
          code: 'SETTLEMENT_REASON_REQUIRED',
        });
      }
    }

    for (let index = 0; index < targets.length; index += 1) {
      const item = targets[index];
      await returnBorrowedStock({
        loan_id: loan.id,
        loan_item_id: item.id,
        variant_id: item.variant_id,
        warehouse_id: loan.warehouse_id,
        quantity: 1,
        location_id: returned_to_location_id || null,
        inventory_unit_id: item.inventory_unit_id || null,
        item_condition_on_return: markLost ? 'LOST' : normalizedReturnCondition,
        mark_lost: markLost,
        idempotency_key: `${idempotencyKey}:${index + 1}`,
        handled_by_user_id: actorUserId,
        authHeader,
        requestId: req.requestId,
      });
    }

    returnedLoanItemIds = targets.map((item) => item.id);
    const returnedAt = new Date();

    const updated = await prisma.$transaction(async (tx) => {
      const membershipInfo = await resolveActiveMembership(tx, loan.customer_id);
      const targetIds = targets.map((item) => item.id);
      const targetStatus = markLost ? 'LOST' : 'RETURNED';
      await tx.loan_items.updateMany({
        where: { id: { in: targetIds } },
        data: {
          status: targetStatus,
          return_date: markLost ? null : returnedAt,
          returned_to_warehouse_id: markLost ? null : loan.warehouse_id,
          returned_to_location_id: markLost ? null : (returned_to_location_id || null),
          item_condition_on_return: markLost ? null : normalizedReturnCondition,
          ...(notes ? { notes: String(notes) } : {}),
        },
      });

      const fineResult = await applyReturnFines(tx, {
        customerId: loan.customer_id,
        loan,
        items: targets,
        returnedAt,
        actorUserId,
        membershipLimits: membershipInfo?.limits,
        markLost,
        itemConditionOnReturn: normalizedReturnCondition,
      });

      // After the fines exist: each returned book's deposit pays its own fines,
      // the rest goes back to the wallet.
      const depositSettlements = await settleLoanItemDeposits(tx, {
        loanItemIds: targetIds,
        actorUserId,
        returnCondition: normalizedReturnCondition,
        reason: settlementReason || null,
      });
      const totalFineBalance = depositSettlements.some((row) => row.captured_amount > 0)
        ? await recomputeCustomerFineBalance(tx, loan.customer_id)
        : fineResult.totalFineBalance;

      const remaining = await tx.loan_items.count({
        where: {
          loan_id: loan.id,
          status: { in: ['BORROWED', 'OVERDUE', 'RESERVED'] },
        },
      });

      const loanStatus = markLost
        ? (remaining === 0 ? 'LOST' : loan.status)
        : (remaining === 0 ? 'RETURNED' : loan.status);
      const loanUpdated = await tx.loan_transactions.update({
        where: { id: loan.id },
        data: {
          status: loanStatus,
          ...(remaining === 0 ? { closed_at: returnedAt } : {}),
        },
      });

      await writeAuditLog(tx, {
        actor_user_id: actorUserId,
        action_name: 'RETURN_LOAN_ITEMS',
        entity_type: 'LOAN_TRANSACTION',
        entity_id: loan.id,
        before_data: {
          status: loan.status,
          returned_item_count: 0,
        },
        after_data: {
          status: loanStatus,
          target_status: targetStatus,
          returned_item_count: targets.length,
          generated_fine_count: fineResult.fines.length,
          total_fine_balance: totalFineBalance,
          settled_deposit_ids: depositSettlements.map((row) => row.deposit_id),
          idempotency_key: idempotencyKey,
        },
      });

      await createNotificationRecord(tx, {
        customer_id: loan.customer_id,
        channel: 'IN_APP',
        template_code: 'LOAN_RETURNED',
        subject: remaining === 0 ? 'Đã trả đủ sách' : 'Đã trả sách',
        body: remaining === 0
          ? `Phiếu mượn ${loan.loan_number} đã được trả đủ.`
          : `Đã trả ${targets.length} cuốn thuộc phiếu mượn ${loan.loan_number}.`,
        reference_type: 'LOAN_TRANSACTION',
        reference_id: loan.id,
        metadata: {
          generated_fine_count: fineResult.fines.length,
          total_fine_balance: totalFineBalance,
          mark_lost: markLost,
        },
      });

      if (depositSettlements.length > 0) {
        const sum = (key) => depositSettlements.reduce((total, row) => total.add(toMoney(row[key])), toMoney(0)).toNumber();
        const refunded = sum('refunded_amount');
        const captured = sum('captured_amount');
        const additionalDue = sum('additional_due');
        const parts = [`Hoàn ${refunded.toLocaleString('vi-VN')}đ tiền cọc về ví`];
        if (captured > 0) parts.push(`khấu trừ ${captured.toLocaleString('vi-VN')}đ để trả tiền phạt`);
        if (additionalDue > 0) parts.push(`còn phải thanh toán ${additionalDue.toLocaleString('vi-VN')}đ`);
        await createNotificationRecord(tx, {
          customer_id: loan.customer_id,
          channel: 'IN_APP',
          template_code: 'LOAN_DEPOSIT_SETTLED',
          subject: 'Đã quyết toán tiền cọc',
          body: `Phiếu mượn ${loan.loan_number}: ${parts.join(', ')}.`,
          reference_type: 'LOAN_TRANSACTION',
          reference_id: loan.id,
          metadata: {
            deposit_ids: depositSettlements.map((row) => row.deposit_id),
            refunded_amount: refunded,
            captured_amount: captured,
            additional_due: additionalDue,
          },
        });
      }

      return {
        ...loanUpdated,
        generated_fines: fineResult.fines,
        total_fine_balance: totalFineBalance,
        deposit_settlements: depositSettlements.map(({ deposit, ...row }) => row),
      };
    });

    return res.json({ data: updated });
  } catch (error) {
    if (error?.status === 409) {
      return res.status(409).json({ message: error.message });
    }

    console.error('Error while returning loan:', error);

    if (returnedLoanItemIds.length > 0) {
      // The returnBorrowedStock loop above already succeeded: Inventory has
      // moved borrowed_qty -> available_qty for these items, but loan_items/
      // loan status here never updated to match. Same "no safe automatic
      // undo" reasoning as createDirectLoan/convertReservationToLoan: queue
      // it instead of guessing.
      await queueReconciliation({
        aggregateId: loanId,
        eventType: 'LOAN_RETURN_UNRESOLVED',
        payload: { loan_id: loanId, loan_item_ids: returnedLoanItemIds },
      });
      return res.status(500).json({ message: 'Internal server error. Stock was already returned; this has been queued for reconciliation.' });
    }

    return res.status(500).json({ message: 'Internal server error' });
  }
}

async function runOverdueSweepNow(req, res) {
  try {
    const result = await runOverdueSweep(prisma, {
      limit: Number(req.body?.limit || req.query?.limit || 200),
    });
    return res.json({
      message: 'Overdue sweep completed',
      data: result,
    });
  } catch (error) {
    console.error('runOverdueSweepNow error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

module.exports = {
  listLoans,
  getLoanById,
  createDirectLoan,
  convertReservationToLoan,
  convertReservationPickupCodeToLoan,
  listRenewalRequests,
  reviewLoanRenewal,
  returnLoan,
  previewLoanReturn,
  runOverdueSweepNow,
};
