const { deterministicUuid } = require('@smartbook/shared/runtime');
const { prisma } = require('../lib/prisma');
const { resolveActiveMembership, countActiveBorrowedItems, countActiveReservedItems } = require('../services/membership.service');
const { checkAvailability, reserveStock, releaseReservation, reallocateReservationStock } = require('../services/inventory-integration.service');
const { parsePicks } = require('../utils/picks');
const { queueReconciliation } = require('../services/reconciliation.service');
const { readBorrowOperation, prepareBorrowOperation, prepareBorrowOperationInTransaction, approvedRecovery,
  markBorrowRemoteStarted, completeBorrowOperation, deferBorrowOperation, sendBorrowReplay, boundedBorrowKey } = require('../services/borrow-operation.service');
const { writeAuditLog } = require('../lib/audit');
const { createNotificationRecord } = require('../lib/notifications');
const { createPickupQrValue, generateUniquePickupCode } = require('../utils/pickup-code');
const { parseStatusFilter, searchTerm, countByStatus } = require('../lib/list-query');
const {
  requireWarehouseReadAccess,
  requireWarehouseWriteAccess,
  scopedWarehouseWhere,
  scopeErrorStatus,
  WarehouseScopeUnavailableError,
} = require('../utils/warehouse-scope.utils');

const ACTIVE_RESERVATION_STATUSES = ['PENDING', 'CONFIRMED', 'READY_FOR_PICKUP'];
const DUPLICATE_RESERVATION_MESSAGE = 'Khách đã có một đặt chỗ đang hoạt động cho cuốn sách này';
const RESERVATION_EXPIRY_BATCH_SIZE = 100;

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ''));
}

// createReservation/cancelReservation are shared with my.controller.js's customer
// self-service path (createMyReservation/cancelMyReservation); warehouse scope is
// a staff concept (who may act on which branch's records) and never applied to a
// customer acting on their own reservation - same role check authorizeCustomerSelf
// already gates that path on.
function isCustomerCaller(req) {
  const roles = Array.isArray(req.user?.roles) ? req.user.roles.map((r) => String(r).toUpperCase()) : [];
  return roles.includes('CUSTOMER');
}

function parseId(value) {
  const id = String(value || '').trim();
  return id || null;
}

