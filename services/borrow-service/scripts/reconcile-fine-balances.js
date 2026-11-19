const { PrismaClient } = require('@prisma/client');
const { auditFineBalances } = require('../src/services/fine-balance-reconciliation.service');

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL_REQUIRED');
  const prisma = new PrismaClient();
  try {
    const result = await prisma.$transaction(async tx => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      await tx.$executeRaw`SET LOCAL statement_timeout = '15s'`;
      return auditFineBalances(tx);
    }, { timeout: 20000 });
    console.log(JSON.stringify({ check: 'fine-balance-reconciliation', ...result }));
    if (result.count) process.exitCode = 2;
  } finally { await prisma.$disconnect(); }
}

main().catch(() => {
  // Connection/Prisma messages may include a URL. Report failure without logging credentials.
  console.error('Fine balance reconciliation could not complete');
  process.exitCode = 1;
});
