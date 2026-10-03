const test = require('node:test');
const assert = require('node:assert/strict');

// picking.controller.js does `new PrismaClient()` at module scope, so a fake
// @prisma/client is registered in require.cache (node --test isolates each file).
const MANAGER = { id: '11111111-1111-4111-8111-111111111111', roles: ['WAREHOUSE_MANAGER'] };
const ORDER_ID = '22222222-2222-4222-8222-222222222222';

function createFakeRes() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

function loadController({ outboundItems = [], transferItems = [] } = {}) {
  const tx = {
    async $queryRawUnsafe() {},
    outbound_orders: {
      async findUnique() {
        return { id: ORDER_ID, status: 'PICKING', processed_by_user_id: MANAGER.id, note: '' };
      },
    },
    outbound_order_items: { async findMany() { return outboundItems; } },
    transfer_orders: {
      async findUnique() {
        return { id: ORDER_ID, status: 'PICKING', shipped_by_user_id: MANAGER.id, note: '' };
      },
    },
    transfer_order_items: { async findMany() { return transferItems; } },
  };
  const client = { ...tx, async $transaction(fn) { return fn(tx); } };

  const prismaClientPath = require.resolve('@prisma/client');
  require.cache[prismaClientPath] = {
    id: prismaClientPath,
    filename: prismaClientPath,
    loaded: true,
    exports: { PrismaClient: function FakePrismaClient() { return client; } },
  };
  const controllerPath = require.resolve('../src/controllers/picking.controller.js');
  delete require.cache[controllerPath];
  return require('../src/controllers/picking.controller.js');
}

async function call(handler) {
  const res = createFakeRes();
  await handler({ params: { taskId: ORDER_ID }, user: MANAGER }, res);
  return res;
}

test('outbound: declaring a shortage before picking anything is rejected', async () => {
  const { declareOutboundShortage } = loadController({
    outboundItems: [{ id: 'i1', variant_id: 'v1', source_location_id: 'l1', quantity: 5, processed_qty: 0, note: '' }],
  });
  const res = await call(declareOutboundShortage);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /Chưa lấy cuốn nào/);
  assert.match(res.body.message, /báo cáo sự cố/);
});

test('outbound: zero picked across several lines is still rejected', async () => {
  const { declareOutboundShortage } = loadController({
    outboundItems: [
      { id: 'i1', variant_id: 'v1', source_location_id: 'l1', quantity: 2, processed_qty: 0, note: '' },
      { id: 'i2', variant_id: 'v2', source_location_id: 'l2', quantity: 3, processed_qty: null, note: '' },
    ],
  });
  assert.equal((await call(declareOutboundShortage)).statusCode, 400);
});

test('outbound: a fully picked order still reports "no shortage" (existing rule, unchanged)', async () => {
  const { declareOutboundShortage } = loadController({
    outboundItems: [{ id: 'i1', variant_id: 'v1', source_location_id: 'l1', quantity: 3, processed_qty: 3, note: '' }],
  });
  const res = await call(declareOutboundShortage);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /fully picked/);
});

test('transfer: declaring a shortage before shipping/picking anything is rejected', async () => {
  const { declareTransferShortage } = loadController({
    transferItems: [{ id: 't1', variant_id: 'v1', from_location_id: 'l1', to_location_id: 'l2', quantity: 4, shipped_qty: 0, note: '' }],
  });
  const res = await call(declareTransferShortage);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /Chưa lấy cuốn nào/);
});

test.after(() => {
  delete require.cache[require.resolve('@prisma/client')];
});
