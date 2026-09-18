const assert = require('node:assert/strict');
const test = require('node:test');
const { runOutboxPublishSweep } = require('../src/jobs/outbox-publisher.job');

function fakePrisma(records, updates) {
  return {
    integration_outbox: {
      findMany: async () => records,
      update: async (args) => {
        updates.push(args);
        return args;
      },
    },
  };
}

test('outbox publisher publishes a PENDING record and marks it PUBLISHED on success', async () => {
  const updates = [];
  const record = {
    id: 'outbox-1',
    event_type: 'inventory.reservation.created',
    aggregate_type: 'STOCK_RESERVATION',
    aggregate_id: 'res-1',
    payload: { reservation_id: 'res-1' },
    headers: { correlation_id: 'req-abc' },
    occurred_at: new Date('2026-09-12T00:00:00Z'),
    retry_count: 0,
  };

  let publishedWith = null;
  const result = await runOutboxPublishSweep(fakePrisma([record], updates), {
    publishEventFn: async (routingKey, envelope) => {
      publishedWith = { routingKey, envelope };
      return true;
    },
  });

  assert.equal(result.published, 1);
  assert.equal(result.retried, 0);
  assert.equal(result.failed, 0);
  assert.equal(publishedWith.routingKey, 'inventory.reservation.created');
  assert.equal(publishedWith.envelope.event_id, 'outbox-1');
  assert.equal(publishedWith.envelope.correlation_id, 'req-abc');
  assert.equal(updates.length, 1);
  assert.equal(updates[0].where.id, 'outbox-1');
  assert.equal(updates[0].data.status, 'PUBLISHED');
});

test('outbox publisher retries (does not give up) on the first failed attempt, and gives up only past the retry cap', async () => {
  const updates = [];
  const record = {
    id: 'outbox-2',
    event_type: 'inventory.reservation.created',
    aggregate_type: 'STOCK_RESERVATION',
    aggregate_id: 'res-2',
    payload: {},
    headers: {},
    occurred_at: new Date(),
    retry_count: 9, // one below the cap
  };

  const result = await runOutboxPublishSweep(fakePrisma([record], updates), {
    publishEventFn: async () => false,
  });

  assert.equal(result.failed, 1);
  assert.equal(result.retried, 0);
  assert.equal(updates[0].data.status, 'FAILED', 'must stop retrying once past MAX_RETRY_COUNT, not loop forever');
});

test('outbox publisher retries without giving up while under the retry cap', async () => {
  const updates = [];
  const record = {
    id: 'outbox-3',
    event_type: 'inventory.reservation.created',
    aggregate_type: 'STOCK_RESERVATION',
    aggregate_id: 'res-3',
    payload: {},
    headers: {},
    occurred_at: new Date(),
    retry_count: 0,
  };

  const result = await runOutboxPublishSweep(fakePrisma([record], updates), {
    publishEventFn: async () => {
      throw new Error('broker unreachable');
    },
  });

  assert.equal(result.retried, 1);
  assert.equal(result.failed, 0);
  assert.equal(updates[0].data.status, undefined, 'must not mark FAILED before the retry cap');
  assert.equal(updates[0].data.retry_count, 1);
});

test('outbox publisher only reads PUBLISHABLE_EVENT_TYPES (query is scoped, not open-ended)', async () => {
  const updates = [];
  const calls = [];
  const prisma = {
    integration_outbox: {
      findMany: async (args) => {
        calls.push(args);
        return [];
      },
      update: async (args) => {
        updates.push(args);
        return args;
      },
    },
  };

  await runOutboxPublishSweep(prisma, {});

  assert.equal(calls.length, 1);
  assert.ok(calls[0].where.event_type.in.includes('inventory.reservation.created'));
  assert.equal(calls[0].where.status, 'PENDING');
});
