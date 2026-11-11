// Unit tests for the decision center's presentation rules (src/lib/reorder-intelligence.ts).
// Run: pnpm --filter web test:unit (transpiled with Vite's esbuild, as in book-ocr.test.mjs).
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { transformWithEsbuild } from 'vite';

const source = await readFile(new URL('../src/lib/reorder-intelligence.ts', import.meta.url), 'utf8');
const { code } = await transformWithEsbuild(source, 'reorder-intelligence.ts', { loader: 'ts', format: 'esm' });
const ri = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

const item = (overrides = {}) => ({
  variant_id: 'v', title: 'Sách', available_qty: 5, estimated_days_until_stockout: null, demand_score: 1,
  suggested_reorder_qty: 4, unit_cost: 100000, ...overrides,
});

test('urgency keeps the original rules: out of stock, stockout within lead time, later', () => {
  assert.equal(ri.urgencyOf(item({ available_qty: 0, estimated_days_until_stockout: 3 }), 14), 'OUT');
  assert.equal(ri.urgencyOf(item({ estimated_days_until_stockout: 14 }), 14), 'BEFORE_RESTOCK');
  assert.equal(ri.urgencyOf(item({ estimated_days_until_stockout: 14.1 }), 14), 'LATER');
  assert.equal(ri.urgencyOf(item({ estimated_days_until_stockout: null }), 14), 'LATER');
});

test('urgency compares the stockout with each book\'s own lead time, falling back to the default', () => {
  // learned lead time of 1 day: stockout in 5 days is not before restock
  assert.equal(ri.urgencyOf(item({ estimated_days_until_stockout: 5, lead_time_days: 1 }), 14), 'LATER');
  // supplier needs 21 days: stockout in 18 days is before restock even though the default is 14
  assert.equal(ri.urgencyOf(item({ estimated_days_until_stockout: 18, lead_time_days: 21 }), 14), 'BEFORE_RESTOCK');
  assert.equal(ri.urgencyOf(item({ estimated_days_until_stockout: 5 }), 14), 'BEFORE_RESTOCK');
  assert.equal(ri.leadTimeOf(item({ lead_time_days: 3 }), 14), 3);
  assert.equal(ri.leadTimeOf(item(), 14), 14);
  // out of stock stays OUT whatever the lead time
  assert.equal(ri.urgencyOf(item({ available_qty: 0, lead_time_days: 1 }), 14), 'OUT');
});

test('sortByUrgency orders by urgency, then soonest stockout, then demand, without mutating input', () => {
  const list = [
    item({ variant_id: 'later', estimated_days_until_stockout: 40 }),
    item({ variant_id: 'soon-weak', estimated_days_until_stockout: 5, demand_score: 1 }),
    item({ variant_id: 'out', available_qty: 0 }),
    item({ variant_id: 'soon-strong', estimated_days_until_stockout: 5, demand_score: 9 }),
  ];
  assert.deepEqual(ri.sortByUrgency(list, 14).map((i) => i.variant_id), ['out', 'soon-strong', 'soon-weak', 'later']);
  assert.equal(list[0].variant_id, 'later');
  assert.deepEqual(ri.countByUrgency(list, 14), { OUT: 1, BEFORE_RESTOCK: 2, LATER: 1 });
});

test('funding status reads the re-sized cap, not the plain suggestion', () => {
  assert.equal(ri.fundingStatus(item(), false), null);
  // cap 0: the plan needs nothing - not "over budget"
  assert.equal(ri.fundingStatus(item({ funded_qty: 0, budget_plan: { cap_qty: 0 } }), true), 'NOT_NEEDED');
  assert.equal(ri.fundingStatus(item({ funded_qty: 0, budget_plan: { cap_qty: 3 } }), true), 'UNFUNDED');
  assert.equal(ri.fundingStatus(item({ funded_qty: 2, budget_plan: { cap_qty: 3 } }), true), 'PARTIAL');
  // funded equals a cap that is below the plain suggestion: fully funded
  assert.equal(ri.fundingStatus(item({ suggested_reorder_qty: 6, funded_qty: 3, budget_plan: { cap_qty: 3 } }), true), 'FULL');
});

