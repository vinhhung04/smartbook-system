const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const test = require('node:test');

const source = readFileSync(resolve(__dirname, '../src/index.js'), 'utf8');

test('gateway keeps all public service proxy prefixes', () => {
  for (const prefix of ['/auth', '/iam', '/api', '/borrow', '/analytics', '/ai']) {
    assert.match(source, new RegExp(`(?:pathFilter: |app\\.use\\(\\s*)["']${prefix}`));
  }
});

test('internal websocket pushes require a service key and allowlisted event', () => {
  assert.match(source, /x-internal-service-key/);
  assert.match(source, /ALLOWED_EVENTS/);
  assert.match(source, /ROOM_PATTERN/);
});
