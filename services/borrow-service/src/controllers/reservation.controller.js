const crypto = require('crypto');
const { prisma } = require('../lib/prisma');
const { resolveActiveMembership } = require('../services/membership.service');
const { checkAvailability, reserveStock, releaseReservation } = require('../services/inventory-integration.service');
const { writeAuditLog } = require('../lib/audit');
const { createNotificationRecord } = require('../lib/notifications');

const ACTIVE_RESERVATION_STATUSES = ['PENDING', 'CONFIRMED', 'READY_FOR_PICKUP'];

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

function deterministicUuid(seed) {
  const hash = crypto.createHash('sha256').update(seed).digest('hex');
  const chars = hash.slice(0, 32).split('');
  chars[12] = '4';
  chars[16] = ['8', '9', 'a', 'b'][parseInt(chars[16], 16) % 4];
  return `${chars.slice(0, 8).join('')}-${chars.slice(8, 12).join('')}-${chars.slice(12, 16).join('')}-${chars.slice(16, 20).join('')}-${chars.slice(20, 32).join('')}`;
}

async function listReservations(req, res) {
  const { status, customer_id } = req.query;
  const pagination = parsePagination(req.query);

  const where = {
    ...(typeof status === 'string' && status ? { status } : {}),
    ...(typeof customer_id === 'string' && customer_id ? { customer_id } : {}),
  };

  try {
    const [items, total] = await Promise.all([
      prisma.loan_reservations.findMany({
        where,
        orderBy: [{ reserved_at: 'desc' }],
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

  try {
    const customer = await prisma.customers.findUnique({ where: { id: customer_id } });
    if (!customer) {
      return res.status(404).json({ message: 'Customer not found' });
    }

    if (customer.status !== 'ACTIVE') {
      return res.status(409).json({ message: 'Customer is not eligible: status must be ACTIVE' });
    }

    if (Number(customer.total_fine_balance) > 0) {
      return res.status(409).json({
        message: 'Customer has unpaid fine balance',
        detail: { total_fine_balance: Number(customer.total_fine_balance) },
      });
    }

    const membershipInfo = await resolveActiveMembership(prisma, customer_id);
    if (!membershipInfo) {
      return res.status(409).json({ message: 'Customer does not have active membership' });
    }

    const [activeLoanCount, activeReservationCount] = await Promise.all([
      prisma.loan_transactions.count({
        where: {
          customer_id,
          status: { in: ['RESERVED', 'BORROWED', 'OVERDUE'] },
        },
      }),
      prisma.loan_reservations.count({
        where: {
          customer_id,
          status: { in: ACTIVE_RESERVATION_STATUSES },
          expires_at: { gt: new Date() },
        },
      }),
    ]);

    if (activeLoanCount + activeReservationCount + normalizedQuantity > membershipInfo.limits.max_active_loans) {
      return res.status(409).json({
        message: 'Customer exceeded max active loans limit by membership plan',
        detail: {
          max_active_loans: membershipInfo.limits.max_active_loans,
          active_loan_count: activeLoanCount,
          active_reservation_count: activeReservationCount,
        },
      });
    }

    const reservationId = deterministicUuid(`reservation:${idempotencyKey}`);
    const existingByIdempotency = await prisma.loan_reservations.findUnique({ where: { id: reservationId } });

    if (existingByIdempotency) {
      const samePayload =
        existingByIdempotency.customer_id === customer_id
        && existingByIdempotency.variant_id === variant_id
        && existingByIdempotency.warehouse_id === warehouse_id
        && existingByIdempotency.quantity === normalizedQuantity;

      if (!samePayload) {
        return res.status(409).json({ message: 'Idempotency-Key already used with a different payload' });
      }

      return res.status(200).json({ data: existingByIdempotency, idempotent: true });
    }

    await checkAvailability({
      variant_id,
      warehouse_id,
      quantity: normalizedQuantity,
      authHeader,
    });

    const reservationNumber = `RSV-${reservationId.slice(0, 8).toUpperCase()}`;
    const reservedAt = new Date();
    const expiresAt = new Date(reservedAt.getTime() + membershipInfo.limits.reservation_hold_hours * 60 * 60 * 1000);

    await reserveStock({
      reservation_id: reservationId,
      reservation_number: reservationNumber,
      customer_id,
      variant_id,
      warehouse_id,
      quantity: normalizedQuantity,
      expires_at: expiresAt.toISOString(),
      created_by_user_id: actorUserId,
      idempotency_key: idempotencyKey,
      authHeader,
    });

    try {
      const created = await prisma.$transaction(async (tx) => {
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
          subject: 'Reservation created',
          body: `Reservation ${reservation.reservation_number} has been created successfully.`,
          reference_type: 'LOAN_RESERVATION',
          reference_id: reservation.id,
          metadata: {
            reservation_number: reservation.reservation_number,
            expires_at: reservation.expires_at,
          },
        });

        return reservation;
      });

      return res.status(201).json({ data: created });
    } catch (error) {
      let releaseError = null;
      try {
        await releaseReservation({
          reservation_id: reservationId,
          reason: 'ROLLBACK_AFTER_BORROW_TX_FAIL',
          idempotency_key: `rollback:${idempotencyKey}`,
          authHeader,
        });
      } catch (inner) {
        releaseError = inner;
      }

      if (releaseError) {
        console.error('Reservation create rollback failed:', releaseError);
        return res.status(502).json({
          message: 'Reservation persistence failed and compensation release also failed. Manual reconciliation required.',
        });
      }

      throw error;
    }
  } catch (error) {
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
        subject: 'Reservation cancelled',
        body: `Reservation ${reservation.reservation_number} has been cancelled.`,
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

module.exports = {
  listReservations,
  getReservationById,
  createReservation,
  cancelReservation,
};
