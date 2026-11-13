const { deterministicUuid } = require('@smartbook/shared/runtime');
const { prisma } = require('../lib/prisma');
const { resolveActiveMembership } = require('../services/membership.service');
const { checkAvailability, reserveStock, releaseReservation } = require('../services/inventory-integration.service');
const { compensateWithRetry } = require('../services/reconciliation.service');
const { writeAuditLog } = require('../lib/audit');
const { createNotificationRecord } = require('../lib/notifications');
const { createPickupQrValue, generateUniquePickupCode } = require('../utils/pickup-code');
const { parseStatusFilter, searchTerm, countByStatus } = require('../lib/list-query');

const ACTIVE_RESERVATION_STATUSES = ['PENDING', 'CONFIRMED', 'READY_FOR_PICKUP'];
const DUPLICATE_RESERVATION_MESSAGE = 'Khách đã có một đặt chỗ đang hoạt động cho cuốn sách này';
const RESERVATION_EXPIRY_BATCH_SIZE = 100;

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ''));
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

  // Everything except the status condition; per-status counts are taken over this.
  const whereWithoutStatus = {
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

  try {
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
    console.error('Error while listing reservations:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

async function getReservationById(req, res) {
  const id = parseId(req.params.id);
  if (!id || !isUuid(id)) {
    return res.status(400).json({ message: 'Invalid reservation id' });
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
      return res.status(404).json({ message: 'Reservation not found' });
    }

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
      message: 'Idempotency-Key already used with a different payload',
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
    return { status: 404, body: { message: 'Customer not found' } };
  }
  if (customer.status !== 'ACTIVE') {
    return { status: 409, body: { message: 'Customer is not eligible: status must be ACTIVE' } };
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
    return { status: 409, body: { message: 'Customer does not have active membership' } };
  }

  const [activeLoanCount, activeReservationCount] = await Promise.all([
    prisma.loan_transactions.count({
      where: { customer_id, status: { in: ['RESERVED', 'BORROWED', 'OVERDUE'] } },
    }),
    prisma.loan_reservations.count({
      where: { customer_id, status: { in: ACTIVE_RESERVATION_STATUSES }, expires_at: { gt: new Date() } },
    }),
  ]);
  if (activeLoanCount + activeReservationCount + quantity > membershipInfo.limits.max_active_loans) {
    return {
      status: 409,
      body: {
        message: 'Customer exceeded max active loans limit by membership plan',
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
    return res.status(400).json({ message: 'customer_id, variant_id and warehouse_id are required' });
  }

  if (!idempotencyKey) {
    return res.status(400).json({ message: 'Idempotency-Key header is required for reservation creation' });
  }

  if (![customer_id, variant_id, warehouse_id].every(isUuid)) {
    return res.status(400).json({ message: 'customer_id, variant_id and warehouse_id must be valid UUID values' });
  }

  if (pickup_location_id && !isUuid(pickup_location_id)) {
    return res.status(400).json({ message: 'pickup_location_id must be a valid UUID when provided' });
  }

  const normalizedQuantity = Number.parseInt(String(quantity || '1'), 10);
  if (!Number.isInteger(normalizedQuantity) || normalizedQuantity <= 0) {
    return res.status(400).json({ message: 'quantity must be a positive integer' });
  }

  const normalizedSource = source_channel || 'WEB';
  if (!['WEB', 'MOBILE', 'COUNTER', 'ADMIN'].includes(normalizedSource)) {
    return res.status(400).json({ message: 'Invalid source_channel' });
  }

  const fingerprint = { customer_id, variant_id, warehouse_id, quantity: normalizedQuantity };
  const ids = { ...reservationIdsFor(actorUserId, idempotencyKey), actorUserId };
  const { reservationId } = ids;

  try {
    // Idempotency BEFORE the business rules: a retry of a request that already
    // created its reservation must get that reservation back, even when the
    // reservation itself now makes the membership limit or the one-per-book rule
    // refuse a new one (or the membership changed since).
    const existingByIdempotency = await findIdempotentReservation(prisma, ids);
    if (existingByIdempotency) {
      return replayReservation(res, existingByIdempotency, fingerprint);
    }

    const precheck = await reservationRefusal(fingerprint);
    if (precheck.status) {
      // A concurrent request with this key may have committed since the lookup
      // above - its reservation is then exactly what refused this one.
      const committedMeanwhile = await findIdempotentReservation(prisma, ids);
      if (committedMeanwhile) return replayReservation(res, committedMeanwhile, fingerprint);
      return res.status(precheck.status).json(precheck.body);
    }
    const { membershipInfo } = precheck;

    await checkAvailability({
      variant_id,
      warehouse_id,
      quantity: normalizedQuantity,
      reservation_channel: req.reservationChannel,
      authHeader,
      requestId: req.requestId,
    });

    const reservationNumber = `RSV-${reservationId.slice(0, 8).toUpperCase()}`;
    const reservedAt = new Date();
    const expiresAt = new Date(reservedAt.getTime() + membershipInfo.limits.reservation_hold_hours * 60 * 60 * 1000);

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
          tx.loan_transactions.count({
            where: { customer_id, status: { in: ['RESERVED', 'BORROWED', 'OVERDUE'] } },
          }),
          tx.loan_reservations.count({
            where: { customer_id, status: { in: ACTIVE_RESERVATION_STATUSES }, expires_at: { gt: new Date() } },
          }),
        ]);
        if (recheckLoanCount + recheckReservationCount + normalizedQuantity > membershipInfo.limits.max_active_loans) {
          const limitError = new Error('Customer exceeded max active loans limit by membership plan');
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

      const rollbackReason = 'ROLLBACK_AFTER_BORROW_TX_FAIL';
      const compensation = await compensateWithRetry(
        () => releaseReservation({
          reservation_id: reservationId,
          reason: rollbackReason,
          idempotency_key: `rollback:${reservationId}`,
          authHeader,
          requestId: req.requestId,
        }),
        {
          aggregateId: reservationId,
          eventType: 'RELEASE_RESERVATION',
          payload: { reservation_id: reservationId, reason: rollbackReason },
        },
      );

      if (!compensation.ok) {
        return res.status(502).json({
          message: 'Reservation persistence failed; compensation queued for automatic retry (reconciliation job).',
        });
      }

      throw error;
    }
  } catch (error) {
    // e.g. inventory refused availability because a concurrent request with this
    // key just took the last copy: that request's reservation is the answer.
    const replay = await findIdempotentReservation(prisma, ids).catch(() => null);
    if (replay) return replayReservation(res, replay, fingerprint);

    if (error?.status === 409) {
      return res.status(409).json({ message: error.message });
    }

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
    return res.status(400).json({ message: 'Invalid reservation id' });
  }

  if (!idempotencyKey) {
    return res.status(400).json({ message: 'Idempotency-Key header is required for reservation cancellation' });
  }

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const existing = await tx.loan_reservations.findUnique({ where: { id } });
      if (!existing) {
        return { notFound: true };
      }

      if (existing.status === 'CANCELLED') {
        return { data: existing, idempotent: true, previous_status: existing.status };
      }

      if (!ACTIVE_RESERVATION_STATUSES.includes(existing.status)) {
        return { conflict: true, message: `Cannot cancel reservation from status ${existing.status}` };
      }

      if (new Date(existing.expires_at).getTime() <= Date.now()) {
        return { conflict: true, message: 'Cannot cancel reservation because it is already expired' };
      }

      const reservation = await tx.loan_reservations.update({
        where: { id },
        data: {
          status: 'CANCELLED',
        },
      });

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
    });

    if (updated.notFound) {
      return res.status(404).json({ message: 'Reservation not found' });
    }

    if (updated.conflict) {
      return res.status(409).json({ message: updated.message });
    }

    if (!updated.idempotent) {
      try {
        await releaseReservation({
          reservation_id: id,
          reason: 'CANCELLED',
          idempotency_key: idempotencyKey,
          authHeader,
          requestId: req.requestId,
        });
      } catch (error) {
        await prisma.$transaction(async (tx) => {
          const rollbackTarget = await tx.loan_reservations.findUnique({ where: { id } });
          if (rollbackTarget && rollbackTarget.status === 'CANCELLED') {
            const restored = await tx.loan_reservations.update({
              where: { id },
              data: { status: updated.previous_status },
            });

            await writeAuditLog(tx, {
              actor_user_id: actorUserId,
              action_name: 'ROLLBACK_CANCEL_RESERVATION',
              entity_type: 'LOAN_RESERVATION',
              entity_id: id,
              before_data: rollbackTarget,
              after_data: {
                ...restored,
                reason: 'inventory_release_failed',
              },
            });
          }
        });

        return res.status(502).json({
          message: 'Reservation cancellation failed because inventory release failed. State has been rolled back.',
        });
      }
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
    return res.status(400).json({ message: 'Invalid reservation id' });
  }

  if (!idempotencyKey) {
    return res.status(400).json({ message: 'Idempotency-Key header is required for reservation confirmation' });
  }

  if (!['CONFIRMED', 'READY_FOR_PICKUP'].includes(nextStatus)) {
    return res.status(400).json({ message: 'status must be CONFIRMED or READY_FOR_PICKUP' });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Row lock closes the race where two concurrent confirms both read PENDING
      // before either commits, which would otherwise double-write audit/notification
      // rows and race on which pickup_code wins.
      await tx.$queryRawUnsafe('SELECT id FROM loan_reservations WHERE id::text = $1 FOR UPDATE', id);
      const existing = await tx.loan_reservations.findUnique({ where: { id } });
      if (!existing) {
        return { code: 404, payload: { message: 'Reservation not found' } };
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
          payload: { message: `Cannot confirm reservation from status ${existing.status}` },
        };
      }

      if (new Date(existing.expires_at).getTime() <= Date.now()) {
        return {
          code: 409,
          payload: { message: 'Reservation already expired and cannot be confirmed' },
        };
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
    });

    return res.status(result.code).json(result.payload);
  } catch (error) {
    console.error('Error while confirming reservation:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

async function releaseExpiredReservation(reservation, options = {}) {
  const idempotencyKey = `expire:${reservation.id}:${new Date(reservation.expires_at).getTime()}`;

  await releaseReservation({
    reservation_id: reservation.id,
    reason: 'EXPIRED',
    idempotency_key: idempotencyKey,
    authHeader: options.authHeader,
  });

  return prisma.$transaction(async (tx) => {
    const current = await tx.loan_reservations.findUnique({ where: { id: reservation.id } });
    if (!current) {
      return { skipped: true, reason: 'NOT_FOUND' };
    }

    if (!ACTIVE_RESERVATION_STATUSES.includes(current.status)) {
      return { skipped: true, reason: `STATUS_${current.status}`, data: current };
    }

    const expired = await tx.loan_reservations.update({
      where: { id: current.id },
      data: {
        status: 'EXPIRED',
        updated_at: new Date(),
      },
    });

    await writeAuditLog(tx, {
      actor_user_id: options.actorUserId || null,
      action_name: 'EXPIRE_RESERVATION',
      entity_type: 'LOAN_RESERVATION',
      entity_id: expired.id,
      before_data: current,
      after_data: {
        ...expired,
        idempotency_key: idempotencyKey,
      },
    });

    await createNotificationRecord(tx, {
      customer_id: expired.customer_id,
      channel: 'IN_APP',
      template_code: 'RESERVATION_EXPIRED',
      subject: 'Đặt trước đã hết hạn',
      body: `Đặt trước ${expired.reservation_number} đã hết hạn và sách giữ chỗ đã được trả về kho.`,
      reference_type: 'LOAN_RESERVATION',
      reference_id: expired.id,
      metadata: {
        reservation_number: expired.reservation_number,
        expires_at: expired.expires_at,
      },
    });

    return { data: expired };
  });
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
  runExpiredReservationSweep,
  runExpiredReservationSweepNow,
};
