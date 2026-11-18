import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { borrowTestImage } from '../helpers/runtime-images.mjs';

test('PRA19: actual nonroot web image serves SPA/assets and renders CSP without capabilities', () => {
  const root = resolve(import.meta.dirname, '../../..');
  const image = borrowTestImage(root).replace('-borrow-service:', '-smartbook-ui:');
  const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', timeout: 30000, windowsHide: true }).trim();
  const user = docker('image', 'inspect', image, '--format', '{{.Config.User}}');
  assert.ok(user && !['root', '0', '0:0'].includes(user), 'Web runtime must declare a nonroot user');
  const name = `smartbook-web-nonroot-${randomBytes(4).toString('hex')}`;
  docker('run', '-d', '--rm', '--name', name, '--network', 'none',
    '--sysctl', 'net.ipv4.ip_unprivileged_port_start=0', '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges', '--env', 'API_ORIGIN=https://api.example.invalid',
    '--env', 'API_WS_ORIGIN=wss://api.example.invalid', image);
  try {
    assert.notEqual(docker('exec', name, 'id', '-u'), '0');
    const response = docker('exec', name, 'sh', '-c',
      'for attempt in 1 2 3 4 5 6 7 8 9 10; do wget -q -S -O /dev/null http://127.0.0.1/login 2>/tmp/web-proof.headers && cat /tmp/web-proof.headers && exit 0; sleep 0.2; done; cat /tmp/web-proof.headers; exit 1');
    assert.match(response, /HTTP\/1\.1 200/);
    assert.match(response, /Content-Security-Policy:.*connect-src 'self' https:\/\/api\.example\.invalid wss:\/\/api\.example\.invalid/);
    const asset = docker('exec', name, 'sh', '-c', 'find /usr/share/nginx/html/assets -name "*.js" -print -quit');
    assert.match(asset, /^\/usr\/share\/nginx\/html\/assets\/[a-zA-Z0-9._-]+\.js$/);
    docker('exec', name, 'wget', '-q', '-O', '/dev/null', `http://127.0.0.1${asset.replace('/usr/share/nginx/html', '')}`);
  } finally {
    docker('stop', '--time', '5', name);
  }
});
