const test = require('node:test');
const assert = require('node:assert/strict');
const { reconcileMetadata, matchAuthority, normalizeCategory } = require('../src/services/authority-normalization.service');

const authorities = {
  authors: [{ id: 'a1', full_name: 'Nguyễn Nhật Ánh' }],
  authorAliases: [{ normalized_alias: 'nguyen nhat anh', status: 'APPROVED', authors: { id: 'a1', full_name: 'Nguyễn Nhật Ánh' } }],
  publishers: [{ id: 'p1', name: 'Nhà xuất bản Trẻ' }],
  publisherAliases: [],
  categories: [{ id: 'c1', name: 'Lập trình phần mềm' }],
};

test('matches author aliases regardless of Vietnamese accents and whitespace', () => {
  const result = matchAuthority('  Nguyen   Nhat Anh ', authorities.authors, authorities.authorAliases, 'full_name', 'author');
  assert.equal(result.status, 'AUTO_MATCH');
  assert.equal(result.matchedEntity.id, 'a1');
});

test('maps external English category into existing Vietnamese taxonomy', () => {
  const result = normalizeCategory('Software Engineering', authorities.categories);
  assert.equal(result.status, 'AUTO_MATCH');
  assert.equal(result.matchedEntity.id, 'c1');
});

test('keeps low-confidence authority candidates reviewable instead of auto matching', () => {
  const result = reconcileMetadata({ title: 'X', authors: ['Someone Else'], publisher: 'Nha xuat ban Tre', categories: ['Unknown'], pageCount: -1 }, authorities);
  assert.equal(result.authorNormalization[0].status, 'NEW_ENTITY');
  assert.equal(result.publisherNormalization.status, 'AUTO_MATCH');
  assert.ok(result.qualityWarnings.includes('ABNORMAL_PAGE_COUNT'));
});
