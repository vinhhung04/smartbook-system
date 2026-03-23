const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const { parseId, normalizeText } = require('../utils/validation');
const { toInt } = require('../utils/validation');
const { normalizeIsbn13 } = require('../utils/validation');
const { normalizeTaskType } = require('../utils/validation');

function canApproveRequests(user) {
  if (user?.is_superuser) return true;

  const permissions = Array.isArray(user?.permissions)
    ? user.permissions.map((p) => String(p || '').trim())
    : [];
  if (permissions.includes('inventory.purchase.approve')) {
    return true;
  }

  const roles = Array.isArray(user?.roles) ? user.roles.map((r) => String(r || '').toUpperCase()) : [];
  return roles.includes('ADMIN') || roles.includes('MANAGER');
}

function createOutboundNumber() {
  const ts = Date.now();
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `OB-${ts}-${suffix}`;
}

function createTransferNumber() {
  const ts = Date.now();
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `TO-${ts}-${suffix}`;
}

async function resolveVariantIdByIdentifier(tx, payloadLine) {
  const directVariantId = parseId(payloadLine?.variant_id);
  if (directVariantId) {
    return { variant_id: directVariantId, isbn13: normalizeIsbn13(payloadLine?.isbn13) };
  }

  const isbn13 = normalizeIsbn13(payloadLine?.isbn13);
  if (!isbn13 || !/^\d{13}$/.test(isbn13)) {
    return { variant_id: null, isbn13: null };
  }

  const variant = await tx.book_variants.findFirst({
    where: { isbn13, is_active: true },
    select: { id: true },
  });

  return {
    variant_id: variant?.id || null,
    isbn13,
  };
}

function mapOutboundSummary(order) {
  const items = Array.isArray(order.outbound_order_items) ? order.outbound_order_items : [];
  const totalQuantity = items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);

  return {
    task_type: 'outbound',
    task_id: order.id,
    order_number: order.outbound_number,
    status: order.status,
    order_type: `OUTBOUND_${order.outbound_type}`,
    source_warehouse_id: order.warehouse_id,
    source_warehouse_code: order.warehouses?.code || null,
    source_warehouse_name: order.warehouses?.name || null,
    target_warehouse_id: null,
    target_warehouse_code: null,
    target_warehouse_name: null,
    requested_by_user_id: order.requested_by_user_id,
    approved_by_user_id: order.approved_by_user_id,
    assigned_picker_user_id: order.processed_by_user_id,
    line_count: items.length,
    total_quantity: totalQuantity,
    requested_at: order.requested_at,
    updated_at: order.updated_at,
    note: order.note || null,
    external_reference: order.external_reference || null,
  };
}

function mapTransferSummary(order) {
  const items = Array.isArray(order.transfer_order_items) ? order.transfer_order_items : [];
  const totalQuantity = items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);

  return {
    task_type: 'transfer',
    task_id: order.id,
    order_number: order.transfer_number,
    status: order.status,
    order_type: 'WAREHOUSE_TRANSFER',
    source_warehouse_id: order.from_warehouse_id,
    source_warehouse_code: order.warehouses_transfer_orders_from_warehouse_idTowarehouses?.code || null,
    source_warehouse_name: order.warehouses_transfer_orders_from_warehouse_idTowarehouses?.name || null,
    target_warehouse_id: order.to_warehouse_id,
    target_warehouse_code: order.warehouses_transfer_orders_to_warehouse_idTowarehouses?.code || null,
    target_warehouse_name: order.warehouses_transfer_orders_to_warehouse_idTowarehouses?.name || null,
    requested_by_user_id: order.requested_by_user_id,
    approved_by_user_id: order.approved_by_user_id,
    assigned_picker_user_id: order.shipped_by_user_id,
    line_count: items.length,
    total_quantity: totalQuantity,
    requested_at: order.requested_at,
    updated_at: order.updated_at,
    note: order.note || null,
    external_reference: null,
  };
}

