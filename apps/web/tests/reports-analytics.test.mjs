// Reports page, analytics mode (manager without circulation desk access): pure helpers.
// Run: pnpm --filter web test:unit (transpiled with Vite's esbuild, like ai-import-workspace.test.mjs).
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { test } from 'node:test';
import { transformWithEsbuild } from 'vite';

const cacheDir = new URL('../node_modules/.cache/reports-analytics-tests/', import.meta.url);
await mkdir(cacheDir, { recursive: true });
const source = await readFile(new URL('../src/components/pages/reports-analytics.ts', import.meta.url), 'utf8');
const { code } = await transformWithEsbuild(source, 'reports-analytics.ts', { loader: 'ts', format: 'esm' });
const target = new URL('reports-analytics.mjs', cacheDir);
await writeFile(target, code);
const { trendTotals, fineRowsFromSummary, periodParams } = await import(target.href);

test('trend totals add loans and returns, tolerate empty input', () => {
  assert.deepEqual(trendTotals([{ date: '2026-11-01', loans: 3, returns: 1 }, { date: '2026-11-02', loans: 2, returns: 4 }]),
    { loans: 5, returns: 5 });
  assert.deepEqual(trendTotals(null), { loans: 0, returns: 0 });
});

test('fine rows keep the statuses with money and leave the unknown waived count empty', () => {
  const { rows, total } = fineRowsFromSummary({
    total_unpaid: 3_000_000, total_paid: 1_000_000, total_waived: 0, unpaid_count: 30, paid_count: 10, by_type: [],
  });
  assert.deepEqual(rows.map((r) => r.status), ['UNPAID', 'PAID']);
  assert.equal(total, 4_000_000);
  assert.equal(fineRowsFromSummary({ total_unpaid: 0, total_paid: 0, total_waived: 5, unpaid_count: 0, paid_count: 0 }).rows[0].count, null);
  assert.deepEqual(fineRowsFromSummary(null), { rows: [], total: 0 });
});

test('period params are whole days; "all data" starts far back', () => {
  const end = new Date('2026-11-25T10:00:00Z');
  assert.deepEqual(periodParams(new Date('2026-10-26T10:00:00Z'), end), { from: '2026-10-26', to: '2026-11-25' });
  assert.equal(periodParams(null, end).from, '2000-01-01');
});
