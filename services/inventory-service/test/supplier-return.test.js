const test = require('node:test');
const assert = require('node:assert/strict');

const {
  SupplierReturnError,
  assertReturnQtyWithinAccepted,
  buildReturnRequestHeader,
  validateReturnLine,
  nextStatusAfterApproval,
  buildCompletion,
  executeReturnStock,
} = require('../src/services/supplier-return.service');

const POSTED_GRN = { id: 'grn-1', purchase_order_id: 'po-1', status: 'POSTED' };
const GRN_ITEM = { id: 'gri-1', variant_id: 'v1', quantity: 10, unit_cost: 50000, location_id: 'loc-1' };

// ── buildReturnRequestHeader ─────────────────────────────────────────────────

test('rejects a return request against a GRN not linked to any PO', () => {
  assert.throws(() => buildReturnRequestHeader({ ...POSTED_GRN, purchase_order_id: null }, {
    reason: 'x', lines: [{ goods_receipt_item_id: 'gri-1', return_qty: 1 }],
  }), SupplierReturnError);
});

test('rejects a return request against a GRN that is not POSTED', () => {
  assert.throws(() => buildReturnRequestHeader({ ...POSTED_GRN, status: 'DRAFT' }, {
    reason: 'x', lines: [{ goods_receipt_item_id: 'gri-1', return_qty: 1 }],
  }), SupplierReturnError);
});

test('requires a reason', () => {
  assert.throws(() => buildReturnRequestHeader(POSTED_GRN, { lines: [{ goods_receipt_item_id: 'gri-1', return_qty: 1 }] }), SupplierReturnError);
});

test('requires at least one line', () => {
  assert.throws(() => buildReturnRequestHeader(POSTED_GRN, { reason: 'x', lines: [] }), SupplierReturnError);
});

test('defaults requires_supplier_confirmation to true and captures an optional evidence reference', () => {
  const header = buildReturnRequestHeader(POSTED_GRN, {
    reason: 'Hàng hỏng khi kiểm tra',
    evidence_reference: 'PHOTO-001',
    lines: [{ goods_receipt_item_id: 'gri-1', return_qty: 2 }],
  });
  assert.equal(header.requiresSupplierConfirmation, true);
  assert.equal(header.evidenceReference, 'PHOTO-001');
});

test('requires_supplier_confirmation can be explicitly turned off', () => {
  const header = buildReturnRequestHeader(POSTED_GRN, {
    reason: 'x', requires_supplier_confirmation: false,
    lines: [{ goods_receipt_item_id: 'gri-1', return_qty: 2 }],
  });
  assert.equal(header.requiresSupplierConfirmation, false);
});

// ── validateReturnLine ───────────────────────────────────────────────────────

test('rejects a line whose goods_receipt_item_id is not on this GRN', () => {
  const itemsById = new Map([['gri-1', GRN_ITEM]]);
  assert.throws(() => validateReturnLine({ goods_receipt_item_id: 'gri-other', return_qty: 1 }, itemsById, new Set()), SupplierReturnError);
});

test('rejects a non-positive or non-integer return_qty', () => {
  const itemsById = new Map([['gri-1', GRN_ITEM]]);
  assert.throws(() => validateReturnLine({ goods_receipt_item_id: 'gri-1', return_qty: 0 }, itemsById, new Set()), SupplierReturnError);
  assert.throws(() => validateReturnLine({ goods_receipt_item_id: 'gri-1', return_qty: 1.5 }, itemsById, new Set()), SupplierReturnError);
});

test('rejects the same GRN line appearing twice in one request', () => {
  const itemsById = new Map([['gri-1', GRN_ITEM]]);
  const seen = new Set();
  validateReturnLine({ goods_receipt_item_id: 'gri-1', return_qty: 1 }, itemsById, seen);
  assert.throws(() => validateReturnLine({ goods_receipt_item_id: 'gri-1', return_qty: 1 }, itemsById, seen), SupplierReturnError);
});

// ── nextStatusAfterApproval / buildCompletion ───────────────────────────────

test('approval routes to PENDING_SUPPLIER_CONFIRMATION or straight to APPROVED', () => {
  assert.equal(nextStatusAfterApproval(true), 'PENDING_SUPPLIER_CONFIRMATION');
  assert.equal(nextStatusAfterApproval(false), 'APPROVED');
});

test('buildCompletion only accepts the four documented outcomes plus OTHER', () => {
  assert.throws(() => buildCompletion({ resolution_outcome: 'MADE_UP' }), SupplierReturnError);
  for (const outcome of ['REFUND', 'REDELIVERY', 'EXCHANGE', 'CREDIT_NOTE', 'OTHER']) {
    const result = buildCompletion({ resolution_outcome: outcome, resolution_note: 'x' });
    assert.equal(result.outcome, outcome);
  }
});

// ── assertReturnQtyWithinAccepted: double-count guard ───────────────────────
// Needs $queryRawUnsafe (raw FOR UPDATE), which the shared fake-db doesn't model, so a small
// bespoke stub stands in, same approach as purchase-order-revision.test.js's applyRevision tests.

function createReturnGuardStub(existingReturnItems) {
  return {
    async $queryRawUnsafe() { return []; },
    supplier_return_items: {
      async findMany() { return existingReturnItems; },
    },
  };
}

