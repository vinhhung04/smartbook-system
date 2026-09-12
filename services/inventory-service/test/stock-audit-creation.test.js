const test = require('node:test');
const assert = require('node:assert/strict');
const { buildStockBalanceFilter, createAuditWithLines } = require('../src/services/stock-audit-creation.service');

test('scopes the stock_balances lookup to the given locations (warehouse floor map: "audit just this bin")', () => {
  const filter = buildStockBalanceFilter('wh-1', ['loc-bin-1']);
  assert.deepEqual(filter, { warehouse_id: 'wh-1', location_id: { in: ['loc-bin-1'] } });
});

test('falls back to the whole warehouse when no locations are given (Stock Audits page: "audit everything")', () => {
  const filter = buildStockBalanceFilter('wh-1', []);
  assert.deepEqual(filter, { warehouse_id: 'wh-1' });
});

test('creates one audit line per stock_balances row, carrying variant/location/expected_qty through', async () => {
  const calls = { auditCreate: null, lineCreateMany: null };
  const tx = {
    stock_audits: {
      create: async (args) => {
        calls.auditCreate = args;
        return { id: 'audit-1', audit_number: args.data.audit_number };
      },
    },
    stock_audit_lines: {
      createMany: async (args) => {
        calls.lineCreateMany = args;
        return { count: args.data.length };
      },
    },
  };

  const balances = [
    { variant_id: 'v1', location_id: 'loc-bin-1', on_hand_qty: 18 },
    { variant_id: 'v2', location_id: 'loc-bin-1', on_hand_qty: 15 },
  ];

  const result = await createAuditWithLines(tx, {
    auditNumber: 'AUD-TEST-1',
    warehouseId: 'wh-1',
    note: 'Từ sơ đồ kho — A / 01 / 001',
    userId: 'user-1',
    balances,
  });

  assert.equal(result.id, 'audit-1');
  assert.equal(calls.auditCreate.data.warehouse_id, 'wh-1');
  assert.equal(calls.auditCreate.data.status, 'DRAFT');
  assert.equal(calls.auditCreate.data.created_by_user_id, 'user-1');
  assert.deepEqual(calls.lineCreateMany.data, [
    { stock_audit_id: 'audit-1', variant_id: 'v1', location_id: 'loc-bin-1', expected_qty: 18 },
    { stock_audit_id: 'audit-1', variant_id: 'v2', location_id: 'loc-bin-1', expected_qty: 15 },
  ]);
});
