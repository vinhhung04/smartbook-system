const express = require('express');
const { prisma } = require('../lib/prisma');
const { authorizeBorrowAdminRead, authorizeBorrowAdminWrite } = require('../middlewares/auth.middleware');
const { setDefaultMembershipPlan } = require('../services/membership.service');

const router = express.Router();

/** price / duration_days from a staff form: undefined when absent, an error
 *  string when present but invalid. */
function parsePlanTerms(body) {
  const terms = {};
  if (body.price !== undefined) {
    const price = Number(body.price);
    if (!Number.isFinite(price) || price < 0) return { error: 'price must be a number >= 0' };
    terms.price = price;
  }
  if (body.duration_days !== undefined) {
    const duration = Number(body.duration_days);
    if (!Number.isInteger(duration) || duration <= 0) return { error: 'duration_days must be a positive integer' };
    terms.duration_days = duration;
  }
  return { terms };
}

router.get('/', authorizeBorrowAdminRead, async (req, res) => {
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

router.post('/', authorizeBorrowAdminWrite, async (req, res) => {
  try {
    const { code, name, description, max_active_loans, max_loan_days, max_renewal_count, reservation_hold_hours, fine_per_day, lost_item_fee_multiplier, is_default } = req.body;
    if (!code || !name) return res.status(400).json({ message: 'code and name are required' });
    const { terms, error } = parsePlanTerms(req.body);
    if (error) return res.status(400).json({ message: error });

    const plan = await prisma.$transaction(async (tx) => {
      const created = await tx.membership_plans.create({
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
          ...terms,
        },
      });
      if (is_default === true) return (await setDefaultMembershipPlan(tx, created.id)).plan;
      return created;
    });
    return res.status(201).json({ data: plan });
  } catch (error) {
    if (error.code === 'P2002') return res.status(409).json({ message: 'Plan code already exists' });
    console.error('createMembershipPlan error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

router.patch('/:id', authorizeBorrowAdminWrite, async (req, res) => {
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
    const { terms, error } = parsePlanTerms(req.body);
    if (error) return res.status(400).json({ message: error });
    Object.assign(data, terms);
    data.updated_at = new Date();

    // The default flag can only be moved to another plan (is_default: true on
    // that plan), never simply removed: new accounts must always get a card.
    if (req.body.is_default === false) {
      return res.status(400).json({ message: 'Choose another plan as default instead of unsetting it' });
    }

    const result = await prisma.$transaction(async (tx) => {
      const current = await tx.membership_plans.findUnique({ where: { id } });
      if (!current) return { status: 404, message: 'Plan not found' };
      if (data.is_active === false && current.is_default) {
        return { status: 409, message: 'The default plan cannot be deactivated; choose another default first' };
      }
      const updated = await tx.membership_plans.update({ where: { id }, data });
      if (req.body.is_default === true) {
        const outcome = await setDefaultMembershipPlan(tx, id);
        // Throwing rolls back the update above as well.
        if (outcome.error === 'INACTIVE') throw new Error('INACTIVE_DEFAULT');
        return { plan: outcome.plan };
      }
      return { plan: updated };
    });

    if (result.status) return res.status(result.status).json({ message: result.message });
    return res.json({ data: result.plan });
  } catch (error) {
    if (error.message === 'INACTIVE_DEFAULT') return res.status(409).json({ message: 'An inactive plan cannot be the default plan' });
    if (error.code === 'P2025') return res.status(404).json({ message: 'Plan not found' });
    console.error('updateMembershipPlan error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

module.exports = router;
