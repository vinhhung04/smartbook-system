// Warehouse assignment rules (lib/warehouse-assignment.js) and the route
// guard / warehouse directory used by PUT /iam/users/:id/warehouse-scopes.
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  AssignmentError,
  describeActor,
  normalizeScopeInput,
  normalizePrimaryInput,
  planScopeUpdate,
  visibleRowsFor,
} = require('../src/lib/warehouse-assignment');
const { createWarehouseDirectory, WarehouseDirectoryUnavailableError } = require('../src/lib/warehouse-directory');
const { createWarehouseAssignmentController } = require('../src/controllers/warehouse-assignment.controller');

const HCM = 'd8e151d8-fd15-4477-bbfd-59d10f778ab5';
const HN = '73318a97-5043-4338-b88b-797fa76e51b7';
const BR = '7fda99eb-8bf0-4b50-9d64-fe195beb724d';
const CLOSED = '9dd7de0f-6295-5c17-80e8-214ed2bce031';
const STAFF_ID = '11111111-1111-4111-8111-111111111111';
const MANAGER_ID = '22222222-2222-4222-8222-222222222222';
const ADMIN_ID = '33333333-3333-4333-8333-333333333333';

const admin = describeActor({ sub: ADMIN_ID, roles: ['ADMIN'], permissions: ['auth.users.read', 'auth.users.write'] });
const manager = describeActor({ sub: MANAGER_ID, roles: ['WAREHOUSE_MANAGER'], permissions: ['inventory.operation.decide'] });
const staffTarget = (extra = {}) => ({ id: STAFF_ID, is_superuser: false, deleted: false, roles: ['WAREHOUSE_STAFF'], primary_warehouse_id: null, ...extra });
const warehouses = new Map([
  [HCM, { is_active: true }], [HN, { is_active: true }], [BR, { is_active: true }], [CLOSED, { is_active: false }],
]);

function rejects(fn, status, code) {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof AssignmentError, `expected AssignmentError, got ${error}`);
    assert.equal(error.status, status, error.message);
    assert.equal(error.code, code);
    return true;
  });
}

function plan(overrides = {}) {
  return planScopeUpdate({
    actor: admin,
    target: staffTarget(),
    current: [],
    requested: [],
    requestedPrimary: undefined,
    warehouses,
    ...overrides,
  });
}

// ── assignment ──────────────────────────────────────────────────────────────

test('A1 admin assigns several warehouses with existing access levels; diff lists the additions', () => {
  const result = plan({
    requested: normalizeScopeInput([{ warehouse_id: HCM, access_level: 'operator' }, { warehouse_id: HN, access_level: 'READ' }]),
    requestedPrimary: normalizePrimaryInput(HCM),
  });
  assert.deepEqual(result.scopes, [{ warehouse_id: HCM, access_level: 'OPERATOR' }, { warehouse_id: HN, access_level: 'READ' }]);
  assert.equal(result.primary_warehouse_id, HCM);
  assert.equal(result.added.length, 2);
  assert.deepEqual(result.removed, []);
});

test('A2 unknown access level, malformed warehouse id and a non-list body are 400', () => {
  rejects(() => normalizeScopeInput([{ warehouse_id: HCM, access_level: 'ADMIN' }]), 400, 'INVALID_ACCESS_LEVEL');
  rejects(() => normalizeScopeInput([{ warehouse_id: 'WH-HCM-01', access_level: 'READ' }]), 400, 'INVALID_WAREHOUSE_ID');
  rejects(() => normalizeScopeInput({ warehouse_id: HCM }), 400, 'INVALID_SCOPES');
});

test('A3 the same warehouse twice is refused (no duplicate rows)', () => {
  rejects(() => normalizeScopeInput([
    { warehouse_id: HCM, access_level: 'READ' },
    { warehouse_id: HCM.toUpperCase(), access_level: 'FULL' },
  ]), 400, 'DUPLICATE_WAREHOUSE');
});

test('A4 a warehouse inventory-service does not know is 404; a new grant on an inactive one is 400', () => {
  const ghost = '44444444-4444-4444-8444-444444444444';
  rejects(() => plan({ requested: [{ warehouse_id: ghost, access_level: 'READ' }] }), 404, 'WAREHOUSE_NOT_FOUND');
  rejects(() => plan({ requested: [{ warehouse_id: CLOSED, access_level: 'READ' }] }), 400, 'WAREHOUSE_INACTIVE');
  // an existing grant on a warehouse closed since then may be kept as it is
  const kept = plan({ current: [{ warehouse_id: CLOSED, access_level: 'READ' }], requested: [{ warehouse_id: CLOSED, access_level: 'READ' }] });
  assert.deepEqual(kept.added, []);
});

test('A5 the primary warehouse must be one of the scoped warehouses - it never grants access by itself', () => {
  rejects(() => plan({ requested: [{ warehouse_id: HN, access_level: 'READ' }], requestedPrimary: HCM }), 400, 'PRIMARY_NOT_IN_SCOPE');
});

