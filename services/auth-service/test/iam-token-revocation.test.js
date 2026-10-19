// Copilot 3.2: changing a user's roles, or a role's permissions, ends the
// sessions that carry the old rights. inventory / analytics / borrow read roles
// and permissions from the JWT itself, so without this an old token kept the
// old permissions until it expired (up to JWT_EXPIRES_IN).
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const USER = '11111111-1111-4111-8111-111111111111';
const ROLE = '22222222-2222-4222-8222-222222222222';
const HOLDERS = ['33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444'];

const revoked = [];
const fakeRedis = {
  set: async (key, value) => { revoked.push([key, value]); return true; },
  setStrict: async (key, value) => { revoked.push([key, value]); },
  get: async () => null,
};
const tx = {
  $queryRawUnsafe: async (sql) => {
    if (/FROM roles WHERE id = ANY/.test(sql)) return [{ id: ROLE }];
    if (/FROM user_roles WHERE role_id/.test(sql)) return HOLDERS.map((user_id) => ({ user_id }));
    if (/FROM permissions/.test(sql)) return [];
    if (/SELECT id FROM roles WHERE id = \$1/.test(sql)) return [{ id: ROLE }];
    if (/FROM users/.test(sql) || /UPDATE users/.test(sql)) return [{ id: USER, status: 'ACTIVE' }];
    return [];
  },
  $executeRawUnsafe: async () => 1,
};
const fakePrisma = { $transaction: async (fn) => fn(tx), auditLog: { create: async () => ({}) } };

const realLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === '../lib/prisma') return fakePrisma;
  if (request === './redis' && parent?.filename?.endsWith('token-revocation.js')) return fakeRedis;
  return realLoad.call(this, request, parent, isMain);
};
const iam = require('../src/controllers/iam.controller');

function res() {
  return { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}
const req = (params, body) => ({ params, body, user: { sub: 'admin', is_superuser: true }, headers: {}, ip: '127.0.0.1' });

test('a role change revokes the user\'s existing tokens', async () => {
  revoked.length = 0;
  const r = res();
  await iam.updateUser(req({ id: USER }, { role_ids: [ROLE] }), r);
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.deepEqual(revoked.map(([key]) => key), [`user:tokens-valid-after:${USER}`]);
});

test('a profile-only edit keeps the sessions', async () => {
  revoked.length = 0;
  const r = res();
  await iam.updateUser(req({ id: USER }, { full_name: 'New Name' }), r);
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.deepEqual(revoked, []);
});

test('changing a role\'s permissions revokes every holder\'s tokens', async () => {
  revoked.length = 0;
  const r = res();
  await iam.updateRolePermissions(req({ id: ROLE }, { permission_ids: [] }), r);
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.deepEqual(revoked.map(([key]) => key).sort(), HOLDERS.map((id) => `user:tokens-valid-after:${id}`).sort());
});
