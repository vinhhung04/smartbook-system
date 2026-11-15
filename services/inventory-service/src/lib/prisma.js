const { PrismaClient } = require('@prisma/client');

// One client = one connection pool for the whole service. A client per module
// opened ~40 pools and exhausted Postgres max_connections (shared by all services).
const prisma = new PrismaClient();

module.exports = {
  prisma,
};
