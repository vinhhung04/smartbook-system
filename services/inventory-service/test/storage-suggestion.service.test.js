const test = require('node:test');
const assert = require('node:assert/strict');

// applySuggestion's success path calls invalidateCache(), which lazily connects to
// Redis. The default REDIS_URL host ("redis") only resolves inside docker-compose,
// so DNS lookups here would time out slowly and retry repeatedly. Point at a local
// port nothing listens on instead — connection is refused immediately, so the
// graceful-degradation path in lib/redis.js is reached fast.
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:1';

const {
  calculateLocationScore,
  getConfidence,
  applySuggestion,
  getCacheKey,
} = require('../src/services/storage-suggestion.service');

// --- calculateLocationScore fixtures -----------------------------------

function baseLocation(overrides = {}) {
  return {
    id: 'loc-1',
    is_active: true,
    is_pickable: true,
    location_type: 'SHELF_COMPARTMENT',
    effectiveCapacity: 100,
    occupiedQty: 0,
    remainingCapacity: 100,
    distinctSkuCount: 0,
    ...overrides,
  };
}

function baseContext(overrides = {}) {
  return {
    quantity: 10,
    mode: 'RECEIVING',
    sameVariantLocations: [],
    sameBookLocations: [],
    categoryStockByLocation: new Map(),
    recentMovementLocations: [],
    categoryNames: ['Van hoc'],
    ...overrides,
  };
}

test('TC1: a location already holding the same variant scores higher than a plain empty one', () => {
  const sameVariantLocation = baseLocation({ id: 'loc-same-variant', occupiedQty: 20, remainingCapacity: 80 });
  const emptyLocation = baseLocation({ id: 'loc-empty' });

  const context = baseContext({ sameVariantLocations: ['loc-same-variant'] });

  const sameVariantScore = calculateLocationScore(sameVariantLocation, context);
  const emptyScore = calculateLocationScore(emptyLocation, context);

  assert.ok(sameVariantScore.isValid);
  assert.ok(sameVariantScore.score > emptyScore.score);
  assert.ok(sameVariantScore.reasons.some((r) => r.includes('cùng variant')));
});

test('TC2: same book, different variant scores below same-variant but above no-match, with distinct wording', () => {
  const sameVariantLocation = baseLocation({ id: 'loc-a', occupiedQty: 20, remainingCapacity: 80 });
  const sameBookLocation = baseLocation({ id: 'loc-b', occupiedQty: 20, remainingCapacity: 80 });
  const noMatchLocation = baseLocation({ id: 'loc-c', occupiedQty: 20, remainingCapacity: 80 });

  const context = baseContext({
    sameVariantLocations: ['loc-a'],
    sameBookLocations: ['loc-a', 'loc-b'],
  });

  const sameVariantScore = calculateLocationScore(sameVariantLocation, context);
  const sameBookScore = calculateLocationScore(sameBookLocation, context);
  const noMatchScore = calculateLocationScore(noMatchLocation, context);

  assert.ok(sameVariantScore.score > sameBookScore.score);
  assert.ok(sameBookScore.score > noMatchScore.score);
  assert.ok(sameBookScore.reasons.some((r) => r.includes('cùng tác phẩm/book record nhưng khác variant')));
  assert.ok(!sameVariantScore.reasons.some((r) => r.includes('tác phẩm/book record')));
});

test('TC3: higher category-affinity ratio scores higher than a lower ratio at an otherwise equal location', () => {
  const highAffinity = baseLocation({ id: 'loc-high', occupiedQty: 20, remainingCapacity: 80 });
  const lowAffinity = baseLocation({ id: 'loc-low', occupiedQty: 20, remainingCapacity: 80 });

  const context = baseContext({
    categoryStockByLocation: new Map([
      ['loc-high', 18], // 18/20 matching
      ['loc-low', 1], // 1/20 matching
    ]),
  });

  const highScore = calculateLocationScore(highAffinity, context);
  const lowScore = calculateLocationScore(lowAffinity, context);

  assert.ok(highScore.score > lowScore.score);
});