test('assertReturnQtyWithinAccepted allows a request that fits under the accepted quantity', async () => {
  const stub = createReturnGuardStub([]);
  const overBy = await assertReturnQtyWithinAccepted(stub, GRN_ITEM, 4);
  assert.equal(overBy, null);
});

test('assertReturnQtyWithinAccepted sums only still-active prior returns against the same line', async () => {
  const stub = createReturnGuardStub([
    { return_qty: 6, supplier_returns: { status: 'APPROVED' } },
    { return_qty: 3, supplier_returns: { status: 'REJECTED' } }, // terminal-negative: excluded
  ]);
  // accepted=10, active-already-returned=6 -> remaining=4; requesting 5 does not fit
  const overBy = await assertReturnQtyWithinAccepted(stub, GRN_ITEM, 5);
  assert.equal(overBy, 4);
  // requesting exactly the remaining 4 fits
  assert.equal(await assertReturnQtyWithinAccepted(stub, GRN_ITEM, 4), null);
});

test('assertReturnQtyWithinAccepted never lets two active requests double-count past the accepted qty', async () => {
  const stub = createReturnGuardStub([{ return_qty: 10, supplier_returns: { status: 'PENDING_APPROVAL' } }]);
  const overBy = await assertReturnQtyWithinAccepted(stub, GRN_ITEM, 1);
  assert.equal(overBy, 0, 'nothing left to return once an active request already claims all 10');
});

// ── executeReturnStock: the warehouse-execution guard ───────────────────────

function createExecuteStub({ balance }) {
  const updates = { balance: null, movements: [] };
  const stub = {
    async $queryRawUnsafe() { return []; },
    stock_balances: {
      async findFirst() { return balance; },
      async update({ where, data }) {
        Object.assign(balance, {
          on_hand_qty: balance.on_hand_qty - (data.on_hand_qty?.decrement || 0),
          available_qty: balance.available_qty - (data.available_qty?.decrement || 0),
          version: balance.version + (data.version?.increment || 0),
        });
        updates.balance = balance;
        return balance;
      },
    },
    stock_movements: {
      async create({ data }) {
        updates.movements.push(data);
        return data;
      },
    },
  };
  return { stub, updates };
}

test('executeReturnStock decrements on_hand_qty and available_qty and writes one OUTBOUND movement per line', async () => {
  const balance = { id: 'bal-1', on_hand_qty: 10, available_qty: 10, version: 1 };
  const { stub, updates } = createExecuteStub({ balance });
  const items = [{ id: 'sri-1', goods_receipt_item_id: 'gri-1', variant_id: 'v1', return_qty: 4, unit_cost: 50000, goods_receipt_items: { location_id: 'loc-1' } }];
  await executeReturnStock(stub, { id: 'ret-1', warehouse_id: 'wh-1' }, items, 'user-1');
  assert.equal(updates.balance.on_hand_qty, 6);
  assert.equal(updates.balance.available_qty, 6);
  assert.equal(updates.movements.length, 1);
  assert.equal(updates.movements[0].movement_type, 'OUTBOUND');
  assert.equal(updates.movements[0].reference_type, 'SUPPLIER_RETURN');
  assert.equal(updates.movements[0].quantity, 4);
});

test('executeReturnStock refuses to push available_qty or on_hand_qty negative', async () => {
  const balance = { id: 'bal-1', on_hand_qty: 3, available_qty: 3, version: 1 };
  const { stub } = createExecuteStub({ balance });
  const items = [{ id: 'sri-1', goods_receipt_item_id: 'gri-1', variant_id: 'v1', return_qty: 4, unit_cost: 50000, goods_receipt_items: { location_id: 'loc-1' } }];
  await assert.rejects(() => executeReturnStock(stub, { id: 'ret-1', warehouse_id: 'wh-1' }, items, 'user-1'), SupplierReturnError);
});

test('executeReturnStock refuses to return stock reserved/borrowed for an active loan (available_qty excludes it)', async () => {
  // on_hand_qty=10 but 7 of it is reserved/borrowed elsewhere, so available_qty is only 3.
  const balance = { id: 'bal-1', on_hand_qty: 10, available_qty: 3, version: 1 };
  const { stub } = createExecuteStub({ balance });
  const items = [{ id: 'sri-1', goods_receipt_item_id: 'gri-1', variant_id: 'v1', return_qty: 4, unit_cost: 50000, goods_receipt_items: { location_id: 'loc-1' } }];
  await assert.rejects(() => executeReturnStock(stub, { id: 'ret-1', warehouse_id: 'wh-1' }, items, 'user-1'), SupplierReturnError);
});

test('executeReturnStock refuses a line whose GRN item has no putaway location', async () => {
  const balance = { id: 'bal-1', on_hand_qty: 10, available_qty: 10, version: 1 };
  const { stub } = createExecuteStub({ balance });
  const items = [{ id: 'sri-1', goods_receipt_item_id: 'gri-1', variant_id: 'v1', return_qty: 1, unit_cost: 50000, goods_receipt_items: { location_id: null } }];
  await assert.rejects(() => executeReturnStock(stub, { id: 'ret-1', warehouse_id: 'wh-1' }, items, 'user-1'), SupplierReturnError);
});
