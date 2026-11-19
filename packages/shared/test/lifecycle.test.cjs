const test = require('node:test');
const assert = require('node:assert/strict');
const { createServiceLifecycle } = require('../runtime/lifecycle.cjs');

test('a failed stop hook does not exit while another admitted worker is still draining', async () => {
  const exits = [];
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const lifecycle = createServiceLifecycle({ server: { close(done) { done(); } },
    stopWork: [async () => { throw new Error('stop failed'); }, () => pending],
    timeoutMs: 500, onExit: code => exits.push(code) });
  const ending = lifecycle.shutdown();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(exits, [], 'failure cannot truncate another in-flight worker');
  release();
  const result = await ending;
  assert.equal(result.failed, true);
  assert.deepEqual(exits, [1]);
});

test('resource cleanup continues after one resource fails and reports nonzero exit', async () => {
  const closed = [], exits = [];
  const lifecycle = createServiceLifecycle({ server: { close(done) { done(); } }, closeResources: [
    async () => { closed.push('broker'); throw new Error('broker close failed'); },
    async () => { closed.push('database'); }, async () => { closed.push('telemetry'); },
  ], timeoutMs: 500, onExit: code => exits.push(code) });
  await lifecycle.shutdown();
  assert.deepEqual(closed, ['broker', 'database', 'telemetry']);
  assert.deepEqual(exits, [1]);
});

test('draining admission rejects newly queued work before business middleware', async () => {
  let closeHttp;
  const lifecycle = createServiceLifecycle({ server: { close(done) { closeHttp = done; } }, timeoutMs: 500, onExit() {} });
  let admitted = 0;
  const response = { statusCode: 200, headers: {}, setHeader(name, value) { this.headers[name] = value; }, end(value) { this.body = value; } };
  lifecycle.middleware({}, response, () => admitted++);
  const ending = lifecycle.shutdown();
  lifecycle.middleware({}, response, () => admitted++);
  assert.equal(admitted, 1);
  assert.equal(response.statusCode, 503);
  assert.equal(response.headers.Connection, 'close');
  closeHttp();
  await ending;
});
