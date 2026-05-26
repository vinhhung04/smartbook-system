const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

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
  const isManager = userRoles.includes('MANAGER') || userRoles.includes('ADMIN') || req.user?.is_superuser;

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

    return res.json({ data: updated });
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
};
