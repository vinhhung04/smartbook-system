const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createInternalRouter } = require('../src/routes/internal.routes');

const USER_ID = '11111111-1111-4111-8111-111111111111';
const users = {
  [USER_ID]: {
    id: USER_ID, status: 'ACTIVE', is_superuser: false, deleted_at: null,
    user_warehouse_scopes: [{ warehouse_id: '00000000-0000-0000-0000-000000000003', access_level: 'READ' }],
  },
};
const prisma = { user: { findUnique: async ({ where }) => users[where.id] || null } };

async function call(path, headers = {}, key = 'secret') {
  const app = express();
  app.use('/internal', createInternalRouter({ prisma, internalKey: key }));
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { headers });
    return { status: res.status, body: await res.json() };
  } finally {
    server.close();
  }
}

test('warehouse scopes are only served to callers with the internal key', async () => {
  assert.equal((await call(`/internal/users/${USER_ID}/warehouse-scopes`)).status, 403);
  assert.equal((await call(`/internal/users/${USER_ID}/warehouse-scopes`, { 'x-internal-service-key': 'wrong' })).status, 403);
  // An unset key rejects everyone instead of accepting an empty header.
  assert.equal((await call(`/internal/users/${USER_ID}/warehouse-scopes`, { 'x-internal-service-key': '' }, '')).status, 403);
});

test('returns status, superuser flag and every scope row of the user', async () => {
  const { status, body } = await call(`/internal/users/${USER_ID}/warehouse-scopes`, { 'x-internal-service-key': 'secret' });
  assert.equal(status, 200);
  assert.deepEqual(body.data, {
    user_id: USER_ID, status: 'ACTIVE', deleted: false, is_superuser: false,
    scopes: [{ warehouse_id: '00000000-0000-0000-0000-000000000003', access_level: 'READ' }],
  });
});

test('unknown user is 404 and a malformed id is 400', async () => {
  const headers = { 'x-internal-service-key': 'secret' };
  assert.equal((await call('/internal/users/22222222-2222-4222-8222-222222222222/warehouse-scopes', headers)).status, 404);
  assert.equal((await call('/internal/users/not-a-uuid/warehouse-scopes', headers)).status, 400);
});
