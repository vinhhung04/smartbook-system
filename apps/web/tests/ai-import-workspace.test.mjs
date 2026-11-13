// Unit tests for the AI Import workspace's pure logic: the lookup progress model (only
// real events move it), the ISBN/EAN shape check and the field provenance model.
// Run: pnpm --filter web test:unit (transpiled with Vite's esbuild, like book-ocr.test.mjs).
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { test } from 'node:test';
import { transformWithEsbuild } from 'vite';

// Transpiled into node_modules/.cache so bare imports (lucide-react) resolve from this app.
const cacheDir = new URL('../node_modules/.cache/ai-import-tests/', import.meta.url);
await mkdir(cacheDir, { recursive: true });
async function load(path) {
  const source = await readFile(new URL(`../src/components/pages/ai-import/${path}`, import.meta.url), 'utf8');
  const { code } = await transformWithEsbuild(source, path, { loader: 'ts', format: 'esm' });
  const target = new URL(path.replace(/\.ts$/, '.mjs'), cacheDir);
  await writeFile(target, code);
  return import(target.href);
}
const progressModel = await load('lookup-progress.ts');
const utils = await load('utils.ts');
const model = await load('field-review-model.ts');

const stage = (seq, name, state, detail) => ({ type: 'stage', seq, t: seq * 10, stage: name, state, detail });
const source = (seq, round, name, state, extra = {}) => ({ type: 'source', seq, t: seq * 10, round, source: name, state, ...extra });

test('progress moves only on reported events, in order; duplicates and late events are ignored', () => {
  const { initialProgress, applyProgressEvent } = progressModel;
  let p = initialProgress();
  p = applyProgressEvent(p, stage(1, 'validate', 'done', { kind: 'ISBN13', code: '9786041234567' }));
  p = applyProgressEvent(p, stage(2, 'round1', 'started', { order: ['catalog', 'fahasa', 'tiki'] }));
  assert.equal(p.channel, 'live');
  assert.deepEqual(p.sources.map((r) => [r.source, r.state]), [['catalog', 'queued'], ['fahasa', 'queued'], ['tiki', 'queued']]);

  p = applyProgressEvent(p, source(3, 1, 'catalog', 'started', { query: 'code' }));
  p = applyProgressEvent(p, source(4, 1, 'catalog', 'done', { status: 'NOT_FOUND', durationMs: 40 }));
  const afterFour = p;
  p = applyProgressEvent(p, source(4, 1, 'catalog', 'done', { status: 'ERROR' })); // duplicate seq
  assert.equal(p, afterFour);
  p = applyProgressEvent(p, source(3, 1, 'catalog', 'started')); // late, older event
  assert.equal(p.sources[0].status, 'NOT_FOUND');
  assert.equal(p.sources[0].state, 'done');
  // Nothing moved the next sources: no timer, no guess.
  assert.deepEqual(p.sources.slice(1).map((r) => r.state), ['queued', 'queued']);
});

test('round 1 without a match marks round 2 as not run', () => {
  const { initialProgress, applyProgressEvent } = progressModel;
  let p = applyProgressEvent(initialProgress(), stage(1, 'round1', 'started', { order: ['catalog'] }));
  p = applyProgressEvent(p, stage(2, 'round1', 'done', { matchedSource: null }));
  assert.equal(p.round1.state, 'done');
  assert.equal(p.round2.state, 'skipped');
});

test('without a live channel the rows are rebuilt from the response trace and flagged as replayed', () => {
  const { initialProgress, finishProgress } = progressModel;
  const lookup = {
    found: true,
    verification: { round1: { order: ['catalog', 'fahasa'], matchedSource: 'fahasa', attempts: [
      { source: 'catalog', status: 'NOT_FOUND', durationMs: 12, attempts: 1 },
      { source: 'fahasa', status: 'SUCCESS', durationMs: 900, attempts: 1 },
    ] } },
    sources: [
      { name: 'fahasa', status: 'SUCCESS', round: 1, durationMs: 900 },
      { name: 'tiki', status: 'DIFFERENT_EDITION', round: 2, query: 'title', durationMs: 700 },
    ],
  };
  const p = finishProgress(initialProgress('unavailable'), lookup);
  assert.equal(p.replayed, true);
  assert.deepEqual(p.sources.map((r) => [r.round, r.source, r.status]), [[1, 'catalog', 'NOT_FOUND'], [1, 'fahasa', 'SUCCESS'], [2, 'tiki', 'DIFFERENT_EDITION']]);
  assert.equal(p.round1.matchedSource, 'fahasa');
  // Steps nobody reported are said to be unreported, not "done".
  assert.equal(p.authority, 'unreported');
  assert.equal(p.validate.state, 'unreported');
});

test('a live channel keeps what it saw; it is not replaced by the replay', () => {
  const { initialProgress, applyProgressEvent, finishProgress } = progressModel;
  let p = applyProgressEvent(initialProgress(), stage(1, 'round1', 'started', { order: ['catalog'] }));
  p = applyProgressEvent(p, source(2, 1, 'catalog', 'done', { status: 'SUCCESS' }));
  const done = finishProgress(p, { found: true, sources: [], verification: { round1: { order: ['catalog'], matchedSource: 'catalog', attempts: [] } } });
  assert.equal(done.replayed, false);
  assert.equal(done.sources[0].status, 'SUCCESS');
});

