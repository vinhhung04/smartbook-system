const assert = require('node:assert/strict');
const test = require('node:test');
const { WALLET_TOPUP_AMOUNTS_VND, isAllowedTopupAmount } = require('../src/services/account.service');

test('a wallet can only be topped up with the five fixed amounts', () => {
  assert.deepEqual([...WALLET_TOPUP_AMOUNTS_VND], [10000, 20000, 50000, 100000, 200000]);
  for (const amount of [10000, 20000, 50000, 100000, 200000, '50000', '200000.00']) {
    assert.equal(isAllowedTopupAmount(amount), true, `${amount} should be allowed`);
  }
  for (const amount of [15000, 5000, 300000, 10000.5, 0, -10000, 'abc', '', null, undefined, {}]) {
    assert.equal(isAllowedTopupAmount(amount), false, `${String(amount)} should be refused`);
  }
});
