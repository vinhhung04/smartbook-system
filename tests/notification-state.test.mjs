// Notification center count/list consistency. Pure logic from
// apps/web/src/lib/notification-state.ts, transpiled with the web app's own
// TypeScript so it runs on Node 20 (same approach as notification-links).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const src = (p) => readFileSync(resolve(root, 'apps/web/src', p), 'utf8');

const ts = createRequire(resolve(root, 'apps/web/package.json'))('typescript');
const { outputText } = ts.transpileModule(src('lib/notification-state.ts'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
});
const { applyMarkedRead, applyAllRead, applyIncoming, createRecentIds, pageCount } =
  await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);

const NOW = '2026-10-06T08:00:00.000Z';
const row = (id, read = false) => ({ id, subject: `N ${id}`, read_at: read ? '2026-10-01T00:00:00.000Z' : null });
const state = (rows, extra = {}) => ({ rows, total: rows.length, unreadCount: rows.filter((r) => !r.read_at).length, page: 1, totalPages: 1, pageSize: 20, ...extra });

test('UNREAD view: marking one read removes the row and lowers both the total and the unread count', () => {
  const next = applyMarkedRead(state([row('a'), row('b')], { total: 2, unreadCount: 2 }), 'a', 'UNREAD', NOW);
  assert.deepEqual(next.rows.map((r) => r.id), ['b']);
  assert.equal(next.total, 1);
  assert.equal(next.unreadCount, 1);
});

test('ALL view: the row stays (now read), total unchanged, unread count down by one', () => {
  const next = applyMarkedRead(state([row('a'), row('b', true)], { total: 2, unreadCount: 1 }), 'a', 'ALL', NOW);
  assert.deepEqual(next.rows.map((r) => [r.id, r.read_at]), [['a', NOW], ['b', '2026-10-01T00:00:00.000Z']]);
  assert.equal(next.total, 2);
  assert.equal(next.unreadCount, 0);
});

test('READ view and already-read/unknown rows: nothing changes, counts never go negative', () => {
  const read = state([row('a', true)], { total: 1, unreadCount: 0 });
  assert.equal(applyMarkedRead(read, 'a', 'READ', NOW), read);
  assert.equal(applyMarkedRead(read, 'missing', 'ALL', NOW), read);
  const inconsistent = state([row('a')], { total: 1, unreadCount: 0 }); // server said 0 meanwhile
  assert.equal(applyMarkedRead(inconsistent, 'a', 'ALL', NOW).unreadCount, 0);
  assert.equal(applyMarkedRead(state([row('a')], { total: 0, unreadCount: 0 }), 'a', 'UNREAD', NOW).total, 0);
});

test('reading the last unread row of the last page never leaves the page out of range', () => {
  // 21 unread over 2 pages of 20; on page 2 the only row is read.
  const lastPage = state([row('u21')], { total: 21, unreadCount: 21, page: 2, totalPages: 2 });
  const next = applyMarkedRead(lastPage, 'u21', 'UNREAD', NOW);
  assert.equal(next.total, 20);
  assert.equal(next.totalPages, 1);
  assert.equal(next.page, 1);
  assert.equal(pageCount(0, 20), 1);
});

test('read-all: unread count 0; UNREAD empties to page 1, ALL keeps rows (now read) and its total', () => {
  const unread = applyAllRead(state([row('a'), row('b')], { total: 45, unreadCount: 45, page: 2, totalPages: 3 }), 'UNREAD', NOW);
  assert.deepEqual([unread.rows.length, unread.total, unread.unreadCount, unread.page, unread.totalPages], [0, 0, 0, 1, 1]);

  const all = applyAllRead(state([row('a'), row('b', true)], { total: 30, unreadCount: 7, page: 2, totalPages: 2 }), 'ALL', NOW);
  assert.equal(all.unreadCount, 0);
  assert.equal(all.total, 30);
  assert.equal(all.page, 2);
  assert.ok(all.rows.every((r) => r.read_at));

  assert.equal(applyAllRead(state([row('a', true)], { unreadCount: 3 }), 'READ', NOW).unreadCount, 0);
});

test('a duplicate notification:new does not double-increment, even when the row is not on the current page', () => {
  const seen = createRecentIds();
  let s = state([row('old')], { total: 1, unreadCount: 1 });
  const handle = (event, filter = 'ALL') => {
    if (!seen.addIfNew(event.id)) return;
    s = applyIncoming(s, event, filter);
  };
  handle(row('n1'));
  handle(row('n1')); // emitted twice
  assert.equal(s.unreadCount, 2);
  assert.equal(s.total, 2);
  assert.deepEqual(s.rows.map((r) => r.id), ['n1', 'old']);

  // On page 3 the new row is not visible — the id set still blocks the repeat.
  s = state([row('x')], { total: 41, unreadCount: 5, page: 3, totalPages: 3 });
  handle(row('n2'));
  handle(row('n2'));
  assert.equal(s.unreadCount, 6);
  assert.equal(s.total, 42);
  assert.deepEqual(s.rows.map((r) => r.id), ['x']);
});

test('an event for a row already loaded by a fetch does not count again', () => {
  const loaded = state([row('n1'), row('old', true)], { total: 2, unreadCount: 1 });
  assert.equal(applyIncoming(loaded, row('n1'), 'ALL'), loaded);
});

test('READ view: a new notification only raises the unread count', () => {
  const next = applyIncoming(state([row('r', true)], { total: 1, unreadCount: 0 }), row('n'), 'READ');
  assert.equal(next.unreadCount, 1);
  assert.equal(next.total, 1);
  assert.deepEqual(next.rows.map((r) => r.id), ['r']);
});

test('the id memory is bounded', () => {
  const seen = createRecentIds(3);
  for (const id of ['a', 'b', 'c', 'd']) assert.equal(seen.addIfNew(id), true);
  assert.equal(seen.size, 3);
  assert.equal(seen.addIfNew('d'), false);
  assert.equal(seen.addIfNew('a'), true, 'oldest id was evicted');
});

test('bell and notifications page share one unread count channel and the bell reconciles after bursts', () => {
  const page = src('components/pages/customer/notifications.tsx');
  const bell = src('components/pages/customer/_shared/notification-bell-dropdown.tsx');
  for (const source of [page, bell]) {
    assert.match(source, /publishUnreadCount/);
    assert.match(source, /onUnreadCount/);
    assert.match(source, /addIfNew/);
  }
  assert.match(bell, /getUnreadNotificationCount/);
  assert.match(bell, /RECONCILE_DELAY_MS/);
});
