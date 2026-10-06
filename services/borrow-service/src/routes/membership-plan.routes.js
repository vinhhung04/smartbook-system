const express = require('express');
const { prisma } = require('../lib/prisma');
const { authorizeBorrowAdminRead, authorizeBorrowAdminWrite } = require('../middlewares/auth.middleware');
const { setDefaultMembershipPlan } = require('../services/membership.service');

const router = express.Router();

// Numeric plan fields. `default` is what POST uses when the field is omitted
// (undefined) — never when it is 0: max_renewal_count 0 means "no renewals".
// Upper bounds are the column limits (INT, DECIMAL(10,2), DECIMAL(5,2),
// DECIMAL(12,2)), so an oversized value is a 400 instead of a database error.
const INT_MAX = 2147483647;
const PLAN_NUMBER_RULES = {
  max_active_loans: { integer: true, min: 1, max: INT_MAX, default: 5 },
  max_loan_days: { integer: true, min: 1, max: INT_MAX, default: 14 },
  max_renewal_count: { integer: true, min: 0, max: INT_MAX, default: 2 },
  reservation_hold_hours: { integer: true, min: 1, max: INT_MAX, default: 24 },
  fine_per_day: { integer: false, min: 0, max: 99999999.99, default: 0 },
  lost_item_fee_multiplier: { integer: false, min: 0, max: 999.99, default: 1 },
  price: { integer: false, min: 0, max: 9999999999.99, default: 0 },
  duration_days: { integer: true, min: 1, max: INT_MAX, default: 365 },
};

/** A number, or a numeric string from an HTML form ("0", "5", "100000").
 *  Everything else — "", "abc", null, booleans, NaN, Infinity — is NaN. */
function toNumber(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '') return Number(value.trim());
  return Number.NaN;
}

function describeRule(key, rule) {
  const kind = rule.integer ? 'an integer' : 'a number';
  return `${key} must be ${kind} >= ${rule.min}${rule.integer ? '' : ' with at most 2 decimals'}`;
}

/**
 * Validates the numeric fields present in `body`. With `withDefaults` (POST)
 * omitted fields get their default; without it (PATCH) only sent fields are
 * returned. `{ error }` on the first invalid value — nothing is coerced.
 */
function parsePlanNumbers(body, { withDefaults = false } = {}) {
  const values = {};
  for (const [key, rule] of Object.entries(PLAN_NUMBER_RULES)) {
    if (body[key] === undefined) {
      if (withDefaults) values[key] = rule.default;
      continue;
    }
    const value = toNumber(body[key]);
    const validShape = rule.integer ? Number.isInteger(value) : Number.isFinite(value) && Math.round(value * 100) / 100 === value;
    if (!validShape || value < rule.min || value > rule.max) return { error: describeRule(key, rule) };
    values[key] = value;
  }
  return { values };
}

/** A flag sent as a real JSON boolean, or absent. "false", 0, null, [] are
 *  rejected rather than coerced (Boolean("false") is true). */
function parseOptionalBoolean(body, key) {
  if (body[key] === undefined) return { value: undefined };
  if (typeof body[key] !== 'boolean') return { error: `${key} must be a boolean` };
  return { value: body[key] };
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
    const { code, name, description } = req.body;
    if (!code || !name) return res.status(400).json({ message: 'code and name are required' });
    const { values, error } = parsePlanNumbers(req.body, { withDefaults: true });
    if (error) return res.status(400).json({ message: error });
    const isDefault = parseOptionalBoolean(req.body, 'is_default');
    if (isDefault.error) return res.status(400).json({ message: isDefault.error });

    const plan = await prisma.$transaction(async (tx) => {
      const created = await tx.membership_plans.create({
        data: {
          code: code.toUpperCase().trim(),
          name: name.trim(),
          description: description || null,
          ...values,
        },
      });
      if (isDefault.value === true) return (await setDefaultMembershipPlan(tx, created.id)).plan;
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
    const data = {};
    for (const key of ['name', 'description']) {
      if (req.body[key] !== undefined) data[key] = req.body[key];
    }
    const isActive = parseOptionalBoolean(req.body, 'is_active');
    if (isActive.error) return res.status(400).json({ message: isActive.error });
    if (isActive.value !== undefined) data.is_active = isActive.value;
    const isDefault = parseOptionalBoolean(req.body, 'is_default');
    if (isDefault.error) return res.status(400).json({ message: isDefault.error });
    // Only the numeric fields actually sent are validated and written.
    const { values, error } = parsePlanNumbers(req.body);
    if (error) return res.status(400).json({ message: error });
    Object.assign(data, values);
    data.updated_at = new Date();

    // The default flag can only be moved to another plan (is_default: true on
    // that plan), never simply removed: new accounts must always get a card.
    if (isDefault.value === false) {
      return res.status(400).json({ message: 'Choose another plan as default instead of unsetting it' });
    }

    const result = await prisma.$transaction(async (tx) => {
      const current = await tx.membership_plans.findUnique({ where: { id } });
      if (!current) return { status: 404, message: 'Plan not found' };
      if (data.is_active === false && current.is_default) {
        return { status: 409, message: 'The default plan cannot be deactivated; choose another default first' };
      }
      const updated = await tx.membership_plans.update({ where: { id }, data });
      if (isDefault.value === true) {
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
