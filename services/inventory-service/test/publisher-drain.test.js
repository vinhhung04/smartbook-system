const test = require('node:test');
const assert = require('node:assert/strict');
const publisher = require('../src/lib/rabbitmq');

test('publisher closes its connection even when channel cleanup rejects, then refuses new publishes', async () => {
  let connectionClosed = 0;
  publisher.channelWrapper = { close: async () => { throw new Error('channel close failed'); } };
  publisher.connection = { close: async () => { connectionClosed++; } };
  await assert.rejects(publisher.close(), /channel close failed/);
  assert.equal(connectionClosed, 1);
  assert.equal(await publisher.publishEvent('test', {}), false);
});
