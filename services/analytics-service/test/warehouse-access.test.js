const test = require('node:test');
const assert = require('node:assert/strict');
const {
  accessibleWarehouses,
  actionCapabilities,
  checkRequestedWarehouses,
  transferPermission,
  purchasePermission,
} = require('../src/utils/warehouse-access');

const HCM = '11111111-1111-4111-8111-111111111111';
const HN = '22222222-2222-4222-8222-222222222222';
const DN = '33333333-3333-4333-8333-333333333333';
const CT = '44444444-4444-4444-8444-444444444444'; // exists, outside every test scope
const OLD = '55555555-5555-4555-8555-555555555555'; // inactive

const ACTIVE = [
  { id: HCM, code: 'WH-HCM-01', name: 'Kho HCM' },
  { id: HN, code: 'WH-HN-01', name: 'Kho Ha Noi' },
  { id: DN, code: 'WH-DN-01', name: 'Kho Da Nang' },
  { id: CT, code: 'WH-CT-01', name: 'Kho Can Tho' },
];
const ALL_IDS = new Set([HCM, HN, DN, CT, OLD]);

function scope(read = [], write = []) {
  return { all: false, read: new Set([...read, ...write]), write: new Set(write) };
}
const ALL = { all: true, read: null, write: null };
const MANAGER = { roles: ['MANAGER'], permissions: ['inventory.operation.decide', 'inventory.purchase.request'] };

test('single-warehouse manager sees only that warehouse', () => {
  const list = accessibleWarehouses(ACTIVE, scope([], [HCM]));
  assert.deepEqual(list.map((w) => [w.code, w.access]), [['WH-HCM-01', 'WRITE']]);
});

test('FULL + READ + FULL: reads three, writes two, never the fourth', () => {
  const list = accessibleWarehouses(ACTIVE, scope([HN], [HCM, DN]));
  assert.deepEqual(list.map((w) => [w.code, w.access]), [['WH-HCM-01', 'WRITE'], ['WH-HN-01', 'READ'], ['WH-DN-01', 'WRITE']]);
});

test('no scope rows -> nothing; inactive warehouse in scope is left out; superuser reads every active one', () => {
  assert.deepEqual(accessibleWarehouses(ACTIVE, scope()), []);
  assert.deepEqual(accessibleWarehouses(ACTIVE, scope([], [OLD])), []);
  assert.equal(accessibleWarehouses(ACTIVE, ALL).length, 4);
  assert.ok(accessibleWarehouses(ACTIVE, ALL).every((w) => w.access === 'WRITE'));
});

test('requested ids: forged / unknown / out of scope -> 403, inactive in scope -> 409, malformed -> 400', () => {
  const s = scope([HN], [HCM, OLD]);
  const acc = accessibleWarehouses(ACTIVE, s);
  assert.doesNotThrow(() => checkRequestedWarehouses([HCM, HN], acc, s));
  assert.throws(() => checkRequestedWarehouses([CT], acc, s), { statusCode: 403 });
  assert.throws(() => checkRequestedWarehouses(['66666666-6666-4666-8666-666666666666'], acc, s), { statusCode: 403 });
  assert.throws(() => checkRequestedWarehouses([OLD], acc, s), { statusCode: 409 });
  assert.throws(() => checkRequestedWarehouses(["x' OR 1=1"], acc, s), { statusCode: 400 });
  // superuser: an inactive id is 409, an unknown one 403
  const accAll = accessibleWarehouses(ACTIVE, ALL);
  assert.throws(() => checkRequestedWarehouses([OLD], accAll, ALL, ALL_IDS), { statusCode: 409 });
  assert.throws(() => checkRequestedWarehouses(['66666666-6666-4666-8666-666666666666'], accAll, ALL, ALL_IDS), { statusCode: 403 });
});

test('transfer from a READ warehouse is collaborative, from a WRITE one executable', () => {
  const acc = accessibleWarehouses(ACTIVE, scope([HN], [HCM, DN]));
  const caps = actionCapabilities(MANAGER);
  assert.deepEqual(transferPermission(DN, HCM, acc, caps), { status: 'EXECUTABLE', reason: null });
  assert.deepEqual(transferPermission(HN, HCM, acc, caps), { status: 'COLLABORATIVE', reason: 'NO_WRITE_ON_SOURCE' });
  // destination only needs read (inventory checks the same)
  assert.deepEqual(transferPermission(HCM, HN, acc, caps), { status: 'EXECUTABLE', reason: null });
  // an end outside the scope is never proposed
  assert.equal(transferPermission(CT, HCM, acc, caps), null);
  assert.equal(transferPermission(HCM, CT, acc, caps), null);
  assert.equal(transferPermission(HCM, HCM, acc, caps), null);
});

test('write scope without the permission is still not executable', () => {
  const acc = accessibleWarehouses(ACTIVE, scope([], [HCM, DN]));
  const staff = actionCapabilities({ roles: ['WAREHOUSE_STAFF'], permissions: ['inventory.operation.decide'] });
  assert.deepEqual(transferPermission(DN, HCM, acc, staff), { status: 'COLLABORATIVE', reason: 'NO_TRANSFER_PERMISSION' });
  assert.deepEqual(purchasePermission(HCM, acc, staff), { status: 'PROPOSAL_ONLY', reason: 'NO_PURCHASE_PERMISSION' });
});

test('purchase request: WRITE + permission executable, READ proposal only, unreadable null', () => {
  const acc = accessibleWarehouses(ACTIVE, scope([HN], [HCM]));
  const caps = actionCapabilities(MANAGER);
  assert.deepEqual(purchasePermission(HCM, acc, caps), { status: 'EXECUTABLE', reason: null });
  assert.deepEqual(purchasePermission(HN, acc, caps), { status: 'PROPOSAL_ONLY', reason: 'NO_WRITE_ON_WAREHOUSE' });
  assert.equal(purchasePermission(CT, acc, caps), null);
});

test('superuser capabilities are complete', () => {
  assert.deepEqual(actionCapabilities({ is_superuser: true }), { can_create_transfer: true, can_request_purchase: true });
  assert.deepEqual(actionCapabilities({ is_superuser: 'true' }), { can_create_transfer: false, can_request_purchase: false });
});
