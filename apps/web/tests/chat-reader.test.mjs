// Unit tests for the chatbot's reader digest, loan-code pickup and follow-ups.
// Run: pnpm --filter web test:unit
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { test } from 'node:test';
import { transformWithEsbuild } from 'vite';

const cacheDir = new URL('../node_modules/.cache/chat-reader-tests/', import.meta.url);
await mkdir(cacheDir, { recursive: true });
const source = await readFile(new URL('../src/lib/chat-reader.ts', import.meta.url), 'utf8');
const { code } = await transformWithEsbuild(source, 'chat-reader.ts', { loader: 'ts', format: 'esm' });
const target = new URL('chat-reader.mjs', cacheDir);
await writeFile(target, code);
const r = await import(target.href);

const now = new Date(2026, 10, 16, 15, 0).getTime();
const on = (day) => new Date(2026, 10, day, 9, 0).toISOString();
const loan = (id, status, day, extra = {}) => ({ id, loan_number: `LOAN-${id}`, status, due_date: on(day), primary_book_title: `Sách ${id}`, ...extra });

test('daysUntil counts calendar days, so a due date earlier today is still today', () => {
  assert.equal(r.daysUntil(on(16), now), 0);
  assert.equal(r.daysUntil(on(17), now), 1);
  assert.equal(r.daysUntil(on(13), now), -3);
});

test('digest leads with the nearest due loan; returned loans are ignored', () => {
  const cards = r.readerDigest([loan('A', 'BORROWED', 20), loan('B', 'BORROWED', 18), loan('C', 'RETURNED', 1)], [], now);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].title, 'Sách B đến hạn sau 2 ngày');
  assert.equal(cards[0].tone, 'notice');
  assert.equal(cards[0].detail, 'Bạn đang mượn 2 phiếu.');
  assert.equal(r.readerDigest([loan('A', 'BORROWED', 30)], [], now)[0].tone, 'calm');
});

test('overdue loans take the alert card; several are counted', () => {
  const one = r.readerDigest([loan('A', 'OVERDUE', 13, { extra_item_count: 1 })], [], now);
  assert.equal(one[0].tone, 'alert');
  assert.equal(one[0].title, 'Sách A và 1 cuốn khác quá hạn 3 ngày');
  const two = r.readerDigest([loan('A', 'OVERDUE', 13), loan('B', 'BORROWED', 15)], [], now);
  assert.equal(two[0].title, '2 phiếu mượn đã quá hạn');
  assert.equal(two[0].detail, 'Lâu nhất: Sách A, quá hạn 3 ngày.');
});

test('fines card sums what is still owed and skips settled fines', () => {
  const cards = r.readerDigest([], [{ id: 'f1', remaining_amount: 15000 }, { id: 'f2', remaining_amount: 5000 }, { id: 'f3', remaining_amount: 0 }], now);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].title, `Phí phạt còn ${(20000).toLocaleString('vi-VN')}đ`);
  assert.equal(cards[0].detail, '2 khoản chưa thanh toán xong.');
  assert.deepEqual(r.readerDigest([], [], now), []);
});

test('renewal is offered only for active loans without a pending request', () => {
  assert.equal(r.canRequestRenewal(loan('A', 'BORROWED', 20)), true);
  assert.equal(r.canRequestRenewal(loan('A', 'OVERDUE', 10)), true);
  assert.equal(r.canRequestRenewal(loan('A', 'BORROWED', 20, { renewal: { pending: true } })), false);
  assert.equal(r.canRequestRenewal(loan('A', 'RETURNED', 20)), false);
});

test('loan codes are picked up once each, in order', () => {
  assert.deepEqual(r.mentionedLoanCodes('LOAN-1A-B2 rồi LOAN-9Z, lại LOAN-1A-B2; RSV-7 không tính'), ['LOAN-1A-B2', 'LOAN-9Z']);
  assert.deepEqual(r.mentionedLoanCodes('Phiếu HIST-LOAN-008421 đã quá hạn'), ['HIST-LOAN-008421']);
});

test('follow-ups: intent first, then the words; never repeat a question already asked', () => {
  assert.deepEqual(r.followUpsFor({ reader: true, intent: 'FINE_SUMMARY_QUERY', question: 'x', asked: [] }),
    ['Làm sao để thanh toán phí phạt?', 'Vì sao tôi bị tính phí phạt?']);
  assert.deepEqual(r.followUpsFor({ reader: true, intent: 'GENERAL_QUERY', question: 'Tôi có sách nào sắp đến hạn trả?', asked: ['Tôi có thể gia hạn sách nào?'] }),
    ['Trả sách muộn bị phạt bao nhiêu?']);
  assert.deepEqual(r.followUpsFor({ reader: true, intent: 'GENERAL_QUERY', question: 'Xin chào', asked: [] }), []);
  assert.deepEqual(r.followUpsFor({ reader: false, intent: 'LOW_STOCK_QUERY', question: 'x', asked: [] }).length, 2);
  assert.deepEqual(r.followUpsFor({ reader: false, intent: 'GENERAL_QUERY', question: 'phạt', asked: [] }), []);
});
