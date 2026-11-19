import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '../..');
const roles = ['AUTH', 'INVENTORY', 'BORROW', 'AI'];

test('fresh development/QA PostgreSQL receives every credential required by the owner bootstrap', () => {
  const compose = readFileSync(resolve(root, 'docker-compose.yml'), 'utf8');
  const db = compose.split(/^  db:\r?$/m)[1].split(/^  [a-z-]+:\r?$/m)[0];
  for (const role of roles) assert.ok(db.includes(`${role}_DB_PASSWORD: \u0024{${role}_DB_PASSWORD:`), `${role} runtime credential must reach the DB owner bootstrap`);
});

test('QA environment generation has four independent runtime-role secret placeholders', () => {
  const template = readFileSync(resolve(root, '.env.example'), 'utf8');
  const placeholders = roles.map(role => template.match(new RegExp(`^${role}_DB_PASSWORD=(GENERATE_[A-Z_]+)$`, 'm'))?.[1]);
  assert.ok(placeholders.every(Boolean), 'Every role requires a generated credential');
  assert.equal(new Set(placeholders).size, 4);
  assert.ok(placeholders.every(value => value !== 'GENERATE_POSTGRES_PASSWORD'), 'Runtime credentials must differ from the owner credential');
});

test('local demo env generator fills every GENERATE_* placeholder, including runtime roles', () => {
  const template = readFileSync(resolve(root, '.env.example'), 'utf8');
  const generator = readFileSync(resolve(root, 'scripts/init-demo-env.mjs'), 'utf8');
  const missing = [...new Set(template.match(/GENERATE_[A-Z_]+/g))].filter(placeholder => !generator.includes(`${placeholder}:`));
  assert.deepEqual(missing, [], 'pnpm demo:env must not leave a guessable literal placeholder as a secret');
});
