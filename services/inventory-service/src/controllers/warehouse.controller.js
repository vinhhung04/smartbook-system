const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

function parseId(value) {
  return String(value || '').trim() || null;
}

async function getAllWarehouses(req, res) {
  try {
    const warehouses = await prisma.warehouses.findMany({
      orderBy: { id: 'desc' },
      include: {
        _count: {
          select: {
            locations: true,
          },
        },
      },
    });

    return res.json(warehouses);
  } catch (error) {
    console.error('Error while fetching warehouses:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

async function getWarehouseById(req, res) {
  const id = parseId(req.params.id);

  if (!id) {
    return res.status(400).json({ message: 'Invalid warehouse id' });
  }

  try {
    const warehouse = await prisma.warehouses.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            locations: true,
          },
        },
      },
    });

    if (!warehouse) {
      return res.status(404).json({ message: 'Warehouse not found' });
    }

    return res.json(warehouse);
  } catch (error) {
    console.error('Error while fetching warehouse by id:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

async function createWarehouse(req, res) {
  const { name, code, warehouse_type, address_line1 } = req.body;

  if (!name || !code) {
    return res.status(400).json({ message: 'name and code are required' });
  }

  try {
    const warehouse = await prisma.warehouses.create({
      data: {
        name,
        code,
        warehouse_type: warehouse_type || 'WAREHOUSE',
        address_line1: address_line1 || null,
      },
    });

    return res.status(201).json(warehouse);
  } catch (error) {
    console.error('Error while creating warehouse:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

async function updateWarehouse(req, res) {
  const id = parseId(req.params.id);

  if (!id) {
    return res.status(400).json({ message: 'Invalid warehouse id' });
  }

  const { name, code, warehouse_type, address_line1 } = req.body;

  try {
    const exists = await prisma.warehouses.findUnique({ where: { id } });
    if (!exists) {
      return res.status(404).json({ message: 'Warehouse not found' });
    }

    const warehouse = await prisma.warehouses.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(code !== undefined ? { code } : {}),
        ...(warehouse_type !== undefined ? { warehouse_type } : {}),
        ...(address_line1 !== undefined ? { address_line1 } : {}),
      },
    });

    return res.json(warehouse);
  } catch (error) {
    console.error('Error while updating warehouse:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

async function deleteWarehouse(req, res) {
  const id = parseId(req.params.id);

  if (!id) {
    return res.status(400).json({ message: 'Invalid warehouse id' });
  }

  try {
    const exists = await prisma.warehouses.findUnique({ where: { id } });
    if (!exists) {
      return res.status(404).json({ message: 'Warehouse not found' });
    }

    const [
      locationsCount,
      stockBalanceCount,
      stockMovementCount,
      inventoryUnitCount,
      stockAuditCount,
      goodsReceiptCount,
      purchaseOrderCount,
      outboundOrderCount,
      stockReservationCount,
      transferFromCount,
      transferToCount,
    ] = await Promise.all([
      prisma.locations.count({ where: { warehouse_id: id } }),
      prisma.stock_balances.count({ where: { warehouse_id: id } }),
      prisma.stock_movements.count({ where: { warehouse_id: id } }),
      prisma.inventory_units.count({ where: { warehouse_id: id } }),
      prisma.stock_audits.count({ where: { warehouse_id: id } }),
      prisma.goods_receipts.count({ where: { warehouse_id: id } }),
      prisma.purchase_orders.count({ where: { warehouse_id: id } }),
      prisma.outbound_orders.count({ where: { warehouse_id: id } }),
      prisma.stock_reservations.count({ where: { warehouse_id: id } }),
      prisma.transfer_orders.count({ where: { from_warehouse_id: id } }),
      prisma.transfer_orders.count({ where: { to_warehouse_id: id } }),
    ]);

    const conflicts = [];
    if (locationsCount > 0) conflicts.push(`Warehouse has ${locationsCount} location(s)`);
    if (stockBalanceCount > 0) conflicts.push(`Warehouse has ${stockBalanceCount} stock balance record(s)`);
    if (stockMovementCount > 0) conflicts.push(`Warehouse has ${stockMovementCount} stock movement record(s)`);
    if (inventoryUnitCount > 0) conflicts.push(`Warehouse has ${inventoryUnitCount} inventory unit(s)`);
    if (stockAuditCount > 0) conflicts.push(`Warehouse has ${stockAuditCount} stock audit(s)`);
    if (goodsReceiptCount > 0) conflicts.push(`Warehouse has ${goodsReceiptCount} goods receipt(s)`);
    if (purchaseOrderCount > 0) conflicts.push(`Warehouse has ${purchaseOrderCount} purchase order(s)`);
    if (outboundOrderCount > 0) conflicts.push(`Warehouse has ${outboundOrderCount} outbound order(s)`);
    if (stockReservationCount > 0) conflicts.push(`Warehouse has ${stockReservationCount} stock reservation(s)`);
    if (transferFromCount > 0 || transferToCount > 0) {
      conflicts.push(`Warehouse has ${transferFromCount + transferToCount} transfer order relation(s)`);
    }

    if (conflicts.length > 0) {
      return res.status(409).json({
        message: 'Cannot delete warehouse because it is referenced by existing records',
        conflicts,
      });
    }

    await prisma.warehouses.delete({ where: { id } });
    return res.status(204).send();
  } catch (error) {
    console.error('Error while deleting warehouse:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

module.exports = {
  getAllWarehouses,
  getWarehouseById,
  createWarehouse,
  updateWarehouse,
  deleteWarehouse,
};