// Boots the real Grafana + Prometheus images from compose.prod.yml with this
// repository's provisioning, on an isolated internal Docker network. Guards the
// three monitoring regressions found in the 2026-11 audit:
//   1. Grafana must provision (contact point URL can never be empty) and must
//      refuse to start without MONITORING_INGEST_TOKEN instead of misdelivering;
//   2. a healthy system must not fire or pend any rule (NoData semantics);
//   3. a lost scrape target must raise exactly the availability rule for it.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '../../..');
const compose = readFileSync(resolve(root, 'compose.prod.yml'), 'utf8');
const image = (name) => compose.match(new RegExp(`^  ${name}:\\s*\\r?\\n(?:\\s+#.*\\r?\\n)*\\s+image:\\s*(\\S+)`, 'm'))?.[1];
const grafanaImage = image('grafana');
const prometheusImage = image('prometheus');
const grafanaBlock = compose.split(/^  grafana:\r?$/m)[1].split(/^  [a-z-]+:\r?$/m)[0];
const entrypoint = grafanaBlock.match(/^\s+- '(\[ "\$\$\{#MONITORING_INGEST_TOKEN\}".*)'\r?$/m)?.[1]?.replaceAll('$$', '$');
const id = randomBytes(4).toString('hex');
const net = `sb-alert-test-${id}`;
const token = randomBytes(24).toString('hex');
const password = randomBytes(16).toString('hex');

function docker(args, options = {}) {
  return spawnSync('docker', args, { encoding: 'utf8', timeout: 120_000, ...options });
}
function run(args) {
  const result = docker(args);
  assert.equal(result.status, 0, `${args.join(' ')}\n${result.stdout}\n${result.stderr}`);
  return result.stdout.trim();
}
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function rules(container) {
  const result = docker(['exec', container, 'wget', '-qO-', `http://admin:${password}@127.0.0.1:3000/api/prometheus/grafana/api/v1/rules`]);
  if (result.status !== 0) return null;
  return JSON.parse(result.stdout).data.groups.flatMap((group) => group.rules);
}

async function evaluatedRules(container, minimum) {
  let list = null;
  for (let i = 0; i < 60; i += 1) {
    list = await rules(container);
    if (list && list.length >= minimum && list.every((rule) => rule.lastEvaluation && !rule.lastEvaluation.startsWith('0001'))) return list;
    await sleep(3000);
  }
  const logs = docker(['logs', '--tail', '15', container]);
  throw new Error(`rules were not evaluated within 180s: ${list ? `${list.length} rules, unevaluated: ${list.filter((r) => !r.lastEvaluation || r.lastEvaluation.startsWith('0001')).map((r) => r.name).slice(0, 5)}` : 'rules API unreachable'}\n${logs.stdout}${logs.stderr}`);
}

