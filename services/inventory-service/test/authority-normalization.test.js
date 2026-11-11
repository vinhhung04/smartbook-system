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

test('authority fields auto-accept only when every value is already in the catalog', () => {
  const { exactAuthorityFields } = require('../src/services/authority-normalization.service');
  const exact = reconcileMetadata({ authors: ['Nguyen Nhat Anh'], publisher: 'Nhà xuất bản Trẻ', categories: ['Lập trình phần mềm'] }, authorities);
  assert.deepEqual(exactAuthorityFields(exact), ['authors', 'publisher', 'categories']);

  // one author missing from the catalog keeps the whole field for staff
  const mixed = reconcileMetadata({ authors: ['Nguyễn Nhật Ánh', 'Tác Giả Mới'], publisher: 'NXB Lạ', categories: [] }, authorities);
  assert.deepEqual(exactAuthorityFields(mixed), []);

  // a similar (not exact) name is a review, not an auto-accept
  const similar = reconcileMetadata({ authors: ['Nguyễn Nhật'], publisher: '', categories: ['Software Engineering'] }, authorities);
  assert.deepEqual(exactAuthorityFields(similar), ['categories']);
});

test('exact authority matches still wait for staff when the lookup sources disagree', () => {
  const { initialDecisionStatuses } = require('../src/services/metadata-provenance.service');
  const { exactAuthorityFields } = require('../src/services/authority-normalization.service');
  const result = reconcileMetadata({ authors: ['Nguyễn Nhật Ánh'], publisher: 'Nhà xuất bản Trẻ', categories: [] }, authorities);
  const autoAcceptFields = new Set(['title', ...exactAuthorityFields(result)]);
  const statuses = initialDecisionStatuses({ autoAcceptFields, lookupFieldStatus: { publisher: 'CONFLICTED' } });
  assert.equal(statuses.authors, 'ACCEPTED');
  assert.equal(statuses.publisher, 'PENDING');
});
