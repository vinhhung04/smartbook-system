// Regression: `@@unique(..., map: "uniq_...")` only names the DATABASE
// constraint. Prisma's compound where-key is still built from the fields
// (e.g. `customer_id_book_id`). Using the map name made every wishlist,
// availability-alert and review upsert fail with PrismaClientValidationError
// (HTTP 500).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const schema = fs.readFileSync(path.join(__dirname, '..', 'prisma', 'schema.prisma'), 'utf8');
const constraintNames = [...schema.matchAll(/@@unique\([^)]*map:\s*"([^"]+)"/g)].map((m) => m[1]);

test('controllers never use a @@unique map: name as a Prisma where key', () => {
  const dir = path.join(__dirname, '..', 'src');
  const offenders = [];
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name.endsWith('.js')) {
        const code = fs.readFileSync(p, 'utf8');
        for (const name of constraintNames) {
          if (new RegExp(`\\b${name}\\s*:\\s*\\{`).test(code)) offenders.push(`${path.relative(dir, p)} uses ${name}`);
        }
      }
    }
  };
  walk(dir);
  assert.ok(constraintNames.length > 0);
  assert.deepEqual(offenders, []);
});
