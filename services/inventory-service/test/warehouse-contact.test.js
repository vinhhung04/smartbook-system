const test = require('node:test');
const assert = require('node:assert/strict');
const { parseBranchContact } = require('../src/controllers/warehouse.controller');

// Branch contact details entered by staff and shown on /branches/:id.

test('only the contact fields present in the body are written; blanks clear them', () => {
  assert.deepEqual(parseBranchContact({ name: 'x' }), { data: {} });
  assert.deepEqual(parseBranchContact({ phone: ' 028 3822 1234 ', opening_hours: 'T2–CN: 8:00–20:00', email: '', description: null }), {
    data: { phone: '028 3822 1234', opening_hours: 'T2–CN: 8:00–20:00', email: null, description: null },
  });
});

test('malformed phone/email and oversized values are rejected', () => {
  assert.match(parseBranchContact({ phone: 'call me' }).error, /phone/);
  assert.match(parseBranchContact({ email: 'not-an-email' }).error, /email/);
  assert.match(parseBranchContact({ opening_hours: 'x'.repeat(256) }).error, /opening_hours/);
  assert.match(parseBranchContact({ description: 'x'.repeat(2001) }).error, /description/);
});
