import assert from 'node:assert/strict';
import Module, { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { root } from './helpers/shell-sandbox.mjs';

function inventoryMetrics({ count = 601, oldest = new Date(Date.now() - 90_000) } = {}) {
  const gauges = new Map();
  const prisma = {
    integration_outbox: {
      count: async () => count,
      aggregate: async () => ({ _min: { occurred_at: oldest } }),
    },
    $queryRaw: async () => [{ low_stock_variants: 0 }],
  };
  const meter = {
    createObservableGauge(name) { return { addCallback(callback) { gauges.set(name, callback); } }; },
    createCounter() { return { add() {} }; },
  };
  const filename = resolve(root, 'services/inventory-service/src/lib/metrics.js');
  const localRequire = createRequire(filename);
  const module = new Module(filename);
  module.filename = filename;
  module.require = (id) => {
    if (id === '@smartbook/shared/metrics') return { getMeter: () => meter };
    if (id === './prisma') return { prisma };
    return localRequire(id);
  };
  module._compile(readFileSync(filename, 'utf8'), filename);
  return gauges;
}

test('PRA-18 pending gauge reports the full persisted backlog, including records outside the worker batch', async () => {
  const gauges = inventoryMetrics({ count: 601 });
  const callback = gauges.get('outbox_pending_total');
  assert.ok(callback);
  let observed;
  await callback({ observe(value) { observed = value; } });
  assert.equal(observed, 601, 'batch-sized or restart-zero values conceal the actual queue');
});

test('PRA-18 oldest pending age is observable before the first publisher sweep', async () => {
  const gauges = inventoryMetrics();
  const callback = gauges.get('outbox_oldest_pending_age_seconds');
  assert.ok(callback, 'count alone cannot distinguish a growing backlog from a stuck old event');
  let observed;
  await callback({ observe(value) { observed = value; } });
  assert.ok(observed >= 90 && observed < 95, `expected oldest age near 90 seconds, got ${observed}`);
});
