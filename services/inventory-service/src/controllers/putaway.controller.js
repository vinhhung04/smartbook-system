
const { prisma } = require('../lib/prisma');

const READY_PUTAWAY_STATUS = 'POSTED';
const POSTING_REFERENCE_TYPE = 'GOODS_RECEIPT';
const PUTAWAY_REFERENCE_TYPE = 'RECEIVING_SHELF_PUTAWAY';

const { parseId } = require('../utils/validation');
const { normalizeLocationType } = require('../utils/validation');
const { MAX_COMPARTMENT_CAPACITY } = require('../utils/constants');
const {
  requireAssignableUser,
  requireWarehouseReadAccess,
  requireWarehouseWriteAccess,
  scopedWarehouseWhere,
  scopeErrorStatus,
} = require('../utils/warehouse-scope.utils');

// Phase 5 warehouse scope: the receipt's stored warehouse decides - read to
// list / open it, write to claim / assign. Putting stock away is
// POST /api/receiving-putaway/transfer (moves it out of RECEIVING).

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

function getTaskPermissionScope(user = {}) {
  const roles = Array.isArray(user.roles)
    ? user.roles.map((role) => String(role).toUpperCase())
    : [];

  return {
    currentUserId: parseId(user.id || user.sub),
    canManageAssignment:
      Boolean(user.is_superuser) ||
      roles.includes('ADMIN') ||
      roles.includes('MANAGER'),
  };
}

function filterReceiptsForStaff(receipts, req) {
  const scope = getTaskPermissionScope(req.user || {});
  if (scope.canManageAssignment) return receipts;
  // Staff thấy: chưa giao cho ai (putaway_assignee_user_id = null)
  // hoặc đã được giao cho chính họ
  return receipts.filter(
    (r) => !r.putaway_assignee_user_id || r.putaway_assignee_user_id === scope.currentUserId
  );
}

