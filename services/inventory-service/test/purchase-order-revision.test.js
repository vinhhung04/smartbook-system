const test = require('node:test');
const assert = require('node:assert/strict');

const {
  RevisionError,
  buildRevisionProposal,
  assertNoActivePendingRevision,
  nextRevisionNumber,
  applyRevision,
} = require('../src/services/purchase-order-revision.service');
const { createFakeDb } = require('./helpers/procurement-fake-db');

const PO = {
  id: 'po-1',
  status: 'SENT_TO_SUPPLIER',
  expected_date: new Date('2026-01-01T00:00:00.000Z'),
  note: 'original note',
  purchase_order_items: [
    { id: 'poi-1', variant_id: 'v1', ordered_qty: 100, unit_cost: 50000, received_qty: 20 },
    { id: 'poi-2', variant_id: 'v2', ordered_qty: 20, unit_cost: 80000, received_qty: 0 },
  ],
};

test('rejects a revision when the PO status is not revisable', () => {
  assert.throws(() => buildRevisionProposal(
    { ...PO, status: 'DRAFT' },
    { reason: 'x', lines: [{ purchase_order_item_id: 'poi-1', ordered_qty: 90 }] },
  ), RevisionError);
});

test('requires a reason', () => {
  assert.throws(() => buildRevisionProposal(PO, { lines: [{ purchase_order_item_id: 'poi-1', ordered_qty: 90 }] }), RevisionError);
});

test('rejects reducing ordered_qty below what has already been received', () => {
  assert.throws(() => buildRevisionProposal(PO, { reason: 'x', lines: [{ purchase_order_item_id: 'poi-1', ordered_qty: 10 }] }), RevisionError);
});

test('builds before/after snapshots for a quantity change, defaulting requires_supplier_reconfirmation to true', () => {
  const proposal = buildRevisionProposal(PO, {
    reason: 'Giảm số lượng theo thỏa thuận với nhà cung cấp',
    lines: [{ purchase_order_item_id: 'poi-1', ordered_qty: 80 }],
  });
  assert.equal(proposal.requires_supplier_reconfirmation, true);
  assert.equal(proposal.before_snapshot.lines.find((l) => l.purchase_order_item_id === 'poi-1').ordered_qty, 100, 'before snapshot keeps the original value');
  assert.equal(proposal.after_snapshot.lines.find((l) => l.purchase_order_item_id === 'poi-1').ordered_qty, 80);
  const untouched = proposal.after_snapshot.lines.find((l) => l.purchase_order_item_id === 'poi-2');
  assert.equal(untouched.ordered_qty, 20, 'line not mentioned in the request is carried through unchanged');
});

test('allows a header-only change with no line edits', () => {
  const proposal = buildRevisionProposal(PO, { reason: 'Dời ngày giao', expected_date: '2026-02-01' });
  assert.equal(proposal.after_snapshot.header.expected_date, new Date('2026-02-01').toISOString());
  assert.equal(proposal.after_snapshot.lines.length, 2);
});

test('rejects a no-op revision (proposed values equal current values)', () => {
  assert.throws(() => buildRevisionProposal(PO, { reason: 'x', lines: [{ purchase_order_item_id: 'poi-1', ordered_qty: 100 }] }), RevisionError);
});

test('rejects a line that does not belong to the PO, and a duplicated line', () => {
  assert.throws(() => buildRevisionProposal(PO, { reason: 'x', lines: [{ purchase_order_item_id: 'other-po-line', ordered_qty: 5 }] }), RevisionError);
  assert.throws(() => buildRevisionProposal(PO, {
    reason: 'x',
    lines: [
      { purchase_order_item_id: 'poi-1', ordered_qty: 80 },
      { purchase_order_item_id: 'poi-1', ordered_qty: 70 },
    ],
  }), RevisionError);
});

test('respects an explicit requires_supplier_reconfirmation: false from the requester', () => {
  const proposal = buildRevisionProposal(PO, {
    reason: 'x',
    requires_supplier_reconfirmation: false,
    lines: [{ purchase_order_item_id: 'poi-1', ordered_qty: 80 }],
  });
  assert.equal(proposal.requires_supplier_reconfirmation, false);
});

test('assertNoActivePendingRevision blocks a new request while one is already pending for that PO', async () => {
  const { client } = createFakeDb({
    purchase_order_revisions: [{ id: 'r1', purchase_order_id: 'po-1', status: 'PENDING_APPROVAL' }],
  });
  await assert.rejects(() => assertNoActivePendingRevision(client, 'po-1'), RevisionError);
  await assertNoActivePendingRevision(client, 'po-2'); // different PO: unaffected
});

