const { PrismaClient } = require('@prisma/client');
const { auditBorrowInventoryState } = require('../src/services/borrow-state-reconciliation.service');
async function main() {
  if (!process.env.DATABASE_URL || !process.env.INTERNAL_SERVICE_KEY) throw new Error('Explicit database and internal service configuration required');
  const cursor = process.argv[2] ? JSON.parse(process.argv[2]) : {};
  const limit = Number(process.argv[3]) || 10;
  const db = new PrismaClient();
  try {
    const result = await db.$transaction(async tx => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      return auditBorrowInventoryState(tx, { cursor, limit });
    }, { isolationLevel: 'RepeatableRead', timeout: 120000 });
    console.log(JSON.stringify(result, null, 2));
    if (result.errors.length) process.exitCode = 1;
    else if (result.issues.length) process.exitCode = 2;
  } finally { await db.$disconnect(); }
}
main().catch(() => { console.error('Read-only custody reconciliation failed; verify explicit targets and service availability. No repair was performed.'); process.exitCode = 1; });
