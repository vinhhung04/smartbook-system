const express = require('express');
const { prisma } = require('../lib/prisma');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const plans = await prisma.membership_plans.findMany({
      orderBy: { created_at: 'asc' },
      include: { _count: { select: { customer_memberships: true } } },
    });
    return res.json({ data: plans });
  } catch (error) {
    console.error('getMembershipPlans error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { code, name, description, max_active_loans, max_loan_days, max_renewal_count, reservation_hold_hours, fine_per_day, lost_item_fee_multiplier } = req.body;
    if (!code || !name) return res.status(400).json({ message: 'code and name are required' });

    const plan = await prisma.membership_plans.create({
      data: {
        code: code.toUpperCase().trim(),
        name: name.trim(),
        description: description || null,
        max_active_loans: Number(max_active_loans) || 5,
        max_loan_days: Number(max_loan_days) || 14,
        max_renewal_count: Number(max_renewal_count) || 2,
        reservation_hold_hours: Number(reservation_hold_hours) || 24,
        fine_per_day: Number(fine_per_day) || 0,
        lost_item_fee_multiplier: Number(lost_item_fee_multiplier) || 1,
      },
    });
    return res.status(201).json({ data: plan });
  } catch (error) {
    if (error.code === 'P2002') return res.status(409).json({ message: 'Plan code already exists' });
    console.error('createMembershipPlan error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const allowed = ['name', 'description', 'max_active_loans', 'max_loan_days', 'max_renewal_count', 'reservation_hold_hours', 'fine_per_day', 'lost_item_fee_multiplier', 'is_active'];
    const data = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        if (['max_active_loans', 'max_loan_days', 'max_renewal_count', 'reservation_hold_hours'].includes(key)) {
          data[key] = Number(req.body[key]);
        } else if (['fine_per_day', 'lost_item_fee_multiplier'].includes(key)) {
          data[key] = Number(req.body[key]);
        } else if (key === 'is_active') {
          data[key] = Boolean(req.body[key]);
        } else {
          data[key] = req.body[key];
        }
      }
    }
    data.updated_at = new Date();

    const plan = await prisma.membership_plans.update({ where: { id }, data });
    return res.json({ data: plan });
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ message: 'Plan not found' });
    console.error('updateMembershipPlan error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

module.exports = router;