async function searchVariants(req, res) {
  const keyword = String(req.query.q || '').trim();
  const limit = Math.min(20, Math.max(1, Number.parseInt(String(req.query.limit || '8'), 10) || 8));

  if (keyword.length < 2) {
    return res.json({ data: [] });
  }

  try {
    const rows = await prisma.book_variants.findMany({
      where: {
        is_active: true,
        isbn13: { not: null },
        OR: [
          { isbn13: { contains: keyword, mode: 'insensitive' } },
          { sku: { contains: keyword, mode: 'insensitive' } },
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
        internal_barcode: true,
        isbn13: true,
        isbn10: true,
        books: {
          select: {
            title: true,
          },
        },
      },
      orderBy: { updated_at: 'desc' },
      take: limit,
    });

    return res.json({
      data: rows.map((row) => ({
        variant_id: row.id,
        sku: row.sku || null,
        barcode: row.isbn13 || row.internal_barcode || row.isbn10 || row.sku || null,
        isbn13: row.isbn13 || null,
        isbn10: row.isbn10 || null,
        title: row.books?.title || 'Chua co ten sach',
      })),
    });
  } catch (error) {
    console.error('Error while searching variants for order requests:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

async function listOrderRequests(req, res) {
  const view = String(req.query.view || 'my').trim().toLowerCase();
  const warehouseId = parseId(req.query.warehouse_id);
  const currentUserId = parseId(req.user?.id);

  if (!currentUserId) {
    return res.status(401).json({ message: 'Invalid current user context' });
  }

  const canApprove = canApproveRequests(req.user || {});

  try {
    const outboundWhere = {};
    const transferWhere = {};

    if (view === 'approval') {
      if (!canApprove) {
        return res.status(403).json({ message: 'Only manager/admin can view approval queue' });
      }
      outboundWhere.status = 'PENDING_APPROVAL';
      transferWhere.status = 'REQUESTED';
    } else {
      outboundWhere.requested_by_user_id = currentUserId;
      transferWhere.requested_by_user_id = currentUserId;
    }

    if (warehouseId) {
      outboundWhere.warehouse_id = warehouseId;
      transferWhere.from_warehouse_id = warehouseId;
    }

    const [outboundOrders, transferOrders] = await Promise.all([
      prisma.outbound_orders.findMany({
        where: outboundWhere,
        include: {
          warehouses: {
            select: { id: true, code: true, name: true },
          },
          outbound_order_items: {
            select: {
              id: true,
              quantity: true,
            },
          },
        },
        orderBy: { requested_at: 'desc' },
      }),
      prisma.transfer_orders.findMany({
        where: transferWhere,
        include: {
          warehouses_transfer_orders_from_warehouse_idTowarehouses: {
            select: { id: true, code: true, name: true },
          },
          warehouses_transfer_orders_to_warehouse_idTowarehouses: {
            select: { id: true, code: true, name: true },
          },
          transfer_order_items: {
            select: {
              id: true,
              quantity: true,
            },
          },
        },
        orderBy: { requested_at: 'desc' },
      }),
    ]);

    const rows = [
      ...outboundOrders.map(mapOutboundSummary),
      ...transferOrders.map(mapTransferSummary),
    ].sort((a, b) => new Date(b.requested_at).getTime() - new Date(a.requested_at).getTime());

    return res.json({ data: rows });
  } catch (error) {
    console.error('Error while listing order requests:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

async function createOutboundRequest(req, res) {
  const warehouseId = parseId(req.body?.warehouse_id);
  const outboundType = normalizeText(req.body?.outbound_type) || 'MANUAL';
  const externalReference = normalizeText(req.body?.external_reference);
  const note = normalizeText(req.body?.note);
  const lines = Array.isArray(req.body?.lines) ? req.body.lines : [];
  const currentUserId = parseId(req.user?.id);

  if (!currentUserId) {
    return res.status(401).json({ message: 'Invalid current user context' });
  }

  if (!warehouseId) {
    return res.status(400).json({ message: 'warehouse_id is required' });
  }

  if (!['SALE', 'DISPOSAL', 'RETURN_TO_SUPPLIER', 'MANUAL'].includes(outboundType)) {
    return res.status(400).json({ message: 'Invalid outbound_type' });
  }

  if (lines.length === 0) {
    return res.status(400).json({ message: 'lines is required' });
  }

  const normalizedLines = [];
  for (const line of lines) {
    const sourceLocationId = parseId(line?.source_location_id);
    const quantity = toInt(line?.quantity);
    const lineNote = normalizeText(line?.note);
    const lineIsbn13 = normalizeIsbn13(line?.isbn13);
    const hasIdentifier = parseId(line?.variant_id) || lineIsbn13;

    if (!hasIdentifier || quantity === null || quantity <= 0) {
      return res.status(400).json({ message: 'Each line must include isbn13 (or variant_id) and quantity > 0' });
    }

    if (lineIsbn13 && !/^\d{13}$/.test(lineIsbn13)) {
      return res.status(400).json({ message: 'isbn13 must contain exactly 13 digits' });
    }

    normalizedLines.push({
      variant_id: parseId(line?.variant_id),
      isbn13: lineIsbn13,
      source_location_id: sourceLocationId,
      quantity,
      note: lineNote,
    });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const warehouse = await tx.warehouses.findUnique({
        where: { id: warehouseId },
        select: { id: true, is_active: true },
      });

      if (!warehouse || !warehouse.is_active) {
        return { invalid: true, statusCode: 400, message: 'Warehouse not found or inactive' };
      }

      const resolvedLines = [];
      for (const line of normalizedLines) {
        const resolved = await resolveVariantIdByIdentifier(tx, line);
        if (!resolved.variant_id) {
          return { invalid: true, statusCode: 400, message: 'One or more isbn13 values are invalid or inactive' };
        }

        resolvedLines.push({
          ...line,
          variant_id: resolved.variant_id,
          isbn13: resolved.isbn13,
        });
      }

      const variantIds = [...new Set(resolvedLines.map((line) => line.variant_id))];
      const variants = await tx.book_variants.findMany({
        where: {
          id: { in: variantIds },
          is_active: true,
        },
        select: {
          id: true,
          sku: true,
          isbn13: true,
        },
      });

      if (variants.length !== variantIds.length) {
        return { invalid: true, statusCode: 400, message: 'One or more variant_id is invalid or inactive' };
      }

      const locationIds = resolvedLines.map((line) => line.source_location_id).filter(Boolean);
      if (locationIds.length > 0) {
        const locations = await tx.locations.findMany({
          where: {
            id: { in: locationIds },
            warehouse_id: warehouseId,
            is_active: true,
          },
          select: { id: true },
        });

        if (locations.length !== locationIds.length) {
          return { invalid: true, statusCode: 400, message: 'One or more source_location_id is invalid for selected warehouse' };
        }
      }

      const order = await tx.outbound_orders.create({
        data: {
          outbound_number: createOutboundNumber(),
          warehouse_id: warehouseId,
          outbound_type: outboundType,
          status: 'PENDING_APPROVAL',
          requested_by_user_id: currentUserId,
          external_reference: externalReference,
          note,
        },
      });

      await tx.outbound_order_items.createMany({
        data: resolvedLines.map((line) => ({
          outbound_order_id: order.id,
          variant_id: line.variant_id,
          source_location_id: line.source_location_id,
          quantity: line.quantity,
          processed_qty: 0,
          note: line.note,
        })),
      });

      await tx.inventory_audit_logs.create({
        data: {
          actor_user_id: currentUserId,
          action_name: 'OUTBOUND_REQUEST_CREATED',
          entity_type: 'OUTBOUND_ORDER',
          entity_id: order.id,
          after_data: {
            status: 'PENDING_APPROVAL',
            line_count: resolvedLines.length,
            total_quantity: resolvedLines.reduce((sum, line) => sum + line.quantity, 0),
          },
        },
      });

      return { data: order };
    });

    if (result.invalid) {
      return res.status(result.statusCode || 400).json({
        message: result.message,
        ...(result.details ? { details: result.details } : {}),
      });
    }

    return res.status(201).json({
      message: 'Outbound request created and waiting for approval',
      data: {
        task_type: 'outbound',
        task_id: result.data.id,
        order_number: result.data.outbound_number,
        status: result.data.status,
      },
    });
  } catch (error) {
    console.error('Error while creating outbound request:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

async function createTransferRequest(req, res) {
  const fromWarehouseId = parseId(req.body?.from_warehouse_id);
  const toWarehouseId = parseId(req.body?.to_warehouse_id);
  const note = normalizeText(req.body?.note);
  const lines = Array.isArray(req.body?.lines) ? req.body.lines : [];
  const currentUserId = parseId(req.user?.id);

  if (!currentUserId) {
    return res.status(401).json({ message: 'Invalid current user context' });
  }

  if (!fromWarehouseId || !toWarehouseId) {
    return res.status(400).json({ message: 'from_warehouse_id and to_warehouse_id are required' });
  }

  if (fromWarehouseId === toWarehouseId) {
    return res.status(400).json({ message: 'from_warehouse_id must be different from to_warehouse_id' });
  }

  if (lines.length === 0) {
    return res.status(400).json({ message: 'lines is required' });
  }

  const normalizedLines = [];
  for (const line of lines) {
    const fromLocationId = parseId(line?.from_location_id);
    const toLocationId = parseId(line?.to_location_id);
    const quantity = toInt(line?.quantity);
    const lineNote = normalizeText(line?.note);
    const lineIsbn13 = normalizeIsbn13(line?.isbn13);
    const hasIdentifier = parseId(line?.variant_id) || lineIsbn13;

    if (!hasIdentifier || quantity === null || quantity <= 0) {
      return res.status(400).json({ message: 'Each line must include isbn13 (or variant_id) and quantity > 0' });
    }

    if (lineIsbn13 && !/^\d{13}$/.test(lineIsbn13)) {
      return res.status(400).json({ message: 'isbn13 must contain exactly 13 digits' });
    }

    normalizedLines.push({
      variant_id: parseId(line?.variant_id),
      isbn13: lineIsbn13,
      from_location_id: fromLocationId,
      to_location_id: toLocationId,
      quantity,
      note: lineNote,
    });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const warehouses = await tx.warehouses.findMany({
        where: {
          id: { in: [fromWarehouseId, toWarehouseId] },
          is_active: true,
        },
        select: { id: true },
      });

      if (warehouses.length !== 2) {
        return { invalid: true, statusCode: 400, message: 'Source or target warehouse is invalid/inactive' };
      }

      const resolvedLines = [];
      for (const line of normalizedLines) {
        const resolved = await resolveVariantIdByIdentifier(tx, line);
        if (!resolved.variant_id) {
          return { invalid: true, statusCode: 400, message: 'One or more isbn13 values are invalid or inactive' };
        }

        resolvedLines.push({
          ...line,
          variant_id: resolved.variant_id,
          isbn13: resolved.isbn13,
        });
      }

      const variantIds = [...new Set(resolvedLines.map((line) => line.variant_id))];
      const variants = await tx.book_variants.findMany({
        where: {
          id: { in: variantIds },
          is_active: true,
        },
        select: {
          id: true,
          sku: true,
          isbn13: true,
        },
      });

      if (variants.length !== variantIds.length) {
        return { invalid: true, statusCode: 400, message: 'One or more variant_id is invalid or inactive' };
      }

      // Enforce stock sufficiency at transfer-request creation using warehouse-level available_qty.
      const requiredQtyByVariant = new Map();
      resolvedLines.forEach((line) => {
        const key = String(line.variant_id);
        const current = Number(requiredQtyByVariant.get(key) || 0);
        requiredQtyByVariant.set(key, current + Number(line.quantity || 0));
      });

      const availableQtyRows = await tx.stock_balances.groupBy({
        by: ['variant_id'],
        where: {
          warehouse_id: fromWarehouseId,
          variant_id: { in: variantIds },
          available_qty: { gt: 0 },
        },
        _sum: {
          available_qty: true,
        },
      });

      const availableQtyByVariant = new Map();
      availableQtyRows.forEach((row) => {
        availableQtyByVariant.set(String(row.variant_id), Number(row._sum.available_qty || 0));
      });

      const variantMetaById = new Map();
      variants.forEach((variant) => {
        variantMetaById.set(String(variant.id), {
          isbn13: variant.isbn13 || null,
          sku: variant.sku || null,
        });
      });

      const shortages = [];
      requiredQtyByVariant.forEach((requiredQty, variantId) => {
        const availableQty = Number(availableQtyByVariant.get(variantId) || 0);
        if (availableQty >= requiredQty) {
          return;
        }

        const meta = variantMetaById.get(variantId) || { isbn13: null, sku: null };
        shortages.push({
          variant_id: variantId,
          isbn13: meta.isbn13,
          sku: meta.sku,
          required_qty: requiredQty,
          available_qty: availableQty,
          shortage_qty: requiredQty - availableQty,
        });
      });

      if (shortages.length > 0) {
        const shortagePreview = shortages
          .slice(0, 3)
          .map((item) => `${item.isbn13 || item.sku || item.variant_id}: thieu ${item.shortage_qty}`)
          .join('; ');

        return {
          invalid: true,
          statusCode: 409,
          message: `Khong du ton kho tai kho nguon. ${shortagePreview}`,
          details: {
            error_code: 'INSUFFICIENT_STOCK',
            source_warehouse_id: fromWarehouseId,
            shortages,
          },
        };
      }

      const fromLocationIds = resolvedLines.map((line) => line.from_location_id).filter(Boolean);
      if (fromLocationIds.length > 0) {
        const locations = await tx.locations.findMany({
          where: {
            id: { in: fromLocationIds },
            warehouse_id: fromWarehouseId,
            is_active: true,
          },
          select: { id: true },
        });

        if (locations.length !== fromLocationIds.length) {
          return { invalid: true, statusCode: 400, message: 'One or more from_location_id is invalid for source warehouse' };
        }
      }

      const toLocationIds = resolvedLines.map((line) => line.to_location_id).filter(Boolean);
      if (toLocationIds.length > 0) {
        const locations = await tx.locations.findMany({
          where: {
            id: { in: toLocationIds },
            warehouse_id: toWarehouseId,
            is_active: true,
          },
          select: { id: true },
        });

        if (locations.length !== toLocationIds.length) {
          return { invalid: true, statusCode: 400, message: 'One or more to_location_id is invalid for target warehouse' };
        }
      }

      const order = await tx.transfer_orders.create({
        data: {
          transfer_number: createTransferNumber(),
          from_warehouse_id: fromWarehouseId,
          to_warehouse_id: toWarehouseId,
          status: 'REQUESTED',
          requested_by_user_id: currentUserId,
          note,
        },
      });

      const variantMap = new Map();
      variants.forEach((v) => variantMap.set(v.id, v));

      await tx.transfer_order_items.createMany({
        data: resolvedLines.map((line) => {
          const variant = variantMap.get(line.variant_id);
          return {
            transfer_order_id: order.id,
            variant_id: line.variant_id,
            from_location_id: line.from_location_id,
            to_location_id: line.to_location_id,
            quantity: line.quantity,
            shipped_qty: 0,
            received_qty: 0,
            unit_cost: variant ? Number(variant.unit_cost || 0) : 0,
            note: line.note,
          };
        }),
      });

      await tx.inventory_audit_logs.create({
        data: {
          actor_user_id: currentUserId,
          action_name: 'TRANSFER_REQUEST_CREATED',
          entity_type: 'TRANSFER_ORDER',
          entity_id: order.id,
          after_data: {
            status: 'REQUESTED',
            line_count: resolvedLines.length,
            total_quantity: resolvedLines.reduce((sum, line) => sum + line.quantity, 0),
          },
        },
      });

      return { data: order };
    });

    if (result.invalid) {
      return res.status(result.statusCode || 400).json({
        message: result.message,
        ...(result.details ? { details: result.details } : {}),
      });
    }

    return res.status(201).json({
      message: 'Transfer request created and waiting for approval',
      data: {
        task_type: 'transfer',
        task_id: result.data.id,
        order_number: result.data.transfer_number,
        status: result.data.status,
      },
    });
  } catch (error) {
    console.error('Error while creating transfer request:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

async function approveRequest(req, res) {
  const taskType = normalizeTaskType(req.params.taskType);
  const taskId = parseId(req.params.taskId);
  const note = normalizeText(req.body?.note);
  const currentUserId = parseId(req.user?.id);

  if (!taskType || !taskId) {
    return res.status(400).json({ message: 'Invalid task type or task id' });
  }

  if (!currentUserId) {
    return res.status(401).json({ message: 'Invalid current user context' });
  }

  try {
    if (taskType === 'outbound') {
      const updated = await prisma.$transaction(async (tx) => {
        const order = await tx.outbound_orders.findUnique({
          where: { id: taskId },
          select: {
            id: true,
            status: true,
            note: true,
          },
        });

        if (!order) return { invalid: true, statusCode: 404, message: 'Outbound request not found' };
        if (order.status !== 'PENDING_APPROVAL') {
          return { invalid: true, statusCode: 400, message: 'Outbound request is not in PENDING_APPROVAL' };
        }

        const nextNote = note
          ? [order.note, `[APPROVED_NOTE] ${note}`].filter(Boolean).join('\n')
          : order.note;

        const row = await tx.outbound_orders.update({
          where: { id: taskId },
          data: {
            status: 'APPROVED',
            approved_by_user_id: currentUserId,
            note: nextNote,
          },
        });

        await tx.inventory_audit_logs.create({
          data: {
            actor_user_id: currentUserId,
            action_name: 'OUTBOUND_REQUEST_APPROVED',
            entity_type: 'OUTBOUND_ORDER',
            entity_id: taskId,
            after_data: {
              status: 'APPROVED',
              note,
            },
          },
        });

        return { data: row };
      });

      if (updated.invalid) {
        return res.status(updated.statusCode || 400).json({ message: updated.message });
      }

      return res.json({
        message: 'Outbound request approved',
        data: {
          task_type: 'outbound',
          task_id: updated.data.id,
          status: updated.data.status,
        },
      });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const order = await tx.transfer_orders.findUnique({
        where: { id: taskId },
        select: {
          id: true,
          status: true,
          note: true,
        },
      });

      if (!order) return { invalid: true, statusCode: 404, message: 'Transfer request not found' };
      if (order.status !== 'REQUESTED') {
        return { invalid: true, statusCode: 400, message: 'Transfer request is not in REQUESTED' };
      }

      const nextNote = note
        ? [order.note, `[APPROVED_NOTE] ${note}`].filter(Boolean).join('\n')
        : order.note;

      const row = await tx.transfer_orders.update({
        where: { id: taskId },
        data: {
          status: 'APPROVED',
          approved_by_user_id: currentUserId,
          note: nextNote,
        },
      });

      await tx.inventory_audit_logs.create({
        data: {
          actor_user_id: currentUserId,
          action_name: 'TRANSFER_REQUEST_APPROVED',
          entity_type: 'TRANSFER_ORDER',
          entity_id: taskId,
          after_data: {
            status: 'APPROVED',
            note,
          },
        },
      });

      return { data: row };
    });

    if (updated.invalid) {
      return res.status(updated.statusCode || 400).json({ message: updated.message });
    }

    return res.json({
      message: 'Transfer request approved',
      data: {
        task_type: 'transfer',
        task_id: updated.data.id,
        status: updated.data.status,
      },
    });
  } catch (error) {
    console.error('Error while approving request:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

async function rejectRequest(req, res) {
  const taskType = normalizeTaskType(req.params.taskType);
  const taskId = parseId(req.params.taskId);
  const note = normalizeText(req.body?.note);
  const currentUserId = parseId(req.user?.id);

  if (!taskType || !taskId) {
    return res.status(400).json({ message: 'Invalid task type or task id' });
  }

  if (!currentUserId) {
    return res.status(401).json({ message: 'Invalid current user context' });
  }

  try {
    if (taskType === 'outbound') {
      const updated = await prisma.$transaction(async (tx) => {
        const order = await tx.outbound_orders.findUnique({
          where: { id: taskId },
          select: {
            id: true,
            status: true,
            note: true,
          },
        });

        if (!order) return { invalid: true, statusCode: 404, message: 'Outbound request not found' };
        if (order.status !== 'PENDING_APPROVAL') {
          return { invalid: true, statusCode: 400, message: 'Outbound request is not in PENDING_APPROVAL' };
        }

        const nextNote = [order.note, `[REJECTED_NOTE] ${note || 'Rejected by manager'}`].filter(Boolean).join('\n');

        const row = await tx.outbound_orders.update({
          where: { id: taskId },
          data: {
            status: 'CANCELLED',
            approved_by_user_id: currentUserId,
            note: nextNote,
          },
        });

        await tx.inventory_audit_logs.create({
          data: {
            actor_user_id: currentUserId,
            action_name: 'OUTBOUND_REQUEST_REJECTED',
            entity_type: 'OUTBOUND_ORDER',
            entity_id: taskId,
            after_data: {
              status: 'CANCELLED',
              note,
            },
          },
        });

        return { data: row };
      });

      if (updated.invalid) {
        return res.status(updated.statusCode || 400).json({ message: updated.message });
      }

      return res.json({
        message: 'Outbound request rejected',
        data: {
          task_type: 'outbound',
          task_id: updated.data.id,
          status: updated.data.status,
        },
      });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const order = await tx.transfer_orders.findUnique({
        where: { id: taskId },
        select: {
          id: true,
          status: true,
          note: true,
        },
      });

      if (!order) return { invalid: true, statusCode: 404, message: 'Transfer request not found' };
      if (order.status !== 'REQUESTED') {
        return { invalid: true, statusCode: 400, message: 'Transfer request is not in REQUESTED' };
      }

      const nextNote = [order.note, `[REJECTED_NOTE] ${note || 'Rejected by manager'}`].filter(Boolean).join('\n');

      const row = await tx.transfer_orders.update({
        where: { id: taskId },
        data: {
          status: 'CANCELLED',
          approved_by_user_id: currentUserId,
          note: nextNote,
        },
      });

      await tx.inventory_audit_logs.create({
        data: {
          actor_user_id: currentUserId,
          action_name: 'TRANSFER_REQUEST_REJECTED',
          entity_type: 'TRANSFER_ORDER',
          entity_id: taskId,
          after_data: {
            status: 'CANCELLED',
            note,
          },
        },
      });

      return { data: row };
    });

    if (updated.invalid) {
      return res.status(updated.statusCode || 400).json({ message: updated.message });
    }

    return res.json({
      message: 'Transfer request rejected',
      data: {
        task_type: 'transfer',
        task_id: updated.data.id,
        status: updated.data.status,
      },
    });
  } catch (error) {
    console.error('Error while rejecting request:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

module.exports = {
  searchVariants,
  listOrderRequests,
  createOutboundRequest,
  createTransferRequest,
  approveRequest,
  rejectRequest,
};
