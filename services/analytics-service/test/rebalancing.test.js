const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildRebalancingPlan, planTransfers, shortageQty, surplusQty, medianTransferDays,
} = require('../src/utils/rebalancing');
const { accessibleWarehouses, actionCapabilities } = require('../src/utils/warehouse-access');

const HCM = '11111111-1111-4111-8111-111111111111';
const HN = '22222222-2222-4222-8222-222222222222';
const DN = '33333333-3333-4333-8333-333333333333';
const ACTIVE = [{ id: HCM, code: 'WH-HCM-01' }, { id: HN, code: 'WH-HN-01' }, { id: DN, code: 'WH-DN-01' }];
const MANAGER = actionCapabilities({ roles: ['WAREHOUSE_MANAGER'], permissions: ['inventory.operation.decide', 'inventory.purchase.request'] });
const FULL3 = accessibleWarehouses(ACTIVE, { all: false, read: new Set([HCM, HN, DN]), write: new Set([HCM, HN, DN]) });
const DEMO = accessibleWarehouses(ACTIVE, { all: false, read: new Set([HCM, HN, DN]), write: new Set([HCM, DN]) }); // HN READ

// position defaults to available + incoming - outgoing
function line(warehouse, variant, o) {
  const available = o.available ?? 0;
  const incoming = o.incoming ?? 0;
  const outgoing = o.outgoing ?? 0;
  return {
    warehouse_id: warehouse,
    variant_id: variant,
    title: `Sách ${variant}`,
    available_qty: available,
    incoming_qty: incoming,
    outgoing_qty: outgoing,
    expected_returns: 0,
    position: o.position ?? available + incoming - outgoing,
    lead_time_demand: o.demand ?? 0,
    safety_stock: o.safety ?? 0,
    unit_cost: o.cost ?? 100000,
    lambda: o.demand ?? 0,
    priority: o.priority ?? 'MEDIUM',
    lead_time_days: 14,
    data_issue: o.data_issue,
  };
}

test('shortage and surplus are measured against demand + safety stock', () => {
  assert.equal(shortageQty(line(HCM, 'v1', { available: 1, demand: 6, safety: 2 })), 7);
  assert.equal(surplusQty(line(HN, 'v1', { available: 10, demand: 3, safety: 2 })), 5);
  // fractional demand rounds the protected level up for both
  assert.equal(shortageQty(line(HCM, 'v1', { available: 2, demand: 2.2, safety: 0 })), 1);
  assert.equal(surplusQty(line(HN, 'v1', { available: 4, demand: 2.2, safety: 0 })), 1);
  // unreliable data: neither short nor spare
  assert.equal(shortageQty(line(HCM, 'v1', { available: 0, demand: 5, data_issue: 'BORROW_INVENTORY_MISMATCH' })), 0);
});

test('a source keeps its protected level and copies promised to an open transfer', () => {
  // 10 on the shelf, 4 already in an open transfer: position 6, protected 5 -> 1 can move
  assert.equal(surplusQty(line(HN, 'v1', { available: 10, outgoing: 4, demand: 3, safety: 2 })), 1);
  // incoming copies raise the position but cannot be shipped before they arrive
  assert.equal(surplusQty(line(HN, 'v1', { available: 2, incoming: 20, demand: 3, safety: 2 })), 2);
});

test('incoming stock at the destination lowers what it needs', () => {
  assert.equal(shortageQty(line(HCM, 'v1', { available: 1, incoming: 5, demand: 6, safety: 2 })), 2);
});

test('one source never serves more than its surplus across destinations (HIGH first)', () => {
  const lines = [
    line(HN, 'v1', { available: 10, demand: 3, safety: 2 }), // surplus 5
    line(HCM, 'v1', { available: 0, demand: 4, priority: 'MEDIUM' }),
    line(DN, 'v1', { available: 0, demand: 4, priority: 'HIGH' }),
  ];
  const transfers = planTransfers(lines, { accessible: FULL3, capabilities: MANAGER });
  assert.deepEqual(transfers.map((t) => [t.to_warehouse_id, t.quantity]), [[DN, 4], [HCM, 1]]);
  assert.equal(transfers.reduce((s, t) => s + t.quantity, 0), 5);
  assert.equal(transfers[1].source_available_after, 5);
  assert.equal(transfers[1].source_protected_qty, 5);
});

