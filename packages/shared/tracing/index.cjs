const { NodeSDK } = require('@opentelemetry/sdk-node');
const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
const { Resource } = require('@opentelemetry/resources');
const { SEMRESATTRS_SERVICE_NAME } = require('@opentelemetry/semantic-conventions');
const { PrismaInstrumentation } = require('@prisma/instrumentation');

function initTracing(serviceName) {
  if (!process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
    console.log(`[${serviceName}][tracing] OTEL_EXPORTER_OTLP_ENDPOINT not set, tracing disabled`);
    return null;
  }

  const sdk = new NodeSDK({
    resource: new Resource({ [SEMRESATTRS_SERVICE_NAME]: serviceName }),
    traceExporter: new OTLPTraceExporter(),
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': { enabled: false },
      }),
      new PrismaInstrumentation(),
    ],
  });

  sdk.start();
  console.log(`[${serviceName}][tracing] started`);
  process.on('SIGTERM', () => {
    sdk.shutdown().catch(() => {});
  });

  return sdk;
}

module.exports = { initTracing };
