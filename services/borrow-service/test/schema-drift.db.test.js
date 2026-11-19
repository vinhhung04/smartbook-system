const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const url = process.env.BORROW_POLICY_DATABASE_URL;
test('PRA15: migrated Borrow database matches Prisma and retains SQL-only financial protections', { skip: !url }, async () => {
  const target = new URL(url); assert.equal(target.hostname, '127.0.0.1'); assert.equal(target.pathname, '/borrow_audit');
  const cwd = path.resolve(__dirname, '..');
  const result = spawnSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'diff', '--from-url', url, '--to-schema-datamodel', 'prisma/schema.prisma', '--exit-code'], { cwd, encoding: 'utf8', env: { ...process.env, DATABASE_URL: url, PRISMA_HIDE_UPDATE_MESSAGE: '1' } });
  assert.equal(result.status, 0, (result.stdout + result.stderr).replace(/postgres(?:ql)?:\/\/[^\s"']+/g, '[DATABASE_URL_REDACTED]'));
  const db = new (require('@prisma/client').PrismaClient)({ datasources: { db: { url } } });
  try {
    const triggers = await db.$queryRaw`SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgname IN ('provider_settlement_append_only','fine_payment_request_append_only')`;
    assert.equal(triggers.length, 2);
    const checks = await db.$queryRaw`SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conname='ck_provider_settlement_conservation'`;
    assert.equal(checks.length, 1);
    assert.match(checks[0].definition, /received_amount.*applied_amount.*unapplied_amount/);
  } finally { await db.$disconnect(); }
});
