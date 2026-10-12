// Customer notification center: clicking a notification opens the entity it is
// about. Pure logic from apps/web/src/lib/notification-links.ts, transpiled with
// the web app's TypeScript so it runs on Node 20 (same approach as ai-decision).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const src = (p) => readFileSync(resolve(root, 'apps/web/src', p), 'utf8');

const ts = createRequire(resolve(root, 'apps/web/package.json'))('typescript');
const { outputText } = ts.transpileModule(src('lib/notification-links.ts'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
});
const { notificationTarget } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);

const LOAN = '11111111-1111-4111-8111-111111111111';
const BOOK = '22222222-2222-4222-8222-222222222222';

test('loan notifications open the loan detail page', () => {
  assert.equal(notificationTarget({ reference_type: 'LOAN_TRANSACTION', reference_id: LOAN }), `/customer/loans/${LOAN}`);
  // Due-date reminders reference the loan item; the loan id is in metadata.
  assert.equal(notificationTarget({ reference_type: 'LOAN_ITEM', reference_id: BOOK, metadata: { loan_id: LOAN } }), `/customer/loans/${LOAN}`);
  assert.equal(notificationTarget({ reference_type: 'LOAN_ITEM', reference_id: BOOK }), '/customer/loans');
});

test('reservation, fine and book notifications open their pages', () => {
  assert.equal(notificationTarget({ reference_type: 'LOAN_RESERVATION', reference_id: LOAN }), '/customer/reservations');
  assert.equal(notificationTarget({ reference_type: 'FINE', reference_id: LOAN }), '/customer/fines');
  assert.equal(notificationTarget({ reference_type: 'BOOK', reference_id: BOOK }), `/books/${BOOK}`);
});

test('unknown types and malformed ids never produce a link', () => {
  assert.equal(notificationTarget({ reference_type: 'ADMIN_MESSAGE', reference_id: LOAN }), null);
  assert.equal(notificationTarget({ reference_type: null, reference_id: null }), null);
  assert.equal(notificationTarget({ reference_type: 'BOOK', reference_id: '../admin' }), null);
  assert.equal(notificationTarget({ reference_type: 'LOAN_TRANSACTION', reference_id: 'javascript:alert(1)' }), '/customer/loans');
});

test('notification center UI uses the server unread count and links items to their entity', () => {
  const page = src('components/pages/customer/notifications.tsx');
  const bell = src('components/pages/customer/_shared/notification-bell-dropdown.tsx');
  const item = src('components/pages/customer/_shared/notification-item.tsx');
  assert.match(page, /unread_count/);
  assert.match(bell, /unread_count|getUnreadNotificationCount/);
  assert.match(item, /notificationTarget/);
  assert.match(bell, /notificationTarget/);
  // No mock data in the customer notification center.
  for (const source of [page, bell, item]) assert.doesNotMatch(source, /MOCK_/);
});
