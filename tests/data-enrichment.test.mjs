import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const readSeed = (service) =>
  readFile(new URL(`../services/${service}/prisma/seed.js`, import.meta.url), 'utf8');

test('demo seeds include representative cross-service enrichment scenarios', async () => {
  const [auth, inventory, borrow] = await Promise.all([
    readSeed('auth-service'),
    readSeed('inventory-service'),
    readSeed('borrow-service'),
  ]);

  assert.match(auth, /curator01/);
  assert.match(inventory, /BK-EXT-001/);
  assert.match(inventory, /PO-EXT-001/);
  assert.match(inventory, /GR-EXT-001/);
  assert.match(inventory, /MOV-EXT-001/);
  assert.match(inventory, /READY_FOR_PUTAWAY/);
  assert.match(borrow, /CUST-EXT-001/);
  assert.match(borrow, /LOAN-EXT-OVERDUE/);
  assert.match(borrow, /PAYMENT-EXT-WALLET/);
});
