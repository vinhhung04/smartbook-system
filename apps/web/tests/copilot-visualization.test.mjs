// Unit tests for the client-side visualization contract (src/lib/copilot-visualization.ts).
// Run: pnpm --filter web test:unit. The module is transpiled with Vite's own
// esbuild transform so this runs on CI's Node 20 as well (no native TS there).
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { transformWithEsbuild } from 'vite';

const source = await readFile(new URL('../src/lib/copilot-visualization.ts', import.meta.url), 'utf8');
const { code } = await transformWithEsbuild(source, 'copilot-visualization.ts', { loader: 'ts', format: 'esm' });
const moduleUrl = `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
const {
  formatDataAsOf,
  budgetPrompt,
  filterRows,
  formatAxisTick,
  formatValue,
  sanitizeVisualization,
  sanitizeVisualizations,
  sortRows,
  switchableTypes,
  tableColumns,
  VIZ_LIMITS,
} = await import(moduleUrl);

const base = (over = {}) => ({
  id: 'viz-0123456789ab',
  type: 'line',
  title: 'Lượt mượn theo tháng',
  x_key: 'period',
  x_label: 'Tháng',
  x_kind: 'time',
  series: [
    { key: 'loans', label: 'Lượt mượn', unit: 'lượt', kind: 'count' },
    { key: 'returns', label: 'Lượt trả', unit: 'lượt', kind: 'count', hidden: true },
  ],
  data: [
    { period: '05/2026', loans: 120, returns: 100 },
    { period: '06/2026', loans: null, returns: 90 },
    { period: '07/2026', loans: 110, returns: 95 },
  ],
  source: { tools: ['get_borrow_trends'], endpoints: ['/analytics/borrow-trends'] },
  scope: { level: 'system', label: 'Toàn hệ thống' },
  time_range: { label: '6 tháng qua' },
  data_as_of: '2026-10-15T10:00:00+07:00',
  interactions: { allowed_types: ['line', 'area', 'bar', 'table'], can_toggle_series: true, followups: ['Biểu đồ này cho thấy điều gì?'] },
  ...over,
});

test('a valid spec passes and keeps nulls as nulls', () => {
  const spec = sanitizeVisualization(base());
  assert.ok(spec);
  assert.equal(spec.data[1].loans, null);
  assert.equal(spec.series[1].hidden, true);
  assert.deepEqual(switchableTypes(spec), ['area', 'bar', 'table']);
});

test('unknown types, NaN/Infinity, objects and booleans are rejected', () => {
  assert.equal(sanitizeVisualization(base({ type: 'html' })), null);
  assert.equal(sanitizeVisualization(base({ type: 'script' })), null);
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, { a: 1 }, true]) {
    assert.equal(sanitizeVisualization(base({ data: [{ period: 'x', loans: bad, returns: 1 }] })), null);
  }
});

test('text cannot hide in a numeric series', () => {
  assert.equal(sanitizeVisualization(base({ data: [{ period: 'x', loans: '<img onerror=1>', returns: 1 }] })), null);
});

test('mixed units in one chart are rejected', () => {
  const series = [{ key: 'a', label: 'A', unit: 'lượt', kind: 'count' }, { key: 'b', label: 'B', unit: '₫', kind: 'currency' }];
  assert.equal(sanitizeVisualization(base({ series, data: [{ period: 'x', a: 1, b: 2 }] })), null);
});

test('limits are enforced', () => {
  const many = Array.from({ length: VIZ_LIMITS.chartPoints + 1 }, (_, i) => ({ period: `p${i}`, loans: i, returns: i }));
  assert.equal(sanitizeVisualization(base({ data: many })), null);
  const list = Array.from({ length: 9 }, (_, i) => base({ id: `viz-00000000000${i}` }));
  assert.equal(sanitizeVisualizations(list).length, VIZ_LIMITS.visualizations);
  assert.deepEqual(sanitizeVisualizations('not an array'), []);
  assert.deepEqual(sanitizeVisualizations(undefined), []);
});

test('pie needs complete non-negative values', () => {
  const pie = {
    type: 'pie', x_kind: 'category', x_key: 'status', series: [{ key: 'count', label: 'Lượt', unit: 'lượt', kind: 'count' }],
    interactions: { allowed_types: ['pie', 'bar', 'table'] },
  };
  assert.ok(sanitizeVisualization(base({ ...pie, data: [{ status: 'A', count: 2 }, { status: 'B', count: 3 }] })));
  assert.equal(sanitizeVisualization(base({ ...pie, data: [{ status: 'A', count: null }, { status: 'B', count: 3 }] })), null);
});

test('kpi specs need kpis and finite values', () => {
  const kpi = { type: 'kpi', data: [], series: [], interactions: { allowed_types: ['kpi'] } };
  assert.equal(sanitizeVisualization(base({ ...kpi, kpis: [] })), null);
  const ok = sanitizeVisualization(base({ ...kpi, kpis: [{ key: 'total', label: 'Tổng', value: 635, unit: 'lượt' }] }));
  assert.equal(ok.kpis[0].value, 635);
  assert.equal(sanitizeVisualization(base({ ...kpi, kpis: [{ key: 't', label: 'T', value: Number.NaN }] })), null);
});

test('values are formatted vi-VN and missing stays missing', () => {
  assert.equal(formatValue(1234567, '₫', 'currency'), '1.234.567 ₫');
  assert.equal(formatValue(-25, '%', 'percent'), '-25%');
  assert.equal(formatValue(1234.5, 'lượt'), '1.234,5 lượt');
  assert.equal(formatValue(null, 'lượt'), '—');
  assert.equal(formatValue(undefined), '—');
  assert.equal(formatValue(0, 'lượt'), '0 lượt');
  assert.ok(formatAxisTick(20_000_000).length < 8);
});

test('table view puts the chart x column first', () => {
  const spec = sanitizeVisualization(base());
  assert.deepEqual(tableColumns(spec).map((c) => c.key), ['period', 'loans', 'returns']);
});

test('sorting keeps missing values last in both directions', () => {
  const rows = [{ k: 'a', v: 2 }, { k: 'b', v: null }, { k: 'c', v: 5 }];
  assert.deepEqual(sortRows(rows, 'v', 'desc').map((r) => r.k), ['c', 'a', 'b']);
  assert.deepEqual(sortRows(rows, 'v', 'asc').map((r) => r.k), ['a', 'c', 'b']);
});

test('filtering is accent-insensitive', () => {
  const rows = [{ warehouse: 'Kho Hà Nội' }, { warehouse: 'Kho HCM Chính' }];
  assert.equal(filterRows(rows, 'ha noi').length, 1);
  assert.equal(filterRows(rows, 'chinh')[0].warehouse, 'Kho HCM Chính');
  assert.equal(filterRows(rows, '  ').length, 2);
});

test('the budget slider asks the backend instead of interpolating', () => {
  assert.equal(budgetPrompt([12_000_000]), 'Nếu ngân sách nhập sách là 12 triệu thì sao? Hiển thị biểu đồ.');
});

test('snapshot times are shown in Vietnam time whatever the zone of the instant', () => {
  assert.equal(formatDataAsOf('2026-10-15T09:31:50+07:00'), '09:31 15/10/2026');
  assert.equal(formatDataAsOf('2026-10-15T02:31:50Z'), '09:31 15/10/2026');
  // 17:30 UTC on the last day of a month is already the next month in Vietnam.
  assert.equal(formatDataAsOf('2026-09-30T17:30:00Z'), '00:30 01/10/2026');
  assert.equal(formatDataAsOf('not a date'), null);
  assert.equal(formatDataAsOf(null), null);
});

test('the machine time zone does not change the label (CI runs in UTC)', () => {
  const script = `const m = await import(${JSON.stringify(moduleUrl)}); console.log(m.formatDataAsOf('2026-10-15T09:31:50+07:00'));`;
  for (const TZ of ['UTC', 'America/New_York', 'Asia/Tokyo', 'Asia/Ho_Chi_Minh']) {
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, TZ } }).toString().trim();
    assert.equal(out, '09:31 15/10/2026', TZ);
  }
});