function parsePagination(query) {
  const page = Math.max(1, Number.parseInt(String(query.page || '1'), 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(String(query.pageSize || '20'), 10) || 20));
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

function parseIdempotencyKey(req) {
  const header = req.headers['idempotency-key'] || req.headers['x-idempotency-key'];
  const value = String(header || '').trim();
  return value || null;
}

async function listReservations(req, res) {
  const { customer_id } = req.query;
  const pagination = parsePagination(req.query);
  const q = searchTerm(req.query);
  const status = parseStatusFilter(req.query.status);

  try {
    const scopeWhere = await scopedWarehouseWhere(req.user);

    // Everything except the status condition; per-status counts are taken over this.
    const whereWithoutStatus = {
      ...scopeWhere,
      ...(typeof customer_id === 'string' && customer_id ? { customer_id } : {}),
      ...(q
        ? {
          OR: [
            { reservation_number: { contains: q, mode: 'insensitive' } },
            { pickup_code: { contains: q, mode: 'insensitive' } },
            { customers: { full_name: { contains: q, mode: 'insensitive' } } },
            { customers: { customer_code: { contains: q, mode: 'insensitive' } } },
          ],
        }
        : {}),
    };
    const where = status ? { ...whereWithoutStatus, status } : whereWithoutStatus;
    const orderBy = req.query.sort === 'expires_at' ? [{ expires_at: 'asc' }] : [{ reserved_at: 'desc' }];

    const [items, total, statusCounts] = await Promise.all([
      prisma.loan_reservations.findMany({
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
        },
      }),
      prisma.loan_reservations.count({ where }),
      countByStatus(prisma.loan_reservations, whereWithoutStatus),
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
    if (error instanceof WarehouseScopeUnavailableError) {
      return res.status(scopeErrorStatus(error)).json({ message: error.message, code: error.code });
    }
    console.error('Error while listing reservations:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

async function getReservationById(req, res) {
  const id = parseId(req.params.id);
  if (!id || !isUuid(id)) {
    return res.status(400).json({ message: 'Mã đặt trước không hợp lệ' });
  }

  try {
    const reservation = await prisma.loan_reservations.findUnique({
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
      },
    });

    if (!reservation) {
      return res.status(404).json({ message: 'Không tìm thấy đặt trước' });
    }

    if (!(await requireWarehouseReadAccess(req, res, reservation.warehouse_id))) return;

    return res.json({ data: reservation });
  } catch (error) {
    console.error('Error while loading reservation:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

// Idempotency of POST /reservations (Phase E). The reservation row IS the
// idempotency record: its primary key is derived from the Idempotency-Key, so the
// primary-key constraint is what stops two requests with one key from creating
// two reservations. A key stays bound to its reservation for the row's lifetime:
// replaying it after the reservation was cancelled or expired returns that
// reservation in its current status, never a second one.
function reservationIdsFor(actorUserId, idempotencyKey) {
  // Scoped per acting user: another user's request with the same key can neither
  // replay this reservation nor collide with it.
  const legacyId = deterministicUuid(`reservation:${idempotencyKey}`);
  if (!actorUserId) return { reservationId: legacyId, legacyId: null };
  // Ids created before the scoping were derived from the key alone; they are still
  // honoured for the user who created them, so a retry spanning the upgrade
  // replays instead of creating a duplicate.
  return { reservationId: deterministicUuid(`reservation:${actorUserId}:${idempotencyKey}`), legacyId };
}

async function findIdempotentReservation(db, { reservationId, legacyId, actorUserId }) {
  const ids = legacyId ? [reservationId, legacyId] : [reservationId];
  const rows = await db.loan_reservations.findMany({ where: { id: { in: ids } } });
  return rows.find((row) => row.id === reservationId)
    || rows.find((row) => row.id === legacyId && row.created_by_user_id === actorUserId)
    || null;
}

function replayReservation(res, existing, payload) {
  const samePayload = existing.customer_id === payload.customer_id
    && existing.variant_id === payload.variant_id
    && existing.warehouse_id === payload.warehouse_id
    && existing.quantity === payload.quantity;
  if (!samePayload) {
    return res.status(409).json({
      message: 'Idempotency-Key đã được dùng cho một yêu cầu có nội dung khác',
      code: 'IDEMPOTENCY_KEY_REUSED',
    });
  }
  return res.status(200).json({ data: existing, idempotent: true });
}

// Business preconditions of a NEW reservation. Returns { status, body } when the
// request is refused, { membershipInfo } when it may proceed. Never consulted for a replay.
async function reservationRefusal({ customer_id, variant_id, quantity }) {
  const customer = await prisma.customers.findUnique({ where: { id: customer_id } });
  if (!customer) {
    return { status: 404, body: { message: 'Không tìm thấy bạn đọc' } };
  }
  if (customer.status !== 'ACTIVE') {
    return { status: 409, body: { message: 'Bạn đọc không đủ điều kiện: trạng thái phải là ACTIVE' } };
  }
  if (Number(customer.total_fine_balance) > 0) {
    return {
      status: 409,
      body: {
        message: 'Khách còn tiền phạt chưa thanh toán',
        detail: { total_fine_balance: Number(customer.total_fine_balance) },
      },
    };
  }

  const membershipInfo = await resolveActiveMembership(prisma, customer_id);
  if (!membershipInfo) {
    return { status: 409, body: { message: 'Bạn đọc chưa có thẻ thành viên còn hiệu lực' } };
  }

  const [activeLoanCount, activeReservationCount] = await Promise.all([
    countActiveBorrowedItems(prisma, customer_id),
    countActiveReservedItems(prisma, customer_id),
  ]);
  if (activeLoanCount + activeReservationCount + quantity > membershipInfo.limits.max_active_loans) {
    return {
      status: 409,
      body: {
        message: 'Bạn đọc đã đạt số sách mượn tối đa theo gói thành viên',
        detail: {
          max_active_loans: membershipInfo.limits.max_active_loans,
          active_loan_count: activeLoanCount,
          active_reservation_count: activeReservationCount,
        },
      },
    };
  }

  // One live reservation per customer per book; checked again under the customer
  // lock in the transaction so two simultaneous requests cannot both slip past it.
  const duplicateReservation = await prisma.loan_reservations.count({
    where: { customer_id, variant_id, status: { in: ACTIVE_RESERVATION_STATUSES }, expires_at: { gt: new Date() } },
  });
  if (duplicateReservation > 0) {
    return { status: 409, body: { message: DUPLICATE_RESERVATION_MESSAGE } };
  }

  return { membershipInfo };
}

async function createReservation(req, res) {
  const { customer_id, variant_id, warehouse_id, pickup_location_id, quantity, source_channel, notes } = req.body;
  const actorUserId = req.user?.id || null;
  const authHeader = req.headers.authorization;
  const idempotencyKey = parseIdempotencyKey(req);

  if (!customer_id || !variant_id || !warehouse_id) {
    return res.status(400).json({ message: 'Cần có đủ customer_id, variant_id và warehouse_id' });
  }

  if (!idempotencyKey) {
    return res.status(400).json({ message: 'Cần header Idempotency-Key khi tạo đặt trước' });
  }

  if (![customer_id, variant_id, warehouse_id].every(isUuid)) {
    return res.status(400).json({ message: 'customer_id, variant_id và warehouse_id phải là UUID hợp lệ' });
  }

  if (pickup_location_id && !isUuid(pickup_location_id)) {
    return res.status(400).json({ message: 'pickup_location_id phải là UUID hợp lệ (nếu có)' });
  }
  if (notes != null && typeof notes !== 'string') return res.status(400).json({ message: 'notes phải là chuỗi' });

  const normalizedQuantity = Number.parseInt(String(quantity || '1'), 10);
  if (!Number.isInteger(normalizedQuantity) || normalizedQuantity <= 0) {
    return res.status(400).json({ message: 'quantity phải là số nguyên dương' });
  }

  const normalizedSource = source_channel || 'WEB';
  if (!['WEB', 'MOBILE', 'COUNTER', 'ADMIN'].includes(normalizedSource)) {
    return res.status(400).json({ message: 'source_channel không hợp lệ' });
  }

  // Staff creating a reservation on a customer's behalf must hold write scope on
  // that branch; a customer reserving for themself is not warehouse-scoped at all.
  if (!approvedRecovery(req) && !isCustomerCaller(req) && !(await requireWarehouseWriteAccess(req, res, warehouse_id))) return;

  const fingerprint = { customer_id, variant_id, warehouse_id, quantity: normalizedQuantity };
  const ids = { ...reservationIdsFor(actorUserId, idempotencyKey), actorUserId };
  const { reservationId } = ids;
  const operationRequest = { params: {}, body: { customer_id, variant_id, warehouse_id,
    quantity: normalizedQuantity, pickup_location_id: pickup_location_id || null, source_channel: normalizedSource, notes: notes || null },
    channel: req.reservationChannel || null };
  let operation;
  let reservationAccepted = false;

  try {
    // Idempotency BEFORE the business rules: a retry of a request that already
    // created its reservation must get that reservation back, even when the
    // reservation itself now makes the membership limit or the one-per-book rule
    // refuse a new one (or the membership changed since).
    const existingByIdempotency = await findIdempotentReservation(prisma, ids);
    if (existingByIdempotency) {
      return replayReservation(res, existingByIdempotency, fingerprint);
    }

    const previousOperation = approvedRecovery(req) || await readBorrowOperation(prisma, 'CREATE_RESERVATION', reservationId, { request: operationRequest, user: req.user });
    const approved = previousOperation?.payload.plan;
    const precheck = approved ? { membershipInfo: approved.membershipInfo } : await reservationRefusal(fingerprint);
    if (precheck.status) {
      // A concurrent request with this key may have committed since the lookup
      // above - its reservation is then exactly what refused this one.
      const committedMeanwhile = await findIdempotentReservation(prisma, ids);
      if (committedMeanwhile) return replayReservation(res, committedMeanwhile, fingerprint);
      return res.status(precheck.status).json(precheck.body);
    }
    const { membershipInfo } = precheck;

    if (!approved) await checkAvailability({
      variant_id,
      warehouse_id,
      quantity: normalizedQuantity,
      reservation_channel: req.reservationChannel,
      authHeader,
      requestId: req.requestId,
    });

    const reservationNumber = `RSV-${reservationId.slice(0, 8).toUpperCase()}`;
    let reservedAt = approved ? new Date(approved.reservedAt) : new Date();
    let expiresAt = approved ? new Date(approved.expiresAt) : new Date(reservedAt.getTime() + membershipInfo.limits.reservation_hold_hours * 60 * 60 * 1000);
    operation = await prepareBorrowOperation(prisma, { kind: 'CREATE_RESERVATION', reference: reservationId,
      key: idempotencyKey, request: operationRequest, user: req.user, req,
      plan: { reservationId, reservationNumber, reservedAt, expiresAt, membershipInfo } });
    if (operation.status === 'PUBLISHED') return sendBorrowReplay(res, operation);
    reservedAt = new Date(operation.payload.plan.reservedAt); expiresAt = new Date(operation.payload.plan.expiresAt);
    await markBorrowRemoteStarted(prisma, operation);

    // Inventory dedups on reservation_id, so a concurrent request with the same key
    // ends up with the same single stock hold, not two.
    await reserveStock({
      reservation_id: reservationId,
      reservation_number: reservationNumber,
      customer_id,
      variant_id,
      warehouse_id,
      quantity: normalizedQuantity,
      expires_at: expiresAt.toISOString(),
      created_by_user_id: actorUserId,
      idempotency_key: `reserve:${reservationId}`,
      reservation_channel: req.reservationChannel,
      authHeader,
      requestId: req.requestId,
    });
    reservationAccepted = true;

    try {
      const created = await prisma.$transaction(async (tx) => {
        // Re-check the membership limit atomically, serialized per customer: the count above
        // ran outside any lock, so two concurrent requests could both pass it and both reach
        // here. Throwing past the limit here is caught by the catch block below, which
        // releases the real stock hold taken by reserveStock().
        // $executeRaw (not $queryRaw): pg_advisory_xact_lock returns void, which Prisma's
        // $queryRaw cannot deserialize (P2010 "Failed to deserialize column of type 'void'").
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`membership-limit:${customer_id}`}, 0))`;

        // The same key committed while this request waited for the lock: that
        // reservation owns the stock hold, so replay it - never release it below.
        const sameKey = await findIdempotentReservation(tx, ids);
        if (sameKey) return { replay: sameKey };

        const [recheckLoanCount, recheckReservationCount] = await Promise.all([
          countActiveBorrowedItems(tx, customer_id),
          countActiveReservedItems(tx, customer_id),
        ]);
        if (recheckLoanCount + recheckReservationCount + normalizedQuantity > membershipInfo.limits.max_active_loans) {
          const limitError = new Error('Bạn đọc đã đạt số sách mượn tối đa theo gói thành viên');
          limitError.status = 409;
          throw limitError;
        }

        const recheckDuplicate = await tx.loan_reservations.count({
          where: { customer_id, variant_id, status: { in: ACTIVE_RESERVATION_STATUSES }, expires_at: { gt: new Date() } },
        });
        if (recheckDuplicate > 0) {
          const duplicateError = new Error(DUPLICATE_RESERVATION_MESSAGE);
          duplicateError.status = 409;
          throw duplicateError;
        }

        const reservation = await tx.loan_reservations.create({
          data: {
            id: reservationId,
            reservation_number: reservationNumber,
            customer_id,
            variant_id,
            warehouse_id,
            pickup_location_id: pickup_location_id || null,
            quantity: normalizedQuantity,
            source_channel: normalizedSource,
            status: 'PENDING',
            reserved_at: reservedAt,
            expires_at: expiresAt,
            notes: notes || null,
            created_by_user_id: actorUserId,
          },
        });

        await writeAuditLog(tx, {
          actor_user_id: actorUserId,
          action_name: 'CREATE_RESERVATION',
          entity_type: 'LOAN_RESERVATION',
          entity_id: reservation.id,
          after_data: {
            ...reservation,
            idempotency_key: idempotencyKey,
          },
        });

        await createNotificationRecord(tx, {
          customer_id,
          channel: 'IN_APP',
          template_code: 'RESERVATION_CREATED',
          subject: 'Đặt trước thành công',
          body: `Đặt trước ${reservation.reservation_number} đã được tạo thành công.`,
          reference_type: 'LOAN_RESERVATION',
          reference_id: reservation.id,
          metadata: {
            reservation_number: reservation.reservation_number,
            expires_at: reservation.expires_at,
          },
        });

        await completeBorrowOperation(tx, operation, { status: 201, body: { data: reservation } });
        return { reservation };
      });

      if (created.replay) return replayReservation(res, created.replay, fingerprint);
      return res.status(201).json({ data: created.reservation });
    } catch (error) {
      // Unique violation on the derived id: a concurrent request with the same key
      // (for another customer, so not serialized by the customer lock) won the
      // insert. Its reservation owns the stock hold - do not release it.
      if (error?.code === 'P2002') {
        const winner = await findIdempotentReservation(prisma, ids);
        if (winner) return replayReservation(res, winner, fingerprint);
      }

      // Only a known local validation refusal is safe to compensate. A lost DB
      // commit response is ambiguous: retain the approved create plan and retry.
      if (error.status !== 409) {
        await deferBorrowOperation(prisma, operation, error, req);
        return res.status(502).json({ message: 'Đặt trước đang được đối soát; hãy thử lại với cùng key.' });
      }
      const response = { status: 409, body: { message: error.message } };
      const undo = await prisma.$transaction(async tx => {
        const record = await queueReconciliation({ db: tx, aggregateId: reservationId, eventType: 'RELEASE_RESERVATION',
          payload: { reservation_id: reservationId, reason: 'ROLLBACK_AFTER_BORROW_TX_FAIL', idempotency_key: `rollback:${reservationId}` } });
        await completeBorrowOperation(tx, operation, response);
        return record;
      });
      try {
        await releaseReservation({ reservation_id: reservationId, reason: 'ROLLBACK_AFTER_BORROW_TX_FAIL',
          idempotency_key: `rollback:${reservationId}`, authHeader, requestId: req.requestId });
        await prisma.integration_outbox.update({ where: { id: undo.id }, data: { status: 'PUBLISHED', published_at: new Date() } });
      } catch { /* The independent undo record is durable and retryable. */ }
      return res.status(409).json(response.body);
    }
  } catch (error) {
    if (operation && error.status === 409 && !reservationAccepted && !operation.payload.remote_started) {
      const response = { status: 409, body: { message: error.message, code: 'BORROW_RESERVE_REFUSED' } };
      await prisma.$transaction(tx => completeBorrowOperation(tx, operation, response));
      return res.status(409).json(response.body);
    }
    await deferBorrowOperation(prisma, operation, error, req);
    // e.g. inventory refused availability because a concurrent request with this
    // key just took the last copy: that request's reservation is the answer.
    const replay = await findIdempotentReservation(prisma, ids).catch(() => null);
    if (replay) return replayReservation(res, replay, fingerprint);

    if (error?.status === 409) {
      return res.status(409).json({ message: error.message });
    }

    if (operation) return res.status(502).json({ message: 'Đặt trước đang được đối soát; hãy thử lại với cùng key.' });

    console.error('Error while creating reservation:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

async function cancelReservation(req, res) {
  const id = parseId(req.params.id);
  const actorUserId = req.user?.id || null;
  const authHeader = req.headers.authorization;
  // A status transition has no request payload to compare against a stored copy,
  // so dedup here is the existing-status short-circuit below, not a key lookup.
  // The key is still required and forwarded to inventory's releaseReservation,
  // whose own stock_movements.idempotency_key uniqueness makes that retry-safe.
  const idempotencyKey = parseIdempotencyKey(req);

  if (!id || !isUuid(id)) {
    return res.status(400).json({ message: 'Mã đặt trước không hợp lệ' });
  }

  if (!idempotencyKey) {
    return res.status(400).json({ message: 'Cần header Idempotency-Key khi hủy đặt trước' });
  }

  if (!approvedRecovery(req) && !isCustomerCaller(req)) {
    const target = await prisma.loan_reservations.findUnique({ where: { id }, select: { warehouse_id: true } });
    if (!target) {
      return res.status(404).json({ message: 'Không tìm thấy đặt trước' });
    }
    if (!(await requireWarehouseWriteAccess(req, res, target.warehouse_id))) return;
  }

  let operation;
  const operationRequest = { params: { id }, body: {} };
  try {
    const updated = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`reservation-state:${id}`}, 0))`;

      const existing = await tx.loan_reservations.findUnique({ where: { id } });
      if (!existing) {
        return { notFound: true };
      }

      if (existing.status === 'CANCELLED') {
        operation = await prepareBorrowOperationInTransaction(tx, { kind: 'CANCEL_RESERVATION', reference: id,
          key: idempotencyKey, request: operationRequest, user: req.user, ownedOperation: approvedRecovery(req), plan: { reservationId: id, warehouseId: existing.warehouse_id } });
        return { data: existing, idempotent: true, previous_status: existing.status };
      }

      if (!ACTIVE_RESERVATION_STATUSES.includes(existing.status)) {
        return { conflict: true, message: `Cannot cancel reservation from status ${existing.status}` };
      }

      if (new Date(existing.expires_at).getTime() <= Date.now()) {
        return { conflict: true, message: 'Cannot cancel reservation because it is already expired' };
      }
      const converting = await readBorrowOperation(tx, 'CONVERT_RESERVATION', id);
      if (converting && converting.status !== 'PUBLISHED' && converting.payload.remote_started) {
        return { conflict: true, message: 'Đặt trước có lượt chuyển mượn đang chờ đối soát, chưa thể giải phóng sách' };
      }

      const reservation = await tx.loan_reservations.update({
        where: { id },
        data: {
          status: 'CANCELLED',
        },
      });
      operation = await prepareBorrowOperationInTransaction(tx, { kind: 'CANCEL_RESERVATION', reference: id,
        key: idempotencyKey, request: operationRequest, user: req.user, ownedOperation: approvedRecovery(req), plan: { reservationId: id, warehouseId: existing.warehouse_id } });

      await writeAuditLog(tx, {
        actor_user_id: actorUserId,
        action_name: 'CANCEL_RESERVATION',
        entity_type: 'LOAN_RESERVATION',
        entity_id: reservation.id,
        before_data: existing,
        after_data: {
          ...reservation,
          idempotency_key: idempotencyKey,
        },
      });

      await createNotificationRecord(tx, {
        customer_id: reservation.customer_id,
        channel: 'IN_APP',
        template_code: 'RESERVATION_CANCELLED',
        subject: 'Đã hủy đặt trước',
        body: `Đặt trước ${reservation.reservation_number} đã được hủy.`,
        reference_type: 'LOAN_RESERVATION',
        reference_id: reservation.id,
      });

      return { data: reservation, previous_status: existing.status };
    }, { timeout: 30000 });

    if (updated.notFound) {
      return res.status(404).json({ message: 'Không tìm thấy đặt trước' });
    }

    if (updated.conflict) {
      return res.status(409).json({ message: updated.message });
    }

    if (operation?.status === 'PUBLISHED') return sendBorrowReplay(res, operation);
    if (operation) {
      try {
        await markBorrowRemoteStarted(prisma, operation);
        await releaseReservation({
          reservation_id: id,
          reason: 'CANCELLED',
          idempotency_key: boundedBorrowKey('', operation.payload.key),
          authHeader,
          requestId: req.requestId,
        });
      } catch (error) {
        await deferBorrowOperation(prisma, operation, error, req);

        return res.status(502).json({
          message: 'Đã hủy đặt trước; lượt giải phóng tồn kho đang chờ xác nhận và được đối soát tự động.',
        });
      }
      await prisma.$transaction(tx => completeBorrowOperation(tx, operation, { status: 200, body: { data: updated.data } }));
    }

    return res.json({ data: updated.data, idempotent: Boolean(updated.idempotent) });
  } catch (error) {
    if (error?.status === 409) {
      return res.status(409).json({ message: error.message });
    }
    console.error('Error while cancelling reservation:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

async function confirmReservation(req, res) {
  const id = parseId(req.params.id);
  const actorUserId = req.user?.id || null;
  const nextStatus = String(req.body?.status || 'CONFIRMED').trim().toUpperCase();
  const note = String(req.body?.notes || '').trim() || null;
  const idempotencyKey = parseIdempotencyKey(req);

  if (!id || !isUuid(id)) {
    return res.status(400).json({ message: 'Mã đặt trước không hợp lệ' });
  }

  if (!idempotencyKey) {
    return res.status(400).json({ message: 'Cần header Idempotency-Key khi xác nhận đặt trước' });
  }

  if (!['CONFIRMED', 'READY_FOR_PICKUP'].includes(nextStatus)) {
    return res.status(400).json({ message: 'status phải là CONFIRMED hoặc READY_FOR_PICKUP' });
  }

  const target = await prisma.loan_reservations.findUnique({ where: { id }, select: { warehouse_id: true } });
  if (!target) {
    return res.status(404).json({ message: 'Không tìm thấy đặt trước' });
  }
  if (!(await requireWarehouseWriteAccess(req, res, target.warehouse_id))) return;

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Row lock closes the race where two concurrent confirms both read PENDING
      // before either commits, which would otherwise double-write audit/notification
      // rows and race on which pickup_code wins.
      await tx.$queryRawUnsafe('SELECT id FROM loan_reservations WHERE id::text = $1 FOR UPDATE', id);
      const existing = await tx.loan_reservations.findUnique({ where: { id } });
      if (!existing) {
        return { code: 404, payload: { message: 'Không tìm thấy đặt trước' } };
      }

      if (existing.status === nextStatus && (nextStatus !== 'READY_FOR_PICKUP' || existing.pickup_code)) {
        return { code: 200, payload: { data: existing, idempotent: true } };
      }

      const canMoveToNextStatus =
        existing.status === 'PENDING'
        || (existing.status === 'CONFIRMED' && nextStatus === 'READY_FOR_PICKUP')
        || (existing.status === 'READY_FOR_PICKUP' && nextStatus === 'READY_FOR_PICKUP' && !existing.pickup_code);

      if (!canMoveToNextStatus) {
        return {
          code: 409,
          payload: { message: `Không thể xác nhận đặt trước ở trạng thái ${existing.status}` },
        };
      }

      if (new Date(existing.expires_at).getTime() <= Date.now()) {
        return {
          code: 409,
          payload: { message: 'Đặt trước đã hết hạn, không thể xác nhận' },
        };
      }

      // "Ready" means the librarian has the copies in hand: record the shelves they
      // came from, so inventory holds (and later lends out) stock from those shelves.
      let picks = null;
      if (nextStatus === 'READY_FOR_PICKUP') {
        const parsed = parsePicks(req.body?.picks, existing.quantity);
        if (parsed.error) return { code: 400, payload: { message: parsed.error } };
        picks = parsed.picks;
        try {
          await reallocateReservationStock({
            reservation_id: existing.id,
            warehouse_id: existing.warehouse_id,
            picks,
            idempotency_key: boundedBorrowKey('ready-pick:', idempotencyKey),
            handled_by_user_id: actorUserId,
            authHeader: req.headers.authorization,
            requestId: req.requestId,
          });
        } catch (error) {
          if (error.status >= 400 && error.status < 500) return { code: 409, payload: { message: error.message } };
          throw error;
        }
      }

      const pickupCode = nextStatus === 'READY_FOR_PICKUP'
        ? existing.pickup_code || await generateUniquePickupCode(tx)
        : null;
      const now = new Date();

      const reservation = await tx.loan_reservations.update({
        where: { id },
        data: {
          status: nextStatus,
          ...(pickupCode
            ? {
              pickup_code: pickupCode,
              pickup_code_issued_at: existing.pickup_code_issued_at || now,
              pickup_code_expires_at: existing.expires_at,
              pickup_code_used_at: null,
            }
            : {}),
          ...(note ? { notes: existing.notes ? `${existing.notes}\n${note}` : note } : {}),
          updated_at: now,
        },
      });

      await writeAuditLog(tx, {
        actor_user_id: actorUserId,
        action_name: nextStatus === 'READY_FOR_PICKUP' ? 'MARK_RESERVATION_READY' : 'CONFIRM_RESERVATION',
        entity_type: 'LOAN_RESERVATION',
        entity_id: reservation.id,
        before_data: existing,
        after_data: {
          ...reservation,
          idempotency_key: idempotencyKey,
          ...(picks ? { picks } : {}),
        },
      });

      await createNotificationRecord(tx, {
        customer_id: reservation.customer_id,
        channel: 'IN_APP',
        template_code: 'RESERVATION_CONFIRMED',
        subject: nextStatus === 'READY_FOR_PICKUP' ? 'Sách sẵn sàng để nhận' : 'Đặt trước đã được xác nhận',
        body: nextStatus === 'READY_FOR_PICKUP'
          ? `Đặt trước ${reservation.reservation_number} đã sẵn sàng để nhận. Mã nhận sách: ${reservation.pickup_code}.`
          : `Đặt trước ${reservation.reservation_number} đã được nhân viên xác nhận.`,
        reference_type: 'LOAN_RESERVATION',
        reference_id: reservation.id,
        metadata: {
          reservation_number: reservation.reservation_number,
          status: reservation.status,
          expires_at: reservation.expires_at,
          pickup_code: reservation.pickup_code,
          pickup_qr_value: createPickupQrValue(reservation.pickup_code),
        },
      });

      return { code: 200, payload: { data: reservation } };
    }, { timeout: 30000 }); // the "ready" step waits on inventory (10s cap) under the row lock

    return res.status(result.code).json(result.payload);
  } catch (error) {
    console.error('Error while confirming reservation:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

async function releaseExpiredReservation(reservation, options = {}) {
  const now = options.now || new Date();
  const idempotencyKey = `expire:${reservation.id}:${new Date(reservation.expires_at).getTime()}`;
  const reference = deterministicUuid(idempotencyKey);
  const request = { params: { id: reservation.id }, body: { expires_at: new Date(reservation.expires_at).toISOString() } };
  const user = options.operation?.payload.actor || { id: options.actorUserId || null, is_superuser: true, roles: [], permissions: [] };
  let operation;
  const result = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`reservation-state:${reservation.id}`}, 0))`;
    const current = await tx.loan_reservations.findUnique({ where: { id: reservation.id } });
    if (!current) return { skipped: true, reason: 'NOT_FOUND' };
    if (!ACTIVE_RESERVATION_STATUSES.includes(current.status) && current.status !== 'EXPIRED') return { skipped: true, reason: `STATUS_${current.status}` };
    if (new Date(current.expires_at).getTime() !== new Date(reservation.expires_at).getTime()
      || new Date(current.expires_at) > now) return { skipped: true, reason: 'EXPIRY_CHANGED' };
    const converting = await readBorrowOperation(tx, 'CONVERT_RESERVATION', current.id);
    if (converting && converting.status !== 'PUBLISHED' && converting.payload.remote_started) {
      throw Object.assign(new Error('Reservation conversion requires reconciliation before expiry release'), { status: 409 });
    }
    operation = await prepareBorrowOperationInTransaction(tx, { kind: 'EXPIRE_RESERVATION', reference,
      aggregateId: current.id, key: idempotencyKey, request, user, ownedOperation: options.operation, plan: { reservation: current } });
    if (current.status === 'EXPIRED') return { data: current, idempotent: true };
    const expired = await tx.loan_reservations.update({ where: { id: current.id }, data: { status: 'EXPIRED', updated_at: new Date() } });
    await writeAuditLog(tx, { actor_user_id: options.actorUserId || null, action_name: 'EXPIRE_RESERVATION',
      entity_type: 'LOAN_RESERVATION', entity_id: expired.id, before_data: current,
      after_data: { ...expired, idempotency_key: idempotencyKey } });
    await createNotificationRecord(tx, { customer_id: expired.customer_id, channel: 'IN_APP', template_code: 'RESERVATION_EXPIRED',
      subject: 'Đặt trước đã hết hạn', body: `Đặt trước ${expired.reservation_number} đã hết hạn.`,
      reference_type: 'LOAN_RESERVATION', reference_id: expired.id,
      metadata: { reservation_number: expired.reservation_number, expires_at: expired.expires_at } });
    return { data: expired };
  });
  if (result.skipped || operation.status === 'PUBLISHED') return result;
  try {
    await markBorrowRemoteStarted(prisma, operation);
    await releaseReservation({ reservation_id: reservation.id, reason: 'EXPIRED',
      idempotency_key: operation.payload.key, authHeader: options.authHeader });
    await prisma.$transaction(tx => completeBorrowOperation(tx, operation, { status: 200, body: result }));
    return result;
  } catch (error) {
    if (!options.operation) await deferBorrowOperation(prisma, operation, error);
    throw error;
  }
}

async function runExpiredReservationSweep(prismaClient = prisma, options = {}) {
  const now = options.now || new Date();
  const limit = Math.min(
    500,
    Math.max(1, Number.parseInt(String(options.limit || process.env.RESERVATION_EXPIRY_BATCH_SIZE || RESERVATION_EXPIRY_BATCH_SIZE), 10) || RESERVATION_EXPIRY_BATCH_SIZE)
  );

  const expiredReservations = await prismaClient.loan_reservations.findMany({
    where: {
      status: { in: ACTIVE_RESERVATION_STATUSES },
      expires_at: { lte: now },
    },
    orderBy: [{ expires_at: 'asc' }],
    take: limit,
  });

  const result = {
    scanned: expiredReservations.length,
    expired: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };

  for (const reservation of expiredReservations) {
    try {
      const released = await releaseExpiredReservation(reservation, {
        now,
        authHeader: options.authHeader,
        actorUserId: options.actorUserId || null,
      });

      if (released.skipped) {
        result.skipped += 1;
      } else {
        result.expired += 1;
      }
    } catch (error) {
      result.failed += 1;
      result.errors.push({
        reservation_id: reservation.id,
        message: error?.message || 'Unknown error',
      });
    }
  }

  return result;
}

async function runExpiredReservationSweepNow(req, res) {
  try {
    const result = await runExpiredReservationSweep(prisma, {
      limit: Number(req.body?.limit || req.query?.limit || RESERVATION_EXPIRY_BATCH_SIZE),
      authHeader: req.headers.authorization,
      actorUserId: req.user?.id || null,
    });

    return res.json({
      message: 'Expired reservation sweep completed',
      data: result,
    });
  } catch (error) {
    console.error('runExpiredReservationSweepNow error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

module.exports = {
  ACTIVE_RESERVATION_STATUSES,
  listReservations,
  getReservationById,
  createReservation,
  cancelReservation,
  confirmReservation,
  releaseExpiredReservation,
  runExpiredReservationSweep,
  runExpiredReservationSweepNow,
};
