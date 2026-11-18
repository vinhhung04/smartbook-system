import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { caddyImage } from '../helpers/runtime-images.mjs';
const root = resolve(import.meta.dirname, '../../..');
const image = caddyImage(root);
const run = args => spawnSync('docker', args, { encoding: 'utf8', timeout: 15000 });
const wait = ms => new Promise(r => setTimeout(r, ms));
test('PRA12: real production Caddy version redacts supplier URL and header secrets from access and upstream-error logs', async () => {
  const source = readFileSync(resolve(root, 'deploy/Caddyfile'), 'utf8');
  const common = source.match(/^\(common\)\s*\{[\s\S]*?^\}/m)?.[0];
  assert.ok(common, 'Use the actual production common configuration');
  const global = source.match(/^\{\s*$[\s\S]*?^\}/m)?.[0] || '';
  const id = randomBytes(5).toString('hex');
  const dir = resolve(root, '.git', `caddy-log-test-${id}`);
  mkdirSync(dir, { recursive: true });
  const config = resolve(dir, 'Caddyfile');
  writeFileSync(config, `${global}\n${common}\nhttp://127.0.0.1:8080 {\n import common\n reverse_proxy 127.0.0.1:1\n}\n`);
  const name = `smartbook-readiness-caddy-${id}`;
  const created = run(['create', '--name', name, '--network', 'none', '--mount', `type=bind,source=${config},target=/etc/caddy/Caddyfile,readonly`, image, 'caddy', 'run', '--config', '/etc/caddy/Caddyfile', '--adapter', 'caddyfile']);
  assert.equal(created.status, 0, created.stderr);
  try {
    assert.equal(run(['start', name]).status, 0);
    const marker = 'FAKE_CADDY_SUPPLIER_MARKER_21c6';
    let logs = '';
    for (let i = 0; i < 25; i++) {
      run(['exec', name, 'wget', '-qO-', '--header', `Authorization: Bearer ${marker}`, '--header', `Cookie: session=${marker}`, '--header', `Referer: http://test.invalid/${marker}`, '--header', 'X-Request-Id: SAFE-CADDY-REQUEST-ID', `http://127.0.0.1:8080/api/supplier-portal/orders/${marker}/confirm?token=${marker}`]);
      await wait(100);
      const captured = run(['logs', name]); logs = captured.stdout + captured.stderr;
      if (logs.includes('"status":502')) break;
    }
    assert.match(logs, /"status":502/, 'Actually exercise both access and upstream-error logging');
    assert.ok(!logs.includes(marker), 'Synthetic bearer marker must be absent from all Caddy logs');
    assert.ok(logs.includes('SAFE-CADDY-REQUEST-ID'), 'Retain a safe correlation identifier');
  } finally { run(['stop', '--time', '2', name]); }
});
