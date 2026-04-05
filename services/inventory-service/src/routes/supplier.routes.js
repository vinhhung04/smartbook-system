const express = require('express');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const suppliers = await prisma.suppliers.findMany({
      orderBy: { created_at: 'desc' },
      include: { _count: { select: { purchase_orders: true, supplier_variants: true } } },
    });
    return res.json(suppliers);
  } catch (error) {
    console.error('getSuppliers error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { code, name, contact_name, phone, email, address, tax_code } = req.body;
    if (!name) return res.status(400).json({ message: 'name is required' });

    const supplier = await prisma.suppliers.create({
      data: {
        code: code ? code.toUpperCase().trim() : null,
        name: name.trim(),
        contact_name: contact_name || null,
        phone: phone || null,
        email: email || null,
        address: address || null,
        tax_code: tax_code || null,
      },
    });
    return res.status(201).json(supplier);
  } catch (error) {
    if (error.code === 'P2002') return res.status(409).json({ message: 'Supplier name or code already exists' });
    console.error('createSupplier error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const allowed = ['name', 'contact_name', 'phone', 'email', 'address', 'tax_code', 'status'];
    const data = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) data[key] = req.body[key];
    }
    data.updated_at = new Date();

    const supplier = await prisma.suppliers.update({ where: { id }, data });
    return res.json(supplier);
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ message: 'Supplier not found' });
    console.error('updateSupplier error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await prisma.suppliers.delete({ where: { id: req.params.id } });
    return res.json({ message: 'Supplier deleted' });
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ message: 'Supplier not found' });
    console.error('deleteSupplier error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

module.exports = router;
