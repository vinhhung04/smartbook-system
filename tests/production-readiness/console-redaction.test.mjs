import assert from 'node:assert/strict';
import test from 'node:test';
import { runRedactedCommand, sanitizeCapturedStreams } from '../../scripts/testing/redacted-command.mjs';
import { sanitizeText } from '../../scripts/testing/sanitize-artifacts.mjs';

test('browser failure output is redacted before both console streams, including split child writes', () => {
  const password = 'QA_PASSWORD_CONSOLE_MARKER_672';
  const internal = 'QA_INTERNAL_KEY_MARKER_672';
  const jwt = 'eyJCONSOLE_HEADER.eyJCONSOLE_PAYLOAD.QA_ONLY_SIGNATURE';
  let out = '', err = '';
  const output = { stdout: { write(text) { out += text; } }, stderr: { write(text) { err += text; } } };
  const payload = `progress retained\nfill("${password}") INTERNAL=${internal}\n"authorization": "Bearer ${jwt}"\npostgresql+asyncpg://qa:QA_DSN_PASSWORD@127.0.0.1/qa_audit\n`;
  const code = `const text=${JSON.stringify(payload)}; process.stdout.write(text.slice(0,37)); process.stdout.write(text.slice(37)); process.stderr.write(text); process.exitCode=7;`;
  const result = runRedactedCommand(process.execPath, ['-e', code], {
    env: { ...process.env, DEMO_PASSWORD: password, INTERNAL_SERVICE_KEY: internal },
  }, output);
  assert.equal(result.status, 7, 'Redaction must preserve a failing gate');
  for (const stream of [out, err]) {
    assert.ok(stream.includes('progress retained'));
    assert.ok(stream.includes('[REDACTED'));
    for (const marker of [password, internal, jwt, 'QA_DSN_PASSWORD']) assert.equal(stream.includes(marker), false);
  }
  assert.equal('stdout' in result, false, 'Raw output must not escape through the result object');
});

test('quoted authorization header values are removed even when they are not JWT-shaped', () => {
  const marker = 'QA_NON_JWT_BEARER_MARKER_672';
  const output = sanitizeText(`"authorization": "Bearer ${marker}"\n'authorization': 'Bearer ${marker}'`);
  assert.equal(output.includes(marker), false);
});

test('all captured runner outputs discard overflow, timeout, or signal fragments before logs and console', () => {
  for (const failure of [{ error: { code: 'ENOBUFS' } }, { error: { code: 'ETIMEDOUT' } }, { signal: 'SIGTERM' }]) {
    const safe = sanitizeCapturedStreams({ stdout: 'QA_SECRET_TRUNCATED', stderr: 'eyJpartialheader', ...failure });
    assert.equal(safe.stdout, '');
    assert.doesNotMatch(safe.stderr, /QA_SECRET|eyJpartial/);
    assert.match(safe.stderr, /unavailable or incomplete/);
  }
});

test('incomplete command capture fails closed without echoing partial secrets', () => {
  let combined = '';
  const sink = { write(value) { combined += value; } };
  const result = runRedactedCommand(process.execPath, ['-e', 'process.stdout.write("QA_PARTIAL_SECRET"); setInterval(()=>{},1000)'], {
    env: process.env, timeout: 100,
  }, { stdout: sink, stderr: sink });
  assert.ok(result.error || result.signal);
  assert.doesNotMatch(combined, /QA_PARTIAL_SECRET/);
  assert.match(combined, /unavailable or incomplete/);
});
