// Prometheus metrics for the Node services, served at :9464/metrics.
//
// Pull-based and independent of the monitoring stack: nothing leaves the process
// unless Prometheus (compose profile `monitoring`) scrapes it, and observable
// gauges (e.g. inventory's low-stock count, db_up) are only computed on a scrape.
// There is no tracing: the stack has no trace backend, so no spans are created.
const { metrics } = require('@opentelemetry/api');
const { MeterProvider } = require('@opentelemetry/sdk-metrics');
const { PrometheusExporter } = require('@opentelemetry/exporter-prometheus');
const { Resource } = require('@opentelemetry/resources');
const { registerInstrumentations } = require('@opentelemetry/instrumentation');
const { HttpInstrumentation } = require('@opentelemetry/instrumentation-http');

const DEFAULT_METRICS_PORT = 9464;

function initTelemetry(serviceName, { port = DEFAULT_METRICS_PORT } = {}) {
  const exporter = new PrometheusExporter({ port }, (error) => {
    if (error) console.error(`[${serviceName}][metrics] exporter failed to start:`, error.message);
  });
  const meterProvider = new MeterProvider({
    resource: new Resource({ 'service.name': serviceName }),
    readers: [exporter],
  });
  metrics.setGlobalMeterProvider(meterProvider);

  // HTTP server/client duration histograms (http_server_duration, http_client_duration):
  // request rate, p95 latency and 5xx error rate on the dashboards and alerts.
  registerInstrumentations({ meterProvider, instrumentations: [new HttpInstrumentation()] });

  console.log(`[${serviceName}][metrics] Prometheus endpoint on :${port}/metrics`);
  return meterProvider;
}

module.exports = { initTelemetry };
