const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const LOCATION_TYPES = ['ZONE', 'SHELF', 'SHELF_COMPARTMENT'];
const ROOT_TYPES = ['ZONE'];
const CHILD_TYPE_BY_PARENT = {
  ZONE: 'SHELF',
  SHELF: 'SHELF_COMPARTMENT',
};
const MAX_SHELVES_PER_ZONE = 5;
const MAX_COMPARTMENTS_PER_SHELF = 10;
const MAX_COMPARTMENT_CAPACITY = 100;

const LOCATION_SELECT_FIELDS = {
  id: true,
  warehouse_id: true,
  parent_location_id: true,
  location_code: true,
  location_type: true,
  zone: true,
  aisle: true,
  shelf: true,
  bin: true,
  barcode: true,
  capacity_qty: true,
  is_pickable: true,
  is_active: true,
  created_at: true,
  updated_at: true,
};

function parseId(value) {
  return String(value || '').trim() || null;
}

function normalizeText(value) {
  const text = String(value || '').trim();
  return text || null;
}

function normalizeBoolean(value, defaultValue = true) {
  if (value === undefined) return defaultValue;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;
  }
  return defaultValue;
}

function normalizeNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const num = Number(value);
  if (Number.isNaN(num)) return null;
  return num;
}

function ensureLocationType(value) {
  const type = String(value || '').trim().toUpperCase();
  return LOCATION_TYPES.includes(type) ? type : null;
}

function toDbLocationType(type) {
  const normalized = String(type || '').trim().toUpperCase();
  // Backward compatibility: old DB check constraints may not include SHELF_COMPARTMENT.
  return normalized === 'SHELF_COMPARTMENT' ? 'BIN' : normalized;
}

function fromDbLocationType(type) {
  const normalized = String(type || '').trim().toUpperCase();
  return normalized === 'BIN' ? 'SHELF_COMPARTMENT' : normalized;
}

function buildLocationLabel(location) {
  if (!location) return '';
  const dynamicPath = [location.zone, location.aisle, location.shelf, location.bin].filter(Boolean).join(' / ');
  return dynamicPath || location.location_code;
}

function expectedChildType(parentType) {
  return CHILD_TYPE_BY_PARENT[fromDbLocationType(parentType)] || null;
}

function buildLocationTree(rows) {
  const map = new Map();
  const roots = [];

  rows.forEach((row) => {
    map.set(row.id, {
      ...row,
      name: buildLocationLabel(row),
      description: null,
      sort_order: 0,
      code: row.location_code,
      children: [],
    });
  });

  map.forEach((node) => {
    if (node.parent_location_id && map.has(node.parent_location_id)) {
      map.get(node.parent_location_id).children.push(node);
      return;
    }
    roots.push(node);
  });

  const byCode = (a, b) => a.location_code.localeCompare(b.location_code);
  const sortNodes = (nodes) => {
    nodes.sort(byCode);
    nodes.forEach((node) => sortNodes(node.children));
  };

  sortNodes(roots);
  return roots;
}

function canAttachToParent(type, parentType) {
  if (!parentType) {
    return ROOT_TYPES.includes(type);
  }

  const expectedType = CHILD_TYPE_BY_PARENT[fromDbLocationType(parentType)];
  return Boolean(expectedType && expectedType === type);
}

async function ensureChildrenCompatible(locationId, finalType) {
  const childTypes = await prisma.locations.findMany({
    where: { parent_location_id: locationId },
    select: { location_type: true },
  });

  if (childTypes.length === 0) {
    return true;
  }

  const expectedType = expectedChildType(finalType);
  if (!expectedType) {
    return false;
  }

  return childTypes.every((child) => {
    const childType = fromDbLocationType(child.location_type);
    return childType === expectedType;
  });
}

async function ensureNoCycle(locationId, targetParentId, warehouseId) {
  if (!targetParentId) return true;
  if (targetParentId === locationId) return false;

  const locations = await prisma.locations.findMany({
    where: { warehouse_id: warehouseId },
    select: { id: true, parent_location_id: true },
  });

  const childrenByParent = new Map();
  locations.forEach((item) => {
    if (!item.parent_location_id) return;
    const list = childrenByParent.get(item.parent_location_id) || [];
    list.push(item.id);
    childrenByParent.set(item.parent_location_id, list);
  });

  const queue = [locationId];
  const visited = new Set();

  while (queue.length > 0) {
    const current = queue.shift();
    if (visited.has(current)) continue;
    visited.add(current);

    const children = childrenByParent.get(current) || [];
    children.forEach((child) => queue.push(child));
  }

  return !visited.has(targetParentId);
}

async function loadLocation(id) {
  return prisma.locations.findUnique({
    where: { id },
    select: LOCATION_SELECT_FIELDS,
  });
}

