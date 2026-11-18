const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { auditFineBalances } = require('../src/services/fine-balance-reconciliation.service');
const url = process.env.BORROW_TEST_DATABASE_URL;

test('PRA06: read-only reconciliation finds stale debt and accounts for payments and waivers', { skip: !url }, async () => {
  const target = new URL(url);
  assert.ok(['127.0.0.1', 'localhost'].includes(target.hostname) && /^\/borrow_audit[a-z_]*$/.test(target.pathname));
  const { PrismaClient } = process.env.BORROW_AUDIT_PRISMA_CLIENT ? require(process.env.BORROW_AUDIT_PRISMA_CLIENT) : require('@prisma/client');
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    const customer = await prisma.customers.create({ data: { customer_code: `REC-${randomUUID().slice(0, 12)}`, full_name: 'Reconciliation test', total_fine_balance: 0 } });
    const fine = await prisma.fines.create({ data: { customer_id: customer.id, fine_type: 'DAMAGE', amount: 100000, waived_amount: 10000, status: 'PARTIALLY_PAID' } });
    await prisma.fine_payments.create({ data: { fine_id: fine.id, amount: 20000, payment_method: 'TRANSFER' } });
    await prisma.fines.create({ data: { customer_id: customer.id, fine_type: 'DAMAGE', amount: 50000, status: 'WAIVED' } });
    const result = await prisma.$transaction(async tx => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      return auditFineBalances(tx, { customerIds: [customer.id] });
    });
    assert.equal(result.count, 1);
    assert.deepEqual(result.items, [{ customer_id: customer.id, cached_balance: 0, computed_balance: 70000 }]);
    assert.equal(Number((await prisma.customers.findUnique({ where: { id: customer.id } })).total_fine_balance), 0, 'detector must not change the cache');
    await prisma.customers.update({ where: { id: customer.id }, data: { total_fine_balance: 70000 } });
    assert.deepEqual(await auditFineBalances(prisma, { customerIds: [customer.id] }), { count: 0, items: [] });
  } finally { await prisma.$disconnect(); }
});
