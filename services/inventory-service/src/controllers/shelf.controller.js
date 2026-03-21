const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const COMPARTMENT_TYPES = ['SHELF_COMPARTMENT', 'BIN'];

function parseId(value) {
  return String(value || '').trim() || null;
}

function toSafeNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function buildShelfCapacitySummary(compartments, occupiedByLocation) {
  let occupiedQty = 0;
  let capacityQty = 0;
  let hasAnyCapacity = false;

  for (const compartment of compartments) {
    const occupied = toSafeNumber(occupiedByLocation.get(compartment.id), 0);
    const capacity = compartment.capacity_qty == null ? null : toSafeNumber(compartment.capacity_qty, 0);

    occupiedQty += occupied;

    if (capacity != null) {
      hasAnyCapacity = true;
      capacityQty += capacity;
    }
  }

  const safeCapacity = hasAnyCapacity ? capacityQty : null;
  const availableQty = safeCapacity == null ? null : Math.max(safeCapacity - occupiedQty, 0);

  return {
    occupiedQty,
    capacityQty: safeCapacity,
    availableQty,
    utilizationPct: safeCapacity && safeCapacity > 0
      ? Number(((occupiedQty / safeCapacity) * 100).toFixed(2))
      : null,
  };
}

async function getShelfOverview(req, res) {
  const warehouseId = parseId(req.query.warehouseId);
  const query = String(req.query.query || '').trim();

  try {
    const shelves = await prisma.locations.findMany({
      where: {
        location_type: 'SHELF',
        ...(warehouseId ? { warehouse_id: warehouseId } : {}),
        ...(query
          ? {
              OR: [
                { location_code: { contains: query, mode: 'insensitive' } },
                { zone: { contains: query, mode: 'insensitive' } },
                { shelf: { contains: query, mode: 'insensitive' } },
                { warehouses: { name: { contains: query, mode: 'insensitive' } } },
                { warehouses: { code: { contains: query, mode: 'insensitive' } } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        warehouse_id: true,
        parent_location_id: true,
        location_code: true,
        zone: true,
        shelf: true,
        available: true,
        capacity_qty: true,
        warehouses: {
          select: {
            id: true,
            code: true,
            name: true,
          },
        },
      },
      orderBy: [{ warehouse_id: 'asc' }, { location_code: 'asc' }],
    });

    const shelfIds = shelves.map((shelf) => shelf.id);

    if (shelfIds.length === 0) {
      return res.json({ shelves: [] });
    }

    const compartments = await prisma.locations.findMany({
      where: {
        parent_location_id: { in: shelfIds },
        location_type: { in: COMPARTMENT_TYPES },
      },
      select: {
        id: true,
        parent_location_id: true,
        capacity_qty: true,
      },
    });

    const compartmentIds = compartments.map((item) => item.id);
    const occupiedByLocation = new Map();

    if (compartmentIds.length > 0) {
      const grouped = await prisma.stock_balances.groupBy({
        by: ['location_id'],
        where: {
          location_id: { in: compartmentIds },
          on_hand_qty: { gt: 0 },
        },
        _sum: {
          on_hand_qty: true,
        },
      });

      grouped.forEach((row) => {
        occupiedByLocation.set(row.location_id, toSafeNumber(row._sum.on_hand_qty, 0));
      });
    }

    const compartmentsByShelf = new Map();
    for (const item of compartments) {
      const list = compartmentsByShelf.get(item.parent_location_id) || [];
      list.push(item);
      compartmentsByShelf.set(item.parent_location_id, list);
    }

    const rows = shelves.map((shelf) => {
      const childCompartments = compartmentsByShelf.get(shelf.id) || [];
      const summary = buildShelfCapacitySummary(childCompartments, occupiedByLocation);

      return {
        id: shelf.id,
        code: shelf.location_code,
        zone: shelf.zone,
        shelf: shelf.shelf,
        warehouse: shelf.warehouses,
        compartmentCount: childCompartments.length,
        occupiedQty: summary.occupiedQty,
        capacityQty: summary.capacityQty,
        availableQty: summary.availableQty,
        utilizationPct: summary.utilizationPct,
        locationAvailable: shelf.available,
      };
    });

    return res.json({ shelves: rows });
  } catch (error) {
    console.error('Error while fetching shelf overview:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

async function getShelfDetail(req, res) {
  const shelfId = parseId(req.params.id);

  if (!shelfId) {
    return res.status(400).json({ message: 'Invalid shelf id' });
  }

  try {
    const shelf = await prisma.locations.findFirst({
      where: {
        id: shelfId,
        location_type: 'SHELF',
      },
      select: {
        id: true,
        warehouse_id: true,
        location_code: true,
        zone: true,
        shelf: true,
        available: true,
        capacity_qty: true,
        warehouses: {
          select: {
            id: true,
            code: true,
            name: true,
          },
        },
      },
    });

    if (!shelf) {
      return res.status(404).json({ message: 'Shelf not found' });
    }

    const compartments = await prisma.locations.findMany({
      where: {
        parent_location_id: shelf.id,
        location_type: { in: COMPARTMENT_TYPES },
      },
      select: {
        id: true,
        location_code: true,
        capacity_qty: true,
        available: true,
      },
      orderBy: { location_code: 'asc' },
    });

    const compartmentIds = compartments.map((item) => item.id);

    const balances = compartmentIds.length > 0
      ? await prisma.stock_balances.findMany({
          where: {
            location_id: { in: compartmentIds },
            on_hand_qty: { gt: 0 },
          },
          select: {
            variant_id: true,
            location_id: true,
            on_hand_qty: true,
            last_movement_at: true,
            book_variants: {
              select: {
                id: true,
                sku: true,
                isbn13: true,
                books: {
                  select: {
                    id: true,
                    title: true,
                    book_code: true,
                  },
                },
              },
            },
          },
          orderBy: [{ location_id: 'asc' }, { on_hand_qty: 'desc' }],
        })
      : [];

    const occupiedByLocation = new Map();
    balances.forEach((row) => {
      occupiedByLocation.set(
        row.location_id,
        toSafeNumber(occupiedByLocation.get(row.location_id), 0) + toSafeNumber(row.on_hand_qty, 0),
      );
    });

    const latestInboundByKey = new Map();
    const movementRows = compartmentIds.length > 0
      ? await prisma.stock_movements.findMany({
          where: {
            to_location_id: { in: compartmentIds },
            quantity: { gt: 0 },
          },
          select: {
            to_location_id: true,
            variant_id: true,
            created_at: true,
          },
          orderBy: { created_at: 'desc' },
        })
      : [];

    for (const movement of movementRows) {
      const key = `${movement.to_location_id}:${movement.variant_id}`;
      if (!latestInboundByKey.has(key)) {
        latestInboundByKey.set(key, movement.created_at);
      }
    }

    const booksByCompartment = new Map();
    for (const row of balances) {
      const key = `${row.location_id}:${row.variant_id}`;
      const inboundAt = latestInboundByKey.get(key) || row.last_movement_at || null;

      const list = booksByCompartment.get(row.location_id) || [];
      list.push({
        variantId: row.variant_id,
        sku: row.book_variants.sku,
        isbn13: row.book_variants.isbn13,
        title: row.book_variants.books.title,
        bookCode: row.book_variants.books.book_code,
        onHandQty: row.on_hand_qty,
        inboundAt,
      });
      booksByCompartment.set(row.location_id, list);
    }

    const compartmentRows = compartments.map((compartment) => {
      const occupiedQty = toSafeNumber(occupiedByLocation.get(compartment.id), 0);
      const capacityQty = compartment.capacity_qty == null ? null : toSafeNumber(compartment.capacity_qty, 0);
      const availableQty = capacityQty == null ? null : Math.max(capacityQty - occupiedQty, 0);
      const books = booksByCompartment.get(compartment.id) || [];

      return {
        id: compartment.id,
        code: compartment.location_code,
        occupiedQty,
        capacityQty,
        availableQty,
        locationAvailable: compartment.available,
        utilizationPct: capacityQty && capacityQty > 0
          ? Number(((occupiedQty / capacityQty) * 100).toFixed(2))
          : null,
        books,
      };
    });

    const shelfSummary = buildShelfCapacitySummary(compartments, occupiedByLocation);

    return res.json({
      shelf: {
        id: shelf.id,
        code: shelf.location_code,
        zone: shelf.zone,
        shelf: shelf.shelf,
        warehouse: shelf.warehouses,
        locationAvailable: shelf.available,
        occupiedQty: shelfSummary.occupiedQty,
        capacityQty: shelfSummary.capacityQty,
        availableQty: shelfSummary.availableQty,
        utilizationPct: shelfSummary.utilizationPct,
        compartmentCount: compartmentRows.length,
      },
      compartments: compartmentRows,
    });
  } catch (error) {
    console.error('Error while fetching shelf detail:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

module.exports = {
  getShelfOverview,
  getShelfDetail,
};
