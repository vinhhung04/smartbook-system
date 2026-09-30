// Decision-support UX rules for the web app's AI surfaces.
// Pure logic comes from apps/web/src/lib/ai-decision.ts, transpiled here with the
// web app's own TypeScript so this runs on Node 20 (CI and the Docker images),
// which cannot load .ts files natively. ai-decision.ts must stay import-free for
// that. UI wording rules are asserted on the sources, since the web app has no
// component-test runner.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const src = (p) => readFileSync(resolve(root, 'apps/web/src', p), 'utf8');

const ts = createRequire(resolve(root, 'apps/web/package.json'))('typescript');
const { outputText } = ts.transpileModule(src('lib/ai-decision.ts'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
});
const {
  recommendationTier,
  recommendationFactors,
  RECOMMENDATION_TIER_LABEL,
  RECOMMENDATION_TIER_HIGH_MIN_SCORE,
  RECOMMENDATION_TIER_MID_MIN_SCORE,
  storageSuitability,
  summarizeStockLines,
  groupLinesByWarehouse,
  priorityLabel,
  canUserConfirmAction,
} = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);

test('recommendation score maps to ranking tiers, not percentages', () => {
  assert.equal(recommendationTier(RECOMMENDATION_TIER_HIGH_MIN_SCORE), 'STRONG');
  assert.equal(recommendationTier(RECOMMENDATION_TIER_HIGH_MIN_SCORE - 0.01), 'GOOD');
  assert.equal(recommendationTier(RECOMMENDATION_TIER_MID_MIN_SCORE), 'GOOD');
  assert.equal(recommendationTier(RECOMMENDATION_TIER_MID_MIN_SCORE - 0.01), 'EXPLORE');
  assert.equal(recommendationTier(undefined), 'EXPLORE');
  assert.equal(recommendationTier(Number.NaN), 'EXPLORE');
  for (const label of Object.values(RECOMMENDATION_TIER_LABEL)) assert.doesNotMatch(label, /%|\d/);
});

