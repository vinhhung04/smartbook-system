const express = require('express');
const { prisma } = require('../lib/prisma');
const { findDefaultMembershipPlan, DEFAULT_MEMBERSHIP_DURATION_DAYS } = require('../services/membership.service');

// Anonymous, read-only membership plans for the public /membership page. GET
// only; creating and editing plans stays on /borrow/membership-plans (staff).
// Explicit whitelist: plan code, member counts and audit timestamps never leave.
const PUBLIC_PLAN_SELECT = {
  id: true,
  name: true,
  description: true,
  max_active_loans: true,
  max_loan_days: true,
  max_renewal_count: true,
  reservation_hold_hours: true,
  fine_per_day: true,
};

function toPublicPlan(plan, defaultPlanId) {
  return {
    id: plan.id,
    name: plan.name,
    description: plan.description || null,
    max_active_loans: plan.max_active_loans,
    max_loan_days: plan.max_loan_days,
    max_renewal_count: plan.max_renewal_count,
    reservation_hold_hours: plan.reservation_hold_hours,
    fine_per_day: Number(plan.fine_per_day),
    // Business rule, not marketing: the plan a newly created account receives.
    is_default: plan.id === defaultPlanId,
  };
}

async function listPublicPlans(client) {
  const [plans, defaultPlan] = await Promise.all([
    client.membership_plans.findMany({
      where: { is_active: true },
      select: PUBLIC_PLAN_SELECT,
      orderBy: [{ max_active_loans: 'asc' }, { max_loan_days: 'asc' }, { name: 'asc' }],
    }),
    findDefaultMembershipPlan(client, { id: true }),
  ]);
  return {
    data: plans.map((plan) => toPublicPlan(plan, defaultPlan?.id || null)),
    // How long a card issued at sign-up stays valid (customer provisioning).
    card_validity_days: DEFAULT_MEMBERSHIP_DURATION_DAYS,
  };
}

function createPublicMembershipRouter(client = prisma) {
  const router = express.Router();
  router.get('/plans', async (_req, res) => {
    try {
      res.set('Cache-Control', 'public, max-age=300');
      return res.json(await listPublicPlans(client));
    } catch (error) {
      console.error('[public-membership] request failed:', error);
      return res.status(500).json({ message: 'Không tải được thông tin thẻ bạn đọc' });
    }
  });
  return router;
}

module.exports = createPublicMembershipRouter();
module.exports.PUBLIC_PLAN_SELECT = PUBLIC_PLAN_SELECT;
module.exports.listPublicPlans = listPublicPlans;
module.exports.createPublicMembershipRouter = createPublicMembershipRouter;
