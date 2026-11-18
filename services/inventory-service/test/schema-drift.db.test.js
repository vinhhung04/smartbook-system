const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const url = process.env.INVENTORY_AUDIT_TEST_DATABASE_URL;
test('PRA15: migrated Inventory matches Prisma and retains partial uniqueness, audit freeze and custody FKs', { skip: !url }, async () => {
  const target = new URL(url); assert.equal(target.hostname, '127.0.0.1'); assert.match(target.pathname, /^\/inventory_audit[a-z_]*$/);
  const cwd = path.resolve(__dirname, '..');
  const result = spawnSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'diff', '--from-url', url, '--to-schema-datamodel', 'prisma/schema.prisma', '--exit-code'], { cwd, encoding: 'utf8', env: { ...process.env, DATABASE_URL: url, PRISMA_HIDE_UPDATE_MESSAGE: '1' } });
  assert.equal(result.status, 0, (result.stdout + result.stderr).replace(/postgres(?:ql)?:\/\/[^\s"']+/g, '[DATABASE_URL_REDACTED]'));
  const db = new (require('@prisma/client').PrismaClient)({ datasources: { db: { url } } });
  try {
    const partial = await db.$queryRaw`SELECT indisunique,pg_get_expr(indpred,indrelid) AS predicate FROM pg_index WHERE indexrelid=to_regclass('uq_stock_audit_location_active')`;
    assert.equal(partial.length, 1); assert.equal(partial[0].indisunique, true); assert.match(partial[0].predicate, /released_at IS NULL/);
    const triggers = await db.$queryRaw`SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgname='stock_balance_audit_freeze'`;
    assert.equal(triggers.length, 1);
    const fks = await db.$queryRaw`SELECT count(*)::integer AS n FROM pg_constraint WHERE contype='f' AND conrelid IN ('transfer_discrepancies'::regclass,'transfer_discrepancy_items'::regclass,'transfer_discrepancy_resolutions'::regclass,'stock_audit_location_sessions'::regclass)`;
    assert.equal(fks[0].n, 12);
  } finally { await db.$disconnect(); }
});