test('classifyCode: ISBN-13, ISBN-10, retail EAN-13 and checksum errors', () => {
  const { classifyCode } = utils;
  assert.equal(classifyCode('978-0-13-235088-4').kind, 'ISBN13');
  assert.equal(classifyCode('0-13-235088-2').kind, 'ISBN10');
  assert.equal(classifyCode('080442957X').kind, 'ISBN10');
  assert.equal(classifyCode('8935212359658').kind, 'EAN13');
  assert.equal(classifyCode('9780132350885').kind, 'BAD_CHECKSUM_13');
  assert.equal(classifyCode('0132350883').kind, 'BAD_CHECKSUM_10');
  assert.equal(classifyCode('12345').kind, 'WRONG_LENGTH');
  assert.equal(classifyCode('  ').kind, 'EMPTY');
});

const LOOKUP = {
  found: true,
  sources: [{ name: 'fahasa', status: 'SUCCESS' }, { name: 'googleBooks', status: 'SUCCESS' }, { name: 'tiki', status: 'SUCCESS' }],
  conflictedFields: ['publisher'],
  fieldSources: { title: ['fahasa', 'googleBooks'] },
  fieldStatus: { pageCount: 'LOW_CONFIDENCE' },
  fieldEvidence: {
    title: {
      selectedValue: 'Nhà giả kim', selectedSource: 'fahasa',
      confirmations: [{ source: 'fahasa', value: 'Nhà giả kim', round: 1, verification: 'CODE_MATCH' }, { source: 'googleBooks', value: 'Nhà giả kim', round: 2, verification: 'CODE_MATCH' }],
    },
    publisher: {
      selectedValue: 'NXB Hội Nhà Văn', selectedSource: 'fahasa',
      confirmations: [{ source: 'fahasa', value: 'NXB Hội Nhà Văn', round: 1, verification: 'CODE_MATCH' }],
      candidates: [{ value: 'Hội Nhà Văn', sources: ['tiki'], support: 0.3 }, { value: 'NXB Hội Nhà Văn', sources: ['fahasa'], support: 0.7 }],
    },
    pageCount: { selectedValue: 228, selectedSource: 'tiki', confirmations: [{ source: 'tiki', value: 228, round: 2, verification: 'TITLE_MATCH' }] },
  },
};

test('field status: verified, multi-source, conflict, low confidence, missing, edited', () => {
  const { fieldState } = model;
  const title = fieldState({ field: 'title', lookup: LOOKUP, value: 'Nhà giả kim', edited: false, hasAiSuggestion: false });
  assert.ok(title.filters.has('verified') && title.filters.has('multi'));
  assert.equal(title.label, '2 nguồn xác nhận');
  const publisher = fieldState({ field: 'publisher', lookup: LOOKUP, value: 'NXB Hội Nhà Văn', edited: false, hasAiSuggestion: false });
  assert.ok(publisher.filters.has('conflict'));
  assert.equal(publisher.label, 'Nguồn ghi khác nhau');
  assert.ok(fieldState({ field: 'pageCount', lookup: LOOKUP, value: '228', edited: false, hasAiSuggestion: false }).filters.has('low'));
  assert.ok(fieldState({ field: 'subtitle', lookup: LOOKUP, value: '', edited: false, hasAiSuggestion: false }).filters.has('missing'));
  // A field the user chose keeps saying so, even when sources disagree.
  assert.equal(fieldState({ field: 'publisher', lookup: LOOKUP, value: 'Hội Nhà Văn', edited: true, hasAiSuggestion: false }).label, 'Bạn đã sửa hoặc chọn');
});

test('a field holding an applied AI suggestion says so, never "source evidence"', () => {
  const { fieldState } = model;
  const state = fieldState({ field: 'description', lookup: LOOKUP, value: 'Mô tả do AI viết', edited: false, hasAiSuggestion: true, aiApplied: true });
  assert.equal(state.label, 'Đã dùng đề xuất AI');
  assert.equal(state.tone, 'ai');
  // The user's own edit still wins over the AI label.
  assert.equal(fieldState({ field: 'description', lookup: LOOKUP, value: 'x', edited: true, hasAiSuggestion: true, aiApplied: true }).label, 'Bạn đã sửa hoặc chọn');
});

test('candidates rank by support and mark the value Evidence Fusion selected', () => {
  const { candidatesFor, toFormValue } = model;
  const values = candidatesFor(LOOKUP, 'publisher');
  assert.deepEqual(values.map((c) => [c.value, c.selected]), [['NXB Hội Nhà Văn', true], ['Hội Nhà Văn', false]]);
  assert.equal(candidatesFor(LOOKUP, 'pageCount')[0].value, '228');
  assert.equal(toFormValue(['Paulo Coelho', ' Lê Chu Cầu ']), 'Paulo Coelho, Lê Chu Cầu');
  assert.equal(toFormValue(null), '');
});