test('several sources fill one destination, never above its shortage', () => {
  const lines = [
    line(HN, 'v1', { available: 6, demand: 1 }), // surplus 5
    line(DN, 'v1', { available: 4, demand: 1 }), // surplus 3
    line(HCM, 'v1', { available: 0, demand: 7 }), // need 7
  ];
  const transfers = planTransfers(lines, { accessible: FULL3, capabilities: MANAGER, destinationIds: new Set([HCM]) });
  assert.deepEqual(transfers.map((t) => [t.from_warehouse_id, t.quantity]), [[HN, 5], [DN, 2]]);
});

test('destination filter: other short warehouses are not served', () => {
  const lines = [
    line(HN, 'v1', { available: 10, demand: 0 }),
    line(HCM, 'v1', { available: 0, demand: 3 }),
    line(DN, 'v1', { available: 0, demand: 3 }),
  ];
  const plan = buildRebalancingPlan(lines, { accessible: FULL3, capabilities: MANAGER, destinationIds: new Set([HCM]) });
  assert.deepEqual(plan.options.HYBRID.transfers.map((t) => t.to_warehouse_id), [HCM]);
  assert.equal(plan.options.HYBRID.total_shortage_qty, 3);
});

test('a READ source is collaborative; HYBRID_EXECUTABLE leaves it out', () => {
  const lines = [
    line(HN, 'v1', { available: 10, demand: 0 }), // READ for the demo manager
    line(HCM, 'v1', { available: 0, demand: 6, cost: 50000 }),
  ];
  const plan = buildRebalancingPlan(lines, { accessible: DEMO, capabilities: MANAGER, destinationIds: new Set([HCM]) });
  assert.equal(plan.options.HYBRID.transfers[0].permission, 'COLLABORATIVE');
  assert.equal(plan.options.HYBRID.transfers[0].permission_reason, 'NO_WRITE_ON_SOURCE');
  assert.ok(plan.options.HYBRID_EXECUTABLE);
  assert.equal(plan.options.HYBRID_EXECUTABLE.transfer_lines, 0);
  assert.equal(plan.options.HYBRID_EXECUTABLE.purchase_qty, 6);
  // business best uses the free HN surplus; the executable best buys
  assert.equal(plan.recommendation.best_business_option, 'TRANSFER_ONLY');
  assert.equal(plan.recommendation.executable_option, 'PROCUREMENT_ONLY');
});

test('a READ destination: its purchases are proposals, the executable plan buys only where it may', () => {
  const lines = [
    line(HCM, 'v1', { available: 0, demand: 3, priority: 'HIGH' }), // WRITE
    line(HN, 'v2', { available: 0, demand: 4, priority: 'HIGH' }), // READ
    line(DN, 'v2', { available: 2, demand: 0 }), // spare 2 for HN, executable (dest needs read only)
  ];
  const plan = buildRebalancingPlan(lines, { accessible: DEMO, capabilities: MANAGER });
  const hn = plan.options.HYBRID.purchases.find((p) => p.warehouse_id === HN);
  assert.deepEqual([hn.quantity, hn.permission], [2, 'PROPOSAL_ONLY']);
  const exec = plan.options.HYBRID_EXECUTABLE;
  assert.deepEqual(exec.transfers.map((t) => [t.from_warehouse_id, t.to_warehouse_id, t.quantity]), [[DN, HN, 2]]);
  assert.deepEqual(exec.purchases.map((p) => [p.warehouse_id, p.quantity]), [[HCM, 3]]);
  assert.equal(exec.remaining_shortage_qty, 2); // HN's last 2 need HN's own manager
  assert.equal(plan.recommendation.best_business_option, 'HYBRID');
  assert.equal(plan.recommendation.executable_option, 'HYBRID_EXECUTABLE');
});

