import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import test from 'node:test';
import { root } from './helpers/shell-sandbox.mjs';

// Proposed helper contract, intentionally RED until Phase 5 implementation.
// This specifies new behavior; it is not claimed as a runtime reproduction of
// an existing helper. Services still require their own real restart/drain tests.
function createLifecycle(options) {
  const require = createRequire(import.meta.url);
  const { createServiceLifecycle } = require(resolve(root, 'packages/shared/runtime/lifecycle.cjs'));
  return createServiceLifecycle(options);
}

test('PRA-17 shutdown becomes unready immediately and closes resources only after HTTP and job drain', async () => {
  const events = [];
  let releaseHttp;
  let releaseWork;
  const work = new Promise((resolveWork) => { releaseWork = resolveWork; });
  const lifecycle = createLifecycle({
    server: { close(done) { events.push('http-stop'); releaseHttp = done; } },
    stopWork: [async () => { events.push('work-stop'); await work; events.push('work-drained'); }],
    closeResources: [async () => { events.push('resources-closed'); }],
    timeoutMs: 500,
    onExit(code) { events.push(`exit-${code}`); },
  });
  assert.equal(lifecycle.isReady(), true);
  const finishing = lifecycle.shutdown('SIGTERM');
  assert.equal(lifecycle.isReady(), false);
  await Promise.resolve();
  assert.equal(events.includes('resources-closed'), false);
  releaseHttp();
  await Promise.resolve();
  assert.equal(events.includes('resources-closed'), false, 'HTTP drain alone cannot close resources used by a worker');
  releaseWork();
  await finishing;
  assert.equal(events.filter((entry) => entry === 'resources-closed').length, 1);
  assert.equal(events.at(-1), 'exit-0');
});

test('PRA-17 duplicate shutdown signals do not execute resource cleanup twice', async () => {
  let closed = 0;
  let stopped = 0;
  const lifecycle = createLifecycle({
    server: { close(done) { stopped++; done(); } },
    stopWork: [],
    closeResources: [async () => { closed++; }],
    timeoutMs: 500,
    onExit() {},
  });
  await Promise.all([lifecycle.shutdown('SIGTERM'), lifecycle.shutdown('SIGINT')]);
  assert.equal(stopped, 1);
  assert.equal(closed, 1);
});

test('PRA-17 an unresponsive drain has a bounded nonzero exit', async () => {
  const exits = [];
  const lifecycle = createLifecycle({
    server: { close() {}, closeAllConnections() {} },
    stopWork: [],
    closeResources: [],
    timeoutMs: 20,
    onExit(code) { exits.push(code); },
  });
  const result = await lifecycle.shutdown('SIGTERM');
  assert.equal(result.timedOut, true);
  assert.deepEqual(exits, [1]);
});