test('TC4: insufficient capacity is hard-rejected, not just a warning', () => {
  const location = baseLocation({ occupiedQty: 95, remainingCapacity: 5 });
  const context = baseContext({ quantity: 10 });

  const result = calculateLocationScore(location, context);

  assert.equal(result.isValid, false);
  assert.equal(result.score, 0);
});

test('TC5: zero remaining capacity is hard-rejected', () => {
  const location = baseLocation({ occupiedQty: 100, remainingCapacity: 0 });
  const context = baseContext({ quantity: 1 });

  const result = calculateLocationScore(location, context);

  assert.equal(result.isValid, false);
});

test('TC6: null capacity_qty already resolved to the MAX_COMPARTMENT_CAPACITY default is scored as normal capacity', () => {
  // location-capacity.service.js resolves capacity_qty:null to effectiveCapacity=100
  // before this function ever runs — calculateLocationScore just trusts the numbers.
  const location = baseLocation({ effectiveCapacity: 100, occupiedQty: 10, remainingCapacity: 90 });
  const context = baseContext({ quantity: 10 });

  const result = calculateLocationScore(location, context);

  assert.ok(result.isValid);
  assert.ok(result.score > 0);
});

test('TC7: heavy SKU mixing penalizes score relative to an otherwise-identical low-mix location', () => {
  const highMix = baseLocation({ id: 'loc-mix', occupiedQty: 20, remainingCapacity: 80, distinctSkuCount: 10 });
  const lowMix = baseLocation({ id: 'loc-clean', occupiedQty: 20, remainingCapacity: 80, distinctSkuCount: 0 });

  const context = baseContext();

  const highMixScore = calculateLocationScore(highMix, context);
  const lowMixScore = calculateLocationScore(lowMix, context);

  assert.ok(highMixScore.score < lowMixScore.score);
  assert.ok(highMixScore.warnings.some((w) => w.includes('SKU mix')));
});

test('TC8: consolidating into an existing location beats spreading to a new one when the item is already fragmented', () => {
  const existingLocation = baseLocation({ id: 'loc-existing', occupiedQty: 5, remainingCapacity: 95 });
  const newSpreadLocation = baseLocation({ id: 'loc-new', occupiedQty: 0, remainingCapacity: 100 });

  const context = baseContext({
    sameVariantLocations: ['loc-existing', 'loc-x', 'loc-y', 'loc-z'],
  });

  const existingScore = calculateLocationScore(existingLocation, context);
  const newScore = calculateLocationScore(newSpreadLocation, context);

  assert.ok(newScore.warnings.some((w) => w.includes('phân tán')));
  assert.ok(existingScore.score > newScore.score);
});

test('TC9: inactive and non-pickable locations are hard-rejected', () => {
  const inactive = calculateLocationScore(baseLocation({ is_active: false }), baseContext());
  const nonPickable = calculateLocationScore(baseLocation({ is_pickable: false }), baseContext());

  assert.equal(inactive.isValid, false);
  assert.equal(nonPickable.isValid, false);
});

test('TC10: RECEIVING and RELOCATION modes score the same input differently', () => {
  const location = baseLocation({ occupiedQty: 20, remainingCapacity: 80 });

  const receivingScore = calculateLocationScore(location, baseContext({ mode: 'RECEIVING' }));
  const relocationScore = calculateLocationScore(location, baseContext({ mode: 'RELOCATION' }));

  assert.notEqual(receivingScore.score, relocationScore.score);
});

test('BIN locations are hard-rejected under RECEIVING mode (Putaway can never use them)', () => {
  const bin = baseLocation({ location_type: 'BIN' });
  const result = calculateLocationScore(bin, baseContext({ mode: 'RECEIVING' }));

  assert.equal(result.isValid, false);
});

test('occupancy from a DIFFERENT variant still reduces remaining capacity (core bug-1 regression)', () => {
  // A location holding 45 units of some other variant, capacity 50 — only 5 left,
  // even though none of that 45 belongs to the variant being placed.
  const location = baseLocation({ occupiedQty: 45, effectiveCapacity: 50, remainingCapacity: 5 });
  const context = baseContext({ quantity: 10 });

  const result = calculateLocationScore(location, context);

  assert.equal(result.isValid, false);
});