test('A6 revoking the current primary needs an explicit decision (409), then a new primary or null works', () => {
  const target = staffTarget({ primary_warehouse_id: HCM });
  const current = [{ warehouse_id: HCM, access_level: 'OPERATOR' }, { warehouse_id: HN, access_level: 'OPERATOR' }];
  const requested = [{ warehouse_id: HN, access_level: 'OPERATOR' }];
  rejects(() => plan({ target, current, requested }), 409, 'PRIMARY_WAREHOUSE_REVOKED');
  const moved = plan({ target, current, requested, requestedPrimary: HN });
  assert.equal(moved.primary_warehouse_id, HN);
  assert.equal(moved.primary_changed, true);
  assert.deepEqual(moved.removed, [{ warehouse_id: HCM, access_level: 'OPERATOR' }]);
  assert.equal(plan({ target, current, requested, requestedPrimary: null }).primary_warehouse_id, null);
});

test('A7 changing a level is reported as a change, not as remove + add', () => {
  const result = plan({ current: [{ warehouse_id: HCM, access_level: 'READ' }], requested: [{ warehouse_id: HCM, access_level: 'OPERATOR' }] });
  assert.deepEqual(result.changed, [{ warehouse_id: HCM, from: 'READ', to: 'OPERATOR' }]);
  assert.deepEqual(result.added, []);
  assert.deepEqual(result.removed, []);
});

// ── authorization ───────────────────────────────────────────────────────────

test('B1 nobody changes their own warehouse scope, not even an admin', () => {
  rejects(() => plan({ target: staffTarget({ id: ADMIN_ID, roles: ['ADMIN'] }) }), 403, 'SELF_ASSIGNMENT_FORBIDDEN');
});

test('B2 a manager only assigns warehouses they manage (WRITE level and up)', () => {
  const actorScopes = [{ warehouse_id: HCM, access_level: 'FULL' }, { warehouse_id: HN, access_level: 'READ' }];
  rejects(() => plan({ actor: manager, actorScopes, requested: [{ warehouse_id: HN, access_level: 'READ' }] }), 403, 'WAREHOUSE_OUT_OF_MANAGER_SCOPE');
  rejects(() => plan({ actor: manager, actorScopes, requested: [{ warehouse_id: BR, access_level: 'READ' }] }), 403, 'WAREHOUSE_OUT_OF_MANAGER_SCOPE');
  const ok = plan({ actor: manager, actorScopes, requested: [{ warehouse_id: HCM, access_level: 'OPERATOR' }] });
  assert.deepEqual(ok.scopes, [{ warehouse_id: HCM, access_level: 'OPERATOR' }]);
});

test('B3 a manager cannot grant (or strip) a level above their own', () => {
  const actorScopes = [{ warehouse_id: HCM, access_level: 'OPERATOR' }];
  rejects(() => plan({ actor: manager, actorScopes, requested: [{ warehouse_id: HCM, access_level: 'FULL' }] }), 403, 'ACCESS_LEVEL_ESCALATION');
  rejects(() => plan({ actor: manager, actorScopes, current: [{ warehouse_id: HCM, access_level: 'FULL' }], requested: [] }), 403, 'ACCESS_LEVEL_ESCALATION');
});

test('B4 a manager only manages WAREHOUSE_STAFF accounts', () => {
  const actorScopes = [{ warehouse_id: HCM, access_level: 'FULL' }];
  for (const roles of [['WAREHOUSE_MANAGER'], ['ADMIN'], ['WAREHOUSE_STAFF', 'WAREHOUSE_MANAGER'], ['LIBRARIAN'], []]) {
    rejects(() => plan({ actor: manager, actorScopes, target: staffTarget({ roles }), requested: [] }), 403, 'TARGET_NOT_STAFF');
  }
});

test('B5 a manager leaves rows in other warehouses untouched (no blind replace)', () => {
  const actorScopes = [{ warehouse_id: HCM, access_level: 'FULL' }];
  const current = [{ warehouse_id: HN, access_level: 'OPERATOR' }, { warehouse_id: HCM, access_level: 'READ' }];
  const result = plan({ actor: manager, actorScopes, current, requested: [] });
  assert.deepEqual(result.scopes, [{ warehouse_id: HN, access_level: 'OPERATOR' }]);
  assert.deepEqual(result.removed, [{ warehouse_id: HCM, access_level: 'READ' }]);
});

test('B6 a manager cannot move a primary warehouse they do not manage', () => {
  const actorScopes = [{ warehouse_id: HCM, access_level: 'FULL' }];
  const target = staffTarget({ primary_warehouse_id: HN });
  const current = [{ warehouse_id: HN, access_level: 'OPERATOR' }];
  rejects(() => plan({ actor: manager, actorScopes, target, current, requested: [{ warehouse_id: HCM, access_level: 'READ' }], requestedPrimary: HCM }), 403, 'WAREHOUSE_OUT_OF_MANAGER_SCOPE');
});

