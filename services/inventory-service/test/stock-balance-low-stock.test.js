const test = require('node:test');
const assert = require('node:assert/strict');

// The controller builds a PrismaClient at require time; nothing here reaches the DB.
const { getLowStockByWarehouse } = require('../src/controllers/stock-balance.controller');

function fakeRes() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

test('a malformed warehouse_id is a 400, not a database error', async () => {
  const res = fakeRes();
  await getLowStockByWarehouse({ query: { warehouse_id: 'kho-ha-noi' } }, res);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { message: 'Invalid warehouse_id' });
});
