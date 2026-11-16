// Unit tests for the chatbot's markdown parser and its saved conversations.
// Run: pnpm --filter web test:unit
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { test } from 'node:test';
import { transformWithEsbuild } from 'vite';

const cacheDir = new URL('../node_modules/.cache/chat-markdown-tests/', import.meta.url);
await mkdir(cacheDir, { recursive: true });
async function load(file) {
  const source = await readFile(new URL(`../src/lib/${file}.ts`, import.meta.url), 'utf8');
  const { code } = await transformWithEsbuild(source, `${file}.ts`, { loader: 'ts', format: 'esm' });
  const target = new URL(`${file}.mjs`, cacheDir);
  await writeFile(target, code);
  return import(target.href);
}
const md = await load('chat-markdown');
const history = await load('chat-history');

test('record codes become record runs and keep the text around them', () => {
  assert.deepEqual(md.parseInline('Phiếu LOAN-850279-KS568R và RSV-48759EC7.'), [
    { type: 'text', text: 'Phiếu ' },
    { type: 'record', kind: 'loan', code: 'LOAN-850279-KS568R' },
    { type: 'text', text: ' và ' },
    { type: 'record', kind: 'reservation', code: 'RSV-48759EC7' },
    { type: 'text', text: '.' },
  ]);
});

test('a prefixed code stays whole; a code never starts inside a word', () => {
  assert.deepEqual(md.parseInline('Phiếu HIST-LOAN-008421.'), [
    { type: 'text', text: 'Phiếu ' },
    { type: 'record', kind: 'loan', code: 'HIST-LOAN-008421' },
    { type: 'text', text: '.' },
  ]);
  assert.deepEqual(md.parseInline('xLOAN-1'), [{ type: 'text', text: 'xLOAN-1' }]);
});

test('links: site paths and http(s) only; other schemes stay text; bare URLs drop trailing punctuation', () => {
  assert.deepEqual(md.parseInline('[Phiếu mượn](/customer/loans)'), [{ type: 'link', label: 'Phiếu mượn', href: '/customer/loans', external: false }]);
  // The URL stops at the first ")", so the label stays text and the rest of the URL is dropped with it.
  assert.deepEqual(md.parseInline('[x](javascript:alert(1))'), [{ type: 'text', text: 'x)' }]);
  assert.deepEqual(md.parseInline('[x](//evil.test)'), [{ type: 'text', text: 'x' }]);
  assert.deepEqual(md.parseInline('Xem https://smartbook.test/books.'), [
    { type: 'text', text: 'Xem ' },
    { type: 'link', href: 'https://smartbook.test/books', label: 'https://smartbook.test/books', external: true },
    { type: 'text', text: '.' },
  ]);
});

test('bold may hold a record code; inline code is literal', () => {
  assert.deepEqual(md.parseInline('**LOAN-1A**'), [{ type: 'bold', children: [{ type: 'record', kind: 'loan', code: 'LOAN-1A' }] }]);
  assert.deepEqual(md.parseInline('`**x**`'), [{ type: 'code', text: '**x**' }]);
});

test('blocks: headings, lists, one gap between paragraphs, no trailing gap', () => {
  const blocks = md.parseBlocks('# Tổng quan\n- một\n- hai\n\n\nĐoạn cuối\n\n');
  assert.deepEqual(blocks.map((b) => b.type), ['heading', 'list', 'gap', 'paragraph']);
  assert.equal(blocks[1].items.length, 2);
  assert.equal(blocks[1].ordered, false);
  assert.equal(md.parseBlocks('1. a\n2) b')[0].ordered, true);
});

test('a table needs its rule line; without it (still streaming) the header stays text', () => {
  const table = md.parseBlocks('| Sách | Hạn |\n|---|---:|\n| Dế Mèn | 20/11 |\n| Nhà giả kim | 25/11 |');
  assert.equal(table.length, 1);
  assert.equal(table[0].type, 'table');
  assert.equal(table[0].head.length, 2);
  assert.equal(table[0].rows.length, 2);
  assert.deepEqual(table[0].rows[1][0], [{ type: 'text', text: 'Nhà giả kim' }]);
  assert.equal(md.parseBlocks('| Sách | Hạn |')[0].type, 'paragraph');
});

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v), removeItem: (k) => data.delete(k), data };
}
const msg = (id, role, text) => ({ id, role, text });

test('the old single history migrates into one conversation and the old key goes on save', () => {
  const storage = memoryStorage({ 'smartbook_ai_chat_history:u1': JSON.stringify([msg(1, 'user', 'Sách nào sắp đến hạn?'), msg(2, 'assistant', 'Không có.')]) });
  const store = history.loadStore(storage, 'u1', 1000);
  assert.equal(store.conversations.length, 1);
  assert.equal(store.conversations[0].title, 'Sách nào sắp đến hạn?');
  assert.equal(store.activeId, store.conversations[0].id);
  history.saveStore(storage, 'u1', store);
  assert.equal(storage.data.has('smartbook_ai_chat_history:u1'), false);
  assert.deepEqual(history.loadStore(storage, 'u1').conversations, store.conversations);
});

test('an empty conversation is not saved; reopening without new content keeps its place', () => {
  let store = history.loadStore(memoryStorage(), 'u1');
  assert.equal(history.upsertActive(store, [], 1).conversations.length, 0);
  store = history.upsertActive(store, [msg(1, 'user', 'A')], 100);
  const first = store.activeId;
  store = history.startConversation(store);
  store = history.upsertActive(store, [msg(1, 'user', 'B')], 200);
  assert.deepEqual(store.conversations.map((c) => c.title), ['B', 'A']);
  store = { ...store, activeId: first };
  store = history.upsertActive(store, store.conversations[1].messages, 300);
  assert.deepEqual(store.conversations.map((c) => c.title), ['B', 'A']);
  store = history.upsertActive(store, [msg(1, 'user', 'A'), msg(2, 'assistant', 'ok')], 400);
  assert.deepEqual(store.conversations.map((c) => c.title), ['A', 'B']);
});

test('caps: 20 conversations, 40 messages each, 60-character titles', () => {
  let store = history.loadStore(null, 'u1');
  for (let i = 0; i < 25; i += 1) {
    store = history.upsertActive(history.startConversation(store), [msg(1, 'user', `Câu ${i}`)], i);
  }
  assert.equal(store.conversations.length, history.MAX_CONVERSATIONS);
  assert.equal(store.conversations[0].title, 'Câu 24');
  const many = Array.from({ length: 50 }, (_, i) => msg(i, i % 2 ? 'assistant' : 'user', `m${i}`));
  assert.equal(history.upsertActive(store, many, 99).conversations[0].messages.length, history.MAX_MESSAGES);
  assert.equal(history.conversationTitle([msg(1, 'user', 'x'.repeat(80))]).length, 60);
});

test('removing the open conversation starts a new one; undo puts it back in order', () => {
  let store = history.loadStore(null, 'u1');
  store = history.upsertActive(store, [msg(1, 'user', 'A')], 100);
  const removed = store.conversations[0];
  const after = history.removeConversation(store, removed.id);
  assert.equal(after.conversations.length, 0);
  assert.notEqual(after.activeId, removed.id);
  assert.deepEqual(history.restoreConversation(after, removed).conversations, [removed]);
});
