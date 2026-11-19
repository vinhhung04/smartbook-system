import assert from 'node:assert/strict';
import test from 'node:test';
import { sanitizeText } from '../../scripts/testing/sanitize-artifacts.mjs';

test('failure artifact sanitation removes QA passwords, DSNs, JWTs and bearer values', () => {
  const password = 'QA_ONLY_PASSWORD_MARKER_721';
  const sanitized = sanitizeText(`fill("${password}") postgresql://qa:fixture@127.0.0.1/audit authorization: Bearer FAKE_BEARER_MARKER eyJheader.eyJpayload.FAKE_signature`, [password]);
  for (const marker of [password, 'qa:fixture', 'FAKE_BEARER_MARKER', 'eyJheader.eyJpayload.FAKE_signature']) assert.equal(sanitized.includes(marker), false);
  assert.ok(sanitized.includes('[REDACTED'));
});