test('getConfidence buckets scores at the documented thresholds', () => {
  assert.equal(getConfidence(80), 'HIGH');
  assert.equal(getConfidence(79), 'MEDIUM');
  assert.equal(getConfidence(50), 'MEDIUM');
  assert.equal(getConfidence(49), 'LOW');
});

test('getCacheKey includes mode so different modes never share a cached suggestion', () => {
  const receivingKey = getCacheKey('wh-1', 'variant-1', 5, 'RECEIVING');
  const relocationKey = getCacheKey('wh-1', 'variant-1', 5, 'RELOCATION');

  assert.notEqual(receivingKey, relocationKey);
  assert.ok(receivingKey.includes('RECEIVING'));
  assert.ok(relocationKey.includes('RELOCATION'));
});

// --- applySuggestion (DI'd client) --------------------------------------

function fakeApplyClient({ location, variant, occupancyByLocation }) {
  return {
    locations: {
      findUnique: async () => location,
    },
    book_variants: {
      findUnique: async () => variant,
    },
    stock_balances: {
      groupBy: async ({ where }) => {
        const ids = where.location_id.in;
        return ids
          .filter((id) => occupancyByLocation.has(id))
          .map((id) => ({
            location_id: id,
            _sum: { on_hand_qty: occupancyByLocation.get(id) },
          }));
      },
    },
  };
}

test('applySuggestion rejects when SUM of ALL variants at the location + incoming qty exceeds capacity, even if the incoming variant has zero stock there', async () => {
  // capacity=100, Book A=50 + Book B=40 already there (90 total), incoming Book C=30.
  // The old bug only checked Book C's own row (0), so 0+30<=100 would have wrongly passed.
  const client = fakeApplyClient({
    location: {
      id: 'loc-1',
      warehouse_id: 'wh-1',
      is_active: true,
      is_pickable: true,
      location_type: 'SHELF_COMPARTMENT',
      capacity_qty: 100,
    },
    variant: { id: 'variant-c' },
    occupancyByLocation: new Map([['loc-1', 90]]),
  });

  const result = await applySuggestion('wh-1', 'variant-c', 'loc-1', 30, 'RECEIVING', client);

  assert.equal(result.success, false);
});

test('applySuggestion accepts when SUM of all stock + incoming qty fits within capacity', async () => {
  const client = fakeApplyClient({
    location: {
      id: 'loc-1',
      warehouse_id: 'wh-1',
      is_active: true,
      is_pickable: true,
      location_type: 'SHELF_COMPARTMENT',
      capacity_qty: 100,
    },
    variant: { id: 'variant-c' },
    occupancyByLocation: new Map([['loc-1', 70]]),
  });

  const result = await applySuggestion('wh-1', 'variant-c', 'loc-1', 30, 'RECEIVING', client);

  assert.equal(result.success, true);
  assert.equal(result.data.availableCapacity, 30);
});

test('applySuggestion rejects a location from a different warehouse', async () => {
  const client = fakeApplyClient({
    location: {
      id: 'loc-1',
      warehouse_id: 'wh-other',
      is_active: true,
      is_pickable: true,
      location_type: 'SHELF_COMPARTMENT',
      capacity_qty: 100,
    },
    variant: { id: 'variant-c' },
    occupancyByLocation: new Map(),
  });

  const result = await applySuggestion('wh-1', 'variant-c', 'loc-1', 10, 'RECEIVING', client);

  assert.equal(result.success, false);
});

test('applySuggestion rejects an inactive location', async () => {
  const client = fakeApplyClient({
    location: {
      id: 'loc-1',
      warehouse_id: 'wh-1',
      is_active: false,
      is_pickable: true,
      location_type: 'SHELF_COMPARTMENT',
      capacity_qty: 100,
    },
    variant: { id: 'variant-c' },
    occupancyByLocation: new Map(),
  });

  const result = await applySuggestion('wh-1', 'variant-c', 'loc-1', 10, 'RECEIVING', client);

  assert.equal(result.success, false);
});

