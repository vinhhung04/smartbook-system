import assert from 'node:assert/strict';
import Module from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { root } from './helpers/shell-sandbox.mjs';

function load() {
  const observations = [];
  const filename = resolve(root, 'services/borrow-service/src/lib/metrics.js');
  const module = new Module(filename);
  module.filename = filename;
  module.require = id => {
    if (id === '@smartbook/shared/metrics') return { getMeter: () => ({
      createCounter: () => ({ add: (value, attributes) => observations.push({ value, attributes }) }),
      createObservableGauge: () => ({ addCallback() {} }),
    }) };
    if (id === './prisma') return { prisma: {} };
    if (id === '../services/reconciliation-queue.service') return { getQueueState() {} };
    throw new Error(`Unexpected metric dependency ${id}`);
  };
  module._compile(readFileSync(filename, 'utf8'), filename);
  return { ...module.exports, observations };
}

for (const [RspCode, outcome] of [['00', 'accepted'], ['02', 'replay'], ['97', 'failed'], ['99', 'failed']]) {
  test(`callback metric records ${outcome} for ${RspCode} without changing the response`, () => {
    const metrics = load(); let finish, forwarded;
    const body = { RspCode, Message: 'NON_SECRET_TEST_MESSAGE' };
    const response = { statusCode: 200, once(_event, callback) { finish = callback; }, json(value) { forwarded = value; return this; } };
    const request = { path: '/ipn' };
    metrics.recordPaymentCallback(request, response, () => {});
    assert.equal(response.json(body), response);
    assert.equal(forwarded, body);
    request.path = '/restored-router-path'; finish();
    assert.deepEqual(metrics.observations, [{ value: 1, attributes: { endpoint: 'ipn', outcome } }]);
  });
}
