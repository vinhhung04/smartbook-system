const test = require('node:test');
const assert = require('node:assert/strict');
let release, sweeps = 0;
const blocked = new Promise(resolve => { release = resolve; });
const servicePath = require.resolve('../src/services/fine.service');
require.cache[servicePath] = { id: servicePath, filename: servicePath, loaded: true, exports: {
  async runOverdueSweep() { sweeps++; await blocked; return { scanned: 0 }; },
} };
const { startOverdueSweepJob, stopOverdueSweepJob } = require('../src/jobs/overdue.job');
test('Borrow worker stop awaits its admitted operation and prevents another sweep', async () => {
  startOverdueSweepJob();
  let stopped = false;
  const ending = stopOverdueSweepJob().then(() => { stopped = true; });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(stopped, false);
  release();
  await ending;
  startOverdueSweepJob();
  assert.equal(sweeps, 1);
});
