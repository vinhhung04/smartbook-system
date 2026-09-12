/**
 * RabbitMQ consumer that pushes `inventory.reservation.created` events to the
 * customer's Socket.IO room — the durable replacement path for what used to
 * only be reachable via the synchronous /internal/push-event HTTP call.
 *
 * This is a NEW capability, not a replacement: the existing HTTP push for
 * `reservation:created` (see borrow-service/src/lib/notifications.js) targets
 * the staff rooms (admin/librarian), never the customer room — so there is no
 * duplicate push to reconcile here.
 */

const amqp = require('amqp-connection-manager');

const EXCHANGE = 'smartbook.events';
const DLX = 'smartbook.events.dlx';
const ROUTING_KEY = 'inventory.reservation.created';
const QUEUE = 'gateway-push.reservation-created.queue';
const DLQ_ROUTING_KEY = 'gateway-push.reservation-created';
const DLQ = 'gateway-push.reservation-created.dlq';

function startGatewayRabbitMqConsumer(io) {
  const enabled = String(process.env.ENABLE_GATEWAY_RABBITMQ_CONSUMER || 'true').toLowerCase() === 'true';
  if (!enabled) {
    console.log('[api-gateway][rabbitmq] consumer disabled by env');
    return null;
  }

  const url = process.env.RABBITMQ_URL || 'amqp://rabbitmq:5672';
  const connection = amqp.connect([url]);

  connection.on('connect', () => console.log('[api-gateway][rabbitmq] connected'));
  connection.on('disconnect', (params) => {
    console.warn('[api-gateway][rabbitmq] disconnected, will reconnect:', params?.err?.message);
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
      await channel.bindQueue(QUEUE, EXCHANGE, ROUTING_KEY);
      await channel.consume(QUEUE, (msg) => handleMessage(channel, io, msg));
    },
  });

  console.log('[api-gateway][rabbitmq] consumer started', { queue: QUEUE, routingKey: ROUTING_KEY });
  return channelWrapper;
}

function handleMessage(channel, io, msg) {
  if (!msg) return;

  try {
    const envelope = JSON.parse(msg.content.toString('utf8'));
    const customerId = envelope.payload?.customer_id;

    if (!customerId) {
      console.warn('[api-gateway][rabbitmq] message missing payload.customer_id, sending to DLQ', envelope.event_id);
      channel.nack(msg, false, false);
      return;
    }

    io.to(`customer:${customerId}`).emit('reservation:created', envelope.payload);
    channel.ack(msg);
  } catch (error) {
    console.error('[api-gateway][rabbitmq] failed to handle message, sending to DLQ:', error.message);
    channel.nack(msg, false, false);
  }
}

module.exports = { startGatewayRabbitMqConsumer, handleMessage };
