const test = require('node:test');
const assert = require('node:assert/strict');

const redis = require('../src/lib/redis');
const revocation = require('../src/lib/token-revocation');

// Phase 5: a revocation written while Redis is down is retried, not lost.
test('a logout during a Redis outage is queued and written once Redis answers', async () => {
  const store = new Map();
  let down = true;
  redis.setStrict = async (key, value) => { if (down) throw new Error('Redis is not connected'); store.set(key, value); };

  assert.equal(await revocation.blacklistToken('u1-1', 600), false);
  assert.equal(store.size, 0);
  assert.ok(revocation._pending.has('blacklist:token:u1-1'));

  down = false;
  await revocation._flush();
  assert.equal(store.get('blacklist:token:u1-1'), '1');
  assert.equal(revocation._pending.size, 0);
});

test('a queued cutoff only moves forward and an expired entry is dropped', async () => {
  let down = true;
  const store = new Map();
  redis.setStrict = async (key, value) => { if (down) throw new Error('down'); store.set(key, value); };
  await revocation.revokeUserTokensIssuedBefore('u2');
  const first = revocation._pending.get('user:tokens-valid-after:u2').value;
  assert.ok(Number(first) > 0);

  assert.equal(await revocation.blacklistToken('gone', 1), false);
  revocation._pending.get('blacklist:token:gone').until = Date.now() - 1;
  down = false;
  await revocation._flush();
  assert.equal(store.get('user:tokens-valid-after:u2'), first);
  assert.equal(store.has('blacklist:token:gone'), false);
});

test('written immediately when Redis answers', async () => {
  const store = new Map();
  redis.setStrict = async (key, value) => { store.set(key, value); };
  assert.equal(await revocation.blacklistToken('u3-1', 60), true);
  assert.equal(store.get('blacklist:token:u3-1'), '1');
});
