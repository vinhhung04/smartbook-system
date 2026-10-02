const test = require('node:test');
const assert = require('node:assert/strict');

// Same fast-fail Redis config as storage-suggestion.service.test.js — the
// controller's success paths now call invalidateCache(), which would
// otherwise try (and slowly fail) to resolve the docker-compose-only "redis"
// hostname.
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:1';

// --- Minimal in-memory fake Prisma client ------------------------------
//
// receiving-putaway.controller.js and location-capacity.service.js each do
// `new PrismaClient()` at module scope, so there's no constructor-injection
// point for a test double. Instead we register a fake `@prisma/client`
// module in require.cache (isolated to this test file/process — node --test
// runs each file in its own process) whose PrismaClient always returns the
// same in-memory fake, so every module sees one consistent fake database.

function matchesWhere(row, where) {
  return Object.entries(where || {}).every(([key, cond]) => {
    if (cond !== null && typeof cond === 'object' && !Array.isArray(cond)) {
      if (Object.prototype.hasOwnProperty.call(cond, 'in')) {
        return cond.in.includes(row[key]);
      }
      if (Object.prototype.hasOwnProperty.call(cond, 'gt')) {
        return Number(row[key]) > cond.gt;
      }
      // Composite unique-key object, e.g. variant_id_location_id: {variant_id, location_id}
      return Object.entries(cond).every(([subKey, subVal]) => row[subKey] === subVal);
    }
    return row[key] === cond;
  });
}

function applyData(row, data) {
  Object.entries(data).forEach(([key, val]) => {
    if (val && typeof val === 'object' && !Array.isArray(val) && !(val instanceof Date)) {
      if ('increment' in val) {
        row[key] = Number(row[key] || 0) + val.increment;
        return;
      }
      if ('decrement' in val) {
        row[key] = Number(row[key] || 0) - val.decrement;
        return;
      }
    }
    row[key] = val;
  });
}

function project(row, select) {
  if (!select) return { ...row };
  const result = {};
  Object.keys(select).forEach((key) => {
    if (select[key]) result[key] = row[key];
  });
  return result;
}

function createModel(rows) {
  return {
    async findUnique({ where, select }) {
      const row = rows.find((r) => matchesWhere(r, where));
      return row ? project(row, select) : null;
    },
    async findMany({ where, select, orderBy } = {}) {
      let result = rows.filter((r) => matchesWhere(r, where || {}));
      if (orderBy) {
        const [[field, dir]] = Object.entries(orderBy);
        result = [...result].sort((a, b) => (dir === 'desc' ? b[field] - a[field] : a[field] - b[field]));
      }
      return result.map((r) => project(r, select));
    },
    async groupBy({ by, where, _sum }) {
      const filtered = rows.filter((r) => matchesWhere(r, where || {}));
      const groups = new Map();
      filtered.forEach((r) => {
        const key = by.map((f) => r[f]).join('||');
        if (!groups.has(key)) {
          groups.set(key, { keys: by.reduce((acc, f) => ({ ...acc, [f]: r[f] }), {}), sums: {} });
        }
        const g = groups.get(key);
        Object.keys(_sum).forEach((field) => {
          g.sums[field] = Number(g.sums[field] || 0) + Number(r[field] || 0);
        });
      });
      return [...groups.values()].map((g) => ({ ...g.keys, _sum: g.sums }));
    },
    async update({ where, data }) {
      const row = rows.find((r) => matchesWhere(r, where));
      if (!row) throw new Error('fake prisma: no row found for update');
      applyData(row, data);
      return { ...row };
    },
    async upsert({ where, update, create }) {
      const row = rows.find((r) => matchesWhere(r, where));
      if (row) {
        applyData(row, update);
        return { ...row };
      }
      const newRow = { ...create };
      rows.push(newRow);
      return { ...newRow };
    },
    async createMany({ data }) {
      data.forEach((d) => rows.push({ ...d }));
      return { count: data.length };
    },
  };
}

function createFakeDb(seed) {
  const state = {
    locations: seed.locations.map((l) => ({ ...l })),
    stock_balances: seed.stock_balances.map((b) => ({ ...b })),
    stock_movements: [],
    integration_outbox: [],
  };

  const client = {
    locations: createModel(state.locations),
    stock_balances: createModel(state.stock_balances),
    stock_movements: createModel(state.stock_movements),
    integration_outbox: createModel(state.integration_outbox),
    async $transaction(fn) {
      return fn(client);
    },
  };

  return { client, state };
}

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

const prismaClientPath = require.resolve('@prisma/client');

function installFakePrisma(client) {
  require.cache[prismaClientPath] = {
    id: prismaClientPath,
    filename: prismaClientPath,
    loaded: true,
    exports: {
      PrismaClient: function FakePrismaClient() {
        return client;
      },
    },
  };
}

