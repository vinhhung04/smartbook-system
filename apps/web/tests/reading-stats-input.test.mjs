// Unit test for the loan enrichment sent to ai-service /reading-stats.
// Run: pnpm --filter web test:unit
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { test } from 'node:test';
import { transformWithEsbuild } from 'vite';

const cacheDir = new URL('../node_modules/.cache/reading-stats-input-tests/', import.meta.url);
await mkdir(cacheDir, { recursive: true });
const source = await readFile(new URL('../src/lib/reading-stats-input.ts', import.meta.url), 'utf8');
const { code } = await transformWithEsbuild(source, 'reading-stats-input.ts', { loader: 'ts', format: 'esm' });
const target = new URL('reading-stats-input.mjs', cacheDir);
await writeFile(target, code);
const { enrichLoansForStats } = await import(target.href);

const books = [
  { title: 'Norwegian Wood', author: 'Haruki Murakami', category: 'Văn học nước ngoài', variant_id: 'v-nw' },
  { title: 'Đắc Nhân Tâm', author: 'Dale Carnegie', category: 'Kỹ năng sống', variant_id: 'v-dnt-main' },
];

test('fills author from book_author and category by variant id', () => {
  const [loan] = enrichLoansForStats([{ id: 'l1', loan_items: [{ variant_id: 'v-nw', book_title: 'Norwegian Wood', book_author: 'H. Murakami' }] }], books);
  assert.equal(loan.id, 'l1');
  assert.equal(loan.loan_items[0].author, 'H. Murakami');
  assert.equal(loan.loan_items[0].category, 'Văn học nước ngoài');
});

test('falls back to a case-insensitive title match for other variants', () => {
  const [loan] = enrichLoansForStats([{ loan_items: [{ variant_id: 'v-dnt-paperback', book_title: 'đắc nhân tâm ', book_author: null }] }], books);
  assert.equal(loan.loan_items[0].category, 'Kỹ năng sống');
  assert.equal(loan.loan_items[0].author, 'Dale Carnegie');
});

test('unknown books keep null fields; loans without items stay valid', () => {
  const [a, b] = enrichLoansForStats([{ loan_items: [{ variant_id: 'x', book_title: 'Không có' }] }, { loan_items: null }], books);
  assert.equal(a.loan_items[0].category, null);
  assert.equal(a.loan_items[0].author, null);
  assert.deepEqual(b.loan_items, []);
});
