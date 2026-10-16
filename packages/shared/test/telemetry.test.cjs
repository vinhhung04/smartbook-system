const assert = require('node:assert/strict');
const test = require('node:test');

const { initTelemetry } = require('../telemetry/index.cjs');
const { getMeter } = require('../metrics/index.cjs');

const METRICS_PORT = 19464;

// Loaded after initTelemetry (see the test): instrumentation only patches modules
// required after it is registered - that is why the services preload it with
// `node -r ./src/telemetry.js`.
let http;

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

function get(port, path) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    }).on('error', reject);
  });
}

test('metrics are exported for Prometheus without any OTLP/trace backend', async (t) => {
  delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  const meterProvider = initTelemetry('telemetry-test', { port: METRICS_PORT });
  http = require('http');
  const app = http.createServer((_req, res) => res.end('ok'));
  t.after(async () => {
    app.close();
    await meterProvider.shutdown();
  });

  getMeter('telemetry-test').createCounter('telemetry_test_events_total').add(2, { kind: 'demo' });
  assert.equal(await get(await listen(app), '/books'), 200);

  const body = await (await fetch(`http://127.0.0.1:${METRICS_PORT}/metrics`)).text();
  // HTTP rate / p95 latency / 5xx error rate on the dashboards and alerts.
  assert.match(body, /^http_server_duration_count\{[^}]*http_status_code="200"[^}]*\} 1$/m);
  assert.match(body, /^http_server_duration_bucket\{/m);
  // Business metrics created through @smartbook/shared/metrics share the same exporter.
  assert.match(body, /^telemetry_test_events_total\{kind="demo"\} 2$/m);
  assert.match(body, /^target_info\{[^}]*service_name="telemetry-test"/m);
});
