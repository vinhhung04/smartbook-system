import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const root = resolve(import.meta.dirname, '../../..');
const dashboards = readdirSync(resolve(root, 'observability/grafana/dashboards')).filter(name => name.endsWith('.json'))
  .map(name => JSON.parse(readFileSync(resolve(root, 'observability/grafana/dashboards', name), 'utf8')));
const alertSource = readFileSync(resolve(root, 'observability/grafana/provisioning/alerting/rules.yaml'), 'utf8');
const alertQueries = [...alertSource.matchAll(/^\s+expr: (.+)$/gm)].map(match => match[1]);
const dashboardQueries = dashboards.flatMap(dashboard => dashboard.panels.flatMap(panel => panel.targets || []).map(target => target.expr));

test('HTTP dashboards and alerts consume current exporter names and preserve millisecond latency display', () => {
  assert.doesNotMatch([...dashboardQueries, ...alertQueries].join('\n'), /http_server_duration|http_status_code|http_method/);
  for (const dashboard of dashboards) {
    for (const panel of dashboard.panels.filter(panel => panel.targets?.some(target => target.expr.includes('http_server_request_duration_bucket')))) {
      assert.equal(panel.fieldConfig.defaults.unit, 'ms');
      assert.match(panel.targets[0].expr, /^1000 \* histogram_quantile/);
    }
  }
  const scrape = readFileSync(resolve(root, 'observability/prometheus/prometheus.yml'), 'utf8');
  for (const service of ['api-gateway', 'auth-service', 'inventory-service', 'borrow-service', 'analytics-service']) {
    assert.ok(scrape.includes(`labels: { service_name: ${service} }`), 'Grouping/filter label must be added by the actual scrape config');
  }
});

test('actual Prometheus parses every provisioned query and verifies latency/error-rate scale with current histogram labels', () => {
  const image = readFileSync(resolve(root, 'compose.prod.yml'), 'utf8').match(/^  prometheus:\s*\r?\n\s+image:\s*(\S+)/m)?.[1];
  assert.match(image || '', /^prom\/prometheus:[A-Za-z0-9._-]+(?:@sha256:[a-f0-9]{64})?$/);
  const directory = resolve(root, '.git', `metrics-promql-${randomBytes(4).toString('hex')}`);
  mkdirSync(directory, { recursive: true });
  writeFileSync(resolve(directory, 'rules.json'), JSON.stringify({ groups: [{ name: 'all-provisioned-queries', rules:
    [...dashboardQueries, ...alertQueries].map((expr, index) => ({ record: `qa_consumer_${index}`, expr })) }] }));
  const overview = dashboards.find(dashboard => dashboard.uid === 'system-overview');
  const borrow = dashboards.find(dashboard => dashboard.uid === 'borrow-flow');
  const expressions = [
    // Prometheus 2.x compares expected floats exactly. Test the intended 150ms
    // within 0.000001ms rather than testing binary rounding bits.
    { expr: `abs((${overview.panels.find(panel => panel.id === 2).targets[0].expr}) - 150) < bool 0.000001`, eval_time: '5m', exp_samples: [{ labels: '{service_name="borrow-service"}', value: 1 }] },
    { expr: `abs((${borrow.panels.find(panel => panel.id === 4).targets[0].expr}) - 150) < bool 0.000001`, eval_time: '5m', exp_samples: [{ labels: '{}', value: 1 }] },
    { expr: overview.panels.find(panel => panel.id === 3).targets[0].expr, eval_time: '5m', exp_samples: [{ labels: '{}', value: 10 }] },
    { expr: alertQueries.find(expr => expr.includes('http_server_request_duration_count')), eval_time: '5m', exp_samples: [{ labels: '{}', value: 0.1 }] },
  ];
  writeFileSync(resolve(directory, 'test.json'), JSON.stringify({ rule_files: ['/qa/rules.json'], evaluation_interval: '1m',
    tests: [{ interval: '1m', input_series: [
      { series: 'http_server_request_duration_bucket{service_name="borrow-service",le="0.1"}', values: '0+540x10' },
      { series: 'http_server_request_duration_bucket{service_name="borrow-service",le="0.2"}', values: '0+600x10' },
      { series: 'http_server_request_duration_bucket{service_name="borrow-service",le="+Inf"}', values: '0+600x10' },
      { series: 'http_server_request_duration_count{service_name="borrow-service",http_response_status_code="200",http_request_method="GET"}', values: '0+540x10' },
      { series: 'http_server_request_duration_count{service_name="borrow-service",http_response_status_code="500",http_request_method="GET"}', values: '0+60x10' },
    ], promql_expr_test: expressions }] }));
  for (const args of [['check', 'rules', '/qa/rules.json'], ['test', 'rules', '/qa/test.json']]) {
    const result = spawnSync('docker', ['run', '--rm', '--network', 'none', '--read-only', '--tmpfs', '/tmp:rw,noexec,nosuid,size=64m', '--mount', `type=bind,source=${directory},target=/qa,readonly`,
      '--entrypoint', 'promtool', image, ...args], { encoding: 'utf8', timeout: 120000 });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  }
});
