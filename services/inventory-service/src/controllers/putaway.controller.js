const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const READY_PUTAWAY_STATUS = 'POSTED';
const POSTING_REFERENCE_TYPE = 'GOODS_RECEIPT';
const PUTAWAY_MOVEMENT_TYPE = 'INBOUND';

const { parseId } = require('../utils/validation');
const { toInt } = require('../utils/validation');
const { normalizeLocationType } = require('../utils/validation');
const { createMovementNumber } = require('../utils/inventory');
const { MAX_COMPARTMENT_CAPACITY } = require('../utils/constants');

function getAncestorByType(location, locationMap, targetType) {
  const normalizedTarget = normalizeLocationType(targetType);
  let current = location;
  const guard = new Set();

  while (current) {
    if (normalizeLocationType(current.location_type) === normalizedTarget) {
      return current;
    }

    if (!current.parent_location_id) {
      return null;
    }

    if (guard.has(current.id)) {
      return null;
    }

    guard.add(current.id);
    current = locationMap.get(current.parent_location_id) || null;
  }

  return null;
}

function getZoneAncestor(location, locationMap) {
  return getAncestorByType(location, locationMap, 'ZONE');
}

function getShelfAncestor(location, locationMap) {
  return getAncestorByType(location, locationMap, 'SHELF');
}

function aggregateBalanceEntries(entries) {
  const map = new Map();

  entries.forEach((entry) => {
    const key = `${entry.variant_id}::${entry.location_id}`;
    const current = map.get(key);
    if (!current) {
      map.set(key, {
        variant_id: entry.variant_id,
        location_id: entry.location_id,
        quantity: Number(entry.quantity || 0),
      });
      return;
    }

    current.quantity += Number(entry.quantity || 0);
  });

  return Array.from(map.values());
}

async function resolveOrCreateFallbackReceivingLocation(tx, warehouseId) {
  const found = await tx.locations.findFirst({
    where: {
      warehouse_id: warehouseId,
      is_active: true,
      location_type: { in: ['RECEIVING', 'STAGING'] },
    },
    select: { id: true, location_code: true },
    orderBy: { location_code: 'asc' },
  });

  if (found) return found;

  const ts = Date.now();
  const suffix = Math.random().toString(36).slice(2, 5).toUpperCase();
  return tx.locations.create({
    data: {
      warehouse_id: warehouseId,
      location_code: 'RECEIVING',
      location_type: 'RECEIVING',
      zone: 'RECEIVING',
      is_pickable: false,
      is_active: true,
    },
    select: { id: true, location_code: true },
  });
}

