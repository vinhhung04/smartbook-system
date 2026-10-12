const test = require('node:test');
const assert = require('node:assert/strict');
const { validateBundle, reviewEvent, partialDate, assertReady } = require('../src/services/metadata-provenance.service');

test('partial dates keep precision without inventing a calendar date', () => {
  assert.deepEqual(partialDate('2020'), { value: '2020', precision: 'year', date: null });
  assert.equal(partialDate('2020-02').precision, 'month');
  assert.equal(partialDate('2020-02-29').date.toISOString(), '2020-02-29T00:00:00.000Z');
  assert.throws(() => partialDate('2021-02-29'));
});
test('accept preserves origin and edit records before/after', () => {
  assert.equal(reviewEvent('title', 'A', 'A', 'u', 'ACCEPTED').action, 'ACCEPTED');
  const event = reviewEvent('title', 'A', 'B', 'u', 'ACCEPTED');
  assert.equal(event.action, 'EDITED');
  assert.equal(event.before, 'A');
  assert.equal(event.after, 'B');
});
test('unresolved decisions cannot be bypassed by apply', () => {
  assert.throws(() => assertReady({ decisions: [{ field: 'title', status: 'PENDING' }] }), /title/);
  assert.doesNotThrow(() => assertReady({ decisions: [{ field: 'title', status: 'REJECTED' }] }));
});
test('malformed pipeline references are rejected', () => {
  assert.throws(() => validateBundle({ schemaVersion: 'metadata-intelligence-v2.1', documents: [], candidates: [
    { id: 'c', sourceDocumentId: 'missing', evidenceIds: [] }], evidence: [], decisions: {}, provenance: {} }));
});

const { initialDecisionStatuses } = require('../src/services/metadata-provenance.service');

test('passthrough fields auto-accept only when no source marks them unsettled', () => {
  const statuses = initialDecisionStatuses({ autoAcceptFields: ['title', 'publishedDate', 'pageCount', 'description', 'isbn'] });
  assert.equal(statuses.title, 'ACCEPTED');
  assert.equal(statuses.authors, 'PENDING'); // authority field, reviewed in its own row
});

test('default ISBN lookup: CONFLICTED or LOW_CONFIDENCE fields wait for staff instead of being auto-accepted', () => {
  const statuses = initialDecisionStatuses({
    autoAcceptFields: ['title', 'publishedDate', 'pageCount', 'description', 'isbn'],
    lookupFieldStatus: { title: 'SUFFICIENT', publishedDate: 'CONFLICTED', description: 'LOW_CONFIDENCE', pageCount: 'MISSING' },
  });
  assert.equal(statuses.title, 'ACCEPTED');
  assert.equal(statuses.publishedDate, 'PENDING');
  assert.equal(statuses.description, 'PENDING');
  assert.equal(statuses.pageCount, 'ACCEPTED'); // nothing found -> nothing to approve
});

test('V2 REVIEW_REQUIRED decisions still demote a field', () => {
  const statuses = initialDecisionStatuses({
    autoAcceptFields: ['title', 'isbn'],
    intelligenceDecisions: { isbn: { status: 'REVIEW_REQUIRED' }, title: { status: 'PROPOSED' } },
  });
  assert.equal(statuses.isbn, 'PENDING');
  assert.equal(statuses.title, 'ACCEPTED');
});
