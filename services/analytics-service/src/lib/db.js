const { Pool } = require('pg');

const inventoryConnectionString = process.env.INVENTORY_DATABASE_URL;
const borrowConnectionString = process.env.BORROW_DATABASE_URL;

if (!inventoryConnectionString) {
  throw new Error('INVENTORY_DATABASE_URL is required');
}

if (!borrowConnectionString) {
  throw new Error('BORROW_DATABASE_URL is required');
}

// Analytics is the reporting boundary for cross-domain reads. Business services
// keep their own databases isolated; this service only aggregates read models.
const inventoryPool = new Pool({
  connectionString: inventoryConnectionString,
  application_name: 'smartbook-analytics-inventory',
  max: Number(process.env.DB_POOL_SIZE || 5),
});

const borrowPool = new Pool({
  connectionString: borrowConnectionString,
  application_name: 'smartbook-analytics-borrow',
  max: Number(process.env.DB_POOL_SIZE || 5),
});

async function query(pool, text, params = []) {
  const result = await pool.query(text, params);
  return result.rows;
}

async function queryOne(pool, text, params = []) {
  const rows = await query(pool, text, params);
  return rows[0] || {};
}

async function pingDatabases() {
  const [inventory, borrow] = await Promise.all([
    queryOne(inventoryPool, 'SELECT 1 AS ok'),
    queryOne(borrowPool, 'SELECT 1 AS ok'),
  ]);

  return {
    inventory: Number(inventory.ok) === 1 ? 'ok' : 'unknown',
    borrow: Number(borrow.ok) === 1 ? 'ok' : 'unknown',
  };
}

async function closePools() {
  await Promise.allSettled([inventoryPool.end(), borrowPool.end()]);
}

module.exports = {
  inventoryPool,
  borrowPool,
  query,
  queryOne,
  pingDatabases,
  closePools,
};
