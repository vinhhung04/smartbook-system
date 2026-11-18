const test = require('node:test');
const assert = require('node:assert/strict');
const { fork } = require('node:child_process');
const http = require('node:http');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const url = process.env.BORROW_POLICY_DATABASE_URL;

test('PRA17 real Node process drains SIGTERM HTTP/PG/remote work and retains timed-out durable intent', { skip: !url }, async t => {
  const target = new URL(url);
  assert.ok(['127.0.0.1', 'localhost'].includes(target.hostname) && target.pathname === '/borrow_audit');
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const remoteKeys = new Set();
  let remoteCalls = 0;
  const remote = http.createServer((req, res) => {
    remoteCalls++;
    remoteKeys.add(req.headers['idempotency-key']);
    req.resume(); req.on('end', () => res.end('committed remotely'));
  });
  await new Promise(resolve => remote.listen(0, '127.0.0.1', resolve));
  const children = [];
  function launch(id, timeout = 3000) {
    const child = fork(path.join(__dirname, 'helpers/lifecycle-process.cjs'), [], { env: { ...process.env, DATABASE_URL: url,
      LIFECYCLE_OPERATION_ID: id, LIFECYCLE_TIMEOUT_MS: String(timeout), LIFECYCLE_REMOTE_URL: `http://127.0.0.1:${remote.address().port}` }, silent: true });
    children.push(child);
    const messages = [], waiters = [];
    let output = '';
    child.stdout.on('data', data => { output += data; });
    child.stderr.on('data', data => { output += data; });
    child.on('message', message => {
      messages.push(message);
      for (const waiter of [...waiters]) if (waiter.event === message.event) { waiters.splice(waiters.indexOf(waiter), 1); waiter.resolve(message); }
    });
    const exit = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal, output })));
    function event(name) {
      const saved = messages.find(message => message.event === name);
      if (saved) return Promise.resolve(saved);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`No ${name} from lifecycle child`)), 8000);
        waiters.push({ event: name, resolve: message => { clearTimeout(timer); resolve(message); } });
      });
    }
    return { child, event, exit, messages };
  }
  try {
    await t.test('duplicate SIGTERM waits for response, transaction and worker before closing resources', async () => {
      const id = randomUUID(), process = launch(id);
      const { port } = await process.event('listening');
      const response = fetch(`http://127.0.0.1:${port}/work`);
      await process.event('transaction-open');
      process.child.kill('SIGTERM');
      const state = await process.event('draining');
      assert.equal(state.ready, false);
      process.child.kill('SIGTERM');
      await new Promise(resolve => setTimeout(resolve, 25));
      assert.equal(process.child.exitCode, null, 'second signal must not bypass drain');
      assert.equal(state.events.includes('database-closed'), false);
      process.child.send('release-tx');
      assert.equal(await (await response).text(), 'committed');
      assert.equal(process.child.exitCode, null, 'worker still owns resources after HTTP drain');
      process.child.send('release-job');
      const exited = await process.event('exit');
      assert.deepEqual(exited.events, ['remote-complete', 'transaction-committed', 'job-drained', 'broker-closed', 'redis-closed', 'database-closed', 'telemetry-closed']);
      assert.equal((await process.exit).code, 0);
      const restarted = launch(id);
      const restartPort = (await restarted.event('listening')).port;
      const persisted = await (await fetch(`http://127.0.0.1:${restartPort}/inspect`)).json();
      assert.equal(persisted.status, 'PUBLISHED');
      assert.equal(remoteKeys.has(id), true);
      restarted.child.kill('SIGTERM');
      assert.equal((await restarted.exit).code, 0);
    });
    await t.test('bounded forced exit preserves the committed remote key, original plan and PROCESSING lease', async () => {
      const id = randomUUID(), process = launch(id, 100);
      const { port } = await process.event('listening');
      const response = fetch(`http://127.0.0.1:${port}/work`).then(res => res.text(), () => null);
      await process.event('transaction-open');
      const before = await prisma.integration_outbox.findUnique({ where: { id } });
      process.child.kill('SIGTERM');
      const result = await process.exit;
      assert.equal(result.code, 1);
      await response;
      const persisted = await prisma.integration_outbox.findUnique({ where: { id } });
      assert.equal(persisted.status, 'PROCESSING');
      assert.deepEqual(persisted.payload, before.payload);
      assert.equal(persisted.lease_until.getTime(), before.lease_until.getTime());
      assert.equal(remoteKeys.has(id), true);
      const restarted = launch(id);
      const restartPort = (await restarted.event('listening')).port;
      const inspected = await (await fetch(`http://127.0.0.1:${restartPort}/inspect`)).json();
      assert.equal(inspected.status, 'PROCESSING');
      assert.equal(inspected.payload.plan.remote_key, id);
      restarted.child.kill('SIGTERM');
      assert.equal((await restarted.exit).code, 0);
      assert.equal(remoteCalls, 2, 'restart inspection must not repeat either remote mutation');
    });
  } finally {
    for (const child of children) if (child.exitCode == null && child.signalCode == null) child.kill('SIGKILL');
    await new Promise(resolve => remote.close(resolve));
    await prisma.$disconnect();
  }
});
