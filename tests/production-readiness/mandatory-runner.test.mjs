import assert from 'node:assert/strict';
import test from 'node:test';
import { assertMandatoryTap, mandatoryTestEnvironment, discoverDatabaseTests } from '../../scripts/testing/mandatory-db.mjs';

test('mandatory DB reports reject missing, empty, skipped, cancelled, or failed tests', () => {
  const green = '# tests 12\n# pass 12\n# fail 0\n# cancelled 0\n# skipped 0\n';
  assert.equal(assertMandatoryTap(green).tests, 12);
  for (const bad of ['', green.replace('# tests 12', '# tests 0'), green.replace('# skipped 0', '# skipped 1'),
    green.replace('# fail 0', '# fail 1'), green.replace('# cancelled 0', '# cancelled 1')]) assert.throws(() => assertMandatoryTap(bad));
});

test('mandatory environment drops ambient URLs/client overrides and requires an audit target', () => {
  const result = mandatoryTestEnvironment({ BORROW_POLICY_DATABASE_URL: 'unsafe', AUTH_AUDIT_DATABASE_URL: 'unsafe',
    INVENTORY_AUDIT_TEST_DATABASE_URL: 'unsafe', BORROW_AUDIT_PRISMA_CLIENT: 'unsafe', OPENROUTER_API_KEY: 'unsafe' },
  'postgresql://127.0.0.1:5432/borrow_audit');
  assert.equal(result.BORROW_POLICY_DATABASE_URL, undefined);
  assert.equal(result.AUTH_AUDIT_DATABASE_URL, undefined);
  assert.equal(result.INVENTORY_AUDIT_TEST_DATABASE_URL, undefined);
  assert.equal(result.BORROW_AUDIT_PRISMA_CLIENT, undefined);
  assert.equal(result.OPENROUTER_API_KEY, '');
  for (const bad of ['postgresql://production:5432/borrow_audit', 'postgresql://127.0.0.1:5432/borrow_db',
    'postgresql://127.0.0.1:15432/borrow_audit']) assert.throws(() => mandatoryTestEnvironment({}, bad));
});

test('database discovery includes every current service, policies, schema drift, and new fingerprints', () => {
  assert.ok(discoverDatabaseTests('auth').includes('schema-drift.db.test.js'));
  assert.ok(discoverDatabaseTests('borrow').includes('financial-readiness.db.test.js'));
  assert.ok(discoverDatabaseTests('borrow').includes('wallet-payload-binding.db.test.js'));
  assert.ok(discoverDatabaseTests('inventory').includes('schema-drift.db.test.js'));
  assert.ok(discoverDatabaseTests('inventory').includes('reserve-grn-fingerprint.db.test.js'));
  assert.ok(discoverDatabaseTests('analytics').includes('reorder-incoming-shortage.db.test.js'));
});