function canAccessReceipt(req, receipt) {
  const scope = getTaskPermissionScope(req.user || {});
  if (scope.canManageAssignment) return true;
  // Staff có thể xem nếu: chưa giao cho ai, hoặc đã giao cho chính họ
  return !receipt?.putaway_assignee_user_id ||
    Boolean(scope.currentUserId && receipt?.putaway_assignee_user_id === scope.currentUserId);
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
    const allReceipts = await prisma.goods_receipts.findMany({
      where: { status: READY_PUTAWAY_STATUS, ...(await scopedWarehouseWhere(req.user, 'warehouse_id', req.query.warehouse_id || null)) },
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
            variant_id: true,
            location_id: true,
            quantity: true,
          },
        },
      },
    });

    const receipts = filterReceiptsForStaff(allReceipts, req);
    const receiptIds = receipts.map((item) => item.id);
    const postedMovements = receiptIds.length > 0
      ? await prisma.stock_movements.findMany({
        where: {
          reference_type: { in: [POSTING_REFERENCE_TYPE, PUTAWAY_REFERENCE_TYPE] },
          movement_status: 'POSTED',
          reference_id: { in: receiptIds },
        },
        select: {
          reference_id: true,
          variant_id: true,
          quantity: true,
          metadata: true,
          reference_type: true,
        },
      })
      : [];

    // Build variant→item map per receipt for movements that lack goods_receipt_item_id
    // (e.g. RECEIVING_SHELF_PUTAWAY from barcode-scan flow that only records variant_id)
    const variantToItemByReceipt = new Map(); // `${receiptId}::${variantId}` → itemId
    receipts.forEach((receipt) => {
      receipt.goods_receipt_items.forEach((item) => {
        variantToItemByReceipt.set(`${receipt.id}::${String(item.variant_id)}`, String(item.id));
      });
    });

    const putawayQtyByReceiptItem = new Map();
    postedMovements.forEach((movement) => {
      const metadata = movement.metadata && typeof movement.metadata === 'object' ? movement.metadata : null;
      const bucket = metadata && metadata.movement_bucket ? String(metadata.movement_bucket) : null;
      if (bucket !== 'PUTAWAY' || !movement.reference_id) return;
      const rid = String(movement.reference_id);
      // Prefer explicit goods_receipt_item_id; fall back to variant→item lookup
      const explicitItemId = metadata && metadata.goods_receipt_item_id ? String(metadata.goods_receipt_item_id) : null;
      const itemId = explicitItemId || variantToItemByReceipt.get(`${rid}::${String(movement.variant_id)}`);
      if (!itemId) return;
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
        received_by_user_id: receipt.received_by_user_id || null,
        putaway_assignee_user_id: receipt.putaway_assignee_user_id || null,
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
    if (scopeErrorStatus(error) === 503) return res.status(503).json({ message: error.message });
    console.error('Error while loading ready receipts:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

async function getReadyReceiptDetail(req, res) {
  const receiptId = parseId(req.params.id);
  if (!receiptId) {
    return res.status(400).json({ message: 'Mã phiếu nhập kho không hợp lệ' });
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
      return res.status(404).json({ message: 'Không tìm thấy phiếu nhập kho' });
    }
    if (!(await requireWarehouseReadAccess(req, res, receipt.warehouse_id))) return undefined;

    if (receipt.status !== READY_PUTAWAY_STATUS) {
      return res.status(400).json({ message: 'Chỉ phiếu nhập kho đã ghi sổ (POSTED) mới cất hàng được' });
    }
    if (!canAccessReceipt(req, receipt)) {
      return res.status(403).json({ message: 'Bạn không có quyền thực hiện thao tác này' });
    }

    const postedMovements = await prisma.stock_movements.findMany({
      where: {
        reference_type: { in: [POSTING_REFERENCE_TYPE, PUTAWAY_REFERENCE_TYPE] },
        reference_id: receiptId,
        movement_status: 'POSTED',
      },
      select: {
        variant_id: true,
        quantity: true,
        metadata: true,
      },
    });

    // Build variant→item fallback for barcode-scan movements that lack goods_receipt_item_id
    const variantToItem = new Map(
      receipt.goods_receipt_items.map((item) => [String(item.variant_id), String(item.id)])
    );

    const putawayQtyByItem = new Map();
    postedMovements.forEach((movement) => {
      const metadata = movement.metadata && typeof movement.metadata === 'object' ? movement.metadata : null;
      const bucket = metadata && metadata.movement_bucket ? String(metadata.movement_bucket) : null;
      if (bucket !== 'PUTAWAY') return;
      const explicitItemId = metadata && metadata.goods_receipt_item_id ? String(metadata.goods_receipt_item_id) : null;
      const itemId = explicitItemId || variantToItem.get(String(movement.variant_id || ''));
      if (!itemId) return;
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
      putaway_assignee_user_id: receipt.putaway_assignee_user_id || null,
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
    return res.status(400).json({ message: 'Mã phiếu nhập kho không hợp lệ' });
  }

  try {
    const receipt = await prisma.goods_receipts.findUnique({
      where: { id: receiptId },
      select: {
        id: true,
        status: true,
        warehouse_id: true,
        received_by_user_id: true,
      },
    });

    if (!receipt) {
      return res.status(404).json({ message: 'Không tìm thấy phiếu nhập kho' });
    }
    if (!(await requireWarehouseReadAccess(req, res, receipt.warehouse_id))) return undefined;

    if (receipt.status !== READY_PUTAWAY_STATUS) {
      return res.status(400).json({ message: 'Chỉ phiếu nhập kho đã ghi sổ (POSTED) mới cất hàng được' });
    }
    if (!canAccessReceipt(req, receipt)) {
      return res.status(403).json({ message: 'Bạn không có quyền thực hiện thao tác này' });
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

async function claimPutawayTask(req, res) {
  const receiptId = parseId(req.params.id);
  if (!receiptId) {
    return res.status(400).json({ message: 'Mã phiếu nhập kho không hợp lệ' });
  }

  const userId = req.user?.id || req.user?.sub;
  if (!userId) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  try {
    const receipt = await prisma.goods_receipts.findUnique({
      where: { id: receiptId },
      select: { id: true, status: true, putaway_assignee_user_id: true, warehouse_id: true },
    });

    if (!receipt) {
      return res.status(404).json({ message: 'Không tìm thấy phiếu nhập' });
    }
    if (!(await requireWarehouseWriteAccess(req, res, receipt.warehouse_id))) return undefined;
    if (receipt.status !== READY_PUTAWAY_STATUS) {
      return res.status(400).json({ message: 'Phiếu nhập chưa được duyệt (cần status POSTED)' });
    }
    if (receipt.putaway_assignee_user_id) {
      return res.status(409).json({ message: 'Task này đã được nhận bởi nhân viên khác' });
    }

    await prisma.goods_receipts.update({
      where: { id: receiptId },
      data: { putaway_assignee_user_id: userId },
    });

    return res.json({ success: true, message: 'Đã nhận task putaway thành công' });
  } catch (error) {
    console.error('Error claiming putaway task:', error);
    return res.status(500).json({ message: 'Lỗi khi nhận task' });
  }
}

async function assignPutawayTask(req, res) {
  const receiptId = parseId(req.params.id);
  const assigneeUserId = parseId(req.body?.user_id || req.body?.putaway_assignee_user_id);

  if (!receiptId) {
    return res.status(400).json({ message: 'Mã phiếu nhập kho không hợp lệ' });
  }
  if (!assigneeUserId) {
    return res.status(400).json({ message: 'Thiếu user_id' });
  }

  try {
    const receipt = await prisma.goods_receipts.findUnique({
      where: { id: receiptId },
      select: { id: true, status: true, warehouse_id: true },
    });

    if (!receipt) {
      return res.status(404).json({ message: 'Không tìm thấy phiếu nhập' });
    }
    if (!(await requireWarehouseWriteAccess(req, res, receipt.warehouse_id))) return undefined;
    if (!(await requireAssignableUser(res, assigneeUserId, receipt.warehouse_id))) return undefined;
    if (receipt.status !== READY_PUTAWAY_STATUS) {
      return res.status(400).json({ message: 'Phiếu nhập chưa được duyệt (cần status POSTED)' });
    }

    await prisma.goods_receipts.update({
      where: { id: receiptId },
      data: { putaway_assignee_user_id: assigneeUserId },
    });

    return res.json({ success: true, message: 'Đã giao task putaway cho nhân viên' });
  } catch (error) {
    console.error('Error assigning putaway task:', error);
    return res.status(500).json({ message: 'Lỗi khi giao task' });
  }
}

module.exports = {
  getReadyReceipts,
  getReadyReceiptDetail,
  getPutawayLocations,
  claimPutawayTask,
  assignPutawayTask,
};