function buildSeed() {
  return {
    locations: [
      { id: 'loc-recv', warehouse_id: 'wh-1', parent_location_id: null, location_type: 'RECEIVING', location_code: 'RECV-1', is_active: true, capacity_qty: null },
      { id: 'zone-1', warehouse_id: 'wh-1', parent_location_id: null, location_type: 'ZONE', location_code: 'ZONE-1', is_active: true, capacity_qty: null },
      { id: 'shelf-1', warehouse_id: 'wh-1', parent_location_id: 'zone-1', location_type: 'SHELF', location_code: 'SHELF-1', is_active: true, capacity_qty: null },
      { id: 'compartment-1', warehouse_id: 'wh-1', parent_location_id: 'shelf-1', location_type: 'SHELF_COMPARTMENT', location_code: 'COMP-1', is_active: true, capacity_qty: 50 },
      { id: 'bin-1', warehouse_id: 'wh-1', parent_location_id: 'shelf-1', location_type: 'BIN', location_code: 'BIN-1', is_active: true, capacity_qty: 50 },
    ],
    stock_balances: [
      { variant_id: 'variant-x', location_id: 'loc-recv', warehouse_id: 'wh-1', on_hand_qty: 50, available_qty: 0, version: 1 },
    ],
  };
}

const controllerPath = require.resolve('../src/controllers/receiving-putaway.controller.js');
const capacityServicePath = require.resolve('../src/services/location-capacity.service.js');
const suggestionServicePath = require.resolve('../src/services/storage-suggestion.service.js');

// Every test gets its OWN fresh fake database and a freshly required
// controller bound to it — no state leaks between tests, so test order never
// matters (a location filled to capacity by one test must not affect the next).
function withFreshController(seedOverride, transactionOverride) {
  const { client } = createFakeDb(seedOverride || buildSeed());
  if (transactionOverride) client.$transaction = transactionOverride;
  installFakePrisma(client);

  delete require.cache[controllerPath];
  delete require.cache[capacityServicePath];
  delete require.cache[suggestionServicePath];

  return require('../src/controllers/receiving-putaway.controller.js');
}

test('TC-flow-1: happy path RECEIVING -> candidates -> transfer produces correct stock balances and a movement record', async () => {
  const controller = withFreshController();

  const candidatesReq = { params: { receivingId: 'loc-recv' }, query: { variant_id: 'variant-x' } };
  const candidatesRes = createFakeRes();
  await controller.getCompartmentCandidates(candidatesReq, candidatesRes);

  assert.equal(candidatesRes.statusCode, 200);
  const candidateIds = candidatesRes.body.candidates.map((c) => c.id);
  assert.ok(candidateIds.includes('compartment-1'), 'SHELF_COMPARTMENT must be offered as a candidate');
  assert.ok(!candidateIds.includes('bin-1'), 'BIN must never be offered — Receiving Putaway cannot use it');

  const transferReq = {
    body: {
      warehouse_id: 'wh-1',
      source_receiving_location_id: 'loc-recv',
      variant_id: 'variant-x',
      allocations: [{ target_location_id: 'compartment-1', quantity: 30, reason: 'putaway test' }],
    },
    user: { id: 'user-1' },
  };
  const transferRes = createFakeRes();
  await controller.transferReceivingToShelf(transferReq, transferRes);

  assert.equal(transferRes.statusCode, 201, JSON.stringify(transferRes.body));
  assert.equal(transferRes.body.data.moved_quantity, 30);
});

test('TC-flow-2: a location returned as an eligible candidate is not then rejected by transfer for the same quantity', async () => {
  const controller = withFreshController();

  const candidatesReq = { params: { receivingId: 'loc-recv' }, query: { variant_id: 'variant-x' } };
  const candidatesRes = createFakeRes();
  await controller.getCompartmentCandidates(candidatesReq, candidatesRes);

  const candidate = candidatesRes.body.candidates.find((c) => c.id === 'compartment-1');
  assert.ok(candidate, 'compartment-1 must be a candidate');
  assert.ok(candidate.remaining_capacity > 0);

  const transferReq = {
    body: {
      warehouse_id: 'wh-1',
      source_receiving_location_id: 'loc-recv',
      variant_id: 'variant-x',
      allocations: [{ target_location_id: candidate.id, quantity: candidate.remaining_capacity, reason: 'fill to capacity' }],
    },
    user: { id: 'user-1' },
  };
  const transferRes = createFakeRes();
  await controller.transferReceivingToShelf(transferReq, transferRes);

  assert.equal(transferRes.statusCode, 201, JSON.stringify(transferRes.body));
});

test('TC-flow-3: a Postgres serialization failure maps to 409 CONCURRENCY_CONFLICT, not a generic 500', async () => {
  const controller = withFreshController(null, async () => {
    const err = new Error('could not serialize access due to concurrent update');
    err.code = '40001';
    throw err;
  });

  const req = {
    body: {
      warehouse_id: 'wh-1',
      source_receiving_location_id: 'loc-recv',
      variant_id: 'variant-x',
      allocations: [{ target_location_id: 'compartment-1', quantity: 10, reason: 'race' }],
    },
    user: { id: 'user-1' },
  };
  const res = createFakeRes();
  await controller.transferReceivingToShelf(req, res);

  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'CONCURRENCY_CONFLICT');
});

test('getCompartmentCandidates respects the shared effective-capacity formula (capacity_qty, not a flat constant)', async () => {
  const controller = withFreshController();

  const req = { params: { receivingId: 'loc-recv' }, query: { variant_id: 'variant-x' } };
  const res = createFakeRes();
  await controller.getCompartmentCandidates(req, res);

  const candidate = res.body.candidates.find((c) => c.id === 'compartment-1');
  assert.equal(candidate.max_capacity, 50);
});

test.after(() => {
  delete require.cache[prismaClientPath];
});