test('budget: never overspent, 0 buys nothing, unpriced lines are reported not bought', () => {
  const lines = [
    line(HCM, 'v1', { available: 0, demand: 5, cost: 100000, priority: 'HIGH' }),
    line(HCM, 'v2', { available: 0, demand: 5, cost: 100000 }),
    line(HCM, 'v3', { available: 0, demand: 2, cost: 0 }),
  ];
  const base = { accessible: FULL3, capabilities: MANAGER, destinationIds: new Set([HCM]) };
  const zero = buildRebalancingPlan(lines, { ...base, budgetVnd: 0 }).options.PROCUREMENT_ONLY;
  assert.equal(zero.purchase_qty, 0);
  assert.equal(zero.remaining_budget_vnd, 0);
  const tight = buildRebalancingPlan(lines, { ...base, budgetVnd: 450000 }).options.PROCUREMENT_ONLY;
  assert.equal(tight.purchase_qty, 4);
  assert.ok(tight.purchase_cost_vnd <= 450000);
  assert.equal(tight.remaining_budget_vnd, 50000);
  const open = buildRebalancingPlan(lines, base).options.PROCUREMENT_ONLY;
  assert.equal(open.purchase_qty, 10);
  assert.equal(open.unpriced_qty, 2);
  assert.ok(open.risks.includes('UNPRICED_LINES'));
  assert.equal(open.remaining_budget_vnd, null);
});

test('options are ranked by rule, hybrid is not assumed best', () => {
  // no surplus anywhere: hybrid equals procurement only -> the simpler one ranks first
  const noSurplus = [line(HCM, 'v1', { available: 0, demand: 4 })];
  const a = buildRebalancingPlan(noSurplus, { accessible: FULL3, capabilities: MANAGER });
  assert.equal(a.recommendation.best_business_option, 'PROCUREMENT_ONLY');
  assert.equal(a.options.TRANSFER_ONLY.remaining_shortage_qty, 4);
  // surplus covers part, no budget limit: same coverage, hybrid buys less
  const partial = [line(HN, 'v1', { available: 3, demand: 0 }), line(HCM, 'v1', { available: 0, demand: 5 })];
  const b = buildRebalancingPlan(partial, { accessible: FULL3, capabilities: MANAGER });
  assert.equal(b.recommendation.best_business_option, 'HYBRID');
  assert.equal(b.options.HYBRID.purchase_qty, 2);
  assert.equal(b.options.PROCUREMENT_ONLY.purchase_qty, 5);
  // tight budget: hybrid covers more than procurement only
  const c = buildRebalancingPlan(partial, { accessible: FULL3, capabilities: MANAGER, budgetVnd: 200000 });
  assert.equal(c.options.HYBRID.remaining_shortage_qty, 0);
  assert.equal(c.options.PROCUREMENT_ONLY.remaining_shortage_qty, 3);
  assert.equal(c.recommendation.best_business_option, 'HYBRID');
  assert.equal(c.recommendation.executable_option, 'HYBRID');
});

test('lead times: unknown transfer time is reported, not assumed', () => {
  const lines = [line(HN, 'v1', { available: 5, demand: 0 }), line(HCM, 'v1', { available: 0, demand: 3 })];
  const unknown = buildRebalancingPlan(lines, { accessible: FULL3, capabilities: MANAGER });
  assert.equal(unknown.options.TRANSFER_ONLY.transfer_lead_time_days, null);
  assert.equal(unknown.options.TRANSFER_ONLY.response_days, null);
  assert.ok(unknown.options.TRANSFER_ONLY.risks.includes('TRANSFER_TIME_UNKNOWN'));
  assert.equal(unknown.options.TRANSFER_ONLY.transfer_cost_vnd, null);
  const known = buildRebalancingPlan(lines, { accessible: FULL3, capabilities: MANAGER, transferLeadTimeDays: 3 });
  assert.equal(known.options.TRANSFER_ONLY.response_days, 3);
  assert.equal(known.options.PROCUREMENT_ONLY.response_days, 14);
  assert.equal(medianTransferDays([1, 2]), null);
  assert.equal(medianTransferDays([4, 1, 3, 2]), 2.5);
});