test('system quantity is the funded quantity under a budget, else the suggestion', () => {
  assert.equal(ri.systemQty(item({ funded_qty: 2 }), true), 2);
  assert.equal(ri.systemQty(item({ funded_qty: 0 }), true), 4);
  assert.equal(ri.systemQty(item({ funded_qty: 2 }), false), 4);
});

test('parseQty accepts whole copies from 1 only', () => {
  assert.equal(ri.parseQty('12'), 12);
  assert.equal(ri.parseQty(' 3 '), 3);
  for (const bad of ['', '0', '-2', '1.5', '1e3', 'abc', '100000']) assert.equal(ri.parseQty(bad), null, bad);
});

test('a missing unit cost is never counted as free', () => {
  assert.equal(ri.lineCost(3, 0), null);
  assert.equal(ri.lineCost(null, 1000), null);
  assert.deepEqual(
    ri.totalLines([{ qty: 2, unitCost: 1000 }, { qty: 5, unitCost: 0 }, { qty: null, unitCost: 1000 }, { qty: 0, unitCost: 1000 }]),
    { lines: 4, qty: 7, cost: 2000, missingCost: 1, invalidQty: 2 },
  );
});

test('plan lines separate the system quantity from a manual override', () => {
  const funded = item({ funded_qty: 2, budget_plan: { cap_qty: 4 } });
  const keep = ri.buildPlanLine(funded, 14, true, undefined);
  assert.equal(keep.qty, 2);
  assert.equal(keep.manual, false);
  assert.equal(keep.funding, 'PARTIAL');
  assert.equal(keep.cost, 200000);
  assert.equal(keep.leadDays, 14);
  assert.equal(ri.buildPlanLine(item({ lead_time_days: 2 }), 14, false, undefined).leadDays, 2);

  const raised = ri.buildPlanLine(funded, 14, true, '5');
  assert.equal(raised.qty, 5);
  assert.equal(raised.manual, true);
  assert.equal(raised.overFunded, 3);

  // typing the system quantity back is not an override
  assert.equal(ri.buildPlanLine(funded, 14, true, '2').manual, false);
  // invalid text leaves no order quantity
  assert.equal(ri.buildPlanLine(funded, 14, true, '0').qty, null);
  // nothing suggested: no quantity until the user enters one
  const none = ri.buildPlanLine(item({ suggested_reorder_qty: 0 }), 14, false, undefined);
  assert.equal(none.qty, null);
  assert.equal(none.manual, false);
  assert.equal(none.overFunded, 0);
  // missing unit cost stays unknown
  assert.equal(ri.buildPlanLine(item({ unit_cost: 0 }), 14, false, undefined).cost, null);
});

test('risk band cut-offs mirror the service: threshold and half of it', () => {
  assert.deepEqual(ri.riskBandCutoffs({ best_threshold: { threshold: 0.4 } }), { high: 0.4, medium: 0.2 });
  assert.deepEqual(ri.riskBandCutoffs(undefined), { high: 0.5, medium: 0.25 });
});

test('factor weights are relative to the strongest factor in the row', () => {
  const weights = ri.factorWeights([
    { feature: 'a', contribution: -0.8, direction: 'decreases_risk' },
    { feature: 'b', contribution: 0.4, direction: 'increases_risk' },
  ]).map((f) => f.weight);
  assert.deepEqual(weights, [1, 0.5]);
  assert.deepEqual(ri.factorWeights([{ feature: 'a', contribution: 0, direction: 'increases_risk' }]).map((f) => f.weight), [0]);
});

test('insufficient-data reasons get a Vietnamese reading, unknown ones none', () => {
  assert.match(ri.describeInsufficientReason('need at least 200 labelled samples, have 37'), /200.*37/);
  assert.match(ri.describeInsufficientReason('need at least 20 positive examples and at least one negative, have 4/310'), /20.*4\/310/);
  assert.equal(ri.describeInsufficientReason('something else'), null);
  assert.equal(ri.describeInsufficientReason(undefined), null);
});