test('B7 only a superuser changes a superuser; customers are never given a warehouse', () => {
  rejects(() => plan({ target: staffTarget({ is_superuser: true, roles: ['ADMIN'] }) }), 403, 'TARGET_PROTECTED');
  rejects(() => plan({ target: staffTarget({ roles: ['CUSTOMER'] }), requested: [{ warehouse_id: HCM, access_level: 'READ' }] }), 400, 'TARGET_NOT_INTERNAL');
  // clearing a customer's (stale) rows is allowed
  assert.deepEqual(plan({ target: staffTarget({ roles: ['CUSTOMER'] }), current: [{ warehouse_id: HCM, access_level: 'READ' }] }).removed.length, 1);
});

test('B8 roles without user write or WAREHOUSE_MANAGER cannot assign at all (route guard 403)', () => {
  const { authorizeAssignmentManager } = createWarehouseAssignmentController({ prisma: {}, directory: {} });
  const run = (auth, method = 'PUT') => {
    let status = null;
    let passed = false;
    authorizeAssignmentManager({ auth, method }, { status: (s) => { status = s; return { json: () => {} }; } }, () => { passed = true; });
    return passed ? 'next' : status;
  };
  assert.equal(run({ sub: STAFF_ID, roles: ['WAREHOUSE_STAFF'], permissions: ['inventory.task.read'] }), 403);
  assert.equal(run({ sub: STAFF_ID, roles: ['LIBRARIAN'], permissions: [] }), 403);
  assert.equal(run({ sub: ADMIN_ID, roles: ['AUDITOR'], permissions: ['auth.users.read'] }), 403, 'read permission does not write');
  assert.equal(run({ sub: ADMIN_ID, roles: ['AUDITOR'], permissions: ['auth.users.read'] }, 'GET'), 'next');
  assert.equal(run({ sub: MANAGER_ID, roles: ['WAREHOUSE_MANAGER'], permissions: [] }), 'next');
});

test('B9 a manager reading someone\'s scope only sees rows of their own warehouses', () => {
  const rows = [{ warehouse_id: HCM, access_level: 'READ' }, { warehouse_id: HN, access_level: 'FULL' }];
  assert.deepEqual(visibleRowsFor(manager, [{ warehouse_id: HCM, access_level: 'READ' }], rows), [rows[0]]);
  assert.deepEqual(visibleRowsFor(admin, [], rows), rows);
});

// ── warehouse directory (service-to-service, fail-closed) ───────────────────

test('C1 warehouse lookup goes to inventory-service with the internal key and fails closed', async () => {
  const calls = [];
  const directory = createWarehouseDirectory({
    inventoryUrl: 'http://inventory', internalKey: 'k',
    fetchImpl: async (url, init) => {
      calls.push({ url, key: init.headers['x-internal-service-key'] });
      return { ok: true, status: 200, json: async () => ({ data: [{ id: HCM, code: 'WH-HCM-01', name: 'HCM', is_active: true }] }) };
    },
  });
  const found = await directory.lookup([HCM, HCM]);
  assert.equal(found.get(HCM).code, 'WH-HCM-01');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].key, 'k');
  assert.ok(calls[0].url.startsWith('http://inventory/internal/warehouses?ids='));

  const down = createWarehouseDirectory({ inventoryUrl: 'http://inventory', internalKey: 'k', fetchImpl: async () => { throw new Error('ECONNREFUSED'); } });
  await assert.rejects(() => down.lookup([HCM]), WarehouseDirectoryUnavailableError);
  const noKey = createWarehouseDirectory({ inventoryUrl: 'http://inventory', internalKey: '', fetchImpl: async () => ({ ok: true }) });
  await assert.rejects(() => noKey.lookup([HCM]), WarehouseDirectoryUnavailableError);
  // invalidation is best effort and never throws
  assert.equal(await down.notifyScopeChanged(STAFF_ID), false);
});

test('C2 PUT answers 503 and changes nothing when the warehouse directory is down', async () => {
  let transactionStarted = false;
  const controller = createWarehouseAssignmentController({
    prisma: { $transaction: async () => { transactionStarted = true; } },
    directory: { lookup: async () => { throw new WarehouseDirectoryUnavailableError(); }, notifyScopeChanged: async () => true },
  });
  let status = null;
  let body = null;
  await controller.replaceUserWarehouseScopes(
    { params: { id: STAFF_ID }, auth: { sub: ADMIN_ID, roles: ['ADMIN'], permissions: ['auth.users.write'] }, body: { scopes: [{ warehouse_id: HCM, access_level: 'READ' }] }, headers: {} },
    { status: (s) => { status = s; return { json: (b) => { body = b; } }; }, json: (b) => { body = b; } },
  );
  assert.equal(status, 503);
  assert.equal(body.code, 'WAREHOUSE_DIRECTORY_UNAVAILABLE');
  assert.equal(transactionStarted, false);
});
