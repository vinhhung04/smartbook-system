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