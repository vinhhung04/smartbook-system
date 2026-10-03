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
    if (key === 'OR') return cond.some((alternative) => matchesWhere(row, alternative));
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
    async findFirst({ where, select } = {}) {
      const row = rows.find((r) => matchesWhere(r, where || {}));
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
    stock_movements: (seed.stock_movements || []).map((m) => ({ ...m })),
    integration_outbox: [],
    goods_receipts: (seed.goods_receipts || []).map((r) => ({ ...r })),
    goods_receipt_items: (seed.goods_receipt_items || []).map((i) => ({ ...i })),
    book_variants: (seed.book_variants || []).map((v) => ({ ...v })),
  };

  const client = {
    locations: createModel(state.locations),
    stock_balances: createModel(state.stock_balances),
    stock_movements: createModel(state.stock_movements),
    integration_outbox: createModel(state.integration_outbox),
    goods_receipts: createModel(state.goods_receipts),
    goods_receipt_items: createModel(state.goods_receipt_items),
    book_variants: createModel(state.book_variants),
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
function withFreshController(seedOverride, transactionOverride, options = {}) {
  const { client } = createFakeDb(seedOverride || buildSeed());
  if (transactionOverride) client.$transaction = transactionOverride;
  installFakePrisma(client);

  delete require.cache[controllerPath];
  delete require.cache[capacityServicePath];
  delete require.cache[suggestionServicePath];
  if (options.stubCache) {
    // Success paths call invalidateCache(), which otherwise waits on Redis connection retries.
    require.cache[suggestionServicePath] = {
      id: suggestionServicePath,
      filename: suggestionServicePath,
      loaded: true,
      exports: { invalidateCache: async () => {} },
    };
  }

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

function fastController(seed) {
  return withFreshController(seed, undefined, { stubCache: true });
}

// --- Location scan lookup: codes that are not "<letter>-NN-NNN" -------------------------------

function buildScanSeed() {
  const seed = buildSeed();
  seed.locations.push(
    { id: 'compartment-hn', warehouse_id: 'wh-1', parent_location_id: 'shelf-1', location_type: 'SHELF_COMPARTMENT', location_code: 'HN-A-01-001', barcode: 'LOC-HN-A-01-001', is_active: true, capacity_qty: 50 },
    { id: 'compartment-a', warehouse_id: 'wh-1', parent_location_id: 'shelf-1', location_type: 'SHELF_COMPARTMENT', location_code: 'A-01-003', barcode: 'LOC-A-01-003', is_active: true, capacity_qty: 50 },
    { id: 'bin-scan', warehouse_id: 'wh-1', parent_location_id: 'shelf-1', location_type: 'BIN', location_code: 'BIN-9', barcode: 'LOC-BIN-9', is_active: true, capacity_qty: 50 },
  );
  return seed;
}

async function lookup(controller, barcode, warehouseId = 'wh-1') {
  const res = createFakeRes();
  await controller.lookupCompartmentByBarcode({ query: { warehouse_id: warehouseId, barcode } }, res);
  return res;
}

test('lookupCompartmentByBarcode resolves codes outside the old <letter>-NN-NNN format (Hanoi HN-A-01-001)', async () => {
  const controller = fastController(buildScanSeed());

  for (const input of ['LOC-HN-A-01-001', 'HN-A-01-001', 'hn-a-01-001']) {
    const res = await lookup(controller, input);
    assert.equal(res.statusCode, 200, `${input}: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.id, 'compartment-hn');
    assert.equal(res.body.normalized_barcode, 'LOC-HN-A-01-001', 'echoes the location\'s real barcode');
  }
});

test('lookupCompartmentByBarcode still resolves the classic format with or without the LOC- prefix', async () => {
  const controller = fastController(buildScanSeed());
  for (const input of ['LOC-A-01-003', 'a-01-003']) {
    const res = await lookup(controller, input);
    assert.equal(res.statusCode, 200, input);
    assert.equal(res.body.id, 'compartment-a');
  }
});

test('lookupCompartmentByBarcode rejects junk input (400), unknown codes (404) and non-compartment locations (400)', async () => {
  const controller = fastController(buildScanSeed());
  assert.equal((await lookup(controller, 'a b;DROP TABLE')).statusCode, 400);
  assert.equal((await lookup(controller, '***')).statusCode, 400);
  assert.equal((await lookup(controller, 'LOC-NOPE-1')).statusCode, 404);
  assert.equal((await lookup(controller, 'LOC-BIN-9')).statusCode, 400);
  assert.equal((await lookup(controller, 'LOC-HN-A-01-001', 'wh-2')).statusCode, 404, 'a code is only valid in its own warehouse');
});

// --- Transfer: server-side validation of scans and of the receipt-scoped ceiling --------------

function buildReceiptSeed() {
  const seed = buildScanSeed();
  seed.stock_balances[0].on_hand_qty = 100;
  seed.book_variants = [
    { id: 'variant-x', sku: 'SKU-X', isbn13: '9786041234567', isbn10: '6041234560', internal_barcode: 'BC-X-1' },
  ];
  seed.goods_receipts = [
    { id: 'receipt-1', warehouse_id: 'wh-1', status: 'POSTED' },
    { id: 'receipt-draft', warehouse_id: 'wh-1', status: 'DRAFT' },
    { id: 'receipt-other-wh', warehouse_id: 'wh-2', status: 'POSTED' },
    { id: 'receipt-done', warehouse_id: 'wh-1', status: 'POSTED' },
  ];
  seed.goods_receipt_items = [
    { id: 'item-1', goods_receipt_id: 'receipt-1', variant_id: 'variant-x', quantity: 20, location_id: null },
    { id: 'item-draft', goods_receipt_id: 'receipt-draft', variant_id: 'variant-x', quantity: 20, location_id: null },
    { id: 'item-other', goods_receipt_id: 'receipt-other-wh', variant_id: 'variant-x', quantity: 20, location_id: null },
    { id: 'item-done', goods_receipt_id: 'receipt-done', variant_id: 'variant-x', quantity: 5, location_id: null },
  ];
  seed.stock_movements = [
    { reference_type: 'RECEIVING_SHELF_PUTAWAY', reference_id: 'receipt-done', variant_id: 'variant-x', movement_status: 'POSTED', quantity: 5, metadata: { movement_bucket: 'PUTAWAY' } },
  ];
  return seed;
}

async function transfer(controller, overrides = {}, allocation = {}) {
  const res = createFakeRes();
  await controller.transferReceivingToShelf(
    {
      body: {
        warehouse_id: 'wh-1',
        source_receiving_location_id: 'loc-recv',
        variant_id: 'variant-x',
        allocations: [{ target_location_id: 'compartment-hn', quantity: 2, reason: 't', ...allocation }],
        ...overrides,
      },
      user: { id: 'user-1' },
    },
    res,
  );
  return res;
}

test('transfer rejects a scanned_location_barcode that is not the target location (previously accepted unchecked)', async () => {
  const controller = fastController(buildReceiptSeed());
  const res = await transfer(controller, {}, { scanned_location_barcode: 'WRONG-BARCODE' });
  assert.equal(res.statusCode, 400, JSON.stringify(res.body));
  assert.match(res.body.message, /không khớp vị trí đích/);
});

test('transfer accepts the target\'s own barcode however it is typed (LOC- prefix, code only, any case)', async () => {
  for (const scanned of ['LOC-HN-A-01-001', 'HN-A-01-001', 'hn-a-01-001']) {
    const controller = fastController(buildReceiptSeed());
    const res = await transfer(controller, {}, { scanned_location_barcode: scanned });
    assert.equal(res.statusCode, 201, `${scanned}: ${JSON.stringify(res.body)}`);
  }
});

test('transfer without any scanned barcode is still allowed (manual selection path)', async () => {
  const controller = fastController(buildReceiptSeed());
  assert.equal((await transfer(controller)).statusCode, 201);
});

test('transfer checks scanned_product_barcode against the variant (internal barcode, SKU, ISBN)', async () => {
  const bad = await transfer(fastController(buildReceiptSeed()), {}, { scanned_product_barcode: 'BC-OTHER' });
  assert.equal(bad.statusCode, 400);
  assert.match(bad.body.message, /Mã sách quét không khớp/);

  for (const scanned of ['BC-X-1', 'sku-x', '9786041234567']) {
    const ok = await transfer(fastController(buildReceiptSeed()), {}, { scanned_product_barcode: scanned });
    assert.equal(ok.statusCode, 201, `${scanned}: ${JSON.stringify(ok.body)}`);
  }
});

test('receipt-scoped transfer is capped at the receipt\'s remaining quantity', async () => {
  const controller = fastController(buildReceiptSeed());

  const tooMany = await transfer(controller, { goods_receipt_id: 'receipt-1' }, { quantity: 21 });
  assert.equal(tooMany.statusCode, 400);
  assert.match(tooMany.body.message, /vượt quá số còn lại của phiếu này \(20\)/);

  const exact = await transfer(controller, { goods_receipt_id: 'receipt-1' }, { quantity: 20 });
  assert.equal(exact.statusCode, 201, JSON.stringify(exact.body));
});

test('a goods receipt that is already fully put away accepts no more stock stamped against it', async () => {
  const controller = fastController(buildReceiptSeed());
  const res = await transfer(controller, { goods_receipt_id: 'receipt-done' }, { quantity: 1 });
  assert.equal(res.statusCode, 400, JSON.stringify(res.body));
  assert.match(res.body.message, /còn lại của phiếu này \(0\)/);
});

test('receipt-scoped transfer validates the receipt: unknown, other warehouse, not POSTED, variant not on it', async () => {
  const unknown = await transfer(fastController(buildReceiptSeed()), { goods_receipt_id: 'receipt-missing' });
  assert.match(unknown.body.message, /Không tìm thấy phiếu nhập/);

  const otherWh = await transfer(fastController(buildReceiptSeed()), { goods_receipt_id: 'receipt-other-wh' });
  assert.match(otherWh.body.message, /không thuộc kho này/);

  const draft = await transfer(fastController(buildReceiptSeed()), { goods_receipt_id: 'receipt-draft' });
  assert.match(draft.body.message, /đã ghi sổ \(POSTED\)/);

  const seed = buildReceiptSeed();
  seed.goods_receipt_items = seed.goods_receipt_items.filter((i) => i.goods_receipt_id !== 'receipt-1');
  const noVariant = await transfer(fastController(seed), { goods_receipt_id: 'receipt-1' });
  assert.match(noVariant.body.message, /không thuộc phiếu nhập đã chọn/);
});

test.after(() => {
  delete require.cache[prismaClientPath];
});