test('nextRevisionNumber increments from the highest existing revision, per PO', async () => {
  const { client } = createFakeDb({
    purchase_order_revisions: [
      { id: 'r1', purchase_order_id: 'po-1', revision_number: 1, status: 'EFFECTIVE' },
      { id: 'r2', purchase_order_id: 'po-1', revision_number: 2, status: 'REJECTED' },
    ],
  });
  assert.equal(await nextRevisionNumber(client, 'po-1'), 3);
  assert.equal(await nextRevisionNumber(client, 'po-2'), 1);
});

// applyRevision touches purchase_order_items/purchase_orders/supplier_delivery_invoice_items with
// a raw FOR UPDATE lock query the shared fake-db doesn't model, so it gets a tiny bespoke stub.
function createApplyStub({ items, invoiceItemsByPoItemId = {} }) {
  const updates = { items: [], po: null };
  const stub = {
    async $queryRawUnsafe() { return []; },
    purchase_order_items: {
      async findMany({ where }) {
        const ids = (where.id.in || []).map(String);
        return items.filter((item) => ids.includes(String(item.id)));
      },
      async update({ where, data }) {
        const item = items.find((i) => String(i.id) === String(where.id));
        Object.assign(item, data);
        updates.items.push({ id: where.id, data });
        return item;
      },
    },
    purchase_orders: {
      async update({ where, data }) {
        updates.po = { id: where.id, data };
        return { id: where.id, ...data };
      },
    },
    supplier_delivery_invoice_items: {
      async findMany({ where }) {
        return invoiceItemsByPoItemId[String(where.purchase_order_item_id)] || [];
      },
    },
  };
  return { stub, updates };
}

test('applyRevision writes ordered_qty, unit_cost and header fields when nothing else has moved', async () => {
  const items = [{ id: 'poi-1', ordered_qty: 100, received_qty: 20 }];
  const { stub, updates } = createApplyStub({ items });
  const revision = {
    purchase_order_id: 'po-1',
    after_snapshot: {
      header: { expected_date: null, note: 'updated note' },
      lines: [{ purchase_order_item_id: 'poi-1', ordered_qty: 80, unit_cost: 55000 }],
    },
  };
  await applyRevision(stub, revision);
  assert.equal(items[0].ordered_qty, 80);
  assert.equal(items[0].unit_cost, 55000);
  assert.equal(updates.po.data.note, 'updated note');
});

test('applyRevision refuses to apply once received_qty grew past the proposed ordered_qty while the revision was pending', async () => {
  // Simulates a GRN posting 85 units while this revision (proposing 80) was awaiting approval.
  const items = [{ id: 'poi-1', ordered_qty: 100, received_qty: 85 }];
  const { stub } = createApplyStub({ items });
  const revision = {
    purchase_order_id: 'po-1',
    after_snapshot: { header: {}, lines: [{ purchase_order_item_id: 'poi-1', ordered_qty: 80, unit_cost: 50000 }] },
  };
  await assert.rejects(() => applyRevision(stub, revision), RevisionError);
  assert.equal(items[0].ordered_qty, 100, 'left untouched after the guard rejects the apply');
});

test('applyRevision refuses to drop ordered_qty below already-invoiced (non-redelivery) qty', async () => {
  const items = [{ id: 'poi-1', ordered_qty: 100, received_qty: 0 }];
  const { stub } = createApplyStub({
    items,
    invoiceItemsByPoItemId: { 'poi-1': [{ invoiced_qty: 90, supplier_delivery_invoices: { raw_payload: {} } }] },
  });
  const revision = {
    purchase_order_id: 'po-1',
    after_snapshot: { header: {}, lines: [{ purchase_order_item_id: 'poi-1', ordered_qty: 80, unit_cost: 50000 }] },
  };
  await assert.rejects(() => applyRevision(stub, revision), RevisionError);
});

test('applyRevision excludes redelivery invoice lines from the already-invoiced sum', async () => {
  const items = [{ id: 'poi-1', ordered_qty: 100, received_qty: 0 }];
  const { stub } = createApplyStub({
    items,
    invoiceItemsByPoItemId: { 'poi-1': [{ invoiced_qty: 90, supplier_delivery_invoices: { raw_payload: { redelivery: true } } }] },
  });
  const revision = {
    purchase_order_id: 'po-1',
    after_snapshot: { header: {}, lines: [{ purchase_order_item_id: 'poi-1', ordered_qty: 80, unit_cost: 50000 }] },
  };
  await applyRevision(stub, revision);
  assert.equal(items[0].ordered_qty, 80);
});
