const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const url = process.env.AUTH_AUDIT_DATABASE_URL;
test('PRA15: independently migrated Auth schema matches its Prisma datamodel', { skip: !url }, () => {
  const target = new URL(url); assert.equal(target.hostname, '127.0.0.1'); assert.equal(target.pathname, '/auth_audit');
  const cwd = path.resolve(__dirname, '..');
  const result = spawnSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'diff', '--from-url', url, '--to-schema-datamodel', 'prisma/schema.prisma', '--exit-code'], { cwd, encoding: 'utf8', env: { ...process.env, DATABASE_URL: url, PRISMA_HIDE_UPDATE_MESSAGE: '1' } });
  assert.equal(result.status, 0, (result.stdout + result.stderr).replace(/postgres(?:ql)?:\/\/[^\s"']+/g, '[DATABASE_URL_REDACTED]'));
});
