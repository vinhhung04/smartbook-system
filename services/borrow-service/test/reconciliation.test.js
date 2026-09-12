const assert = require('node:assert/strict');
const test = require('node:test');
const { compensateWithRetry } = require('../src/services/reconciliation.service');
const { runReconciliationSweep } = require('../src/jobs/reservation-reconciliation.job');

test('compensateWithRetry succeeds without retrying when the first attempt works', async () => {
  let calls = 0;
  const result = await compensateWithRetry(async () => {
    calls += 1;
  }, { aggregateId: 'r1', eventType: 'RELEASE_RESERVATION', payload: {} });

  assert.equal(result.ok, true);
  assert.equal(calls, 1);
});

test('compensateWithRetry retries a transient failure and succeeds on a later attempt', async () => {
  let calls = 0;
  const result = await compensateWithRetry(async () => {
    calls += 1;
    if (calls < 2) throw new Error('transient');
  }, { aggregateId: 'r1', eventType: 'RELEASE_RESERVATION', payload: {}, backoffMs: 1 });

  assert.equal(result.ok, true);
  assert.equal(calls, 2);
});

test('compensateWithRetry gives up after maxAttempts and reports failure without throwing', async () => {
  let calls = 0;
  const result = await compensateWithRetry(async () => {
    calls += 1;
    throw new Error('still failing');
  }, { aggregateId: 'r1', eventType: 'RELEASE_RESERVATION', payload: {}, maxAttempts: 2, backoffMs: 1 });

  assert.equal(result.ok, false);
  assert.equal(calls, 2);
  assert.equal(result.error.message, 'still failing');
});

test('reconciliation job auto-retries a RELEASE_RESERVATION outbox record and marks it PUBLISHED on success', async () => {
  const updates = [];
  const fakeRecord = {
    id: 'outbox-1',
    event_type: 'RELEASE_RESERVATION',
    payload: { reservation_id: 'res-1', reason: 'ROLLBACK_AFTER_BORROW_TX_FAIL' },
    retry_count: 0,
  };
  const fakePrisma = {
    integration_outbox: {
      findMany: async () => [fakeRecord],
      update: async (args) => {
        updates.push(args);
        return args;
      },
    },
  };

  let releaseCalledWith = null;
  const result = await runReconciliationSweep(fakePrisma, {
    releaseReservationFn: async (args) => {
      releaseCalledWith = args;
    },
  });

  assert.equal(result.resolved, 1);
  assert.equal(result.needsManualReview, 0);
  assert.equal(releaseCalledWith.reservation_id, 'res-1');
  assert.equal(updates.length, 1);
  assert.equal(updates[0].where.id, 'outbox-1');
  assert.equal(updates[0].data.status, 'PUBLISHED');
});

test('reconciliation job retries (not gives up) on the first failed attempt, and gives up only past the retry cap', async () => {
  const updates = [];
  const fakeRecord = {
    id: 'outbox-3',
    event_type: 'RELEASE_RESERVATION',
    payload: { reservation_id: 'res-2', reason: 'ROLLBACK_AFTER_BORROW_TX_FAIL' },
    retry_count: 9, // one below the cap
  };
  const fakePrisma = {
    integration_outbox: {
      findMany: async () => [fakeRecord],
      update: async (args) => {
        updates.push(args);
        return args;
      },
    },
  };

  const result = await runReconciliationSweep(fakePrisma, {
    releaseReservationFn: async () => {
      throw new Error('inventory-service still unreachable');
    },
  });

  assert.equal(result.failed, 1);
  assert.equal(result.retried, 0);
  assert.equal(updates[0].data.status, 'FAILED', 'must stop retrying once past MAX_RETRY_COUNT, not loop forever');
});

test('reconciliation job leaves an unknown event_type pending for manual review instead of guessing', async () => {
  const updates = [];
  const fakeRecord = {
    id: 'outbox-2',
    event_type: 'DIRECT_LOAN_CONSUME_UNRESOLVED',
    payload: { loan_id: 'loan-1' },
    retry_count: 0,
  };
  const fakePrisma = {
    integration_outbox: {
      findMany: async () => [fakeRecord],
      update: async (args) => {
        updates.push(args);
        return args;
      },
    },
  };

  const result = await runReconciliationSweep(fakePrisma, {});

  assert.equal(result.needsManualReview, 1);
  assert.equal(result.resolved, 0);
  assert.equal(updates.length, 0, 'must not touch a record it has no safe automatic action for');
});
