const test = require('node:test');
const assert = require('node:assert/strict');
const { findOutboundShortages } = require('../src/services/outbound-availability.service');

function fakeTx({ available = [], outbound = [], transfer = [] } = {}) {
  const calls = { outboundWhere: null, locks: 0 };
  return {
    calls,
    async $queryRawUnsafe(sql) { if (sql.includes('pg_advisory_xact_lock')) calls.locks += 1; return [{}]; },
    stock_balances: { async groupBy() { return available.map(([variant_id, qty]) => ({ variant_id, _sum: { available_qty: qty } })); } },
    outbound_order_items: { async findMany({ where }) { calls.outboundWhere = where; return outbound; } },
    transfer_order_items: { async findMany() { return transfer; } },
  };
}

test('free stock = available minus unpicked remainder of approved outbound and transfer orders', async () => {
  const tx = fakeTx({
    available: [['v1', 10]],
    outbound: [{ variant_id: 'v1', quantity: 5, processed_qty: 2 }],
    transfer: [{ variant_id: 'v1', quantity: 4, shipped_qty: 0 }],
  });
  assert.deepEqual(await findOutboundShortages(tx, 'w1', new Map([['v1', 3]])), []);
  const [short] = await findOutboundShortages(tx, 'w1', new Map([['v1', 4]]));
  assert.equal(short.committed_qty, 7);
  assert.equal(short.free_qty, 3);
  assert.equal(short.shortage_qty, 1);
  assert.equal(tx.calls.locks, 2);
});

test('variant with no stock row is fully short; the order being approved is excluded from commitments', async () => {
  const tx = fakeTx();
  const [short] = await findOutboundShortages(tx, 'w1', new Map([['v2', 2]]), { excludeOrderId: 'o1' });
  assert.equal(short.shortage_qty, 2);
  assert.deepEqual(tx.calls.outboundWhere.outbound_orders.id, { not: 'o1' });
});

test('nothing requested -> no query, no shortage', async () => {
  const tx = fakeTx();
  assert.deepEqual(await findOutboundShortages(tx, 'w1', new Map()), []);
  assert.equal(tx.calls.locks, 0);
});