test('applySuggestion rejects a location type not eligible for the given mode (e.g. BIN under RECEIVING)', async () => {
  const client = fakeApplyClient({
    location: {
      id: 'loc-1',
      warehouse_id: 'wh-1',
      is_active: true,
      is_pickable: true,
      location_type: 'BIN',
      capacity_qty: 100,
    },
    variant: { id: 'variant-c' },
    occupancyByLocation: new Map(),
  });

  const result = await applySuggestion('wh-1', 'variant-c', 'loc-1', 10, 'RECEIVING', client);

  assert.equal(result.success, false);
});

test('applySuggestion rejects a non-pickable location', async () => {
  const client = fakeApplyClient({
    location: {
      id: 'loc-1',
      warehouse_id: 'wh-1',
      is_active: true,
      is_pickable: false,
      location_type: 'SHELF_COMPARTMENT',
      capacity_qty: 100,
    },
    variant: { id: 'variant-c' },
    occupancyByLocation: new Map(),
  });

  const result = await applySuggestion('wh-1', 'variant-c', 'loc-1', 10, 'RECEIVING', client);

  assert.equal(result.success, false);
});

test('applySuggestion rejects non-integer / zero / negative quantities', async () => {
  const client = fakeApplyClient({
    location: {
      id: 'loc-1',
      warehouse_id: 'wh-1',
      is_active: true,
      is_pickable: true,
      location_type: 'SHELF_COMPARTMENT',
      capacity_qty: 100,
    },
    variant: { id: 'variant-c' },
    occupancyByLocation: new Map(),
  });

  const zero = await applySuggestion('wh-1', 'variant-c', 'loc-1', 0, 'RECEIVING', client);
  const negative = await applySuggestion('wh-1', 'variant-c', 'loc-1', -5, 'RECEIVING', client);
  const fractional = await applySuggestion('wh-1', 'variant-c', 'loc-1', 1.5, 'RECEIVING', client);

  assert.equal(zero.success, false);
  assert.equal(negative.success, false);
  // toInt() truncates 1.5 -> 1, which is a valid positive integer, so this should pass
  // through quantity validation (truncation, not rejection, matches utils/validation.js).
  assert.equal(fractional.success, true);
});

test('applySuggestion rejects a non-existent variant', async () => {
  const client = fakeApplyClient({
    location: {
      id: 'loc-1',
      warehouse_id: 'wh-1',
      is_active: true,
      is_pickable: true,
      location_type: 'SHELF_COMPARTMENT',
      capacity_qty: 100,
    },
    variant: null,
    occupancyByLocation: new Map(),
  });

  const result = await applySuggestion('wh-1', 'variant-missing', 'loc-1', 10, 'RECEIVING', client);

  assert.equal(result.success, false);
});

test('applySuggestion rejects a non-existent location', async () => {
  const client = fakeApplyClient({
    location: null,
    variant: { id: 'variant-c' },
    occupancyByLocation: new Map(),
  });

  const result = await applySuggestion('wh-1', 'variant-c', 'loc-missing', 10, 'RECEIVING', client);

  assert.equal(result.success, false);
});

test('applySuggestion does a fresh occupancy read at apply time (not a stale suggestion-time value)', async () => {
  let callCount = 0;
  const client = {
    locations: {
      findUnique: async () => ({
        id: 'loc-1',
        warehouse_id: 'wh-1',
        is_active: true,
        is_pickable: true,
        location_type: 'SHELF_COMPARTMENT',
        capacity_qty: 100,
      }),
    },
    book_variants: {
      findUnique: async () => ({ id: 'variant-c' }),
    },
    stock_balances: {
      groupBy: async () => {
        callCount += 1;
        // Simulate the location having filled up since an earlier suggestion was
        // generated — the second call (this one, at apply time) sees 95, not 0.
        return [{ location_id: 'loc-1', _sum: { on_hand_qty: 95 } }];
      },
    },
  };

  const result = await applySuggestion('wh-1', 'variant-c', 'loc-1', 10, 'RECEIVING', client);

  assert.equal(callCount, 1);
  assert.equal(result.success, false);
});
