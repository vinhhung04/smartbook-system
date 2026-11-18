import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

export function availableStockFixture(minimum = 10) {
  assert.equal(process.env.SMARTBOOK_TEST_ISOLATED, '1', 'stock fixtures require the disposable test database');
  assert.ok(Number.isSafeInteger(minimum) && minimum > 0);
  assert.ok(process.env.DB_USER);
  const query = `SELECT row_to_json(s) FROM (SELECT sb.variant_id, sb.warehouse_id AS default_warehouse_id, sb.location_id AS default_location_id FROM stock_balances sb JOIN locations l ON l.id=sb.location_id WHERE sb.available_qty>=${minimum} AND l.is_pickable=true AND l.location_type IN ('SHELF_COMPARTMENT','BIN') ORDER BY sb.available_qty DESC, sb.id LIMIT 1) s`;
  const raw = execFileSync('docker', ['compose', 'exec', '-T', 'db', 'psql', '-U', process.env.DB_USER, '-d', 'inventory_db', '-v', 'ON_ERROR_STOP=1', '-At', '-c', query], { encoding: 'utf8' }).trim();
  assert.ok(raw, `seed needs ${minimum} genuinely available copies at one shelf`);
  return JSON.parse(raw);
}
