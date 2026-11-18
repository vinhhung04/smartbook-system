import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { root, runShellSandbox } from './helpers/shell-sandbox.mjs';
import { caddyImage } from './helpers/runtime-images.mjs';

test('release includes a separately pulled Caddy digest without making edge an application writer', () => {
  const lib = readFileSync(resolve(root, 'deploy/scripts/lib.sh'), 'utf8');
  assert.doesNotMatch(lib.match(/^APP_SERVICES=.*$/m)[0], /caddy/);
  assert.match(lib, /IMAGE_SERVICES=\("\$\{APP_SERVICES\[@\]\}" caddy\)/);
  const result = runShellSandbox('deploy.sh', { args: ['b'.repeat(40)] });
  assert.match(result.trace, /pull --quiet [^\n]* web caddy/);
  assert.match(result.trace, /smartbook-caddy@sha256:/);
  assert.equal(result.status, 1, 'The controlled failing rollout must still fail closed');
});

for (const scenario of ['missing-caddy', 'foreign-registry', 'foreign-repository']) {
  test(`release refuses ${scenario} manifest before pulling or changing containers`, () => {
    const result = runShellSandbox('deploy.sh', { args: ['b'.repeat(40)], prepare(directory) {
      const path = resolve(directory, `state/images/${'b'.repeat(40)}.env`);
      let manifest = readFileSync(path, 'utf8');
      if (scenario === 'missing-caddy') manifest = manifest.replace(/^CADDY_IMAGE=.*\n/m, '');
      if (scenario === 'foreign-registry') manifest = manifest.replace('ghcr.io/vinhhung04/smartbook-caddy', 'ghcr.io/untrusted/smartbook-caddy');
      if (scenario === 'foreign-repository') manifest = manifest.replace('ghcr.io/vinhhung04/smartbook-caddy', 'ghcr.io/vinhhung04/smartbook-web');
      writeFileSync(path, manifest);
    } });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /missing\/wrong service image digest/);
    assert.doesNotMatch(result.trace, /^DC .* (?:pull|stop|run|up) /m);
  });
}

test('Caddy runtime regressions require the explicit SHA-tagged local custom image', () => {
  const directory = resolve(root, '.git/caddy-image-contract'); mkdirSync(directory, { recursive: true });
  writeFileSync(resolve(directory, 'compose.prod.yml'), 'services:\n  caddy:\n    image: ${CADDY_IMAGE:-ghcr.io/vinhhung04/smartbook-caddy:latest}\n');
  const before = process.env.SMARTBOOK_TEST_CADDY_IMAGE;
  try {
    delete process.env.SMARTBOOK_TEST_CADDY_IMAGE;
    assert.throws(() => caddyImage(directory), /Explicit locally built/);
    for (const invalid of ['caddy:2.8', 'caddy:2.11.9', 'ghcr.io/untrusted/caddy:latest']) {
      process.env.SMARTBOOK_TEST_CADDY_IMAGE = invalid;
      assert.throws(() => caddyImage(directory), /Explicit locally built/);
    }
    process.env.SMARTBOOK_TEST_CADDY_IMAGE = `smartbook-qa-caddy:${'a'.repeat(40)}`;
    assert.equal(caddyImage(directory), process.env.SMARTBOOK_TEST_CADDY_IMAGE);
  } finally {
    if (before === undefined) delete process.env.SMARTBOOK_TEST_CADDY_IMAGE;
    else process.env.SMARTBOOK_TEST_CADDY_IMAGE = before;
  }
});

test('release build publishes all eight verified component artifacts including Caddy', () => {
  const workflow = readFileSync(resolve(root, '.github/workflows/deploy-production.yml'), 'utf8');
  const names = [...workflow.matchAll(/^          - name: ([a-z-]+)$/gm)].map(match => match[1]);
  assert.equal(names.length, 8);
  assert.ok(names.includes('caddy'));
  assert.match(workflow, /file: deploy\/Dockerfile\.caddy/);
  assert.match(workflow, /caddy\) docker run.*--entrypoint caddy/);
});
