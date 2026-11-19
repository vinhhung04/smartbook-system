// Unit test for the /dashboard analysis period (query window and axis labels).
// Run: pnpm --filter web test:unit
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { test } from 'node:test';
import { transformWithEsbuild } from 'vite';

const cacheDir = new URL('../node_modules/.cache/dashboard-period-tests/', import.meta.url);
await mkdir(cacheDir, { recursive: true });
const source = await readFile(new URL('../src/components/pages/dashboard/period.ts', import.meta.url), 'utf8');
const { code } = await transformWithEsbuild(source, 'period.ts', { loader: 'ts', format: 'esm' });
const target = new URL('period.mjs', cacheDir);
await writeFile(target, code);
const { periodParams, bucketLabel, longBucketLabel } = await import(target.href);

const now = new Date('2026-11-19T07:00:00Z');

test('day periods go back 30 or 90 days by day', () => {
  assert.deepEqual(periodParams('30d', now), { from: '2026-10-20T07:00:00.000Z', granularity: 'day' });
  assert.equal(periodParams('90d', now).from, '2026-08-21T07:00:00.000Z');
});

test('12 months starts at local midnight on the 1st, 11 months back (12 buckets), by month', () => {
  const params = periodParams('12m', now);
  const from = new Date(params.from);
  assert.equal(params.granularity, 'month');
  assert.deepEqual([from.getFullYear(), from.getMonth(), from.getDate(), from.getHours()], [2025, 11, 1, 0]);
});

test('labels read day and month buckets', () => {
  assert.equal(bucketLabel('2026-10-23'), '23/10');
  assert.equal(bucketLabel('2026-10'), '10/2026');
  assert.equal(longBucketLabel('2026-10'), 'Tháng 10/2026');
  assert.equal(bucketLabel('weird'), 'weird');
});
