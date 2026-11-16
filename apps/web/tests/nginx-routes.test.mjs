import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

// nginx answers 404 for paths outside its route list, so a route added to routes.ts
// but not to nginx.conf would be served to crawlers as "not found".
test('nginx.conf lists the first segment of every SPA route', () => {
  const routes = read('../src/app/routes.ts');
  const segments = new Set(
    [...routes.matchAll(/path: ['"]([^'"]+)['"]/g)]
      .map(([, path]) => path.replace(/^\//, '').split('/')[0])
      .filter((segment) => segment && segment !== '*'),
  );
  const match = read('../nginx.conf').match(/location ~ \^\/\(([^)]+)\)\(\/\|\$\)/);
  assert.ok(match, 'route location block not found in nginx.conf');
  const listed = new Set(match[1].split('|'));
  const missing = [...segments].filter((segment) => !listed.has(segment));
  assert.deepEqual(missing, []);
});
