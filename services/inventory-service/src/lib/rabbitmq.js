/**
 * RabbitMQ publisher for Inventory Service.
 *
 * Thin wrapper (mirrors lib/redis.js's style: connect lazily, degrade
 * gracefully, never throw synchronously) built on amqp-connection-manager so
 * reconnect/backoff is handled by the library instead of hand-rolled here.
 */

const amqp = require('amqp-connection-manager');
const { trace, propagation, context } = require('@opentelemetry/api');
const { rabbitmqPublishFailCounter } = require('./metrics');

const EXCHANGE = 'smartbook.events';
const DLX = 'smartbook.events.dlx';

// @opentelemetry/instrumentation-amqplib can't auto-patch this amqplib
// version: amqplib@2.x's package.json "exports" map only exposes "." and
// "./callback_api", so the instrumentation's hook into "amqplib/lib/
// channel_model.js" never fires (confirmed experimentally — no publish/
// consume spans appear regardless of context propagation). Create the
// publish span by hand instead, and inject the trace context into the
// envelope so the gateway consumer (rabbitmq-consumer.js) can link its own
// span as a child of this one.
const tracer = trace.getTracer('inventory-service-rabbitmq');

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
    return tracer.startActiveSpan(`publish ${EXCHANGE}`, async (span) => {
      try {
        const channelWrapper = this.connect();
        const traceContext = {};
        propagation.inject(context.active(), traceContext);
        await channelWrapper.publish(EXCHANGE, routingKey, { ...envelope, trace_context: traceContext }, { persistent: true });
        return true;
      } catch (error) {
        span.recordException(error);
        rabbitmqPublishFailCounter.add(1);
        console.warn('[inventory-service][rabbitmq] publish failed:', error.message);
        return false;
      } finally {
        span.end();
      }
    });
  }
}

module.exports = new RabbitMqPublisher();
