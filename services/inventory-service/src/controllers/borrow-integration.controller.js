const { RequestBindingError, reserveIdentity, assertReserveReplay } = require('../services/request-binding.service');
const { releaseReservedStock, consumeReservedStock } = require('../services/borrow-reservation-guard.service');
const { reservationCreatedCounter, reservationConflictCounter, recordStockMutation } = require('../lib/metrics');
const { isPublicPickupWarehouse } = require('../utils/public-pickup-warehouse');
const { readPublicAvailabilityByBook, readPublicAvailabilityByVariant } = require('../services/public-catalog.service');

const { prisma } = require('../lib/prisma');

// Borrow-service marks reservations a reader makes for themselves (/my/reservations)
// with this channel: those may only be picked up at a reader-facing location. Staff
// flows (counter loans, reservations made on a customer's behalf) send no channel and
// keep access to every warehouse.
const CUSTOMER_RESERVATION_CHANNEL = 'CUSTOMER';
const INVALID_PICKUP_WAREHOUSE_MESSAGE = 'Chi nhánh đã chọn không phải điểm nhận sách hợp lệ';

function isCustomerReservation(channel) {
  return String(channel || '').trim().toUpperCase() === CUSTOMER_RESERVATION_CHANNEL;
}

async function isValidPickupWarehouse(db, warehouseId) {
  const warehouse = await db.warehouses.findUnique({
    where: { id: warehouseId },
    select: { is_active: true, warehouse_type: true },
  });
  return isPublicPickupWarehouse(warehouse);
}

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

function requireIdempotencyKey(res, idempotency_key) {
  if (!idempotency_key || typeof idempotency_key !== 'string' || !idempotency_key.trim()) {
    res.status(400).json({ message: 'Thiếu idempotency_key' });
    return null;
  }
  return idempotency_key.trim();
}

function borrowRequestIdentity(operation, body) {
  if (operation === 'release') {
    const reason = String(body.reason || 'RELEASED').toUpperCase();
    return { operation, reservation_id: body.reservation_id, reason: ['EXPIRED', 'CANCELLED', 'RELEASED'].includes(reason) ? reason : 'RELEASED', warehouse_id: body.warehouse_id || null, variant_id: body.variant_id || null, quantity: body.quantity == null ? null : Number(body.quantity) };
  }
  if (operation === 'consume') {
    return { operation, reservation_id: body.reservation_id, loan_id: body.loan_id, loan_number: body.loan_number, warehouse_id: body.warehouse_id, variant_id: body.variant_id || null, quantity: body.quantity == null ? null : Number(body.quantity) };
  }
  const condition = String(body.item_condition_on_return || 'GOOD').trim().toUpperCase();
  return { operation, loan_id: body.loan_id, loan_item_id: body.loan_item_id || null, variant_id: body.variant_id, warehouse_id: body.warehouse_id, quantity: parsePositiveInteger(body.quantity, 1), location_id: body.location_id || null, inventory_unit_id: body.inventory_unit_id || null, item_condition_on_return: condition, mark_lost: body.mark_lost === true || condition === 'LOST' };
}

function assertBorrowReplay(movement, identity) {
  const saved = movement.metadata?.borrow_request;
  let matches;
  if (saved) {
    matches = Object.keys(identity).every((key) => saved[key] === identity[key]);
  } else {
    // Existing movements predate request fingerprints. Reconstruct the business
    // identity from their persisted references instead of invalidating old retries.
    const meta = movement.metadata || {};
    matches = movement.source_service === 'BORROW_SERVICE';
    if (identity.operation === 'release') {
      matches = matches && movement.movement_type === 'RELEASE' && movement.reference_type === 'LOAN_RESERVATION' && movement.reference_id === identity.reservation_id && meta.reason === identity.reason;
    } else if (identity.operation === 'consume') {
      matches = matches && movement.movement_type === 'BORROW' && movement.reference_type === 'LOAN_TRANSACTION' && movement.reference_id === identity.loan_id && meta.reservation_id === identity.reservation_id && meta.loan_number === identity.loan_number;
    } else {
      matches = matches && ['RETURN', 'ADJUSTMENT'].includes(movement.movement_type) && movement.reference_type === 'LOAN_TRANSACTION' && movement.reference_id === identity.loan_id && (meta.loan_item_id || null) === identity.loan_item_id && (movement.inventory_unit_id || null) === identity.inventory_unit_id && meta.item_condition_on_return === identity.item_condition_on_return && Boolean(meta.mark_lost) === identity.mark_lost && (!identity.location_id || identity.mark_lost || movement.to_location_id === identity.location_id);
    }
    for (const field of ['warehouse_id', 'variant_id', 'quantity']) {
      if (identity[field] != null) matches = matches && movement[field] === identity[field];
    }
  }
  if (!matches) throw new Error('IDEMPOTENCY_PAYLOAD_CONFLICT');
}

async function recoverBorrowReplay(error, req, res, operation) {
  if (error.code !== 'P2002' && !['RESERVATION_STOCK_ALREADY_RELEASED', 'RESERVATION_STOCK_ALREADY_CONSUMED', 'RESERVATION_NOT_ACTIVE', 'BORROWED_STOCK_NOT_FOUND'].includes(error.message)) return false;
  // A simultaneous retry can lose the unique-key race after both transactions
  // read no movement. Its stock writes have rolled back; replay the winner.
  const movement = await prisma.stock_movements.findUnique({ where: { idempotency_key: req.body.idempotency_key.trim() } });
  if (!movement) return false;
  try {
    assertBorrowReplay(movement, borrowRequestIdentity(operation, req.body));
  } catch {
    res.status(409).json({ message: 'idempotency_key đã được dùng cho nghiệp vụ hoặc dữ liệu khác' });
    return true;
  }
  const data = operation === 'release'
    ? await prisma.stock_reservations.findFirst({ where: { source_service: 'BORROW', source_reference_id: req.body.reservation_id }, orderBy: [{ updated_at: 'desc' }] })
    : movement;
  res.status(200).json({ data: data || null, idempotent: true });
  return true;
}

