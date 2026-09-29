// The `explain` flag lets ranking-only callers (per-line preview on the putaway
// receipt) skip the AI paraphrase, without changing the default for everyone else.
const test = require('node:test');
const assert = require('node:assert/strict');

const servicePath = require.resolve('../src/services/storage-suggestion.service');
const scopePath = require.resolve('../src/utils/warehouse-scope.utils');

const calls = [];
require.cache[servicePath] = {
  id: servicePath, filename: servicePath, loaded: true,
  exports: {
    VALID_SUGGESTION_MODES: ['RECEIVING', 'PUTAWAY', 'RELOCATION', 'AI_IMPORT'],
    generateSuggestions: async (...args) => { calls.push(args); return { success: true, suggestions: [], fallback: true }; },
  },
};
require.cache[scopePath] = {
  id: scopePath, filename: scopePath, loaded: true,
  exports: { requireWarehouseReadAccess: async () => true, requireWarehouseWriteAccess: async () => true },
};

const { getSuggestions } = require('../src/controllers/storage-suggestion.controller');

const WH = '11111111-1111-4111-8111-111111111111';
const VAR = '22222222-2222-4222-8222-222222222222';
const res = () => ({ statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } });
const req = (body) => ({ body, user: { permissions: ['inventory.stock.read'] }, requestId: 'r1' });

test('explain defaults to true (AI paraphrase requested)', async () => {
  calls.length = 0;
  await getSuggestions(req({ warehouse_id: WH, variant_id: VAR, quantity: 3 }), res());
  assert.deepEqual(calls[0].slice(0, 4), [WH, VAR, 3, 'RECEIVING']);
  assert.deepEqual(calls[0][5], { explain: true });
});

test('explain: false is forwarded so the service skips the LLM call', async () => {
  calls.length = 0;
  await getSuggestions(req({ warehouse_id: WH, variant_id: VAR, quantity: 3, mode: 'PUTAWAY', explain: false }), res());
  assert.equal(calls[0][3], 'PUTAWAY');
  assert.deepEqual(calls[0][5], { explain: false });
});
