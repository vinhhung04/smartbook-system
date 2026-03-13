require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { PrismaClient } = require('@prisma/client');

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// ─── GET /api/inventory ──────────────────────────────────────────────────────
// Lấy danh sách toàn bộ sách kèm variants, số lượng tồn kho và vị trí kệ
app.get('/api/inventory', async (req, res) => {
  try {
    const books = await prisma.book.findMany({
      include: {
        variants: {
          include: {
            inventories: {
              select: {
                location: true,
                quantity: true,
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
  const { variantId, location, quantity } = req.body;

  if (!variantId || !location || !quantity || quantity <= 0) {
    return res.status(400).json({ error: 'variantId, location và quantity (> 0) là bắt buộc' });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Upsert: nếu đã có bản ghi với cùng variantId + location thì cộng thêm; nếu chưa thì tạo mới
      const inventory = await tx.inventory.upsert({
        where: { variantId_location: { variantId, location } },
        update: { quantity: { increment: quantity } },
        create: { variantId, location, quantity },
      });

      const movement = await tx.stockMovement.create({
        data: { variantId, type: 'IN', quantity },
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
  const { variantId, location, quantity } = req.body;

  if (!variantId || !location || !quantity || quantity <= 0) {
    return res.status(400).json({ error: 'variantId, location và quantity (> 0) là bắt buộc' });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const inventory = await tx.inventory.findFirst({ where: { variantId, location } });

      if (!inventory) {
        const err = new Error('Không tìm thấy bản ghi tồn kho cho variant và vị trí này');
        err.statusCode = 400;
        throw err;
      }

      if (inventory.quantity < quantity) {
        const err = new Error(
          `Số lượng tồn kho không đủ. Hiện có: ${inventory.quantity}, yêu cầu xuất: ${quantity}`
        );
        err.statusCode = 400;
        throw err;
      }

      const updated = await tx.inventory.update({
        where: { id: inventory.id },
        data: { quantity: { decrement: quantity } },
      });

      const movement = await tx.stockMovement.create({
        data: { variantId, type: 'OUT', quantity },
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

// ─── Start server ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Inventory Service running on http://localhost:${PORT}`);
});
