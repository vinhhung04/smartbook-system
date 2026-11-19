const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const url = process.env.BORROW_POLICY_DATABASE_URL;
const options = { skip: !url && 'Independent audit PostgreSQL required' };
let db, sweep;
test.before(() => {
  if (!url) return;
  const target = new URL(url);
  assert.equal(target.hostname, '127.0.0.1');
  assert.equal(target.pathname, '/borrow_audit');
  process.env.DATABASE_URL = url;
  db = new (require('@prisma/client').PrismaClient)();
  const p = require.resolve('../src/lib/prisma');
  require.cache[p] = { id: p, filename: p, loaded: true, exports: { prisma: db } };
  ({ runReconciliationSweep: sweep } = require('../src/jobs/reservation-reconciliation.job'));
});
test.after(async () => db?.$disconnect());
function scope(group) {
  return { ...db, integration_outbox: Object.fromEntries(['findMany', 'count', 'findFirst', 'updateMany'].map(method => [method, args => db.integration_outbox[method]({ ...args, where: { AND: [args?.where || {}, { aggregate_id: group }] } })])) };
}

test('PRA08: fifty old manual cases cannot starve a new automatic release across sweeps', options, async () => {
  const group = randomUUID();
  await db.integration_outbox.createMany({ data: Array.from({ length: 50 }, () => ({
    aggregate_type: 'READINESS_TEST', aggregate_id: group,
    event_type: 'DIRECT_LOAN_CONSUME_UNRESOLVED', payload: {},
    occurred_at: new Date('2000-01-01T00:00:00Z'),
  })) });
  const release = await db.integration_outbox.create({ data: {
    aggregate_type: 'READINESS_TEST', aggregate_id: group,
    event_type: 'RELEASE_RESERVATION', payload: { reservation_id: group, reason: 'TEST_ONLY', idempotency_key: `release:${group}` },
  } });
  const calls = [];
  // Scope reads to this additive fixture, without hiding any queue filter or LIMIT.
  const scoped = { ...db, integration_outbox: {
    findMany: args => db.integration_outbox.findMany({ ...args, where: { AND: [args.where || {}, { aggregate_id: group }] } }),
    count: args => db.integration_outbox.count({ ...args, where: { AND: [args?.where || {}, { aggregate_id: group }] } }),
    findFirst: args => db.integration_outbox.findFirst({ ...args, where: { AND: [args?.where || {}, { aggregate_id: group }] } }),
    update: args => db.integration_outbox.update(args),
    updateMany: args => db.integration_outbox.updateMany({ ...args, where: { AND: [args.where, { aggregate_id: group }] } }),
  } };
  for (let i = 0; i < 3; i++) await sweep(scoped, { limit: 50, releaseReservationFn: async p => calls.push(p) });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].idempotency_key, `release:${group}`);
  assert.equal((await db.integration_outbox.findUnique({ where: { id: release.id } })).status, 'PUBLISHED');
  assert.equal(await db.integration_outbox.count({ where: { aggregate_id: group, event_type: 'DIRECT_LOAN_CONSUME_UNRESOLVED', status: 'PENDING' } }), 50);
});

test('PRA08: two workers claim one release once; failures back off and stale leases recover', options, async () => {
  const group = randomUUID();
  const row = await db.integration_outbox.create({ data: { aggregate_type: 'READINESS_TEST', aggregate_id: group, event_type: 'RELEASE_RESERVATION', payload: { reservation_id: group } } });
  const scoped = scope(group);
  let calls = 0;
  const releaseReservationFn = async () => { calls++; await new Promise(r => setTimeout(r, 30)); throw Object.assign(new Error('test unavailable'), { status: 503 }); };
  await Promise.all([sweep(scoped, { limit: 200, releaseReservationFn }), sweep(scoped, { limit: 200, releaseReservationFn })]);
  const after = await db.integration_outbox.findUnique({ where: { id: row.id } });
  assert.equal(calls, 1);
  assert.equal(after.retry_count, 1);
  assert.equal(after.status, 'PENDING');
  assert.ok(after.next_attempt_at > new Date());
  await db.integration_outbox.update({ where: { id: row.id }, data: { status: 'PROCESSING', lease_until: new Date(Date.now() - 1000), next_attempt_at: new Date(0) } });
  await sweep(scoped, { limit: 200, releaseReservationFn: async () => { calls++; } });
  assert.equal((await db.integration_outbox.findUnique({ where: { id: row.id } })).status, 'PUBLISHED');
  assert.equal(calls, 2);
});

