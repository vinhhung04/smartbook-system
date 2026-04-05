const express = require('express');
const { prisma } = require('../lib/prisma');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20));
    const skip = (page - 1) * pageSize;

    const where = {};
    if (req.query.entity_type) where.entity_type = String(req.query.entity_type);
    if (req.query.action_name) where.action_name = { contains: String(req.query.action_name), mode: 'insensitive' };
    if (req.query.actor_user_id) where.actor_user_id = String(req.query.actor_user_id);

    const [items, total] = await Promise.all([
      prisma.borrow_audit_logs.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip,
        take: pageSize,
      }),
      prisma.borrow_audit_logs.count({ where }),
    ]);

    return res.json({
      data: items,
      meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) || 1 },
    });
  } catch (error) {
    console.error('audit logs error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

module.exports = router;
