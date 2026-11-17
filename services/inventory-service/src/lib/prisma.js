const { PrismaClient } = require('@prisma/client');

// One client = one connection pool for the whole service. A client per module
// opened ~40 pools and exhausted Postgres max_connections (shared by all services).
const prisma = new PrismaClient();
const { observeStockAuditFreeze } = require('../middlewares/stock-audit-freeze.middleware');
if (typeof prisma.$use === 'function') prisma.$use(async (params, next) => {
  try { return await next(params); }
  catch (error) { observeStockAuditFreeze(error); throw error; }
});

module.exports = {
  prisma,
};
