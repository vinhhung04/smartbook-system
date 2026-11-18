const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const spool = require('../src/lib/spool');
const { isDbUnavailable } = require('../src/lib/db-errors');

function tempDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'monitoring-spool-')); }

test('spooled payloads replay in arrival order and the spool is emptied', async () => {
  const dir = tempDir();
  for (const n of [1, 2, 3]) assert.equal(spool.append({ n }, dir), true);
  assert.equal(spool.pending(dir), 3);
  const seen = [];
  assert.equal(await spool.replay(async (entry) => { seen.push(entry.n); }, dir), 3);
  assert.deepEqual(seen, [1, 2, 3]);
  assert.equal(spool.pending(dir), 0);
  assert.equal(await spool.replay(async () => { throw new Error('not called'); }, dir), 0);
});

test('a failed replay keeps the unprocessed entries first, ahead of newer arrivals', async () => {
  const dir = tempDir();
  for (const n of [1, 2, 3]) spool.append({ n }, dir);
  await assert.rejects(spool.replay(async (entry) => { if (entry.n === 2) throw new Error('db down'); }, dir), /db down/);
  spool.append({ n: 4 }, dir); // arrives while the database is still down
  const seen = [];
  await spool.replay(async (entry) => { seen.push(entry.n); }, dir);
  await spool.replay(async (entry) => { seen.push(entry.n); }, dir);
  assert.deepEqual(seen, [2, 3, 4], 'entry 1 is not replayed twice; 2 and 3 precede 4');
});

test('the spool is bounded', () => {
  const dir = tempDir();
  const big = 'x'.repeat(1024 * 1024);
  let stored = 0;
  while (spool.append({ big }, dir)) stored += 1;
  assert.ok(stored >= 9 && stored <= 10, String(stored));
  assert.ok(fs.statSync(path.join(dir, 'alerts.ndjson')).size <= spool.MAX_BYTES);
});

test('database-unavailable errors are recognised, ordinary errors are not', () => {
  assert.equal(isDbUnavailable({ name: 'PrismaClientInitializationError', message: '' }), true);
  assert.equal(isDbUnavailable({ code: 'P1001', message: '' }), true);
  assert.equal(isDbUnavailable({ message: 'Transaction API error: Unable to start a transaction in the given time.' }), true);
  assert.equal(isDbUnavailable({ code: 'P2002', message: 'Unique constraint failed' }), false);
  assert.equal(isDbUnavailable(Object.assign(new Error('alerts must be an array'), { statusCode: 400 })), false);
  assert.equal(isDbUnavailable(null), false);
});
