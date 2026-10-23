// Unit tests for the Copilot 3.2 verification note (src/lib/copilot-verification.ts).
// Run: pnpm --filter web test:unit (transpiled with Vite's esbuild, as in copilot-visualization.test.mjs).
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { transformWithEsbuild } from 'vite';

const source = await readFile(new URL('../src/lib/copilot-verification.ts', import.meta.url), 'utf8');
const { code } = await transformWithEsbuild(source, 'copilot-verification.ts', { loader: 'ts', format: 'esm' });
const { verificationNotice } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

const claim = (verdict, category = 'COUNT', label = 'số lượng không khớp dữ liệu') => ({ type: 'numeric', category, label, verdict });

test('a verified answer gets a quiet "checked against data" line, never a percentage', () => {
  const n = verificationNotice({ status: 'PASSED', claims: [claim('SUPPORTED')], counts: { SUPPORTED: 1 } });
  assert.equal(n.tone, 'checked');
  assert.equal(n.title, 'Đã đối chiếu với dữ liệu hệ thống');
  assert.doesNotMatch(JSON.stringify(n), /100\s*%|claim_id|scope_id|verifier_code|COUNT/);
});

test('nothing checkable: no note at all (no false reassurance)', () => {
  assert.equal(verificationNotice({ status: 'PASSED', claims: [], counts: { SUPPORTED: 0 } }), null);
});

test('adjusted, unsupported and blocked states list reader-facing labels only', () => {
  const adjusted = verificationNotice({ status: 'REPAIRED', claims: [], repairs: [{ category: 'COUNT', label: 'số lượng không khớp dữ liệu' }] });
  assert.equal(adjusted.tone, 'adjusted');
  assert.deepEqual(adjusted.items, ['số lượng không khớp dữ liệu']);

  const warning = verificationNotice({ status: 'WARNING', claims: [claim('UNSUPPORTED', 'CAUSALITY', 'khẳng định nguyên nhân không có trong dữ liệu'), claim('SUPPORTED')] });
  assert.equal(warning.tone, 'warning');
  assert.deepEqual(warning.items, ['khẳng định nguyên nhân không có trong dữ liệu']);

  const blocked = verificationNotice({ status: 'BLOCKED', claims: [claim('CONTRADICTED'), claim('CONTRADICTED')] });
  assert.equal(blocked.tone, 'blocked');
  assert.match(blocked.title, /Không kiểm chứng được một khuyến nghị an toàn/);
  assert.deepEqual(blocked.items, ['số lượng không khớp dữ liệu']); // de-duplicated
});

test('only internal labels stripped: nothing for the reader beyond "checked"', () => {
  const n = verificationNotice({ status: 'REPAIRED', claims: [claim('SUPPORTED')], counts: { SUPPORTED: 1 }, repairs: [] });
  assert.equal(n.tone, 'checked');
});

test('answers stored before 3.2 keep the 3.1 note', () => {
  const n = verificationNotice(null, { status: 'fallback', issues: [{ type: 'CONTRADICTION', label: 'mâu thuẫn với xu hướng trong dữ liệu' }] });
  assert.equal(n.tone, 'blocked');
  assert.deepEqual(n.items, ['mâu thuẫn với xu hướng trong dữ liệu']);
  assert.equal(verificationNotice(null, { status: 'passed', issues: [] }), null);
});

test('3.3: withdrawn sentences get their own note with reader-facing labels', () => {
  const n = verificationNotice({
    status: 'WARNING', safe_to_act: false,
    claims: [claim('CONTRADICTED', 'TREND', 'xu hướng không khớp dữ liệu')],
    withdrawn: [{ category: 'TREND', label: 'xu hướng không khớp dữ liệu' }, { category: 'TREND', label: 'xu hướng không khớp dữ liệu' }],
  });
  assert.equal(n.tone, 'warning');
  assert.match(n.title, /đã được lược bỏ/);
  assert.deepEqual(n.items, ['xu hướng không khớp dữ liệu']);
  assert.doesNotMatch(JSON.stringify(n), /TREND|basis|semantic/);
});