// The stock a borrow reservation holds, one row per shelf, oldest first.
function findActiveBorrowHolds(db, reservationId) {
  return db.stock_reservations.findMany({
    where: { source_service: 'BORROW', source_reference_id: reservationId, status: 'ACTIVE' },
    orderBy: [{ created_at: 'asc' }],
  });
}

// One request writes one movement per shelf line. The first keeps the caller's
// key, so replay lookups by that key keep working; the rest get a suffix.
function lineIdempotencyKey(key, index, tag = '') {
  return index === 0 && !tag ? key : boundedLineKey(`${key}#${tag}${index + 1}`);
}

// Borrow keys may already be 100 chars (VarChar(100)); a suffixed key that would
// overflow is hashed deterministically. Keys that fit stay unchanged for replays.
function boundedLineKey(key) {
  return key.length <= 100 ? key : `line:${require('node:crypto').createHash('sha256').update(key).digest('hex')}`;
}

const MAX_PICK_LINES = 20;

// [{ location_id, quantity }] -> one line per shelf, sorted, or null when malformed.
function normalizePicks(picks) {
  if (!Array.isArray(picks) || picks.length === 0 || picks.length > MAX_PICK_LINES) return null;
  const byLocation = new Map();
  for (const pick of picks) {
    const locationId = String(pick?.location_id || '').toLowerCase();
    const quantity = Number(pick?.quantity);
    if (!isUuid(locationId) || !Number.isInteger(quantity) || quantity <= 0) return null;
    byLocation.set(locationId, (byLocation.get(locationId) || 0) + quantity);
  }
  return [...byLocation]
    .map(([location_id, quantity]) => ({ location_id, quantity }))
    .sort((a, b) => a.location_id.localeCompare(b.location_id));
}

