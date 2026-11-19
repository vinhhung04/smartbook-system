const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
let setup, wrapper, connection;
const amqpPath = require.resolve('amqp-connection-manager');
require.cache[amqpPath] = { id: amqpPath, filename: amqpPath, loaded: true, exports: {
  connect() {
    connection = new EventEmitter();
    connection.close = async () => { connection.closed = true; };
    connection.createChannel = options => { setup = options.setup; wrapper = { close: async () => { wrapper.closed = true; } }; return wrapper; };
    return connection;
  },
} };
const { startAvailabilityAlertConsumer } = require('../src/lib/rabbitmq-consumer');
function channel(overrides = {}) {
  return { assertExchange: async () => {}, assertQueue: async () => {}, bindQueue: async () => {}, prefetch: async () => {},
    consume: async (_q, callback) => { callbackRef = callback; return { consumerTag: 'test-tag' }; },
    cancel: async () => {}, ack() {}, nack() {}, ...overrides };
}
let callbackRef;
test('consumer cancellation failure still drains admitted work and closes broker resources', async () => {
  let finish, acked = false;
  const work = new Promise(resolve => { finish = resolve; });
  const consumer = startAvailabilityAlertConsumer(() => work);
  const ch = channel({ cancel: async () => { throw new Error('cancel failed'); }, ack: () => { acked = true; } });
  await setup(ch);
  callbackRef({ content: Buffer.from(JSON.stringify({ event_type: 'inventory.stock.changed' })) });
  await Promise.resolve();
  const ending = consumer.stop();
  // Capture the stop rejection, but require every admitted handler and resource
  // to finish before the rejection is reported to the service lifecycle.
  const result = ending.then(() => null, error => error);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(acked, false);
  assert.equal(wrapper.closed, undefined);
  finish({});
  assert.ok(await result);
  assert.equal(acked, true);
  assert.equal(wrapper.closed, true);
  assert.equal(connection.closed, true);
});
test('stop during broker setup prevents a late consumer from subscribing after shutdown', async () => {
  let finishSetup, subscriptions = 0;
  const blocked = new Promise(resolve => { finishSetup = resolve; });
  const consumer = startAvailabilityAlertConsumer(async () => ({}));
  const ch = channel({ assertExchange: () => blocked, consume: async () => { subscriptions++; return { consumerTag: 'late' }; } });
  const initializing = setup(ch);
  const ending = consumer.stop();
  finishSetup();
  await initializing;
  await ending;
  assert.equal(subscriptions, 0);
  assert.equal(wrapper.closed, true);
  assert.equal(connection.closed, true);
});
