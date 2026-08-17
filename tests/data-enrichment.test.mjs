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
  assert.match(inventory, /SUP-DEL-EXT-001/);
  assert.match(inventory, /OUT-EXT-001/);
  assert.match(inventory, /TR-EXT-001/);
  assert.match(inventory, /AUD-EXT-001/);
  assert.match(inventory, /PUR-REQ-EXT-001/);
  assert.match(inventory, /EXC-EXT-001/);
  assert.match(inventory, /Chuẩn bị khu vực xuất hàng/);
  assert.match(borrow, /CUST-EXT-001/);
  assert.match(borrow, /LOAN-EXT-OVERDUE/);
  assert.match(borrow, /PAYMENT-EXT-WALLET/);
});

test('every audited operational queue route has a representative inventory seed', async () => {
  const [routes, inventory] = await Promise.all([
    readFile(new URL('../apps/web/src/app/routes.ts', import.meta.url), 'utf8'),
    readSeed('inventory-service'),
  ]);

  const requiredCoverage = [
    ['supplier-deliveries', 'SUP-DEL-EXT-001'],
    ['picking', 'OUT-EXT-001'],
    ['packing', 'PACK-EXT-001'],
    ['outbound', 'OUT-EXT-001'],
    ['transfer-receiving', 'TR-EXT-001'],
    ['stock-audits', 'AUD-EXT-001'],
    ['purchase-requests', 'PUR-REQ-EXT-001'],
    ['exception-reports', 'EXC-EXT-001'],
    ['staff-tasks', 'Chuẩn bị khu vực xuất hàng'],
  ];

  for (const [route, seedMarker] of requiredCoverage) {
    assert.match(routes, new RegExp(`path: ["']${route}["']`));
    assert.match(inventory, new RegExp(seedMarker));
  }
});
