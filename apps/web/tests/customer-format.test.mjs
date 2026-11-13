// Unit test for the customer portal's month gap-filling used by the reading-stats chart.
// Run: pnpm --filter web test:unit
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { test } from 'node:test';
import { transformWithEsbuild } from 'vite';

const cacheDir = new URL('../node_modules/.cache/customer-format-tests/', import.meta.url);
await mkdir(cacheDir, { recursive: true });
const source = await readFile(new URL('../src/components/pages/customer/_shared/customer-format.ts', import.meta.url), 'utf8');
const { code } = await transformWithEsbuild(source, 'customer-format.ts', { loader: 'ts', format: 'esm' });
const target = new URL('customer-format.mjs', cacheDir);
await writeFile(target, code);
const { fillMonths } = await import(target.href);

test('fillMonths zero-fills a window ending at the current month, across a year boundary', () => {
  const out = fillMonths([{ month: '2025-11', count: 3 }, { month: '2026-01', count: 20 }], 4, new Date(2026, 1, 15));
  assert.deepEqual(out.map((m) => [m.month, m.label, m.count]), [
    ['2025-11', '11/25', 3],
    ['2025-12', '12/25', 0],
    ['2026-01', '1/26', 20],
    ['2026-02', '2/26', 0],
  ]);
});

test('fillMonths with no data still returns an empty window', () => {
  const out = fillMonths([], 3, new Date(2026, 10, 13));
  assert.deepEqual(out.map((m) => m.month), ['2026-09', '2026-10', '2026-11']);
  assert.ok(out.every((m) => m.count === 0));
});
