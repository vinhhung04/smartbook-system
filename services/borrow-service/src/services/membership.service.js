function getTodayDateOnly() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

async function resolveActiveMembership(tx, customerId) {
  const today = getTodayDateOnly();

  const membership = await tx.customer_memberships.findFirst({
    where: {
      customer_id: customerId,
      status: 'ACTIVE',
      OR: [{ end_date: null }, { end_date: { gte: today } }],
    },
    include: {
      membership_plans: true,
    },
    orderBy: [{ start_date: 'desc' }, { created_at: 'desc' }],
  });

  if (!membership || !membership.membership_plans || !membership.membership_plans.is_active) {
    return null;
  }

  return {
    membership,
    plan: membership.membership_plans,
    limits: {
      max_active_loans: membership.max_active_loans_override ?? membership.membership_plans.max_active_loans,
      max_loan_days: membership.max_loan_days_override ?? membership.membership_plans.max_loan_days,
      max_renewal_count: membership.membership_plans.max_renewal_count,
      reservation_hold_hours: membership.membership_plans.reservation_hold_hours,
      fine_per_day: Number(membership.membership_plans.fine_per_day),
      lost_item_fee_multiplier: Number(membership.membership_plans.lost_item_fee_multiplier),
    },
  };
}

const DEFAULT_MEMBERSHIP_DURATION_DAYS = 365;

function computeMembershipEndDate(startDate, durationDays = DEFAULT_MEMBERSHIP_DURATION_DAYS) {
  const start = startDate instanceof Date ? startDate : new Date(startDate);
  const end = new Date(start.getTime());
  end.setUTCDate(end.getUTCDate() + durationDays);
  return end;
}

function resolveRenewalStart(currentEndDate, today = new Date()) {
  if (!currentEndDate) return today;
  const end = currentEndDate instanceof Date ? currentEndDate : new Date(currentEndDate);
  return end.getTime() > today.getTime() ? end : today;
}

/**
 * The plan a new reader account is given: the active plan flagged `is_default`.
 * If no plan is flagged, the plan named by DEFAULT_MEMBERSHIP_PLAN_CODE (explicit
 * config) is used. Never falls back to plan names, created_at or row order — with
 * neither configured there is no default and the caller decides what to do.
 * Read-only: it never creates a plan.
 */
async function findDefaultMembershipPlan(client, select) {
  const flagged = await client.membership_plans.findMany({
    where: { is_active: true, is_default: true },
    ...(select ? { select: { ...select, id: true } } : {}),
    take: 2,
  });
  if (flagged.length > 1) {
    throw new Error('More than one default membership plan is configured');
  }
  if (flagged.length === 1) return flagged[0];

  const code = String(process.env.DEFAULT_MEMBERSHIP_PLAN_CODE || '').trim();
  if (!code) return null;
  return client.membership_plans.findFirst({ where: { is_active: true, code }, ...(select ? { select } : {}) });
}

/**
 * Gives a new customer the default plan's card, valid for that plan's
 * duration_days from startDate. Returns null (and assigns nothing) when no
 * default plan is configured — an inactive plan is never assigned.
 */
async function assignDefaultMembership(tx, { customerId, cardNumber, status = 'ACTIVE', note, startDate = new Date() }) {
  const plan = await findDefaultMembershipPlan(tx);
  if (!plan) {
    console.warn('[borrow-service] no default membership plan configured; customer created without a card', { customerId });
    return null;
  }

  const membership = await tx.customer_memberships.create({
    data: {
      customer_id: customerId,
      plan_id: plan.id,
      card_number: cardNumber,
      start_date: startDate,
      end_date: computeMembershipEndDate(startDate, plan.duration_days || DEFAULT_MEMBERSHIP_DURATION_DAYS),
      status,
      note,
    },
  });
  return { plan, membership };
}

/** Makes planId the only default plan. Serialized so two admins switching the
 *  default at once cannot leave two plans flagged. */
async function setDefaultMembershipPlan(tx, planId) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('membership-plans:default', 0))`;
  const plan = await tx.membership_plans.findUnique({ where: { id: planId } });
  if (!plan) return { error: 'NOT_FOUND' };
  if (!plan.is_active) return { error: 'INACTIVE' };
  await tx.membership_plans.updateMany({
    where: { is_default: true, id: { not: planId } },
    data: { is_default: false, updated_at: new Date() },
  });
  return { plan: await tx.membership_plans.update({ where: { id: planId }, data: { is_default: true, updated_at: new Date() } }) };
}

module.exports = {
  assignDefaultMembership,
  findDefaultMembershipPlan,
  setDefaultMembershipPlan,
  resolveActiveMembership,
  computeMembershipEndDate,
  resolveRenewalStart,
  DEFAULT_MEMBERSHIP_DURATION_DAYS,
};