async function getReadyReceipts(req, res) {
  try {
    const receipts = await prisma.goods_receipts.findMany({
      where: { status: READY_PUTAWAY_STATUS },
      orderBy: { created_at: 'desc' },
      include: {
        warehouses: {
          select: {
            id: true,
            code: true,
            name: true,
          },
        },
        goods_receipt_items: {
          select: {
            id: true,
            location_id: true,
            quantity: true,
          },
        },
      },
    });

    const receiptIds = receipts.map((item) => item.id);
    const postedMovements = receiptIds.length > 0
      ? await prisma.stock_movements.findMany({
        where: {
          reference_type: POSTING_REFERENCE_TYPE,
          movement_status: 'POSTED',
          reference_id: { in: receiptIds },
        },
        select: {
          reference_id: true,
          quantity: true,
          metadata: true,
        },
      })
      : [];

    // Sum PUTAWAY bucket per receipt line (same rules as getReadyReceiptDetail).
    const putawayQtyByReceiptItem = new Map();
    postedMovements.forEach((movement) => {
      const metadata = movement.metadata && typeof movement.metadata === 'object' ? movement.metadata : null;
      const itemId = metadata && metadata.goods_receipt_item_id ? String(metadata.goods_receipt_item_id) : null;
      const bucket = metadata && metadata.movement_bucket ? String(metadata.movement_bucket) : null;
      if (!itemId || bucket !== 'PUTAWAY' || !movement.reference_id) return;
      const rid = String(movement.reference_id);
      const key = `${rid}::${itemId}`;
      putawayQtyByReceiptItem.set(
        key,
        (putawayQtyByReceiptItem.get(key) || 0) + Number(movement.quantity || 0),
      );
    });

    const data = receipts.map((receipt) => {
      const totalLines = receipt.goods_receipt_items.length;
      const totalQuantity = receipt.goods_receipt_items.reduce((sum, item) => sum + item.quantity, 0);

      let putawayQuantity = 0;
      let allocatedLines = 0;
      receipt.goods_receipt_items.forEach((item) => {
        const key = `${receipt.id}::${String(item.id)}`;
        const fromMovements = putawayQtyByReceiptItem.get(key) || 0;
        const linePutaway = fromMovements > 0
          ? Math.min(Number(item.quantity || 0), fromMovements)
          : (item.location_id ? Number(item.quantity || 0) : 0);
        putawayQuantity += linePutaway;
        if (linePutaway > 0) allocatedLines += 1;
      });

      const remainingQuantity = Math.max(totalQuantity - putawayQuantity, 0);

      return {
        id: receipt.id,
        receipt_number: receipt.receipt_number,
        warehouse_id: receipt.warehouse_id,
        warehouse_code: receipt.warehouses?.code || null,
        warehouse_name: receipt.warehouses?.name || null,
        status: receipt.status,
        approved_by_user_id: receipt.received_by_user_id || null,
        received_at: receipt.received_at,
        created_at: receipt.created_at,
        line_count: totalLines,
        allocated_line_count: allocatedLines,
        total_quantity: totalQuantity,
        putaway_quantity: putawayQuantity,
        remaining_quantity: remainingQuantity,
      };
    }).filter((receipt) => receipt.remaining_quantity > 0);

    return res.json(data);
  } catch (error) {
    console.error('Error while loading ready receipts:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

async function getReadyReceiptDetail(req, res) {
  const receiptId = parseId(req.params.id);
  if (!receiptId) {
    return res.status(400).json({ message: 'Invalid goods receipt id' });
  }

  try {
    const receipt = await prisma.goods_receipts.findUnique({
      where: { id: receiptId },
      include: {
        warehouses: {
          select: {
            id: true,
            code: true,
            name: true,
          },
        },
        goods_receipt_items: {
          include: {
            book_variants: {
              include: {
                books: {
                  select: {
                    id: true,
                    title: true,
                  },
                },
              },
            },
            locations: {
              select: {
                id: true,
                location_code: true,
                location_type: true,
              },
            },
          },
          orderBy: { id: 'asc' },
        },
      },
    });

    if (!receipt) {
      return res.status(404).json({ message: 'Goods receipt not found' });
    }

    if (receipt.status !== READY_PUTAWAY_STATUS) {
      return res.status(400).json({ message: 'Only POSTED goods receipts can be put away' });
    }

    const postedMovements = await prisma.stock_movements.findMany({
      where: {
        reference_type: POSTING_REFERENCE_TYPE,
        reference_id: receiptId,
        movement_status: 'POSTED',
      },
      select: {
        quantity: true,
        metadata: true,
      },
    });

    const putawayQtyByItem = new Map();
    postedMovements.forEach((movement) => {
      const metadata = movement.metadata && typeof movement.metadata === 'object' ? movement.metadata : null;
      const itemId = metadata && metadata.goods_receipt_item_id ? String(metadata.goods_receipt_item_id) : null;
      const bucket = metadata && metadata.movement_bucket ? String(metadata.movement_bucket) : null;
      if (!itemId || bucket !== 'PUTAWAY') {
        return;
      }
      const current = putawayQtyByItem.get(itemId) || 0;
      putawayQtyByItem.set(itemId, current + Number(movement.quantity || 0));
    });

    const items = receipt.goods_receipt_items.map((item) => {
      const putawayQty = putawayQtyByItem.has(item.id)
        ? Math.min(Number(item.quantity || 0), Number(putawayQtyByItem.get(item.id) || 0))
        : (item.location_id ? Number(item.quantity || 0) : 0);
      const remainingQty = Math.max(Number(item.quantity || 0) - putawayQty, 0);
      const allocated = putawayQty > 0;

      return {
        id: item.id,
        variant_id: item.variant_id,
        sku: item.book_variants?.sku || null,
        isbn13: item.book_variants?.isbn13 || null,
        isbn10: item.book_variants?.isbn10 || null,
        barcode: item.book_variants?.internal_barcode || item.book_variants?.isbn13 || item.book_variants?.isbn10 || null,
        book_id: item.book_variants?.books?.id || null,
        book_title: item.book_variants?.books?.title || 'Chua co ten sach',
        quantity: item.quantity,
        putaway_quantity: putawayQty,
        remaining_quantity: remainingQty,
        is_allocated: allocated,
        unit_cost: Number(item.unit_cost || 0),
        location_id: item.location_id,
        location_code: item.locations?.location_code || null,
        location_type: item.locations?.location_type || null,
      };
    });

    const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);
    const putawayQuantity = items.reduce((sum, item) => sum + item.putaway_quantity, 0);
    const remainingQuantity = items.reduce((sum, item) => sum + item.remaining_quantity, 0);

    return res.json({
      id: receipt.id,
      receipt_number: receipt.receipt_number,
      warehouse_id: receipt.warehouse_id,
      warehouse_code: receipt.warehouses?.code || null,
      warehouse_name: receipt.warehouses?.name || null,
      status: receipt.status,
      approved_by_user_id: receipt.received_by_user_id || null,
      received_at: receipt.received_at,
      created_at: receipt.created_at,
      note: receipt.note,
      total_quantity: totalQuantity,
      putaway_quantity: putawayQuantity,
      remaining_quantity: remainingQuantity,
      items,
    });
  } catch (error) {
    console.error('Error while loading ready receipt detail:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

async function getPutawayLocations(req, res) {
  const receiptId = parseId(req.params.id);
  if (!receiptId) {
    return res.status(400).json({ message: 'Invalid goods receipt id' });
  }

  try {
    const receipt = await prisma.goods_receipts.findUnique({
      where: { id: receiptId },
      select: {
        id: true,
        status: true,
        warehouse_id: true,
      },
    });

    if (!receipt) {
      return res.status(404).json({ message: 'Goods receipt not found' });
    }

    if (receipt.status !== READY_PUTAWAY_STATUS) {
      return res.status(400).json({ message: 'Only POSTED goods receipts can be put away' });
    }

    const locations = await prisma.locations.findMany({
      where: {
        warehouse_id: receipt.warehouse_id,
        is_active: true,
      },
      select: {
        id: true,
        warehouse_id: true,
        parent_location_id: true,
        location_type: true,
        location_code: true,
        is_active: true,
        capacity_qty: true,
      },
      orderBy: { location_code: 'asc' },
    });

    const locationMap = new Map(locations.map((item) => [item.id, item]));

    const zones = locations
      .filter((item) => normalizeLocationType(item.location_type) === 'ZONE')
      .map((item) => ({
        id: item.id,
        location_code: item.location_code,
        location_name: item.location_code,
      }));

    const shelves = locations
      .filter((item) => normalizeLocationType(item.location_type) === 'SHELF')
      .map((item) => {
        const zone = getZoneAncestor(item, locationMap);
        return {
          id: item.id,
          location_code: item.location_code,
          location_name: item.location_code,
          zone_id: zone?.id || null,
          zone_code: zone?.location_code || null,
        };
      })
      .filter((item) => item.zone_id);

    const shelvesById = new Map(shelves.map((item) => [item.id, item]));

    const compartmentRows = locations
      .filter((item) => {
        const type = normalizeLocationType(item.location_type);
        return type === 'SHELF_COMPARTMENT' || type === 'BIN';
      })
      .map((item) => {
        const shelf = getShelfAncestor(item, locationMap);
        if (!shelf) {
          return null;
        }

        const shelfInfo = shelvesById.get(shelf.id);
        if (!shelfInfo) {
          return null;
        }

        return {
          id: item.id,
          location_code: item.location_code,
          location_name: item.location_code,
          shelf_id: shelf.id,
          shelf_code: shelf.location_code,
          zone_id: shelfInfo.zone_id,
          capacity_qty: item.capacity_qty,
        };
      })
      .filter(Boolean);

    const compartmentIds = compartmentRows.map((row) => row.id);
    const occupancyByLocation = new Map();
    if (compartmentIds.length > 0) {
      const occupancy = await prisma.stock_balances.groupBy({
        by: ['location_id'],
        where: { location_id: { in: compartmentIds } },
        _sum: { on_hand_qty: true },
      });
      occupancy.forEach((row) => {
        occupancyByLocation.set(row.location_id, Number(row._sum.on_hand_qty || 0));
      });
    }

    const compartments = compartmentRows.map((row) => {
      const locationCapacity = Number(row.capacity_qty || 0);
      const maxCapacity =
        locationCapacity > 0
          ? Math.min(locationCapacity, MAX_COMPARTMENT_CAPACITY)
          : MAX_COMPARTMENT_CAPACITY;
      const occupiedQty = occupancyByLocation.get(row.id) || 0;
      const remainingCapacity = Math.max(maxCapacity - occupiedQty, 0);
      return {
        id: row.id,
        location_code: row.location_code,
        location_name: row.location_name,
        shelf_id: row.shelf_id,
        shelf_code: row.shelf_code,
        zone_id: row.zone_id,
        capacity_qty: row.capacity_qty == null ? null : locationCapacity,
        occupied_qty: occupiedQty,
        remaining_capacity: remainingCapacity,
      };
    });

    return res.json({
      warehouse_id: receipt.warehouse_id,
      zones,
      shelves,
      compartments,
    });
  } catch (error) {
    console.error('Error while loading putaway locations:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

async function confirmPutaway(req, res) {
  const receiptId = parseId(req.params.id);
  const allocations = Array.isArray(req.body.allocations) ? req.body.allocations : [];
  const userId = req.user?.id || null;

  if (!receiptId) {
    return res.status(400).json({ message: 'Invalid goods receipt id' });
  }
  if (allocations.length === 0) {
    return res.status(400).json({ message: 'allocations is required' });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const receipt = await tx.goods_receipts.findUnique({
        where: { id: receiptId },
        select: {
          id: true,
          status: true,
          warehouse_id: true,
        },
      });

      if (!receipt) {
        return { notFound: true };
      }
      if (receipt.status !== READY_PUTAWAY_STATUS) {
        return { invalid: true, message: 'Only POSTED goods receipts can be put away' };
      }

      const receiptItems = await tx.goods_receipt_items.findMany({
        where: { goods_receipt_id: receiptId },
        select: {
          id: true,
          goods_receipt_id: true,
          variant_id: true,
          quantity: true,
          unit_cost: true,
          location_id: true,
        },
      });

      if (receiptItems.length === 0) {
        return { invalid: true, message: 'Goods receipt has no item lines' };
      }

      // Track which items are already fully putaway (location already assigned).
      const alreadyPutawayItemIds = new Set(
        receiptItems.filter((item) => item.location_id !== null).map((item) => String(item.id))
      );

      // Build a map of already-posted putaway quantities per item.
      const existingPostedMovements = await tx.stock_movements.findMany({
        where: {
          reference_type: POSTING_REFERENCE_TYPE,
          reference_id: receiptId,
          movement_status: 'POSTED',
        },
        select: { quantity: true, metadata: true },
      });

      const alreadyPutawayQtyByItem = new Map();
      existingPostedMovements.forEach((m) => {
        const meta = m.metadata && typeof m.metadata === 'object' ? m.metadata : null;
        const itemId = meta?.goods_receipt_item_id ? String(meta.goods_receipt_item_id) : null;
        const bucket = meta?.movement_bucket ? String(meta.movement_bucket) : null;
        if (!itemId || bucket !== 'PUTAWAY') return;
        const current = alreadyPutawayQtyByItem.get(itemId) || 0;
        alreadyPutawayQtyByItem.set(itemId, current + Number(m.quantity || 0));
      });

      // Items that still need to be putaway (fully or partially).
      const itemsToProcess = receiptItems.filter((item) => {
        if (!alreadyPutawayItemIds.has(String(item.id))) return true;
        const alreadyDone = alreadyPutawayQtyByItem.get(String(item.id)) || 0;
        return alreadyDone < Number(item.quantity || 0);
      });

      if (itemsToProcess.length === 0) {
        return {
          invalid: true,
          message: 'All item lines have already been fully putaway',
        };
      }

      const allocationMap = new Map();
      for (const allocation of allocations) {
        const itemId = parseId(allocation?.item_id);
        const zoneId = parseId(allocation?.zone_id);
        const shelfId = parseId(allocation?.shelf_id);
        const compartmentId = parseId(allocation?.compartment_id);
        const putawayQuantity = toInt(allocation?.putaway_quantity);

        if (!itemId || putawayQuantity === null || putawayQuantity < 0) {
          return { invalid: true, message: 'Each allocation must include item_id and putaway_quantity >= 0' };
        }

        if (putawayQuantity > 0 && (!zoneId || !shelfId || !compartmentId)) {
          return { invalid: true, message: 'Allocation with putaway_quantity > 0 must include zone_id, shelf_id and compartment_id' };
        }

        allocationMap.set(itemId, {
          item_id: itemId,
          zone_id: zoneId,
          shelf_id: shelfId,
          compartment_id: compartmentId,
          putaway_quantity: putawayQuantity,
        });
      }

      for (const item of itemsToProcess) {
        if (!allocationMap.has(String(item.id))) {
          return { invalid: true, message: 'Cannot complete putaway while some item lines are not allocated' };
        }
      }

      const receiptItemIds = new Set(receiptItems.map((item) => String(item.id)));
      for (const itemId of allocationMap.keys()) {
        if (!receiptItemIds.has(itemId)) {
          return { invalid: true, message: 'Allocation contains an item that does not belong to this goods receipt' };
        }
      }

      const activeLocations = await tx.locations.findMany({
        where: {
          warehouse_id: receipt.warehouse_id,
          is_active: true,
        },
        select: {
          id: true,
          warehouse_id: true,
          parent_location_id: true,
          location_type: true,
          location_code: true,
        },
      });

      const locationMap = new Map(activeLocations.map((item) => [item.id, item]));

      const fallbackLocation = activeLocations.find((item) => {
        const type = normalizeLocationType(item.location_type);
        return type === 'RECEIVING' || type === 'STAGING';
      }) || null;

      const updates = [];
      const postingEntries = [];
      for (const item of receiptItems) {
        const itemId = String(item.id);
        const allocation = allocationMap.get(itemId);
        const totalQuantity = Number(item.quantity || 0);
        const alreadyPutawayQty = alreadyPutawayQtyByItem.get(itemId) || 0;
        const putawayQuantity = allocation.putaway_quantity;

        if (putawayQuantity > totalQuantity) {
          return { invalid: true, message: 'putaway_quantity cannot exceed received quantity' };
        }

        let shelf = null;
        let zone = null;
        let compartment = null;

        if (putawayQuantity > 0) {
          shelf = locationMap.get(allocation.shelf_id);
          zone = locationMap.get(allocation.zone_id);
          compartment = locationMap.get(allocation.compartment_id);

          if (!shelf || !zone || !compartment) {
            return { invalid: true, message: 'Selected zone, shelf or compartment is invalid or inactive' };
          }

          if (normalizeLocationType(zone.location_type) !== 'ZONE') {
            return { invalid: true, message: 'zone_id must be a ZONE location' };
          }

          if (normalizeLocationType(shelf.location_type) !== 'SHELF') {
            return { invalid: true, message: 'shelf_id must be a SHELF location' };
          }

          {
            const compartmentType = normalizeLocationType(compartment.location_type);
            if (compartmentType !== 'SHELF_COMPARTMENT' && compartmentType !== 'BIN') {
              return { invalid: true, message: 'compartment_id must be a SHELF_COMPARTMENT location' };
            }
          }

          const shelfZone = getZoneAncestor(shelf, locationMap);
          if (!shelfZone || shelfZone.id !== zone.id) {
            return { invalid: true, message: 'Selected shelf does not belong to the selected zone' };
          }

          const compartmentShelf = getShelfAncestor(compartment, locationMap);
          if (!compartmentShelf || compartmentShelf.id !== shelf.id) {
            return { invalid: true, message: 'Selected compartment does not belong to the selected shelf' };
          }
        }

        // remaining after this putaway session, accounting for any previous partial putaway
        const remainingQuantity = Math.max(totalQuantity - alreadyPutawayQty - putawayQuantity, 0);
        const remainingLocationId = remainingQuantity > 0 ? (fallbackLocation?.id || null) : null;
        if (putawayQuantity > 0) {
          postingEntries.push({
            goods_receipt_item_id: itemId,
            variant_id: item.variant_id,
            unit_cost: item.unit_cost,
            location_id: compartment.id,
            quantity: putawayQuantity,
            movement_bucket: 'PUTAWAY',
          });
        }

        if (remainingQuantity > 0) {
          postingEntries.push({
            goods_receipt_item_id: itemId,
            variant_id: item.variant_id,
            unit_cost: item.unit_cost,
            location_id: remainingLocationId,
            quantity: remainingQuantity,
            movement_bucket: 'REMAINING',
          });
        }

        updates.push({
          item_id: itemId,
          location_id: remainingQuantity > 0
            ? remainingLocationId
            : (putawayQuantity > 0 ? compartment.id : null),
        });
      }

      const putawayIncrementByLocation = new Map();
      postingEntries.forEach((entry) => {
        if (entry.movement_bucket === 'PUTAWAY' && entry.location_id) {
          const lid = entry.location_id;
          const add = Number(entry.quantity || 0);
          putawayIncrementByLocation.set(lid, (putawayIncrementByLocation.get(lid) || 0) + add);
        }
      });

      const putawayLocationIds = Array.from(putawayIncrementByLocation.keys());
      if (putawayLocationIds.length > 0) {
        await tx.$queryRawUnsafe(
          'SELECT id FROM locations WHERE id = ANY($1::uuid[]) FOR UPDATE',
          putawayLocationIds,
        );

        const targetLocs = await tx.locations.findMany({
          where: {
            id: { in: putawayLocationIds },
            warehouse_id: receipt.warehouse_id,
            is_active: true,
          },
          select: {
            id: true,
            location_code: true,
            location_type: true,
            capacity_qty: true,
          },
        });

        if (targetLocs.length !== putawayLocationIds.length) {
          return { invalid: true, message: 'One or more putaway target locations are invalid or inactive' };
        }

        const occRows = await tx.stock_balances.groupBy({
          by: ['location_id'],
          where: { location_id: { in: putawayLocationIds } },
          _sum: { on_hand_qty: true },
        });
        const occMap = new Map();
        occRows.forEach((row) => {
          occMap.set(row.location_id, Number(row._sum.on_hand_qty || 0));
        });
        const locById = new Map(targetLocs.map((loc) => [loc.id, loc]));

        for (const [locationId, increment] of putawayIncrementByLocation) {
          const target = locById.get(locationId);
          const compartmentType = normalizeLocationType(target.location_type);
          if (compartmentType !== 'SHELF_COMPARTMENT' && compartmentType !== 'BIN') {
            return {
              invalid: true,
              message: `Location ${target.location_code} is not a valid shelf compartment for putaway`,
            };
          }
          const currentOnHand = occMap.get(locationId) || 0;
          const locationCapacity = Number(target.capacity_qty || 0);
          const maxCapacity =
            locationCapacity > 0
              ? Math.min(locationCapacity, MAX_COMPARTMENT_CAPACITY)
              : MAX_COMPARTMENT_CAPACITY;
          const remaining = Math.max(maxCapacity - currentOnHand, 0);
          if (increment > remaining) {
            return {
              invalid: true,
              message:
                `Shelf compartment ${target.location_code} only has ${remaining} remaining capacity (max ${maxCapacity}, currently ${currentOnHand}). Cannot put away ${increment} unit(s).`,
            };
          }
        }
      }

      await Promise.all(updates.map((update) => tx.goods_receipt_items.update({
        where: { id: update.item_id },
        data: { location_id: update.location_id },
      })));

      const finalItems = await tx.goods_receipt_items.findMany({
        where: { goods_receipt_id: receiptId },
        select: {
          id: true,
          variant_id: true,
          quantity: true,
          unit_cost: true,
          location_id: true,
        },
      });

      if (postingEntries.length === 0) {
        return { invalid: true, message: 'No quantity to post' };
      }

      const aggregatedBalanceEntries = aggregateBalanceEntries(postingEntries);
      const availableIncrementMap = new Map();
      postingEntries
        .filter((entry) => entry.movement_bucket === 'PUTAWAY')
        .forEach((entry) => {
          const key = `${entry.variant_id}::${entry.location_id}`;
          const current = availableIncrementMap.get(key) || 0;
          availableIncrementMap.set(key, current + Number(entry.quantity || 0));
        });

      for (const entry of aggregatedBalanceEntries) {
        const key = `${entry.variant_id}::${entry.location_id}`;
        const availableIncrement = Number(availableIncrementMap.get(key) || 0);

        await tx.stock_balances.upsert({
          where: {
            variant_id_location_id: {
              variant_id: entry.variant_id,
              location_id: entry.location_id,
            },
          },
          update: {
            on_hand_qty: { increment: entry.quantity },
            available_qty: { increment: availableIncrement },
            version: { increment: 1 },
            last_movement_at: new Date(),
          },
          create: {
            warehouse_id: receipt.warehouse_id,
            variant_id: entry.variant_id,
            location_id: entry.location_id,
            on_hand_qty: entry.quantity,
            available_qty: availableIncrement,
            version: 1,
            last_movement_at: new Date(),
          },
        });
      }

      const baseTimestamp = Date.now();

      await tx.stock_movements.createMany({
        data: postingEntries.map((entry, index) => ({
          movement_number: createMovementNumber(baseTimestamp, index),
          movement_type: PUTAWAY_MOVEMENT_TYPE,
          movement_status: 'POSTED',
          warehouse_id: receipt.warehouse_id,
          variant_id: entry.variant_id,
          to_location_id: entry.location_id,
          quantity: entry.quantity,
          unit_cost: entry.unit_cost,
          source_service: 'INVENTORY_SERVICE',
          reference_type: POSTING_REFERENCE_TYPE,
          reference_id: receiptId,
          created_by_user_id: userId,
          metadata: {
            putaway: true,
            movement_bucket: entry.movement_bucket,
            goods_receipt_item_id: entry.goods_receipt_item_id,
          },
        })),
      });

      return {
        success: true,
        allocated_line_count: finalItems.filter((item) => Boolean(item.location_id)).length,
      };
    });

    if (result.notFound) {
      return res.status(404).json({ message: 'Goods receipt not found' });
    }

    if (result.invalid) {
      return res.status(400).json({ message: result.message });
    }

    return res.status(201).json({
      message: 'Putaway completed and stock posted successfully',
      data: result,
    });
  } catch (error) {
    console.error('Error while confirming putaway:', error);
    const debugMessage = typeof error?.message === 'string' ? error.message : 'Internal server error';
    const debugCode = error?.code ? String(error.code) : 'INTERNAL_ERROR';
    return res.status(500).json({ message: debugMessage, code: debugCode });
  }
}

module.exports = {
  getReadyReceipts,
  getReadyReceiptDetail,
  getPutawayLocations,
  confirmPutaway,
};