function locationPayload(location) {
  return {
    ...location,
    location_type: fromDbLocationType(location.location_type),
    code: location.location_code,
    name: buildLocationLabel(location),
    description: null,
    sort_order: 0,
  };
}

async function ensureParentChildCapacity(parentId, parentType, childType, excludeId = null) {
  if (!parentId) {
    return { ok: true };
  }

  if (parentType === 'ZONE' && childType === 'SHELF') {
    const count = await prisma.locations.count({
      where: {
        parent_location_id: parentId,
        location_type: 'SHELF',
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
    });

    if (count >= MAX_SHELVES_PER_ZONE) {
      return {
        ok: false,
        message: `A ZONE can contain at most ${MAX_SHELVES_PER_ZONE} SHELF nodes`,
      };
    }
  }

  if (parentType === 'SHELF' && childType === 'SHELF_COMPARTMENT') {
    const count = await prisma.locations.count({
      where: {
        parent_location_id: parentId,
        location_type: { in: ['SHELF_COMPARTMENT', 'BIN'] },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
    });

    if (count >= MAX_COMPARTMENTS_PER_SHELF) {
      return {
        ok: false,
        message: `A SHELF can contain at most ${MAX_COMPARTMENTS_PER_SHELF} SHELF_COMPARTMENT nodes`,
      };
    }
  }

  return { ok: true };
}

function typeParts(type, code) {
  const normalizedType = fromDbLocationType(type);
  return {
    zone: normalizedType === 'ZONE' ? code : null,
    shelf: normalizedType === 'SHELF' ? code : null,
    aisle: null,
    bin: normalizedType === 'SHELF_COMPARTMENT' ? code : null,
  };
}

async function getZonesAndBinsByWarehouse(req, res) {
  const warehouseId = parseId(req.params.warehouseId || req.params.id);

  if (!warehouseId) {
    return res.status(400).json({ message: 'Invalid warehouse id' });
  }

  try {
    const warehouse = await prisma.warehouses.findUnique({
      where: { id: warehouseId },
      include: {
        locations: {
          select: LOCATION_SELECT_FIELDS,
          orderBy: [
            { location_type: 'asc' },
            { location_code: 'asc' },
          ],
        },
      },
    });

    if (!warehouse) {
      return res.status(404).json({ message: 'Warehouse not found' });
    }

    return res.json({
      warehouse: {
        id: warehouse.id,
        name: warehouse.name,
        code: warehouse.code,
      },
      locations: warehouse.locations.map(locationPayload),
    });
  } catch (error) {
    console.error('Error while fetching zones and bins:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

async function getLocationTreeByWarehouse(req, res) {
  const warehouseId = parseId(req.params.warehouseId);
  if (!warehouseId) {
    return res.status(400).json({ message: 'Invalid warehouse id' });
  }

  try {
    const warehouse = await prisma.warehouses.findUnique({
      where: { id: warehouseId },
      select: { id: true, code: true, name: true },
    });

    if (!warehouse) {
      return res.status(404).json({ message: 'Warehouse not found' });
    }

    const locations = await prisma.locations.findMany({
      where: { warehouse_id: warehouseId },
      select: LOCATION_SELECT_FIELDS,
      orderBy: [{ location_type: 'asc' }, { location_code: 'asc' }],
    });

    return res.json({
      warehouse,
      locations: locations.map(locationPayload),
      tree: buildLocationTree(locations),
    });
  } catch (error) {
    console.error('Error while fetching location tree:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

async function getLocationById(req, res) {
  const id = parseId(req.params.id);

  if (!id) {
    return res.status(400).json({ message: 'Invalid location id' });
  }

  try {
    const location = await loadLocation(id);
    if (!location) {
      return res.status(404).json({ message: 'Location not found' });
    }

    return res.json(locationPayload(location));
  } catch (error) {
    console.error('Error while fetching location by id:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

async function createLocation(req, res) {
  const warehouseId = parseId(req.body.warehouse_id);
  const parentId = parseId(req.body.parent_location_id);
  const code = normalizeText(req.body.code || req.body.location_code);
  const type = ensureLocationType(req.body.location_type);

  if (!warehouseId) {
    return res.status(400).json({ message: 'warehouse_id is required' });
  }
  if (!code) {
    return res.status(400).json({ message: 'code is required' });
  }
  if (!type) {
    return res.status(400).json({ message: `location_type must be one of: ${LOCATION_TYPES.join(', ')}` });
  }

  try {
    const warehouse = await prisma.warehouses.findUnique({ where: { id: warehouseId } });
    if (!warehouse) {
      return res.status(404).json({ message: 'Warehouse not found' });
    }

    let parent = null;
    if (parentId) {
      parent = await prisma.locations.findUnique({
        where: { id: parentId },
        select: {
          id: true,
          warehouse_id: true,
          location_type: true,
        },
      });
      if (!parent) {
        return res.status(400).json({ message: 'parent_location_id not found' });
      }
      if (parent.warehouse_id !== warehouseId) {
        return res.status(400).json({ message: 'Parent location must belong to the same warehouse' });
      }
    }

    if (!canAttachToParent(type, parent?.location_type || null)) {
      return res.status(400).json({ message: 'Invalid parent-child location_type relationship' });
    }

    const capacityCheck = await ensureParentChildCapacity(parentId, parent?.location_type || null, type);
    if (!capacityCheck.ok) {
      return res.status(400).json({ message: capacityCheck.message });
    }

    const requestedCapacity = normalizeNumber(req.body.capacity_qty);
    if (type === 'SHELF_COMPARTMENT' && requestedCapacity !== null && requestedCapacity > MAX_COMPARTMENT_CAPACITY) {
      return res.status(400).json({ message: `SHELF_COMPARTMENT capacity cannot exceed ${MAX_COMPARTMENT_CAPACITY}` });
    }

    const data = {
      warehouse_id: warehouseId,
      parent_location_id: parentId,
      location_code: code,
      location_type: toDbLocationType(type),
      barcode: normalizeText(req.body.barcode),
      capacity_qty: type === 'SHELF_COMPARTMENT'
        ? (requestedCapacity ?? MAX_COMPARTMENT_CAPACITY)
        : requestedCapacity,
      is_pickable: normalizeBoolean(req.body.is_pickable, true),
      is_active: normalizeBoolean(req.body.is_active, true),
      ...typeParts(type, code),
    };

    const created = await prisma.locations.create({ data });
    const full = await loadLocation(created.id);
    return res.status(201).json(locationPayload(full));
  } catch (error) {
    if (error?.code === 'P2002') {
      return res.status(409).json({ message: 'Location code already exists in this warehouse' });
    }
    console.error('Error while creating location:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

async function updateLocation(req, res) {
  const id = parseId(req.params.id);
  if (!id) {
    return res.status(400).json({ message: 'Invalid location id' });
  }

  const nextCode = req.body.code !== undefined || req.body.location_code !== undefined
    ? normalizeText(req.body.code || req.body.location_code)
    : undefined;
  const nextType = req.body.location_type !== undefined ? ensureLocationType(req.body.location_type) : undefined;
  const nextParentId = req.body.parent_location_id !== undefined ? parseId(req.body.parent_location_id) : undefined;

  if ((req.body.code !== undefined || req.body.location_code !== undefined) && !nextCode) {
    return res.status(400).json({ message: 'code cannot be empty' });
  }
  if (req.body.location_type !== undefined && !nextType) {
    return res.status(400).json({ message: `location_type must be one of: ${LOCATION_TYPES.join(', ')}` });
  }

  try {
    const current = await loadLocation(id);
    if (!current) {
      return res.status(404).json({ message: 'Location not found' });
    }

    const finalParentId = nextParentId !== undefined ? nextParentId : current.parent_location_id;
    const finalType = nextType || current.location_type;

    let parent = null;
    if (finalParentId) {
      parent = await prisma.locations.findUnique({
        where: { id: finalParentId },
        select: {
          id: true,
          warehouse_id: true,
          location_type: true,
        },
      });
      if (!parent) {
        return res.status(400).json({ message: 'parent_location_id not found' });
      }
      if (parent.warehouse_id !== current.warehouse_id) {
        return res.status(400).json({ message: 'Parent location must belong to the same warehouse' });
      }
    }

    const validTree = await ensureNoCycle(current.id, finalParentId, current.warehouse_id);
    if (!validTree) {
      return res.status(400).json({ message: 'Cannot create parent-child cycle' });
    }

    const childrenCompatible = await ensureChildrenCompatible(current.id, finalType);
    if (!childrenCompatible) {
      return res.status(400).json({ message: 'Cannot update location_type because existing children would violate hierarchy rules' });
    }

    if (!canAttachToParent(finalType, parent?.location_type || null)) {
      return res.status(400).json({ message: 'Invalid parent-child location_type relationship' });
    }

    const capacityCheck = await ensureParentChildCapacity(finalParentId, parent?.location_type || null, finalType, current.id);
    if (!capacityCheck.ok) {
      return res.status(400).json({ message: capacityCheck.message });
    }

    const requestedCapacity = req.body.capacity_qty !== undefined ? normalizeNumber(req.body.capacity_qty) : undefined;
    if (requestedCapacity !== undefined && finalType === 'SHELF_COMPARTMENT' && requestedCapacity !== null && requestedCapacity > MAX_COMPARTMENT_CAPACITY) {
      return res.status(400).json({ message: `SHELF_COMPARTMENT capacity cannot exceed ${MAX_COMPARTMENT_CAPACITY}` });
    }

    const finalCode = nextCode !== undefined ? nextCode : current.location_code;
    const updateData = {
      ...(nextParentId !== undefined ? { parent_location_id: nextParentId } : {}),
      ...(nextCode !== undefined ? { location_code: nextCode } : {}),
      ...(nextType !== undefined ? { location_type: nextType } : {}),
      ...(req.body.barcode !== undefined ? { barcode: normalizeText(req.body.barcode) } : {}),
      ...(req.body.capacity_qty !== undefined ? { capacity_qty: requestedCapacity } : {}),
      ...(req.body.is_pickable !== undefined ? { is_pickable: normalizeBoolean(req.body.is_pickable, true) } : {}),
      ...(req.body.is_active !== undefined ? { is_active: normalizeBoolean(req.body.is_active, true) } : {}),
      ...((nextType !== undefined || nextCode !== undefined) ? typeParts(finalType, finalCode) : {}),
    };

    if (nextType !== undefined) {
      updateData.location_type = toDbLocationType(nextType);
    }

    if (nextType !== undefined && finalType === 'SHELF_COMPARTMENT' && req.body.capacity_qty === undefined && (current.capacity_qty || 0) > MAX_COMPARTMENT_CAPACITY) {
      updateData.capacity_qty = MAX_COMPARTMENT_CAPACITY;
    }

    const updated = await prisma.locations.update({
      where: { id },
      data: updateData,
    });

    const full = await loadLocation(updated.id);
    return res.json(locationPayload(full));
  } catch (error) {
    if (error?.code === 'P2002') {
      return res.status(409).json({ message: 'Location code already exists in this warehouse' });
    }
    console.error('Error while updating location:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

async function deleteLocation(req, res) {
  const id = parseId(req.params.id);

  if (!id) {
    return res.status(400).json({ message: 'Invalid location id' });
  }

  try {
    const location = await prisma.locations.findUnique({
      where: { id },
      select: {
        id: true,
      },
    });
    if (!location) {
      return res.status(404).json({ message: 'Location not found' });
    }

    const [
      childrenCount,
      stockBalanceCount,
      stockMovementCount,
      stockAuditLineCount,
      inventoryUnitCount,
      transferItemCount,
      outboundItemCount,
      goodsReceiptItemCount,
      reservationCount,
    ] = await Promise.all([
      prisma.locations.count({ where: { parent_location_id: id } }),
      prisma.stock_balances.count({ where: { location_id: id } }),
      prisma.stock_movements.count({ where: { OR: [{ from_location_id: id }, { to_location_id: id }] } }),
      prisma.stock_audit_lines.count({ where: { location_id: id } }),
      prisma.inventory_units.count({ where: { OR: [{ home_location_id: id }, { current_location_id: id }] } }),
      prisma.transfer_order_items.count({ where: { OR: [{ from_location_id: id }, { to_location_id: id }] } }),
      prisma.outbound_order_items.count({ where: { source_location_id: id } }),
      prisma.goods_receipt_items.count({ where: { location_id: id } }),
      prisma.stock_reservations.count({ where: { location_id: id } }),
    ]);

    const conflicts = [];
    if (childrenCount > 0) conflicts.push(`Location has ${childrenCount} child node(s)`);
    if (stockBalanceCount > 0) conflicts.push(`Location is used by ${stockBalanceCount} stock balance record(s)`);
    if (stockMovementCount > 0) conflicts.push(`Location is used by ${stockMovementCount} stock movement record(s)`);
    if (stockAuditLineCount > 0) conflicts.push(`Location is used by ${stockAuditLineCount} stock audit line(s)`);
    if (inventoryUnitCount > 0) conflicts.push(`Location is used by ${inventoryUnitCount} inventory unit(s)`);
    if (transferItemCount > 0) conflicts.push(`Location is used by ${transferItemCount} transfer item(s)`);
    if (outboundItemCount > 0) conflicts.push(`Location is used by ${outboundItemCount} outbound item(s)`);
    if (goodsReceiptItemCount > 0) conflicts.push(`Location is used by ${goodsReceiptItemCount} goods receipt item(s)`);
    if (reservationCount > 0) conflicts.push(`Location is used by ${reservationCount} stock reservation(s)`);

    if (conflicts.length > 0) {
      return res.status(409).json({
        message: 'Cannot delete location because it is referenced by existing records',
        conflicts,
      });
    }

    await prisma.locations.delete({ where: { id } });
    return res.status(204).send();
  } catch (error) {
    console.error('Error while deleting location:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

module.exports = {
  getZonesAndBinsByWarehouse,
  getLocationTreeByWarehouse,
  getLocationById,
  createLocation,
  updateLocation,
  deleteLocation,
};