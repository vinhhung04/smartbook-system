// Unit test for the queue-row age used by the exception reports inbox.
// Run: pnpm --filter web test:unit
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { test } from 'node:test';
import { transformWithEsbuild } from 'vite';

const cacheDir = new URL('../node_modules/.cache/time-ago-tests/', import.meta.url);
await mkdir(cacheDir, { recursive: true });
const source = await readFile(new URL('../src/lib/time-ago.ts', import.meta.url), 'utf8');
const { code } = await transformWithEsbuild(source, 'time-ago.ts', { loader: 'ts', format: 'esm' });
const target = new URL('time-ago.mjs', cacheDir);
await writeFile(target, code);
const { timeAgo } = await import(target.href);

const now = Date.parse('2026-11-14T12:00:00Z');
const ago = (ms) => new Date(now - ms).toISOString();

test('timeAgo steps from minutes to hours to days at each boundary', () => {
  assert.equal(timeAgo(ago(30 * 1000), now), 'Vừa xong');
  assert.equal(timeAgo(ago(59 * 60 * 1000), now), '59 phút');
  assert.equal(timeAgo(ago(60 * 60 * 1000), now), '1 giờ');
  assert.equal(timeAgo(ago(23 * 3600 * 1000), now), '23 giờ');
  assert.equal(timeAgo(ago(24 * 3600 * 1000), now), 'Hôm qua');
  assert.equal(timeAgo(ago(29 * 86400 * 1000), now), '29 ngày');
});

test('timeAgo falls back to the date after a month, and a dash for missing or bad input', () => {
  assert.match(timeAgo(ago(40 * 86400 * 1000), now), /\d{2}\/\d{2}\/2026/);
  assert.equal(timeAgo(null, now), '-');
  assert.equal(timeAgo('not a date', now), '-');
  assert.equal(timeAgo(new Date(now + 60000).toISOString(), now), 'Vừa xong'); // clock skew never goes negative
});
