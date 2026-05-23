const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

function parsePositiveInteger(value, fallback = 1) {
  const parsed = Number.parseInt(String(value ?? fallback), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ''));
}

function createMovementNumber(baseTimestamp, index) {
  return `BV-${baseTimestamp}-${index + 1}`;
}

function createFallbackIdempotencyKey(prefix, id) {
  return `${prefix}:${id}`;
}

async function searchBorrowVariants(req, res) {
  const keyword = String(req.query.q || '').trim();
  const limit = Math.min(20, Math.max(1, Number.parseInt(String(req.query.limit || '8'), 10) || 8));

  if (keyword.length < 2) {
    return res.json({ data: [] });
  }

  try {
    const variants = await prisma.book_variants.findMany({
      where: {
        is_active: true,
        is_borrowable: true,
        OR: [
          { sku: { contains: keyword, mode: 'insensitive' } },
          { isbn13: { contains: keyword, mode: 'insensitive' } },
          { isbn10: { contains: keyword, mode: 'insensitive' } },
          { internal_barcode: { contains: keyword, mode: 'insensitive' } },
          {
            books: {
              title: { contains: keyword, mode: 'insensitive' },
            },
          },
        ],
      },
      select: {
        id: true,
        sku: true,
        isbn13: true,
        isbn10: true,
        internal_barcode: true,
        books: {
          select: {
            title: true,
          },
        },
      },
      orderBy: [{ updated_at: 'desc' }],
      take: limit,
    });

    return res.json({
      data: variants.map((variant) => ({
        id: variant.id,
        title: variant.books?.title || 'Untitled',
        sku: variant.sku,
        isbn: variant.isbn13 || variant.isbn10 || null,
        internal_barcode: variant.internal_barcode || null,
      })),
    });
  } catch (error) {
    console.error('Error while searching borrow variants:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

async function listBorrowWarehouses(req, res) {
  const keyword = String(req.query.q || '').trim();
  const limit = Math.min(20, Math.max(1, Number.parseInt(String(req.query.limit || '8'), 10) || 8));

  const where = {
    is_active: true,
    ...(keyword
      ? {
          OR: [
            { name: { contains: keyword, mode: 'insensitive' } },
            { code: { contains: keyword, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  try {
    const warehouses = await prisma.warehouses.findMany({
      where,
      select: {
        id: true,
        name: true,
        code: true,
        warehouse_type: true,
      },
      orderBy: [{ name: 'asc' }],
      take: limit,
    });

    return res.json({ data: warehouses });
  } catch (error) {
    console.error('Error while listing borrow warehouses:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

async function getAvailability(req, res) {
  const { variant_id, warehouse_id } = req.query;
  const quantity = parsePositiveInteger(req.query.quantity, 1);

  if (!variant_id || !warehouse_id || !quantity) {
    return res.status(400).json({ message: 'variant_id, warehouse_id and quantity > 0 are required' });
  }

  if (![variant_id, warehouse_id].every(isUuid)) {
    return res.status(400).json({ message: 'variant_id and warehouse_id must be valid UUID values' });
  }

  try {
    const balances = await prisma.stock_balances.findMany({
      where: {
        variant_id: String(variant_id),
        warehouse_id: String(warehouse_id),
      },
      select: {
        id: true,
        location_id: true,
        available_qty: true,
        reserved_qty: true,
      },
      orderBy: [{ available_qty: 'desc' }],
    });

    const totalAvailable = balances.reduce((sum, row) => sum + row.available_qty, 0);

    if (totalAvailable < quantity) {
      return res.status(409).json({
        message: 'Insufficient available stock',
        data: {
          total_available: totalAvailable,
          requested_quantity: quantity,
        },
      });
    }

    return res.json({
      data: {
        variant_id: String(variant_id),
        warehouse_id: String(warehouse_id),
        total_available: totalAvailable,
        requested_quantity: quantity,
        suggested_location_id: balances[0]?.location_id || null,
      },
    });
  } catch (error) {
    console.error('Error while checking borrow availability:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

async function reserveFromBorrow(req, res) {
  const {
    reservation_id,
    reservation_number,
    customer_id,
    variant_id,
    warehouse_id,
    quantity,
    expires_at,
    created_by_user_id,
    idempotency_key,
  } = req.body;

  const normalizedQuantity = parsePositiveInteger(quantity, 1);
  const movementIdempotency = String(idempotency_key || createFallbackIdempotencyKey('reserve', reservation_id || 'unknown'));

  if (!reservation_id || !reservation_number || !variant_id || !warehouse_id || !normalizedQuantity || !expires_at) {
    return res.status(400).json({
      message: 'reservation_id, reservation_number, variant_id, warehouse_id, quantity and expires_at are required',
    });
  }

  if (![reservation_id, variant_id, warehouse_id].every(isUuid)) {
    return res.status(400).json({ message: 'reservation_id, variant_id and warehouse_id must be valid UUID values' });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.stock_reservations.findFirst({
        where: {
          source_service: 'BORROW',
          source_reference_id: reservation_id,
          status: 'ACTIVE',
        },
      });

      if (existing) {
        return { alreadyReserved: true, reservation: existing };
      }

      const movementByKey = await tx.stock_movements.findUnique({ where: { idempotency_key: movementIdempotency } });
      if (movementByKey) {
        const reservationByReference = await tx.stock_reservations.findFirst({
          where: {
            source_service: 'BORROW',
            source_reference_id: reservation_id,
          },
          orderBy: [{ created_at: 'desc' }],
        });

        if (reservationByReference) {
          return { alreadyReserved: true, reservation: reservationByReference };
        }
      }

      const variant = await tx.book_variants.findUnique({
        where: { id: variant_id },
        select: { id: true, is_borrowable: true },
      });

      if (!variant || !variant.is_borrowable) {
        throw new Error('VARIANT_NOT_BORROWABLE');
      }

      const balance = await tx.stock_balances.findFirst({
        where: {
          variant_id,
          warehouse_id,
          available_qty: { gte: normalizedQuantity },
        },
        orderBy: [{ available_qty: 'desc' }],
      });

      if (!balance) {
        throw new Error('INSUFFICIENT_AVAILABLE_STOCK');
      }

      await tx.stock_balances.update({
        where: {
          variant_id_location_id: {
            variant_id,
            location_id: balance.location_id,
          },
        },
        data: {
          available_qty: { decrement: normalizedQuantity },
          reserved_qty: { increment: normalizedQuantity },
          last_movement_at: new Date(),
        },
      });

      const stockReservation = await tx.stock_reservations.create({
        data: {
          reservation_code: reservation_number,
          variant_id,
          warehouse_id,
          location_id: balance.location_id,
          customer_id: customer_id || null,
          source_service: 'BORROW',
          source_reference_id: reservation_id,
          quantity: normalizedQuantity,
          status: 'ACTIVE',
          expires_at: new Date(expires_at),
          created_by_user_id: created_by_user_id || null,
        },
      });

      await tx.stock_movements.create({
        data: {
          movement_number: createMovementNumber(Date.now(), 0),
          movement_type: 'RESERVE',
          movement_status: 'POSTED',
          warehouse_id,
          variant_id,
          from_location_id: balance.location_id,
          to_location_id: balance.location_id,
          quantity: normalizedQuantity,
          unit_cost: 0,
          source_service: 'BORROW_SERVICE',
          reference_type: 'LOAN_RESERVATION',
          reference_id: reservation_id,
          idempotency_key: movementIdempotency,
          created_by_user_id: created_by_user_id || null,
          metadata: {
            reservation_number,
            customer_id: customer_id || null,
          },
        },
      });

      return { reservation: stockReservation };
    });

    return res.status(result.alreadyReserved ? 200 : 201).json({
      data: result.reservation,
      idempotent: Boolean(result.alreadyReserved),
    });
  } catch (error) {
    if (error.message === 'VARIANT_NOT_BORROWABLE') {
      return res.status(409).json({ message: 'Variant is not borrowable' });
    }
    if (error.message === 'INSUFFICIENT_AVAILABLE_STOCK') {
      return res.status(409).json({ message: 'Insufficient available stock to reserve' });
    }
    if (error.code === 'P2002') {
      return res.status(409).json({ message: 'Reservation already exists' });
    }

    console.error('Error while reserving stock for borrow:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

async function releaseBorrowReservation(req, res) {
  const { reservation_id, reason, idempotency_key } = req.body;

  if (!reservation_id) {
    return res.status(400).json({ message: 'reservation_id is required' });
  }

  if (!isUuid(reservation_id)) {
    return res.status(400).json({ message: 'reservation_id must be a valid UUID value' });
  }

  const movementIdempotency = String(idempotency_key || createFallbackIdempotencyKey('release', reservation_id));
  const releaseReason = String(reason || 'RELEASED').toUpperCase();
  const targetStatus = ['EXPIRED', 'CANCELLED', 'RELEASED'].includes(releaseReason) ? releaseReason : 'RELEASED';

  try {
    const result = await prisma.$transaction(async (tx) => {
      const movementByKey = await tx.stock_movements.findUnique({ where: { idempotency_key: movementIdempotency } });
      if (movementByKey) {
        const alreadyUpdated = await tx.stock_reservations.findFirst({
          where: {
            source_service: 'BORROW',
            source_reference_id: reservation_id,
          },
          orderBy: [{ updated_at: 'desc' }],
        });
        return { data: alreadyUpdated || null, idempotent: true };
      }

      const reservation = await tx.stock_reservations.findFirst({
        where: {
          source_service: 'BORROW',
          source_reference_id: reservation_id,
          status: 'ACTIVE',
        },
      });

      if (!reservation) {
        return { data: null, idempotent: true };
      }

      if (!reservation.location_id) {
        throw new Error('RESERVATION_LOCATION_MISSING');
      }

      await tx.stock_balances.update({
        where: {
          variant_id_location_id: {
            variant_id: reservation.variant_id,
            location_id: reservation.location_id,
          },
        },
        data: {
          available_qty: { increment: reservation.quantity },
          reserved_qty: { decrement: reservation.quantity },
          last_movement_at: new Date(),
        },
      });

      const updated = await tx.stock_reservations.update({
        where: { id: reservation.id },
        data: {
          status: targetStatus,
        },
      });

      await tx.stock_movements.create({
        data: {
          movement_number: createMovementNumber(Date.now(), 0),
          movement_type: 'RELEASE',
          movement_status: 'POSTED',
          warehouse_id: reservation.warehouse_id,
          variant_id: reservation.variant_id,
          from_location_id: reservation.location_id,
          to_location_id: reservation.location_id,
          quantity: reservation.quantity,
          unit_cost: 0,
          source_service: 'BORROW_SERVICE',
          reference_type: 'LOAN_RESERVATION',
          reference_id: reservation_id,
          idempotency_key: movementIdempotency,
          created_by_user_id: req.user?.id || null,
          metadata: {
            reason: targetStatus,
            reservation_code: reservation.reservation_code,
          },
        },
      });

      return { data: updated };
    });

    return res.json(result);
  } catch (error) {
    if (error.message === 'RESERVATION_LOCATION_MISSING') {
      return res.status(409).json({ message: 'Reservation location is missing and cannot be released safely' });
    }
    console.error('Error while releasing borrow reservation:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

async function consumeBorrowReservation(req, res) {
  const {
    reservation_id,
    loan_id,
    loan_number,
    warehouse_id,
    idempotency_key,
    handled_by_user_id,
  } = req.body;

  if (!reservation_id || !loan_id || !loan_number || !warehouse_id) {
    return res.status(400).json({ message: 'reservation_id, loan_id, loan_number and warehouse_id are required' });
  }

  if (![reservation_id, loan_id, warehouse_id].every(isUuid)) {
    return res.status(400).json({ message: 'reservation_id, loan_id and warehouse_id must be valid UUID values' });
  }

  const movementIdempotency = String(idempotency_key || createFallbackIdempotencyKey('consume', reservation_id));

  try {
    const result = await prisma.$transaction(async (tx) => {
      const movementByKey = await tx.stock_movements.findUnique({ where: { idempotency_key: movementIdempotency } });
      if (movementByKey) {
        return { idempotent: true, data: movementByKey };
      }

      const reservation = await tx.stock_reservations.findFirst({
        where: {
          source_service: 'BORROW',
          source_reference_id: reservation_id,
          status: 'ACTIVE',
        },
      });

      if (!reservation) {
        throw new Error('RESERVATION_NOT_ACTIVE');
      }

      if (!reservation.location_id) {
        throw new Error('RESERVATION_LOCATION_MISSING');
      }

      await tx.stock_balances.update({
        where: {
          variant_id_location_id: {
            variant_id: reservation.variant_id,
            location_id: reservation.location_id,
          },
        },
        data: {
          reserved_qty: { decrement: reservation.quantity },
          borrowed_qty: { increment: reservation.quantity },
          last_movement_at: new Date(),
        },
      });

      await tx.stock_reservations.update({
        where: { id: reservation.id },
        data: {
          status: 'CONSUMED',
        },
      });

      const movement = await tx.stock_movements.create({
        data: {
          movement_number: createMovementNumber(Date.now(), 0),
          movement_type: 'BORROW',
          movement_status: 'POSTED',
          warehouse_id,
          variant_id: reservation.variant_id,
          from_location_id: reservation.location_id,
          to_location_id: null,
          quantity: reservation.quantity,
          unit_cost: 0,
          source_service: 'BORROW_SERVICE',
          reference_type: 'LOAN_TRANSACTION',
          reference_id: loan_id,
          idempotency_key: movementIdempotency,
          created_by_user_id: handled_by_user_id || req.user?.id || null,
          metadata: {
            loan_number,
            reservation_id,
          },
        },
      });

      return { data: movement, idempotent: false };
    });

    return res.status(result.idempotent ? 200 : 201).json(result);
  } catch (error) {
    if (error.message === 'RESERVATION_NOT_ACTIVE') {
      return res.status(409).json({ message: 'Reservation is not ACTIVE in inventory and cannot be consumed' });
    }
    if (error.message === 'RESERVATION_LOCATION_MISSING') {
      return res.status(409).json({ message: 'Reservation location is missing and cannot be consumed safely' });
    }
    console.error('Error while consuming borrow reservation:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

async function returnBorrowedLoan(req, res) {
  const {
    loan_id,
    loan_item_id,
    variant_id,
    warehouse_id,
    quantity,
    location_id,
    inventory_unit_id,
    idempotency_key,
    handled_by_user_id,
  } = req.body;

  const normalizedQuantity = parsePositiveInteger(quantity, 1);

  if (!loan_id || !variant_id || !warehouse_id || !normalizedQuantity) {
    return res.status(400).json({ message: 'loan_id, variant_id, warehouse_id and quantity are required' });
  }

  if (![loan_id, variant_id, warehouse_id].every(isUuid)) {
    return res.status(400).json({ message: 'loan_id, variant_id and warehouse_id must be valid UUID values' });
  }

  if (loan_item_id && !isUuid(loan_item_id)) {
    return res.status(400).json({ message: 'loan_item_id must be a valid UUID when provided' });
  }

  if (location_id && !isUuid(location_id)) {
    return res.status(400).json({ message: 'location_id must be a valid UUID when provided' });
  }

  if (inventory_unit_id && !isUuid(inventory_unit_id)) {
    return res.status(400).json({ message: 'inventory_unit_id must be a valid UUID when provided' });
  }

  const movementIdempotency = String(idempotency_key || createFallbackIdempotencyKey('return', loan_item_id || loan_id));

  try {
    const result = await prisma.$transaction(async (tx) => {
      const movementByKey = await tx.stock_movements.findUnique({ where: { idempotency_key: movementIdempotency } });
      if (movementByKey) {
        return { data: movementByKey, idempotent: true };
      }

      const balance = await tx.stock_balances.findFirst({
        where: {
          variant_id,
          warehouse_id,
          borrowed_qty: { gte: normalizedQuantity },
          ...(location_id ? { location_id } : {}),
        },
        orderBy: [{ borrowed_qty: 'desc' }],
      });

      if (!balance) {
        throw new Error('BORROWED_STOCK_NOT_FOUND');
      }

      await tx.stock_balances.update({
        where: {
          variant_id_location_id: {
            variant_id,
            location_id: balance.location_id,
          },
        },
        data: {
          borrowed_qty: { decrement: normalizedQuantity },
          available_qty: { increment: normalizedQuantity },
          last_movement_at: new Date(),
        },
      });

      if (inventory_unit_id) {
        await tx.inventory_units.update({
          where: { id: inventory_unit_id },
          data: {
            status: 'AVAILABLE',
            current_location_id: balance.location_id,
            last_seen_at: new Date(),
          },
        }).catch(() => undefined);
      }

      const movement = await tx.stock_movements.create({
        data: {
          movement_number: createMovementNumber(Date.now(), 0),
          movement_type: 'RETURN',
          movement_status: 'POSTED',
          warehouse_id,
          variant_id,
          inventory_unit_id: inventory_unit_id || null,
          from_location_id: balance.location_id,
          to_location_id: balance.location_id,
          quantity: normalizedQuantity,
          unit_cost: 0,
          source_service: 'BORROW_SERVICE',
          reference_type: 'LOAN_TRANSACTION',
          reference_id: loan_id,
          idempotency_key: movementIdempotency,
          created_by_user_id: handled_by_user_id || req.user?.id || null,
          metadata: {
            loan_item_id: loan_item_id || null,
          },
        },
      });

      return { data: movement, idempotent: false };
    });

    return res.status(result.idempotent ? 200 : 201).json(result);
  } catch (error) {
    if (error.message === 'BORROWED_STOCK_NOT_FOUND') {
      return res.status(409).json({ message: 'No borrowed stock available to return for this variant/warehouse' });
    }
    console.error('Error while returning borrowed stock:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

module.exports = {
  searchBorrowVariants,
  listBorrowWarehouses,
  getAvailability,
  reserveFromBorrow,
  releaseBorrowReservation,
  consumeBorrowReservation,
  returnBorrowedLoan,
};
