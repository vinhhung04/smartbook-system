require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { PrismaClient } = require('@prisma/client');
const { authenticateToken } = require('./middlewares/auth.middleware');

const prisma = new PrismaClient();
const bookRoutes = require('./routes/book.routes');
const warehouseRoutes = require('./routes/warehouse.routes');
const locationRoutes = require('./routes/location.routes');
const goodsReceiptRoutes = require('./routes/goods-receipt.routes');
const stockMovementRoutes = require('./routes/stock-movement.routes');
const borrowIntegrationRoutes = require('./routes/borrow-integration.routes');
const putawayRoutes = require('./routes/putaway.routes');
const shelfRoutes = require('./routes/shelf.routes');
const receivingPutawayRoutes = require('./routes/receiving-putaway.routes');
const pickingRoutes = require('./routes/picking.routes');
const orderRequestRoutes = require('./routes/order-request.routes');
const outboundRoutes = require('./routes/outbound.routes');

const app = express();
const PORT = process.env.PORT || 3001;
const JSON_BODY_LIMIT = process.env.JSON_BODY_LIMIT || '8mb';

app.use(cors());
app.use(express.json({ limit: JSON_BODY_LIMIT }));
app.use(express.urlencoded({ extended: true, limit: JSON_BODY_LIMIT }));

// Only API routes require JWT.
app.use('/api', authenticateToken);

app.use('/api/books', bookRoutes);
app.use('/api/warehouses', warehouseRoutes);
app.use('/api/locations', locationRoutes);
app.use('/api/goods-receipts', goodsReceiptRoutes);
app.use('/api/stock-movements', stockMovementRoutes);
app.use('/api/borrow-integration', borrowIntegrationRoutes);
app.use('/api/putaway', putawayRoutes);
app.use('/api/shelves', shelfRoutes);
app.use('/api/receiving-putaway', receivingPutawayRoutes);
app.use('/api/picking', pickingRoutes);
app.use('/api/order-requests', orderRequestRoutes);
app.use('/api/outbound', outboundRoutes);

// ─── GET /api/inventory ──────────────────────────────────────────────────────
// Lấy danh sách toàn bộ sách kèm variants, số lượng tồn kho và vị trí kệ
app.get('/api/inventory', async (req, res) => {
  try {
    const books = await prisma.books.findMany({
      include: {
        book_variants: {
          include: {
            stock_balances: {
              include: {
                locations: {
                  select: {
                    id: true,
                    location_code: true,
                    location_type: true,
                  },
                },
              },
            },
          },
        },
      },
    });
    res.json(books);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/inventory/inbound ─────────────────────────────────────────────
// Nhập kho: cộng số lượng vào Inventory và ghi log StockMovement (type: IN)
app.post('/api/inventory/inbound', async (req, res) => {
  const { variantId, locationId, warehouseId, quantity, unitCost } = req.body;

  if (!variantId || !locationId || !warehouseId || !quantity || quantity <= 0) {
    return res.status(400).json({ error: 'variantId, locationId, warehouseId và quantity (> 0) là bắt buộc' });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Upsert: nếu đã có bản ghi với cùng variant_id + location_id thì cộng thêm; nếu chưa thì tạo mới
      const inventory = await tx.stock_balances.upsert({
        where: {
          variant_id_location_id: { variant_id: variantId, location_id: locationId },
        },
        update: {
          on_hand_qty: { increment: quantity },
          available_qty: { increment: quantity },
        },
        create: {
          variant_id: variantId,
          location_id: locationId,
          warehouse_id: warehouseId,
          on_hand_qty: quantity,
          available_qty: quantity,
        },
      });

      const movement = await tx.stock_movements.create({
        data: {
          movement_number: `IN-${Date.now()}`,
          movement_type: 'IN',
          warehouse_id: warehouseId,
          variant_id: variantId,
          to_location_id: locationId,
          quantity,
          unit_cost: unitCost || 0,
          source_service: 'inventory-service',
        },
      });

      return { inventory, movement };
    });

    res.status(201).json(result);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/inventory/outbound ────────────────────────────────────────────
// Xuất kho: trừ số lượng tồn và ghi log StockMovement (type: OUT)
app.post('/api/inventory/outbound', async (req, res) => {
  const { variantId, locationId, warehouseId, quantity } = req.body;

  if (!variantId || !locationId || !warehouseId || !quantity || quantity <= 0) {
    return res.status(400).json({ error: 'variantId, locationId, warehouseId và quantity (> 0) là bắt buộc' });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const inventory = await tx.stock_balances.findUnique({
        where: {
          variant_id_location_id: { variant_id: variantId, location_id: locationId },
        },
      });

      if (!inventory) {
        const err = new Error('Không tìm thấy bản ghi tồn kho cho variant và vị trí này');
        err.statusCode = 400;
        throw err;
      }

      if (inventory.on_hand_qty < quantity) {
        const err = new Error(
          `Số lượng tồn kho không đủ. Hiện có: ${inventory.on_hand_qty}, yêu cầu xuất: ${quantity}`
        );
        err.statusCode = 400;
        throw err;
      }

      const updated = await tx.stock_balances.update({
        where: { id: inventory.id },
        data: {
          on_hand_qty: { decrement: quantity },
          available_qty: { decrement: quantity },
        },
      });

      const movement = await tx.stock_movements.create({
        data: {
          movement_number: `OUT-${Date.now()}`,
          movement_type: 'OUT',
          warehouse_id: warehouseId,
          variant_id: variantId,
          from_location_id: locationId,
          quantity,
          source_service: 'inventory-service',
        },
      });

      return { inventory: updated, movement };
    });

    res.json(result);
  } catch (error) {
    if (error.statusCode === 400) {
      return res.status(400).json({ error: error.message });
    }
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Return JSON for oversized request payloads (e.g. base64 cover image uploads).
app.use((err, req, res, next) => {
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({
      message: `Payload quá lớn. Vui lòng dùng ảnh nhỏ hơn hoặc nén ảnh trước khi upload (giới hạn hiện tại: ${JSON_BODY_LIMIT}).`,
    });
  }

  return next(err);
});

// ─── Start server ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Inventory Service running on http://localhost:${PORT}`);
});
