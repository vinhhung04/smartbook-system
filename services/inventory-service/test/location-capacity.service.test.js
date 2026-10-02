const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MAX_COMPARTMENT_CAPACITY,
  computeEffectiveCapacity,
  getLocationCapacityContext,
  getLocationCapacityContextBatch,
  getEligibleLocationTypes,
  isLocationEligibleForMode,
} = require('../src/services/location-capacity.service');

function fakeStockBalancesClient(rowsByLocation) {
  return {
    stock_balances: {
      groupBy: async ({ where }) => {
        const ids = where.location_id.in;
        return ids
          .filter((id) => rowsByLocation.has(id))
          .map((id) => ({
            location_id: id,
            _sum: { on_hand_qty: rowsByLocation.get(id).reduce((sum, qty) => sum + qty, 0) },
          }));
      },
    },
  };
}

test('computeEffectiveCapacity falls back to MAX_COMPARTMENT_CAPACITY when unconfigured', () => {
  assert.equal(computeEffectiveCapacity(null), MAX_COMPARTMENT_CAPACITY);
  assert.equal(computeEffectiveCapacity(0), MAX_COMPARTMENT_CAPACITY);
  assert.equal(computeEffectiveCapacity(undefined), MAX_COMPARTMENT_CAPACITY);
});

test('computeEffectiveCapacity uses configured capacity when below the ceiling', () => {
  assert.equal(computeEffectiveCapacity(50), 50);
});

test('computeEffectiveCapacity clamps configured capacity at the ceiling', () => {
  assert.equal(computeEffectiveCapacity(500), MAX_COMPARTMENT_CAPACITY);
});

test('getLocationCapacityContext sums occupancy across ALL variants at the location, not just one', async () => {
  // Location holds 40 units total, split across two different variants — the
  // bug this guards against summed only the incoming variant's own row.
  const client = fakeStockBalancesClient(new Map([['loc-1', [15, 25]]]));
  const location = { id: 'loc-1', capacity_qty: 50 };

  const context = await getLocationCapacityContext(client, location);

  assert.equal(context.occupiedQty, 40);
  assert.equal(context.effectiveCapacity, 50);
  assert.equal(context.remainingCapacity, 10);
  assert.equal(context.configuredCapacity, 50);
});

test('getLocationCapacityContext never returns a negative remaining capacity', async () => {
  const client = fakeStockBalancesClient(new Map([['loc-1', [120]]]));
  const location = { id: 'loc-1', capacity_qty: 100 };

  const context = await getLocationCapacityContext(client, location);

  assert.equal(context.remainingCapacity, 0);
});

test('getLocationCapacityContext applies the MAX_COMPARTMENT_CAPACITY default when capacity_qty is null', async () => {
  const client = fakeStockBalancesClient(new Map([['loc-1', [10]]]));
  const location = { id: 'loc-1', capacity_qty: null };

  const context = await getLocationCapacityContext(client, location);

  assert.equal(context.effectiveCapacity, MAX_COMPARTMENT_CAPACITY);
  assert.equal(context.remainingCapacity, MAX_COMPARTMENT_CAPACITY - 10);
});

test('getLocationCapacityContextBatch computes contexts for multiple locations in one occupancy query', async () => {
  const client = fakeStockBalancesClient(
    new Map([
      ['loc-1', [10]],
      ['loc-2', [5, 5]],
    ]),
  );
  const locations = [
    { id: 'loc-1', capacity_qty: 20 },
    { id: 'loc-2', capacity_qty: null },
  ];

  const batch = await getLocationCapacityContextBatch(client, locations);

  assert.equal(batch.get('loc-1').remainingCapacity, 10);
  assert.equal(batch.get('loc-2').occupiedQty, 10);
  assert.equal(batch.get('loc-2').effectiveCapacity, MAX_COMPARTMENT_CAPACITY);
});

test('getEligibleLocationTypes restricts RECEIVING and PUTAWAY to SHELF_COMPARTMENT only', () => {
  assert.deepEqual(getEligibleLocationTypes('RECEIVING'), ['SHELF_COMPARTMENT']);
  assert.deepEqual(getEligibleLocationTypes('PUTAWAY'), ['SHELF_COMPARTMENT']);
});

test('getEligibleLocationTypes falls back to RECEIVING policy for an unknown mode', () => {
  assert.deepEqual(getEligibleLocationTypes('NOT_A_MODE'), ['SHELF_COMPARTMENT']);
});

test('isLocationEligibleForMode rejects BIN locations for RECEIVING (Putaway can never use them)', () => {
  const binLocation = { is_active: true, location_type: 'BIN' };
  assert.equal(isLocationEligibleForMode(binLocation, 'RECEIVING'), false);
});

test('isLocationEligibleForMode accepts an active SHELF_COMPARTMENT for RECEIVING', () => {
  const shelfCompartment = { is_active: true, location_type: 'SHELF_COMPARTMENT' };
  assert.equal(isLocationEligibleForMode(shelfCompartment, 'RECEIVING'), true);
});

test('isLocationEligibleForMode rejects an inactive location regardless of type', () => {
  const inactive = { is_active: false, location_type: 'SHELF_COMPARTMENT' };
  assert.equal(isLocationEligibleForMode(inactive, 'RECEIVING'), false);
});
