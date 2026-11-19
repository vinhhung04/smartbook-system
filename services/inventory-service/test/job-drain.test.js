const test = require('node:test');
const assert = require('node:assert/strict');
let release, sweeps = 0;
const blocked = new Promise(resolve => { release = resolve; });
const prismaPath = require.resolve('../src/lib/prisma');
require.cache[prismaPath] = { id: prismaPath, filename: prismaPath, loaded: true, exports: { prisma: {
  integration_outbox: { async findMany() { sweeps++; await blocked; return []; } },
} } };
const { startOutboxPublisherJob, stopOutboxPublisherJob } = require('../src/jobs/outbox-publisher.job');
test('publisher stop awaits the admitted DB sweep and cannot schedule work afterward', async () => {
  startOutboxPublisherJob();
  let stopped = false;
  const ending = stopOutboxPublisherJob().then(() => { stopped = true; });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(stopped, false);
  release();
  await ending;
  startOutboxPublisherJob();
  assert.equal(sweeps, 1);
});
