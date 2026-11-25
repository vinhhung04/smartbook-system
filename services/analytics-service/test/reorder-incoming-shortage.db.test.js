// Execute the controller's incoming SQL against isolated TEMP PostgreSQL tables.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const url = process.env.ANALYTICS_TEST_PG_URL;
let client;
const dbPath = path.resolve(__dirname, '../src/lib/db.js');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {
  inventoryPool: 'inventory', borrowPool: 'borrow',
  async query(_pool, sql, params) {
    if (sql.includes('FROM purchase_order_items poi')) return (await client.query(sql, params)).rows;
    if (sql.includes('FROM book_variants bv') && sql.includes('bv.unit_cost') && sql.includes('GROUP BY')) {
      return [{ variant_id: '00000000-0000-4000-8000-000000000001', book_id: 'book', title: 'A',
        available_qty: 0, on_hand_qty: 0, reserved_qty: 0, borrowed_qty: 0, reorder_point: 20, unit_cost: 10000 }];
    }
    return [];
  },
  async queryOne() { return {}; },
} };
const { getReorderSuggestions } = require('../src/controllers/analytics.controller');

test('SB-18: open lines on a shortage PO remain incoming; closed lines and draft/cancelled POs do not',
  { skip: !url && 'ANALYTICS_TEST_PG_URL not set' }, async () => {
    const { Client } = require('pg');
    client = new Client({ connectionString: url });
    await client.connect();
    try {
      await client.query('BEGIN');
      // warehouse_id: incoming stock is filtered by the caller's warehouse scope (NULL here = every warehouse)
      await client.query('CREATE TEMP TABLE purchase_orders (id int PRIMARY KEY, status text, warehouse_id uuid) ON COMMIT DROP');
      await client.query(`CREATE TEMP TABLE purchase_order_items (purchase_order_id int, variant_id uuid,
        ordered_qty int, received_qty int, closure_status text) ON COMMIT DROP`);
      await client.query(`INSERT INTO purchase_orders (id, status) VALUES (1, 'SHORTAGE_REPORTED'), (2, 'CANCELLED'), (3, 'DRAFT')`);
      await client.query(`INSERT INTO purchase_order_items VALUES
        (1, '00000000-0000-4000-8000-000000000001', 10, 4, 'OPEN'),
        (1, '00000000-0000-4000-8000-000000000001', 10, 0, 'CLOSED_WITH_REMAINING'),
        (2, '00000000-0000-4000-8000-000000000001', 50, 0, 'OPEN'),
        (3, '00000000-0000-4000-8000-000000000001', 50, 0, 'OPEN')`);
      let body;
      await getReorderSuggestions({ query: { limit: '20', budgetVnd: '10000000' }, user: null, headers: {} },
        { json(value) { body = value; } }, (err) => { throw err; });
      const item = body.data.items[0];
      assert.equal(item.budget_plan.incoming_qty, 6);
      assert.equal(item.budget_plan.inventory_position, 6);
      assert.equal(item.budget_plan.cap_qty, 14);
    } finally {
      await client.query('ROLLBACK').catch(() => {});
      await client.end();
    }
  });