test('recommendation pages never render the score as a percentage or stars', () => {
  for (const page of ['components/pages/recommendations.tsx', 'components/pages/customer/recommendations.tsx', 'components/ai/recommendation-card.tsx']) {
    const code = src(page);
    assert.doesNotMatch(code, /score[^\n]*\*\s*100/, page);
    assert.doesNotMatch(code, /Độ phù hợp|Phù hợp \{/, page);
    assert.doesNotMatch(code, /<Star\b/, page);
  }
});

test('recommendation factors come only from the server breakdown', () => {
  assert.deepEqual(recommendationFactors(undefined), []);
  assert.deepEqual(recommendationFactors({ semantic: 0, affinity: 0, quality: 0, availability: 1 }), []);
  const f = recommendationFactors({ semantic: 0.7, affinity: 0.5, quality: 0.8, availability: 0.3 });
  assert.equal(f.length, 4);
});

test('a server-computed V2 tier wins over score thresholds; invalid tiers fall back', () => {
  assert.equal(recommendationTier(1, 'EXPLORE'), 'EXPLORE');
  assert.equal(recommendationTier(0, 'strong'), 'STRONG');
  assert.equal(recommendationTier(RECOMMENDATION_TIER_HIGH_MIN_SCORE, 'NOT_A_TIER'), 'STRONG');
  assert.equal(recommendationTier(0, null), 'EXPLORE');
});

test('V2 factors come only from server reason codes and never show numbers', () => {
  const f = recommendationFactors({ affinity: 0.9, semantic: 0.9, quality: 0.9, availability: null }, ['MATCHED_AUTHOR', 'SIMILAR_USERS_LIKED', 'AVAILABLE_NOW', 'UNKNOWN']);
  assert.deepEqual(f.length, 2);
  for (const text of f) assert.doesNotMatch(text, /%|\d/);
  assert.deepEqual(recommendationFactors({ affinity: 0.9 }, []), []);
  // Unknown stock (null) is not reported as out of stock.
  assert.deepEqual(recommendationFactors({ semantic: 0, affinity: 0, quality: 0, availability: null }), []);
});

test('storage suggestion confidence is presented as suitability, not AI confidence', () => {
  assert.equal(storageSuitability('HIGH').label, 'Rất phù hợp');
  assert.equal(storageSuitability('MEDIUM').label, 'Phù hợp');
  assert.equal(storageSuitability('LOW').label, 'Có thể cân nhắc');
  assert.equal(storageSuitability('???').label, 'Có thể cân nhắc');
  const panel = src('components/inventory/StorageSuggestionPanel.tsx');
  assert.doesNotMatch(panel, /confidence(Config)?\.label|AI confidence|Độ tin cậy|"Trung bình"/i);
  assert.match(panel, /Mức phù hợp/);
});

test('stock line summary counts what the payload actually contains', () => {
  const s = summarizeStockLines([
    { title: 'A', current_stock: 0, suggested_quantity: 10, priority: 'HIGH', warehouse_id: 'w1', warehouse_name: 'Kho HN', reorder_point: 5, suggested_supplier_name: 'NCC' },
    { title: 'B', current_stock: 2, suggested_quantity: 5, priority: 'MEDIUM', warehouse_id: 'w1', warehouse_name: 'Kho HN', reorder_point: 5 },
    { title: 'C', current_stock: 8, suggested_quantity: 3, priority: 'LOW', warehouse_id: null },
    { message: 'no title row' },
  ]);
  assert.equal(s.lineCount, 3);
  assert.equal(s.totalSuggestedQty, 18);
  assert.equal(s.highPriorityCount, 1);
  assert.equal(s.outOfStockCount, 1);
  assert.equal(s.belowMinimumCount, 1);
  assert.equal(s.withSupplierCount, 1);
  assert.equal(s.missingWarehouseCount, 1);
  assert.deepEqual(s.warehouses, ['Kho HN']);
  const groups = groupLinesByWarehouse([{ title: 'C', warehouse_id: null }, { title: 'A', warehouse_id: 'w1', warehouse_name: 'Kho HN' }]);
  assert.equal(groups[0].key, 'w1');
  assert.equal(groups.at(-1).label, 'Chưa xác định kho');
  assert.equal(priorityLabel('HIGH'), 'Ưu tiên cao');
});

test('confirm permission mirrors the backend role-or-permission rule', () => {
  const action = { allowed_roles: ['WAREHOUSE_MANAGER'], allowed_permissions: ['inventory.purchase.request'] };
  assert.equal(canUserConfirmAction(null, action), false);
  assert.equal(canUserConfirmAction({ is_superuser: true }, action), true);
  assert.equal(canUserConfirmAction({ roles: ['warehouse-manager'] }, action), true);
  assert.equal(canUserConfirmAction({ roles: ['CUSTOMER'], permissions: ['inventory.purchase.request'] }, action), true);
  assert.equal(canUserConfirmAction({ roles: ['CUSTOMER'], permissions: ['customer.self.read'] }, action), false);
});

test('AI action card: specific CTAs, explicit reject, no 9-10px text, no raw ids up front', () => {
  const card = src('components/ai-action-card.tsx');
  for (const cta of ['Tạo phiếu đề xuất nhập', 'Tạo cảnh báo', 'Tạo nhiệm vụ', 'Tạo đặt trước', 'Từ chối đề xuất', 'Điều chỉnh trước khi tạo']) {
    assert.match(card, new RegExp(cta), cta);
  }
  assert.doesNotMatch(card, />\s*Xác nhận\s*</);
  assert.doesNotMatch(card, /text-\[(9|10)px\]/);
  // UUIDs are only rendered inside the collapsed "Chi tiết kỹ thuật" block.
  assert.match(card, /Chi tiết kỹ thuật/);
  assert.doesNotMatch(card, /Variant ID:|Warehouse ID:/);
});

test('AI surfaces avoid wording that makes the system the decision maker', () => {
  for (const file of ['components/ai-action-card.tsx', 'components/ai/decision-card.tsx', 'components/inventory/StorageSuggestionPanel.tsx', 'components/pages/shelves.tsx', 'components/ai/recommendation-card.tsx']) {
    assert.doesNotMatch(src(file), /AI quyết định|AI chắc chắn|phương án tốt nhất/i, file);
  }
});