test('PRA08: manual resolution retains the payload and atomically records operator evidence', options, async () => {
  const { reviewReconciliation, getQueueState } = require('../src/services/reconciliation-queue.service');
  const group = randomUUID(), actorId = randomUUID();
  const row = await db.integration_outbox.create({ data: { aggregate_type: 'READINESS_TEST', aggregate_id: group, event_type: 'PAYMENT_UNAPPLIED', payload: { receipt_id: randomUUID() }, occurred_at: new Date(Date.now() - 120000) } });
  const before = await getQueueState(scope(group));
  assert.equal(before.manualPending, 1);
  assert.ok(before.oldestManualSeconds >= 119);
  await assert.rejects(reviewReconciliation(db, { id: row.id, actorId, action: 'requeue', note: 'No safe handler', evidence: 'TEST-1' }), /No safe automatic/);
  await assert.rejects(reviewReconciliation(db, { id: row.id, actorId, action: 'resolve', note: 'Missing evidence' }), /evidence reference/);
  await reviewReconciliation(db, { id: row.id, actorId, action: 'resolve', note: 'Verified outside the automated queue', evidence: 'TEST-ONLY-EVIDENCE' });
  const after = await db.integration_outbox.findUnique({ where: { id: row.id } });
  assert.equal(after.status, 'RESOLVED');
  assert.deepEqual(after.payload, row.payload);
  const audit = await db.borrow_audit_logs.findFirst({ where: { entity_id: row.id, action_name: 'RECONCILIATION_RESOLVE' } });
  assert.equal(audit.actor_user_id, actorId);
  assert.equal(audit.after_data.evidence, 'TEST-ONLY-EVIDENCE');
  assert.equal((await getQueueState(scope(group))).manualPending, 0);
});

test('PRA07: an unavailable durable queue rejects instead of reporting queued success', async () => {
  const { queueReconciliation } = require('../src/services/reconciliation.service');
  await assert.rejects(queueReconciliation({ aggregateId: randomUUID(), eventType: 'RELEASE_RESERVATION', payload: {}, db: { integration_outbox: { create: async () => { throw new Error('queue unavailable'); } } } }), /queue unavailable/);
});

test('PRA07: compensation never calls Inventory when its intent cannot be persisted', async () => {
  const { compensateWithRetry } = require('../src/services/reconciliation.service');
  let called = false;
  const db = { integration_outbox: { create: async () => { throw new Error('intent write unavailable'); } } };
  await assert.rejects(compensateWithRetry(async () => { called = true; }, { eventType: 'RELEASE_RESERVATION', db }), /intent write unavailable/);
  assert.equal(called, false);
});

test('PRA08: audit failure rolls back a manual resolution without losing the case', options, async () => {
  const { reviewReconciliation } = require('../src/services/reconciliation-queue.service');
  const row = await db.integration_outbox.create({ data: { aggregate_type: 'READINESS_TEST', event_type: 'PAYMENT_UNAPPLIED', payload: { evidence: 'retained-test-marker' } } });
  const auditUnavailable = { $transaction: fn => db.$transaction(tx => fn({
    integration_outbox: tx.integration_outbox, $queryRaw: tx.$queryRaw.bind(tx),
    borrow_audit_logs: { create: async () => { throw new Error('audit unavailable'); } },
  })) };
  await assert.rejects(reviewReconciliation(auditUnavailable, { id: row.id, actorId: randomUUID(), action: 'resolve', note: 'No silent completion', evidence: 'TEST-ONLY' }), /audit unavailable/);
  const after = await db.integration_outbox.findUnique({ where: { id: row.id } });
  assert.equal(after.status, 'PENDING');
  assert.deepEqual(after.payload, row.payload);
});

test('PRA08: exhausted automatic work is visible in the manual queue and stays bounded', options, async () => {
  const { getQueueState } = require('../src/services/reconciliation-queue.service');
  const group = randomUUID();
  const row = await db.integration_outbox.create({ data: { aggregate_type: 'READINESS_TEST', aggregate_id: group, event_type: 'RELEASE_RESERVATION', retry_count: 9, payload: { reservation_id: group } } });
  let calls = 0;
  const scoped = scope(group);
  await sweep(scoped, { releaseReservationFn: async () => { calls++; throw new Error('Persistent test failure'); } });
  await sweep(scoped, { releaseReservationFn: async () => { calls++; } });
  assert.equal(calls, 1);
  const after = await db.integration_outbox.findUnique({ where: { id: row.id } });
  assert.equal(after.status, 'FAILED');
  assert.equal(after.retry_count, 10);
  const state = await getQueueState(scoped);
  assert.equal(state.automaticPending, 0);
  assert.equal(state.manualPending, 1);
  assert.equal(state.failed, 1);
});
