// A real child HTTP process using the production lifecycle, PostgreSQL and an
// idempotent remote HTTP boundary. No business controller or lease is repaired.
const http = require('node:http');
const { PrismaClient } = require('@prisma/client');
const { createServiceLifecycle } = require('@smartbook/shared/runtime');
const prisma = new PrismaClient();
const events = [];
let releaseTx, releaseJob;
const txGate = new Promise(resolve => { releaseTx = resolve; });
const jobGate = new Promise(resolve => { releaseJob = resolve; });
const id = process.env.LIFECYCLE_OPERATION_ID;
let lifecycle, admittedWork = false;
const emit = event => process.send?.({ event, events: [...events], ready: lifecycle?.isReady() });
const server = http.createServer((req, res) => lifecycle.middleware(req, res, async () => {
  if (req.url === '/inspect') {
    const record = await prisma.integration_outbox.findUnique({ where: { id } });
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ status: record?.status, payload: record?.payload, lease_until: record?.lease_until }));
  }
  if (req.url !== '/work') { res.statusCode = 404; return res.end(); }
  admittedWork = true;
  try {
    const record = await prisma.integration_outbox.findUnique({ where: { id } }) || await prisma.integration_outbox.create({ data: {
      id, aggregate_type: 'LIFECYCLE_TEST', aggregate_id: id, event_type: 'LIFECYCLE_TEST', status: 'PROCESSING',
      lease_until: new Date(Date.now() + 30 * 60_000),
      payload: { version: 1, state: 'REMOTE_STARTED', remote_started: true, plan: { operation_id: id, remote_key: id } },
    } });
    emit('plan-persisted');
    const response = await fetch(process.env.LIFECYCLE_REMOTE_URL, { method: 'POST', headers: { 'idempotency-key': id }, body: id });
    if (!response.ok) throw new Error('remote failed');
    events.push('remote-complete');
    emit('remote-complete');
    await prisma.$transaction(async tx => {
      await tx.integration_outbox.update({ where: { id }, data: { status: 'PUBLISHED', published_at: new Date(), payload: { ...record.payload, state: 'COMPLETED' } } });
      emit('transaction-open');
      await txGate;
    }, { timeout: 10_000 });
    events.push('transaction-committed');
    res.end('committed');
  } catch (_error) { res.statusCode = 500; res.end('failed'); }
}));
lifecycle = createServiceLifecycle({ server, timeoutMs: Number(process.env.LIFECYCLE_TIMEOUT_MS || 3000),
  stopWork: [async () => { if (admittedWork) await jobGate; events.push('job-drained'); }],
  closeResources: [async () => { events.push('broker-closed'); }, async () => { events.push('redis-closed'); },
    async () => { await prisma.$disconnect(); events.push('database-closed'); }, async () => { events.push('telemetry-closed'); }],
  onExit: code => process.send({ event: 'exit', code, events, ready: lifecycle.isReady() }, () => process.exit(code)),
});
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { lifecycle.shutdown(signal); emit('draining'); });
process.on('message', message => {
  if (message === 'release-tx') releaseTx();
  if (message === 'release-job') releaseJob();
});
server.listen(0, '127.0.0.1', () => process.send({ event: 'listening', port: server.address().port }));