test('Grafana provisions every rule, stays quiet when healthy and fires only for a lost target', { timeout: 600_000 }, async (t) => {
  assert.ok(grafanaImage && prometheusImage, 'monitoring images must be pinned in compose.prod.yml');
  assert.ok(entrypoint, 'Grafana must guard MONITORING_INGEST_TOKEN in its entrypoint');
  const directory = resolve(root, '.git', `grafana-alerting-${id}`);
  mkdirSync(resolve(directory, 'prometheus'), { recursive: true });
  // Healthy: Prometheus itself. Fault: one unreachable target labelled like a service.
  writeFileSync(resolve(directory, 'prometheus/prometheus.yml'), [
    'global: { scrape_interval: 5s, scrape_timeout: 4s }',
    'scrape_configs:',
    '  - job_name: prometheus',
    '    static_configs: [{ targets: ["localhost:9090"], labels: { service_name: prometheus } }]',
    '  - job_name: ghost',
    '    static_configs: [{ targets: ["ghost-service.invalid:9464"], labels: { service_name: ghost-service } }]',
  ].join('\n'));
  const names = { prometheus: 'prometheus', grafana: `sb-alert-test-grafana-${id}`, refused: `sb-alert-test-refused-${id}` };
  t.after(() => {
    docker(['rm', '-f', `${names.prometheus}-${id}`, names.grafana, names.refused]);
    docker(['network', 'rm', net]);
  });
  run(['network', 'create', '--internal', net]);
  // Grafana's datasource points at http://prometheus:9090.
  run(['run', '-d', '--name', `${names.prometheus}-${id}`, '--network', net, '--network-alias', 'prometheus', '--read-only',
    '--mount', `type=bind,source=${resolve(directory, 'prometheus')},target=/etc/prometheus,readonly`, '--tmpfs', '/prometheus:rw,uid=65534,gid=65534,mode=0755', prometheusImage]);
  // "Healthy" starts once Prometheus has scraped itself: its very first self-scrape
  // can precede its own listener (a transient up=0 that `for: 2m` absorbs in practice).
  for (let i = 0; ; i += 1) {
    const targets = docker(['exec', `${names.prometheus}-${id}`, 'wget', '-qO-', 'http://127.0.0.1:9090/api/v1/query?query=up%7Bjob%3D%22prometheus%22%7D']);
    if (targets.status === 0 && /"value":\[[^\]]*,"1"\]/.test(targets.stdout)) break;
    assert.ok(i < 40, `Prometheus never scraped itself: ${targets.stdout}${targets.stderr}`);
    await sleep(1500);
  }
  const mounts = ['--mount', `type=bind,source=${resolve(root, 'observability/grafana/provisioning')},target=/etc/grafana/provisioning,readonly`,
    '--mount', `type=bind,source=${resolve(root, 'observability/grafana/dashboards')},target=/var/lib/grafana/dashboards,readonly`];

  // 1a. Without a token Grafana refuses to start.
  const refused = docker(['run', '--name', names.refused, '--network', net, ...mounts, '-e', 'MONITORING_INGEST_TOKEN=', '--entrypoint', 'sh', grafanaImage, '-c', entrypoint]);
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /MONITORING_INGEST_TOKEN/);

  // 1b. With it, provisioning (contact point + every rule) succeeds.
  run(['run', '-d', '--name', names.grafana, '--network', net, ...mounts, '-e', `GF_SECURITY_ADMIN_PASSWORD=${password}`,
    '-e', `MONITORING_INGEST_TOKEN=${token}`, '-e', 'GF_ANALYTICS_REPORTING_ENABLED=false', '-e', 'GF_ANALYTICS_CHECK_FOR_UPDATES=false',
    '--entrypoint', 'sh', grafanaImage, '-c', entrypoint]);
  const expected = [...readFileSync(resolve(root, 'observability/grafana/provisioning/alerting/rules.yaml'), 'utf8').matchAll(/^      - uid: (\S+)/gm)].map((m) => m[1]);
  const list = await evaluatedRules(names.grafana, expected.length);
  const logs = docker(['logs', names.grafana]);
  assert.doesNotMatch(logs.stdout + logs.stderr, /Failed to provision|failure to map file/);
  assert.equal(list.length, expected.length, 'every provisioned rule is loaded');
  assert.ok(list.every((rule) => rule.health === 'ok'), JSON.stringify(list.filter((rule) => rule.health !== 'ok').map((rule) => [rule.name, rule.lastError])));

  // 2 + 3. Nothing but the lost target's availability rule is pending or firing.
  const active = list.filter((rule) => rule.state !== 'inactive');
  assert.deepEqual(active.map((rule) => rule.name), ['Service metrics unavailable'], JSON.stringify(active.map((rule) => [rule.name, rule.state, rule.alerts?.map((a) => a.labels)])));
  // A rule lists all its instances; only Pending/Alerting ones are raised (prometheus itself stays Normal).
  const raised = active[0].alerts.filter((alert) => !alert.state.startsWith('Normal'));
  assert.deepEqual(raised.map((alert) => alert.labels.service_name), ['ghost-service']);
  assert.equal(raised[0].labels.severity, 'critical');
  assert.equal(raised[0].labels.alert_kind, 'availability');
});
