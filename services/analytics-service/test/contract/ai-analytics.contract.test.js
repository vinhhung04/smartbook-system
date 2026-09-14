// Contract test for the AI<->Analytics boundary: calls the real, running
// analytics-service (via api-gateway's pure proxy -- analytics-service has
// no host port of its own) with the internal-service-key header
// ai-service's nightly_briefing.py uses, and validates response shapes
// against packages/shared/contracts/ai-analytics. Locks ONE canonical
// {data: ...} shape per endpoint -- the thing nightly_briefing.py's own
// `payload.get("data", payload)` is (over-defensively) tolerant of two
// shapes for; this test defines which one is actually the contract.
//
// Deliberately NOT under test/*.test.js -- separate test:contract script so
// `pnpm test`/`pnpm verify` (no Docker stack needed) never run this.
const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const Ajv = require('ajv');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const INTERNAL_SERVICE_KEY = process.env.INTERNAL_SERVICE_KEY;
if (!INTERNAL_SERVICE_KEY) {
  throw new Error('INTERNAL_SERVICE_KEY env var is required (same value as the running stack\'s .env)');
}

const ajv = new Ajv();
const contractsDir = path.join('..', '..', '..', '..', 'packages', 'shared', 'contracts', 'ai-analytics');
const endpoints = [
  ['overdue-summary', require(path.join(contractsDir, 'overdue-summary.response.json'))],
  ['fine-summary', require(path.join(contractsDir, 'fine-summary.response.json'))],
  ['warehouse-stock-risk', require(path.join(contractsDir, 'warehouse-stock-risk.response.json'))],
  ['reorder-suggestions', require(path.join(contractsDir, 'reorder-suggestions.response.json'))],
  ['reservation-funnel', require(path.join(contractsDir, 'reservation-funnel.response.json'))],
  ['weeding-suggestions', require(path.join(contractsDir, 'weeding-suggestions.response.json'))],
];

async function request(path_) {
  const response = await fetch(`${BASE_URL}/analytics/${path_}`, {
    headers: { 'x-internal-service-key': INTERNAL_SERVICE_KEY },
  });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data };
}

test('contract: analytics-service internal endpoints match locked schemas', async (t) => {
  for (const [path_, schema] of endpoints) {
    await t.test(`GET /analytics/${path_}`, async () => {
      const res = await request(path_);
      assert.equal(res.status, 200, JSON.stringify(res.data));
      const valid = ajv.validate(schema, res.data);
      assert.ok(valid, ajv.errorsText(ajv.errors));
    });
  }
});