test('diagnosis counts per readable warehouse', () => {
  const lines = [
    line(HN, 'v1', { available: 10, demand: 3, safety: 2 }),
    line(HCM, 'v1', { available: 1, demand: 6, safety: 2 }),
    line(HCM, 'v2', { available: 3, demand: 3 }),
  ];
  const plan = buildRebalancingPlan(lines, { accessible: DEMO, capabilities: MANAGER });
  const hcm = plan.diagnosis.find((d) => d.warehouse_id === HCM);
  const hn = plan.diagnosis.find((d) => d.warehouse_id === HN);
  assert.deepEqual([hcm.variants_tracked, hcm.shortage_variants, hcm.shortage_qty, hcm.access], [2, 1, 7, 'WRITE']);
  assert.deepEqual([hn.surplus_variants, hn.surplus_qty, hn.access], [1, 5, 'READ']);
  assert.equal(plan.diagnosis.length, 3); // DN listed with zero lines
});

const { applyWhatIf } = require('../src/utils/rebalancing');

test('what-if: only the changed parameter moves the result', () => {
  const lines = [
    line(HN, 'v1', { available: 10, demand: 2 }), // spare 8
    line(DN, 'v1', { available: 6, demand: 1 }), // spare 5
    line(HCM, 'v1', { available: 0, demand: 10, cost: 100000, priority: 'HIGH' }),
    line(HCM, 'v2', { available: 0, demand: 4, cost: 100000, priority: 'LOW' }),
  ];
  const base = { accessible: FULL3, capabilities: MANAGER, destinationIds: new Set([HCM]) };
  const plain = buildRebalancingPlan(lines, base).options.HYBRID;
  assert.equal(plain.total_shortage_qty, 14);
  // demand at the destination +20%: 10 -> 12, 4 -> 4.8 (rounded up to 5)
  const up = buildRebalancingPlan(applyWhatIf(lines, { demandChangePct: 20, demandWarehouseIds: new Set([HCM]) }), base).options.HYBRID;
  assert.equal(up.total_shortage_qty, 17);
  assert.equal(up.transfer_qty, 12); // sources' own demand untouched
  // demand -15% everywhere
  const down = buildRebalancingPlan(applyWhatIf(lines, { demandChangePct: -15 }), base).options.HYBRID;
  assert.equal(down.total_shortage_qty, 9 + 4);
  // a source that cannot send
  const blocked = buildRebalancingPlan(applyWhatIf(lines, { blockedSourceIds: new Set([HN]) }), base).options.HYBRID;
  assert.ok(blocked.transfers.every((t) => t.from_warehouse_id === DN));
  // only HN <-> HCM allowed
  const pair = buildRebalancingPlan(applyWhatIf(lines, { allowedSourceIds: new Set([HN]) }), base).options.HYBRID;
  assert.ok(pair.transfers.every((t) => t.from_warehouse_id === HN));
  // DN stopped: no stock, no need
  const closed = buildRebalancingPlan(applyWhatIf(lines, { closedWarehouseIds: new Set([DN]) }), base);
  assert.ok(closed.options.HYBRID.transfers.every((t) => t.from_warehouse_id !== DN));
  assert.equal(closed.diagnosis.find((d) => d.warehouse_id === DN).variants_tracked, 0);
  // safety stock doubled at the sources lowers what they can give
  const safer = buildRebalancingPlan(applyWhatIf(
    lines.map((l) => ({ ...l, safety_stock: l.warehouse_id === HCM ? 0 : 2 })), { safetyStockMultiplier: 2 }), base).options.HYBRID;
  assert.equal(safer.transfer_qty, (10 - 2 - 4) + (6 - 1 - 4));
  // HIGH only: the LOW line is no longer served
  const high = buildRebalancingPlan(lines, { ...base, priorities: new Set(['HIGH']) }).options.HYBRID;
  assert.equal(high.total_shortage_qty, 10);
});
