/**
 * RabbitMQ publisher for Inventory Service.
 *
 * Thin wrapper (mirrors lib/redis.js's style: connect lazily, degrade
 * gracefully, never throw synchronously) built on amqp-connection-manager so
 * reconnect/backoff is handled by the library instead of hand-rolled here.
 */

const amqp = require('amqp-connection-manager');

const EXCHANGE = 'smartbook.events';
const DLX = 'smartbook.events.dlx';

class RabbitMqPublisher {
  constructor() {
    this.connection = null;
    this.channelWrapper = null;
  }

  connect() {
    if (this.channelWrapper) return this.channelWrapper;

    const url = process.env.RABBITMQ_URL || 'amqp://rabbitmq:5672';
    this.connection = amqp.connect([url]);

    this.connection.on('connect', () => console.log('[inventory-service][rabbitmq] connected'));
    this.connection.on('disconnect', (params) => {
      console.warn('[inventory-service][rabbitmq] disconnected, will reconnect:', params?.err?.message);
    });

    this.channelWrapper = this.connection.createChannel({
      json: true,
      setup: (channel) => Promise.all([
        channel.assertExchange(EXCHANGE, 'topic', { durable: true }),
        channel.assertExchange(DLX, 'direct', { durable: true }),
      ]),
    });

    return this.channelWrapper;
  }

  /**
   * Publishes one event envelope on the shared topic exchange, routed by
   * event_type. Resolves `true` on confirmed publish, resolves `false`
   * (never throws/rejects) when the broker is unreachable — callers (the
   * outbox publisher job) treat that the same as any other publish failure
   * and retry on the next poll tick.
   */
  async publishEvent(routingKey, envelope) {
    try {
      const channelWrapper = this.connect();
      await channelWrapper.publish(EXCHANGE, routingKey, envelope, { persistent: true });
      return true;
    } catch (error) {
      console.warn('[inventory-service][rabbitmq] publish failed:', error.message);
      return false;
    }
  }
}

module.exports = new RabbitMqPublisher();
