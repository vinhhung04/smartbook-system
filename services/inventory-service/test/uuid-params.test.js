const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { rejectInvalidUuidParams } = require('../src/middlewares/uuid-params.middleware');

// A malformed id used to reach Prisma (P2023) and come back as a 500.

async function withServer(router, fn) {
  const app = express();
  app.use('/api/things', router);
  const server = app.listen(0);
  try {
    await fn(`http://127.0.0.1:${server.address().port}/api/things`);
  } finally {
    server.close();
  }
}

function buildRouter() {
  const router = express.Router();
  router.get('/summary', (_req, res) => res.json({ route: 'summary' }));
  router.get('/:id', (req, res) => res.json({ id: req.params.id }));
  router.post('/:taskType/:taskId/approve', (req, res) => res.json(req.params));
  return rejectInvalidUuidParams(router);
}

test('malformed uuid path params are rejected with 400, not passed to the handler', async () => {
  await withServer(buildRouter(), async (base) => {
    const bad = await fetch(`${base}/not-a-uuid`);
    assert.equal(bad.status, 400);
    assert.deepEqual(await bad.json(), { message: 'Invalid id' });

    const badTask = await fetch(`${base}/outbound/123/approve`, { method: 'POST' });
    assert.equal(badTask.status, 400);
    assert.deepEqual(await badTask.json(), { message: 'Invalid taskId' });
  });
});

test('valid uuids, non-uuid param names and literal routes pass through', async () => {
  await withServer(buildRouter(), async (base) => {
    const id = '0B5F1C2E-3D4A-4B6C-8D9E-0F1A2B3C4D5E';
    assert.deepEqual(await (await fetch(`${base}/${id}`)).json(), { id });

    const taskId = '00000000-0000-4000-8000-000000000000';
    const approved = await fetch(`${base}/outbound/${taskId}/approve`, { method: 'POST' });
    assert.deepEqual(await approved.json(), { taskType: 'outbound', taskId });

    assert.deepEqual(await (await fetch(`${base}/summary`)).json(), { route: 'summary' });
  });
});
