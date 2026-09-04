const { prisma } = require('../lib/prisma');
const { writeAuditLog } = require('../lib/audit');
const { resolveActiveMembership, computeMembershipEndDate } = require('../services/membership.service');

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ''));
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function parsePagination(query) {
  const page = Math.max(1, Number.parseInt(String(query.page || '1'), 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(String(query.pageSize || '20'), 10) || 20));
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

function generateCustomerCode() {
  const year = new Date().getFullYear();
  const suffix = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `CUS-${year}-${suffix}`;
}

function generateCardNumber(customerId) {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  const idPart = String(customerId || '').replace(/-/g, '').slice(0, 8).toUpperCase();
  return `CARD-${stamp}-${idPart}`;
}

function parseId(value) {
  const id = String(value || '').trim();
  return id || null;
}

async function resolveCurrentCustomer(req) {
  const userId = String(req.user?.id || '').trim();
  const email = String(req.user?.email || '').trim().toLowerCase();

  if (!email) {
    return null;
  }

  const customer = await prisma.customers.findFirst({
    where: {
      email,
    },
  });

  if (!customer && userId) {
    return prisma.customers.findFirst({
      where: {
        customer_code: `AUTH-${userId.slice(0, 12).toUpperCase()}`,
      },
    });
  }

  return customer;
}

async function ensureCurrentCustomer(req) {
  const existed = await resolveCurrentCustomer(req);
  if (existed) {
    return existed;
  }

  const email = String(req.user?.email || '').trim().toLowerCase();
  const fullName = String(req.user?.full_name || req.user?.username || '').trim();
  const userId = String(req.user?.id || '').trim();

  if (!email || !fullName) {
    return null;
  }

  try {
    const created = await prisma.$transaction(async (tx) => {
      const customer = await tx.customers.create({
        data: {
          customer_code: userId ? `AUTH-${userId.slice(0, 12).toUpperCase()}` : generateCustomerCode(),
          full_name: fullName,
          email,
          status: 'ACTIVE',
        },
      });

      await tx.customer_preferences.create({
        data: { customer_id: customer.id },
      });

      const membershipPlan = await tx.membership_plans.findFirst({
        where: {
          is_active: true,
          code: String(process.env.DEFAULT_MEMBERSHIP_PLAN_CODE || 'STANDARD').trim(),
        },
      }) || await tx.membership_plans.findFirst({
        where: { is_active: true },
        orderBy: [{ created_at: 'asc' }],
      }) || await tx.membership_plans.create({
        data: {
          code: String(process.env.DEFAULT_MEMBERSHIP_PLAN_CODE || 'STANDARD').trim(),
          name: 'Standard Plan',
          description: 'Auto-created default plan for customer self provisioning',
          max_active_loans: 5,
          max_loan_days: 14,
          max_renewal_count: 2,
          reservation_hold_hours: 24,
          fine_per_day: 5000,
          lost_item_fee_multiplier: 1,
          is_active: true,
        },
      });

      await tx.customer_memberships.create({
        data: {
          customer_id: customer.id,
          plan_id: membershipPlan.id,
          card_number: generateCardNumber(customer.id),
          start_date: new Date(),
          end_date: computeMembershipEndDate(new Date()),
          status: 'ACTIVE',
          note: 'Auto assigned from customer self provisioning',
        },
      });

      return customer;
    });

    return created;
  } catch (error) {
    if (error?.code === 'P2002') {
      return prisma.customers.findFirst({ where: { email } });
    }
    throw error;
  }
}

async function listCustomers(req, res) {
  const { status, q } = req.query;
  const pagination = parsePagination(req.query);

  const where = {
    ...(typeof status === 'string' && status ? { status } : {}),
    ...(typeof q === 'string' && q.trim()
      ? {
          OR: [
            { full_name: { contains: q.trim(), mode: 'insensitive' } },
            { customer_code: { contains: q.trim(), mode: 'insensitive' } },
            { email: { contains: q.trim(), mode: 'insensitive' } },
            { phone: { contains: q.trim(), mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  try {
    const [items, total] = await Promise.all([
      prisma.customers.findMany({
        where,
        orderBy: [{ created_at: 'desc' }],
        skip: pagination.skip,
        take: pagination.take,
      }),
      prisma.customers.count({ where }),
    ]);

    return res.json({
      data: items,
      meta: {
        page: pagination.page,
        pageSize: pagination.pageSize,
        total,
        totalPages: Math.ceil(total / pagination.pageSize) || 1,
      },
    });
  } catch (error) {
    console.error('Error while listing customers:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

async function createCustomer(req, res) {
  const { full_name, email, phone, birth_date, address, status } = req.body;
  const actorUserId = req.user?.id || null;
  const defaultPlanCode = String(process.env.DEFAULT_MEMBERSHIP_PLAN_CODE || 'STANDARD').trim();

  if (!full_name || String(full_name).trim().length < 2) {
    return res.status(400).json({ message: 'full_name is required and must be at least 2 chars' });
  }

  const resolvedStatus = status || 'ACTIVE';
  if (!['ACTIVE', 'SUSPENDED', 'BLOCKED', 'INACTIVE'].includes(resolvedStatus)) {
    return res.status(400).json({ message: 'Invalid status' });
  }

  if (email && !isValidEmail(email)) {
    return res.status(400).json({ message: 'Invalid email format' });
  }

  try {
    const created = await prisma.$transaction(async (tx) => {
      const customer = await tx.customers.create({
        data: {
          customer_code: generateCustomerCode(),
          full_name: String(full_name).trim(),
          email: email ? String(email).trim() : null,
          phone: phone ? String(phone).trim() : null,
          birth_date: birth_date ? new Date(birth_date) : null,
          address: address ? String(address).trim() : null,
          status: resolvedStatus,
        },
      });

      await tx.customer_preferences.create({
        data: {
          customer_id: customer.id,
        },
      });

      const membershipPlan = await tx.membership_plans.findFirst({
        where: {
          is_active: true,
          ...(defaultPlanCode ? { code: defaultPlanCode } : {}),
        },
      }) || await tx.membership_plans.findFirst({
        where: { is_active: true },
        orderBy: [{ created_at: 'asc' }],
      });

      if (membershipPlan) {
        const membership = await tx.customer_memberships.create({
          data: {
            customer_id: customer.id,
            plan_id: membershipPlan.id,
            card_number: generateCardNumber(customer.id),
            start_date: new Date(),
            end_date: computeMembershipEndDate(new Date()),
            status: resolvedStatus === 'ACTIVE' ? 'ACTIVE' : 'INACTIVE',
            note: 'Auto assigned on customer creation',
          },
        });

        await writeAuditLog(tx, {
          actor_user_id: actorUserId,
          action_name: 'AUTO_ASSIGN_CUSTOMER_MEMBERSHIP',
          entity_type: 'CUSTOMER_MEMBERSHIP',
          entity_id: membership.id,
          after_data: {
            customer_id: membership.customer_id,
            plan_id: membership.plan_id,
            plan_code: membershipPlan.code,
            status: membership.status,
          },
        });
      }

      await writeAuditLog(tx, {
        actor_user_id: actorUserId,
        action_name: 'CREATE_CUSTOMER',
        entity_type: 'CUSTOMER',
        entity_id: customer.id,
        after_data: customer,
      });

      return customer;
    });

    return res.status(201).json({ data: created });
  } catch (error) {
    if (error?.code === 'P2002') {
      return res.status(409).json({ message: 'Email, phone or customer_code already exists' });
    }
    console.error('Error while creating customer:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

async function getCustomerById(req, res) {
  const id = parseId(req.params.id);
  if (!id || !isUuid(id)) {
    return res.status(400).json({ message: 'Invalid customer id' });
  }

  try {
    const customer = await prisma.customers.findUnique({
      where: { id },
      include: {
        customer_preferences: true,
        customer_memberships: {
          include: { membership_plans: true },
          orderBy: [{ start_date: 'desc' }],
          take: 5,
        },
      },
    });

    if (!customer) {
      return res.status(404).json({ message: 'Customer not found' });
    }

    return res.json({ data: customer });
  } catch (error) {
    console.error('Error while fetching customer by id:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

async function updateCustomer(req, res) {
  const id = parseId(req.params.id);
  const actorUserId = req.user?.id || null;

  if (!id || !isUuid(id)) {
    return res.status(400).json({ message: 'Invalid customer id' });
  }

  const { full_name, email, phone, birth_date, address, status } = req.body;

  if (status && !['ACTIVE', 'SUSPENDED', 'BLOCKED', 'INACTIVE'].includes(status)) {
    return res.status(400).json({ message: 'Invalid status' });
  }

  if (email !== undefined && email && !isValidEmail(email)) {
    return res.status(400).json({ message: 'Invalid email format' });
  }

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const existing = await tx.customers.findUnique({ where: { id } });
      if (!existing) {
        return null;
      }

      const customer = await tx.customers.update({
        where: { id },
        data: {
          ...(full_name !== undefined ? { full_name: String(full_name).trim() } : {}),
          ...(email !== undefined ? { email: email ? String(email).trim() : null } : {}),
          ...(phone !== undefined ? { phone: phone ? String(phone).trim() : null } : {}),
          ...(birth_date !== undefined ? { birth_date: birth_date ? new Date(birth_date) : null } : {}),
          ...(address !== undefined ? { address: address ? String(address).trim() : null } : {}),
          ...(status !== undefined ? { status } : {}),
        },
      });

      await writeAuditLog(tx, {
        actor_user_id: actorUserId,
        action_name: 'UPDATE_CUSTOMER',
        entity_type: 'CUSTOMER',
        entity_id: customer.id,
        before_data: existing,
        after_data: customer,
      });

      return customer;
    });

    if (!updated) {
      return res.status(404).json({ message: 'Customer not found' });
    }

    return res.json({ data: updated });
  } catch (error) {
    if (error?.code === 'P2002') {
      return res.status(409).json({ message: 'Email or phone already exists' });
    }
    console.error('Error while updating customer:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

async function getActiveMembership(req, res) {
  const id = parseId(req.params.id);

  if (!id || !isUuid(id)) {
    return res.status(400).json({ message: 'Invalid customer id' });
  }

  try {
    const customer = await prisma.customers.findUnique({ where: { id } });
    if (!customer) {
      return res.status(404).json({ message: 'Customer not found' });
    }

    const membershipInfo = await resolveActiveMembership(prisma, id);
    if (!membershipInfo) {
      return res.status(404).json({ message: 'Active membership not found' });
    }

    const activeLoanCount = await prisma.loan_transactions.count({
      where: {
        customer_id: id,
        status: { in: ['RESERVED', 'BORROWED', 'OVERDUE'] },
      },
    });

    return res.json({
      data: {
        customer_id: id,
        membership_id: membershipInfo.membership.id,
        plan_id: membershipInfo.plan.id,
        plan_code: membershipInfo.plan.code,
        plan_name: membershipInfo.plan.name,
        limits: membershipInfo.limits,
        active_loan_count: activeLoanCount,
        remaining_loan_slots: Math.max(0, membershipInfo.limits.max_active_loans - activeLoanCount),
        outstanding_fine_balance: Number(customer.total_fine_balance),
      },
    });
  } catch (error) {
    console.error('Error while loading active membership:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

async function getMyProfile(req, res) {
  try {
    const customer = await ensureCurrentCustomer(req);
    if (!customer) {
      return res.status(404).json({ message: 'Customer profile not found' });
    }

    const withPrefs = await prisma.customers.findUnique({
      where: { id: customer.id },
      include: {
        customer_preferences: true,
      },
    });

    return res.json({ data: withPrefs });
  } catch (error) {
    console.error('Error while loading own profile:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

async function updateMyProfile(req, res) {
  try {
    const customer = await ensureCurrentCustomer(req);
    if (!customer) {
      return res.status(404).json({ message: 'Customer profile not found' });
    }

    const { full_name, phone, birth_date, address } = req.body || {};

    const updated = await prisma.customers.update({
      where: { id: customer.id },
      data: {
        ...(full_name !== undefined ? { full_name: String(full_name).trim() } : {}),
        ...(phone !== undefined ? { phone: phone ? String(phone).trim() : null } : {}),
        ...(birth_date !== undefined ? { birth_date: birth_date ? new Date(birth_date) : null } : {}),
        ...(address !== undefined ? { address: address ? String(address).trim() : null } : {}),
      },
      include: {
        customer_preferences: true,
      },
    });

    return res.json({
      message: 'Profile updated',
      data: updated,
    });
  } catch (error) {
    if (error?.code === 'P2002') {
      return res.status(409).json({ message: 'Phone already exists' });
    }
    console.error('Error while updating own profile:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

async function getMyMembership(req, res) {
  try {
    const customer = await ensureCurrentCustomer(req);
    if (!customer) {
      return res.status(404).json({ message: 'Customer profile not found' });
    }

    const membershipInfo = await resolveActiveMembership(prisma, customer.id);
    if (!membershipInfo) {
      return res.status(404).json({ message: 'Active membership not found' });
    }

    const activeLoanCount = await prisma.loan_transactions.count({
      where: {
        customer_id: customer.id,
        status: { in: ['RESERVED', 'BORROWED', 'OVERDUE'] },
      },
    });

    return res.json({
      data: {
        customer_id: customer.id,
        membership_id: membershipInfo.membership.id,
        plan_id: membershipInfo.plan.id,
        plan_code: membershipInfo.plan.code,
        plan_name: membershipInfo.plan.name,
        limits: membershipInfo.limits,
        active_loan_count: activeLoanCount,
        remaining_loan_slots: Math.max(0, membershipInfo.limits.max_active_loans - activeLoanCount),
        outstanding_fine_balance: Number(customer.total_fine_balance),
      },
    });
  } catch (error) {
    console.error('Error while loading own membership:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

async function provisionCustomerFromAuth(req, res) {
  const internalServiceKey = String(process.env.INTERNAL_SERVICE_KEY || 'smartbook-internal-dev-key').trim();

  const providedKey = String(req.headers['x-internal-service-key'] || '').trim();
  if (providedKey !== internalServiceKey) {
    return res.status(401).json({ message: 'Unauthorized internal call' });
  }

  const email = String(req.body?.email || '').trim().toLowerCase();
  const full_name = String(req.body?.full_name || '').trim();
  const userId = String(req.body?.user_id || '').trim();

  if (!email || !full_name) {
    return res.status(400).json({ message: 'email and full_name are required' });
  }

  try {
    const existing = await prisma.customers.findFirst({ where: { email } });
    if (existing) {
      return res.json({ data: existing, created: false });
    }

    const created = await prisma.$transaction(async (tx) => {
      const customer = await tx.customers.create({
        data: {
          customer_code: userId ? `AUTH-${userId.slice(0, 12).toUpperCase()}` : generateCustomerCode(),
          full_name,
          email,
          status: 'ACTIVE',
        },
      });

      await tx.customer_preferences.create({
        data: {
          customer_id: customer.id,
        },
      });

      const membershipPlan = await tx.membership_plans.findFirst({
        where: {
          is_active: true,
          code: String(process.env.DEFAULT_MEMBERSHIP_PLAN_CODE || 'STANDARD').trim(),
        },
      }) || await tx.membership_plans.findFirst({
        where: { is_active: true },
        orderBy: [{ created_at: 'asc' }],
      });

      const ensuredPlan = membershipPlan || await tx.membership_plans.create({
        data: {
          code: String(process.env.DEFAULT_MEMBERSHIP_PLAN_CODE || 'STANDARD').trim(),
          name: 'Standard Plan',
          description: 'Auto-created default plan for customer provisioning',
          max_active_loans: 5,
          max_loan_days: 14,
          max_renewal_count: 2,
          reservation_hold_hours: 24,
          fine_per_day: 5000,
          lost_item_fee_multiplier: 1,
          is_active: true,
        },
      });

      await tx.customer_memberships.create({
        data: {
          customer_id: customer.id,
          plan_id: ensuredPlan.id,
          card_number: generateCardNumber(customer.id),
          start_date: new Date(),
          end_date: computeMembershipEndDate(new Date()),
          status: 'ACTIVE',
          note: 'Auto assigned from auth register',
        },
      });

      return customer;
    });

    return res.status(201).json({ data: created, created: true });
  } catch (error) {
    if (error?.code === 'P2002') {
      return res.status(409).json({ message: 'Customer profile already exists' });
    }
    console.error('Error while provisioning customer:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

async function resolveCustomerByAuth(req, res) {
  const internalKey = process.env.INTERNAL_SERVICE_KEY || 'smartbook_internal_key';
  if (req.headers['x-internal-service-key'] !== internalKey) {
    return res.status(403).json({ message: 'Forbidden' });
  }

  const { email, user_id } = req.query;
  if (!email && !user_id) {
    return res.status(400).json({ message: 'email or user_id is required' });
  }

  try {
    let customer = null;

    if (email) {
      customer = await prisma.customers.findFirst({
        where: { email: String(email).trim().toLowerCase() },
        select: { id: true },
      });
    }

    if (!customer && user_id) {
      const code = `AUTH-${String(user_id).slice(0, 12).toUpperCase()}`;
      customer = await prisma.customers.findFirst({
        where: { customer_code: code },
        select: { id: true },
      });
    }

    if (!customer) {
      return res.status(404).json({ message: 'Customer not found' });
    }

    return res.json({ customer_id: customer.id });
  } catch (err) {
    console.error('[resolveCustomerByAuth] error:', err.message);
    return res.status(500).json({ message: 'Internal error' });
  }
}

module.exports = {
  listCustomers,
  createCustomer,
  getCustomerById,
  updateCustomer,
  getActiveMembership,
  getMyProfile,
  updateMyProfile,
  getMyMembership,
  provisionCustomerFromAuth,
  ensureCurrentCustomer,
  resolveCustomerByAuth,
};
