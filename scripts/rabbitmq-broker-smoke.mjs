// Phase 0 risk-first check for SB-03/SB-04: proves the RabbitMQ container in
// docker-compose actually works (network, credentials, publish+consume
// round-trip) with ZERO application service code involved. If this script
// fails, no application code built on top of the broker can be trusted yet.
import amqp from 'amqplib';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const envPath = resolve(root, '.env');

function readEnvVar(name, fallback) {
  if (!existsSync(envPath)) return fallback;
  const contents = readFileSync(envPath, 'utf8');
  const match = contents.match(new RegExp(`^${name}=(.*)$`, 'm'));
  return match ? match[1].trim() : fallback;
}

const user = process.env.RABBITMQ_USER || readEnvVar('RABBITMQ_USER', 'smartbook');
const password = process.env.RABBITMQ_PASSWORD || readEnvVar('RABBITMQ_PASSWORD', '');
const url = process.env.RABBITMQ_URL || `amqp://${user}:${password}@localhost:5672`;

const EXCHANGE = 'smartbook.events.smoketest';
const QUEUE = 'smartbook.events.smoketest.queue';
const ROUTING_KEY = 'smoketest.ping';

async function run() {
  if (!password) {
    throw new Error('RABBITMQ_PASSWORD not set (checked process.env and .env)');
  }

  console.log(`Connecting to ${url.replace(/:[^:@]+@/, ':***@')}...`);
  const connection = await amqp.connect(url);
  const channel = await connection.createChannel();

  await channel.assertExchange(EXCHANGE, 'topic', { durable: false, autoDelete: true });
  const { queue } = await channel.assertQueue(QUEUE, { durable: false, autoDelete: true, exclusive: false });
  await channel.bindQueue(queue, EXCHANGE, ROUTING_KEY);

  const payload = { ping: 'smartbook-broker-smoke', sentAt: new Date().toISOString(), nonce: Math.random() };

  const received = await new Promise((resolvePromise, rejectPromise) => {
    const timeout = setTimeout(() => rejectPromise(new Error('Timed out waiting for message (5s)')), 5000);

    channel.consume(queue, (msg) => {
      if (!msg) return;
      clearTimeout(timeout);
      channel.ack(msg);
      try {
        resolvePromise(JSON.parse(msg.content.toString('utf8')));
      } catch (error) {
        rejectPromise(error);
      }
    }, { noAck: false }).then(() => {
      channel.publish(EXCHANGE, ROUTING_KEY, Buffer.from(JSON.stringify(payload)), { contentType: 'application/json' });
    }).catch(rejectPromise);
  });

  if (received.nonce !== payload.nonce) {
    throw new Error(`Round-trip payload mismatch: sent nonce ${payload.nonce}, received ${received.nonce}`);
  }

  await channel.deleteQueue(QUEUE);
  await channel.deleteExchange(EXCHANGE);
  await channel.close();
  await connection.close();

  console.log('PASS: published a message and consumed it back with matching payload.');
  console.log(`  sent:     ${JSON.stringify(payload)}`);
  console.log(`  received: ${JSON.stringify(received)}`);
}

run().catch((error) => {
  console.error('FAIL:', error.message);
  process.exitCode = 1;
});
