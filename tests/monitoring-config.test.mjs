// Monitoring is optional: Prometheus + Grafana run only with `--profile monitoring`,
// and nothing in the default stack depends on them. Loki, Promtail and Tempo were
// removed; these checks keep them (and their OTLP wiring) from creeping back in.
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const compose = read('docker-compose.yml');

function serviceBlocks() {
  const services = compose.split(/^services:\r?$/m)[1].split(/^volumes:\r?$/m)[0];
  const blocks = {};
  for (const part of services.split(/^(?=  [a-z0-9-]+:\r?$)/m)) {
    const name = part.match(/^  ([a-z0-9-]+):/)?.[1];
    if (name) blocks[name] = part;
  }
  return blocks;
}

// Names of the services listed under a block's depends_on.
function dependencies(block) {
  const section = block.split(/^    depends_on:\r?$/m)[1]?.split(/^    [a-z_]+:/m)[0] ?? '';
  return [...section.matchAll(/^      ([a-z0-9-]+):/gm)].map((m) => m[1]);
}

const MONITORING = ['prometheus', 'grafana'];
const BUSINESS = ['inventory-service', 'auth-service', 'borrow-service', 'analytics-service', 'ai-service', 'api-gateway', 'smartbook-ui'];

test('Loki, Promtail and Tempo are gone from compose and the repository', () => {
  const blocks = serviceBlocks();
  for (const name of ['loki', 'promtail', 'tempo']) {
    assert.equal(blocks[name], undefined, `${name} service`);
    assert.equal(existsSync(resolve(root, 'observability', name)), false, `observability/${name}`);
  }
  assert.doesNotMatch(compose, /tempo|loki|promtail/i);
  assert.doesNotMatch(compose, /OTEL_|OTLP/);
});

test('Prometheus and Grafana run only with the monitoring profile', () => {
  const blocks = serviceBlocks();
  for (const name of MONITORING) {
    assert.ok(blocks[name], name);
    assert.match(blocks[name], /^    profiles: \["monitoring"\]\r?$/m, name);
  }
});

test('no business service depends on a monitoring service', () => {
  const blocks = serviceBlocks();
  for (const name of BUSINESS) {
    assert.ok(blocks[name], name);
    const deps = dependencies(blocks[name]);
    assert.ok(deps.length > 0, `${name} has depends_on`);
    for (const monitoring of MONITORING) assert.ok(!deps.includes(monitoring), `${name} -> ${monitoring}`);
  }
  // Grafana needs only Prometheus.
  assert.deepEqual(dependencies(blocks.grafana), ['prometheus']);
});

test('the default stack needs no Grafana secret, and Grafana refuses to start without one', () => {
  const grafana = serviceBlocks().grafana;
  // No compose interpolation (which would fail every `docker compose` command when unset).
  assert.doesNotMatch(compose, /\$\{GRAFANA_ADMIN_PASSWORD/);
  assert.match(grafana, /^      - GRAFANA_ADMIN_PASSWORD\r?$/m);
  assert.match(grafana, /\[ -n "\$\$GRAFANA_ADMIN_PASSWORD" \] \|\| \{[^}]*exit 1; \}/);
  assert.match(grafana, /GF_SECURITY_ADMIN_PASSWORD="\$\$GRAFANA_ADMIN_PASSWORD" exec \/run\.sh/);
});

test('health checks stay on the infrastructure and business services', () => {
  const blocks = serviceBlocks();
  for (const name of ['db', 'redis', 'rabbitmq', 'inventory-service', 'auth-service', 'borrow-service', 'analytics-service', 'api-gateway', 'smartbook-ui', ...MONITORING]) {
    assert.match(blocks[name], /^    healthcheck:\r?$/m, name);
  }
});

test('Prometheus scrapes every service and labels it with service_name', () => {
  const config = read('observability/prometheus/prometheus.yml');
  for (const [service, port] of [['api-gateway', 9464], ['auth-service', 9464], ['inventory-service', 9464],
    ['borrow-service', 9464], ['analytics-service', 9464], ['ai-service', 8000]]) {
    assert.match(config, new RegExp(`targets: \\[${service}:${port}\\]\\r?\\n\\s+labels: \\{ service_name: ${service} \\}`), service);
  }
});

test('Grafana provisions only Prometheus, and every panel and alert uses it', () => {
  const datasources = read('observability/grafana/provisioning/datasources/datasources.yml');
  assert.deepEqual([...datasources.matchAll(/^\s+type: (\S+)/gm)].map((m) => m[1]), ['prometheus']);
  assert.doesNotMatch(datasources, /loki|tempo|derivedFields/i);

  const dashboards = readdirSync(resolve(root, 'observability/grafana/dashboards'));
  assert.ok(dashboards.length > 0);
  for (const file of dashboards) {
    const { panels } = JSON.parse(read(`observability/grafana/dashboards/${file}`));
    for (const panel of panels) {
      assert.equal(panel.datasource?.uid, 'prometheus-ds', `${file}: ${panel.title}`);
    }
  }
  const rules = read('observability/grafana/provisioning/alerting/rules.yaml');
  const uids = [...rules.matchAll(/datasourceUid: (\S+)/g)].map((m) => m[1]);
  assert.ok(uids.length > 0);
  assert.deepEqual([...new Set(uids)], ['prometheus-ds']);
});

test('the AI dashboard keeps the latency, token, cost, OCR and catalog-sync metrics', () => {
  const dashboard = read('observability/grafana/dashboards/ai-performance.json');
  for (const metric of ['ai_request_duration_seconds', 'ai_llm_tokens_total', 'ai_llm_cost_usd_total',
    'ocr_request_duration_seconds', 'ai_catalog_sync_last_success_timestamp_seconds', 'http_requests_total']) {
    assert.match(dashboard, new RegExp(metric), metric);
  }
});

test('Node services export Prometheus metrics without a tracing SDK', () => {
  const telemetry = read('packages/shared/telemetry/index.cjs');
  assert.match(telemetry, /PrometheusExporter/);
  assert.match(telemetry, /HttpInstrumentation/);
  assert.doesNotMatch(telemetry, /OTEL_EXPORTER_OTLP_ENDPOINT|sdk-node|exporter-trace|auto-instrumentations/);
  const shared = JSON.parse(read('packages/shared/package.json'));
  assert.doesNotMatch(Object.keys(shared.dependencies).join(' '), /sdk-node|exporter-trace-otlp|auto-instrumentations|@prisma\/instrumentation/);
  for (const dir of ['apps/api-gateway', 'services/auth-service', 'services/inventory-service',
    'services/borrow-service', 'services/analytics-service']) {
    assert.match(read(`${dir}/src/telemetry.js`), /initTelemetry\('/, dir);
    assert.match(read(`${dir}/Dockerfile`), /"-r", "\.\/src\/telemetry\.js"/, dir);
  }
});

test('ai-service runs without the OpenTelemetry agent but keeps its /metrics endpoint', () => {
  assert.doesNotMatch(read('services/ai-service/Dockerfile'), /opentelemetry-instrument/);
  const requirements = read('services/ai-service/requirements.txt');
  assert.doesNotMatch(requirements, /opentelemetry/);
  assert.match(requirements, /^prometheus-fastapi-instrumentator\r?$/m);
  assert.match(requirements, /^prometheus-client\r?$/m);
  assert.match(read('services/ai-service/main.py'), /Instrumentator\(\)\.instrument\(app\)\.expose\(app\)/);
});
