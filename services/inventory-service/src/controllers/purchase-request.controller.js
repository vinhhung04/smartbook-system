const { PrismaClient } = require('@prisma/client');
const { requireWarehouseWriteAccess } = require('../utils/warehouse-scope.utils');
const { pushToRooms } = require('../lib/socket-emitter');

const prisma = new PrismaClient();

const PR_STAFF_ROOMS = ['admin', 'warehouse_manager'];

function generateRequestNumber() {
  const now = new Date();
  const prefix = 'PR';
  const date = now.toISOString().slice(0, 10).replace(/-/g, '');
  const ms = String(now.getTime()).slice(-6);
  return `${prefix}-${date}-${ms}`;
}

async function createPurchaseRequest(req, res) {
  const userId = req.user?.id || req.user?.sub;
  if (!userId) {
    return res.status(401).json({ message: 'Invalid current user context' });
  }

  const { warehouse_id, book_variant_id, book_title_hint, quantity_requested, reason, note } = req.body;

  if (!warehouse_id) {
    return res.status(400).json({ message: 'warehouse_id is required' });
  }
  if (!quantity_requested || quantity_requested < 1) {
    return res.status(400).json({ message: 'quantity_requested must be at least 1' });
  }

  const validReasons = ['LOW_STOCK', 'CUSTOMER_REQUEST', 'DAMAGED', 'LOST', 'OTHER'];
  const resolvedReason = reason && validReasons.includes(reason) ? reason : 'OTHER';

  try {
    const warehouse = await prisma.warehouses.findUnique({ where: { id: warehouse_id } });
    if (!warehouse) {
      return res.status(404).json({ message: 'Warehouse not found' });
    }

    // Enforce warehouse write scope. Note: if user_warehouse_scopes table has no entries
    // for this user, the utility grants access to all active warehouses as fallback.
    const canWrite = await requireWarehouseWriteAccess(req, res, warehouse_id);
    if (!canWrite) return;

    if (book_variant_id) {
      const variant = await prisma.book_variants.findUnique({ where: { id: book_variant_id } });
      if (!variant) {
        return res.status(404).json({ message: 'Book variant not found' });
      }
    }

    const request = await prisma.purchase_requests.create({
      data: {
        request_number: generateRequestNumber(),
        created_by_user_id: userId,
        warehouse_id,
        book_variant_id: book_variant_id || null,
        book_title_hint: book_title_hint || null,
        quantity_requested: Number(quantity_requested),
        reason: resolvedReason,
        note: note || null,
        status: 'PENDING',
      },
    });

    setImmediate(() => void pushToRooms(PR_STAFF_ROOMS, 'purchase_request:created', {
      id: request.id,
      request_number: request.request_number,
      warehouse_id: request.warehouse_id,
      status: request.status,
      created_by_user_id: userId,
    }));

    return res.status(201).json({ data: request });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function getMyPurchaseRequests(req, res) {
  const userId = req.user?.id || req.user?.sub;
  if (!userId) {
    return res.status(401).json({ message: 'Invalid current user context' });
  }

  try {
    const requests = await prisma.purchase_requests.findMany({
      where: { created_by_user_id: userId },
      include: {
        warehouses: { select: { id: true, code: true, name: true } },
        book_variants: {
          select: {
            id: true, sku: true, isbn13: true,
            books: { select: { id: true, title: true } },
          },
        },
      },
      orderBy: { created_at: 'desc' },
      take: 50,
    });

    return res.json({ data: requests });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function getAllPurchaseRequests(req, res) {
  const { status, warehouse_id, page = 1, limit = 50 } = req.query;
  const where = {};
  if (status) where.status = status;
  if (warehouse_id) where.warehouse_id = warehouse_id;

  try {
    const [requests, total] = await Promise.all([
      prisma.purchase_requests.findMany({
        where,
        include: {
          warehouses: { select: { id: true, code: true, name: true } },
          book_variants: {
            select: {
              id: true, sku: true, isbn13: true,
              books: { select: { id: true, title: true } },
            },
          },
        },
        orderBy: { created_at: 'desc' },
        skip: (Number(page) - 1) * Number(limit),
        take: Number(limit),
      }),
      prisma.purchase_requests.count({ where }),
    ]);

    return res.json({ data: requests, total, page: Number(page), limit: Number(limit) });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function getPurchaseRequestById(req, res) {
  const userId = req.user?.id || req.user?.sub;
  const userRoles = Array.isArray(req.user?.roles) ? req.user.roles.map((r) => String(r).toUpperCase()) : [];
  const isManager = userRoles.includes('WAREHOUSE_MANAGER') || userRoles.includes('ADMIN') || req.user?.is_superuser;

  try {
    const request = await prisma.purchase_requests.findUnique({
      where: { id: req.params.id },
      include: {
        warehouses: { select: { id: true, code: true, name: true } },
        book_variants: {
          select: {
            id: true, sku: true, isbn13: true,
            books: { select: { id: true, title: true } },
          },
        },
      },
    });

    if (!request) {
      return res.status(404).json({ message: 'Purchase request not found' });
    }

    if (!isManager && request.created_by_user_id !== userId) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    return res.json({ data: request });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function approvePurchaseRequest(req, res) {
  const userId = req.user?.id || req.user?.sub;

  try {
    const request = await prisma.purchase_requests.findUnique({ where: { id: req.params.id } });
    if (!request) {
      return res.status(404).json({ message: 'Purchase request not found' });
    }
    if (request.status !== 'PENDING') {
      return res.status(400).json({ message: `Cannot approve a request with status ${request.status}` });
    }

    const updated = await prisma.purchase_requests.update({
      where: { id: req.params.id },
      data: {
        status: 'APPROVED',
        approved_by_user_id: userId,
        approved_at: new Date(),
        updated_at: new Date(),
      },
    });

    setImmediate(() => void pushToRooms(PR_STAFF_ROOMS, 'purchase_request:status_changed', {
      id: updated.id,
      request_number: updated.request_number,
      status: updated.status,
      warehouse_id: updated.warehouse_id,
    }));

    return res.json({ data: updated });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function rejectPurchaseRequest(req, res) {
  const userId = req.user?.id || req.user?.sub;
  const { rejection_reason } = req.body;

  try {
    const request = await prisma.purchase_requests.findUnique({ where: { id: req.params.id } });
    if (!request) {
      return res.status(404).json({ message: 'Purchase request not found' });
    }
    if (request.status !== 'PENDING') {
      return res.status(400).json({ message: `Cannot reject a request with status ${request.status}` });
    }

    const updated = await prisma.purchase_requests.update({
      where: { id: req.params.id },
      data: {
        status: 'REJECTED',
        rejected_by_user_id: userId,
        rejected_at: new Date(),
        rejection_reason: rejection_reason || null,
        updated_at: new Date(),
      },
    });

    setImmediate(() => void pushToRooms(PR_STAFF_ROOMS, 'purchase_request:status_changed', {
      id: updated.id,
      request_number: updated.request_number,
      status: updated.status,
      warehouse_id: updated.warehouse_id,
    }));

    return res.json({ data: updated });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function withdrawPurchaseRequest(req, res) {
  const userId = req.user?.id || req.user?.sub;
  if (!userId) {
    return res.status(401).json({ message: 'Invalid current user context' });
  }

  try {
    const request = await prisma.purchase_requests.findUnique({ where: { id: req.params.id } });
    if (!request) {
      return res.status(404).json({ message: 'Purchase request not found' });
    }
    if (request.created_by_user_id !== userId) {
      return res.status(403).json({ message: 'You can only withdraw your own purchase request' });
    }
    if (request.status !== 'PENDING') {
      return res.status(400).json({ message: `Cannot withdraw a request with status ${request.status}` });
    }

    const updated = await prisma.purchase_requests.update({
      where: { id: req.params.id },
      data: {
        status: 'WITHDRAWN',
        updated_at: new Date(),
      },
    });

    setImmediate(() => void pushToRooms(PR_STAFF_ROOMS, 'purchase_request:status_changed', {
      id: updated.id,
      request_number: updated.request_number,
      status: updated.status,
      warehouse_id: updated.warehouse_id,
    }));

    return res.json({ data: updated });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function convertPurchaseRequestToPO(req, res) {
  const userId = req.user?.id || req.user?.sub;
  if (!userId) {
    return res.status(401).json({ message: 'Invalid current user context' });
  }

  try {
    const request = await prisma.purchase_requests.findUnique({
      where: { id: req.params.id },
    });
    if (!request) {
      return res.status(404).json({ message: 'Purchase request not found' });
    }
    if (request.status !== 'APPROVED') {
      return res.status(400).json({ message: `Request must be APPROVED before converting (current: ${request.status})` });
    }
    if (request.purchase_order_id || request.status === 'CONVERTED') {
      return res.status(400).json({ message: 'Request has already been converted to a Purchase Order' });
    }
    const { supplier_id, book_variant_id: overrideVariantId } = req.body;

    // Manager có thể cung cấp book_variant_id khi convert nếu request chưa có
    const resolvedVariantId = overrideVariantId || request.book_variant_id;
    if (!resolvedVariantId) {
      return res.status(400).json({ message: 'Vui lòng chọn biến thể sách cụ thể để tạo đơn đặt hàng' });
    }
    if (!supplier_id) {
      return res.status(400).json({ message: 'supplier_id is required' });
    }

    const supplier = await prisma.suppliers.findUnique({ where: { id: supplier_id } });
    if (!supplier) {
      return res.status(404).json({ message: 'Supplier not found' });
    }
    if (supplier.status && supplier.status !== 'ACTIVE') {
      return res.status(400).json({ message: 'Supplier is not active' });
    }

    const variant = await prisma.book_variants.findUnique({ where: { id: resolvedVariantId } });
    if (!variant) {
      return res.status(400).json({ message: 'Book variant no longer exists' });
    }

    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const suffix = Math.random().toString(36).substring(2, 8).toUpperCase();
    const poNumber = `PO-${dateStr}-${suffix}`;

    const result = await prisma.$transaction(async (tx) => {
      const po = await tx.purchase_orders.create({
        data: {
          po_number: poNumber,
          supplier_id,
          warehouse_id: request.warehouse_id,
          status: 'DRAFT',
          ordered_by_user_id: userId,
          note: request.note || null,
        },
      });

      await tx.purchase_order_items.create({
        data: {
          purchase_order_id: po.id,
          variant_id: resolvedVariantId,
          ordered_qty: request.quantity_requested,
          unit_cost: 0,
        },
      });

      const updated = await tx.purchase_requests.update({
        where: { id: request.id },
        data: {
          status: 'CONVERTED',
          purchase_order_id: po.id,
          updated_at: new Date(),
        },
      });

      return { po, updated };
    });

    try {
      await prisma.inventory_audit_logs.create({
        data: {
          action_name: 'PURCHASE_REQUEST_CONVERTED_TO_PO',
          actor_user_id: userId,
          entity_type: 'PURCHASE_REQUEST',
          entity_id: request.id,
          after_data: { purchase_order_id: result.po.id, po_number: result.po.po_number },
        },
      });
    } catch (_) { /* audit log is non-critical */ }

    return res.status(201).json({
      data: {
        purchase_order_id: result.po.id,
        po_number: result.po.po_number,
      },
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  createPurchaseRequest,
  getMyPurchaseRequests,
  getAllPurchaseRequests,
  getPurchaseRequestById,
  approvePurchaseRequest,
  rejectPurchaseRequest,
  withdrawPurchaseRequest,
  convertPurchaseRequestToPO,
};
