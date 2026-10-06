/**
 * Borrow-service consumer for inventory stock events (published by
 * inventory-service's outbox job on the shared `smartbook.events` topic
 * exchange). Same shape as api-gateway/src/lib/rabbitmq-consumer.js: own
 * durable queue, dead-letter queue on the shared DLX, manual ack.
 *
 * Retry policy: a failed message is requeued once (e.g. inventory briefly
 * unreachable); a second failure goes to the DLQ for inspection. Processing is
 * idempotent per alert (see services/availability-alert.service.js), so the
 * retry can never send the same alert twice.
 */

const amqp = require('amqp-connection-manager');
const { ALERT_TRIGGER_EVENTS } = require('../services/availability-alert.service');

const EXCHANGE = 'smartbook.events';
const DLX = 'smartbook.events.dlx';
const QUEUE = 'borrow-service.availability-alerts.queue';
const DLQ_ROUTING_KEY = 'borrow-service.availability-alerts';
const DLQ = 'borrow-service.availability-alerts.dlq';
const PREFETCH = 10;

async function handleMessage(channel, msg, processEnvelope) {
  if (!msg) return;

  let envelope;
  try {
    envelope = JSON.parse(msg.content.toString('utf8'));
  } catch (error) {
    console.error('[borrow-service][rabbitmq] malformed message, sending to DLQ:', error.message);
    channel.nack(msg, false, false);
    return;
  }

  try {
    const result = await processEnvelope(envelope);
    channel.ack(msg);
    if (result?.notified) {
      console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'info',
        service: 'borrow-service',
        correlation_id: envelope.correlation_id || null,
        event_id: envelope.event_id || null,
        event_type: envelope.event_type,
        availability_alerts_notified: result.notified,
        book_id: result.book_id,
      }));
    }
  } catch (error) {
    const requeue = !msg.fields?.redelivered;
    console.error(`[borrow-service][rabbitmq] failed to process ${envelope.event_type} ${envelope.event_id || ''}, ${requeue ? 'requeueing once' : 'sending to DLQ'}:`, error.message);
    channel.nack(msg, false, requeue);
  }
}

function startAvailabilityAlertConsumer(processEnvelope) {
  const enabled = String(process.env.ENABLE_AVAILABILITY_ALERT_CONSUMER || 'true').toLowerCase() === 'true';
  if (!enabled) {
    console.log('[borrow-service][rabbitmq] availability alert consumer disabled by env');
    return null;
  }

  const url = process.env.RABBITMQ_URL || 'amqp://rabbitmq:5672';
  const connection = amqp.connect([url]);
  connection.on('connect', () => console.log('[borrow-service][rabbitmq] connected'));
  connection.on('disconnect', (params) => {
    console.warn('[borrow-service][rabbitmq] disconnected, will reconnect:', params?.err?.message);
  });

  const channelWrapper = connection.createChannel({
    setup: async (channel) => {
      await channel.assertExchange(EXCHANGE, 'topic', { durable: true });
      await channel.assertExchange(DLX, 'direct', { durable: true });
      await channel.assertQueue(DLQ, { durable: true });
      await channel.bindQueue(DLQ, DLX, DLQ_ROUTING_KEY);
      await channel.assertQueue(QUEUE, {
        durable: true,
        arguments: {
          'x-dead-letter-exchange': DLX,
          'x-dead-letter-routing-key': DLQ_ROUTING_KEY,
        },
      });
      for (const routingKey of ALERT_TRIGGER_EVENTS) {
        await channel.bindQueue(QUEUE, EXCHANGE, routingKey);
      }
      await channel.prefetch(PREFETCH);
      await channel.consume(QUEUE, (msg) => handleMessage(channel, msg, processEnvelope));
    },
  });

  console.log('[borrow-service][rabbitmq] availability alert consumer started', { queue: QUEUE, routingKeys: ALERT_TRIGGER_EVENTS });
  return channelWrapper;
}

module.exports = { startAvailabilityAlertConsumer, handleMessage, QUEUE, DLQ };
