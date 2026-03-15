const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

function parseId(value) {
  const id = Number(value);
  return Number.isNaN(id) ? null : id;
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
        zones: {
          include: {
            bins: true,
          },
          orderBy: { id: 'asc' },
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
      zones: warehouse.zones,
    });
  } catch (error) {
    console.error('Error while fetching zones and bins:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

module.exports = {
  getZonesAndBinsByWarehouse,
};