function sameAllocation(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

// The shelf a loan's copies of this variant were lent from that still has copies
// out: BORROW movements of the loan minus what its RETURN/ADJUSTMENT movements
// already took back (both record that shelf as from_location_id). Null for loans
// with no lending movement on record, which keep the previous fallback.
async function findShelfLentFrom(db, { loan_id, variant_id, warehouse_id, quantity }) {
  const movements = await db.stock_movements.findMany({
    where: {
      source_service: 'BORROW_SERVICE',
      reference_type: 'LOAN_TRANSACTION',
      reference_id: loan_id,
      variant_id,
      warehouse_id,
      movement_type: { in: ['BORROW', 'RETURN', 'ADJUSTMENT'] },
    },
    select: { movement_type: true, from_location_id: true, quantity: true },
  });
  const outstanding = new Map();
  for (const movement of movements) {
    if (!movement.from_location_id) continue;
    const sign = movement.movement_type === 'BORROW' ? 1 : -1;
    outstanding.set(movement.from_location_id, (outstanding.get(movement.from_location_id) || 0) + sign * movement.quantity);
  }
  const shelf = [...outstanding].sort(([a], [b]) => a.localeCompare(b)).find(([, count]) => count >= quantity);
  return shelf ? shelf[0] : null;
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
    return res.status(400).json({ message: 'Cần có đủ variant_id, warehouse_id và quantity > 0' });
  }

  if (![variant_id, warehouse_id].every(isUuid)) {
    return res.status(400).json({ message: 'variant_id và warehouse_id phải là UUID hợp lệ' });
  }

  try {
    if (isCustomerReservation(req.query.reservation_channel) && !(await isValidPickupWarehouse(prisma, String(warehouse_id)))) {
      return res.status(409).json({ message: INVALID_PICKUP_WAREHOUSE_MESSAGE });
    }

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
        message: 'Không đủ tồn kho khả dụng',
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
    reservation_channel,
  } = req.body;

  const normalizedQuantity = Number(quantity ?? 1);

  if (!reservation_id || !reservation_number || !variant_id || !warehouse_id || !normalizedQuantity || !expires_at) {
    return res.status(400).json({
      message: 'Cần có đủ reservation_id, reservation_number, variant_id, warehouse_id, quantity và expires_at',
    });
  }

  if (![reservation_id, variant_id, warehouse_id].every(isUuid)) {
    return res.status(400).json({ message: 'reservation_id, variant_id và warehouse_id phải là UUID hợp lệ' });
  }

  const movementIdempotency = requireIdempotencyKey(res, idempotency_key);
  if (!movementIdempotency) return undefined;

  try {
    if (movementIdempotency.length > 100) throw new RequestBindingError('idempotency_key tối đa 100 ký tự', 400, 'INVALID_REQUEST_PAYLOAD');
    const binding = reserveIdentity(req);
    const result = await prisma.$transaction(async (tx) => {
      // Select a scalar from the locking function so Prisma never deserializes
      // PostgreSQL's void return value. Same key and same external reference
      // serialize independently, including retries with changed payloads.
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${`reserve-key:${movementIdempotency}`}, 0))`;
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${`reserve-reference:${binding.identity.reservation_id}`}, 0))`;
      const movementByKey = await tx.stock_movements.findUnique({ where: { idempotency_key: movementIdempotency } });
      if (movementByKey) {
        assertReserveReplay(movementByKey, binding.identity);
        const reservation = await tx.stock_reservations.findFirst({ where: { source_service: 'BORROW', source_reference_id: binding.identity.reservation_id }, orderBy: [{ created_at: 'desc' }] });
        if (!reservation) throw new RequestBindingError('Không tìm thấy phiếu giữ gốc để đối soát');
        return { alreadyReserved: true, reservation };
      }
      const existing = await tx.stock_reservations.findFirst({
        where: { source_service: 'BORROW', source_reference_id: binding.identity.reservation_id },
        orderBy: [{ created_at: 'desc' }],
      });
      if (existing) {
        const movement = await tx.stock_movements.findFirst({ where: { source_service: 'BORROW_SERVICE',
          movement_type: 'RESERVE', reference_type: 'LOAN_RESERVATION', reference_id: binding.identity.reservation_id } });
        assertReserveReplay(movement, binding.identity);
        // A different key cannot claim the same physical hold and then be reused
        // later for a second resource. The caller must retry its original key.
        throw new RequestBindingError('Phiếu giữ đã thuộc một key khác; gửi lại key ban đầu');
      }
      if (binding.invalidDelegation) throw new RequestBindingError('Không được thay người thực hiện bằng created_by_user_id', 403, 'ACTOR_DELEGATION_FORBIDDEN');

      if (isCustomerReservation(reservation_channel) && !(await isValidPickupWarehouse(tx, warehouse_id))) {
        throw new Error('INVALID_PICKUP_WAREHOUSE');
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
        const error = new Error('INSUFFICIENT_AVAILABLE_STOCK');
        error.reason = 'no_stock';
        throw error;
      }

      const reserveUpdate = await tx.stock_balances.updateMany({
        where: {
          variant_id,
          location_id: balance.location_id,
          available_qty: { gte: normalizedQuantity },
        },
        data: {
          available_qty: { decrement: normalizedQuantity },
          reserved_qty: { increment: normalizedQuantity },
          last_movement_at: new Date(),
        },
      });

      recordStockMutation('reserve', reserveUpdate.count === 1 ? 'success' : 'noop');

      if (reserveUpdate.count === 0) {
        const error = new Error('INSUFFICIENT_AVAILABLE_STOCK');
        error.reason = 'cas_conflict';
        throw error;
      }

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
            borrow_request: binding.identity,
          },
        },
      });

      await tx.integration_outbox.create({
        data: {
          aggregate_type: 'STOCK_RESERVATION',
          aggregate_id: stockReservation.id,
          event_type: 'inventory.reservation.created',
          payload: {
            reservation_id,
            reservation_number,
            customer_id: customer_id || null,
            variant_id,
            warehouse_id,
            quantity: normalizedQuantity,
            expires_at,
          },
          headers: { correlation_id: req.requestId || null },
        },
      });

      return { reservation: stockReservation };
    });

    reservationCreatedCounter.add(1, { idempotent: Boolean(result.alreadyReserved) });
    return res.status(result.alreadyReserved ? 200 : 201).json({
      data: result.reservation,
      idempotent: Boolean(result.alreadyReserved),
    });
  } catch (error) {
    if (error instanceof RequestBindingError) return res.status(error.statusCode).json({ message: error.message, code: error.code });
    if (error.message === 'INVALID_PICKUP_WAREHOUSE') {
      return res.status(409).json({ message: INVALID_PICKUP_WAREHOUSE_MESSAGE });
    }
    if (error.message === 'VARIANT_NOT_BORROWABLE') {
      return res.status(409).json({ message: 'Ấn bản này hiện không cho mượn.' });
    }
    if (error.message === 'INSUFFICIENT_AVAILABLE_STOCK') {
      reservationConflictCounter.add(1, { reason: error.reason || 'unknown' });
      return res.status(409).json({ message: 'Không đủ tồn kho khả dụng để đặt trước' });
    }
    if (error.code === 'P2002') {
      return res.status(409).json({ message: 'Đặt trước đã tồn tại' });
    }

    console.error('Error while reserving stock for borrow:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

async function releaseBorrowReservation(req, res) {
  const { reservation_id, reason, idempotency_key } = req.body;

  if (!reservation_id) {
    return res.status(400).json({ message: 'Thiếu reservation_id' });
  }

  if (!isUuid(reservation_id)) {
    return res.status(400).json({ message: 'reservation_id phải là UUID hợp lệ' });
  }

  const movementIdempotency = requireIdempotencyKey(res, idempotency_key);
  if (!movementIdempotency) return undefined;

  const releaseReason = String(reason || 'RELEASED').toUpperCase();
  const targetStatus = ['EXPIRED', 'CANCELLED', 'RELEASED'].includes(releaseReason) ? releaseReason : 'RELEASED';
  const requestIdentity = borrowRequestIdentity('release', req.body);

  try {
    const result = await prisma.$transaction(async (tx) => {
      const movementByKey = await tx.stock_movements.findUnique({ where: { idempotency_key: movementIdempotency } });
      if (movementByKey) {
        assertBorrowReplay(movementByKey, requestIdentity);
        const alreadyUpdated = await tx.stock_reservations.findFirst({
          where: {
            source_service: 'BORROW',
            source_reference_id: reservation_id,
          },
          orderBy: [{ updated_at: 'desc' }],
        });
        return { data: alreadyUpdated || null, idempotent: true };
      }

      // A reservation may hold stock on several shelves: give each line back to its own shelf.
      const reservations = await findActiveBorrowHolds(tx, reservation_id);

      if (reservations.length === 0) {
        const terminal = await tx.stock_reservations.findFirst({ where: { source_service: 'BORROW', source_reference_id: reservation_id, status: 'CONSUMED' } });
        if (terminal) throw new Error('RESERVATION_NOT_ACTIVE');
        return { data: null, idempotent: true };
      }

      if (reservations.some((reservation) => !reservation.location_id)) {
        throw new Error('RESERVATION_LOCATION_MISSING');
      }

      const baseTimestamp = Date.now();
      const updatedRows = [];
      for (const [index, reservation] of reservations.entries()) {
        const stateClaim = await tx.stock_reservations.updateMany({
          where: { id: reservation.id, status: 'ACTIVE' },
          data: { status: targetStatus },
        });
        if (stateClaim.count !== 1) throw new Error('RESERVATION_NOT_ACTIVE');

        const claimed = await releaseReservedStock(tx, {
          variant_id: reservation.variant_id,
          location_id: reservation.location_id,
          quantity: reservation.quantity,
        });
        if (!claimed) {
          throw new Error('RESERVATION_STOCK_ALREADY_RELEASED');
        }

        updatedRows.push(await tx.stock_reservations.findUnique({ where: { id: reservation.id } }));

        await tx.stock_movements.create({
          data: {
            movement_number: createMovementNumber(baseTimestamp, index),
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
            idempotency_key: lineIdempotencyKey(movementIdempotency, index),
            created_by_user_id: req.user?.id || null,
            metadata: {
              reason: targetStatus,
              reservation_code: reservation.reservation_code,
              borrow_request: requestIdentity,
            },
          },
        });

        await tx.integration_outbox.create({
          data: {
            aggregate_type: 'STOCK_RESERVATION',
            aggregate_id: reservation.id,
            event_type: 'inventory.reservation.released',
            payload: {
              reservation_id,
              source_reference_id: reservation_id,
              variant_id: reservation.variant_id,
              location_id: reservation.location_id,
              quantity: reservation.quantity,
              reason: targetStatus,
            },
            headers: { correlation_id: req.requestId || null },
          },
        });
      }

      // Same shape as the replay branches: `idempotent` is always present on 200.
      return { data: updatedRows[0], idempotent: false };
    });

    return res.json(result);
  } catch (error) {
    if (error.message === 'IDEMPOTENCY_PAYLOAD_CONFLICT') return res.status(409).json({ message: 'idempotency_key đã được dùng cho nghiệp vụ hoặc dữ liệu khác' });
    if (await recoverBorrowReplay(error, req, res, 'release')) return undefined;
    if (error.message === 'RESERVATION_NOT_ACTIVE') return res.status(409).json({ message: 'Phần giữ hàng không còn ACTIVE, không thể hủy giữ hàng' });
    if (error.message === 'RESERVATION_LOCATION_MISSING') {
      return res.status(409).json({ message: 'Thiếu vị trí giữ hàng của đặt trước, không thể trả lại tồn an toàn' });
    }
    if (error.message === 'RESERVATION_STOCK_ALREADY_RELEASED') {
      return res.status(409).json({ message: 'Tồn kho vừa thay đổi do có yêu cầu đồng thời, vui lòng thử lại' });
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
    return res.status(400).json({ message: 'Cần có đủ reservation_id, loan_id, loan_number và warehouse_id' });
  }

  if (![reservation_id, loan_id, warehouse_id].every(isUuid)) {
    return res.status(400).json({ message: 'reservation_id, loan_id và warehouse_id phải là UUID hợp lệ' });
  }

  const movementIdempotency = requireIdempotencyKey(res, idempotency_key);
  if (!movementIdempotency) return undefined;
  const requestIdentity = borrowRequestIdentity('consume', req.body);

  try {
    const result = await prisma.$transaction(async (tx) => {
      const movementByKey = await tx.stock_movements.findUnique({ where: { idempotency_key: movementIdempotency } });
      if (movementByKey) {
        assertBorrowReplay(movementByKey, requestIdentity);
        return { idempotent: true, data: movementByKey };
      }

      // One borrow reservation can hold stock on several shelves (see
      // reallocateBorrowReservation): consume every held line at its own shelf.
      const reservations = await findActiveBorrowHolds(tx, reservation_id);

      if (reservations.length === 0) {
        throw new Error('RESERVATION_NOT_ACTIVE');
      }

      if (reservations.some((reservation) => !reservation.location_id)) {
        throw new Error('RESERVATION_LOCATION_MISSING');
      }

      const baseTimestamp = Date.now();
      const movements = [];
      for (const [index, reservation] of reservations.entries()) {
        const stateClaim = await tx.stock_reservations.updateMany({
          where: { id: reservation.id, status: 'ACTIVE' },
          data: { status: 'CONSUMED' },
        });
        if (stateClaim.count !== 1) throw new Error('RESERVATION_NOT_ACTIVE');

        const claimed = await consumeReservedStock(tx, {
          variant_id: reservation.variant_id,
          location_id: reservation.location_id,
          quantity: reservation.quantity,
        });
        if (!claimed) {
          throw new Error('RESERVATION_STOCK_ALREADY_CONSUMED');
        }

        const movement = await tx.stock_movements.create({
          data: {
            movement_number: createMovementNumber(baseTimestamp, index),
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
            idempotency_key: lineIdempotencyKey(movementIdempotency, index),
            created_by_user_id: handled_by_user_id || req.user?.id || null,
            metadata: {
              loan_number,
              reservation_id,
              borrow_request: requestIdentity,
            },
          },
        });
        movements.push(movement);

        await tx.integration_outbox.create({
          data: {
            aggregate_type: 'STOCK_RESERVATION',
            aggregate_id: reservation.id,
            event_type: 'inventory.reservation.consumed',
            payload: {
              reservation_id,
              variant_id: reservation.variant_id,
              location_id: reservation.location_id,
              quantity: reservation.quantity,
              loan_id,
              loan_number,
            },
            headers: { correlation_id: req.requestId || null },
          },
        });
      }

      return { data: movements[0], movements, idempotent: false };
    });

    return res.status(result.idempotent ? 200 : 201).json(result);
  } catch (error) {
    if (error.message === 'IDEMPOTENCY_PAYLOAD_CONFLICT') return res.status(409).json({ message: 'idempotency_key đã được dùng cho nghiệp vụ hoặc dữ liệu khác' });
    if (await recoverBorrowReplay(error, req, res, 'consume')) return undefined;
    if (error.message === 'RESERVATION_NOT_ACTIVE') {
      return res.status(409).json({ message: 'Phần giữ hàng của đặt trước không còn ACTIVE trong kho, không thể xuất cho mượn' });
    }
    if (error.message === 'RESERVATION_LOCATION_MISSING') {
      return res.status(409).json({ message: 'Thiếu vị trí giữ hàng của đặt trước, không thể xuất cho mượn an toàn' });
    }
    if (error.message === 'RESERVATION_STOCK_ALREADY_CONSUMED') {
      return res.status(409).json({ message: 'Tồn kho vừa thay đổi do có yêu cầu đồng thời, vui lòng thử lại' });
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
    item_condition_on_return,
    mark_lost,
    idempotency_key,
    handled_by_user_id,
  } = req.body;

  const normalizedQuantity = parsePositiveInteger(quantity, 1);
  const normalizedCondition = String(item_condition_on_return || 'GOOD').trim().toUpperCase();
  const isLost = mark_lost === true || normalizedCondition === 'LOST';
  const isDamaged = !isLost && ['DAMAGED', 'POOR'].includes(normalizedCondition);

  if (!loan_id || !variant_id || !warehouse_id || !normalizedQuantity) {
    return res.status(400).json({ message: 'Cần có đủ loan_id, variant_id, warehouse_id và quantity' });
  }

  if (![loan_id, variant_id, warehouse_id].every(isUuid)) {
    return res.status(400).json({ message: 'loan_id, variant_id và warehouse_id phải là UUID hợp lệ' });
  }

  if (loan_item_id && !isUuid(loan_item_id)) {
    return res.status(400).json({ message: 'loan_item_id phải là UUID hợp lệ (nếu có)' });
  }

  if (location_id && !isUuid(location_id)) {
    return res.status(400).json({ message: 'location_id phải là UUID hợp lệ (nếu có)' });
  }

  // The librarian says where the returned copy was put back; only a lost copy has no place.
  // Borrow operations approved before shelf returns had no place: they return to the shelf lent from.
  if (!isLost && !location_id && req.body.return_to_lent_from_shelf !== true) {
    return res.status(400).json({ message: 'Cần location_id: vị trí sách được trả về' });
  }

  if (inventory_unit_id && !isUuid(inventory_unit_id)) {
    return res.status(400).json({ message: 'inventory_unit_id phải là UUID hợp lệ (nếu có)' });
  }

  const movementIdempotency = requireIdempotencyKey(res, idempotency_key);
  if (!movementIdempotency) return undefined;
  const requestIdentity = borrowRequestIdentity('return', req.body);

  try {
    const result = await prisma.$transaction(async (tx) => {
      if (loan_item_id) {
        await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))::text', `borrow-return:${loan_item_id.toLowerCase()}`);
      }
      const movementByKey = await tx.stock_movements.findUnique({ where: { idempotency_key: movementIdempotency } });
      if (movementByKey) {
        assertBorrowReplay(movementByKey, requestIdentity);
        return { data: movementByKey, idempotent: true };
      }

      if (loan_item_id) {
        const returned = await tx.$queryRawUnsafe(
          "SELECT id FROM stock_movements WHERE source_service = 'BORROW_SERVICE' AND reference_type = 'LOAN_TRANSACTION' AND movement_type IN ('RETURN', 'ADJUSTMENT') AND LOWER(metadata->>'loan_item_id') = LOWER($1) LIMIT 1",
          loan_item_id,
        );
        if (returned.length > 0) throw new Error('LOAN_ITEM_ALREADY_RETURNED');
      }

      // Take the copy off the shelf it was lent from, not whichever shelf lends the most.
      await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))::text', `borrow-return-loan:${String(loan_id).toLowerCase()}`);
      const lentFromLocationId = await findShelfLentFrom(tx, { loan_id, variant_id, warehouse_id, quantity: normalizedQuantity });

      const balance = await tx.stock_balances.findFirst({
        where: {
          variant_id,
          warehouse_id,
          borrowed_qty: { gte: normalizedQuantity },
          ...(lentFromLocationId ? { location_id: lentFromLocationId } : {}),
        },
        orderBy: [{ borrowed_qty: 'desc' }],
      });

      if (!balance) {
        throw new Error('BORROWED_STOCK_NOT_FOUND');
      }

      if (isLost && balance.on_hand_qty < normalizedQuantity) {
        throw new Error('ON_HAND_STOCK_NOT_FOUND');
      }

      const targetLocationId = location_id || balance.location_id;
      const isSameLocation = targetLocationId === balance.location_id;
      const sourceUpdate = {
        borrowed_qty: { decrement: normalizedQuantity },
        last_movement_at: new Date(),
      };

      if (isLost || !isSameLocation) {
        sourceUpdate.on_hand_qty = { decrement: normalizedQuantity };
      }

      if (!isLost && isSameLocation) {
        if (isDamaged) {
          sourceUpdate.damaged_qty = { increment: normalizedQuantity };
        } else {
          sourceUpdate.available_qty = { increment: normalizedQuantity };
        }
      }

      const returnUpdate = await tx.stock_balances.updateMany({
        where: {
          variant_id,
          location_id: balance.location_id,
          borrowed_qty: { gte: normalizedQuantity },
        },
        data: sourceUpdate,
      });

      if (returnUpdate.count === 0) {
        throw new Error('BORROWED_STOCK_NOT_FOUND');
      }

      if (!isLost && !isSameLocation) {
        await tx.stock_balances.upsert({
          where: {
            variant_id_location_id: {
              variant_id,
              location_id: targetLocationId,
            },
          },
          create: {
            warehouse_id,
            variant_id,
            location_id: targetLocationId,
            on_hand_qty: normalizedQuantity,
            available_qty: isDamaged ? 0 : normalizedQuantity,
            reserved_qty: 0,
            borrowed_qty: 0,
            damaged_qty: isDamaged ? normalizedQuantity : 0,
            last_movement_at: new Date(),
          },
          update: {
            on_hand_qty: { increment: normalizedQuantity },
            ...(isDamaged
              ? { damaged_qty: { increment: normalizedQuantity } }
              : { available_qty: { increment: normalizedQuantity } }),
            last_movement_at: new Date(),
          },
        });
      }

      if (inventory_unit_id) {
        await tx.inventory_units.update({
          where: { id: inventory_unit_id },
          data: {
            status: isLost ? 'LOST' : (isDamaged ? 'DAMAGED' : 'AVAILABLE'),
            current_location_id: isLost ? null : targetLocationId,
            last_seen_at: new Date(),
          },
        }).catch(() => undefined);
      }

      const movementType = (isLost || isDamaged) ? 'ADJUSTMENT' : 'RETURN';
      const movement = await tx.stock_movements.create({
        data: {
          movement_number: createMovementNumber(Date.now(), 0),
          movement_type: movementType,
          movement_status: 'POSTED',
          warehouse_id,
          variant_id,
          inventory_unit_id: inventory_unit_id || null,
          from_location_id: balance.location_id,
          to_location_id: isLost ? null : targetLocationId,
          quantity: normalizedQuantity,
          unit_cost: 0,
          source_service: 'BORROW_SERVICE',
          reference_type: 'LOAN_TRANSACTION',
          reference_id: loan_id,
          idempotency_key: movementIdempotency,
          created_by_user_id: handled_by_user_id || req.user?.id || null,
          reason_code: isLost ? 'LOST' : (isDamaged ? 'DAMAGED_RETURN' : 'RETURNED'),
          metadata: {
            loan_item_id: loan_item_id || null,
            item_condition_on_return: normalizedCondition,
            mark_lost: isLost,
            borrow_request: requestIdentity,
          },
        },
      });

      // A good-condition return puts the copy back on the shelf: publish it like
      // putaway/receiving do so availability alerts can react. Lost/damaged
      // returns never raise available_qty, so there is nothing to announce.
      if (!isLost && !isDamaged) {
        await tx.integration_outbox.create({
          data: {
            aggregate_type: 'STOCK_BALANCE',
            aggregate_id: variant_id,
            event_type: 'inventory.stock.changed',
            payload: {
              variant_id,
              location_id: targetLocationId,
              warehouse_id,
              delta_qty: normalizedQuantity,
              reason_code: 'LOAN_RETURNED',
              source_reference_type: 'LOAN_TRANSACTION',
              source_reference_id: loan_id,
            },
            headers: { correlation_id: req.requestId || null },
          },
        });
      }

      return { data: movement, idempotent: false };
    });

    return res.status(result.idempotent ? 200 : 201).json(result);
  } catch (error) {
    if (error.message === 'IDEMPOTENCY_PAYLOAD_CONFLICT') return res.status(409).json({ message: 'idempotency_key đã được dùng cho nghiệp vụ hoặc dữ liệu khác' });
    if (await recoverBorrowReplay(error, req, res, 'return')) return undefined;
    if (error.message === 'LOAN_ITEM_ALREADY_RETURNED') return res.status(409).json({ message: 'Cuốn sách này đã được xử lý trả hoặc mất' });
    if (error.message === 'BORROWED_STOCK_NOT_FOUND') {
      return res.status(409).json({ message: 'Không có tồn đang cho mượn để nhận trả cho ấn bản/kho này' });
    }
    if (error.message === 'ON_HAND_STOCK_NOT_FOUND') {
      return res.status(409).json({ message: 'Không có tồn thực tế để đánh dấu mất cho ấn bản/kho này' });
    }
    console.error('Error while returning borrowed stock:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

function pickError(code, message) {
  return Object.assign(new Error(code), { pickMessage: message });
}

// Librarian reports which shelves the copies of a borrow reservation were actually
// taken from. The hold placed at reservation time sits on a shelf the system chose;
// this moves it to the shelves really picked (release the old lines, reserve the
// new ones), so the later consume takes stock off the right shelves.
async function reallocateBorrowReservation(req, res) {
  const { reservation_id, warehouse_id, picks, idempotency_key, handled_by_user_id } = req.body || {};

  if (!isUuid(reservation_id) || !isUuid(warehouse_id)) {
    return res.status(400).json({ message: 'reservation_id và warehouse_id phải là UUID hợp lệ' });
  }

  const normalizedPicks = normalizePicks(picks);
  if (!normalizedPicks) {
    return res.status(400).json({ message: `picks phải là danh sách 1-${MAX_PICK_LINES} dòng { location_id, quantity > 0 }` });
  }

  const movementIdempotency = requireIdempotencyKey(res, idempotency_key);
  if (!movementIdempotency) return undefined;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const movementByKey = await tx.stock_movements.findUnique({ where: { idempotency_key: movementIdempotency } });
      if (movementByKey) {
        if (movementByKey.reference_id !== reservation_id || !sameAllocation(movementByKey.metadata?.picks, normalizedPicks)) {
          throw new Error('IDEMPOTENCY_PAYLOAD_CONFLICT');
        }
        return { data: await findActiveBorrowHolds(tx, reservation_id), idempotent: true };
      }

      const current = await findActiveBorrowHolds(tx, reservation_id);
      if (current.length === 0) throw new Error('RESERVATION_NOT_ACTIVE');
      if (current.some((row) => row.warehouse_id !== warehouse_id)) throw new Error('RESERVATION_WAREHOUSE_MISMATCH');
      if (current.some((row) => !row.location_id)) throw new Error('RESERVATION_LOCATION_MISSING');

      const heldTotal = current.reduce((sum, row) => sum + row.quantity, 0);
      const pickedTotal = normalizedPicks.reduce((sum, pick) => sum + pick.quantity, 0);
      if (heldTotal !== pickedTotal) {
        throw pickError('PICK_QUANTITY_MISMATCH', `Tổng số sách đã lấy (${pickedTotal}) phải bằng số lượng của đặt trước (${heldTotal})`);
      }

      const locations = await tx.locations.findMany({
        where: { id: { in: normalizedPicks.map((pick) => pick.location_id) } },
        select: { id: true, warehouse_id: true, location_code: true, is_active: true },
      });
      const locationById = new Map(locations.map((location) => [location.id.toLowerCase(), location]));
      for (const pick of normalizedPicks) {
        const location = locationById.get(pick.location_id);
        if (!location || location.warehouse_id !== warehouse_id || location.is_active === false) {
          throw pickError('PICK_LOCATION_INVALID', `Vị trí ${location?.location_code || pick.location_id} không thuộc kho của đặt trước hoặc đã ngừng sử dụng`);
        }
      }

      const currentAllocation = normalizePicks(current.map((row) => ({ location_id: row.location_id, quantity: row.quantity })));
      if (sameAllocation(currentAllocation, normalizedPicks)) {
        return { data: current, idempotent: false, unchanged: true };
      }

      const template = current[0];
      const rootCode = String(template.reservation_code).split('/P')[0];
      const lineCount = await tx.stock_reservations.count({ where: { source_service: 'BORROW', source_reference_id: reservation_id } });
      const actorUserId = handled_by_user_id || req.user?.id || null;
      const baseTimestamp = Date.now();
      const now = new Date();
      const metadata = { reason: 'PICK_REALLOCATED', picks: normalizedPicks };
      let movementIndex = 0;

      for (const [index, row] of current.entries()) {
        const stateClaim = await tx.stock_reservations.updateMany({
          where: { id: row.id, status: 'ACTIVE' },
          data: { status: 'REALLOCATED', updated_at: now },
        });
        if (stateClaim.count !== 1) throw new Error('RESERVATION_NOT_ACTIVE');

        if (!(await releaseReservedStock(tx, { variant_id: row.variant_id, location_id: row.location_id, quantity: row.quantity }))) {
          throw new Error('RESERVATION_STOCK_CHANGED');
        }

        await tx.stock_movements.create({
          data: {
            movement_number: createMovementNumber(baseTimestamp, movementIndex++),
            movement_type: 'RELEASE',
            movement_status: 'POSTED',
            warehouse_id,
            variant_id: row.variant_id,
            from_location_id: row.location_id,
            to_location_id: row.location_id,
            quantity: row.quantity,
            unit_cost: 0,
            source_service: 'BORROW_SERVICE',
            reference_type: 'LOAN_RESERVATION',
            reference_id: reservation_id,
            idempotency_key: lineIdempotencyKey(movementIdempotency, index, 'release-'),
            created_by_user_id: actorUserId,
            metadata: { ...metadata, reservation_code: row.reservation_code },
          },
        });
      }

      const created = [];
      for (const [index, pick] of normalizedPicks.entries()) {
        const reserveUpdate = await tx.stock_balances.updateMany({
          where: { variant_id: template.variant_id, location_id: pick.location_id, available_qty: { gte: pick.quantity } },
          data: {
            available_qty: { decrement: pick.quantity },
            reserved_qty: { increment: pick.quantity },
            last_movement_at: now,
          },
        });
        recordStockMutation('reserve', reserveUpdate.count === 1 ? 'success' : 'noop');
        if (reserveUpdate.count !== 1) {
          const code = locationById.get(pick.location_id).location_code;
          throw pickError('PICK_LOCATION_SHORT', `Vị trí ${code} không còn đủ ${pick.quantity} cuốn khả dụng trên hệ thống. Kiểm tra lại vị trí đã lấy sách.`);
        }

        const line = await tx.stock_reservations.create({
          data: {
            reservation_code: `${rootCode}/P${lineCount + index + 1}`,
            variant_id: template.variant_id,
            warehouse_id,
            location_id: pick.location_id,
            customer_id: template.customer_id,
            source_service: 'BORROW',
            source_reference_id: reservation_id,
            quantity: pick.quantity,
            status: 'ACTIVE',
            expires_at: template.expires_at,
            created_by_user_id: actorUserId,
          },
        });
        created.push(line);

        await tx.stock_movements.create({
          data: {
            movement_number: createMovementNumber(baseTimestamp, movementIndex++),
            movement_type: 'RESERVE',
            movement_status: 'POSTED',
            warehouse_id,
            variant_id: template.variant_id,
            from_location_id: pick.location_id,
            to_location_id: pick.location_id,
            quantity: pick.quantity,
            unit_cost: 0,
            source_service: 'BORROW_SERVICE',
            reference_type: 'LOAN_RESERVATION',
            reference_id: reservation_id,
            // The first new line carries the caller's key: it is the replay marker.
            idempotency_key: index === 0 ? movementIdempotency : lineIdempotencyKey(movementIdempotency, index, 'reserve-'),
            created_by_user_id: actorUserId,
            metadata: { ...metadata, reservation_code: line.reservation_code },
          },
        });
      }

      // No outbox event on purpose: availability did not change, and a
      // `released` event would wake "back in stock" alerts for nothing.
      return { data: created, idempotent: false };
    });

    return res.json(result);
  } catch (error) {
    if (error.pickMessage) return res.status(409).json({ message: error.pickMessage, code: error.message });
    if (error.message === 'IDEMPOTENCY_PAYLOAD_CONFLICT') return res.status(409).json({ message: 'idempotency_key đã được dùng cho nghiệp vụ hoặc dữ liệu khác' });
    if (error.message === 'RESERVATION_NOT_ACTIVE') return res.status(409).json({ message: 'Phần giữ hàng của đặt trước không còn ACTIVE trong kho' });
    if (error.message === 'RESERVATION_WAREHOUSE_MISMATCH') return res.status(409).json({ message: 'Đặt trước không giữ hàng ở kho này' });
    if (error.message === 'RESERVATION_LOCATION_MISSING') return res.status(409).json({ message: 'Thiếu vị trí giữ hàng của đặt trước' });
    if (error.message === 'RESERVATION_STOCK_CHANGED' || error.code === 'P2002') {
      return res.status(409).json({ message: 'Tồn kho vừa thay đổi do có yêu cầu đồng thời, vui lòng thử lại' });
    }
    console.error('Error while reallocating borrow reservation:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

// Shelves the librarian may report a pick from: every active shelf of the
// warehouse holding this variant, with what is free there plus what this
// reservation already holds there (both can be picked).
async function getBorrowPickOptions(req, res) {
  const { variant_id, warehouse_id, reservation_id } = req.query;

  if (!isUuid(variant_id) || !isUuid(warehouse_id) || (reservation_id && !isUuid(reservation_id))) {
    return res.status(400).json({ message: 'variant_id, warehouse_id (và reservation_id nếu có) phải là UUID hợp lệ' });
  }

  try {
    const [balances, holds] = await Promise.all([
      prisma.stock_balances.findMany({
        where: { variant_id, warehouse_id },
        select: { location_id: true, available_qty: true },
      }),
      reservation_id
        ? prisma.stock_reservations.findMany({
          where: { source_service: 'BORROW', source_reference_id: reservation_id, status: 'ACTIVE', variant_id, warehouse_id },
          select: { location_id: true, quantity: true },
        })
        : [],
    ]);

    const tally = new Map();
    const bump = (locationId, field, quantity) => {
      if (!locationId) return;
      const row = tally.get(locationId) || { available_qty: 0, held_qty: 0 };
      row[field] += quantity;
      tally.set(locationId, row);
    };
    balances.forEach((balance) => bump(balance.location_id, 'available_qty', balance.available_qty));
    holds.forEach((hold) => bump(hold.location_id, 'held_qty', hold.quantity));

    const locations = tally.size
      ? await prisma.locations.findMany({
        where: { id: { in: [...tally.keys()] }, warehouse_id, is_active: true },
        select: { id: true, location_code: true, zone: true, aisle: true, shelf: true, bin: true },
      })
      : [];

    const options = locations
      .map((location) => ({
        location_id: location.id,
        location_code: location.location_code,
        zone: location.zone,
        aisle: location.aisle,
        shelf: location.shelf,
        bin: location.bin,
        ...tally.get(location.id),
      }))
      .filter((option) => option.available_qty + option.held_qty > 0)
      .sort((a, b) => a.location_code.localeCompare(b.location_code));

    return res.json({ data: options });
  } catch (error) {
    console.error('Error while listing borrow pick options:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

async function getVariantDetails(req, res) {
  const idsParam = String(req.query.ids || '').trim();
  if (!idsParam) {
    return res.json({ data: [] });
  }

  const ids = idsParam.split(',').map((id) => id.trim()).filter(Boolean).slice(0, 200);
  if (ids.length === 0) {
    return res.json({ data: [] });
  }

  try {
    const variants = await prisma.book_variants.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        cover_image_url: true,
        books: {
          select: {
            title: true,
            book_authors: {
              select: { authors: { select: { full_name: true } } },
              orderBy: { author_order: 'asc' },
              take: 1,
            },
          },
        },
      },
    });

    return res.json({
      data: variants.map((variant) => ({
        id: variant.id,
        title: variant.books?.title || 'Không rõ tên sách',
        author: variant.books?.book_authors?.[0]?.authors?.full_name || null,
        cover_image_url: variant.cover_image_url || null,
      })),
    });
  } catch (error) {
    console.error('getVariantDetails error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

async function getVariantPublicAvailability(req, res) {
  const variantId = String(req.params.variantId || '');
  if (!isUuid(variantId)) {
    return res.status(400).json({ message: 'variantId phải là UUID hợp lệ' });
  }

  try {
    const availability = await readPublicAvailabilityByVariant(prisma, variantId);
    if (!availability) {
      return res.status(404).json({ message: 'Không tìm thấy sách trong danh mục công khai' });
    }
    return res.json({ data: availability });
  } catch (error) {
    console.error('getVariantPublicAvailability error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

async function getBookPublicAvailability(req, res) {
  const bookId = String(req.params.bookId || '');
  if (!isUuid(bookId)) {
    return res.status(400).json({ message: 'bookId phải là UUID hợp lệ' });
  }

  try {
    const availability = await readPublicAvailabilityByBook(prisma, bookId);
    if (!availability) {
      return res.status(404).json({ message: 'Không tìm thấy sách trong danh mục công khai' });
    }
    return res.json({ data: availability });
  } catch (error) {
    console.error('getBookPublicAvailability error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

async function getBookVariantIds(req, res) {
  const bookId = String(req.params.bookId || '');
  if (!isUuid(bookId)) {
    return res.status(400).json({ message: 'bookId phải là UUID hợp lệ' });
  }

  try {
    const variants = await prisma.book_variants.findMany({
      where: { book_id: bookId },
      select: { id: true },
    });
    return res.json({ data: variants.map((variant) => variant.id) });
  } catch (error) {
    console.error('getBookVariantIds error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

module.exports = {
  getVariantPublicAvailability,
  getBookPublicAvailability,
  getBookVariantIds,
  searchBorrowVariants,
  listBorrowWarehouses,
  getAvailability,
  reserveFromBorrow,
  releaseBorrowReservation,
  consumeBorrowReservation,
  reallocateBorrowReservation,
  getBorrowPickOptions,
  returnBorrowedLoan,
  getVariantDetails,
};
