const assert = require('node:assert/strict');
const test = require('node:test');
const { handleMessage } = require('../src/lib/rabbitmq-consumer');

function fakeChannel() {
  const acked = [];
  const nacked = [];
  return {
    ack: (msg) => acked.push(msg),
    nack: (msg, allUpTo, requeue) => nacked.push({ msg, allUpTo, requeue }),
    acked,
    nacked,
  };
}

function fakeIo() {
  const emitted = [];
  return {
    to: (room) => ({
      emit: (event, data) => emitted.push({ room, event, data }),
    }),
    emitted,
  };
}

function envelopeMessage(envelope) {
  return { content: Buffer.from(JSON.stringify(envelope)) };
}

test('handleMessage emits to the customer room and acks on a valid message', () => {
  const channel = fakeChannel();
  const io = fakeIo();
  const envelope = { event_id: 'e1', event_type: 'inventory.reservation.created', payload: { customer_id: 'cust-1', reservation_id: 'res-1' } };
  const msg = envelopeMessage(envelope);

  handleMessage(channel, io, msg);

  assert.equal(io.emitted.length, 1);
  assert.equal(io.emitted[0].room, 'customer:cust-1');
  assert.equal(io.emitted[0].event, 'reservation:created');
  assert.deepEqual(io.emitted[0].data, envelope.payload);
  assert.equal(channel.acked.length, 1);
  assert.equal(channel.nacked.length, 0);
});

test('handleMessage nacks (no requeue) to the DLQ when payload.customer_id is missing', () => {
  const channel = fakeChannel();
  const io = fakeIo();
  const msg = envelopeMessage({ event_id: 'e2', event_type: 'inventory.reservation.created', payload: { reservation_id: 'res-2' } });

  handleMessage(channel, io, msg);

  assert.equal(io.emitted.length, 0);
  assert.equal(channel.acked.length, 0);
  assert.equal(channel.nacked.length, 1);
  assert.equal(channel.nacked[0].allUpTo, false);
  assert.equal(channel.nacked[0].requeue, false);
});

test('handleMessage nacks (no requeue) instead of throwing on malformed JSON', () => {
  const channel = fakeChannel();
  const io = fakeIo();
  const msg = { content: Buffer.from('not json') };

  assert.doesNotThrow(() => handleMessage(channel, io, msg));
  assert.equal(io.emitted.length, 0);
  assert.equal(channel.nacked.length, 1);
  assert.equal(channel.nacked[0].requeue, false);
});

test('handleMessage is a no-op for a null message (consumer cancellation)', () => {
  const channel = fakeChannel();
  const io = fakeIo();

  assert.doesNotThrow(() => handleMessage(channel, io, null));
  assert.equal(io.emitted.length, 0);
  assert.equal(channel.acked.length, 0);
  assert.equal(channel.nacked.length, 0);
});
